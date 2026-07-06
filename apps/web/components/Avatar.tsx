'use client';
import { useState } from 'react';

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Discord avatar with graceful fallback to initials. */
export function Avatar({
  discordId,
  avatar,
  name,
  size = 32,
}: {
  discordId: string;
  avatar: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  const ext = avatar?.startsWith('a_') ? 'gif' : 'png';
  const url =
    avatar && discordId
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${ext}?size=64`
      : null;

  if (!url || failed) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300 ring-1 ring-white/5"
        style={{ width: size, height: size }}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover ring-1 ring-white/10"
      style={{ width: size, height: size }}
    />
  );
}
