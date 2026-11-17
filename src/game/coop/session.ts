// The co-op connection: opens or joins a room on the game's backend, keeps the socket alive
// (pings, a watchdog, reconnecting with backoff to the same seat), and passes game messages.
import { api, runtimeOrigin, socketURL } from '../runtime';
import { PROTOCOL } from './wire';

export type Role = 'host' | 'guest';

export type SessionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface PeerEvent {
  online: boolean;
  /** The seat was given up (the guest left for good). */
  gone?: boolean;
  name?: string;
  rejoin?: boolean;
}

/** Why a session ended for good. */
export type EndReason = 'host_left' | 'full' | 'no_room' | 'reload' | 'kicked' | 'replaced' | 'failed' | 'left';

const STOPS: Record<number, EndReason> = { 4001: 'replaced', 4003: 'full', 4401: 'failed', 4404: 'no_room', 4410: 'host_left', 4426: 'reload', 4400: 'failed' };

function randomKey(): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => a[b % a.length]).join('');
}

/** Opens a new room: its code and the key that lets this device hold the host's seat. */
export async function createRoom(): Promise<{ code: string; hostKey: string }> {
  return api<{ code: string; hostKey: string }>('/api/room', {});
}

/** Whether a room code is open, and who is in it. */
export async function roomStatus(code: string): Promise<{ open: boolean; host: { name: string; online: boolean } | null; full: boolean } | null> {
  const origin = await runtimeOrigin();
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}/api/room/${encodeURIComponent(code)}`, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return { open: false, host: null, full: false };
    return (await res.json()) as { open: boolean; host: { name: string; online: boolean } | null; full: boolean };
  } catch {
    return null;
  }
}

export class Session {
  readonly role: Role;
  readonly code: string;
  private readonly key: string;
  name: string;
  state: SessionState = 'connecting';
  /** Round trip to the room (ms, smoothed). */
  rtt = 0;
  peerOnline = false;
  peerName = '';
  bytesIn = 0;
  bytesOut = 0;
  onOpen: ((peer: { name: string; online: boolean } | null) => void) | null = null;
  onPeer: ((e: PeerEvent) => void) | null = null;
  onMessage: ((data: unknown) => void) | null = null;
  onState: ((s: SessionState) => void) | null = null;
  onEnd: ((why: EndReason) => void) | null = null;
  private ws: WebSocket | null = null;
  private attempts = 0;
  private heardAt = 0;
  private pingAt = 0;
  private retryTimer = 0;
  private tickTimer = 0;
  private ended = false;

  constructor(role: Role, code: string, name: string, key?: string) {
    this.role = role;
    this.code = code;
    this.name = name;
    if (key) this.key = key;
    else {
      // A guest keeps one seat key per room in this tab, so a reload takes the same seat back.
      const store = `bf-coop-seat:${code}`;
      let k = '';
      try {
        k = window.sessionStorage.getItem(store) ?? '';
      } catch {
        k = '';
      }
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(k)) k = randomKey();
      try {
        window.sessionStorage.setItem(store, k);
      } catch {
        // a reload will take a new seat
      }
      this.key = k;
    }
    this.tickTimer = window.setInterval(() => this.tick(), 2500);
    window.addEventListener('online', this.wake);
    void this.connect();
  }

  get open(): boolean {
    return this.state === 'open';
  }

  private readonly wake = (): void => {
    if (!this.ended && !this.ws) void this.connect();
  };

  private setState(s: SessionState): void {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  private async connect(): Promise<void> {
    if (this.ended) return;
    window.clearTimeout(this.retryTimer);
    const url = await socketURL(`/api/room/${this.code}/ws`);
    if (this.ended) return;
    if (!url) {
      this.retry();
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    this.heardAt = performance.now();
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, role: this.role, key: this.key, name: this.name }));
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws || typeof event.data !== 'string') return;
      this.heardAt = performance.now();
      this.bytesIn += event.data.length;
      this.receive(event.data);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.closed(event.code);
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private receive(text: string): void {
    if (text.charCodeAt(0) === 35) {
      let data: unknown;
      try {
        data = JSON.parse(text.slice(1));
      } catch {
        return;
      }
      this.onMessage?.(data);
      return;
    }
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome': {
        this.attempts = 0;
        this.setState('open');
        const peer = m.peer as { name: string; online: boolean } | null;
        this.peerOnline = Boolean(peer?.online);
        this.peerName = peer?.name ?? '';
        this.onOpen?.(peer);
        break;
      }
      case 'peer': {
        const e: PeerEvent = { online: m.on === true, gone: m.gone === true, name: typeof m.name === 'string' ? m.name : undefined, rejoin: m.rejoin === true };
        if (e.gone) this.peerOnline = false;
        else this.peerOnline = e.online;
        if (e.name) this.peerName = e.name;
        this.onPeer?.(e);
        break;
      }
      case 'pong': {
        if (this.pingAt > 0) {
          const ms = performance.now() - this.pingAt;
          this.rtt = this.rtt === 0 ? ms : this.rtt * 0.7 + ms * 0.3;
          this.pingAt = 0;
        }
        break;
      }
      case 'close': {
        const code = Number(m.code);
        const why = m.why === 'kicked' ? 'kicked' : STOPS[code];
        if (why) this.end(why);
        break;
      }
      default:
        break;
    }
  }

  private closed(code: number): void {
    const why = STOPS[code];
    if (why) {
      this.end(why);
      return;
    }
    this.retry();
  }

  private retry(): void {
    if (this.ended) return;
    this.setState('reconnecting');
    window.clearTimeout(this.retryTimer);
    const wait = Math.min(8000, 500 * 2 ** this.attempts) + Math.random() * 300;
    this.attempts += 1;
    this.retryTimer = window.setTimeout(() => void this.connect(), wait);
  }

  /** Pings (answered by the room even while it sleeps) and a watchdog for a dead line. */
  private tick(): void {
    const ws = this.ws;
    if (!ws || this.ended) return;
    if (performance.now() - this.heardAt > 14000) {
      this.ws = null;
      try {
        ws.close();
      } catch {
        // already closing
      }
      this.retry();
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      this.pingAt = performance.now();
      ws.send('{"t":"ping"}');
    }
  }

  /** Sends a game message to the other seat (dropped while the line is down). */
  send(data: unknown): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.state !== 'open') return false;
    const text = `#${JSON.stringify(data)}`;
    this.bytesOut += text.length;
    ws.send(text);
    return true;
  }

  /** Data waiting to go out on the socket (to skip snapshots while it backs up). */
  get backlog(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  kick(): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send('{"t":"kick"}');
  }

  /** Leaves on purpose (a host leaving closes the room). */
  leave(): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send('{"t":"bye"}');
      } catch {
        // closing anyway
      }
    }
    this.end('left');
  }

  private end(why: EndReason): void {
    if (this.ended) return;
    this.ended = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.tickTimer);
    window.removeEventListener('online', this.wake);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000);
      } catch {
        // already closed
      }
    }
    this.setState('closed');
    this.onEnd?.(why);
  }
}
