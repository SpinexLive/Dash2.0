import { prisma } from '@hll/db';
import { client, GUILD_ID } from '../client';

/**
 * Full role re-sync: snapshots every guild member's roles into the DB and
 * recomputes `is_member` from the configured member roles. Run on a schedule as a
 * safety net; the live `guildMemberUpdate` handler keeps things fresh between runs.
 */
export async function syncAllRoles() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const memberRoleIds = memberRoles(settings);

  const guild = await client.guilds.fetch(GUILD_ID);
  const members = await guild.members.fetch();

  // Track the userIds that should remain in the directory (member-role holders).
  const keepUserIds: bigint[] = [];

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

    // The directory only contains holders of a configured member role.
    if (hasAnyRole(roleIds, memberRoleIds)) {
      await prisma.member.upsert({
        where: { userId: user.id },
        create: { userId: user.id, isMember: true },
        update: { isMember: true },
      });
      keepUserIds.push(user.id);
    }
  }

  // Members who no longer hold the configured role (or left the guild) are
  // kept in the database for history but flagged inactive so the directory
  // can hide them. We never delete them.
  if (memberRoleIds.length) {
    await prisma.member.updateMany({
      where: { userId: { notIn: keepUserIds.length ? keepUserIds : [BigInt(-1)] } },
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
