// Where the game's own backend (cloud saves, co-op rooms) lives. The platform writes
// combos-runtime.json next to index.html with the Worker's origin; the creator's preview gets the
// development Worker there, published games the production one. Without it (a plain local build)
// the online features stay off and the game plays on as before.

let found: string | null = null;
let pending: Promise<string | null> | null = null;
let failedAt = -1e9;

function valid(raw: string): string | null {
  try {
    const u = new URL(raw);
    const local = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    if ((u.protocol !== 'https:' && !local) || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The backend origin, or null when there is none (a failed lookup is retried after a while). */
export function runtimeOrigin(): Promise<string | null> {
  if (found) return Promise.resolve(found);
  if (pending) return pending;
  if (performance.now() - failedAt < 8000) return Promise.resolve(null);
  pending = (async () => {
    try {
      // Local test builds may point at a local Worker (only ever a loopback address).
      const forced = new URLSearchParams(window.location.search).get('runtime');
      if (forced) {
        const v = valid(forced);
        if (v && v.startsWith('http://')) return v;
      }
      const res = await fetch(new URL('combos-runtime.json', document.baseURI), { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as { runtime_url?: unknown };
      return typeof data.runtime_url === 'string' ? valid(data.runtime_url) : null;
    } catch {
      return null;
    }
  })().then((origin) => {
    pending = null;
    if (origin) found = origin;
    else failedAt = performance.now();
    return origin;
  });
  return pending;
}

/** POSTs JSON to the backend; rejects on network failure or a non-2xx answer. */
export async function api<T>(path: string, body: unknown, timeoutMs = 12000): Promise<T> {
  const origin = await runtimeOrigin();
  if (!origin) throw new Error('offline');
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}${path}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok || data === null) throw new Error(`http_${res.status}`);
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

/** ws(s):// address of a backend path. */
export async function socketURL(path: string): Promise<string | null> {
  const origin = await runtimeOrigin();
  if (!origin) return null;
  const u = new URL(path, origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}
