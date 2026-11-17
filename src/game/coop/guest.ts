// The co-op guest: this game shows its mate's world. On arrival the host sends the world as it
// stands (its seed, the game as a save, every edit); this game rebuilds it, then follows the
// host's snapshots a moment behind (so everything moves smoothly), moves its own body itself and
// sends its pose and actions back. The world's own rules all run on the host.
import type { Material, SfxName } from '../audio';
import { BlockBody } from '../body';
import { applyLift, HOIST_STAGES, LIFT_LERP, mirrorCraneDrop, mirrorHoist, playCraneFx } from '../crane';
import type { CellRow } from '../fortress';
import type { EffectId } from '../effects';
import { Actor, type FallingBlock, type ItemDrop, type Projectile } from '../entities';
import type { Airdrop } from '../events';
import { feat } from '../feats';
import type { Game, Ray, SaveData, Target } from '../game';
import { createGiant, type Giant, type GiantType } from '../giants';
import type { Vec3 } from '../math3d';
import { setMySkin } from '../models';
import type { Fang } from '../monsters';
import { OFFICERS } from '../officers';
import { makePet, type Pet } from '../pet';
import { PlayerCtx } from '../player-ctx';
import type { StructKind } from '../structures';
import { poseView, type MateShown } from './avatar';
import { SHARED, type Lookup } from './mirror';
import { roomStatus, Session, type EndReason } from './session';
import {
  ACTOR_LERP, AF, applyActor, applyBody, applyCrate, applyDrop, applyFalling, applyFang, applyLegs, applyPose, applyProjectile,
  CRATE_LERP, DROP_LERP, FALL_LERP, FANG_LERP, FRAME_FORTRESS, FRAME_GIANT, FRAME_WORLD, KINDS, lerpValues, P, patchValues, PF, POSE_LERP,
  POSE_SIZE, PROJ_LERP, q2, q3, SNAP_HZ, STALL_MS,
  type EntDelta, type GiantDelta, type HoistDelta, type Lerp, type ListName, type Snapshot, type WelcomeState,
} from './wire';

/** How far behind the host's clock this game shows the world (seconds): a snapshot or two. */
const DELAY = 0.15;
const BODY_LERP: Lerp[] = [1, 1, 1, 2];
/** A load on the crane: its pose, then its lean and the crane's own pose. */
const HOIST_LERP: Lerp[] = [...BODY_LERP, ...LIFT_LERP];
const WALK_LERP: Lerp[] = [1, 0, 1, 1];
const PET_LERP: Lerp[] = [...ACTOR_LERP, 1, 1, 1];
const LIST_LERP: Record<ListName, Lerp[]> = { m: ACTOR_LERP, v: ACTOR_LERP, a: ACTOR_LERP, c: ACTOR_LERP, pr: PROJ_LERP, dr: DROP_LERP, fb: FALL_LERP, ad: CRATE_LERP, fg: FANG_LERP, pt: PET_LERP };
const ACTOR_LISTS = new Set<ListName>(['m', 'v', 'a', 'c', 'pt']);

/** Continuous state at one moment of the host's clock (poses and records, eased between). */
interface Frame {
  tm: number;
  f: number[];
  wk: number[];
  legs: number[];
  gi: Map<number, { p: number[]; wk: number[]; legs: number[] }>;
  ho: number[] | null;
  e: Map<ListName, Map<number, number[]>>;
  h: number[] | null;
}

type Mirror = Actor | Projectile | ItemDrop | FallingBlock | Airdrop | Fang;

export type GuestStatus = 'connecting' | 'waiting' | 'loading' | 'playing' | 'reconnecting' | 'closed';

/** What each way a session can end means for the guest. */
const ENDINGS: Record<EndReason, string> = {
  host_left: 'Your mate closed the game',
  full: 'That fortress already has two players',
  no_room: 'No game with that code (check it, or ask for a new one)',
  reload: 'Your mate has a different version: reload the page to play together',
  kicked: 'Your mate sent you off the fortress',
  replaced: 'You joined from another tab',
  failed: 'Could not connect',
  left: 'You left the co-op game',
};

export class CoopGuest {
  readonly g: Game;
  readonly session: Session;
  readonly code: string;
  hostName = '';
  status: GuestStatus = 'connecting';
  /** Why it ended (shown in the co-op panel). */
  ended: string | null = null;
  /** Loading the world (0..1) once it has started coming in. */
  progress = 0;
  onChange: (() => void) | null = null;
  /** Called once when the session is over and this game has gone back to its own title. */
  onEnded: ((why: string) => void) | null = null;
  private joined = false;
  private chunks: string[] = [];
  private pending: Snapshot[] = [];
  private frames: Frame[] = [];
  private recs = new Map<ListName, Map<number, number[]>>();
  private mirrors = new Map<number, Mirror>();
  private giantMap = new Map<number, Giant>();
  private pet: Pet | null = null;
  private offset: number | null = null;
  private poseTimer = 0;
  private aimTimer = 0;
  /** When the host's last snapshot came in (performance.now). */
  private snapAt = 0;
  private epoch = 0;
  private hostPose: number[] | null = null;
  private scratch: number[] = [];
  private lastSel: string = '';
  /** Stands in for the host where the game asks "whose is this?" (a building on the crane). */
  private readonly hostCtx = new PlayerCtx('remote');
  private readonly lookup: Lookup = {
    actor: (id) => {
      const m = this.mirrors.get(id);
      return m instanceof Actor ? m : null;
    },
    giant: (id) => this.giantMap.get(id) ?? null,
  };

  /** The host's hearts [now, most] (for the HUD strip). */
  hostHp: [number, number] = [20, 20];
  private hostDown = false;

  /** Joins a room by its code (after checking it is open and has room). */
  static async join(g: Game, code: string, name: string): Promise<CoopGuest | string> {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(clean)) return 'A room code is 5 letters and numbers';
    const st = await roomStatus(clean);
    if (st === null) return 'Could not reach the co-op server: check your connection';
    if (!st.open) return ENDINGS.no_room;
    if (st.full) return ENDINGS.full;
    return new CoopGuest(g, clean, name);
  }

  private constructor(g: Game, code: string, name: string) {
    this.g = g;
    this.code = code;
    this.session = new Session('guest', code, name);
    this.session.onOpen = (peer) => {
      this.hostName = peer?.name ?? this.hostName;
      if (!this.joined) this.status = peer?.online ? 'loading' : 'waiting';
      else this.status = 'playing';
      // Back after a dropped line: the host sends the world again (it may have moved on).
      this.changed();
    };
    this.session.onPeer = (e) => {
      if (e.name) this.hostName = e.name;
      if (!this.joined) this.status = e.online ? 'loading' : 'waiting';
      if (this.joined && !e.online) this.g.ui.toast(`${this.hostName || 'Your mate'} lost the connection: hold on...`, 'ui_coop');
      this.changed();
    };
    this.session.onState = (s) => {
      if (s === 'reconnecting' && this.joined) this.status = 'reconnecting';
      this.changed();
    };
    this.session.onMessage = (data) => this.receive(data);
    this.session.onEnd = (why) => this.end(ENDINGS[why]);
    g.coopGuest = this;
  }

  private changed(): void {
    this.onChange?.();
  }

  get ping(): number {
    return Math.round(this.session.rtt);
  }

  get playing(): boolean {
    return this.joined && !this.ended;
  }

  /** The line holds but the host's world has gone quiet (its app in the background, a frozen tab). */
  get stalled(): boolean {
    return this.playing && this.status === 'playing' && performance.now() - this.snapAt > STALL_MS;
  }

  /** What the host is up to, by its last pose (for the HUD strip). */
  get hostRole(): 'helm' | 'guns' | 'down' | 'aboard' {
    const fl = this.hostPose?.[P.flags] ?? 0;
    return fl & PF.dead ? 'down' : fl & PF.helm ? 'helm' : fl & PF.gunner ? 'guns' : 'aboard';
  }

  // ------------------------------------------------------------------ from the host

  private receive(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const m = data as { t?: unknown; i?: unknown; n?: unknown; d?: unknown };
    if (m.t === 'w') {
      const i = Number(m.i);
      const n = Number(m.n);
      if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > 64 || typeof m.d !== 'string') return;
      if (i === 0 || this.chunks.length !== n) this.chunks = new Array<string>(n).fill('');
      this.chunks[i] = m.d;
      const got = this.chunks.filter((c) => c.length > 0).length;
      this.progress = got / n;
      if (!this.joined) this.status = 'loading';
      this.changed();
      if (got < n) return;
      let state: WelcomeState;
      try {
        state = JSON.parse(this.chunks.join('')) as WelcomeState;
      } catch {
        this.chunks = [];
        this.session.send({ t: 'again' });
        return;
      }
      this.chunks = [];
      this.build(state);
      return;
    }
    if (m.t === 's' && this.joined) {
      this.snapAt = performance.now();
      this.ingest(data as Snapshot);
    }
  }

  /** The world as the host has it: rebuilt (or brought up to date), then play begins. */
  private build(state: WelcomeState): void {
    const g = this.g;
    const save = state.save as SaveData;
    this.hostName = state.host || this.hostName;
    const same = this.joined && g.seed === state.seed && g.world !== undefined;
    g.coopGuest = this;
    if (!same) {
      g.prepare(state.seed, save);
    } else {
      for (const id of save.hoisted) g.world.hoisted.add(id);
      for (const k of save.looted) g.world.lootedChests.add(k);
    }
    g.world.setRemoteEdits(state.edits);
    // Nothing of the last state carries over: mirrors, frames and records start afresh.
    this.pending = [];
    this.frames = [];
    this.recs.clear();
    this.mirrors.clear();
    this.giantMap.clear();
    g.giants = [];
    g.hoist = null;
    g.craneDrop = null;
    this.pet = null;
    g.pet = null;
    this.offset = null;
    this.hostPose = null;
    this.lastSel = '';
    // The first snapshot is the whole world: in at once.
    this.ingest(state.snap);
    const first = this.pending.shift();
    if (first) this.applyDiscrete(first, true);
    this.interpolate(state.snap.tm);
    g.time = state.snap.tm;
    // Aboard where the host put us.
    const F = g.fortress;
    const p = g.player;
    const [x, y, z] = F.toWorld(state.spawn[0], state.spawn[1], state.spawn[2]);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.standingOn = F;
    p.onGround = true;
    p.dead = false;
    p.chute = 0;
    g.yaw = state.yaw;
    g.pitch = -0.1;
    g.tutorialStep = 99;
    g.intro = null;
    g.paused = false;
    g.modal = 'none';
    g.helm = false;
    g.gunner = false;
    setMySkin('builder2');
    if (!same) {
      g.streamAll(2);
      g.renderer.prebuild(g, 400);
    }
    g.audio.ambience(g.phase === 'night' || g.siege ? 'night' : 'day');
    g.ui.onPhaseChanged();
    g.ui.onInventoryChanged();
    this.joined = true;
    this.status = 'playing';
    this.progress = 1;
    this.snapAt = performance.now();
    this.session.send({ t: 'ready' });
    if (!same) g.ui.banner('ABOARD!', `${this.hostName || 'Your mate'}'s fortress: one of you steers, the other mans the guns`, 'gold');
    this.changed();
  }

  /** A snapshot arrives: its records and poses become a frame; the rest waits for its moment. */
  private ingest(s: Snapshot): void {
    const now = performance.now() / 1000;
    const off = s.tm - now;
    if (this.offset === null || off > this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.03;
    // What happens to this player's own body happens now (it is not shown behind).
    if (s.fx) {
      const later: unknown[][] = [];
      for (const e of s.fx) {
        if (e[0] === 'k') this.own(e);
        else later.push(e);
      }
      s.fx = later;
    }
    const e = new Map<ListName, Map<number, number[]>>();
    if (s.e) for (const [name, d] of Object.entries(s.e)) this.patch(name as ListName, d);
    for (const [name, recs] of this.recs) e.set(name, new Map(recs));
    const last = this.frames[this.frames.length - 1];
    const gi = new Map<number, { p: number[]; wk: number[]; legs: number[] }>();
    if (s.gi) {
      for (const [k, d] of Object.entries(s.gi)) {
        if (d === 0) continue;
        gi.set(Number(k), { p: d.p, wk: d.wk ?? [0, 0, 0, 1000], legs: d.legs ?? [] });
      }
    }
    const frame: Frame = {
      tm: s.tm,
      f: s.f?.p ?? last?.f ?? [0, 0, 0, 0],
      wk: s.f?.wk ?? last?.wk ?? [0, 0, 0, 1000],
      legs: s.f?.legs ?? last?.legs ?? [],
      gi,
      ho: s.ho === 0 ? null : s.ho ? s.ho.p : last?.ho ?? null,
      e,
      h: s.h ?? last?.h ?? null,
    };
    // (A late snapshot cannot rewrite history: frames stay in order.)
    if (last && frame.tm < last.tm) frame.tm = last.tm;
    this.frames.push(frame);
    if (this.frames.length > 40) this.frames.splice(0, this.frames.length - 40);
    this.pending.push(s);
  }

  /** Brings a list's latest records up to date (new, changed, gone). */
  private patch(name: ListName, d: EntDelta): void {
    let recs = this.recs.get(name);
    if (!recs) {
      recs = new Map();
      this.recs.set(name, recs);
    }
    for (const n of d.n ?? []) recs.set(n[0]!, n.slice(1));
    for (const u of d.u ?? []) {
      const old = recs.get(u[0]!);
      if (!old) continue;
      const next = old.slice();
      patchValues(next, u, 1);
      recs.set(u[0]!, next);
    }
    for (const id of d.r ?? []) recs.delete(id);
  }

  // ------------------------------------------------------------------ each frame

  /** Shows the world at the host's time a moment ago, then moves this player and reports it. */
  update(dt: number): void {
    const g = this.g;
    if (!this.joined || this.ended) return;
    const rt = performance.now() / 1000 + (this.offset ?? 0) - DELAY;
    while (this.pending.length && this.pending[0]!.tm <= rt) this.applyDiscrete(this.pending.shift()!, false);
    g.time = Math.max(g.time, rt);
    // Bodies remember where they were (whoever rides them is carried by how they moved).
    g.fortress.savePose();
    for (const gi of g.giants) gi.body.savePose();
    g.hoist?.cargo.savePose();
    this.interpolate(rt);
    g.mirrorStep(dt);
    if (g.phase === 'day' || g.phase === 'night') {
      g.own(() => g.updatePlayer(dt));
      if (g.holdRay) g.mining.swing = Math.max(g.mining.swing, 0.2);
    }
    this.aimTimer -= dt;
    this.poseTimer -= dt;
    if (this.poseTimer <= 0) {
      this.poseTimer = Math.max(0, this.poseTimer + 1 / SNAP_HZ);
      this.sendPose();
    }
  }

  /** Eases poses and records between the frames on either side of `rt`. */
  private interpolate(rt: number): void {
    const g = this.g;
    const fr = this.frames;
    if (!fr.length) return;
    let ai = 0;
    while (ai + 1 < fr.length && fr[ai + 1]!.tm <= rt) ai += 1;
    if (ai > 0) fr.splice(0, ai);
    const A = fr[0]!;
    const B = fr[1] ?? null;
    const t = B ? Math.max(0, Math.min(1, (rt - A.tm) / Math.max(1e-3, B.tm - A.tm))) : 0;
    const mix = (a: number[], b: number[] | undefined, lerp: Lerp[]): number[] => (b && b.length === a.length ? lerpValues(a, b, t, lerp, []) : a);
    const F = g.fortress;
    applyPose(F, mix(A.f, B?.f, BODY_LERP));
    const wk = mix(A.wk, B?.wk, WALK_LERP);
    F.walkPhase = wk[0]! / 100;
    F.moving = wk[1] === 1;
    F.shake = wk[2]! / 100;
    g.walker.scale = (wk[3] ?? 1000) / 1000;
    applyLegs(g.walker, mix(A.legs, B?.legs, A.legs.map(() => 1 as Lerp)));
    for (const [id, a] of A.gi) {
      const gi = this.giantMap.get(id);
      if (!gi) continue;
      const b = B?.gi.get(id);
      applyPose(gi.body, mix(a.p, b?.p, BODY_LERP));
      const gw = mix(a.wk, b?.wk, WALK_LERP);
      gi.body.walkPhase = gw[0]! / 100;
      gi.body.moving = gw[1] === 1;
      gi.body.shake = gw[2]! / 100;
      gi.walker.scale = (gw[3] ?? 1000) / 1000;
      applyLegs(gi.walker, mix(a.legs, b?.legs, a.legs.map(() => 1 as Lerp)));
    }
    if (g.hoist && A.ho) {
      const v = mix(A.ho, B?.ho ?? undefined, HOIST_LERP);
      applyPose(g.hoist.cargo, v);
      applyLift(g, g.hoist, v);
    }
    // Everything that moves on its own, list by list (there only once it has turned up).
    const lists: Record<ListName, Mirror[]> = { m: [], v: [], a: [], c: [], pr: [], dr: [], fb: [], ad: [], fg: [], pt: [] };
    for (const [name, recs] of A.e) {
      const bRecs = B?.e.get(name);
      const lerp = LIST_LERP[name];
      for (const [id, ra] of recs) {
        const rb = bRecs?.get(id);
        const rec = rb && rb.length === ra.length ? lerpValues(ra, rb, t, lerp, this.scratch) : ra;
        const m = this.mirror(name, id, rec);
        if (m) lists[name].push(m);
      }
    }
    g.mobs = lists.m as Actor[];
    g.villagers = lists.v as Actor[];
    g.animals = lists.a as Actor[];
    g.corpses = lists.c as Actor[];
    g.projectiles = lists.pr as Projectile[];
    g.drops = lists.dr as ItemDrop[];
    g.falling = lists.fb as FallingBlock[];
    g.airdrops = lists.ad as Airdrop[];
    g.fangs = lists.fg as Fang[];
    g.pet = lists.pt.length ? this.pet : null;
    // Gone from every list: forgotten.
    if (this.mirrors.size > 64) {
      const alive = new Set<Mirror>(Object.values(lists).flat());
      for (const [id, m] of this.mirrors) if (!alive.has(m)) this.mirrors.delete(id);
    }
    const h = A.h;
    if (h) this.hostPose = B?.h && B.h.length === h.length && B.h[P.frame] === h[P.frame] ? lerpValues(h, B.h, t, POSE_LERP, []) : h;
    // The host knocked out: this player hears of it.
    const down = ((this.hostPose?.[P.flags] ?? 0) & PF.dead) !== 0;
    if (down !== this.hostDown) {
      this.hostDown = down;
      if (down && this.joined) g.ui.toast(`${this.hostName || 'Your mate'} is knocked out: back aboard in a moment`, 'ui_coop');
    }
  }

  /** The mirror standing for an entity (made when it first turns up), with its record applied. */
  private mirror(name: ListName, id: number, rec: number[]): Mirror | null {
    const g = this.g;
    let m = this.mirrors.get(id);
    if (ACTOR_LISTS.has(name)) {
      const kind = KINDS[rec[27]!] ?? 'zombie';
      let a = m instanceof Actor && m.kind === kind ? m : null;
      if (!a) {
        a = new Actor(kind, rec[0]! / 100, rec[1]! / 100, rec[2]! / 100);
        if (name === 'pt') {
          this.pet = makePet(a.x, a.y, a.z);
          a = this.pet.a;
        }
        this.mirrors.set(id, a);
      }
      applyActor(a, rec);
      if (a.kind === 'npc') a.npc = OFFICERS[a.tint]?.id ?? '';
      a.dead = name === 'c' || a.dead;
      const mount = rec[32]!;
      a.mount = mount ? this.lookup.actor(mount) : null;
      a.standingOn = (rec[18]! & AF.deck) !== 0 ? g.fortress : null;
      if (name === 'pt' && this.pet) {
        this.pet.sit = rec[44]! / 100;
        this.pet.happy = rec[45]! / 100;
        this.pet.howl = rec[46]! / 100;
      }
      return a;
    }
    switch (name) {
      case 'pr': {
        const pr = (m as Projectile | undefined) ?? { kind: 'tnt', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 99, spin: 0, fromCrew: false };
        applyProjectile(pr, rec);
        m = pr;
        break;
      }
      case 'dr': {
        const d = (m as ItemDrop | undefined) ?? { id: 0, count: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0 };
        applyDrop(d, rec);
        m = d;
        break;
      }
      case 'fb': {
        const f = (m as FallingBlock | undefined) ?? { id: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, vr: 0, age: 0, drop: false };
        applyFalling(f, rec);
        m = f;
        break;
      }
      case 'ad': {
        const c = (m as Airdrop | undefined) ?? { x: 0, y: 0, z: 0, ground: 0, sway: 0, loot: [], chest: null, t: 0 };
        applyCrate(c, rec);
        m = c;
        break;
      }
      case 'fg': {
        const f = (m as Fang | undefined) ?? { x: 0, y: 0, z: 0, yaw: 0, t: 0, bit: false };
        applyFang(f, rec);
        m = f;
        break;
      }
      default:
        return null;
    }
    this.mirrors.set(id, m);
    return m;
  }

  // ------------------------------------------------------------------ discrete changes

  private applyDiscrete(s: Snapshot, full: boolean): void {
    const g = this.g;
    if (s.f) applyBody(g.fortress, s.f, full);
    if (s.gi) this.applyGiants(s.gi, full);
    if (s.ho !== undefined) this.applyHoist(s.ho);
    if (s.cd !== undefined) mirrorCraneDrop(g, s.cd, this.hostCtx);
    const w = s.w;
    if (w) for (let i = 0; i + 4 < w.length; i += 5) g.world.setRemote(w[i]!, w[i + 1]!, w[i + 2]!, w[i + 3]!, w[i + 4]!);
    for (const id of s.hz ?? []) g.world.hoisted.add(id);
    for (const k of s.lc ?? []) g.world.lootedChests.add(k);
    if (s.g) this.applyShared(s.g);
    for (const e of s.fx ?? []) this.play(e);
    if (s.me) this.applyMe(s.me);
  }

  private applyGiants(gi: Record<string, GiantDelta | 0>, full: boolean): void {
    const g = this.g;
    if (full) this.giantMap.clear();
    for (const [k, d] of Object.entries(gi)) {
      const id = Number(k);
      if (d === 0) {
        this.giantMap.delete(id);
        continue;
      }
      let giant = this.giantMap.get(id);
      if (!giant || d.type) {
        const [cx, cz] = [d.p[0]! / 100, d.p[2]! / 100];
        giant = createGiant((d.type ?? 'brute') as GiantType, cx, cz, 0, 1);
        giant.name = d.name ?? giant.name;
        this.giantMap.set(id, giant);
        applyBody(giant.body, d, true);
        applyPose(giant.body, d.p);
        giant.body.savePose();
      } else applyBody(giant.body, d, false);
      const st = d.st;
      if (st) {
        giant.dead = st[0] === 1;
        giant.blind = st[1] === 1;
        giant.rage = st[2]!;
        giant.windup = st[3]! / 100;
        giant.contact = st[4] === 1;
        giant.charge = st[5]! / 100;
        giant.heavy = st[6] === 1;
        giant.aimKey = st[7]! >= 0 ? st[7]! : null;
        giant.aimT = st[8]! / 100;
        giant.roared = st[9] === 1;
        giant.lair = st[10]! >= 0 ? st[10]! : undefined;
        giant.dormant = st[11] === 1;
        giant.guardian = st[12] === 1 || undefined;
      }
    }
    g.giants = [...this.giantMap.values()];
  }

  private applyHoist(d: HoistDelta | 0): void {
    const g = this.g;
    if (d === 0) {
      g.hoist = null;
      return;
    }
    const s = g.world.structures.byId.get(d.sid);
    if (!s) return;
    let h = g.hoist;
    if (!h || h.s !== s) {
      h = mirrorHoist(s, this.hostCtx, { kind: s.kind as StructKind, hub: null, dir: 0 });
      g.hoist = h;
      applyBody(h.cargo, d, true);
      applyPose(h.cargo, d.p);
      applyLift(g, h, d.p);
      h.cargo.savePose();
    } else applyBody(h.cargo, d, false);
    h.stage = HOIST_STAGES[d.stage] ?? 'reach';
    h.t = d.t;
    h.mid = [d.mid[0] ?? 0, d.mid[1] ?? 0, d.mid[2] ?? 0];
    h.by = d.by === 1 ? g.me : this.hostCtx;
    h.info = d.info as typeof h.info;
    h.strain = d.st ?? 0;
    h.perfect = [((d.pf ?? 0) & 1) !== 0, ((d.pf ?? 0) & 2) !== 0];
    const ev = d.eav ?? [];
    for (let i = 0; i < 4 && ev.length >= 12; i += 1) h.eaves[i] = [ev[i * 3]!, ev[i * 3 + 1]!, ev[i * 3 + 2]!];
    if (d.ax && d.ax.length >= 2) h.axis = [d.ax[0]!, d.ax[1]!];
    if (d.tr !== undefined) h.trim = d.tr;
    if (d.base) {
      const rows: CellRow[] = [];
      for (let i = 0; i + 4 < d.base.length; i += 5) rows.push([d.base[i]!, d.base[i + 1]!, d.base[i + 2]!, d.base[i + 3]!, d.base[i + 4]!]);
      h.base = rows;
    }
  }

  private applyShared(sh: Record<string, unknown>): void {
    const g = this.g;
    const phase = g.phase;
    const siege = g.siege;
    for (const [k, v] of Object.entries(sh)) {
      const f = SHARED[k];
      if (f) f.set(g, v as never, this.lookup);
    }
    if (g.phase !== phase || g.siege !== siege) {
      g.audio.ambience(g.phase === 'night' || g.siege ? 'night' : g.phase === 'day' ? 'day' : 'none');
      if (g.phase !== phase) g.ui.onPhaseChanged();
    }
  }

  /** This player's own state as the host keeps it. */
  private applyMe(me: Record<string, unknown>): void {
    const g = this.g;
    const p = g.player;
    const n = (k: string): number => Number(me[k]) || 0;
    p.hp = n('hp');
    p.maxHp = n('mh') || p.maxHp;
    const dead = me.dead === true;
    if (dead && !p.dead) {
      p.vx = p.vz = 0;
      g.holdRay = null;
    }
    p.dead = dead;
    g.respawnTimer = n('rs');
    g.hunger = n('hu');
    g.behind = n('bh');
    const before = JSON.stringify([...g.effects].map(([id, e]) => [id, e.level]));
    g.effects.clear();
    for (const e of (me.ef as Array<[EffectId, number, number]>) ?? []) g.effects.set(e[0], { t: e[1] < 0 ? Infinity : e[1], level: e[2], tick: 1 });
    if (JSON.stringify([...g.effects].map(([id, e]) => [id, e.level])) !== before) g.ui.effectsChanged();
    const helm = me.helm === true;
    const gunner = me.gun === true;
    if (helm !== g.helm || gunner !== g.gunner) {
      g.helm = helm;
      g.gunner = gunner;
      g.holdRay = null;
      if (helm) g.pitch = g.helmCam.pitch;
    }
    if (me.car === 1 && !g.carried) g.carried = new Actor('chicken', p.x, p.y + 1, p.z);
    else if (me.car !== 1) g.carried = null;
    g.mining.progress = n('mp');
    g.mining.target = this.target(me.mt);
    // The host's word on what is in hand counts when it changes (an item used up, bread eaten).
    const sel = `${n('sel')},${String(me.mode)}`;
    if (sel !== this.lastSel) {
      this.lastSel = sel;
      const id = n('sel');
      g.selected = id < 0 ? null : id;
      g.mode = me.mode === 'build' ? 'build' : 'mine';
      g.ui.onInventoryChanged();
    }
  }

  private target(v: unknown): Target | null {
    if (!Array.isArray(v) || v.length < 6) return null;
    const [kind, gid, x, y, z, id] = v as number[];
    const giant = kind === 2 ? this.giantMap.get(gid!) ?? null : null;
    const body = kind === 1 ? this.g.fortress : giant ? giant.body : null;
    if (kind === 2 && !giant) return null;
    return { kind: kind === 0 ? 'world' : kind === 1 ? 'fortress' : 'giant', body, giant, x: x!, y: y!, z: z!, nx: 0, ny: 1, nz: 0, id: id!, dist: 1, sig: `${kind},${x},${y},${z}` };
  }

  /** One effect from the host's world: a sound, particles, a light, news, a sweep or a ring. */
  private play(e: unknown[]): void {
    const g = this.g;
    switch (e[0]) {
      case 's':
        g.audio.play(e[1] as SfxName, e[2] as Material, Number(e[3]), Number(e[4]));
        break;
      case 'S':
        g.sfxHere(e[1] as SfxName, Number(e[2]), Number(e[3]), Number(e[4]), Number(e[5]), Number(e[6]), Number(e[7]) || 42, (e[8] ?? 'stone') as Material);
        break;
      case 'p': {
        const fn = (g.particles as unknown as Record<string, (...a: unknown[]) => void>)[e[1] as string];
        if (typeof fn === 'function') fn.apply(g.particles, e.slice(2));
        break;
      }
      case 'l':
        g.lights.push({ x: Number(e[1]), y: Number(e[2]), z: Number(e[3]), r: Number(e[4]), color: [Number(e[5]), Number(e[6]), Number(e[7])], life: Number(e[8]), max: Number(e[9]) });
        break;
      case 'u':
        this.news(String(e[1]), (e[2] as unknown[]) ?? []);
        break;
      case 'cel':
        g.celebrate(Number(e[1]) || 3);
        break;
      case 'cr':
        playCraneFx(g, e.slice(1));
        break;
      case 'sl':
        g.slashes.push({ x: Number(e[1]), y: Number(e[2]), z: Number(e[3]), yaw: Number(e[4]), crit: e[5] === 1, t: Number(e[6]) || 0 });
        break;
      case 'sh':
        g.shocks.push({ x: Number(e[1]), y: Number(e[2]), z: Number(e[3]), r0: Number(e[4]), r1: Number(e[5]), t: Number(e[6]), life: Number(e[7]), width: Number(e[8]), power: Number(e[9]) });
        break;
      case 'ar':
        g.stuckArrows.push(e[1] as Game['stuckArrows'][number]);
        break;
      default:
        break;
    }
  }

  /** Something for this screen from the host's game (its own news, or the world's). */
  private news(method: string, args: unknown[]): void {
    const ui = this.g.me.ui as unknown as Record<string, (...a: unknown[]) => void>;
    if (method === 'say') {
      const at: Vec3 = [Number(args[0]), Number(args[1]), Number(args[2])];
      this.g.me.ui.say(() => at, String(args[3]), args[4] as Parameters<Game['ui']['say']>[2]);
      return;
    }
    const fn = ui[method];
    if (typeof fn === 'function') fn.apply(this.g.me.ui, args);
  }

  /** Happens to this player's own body (now, not a moment behind like the world). */
  private own(e: unknown[]): void {
    const g = this.g;
    const p = g.player;
    const n = (i: number): number => Number(e[i]) || 0;
    switch (e[1]) {
      case 'sfx':
        g.audio.play(e[2] as SfxName, e[3] as Material, n(4), n(5) || 1);
        break;
      case 'buzz':
        g.buzz(n(2));
        break;
      case 'punch':
        g.punch(n(2));
        break;
      case 'shake':
        g.renderer.shake(n(2));
        break;
      case 'feat':
        feat(g, String(e[2]), n(3) || 1);
        break;
      case 'hurt': {
        // The host took the hearts; the blow's shove is this body's to feel.
        p.hurt = 0.35;
        p.vx += n(3);
        p.vz += n(4);
        if (Math.hypot(n(3), n(4)) > 0.1) {
          p.vy = Math.max(p.vy, 4);
          p.onGround = false;
          p.standingOn = null;
        }
        g.tookHit(n(2), n(3), n(4));
        break;
      }
      case 'fling':
        p.vx = n(2);
        p.vy = n(3);
        p.vz = n(4);
        p.onGround = false;
        p.standingOn = null;
        break;
      case 'hit':
        g.hitMarker(n(2) === 1);
        break;
      case 'moved': {
        // The host put this player somewhere (a respawn, a pearl, the helm, the guns).
        const frame = n(2);
        const F = g.fortress;
        const [x, y, z] = frame === FRAME_FORTRESS ? F.toWorld(n(3) / 100, n(4) / 100, n(5) / 100) : [n(3) / 100, n(4) / 100, n(5) / 100];
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = p.vy = p.vz = 0;
        p.standingOn = frame === FRAME_FORTRESS ? F : null;
        p.onGround = frame === FRAME_FORTRESS;
        p.climbing = false;
        p.ladder = null;
        p.chute = 0;
        g.grapple = null;
        g.overSide = null;
        g.leap = null;
        g.yaw = n(6) / 1000;
        this.epoch = n(7);
        this.poseTimer = 0;
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ to the host

  /** What this player stands in (the deck, a giant, the world) and its place there. */
  private frame(): { frame: number; giant: number; body: BlockBody | null } {
    const g = this.g;
    const a = g.player;
    const F = g.fortress;
    if (a.standingOn === F || a.ladder?.body === F || g.helm || g.gunner || g.overSide) return { frame: FRAME_FORTRESS, giant: 0, body: F };
    for (const [id, gi] of this.giantMap) {
      if (!gi.dead && (a.standingOn === gi.body || a.ladder?.body === gi.body)) return { frame: FRAME_GIANT, giant: id, body: gi.body };
    }
    return { frame: FRAME_WORLD, giant: 0, body: null };
  }

  private sendPose(): void {
    const g = this.g;
    if (!this.session.open) return;
    const a = g.player;
    const { frame, giant, body } = this.frame();
    const [x, y, z] = body ? body.toLocal(a.x, a.y, a.z) : [a.x, a.y, a.z];
    let fl = 0;
    if (a.onGround) fl |= PF.ground;
    if (a.climbing) fl |= PF.climbing;
    if (g.helm) fl |= PF.helm;
    if (g.gunner) fl |= PF.gunner;
    if (a.dead) fl |= PF.dead;
    if (g.carried) fl |= PF.hen;
    if (g.inWater(a)) fl |= PF.swim;
    if (g.mode === 'build') fl |= PF.build;
    if (g.leap) fl |= PF.leap;
    if (g.grapple) fl |= PF.grapple;
    const playing = g.isPlaying();
    const mx = playing ? Math.max(-1, Math.min(1, g.move.x + (g.keys.right ? 1 : 0) - (g.keys.left ? 1 : 0))) : 0;
    const mz = playing ? Math.max(-1, Math.min(1, g.move.z + (g.keys.forward ? 1 : 0) - (g.keys.back ? 1 : 0))) : 0;
    const v = new Array<number>(POSE_SIZE).fill(0);
    v[P.frame] = frame;
    v[P.giant] = giant;
    v[P.x] = q2(x);
    v[P.y] = q2(y);
    v[P.z] = q2(z);
    v[P.yaw] = q3(g.yaw);
    v[P.pitch] = q3(g.pitch);
    v[P.vx] = q2(a.vx);
    v[P.vy] = q2(a.vy);
    v[P.vz] = q2(a.vz);
    v[P.walk] = q2(a.walkPhase);
    v[P.flags] = fl;
    v[P.item] = g.selected ?? -1;
    v[P.swing] = q2(Math.min(1, g.mining.swing * 4));
    v[P.chute] = Math.round(a.chute * 100);
    v[P.mx] = Math.round(mx * 100);
    v[P.mz] = Math.round(mz * 100);
    v[P.boost] = g.boostHeld || (g.helm && g.jumpHeld) ? 1 : 0;
    v[P.jump] = g.jumpHeld ? 1 : 0;
    v[P.epoch] = this.epoch;
    this.session.send({ t: 'p', v });
  }

  /** A view ray, in the frame this player stands in (so it lands the same on the host). */
  private wireRay(r: Ray): number[] {
    const { frame, giant, body } = this.frame();
    let o: Vec3 = [r.ox, r.oy, r.oz];
    let dx = r.dx;
    let dz = r.dz;
    if (body) {
      o = body.toLocal(o[0], o[1], o[2]);
      [dx, dz] = body.dirToLocal(dx, dz);
    }
    return [frame, giant, q2(o[0]), q2(o[1]), q2(o[2]), q3(dx), q3(r.dy), q3(dz)];
  }

  /** One of this player's actions on the shared world, for the host to carry out. */
  send(name: string, args: unknown[]): void {
    if (!this.joined || !this.session.open) return;
    const wire = args.map((a) => (a && typeof a === 'object' && 'ox' in a && 'dx' in a ? this.wireRay(a as Ray) : a));
    this.session.send({ t: 'a', n: name, a: wire });
  }

  /** A held press following the finger (sent a few times a second). */
  aim(r: Ray): void {
    if (this.aimTimer > 0) return;
    this.aimTimer = 0.12;
    this.send('aim', [r]);
  }

  /** The host's avatar as this screen shows it. */
  hostShown(): MateShown | null {
    const h = this.hostPose;
    if (!h || h.length < POSE_SIZE) return null;
    const body = h[P.frame] === FRAME_FORTRESS ? this.g.fortress : h[P.frame] === FRAME_GIANT ? this.giantMap.get(h[P.giant]!)?.body ?? null : null;
    return poseView(h, body, 'builder', this.hostName || 'Captain', 0);
  }

  // ------------------------------------------------------------------ leaving

  /** Leaves the co-op game (back to this device's own title). */
  leave(): void {
    this.session.leave();
  }

  /** Leaves without going back to the title (this device is starting a game of its own). */
  quit(): void {
    this.onEnded = null;
    this.session.leave();
  }

  private end(why: string): void {
    if (this.ended) return;
    this.ended = why;
    this.status = 'closed';
    const g = this.g;
    if (g.coopGuest === this) g.coopGuest = null;
    setMySkin('builder');
    const wasPlaying = this.joined;
    this.joined = false;
    this.changed();
    if (wasPlaying) this.onEnded?.(why);
  }
}
