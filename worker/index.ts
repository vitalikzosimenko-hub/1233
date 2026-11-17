// Block Fortress backend. Two Durable Objects behind one small router:
//   SaveVault: a cloud save slot, addressed by the hash of a secret "cloud code" that only the
//              player's devices know (the code itself is never stored).
//   CoopRoom:  a two-seat co-op room. The host's game is the world; the room only admits the two
//              seats, tells each about the other, and relays their game messages ('#'-prefixed
//              text frames) between them.
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOMS: DurableObjectNamespace;
  VAULT: DurableObjectNamespace;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  SEAT_GRACE_MS?: string;
  HOST_GRACE_MS?: string;
  EMPTY_ROOM_TTL_MS?: string;
  IDLE_MS?: string;
}

const PROTOCOL = 'bf-coop-1';
/** Room codes: five characters that cannot be mistaken for one another when read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
/** Cloud codes: 16 Crockford base32 characters (80 random bits). */
const SAVE_KEY_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/;
const SEAT_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_SAVE_CHARS = 1_600_000;
const CHUNK_CHARS = 96_000;
const MAX_RELAY_CHARS = 900_000;
const MAX_ROOM_AGE_MS = 24 * 3600_000;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomString(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Durable Object placement by the continent the request came from. */
const LOCATION_HINTS: Record<string, string> = { AS: 'apac', OC: 'oc', EU: 'weur', NA: 'wnam', SA: 'sam', AF: 'afr', ME: 'me' };

async function readJson(request: Request, max: number): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > max) return null;
  const text = await request.text();
  if (text.length > max) return null;
  try {
    const data: unknown = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function setting(env: Env, name: 'SEAT_GRACE_MS' | 'HOST_GRACE_MS' | 'EMPTY_ROOM_TTL_MS' | 'IDLE_MS', fallback: number): number {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// ------------------------------------------------------------------ router

async function vaultFor(env: Env, key: unknown): Promise<DurableObjectStub | null> {
  if (typeof key !== 'string' || !SAVE_KEY_RE.test(key)) return null;
  return env.VAULT.get(env.VAULT.idFromName(`vault:${await sha256(`bf-vault:${key}`)}`));
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === '/api/health') return json({ ok: true, protocol: PROTOCOL, time: Date.now(), colo: request.cf?.colo ?? null });

  if (path === '/api/save/get' || path === '/api/save/put') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    const body = await readJson(request, MAX_SAVE_CHARS + 4096);
    if (!body) return json({ error: 'bad_request' }, 400);
    const vault = await vaultFor(env, body.key);
    if (!vault) return json({ error: 'bad_key' }, 400);
    const op = path.endsWith('put') ? 'put' : 'get';
    return vault.fetch(`https://vault/${op}`, { method: 'POST', body: JSON.stringify({ save: body.save, info: body.info }) });
  }

  if (path === '/api/room' && request.method === 'POST') {
    const hostKey = randomString(KEY_ALPHABET, 32);
    const hostHash = await sha256(`bf-host:${hostKey}`);
    // The room lives near the player who opens it (friends tend to play from the same region).
    const hint = LOCATION_HINTS[request.cf?.continent ?? ''];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomString(CODE_ALPHABET, 5);
      const room = env.ROOMS.get(env.ROOMS.idFromName(`room:${code}`), hint ? { locationHint: hint } : undefined);
      const made = await room.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, hostHash }) });
      if (made.status === 201) return json({ code, hostKey, protocol: PROTOCOL }, 201);
    }
    return json({ error: 'busy' }, 503);
  }

  const m = /^\/api\/room\/([^/]+)(?:\/(ws))?$/.exec(path);
  if (m) {
    const code = m[1]!.toUpperCase();
    if (!CODE_RE.test(code) || request.method !== 'GET') return json({ error: 'not_found' }, 404);
    const room = env.ROOMS.get(env.ROOMS.idFromName(`room:${code}`));
    if (!m[2]) return room.fetch('https://room/status');
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'upgrade_required' }, 426);
    return room.fetch(new Request('https://room/ws', request));
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    let response: Response;
    try {
      response = await route(request, env, url);
    } catch (error) {
      console.error(JSON.stringify({ event: 'api_error', path: url.pathname, message: String(error) }));
      response = json({ error: 'server_error' }, 500);
    }
    if (response.webSocket) return response;
    const out = new Response(response.body, response);
    for (const [name, value] of Object.entries(CORS)) out.headers.set(name, value);
    return out;
  },
};

// ------------------------------------------------------------------ cloud saves

interface VaultMeta {
  rev: number;
  savedAt: number;
  slot: 'a' | 'b';
  n: number;
  size: number;
  info: Record<string, unknown>;
  prev: { rev: number; savedAt: number; slot: 'a' | 'b'; n: number; info: Record<string, unknown> } | null;
}

/** Small, flat facts about a save shown before loading it (day, blocks, when). */
function cleanInfo(info: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!info || typeof info !== 'object') return out;
  for (const [k, v] of Object.entries(info as Record<string, unknown>).slice(0, 16)) {
    if (k.length > 24) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 64);
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export class SaveVault extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = (await readJson(request, MAX_SAVE_CHARS + 4096)) ?? {};
    const meta = (await this.ctx.storage.get<VaultMeta>('meta')) ?? null;
    if (url.pathname === '/get') {
      if (!meta) return json({ ok: true, rev: 0, savedAt: 0, info: null, save: null });
      const keys = Array.from({ length: meta.n }, (_, i) => `${meta.slot}${i}`);
      const parts = keys.length ? await this.ctx.storage.get<string>(keys) : new Map<string, string>();
      let save = '';
      for (const k of keys) {
        const part = parts.get(k);
        if (typeof part !== 'string') return json({ error: 'corrupt' }, 500);
        save += part;
      }
      return json({ ok: true, rev: meta.rev, savedAt: meta.savedAt, info: meta.info, save });
    }
    if (url.pathname === '/put') {
      const save = body.save;
      if (typeof save !== 'string' || save.length < 2 || save.length > MAX_SAVE_CHARS) return json({ error: 'bad_save' }, 400);
      const slot: 'a' | 'b' = meta?.slot === 'a' ? 'b' : 'a';
      const n = Math.ceil(save.length / CHUNK_CHARS);
      const entries: Record<string, unknown> = {};
      for (let i = 0; i < n; i += 1) entries[`${slot}${i}`] = save.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
      const now = Date.now();
      const next: VaultMeta = {
        rev: (meta?.rev ?? 0) + 1,
        savedAt: now,
        slot,
        n,
        size: save.length,
        info: cleanInfo(body.info),
        // The revision before this one stays readable in the other slot.
        prev: meta ? { rev: meta.rev, savedAt: meta.savedAt, slot: meta.slot, n: meta.n, info: meta.info } : null,
      };
      entries.meta = next;
      await this.ctx.storage.put(entries);
      // Chunks left over in this slot from a bigger save two revisions back.
      const stale: string[] = [];
      for (let i = n; i < 40; i += 1) stale.push(`${slot}${i}`);
      await this.ctx.storage.delete(stale);
      return json({ ok: true, rev: next.rev, savedAt: now });
    }
    return json({ error: 'not_found' }, 404);
  }
}

// ------------------------------------------------------------------ co-op rooms

interface SeatMeta {
  name: string;
  online: boolean;
  /** Guest seats: hash of the seat key that reclaims it after a dropped connection. */
  keyHash?: string;
  offlineSince?: number;
}

interface RoomMeta {
  code: string;
  hostHash: string;
  created: number;
  seats: [SeatMeta | null, SeatMeta | null];
  idleSince: number | null;
}

interface Attachment {
  seat: 0 | 1 | null;
  at: number;
  key?: string;
}

const CLOSE_REASONS: Record<number, string> = {
  4001: 'Replaced',
  4003: 'Room full',
  4400: 'Bad hello',
  4401: 'Not the host',
  4404: 'No such room',
  4408: 'Idle',
  4410: 'Room closed',
  4426: 'Reload required',
};

const PING = '{"t":"ping"}';
const PONG = '{"t":"pong"}';

function send(ws: CfWebSocket, message: string): void {
  try {
    ws.send(message);
  } catch {
    // the idle sweep closes peers that stopped answering
  }
}

function farewell(ws: CfWebSocket, code: number, why = ''): void {
  send(ws, JSON.stringify({ t: 'close', code, why }));
  try {
    ws.close(code, CLOSE_REASONS[code] ?? 'Closed');
  } catch {
    // already closed
  }
}

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) : '';
  return name || fallback;
}

export class CoopRoom extends DurableObject<Env> {
  private meta: RoomMeta | null = null;
  /** Last message time per seat (an idle sweep closes sockets that went quiet). */
  private readonly seen = new Map<number, number>();
  private readonly buckets = new Map<number, { tokens: number; at: number }>();
  private readonly woke = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Pings are answered without waking a hibernating room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get<RoomMeta>('meta')) ?? null;
      if (!this.meta) return;
      // Sockets can outlive this object's memory; a seat without one is offline.
      const live = new Set(this.sockets().map((ws) => this.attachment(ws).seat));
      const now = Date.now();
      this.meta.seats.forEach((s, i) => {
        if (s?.online && !live.has(i as 0 | 1)) {
          s.online = false;
          s.offlineSince = now;
        }
      });
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/init') {
      const body = await readJson(request, 1024);
      const code = typeof body?.code === 'string' ? body.code : '';
      const hostHash = typeof body?.hostHash === 'string' ? body.hostHash : '';
      if (!CODE_RE.test(code) || !/^[0-9a-f]{64}$/.test(hostHash)) return json({ error: 'bad_request' }, 400);
      if (this.meta) {
        // A code still in use (or recently used) is not handed out again.
        const live = this.sockets().length > 0 || (this.meta.idleSince !== null && Date.now() - this.meta.idleSince < 120_000) || Date.now() - this.meta.created < 120_000;
        if (live) return json({ error: 'taken' }, 409);
      }
      this.meta = { code, hostHash, created: Date.now(), seats: [null, null], idleSince: Date.now() };
      for (const ws of this.sockets()) farewell(ws, 4410, 'replaced');
      await this.save();
      await this.ensureAlarm();
      return json({ ok: true }, 201);
    }
    if (url.pathname === '/status') {
      const m = this.meta;
      if (!m) return json({ ok: true, open: false });
      const [host, guest] = m.seats;
      return json({ ok: true, open: true, host: host ? { name: host.name, online: host.online } : null, guest: guest ? { name: guest.name, online: guest.online } : null, full: Boolean(guest && (guest.online || Date.now() - (guest.offlineSince ?? 0) < setting(this.env, 'SEAT_GRACE_MS', 60_000))) });
    }
    if (url.pathname === '/ws') {
      // Accept first: the socket says who it is in its first message (keys stay out of URLs).
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ seat: null, at: Date.now() } satisfies Attachment);
      await this.ensureAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'not_found' }, 404);
  }

  async webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const att = this.attachment(ws);
    if (att.seat === null) {
      await this.hello(ws, att, message);
      return;
    }
    const seat = att.seat;
    this.seen.set(seat, Date.now());
    if (message.charCodeAt(0) === 35) {
      // '#': a game message for the other seat, passed on untouched.
      if (message.length > MAX_RELAY_CHARS || !this.take(seat)) return;
      const peer = this.seatSocket(seat === 0 ? 1 : 0);
      if (peer) send(peer, message);
      return;
    }
    if (message.length > 512) return;
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    if (data?.t === 'bye') await this.leave(ws, seat);
    else if (data?.t === 'kick' && seat === 0) {
      const guest = this.seatSocket(1);
      if (guest) farewell(guest, 4410, 'kicked');
      if (this.meta) this.meta.seats[1] = null;
      await this.save();
    }
  }

  private async hello(ws: CfWebSocket, att: Attachment, message: string): Promise<void> {
    let data: Record<string, unknown> | null = null;
    try {
      data = message.length <= 512 ? (JSON.parse(message) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }
    if (!data || data.t !== 'hello') return farewell(ws, 4400);
    if (data.v !== PROTOCOL) return farewell(ws, 4426);
    const m = this.meta;
    if (!m) return farewell(ws, 4404);
    const key = typeof data.key === 'string' ? data.key : '';
    const now = Date.now();
    let seat: 0 | 1;
    let keyHash: string | undefined;
    let rejoin = false;
    if (data.role === 'host') {
      if ((await sha256(`bf-host:${key}`)) !== m.hostHash) return farewell(ws, 4401);
      seat = 0;
      rejoin = m.seats[0] !== null;
    } else if (data.role === 'guest') {
      if (!SEAT_KEY_RE.test(key)) return farewell(ws, 4400);
      keyHash = await sha256(`bf-seat:${key}`);
      const held = m.seats[1];
      const grace = setting(this.env, 'SEAT_GRACE_MS', 60_000);
      if (held && held.keyHash !== keyHash && (held.online || now - (held.offlineSince ?? 0) < grace)) return farewell(ws, 4003);
      seat = 1;
      rejoin = held !== null && held.keyHash === keyHash;
    } else return farewell(ws, 4400);
    // A newer connection for the same seat replaces the old one.
    for (const old of this.sockets(ws)) if (this.attachment(old).seat === seat) farewell(old, 4001);
    m.seats[seat] = { name: cleanName(data.name, seat === 0 ? 'Captain' : 'Gunner'), online: true, keyHash };
    m.idleSince = null;
    ws.serializeAttachment({ seat, at: att.at } satisfies Attachment);
    this.seen.set(seat, now);
    await this.save();
    const other = m.seats[seat === 0 ? 1 : 0];
    send(ws, JSON.stringify({ t: 'welcome', v: PROTOCOL, seat, code: m.code, peer: other ? { name: other.name, online: other.online } : null }));
    const peer = this.seatSocket(seat === 0 ? 1 : 0);
    if (peer) send(peer, JSON.stringify({ t: 'peer', seat, on: true, name: m.seats[seat]!.name, rejoin }));
  }

  /** A seat leaving on purpose: a guest frees the seat at once; the host closes the room. */
  private async leave(ws: CfWebSocket, seat: 0 | 1): Promise<void> {
    const m = this.meta;
    if (!m) return;
    if (seat === 0) {
      const guest = this.seatSocket(1);
      if (guest) farewell(guest, 4410, 'host_left');
      farewell(ws, 4410, 'bye');
      this.meta = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    m.seats[1] = null;
    farewell(ws, 4410, 'bye');
    const host = this.seatSocket(0);
    if (host) send(host, JSON.stringify({ t: 'peer', seat: 1, gone: true }));
    await this.save();
  }

  async webSocketClose(ws: CfWebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.dropped(ws);
  }

  private async dropped(ws: CfWebSocket): Promise<void> {
    const { seat } = this.attachment(ws);
    try {
      ws.close(1000, 'Closed');
    } catch {
      // already closed
    }
    const m = this.meta;
    if (!m || seat === null) return;
    const s = m.seats[seat];
    if (s?.online && !this.seatSocket(seat, ws)) {
      s.online = false;
      s.offlineSince = Date.now();
      const peer = this.seatSocket(seat === 0 ? 1 : 0);
      if (peer) send(peer, JSON.stringify({ t: 'peer', seat, on: false }));
    }
    if (this.sockets(ws).length === 0) m.idleSince ??= Date.now();
    await this.save();
    await this.ensureAlarm();
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const idle = setting(this.env, 'IDLE_MS', 30_000);
    for (const ws of this.sockets()) {
      const att = this.attachment(ws);
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const last = Math.max(att.at, att.seat === null ? 0 : this.seen.get(att.seat) ?? this.woke, auto);
      if (now - last > idle) {
        farewell(ws, 4408);
        await this.dropped(ws);
      }
    }
    const m = this.meta;
    if (m) {
      const guest = m.seats[1];
      if (guest && !guest.online && now - (guest.offlineSince ?? now) > setting(this.env, 'SEAT_GRACE_MS', 60_000)) {
        m.seats[1] = null;
        const host = this.seatSocket(0);
        if (host) send(host, JSON.stringify({ t: 'peer', seat: 1, gone: true }));
      }
      const host = m.seats[0];
      const hostGone = host ? !host.online && now - (host.offlineSince ?? now) > setting(this.env, 'HOST_GRACE_MS', 90_000) : now - m.created > 15 * 60_000;
      const empty = this.sockets().length === 0 && m.idleSince !== null && now - m.idleSince > setting(this.env, 'EMPTY_ROOM_TTL_MS', 600_000);
      if (hostGone || empty || now - m.created > MAX_ROOM_AGE_MS) {
        for (const ws of this.sockets()) farewell(ws, 4410, 'host_left');
        this.meta = null;
        await this.ctx.storage.deleteAll();
        return;
      }
      await this.save();
    }
    await this.ensureAlarm();
  }

  private take(seat: number): boolean {
    const now = Date.now();
    const b = this.buckets.get(seat) ?? { tokens: 240, at: now };
    b.tokens = Math.min(240, b.tokens + ((now - b.at) / 1000) * 90);
    b.at = now;
    this.buckets.set(seat, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private attachment(ws: CfWebSocket): Attachment {
    const a = ws.deserializeAttachment() as Attachment | null;
    return a ?? { seat: null, at: 0 };
  }

  private sockets(except?: CfWebSocket): CfWebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && ws.readyState === 1);
  }

  private seatSocket(seat: 0 | 1, except?: CfWebSocket): CfWebSocket | null {
    return this.sockets(except).find((ws) => this.attachment(ws).seat === seat) ?? null;
  }

  private async ensureAlarm(): Promise<void> {
    if (!this.meta && this.sockets().length === 0) return;
    const due = Date.now() + (this.sockets().length > 0 ? setting(this.env, 'IDLE_MS', 30_000) / 2 : 30_000);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > due) await this.ctx.storage.setAlarm(due);
  }

  private async save(): Promise<void> {
    if (this.meta) await this.ctx.storage.put('meta', this.meta);
  }
}
