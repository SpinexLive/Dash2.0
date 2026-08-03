'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { PageHeader } from '../../components/PageHeader';
import {
  RefreshIcon,
  WarningIcon,
  CheckCircleIcon,
  DownloadIcon,
} from '../../components/icons';
import { Avatar } from '../../components/Avatar';

interface Member {
  id: string;
  serverNick: string;
  discordId: string;
  avatar: string | null;
  currentRoleId: string | null;
  isMember: boolean;
  rankRole: { id: string; name: string } | null;
  roleGroupNames: string[];
  gameAccounts: { platform: string; gameId: string; verified: boolean }[];
  stats: { kills: number; deaths: number; kd: number; kpm: number; matchesPlayed: number } | null;
  hllRecord: {
    kpm: number | null;
    kdr: number | null;
    duelStrength: number | null;
  } | null;
}

interface VacBanResult {
  memberId: string;
  steamId: string;
  vacBanned: boolean;
  vacBanCount: number;
  gameBanCount: number;
  daysSinceLastBan: number;
  communityBanned: boolean;
  economyBan: string;
  found: boolean;
}

interface VacBanCheckResponse {
  checkedAt: string;
  results: VacBanResult[];
}

type SortKey =
  | 'name'
  | 'kpm'
  | 'kd'
  | 'kills'
  | 'deaths'
  | 'hllKpm'
  | 'hllKdr'
  | 'hllDuel';

/** Epic IDs are 32-char hex; Steam IDs are numeric. */
const isEpicId = (id: string) => /^[0-9a-fA-F]{32}$/.test(id.trim());
const isSteamId = (id: string) => /^\d+$/.test(id.trim());

function accountsOf(m: Member) {
  const epic = m.gameAccounts.find((g) => g.platform === 'epic') ?? null;
  const steam = m.gameAccounts.find((g) => g.platform === 'steam') ?? null;
  // Epic is the player's visible identity; Steam is the hidden companion.
  const primary = epic ?? steam;
  return { epic, steam, primary };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [refreshingHllr, setRefreshingHllr] = useState(false);
  const [checkingVac, setCheckingVac] = useState(false);
  const [vacResults, setVacResults] = useState<Record<string, VacBanResult>>({});
  const [vacCheckedAt, setVacCheckedAt] = useState<string | null>(null);
  const [vacError, setVacError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [draft, setDraft] = useState('');
  const [steamDraft, setSteamDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [roleFilter, setRoleFilter] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [minKpm, setMinKpm] = useState(0);
  const [minKdr, setMinKdr] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    const data = await api<Member[]>('/members');
    setMembers(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh when a recruit is accepted (member.created event).
    const socket = getSocket();
    const onCreated = () => load();
    socket.on('member.created', onCreated);
    return () => {
      socket.off('member.created', onCreated);
    };
  }, [load]);

  async function sync() {
    setSyncing(true);
    setSyncStatus('syncing');
    setSyncMessage('Waiting for Discord to finish the member sync…');
    setError(null);
    try {
      const result = await api<{ ok: boolean; status: string; message?: string }>('/members/sync', {
        method: 'POST',
      });
      if (!result.ok) {
        throw new Error(result.message ?? 'Discord sync failed.');
      }
      await load();
      setSyncStatus('success');
      setSyncMessage('Discord sync completed.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Discord sync failed.';
      setSyncStatus('error');
      setSyncMessage(message);
    } finally {
      setSyncing(false);
    }
  }

  async function refreshHllRecords() {
    setRefreshingHllr(true);
    try {
      await api('/members/hllrecords/refresh', { method: 'POST' });
      // Scraping runs in the bot; give it a little time before reloading.
      setTimeout(() => {
        load();
        setRefreshingHllr(false);
      }, 5000);
    } catch {
      setRefreshingHllr(false);
    }
  }

  async function checkVacBans() {
    setCheckingVac(true);
    setVacError(null);
    try {
      const data = await api<VacBanCheckResponse>('/members/vac-bans/check', {
        method: 'POST',
      });
      setVacResults(
        Object.fromEntries(data.results.map((result) => [result.memberId, result])),
      );
      setVacCheckedAt(data.checkedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setVacError(
        message.includes('STEAM_WEB_API_KEY')
          ? 'Add STEAM_WEB_API_KEY to the API environment, then restart the API.'
          : 'Could not check VAC bans right now.',
      );
    } finally {
      setCheckingVac(false);
    }
  }

  function startEdit(m: Member) {
    const { primary, steam } = accountsOf(m);
    setEditing(m);
    setDraft(primary?.gameId ?? '');
    setSteamDraft(steam?.gameId ?? '');
    setError(null);
  }

  function closeEdit() {
    setEditing(null);
    setDraft('');
    setSteamDraft('');
    setError(null);
  }

  async function saveGameId() {
    if (!editing) return;
    const value = draft.trim();
    if (!value) {
      closeEdit();
      return;
    }
    const epic = isEpicId(value);
    const steam = steamDraft.trim();
    if (epic && !isSteamId(steam)) {
      setError('Epic players must also provide a valid numeric Steam ID.');
      return;
    }
    if (!epic && !isSteamId(value)) {
      setError('Enter a numeric Steam ID or a 32-character Epic ID.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/members/${editing.id}/game-account`, {
        method: 'PATCH',
        body: JSON.stringify(epic ? { gameId: value, steamId: steam } : { gameId: value }),
      });
      await load();
      setVacResults((current) => {
        const next = { ...current };
        delete next[editing.id];
        return next;
      });
      closeEdit();
    } catch {
      setError('Could not save. Please check the IDs and try again.');
    } finally {
      setSaving(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Names read best A→Z; stats read best highest-first.
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  function exportMembers() {
    const rows = [
      ['Discord ID', 'Discord Nickname', 'Steam ID', 'Epic ID'],
      ...sorted.map((member) => {
        const { epic, steam } = accountsOf(member);
        return [
          member.discordId,
          member.serverNick,
          steam?.gameId ?? '',
          epic?.gameId ?? '',
        ];
      }),
    ];
    const htmlRows = rows
      .map(
        (row, index) =>
          `<tr>${row
            .map((cell) => {
              const tag = index === 0 ? 'th' : 'td';
              return `<${tag} style="mso-number-format:'\\@';">${escapeHtml(cell)}</${tag}>`;
            })
            .join('')}</tr>`,
      )
      .join('');
    const workbook = `<!doctype html><html><head><meta charset="utf-8"></head><body><table>${htmlRows}</table></body></html>`;
    const blob = new Blob([workbook], {
      type: 'application/vnd.ms-excel;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `members-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const roleOptions = useMemo(() => {
    const byName = new Set<string>();
    for (const member of members) {
      member.roleGroupNames.forEach((name) => byName.add(name));
    }
    return [...byName].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [members]);

  const filtered = useMemo(() => {
    const normalizedQuery = nameQuery.trim().toLowerCase();
    return members.filter((member) => {
      const roleMatches = !roleFilter || member.roleGroupNames.includes(roleFilter);
      const nameMatches =
        normalizedQuery.length === 0 ||
        member.serverNick.toLowerCase().includes(normalizedQuery);
      const kpmMatches =
        minKpm === 0 ||
        (member.stats?.kpm ?? 0) >= minKpm ||
        (member.hllRecord?.kpm ?? 0) >= minKpm;
      const kdrMatches =
        minKdr === 0 ||
        (member.stats?.kd ?? 0) >= minKdr ||
        (member.hllRecord?.kdr ?? 0) >= minKdr;
      return roleMatches && nameMatches && kpmMatches && kdrMatches;
    });
  }, [members, roleFilter, nameQuery, minKpm, minKdr]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'name') {
        cmp = a.serverNick.localeCompare(b.serverNick, undefined, {
          sensitivity: 'base',
        });
      } else if (sortKey === 'hllKpm') {
        cmp = (a.hllRecord?.kpm ?? 0) - (b.hllRecord?.kpm ?? 0);
      } else if (sortKey === 'hllKdr') {
        cmp = (a.hllRecord?.kdr ?? 0) - (b.hllRecord?.kdr ?? 0);
      } else if (sortKey === 'hllDuel') {
        cmp =
          (a.hllRecord?.duelStrength ?? 0) - (b.hllRecord?.duelStrength ?? 0);
      } else {
        const k = sortKey as 'kpm' | 'kd' | 'kills' | 'deaths';
        cmp = (a.stats?.[k] ?? 0) - (b.stats?.[k] ?? 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const SortHeader = ({
    label,
    k,
    align = 'right',
    title,
  }: {
    label: string;
    k: SortKey;
    align?: 'left' | 'right';
    title?: string;
  }) => (
    <th className={align === 'right' ? 'text-right' : ''} title={title}>
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-zinc-200 ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${sortKey === k ? 'text-brand-bright' : ''}`}
      >
        {label}
        <span className="text-[9px] leading-none">
          {sortKey === k ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : '\u21C5'}
        </span>
      </button>
    </th>
  );

  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-col">
      <PageHeader
        title="Members"
        description="Click a Game ID to edit it."
      >
        <button
          onClick={checkVacBans}
          disabled={checkingVac}
          className="btn btn-ghost"
        >
          <RefreshIcon className={checkingVac ? 'animate-spin' : ''} />
          {checkingVac ? 'Checking...' : 'Check VAC Bans'}
        </button>
        <button
          onClick={refreshHllRecords}
          disabled={refreshingHllr}
          className="btn btn-ghost"
        >
          <RefreshIcon className={refreshingHllr ? 'animate-spin' : ''} />
          {refreshingHllr ? 'Refreshing...' : 'Refresh HLLR'}
        </button>
        <button onClick={sync} disabled={syncing} className="btn btn-ghost">
          <RefreshIcon className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync w/ Discord'}
        </button>
        <button
          onClick={exportMembers}
          disabled={loading || sorted.length === 0}
          className="btn btn-ghost"
          title="Export shown members as an Excel-compatible .xls file"
        >
          <DownloadIcon />
          Export
        </button>
      </PageHeader>

      {syncStatus !== 'idle' && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${syncStatus === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : syncStatus === 'error' ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : 'border-brand/20 bg-brand/10 text-zinc-200'}`}
          aria-live="polite"
        >
          {syncStatus === 'syncing' ? '⏳ ' : syncStatus === 'success' ? '✓ ' : '⚠ '}
          {syncMessage}
        </div>
      )}

      <div className="card flex min-h-0 flex-1 flex-col overflow-auto">
        {loading ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            Loading members…
          </div>
        ) : members.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            No members yet. Set the member role in Settings, then click{' '}
            <span className="text-zinc-300">Sync from Discord</span>.
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex flex-wrap items-end gap-4 border-b border-white/5 bg-zinc-900/40 p-4 backdrop-blur">
              <label className="min-w-56 flex-1">
                <span className="label">Search by name</span>
                <input
                  className="input"
                  type="search"
                  placeholder="Type a name"
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                />
              </label>

              <label className="min-w-56 flex-1">
                <span className="label">Role</span>
                <select
                  className="input"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="">All roles</option>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              <StatSlider
                label="Min KPM"
                value={minKpm}
                min={0}
                max={3}
                step={0.05}
                onChange={setMinKpm}
              />
              <StatSlider
                label="Min KDR"
                value={minKdr}
                min={0}
                max={10}
                step={0.1}
                onChange={setMinKdr}
              />

              <div className="ml-auto text-right text-xs text-zinc-500">
                <div className="font-medium text-zinc-300">
                  {sorted.length} / {members.length}
                </div>
                shown
                {vacCheckedAt && (
                  <div title={new Date(vacCheckedAt).toLocaleString()}>
                    VAC checked {new Date(vacCheckedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
              {vacError && (
                <div className="basis-full text-right text-xs text-red-400">
                  {vacError}
                </div>
              )}
            </div>

            {sorted.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500">
                No members match the current filters.
              </div>
            ) : (
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Member" k="name" align="left" />
                <th>Game ID</th>
                <SortHeader label="KPM" k="kpm" />
                <SortHeader label="K/D" k="kd" />
                <SortHeader label="Kills" k="kills" />
                <SortHeader label="Deaths" k="deaths" />
                <SortHeader
                  label="HLLR KPM"
                  k="hllKpm"
                  title="HLLRecords kills per minute (last 90 days)"
                />
                <SortHeader
                  label="HLLR KDR"
                  k="hllKdr"
                  title="HLLRecords kill/death ratio (last 90 days)"
                />
                <SortHeader
                  label="Duel Str"
                  k="hllDuel"
                  title="HLLRecords Duel strength — infantry kill ELO (last 90 days)"
                />
                <th className="text-center">VAC Bans</th>
                <th className="text-center">Role</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar
                        discordId={m.discordId}
                        avatar={m.avatar}
                        name={m.serverNick}
                      />
                      {(() => {
                        const { primary } = accountsOf(m);
                        const steamId =
                          primary && isSteamId(primary.gameId)
                            ? primary.gameId
                            : null;
                        return (
                          <div className="min-w-0">
                            <Link
                              href={`/members/${m.id}`}
                              className="block truncate font-medium text-zinc-100 transition-colors hover:text-brand-bright hover:underline"
                            >
                              {m.serverNick}
                            </Link>
                            {steamId && (
                              <a
                                href={`https://hllrecords.com/profiles/${steamId}?period=90d`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View HLLRecords profile"
                                className="text-[11px] text-zinc-600 transition-colors hover:text-zinc-300"
                              >
                                HLLRecords
                              </a>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const { epic, steam, primary } = accountsOf(m);
                      return (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => startEdit(m)}
                            title="Click to edit game ID"
                            className="rounded px-2 py-1 font-mono text-xs text-zinc-300 transition-colors hover:bg-white/5 hover:text-brand-bright"
                          >
                            {primary?.gameId ?? '— add —'}
                          </button>
                          {epic &&
                            (steam ? (
                              <span title="Epic linked with a Steam ID">
                                <CheckCircleIcon
                                  width={15}
                                  height={15}
                                  className="text-emerald-400"
                                />
                              </span>
                            ) : (
                              <span title="Epic player missing a Steam ID">
                                <WarningIcon
                                  width={15}
                                  height={15}
                                  className="text-amber-400"
                                />
                              </span>
                            ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="text-right tabular-nums">{m.stats?.kpm ?? 0}</td>
                  <td className="text-right font-medium tabular-nums text-zinc-100">
                    {m.stats?.kd ?? 0}
                  </td>
                  <td className="text-right tabular-nums">{m.stats?.kills ?? 0}</td>
                  <td className="text-right tabular-nums">{m.stats?.deaths ?? 0}</td>
                  <td className="text-right tabular-nums">
                    {m.hllRecord?.kpm ?? '—'}
                  </td>
                  <td className="text-right tabular-nums">
                    {m.hllRecord?.kdr ?? '—'}
                  </td>
                  <td className="text-right font-medium tabular-nums text-zinc-100">
                    {m.hllRecord?.duelStrength ?? '—'}
                  </td>
                  <td className="text-center">
                    <VacBanCell
                      member={m}
                      result={vacResults[m.id]}
                      checked={Boolean(vacCheckedAt)}
                    />
                  </td>
                  <td className="text-center">
                    {m.roleGroupNames.length > 0 ? (
                      <div className="flex flex-wrap justify-center gap-1">
                        {m.roleGroupNames.map((roleName) => (
                          <span key={roleName} className="badge bg-brand/15 text-brand-bright">
                            {roleName}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="badge bg-zinc-500/10 text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            )}
          </>
        )}
      </div>

      {mounted &&
        editing &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
            onClick={closeEdit}
          >
          <div
            className="card w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-3">
              <Avatar
                discordId={editing.discordId}
                avatar={editing.avatar}
                name={editing.serverNick}
                size={40}
              />
              <div>
                <div className="font-semibold text-zinc-100">
                  {editing.serverNick}
                </div>
                <div className="text-xs text-zinc-500">Edit game ID</div>
              </div>
            </div>

            <label className="label" htmlFor="game-id-input">
              Game ID
            </label>
            <input
              id="game-id-input"
              autoFocus
              className="input font-mono"
              placeholder="Steam ID / Epic ID"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveGameId();
                if (e.key === 'Escape') closeEdit();
              }}
            />
            <p className="mt-1 text-xs text-zinc-500">
              Numeric = Steam · 32-char hex = Epic
            </p>

            {isEpicId(draft) && (
              <div className="mt-4">
                <label className="label" htmlFor="steam-id-input">
                  Steam ID <span className="text-amber-400">(required for Epic)</span>
                </label>
                <input
                  id="steam-id-input"
                  className="input font-mono"
                  placeholder="76561198…"
                  value={steamDraft}
                  onChange={(e) => setSteamDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveGameId();
                    if (e.key === 'Escape') closeEdit();
                  }}
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Stored for automated extraction. Hidden from the table.
                </p>
              </div>
            )}

            {error && (
              <p className="mt-3 text-xs text-red-400">{error}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={closeEdit} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={saveGameId}
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
    </div>
  );
}

function StatSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="min-w-56 flex-1">
      <span className="label">{label}</span>
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 min-w-0 flex-1 accent-brand"
        />
        <span className="w-12 text-right text-sm tabular-nums text-zinc-200">
          {value === 0 ? 'Any' : value.toFixed(step < 0.1 ? 2 : 1)}
        </span>
      </div>
    </label>
  );
}

function VacBanCell({
  member,
  result,
  checked,
}: {
  member: Member;
  result?: VacBanResult;
  checked: boolean;
}) {
  const { epic, primary } = accountsOf(member);
  if (epic) {
    return <span className="text-xs text-zinc-500">Ignored</span>;
  }
  if (!primary || !isSteamId(primary.gameId)) {
    return <span className="text-xs text-zinc-500">—</span>;
  }
  if (!checked) {
    return <span className="text-xs text-zinc-500">Not checked</span>;
  }
  if (!result?.found) {
    return <span className="badge bg-zinc-500/10 text-zinc-400">Unknown</span>;
  }

  const hasBan =
    result.vacBanned ||
    result.vacBanCount > 0 ||
    result.gameBanCount > 0 ||
    result.communityBanned ||
    result.economyBan !== 'none';
  const title = [
    `SteamID: ${result.steamId}`,
    `VAC bans: ${result.vacBanCount}`,
    `Game bans: ${result.gameBanCount}`,
    `Days since last ban: ${result.daysSinceLastBan}`,
    `Community banned: ${result.communityBanned ? 'yes' : 'no'}`,
    `Economy ban: ${result.economyBan}`,
  ].join('\n');

  return (
    <span
      title={title}
      className={
        hasBan
          ? 'badge bg-red-500/15 text-red-300'
          : 'badge bg-emerald-500/10 text-emerald-300'
      }
    >
      {hasBan ? `${result.vacBanCount} VAC / ${result.gameBanCount} Game` : 'Clean'}
    </span>
  );
}
