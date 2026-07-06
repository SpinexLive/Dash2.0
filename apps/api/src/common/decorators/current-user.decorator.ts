import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '@hll/shared';

/** Injects the authenticated session user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
