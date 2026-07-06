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
  LogoutIcon,
} from './icons';

const nav = [
  { href: '/members', label: 'Members', Icon: UsersIcon },
  { href: '/recruits', label: 'Recruits', Icon: InboxIcon },
  { href: '/roster', label: 'Roster', Icon: ClipboardIcon },
  { href: '/matches', label: 'Matches', Icon: SwordsIcon },
  { href: '/briefing', label: 'Briefing', Icon: RadioIcon },
  { href: '/settings', label: 'Settings', Icon: CogIcon },
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
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-zinc-900/40 backdrop-blur">
      <div className="flex items-center gap-3 px-5 py-6">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Clan logo"
            className="h-9 w-9 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand font-black text-white">
            HLL
          </div>
        )}
        <div className="leading-tight">
          <p className="text-sm font-semibold text-zinc-100">Clan Dashboard</p>
          <p className="text-xs text-zinc-500">Hell Let Loose</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {nav.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-brand/15 text-brand-bright'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
              }`}
            >
              <Icon
                className={
                  active
                    ? 'text-brand-bright'
                    : 'text-zinc-500 group-hover:text-zinc-300'
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

      <div className="border-t border-white/5 p-3">
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
