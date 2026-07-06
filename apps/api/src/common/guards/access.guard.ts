import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { SessionUser } from '@hll/shared';
import { ADMIN_ONLY_KEY, IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { PermissionService } from '../../access-control/permission.service';

/**
 * Enforces dashboard access. Runs after JwtAuthGuard.
 * - Guild admins always pass.
 * - Otherwise the user must have access via allow-listed role or user id.
 * - Routes marked @AdminOnly() require guild admin.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user: SessionUser }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('No session');

    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // Always re-check against the cache so revoked roles take effect promptly.
    const access = await this.permissions.resolveAccess(user.discordId, {
      isGuildAdmin: user.isGuildAdmin,
      roleIds: user.roleIds,
    });

    if (adminOnly) {
      if (!access.isGuildAdmin) throw new ForbiddenException('Admins only');
      return true;
    }

    if (!access.hasAccess) throw new ForbiddenException('Dashboard access denied');
    return true;
  }
}
