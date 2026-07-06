import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import type Redis from 'ioredis';
import { prisma } from '@hll/db';
import { REDIS } from '../redis/redis.module';

export const BOT_COMMAND_CHANNEL = 'bot:commands';

/** Events that pit us against another clan — these carry an opponent. */
const COMPETITIVE = new Set(['ECL', 'HBL', 'Friendly']);

/**
 * Tank/artillery weapons. A player who scored with any of these was crewing a
 * vehicle, so their infantry-style stats are skewed and get omitted.
 */
const AUTO_OMIT_WEAPONS = new Set([
  // Artillery
  '155MM HOWITZER [M114]',
  '150MM HOWITZER [sFH 18]',
  '122MM HOWITZER [M1938 (M-30)]',
  'QF 25-POUNDER [QF 25-Pounder]',
  // US Tanks
  'M6 37mm [M8 Greyhound]',
  'COAXIAL M1919 [M8 Greyhound]',
  '37MM CANNON [Stuart M5A1]',
  'COAXIAL M1919 [Stuart M5A1]',
  'HULL M1919 [Stuart M5A1]',
  'Sherman M4A3(75)W',
  '75MM CANNON [Sherman M4A3(75)W]',
  'COAXIAL M1919 [Sherman M4A3(75)W]',
  'HULL M1919 [Sherman M4A3(75)W]',
  '75MM M3 GUN [Sherman M4A3E2]',
  'COAXIAL M1919 [Sherman M4A3E2]',
  'HULL M1919 [Sherman M4A3E2]',
  'Sherman M4A3E2(76)',
  '76MM M1 GUN [Sherman M4A3E2(76)]',
  'COAXIAL M1919 [Sherman M4A3E2(76)]',
  'HULL M1919 [Sherman M4A3E2(76)]',
  'M2 Browning [M3 Half-track]',
  // German Tanks
  '50mm KwK 39/1 [Sd.Kfz.234 Puma]',
  'COAXIAL MG34 [Sd.Kfz.234 Puma]',
  '20MM KWK 30 [Sd.Kfz.121 Luchs]',
  'COAXIAL MG34 [Sd.Kfz.121 Luchs]',
  'Sd.Kfz.161 Panzer IV',
  '75MM CANNON [Sd.Kfz.161 Panzer IV]',
  'COAXIAL MG34 [Sd.Kfz.161 Panzer IV]',
  'HULL MG34 [Sd.Kfz.161 Panzer IV]',
  '75MM CANNON [Sd.Kfz.171 Panther]',
  'COAXIAL MG34 [Sd.Kfz.171 Panther]',
  'HULL MG34 [Sd.Kfz.171 Panther]',
  '88 KWK 36 L/56 [Sd.Kfz.181 Tiger 1]',
  'COAXIAL MG34 [Sd.Kfz.181 Tiger 1]',
  'HULL MG34 [Sd.Kfz.181 Tiger 1]',
  'MG 42 [Sd.Kfz 251 Half-track]',
  // Soviet Tanks
  '19-K 45MM [BA-10]',
  'COAXIAL DT [BA-10]',
  '45MM M1937 [T70]',
  'COAXIAL DT [T70]',
  'T34/76',
  '76MM ZiS-5 [T34/76]',
  'COAXIAL DT [T34/76]',
  'HULL DT [T34/76]',
  'D-5T 85MM [IS-1]',
  'COAXIAL DT [IS-1]',
  'HULL DT [IS-1]',
  // British Tanks
  'QF 2-POUNDER [Daimler]',
  'COAXIAL BESA [Daimler]',
  'QF 2-POUNDER [Tetrarch]',
  'COAXIAL BESA [Tetrarch]',
  '37MM CANNON [M3 Stuart Honey]',
  'COAXIAL M1919 [M3 Stuart Honey]',
  'HULL M1919 [M3 Stuart Honey]',
  'OQF 75MM [Cromwell]',
  'COAXIAL BESA [Cromwell]',
  'HULL BESA [Cromwell]',
  'OQF 57MM [Crusader Mk.III]',
  'COAXIAL BESA [Crusader Mk.III]',
  'QF 17-POUNDER [Firefly]',
  'COAXIAL M1919 [Firefly]',
  'OQF 57MM [Churchill Mk.III]',
  'COAXIAL BESA 7.92mm [Churchill Mk.III]',
  'HULL BESA 7.92mm [Churchill Mk.III]',
  'OQF 57MM [Churchill Mk.VII]',
  'COAXIAL BESA 7.92mm [Churchill Mk.VII]',
  'HULL BESA 7.92mm [Churchill Mk.VII]',
]);

interface CreateMatchInput {
  playedAt?: string | null;
  eventType?: string | null;
  eventName?: string | null;
  opponent?: string | null;
  url?: string | null;
}

interface ScoreboardPlayer {
  player_id?: string;
  player?: string;
  kills?: number;
  deaths?: number;
  kills_per_minute?: number;
  team?: { side?: string };
  weapons?: Record<string, number>;
}

@Injectable()
export class MatchesService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Turns a CRCON game URL into its scoreboard API endpoint. */
  private scoreboardUrl(gameUrl: string): string | null {
    try {
      const u = new URL(gameUrl.trim());
      const mapId = u.pathname.match(/(\d+)\s*$/)?.[1];
      if (!mapId) return null;
      return `${u.origin}/api/get_map_scoreboard?map_id=${mapId}`;
    } catch {
      return null;
    }
  }

  private eventLabel(m: {
    eventType: string | null;
    eventName: string | null;
  }): string {
    if (m.eventType === 'Other') return m.eventName?.trim() || 'Event';
    return m.eventType ?? 'Event';
  }

  async list() {
    const matches = await prisma.match.findMany({
      orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { _count: { select: { playerStats: true } } },
    });
    return matches.map((m) => ({
      id: m.id.toString(),
      playedAt: m.playedAt,
      eventType: m.eventType,
      eventName: m.eventName,
      opponent: m.opponent,
      url: m.url,
      map: m.map,
      result: m.result,
      linkedCount: m._count.playerStats,
    }));
  }

  async create(input: CreateMatchInput) {
    const eventType = input.eventType?.trim() || null;
    if (!eventType) throw new BadRequestException('Event type is required');
    if (eventType === 'Other' && !input.eventName?.trim()) {
      throw new BadRequestException('Custom event name is required');
    }

    const match = await prisma.match.create({
      data: {
        playedAt: input.playedAt ? new Date(input.playedAt) : null,
        eventType,
        eventName: eventType === 'Other' ? input.eventName?.trim() : null,
        opponent: COMPETITIVE.has(eventType)
          ? input.opponent?.trim() || null
          : null,
        url: input.url?.trim() || null,
        source: 'crcon',
      },
    });
    return { id: match.id.toString() };
  }

  /**
   * Fetch the match scoreboard, link players to members by any stored game id,
   * and (re)store one MatchPlayerStat row per linked member.
   */
  async extract(id: bigint) {
    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) throw new NotFoundException('Match not found');
    if (!match.url) throw new BadRequestException('Match has no URL to extract');

    const endpoint = this.scoreboardUrl(match.url);
    if (!endpoint) {
      throw new BadRequestException('Could not parse a map id from the URL');
    }

    let players: ScoreboardPlayer[] = [];
    let raw: unknown;
    try {
      const { data } = await axios.get(endpoint, { timeout: 15_000 });
      raw = data;
      players =
        data?.result?.player_stats ??
        data?.player_stats ??
        data?.result ??
        [];
    } catch {
      throw new BadRequestException(
        'Could not reach the scoreboard. Check the URL is correct and public.',
      );
    }
    if (!Array.isArray(players)) {
      throw new BadRequestException('Unexpected scoreboard format');
    }

    // Map every stored Steam/Epic id -> our member's user id.
    const gameAccounts = await prisma.gameAccount.findMany({
      select: { gameId: true, userId: true },
    });
    const gameIdToUser = new Map(
      gameAccounts.map((a) => [a.gameId, a.userId]),
    );

    const rows = players
      .filter((p) => p.player_id && gameIdToUser.has(p.player_id))
      .map((p) => ({
        matchId: id,
        userId: gameIdToUser.get(p.player_id as string) ?? null,
        gameId: p.player_id as string,
        team: p.team?.side ?? null,
        kills: Math.max(0, Math.round(Number(p.kills ?? 0))),
        deaths: Math.max(0, Math.round(Number(p.deaths ?? 0))),
        kpm: Number(p.kills_per_minute ?? 0),
        weapons: p.weapons ?? {},
      }))
      // Drop skewed scores: anyone who crewed a tank/artillery piece, or who
      // got no kills, so they don't drag member averages around.
      .filter((r) => {
        if (r.kills === 0) return false;
        const usedVehicle = Object.keys(r.weapons).some((w) =>
          AUTO_OMIT_WEAPONS.has(w),
        );
        return !usedVehicle;
      })
      .map(({ weapons: _weapons, ...row }) => row);

    await prisma.$transaction([
      prisma.matchPlayerStat.deleteMany({ where: { matchId: id } }),
      ...(rows.length
        ? [prisma.matchPlayerStat.createMany({ data: rows })]
        : []),
      prisma.match.update({
        where: { id },
        data: { rawPayload: raw as object, source: 'crcon' },
      }),
    ]);

    return { linkedCount: rows.length };
  }

  /** Linked member stats for a match (for the "view data" table). */
  async playerStats(id: bigint) {
    const stats = await prisma.matchPlayerStat.findMany({
      where: { matchId: id },
      include: { user: true },
      orderBy: { kills: 'desc' },
    });
    return stats.map((s) => {
      const kills = s.kills;
      const deaths = s.deaths;
      return {
        id: s.id.toString(),
        nickname: s.user?.serverNick ?? s.user?.username ?? s.gameId,
        gameId: s.gameId,
        team: s.team,
        kills,
        deaths,
        kpm: Number(s.kpm),
        kd: deaths === 0 ? kills : Number((kills / deaths).toFixed(2)),
      };
    });
  }

  /** Ask the bot to announce a match in the configured channel. */
  async share(id: bigint) {
    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) throw new NotFoundException('Match not found');

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const channelId = settings?.matchChannelId;
    if (!channelId) {
      throw new BadRequestException(
        'No match announcement channel is set in Settings',
      );
    }

    const date = match.playedAt
      ? new Date(match.playedAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : '';
    let label = this.eventLabel(match);
    if (match.opponent) label += ` vs ${match.opponent}`;

    const content = `# ${label}${date ? ` - ${date}` : ''}\n${match.url ?? ''}`;

    await this.redis.publish(
      BOT_COMMAND_CHANNEL,
      JSON.stringify({ type: 'shareMatch', channelId, content }),
    );
    return { ok: true };
  }

  /** Delete a match and its linked player stats. */
  async remove(id: bigint) {
    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) throw new NotFoundException('Match not found');

    await prisma.$transaction([
      prisma.matchPlayerStat.deleteMany({ where: { matchId: id } }),
      prisma.match.delete({ where: { id } }),
    ]);
    return { ok: true };
  }
}
