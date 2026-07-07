'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';
import { WarningIcon, CheckCircleIcon, RefreshIcon } from '../../components/icons';

interface Recruit {
  id: string;
  discordId: string;
  nickname: string;
  gameId: string | null;
  platform: 'steam' | 'epic' | null;
  hasStoredSteam: boolean;
  hasRankRole: boolean;
  roleCategory: 'recruit' | 'member' | 'competitive' | 'none';
  processed: boolean;
  status: 'pending' | 'accepted' | 'rejected';
  formerMember: boolean;
  postedAt: string;
  rawApplication: string | null;
}

export default function RecruitsPage() {
  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<Recruit[]>('/recruits');
    setRecruits(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refreshApplications() {
    setRefreshing(true);
    try {
      await api('/recruits/refresh', { method: 'POST' });
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function process(id: string) {
    setBusy(id);
    try {
      await api(`/recruits/${id}/process`, { method: 'POST' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(id: string) {
    setBusy(id);
    try {
      await api(`/recruits/${id}/reject`, { method: 'POST' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-col">
      <PageHeader
        title="Recruit Intake"
        description="Applications detected by the bot in the recruit channel. Process one to link its game ID to the member."
      >
        <button
          onClick={refreshApplications}
          disabled={refreshing}
          className="btn btn-ghost"
        >
          <RefreshIcon className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </PageHeader>

      <div className="card flex min-h-0 flex-1 flex-col overflow-auto">
        {loading ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            Loading applications…
          </div>
        ) : recruits.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            No applications detected. Make sure the recruit channel is set in
            Settings.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Discord ID</th>
                <th>Game ID</th>
                <th className="text-center">Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {recruits.map((r) => (
                <tr
                  key={r.id}
                  className={roleRowClass(r.roleCategory)}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-100">
                        {r.nickname}
                      </span>
                      <span
                        className={`badge ${roleBadgeClass(r.roleCategory)}`}
                        title={roleBadgeTitle(r.roleCategory)}
                      >
                        {roleBadgeLabel(r.roleCategory)}
                      </span>
                      {r.formerMember && (
                        <span
                          className="badge bg-amber-500/10 text-amber-400"
                          title="Previously a member — left the server or lost the member role"
                        >
                          Left / inactive
                        </span>
                      )}
                    </div>
                    {r.rawApplication && (
                      <button
                        onClick={() =>
                          setExpanded(expanded === r.id ? null : r.id)
                        }
                        className="mt-0.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                      >
                        {expanded === r.id ? 'Hide application' : 'View application'}
                      </button>
                    )}
                  </td>
                  <td className="font-mono text-xs text-zinc-400">
                    {r.discordId}
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-brand-bright">
                        {r.gameId ?? 'not detected'}
                      </span>
                      {r.platform === 'epic' &&
                        (r.hasStoredSteam ? (
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
                  </td>
                  <td className="text-center">
                    {r.status === 'rejected' ? (
                      <span className="badge bg-zinc-500/10 text-zinc-400">
                        Dismissed
                      </span>
                    ) : r.processed ? (
                      <span className="badge bg-emerald-500/10 text-emerald-400">
                        Processed
                      </span>
                    ) : (
                      <span className="badge bg-brand/15 text-brand-bright">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    {r.processed ? (
                      <span className="text-xs text-zinc-500">Already linked</span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => process(r.id)}
                          disabled={busy === r.id}
                          className="btn btn-primary"
                        >
                          {busy === r.id ? 'Processing…' : 'Process'}
                        </button>
                        <button
                          onClick={() => dismiss(r.id)}
                          disabled={busy === r.id}
                          className="btn btn-ghost"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {expanded && (
        <pre className="card mt-3 max-h-72 overflow-auto whitespace-pre-wrap p-4 text-xs text-zinc-400">
          {recruits.find((r) => r.id === expanded)?.rawApplication}
        </pre>
      )}
    </div>
  );
}

function roleRowClass(category: Recruit['roleCategory']) {
  if (category === 'member' || category === 'competitive') {
    return 'bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/20';
  }
  if (category === 'recruit') {
    return 'bg-amber-500/5 ring-1 ring-inset ring-amber-500/20';
  }
  return 'bg-red-500/5 ring-1 ring-inset ring-red-500/20';
}

function roleBadgeClass(category: Recruit['roleCategory']) {
  if (category === 'member' || category === 'competitive') {
    return 'bg-emerald-500/10 text-emerald-400';
  }
  if (category === 'recruit') return 'bg-amber-500/10 text-amber-400';
  return 'bg-red-500/10 text-red-400';
}

function roleBadgeLabel(category: Recruit['roleCategory']) {
  if (category === 'competitive') return 'Competitive';
  if (category === 'member') return 'Member';
  if (category === 'recruit') return 'Recruit';
  return 'No role';
}

function roleBadgeTitle(category: Recruit['roleCategory']) {
  if (category === 'competitive') return 'Has a selected competitive role';
  if (category === 'member') return 'Has a selected member rank role';
  if (category === 'recruit') return 'Has a selected recruit role';
  return 'Does not have any selected recruit, member, or competitive role';
}
