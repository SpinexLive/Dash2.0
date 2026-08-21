import { Body, Controller, Get, Inject, Patch, UseGuards, BadRequestException } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import type Redis from 'ioredis';
import { Prisma, prisma } from '@hll/db';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { AdminOnly, Public } from '../common/decorators/auth.decorators';
import { REDIS } from '../redis/redis.module';
import { PermissionService } from '../access-control/permission.service';

type RoleOption = { id: string; name: string; position?: number; color?: string };
type JsonObject = Record<string, Prisma.InputJsonValue>;
type RankRoleSettings = {
  recruit: RoleOption[];
  member: RoleOption[];
  competitive: RoleOption[];
  collab: RoleOption[];
};
type BriefingVoiceChannelSettings = {
  categoryId: string | null;
  names: string[];
  autoDelete: boolean;
  deleteAfterMinutes: number | null;
};
type ImportRow = { discordId: string; gameId: string };

const LOGO_KEY = 'settings:logo';
const BRIEFING_VOICE_CHANNEL_KEY = 'settings:briefingVoiceChannelId';
const RCON_API_URL_KEY = 'settings:rconApiUrl';
const RCON_API_TOKEN_KEY = 'settings:rconApiToken';
const DEFAULT_RCON_API_URL = 'http://45.151.81.182:8010/';
const DEFAULT_RCON_API_TOKEN = 'ecb6970c-0c86-420c-8902-c7c71729018b';

class UpdateSettingsDto {
  @IsOptional() @IsString() memberRoleId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) memberRoleIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) adminRoleIds?: string[];
  @IsOptional() @IsArray() selectableRoles?: RoleOption[];
  @IsOptional() rankRoles?: RoleOption[] | RankRoleSettings;
  @IsOptional() @IsObject() rosterEmojis?: JsonObject;
  @IsOptional() @IsString() recruitChannelId?: string;
  @IsOptional() @IsString() matchChannelId?: string;
  @IsOptional() @IsString() squadLeaderRoleId?: string | null;
  @IsOptional() @IsString() briefingVoiceChannelId?: string | null;
  @IsOptional() @IsObject() briefingVoiceChannels?: BriefingVoiceChannelSettings;
  @IsOptional() @IsString() rconApiUrl?: string | null;
  @IsOptional() @IsString() rconApiToken?: string | null;
  @IsOptional() @IsString() tournamentRosterSheetUrl?: string | null;
}

class BriefingVoiceChannelSettingsDto {
  @IsOptional() @IsString() categoryId?: string | null;
  @IsArray() @IsString({ each: true }) names!: string[];
  @IsOptional() @IsBoolean() autoDelete?: boolean;
  @IsOptional() @IsInt() @Min(1) deleteAfterMinutes?: number | null;
}

class SetLogoDto {
  /** A base64 image data URL, or null/empty to clear the logo. */
  @IsOptional() @IsString() logoUrl?: string | null;
}

class ImportGameIdsDto {
  @IsArray() rows!: unknown[];
}

@Controller('settings')
@UseGuards(JwtAuthGuard, AccessGuard)
export class SettingsController {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly permissions: PermissionService,
  ) {}

  @Get()
  async get() {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const [
      briefingVoiceChannelId,
      rconApiUrl,
      rconApiToken,
      currentRoles,
      accessRoles,
    ] = await Promise.all([
      this.redis.get(BRIEFING_VOICE_CHANNEL_KEY),
      this.redis.get(RCON_API_URL_KEY),
      this.redis.get(RCON_API_TOKEN_KEY),
      this.roles(),
      prisma.accessAllowedRole.findMany({ select: { roleId: true } }),
    ]);
    const baseSettings = settings ?? {
      memberRoleId: null,
      memberRoleIds: [],
      recruitChannelId: null,
      matchChannelId: null,
      squadLeaderRoleId: null,
      tournamentRosterSheetUrl: null,
      briefingVoiceChannels: {},
      rankRoles: [],
      selectableRoles: [],
      rosterEmojis: {},
    };

    const memberRoleIds = normalizeMemberRoleIds(
      'memberRoleIds' in baseSettings ? baseSettings.memberRoleIds : [],
      baseSettings.memberRoleId,
    );

    return {
      ...baseSettings,
      memberRoleIds,
      memberRoleId: memberRoleIds[0] ?? baseSettings.memberRoleId ?? null,
      adminRoleIds: accessRoles.map((role) => role.roleId),
      rankRoles: hydrateRankRoleSettings(baseSettings.rankRoles, currentRoles),
      selectableRoles: hydrateRoleOptions(baseSettings.selectableRoles, currentRoles),
      briefingVoiceChannels: normalizeBriefingVoiceChannelSettings(baseSettings.briefingVoiceChannels),
      briefingVoiceChannelId: briefingVoiceChannelId ?? null,
      rconApiUrl: rconApiUrl ?? DEFAULT_RCON_API_URL,
      rconApiToken: rconApiToken ?? DEFAULT_RCON_API_TOKEN,
    };
  }

  /** Discord roles snapshotted by the bot (highest hierarchy first). */
  @Get('discord/roles')
  async roles(): Promise<RoleOption[]> {
    const raw = await this.redis.get('discord:roles');
    return raw ? JSON.parse(raw) : [];
  }

  /** Text channels snapshotted by the bot. */
  @Get('discord/channels')
  async channels() {
    const raw = await this.redis.get('discord:channels');
    return raw ? JSON.parse(raw) : [];
  }

  /** Voice channels snapshotted by the bot. */
  @Get('discord/voice-channels')
  async voiceChannels() {
    const raw = await this.redis.get('discord:voiceChannels');
    return raw ? JSON.parse(raw) : [];
  }

  /** Discord categories snapshotted by the bot. */
  @Get('discord/categories')
  async categories() {
    const raw = await this.redis.get('discord:categories');
    return raw ? JSON.parse(raw) : [];
  }

  /** Custom server emojis snapshotted by the bot. */
  @Get('discord/emojis')
  async emojis() {
    const raw = await this.redis.get('discord:emojis');
    return raw ? JSON.parse(raw) : [];
  }

  /** The clan logo shown in the nav (base64 data URL, stored in Redis). */
  @Get('logo')
  @Public()
  async getLogo() {
    const logoUrl = await this.redis.get(LOGO_KEY);
    return { logoUrl: logoUrl ?? null };
  }

  /** Upload or clear the clan logo. */
  @Patch('logo')
  @AdminOnly()
  async setLogo(@Body() dto: SetLogoDto) {
    const value = dto.logoUrl?.trim();
    if (!value) {
      await this.redis.del(LOGO_KEY);
      return { logoUrl: null };
    }
    if (!/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/.test(value)) {
      throw new BadRequestException('Logo must be a base64 image data URL');
    }
    if (value.length > 4_000_000) {
      throw new BadRequestException('Logo image is too large (max ~3MB)');
    }
    await this.redis.set(LOGO_KEY, value);
    return { logoUrl: value };
  }

  @Patch()
  @AdminOnly()
  async update(@Body() dto: UpdateSettingsDto) {
    const {
      rosterEmojis: rosterEmojiDto,
      briefingVoiceChannels: briefingVoiceChannelsDto,
      briefingVoiceChannelId,
      rconApiUrl,
      rconApiToken,
      ...rest
    } = dto;
    const memberRoleIds = normalizeMemberRoleIds(rest.memberRoleIds, rest.memberRoleId);
    const adminRoleIds = normalizeRoleIds(rest.adminRoleIds);
    const rosterEmojis = (rosterEmojiDto ?? {}) as Prisma.InputJsonValue;
    const briefingVoiceChannels = normalizeBriefingVoiceChannelSettings(briefingVoiceChannelsDto) as Prisma.InputJsonValue;
    await Promise.all([
      briefingVoiceChannelId !== undefined
        ? setOrDelete(this.redis, BRIEFING_VOICE_CHANNEL_KEY, briefingVoiceChannelId)
        : Promise.resolve(),
      rconApiUrl !== undefined ? setOrDelete(this.redis, RCON_API_URL_KEY, rconApiUrl) : Promise.resolve(),
      rconApiToken !== undefined
        ? setOrDelete(this.redis, RCON_API_TOKEN_KEY, rconApiToken)
        : Promise.resolve(),
    ]);
    const { adminRoleIds: _adminRoleIds, ...settingsRest } = rest;
    const settings = await prisma.$transaction(async (tx) => {
      const saved = await tx.settings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          guildId: process.env.DISCORD_GUILD_ID ?? '',
          ...settingsRest,
          memberRoleId: memberRoleIds[0] ?? null,
          memberRoleIds,
          selectableRoles: settingsRest.selectableRoles ?? [],
          rankRoles: normalizeRankRoleSettings(settingsRest.rankRoles) as Prisma.InputJsonValue,
          rosterEmojis,
          briefingVoiceChannels,
        },
        update: {
          ...settingsRest,
          ...(settingsRest.memberRoleId !== undefined || settingsRest.memberRoleIds !== undefined
            ? { memberRoleId: memberRoleIds[0] ?? null, memberRoleIds }
            : {}),
          ...(settingsRest.selectableRoles ? { selectableRoles: settingsRest.selectableRoles } : {}),
          ...(settingsRest.rankRoles
            ? { rankRoles: normalizeRankRoleSettings(settingsRest.rankRoles) as Prisma.InputJsonValue }
            : {}),
          ...(rosterEmojiDto ? { rosterEmojis } : {}),
          ...(briefingVoiceChannelsDto ? { briefingVoiceChannels } : {}),
        },
      });
      if (rest.adminRoleIds !== undefined) {
        await tx.accessAllowedRole.deleteMany();
        if (adminRoleIds.length) {
          await tx.accessAllowedRole.createMany({
            data: adminRoleIds.map((roleId) => ({ roleId })),
            skipDuplicates: true,
          });
        }
      }
      return saved;
    });
    if (rest.adminRoleIds !== undefined) {
      await this.permissions.bustAll();
    }
    const currentRoles = await this.roles();
    const accessRoles = await prisma.accessAllowedRole.findMany({
      select: { roleId: true },
    });
    return {
      ...settings,
      memberRoleIds: normalizeMemberRoleIds(settings.memberRoleIds, settings.memberRoleId),
      adminRoleIds: accessRoles.map((role) => role.roleId),
      rankRoles: hydrateRankRoleSettings(settings.rankRoles, currentRoles),
      selectableRoles: hydrateRoleOptions(settings.selectableRoles, currentRoles),
      briefingVoiceChannels: normalizeBriefingVoiceChannelSettings(settings.briefingVoiceChannels),
      briefingVoiceChannelId: briefingVoiceChannelId ?? null,
      rconApiUrl: rconApiUrl ?? DEFAULT_RCON_API_URL,
      rconApiToken: rconApiToken ?? DEFAULT_RCON_API_TOKEN,
    };
  }

  @Patch('import-game-ids')
  @AdminOnly()
  async importGameIds(@Body() dto: ImportGameIdsDto) {
    const rows = dto.rows.map(normalizeImportRow).filter(Boolean) as ImportRow[];
    const discordIds = [...new Set(rows.map((row) => row.discordId))];
    const users = discordIds.length
      ? await prisma.user.findMany({
          where: { discordId: { in: discordIds } },
          select: { id: true, discordId: true },
        })
      : [];
    const usersByDiscord = new Map(users.map((user) => [user.discordId, user]));

    let matched = 0;
    let updated = 0;
    let missingUser = 0;
    let invalidGameId = 0;

    for (const row of rows) {
      const user = usersByDiscord.get(row.discordId);
      if (!user) {
        missingUser += 1;
        continue;
      }
      matched += 1;
      const platform = detectGamePlatform(row.gameId);
      if (!platform) {
        invalidGameId += 1;
        continue;
      }
      await prisma.gameAccount.upsert({
        where: {
          platform_gameId: { platform, gameId: row.gameId },
        },
        create: {
          userId: user.id,
          platform,
          gameId: row.gameId,
        },
        update: {
          userId: user.id,
        },
      });
      updated += 1;
    }

    return {
      rows: dto.rows.length,
      parsed: rows.length,
      matched,
      updated,
      missingUser,
      invalidGameId,
    };
  }
}

export function normalizeBriefingVoiceChannelSettings(input: unknown): BriefingVoiceChannelSettings {
  const src = input && typeof input === 'object' ? (input as Partial<BriefingVoiceChannelSettings>) : {};
  const categoryId = typeof src.categoryId === 'string' && src.categoryId.trim() ? src.categoryId.trim() : null;
  const names = Array.isArray(src.names)
    ? src.names
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean)
        .slice(0, 25)
    : [];
  const autoDelete = Boolean(src.autoDelete);
  const deleteAfterMinutes = Number.isInteger(src.deleteAfterMinutes) && Number(src.deleteAfterMinutes) > 0
    ? Math.min(Number(src.deleteAfterMinutes), 10080)
    : null;
  return {
    categoryId,
    names,
    autoDelete,
    deleteAfterMinutes: autoDelete ? deleteAfterMinutes : null,
  };
}

function setOrDelete(redis: Redis, key: string, value?: string | null) {
  const clean = value?.trim();
  return clean ? redis.set(key, clean) : redis.del(key);
}

function normalizeMemberRoleIds(input: unknown, fallback?: string | null) {
  const clean = normalizeRoleIds(input);
  if (fallback?.trim()) clean.push(fallback.trim());
  return [...new Set(clean)];
}

function normalizeRoleIds(input: unknown) {
  const ids = Array.isArray(input) ? input : [];
  return [
    ...new Set(
      ids
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

function hydrateRoleOptions(saved: unknown, current: RoleOption[]) {
  if (!Array.isArray(saved)) return [];
  const byId = new Map(current.map((role) => [role.id, role]));
  return saved
    .filter((role): role is RoleOption => Boolean(role?.id))
    .map((role) => byId.get(role.id) ?? role);
}

function normalizeRankRoleSettings(input: unknown): RankRoleSettings {
  if (Array.isArray(input)) {
    return {
      recruit: [],
      member: cleanRoleOptions(input),
      competitive: [],
      collab: [],
    };
  }
  if (!input || typeof input !== 'object') {
    return { recruit: [], member: [], competitive: [], collab: [] };
  }
  const src = input as Partial<Record<keyof RankRoleSettings, unknown>>;
  return {
    recruit: cleanRoleOptions(src.recruit),
    member: cleanRoleOptions(src.member),
    competitive: cleanRoleOptions(src.competitive),
    collab: cleanRoleOptions(src.collab),
  };
}

function hydrateRankRoleSettings(saved: unknown, current: RoleOption[]): RankRoleSettings {
  const normalized = normalizeRankRoleSettings(saved);
  return {
    recruit: hydrateRoleOptions(normalized.recruit, current),
    member: hydrateRoleOptions(normalized.member, current),
    competitive: hydrateRoleOptions(normalized.competitive, current),
    collab: hydrateRoleOptions(normalized.collab, current),
  };
}

function cleanRoleOptions(input: unknown): RoleOption[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((role) => {
      if (!role || typeof role !== 'object' || !('id' in role)) return null;
      const id = typeof role.id === 'string' ? role.id.trim() : '';
      if (!id) return null;
      const name =
        'name' in role && typeof role.name === 'string' && role.name.trim()
          ? role.name.trim()
          : id;
      return { id, name };
    })
    .filter((role): role is RoleOption => Boolean(role));
}

function normalizeImportRow(input: unknown): ImportRow | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  const discordId = cleanString(
    row.Discord_id ??
      row.discord_id ??
      row.discordId ??
      row.discordID ??
      row.discord,
  );
  const gameId = cleanString(
    row.steam_epic_id ??
      row.steamEpicId ??
      row.gameId ??
      row.game_id ??
      row.steam_id ??
      row.epic_id,
  );
  if (!discordId || !gameId) return null;
  return { discordId, gameId };
}

function cleanString(value: unknown) {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function detectGamePlatform(gameId: string): 'steam' | 'epic' | null {
  const value = gameId.trim();
  if (/^[0-9a-fA-F]{32}$/.test(value)) return 'epic';
  if (/^\d+$/.test(value)) return 'steam';
  return null;
}
