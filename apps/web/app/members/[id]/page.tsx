'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '../../../lib/api';
import { Avatar } from '../../../components/Avatar';
import { PageHeader } from '../../../components/PageHeader';

interface MemberProfile {
  id: string;
  discordId: string;
  username: string;
  serverNick: string;
  avatar: string | null;
  isMember: boolean;
  rankRole: { id: string; name: string } | null;
  joinedAt: string;
  gameAccounts: { platform: string; gameId: string; verified: boolean; linkedAt: string }[];
  stats: {
    totalKills: number;
    totalDeaths: number;
    avgKills: number;
    avgDeaths: number;
    kpm: number;
    kd: number;
    matchesPlayed: number;
  };
  hllRecord: {
    kpm: number | null;
    kdr: number | null;
    duelStrength: number | null;
    fetchedAt: string;
  } | null;
  recentMatches: {
    id: string;
    matchId: string;
    map: string | null;
    result: string | null;
    playedAt: string | null;
    eventType: string | null;
    eventName: string | null;
    opponent: string | null;
    team: string | null;
    kills: number;
    deaths: number;
    kd: number;
    kpm: number;
  }[];
  rosterHistory: {
    id: string;
    rosterId: string;
    raidhelperEventId: string | null;
    eventTitle: string | null;
    eventStartTime: string | null;
    position: string | null;
    response: 'pending' | 'accepted' | 'declined';
    respondedAt: string | null;
    status: string;
  }[];
}

function formatDate(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function formatDateTime(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function accountLabel(platform: string) {
  return platform === 'steam' ? 'Steam' : platform === 'epic' ? 'Epic' : platform;
}

export default function MemberProfilePage() {
  const params = useParams<{ id: string }>();
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api<MemberProfile>(`/members/${params.id}`);
        if (active) setMember(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load member');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [params.id]);

  if (loading) {
    return (
      <div className="animate-fade-in flex-1 p-1">
        <div className="card p-10 text-center text-sm text-zinc-500">Loading member...</div>
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="animate-fade-in flex-1 p-1">
        <div className="card border-red-500/20 bg-red-500/5 p-6 text-sm text-red-400">
          {error ?? 'Member not found'}
        </div>
        <Link href="/members" className="btn btn-ghost btn-sm mt-4">
          Back to members
        </Link>
      </div>
    );
  }

  const steam = member.gameAccounts.find((account) => account.platform === 'steam');

  return (
    <div className="animate-fade-in min-h-0 flex-1 overflow-y-auto">
      <PageHeader title={member.serverNick} description="Member profile">
        <Link href="/members" className="btn btn-ghost btn-sm">
          Back to members
        </Link>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="card p-5">
            <div className="flex items-center gap-4">
              <Avatar
                discordId={member.discordId}
                avatar={member.avatar}
                name={member.serverNick}
                size={64}
              />
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold text-zinc-100">{member.serverNick}</h2>
                <div className="truncate text-sm text-zinc-500">@{member.username}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="badge bg-emerald-500/10 text-emerald-400">
                    {member.isMember ? 'Active' : 'Inactive'}
                  </span>
                  {member.rankRole && (
                    <span className="badge bg-brand/15 text-brand-bright">
                      {member.rankRole.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3 text-sm">
              <ProfileField label="Joined" value={formatDate(member.joinedAt)} />
              <ProfileField label="Discord ID" value={member.discordId} mono />
            </div>
          </section>

          <section className="card p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Game Accounts
            </h3>
            <div className="space-y-2">
              {member.gameAccounts.length === 0 ? (
                <div className="text-sm text-zinc-500">No linked game accounts.</div>
              ) : (
                member.gameAccounts.map((account) => (
                  <div
                    key={`${account.platform}-${account.gameId}`}
                    className="rounded-md border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-200">
                        {accountLabel(account.platform)}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {account.verified ? 'Verified' : 'Unverified'}
                      </span>
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-zinc-400">
                      {account.gameId}
                    </div>
                  </div>
                ))
              )}
            </div>
            {steam && (
              <a
                href={`https://hllrecords.com/profiles/${steam.gameId}?period=90d`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm mt-4 w-full"
              >
                HLLRecords profile
              </a>
            )}
          </section>
        </aside>

        <main className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Matches" value={member.stats.matchesPlayed} />
            <StatCard label="K/D" value={member.stats.kd} />
            <StatCard label="KPM" value={member.stats.kpm} />
            <StatCard label="Kills" value={member.stats.totalKills} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Match Averages
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Avg kills" value={member.stats.avgKills} compact />
                <StatCard label="Avg deaths" value={member.stats.avgDeaths} compact />
                <StatCard label="Total deaths" value={member.stats.totalDeaths} compact />
                <StatCard label="Source matches" value={member.stats.matchesPlayed} compact />
              </div>
            </div>
            <div className="card p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                HLLRecords
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="KPM" value={member.hllRecord?.kpm ?? '—'} compact />
                <StatCard label="KDR" value={member.hllRecord?.kdr ?? '—'} compact />
                <StatCard label="Duel" value={member.hllRecord?.duelStrength ?? '—'} compact />
              </div>
              <div className="mt-3 text-xs text-zinc-600">
                Fetched {member.hllRecord ? formatDateTime(member.hllRecord.fetchedAt) : 'never'}
              </div>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-white/5 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Recent Matches
              </h3>
            </div>
            {member.recentMatches.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No linked matches yet.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Played</th>
                    <th className="text-right">Kills</th>
                    <th className="text-right">Deaths</th>
                    <th className="text-right">K/D</th>
                    <th className="text-right">KPM</th>
                  </tr>
                </thead>
                <tbody>
                  {member.recentMatches.map((match) => (
                    <tr key={match.id}>
                      <td>
                        <div className="font-medium text-zinc-100">
                          {match.eventName ?? match.eventType ?? match.map ?? 'Match'}
                        </div>
                        <div className="text-xs text-zinc-600">
                          {[match.opponent, match.result, match.team].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>
                      <td className="text-zinc-400">{formatDate(match.playedAt)}</td>
                      <td className="text-right tabular-nums">{match.kills}</td>
                      <td className="text-right tabular-nums">{match.deaths}</td>
                      <td className="text-right font-medium tabular-nums text-zinc-100">{match.kd}</td>
                      <td className="text-right tabular-nums">{match.kpm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-white/5 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Roster History
              </h3>
            </div>
            {member.rosterHistory.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No roster history yet.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {member.rosterHistory.map((slot) => (
                  <div key={slot.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto]">
                    <div>
                      <div className="font-medium text-zinc-100">
                        {slot.raidhelperEventId ? (
                          <Link
                            href={`/roster/${slot.raidhelperEventId}`}
                            className="hover:text-brand-bright hover:underline"
                          >
                            {slot.eventTitle ?? 'Roster'}
                          </Link>
                        ) : (
                          slot.eventTitle ?? 'Roster'
                        )}
                      </div>
                      <div className="text-xs text-zinc-600">
                        {[slot.position, slot.status].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <span
                        className={`badge ${
                          slot.response === 'accepted'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : slot.response === 'declined'
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        {slot.response}
                      </span>
                      <div className="mt-1 text-xs text-zinc-600">
                        {formatDateTime(slot.eventStartTime)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function ProfileField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 last:border-0 last:pb-0">
      <span className="text-zinc-500">{label}</span>
      <span className={`min-w-0 truncate text-right text-zinc-200 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: number | string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-md border border-white/10 bg-white/[0.03] ${compact ? 'p-3' : 'p-4'}`}>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`${compact ? 'mt-1 text-xl' : 'mt-2 text-3xl'} font-bold tabular-nums text-zinc-100`}>
        {value}
      </div>
    </div>
  );
}