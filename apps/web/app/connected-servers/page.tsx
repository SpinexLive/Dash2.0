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
};
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
            {servers.map((server) => (
              <div key={server.guildId} className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-medium text-zinc-100">{server.name}</p><p className="mt-1 text-xs text-zinc-500">ID: {server.guildId}{server.lastSyncedAt ? ` · Last synced ${new Date(server.lastSyncedAt).toLocaleString()}` : ' · Not synced yet'}</p></div>
                <div className="flex gap-2"><button onClick={() => void sync(server)} disabled={running !== null} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><RefreshIcon />{running === server.guildId ? 'Syncing…' : 'Sync nicknames'}</button><button onClick={() => void remove(server)} disabled={running !== null} aria-label={`Remove ${server.name}`} className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:border-red-400/40 hover:text-red-300 disabled:opacity-50"><TrashIcon /></button></div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
