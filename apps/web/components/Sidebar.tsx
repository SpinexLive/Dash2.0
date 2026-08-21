'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '../lib/api';
import {
  UsersIcon,
  InboxIcon,
  ClipboardIcon,
  SwordsIcon,
  RadioIcon,
  CogIcon,
  LinkIcon,
  LogoutIcon,
  DashboardIcon,
} from './icons';

const commandNav = [
  { href: '/overview', label: 'Overview', Icon: DashboardIcon },
  { href: '/members', label: 'Members', Icon: UsersIcon },
  { href: '/recruits', label: 'Recruits', Icon: InboxIcon },
  { href: '/roster', label: 'Roster', Icon: ClipboardIcon },
  { href: '/matches', label: 'Matches', Icon: SwordsIcon },
  { href: '/briefing', label: 'Briefing', Icon: RadioIcon },
  { href: '/tournament-roster-check', label: 'Tournament Check', Icon: ClipboardIcon },
];
const organisationNav = [
  { href: '/settings', label: 'Settings', Icon: CogIcon },
  { href: '/connected-servers', label: 'Connected Servers', Icon: LinkIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ logoUrl: string | null }>('/settings/logo')
        .then((r) => setLogoUrl(r?.logoUrl ?? null))
        .catch(() => setLogoUrl(null));
    load();
    // Refresh when the logo is changed on the Settings page.
    const onUpdated = () => load();
    window.addEventListener('settings:logo-updated', onUpdated);
    return () => window.removeEventListener('settings:logo-updated', onUpdated);
  }, []);

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-cyan-100/[0.075] bg-[#081119]/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-5 py-7">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Clan logo"
            className="h-9 w-9 rounded-lg border border-cyan-100/10 object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-bright/40 bg-brand/80 font-black text-white shadow-lg shadow-cyan-950/40">
            HLL
          </div>
        )}
        <div className="leading-tight">
          <p className="text-sm font-semibold text-zinc-100">Clan Dashboard</p>
          <p className="text-xs text-zinc-500">331st command</p>
        </div>
      </div>

      <p className="px-5 pb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600">Command</p>
      <nav className="space-y-1 px-3">
        {commandNav.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-brand/15 text-brand-bright shadow-[inset_2px_0_0_#71dcff]'
                  : 'text-zinc-400 hover:bg-cyan-100/[0.045] hover:text-zinc-100'
              }`}
            >
              <Icon
                className={
                  active
                    ? 'text-brand-bright'
                    : 'text-zinc-500 group-hover:text-cyan-100'
                }
              />
              {label}
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-bright" />
              )}
            </Link>
          );
        })}
      </nav>
      <p className="mt-7 px-5 pb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600">Organisation</p>
      <nav className="space-y-1 px-3">
        {organisationNav.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return <Link key={href} href={href} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'bg-brand/15 text-brand-bright shadow-[inset_2px_0_0_#71dcff]' : 'text-zinc-400 hover:bg-cyan-100/[0.045] hover:text-zinc-100'}`}><Icon className={active ? 'text-brand-bright' : 'text-zinc-500 group-hover:text-cyan-100'} />{label}{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_#71dcff]" />}</Link>;
        })}
      </nav>
      <div className="flex-1" />

      <div className="border-t border-cyan-100/[0.075] p-3">
        <a
          href="/auth/logout"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          <LogoutIcon />
          Logout
        </a>
      </div>
    </aside>
  );
}
