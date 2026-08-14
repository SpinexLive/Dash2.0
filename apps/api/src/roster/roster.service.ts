import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { prisma } from '@hll/db';
import { REDIS } from '../redis/redis.module';

export const BOT_COMMAND_CHANNEL = 'bot:commands';
const MATCH_LENGTH_MINUTES = 90;
const DATABASE_SCORE_WEIGHT = 0.75;
const HLLRECORDS_SCORE_WEIGHT = 0.25;

/** Player assigned to a slot (or reserve) inside the saved squad layout. */
interface LayoutPlayer {
  discordId: string;
  name: string;
  position: string;
}

interface LayoutSquadSummary {
  id: string | null;
  name: string;
  type: string | null;
  players: LayoutPlayer[];
}

interface PlayerBalanceStat {
  discordId: string;
  score: number | null;
  kpm: number | null;
  kdr: number | null;
  source: 'hllrecords' | 'matches' | null;
}

export interface SaveRosterDto {
  data: unknown; // the full squad layout document
  name?: string;
  eventTitle?: string;
  eventStartTime?: string | number | null;
  channelId?: string | null;
}

@Injectable()
export class RosterService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Fetch the saved roster for a RaidHelper event (with confirmation rows). */
  async getByEvent(eventId: string) {
    let roster = await prisma.roster.findUnique({
      where: { raidhelperEventId: eventId },
      include: { slots: true },
    });
    if (roster?.messageId && roster.channelId) {
      roster = await this.clearMissingDiscordMessage(roster);
    }
    return roster ? this.serialize(roster) : null;
  }

  /** Ids of every event that already has a saved roster (for list badges). */
  async eventIdsWithRosters(): Promise<string[]> {
    const rows = await prisma.roster.findMany({
      where: { raidhelperEventId: { not: null } },
      select: { raidhelperEventId: true },
    });
    return rows.map((r) => r.raidhelperEventId!).filter(Boolean);
  }

  /**
   * Create or update the roster for an event. Players newly added or moved to a
   * different position have their attendance confirmation reset to pending;
   * removed players' confirmation rows are deleted.
   */
  async save(eventId: string, dto: SaveRosterDto) {
    const previous = await prisma.roster.findUnique({ where: { raidhelperEventId: eventId } });
    const hasPostedMessage = Boolean(previous?.messageId);
    const roster = await prisma.roster.upsert({
      where: { raidhelperEventId: eventId },
      create: {
        raidhelperEventId: eventId,
        name: dto.name ?? null,
        eventTitle: dto.eventTitle ?? null,
        eventStartTime: dto.eventStartTime ? new Date(Number(dto.eventStartTime) * 1000) : null,
        channelId: dto.channelId ?? null,
        data: dto.data as object,
      },
      update: {
        name: dto.name ?? undefined,
        eventTitle: dto.eventTitle ?? undefined,
        eventStartTime: dto.eventStartTime
          ? new Date(Number(dto.eventStartTime) * 1000)
          : undefined,
        channelId: dto.channelId ?? undefined,
        data: dto.data as object,
        status: hasPostedMessage ? 'draft' : undefined,
      },
      include: { slots: true },
    });

    const players = extractPlayers(dto.data);
    const existing = new Map(roster.slots.map((s) => [s.discordId ?? '', s]));
    const changes = { added: [] as string[], changed: [] as string[], removed: [] as string[] };

    // Upsert a confirmation row per assigned player.
    for (const p of players) {
      const prev = existing.get(p.discordId);
      const user = await prisma.user.findUnique({ where: { discordId: p.discordId } });
      if (!prev) {
        changes.added.push(p.name);
        await prisma.rosterSlot.create({
          data: {
            rosterId: roster.id,
            userId: user?.id ?? null,
            discordId: p.discordId,
            username: p.name,
            position: p.position,
            response: 'pending',
          },
        });
      } else if (prev.position !== p.position) {
        changes.changed.push(p.name);
        await prisma.rosterSlot.update({
          where: { id: prev.id },
          data: {
            userId: user?.id ?? null,
            username: p.name,
            position: p.position,
            response: 'pending',
            respondedAt: null,
          },
        });
      } else {
        // Unchanged — keep their confirmation but refresh display name.
        await prisma.rosterSlot.update({
          where: { id: prev.id },
          data: { username: p.name, userId: user?.id ?? null },
        });
      }
    }

    // Remove confirmation rows for players no longer in the roster.
    const currentIds = new Set(players.map((p) => p.discordId));
    for (const s of roster.slots) {
      if (s.discordId && !currentIds.has(s.discordId)) {
        changes.removed.push(s.username ?? s.discordId);
        await prisma.rosterSlot.delete({ where: { id: s.id } });
      }
    }

    const fresh = await prisma.roster.findUnique({
      where: { id: roster.id },
      include: { slots: true },
    });
    return { roster: fresh ? await this.serialize(fresh) : null, changes };
  }

  /** Ask the bot to post the roster embed into the event's channel. */
  async post(eventId: string, assignSquadLeaderRole = false) {
    const roster = await prisma.roster.findUnique({ where: { raidhelperEventId: eventId } });
    if (!roster) return { ok: false };
    if (!roster.messageId && assignSquadLeaderRole) {
      const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { squadLeaderRoleId: true } });
      const roleId = settings?.squadLeaderRoleId?.trim();
      if (!roleId) throw new BadRequestException('Configure a Squad Leader role in Settings before assigning it.');
      await prisma.roster.update({ where: { id: roster.id }, data: { squadLeaderRoleId: roleId } });
    }
    await this.publish({ type: 'postRoster', rosterId: roster.id.toString() });
    return { ok: true };
  }

  async cleanupSquadLeaderRole() {
    const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { squadLeaderRoleId: true } });
    const roleId = settings?.squadLeaderRoleId?.trim();
    if (!roleId) throw new BadRequestException('No Squad Leader role is configured in Settings.');
    await this.publish({ type: 'cleanupSquadLeaderRole', roleId });
    return { ok: true };
  }

  async assignSquadLeaderRole(eventId: string) {
    const roster = await prisma.roster.findUnique({ where: { raidhelperEventId: eventId } });
    if (!roster) return { ok: false };
    const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { squadLeaderRoleId: true } });
    const roleId = settings?.squadLeaderRoleId?.trim();
    if (!roleId) throw new BadRequestException('Configure a Squad Leader role in Settings before assigning it.');
    await prisma.roster.update({
      where: { id: roster.id },
      data: {
        squadLeaderRoleId: roleId,
        squadLeaderRoleAssignedAt: null,
        squadLeaderRoleRemovedAt: null,
      },
    });
    await this.publish({ type: 'assignRosterSquadLeaderRole', rosterId: roster.id.toString() });
    return { ok: true };
  }

  /** Ask the bot to edit the already-posted roster embed. */
  async updateDiscord(eventId: string) {
    const roster = await prisma.roster.findUnique({ where: { raidhelperEventId: eventId } });
    if (!roster) return { ok: false };
    await this.publish({ type: 'updateRoster', rosterId: roster.id.toString() });
    return { ok: true };
  }

  /** Ask the bot to ping players who have not yet confirmed. */
  async remindPending(eventId: string) {
    const roster = await prisma.roster.findUnique({ where: { raidhelperEventId: eventId } });
    if (!roster) return { ok: false };
    await this.publish({ type: 'remindPending', rosterId: roster.id.toString() });
    return { ok: true };
  }

  /** Record a player's accept/decline from the dashboard. */
  async respond(slotId: bigint, response: 'accepted' | 'declined') {
    return prisma.rosterSlot.update({
      where: { id: slotId },
      data: { response, respondedAt: new Date() },
    });
  }

  private async publish(payload: Record<string, unknown>) {
    await this.redis.publish(BOT_COMMAND_CHANNEL, JSON.stringify(payload));
  }

  private async clearMissingDiscordMessage<TRoster extends { id: bigint; channelId: string | null; messageId: string | null }>(
    roster: TRoster,
  ): Promise<TRoster> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token || !roster.channelId || !roster.messageId) return roster;

    try {
      const res = await fetch(
        `https://discord.com/api/v10/channels/${roster.channelId}/messages/${roster.messageId}`,
        { headers: { Authorization: `Bot ${token}` } },
      );
      if (res.status !== 404) return roster;

      return (await prisma.roster.update({
        where: { id: roster.id },
        data: { messageId: null, status: 'draft' },
        include: { slots: true },
      })) as unknown as TRoster;
    } catch {
      return roster;
    }
  }

  private async serialize(roster: {
    id: bigint;
    raidhelperEventId: string | null;
    channelId: string | null;
    messageId: string | null;
    name: string | null;
    eventTitle: string | null;
    eventStartTime: Date | null;
    data: unknown;
    status: string;
    slots: {
      id: bigint;
      discordId: string | null;
      username: string | null;
      position: string | null;
      response: string;
      respondedAt: Date | null;
    }[];
  }) {
    const balance = await buildBalanceSummary(roster.data);
    return {
      id: roster.id.toString(),
      raidhelperEventId: roster.raidhelperEventId,
      channelId: roster.channelId,
      messageId: roster.messageId,
      name: roster.name,
      eventTitle: roster.eventTitle,
      eventStartTime: roster.eventStartTime,
      status: roster.status,
      data: roster.data ?? null,
      confirmations: roster.slots.map((s) => ({
        id: s.id.toString(),
        discordId: s.discordId,
        username: s.username,
        position: s.position,
        response: s.response,
        respondedAt: s.respondedAt,
      })),
      balance,
    };
  }
}

/** Walk a saved squad layout and return every assigned (and reserve) player. */
function extractPlayers(data: unknown): LayoutPlayer[] {
  const out: LayoutPlayer[] = [];
  const seen = new Set<string>();
  const push = (discordId: unknown, name: unknown, position: string) => {
    if (typeof discordId !== 'string' || !discordId) return;
    if (seen.has(discordId)) return;
    seen.add(discordId);
    out.push({ discordId, name: typeof name === 'string' ? name : 'Unknown', position });
  };

  const doc = data as { squads?: unknown[]; reserves?: unknown[] } | null;
  if (doc && Array.isArray(doc.squads)) {
    for (const squad of doc.squads as Squad[]) {
      const squadName = squad?.name ?? 'Squad';
      const slots = Array.isArray(squad?.slots) ? squad.slots : [];
      for (const slot of slots) {
        const player = slot?.player as { discordId?: string; name?: string } | null;
        if (player) push(player.discordId, player.name, `${squadName} • ${slot?.label ?? 'Slot'}`);
      }
    }
  }
  if (doc && Array.isArray(doc.reserves)) {
    for (const player of doc.reserves as { discordId?: string; name?: string }[]) {
      push(player?.discordId, player?.name, 'Reserve');
    }
  }
  return out;
}

function extractSquads(data: unknown): LayoutSquadSummary[] {
  const doc = data as { squads?: unknown[] } | null;
  if (!doc || !Array.isArray(doc.squads)) return [];

  return (doc.squads as Squad[]).map((squad) => {
    const name = squad?.name ?? 'Squad';
    const players: LayoutPlayer[] = [];
    const slots = Array.isArray(squad?.slots) ? squad.slots : [];
    for (const slot of slots) {
      const player = slot?.player as { discordId?: string; name?: string } | null;
      if (player?.discordId) {
        players.push({
          discordId: player.discordId,
          name: player.name ?? 'Unknown',
          position: `${name} • ${slot?.label ?? 'Slot'}`,
        });
      }
    }
    return {
      id: typeof squad?.id === 'string' ? squad.id : null,
      name,
      type: typeof squad?.type === 'string' ? squad.type : null,
      players,
    };
  });
}

async function buildBalanceSummary(data: unknown) {
  const squads = extractSquads(data);
  const players = extractPlayers(data);
  const discordIds = [...new Set(players.map((player) => player.discordId))];

  if (discordIds.length === 0) {
    return {
      assignedPlayers: 0,
      scoredPlayers: 0,
      averageScore: null,
      squads: [],
      spread: null,
      warnings: ['Assign players to calculate roster balance.'],
    };
  }

  const users = await prisma.user.findMany({
    where: { discordId: { in: discordIds } },
    include: { hllRecord: true },
  });
  const userByDiscord = new Map(users.map((user) => [user.discordId, user]));
  const userIds = users.map((user) => user.id);
  const matchAgg = userIds.length
    ? await prisma.matchPlayerStat.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _avg: { kpm: true, kills: true, deaths: true },
        _count: { _all: true },
      })
    : [];
  const matchByUser = new Map(matchAgg.map((row) => [row.userId?.toString() ?? '', row]));

  const statsByDiscord = new Map<string, PlayerBalanceStat>();
  for (const discordId of discordIds) {
    const user = userByDiscord.get(discordId);
    const hllKpm = user?.hllRecord?.kpm != null ? Number(user.hllRecord.kpm) : null;
    const hllKdr = user?.hllRecord?.kdr != null ? Number(user.hllRecord.kdr) : null;
    const match = user ? matchByUser.get(user.id.toString()) : null;
    const avgKills = Number(match?._avg.kills ?? 0);
    const avgDeaths = Number(match?._avg.deaths ?? 0);
    const matchKpm = match ? Number(match._avg.kpm ?? 0) : null;
    const matchKdr = match
      ? avgDeaths === 0
        ? Number(avgKills.toFixed(2))
        : Number((avgKills / avgDeaths).toFixed(2))
      : null;
    const databaseScore = statPairScore(matchKpm, matchKdr);
    const hllRecordsScore = statPairScore(hllKpm, hllKdr);
    const score = weightedPlayerScore(databaseScore, hllRecordsScore);
    statsByDiscord.set(discordId, {
      discordId,
      score,
      kpm: matchKpm ?? hllKpm,
      kdr: matchKdr ?? hllKdr,
      source: match ? 'matches' : hllKpm !== null || hllKdr !== null ? 'hllrecords' : null,
    });
  }

  const squadSummaries = squads.map((squad) => {
    const scores = squad.players
      .map((player) => statsByDiscord.get(player.discordId)?.score ?? null)
      .filter((score): score is number => score !== null && Number.isFinite(score));
    const averageScore = scores.length
      ? Number((scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1))
      : null;
    return {
      id: squad.id,
      name: squad.name,
      type: squad.type,
      players: squad.players.length,
      scoredPlayers: scores.length,
      averageScore,
    };
  });

  const scoredSquads = squadSummaries.filter((squad) => squad.averageScore !== null);
  const best = scoredSquads.reduce<typeof scoredSquads[number] | null>(
    (current, squad) =>
      !current || (squad.averageScore ?? 0) > (current.averageScore ?? 0) ? squad : current,
    null,
  );
  const weakest = scoredSquads.reduce<typeof scoredSquads[number] | null>(
    (current, squad) =>
      !current || (squad.averageScore ?? 0) < (current.averageScore ?? 0) ? squad : current,
    null,
  );
  const spread = best && weakest
    ? {
        strongestSquad: best.name,
        weakestSquad: weakest.name,
        difference: Number(((best.averageScore ?? 0) - (weakest.averageScore ?? 0)).toFixed(1)),
        status:
          (best.averageScore ?? 0) - (weakest.averageScore ?? 0) <= 18
            ? 'balanced'
            : (best.averageScore ?? 0) - (weakest.averageScore ?? 0) <= 36
              ? 'watch'
              : 'imbalanced',
      }
    : null;
  const scoredPlayers = [...statsByDiscord.values()].filter((stat) => stat.score !== null).length;
  const allScores = [...statsByDiscord.values()]
    .map((stat) => stat.score)
    .filter((score): score is number => score !== null);
  const warnings: string[] = [];
  if (scoredPlayers < Math.ceil(discordIds.length * 0.5)) {
    warnings.push('Less than half of assigned players have usable stats.');
  }
  if (spread?.status === 'imbalanced') {
    warnings.push(`${spread.strongestSquad} is much stronger than ${spread.weakestSquad}.`);
  }

  return {
    assignedPlayers: discordIds.length,
    scoredPlayers,
    averageScore: allScores.length
      ? Number((allScores.reduce((total, score) => total + score, 0) / allScores.length).toFixed(1))
      : null,
    squads: squadSummaries,
    spread,
    warnings,
  };
}

function statPairScore(kpm: number | null, kdr: number | null) {
  if (kpm === null || kdr === null) return null;
  return Number((kpm * MATCH_LENGTH_MINUTES + kdr * 10).toFixed(1));
}

function weightedPlayerScore(databaseScore: number | null, hllRecordsScore: number | null) {
  if (databaseScore !== null && hllRecordsScore !== null) {
    return Number(
      (databaseScore * DATABASE_SCORE_WEIGHT + hllRecordsScore * HLLRECORDS_SCORE_WEIGHT).toFixed(1),
    );
  }
  return databaseScore ?? hllRecordsScore;
}

interface Squad {
  id?: string;
  type?: string;
  name?: string;
  slots?: { label?: string; player?: { discordId?: string; name?: string } | null }[];
}
