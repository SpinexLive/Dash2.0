const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Fetch wrapper that always sends the auth cookie and parses JSON. */
export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  let res = await doFetch();

  // Access token expired? Try a single silent refresh, then retry once.
  if (res.status === 401 && path !== '/auth/refresh') {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      credentials: 'include',
    });
    if (refreshed.ok) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${msg}`);
  }
  if (res.status === 204) return undefined as T;
  // Some endpoints (e.g. a missing roster) return 200 with an empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const apiUrl = API_URL;
