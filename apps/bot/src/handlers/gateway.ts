import { Events } from 'discord.js';
import { prisma } from '@hll/db';
import { client } from '../client';
import { redis } from '../redis';
import { syncVoicePresence } from '../jobs/presence-sync.job';

/**
 * Live updates: when a member's roles change, re-snapshot their roles and bust
 * their cached permissions so access changes take effect immediately.
 */
export function registerGatewayHandlers() {
  client.on(Events.GuildMemberUpdate, async (_oldMember, member) => {
    const roleIds = [...member.roles.cache.keys()];

    const user = await prisma.user.upsert({
      where: { discordId: member.id },
      create: {
        discordId: member.id,
        username: member.user.username,
        serverNick: member.nickname,
        avatar: member.user.avatar,
      },
      update: { serverNick: member.nickname },
    });

    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    if (roleIds.length) {
      await prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true,
      });
    }

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const memberRoleIds = memberRoles(settings);
    if (memberRoleIds.length) {
      await prisma.member.updateMany({
        where: { userId: user.id },
        data: { isMember: hasAnyRole(roleIds, memberRoleIds) },
      });
    }

    // Bust the API permission cache for this user.
    await redis.del(`perm:${member.id}`);
  });

  // Keep voice presence fresh on every change.
  client.on(Events.VoiceStateUpdate, () => {
    void syncVoicePresence();
  });
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
