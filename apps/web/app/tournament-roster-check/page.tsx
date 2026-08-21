'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { api } from '../../lib/api';

type CheckResult = {
  checkedMembers: number;
  sheetEntriesWithIds: number;
  missingMembers: { id: string; name: string; discordId: string; gameIds: string[] }[];
  missingIdentifiers: { row: number; name: string }[];
};

export default function TournamentRosterCheckPage() {
  const [sheetUrl, setSheetUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    api<{ tournamentRosterSheetUrl?: string | null }>('/settings')
      .then((settings) => setSheetUrl(settings.tournamentRosterSheetUrl ?? ''))
      .catch(() => undefined);
  }, []);

  async function check() {
    setChecking(true); setError(null); setResult(null);
    try {
      setResult(await api<CheckResult>('/members/tournament-roster-check', {
        method: 'POST', body: JSON.stringify({ sheetUrl }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the tournament roster.');
    } finally { setChecking(false); }
  }

  return <main className="animate-fade-in flex min-h-0 flex-1 flex-col overflow-y-auto">
    <PageHeader title="Tournament Roster Check" description="Match active members to a Google Sheet using game IDs only." />
    <section className="card max-w-4xl p-5">
      <label className="block text-sm font-medium text-zinc-200" htmlFor="sheet-url">Google Sheet link</label>
      <p className="mt-1 text-xs text-zinc-500">The link is saved after a successful check. The sheet must be viewable by anyone with the link.</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input id="sheet-url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-brand-bright" />
        <button onClick={() => void check()} disabled={!sheetUrl.trim() || checking} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{checking ? 'Checking…' : 'Check'}</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
    {result && <div className="mt-6 space-y-5">
      <p className="text-sm text-zinc-400">Checked {result.checkedMembers} active members against {result.sheetEntriesWithIds} sheet ID{result.sheetEntriesWithIds === 1 ? '' : 's'}.</p>
      <section className="card overflow-hidden"><h2 className="border-b border-white/10 px-5 py-4 text-sm font-semibold text-zinc-100">Members not found on the sheet ({result.missingMembers.length})</h2>{result.missingMembers.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-white/5 text-xs text-zinc-500"><tr><th className="px-3 py-2">Member</th><th className="px-3 py-2">Discord ID</th><th className="px-3 py-2">Stored game IDs</th></tr></thead><tbody className="divide-y divide-white/5">{result.missingMembers.map((member) => <tr key={member.id}><td className="px-3 py-2 text-zinc-100">{member.name}</td><td className="px-3 py-2 text-zinc-400">{member.discordId}</td><td className="px-3 py-2 font-mono text-xs text-zinc-400">{member.gameIds.join(', ') || 'No stored game ID'}</td></tr>)}</tbody></table></div> : <p className="px-5 py-4 text-sm text-zinc-500">Every active member has a matching game ID on the sheet.</p>}</section>
      <section className="card overflow-hidden"><h2 className="border-b border-white/10 px-5 py-4 text-sm font-semibold text-zinc-100">Sheet rows without a usable ID ({result.missingIdentifiers.length})</h2>{result.missingIdentifiers.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-white/5 text-xs text-zinc-500"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Name</th></tr></thead><tbody className="divide-y divide-white/5">{result.missingIdentifiers.map((row) => <tr key={row.row}><td className="px-3 py-2 text-zinc-400">{row.row}</td><td className="px-3 py-2 text-zinc-100">{row.name}</td></tr>)}</tbody></table></div> : <p className="px-5 py-4 text-sm text-zinc-500">Every named sheet row has an ID in columns B–D.</p>}</section>
    </div>}
  </main>;
}
