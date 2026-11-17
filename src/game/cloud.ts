// Cloud saves. Every time the game saves, the save also goes up to the game's backend, filed
// under this device's cloud code: 16 random characters (shown as XXXX-XXXX-XXXX-XXXX) that only
// the player's own devices know. Typing the code in on another phone or computer brings the same
// fortress over. A device that finds the cloud copy further along than its own (saved by another
// device since) takes the cloud copy.
import { api, runtimeOrigin } from './runtime';

const STATE_KEY = 'block-fortress-cloud-v1';
/** Crockford base32: no I, L, O or U to misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RETRY_MS = 20000;

export interface CloudInfo {
  day: number;
  nights: number;
  blocks: number;
  level: number;
  /** When it was saved (this device's clock, for display). */
  at: number;
}

export type CloudState = 'off' | 'syncing' | 'saved' | 'pending' | 'offline' | 'error';

interface Stored {
  code: string;
  rev: number;
  dirty: boolean;
  cleared: boolean;
  savedAt: number;
  day: number;
}

/** A typed-in code as stored (16 characters), or null if it cannot be one. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s_-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  return /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/.test(s) ? s : null;
}

export function formatCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

interface GetReply {
  ok: boolean;
  rev: number;
  savedAt: number;
  info: Partial<CloudInfo> | null;
  save: string | null;
}

export class CloudSaves {
  code: string | null = null;
  /** The cloud revision this device's save matches (0: none yet). */
  rev = 0;
  /** A local save not yet in the cloud. */
  dirty = false;
  /** NEW GAME abandoned the local save at `rev` (the cloud copy of that game is not brought back). */
  cleared = false;
  state: CloudState = 'off';
  /** When this device last saved to (or matched) the cloud, and the day it was. */
  savedAt = 0;
  day = 0;
  onChange: (() => void) | null = null;
  private queued: { json: string; info: CloudInfo } | null = null;
  private busy = false;
  private retry = 0;

  constructor() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(STATE_KEY) ?? 'null') as Partial<Stored> | null;
      if (raw && typeof raw.code === 'string' && normalizeCode(raw.code)) {
        this.code = raw.code;
        this.rev = Number(raw.rev) || 0;
        this.dirty = Boolean(raw.dirty);
        this.cleared = Boolean(raw.cleared);
        this.savedAt = Number(raw.savedAt) || 0;
        this.day = Number(raw.day) || 0;
        this.state = this.dirty ? 'pending' : 'saved';
      }
    } catch {
      // a fresh start
    }
    window.addEventListener('online', () => void this.flush());
  }

  private persist(): void {
    if (!this.code) return;
    try {
      const s: Stored = { code: this.code, rev: this.rev, dirty: this.dirty, cleared: this.cleared, savedAt: this.savedAt, day: this.day };
      window.localStorage.setItem(STATE_KEY, JSON.stringify(s));
    } catch {
      // storage may be unavailable; the cloud copy still goes up
    }
  }

  private set(state: CloudState): void {
    this.state = state;
    this.onChange?.();
  }

  /** Whether the backend can be reached at all (decides whether the cloud features show). */
  async available(): Promise<boolean> {
    return (await runtimeOrigin()) !== null;
  }

  /** After each local save: the newest save goes up (one upload at a time). */
  push(json: string, info: CloudInfo): void {
    if (!this.code) this.code = newCode();
    this.dirty = true;
    this.cleared = false;
    this.day = info.day;
    this.persist();
    this.queued = { json, info };
    if (!this.busy) this.set('pending');
    void this.flush();
  }

  /** NEW GAME: the old game's cloud copy is not brought back to this device. */
  forget(): void {
    if (!this.code) return;
    this.cleared = true;
    this.dirty = false;
    this.queued = null;
    this.persist();
    this.onChange?.();
  }

  private async flush(): Promise<void> {
    if (this.busy || !this.queued || !this.code) return;
    const job = this.queued;
    this.queued = null;
    this.busy = true;
    this.set('syncing');
    try {
      const r = await api<{ ok: boolean; rev: number; savedAt: number }>('/api/save/put', { key: this.code, save: job.json, info: job.info });
      this.rev = r.rev;
      this.savedAt = Date.now();
      this.dirty = this.queued !== null;
      this.persist();
      this.state = this.dirty ? 'pending' : 'saved';
    } catch (error) {
      // Kept for a later try (unless a newer save has come along meanwhile).
      this.queued ??= job;
      this.state = String(error).includes('offline') ? 'offline' : 'error';
      window.clearTimeout(this.retry);
      this.retry = window.setTimeout(() => void this.flush(), RETRY_MS);
    } finally {
      this.busy = false;
      this.onChange?.();
    }
    if (this.queued && this.state === 'pending') void this.flush();
  }

  /**
   * At start-up: when another device has saved this code's game since this device last did, its
   * copy replaces the local one (`write`). A local save the cloud has not seen goes up instead.
   */
  async sync(local: { json: string; info: CloudInfo } | null, write: (json: string) => boolean): Promise<'adopted' | 'pushed' | 'same' | 'none' | 'offline' | 'late'> {
    if (!this.code) {
      this.set('off');
      return 'none';
    }
    let r: GetReply;
    try {
      this.set('syncing');
      r = await api<GetReply>('/api/save/get', { key: this.code });
    } catch {
      this.set('offline');
      return 'offline';
    }
    const cloudDay = Number(r.info?.day) || 0;
    if (r.save && r.rev > this.rev && !(this.dirty && local && local.info.day > cloudDay)) {
      // (A game already under way keeps going; the newer copy waits for the next start.)
      if (!write(r.save)) {
        this.set('saved');
        return 'late';
      }
      this.rev = r.rev;
      this.dirty = false;
      this.cleared = false;
      this.day = cloudDay;
      this.savedAt = Number(r.info?.at) || Date.now();
      this.persist();
      this.set('saved');
      return 'adopted';
    }
    if (r.save && !local && !this.cleared) {
      if (!write(r.save)) {
        this.set('saved');
        return 'late';
      }
      this.rev = r.rev;
      this.day = cloudDay;
      this.persist();
      this.set('saved');
      return 'adopted';
    }
    if (local && (this.dirty || !r.save || r.rev > this.rev)) {
      this.push(local.json, local.info);
      return 'pushed';
    }
    this.set(local || !this.cleared ? 'saved' : 'off');
    return 'same';
  }

  /** Looks up the game behind a code typed in from another device. */
  async peek(input: string): Promise<{ code: string; rev: number; info: Partial<CloudInfo>; save: string } | 'bad' | 'empty' | 'offline'> {
    const code = normalizeCode(input);
    if (!code) return 'bad';
    try {
      const r = await api<GetReply>('/api/save/get', { key: code });
      if (!r.save) return 'empty';
      return { code, rev: r.rev, info: r.info ?? {}, save: r.save };
    } catch {
      return 'offline';
    }
  }

  /** Takes another device's game (found by `peek`): this device now saves under that code. */
  adopt(found: { code: string; rev: number; info: Partial<CloudInfo>; save: string }, write: (json: string) => void): void {
    write(found.save);
    this.code = found.code;
    this.rev = found.rev;
    this.dirty = false;
    this.cleared = false;
    this.queued = null;
    this.day = Number(found.info.day) || 0;
    this.savedAt = Number(found.info.at) || Date.now();
    this.persist();
    this.set('saved');
  }
}
