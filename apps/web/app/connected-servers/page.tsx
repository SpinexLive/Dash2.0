'use client';

import { useEffect, useState } from 'react';
import { api, apiUrl } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';
import { LinkIcon, RefreshIcon, TrashIcon } from '../../components/icons';

type ConnectedServer = {
  guildId: string;
  name: string;
  icon: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
  infantryLeaderRoleId: string | null;
  tankCommanderRoleId: string | null;
};
type Role = { id: string; name: string; position: number };
type Roster = { id: string; name: string; eventStartTime: string | null; eligible: number };
type SyncResult = {
  updated: number;
  unchanged: number;
  missing: number;
  failed: number;
  sourceMembers: number;
};

export default function ConnectedServersPage() {
  const [servers, setServers] = useState<ConnectedServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setServers(await api<ConnectedServer[]>('/connected-servers'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load connected servers.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const sync = async (server: ConnectedServer) => {
    setRunning(server.guildId); setMessage(null); setError(null);
    try {
      const result = await api<SyncResult>(`/connected-servers/${server.guildId}/sync-nicknames`, { method: 'POST' });
      setMessage(`${server.name}: ${result.updated} updated, ${result.unchanged} already matched, ${result.missing} not present, ${result.failed} could not be changed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nickname sync failed.');
    } finally { setRunning(null); }
  };

  const remove = async (server: ConnectedServer) => {
    if (!window.confirm(`Remove ${server.name} from nickname sync? The bot will remain installed in Discord.`)) return;
    setError(null);
    try { await api(`/connected-servers/${server.guildId}`, { method: 'POST' }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not remove server.'); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pb-8">
      <PageHeader title="Connected Servers" description="Keep member nicknames aligned with the primary dashboard directory." />
      <section className="rounded-xl border border-white/10 bg-zinc-900/50 p-6">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Add a Discord server</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">A server administrator must approve the bot install. The bot needs Manage Nicknames and must sit above members it should rename.</p>
          </div>
          <a href={`${apiUrl}/connected-servers/install`} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90"><LinkIcon /> Add server</a>
        </div>
      </section>
      {message && <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</p>}
      {error && <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      <section className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50">
        <div className="border-b border-white/10 px-6 py-4"><h2 className="font-semibold text-zinc-100">Nickname targets</h2></div>
        {loading ? <p className="px-6 py-8 text-sm text-zinc-500">Loading servers…</p> : servers.length === 0 ? <p className="px-6 py-8 text-sm text-zinc-500">No additional servers connected yet.</p> : (
          <div className="divide-y divide-white/10">
            {servers.map((server) => <ConnectedServerCard key={server.guildId} server={server} expanded={selected === server.guildId} onToggle={() => setSelected(selected === server.guildId ? null : server.guildId)} onSync={() => void sync(server)} onRemove={() => void remove(server)} running={running !== null} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function ConnectedServerCard({ server, expanded, onToggle, onSync, onRemove, running }: { server: ConnectedServer; expanded: boolean; onToggle: () => void; onSync: () => void; onRemove: () => void; running: boolean }) {
  const [roles, setRoles] = useState<Role[]>([]); const [rosters, setRosters] = useState<Roster[]>([]);
  const [infantry, setInfantry] = useState(server.infantryLeaderRoleId ?? ''); const [tank, setTank] = useState(server.tankCommanderRoleId ?? '');
  const [rosterId, setRosterId] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState<string | null>(null); const [missing, setMissing] = useState<{ name: string; position: string; role: string }[]>([]);
  useEffect(() => { if (!expanded) return; void Promise.all([api<Role[]>(`/connected-servers/${server.guildId}/roles`), api<Roster[]>(`/connected-servers/${server.guildId}/rosters`)]).then(([r, rs]) => { setRoles(r); setRosters(rs); }).catch((e) => setResult(e.message)); }, [expanded, server.guildId]);
  const save = async () => { setBusy(true); try { await api(`/connected-servers/${server.guildId}/role-mapping`, { method: 'POST', body: JSON.stringify({ infantryLeaderRoleId: infantry || null, tankCommanderRoleId: tank || null }) }); setResult('Role mapping saved.'); } catch (e) { setResult(e instanceof Error ? e.message : 'Could not save roles.'); } finally { setBusy(false); } };
  const assign = async () => { if (!rosterId) return; setBusy(true); setResult(null); setMissing([]); try { const r = await api<{ assigned: number; unchanged: number; failed: number; missing: { name: string; position: string; role: string }[] }>(`/connected-servers/${server.guildId}/rosters/${rosterId}/assign-roles`, { method: 'POST' }); setResult(`${r.assigned} assigned, ${r.unchanged} already assigned, ${r.failed} failed.`); setMissing(r.missing); } catch (e) { setResult(e instanceof Error ? e.message : 'Role assignment failed.'); } finally { setBusy(false); } };
  return <div className="px-6 py-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-zinc-100">{server.name}</p><p className="mt-1 text-xs text-zinc-500">ID: {server.guildId}{server.lastSyncedAt ? ` · Last nickname sync ${new Date(server.lastSyncedAt).toLocaleString()}` : ''}</p></div><div className="flex gap-2"><button onClick={onToggle} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-200">{expanded ? 'Close' : 'Configure roles'}</button><button onClick={onSync} disabled={running} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><RefreshIcon />Sync nicknames</button><button onClick={onRemove} disabled={running} aria-label={`Remove ${server.name}`} className="rounded-lg border border-white/10 p-2 text-zinc-400"><TrashIcon /></button></div></div>{expanded && <div className="mt-5 grid gap-5 border-t border-white/10 pt-5"><div className="grid gap-3 md:grid-cols-2"><label className="text-sm text-zinc-300">Infantry Leader role<select value={infantry} onChange={(e) => setInfantry(e.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-zinc-100"><option value="">Do not assign</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label className="text-sm text-zinc-300">Tank Commander role<select value={tank} onChange={(e) => setTank(e.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-zinc-100"><option value="">Do not assign</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div><button onClick={() => void save()} disabled={busy} className="w-fit rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-200">Save role mapping</button><div className="grid gap-3 md:grid-cols-[1fr_auto]"><select value={rosterId} onChange={(e) => setRosterId(e.target.value)} className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"><option value="">Choose roster to assign roles…</option>{rosters.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.eligible} eligible)</option>)}</select><button onClick={() => void assign()} disabled={busy || !rosterId} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Assigning…' : 'Assign roster roles'}</button></div>{result && <p className="text-sm text-zinc-300">{result}</p>}{missing.length > 0 && <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4"><p className="text-sm font-medium text-amber-200">Not in this connected server ({missing.length})</p><ul className="mt-2 space-y-1 text-sm text-amber-100/80">{missing.map((m, i) => <li key={`${m.name}-${i}`}>{m.name} — {m.position} ({m.role === 'tank' ? 'Tank Commander' : 'Infantry Leader'})</li>)}</ul></div>}</div>}</div>;
}
