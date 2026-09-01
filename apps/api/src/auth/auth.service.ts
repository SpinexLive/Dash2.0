import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { prisma } from '@hll/db';
import type { SessionUser } from '@hll/shared';

const DISCORD_API = 'https://discord.com/api/v10';
const ADMINISTRATOR_BIT = 0x8n;

interface DiscordTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface DiscordGuildMember {
  nick: string | null;
  roles: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private get guildId() {
    return process.env.DISCORD_GUILD_ID!;
  }

  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      redirect_uri: process.env.DISCORD_OAUTH_REDIRECT!,
      response_type: 'code',
      scope: process.env.DISCORD_OAUTH_SCOPES ?? 'identify guilds guilds.members.read',
      state,
      prompt: 'select_account',
    });
    return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
  }

  private async exchangeCode(code: string): Promise<DiscordTokens> {
    const body = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_OAUTH_REDIRECT!,
    });
    const { data } = await axios.post<DiscordTokens>(
        `${DISCORD_API}/oauth2/token`,
        body.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      )
      .catch((err) => {
        this.logger.error('Discord OAuth token exchange failed', describeAxiosError(err));
        throw new UnauthorizedException('Discord login failed. Please try signing in again.');
      });
    return data;
  }

  /** Completes the OAuth flow: exchanges code, syncs user + roles, returns a session. */
  async handleCallback(code: string): Promise<SessionUser> {
    const tokens = await this.exchangeCode(code);
    const auth = { headers: { Authorization: `Bearer ${tokens.access_token}` } };

    const { data: dUser } = await axios
      .get<DiscordUser>(`${DISCORD_API}/users/@me`, auth)
      .catch((err) => {
        this.logger.error('Discord user lookup failed', describeAxiosError(err));
        throw new UnauthorizedException('Discord login failed. Could not read your profile.');
      });

    let member: DiscordGuildMember | null = null;
    let isGuildAdmin = false;
    try {
      const { data } = await axios.get<DiscordGuildMember>(
        `${DISCORD_API}/users/@me/guilds/${this.guildId}/member`,
        auth,
      );
      member = data;
    } catch {
      // user is not a member of the clan guild
    }

    // Determine admin via the user's guild permissions from the guilds list.
    try {
      const { data: guilds } = await axios.get<{ id: string; permissions: string }[]>(
        `${DISCORD_API}/users/@me/guilds`,
        auth,
      );
      const g = guilds.find((x) => x.id === this.guildId);
      if (g) {
        isGuildAdmin = (BigInt(g.permissions) & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT;
      }
    } catch {
      // ignore
    }

    if (!member && !isGuildAdmin) {
      throw new UnauthorizedException('You are not a member of this Discord server.');
    }

    const roleIds = member?.roles ?? [];
    const session = await this.syncUser(dUser, member?.nick ?? null, isGuildAdmin, roleIds);
    return session;
  }

  /** Rebuilds a session from local DB state. Used by the token refresh flow. */
  async buildSession(discordId: string): Promise<SessionUser> {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: { roles: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return {
      discordId: user.discordId,
      username: user.username,
      serverNick: user.serverNick,
      avatar: user.avatar,
      isGuildAdmin: user.isGuildAdmin,
      roleIds: user.roles.map((r) => r.roleId),
      hasAccess: false,
    };
  }

  /** Upserts the user, role snapshot, and returns the session shape. */
  private async syncUser(
    dUser: DiscordUser,
    nick: string | null,
    isGuildAdmin: boolean,
    roleIds: string[],
  ): Promise<SessionUser> {
    const user = await prisma.user.upsert({
      where: { discordId: dUser.id },
      create: {
        discordId: dUser.id,
        username: dUser.username,
        serverNick: nick,
        globalName: dUser.global_name,
        avatar: dUser.avatar,
        isGuildAdmin,
      },
      update: {
        username: dUser.username,
        serverNick: nick,
        globalName: dUser.global_name,
        avatar: dUser.avatar,
        isGuildAdmin,
      },
    });

    // Replace the cached role snapshot.
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    if (roleIds.length) {
      await prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true,
      });
    }

    return {
      discordId: user.discordId,
      username: user.username,
      serverNick: user.serverNick,
      avatar: user.avatar,
      isGuildAdmin: user.isGuildAdmin,
      roleIds,
      hasAccess: false, // resolved by PermissionService at guard time
    };
  }
}

function describeAxiosError(err: unknown) {
  if (!axios.isAxiosError(err)) return err instanceof Error ? err.message : String(err);
  return JSON.stringify({
    status: err.response?.status,
    statusText: err.response?.statusText,
    data: err.response?.data,
  });
}
