'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import { PageHeader } from '../../../components/PageHeader';
import { ROLES, SQUAD_TYPES, squadTemplate, INFANTRY_DEFAULT, SL_SLOT, INF_SLOT, SL_MAX, type RoleDef, type SlotDef, type SlotKind } from '../../../lib/roster-config';

interface Stats {
  kpm: number | null;
  kdr: number | null;
  duelStrength: number | null;
}
interface MatchStats {
  kpm: number;
  kd: number;
  kills: number;
  deaths: number;
  matchesPlayed: number;
}
interface EventPlayer {
  signupId: string;
  discordId: string;
  name: string;
  className: string | null;
  specName: string | null;
  roleName: string | null;
  status: string;
  userId: string | null;
  avatar: string | null;
  serverNick: string | null;
  hll: Stats | null;
  match: MatchStats | null;
}
interface EventDetail {
  id: string;
  title: string;
  startTime: number | null;
  channelId: string | null;
  channelName: string | null;
  leaderName: string | null;
  imageUrl: string | null;
  players: EventPlayer[];
  allPlayers?: EventPlayer[];
}
interface AssignedPlayer {
  discordId: string;
  name: string;
  userId: string | null;
  avatar: string | null;
  className: string | null;
  specName: string | null;
  hll: Stats | null;
  match: MatchStats | null;
  roles: RoleDef[];
}
interface Slot {
  id: string;
  label: string;
  icon: string;
  kind: SlotKind;
  player: AssignedPlayer | null;
}
interface Squad {
  id: string;
  type: string;
  name: string;
  slots: Slot[];
}
interface Confirmation {
  id: string;
  discordId: string | null;
  username: string | null;
  position: string | null;
  response: 'pending' | 'accepted' | 'declined';
  respondedAt: string | null;
}

interface SavedRoster {
  data: { squads?: Squad[]; reserves?: AssignedPlayer[] } | null;
  confirmations: Confirmation[];
  messageId: string | null;
  status: string;
  balance?: RosterBalance | null;
}

interface RosterBalanceSquad {
  id: string | null;
  name: string;
  type: string | null;
  players: number;
  scoredPlayers: number;
  averageScore: number | null;
}

interface RosterBalance {
  assignedPlayers: number;
  scoredPlayers: number;
  averageScore: number | null;
  squads: RosterBalanceSquad[];
  spread: {
    strongestSquad: string;
    weakestSquad: string;
    difference: number;
    status: 'balanced' | 'watch' | 'imbalanced';
  } | null;
  warnings: string[];
}

type BalanceStatus = NonNullable<RosterBalance['spread']>['status'];

type Drag =
  | { kind: 'pool'; discordId: string }
  | { kind: 'slot'; squadId: string; slotId: string }
  | { kind: 'reserve'; discordId: string }
  | { kind: 'role'; role: RoleDef };

const RESPONSE_ICON: Record<string, string> = {
  accepted: '/icons/accept.png',
  declined: '/icons/decline.png',
  pending: '/icons/pending.png',
};

const RESPONSE_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  declined: 'Declined',
  pending: 'Pending',
};

/** Squad types grouped into display rows. */
const SQUAD_ROWS: string[][] = [
  ['commander', 'artillery', 'recon'],
  ['armour'],
  ['infantry'],
];

const INFANTRY_PRESETS = [
  { label: '1SL/1Inf', squadLeaders: 1, infantry: 1 },
  { label: '2SL/4Inf', squadLeaders: 2, infantry: 4 },
  { label: '2SL/5Inf', squadLeaders: 2, infantry: 5 },
  { label: '2SL/6Inf', squadLeaders: 2, infantry: 6 },
  { label: '3SL/2Inf', squadLeaders: 3, infantry: 2 },
];

const MATCH_LENGTH_MINUTES = 90;
const DATABASE_SCORE_WEIGHT = 0.75;
const HLLRECORDS_SCORE_WEIGHT = 0.25;

function kpmClass(value: number | null | undefined) {
  if (value == null) return 'text-zinc-600';
  if (value > 0.6) return 'text-emerald-400';
  if (value >= 0.5) return 'text-amber-300';
  return 'text-red-400';
}

function kdrClass(value: number | null | undefined) {
  if (value == null) return 'text-zinc-600';
  if (value > 1.5) return 'text-emerald-400';
  if (value >= 1) return 'text-amber-300';
  return 'text-red-400';
}

function averageStat(
  players: AssignedPlayer[],
  select: (player: AssignedPlayer) => number | null | undefined,
) {
  const values = players
    .map(select)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    value: values.length
      ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
      : null,
    count: values.length,
  };
}

function playerSkillScore(player: AssignedPlayer) {
  const databaseScore = statPairScore(player.match?.kpm, player.match?.kd);
  const hllRecordsScore = statPairScore(player.hll?.kpm, player.hll?.kdr);
  if (databaseScore !== null && hllRecordsScore !== null) {
    return Number(
      (databaseScore * DATABASE_SCORE_WEIGHT + hllRecordsScore * HLLRECORDS_SCORE_WEIGHT).toFixed(1),
    );
  }
  return databaseScore ?? hllRecordsScore;
}

function statPairScore(kpm: number | null | undefined, kdr: number | null | undefined) {
  if (kpm == null || kdr == null) return null;
  return Number((kpm * MATCH_LENGTH_MINUTES + kdr * 10).toFixed(1));
}

function balanceTone(status: BalanceStatus) {
  if (status === 'balanced') return 'text-emerald-400';
  if (status === 'watch') return 'text-amber-300';
  return 'text-red-400';
}

function balanceStatus(difference: number): BalanceStatus {
  if (difference <= 18) return 'balanced';
  if (difference <= 36) return 'watch';
  return 'imbalanced';
}

function ResponseIcon({ response, className = 'h-4 w-4' }: { response: string; className?: string }) {
  const src = RESPONSE_ICON[response];
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={RESPONSE_LABEL[response] ?? response}
      title={RESPONSE_LABEL[response] ?? response}
      className={`${className} shrink-0 object-contain`}
    />
  );
}
function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function toAssigned(p: EventPlayer): AssignedPlayer {
  return {
    discordId: p.discordId,
    name: p.name,
    userId: p.userId,
    avatar: p.avatar,
    className: p.className,
    specName: p.specName,
    hll: p.hll,
    match: p.match,
    roles: [],
  };
}

function prettyClassName(className: string) {
  return className
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mkSlot(def: SlotDef): Slot {
  return { id: uid(), label: def.label, icon: def.icon, kind: def.kind, player: null };
}

export default function RosterBuilderPage() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [reserves, setReserves] = useState<AssignedPlayer[]>([]);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [hasRoster, setHasRoster] = useState(false);
  const [rosterPostState, setRosterPostState] = useState<{ messageId: string | null; status: string }>({
    messageId: null,
    status: 'draft',
  });
  const [savedLayoutKey, setSavedLayoutKey] = useState(JSON.stringify({ squads: [], reserves: [] }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishRoleDialogOpen, setPublishRoleDialogOpen] = useState(false);
  const [assignSquadLeaderRole, setAssignSquadLeaderRole] = useState(false);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sort, setSort] = useState<'name' | 'hllKpm' | 'hllKdr' | 'matchKpm' | 'matchKdr'>('name');
  const [selectedBalanceSquadIds, setSelectedBalanceSquadIds] = useState<Set<string>>(new Set());
  const [squadGapSquadIds, setSquadGapSquadIds] = useState<Set<string>>(new Set());

  const dragRef = useRef<Drag | null>(null);

  // ---- load ----------------------------------------------------------------
  const loadSaved = useCallback(async () => {
    const saved = await api<SavedRoster | null>(`/roster/event/${eventId}`);
    if (saved) {
      setConfirmations(saved.confirmations ?? []);
      setRosterPostState({ messageId: saved.messageId ?? null, status: saved.status ?? 'draft' });
      setSavedLayoutKey(JSON.stringify(saved.data ?? { squads: [], reserves: [] }));
      setHasRoster(true);
      return saved;
    }
    setRosterPostState({ messageId: null, status: 'draft' });
    setSavedLayoutKey(JSON.stringify({ squads: [], reserves: [] }));
    setHasRoster(false);
    return null;
  }, [eventId]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [ev, saved] = await Promise.all([
          api<EventDetail>(`/raidhelper/events/${eventId}`),
          loadSaved(),
        ]);
        if (!active) return;
        setEvent(ev);
        if (saved?.data) {
          setSquads(Array.isArray(saved.data.squads) ? saved.data.squads : []);
          setReserves(Array.isArray(saved.data.reserves) ? saved.data.reserves : []);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load event');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [eventId, loadSaved]);

  // refresh confirmations on realtime updates
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = () => loadSaved().catch(() => {});
    socket.on('roster.updated', onUpdate);
    return () => {
      socket.off('roster.updated', onUpdate);
    };
  }, [loadSaved]);

  // ---- derived -------------------------------------------------------------
  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    squads.forEach((sq) => sq.slots.forEach((s) => s.player && ids.add(s.player.discordId)));
    reserves.forEach((p) => ids.add(p.discordId));
    return ids;
  }, [squads, reserves]);

  const confByDiscord = useMemo(
    () => new Map(confirmations.map((c) => [c.discordId ?? '', c.response])),
    [confirmations],
  );

  const unsignedDiscordIds = useMemo(() => {
    const activeIds = new Set((event?.players ?? []).map((player) => player.discordId));
    return new Set([...assignedIds].filter((discordId) => !activeIds.has(discordId)));
  }, [assignedIds, event]);

  const roleOptions = useMemo(() => {
    const classes = new Set<string>();
    (event?.players ?? []).forEach((p) => {
      const clean = p.className?.trim();
      if (clean) classes.add(clean);
    });
    return [...classes].sort((a, b) => prettyClassName(a).localeCompare(prettyClassName(b)));
  }, [event]);

  const pool = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = (event?.players ?? []).filter((p) => !assignedIds.has(p.discordId));
    if (term) list = list.filter((p) => p.name.toLowerCase().includes(term));
    if (roleFilter) {
      list = list.filter((p) => p.className === roleFilter);
    }
    const num = (v: number | null | undefined) => (v == null ? -1 : v);
    list = [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'hllKpm') return num(b.hll?.kpm) - num(a.hll?.kpm);
      if (sort === 'hllKdr') return num(b.hll?.kdr) - num(a.hll?.kdr);
      if (sort === 'matchKpm') return num(b.match?.kpm) - num(a.match?.kpm);
      return num(b.match?.kd) - num(a.match?.kd);
    });
    return list;
  }, [event, assignedIds, roleFilter, search, sort]);

  const currentLayoutKey = useMemo(() => JSON.stringify({ squads, reserves }), [squads, reserves]);
  const hasUnsavedChanges = currentLayoutKey !== savedLayoutKey;

  const infantrySquadStats = useMemo(
    () =>
      squads
        .filter((squad) => squad.type === 'infantry')
        .map((squad) => {
          const players = squad.slots
            .map((slot) => slot.player)
            .filter((player): player is AssignedPlayer => Boolean(player));

          return {
            id: squad.id,
            name: squad.name,
            players: players.length,
            averageScore: averageStat(players, playerSkillScore),
            hllKpm: averageStat(players, (player) => player.hll?.kpm),
            hllKdr: averageStat(players, (player) => player.hll?.kdr),
            matchKpm: averageStat(players, (player) => player.match?.kpm),
            matchKdr: averageStat(players, (player) => player.match?.kd),
          };
        }),
    [squads],
  );

  const rosterBalance = useMemo<RosterBalance>(() => {
    const balanceSquads = squads
      .filter((squad) => squad.type === 'infantry')
      .map((squad) => {
        const players = squad.slots
          .map((slot) => slot.player)
          .filter((player): player is AssignedPlayer => Boolean(player));
        const scores = players
          .map(playerSkillScore)
          .filter((score): score is number => score !== null && Number.isFinite(score));
        return {
          id: squad.id,
          name: squad.name,
          type: squad.type,
          players: players.length,
          scoredPlayers: scores.length,
          averageScore: scores.length
            ? Number((scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1))
            : null,
        };
      });
    const scored = balanceSquads.filter(
      (squad) => squad.id !== null && squadGapSquadIds.has(squad.id) && squad.averageScore !== null,
    );
    const strongest = scored.reduce<RosterBalanceSquad | null>(
      (current, squad) =>
        !current || (squad.averageScore ?? 0) > (current.averageScore ?? 0) ? squad : current,
      null,
    );
    const weakest = scored.reduce<RosterBalanceSquad | null>(
      (current, squad) =>
        !current || (squad.averageScore ?? 0) < (current.averageScore ?? 0) ? squad : current,
      null,
    );
    const difference = strongest && weakest
      ? Number(((strongest.averageScore ?? 0) - (weakest.averageScore ?? 0)).toFixed(1))
      : null;
    const spread = strongest && weakest && difference !== null
      ? {
          strongestSquad: strongest.name,
          weakestSquad: weakest.name,
          difference,
          status: balanceStatus(difference),
        }
      : null;
    const assignedPlayers = balanceSquads.reduce((total, squad) => total + squad.players, 0);
    const scoredPlayers = balanceSquads.reduce((total, squad) => total + squad.scoredPlayers, 0);
    const allScores = squads.flatMap((squad) =>
      squad.slots
        .map((slot) => (slot.player ? playerSkillScore(slot.player) : null))
        .filter((score): score is number => score !== null),
    );
    const warnings: string[] = [];
    if (assignedPlayers > 0 && scoredPlayers < Math.ceil(assignedPlayers * 0.5)) {
      warnings.push('Less than half of infantry players have usable stats.');
    }
    if (spread?.status === 'imbalanced') {
      warnings.push(`${spread.strongestSquad} is much stronger than ${spread.weakestSquad}.`);
    }
    return {
      assignedPlayers,
      scoredPlayers,
      averageScore: allScores.length
        ? Number((allScores.reduce((total, score) => total + score, 0) / allScores.length).toFixed(1))
        : null,
      squads: balanceSquads,
      spread,
      warnings,
    };
  }, [squadGapSquadIds, squads]);

  const selectedBalanceCount = selectedBalanceSquadIds.size;
  const selectedGapCount = squadGapSquadIds.size;

  const toggleBalanceSquad = (squadId: string) => {
    setSelectedBalanceSquadIds((current) => {
      const next = new Set(current);
      if (next.has(squadId)) next.delete(squadId);
      else next.add(squadId);
      return next;
    });
  };

  const toggleSquadGap = (squadId: string) => {
    setSquadGapSquadIds((current) => {
      const next = new Set(current);
      if (next.has(squadId)) next.delete(squadId);
      else next.add(squadId);
      return next;
    });
  };

  // ---- mutation helpers ----------------------------------------------------
  const findPlayer = useCallback(
    (discordId: string): AssignedPlayer | null => {
      const ev = event?.players.find((p) => p.discordId === discordId);
      if (ev) return toAssigned(ev);
      for (const sq of squads)
        for (const s of sq.slots) if (s.player?.discordId === discordId) return s.player;
      const r = reserves.find((p) => p.discordId === discordId);
      return r ?? null;
    },
    [event, squads, reserves],
  );

  const removeFromEverywhere = useCallback((discordId: string) => {
    setSquads((prev) =>
      prev.map((sq) => ({
        ...sq,
        slots: sq.slots.map((s) =>
          s.player?.discordId === discordId ? { ...s, player: null } : s,
        ),
      })),
    );
    setReserves((prev) => prev.filter((p) => p.discordId !== discordId));
  }, []);

  const assignToSlot = useCallback(
    (squadId: string, slotId: string, player: AssignedPlayer) => {
      setReserves((prev) => prev.filter((p) => p.discordId !== player.discordId));
      setSquads((prev) =>
        prev.map((sq) => {
          if (sq.id !== squadId) {
            // clear the player from any other slot (move semantics)
            return {
              ...sq,
              slots: sq.slots.map((s) =>
                s.player?.discordId === player.discordId ? { ...s, player: null } : s,
              ),
            };
          }
          return {
            ...sq,
            slots: sq.slots.map((s) => {
              if (s.id === slotId) return { ...s, player };
              if (s.player?.discordId === player.discordId) return { ...s, player: null };
              return s;
            }),
          };
        }),
      );
    },
    [],
  );

  const onDropSlot = useCallback(
    (squadId: string, slotId: string) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;

      if (drag.kind === 'role') {
        setSquads((prev) =>
          prev.map((sq) =>
            sq.id !== squadId
              ? sq
              : {
                  ...sq,
                  slots: sq.slots.map((s) => {
                    if (s.id !== slotId || !s.player) return s;
                    if (s.player.roles.some((r) => r.key === drag.role.key)) return s;
                    return { ...s, player: { ...s.player, roles: [...s.player.roles, drag.role] } };
                  }),
                },
          ),
        );
        return;
      }

      if (drag.kind === 'slot') {
        // move/swap between slots
        let source: AssignedPlayer | null = null;
        let target: AssignedPlayer | null = null;
        squads.forEach((sq) =>
          sq.slots.forEach((s) => {
            if (sq.id === drag.squadId && s.id === drag.slotId) source = s.player;
            if (sq.id === squadId && s.id === slotId) target = s.player;
          }),
        );
        if (!source) return;
        setSquads((prev) =>
          prev.map((sq) => ({
            ...sq,
            slots: sq.slots.map((s) => {
              if (sq.id === drag.squadId && s.id === drag.slotId) return { ...s, player: target };
              if (sq.id === squadId && s.id === slotId) return { ...s, player: source };
              return s;
            }),
          })),
        );
        return;
      }

      // pool or reserve -> assign
      const player = findPlayer(drag.discordId);
      if (player) assignToSlot(squadId, slotId, player);
    },
    [squads, findPlayer, assignToSlot],
  );

  const onDropReserves = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.kind === 'role' || drag.kind === 'reserve') return;
    const player = drag.kind === 'pool' ? findPlayer(drag.discordId) : findPlayerFromSlot(drag);
    if (!player) return;
    removeFromEverywhere(player.discordId);
    setReserves((prev) =>
      prev.some((p) => p.discordId === player.discordId) ? prev : [...prev, player],
    );

    function findPlayerFromSlot(d: { kind: 'slot'; squadId: string; slotId: string }) {
      for (const sq of squads)
        if (sq.id === d.squadId)
          for (const s of sq.slots) if (s.id === d.slotId) return s.player;
      return null;
    }
  }, [findPlayer, removeFromEverywhere, squads]);

  const onDropPool = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.kind === 'role' || drag.kind === 'pool') return;
    if (drag.kind === 'reserve') {
      setReserves((prev) => prev.filter((p) => p.discordId !== drag.discordId));
      return;
    }
    // from slot -> back to pool
    for (const sq of squads)
      if (sq.id === drag.squadId)
        for (const s of sq.slots)
          if (s.id === drag.slotId && s.player) removeFromEverywhere(s.player.discordId);
  }, [squads, removeFromEverywhere]);

  // ---- squad management ----------------------------------------------------
  const addSquad = (type: string) => {
    const tpl = squadTemplate(type);
    if (!tpl) return;
    const count = squads.filter((s) => s.type === type).length + 1;
    const defs: SlotDef[] = tpl.configurable
      ? [
          ...Array.from({ length: INFANTRY_DEFAULT.squadLeaders }, () => SL_SLOT),
          ...Array.from({ length: INFANTRY_DEFAULT.infantry }, () => INF_SLOT),
        ]
      : [...tpl.required];
    setSquads((prev) => [
      ...prev,
      {
        id: uid(),
        type,
        name: type === 'commander' ? tpl.name : `${tpl.name} ${count}`,
        slots: defs.map(mkSlot),
      },
    ]);
  };
  const removeSquad = (id: string) => setSquads((prev) => prev.filter((s) => s.id !== id));
  const renameSquad = (id: string, name: string) =>
    setSquads((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  const resetSquad = (id: string) => {
    const squad = squads.find((item) => item.id === id);
    const playerCount = squad?.slots.filter((slot) => slot.player).length ?? 0;
    if (playerCount > 0 && !confirm(`Move ${playerCount} player${playerCount === 1 ? '' : 's'} from ${squad?.name ?? 'this squad'} back to available?`)) {
      return;
    }
    setSquads((prev) =>
      prev.map((squad) =>
        squad.id === id
          ? { ...squad, slots: squad.slots.map((slot) => ({ ...slot, player: null })) }
          : squad,
      ),
    );
  };

  /** Rebuild an infantry squad's slots from new SL/infantry counts, keeping players. */
  const setInfantryCounts = (squadId: string, slCount: number, infCount: number) => {
    const sl = Math.max(0, Math.min(6, slCount));
    const inf = Math.max(0, Math.min(24, infCount));
    setSquads((prev) =>
      prev.map((sq) => {
        if (sq.id !== squadId) return sq;
        const sls = sq.slots.filter((s) => s.kind === 'squadLeader');
        const infs = sq.slots.filter((s) => s.kind === 'infantry');
        const others = sq.slots.filter((s) => s.kind !== 'squadLeader' && s.kind !== 'infantry');
        const newSls = Array.from({ length: sl }, (_, i) => sls[i] ?? mkSlot(SL_SLOT));
        const newInfs = Array.from({ length: inf }, (_, i) => infs[i] ?? mkSlot(INF_SLOT));
        return { ...sq, slots: [...newSls, ...newInfs, ...others] };
      }),
    );
  };

  /** Toggle an optional slot (e.g. armour Gunner/Driver, recon Sniper) on/off. */
  const toggleOptional = (squadId: string, def: SlotDef) => {
    setSquads((prev) =>
      prev.map((sq) => {
        if (sq.id !== squadId) return sq;
        if (sq.slots.some((s) => s.kind === def.kind)) {
          return { ...sq, slots: sq.slots.filter((s) => s.kind !== def.kind) };
        }
        return { ...sq, slots: [...sq.slots, mkSlot(def)] };
      }),
    );
  };

  const removeRole = (squadId: string, slotId: string, key: string) =>
    setSquads((prev) =>
      prev.map((sq) =>
        sq.id !== squadId
          ? sq
          : {
              ...sq,
              slots: sq.slots.map((s) =>
                s.id !== slotId || !s.player
                  ? s
                  : { ...s, player: { ...s.player, roles: s.player.roles.filter((r) => r.key !== key) } },
              ),
            },
      ),
    );

  const autoBalanceInfantry = () => {
    const selectedIds = selectedBalanceSquadIds;
    const infantrySquads = squads.filter(
      (squad) => squad.type === 'infantry' && (selectedIds.size === 0 || selectedIds.has(squad.id)),
    );
    if (infantrySquads.length < 2) return;

    const playersByKind = new Map<SlotKind, AssignedPlayer[]>();
    for (const squad of infantrySquads) {
      for (const slot of squad.slots) {
        if (!slot.player) continue;
        const players = playersByKind.get(slot.kind) ?? [];
        players.push(slot.player);
        playersByKind.set(slot.kind, players);
      }
    }

    const slotAssignments = new Map<string, AssignedPlayer | null>();
    const squadLoads = new Map(
      infantrySquads.map((squad) => [squad.id, { total: 0, scored: 0, assigned: 0 }]),
    );
    const squadLoadAverage = (squadId: string) => {
      const load = squadLoads.get(squadId);
      if (!load || load.scored === 0) return 0;
      return load.total / load.scored;
    };

    for (const [kind, players] of playersByKind) {
      if (players.length < 2) continue;
      const squadsWithKind = infantrySquads
        .map((squad) => ({
          squadId: squad.id,
          slots: squad.slots.filter((slot) => slot.kind === kind),
        }))
        .filter((squad) => squad.slots.length > 0);
      if (squadsWithKind.length < 2) continue;
      const sortedPlayers = [...players].sort(
        (a, b) => (playerSkillScore(b) ?? -1) - (playerSkillScore(a) ?? -1),
      );
      const availableSlots = new Map(squadsWithKind.map((squad) => [squad.squadId, [...squad.slots]]));

      for (const player of sortedPlayers) {
        const targetSquad = squadsWithKind
          .filter((squad) => (availableSlots.get(squad.squadId)?.length ?? 0) > 0)
          .sort((a, b) => {
            const averageDifference = squadLoadAverage(a.squadId) - squadLoadAverage(b.squadId);
            if (averageDifference !== 0) return averageDifference;
            return (squadLoads.get(a.squadId)?.assigned ?? 0) - (squadLoads.get(b.squadId)?.assigned ?? 0);
          })[0];
        if (!targetSquad) break;

        const slot = availableSlots.get(targetSquad.squadId)?.shift();
        if (!slot) continue;
        slotAssignments.set(slot.id, player);
        const score = playerSkillScore(player);
        const load = squadLoads.get(targetSquad.squadId);
        if (load) {
          load.assigned += 1;
          if (score !== null) {
            load.total += score;
            load.scored += 1;
          }
        }
      }

      for (const slots of availableSlots.values()) {
        slots.forEach((slot) => slotAssignments.set(slot.id, null));
      }
    }

    setSquads((prev) =>
      prev.map((squad) => {
        if (!infantrySquads.some((item) => item.id === squad.id)) return squad;
        return {
          ...squad,
          slots: squad.slots.map((slot) => {
            if (!slotAssignments.has(slot.id)) return slot;
            return { ...slot, player: slotAssignments.get(slot.id) ?? null };
          }),
        };
      }),
    );
  };

  const movePoolToReserves = () => {
    const availablePlayers = pool.map(toAssigned);
    if (availablePlayers.length === 0) return;
    if (!confirm(`Move ${availablePlayers.length} available player${availablePlayers.length === 1 ? '' : 's'} to reserves?`)) {
      return;
    }
    setReserves((prev) => {
      const existing = new Set(prev.map((player) => player.discordId));
      return [
        ...prev,
        ...availablePlayers.filter((player) => !existing.has(player.discordId)),
      ];
    });
  };

  // ---- actions -------------------------------------------------------------
  const save = async () => {
    if (!event) return;
    if (slSlotCount > SL_MAX && !confirm(`This roster has ${slSlotCount} leadership slots (max ${SL_MAX}). Save anyway?`)) {
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await api<{ changes: { added: string[]; changed: string[]; removed: string[] } }>(
        `/roster/event/${eventId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            data: { squads, reserves },
            name: event.title,
            eventTitle: event.title,
            eventStartTime: event.startTime,
            channelId: event.channelId,
          }),
        },
      );
      setHasRoster(true);
      await loadSaved();
      setSavedLayoutKey(currentLayoutKey);
      const c = res.changes;
      const bits = [
        c.added.length ? `${c.added.length} added` : '',
        c.changed.length ? `${c.changed.length} moved` : '',
        c.removed.length ? `${c.removed.length} removed` : '',
      ].filter(Boolean);
      setStatus(bits.length ? `Saved — ${bits.join(', ')} (reset to pending).` : 'Roster saved.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const waitForRosterState = async (done: (saved: SavedRoster | null) => boolean) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const saved = await loadSaved();
      if (done(saved)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  const doAction = async (
    path: string,
    label: string,
    done?: (saved: SavedRoster | null) => boolean,
    body?: Record<string, unknown>,
  ) => {
    setBusy(true);
    setStatus(null);
    try {
      await api(`/roster/event/${eventId}/${path}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (done) await waitForRosterState(done);
      else await loadSaved();
      setStatus(label);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const postToDiscord = async () => {
    setPublishRoleDialogOpen(false);
    await doAction(
      'post',
      assignSquadLeaderRole
        ? 'Posted to Discord. Squad Leader role assignment requested.'
        : 'Posted to Discord.',
      (saved) => Boolean(saved?.messageId),
      { assignSquadLeaderRole },
    );
  };

  const cleanupSquadLeaderRole = async () => {
    if (!confirm('Remove the configured Squad Leader role from every Discord member?')) return;
    setBusy(true);
    setStatus(null);
    try {
      await api('/roster/cleanup-squad-leader-role', { method: 'POST' });
      setStatus('Squad Leader role cleanup requested.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Squad Leader role cleanup failed');
    } finally {
      setBusy(false);
    }
  };

  const assignSquadLeaderRoleManually = async () => {
    if (!confirm('Assign the configured Squad Leader role to all leadership positions in this saved roster?')) return;
    await doAction('assign-squad-leader-role', 'Squad Leader role assignment requested.');
  };

  // ---- counts --------------------------------------------------------------
  const totalSlots = squads.reduce((n, sq) => n + sq.slots.length, 0);
  const filledSlots = squads.reduce(
    (n, sq) => n + sq.slots.filter((s) => s.player).length,
    0,
  );
  // Squad-leader count: filled SL/spotter/tank commander/artillery slots over
  // the current roster's planned leadership slots. Commander is excluded.
  const slSlotKinds: SlotKind[] = ['squadLeader', 'spotter', 'tankCommander', 'artillery'];
  const slSlotCount = squads.reduce(
    (n, sq) => n + sq.slots.filter((s) => slSlotKinds.includes(s.kind)).length,
    0,
  );
  const slCount = squads.reduce(
    (n, sq) =>
      n + sq.slots.filter((s) => s.player && slSlotKinds.includes(s.kind)).length,
    0,
  );
  const slOver = slSlotCount > SL_MAX;
  const confirmed = confirmations.filter((c) => c.response === 'accepted').length;
  const declined = confirmations.filter((c) => c.response === 'declined').length;
  const pending = confirmations.length - confirmed - declined;
  const discordMessageExists = Boolean(rosterPostState.messageId);
  const hasSavedDiscordChanges = discordMessageExists && rosterPostState.status !== 'posted';
  const saveEnabled = !busy && hasUnsavedChanges;
  const postEnabled = !busy && hasRoster && !hasUnsavedChanges && !discordMessageExists;
  const updateVisible = hasSavedDiscordChanges;
  const updateEnabled = !busy && !hasUnsavedChanges && updateVisible;
  const remindPendingDisabled = busy || !hasRoster;

  // ---- render --------------------------------------------------------------
  if (loading) {
    return (
      <div className="animate-fade-in flex-1 p-1">
        <div className="card p-10 text-center text-sm text-zinc-500">Loading event…</div>
      </div>
    );
  }
  if (error || !event) {
    return (
      <div className="animate-fade-in flex-1 p-1">
        <div className="card border-red-500/20 bg-red-500/5 p-6 text-sm text-red-400">
          {error ?? 'Event not found'}
        </div>
        <Link href="/roster" className="btn btn-ghost btn-sm mt-4">
          ← Back to events
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <PageHeader title={event.title} description={`Build the roster · ${event.players.length} signed up`}>
        <Link href="/roster" className="btn btn-ghost btn-sm">
          ← Events
        </Link>
      </PageHeader>

      {/* action bar */}
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <button onClick={save} disabled={!saveEnabled} className="btn btn-primary btn-sm">
          Save roster
        </button>
        <button
          onClick={() => {
            setAssignSquadLeaderRole(false);
            setPublishRoleDialogOpen(true);
          }}
          disabled={!postEnabled}
          className="btn btn-ghost btn-sm"
        >
          Post to Discord
        </button>
        <button
          onClick={assignSquadLeaderRoleManually}
          disabled={busy || !hasRoster || hasUnsavedChanges}
          className="btn btn-ghost btn-sm text-emerald-300 hover:text-emerald-200"
          title="Assign the configured Squad Leader role to leadership positions in this roster"
        >
          Assign Squad Leader role
        </button>
        <button
          onClick={cleanupSquadLeaderRole}
          disabled={busy}
          className="btn btn-ghost btn-sm text-amber-300 hover:text-amber-200"
          title="Remove the configured temporary Squad Leader role from all Discord members"
        >
          Cleanup Squad Leader role
        </button>
        {updateVisible && (
          <button
            onClick={() => doAction('update-discord', 'Discord roster updated.', (saved) => saved?.status === 'posted')}
            disabled={!updateEnabled}
            className="btn btn-ghost btn-sm"
          >
            Update Discord
          </button>
        )}
        <button
          onClick={() => doAction('remind-pending', 'Reminder sent.')}
          disabled={remindPendingDisabled}
          className="btn btn-ghost btn-sm"
        >
          Remind pending
        </button>
        {hasUnsavedChanges && (
          <span className="text-xs text-amber-300">Save changes before Discord actions.</span>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          {hasRoster && (
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <ResponseIcon response="accepted" className="h-3.5 w-3.5" />
                {confirmed}
              </span>
              <span className="text-zinc-700">·</span>
              <span className="flex items-center gap-1">
                <ResponseIcon response="pending" className="h-3.5 w-3.5" />
                {pending}
              </span>
              <span className="text-zinc-700">·</span>
              <span className="flex items-center gap-1">
                <ResponseIcon response="declined" className="h-3.5 w-3.5" />
                {declined}
              </span>
            </span>
          )}
        </div>
        {status && <div className="w-full text-xs text-zinc-400">{status}</div>}
      </div>

      {publishRoleDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card w-full max-w-md p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-zinc-100">Post roster to Discord</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Would you like to assign the configured temporary Squad Leader role to commanders, artillery, spotters, tank commanders, and squad leaders?
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={assignSquadLeaderRole}
                onChange={(e) => setAssignSquadLeaderRole(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <span>
                Assign the Squad Leader role now
                <span className="mt-1 block text-xs text-zinc-500">It remains assigned until you use the manual cleanup button.</span>
              </span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPublishRoleDialogOpen(false)} className="btn btn-ghost btn-sm">
                Cancel
              </button>
              <button onClick={postToDiscord} className="btn btn-primary btn-sm">
                Post roster
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`grid gap-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden ${
          infantrySquadStats.length > 0
            ? 'lg:grid-cols-[300px_minmax(0,1fr)_280px]'
            : 'lg:grid-cols-[300px_minmax(0,1fr)]'
        }`}
      >
        {/* squads area */}
        <div className="flex min-w-0 flex-col lg:order-2 lg:min-h-0 lg:overflow-hidden lg:pr-1">
          <div className="card mb-3 shrink-0 p-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-white">
                  {filledSlots}
                  <span className="text-zinc-500">/{totalSlots}</span>
                </span>
                <span className="text-xs uppercase tracking-wide text-zinc-500">slots filled</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-bold ${slOver ? 'text-brand-bright' : 'text-white'}`}
                >
                  {slCount}
                  <span className="text-zinc-500">/{slSlotCount}</span>
                </span>
                <span className="text-xs uppercase tracking-wide text-zinc-500">squad leaders</span>
              </div>
              {slOver && (
                <span className="rounded-md bg-brand/20 px-2 py-1 text-xs font-medium text-brand-bright">
                  ⚠ Too many leadership slots — max {SL_MAX}
                </span>
              )}
              {rosterBalance.spread && (
                <span className={`rounded-md bg-white/[0.04] px-2 py-1 text-xs font-medium ${balanceTone(rosterBalance.spread.status)}`}>
                  Squad gap {rosterBalance.spread.status} · {rosterBalance.spread.difference}
                </span>
              )}
              {unsignedDiscordIds.size > 0 && (
                <span className="rounded-md bg-red-500/15 px-2 py-1 text-xs font-medium text-red-200">
                  {unsignedDiscordIds.size} unsigned/removed
                </span>
              )}
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="min-w-0">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Add squad
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SQUAD_TYPES.map((t) => (
                    <button
                      key={t.type}
                      onClick={() => addSquad(t.type)}
                      className="btn btn-ghost btn-sm gap-1.5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.icon} alt="" className="h-4 w-4 object-contain" />
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-w-0">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Drag role onto assigned player
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map((r) => (
                    <div
                      key={r.key}
                      draggable
                      onDragStart={(e) => {
                        dragRef.current = { kind: 'role', role: r };
                        e.dataTransfer.setData('text/plain', r.key);
                      }}
                      className="flex cursor-grab items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.06]"
                      title={r.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.icon} alt="" className="h-4 w-4 object-contain" />
                      {r.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {squads.length === 0 ? (
            <div className="card p-10 text-center text-sm text-zinc-500">
              No squads yet — add one above to start building.
            </div>
          ) : (
            <div className="space-y-2">
              {SQUAD_ROWS.map((types, rowIdx) => {
                const group = squads
                  .filter((s) => types.includes(s.type))
                  .sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type));
                if (group.length === 0) return null;
                return (
                  <div
                    key={rowIdx}
                    className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
                  >
                    {group.map((sq) => (
                      <div key={sq.id} className="card p-2">
                        <div className="mb-1.5 flex items-center gap-1">
                          <input
                            value={sq.name}
                            onChange={(e) => renameSquad(sq.id, e.target.value)}
                            title="Click to rename squad"
                            className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-semibold text-zinc-100 outline-none hover:bg-white/[0.04] focus:bg-white/[0.06] focus:text-white"
                          />
                          <OptionalToggles squad={sq} onToggle={toggleOptional} />
                          <button
                            onClick={() => removeSquad(sq.id)}
                            className="text-xs text-zinc-500 hover:text-red-400"
                            title="Remove squad"
                          >
                            ✕
                          </button>
                        </div>
                        <SquadControls
                          squad={sq}
                          onSetInfantry={setInfantryCounts}
                          onReset={resetSquad}
                        />
                        <div className="space-y-1">
                          {sq.slots.map((slot) => (
                            <SlotCell
                              key={slot.id}
                              slot={slot}
                              confResponse={
                                slot.player ? confByDiscord.get(slot.player.discordId) : undefined
                              }
                              isUnsigned={
                                slot.player ? unsignedDiscordIds.has(slot.player.discordId) : false
                              }
                              onDragStartPlayer={() => {
                                if (slot.player)
                                  dragRef.current = {
                                    kind: 'slot',
                                    squadId: sq.id,
                                    slotId: slot.id,
                                  };
                              }}
                              onDrop={() => onDropSlot(sq.id, slot.id)}
                              onRemovePlayer={() =>
                                slot.player && removeFromEverywhere(slot.player.discordId)
                              }
                              onRemoveRole={(key) => removeRole(sq.id, slot.id, key)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* reserves */}
          <div
            className="card mt-4 p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropReserves}
          >
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Reserves ({reserves.length})
            </div>
            {reserves.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 p-4 text-center text-xs text-zinc-600">
                Drag players here to keep them as reserves.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {reserves.map((p) => (
                  <div
                    key={p.discordId}
                    draggable
                    onDragStart={() => (dragRef.current = { kind: 'reserve', discordId: p.discordId })}
                    onDoubleClick={() => removeFromEverywhere(p.discordId)}
                    className={`flex cursor-grab items-center gap-1 rounded-md px-2 py-1 text-xs ${
                      unsignedDiscordIds.has(p.discordId)
                        ? 'border border-red-500/50 bg-red-500/15 text-red-100'
                        : 'bg-white/[0.04] text-zinc-300'
                    }`}
                    title={
                      unsignedDiscordIds.has(p.discordId)
                        ? 'UNSIGNED for this event. Double-click to remove'
                        : 'Double-click to remove'
                    }
                  >
                    {p.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>

        {infantrySquadStats.length > 0 && (
          <aside className="card p-3 lg:order-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Infantry balance
              </div>
              <button
                onClick={autoBalanceInfantry}
                disabled={
                  selectedBalanceCount === 1 ||
                  rosterBalance.squads.length < 2 ||
                  rosterBalance.assignedPlayers < 2
                }
                className="btn btn-ghost btn-sm"
              >
                {selectedBalanceCount > 0 ? `Balance ${selectedBalanceCount}` : 'Balance all'}
              </button>
            </div>
            <div className="mb-3 rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-500">
              <div className="flex items-center justify-between gap-2">
                <span>Avg 90m strength</span>
                <span className="font-semibold text-zinc-100">{rosterBalance.averageScore ?? '—'}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span>Scored players</span>
                <span className="font-semibold text-zinc-100">
                  {rosterBalance.scoredPlayers}/{rosterBalance.assignedPlayers}
                </span>
              </div>
              {rosterBalance.spread && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span>Squad gap</span>
                  <span className={`font-semibold ${balanceTone(rosterBalance.spread.status)}`}>
                    {rosterBalance.spread.difference}
                  </span>
                </div>
              )}
              {!rosterBalance.spread && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span>Squad gap</span>
                  <span className="font-semibold text-zinc-100">—</span>
                </div>
              )}
              <div className="mt-2 text-[11px] text-zinc-600">
                Select squads for auto-balance with the cards. Enable gap on two or more squads to compare them.
              </div>
              {selectedGapCount === 1 && (
                <div className="mt-2 text-zinc-500">
                  Add one more squad to show a gap.
                </div>
              )}
              {rosterBalance.warnings.map((warning) => (
                <div key={warning} className="mt-2 text-amber-300">
                  {warning}
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              {infantrySquadStats.map((squad) => (
                <div
                  key={squad.id}
                  onClick={() => toggleBalanceSquad(squad.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleBalanceSquad(squad.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`rounded-md border p-3 text-left transition ${
                    selectedBalanceSquadIds.has(squad.id)
                      ? 'border-brand/50 bg-brand/10 ring-1 ring-brand/30'
                      : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-100">
                      {squad.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <label
                        className="flex items-center gap-1 text-[10px] uppercase text-zinc-500"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={squadGapSquadIds.has(squad.id)}
                          onChange={() => toggleSquadGap(squad.id)}
                          className="h-3 w-3 rounded-full border-white/20 bg-zinc-950 text-brand focus:ring-brand/40"
                        />
                        Gap
                      </label>
                      <span className="text-[10px] uppercase text-zinc-600">
                        {squad.players} players
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-1 text-[11px] text-zinc-500">
                    <div className="flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1 text-zinc-400">
                      <span>Avg 90m strength</span>
                      <span className="font-semibold text-zinc-100" title={`${squad.averageScore.count} counted`}>
                        {squad.averageScore.value ?? '—'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[36px_1fr_1fr] items-center gap-2">
                      <span className="rounded bg-white/[0.04] px-1 text-center text-[10px] font-semibold text-zinc-400">
                        HLLR
                      </span>
                      <span className={kpmClass(squad.hllKpm.value)} title={`${squad.hllKpm.count} counted`}>
                        KPM {squad.hllKpm.value ?? '—'}
                      </span>
                      <span className={kdrClass(squad.hllKdr.value)} title={`${squad.hllKdr.count} counted`}>
                        KDR {squad.hllKdr.value ?? '—'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[36px_1fr_1fr] items-center gap-2">
                      <span className="rounded bg-brand/10 px-1 text-center text-[10px] font-semibold text-brand-bright">
                        DB
                      </span>
                      <span className={kpmClass(squad.matchKpm.value)} title={`${squad.matchKpm.count} counted`}>
                        KPM {squad.matchKpm.value ?? '—'}
                      </span>
                      <span className={kdrClass(squad.matchKdr.value)} title={`${squad.matchKdr.count} counted`}>
                        KDR {squad.matchKdr.value ?? '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* available players pool */}
        <div
          className="card flex max-h-[70vh] flex-col p-3 lg:order-1 lg:h-full lg:max-h-none lg:min-h-0"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropPool}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-zinc-100">Available ({pool.length})</span>
            <button
              onClick={movePoolToReserves}
              disabled={pool.length === 0}
              className="btn btn-ghost btn-sm shrink-0"
            >
              Reserve all
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className="mb-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/20"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="mb-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-white/20"
          >
            <option value="" className="bg-zinc-950 text-zinc-200">
              All classes
            </option>
            {roleOptions.map((role) => (
              <option key={role} value={role} className="bg-zinc-950 text-zinc-200">
                {prettyClassName(role)}
              </option>
            ))}
          </select>
          <div className="mb-2 flex flex-wrap gap-1 text-xs">
            {(
              [
                ['name', 'Name'],
                ['hllKpm', 'HLLR KPM'],
                ['hllKdr', 'HLLR KDR'],
                ['matchKpm', 'DB KPM'],
                ['matchKdr', 'DB KDR'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`rounded px-2 py-1 ${
                  sort === k ? 'bg-brand/20 text-brand-bright' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="-mr-1 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {pool.map((p) => (
              <div
                key={p.discordId}
                draggable
                onDragStart={() => (dragRef.current = { kind: 'pool', discordId: p.discordId })}
                className="cursor-grab rounded-md border border-white/10 bg-white/[0.03] p-2 hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-zinc-200">{p.name}</span>
                  {p.specName && (
                    <span className="shrink-0 text-[10px] uppercase text-zinc-600">
                      {p.specName}
                    </span>
                  )}
                </div>
                <div className="mt-1 grid gap-0.5 text-[11px] text-zinc-500">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="w-8 shrink-0 rounded bg-white/[0.04] px-1 text-center text-[10px] font-semibold text-zinc-400">
                      HLLR
                    </span>
                    <span className={kpmClass(p.hll?.kpm)} title="HLLRecords KPM">
                      KPM {p.hll?.kpm ?? '—'}
                    </span>
                    <span className={kdrClass(p.hll?.kdr)} title="HLLRecords KDR">
                      KDR {p.hll?.kdr ?? '—'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="w-8 shrink-0 rounded bg-brand/10 px-1 text-center text-[10px] font-semibold text-brand-bright">
                      DB
                    </span>
                    <span className={kpmClass(p.match?.kpm)} title="Database average KPM">
                      KPM {p.match?.kpm ?? '—'}
                    </span>
                    <span className={kdrClass(p.match?.kd)} title="Database average KDR">
                      KDR {p.match?.kd ?? '—'}
                    </span>
                    <span title="Database matches played">M {p.match?.matchesPlayed ?? '—'}</span>
                  </div>
                </div>
              </div>
            ))}
            {pool.length === 0 && (
              <div className="p-4 text-center text-xs text-zinc-600">No players.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SquadControls({
  squad,
  onSetInfantry,
  onReset,
}: {
  squad: Squad;
  onSetInfantry: (squadId: string, sl: number, inf: number) => void;
  onReset: (squadId: string) => void;
}) {
  const tpl = squadTemplate(squad.type);
  if (!tpl) return null;

  const hasPlayers = squad.slots.some((slot) => slot.player);
  const resetButton = (
    <button
      onClick={() => onReset(squad.id)}
      disabled={!hasPlayers}
      className="btn btn-ghost btn-sm h-6 px-2 text-[10px]"
    >
      Reset
    </button>
  );

  if (!tpl.configurable) {
    return <div className="mb-1.5 flex justify-end">{resetButton}</div>;
  }

  const slCount = squad.slots.filter((s) => s.kind === 'squadLeader').length;
  const infCount = squad.slots.filter((s) => s.kind === 'infantry').length;
  return (
    <div className="mb-1.5 grid min-w-0 gap-1">
      <Stepper
        label="Squad Leaders"
        shortLabel="SL"
        icon={SL_SLOT.icon}
        value={slCount}
        onChange={(v) => onSetInfantry(squad.id, v, infCount)}
      />
      <Stepper
        label="Infantry"
        shortLabel="Inf"
        icon={INF_SLOT.icon}
        value={infCount}
        onChange={(v) => onSetInfantry(squad.id, slCount, v)}
      />
      <div className="flex flex-wrap gap-1">
        {INFANTRY_PRESETS.map((preset) => {
          const active = slCount === preset.squadLeaders && infCount === preset.infantry;
          return (
            <button
              key={preset.label}
              onClick={() => onSetInfantry(squad.id, preset.squadLeaders, preset.infantry)}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold transition ${
                active
                  ? 'border-brand/50 bg-brand/20 text-brand-bright'
                  : 'border-white/10 bg-white/[0.03] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end">{resetButton}</div>
    </div>
  );
}

function OptionalToggles({
  squad,
  onToggle,
}: {
  squad: Squad;
  onToggle: (squadId: string, def: SlotDef) => void;
}) {
  const tpl = squadTemplate(squad.type);
  if (!tpl || tpl.optional.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {tpl.optional.map((def) => {
        const active = squad.slots.some((s) => s.kind === def.kind);
        return (
          <button
            key={def.kind}
            onClick={() => onToggle(squad.id, def)}
            className={`flex h-6 w-6 items-center justify-center rounded border transition-all ${
              active
                ? 'border-brand/40 bg-brand/20'
                : 'border-white/10 bg-white/[0.03] opacity-40 hover:opacity-100'
            }`}
            title={active ? `Remove ${def.label}` : `Add ${def.label}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={def.icon} alt={def.label} className="h-4 w-4 object-contain" />
          </button>
        );
      })}
    </div>
  );
}

function Stepper({
  label,
  shortLabel,
  icon,
  value,
  onChange,
}: {
  label: string;
  shortLabel: string;
  icon?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-1.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5">
      <div className="flex min-w-0 items-center gap-1" title={label}>
        {icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
        )}
        <span className="truncate text-[10px] font-semibold uppercase leading-none text-zinc-400">
          {shortLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-stretch overflow-hidden rounded border border-white/10">
        <button
          onClick={() => onChange(value - 1)}
          className="flex h-4 w-5 items-center justify-center bg-white/[0.04] text-[10px] leading-none text-zinc-300 hover:bg-white/[0.1] hover:text-white"
        >
          −
        </button>
        <span className="flex h-4 w-6 items-center justify-center border-x border-white/10 bg-white/[0.02] text-[11px] font-bold tabular-nums text-zinc-100">
          {value}
        </span>
        <button
          onClick={() => onChange(value + 1)}
          className="flex h-4 w-5 items-center justify-center bg-white/[0.04] text-[10px] leading-none text-zinc-300 hover:bg-white/[0.1] hover:text-white"
        >
          +
        </button>
      </div>
    </div>
  );
}

function SlotCell({
  slot,
  confResponse,
  isUnsigned,
  onDragStartPlayer,
  onDrop,
  onRemovePlayer,
  onRemoveRole,
}: {
  slot: Slot;
  confResponse?: string;
  isUnsigned: boolean;
  onDragStartPlayer: () => void;
  onDrop: () => void;
  onRemovePlayer: () => void;
  onRemoveRole: (key: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => {
        setOver(false);
        onDrop();
      }}
      className={`flex items-center gap-1.5 rounded border px-1.5 py-1 transition-colors ${
        over
          ? 'border-brand/50 bg-brand/10'
          : slot.player
            ? isUnsigned
              ? 'border-red-500/60 bg-red-500/15'
              : 'border-emerald-500/40 bg-emerald-500/10'
            : 'border-dashed border-white/10 bg-white/[0.02]'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={slot.icon} alt="" className="h-4 w-4 shrink-0 object-contain" title={slot.label} />
      {slot.player ? (
        <div
          draggable
          onDragStart={onDragStartPlayer}
          onDoubleClick={onRemovePlayer}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-1"
          title={isUnsigned ? 'UNSIGNED for this event. Double-click to remove' : 'Double-click to remove'}
        >
          {confResponse && <ResponseIcon response={confResponse} />}
          <span className={`truncate text-xs font-medium ${isUnsigned ? 'text-red-100' : 'text-white'}`}>
            {slot.player.name}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {slot.player.roles.map((r) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={r.key}
                src={r.icon}
                alt={r.name}
                title={`${r.name} — double-click to remove`}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onRemoveRole(r.key);
                }}
                className="h-3.5 w-3.5 cursor-pointer object-contain"
              />
            ))}
          </div>
        </div>
      ) : (
        <span className="flex-1 truncate text-[11px] text-zinc-600">{slot.label}</span>
      )}
    </div>
  );
}
