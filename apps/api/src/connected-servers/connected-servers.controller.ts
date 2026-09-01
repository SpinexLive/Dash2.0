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
  Body,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
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
  missing?: number | unknown[];
  failed?: number;
  error?: string;
  assigned?: number;
};
class UpdateRoleMappingDto {
  @IsOptional() @IsString() infantryLeaderRoleId?: string | null;
  @IsOptional() @IsString() tankCommanderRoleId?: string | null;
}
type DiscordRole = { id: string; name: string; position: number; managed: boolean };
type RosterTarget = { discordId: string; name: string; position: string; role: 'infantry' | 'tank' };

@Controller('connected-servers')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ConnectedServersController {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  @Get()
  async list() {
    return prisma.connectedServer.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Get(':guildId/roles')
  async roles(@Param('guildId') guildId: string) {
    await this.ensureServer(guildId);
    try {
      const { data } = await axios.get<DiscordRole[]>(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      });
      return data.filter((role) => role.name !== '@everyone' && !role.managed)
        .map(({ id, name, position }) => ({ id, name, position })).sort((a, b) => b.position - a.position);
    } catch { throw new BadRequestException('Could not load roles from this connected server.'); }
  }

  @Post(':guildId/role-mapping')
  @AdminOnly()
  async updateRoleMapping(@Param('guildId') guildId: string, @Body() dto: UpdateRoleMappingDto) {
    return prisma.connectedServer.update({
      where: { guildId },
      data: {
        infantryLeaderRoleId: dto.infantryLeaderRoleId?.trim() || null,
        tankCommanderRoleId: dto.tankCommanderRoleId?.trim() || null,
      },
    }).catch(() => { throw new NotFoundException('Connected server not found'); });
  }

  @Get(':guildId/rosters')
  async rosters(@Param('guildId') guildId: string) {
    await this.ensureServer(guildId);
    const rows = await prisma.roster.findMany({
      select: { id: true, name: true, eventTitle: true, eventStartTime: true, slots: { select: { discordId: true, username: true, position: true } } },
      orderBy: { eventStartTime: 'desc' }, take: 50,
    });
    return rows.map((row) => ({ id: row.id.toString(), name: row.eventTitle ?? row.name ?? `Roster ${row.id}`, eventStartTime: row.eventStartTime, eligible: this.roleTargets(row.slots).length }));
  }

  @Post(':guildId/rosters/:rosterId/assign-roles')
  @AdminOnly()
  async assignRosterRoles(@Param('guildId') guildId: string, @Param('rosterId') rosterId: string) {
    const server = await this.ensureServer(guildId);
    if (!server.infantryLeaderRoleId && !server.tankCommanderRoleId) throw new BadRequestException('Select at least one connected-server role first.');
    const roster = await prisma.roster.findUnique({ where: { id: BigInt(rosterId) }, include: { slots: true } });
    if (!roster) throw new NotFoundException('Roster not found');
    const targets = this.roleTargets(roster.slots).filter((target) =>
      target.role === 'infantry' ? Boolean(server.infantryLeaderRoleId) : Boolean(server.tankCommanderRoleId),
    );
    if (!targets.length) throw new BadRequestException('This roster has no commander, artillery, spotter, squad leader, or tank commander assignments.');
    const requestId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const result = await this.awaitBotResponse(requestId, {
      type: 'assignConnectedServerRosterRoles', requestId, guildId,
      infantryRoleId: server.infantryLeaderRoleId, tankRoleId: server.tankCommanderRoleId, targets,
    });
    if (!result.ok) throw new BadGatewayException(result.error ?? 'Role assignment failed');
    return { ok: true, rosterId, ...result };
  }

  @Post(':guildId/rosters/:rosterId/check-members')
  @AdminOnly()
  async checkRosterMembers(@Param('guildId') guildId: string, @Param('rosterId') rosterId: string) {
    await this.ensureServer(guildId);
    const roster = await prisma.roster.findUnique({ where: { id: BigInt(rosterId) }, include: { slots: true } });
    if (!roster) throw new NotFoundException('Roster not found');
    const targets = roster.slots.flatMap((slot) => slot.discordId
      ? [{ discordId: slot.discordId, name: slot.username ?? slot.discordId, position: slot.position ?? 'Roster slot' }]
      : []);
    const requestId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const result = await this.awaitBotResponse(requestId, { type: 'checkConnectedServerRosterMembers', requestId, guildId, targets });
    if (!result.ok) throw new BadGatewayException(result.error ?? 'Roster membership check failed');
    return { ok: true, checked: targets.length, ...result };
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
      include: { user: { select: { discordId: true, serverNick: true, globalName: true, username: true } } },
    });
    const targets = members.map(({ user }) => ({
      discordId: user.discordId,
      nickname: (user.serverNick ?? user.globalName ?? user.username).slice(0, 32),
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

  private async ensureServer(guildId: string) {
    const server = await prisma.connectedServer.findUnique({ where: { guildId } });
    if (!server) throw new NotFoundException('Connected server not found');
    return server;
  }

  private roleTargets(slots: { discordId: string | null; username: string | null; position: string | null }[]): RosterTarget[] {
    return slots.flatMap((slot) => {
      if (!slot.discordId || !slot.position) return [];
      const label = slot.position.toLowerCase();
      const role = label.includes('tank commander') ? 'tank'
        : /commander|artillery|spotter|squad leader|squad lead/.test(label) ? 'infantry' : null;
      return role ? [{ discordId: slot.discordId, name: slot.username ?? slot.discordId, position: slot.position, role }] : [];
    });
  }

  private async awaitBotResponse(requestId: string, command: object): Promise<NicknameSyncResult> {
    const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    return new Promise<NicknameSyncResult>((resolve, reject) => {
      const timeout = setTimeout(() => done(() => reject(new Error('Nickname sync timed out after 3 minutes.'))), 180_000);
      const onMessage = (channel: string, message: string) => {
        if (channel !== BOT_RESPONSE_CHANNEL) return;
        try {
          const payload = JSON.parse(message) as NicknameSyncResult;
          if ((payload.type === 'connectedServerNicknameSyncComplete' || payload.type === 'connectedServerRosterRoleAssignmentComplete' || payload.type === 'connectedServerRosterMemberCheckComplete') && payload.requestId === requestId) {
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
