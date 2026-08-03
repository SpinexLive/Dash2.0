import { Inject, Injectable } from '@nestjs/common';
import axios from 'axios';
import type Redis from 'ioredis';
import { prisma } from '@hll/db';
import { REDIS } from '../redis/redis.module';

export interface VoicePresence {
  discordId: string;
  nick: string;
}

interface CrconPlayer {
  name: string;
  steam_id_64?: string | null;
  player_id?: string | null;
  playerId?: string | null;
}

type CrconPlayerIds = [string, string][] | Record<string, string>;

interface DiscordVoiceState {
  channel_id?: string | null;
}

const BRIEFING_VOICE_CHANNEL_KEY = 'settings:briefingVoiceChannelId';
const RCON_API_URL_KEY = 'settings:rconApiUrl';
const RCON_API_TOKEN_KEY = 'settings:rconApiToken';
const BOT_COMMAND_CHANNEL = 'bot:commands';
const DEFAULT_RCON_API_URL = 'http://45.151.81.182:8010/';
const DEFAULT_RCON_API_TOKEN = 'ecb6970c-0c86-420c-8902-c7c71729018b';

@Injectable()
export class BriefingService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Who is currently in a given Discord voice channel (kept fresh by the bot). */
  async voiceMembers(channelId: string): Promise<VoicePresence[]> {
    const raw = await this.redis.get(`voice:${channelId}`);
    if (!raw) return [];

    try {
      return JSON.parse(raw) as VoicePresence[];
    } catch {
      return [];
    }
  }

  async savedRosters() {
    const earliestStartTime = new Date(Date.now() - 60 * 60 * 1000);
    const rosters = await prisma.roster.findMany({
      where: {
        OR: [{ eventStartTime: null }, { eventStartTime: { gte: earliestStartTime } }],
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, eventTitle: true, eventStartTime: true, updatedAt: true },
    });
    return rosters.map((roster) => ({
      id: roster.id.toString(),
      name: roster.name ?? roster.eventTitle ?? 'Unnamed roster',
      eventTitle: roster.eventTitle,
      eventStartTime: roster.eventStartTime,
      updatedAt: roster.updatedAt,
    }));
  }

  async createVoiceChannels() {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const briefingVoiceChannels = normalizeBriefingVoiceChannelSettings(settings?.briefingVoiceChannels);
    if (!briefingVoiceChannels.categoryId || briefingVoiceChannels.names.length === 0) {
      return { queued: false, created: 0, message: 'Briefing voice channel settings are incomplete.' };
    }

    await this.redis.publish(
      BOT_COMMAND_CHANNEL,
      JSON.stringify({
        type: 'createBriefingVoiceChannels',
        ...briefingVoiceChannels,
      }),
    );
    return { queued: true, created: briefingVoiceChannels.names.length };
  }

  async roster(rosterId: string) {
    const roster = await prisma.roster.findUnique({
      where: { id: BigInt(rosterId) },
      include: { slots: true },
    });
    if (!roster) return null;
    return {
      id: roster.id.toString(),
      name: roster.name ?? roster.eventTitle ?? 'Unnamed roster',
      eventTitle: roster.eventTitle,
      eventStartTime: roster.eventStartTime,
      data: roster.data ?? null,
      confirmations: roster.slots.map((slot) => ({
        discordId: slot.discordId,
        response: slot.response,
      })),
    };
  }

  async checkVoice(discordIds: string[]) {
    const channelId = await this.redis.get(BRIEFING_VOICE_CHANNEL_KEY);
    const ids = [...new Set(discordIds.filter(Boolean))];

    if (!channelId || ids.length === 0) {
      return Object.fromEntries(discordIds.map((id) => [id, false]));
    }

    const cachedMembers = await this.voiceMembers(channelId);
    const present = new Set(cachedMembers.map((member) => member.discordId));

    if (cachedMembers.length > 0) {
      return Object.fromEntries(ids.map((id) => [id, present.has(id)]));
    }

    const livePresent = await this.liveVoicePresence(ids, channelId);
    return Object.fromEntries(ids.map((id) => [id, livePresent.has(id)]));
  }

  private async liveVoicePresence(discordIds: string[], channelId: string): Promise<Set<string>> {
    const present = new Set<string>();
    const token = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!token || !guildId || discordIds.length === 0) return present;

    await Promise.all(
      discordIds.map(async (discordId) => {
        try {
          const res = await fetch(
            `https://discord.com/api/v10/guilds/${guildId}/voice-states/${discordId}`,
            { headers: { Authorization: `Bot ${token}` } },
          );
          if (!res.ok) return;

          const state = (await res.json()) as DiscordVoiceState;
          if (state.channel_id === channelId) {
            present.add(discordId);
          }
        } catch {
          // Leave the member absent if Discord's live lookup is unavailable.
        }
      }),
    );
    return present;
  }

  async checkGame(discordIds: string[]) {
    const ids = [...new Set(discordIds.filter(Boolean))];
    const [players, users] = await Promise.all([
      this.crconPlayers(),
      ids.length
        ? prisma.user.findMany({
            where: { discordId: { in: ids } },
            include: { gameAccounts: true },
          })
        : [],
    ]);
    const liveGameIds = new Set(
      players.map((player) => gameIdFromCrconPlayer(player)).filter((id): id is string => Boolean(id)),
    );
    const accountsByDiscord = new Map(
      users.map((user) => [
        user.discordId,
        user.gameAccounts.map((account) => normalizeGameId(account.gameId)).filter((id): id is string => Boolean(id)),
      ]),
    );

    return Object.fromEntries(
      discordIds.map((discordId) => {
        const accountIds = accountsByDiscord.get(discordId) ?? [];
        return [discordId, accountIds.some((gameId) => liveGameIds.has(gameId))];
      }),
    );
  }

  /** Who is currently in the game server (via CRCON), cross-referenced to Discord. */
  async serverPlayers() {
    const players = await this.crconPlayers();
    const gameIds = players.map((p) => gameIdFromCrconPlayer(p)).filter((id): id is string => Boolean(id));

    // Cross-reference game IDs -> Discord users.
    const accounts = await prisma.gameAccount.findMany({
      where: { gameId: { in: gameIds } },
      include: { user: true },
    });
    const byGameId = new Map(accounts.map((a) => [normalizeGameId(a.gameId), a.user]));

    return players.map((p) => {
      const gameId = gameIdFromCrconPlayer(p);
      const user = gameId ? byGameId.get(gameId) : undefined;
      return {
        gameName: p.name,
        gameId,
        discordId: user?.discordId ?? null,
        serverNick: user?.serverNick ?? null,
        linked: Boolean(user),
      };
    });
  }

  private async crconPlayers(): Promise<CrconPlayer[]> {
    const [savedBase, savedToken] = await Promise.all([
      this.redis.get(RCON_API_URL_KEY),
      this.redis.get(RCON_API_TOKEN_KEY),
    ]);
    const base = savedBase ?? process.env.RCON_API_URL ?? process.env.CRCON_BASE_URL ?? DEFAULT_RCON_API_URL;
    const token = savedToken ?? process.env.RCON_API_TOKEN ?? process.env.CRCON_API_KEY ?? DEFAULT_RCON_API_TOKEN;
    if (!base) return [];

    let data: unknown;
    try {
      const res = await axios.get<unknown>(
        `${base.replace(/\/$/, '')}/api/get_players`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      data = res.data;
    } catch {
      data = null;
    }
    const players = extractCrconPlayers(data);
    if (players.length) return players;

    try {
      const res = await axios.get<unknown>(
        `${base.replace(/\/$/, '')}/api/get_player_ids`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      return extractCrconPlayerIds(res.data);
    } catch {
      return [];
    }
  }
}

function normalizeBriefingVoiceChannelSettings(input: unknown) {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const categoryId = typeof src.categoryId === 'string' && src.categoryId.trim() ? src.categoryId.trim() : null;
  const names = Array.isArray(src.names)
    ? src.names
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean)
        .slice(0, 25)
    : [];
  const autoDelete = src.autoDelete === true;
  const deleteAfterMinutes = Number.isInteger(src.deleteAfterMinutes) && Number(src.deleteAfterMinutes) > 0
    ? Math.min(Number(src.deleteAfterMinutes), 10080)
    : null;
  return { categoryId, names, autoDelete, deleteAfterMinutes: autoDelete ? deleteAfterMinutes : null };
}

function normalizeGameId(gameId: string | null | undefined) {
  return gameId?.trim() || null;
}

function gameIdFromCrconPlayer(player: CrconPlayer) {
  return normalizeGameId(player.steam_id_64 ?? player.player_id ?? player.playerId);
}

function extractCrconPlayers(data: unknown): CrconPlayer[] {
  const result = unwrapCrconResult(data);
  if (Array.isArray(result)) return result.filter(isCrconPlayer);
  if (result && typeof result === 'object' && 'players' in result) {
    const players = (result as { players?: unknown }).players;
    if (Array.isArray(players)) return players.filter(isCrconPlayer);
  }
  return [];
}

function extractCrconPlayerIds(data: unknown): CrconPlayer[] {
  const result = unwrapCrconResult(data) as CrconPlayerIds | unknown;
  if (Array.isArray(result)) {
    return result.flatMap((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) return [];
        const [name, playerId] = entry;
        return typeof name === 'string' && typeof playerId === 'string'
          ? [{ name, player_id: playerId }]
          : [];
      });
  }
  if (result && typeof result === 'object') {
    return Object.entries(result as Record<string, unknown>).flatMap(([name, playerId]) =>
      typeof playerId === 'string' ? [{ name, player_id: playerId }] : [],
    );
  }
  return [];
}

function unwrapCrconResult(data: unknown) {
  if (data && typeof data === 'object' && 'result' in data) {
    return (data as { result?: unknown }).result;
  }
  return data;
}

function isCrconPlayer(value: unknown): value is CrconPlayer {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as CrconPlayer).name === 'string' &&
      gameIdFromCrconPlayer(value as CrconPlayer),
  );
}
