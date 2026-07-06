'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';

interface RosterOption {
  id: string;
  name: string;
  eventTitle: string | null;
  eventStartTime: string | null;
  updatedAt: string;
}

interface LayoutPlayer {
  discordId?: string;
  name?: string;
  avatar?: string | null;
}

interface AssignedBriefingPlayer extends LayoutPlayer {
  position: string;
}

interface LayoutSlot {
  label?: string;
  icon?: string;
  player?: LayoutPlayer | null;
}

interface LayoutSquad {
  id?: string;
  name?: string;
  type?: string;
  slots?: LayoutSlot[];
}

interface RosterDetail {
  id: string;
  name: string;
  eventTitle: string | null;
  eventStartTime: string | null;
  data: { squads?: LayoutSquad[] } | null;
  confirmations: { discordId: string | null; response: string }[];
}

type Attendance = Record<string, boolean>;

const RESPONSE_ICON: Record<string, string> = {
  accepted: '/icons/accept.png',
  declined: '/icons/decline.png',
  pending: '/icons/pending.png',
};

export default function BriefingPage() {
  const [rosters, setRosters] = useState<RosterOption[]>([]);
  const [selectedRosterId, setSelectedRosterId] = useState('');
  const [roster, setRoster] = useState<RosterDetail | null>(null);
  const [voiceAttendance, setVoiceAttendance] = useState<Attendance>({});
  const [gameAttendance, setGameAttendance] = useState<Attendance>({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<'voice' | 'game' | null>(null);
  const [creatingChannels, setCreatingChannels] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api<RosterOption[]>('/briefing/rosters')
      .then(setRosters)
      .catch(() => setRosters([]))
      .finally(() => setLoading(false));
  }, []);

  async function loadRoster(rosterId: string) {
    setSelectedRosterId(rosterId);
    setVoiceAttendance({});
    setGameAttendance({});
    setStatus(null);
    if (!rosterId) {
      setRoster(null);
      return;
    }
    const data = await api<RosterDetail | null>(`/briefing/rosters/${rosterId}`);
    setRoster(data);
  }

  const squads = useMemo(
    () => (Array.isArray(roster?.data?.squads) ? roster.data.squads : []),
    [roster],
  );

  const confirmationByDiscord = useMemo(
    () => new Map((roster?.confirmations ?? []).map((c) => [c.discordId ?? '', c.response])),
    [roster],
  );

  const assignedPlayers = useMemo(() => {
    const players: AssignedBriefingPlayer[] = [];
    for (const squad of squads) {
      for (const slot of squad.slots ?? []) {
        if (slot.player?.discordId) {
          players.push({
            ...slot.player,
            position: `${squad.name ?? 'Squad'} - ${slot.label ?? 'Slot'}`,
          });
        }
      }
    }
    return players;
  }, [squads]);

  const voiceChecked = Object.keys(voiceAttendance).length > 0;
  const gameChecked = Object.keys(gameAttendance).length > 0;
  const missingVoice = useMemo(
    () => (voiceChecked ? assignedPlayers.filter((player) => player.discordId && voiceAttendance[player.discordId] === false) : []),
    [assignedPlayers, voiceAttendance, voiceChecked],
  );
  const missingGame = useMemo(
    () => (gameChecked ? assignedPlayers.filter((player) => player.discordId && gameAttendance[player.discordId] === false) : []),
    [assignedPlayers, gameAttendance, gameChecked],
  );

  async function checkAttendance(kind: 'voice' | 'game') {
    if (!assignedPlayers.length) return;
    setChecking(kind);
    setStatus(null);
    try {
      const discordIds = assignedPlayers
        .map((player) => player.discordId)
        .filter((id): id is string => Boolean(id));
      const data = await api<Attendance>(`/briefing/check-${kind}`, {
        method: 'POST',
        body: JSON.stringify({ discordIds }),
      });
      if (kind === 'voice') setVoiceAttendance(data);
      else setGameAttendance(data);
      setStatus(kind === 'voice' ? 'Voice attendance checked.' : 'Game server checked.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : `Failed to check ${kind}.`);
    } finally {
      setChecking(null);
    }
  }

  async function createVoiceChannels() {
    setCreatingChannels(true);
    setStatus(null);
    try {
      const result = await api<{ queued: boolean; created: number; message?: string }>('/briefing/voice-channels', {
        method: 'POST',
      });
      setStatus(result.queued ? `${result.created} voice channel${result.created === 1 ? '' : 's'} queued.` : result.message ?? 'Voice channels were not queued.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to create voice channels.');
    } finally {
      setCreatingChannels(false);
    }
  }

  const totalAssigned = assignedPlayers.length;

  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Briefing Manager"
        description="Select a saved roster and check voice or game attendance."
      />

      <div className="grid shrink-0 gap-3 md:grid-cols-5">
        <div className="card p-3 md:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Select Roster</span>
              <select
                className="input"
                value={selectedRosterId}
                disabled={loading}
                onChange={(e) => loadRoster(e.target.value)}
              >
                <option value="">Select a roster...</option>
                {rosters.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-1 text-xs font-medium text-zinc-500">Details</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Event</span>
                  <span className="truncate text-zinc-100">{roster?.eventTitle ?? roster?.name ?? '-'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Members</span>
                  <span className="text-zinc-100">{totalAssigned}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-3 md:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <button
              disabled={!roster || checking !== null}
              onClick={() => checkAttendance('voice')}
              className="btn btn-primary flex-1"
            >
              {checking === 'voice' ? 'Checking...' : 'Voice'}
            </button>
            <button
              disabled={!roster || checking !== null}
              onClick={() => checkAttendance('game')}
              className="btn btn-ghost flex-1"
            >
              {checking === 'game' ? 'Checking...' : 'Game'}
            </button>
            <button
              disabled={creatingChannels}
              onClick={createVoiceChannels}
              className="btn btn-ghost flex-1"
            >
              {creatingChannels ? 'Creating...' : 'Create Voice Channels'}
            </button>
          </div>
          {status && <p className="mt-2 text-xs text-zinc-500">{status}</p>}
        </div>
      </div>

      <div className="mt-3 grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-white/5 p-3">
            <h2 className="text-sm font-semibold text-zinc-100">Roster Attendance</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!roster ? (
              <div className="py-12 text-center text-sm text-zinc-500">Select a roster to begin.</div>
            ) : squads.length === 0 ? (
              <div className="py-12 text-center text-sm text-zinc-500">No squads found in this roster.</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {squads.map((squad, index) => (
                  <div key={squad.id ?? `${squad.name}-${index}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                    <h3 className="mb-2 px-1 text-xs font-semibold text-zinc-100">
                      {squad.name ?? 'Squad'}
                    </h3>
                    <div className="space-y-1">
                      {(squad.slots ?? []).map((slot, slotIndex) => (
                        <BriefingSlot
                          key={`${slot.label}-${slotIndex}`}
                          slot={slot}
                          response={slot.player?.discordId ? confirmationByDiscord.get(slot.player.discordId) : undefined}
                          inVoice={slot.player?.discordId ? voiceAttendance[slot.player.discordId] : undefined}
                          inGame={slot.player?.discordId ? gameAttendance[slot.player.discordId] : undefined}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/15">
          <div className="shrink-0 border-b border-white/5 px-3 py-2">
            <h2 className="text-sm font-semibold text-zinc-100">Missing Players</h2>
          </div>
          <div className="grid min-h-0 flex-1 gap-2 p-2 sm:grid-cols-2 xl:grid-cols-1">
            <MissingPlayersList
              title="Not in Voice"
              checked={voiceChecked}
              players={missingVoice}
            />
            <MissingPlayersList
              title="Not in Game"
              checked={gameChecked}
              players={missingGame}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function MissingPlayersList({
  title,
  checked,
  players,
}: {
  title: string;
  checked: boolean;
  players: AssignedBriefingPlayer[];
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-white/10 bg-zinc-950/30">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5">
        <h3 className="text-xs font-semibold uppercase text-zinc-500">{title}</h3>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
          {checked ? players.length : '-'}
        </span>
      </div>
      {!checked ? (
        <div className="p-2 text-xs text-zinc-600">
          Not checked.
        </div>
      ) : players.length === 0 ? (
        <div className="p-2 text-xs text-emerald-400">
          All present.
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
          {players.map((player) => (
            <div
              key={`${title}-${player.discordId}`}
              className="truncate rounded bg-red-500/10 px-2 py-1 text-xs font-medium text-zinc-100"
              title={player.name ?? 'Unknown'}
            >
              {player.name ?? 'Unknown'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BriefingSlot({
  slot,
  response,
  inVoice,
  inGame,
}: {
  slot: LayoutSlot;
  response?: string;
  inVoice?: boolean;
  inGame?: boolean;
}) {
  const player = slot.player;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-black/20 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {slot.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slot.icon} alt="" className="h-4 w-4 shrink-0 object-contain" />
        )}
        {player ? (
          <>
            <span className="truncate text-xs font-medium text-zinc-100">{player.name ?? 'Unknown'}</span>
            {response && RESPONSE_ICON[response] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={RESPONSE_ICON[response]} alt={response} title={response} className="h-3.5 w-3.5 shrink-0 object-contain" />
            )}
          </>
        ) : (
          <span className="truncate text-xs text-zinc-600">{slot.label ?? 'Empty'}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <PresenceButton label="Voice" value={inVoice} />
        <PresenceButton label="Game" value={inGame} />
      </div>
    </div>
  );
}

function PresenceButton({ label, value }: { label: string; value?: boolean }) {
  const color =
    value === undefined
      ? 'border-zinc-600 bg-zinc-700'
      : value
        ? 'border-emerald-400 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]'
        : 'border-red-500/60 bg-red-500/40';
  return <span title={label} className={`h-3.5 w-3.5 rounded-full border ${color}`} />;
}
