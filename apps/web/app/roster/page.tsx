'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';

interface UpcomingEvent {
  id: string;
  title: string;
  startTime: number;
  channelId: string | null;
  signUpCount: number;
  leaderName: string | null;
  imageUrl: string | null;
  color: string | null;
}

function formatWhen(startTime: number): string {
  const d = new Date(startTime * 1000);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relative(startTime: number): string {
  const diff = startTime * 1000 - Date.now();
  const abs = Math.abs(diff);
  const h = Math.round(abs / 3_600_000);
  const d = Math.round(abs / 86_400_000);
  const label = d >= 1 ? `${d}d` : `${h}h`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export default function RosterEventsPage() {
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [withRosters, setWithRosters] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [evs, saved] = await Promise.all([
        api<UpcomingEvent[]>('/raidhelper/events'),
        api<string[]>('/roster/events-with-rosters'),
      ]);
      setEvents(evs);
      setWithRosters(new Set(saved));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="animate-fade-in min-h-0 flex-1 overflow-y-auto">
      <PageHeader
        title="Roster Tool"
        description="Pick a RaidHelper event to build its match roster."
      >
        <button onClick={load} className="btn btn-ghost btn-sm">
          Refresh
        </button>
      </PageHeader>

      {error && (
        <div className="card mb-4 border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-sm text-zinc-500">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="card p-10 text-center text-sm text-zinc-500">
          No upcoming events found.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {events.map((ev) => {
            const hasRoster = withRosters.has(ev.id);
            return (
              <Link
                key={ev.id}
                href={`/roster/${ev.id}`}
                className="card group flex flex-col overflow-hidden transition hover:border-brand/40 hover:bg-white/[0.02]"
              >
                {ev.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ev.imageUrl}
                    alt=""
                    className="h-28 w-full object-cover opacity-90 transition group-hover:opacity-100"
                  />
                )}
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-tight text-zinc-100">{ev.title}</h3>
                    {hasRoster && (
                      <span className="badge shrink-0 bg-emerald-500/10 text-emerald-400">
                        Roster
                      </span>
                    )}
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-2 text-xs text-zinc-500">
                    <span>
                      {formatWhen(ev.startTime)} · {relative(ev.startTime)}
                    </span>
                    <span className="text-zinc-400">{ev.signUpCount} signed</span>
                  </div>
                  {ev.leaderName && (
                    <div className="mt-1 text-xs text-zinc-600">Lead: {ev.leaderName}</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
