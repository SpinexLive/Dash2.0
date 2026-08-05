import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Body,
  Query,
  Inject,
  BadRequestException,
  BadGatewayException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import axios from 'axios';
import { prisma } from '@hll/db';
import Redis from 'ioredis';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { REDIS } from '../redis/redis.module';
import { AdminOnly } from '../common/decorators/auth.decorators';

const BOT_COMMAND_CHANNEL = 'bot:commands';
const BOT_RESPONSE_CHANNEL = 'bot:responses';
const RCON_API_URL_KEY = 'settings:rconApiUrl';
const RCON_API_TOKEN_KEY = 'settings:rconApiToken';
const ADMIN_CAMERA_ROLE = 'camera';
type RoleOption = { id: string; name: string; position?: number; color?: string };
type SteamBanPlayer = {
  SteamId: string;
  CommunityBanned: boolean;
  VACBanned: boolean;
  NumberOfVACBans: number;
  DaysSinceLastBan: number;
  NumberOfGameBans: number;
  EconomyBan: string;
};
type CrconAdmin = { playerId: string; role: string; name: string | null };

/** Steam IDs are numeric; Epic IDs are 32-char hex strings. */
function detectPlatform(id: string): 'steam' | 'epic' | null {
  const v = id.trim();
  if (/^[0-9a-fA-F]{32}$/.test(v)) return 'epic';
  if (/^\d+$/.test(v)) return 'steam';
  return null;
}

class UpdateMemberDto {
  @IsOptional() @IsString() currentRoleId?: string;
}

class SetGameAccountDto {
  @IsString() gameId!: string;
  /** Required companion Steam ID when the primary gameId is an Epic ID. */
  @IsOptional() @IsString() steamId?: string;
}

@Controller('members')
@UseGuards(JwtAuthGuard, AccessGuard)
export class MembersController {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  @Get()
  async list(
    @Query('role') roleId?: string,
    @Query('isMember') isMember?: string,
  ) {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const discordRoles = await this.currentDiscordRoles();
    const rankRoles = hydrateRoleOptions(
      flattenRankRoleSettings(settings?.rankRoles),
      discordRoles,
    );
    const collabRoleIds = roleIdsFromSettings(settings?.rankRoles, 'collab');

    // Default to active members plus any collab-role users who are not clan
    // members but should still appear on the roster page.
    const isMemberFilter = isMember === undefined ? undefined : isMember === 'true';
    const where =
      isMember === 'false'
        ? { isMember: false }
        : isMember === 'true'
          ? { isMember: true }
          : {
              OR: [
                { isMember: true },
                ...(collabRoleIds.length
                  ? [
                      {
                        user: {
                          roles: {
                            some: { roleId: { in: collabRoleIds } },
                          },
                        },
                      },
                    ]
                  : []),
              ],
            };

    const members = await prisma.member.findMany({
      where: {
        ...(roleId ? { currentRoleId: roleId } : {}),
        ...where,
      },
      include: {
        user: { include: { gameAccounts: true, roles: true, hllRecord: true } },
      },
      orderBy: { joinedAt: 'desc' },
    });

    // Member stats are the average across every match the player is linked to.
    const userIds = members.map((m) => m.user.id);
    const agg = userIds.length
      ? await prisma.matchPlayerStat.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds } },
          _avg: { kills: true, deaths: true, kpm: true },
          _count: { _all: true },
        })
      : [];
    const statsByUser = new Map(
      agg.map((a) => [a.userId?.toString() ?? '', a]),
    );

    // Serialize BigInt ids to strings for JSON transport.
    return members.map((m) => {
      const userRoleIds = new Set(m.user.roles.map((r) => r.roleId));
      // rankRoles is ordered highest-priority first; pick the first the user holds.
      const rankRole = rankRoles.find((r) => userRoleIds.has(r.id)) ?? null;
      const roleGroupNames = [...new Set(rankRoles.filter((r) => userRoleIds.has(r.id)).map((r) => r.name))];
      const a = statsByUser.get(m.user.id.toString());
      const avgKills = a ? Number(a._avg.kills ?? 0) : 0;
      const avgDeaths = a ? Number(a._avg.deaths ?? 0) : 0;
      return {
        id: m.id.toString(),
        currentRoleId: m.currentRoleId,
        isMember: m.isMember,
        rankRole,
        roleGroupNames,
        joinedAt: m.joinedAt,
        discordId: m.user.discordId,
        serverNick: m.user.serverNick ?? m.user.username,
        avatar: m.user.avatar,
        gameAccounts: m.user.gameAccounts.map((g) => ({
          platform: g.platform,
          gameId: g.gameId,
          verified: g.verified,
        })),
        stats: a
          ? {
              kills: Number(avgKills.toFixed(1)),
              deaths: Number(avgDeaths.toFixed(1)),
              kpm: Number(Number(a._avg.kpm ?? 0).toFixed(2)),
              matchesPlayed: a._count._all,
              kd:
                avgDeaths === 0
                  ? Number(avgKills.toFixed(2))
                  : Number((avgKills / avgDeaths).toFixed(2)),
            }
          : null,
        hllRecord: m.user.hllRecord
          ? {
              kpm:
                m.user.hllRecord.kpm !== null
                  ? Number(m.user.hllRecord.kpm)
                  : null,
              kdr:
                m.user.hllRecord.kdr !== null
                  ? Number(m.user.hllRecord.kdr)
                  : null,
              duelStrength: m.user.hllRecord.duelStrength,
              fetchedAt: m.user.hllRecord.fetchedAt,
            }
          : null,
      };
    });
  }

  /** Current HLL admin roles, used to mark the member directory. */
  @Get('admin-cam')
  async adminCamStatus() {
    const admins = await this.crconAdmins();
    return { admins };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const memberId = BigInt(id);
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      include: {
        user: {
          include: {
            gameAccounts: true,
            roles: true,
            hllRecord: true,
          },
        },
      },
    });
    if (!member) throw new NotFoundException('Member not found');

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const discordRoles = await this.currentDiscordRoles();
    const rankRoles = hydrateRoleOptions(
      flattenRankRoleSettings(settings?.rankRoles),
      discordRoles,
    );
    const userRoleIds = new Set(member.user.roles.map((r) => r.roleId));
    const rankRole = rankRoles.find((r) => userRoleIds.has(r.id)) ?? null;
    const roleGroupNames = [...new Set(rankRoles.filter((r) => userRoleIds.has(r.id)).map((r) => r.name))];

    const [aggregate, recentMatches, rosterSlots] = await Promise.all([
      prisma.matchPlayerStat.aggregate({
        where: { userId: member.userId },
        _sum: { kills: true, deaths: true },
        _avg: { kills: true, deaths: true, kpm: true },
        _count: { _all: true },
      }),
      prisma.matchPlayerStat.findMany({
        where: { userId: member.userId },
        include: { match: true },
        orderBy: [{ match: { playedAt: 'desc' } }, { matchId: 'desc' }],
        take: 12,
      }),
      prisma.rosterSlot.findMany({
        where: { userId: member.userId },
        include: { roster: true },
        orderBy: [{ roster: { eventStartTime: 'desc' } }, { id: 'desc' }],
        take: 12,
      }),
    ]);

    const totalKills = aggregate._sum.kills ?? 0;
    const totalDeaths = aggregate._sum.deaths ?? 0;
    const avgKills = Number(aggregate._avg.kills ?? 0);
    const avgDeaths = Number(aggregate._avg.deaths ?? 0);

    return {
      id: member.id.toString(),
      userId: member.userId.toString(),
      currentRoleId: member.currentRoleId,
      isMember: member.isMember,
      rankRole,
      roleGroupNames,
      joinedAt: member.joinedAt,
      discordId: member.user.discordId,
      username: member.user.username,
      serverNick: member.user.serverNick ?? member.user.username,
      avatar: member.user.avatar,
      gameAccounts: member.user.gameAccounts.map((g) => ({
        platform: g.platform,
        gameId: g.gameId,
        verified: g.verified,
        linkedAt: g.linkedAt,
      })),
      stats: {
        totalKills,
        totalDeaths,
        avgKills: Number(avgKills.toFixed(1)),
        avgDeaths: Number(avgDeaths.toFixed(1)),
        kpm: Number(Number(aggregate._avg.kpm ?? 0).toFixed(2)),
        matchesPlayed: aggregate._count._all,
        kd:
          totalDeaths === 0
            ? Number(totalKills.toFixed(2))
            : Number((totalKills / totalDeaths).toFixed(2)),
      },
      hllRecord: member.user.hllRecord
        ? {
            kpm:
              member.user.hllRecord.kpm !== null
                ? Number(member.user.hllRecord.kpm)
                : null,
            kdr:
              member.user.hllRecord.kdr !== null
                ? Number(member.user.hllRecord.kdr)
                : null,
            duelStrength: member.user.hllRecord.duelStrength,
            fetchedAt: member.user.hllRecord.fetchedAt,
          }
        : null,
      recentMatches: recentMatches.map((stat) => ({
        id: stat.id.toString(),
        matchId: stat.matchId.toString(),
        map: stat.match.map,
        result: stat.match.result,
        playedAt: stat.match.playedAt,
        eventType: stat.match.eventType,
        eventName: stat.match.eventName,
        opponent: stat.match.opponent,
        team: stat.team,
        kills: stat.kills,
        deaths: stat.deaths,
        kd:
          stat.deaths === 0
            ? Number(stat.kills.toFixed(2))
            : Number((stat.kills / stat.deaths).toFixed(2)),
        kpm: Number(stat.kpm),
      })),
      rosterHistory: rosterSlots.map((slot) => ({
        id: slot.id.toString(),
        rosterId: slot.rosterId.toString(),
        raidhelperEventId: slot.roster.raidhelperEventId,
        eventTitle: slot.roster.eventTitle ?? slot.roster.name,
        eventStartTime: slot.roster.eventStartTime,
        position: slot.position,
        response: slot.response,
        respondedAt: slot.respondedAt,
        status: slot.roster.status,
      })),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateMemberDto) {
    const member = await prisma.member.update({
      where: { id: BigInt(id) },
      data: { currentRoleId: dto.currentRoleId },
    });
    return { id: member.id.toString(), currentRoleId: member.currentRoleId };
  }

  /** Ask the bot to re-sync the full guild member list into the directory. */
  @Post('sync')
  async sync() {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Discord sync timed out after 180 seconds.'));
        }, 180_000);

        const onMessage = (channel: string, message: string) => {
          if (channel !== BOT_RESPONSE_CHANNEL) return;
          try {
            const payload = JSON.parse(message) as { type?: string; requestId?: string; ok?: boolean; error?: string };
            if (payload.type === 'syncMembersComplete' && payload.requestId === requestId) {
              cleanup();
              resolve();
            }
          } catch {
            // ignore malformed responses
          }
        };

        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };

        const cleanup = () => {
          clearTimeout(timeout);
          subscriber.off('message', onMessage);
          subscriber.off('error', onError);
          void subscriber.unsubscribe(BOT_RESPONSE_CHANNEL).catch(() => {});
          void subscriber.quit().catch(() => {});
        };

        subscriber.on('message', onMessage);
        subscriber.on('error', onError);
        void subscriber.subscribe(BOT_RESPONSE_CHANNEL).then(() => {
          void this.redis.publish(BOT_COMMAND_CHANNEL, JSON.stringify({ type: 'syncMembers', requestId })).catch((error) => {
            cleanup();
            reject(error);
          });
        }).catch((error) => {
          cleanup();
          reject(error);
        });
      });

      return { ok: true, status: 'complete' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Discord sync failed.';
      return { ok: false, status: 'error', message };
    }
  }

  /** Ask the bot to refresh HLLRecords stats for all Steam-linked members. */
  @Post('hllrecords/refresh')
  async refreshHllRecords() {
    await this.redis.publish(
      BOT_COMMAND_CHANNEL,
      JSON.stringify({ type: 'scrapeHllRecords' }),
    );
    return { ok: true };
  }

  /**
   * Gives every active Steam-linked member the HLL "camera" admin role, or
   * removes that role from those members when everyone already has access.
   * Existing non-camera roles are deliberately never downgraded or deleted.
   */
  @Post('admin-cam/toggle')
  @AdminOnly()
  async toggleAdminCam() {
    const members = await prisma.member.findMany({
      where: { isMember: true },
      include: { user: { include: { gameAccounts: true } } },
    });
    const eligible = members.flatMap((member) => {
      const steam = member.user.gameAccounts.find(
        (account) => account.platform === 'steam' && /^\d+$/.test(account.gameId),
      );
      return steam
        ? [{ playerId: steam.gameId, name: member.user.serverNick ?? member.user.username }]
        : [];
    });
    if (!eligible.length) {
      throw new BadRequestException('No active members have a Steam ID to grant camera access to');
    }

    const admins = await this.crconAdmins();
    const adminByPlayerId = new Map(admins.map((admin) => [admin.playerId, admin]));
    const missingAccess = eligible.filter(({ playerId }) => !adminByPlayerId.has(playerId));

    if (missingAccess.length) {
      for (const member of missingAccess) {
        await this.crconRequest('add_admin', {
          player_id: member.playerId,
          role: ADMIN_CAMERA_ROLE,
          description: member.name,
        });
      }
      return {
        action: 'enabled',
        added: missingAccess.length,
        alreadyAdmin: eligible.length - missingAccess.length,
        skipped: members.length - eligible.length,
      };
    }

    // HLL's AdminDel removes every role for an ID. Only remove roles that this
    // dashboard owns (the exact "camera" role), never senior/admin roles.
    const cameraAdmins = eligible.filter(
      ({ playerId }) => adminByPlayerId.get(playerId)?.role.toLowerCase() === ADMIN_CAMERA_ROLE,
    );
    for (const member of cameraAdmins) {
      await this.crconRequest('remove_admin', { player_id: member.playerId });
    }
    return {
      action: 'disabled',
      removed: cameraAdmins.length,
      retainedOtherAdminRoles: eligible.length - cameraAdmins.length,
      skipped: members.length - eligible.length,
    };
  }

  /** Check VAC/game ban status for active Steam-primary members only. */
  @Post('vac-bans/check')
  async checkVacBans() {
    const apiKey = process.env.STEAM_WEB_API_KEY?.trim();
    if (!apiKey) {
      throw new BadRequestException('STEAM_WEB_API_KEY is not configured');
    }

    const members = await prisma.member.findMany({
      where: { isMember: true },
      select: {
        id: true,
        user: {
          select: {
            gameAccounts: {
              select: { platform: true, gameId: true },
            },
          },
        },
      },
    });

    const steamChecks = members.flatMap((member) => {
      const epic = member.user.gameAccounts.find((g) => g.platform === 'epic');
      if (epic) return [];
      const steam = member.user.gameAccounts.find(
        (g) => g.platform === 'steam' && /^\d+$/.test(g.gameId),
      );
      return steam
        ? [{ memberId: member.id.toString(), steamId: steam.gameId }]
        : [];
    });

    const banBySteamId = await getSteamBanStatuses(
      [...new Set(steamChecks.map((check) => check.steamId))],
      apiKey,
    );

    const checkedAt = new Date().toISOString();
    return {
      checkedAt,
      results: steamChecks.map((check) => {
        const ban = banBySteamId.get(check.steamId);
        return {
          memberId: check.memberId,
          steamId: check.steamId,
          vacBanned: ban?.VACBanned ?? false,
          vacBanCount: ban?.NumberOfVACBans ?? 0,
          gameBanCount: ban?.NumberOfGameBans ?? 0,
          daysSinceLastBan: ban?.DaysSinceLastBan ?? 0,
          communityBanned: ban?.CommunityBanned ?? false,
          economyBan: ban?.EconomyBan ?? 'none',
          found: Boolean(ban),
        };
      }),
    };
  }

  /** Edit (or create) a member's game id. Anyone with access may correct ids. */
  @Patch(':id/game-account')
  async setGameAccount(@Param('id') id: string, @Body() dto: SetGameAccountDto) {
    const member = await prisma.member.findUnique({
      where: { id: BigInt(id) },
      include: { user: { include: { gameAccounts: true } } },
    });
    if (!member) throw new NotFoundException('Member not found');

    const gameId = dto.gameId.trim();
    const platform = detectPlatform(gameId);
    if (!platform) {
      throw new BadRequestException(
        'Game ID must be a numeric Steam ID or a 32-character Epic ID',
      );
    }

    const userId = member.user.id;
    const accounts = member.user.gameAccounts;

    const upsertAccount = async (plat: string, value: string) => {
      const existing = accounts.find((a) => a.platform === plat);
      if (existing) {
        await prisma.gameAccount.update({
          where: { id: existing.id },
          data: { gameId: value },
        });
      } else {
        await prisma.gameAccount.create({
          data: { userId, platform: plat, gameId: value },
        });
      }
    };

    if (platform === 'epic') {
      // Epic players must also supply a valid Steam ID (stored for later
      // automated extraction, but hidden from the main table).
      const steamId = dto.steamId?.trim();
      if (!steamId || !/^\d+$/.test(steamId)) {
        throw new BadRequestException(
          'Epic players must also provide a valid numeric Steam ID',
        );
      }
      await upsertAccount('epic', gameId);
      await upsertAccount('steam', steamId);
    } else {
      // Pure Steam player: store the steam id and drop any stale epic link.
      await upsertAccount('steam', gameId);
      const epic = accounts.find((a) => a.platform === 'epic');
      if (epic) {
        await prisma.gameAccount.delete({ where: { id: epic.id } });
      }
    }

    const updated = await prisma.gameAccount.findMany({ where: { userId } });
    return updated.map((g) => ({
      platform: g.platform,
      gameId: g.gameId,
      verified: g.verified,
    }));
  }

  private async currentDiscordRoles(): Promise<RoleOption[]> {
    const raw = await this.redis.get('discord:roles');
    return raw ? JSON.parse(raw) : [];
  }

  private async crconAdmins(): Promise<CrconAdmin[]> {
    const data = await this.crconRequest<unknown>('get_admin_ids');
    return extractCrconAdmins(data);
  }

  private async crconRequest<T = unknown>(action: string, body?: Record<string, string>) {
    const [savedBase, savedToken] = await Promise.all([
      this.redis.get(RCON_API_URL_KEY),
      this.redis.get(RCON_API_TOKEN_KEY),
    ]);
    const base = savedBase ?? process.env.RCON_API_URL ?? process.env.CRCON_BASE_URL;
    const token = savedToken ?? process.env.RCON_API_TOKEN ?? process.env.CRCON_API_KEY;
    if (!base?.trim()) {
      throw new BadRequestException('Set the RCON API URL in Settings first');
    }

    try {
      const url = `${base.replace(/\/$/, '')}/api/${action}`;
      const response = body
        ? await axios.post<T>(url, body, { headers: { Authorization: `Bearer ${token ?? ''}` }, timeout: 15_000 })
        : await axios.get<T>(url, { headers: { Authorization: `Bearer ${token ?? ''}` }, timeout: 15_000 });
      return response.data;
    } catch (error) {
      const detail = axios.isAxiosError(error) && typeof error.response?.data === 'string'
        ? `: ${error.response.data}`
        : '';
      throw new BadGatewayException(`Could not contact the configured RCON server${detail}`);
    }
  }
}

function extractCrconAdmins(data: unknown): CrconAdmin[] {
  const unwrapped = data && typeof data === 'object'
    ? (data as { result?: unknown; data?: unknown }).result ?? (data as { data?: unknown }).data ?? data
    : data;
  if (!Array.isArray(unwrapped)) return [];
  return unwrapped.flatMap((entry): CrconAdmin[] => {
    if (Array.isArray(entry)) {
      const [playerId, role, name] = entry;
      return typeof playerId === 'string' && typeof role === 'string'
        ? [{ playerId, role, name: typeof name === 'string' ? name : null }]
        : [];
    }
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as Record<string, unknown>;
    const playerId = value.player_id ?? value.steam_id_64 ?? value.playerId;
    const role = value.role ?? value.admin_role;
    const name = value.name ?? value.description;
    return typeof playerId === 'string' && typeof role === 'string'
      ? [{ playerId, role, name: typeof name === 'string' ? name : null }]
      : [];
  });
}

function hydrateRoleOptions(saved: unknown, current: RoleOption[]) {
  if (!Array.isArray(saved)) return [];
  const byId = new Map(current.map((role) => [role.id, role]));
  return saved
    .filter((role): role is RoleOption => Boolean(role?.id))
    .map((role) => byId.get(role.id) ?? role);
}

function flattenRankRoleSettings(saved: unknown): RoleOption[] {
  if (Array.isArray(saved)) return saved;
  if (!saved || typeof saved !== 'object') return [];
  const src = saved as Record<string, unknown>;
  return [
    ...roleOptions(src.competitive),
    ...roleOptions(src.member),
    ...roleOptions(src.recruit),
    ...roleOptions(src.collab),
  ];
}

function roleIdsFromSettings(saved: unknown, group: 'recruit' | 'member' | 'competitive' | 'collab') {
  if (Array.isArray(saved)) return group === 'member' ? roleIdSet(saved) : [];
  if (!saved || typeof saved !== 'object') return [];
  const src = saved as Record<string, unknown>;
  return roleIdSet(src[group]);
}

function roleIdSet(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((role) => {
      if (typeof role === 'string') return role;
      if (role && typeof role === 'object' && 'id' in role && typeof role.id === 'string') return role.id;
      return null;
    })
    .filter((roleId): roleId is string => Boolean(roleId));
}

function roleOptions(input: unknown): RoleOption[] {
  if (!Array.isArray(input)) return [];
  return input.filter((role): role is RoleOption => Boolean(role?.id));
}

async function getSteamBanStatuses(steamIds: string[], apiKey: string) {
  const result = new Map<string, SteamBanPlayer>();
  for (let i = 0; i < steamIds.length; i += 100) {
    const batch = steamIds.slice(i, i + 100);
    if (batch.length === 0) continue;

    const url = new URL(
      'https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/',
    );
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', batch.join(','));
    url.searchParams.set('format', 'json');

    try {
      const response = await axios.get<{ players?: SteamBanPlayer[] }>(
        url.toString(),
        { timeout: 10000 },
      );
      for (const player of response.data.players ?? []) {
        result.set(player.SteamId, player);
      }
    } catch {
      throw new BadGatewayException('Could not check Steam ban status');
    }
  }
  return result;
}
