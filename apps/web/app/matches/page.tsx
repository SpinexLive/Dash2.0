'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';
import {
  PlusIcon,
  DownloadIcon,
  EyeIcon,
  LinkIcon,
  RefreshIcon,
  ShareIcon,
  TrashIcon,
} from '../../components/icons';

interface Match {
  id: string;
  playedAt: string | null;
  eventType: string | null;
  eventName: string | null;
  opponent: string | null;
  url: string | null;
  linkedCount: number;
}

interface PlayerStat {
  id: string;
  nickname: string;
  gameId: string;
  team: string | null;
  kills: number;
  deaths: number;
  kpm: number;
  kd: number;
}

const COMPETITIVE = ['ECL', 'HBL', 'Friendly'];
const WEEKLY = ['SLB', 'GH', 'MWF'];
const MATCH_FILTERS = ['All', 'Competitive', 'Weekly', 'Other'] as const;

type MatchFilter = (typeof MATCH_FILTERS)[number];

interface RefreshProgress {
  completed: number;
  total: number;
  failed: number;
  current: string | null;
}

const isCompetitive = (t: string) => COMPETITIVE.includes(t);
const isWeekly = (t: string) => WEEKLY.includes(t);

const matchCategory = (m: Match): Exclude<MatchFilter, 'All'> => {
  const type = m.eventType ?? '';
  if (isCompetitive(type)) return 'Competitive';
  if (isWeekly(type)) return 'Weekly';
  return 'Other';
};

const eventLabel = (m: Match) =>
  m.eventType === 'Other' ? m.eventName?.trim() || 'Event' : m.eventType ?? '—';

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const emptyForm = {
  playedAt: '',
  eventType: '',
  eventName: '',
  opponent: '',
  url: '',
};

export default function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [filter, setFilter] = useState<MatchFilter>('All');
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Add-match modal state
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-row action state
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [refreshProgress, setRefreshProgress] =
    useState<RefreshProgress | null>(null);

  // View-data modal state
  const [viewing, setViewing] = useState<Match | null>(null);
  const [stats, setStats] = useState<PlayerStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  // Delete confirmation state
  const [deleting, setDeleting] = useState<Match | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () =>
    api<Match[]>('/matches')
      .then((m) => setMatches(m ?? []))
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const filteredMatches = useMemo(
    () =>
      filter === 'All'
        ? matches
        : matches.filter((match) => matchCategory(match) === filter),
    [filter, matches],
  );

  const filterCounts = useMemo(
    () =>
      matches.reduce<Record<MatchFilter, number>>(
        (counts, match) => {
          counts.All += 1;
          counts[matchCategory(match)] += 1;
          return counts;
        },
        { All: 0, Competitive: 0, Weekly: 0, Other: 0 },
      ),
    [matches],
  );

  const refreshRunning = Boolean(
    refreshProgress && refreshProgress.completed < refreshProgress.total,
  );
  const refreshPercent = refreshProgress?.total
    ? Math.round((refreshProgress.completed / refreshProgress.total) * 100)
    : 0;

  const openAdd = () => {
    setForm(emptyForm);
    setFormError(null);
    setAdding(true);
  };
  const closeAdd = () => setAdding(false);

  const save = async () => {
    if (!form.eventType) {
      setFormError('Pick an event type.');
      return;
    }
    if (form.eventType === 'Other' && !form.eventName.trim()) {
      setFormError('Enter a name for the event.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api('/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playedAt: form.playedAt || null,
          eventType: form.eventType,
          eventName: form.eventType === 'Other' ? form.eventName : null,
          opponent: isCompetitive(form.eventType) ? form.opponent : null,
          url: form.url || null,
        }),
      });
      setAdding(false);
      await load();
    } catch {
      setFormError('Could not save the match.');
    } finally {
      setSaving(false);
    }
  };

  const extract = async (m: Match) => {
    setBusyId(m.id);
    setActionMsg(null);
    try {
      const res = await api<{ linkedCount: number }>(
        `/matches/${m.id}/extract`,
        { method: 'POST' },
      );
      setActionMsg(
        `Linked ${res?.linkedCount ?? 0} member(s) for ${eventLabel(m)}.`,
      );
      await load();
    } catch {
      setActionMsg('Extract failed — check the match URL is correct & public.');
    } finally {
      setBusyId(null);
    }
  };

  const refreshAllStats = async () => {
    const extractableMatches = matches.filter((m) => m.url);
    if (extractableMatches.length === 0) {
      setActionMsg('No matches have a CRCON URL to refresh.');
      setRefreshProgress(null);
      return;
    }

    let failed = 0;
    setActionMsg(null);
    setRefreshProgress({
      completed: 0,
      total: extractableMatches.length,
      failed: 0,
      current: null,
    });

    try {
      for (let index = 0; index < extractableMatches.length; index += 1) {
        const match = extractableMatches[index];
        setBusyId(match.id);
        setRefreshProgress({
          completed: index,
          total: extractableMatches.length,
          failed,
          current: eventLabel(match),
        });

        try {
          await api(`/matches/${match.id}/extract`, { method: 'POST' });
        } catch {
          failed += 1;
        }

        setRefreshProgress({
          completed: index + 1,
          total: extractableMatches.length,
          failed,
          current: null,
        });
      }

      await load();
      setActionMsg(
        failed === 0
          ? `Refreshed stats for ${extractableMatches.length} match(es).`
          : `Refreshed stats for ${extractableMatches.length - failed} match(es); ${failed} failed.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const share = async (m: Match) => {
    setBusyId(m.id);
    setActionMsg(null);
    try {
      await api(`/matches/${m.id}/share`, { method: 'POST' });
      setActionMsg(`Shared ${eventLabel(m)} to Discord.`);
    } catch {
      setActionMsg('Share failed — set a match channel in Settings first.');
    } finally {
      setBusyId(null);
    }
  };

  const openView = async (m: Match) => {
    setViewing(m);
    setStatsLoading(true);
    setStats([]);
    try {
      const s = await api<PlayerStat[]>(`/matches/${m.id}/stats`);
      setStats(s ?? []);
    } catch {
      setStats([]);
    } finally {
      setStatsLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/matches/${deleting.id}`, { method: 'DELETE' });
      setActionMsg(`Deleted ${eventLabel(deleting)}.`);
      setDeleting(null);
      await load();
    } catch {
      setActionMsg('Could not delete the match.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-col">
      <PageHeader
        title="Match History"
        description="Results from Weekly Events & Official matches."
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={refreshAllStats}
            disabled={loading || refreshRunning || matches.every((m) => !m.url)}
            className="btn btn-ghost gap-2"
          >
            <RefreshIcon width={16} height={16} />
            Refresh Stats
          </button>
          <button onClick={openAdd} className="btn btn-primary gap-2">
            <PlusIcon width={16} height={16} />
            Add Match
          </button>
        </div>
      </PageHeader>

      {refreshProgress && (
        <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span>
              {refreshRunning
                ? `Refreshing ${refreshProgress.current ?? 'match stats'}…`
                : 'Stats refresh complete.'}
            </span>
            <span className="font-mono text-xs text-zinc-500">
              {refreshProgress.completed}/{refreshProgress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-red-600 transition-all duration-300"
              style={{ width: `${refreshPercent}%` }}
            />
          </div>
          {refreshProgress.failed > 0 && (
            <p className="mt-2 text-xs text-amber-300">
              {refreshProgress.failed} match(es) failed so far.
            </p>
          )}
        </div>
      )}

      {actionMsg && (
        <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-300">
          {actionMsg}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {MATCH_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              filter === option
                ? 'border-red-600 bg-red-700 text-white shadow-[0_0_0_1px_rgba(220,38,38,0.35)]'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            }`}
          >
            {option}
            <span className="ml-2 text-xs opacity-70">
              {filterCounts[option]}
            </span>
          </button>
        ))}
      </div>

      <div className="card flex min-h-0 flex-1 flex-col overflow-auto">
        {loading ? (
          <div className="p-10 text-center text-sm text-zinc-500">Loading…</div>
        ) : matches.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            No matches recorded.
          </div>
        ) : filteredMatches.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            No {filter.toLowerCase()} matches recorded.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Opponent</th>
                <th>Date</th>
                <th>Linked</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium text-zinc-100">{eventLabel(m)}</td>
                  <td className="text-zinc-400">{m.opponent ?? '—'}</td>
                  <td className="text-zinc-400">{fmtDate(m.playedAt)}</td>
                  <td>
                    <span className="badge bg-zinc-500/10 text-zinc-300">
                      {m.linkedCount}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => extract(m)}
                        disabled={busyId === m.id || refreshRunning || !m.url}
                        className="icon-btn"
                        title={
                          m.url
                            ? m.linkedCount > 0
                              ? 'Re-extract stats from CRCON'
                              : 'Extract stats from CRCON'
                            : 'No URL set'
                        }
                      >
                        <DownloadIcon />
                      </button>
                      <button
                        onClick={() => openView(m)}
                        className="icon-btn"
                        title="View player stats"
                      >
                        <EyeIcon />
                      </button>
                      {m.url && (
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noreferrer"
                          className="icon-btn"
                          title="Open match page"
                        >
                          <LinkIcon />
                        </a>
                      )}
                      <button
                        onClick={() => share(m)}
                        disabled={busyId === m.id || refreshRunning}
                        className="icon-btn"
                        title="Share to Discord"
                      >
                        <ShareIcon />
                      </button>
                      <button
                        onClick={() => setDeleting(m)}
                        className="icon-btn icon-btn-danger"
                        title="Delete match"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add-match modal */}
      {mounted &&
        adding &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
            onClick={closeAdd}
          >
            <div
              className="card w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-lg font-semibold text-zinc-100">
                Add Match
              </h2>

              <label className="label" htmlFor="match-date">
                Date played
              </label>
              <input
                id="match-date"
                type="date"
                className="input"
                value={form.playedAt}
                onChange={(e) => setForm({ ...form, playedAt: e.target.value })}
              />

              <label className="label mt-4" htmlFor="match-event">
                Event
              </label>
              <select
                id="match-event"
                className="input"
                value={form.eventType}
                onChange={(e) =>
                  setForm({ ...form, eventType: e.target.value })
                }
              >
                <option value="" disabled>
                  Select event…
                </option>
                <optgroup label="Competitive">
                  {COMPETITIVE.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Weekly events">
                  {WEEKLY.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other">
                  <option value="Other">Other…</option>
                </optgroup>
              </select>

              {form.eventType === 'Other' && (
                <>
                  <label className="label mt-4" htmlFor="match-name">
                    Event name
                  </label>
                  <input
                    id="match-name"
                    className="input"
                    placeholder="e.g. Scrim vs [XYZ]"
                    value={form.eventName}
                    onChange={(e) =>
                      setForm({ ...form, eventName: e.target.value })
                    }
                  />
                </>
              )}

              {isCompetitive(form.eventType) && (
                <>
                  <label className="label mt-4" htmlFor="match-opponent">
                    Opponent
                  </label>
                  <input
                    id="match-opponent"
                    className="input"
                    placeholder="Enemy clan tag / name"
                    value={form.opponent}
                    onChange={(e) =>
                      setForm({ ...form, opponent: e.target.value })
                    }
                  />
                </>
              )}

              <label className="label mt-4" htmlFor="match-url">
                CRCON match URL
              </label>
              <input
                id="match-url"
                className="input font-mono text-xs"
                placeholder="http://…/games/1609"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
              <p className="mt-1 text-xs text-zinc-500">
                Used to pull player stats when you click Extract.
              </p>

              {formError && (
                <p className="mt-3 text-sm text-red-400">{formError}</p>
              )}

              <div className="mt-6 flex justify-end gap-2">
                <button onClick={closeAdd} className="btn btn-ghost">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* View-data modal */}
      {mounted &&
        viewing &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
            onClick={() => setViewing(null)}
          >
            <div
              className="card flex max-h-[80vh] w-full max-w-2xl flex-col p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-100">
                    {eventLabel(viewing)}
                    {viewing.opponent ? ` vs ${viewing.opponent}` : ''}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {fmtDate(viewing.playedAt)}
                  </p>
                </div>
                <button
                  onClick={() => setViewing(null)}
                  className="btn btn-ghost text-xs"
                >
                  Close
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {statsLoading ? (
                  <div className="p-8 text-center text-sm text-zinc-500">
                    Loading…
                  </div>
                ) : stats.length === 0 ? (
                  <div className="p-8 text-center text-sm text-zinc-500">
                    No linked players. Click Extract to pull stats.
                  </div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Kills</th>
                        <th>Deaths</th>
                        <th>K/D</th>
                        <th>KPM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((s) => (
                        <tr key={s.id}>
                          <td className="font-medium text-zinc-100">
                            {s.nickname}
                          </td>
                          <td>{s.kills}</td>
                          <td>{s.deaths}</td>
                          <td>{s.kd}</td>
                          <td>{s.kpm}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Delete confirmation modal */}
      {mounted &&
        deleting &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
            onClick={() => !deleteBusy && setDeleting(null)}
          >
            <div
              className="card w-full max-w-sm p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold text-zinc-100">
                Delete match?
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                This removes{' '}
                <span className="font-medium text-zinc-200">
                  {eventLabel(deleting)}
                  {deleting.opponent ? ` vs ${deleting.opponent}` : ''}
                </span>{' '}
                and all its linked player stats. This can’t be undone.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setDeleting(null)}
                  disabled={deleteBusy}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteBusy}
                  className="btn btn-danger gap-2"
                >
                  <TrashIcon width={16} height={16} />
                  {deleteBusy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
