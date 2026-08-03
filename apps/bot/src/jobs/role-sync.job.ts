import { prisma } from '@hll/db';
import { client, GUILD_ID } from '../client';

const MEMBER_FETCH_RETRY_DELAY_MS = 30_000;

export function findInactiveMemberUserIds(existingMemberUserIds: bigint[], keepUserIds: bigint[]) {
  const keepSet = new Set(keepUserIds.map((id) => id.toString()));
  return existingMemberUserIds.filter((id) => !keepSet.has(id.toString()));
}

/**
 * Full role re-sync: snapshots every guild member's roles into the DB and
 * recomputes `is_member` from the configured member roles. Run on a schedule as a
 * safety net; the live `guildMemberUpdate` handler keeps things fresh between runs.
 */
export async function syncAllRoles() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const memberRoleIds = memberRoles(settings);

  const guild = await client.guilds.fetch(GUILD_ID);
  const existingMembers = await prisma.member.findMany({ select: { userId: true } });

  let members: Awaited<ReturnType<typeof guild.members.fetch>> | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      members = await guild.members.fetch();
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2) {
        console.warn('[bot] role sync member fetch rate limited or failed after retries:', message);
        return;
      }
      console.warn(`[bot] role sync member fetch failed, retrying in ${MEMBER_FETCH_RETRY_DELAY_MS / 1000}s:`, message);
      await delay(MEMBER_FETCH_RETRY_DELAY_MS);
    }
  }

  if (!members) return;

  // Track the userIds that should remain in the directory (member-role holders).
  const keepUserIds: bigint[] = [];
  const existingMemberUserIds = existingMembers.map((member) => member.userId);

  for (const gm of members.values()) {
    if (gm.user.bot) continue;
    const roleIds = [...gm.roles.cache.keys()];

    const user = await prisma.user.upsert({
      where: { discordId: gm.id },
      create: {
        discordId: gm.id,
        username: gm.user.username,
        serverNick: gm.nickname,
        avatar: gm.user.avatar,
      },
      update: { username: gm.user.username, serverNick: gm.nickname },
    });

    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    if (roleIds.length) {
      await prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true,
      });
    }

    const shouldBeMember = hasAnyRole(roleIds, memberRoleIds);
    await prisma.member.upsert({
      where: { userId: user.id },
      create: { userId: user.id, isMember: shouldBeMember },
      update: { isMember: shouldBeMember },
    });

    if (shouldBeMember) {
      keepUserIds.push(user.id);
    }
  }

  // Members who no longer hold the configured role (or left the guild) are
  // kept in the database for history but flagged inactive so the directory
  // can hide them. We never delete them.
  const inactiveUserIds = findInactiveMemberUserIds(existingMemberUserIds, keepUserIds);
  if (inactiveUserIds.length) {
    await prisma.member.updateMany({
      where: { userId: { in: inactiveUserIds } },
      data: { isMember: false },
    });
  }
}

function memberRoles(settings: { memberRoleId: string | null; memberRoleIds?: unknown } | null) {
  const ids = Array.isArray(settings?.memberRoleIds) ? settings.memberRoleIds : [];
  const clean = ids
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean);
  if (settings?.memberRoleId?.trim()) clean.push(settings.memberRoleId.trim());
  return [...new Set(clean)];
}

function hasAnyRole(roleIds: string[], allowedRoleIds: string[]) {
  return allowedRoleIds.some((roleId) => roleIds.includes(roleId));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
