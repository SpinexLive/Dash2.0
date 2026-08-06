import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import axios from 'axios';
import type { Response } from 'express';
import Redis from 'ioredis';
import { prisma } from '@hll/db';
import type { SessionUser } from '@hll/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { AdminOnly, Public } from '../common/decorators/auth.decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { REDIS } from '../redis/redis.module';

const BOT_COMMAND_CHANNEL = 'bot:commands';
const BOT_RESPONSE_CHANNEL = 'bot:responses';
const INSTALL_STATE_TTL_SECONDS = 600;
const MANAGE_NICKNAMES_PERMISSION = '134217728';
const installStateKey = (state: string) => `connected-server:install:${state}`;

type DiscordGuild = { id: string; name: string; icon: string | null };
type NicknameSyncResult = {
  type?: string;
  requestId?: string;
  ok?: boolean;
  updated?: number;
  unchanged?: number;
  missing?: number;
  failed?: number;
  error?: string;
};

@Controller('connected-servers')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ConnectedServersController {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  @Get()
  async list() {
    return prisma.connectedServer.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Start Discord's admin-approved bot install flow. */
  @Get('install')
  @AdminOnly()
  async install(@CurrentUser() user: SessionUser, @Res() res: Response) {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) throw new BadRequestException('DISCORD_CLIENT_ID is not configured');
    const state = randomBytes(24).toString('hex');
    await this.redis.set(installStateKey(state), user.discordId, 'EX', INSTALL_STATE_TTL_SECONDS);
    const redirectUri = process.env.DISCORD_BOT_INSTALL_REDIRECT
      ?? `${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/connected-servers/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      // `identify` deliberately makes this an OAuth callback flow (rather than
      // Discord's callback-less bot shortcut), which returns the chosen guild.
      scope: 'bot applications.commands identify',
      permissions: MANAGE_NICKNAMES_PERMISSION,
      redirect_uri: redirectUri,
      response_type: 'code',
      integration_type: '0',
      prompt: 'consent',
      state,
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  }

  /** Discord redirects here after an administrator has selected a target server. */
  @Public()
  @Get('callback')
  async callback(
    @Query('state') state: string,
    @Query('guild_id') guildId: string,
    @Res() res: Response,
  ) {
    const addedBy = state ? await this.redis.get(installStateKey(state)) : null;
    if (!addedBy || !guildId) throw new BadRequestException('Invalid or expired server-install request');
    await this.redis.del(installStateKey(state));

    const guild = await this.fetchGuild(guildId);
    await prisma.connectedServer.upsert({
      where: { guildId },
      create: { guildId, name: guild.name, icon: guild.icon, addedBy },
      update: { name: guild.name, icon: guild.icon, addedBy },
    });
    res.redirect(`${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/connected-servers?connected=1`);
  }

  @Post(':guildId/sync-nicknames')
  @AdminOnly()
  async syncNicknames(@Param('guildId') guildId: string) {
    const target = await prisma.connectedServer.findUnique({ where: { guildId } });
    if (!target) throw new NotFoundException('Connected server not found');
    const members = await prisma.member.findMany({
      where: { isMember: true },
      include: { user: { select: { discordId: true, serverNick: true, username: true } } },
    });
    const targets = members.map(({ user }) => ({
      discordId: user.discordId,
      nickname: (user.serverNick ?? user.username).slice(0, 32),
    }));
    const requestId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const result = await this.awaitBotResponse(requestId, {
      type: 'syncConnectedServerNicknames',
      requestId,
      guildId,
      targets,
    });
    if (!result.ok) throw new BadGatewayException(result.error ?? 'Nickname sync failed');
    await prisma.connectedServer.update({ where: { guildId }, data: { lastSyncedAt: new Date() } });
    return { ok: true, ...result, sourceMembers: targets.length };
  }

  @Post(':guildId')
  @AdminOnly()
  async remove(@Param('guildId') guildId: string) {
    await prisma.connectedServer.delete({ where: { guildId } }).catch(() => {
      throw new NotFoundException('Connected server not found');
    });
    return { ok: true };
  }

  private async fetchGuild(guildId: string): Promise<DiscordGuild> {
    try {
      const { data } = await axios.get<DiscordGuild>(`https://discord.com/api/v10/guilds/${guildId}`, {
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      });
      return data;
    } catch {
      throw new BadRequestException('The bot could not verify the selected server. Ensure the install completed.');
    }
  }

  private async awaitBotResponse(requestId: string, command: object): Promise<NicknameSyncResult> {
    const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    return new Promise<NicknameSyncResult>((resolve, reject) => {
      const timeout = setTimeout(() => done(() => reject(new Error('Nickname sync timed out after 3 minutes.'))), 180_000);
      const onMessage = (channel: string, message: string) => {
        if (channel !== BOT_RESPONSE_CHANNEL) return;
        try {
          const payload = JSON.parse(message) as NicknameSyncResult;
          if (payload.type === 'connectedServerNicknameSyncComplete' && payload.requestId === requestId) {
            done(() => resolve(payload));
          }
        } catch { /* Ignore malformed messages. */ }
      };
      const onError = (error: Error) => done(() => reject(error));
      const done = (finish: () => void) => {
        clearTimeout(timeout);
        subscriber.off('message', onMessage);
        subscriber.off('error', onError);
        void subscriber.unsubscribe(BOT_RESPONSE_CHANNEL).catch(() => {});
        void subscriber.quit().catch(() => {});
        finish();
      };
      subscriber.on('message', onMessage);
      subscriber.on('error', onError);
      void subscriber.subscribe(BOT_RESPONSE_CHANNEL)
        .then(() => this.redis.publish(BOT_COMMAND_CHANNEL, JSON.stringify(command)))
        .catch(onError);
    });
  }
}
