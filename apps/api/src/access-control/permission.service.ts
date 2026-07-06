import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { prisma } from '@hll/db';
import { REDIS } from '../redis/redis.module';

interface AccessInput {
  isGuildAdmin: boolean;
  roleIds: string[];
}

export interface AccessResult {
  isGuildAdmin: boolean;
  hasAccess: boolean;
}

const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Computes and caches effective dashboard access for a Discord user.
 * Access = guild admin OR an allow-listed role OR an allow-listed user id.
 */
@Injectable()
export class PermissionService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private cacheKey(discordId: string) {
    return `perm:${discordId}`;
  }

  async resolveAccess(discordId: string, input: AccessInput): Promise<AccessResult> {
    const cached = await this.redis.get(this.cacheKey(discordId));
    if (cached) return JSON.parse(cached) as AccessResult;

    const result = await this.compute(discordId, input);
    await this.redis.set(
      this.cacheKey(discordId),
      JSON.stringify(result),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return result;
  }

  private async compute(discordId: string, input: AccessInput): Promise<AccessResult> {
    if (input.isGuildAdmin) {
      return { isGuildAdmin: true, hasAccess: true };
    }

    const [userAllowed, allowedRoles] = await Promise.all([
      prisma.accessAllowedUser.findUnique({ where: { discordId } }),
      prisma.accessAllowedRole.findMany({ select: { roleId: true } }),
    ]);

    if (userAllowed) return { isGuildAdmin: false, hasAccess: true };

    const allowedRoleIds = new Set(allowedRoles.map((r) => r.roleId));
    const hasRole = input.roleIds.some((id) => allowedRoleIds.has(id));

    return { isGuildAdmin: false, hasAccess: hasRole };
  }

  /** Invalidate a single user's cached permissions (e.g. role change). */
  async bust(discordId: string) {
    await this.redis.del(this.cacheKey(discordId));
  }

  /** Invalidate all cached permissions (e.g. allow-list changed). */
  async bustAll() {
    const keys = await this.redis.keys('perm:*');
    if (keys.length) await this.redis.del(...keys);
  }
}
