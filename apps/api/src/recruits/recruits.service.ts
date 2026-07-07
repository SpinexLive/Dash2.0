import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { prisma } from '@hll/db';
import { REDIS } from '../redis/redis.module';

export const BOT_COMMAND_CHANNEL = 'bot:commands';
const BOT_RESPONSE_CHANNEL = 'bot:responses';

/** Steam IDs are numeric; Epic IDs are 32-char hex strings. */
function detectPlatform(id: string | null): 'steam' | 'epic' | null {
  if (!id) return null;
  const v = id.trim();
  if (/^[0-9a-fA-F]{32}$/.test(v)) return 'epic';
  if (/^\d+$/.test(v)) return 'steam';
  return null;
}

/** Reads the applicant's display nickname out of the stored application text. */
function parseNickname(raw: string | null): string | null {
  if (!raw) return null;
  const userLine = raw.match(/^\s*User:\s*@?(.+)$/im);
  if (userLine) {
    const v = userLine[1].replace(/[`*]/g, '').trim();
    if (v && !/^\d+$/.test(v)) return v;
  }
  const uname = raw.match(/^\s*Username:\s*`?([^`\n]+)`?/im);
  if (uname) return uname[1].trim();
  return null;
}

type RecruitRoleCategory = 'recruit' | 'member' | 'competitive' | 'none';

function roleIdsFromSettings(value: unknown): Record<Exclude<RecruitRoleCategory, 'none'>, Set<string>> {
  if (Array.isArray(value)) {
    return {
      recruit: new Set(),
      member: roleIdSet(value),
      competitive: new Set(),
    };
  }
  if (!value || typeof value !== 'object') {
    return { recruit: new Set(), member: new Set(), competitive: new Set() };
  }
  const src = value as Record<string, unknown>;
  return {
    recruit: roleIdSet(src.recruit),
    member: roleIdSet(src.member),
    competitive: roleIdSet(src.competitive),
  };
}

function roleIdSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map(roleIdFromValue).filter((roleId): roleId is string => Boolean(roleId)));
}

function roleIdFromValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string'
  ) {
    return value.id;
  }
  return null;
}

function recruitRoleCategory(
  roleIds: Set<string>,
  rankRoleIds: Record<Exclude<RecruitRoleCategory, 'none'>, Set<string>>,
): RecruitRoleCategory {
  if ([...rankRoleIds.competitive].some((roleId) => roleIds.has(roleId))) {
    return 'competitive';
  }
  if ([...rankRoleIds.member].some((roleId) => roleIds.has(roleId))) {
    return 'member';
  }
  if ([...rankRoleIds.recruit].some((roleId) => roleIds.has(roleId))) {
    return 'recruit';
  }
  return 'none';
}

@Injectable()
export class RecruitsService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Recruit intake list. Each row carries everything the dashboard needs:
   * nickname, the extracted game id + platform, whether a companion Steam id
   * is already stored (Epic indicator), the processed state, and whether the
   * person is a former/inactive member.
   */
  async list(status?: 'pending' | 'accepted' | 'rejected') {
    const recruits = await prisma.recruit.findMany({
      where: status ? { status } : {},
      orderBy: { postedAt: 'desc' },
    });

    const discordIds = [...new Set(recruits.map((r) => r.discordId))];
    const users = discordIds.length
      ? await prisma.user.findMany({
          where: { discordId: { in: discordIds } },
          include: { gameAccounts: true, member: true, roles: true },
        })
      : [];
    const byDiscord = new Map(users.map((u) => [u.discordId, u]));
    const settings = await prisma.settings.findFirst();
    const rankRoleIds = roleIdsFromSettings(settings?.rankRoles);

    return recruits.map((r) => {
      const platform = detectPlatform(r.extractedGameId);
      const u = byDiscord.get(r.discordId);
      const hasStoredSteam = Boolean(
        u?.gameAccounts.some((g) => g.platform === 'steam'),
      );
      const userRoleIds = new Set(u?.roles.map((role) => role.roleId) ?? []);
      const roleCategory = recruitRoleCategory(userRoleIds, rankRoleIds);
      return {
        id: r.id.toString(),
        discordId: r.discordId,
        nickname: parseNickname(r.rawApplication) ?? r.discordId,
        gameId: r.extractedGameId,
        platform,
        hasStoredSteam,
        roleCategory,
        hasRankRole: roleCategory !== 'none',
        processed: r.status !== 'pending',
        status: r.status,
        // Was once a member but no longer active (left the guild / lost role).
        formerMember: Boolean(u?.member && u.member.isMember === false),
        postedAt: r.postedAt,
        rawApplication: r.rawApplication,
      };
    });
  }

  async refresh() {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timed out waiting for recruit refresh'));
        }, 60000);

        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };

        const onMessage = (channel: string, message: string) => {
          if (channel !== BOT_RESPONSE_CHANNEL) return;

          try {
            const payload = JSON.parse(message) as {
              requestId?: string;
              type?: string;
            };
            if (payload.requestId === requestId && payload.type === 'recruitPollComplete') {
              cleanup();
              resolve();
            }
          } catch {
            // ignore malformed responses
          }
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
          void this.redis
            .publish(BOT_COMMAND_CHANNEL, JSON.stringify({ type: 'pollRecruits', requestId }))
            .catch((error) => {
              cleanup();
              reject(error);
            });
        }).catch((error) => {
          cleanup();
          reject(error);
        });
      });
    } catch (error) {
      console.error('[recruits] recruit refresh failed', error);
      throw error;
    }

    return { ok: true };
  }

  async reject(id: bigint, reviewerDiscordId: string) {
    const reviewer = await prisma.user.findUnique({
      where: { discordId: reviewerDiscordId },
    });
    return prisma.recruit.update({
      where: { id },
      data: { status: 'rejected', processedAt: new Date(), reviewedBy: reviewer?.id },
    });
  }

  /**
   * Process a recruit:
   *  1. ask the bot to refresh the member directory from Discord (best-effort)
   *  2. find/create the user by Discord user id
   *  3. attach the extracted game id (Steam stored normally; Epic stored as
   *     epic — its companion Steam id is added later via the edit modal)
   *  4. ensure a member row exists
   *  5. mark the recruit processed so the button can't be used again
   */
  async process(id: bigint, reviewerDiscordId: string) {
    const recruit = await prisma.recruit.findUnique({ where: { id } });
    if (!recruit) throw new NotFoundException('Recruit not found');

    // 1. Pull the latest members from Discord (async via the bot).
    await this.redis.publish(
      BOT_COMMAND_CHANNEL,
      JSON.stringify({ type: 'syncMembers' }),
    );

    const reviewer = await prisma.user.findUnique({
      where: { discordId: reviewerDiscordId },
    });
    const nickname = parseNickname(recruit.rawApplication);

    const result = await prisma.$transaction(async (tx) => {
      // 2. Find/create the user by Discord user id.
      const user = await tx.user.upsert({
        where: { discordId: recruit.discordId },
        create: {
          discordId: recruit.discordId,
          username: nickname ?? recruit.discordId,
          serverNick: nickname,
        },
        update: nickname ? { serverNick: nickname } : {},
      });

      // 3. Attach the extracted game id on the correct platform.
      const platform = detectPlatform(recruit.extractedGameId);
      if (recruit.extractedGameId && platform) {
        await tx.gameAccount.upsert({
          where: {
            platform_gameId: { platform, gameId: recruit.extractedGameId },
          },
          create: {
            userId: user.id,
            platform,
            gameId: recruit.extractedGameId,
          },
          update: { userId: user.id },
        });
      }

      // 4. Ensure a member row exists (fires the member.created trigger).
      const member = await tx.member.upsert({
        where: { userId: user.id },
        create: { userId: user.id, isMember: true },
        update: { isMember: true },
      });

      // 5. Mark processed.
      await tx.recruit.update({
        where: { id },
        data: {
          status: 'accepted',
          processedAt: new Date(),
          reviewedBy: reviewer?.id,
        },
      });

      return { user, member };
    });

    return {
      ok: true,
      userId: result.user.id.toString(),
      memberId: result.member.id.toString(),
    };
  }
}
