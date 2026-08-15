'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type Member = { id: string; username?: string; nickname?: string; displayName?: string };
type Recruit = { id: string; username?: string; status?: string };
type Event = { id: string; title?: string; startTime?: number; signUpCount?: number; leaderName?: string };
type Match = { id: string; opponent?: string; playedAt?: string };

function eventDate(value?: number) {
  if (!value) return 'Time to be confirmed';
  return new Date(value * 1000).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function OverviewPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    Promise.allSettled([api<Member[]>('/members'), api<Recruit[]>('/recruits'), api<Event[]>('/raidhelper/events'), api<Match[]>('/matches')]).then(([m, r, e, mt]) => {
      if (m.status === 'fulfilled') setMembers(m.value);
      if (r.status === 'fulfilled') setRecruits(r.value);
      if (e.status === 'fulfilled') setEvents(e.value);
      if (mt.status === 'fulfilled') setMatches(mt.value);
    });
  }, []);

  const nextEvent = useMemo(() => [...events].filter((event) => !event.startTime || event.startTime * 1000 > Date.now()).sort((a, b) => (a.startTime ?? Infinity) - (b.startTime ?? Infinity))[0], [events]);
  const pendingRecruits = recruits.filter((recruit) => !recruit.status || recruit.status.toLowerCase().includes('pending'));
  const displayName = (member: Member) => member.nickname || member.displayName || member.username || 'Member';

  return (
    <div className="animate-fade-in min-h-0 flex-1 overflow-y-auto pb-4">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Command centre</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50">Overview</h1>
          <p className="mt-1 text-sm text-zinc-500">Your clan at a glance.</p>
        </div>
        <Link href="/roster" className="btn btn-primary">Create roster</Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active members" value={members.length} detail="Community roster" />
        <Metric label="Pending recruits" value={pendingRecruits.length} detail="Awaiting review" accent="amber" />
        <Metric label="Upcoming events" value={events.length} detail="RaidHelper schedule" />
        <Metric label="Recorded matches" value={matches.length} detail="Match archive" />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.85fr]">
        <article className="card min-h-[300px]">
          <div className="flex items-center justify-between border-b border-cyan-100/[0.075] px-5 py-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.13em] text-zinc-600">Next operation</p><h2 className="mt-1 text-sm font-semibold">{nextEvent?.title ?? 'No operation scheduled'}</h2></div><Link href="/roster" className="text-xs text-brand-bright hover:text-cyan-100">View roster →</Link></div>
          {nextEvent ? <div className="p-5"><div className="rounded-lg border border-cyan-100/[0.08] bg-cyan-100/[0.025] p-4"><p className="font-mono text-xs text-brand-bright">{eventDate(nextEvent.startTime)}</p><p className="mt-3 text-sm text-zinc-300">{nextEvent.signUpCount ?? 0} signed up{nextEvent.leaderName ? ` · led by ${nextEvent.leaderName}` : ''}</p></div><div className="mt-5 grid gap-2 sm:grid-cols-2"><CommandLink href="/briefing" title="Prepare briefing" text="Review attendance and squads." /><CommandLink href="/members" title="Check members" text="Manage available personnel." /></div></div> : <div className="flex h-52 items-center justify-center px-6 text-center text-sm text-zinc-500">When a RaidHelper event is scheduled, its operation summary will appear here.</div>}
        </article>
        <article className="card">
          <div className="flex items-center justify-between border-b border-cyan-100/[0.075] px-5 py-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.13em] text-zinc-600">Recruit queue</p><h2 className="mt-1 text-sm font-semibold">Awaiting review</h2></div><Link href="/recruits" className="text-xs text-brand-bright hover:text-cyan-100">Open queue →</Link></div>
          <div className="divide-y divide-cyan-100/[0.06] px-5">{pendingRecruits.slice(0, 5).map((recruit) => <div key={recruit.id} className="flex items-center gap-3 py-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/15 font-mono text-[10px] text-brand-bright">{(recruit.username ?? '?').slice(0, 2).toUpperCase()}</span><span className="text-sm text-zinc-200">{recruit.username ?? 'Unknown recruit'}</span><span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_#fcd34d]" /></div>)}{pendingRecruits.length === 0 && <p className="py-12 text-center text-sm text-zinc-500">No pending recruits.</p>}</div>
        </article>
      </section>

      <section className="card mt-5">
        <div className="flex items-center justify-between border-b border-cyan-100/[0.075] px-5 py-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.13em] text-zinc-600">Membership</p><h2 className="mt-1 text-sm font-semibold">Recently listed members</h2></div><Link href="/members" className="text-xs text-brand-bright hover:text-cyan-100">View all →</Link></div>
        <div className="grid divide-y divide-cyan-100/[0.06] md:grid-cols-3 md:divide-x md:divide-y-0">{members.slice(0, 6).map((member) => <div key={member.id} className="flex items-center gap-3 px-5 py-4"><span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100/[0.06] font-mono text-[10px] text-cyan-100">{displayName(member).slice(0, 2).toUpperCase()}</span><span className="truncate text-sm text-zinc-200">{displayName(member)}</span><span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" /></div>)}{members.length === 0 && <p className="col-span-3 py-10 text-center text-sm text-zinc-500">Member data will appear here once loaded.</p>}</div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail, accent }: { label: string; value: number; detail: string; accent?: 'amber' }) {
  return <article className="card p-5"><p className="text-xs text-zinc-500">{label}</p><div className="mt-3 flex items-end justify-between"><strong className="text-3xl font-semibold tracking-tight">{value}</strong><span className={`font-mono text-[10px] ${accent === 'amber' ? 'text-amber-300' : 'text-brand-bright'}`}>{detail.toUpperCase()}</span></div></article>;
}

function CommandLink({ href, title, text }: { href: string; title: string; text: string }) {
  return <Link href={href} className="rounded-lg border border-cyan-100/[0.08] bg-cyan-100/[0.025] p-3 transition hover:border-cyan-100/20 hover:bg-cyan-100/[0.06]"><p className="text-xs font-semibold text-zinc-200">{title} →</p><p className="mt-1 text-xs text-zinc-500">{text}</p></Link>;
}
