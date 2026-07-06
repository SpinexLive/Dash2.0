import Link from 'next/link';

export default async function HomePage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  let logoUrl: string | null = null;
  try {
    const res = await fetch(`${apiUrl}/settings/logo`, { cache: 'no-store' });
    if (res.ok) logoUrl = ((await res.json()) as { logoUrl: string | null }).logoUrl;
  } catch {
    // Fall back to the default badge if the API is unreachable.
  }
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_40rem_at_50%_-10%,rgba(145,12,12,0.22),transparent)]" />
      <div className="card animate-fade-in relative w-full max-w-md p-8 text-center">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Clan logo"
            className="mx-auto mb-6 h-14 w-14 rounded-xl object-contain"
          />
        ) : (
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-brand text-xl font-black text-white">
            HLL
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
          Clan Dashboard
        </h1>

        <a
          href="/auth/discord/login"
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-indigo-500"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a14.5 14.5 0 0 0-.642 1.32 18.27 18.27 0 0 0-5.487 0A14.5 14.5 0 0 0 9.785 3a19.79 19.79 0 0 0-3.76 1.369C2.55 9.58 1.6 14.66 2.073 19.67a19.9 19.9 0 0 0 6.063 3.07c.49-.668.927-1.377 1.304-2.122a12.9 12.9 0 0 1-2.053-.99c.172-.126.34-.258.502-.394a14.2 14.2 0 0 0 12.218 0c.164.14.332.272.502.394-.654.388-1.343.72-2.057.99.377.745.814 1.454 1.304 2.122a19.84 19.84 0 0 0 6.067-3.07c.555-5.808-.949-10.843-3.976-15.301ZM8.02 16.5c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.156 2.42 0 1.334-.955 2.419-2.156 2.419Zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.156 2.42 0 1.334-.946 2.419-2.156 2.419Z" />
          </svg>
          Login with Discord
        </a>
        
      </div>
    </div>
  );
}
