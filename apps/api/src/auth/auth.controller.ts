import { randomBytes } from 'crypto';
import {
  Controller,
  Get,
  HttpException,
  Inject,
  Logger,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import type { SessionUser } from '@hll/shared';
import { AuthService } from './auth.service';
import { PermissionService } from '../access-control/permission.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/auth.decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { REDIS } from '../redis/redis.module';
import type Redis from 'ioredis';

const OAUTH_STATE_TTL_SECONDS = 600;
const oauthStateKey = (state: string) => `oauth:state:${state}`;

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly permissions: PermissionService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private cookieOpts(maxAgeSec: number) {
    const secureCookie = process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : (process.env.WEB_PUBLIC_URL ?? '').startsWith('https://');

    return {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax' as const,
      domain: process.env.COOKIE_DOMAIN || undefined,
      maxAge: maxAgeSec * 1000,
      path: '/',
    };
  }

  @Public()
  @Get('discord/login')
  async login(@Res() res: Response) {
    const state = randomBytes(16).toString('hex');
    await this.redis.set(oauthStateKey(state), '1', 'EX', OAUTH_STATE_TTL_SECONDS);
    res.cookie('oauth_state', state, this.cookieOpts(OAUTH_STATE_TTL_SECONDS));
    res.redirect(this.auth.buildAuthorizeUrl(state));
  }

  @Public()
  @Get('discord/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookieState = req.cookies?.['oauth_state'];
    const cookieStateMatches = Boolean(state && state === cookieState);
    const storedStateExists = state
      ? Boolean(await this.redis.get(oauthStateKey(state)))
      : false;

    if (!code || (!cookieStateMatches && !storedStateExists)) {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    if (state) await this.redis.del(oauthStateKey(state));

    try {
      const session = await this.auth.handleCallback(code);

      const accessTtl = Number(process.env.JWT_ACCESS_TTL ?? 900);
      const refreshTtl = Number(process.env.JWT_REFRESH_TTL ?? 2592000);

      const accessToken = await this.jwt.signAsync(
        { sub: session.discordId, ...session },
        { expiresIn: accessTtl },
      );
      const refreshToken = await this.jwt.signAsync(
        { sub: session.discordId, t: 'refresh' },
        { expiresIn: refreshTtl },
      );

      res.cookie('access_token', accessToken, this.cookieOpts(accessTtl));
      res.cookie('refresh_token', refreshToken, this.cookieOpts(refreshTtl));
      res.clearCookie('oauth_state');

      res.redirect(`${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/members`);
    } catch (err) {
      this.logger.error(
        'Discord OAuth callback failed',
        err instanceof Error ? err.stack : String(err),
      );
      if (err instanceof HttpException) throw err;
      throw err;
    }
  }

  @Public()
  @Get('refresh')
  async refresh(@Req() req: Request, @Res() res: Response) {
    const token = req.cookies?.['refresh_token'];
    if (!token) throw new UnauthorizedException('Missing refresh token');

    let payload: { sub: string; t?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.t !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.auth.buildSession(payload.sub);
    const accessTtl = Number(process.env.JWT_ACCESS_TTL ?? 900);
    const accessToken = await this.jwt.signAsync(
      { sub: session.discordId, ...session },
      { expiresIn: accessTtl },
    );
    res.cookie('access_token', accessToken, this.cookieOpts(accessTtl));
    res.json({ ok: true });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: SessionUser) {
    const access = await this.permissions.resolveAccess(user.discordId, {
      isGuildAdmin: user.isGuildAdmin,
      roleIds: user.roleIds,
    });
    return { ...user, hasAccess: access.hasAccess, isGuildAdmin: access.isGuildAdmin };
  }

  @Public()
  @Get('logout')
  logout(@Res() res: Response) {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.redirect(process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000');
  }
}
