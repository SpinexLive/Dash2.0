import Link from 'next/link';
import {
  ClipboardIcon,
  InboxIcon,
  RadioIcon,
  SwordsIcon,
  UsersIcon,
} from '../../components/icons';

const destinations = [
  {
    href: '/members',
    title: 'Members',
    description: 'Browse and manage the clan directory.',
    Icon: UsersIcon,
  },
  {
    href: '/recruits',
    title: 'Recruits',
    description: 'Review applications and track recruitment.',
    Icon: InboxIcon,
  },
  {
    href: '/roster',
    title: 'Roster',
    description: 'Plan squads and organise operations.',
    Icon: ClipboardIcon,
  },
  {
    href: '/matches',
    title: 'Matches',
    description: 'Manage fixtures and match records.',
    Icon: SwordsIcon,
  },
  {
    href: '/briefing',
    title: 'Briefing',
    description: 'Prepare your team for the next operation.',
    Icon: RadioIcon,
  },
];

export default function OverviewPage() {
  return (
    <main className="animate-fade-in flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Command centre
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">Choose an area to continue.</p>
      </header>

      <section
        aria-label="Dashboard sections"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {destinations.map(({ href, title, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="card group flex min-h-44 flex-col p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-brand-bright/20 bg-brand/10 text-brand-bright transition-colors group-hover:bg-brand/20">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-zinc-100">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
            <span className="mt-auto pt-5 text-sm font-medium text-brand-bright transition-transform group-hover:translate-x-1">
              Open {title} →
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
