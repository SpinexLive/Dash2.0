'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';

/**
 * App layout shell. The login page (`/`) renders full-screen; every other
 * route gets the persistent sidebar + scrollable content area.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/';

  useEffect(() => {
    const activateCards = () => {
      document.querySelectorAll<HTMLElement>('.card').forEach((card) => {
        if (!card.querySelector(':scope > .card-edge-glow')) {
          const glow = document.createElement('div');
          glow.className = 'card-edge-glow';
          glow.setAttribute('aria-hidden', 'true');
          card.prepend(glow);
        }
      });
    };
    activateCards();
    const observer = new MutationObserver(activateCards);
    observer.observe(document.body, { childList: true, subtree: true });
    const setGlowPosition = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>('.card');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      card.style.setProperty('--start', String(Math.atan2(y, x) * 180 / Math.PI + 60));
    };
    document.addEventListener('pointermove', setGlowPosition);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointermove', setGlowPosition);
    };
  }, []);

  if (isAuthPage) {
    return (
      <div className="min-h-screen">
        {children}
        <LegalFooter className="fixed inset-x-0 bottom-0 z-10" />
      </div>
    );
  }

  // Data-dense pages use the full content width.
  const isWide =
    /^\/roster\/.+/.test(pathname) ||
    pathname === '/briefing' ||
    pathname === '/members';

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div
          className={`mx-auto flex min-h-0 w-full flex-1 flex-col px-6 py-8 lg:px-10 ${
            isWide ? 'max-w-none' : 'max-w-6xl'
          }`}
        >
          {children}
        </div>
        <LegalFooter />
      </main>
    </div>
  );
}

function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <footer
      className={`border-t border-white/5 bg-zinc-950/80 px-6 py-3 text-xs text-zinc-500 backdrop-blur ${className}`}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span>331st Clan Dashboard</span>
        <Link href="/terms" className="hover:text-zinc-300">
          Terms of Service
        </Link>
        <Link href="/privacy" className="hover:text-zinc-300">
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}
