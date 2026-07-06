import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { prisma } from '@hll/db';
import { REDIS } from '../redis/redis.module';

const API_BASE = 'https://raid-helper.xyz/api/v4';
/** Include events that started within the past 2 hours, or any time in the future. */
const PAST_WINDOW_MS = 2 * 60 * 60 * 1000;
const EVENTS_CACHE_KEY = 'raidhelper:events';
const EVENTS_CACHE_TTL = 30; // seconds

export interface UpcomingEvent {
  id: string;
  title: string;
  rawTitle: string;
  startTime: number; // unix seconds
  endTime: number | null;
  channelId: string | null;
  signUpCount: number;
  leaderName: string | null;
  imageUrl: string | null;
  color: string | null;
  description: string | null;
}

export interface EventPlayer {
  /** RaidHelper sign-up id (number, stringified). */
  signupId: string;
  discordId: string;
  name: string;
  className: string | null;
  specName: string | null;
  roleName: string | null;
  status: string;
  /** Linked dashboard user (if the Discord id is registered). */
  userId: string | null;
  avatar: string | null;
  serverNick: string | null;
  hll: { kpm: number | null; kdr: number | null; duelStrength: number | null } | null;
  match: { kpm: number; kd: number; kills: number; deaths: number; matchesPlayed: number } | null;
}

export interface EventDetail {
  id: string;
  title: string;
  rawTitle: string;
  startTime: number | null;
  endTime: number | null;
  channelId: string | null;
  channelName: string | null;
  leaderName: string | null;
  description: string | null;
  imageUrl: string | null;
  players: EventPlayer[];
  allPlayers: EventPlayer[];
}

/** Replace RaidHelper `{eventtime#...}` title placeholders with an actual date. */
function formatTitle(rawTitle: string, startTime: number | null): string {
  if (!rawTitle) return rawTitle;
  if (!startTime) return rawTitle.replace(/\{eventtime#[^}]*\}/g, '').trim();
  const date = new Date(startTime * 1000);
  const formatted = date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
  return rawTitle.replace(/\{eventtime#[^}]*\}/g, formatted).trim();
}

@Injectable()
export class RaidHelperService {
  private readonly logger = new Logger(RaidHelperService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private get serverId(): string {
    return process.env.DISCORD_GUILD_ID ?? '';
  }

  private get apiKey(): string {
    return process.env.RAIDHELPER_API_KEY ?? '';
  }

  /** List events starting within the past 2 hours or any time in the future. */
  async listEvents(): Promise<UpcomingEvent[]> {
    const cached = await this.redis.get(EVENTS_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as UpcomingEvent[];
      } catch {
        /* fall through and refetch */
      }
    }

    if (!this.serverId || !this.apiKey) {
      this.logger.warn('RaidHelper not configured (DISCORD_GUILD_ID / RAIDHELPER_API_KEY).');
      return [];
    }

    let posted: RawEvent[] = [];
    try {
      const res = await fetch(`${API_BASE}/servers/${this.serverId}/events`, {
        headers: { Authorization: this.apiKey },
      });
      if (!res.ok) {
        this.logger.warn(`RaidHelper events request failed: ${res.status}`);
        return [];
      }
      const data = (await res.json()) as { postedEvents?: RawEvent[] };
      posted = data.postedEvents ?? [];
    } catch (err) {
      this.logger.error('RaidHelper events request error', err as Error);
      return [];
    }

    const cutoff = Date.now() - PAST_WINDOW_MS;
    const events: UpcomingEvent[] = posted
      .map((e) => {
        const startTime = Number(e.startTime) || 0;
        return {
          id: String(e.id),
          rawTitle: e.title ?? '',
          title: formatTitle(e.title ?? '', startTime),
          startTime,
          endTime: e.endTime ? Number(e.endTime) : null,
          channelId: e.channelId ? String(e.channelId) : null,
          signUpCount: Number(e.signUpCount) || 0,
          leaderName: e.leaderName ?? null,
          imageUrl: e.imageUrl ?? null,
          color: e.color ?? null,
          description: e.description ?? null,
        };
      })
      .filter((e) => e.startTime * 1000 >= cutoff)
      .sort((a, b) => a.startTime - b.startTime);

    await this.redis.set(EVENTS_CACHE_KEY, JSON.stringify(events), 'EX', EVENTS_CACHE_TTL);
    return events;
  }

  /** Fetch a single event and enrich its sign-ups with dashboard stats. */
  async getEventWithSignups(eventId: string): Promise<EventDetail | null> {
    let raw: RawEventDetail;
    try {
      const res = await fetch(`${API_BASE}/events/${eventId}`, {
        headers: { Authorization: this.apiKey },
      });
      if (!res.ok) {
        this.logger.warn(`RaidHelper event ${eventId} request failed: ${res.status}`);
        return null;
      }
      raw = (await res.json()) as RawEventDetail;
    } catch (err) {
      this.logger.error(`RaidHelper event ${eventId} request error`, err as Error);
      return null;
    }

    const startTime = raw.startTime ? Number(raw.startTime) : null;
    // Only players actively signed up for an actual role count as available.
    // RaidHelper can include tentative/absence style rows in signUps, so filter
    // those out before the roster builder ever sees them.
    const rawSignups = raw.signUps ?? [];
    const allPlayers = await this.enrichSignups(rawSignups);
    const activeSignupIds = new Set(
      rawSignups.filter(isActiveRoleSignup).map((signup) => String(signup.id)),
    );
    const players = allPlayers.filter((player) => activeSignupIds.has(player.signupId));

    return {
      id: String(raw.id ?? eventId),
      rawTitle: raw.title ?? '',
      title: formatTitle(raw.title ?? '', startTime),
      startTime,
      endTime: raw.endTime ? Number(raw.endTime) : null,
      channelId: raw.channelId ? String(raw.channelId) : null,
      channelName: raw.channelName ?? null,
      leaderName: raw.leaderName ?? null,
      description: raw.description ?? null,
      imageUrl: raw.imageUrl ?? null,
      players,
      allPlayers,
    };
  }

  private async enrichSignups(signups: RawSignup[]): Promise<EventPlayer[]> {
    const discordIds = [...new Set(signups.map((s) => String(s.userId)).filter(Boolean))];

    const users = discordIds.length
      ? await prisma.user.findMany({
          where: { discordId: { in: discordIds } },
          include: { hllRecord: true },
        })
      : [];
    const userByDiscord = new Map(users.map((u) => [u.discordId, u]));

    const userIds = users.map((u) => u.id);
    const agg = userIds.length
      ? await prisma.matchPlayerStat.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds } },
          _avg: { kills: true, deaths: true, kpm: true },
          _count: { _all: true },
        })
      : [];
    const statsByUser = new Map(agg.map((a) => [a.userId?.toString() ?? '', a]));

    return signups.map((s) => {
      const discordId = String(s.userId);
      const user = userByDiscord.get(discordId);
      const a = user ? statsByUser.get(user.id.toString()) : undefined;
      const avgKills = a ? Number(a._avg.kills ?? 0) : 0;
      const avgDeaths = a ? Number(a._avg.deaths ?? 0) : 0;
      return {
        signupId: String(s.id),
        discordId,
        name: s.name ?? user?.username ?? 'Unknown',
        className: s.className ?? null,
        specName: s.specName ?? null,
        roleName: s.roleName || null,
        status: s.status ?? 'primary',
        userId: user ? user.id.toString() : null,
        avatar: user?.avatar ?? null,
        serverNick: user?.serverNick ?? null,
        hll:
          user?.hllRecord
            ? {
                kpm: user.hllRecord.kpm !== null ? Number(user.hllRecord.kpm) : null,
                kdr: user.hllRecord.kdr !== null ? Number(user.hllRecord.kdr) : null,
                duelStrength: user.hllRecord.duelStrength,
              }
            : null,
        match: a
          ? {
              kills: Number(avgKills.toFixed(1)),
              deaths: Number(avgDeaths.toFixed(1)),
              kpm: Number(Number(a._avg.kpm ?? 0).toFixed(2)),
              matchesPlayed: a._count._all,
              kd:
                avgDeaths === 0
                  ? Number(avgKills.toFixed(2))
                  : Number((avgKills / avgDeaths).toFixed(2)),
            }
          : null,
      };
    });
  }
}

interface RawEvent {
  id: string | number;
  title?: string;
  startTime?: string | number;
  endTime?: string | number;
  channelId?: string | number;
  signUpCount?: string | number;
  leaderName?: string;
  imageUrl?: string;
  color?: string;
  description?: string;
}

interface RawSignup {
  id: string | number;
  userId: string | number;
  name?: string;
  className?: string;
  specName?: string;
  roleName?: string;
  status?: string;
  position?: number;
}

interface RawEventDetail {
  id?: string | number;
  title?: string;
  startTime?: string | number;
  endTime?: string | number;
  channelId?: string | number;
  channelName?: string;
  leaderName?: string;
  description?: string;
  imageUrl?: string;
  signUps?: RawSignup[];
}

function isActiveRoleSignup(signup: RawSignup) {
  const status = normalizeSignupText(signup.status);
  if (status && status !== 'primary') return false;

  const labels = [signup.roleName, signup.className, signup.specName]
    .map(normalizeSignupText)
    .filter(Boolean);
  if (labels.length === 0) return false;

  return labels.every((label) => !isUnavailableSignupLabel(label));
}

function normalizeSignupText(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isUnavailableSignupLabel(value: string) {
  return [
    'absent',
    'absence',
    'tentative',
    'unavailable',
    'declined',
    'decline',
    'no',
  ].includes(value);
}
