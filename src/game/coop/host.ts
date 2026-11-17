// The co-op host: this game is the world. It lets a mate in (sending the world as it stands),
// plays the mate's actions and its share of the world's rules as if they were its own, and
// streams what changes back fifteen times a second: the fortress, giants, monsters, effects,
// news and the mate's own state. The mate's device moves its own body and says where it is.
import { forge } from '../gear';
import { updateMining } from '../build';
import type { BlockBody } from '../body';
import { cancelCraneDrop, encodeCraneDrop, encodeLift, HOIST_STAGES } from '../crane';
import { updateEffects } from '../effects';
import { Actor } from '../entities';
import { siteFrom, type Game, type GameUI, type Light, type Ray } from '../game';
import type { Giant } from '../giants';
import type { Vec3 } from '../math3d';
import { damagePlayer, drainPlayer } from '../mobs';
import { PlayerCtx, type PlayerSink } from '../player-ctx';
import { SHARED, type Refs } from './mirror';
import { PoseSmoother, poseView, type MateShown } from './avatar';
import { RemoteUI } from './remote-ui';
import { createRoom, Session, type SessionState } from './session';
import {
  BodySync, diffValues, encodeActor, encodeCrate, encodeDrop, encodeFalling, encodeFang, encodeLegs, encodePose, encodeProjectile,
  FRAME_FORTRESS, FRAME_GIANT, FRAME_WORLD, P, PF, POSE_SIZE, q2, q3, SNAP_HZ, STALL_MS, WELCOME_CHUNK,
  type BodyDelta, type EntDelta, type GiantDelta, type HoistDelta, type ListName, type Snapshot, type WelcomeState, type WireRay,
} from './wire';

/** Particle calls passed on to the mate (it makes its own particles from them). */
const PARTICLE_CALLS = ['add', 'debris', 'sparks', 'smoke', 'dust', 'poof', 'crit', 'ring', 'flash'] as const;

/** Interface calls made by the world (not by either player) that both players see. */
const WORLD_NEWS = new Set(['toast', 'banner', 'briefing', 'flash', 'story', 'showResult', 'say', 'damage', 'totem']);

/** Sounds that stay with whoever made them. */
const PRIVATE_SFX = new Set(['click', 'deny', 'pickup', 'heartbeat', 'levelup', 'feat', 'craft', 'teleport', 'drink']);

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function rounded(v: unknown): unknown {
  if (typeof v === 'number') return r3(v);
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = rounded(x);
    return out;
  }
  return v;
}

/** What the host knows of where its mate's body is: the frame it stands in and its place there. */
interface MateTrack {
  frame: number;
  giant: number;
  local: Vec3;
  /** Its last pose as sent (the avatar is drawn from it), and when that came. */
  pose: number[];
  /** Moves the host made (a respawn, a pearl, the helm): poses from before one are stale. */
  epoch: number;
}

export type HostStatus = 'opening' | 'waiting' | 'joining' | 'playing' | 'away' | 'closed';

export class CoopHost {
  readonly g: Game;
  readonly session: Session;
  readonly code: string;
  readonly name: string;
  /** The mate has the world and plays in it. */
  live = false;
  /** Called whenever the room, the line or the mate changes (the co-op panel listens). */
  onChange: (() => void) | null = null;
  /** Why the room closed, once it has. */
  ended: string | null = null;
  private track: MateTrack = { frame: FRAME_WORLD, giant: 0, local: [0, 0, 0], pose: [], epoch: 0 };
  private seq = 0;
  private snapTimer = 0;
  /** When the mate's last pose came in (performance.now). */
  private poseAt = 0;
  private fx: unknown[][] = [];
  private edits: number[] = [];
  private sent = new Map<string, string>();
  private ents = new Map<ListName, Map<number, number[]>>();
  private readonly ids = new WeakMap<object, number>();
  private nextId = 1;
  private fortressSync = new BodySync();
  private giantSync = new Map<number, BodySync>();
  private giantState = new Map<number, string>();
  private hoistSync = new BodySync();
  private hoistSent: { cargo: BlockBody | null; v: number } = { cargo: null, v: -1 };
  private hoistedSent = 0;
  /** A crane drop has been sent (its end is sent once). */
  private dropSent = false;
  private lootedSent = 0;
  private meSent = '';
  private mateDown = false;
  private world: Game['world'] | null = null;
  private depth = 0;
  private readonly restore: Array<() => void> = [];
  private readonly sink: PlayerSink;
  private readonly refs: Refs = { id: (o) => (o ? this.id(o) : 0) };

  static async open(g: Game, name: string): Promise<CoopHost> {
    const room = await createRoom();
    return new CoopHost(g, room.code, room.hostKey, name);
  }

  private constructor(g: Game, code: string, hostKey: string, name: string) {
    this.g = g;
    this.code = code;
    this.name = name;
    const k = (kind: string, ...args: unknown[]): void => {
      if (this.live) this.fx.push(['k', kind, ...args]);
    };
    this.sink = {
      sfx: (n, m, v, r) => k('sfx', n, m, r3(v), r3(r)),
      buzz: (ms) => k('buzz', ms),
      punch: (a) => k('punch', r3(a)),
      shake: (a) => k('shake', r3(a)),
      feat: (id, n) => k('feat', id, n),
      hurt: (amount, x, z) => k('hurt', r2(amount), r2(x), r2(z)),
      fling: (vx, vy, vz) => k('fling', r2(vx), r2(vy), r2(vz)),
      hitmark: (kill) => k('hit', kill ? 1 : 0),
      moved: () => this.moved(),
    };
    this.session = new Session('host', code, name, hostKey);
    this.session.onOpen = (peer) => {
      if (peer?.online) this.admit(peer.name, true);
      this.changed();
    };
    this.session.onPeer = (e) => {
      if (e.gone) {
        this.dropMate(true);
        return;
      }
      if (e.online) this.admit(e.name ?? 'Mate', e.rejoin === true);
      else this.lost();
      this.changed();
    };
    this.session.onMessage = (data) => this.receive(data);
    this.session.onState = () => this.changed();
    this.session.onEnd = (why) => this.shutdown(why);
    this.install();
  }

  get status(): HostStatus {
    if (this.ended) return 'closed';
    if (this.session.state !== 'open') return 'opening';
    const p = this.g.partner;
    if (!p) return 'waiting';
    if (this.live) return 'playing';
    return this.session.peerOnline ? 'joining' : 'away';
  }

  get mateName(): string {
    return this.g.partner?.name ?? this.session.peerName ?? '';
  }

  get ping(): number {
    return Math.round(this.session.rtt);
  }

  /** The mate's line holds but its body has gone quiet (its app in the background, a frozen tab). */
  get mateStalled(): boolean {
    return this.live && this.status === 'playing' && performance.now() - this.poseAt > STALL_MS;
  }

  private changed(): void {
    this.onChange?.();
  }

  // ------------------------------------------------------------------ hooks into the game

  /** Taps the world's edits, the particles, the interface and the camera shakes (all undone on close). */
  private install(): void {
    const g = this.g;
    this.hookWorld();
    const parts = g.particles as unknown as Record<string, (...a: unknown[]) => void>;
    for (const name of PARTICLE_CALLS) {
      const orig = parts[name]!.bind(g.particles);
      parts[name] = (...args: unknown[]): void => {
        // (Calls made inside another call are its own business: only the outer one travels.)
        const pass = this.depth === 0 && this.live && g.fxMute === 0;
        this.depth += 1;
        try {
          orig(...args);
        } finally {
          this.depth -= 1;
        }
        if (pass) this.fx.push(['p', name, ...args.map(rounded)]);
      };
      this.restore.push(() => {
        delete parts[name];
      });
    }
    // News the world itself makes (not either player's own doing) reaches the mate too.
    const local = g.me.ui;
    g.me.ui = new Proxy(local, {
      get: (target, key) => {
        const v: unknown = Reflect.get(target, key, target);
        if (typeof v !== 'function') return v;
        const fn = (v as (...a: unknown[]) => unknown).bind(target);
        if (typeof key !== 'string' || !WORLD_NEWS.has(key)) return fn;
        return (...args: unknown[]) => {
          const out = fn(...args);
          if (g.cx === g.me && g.privacy === 0 && g.inUpdate) this.worldNews(key, args);
          return out;
        };
      },
    });
    this.restore.push(() => {
      g.me.ui = local;
    });
    g.routeShakes((amount) => {
      if (g.cx !== g.me && g.cx === g.partner) {
        this.sink.shake(amount);
        return true;
      }
      if (g.privacy === 0 && g.inUpdate) this.sink.shake(amount);
      return false;
    });
    this.restore.push(() => g.routeShakes(null));
  }

  private hookWorld(): void {
    const w = this.g.world;
    if (this.world === w) return;
    if (this.world) this.world.onChange = null;
    this.world = w;
    w.onChange = (x, y, z, _before, after) => {
      if (this.g.partner) this.edits.push(x, y, z, after, w.getMeta(x, y, z));
    };
    this.hoistedSent = w.hoisted.size;
    this.lootedSent = w.lootedChests.size;
  }

  private worldNews(method: string, args: unknown[]): void {
    if (!this.live) return;
    if (method === 'say') {
      const at = (args[0] as () => Vec3 | null)();
      if (at) this.fx.push(['u', 'say', [r2(at[0]), r2(at[1]), r2(at[2]), args[1], args[2]]]);
      return;
    }
    this.fx.push(['u', method, rounded(args)]);
  }

  // ------------------------------------------------------------------ the mate's seat

  /** A mate comes aboard (or back): it gets the world as it stands, then plays once it has it. */
  private admit(name: string, rejoin: boolean): void {
    const g = this.g;
    let p = g.partner;
    if (!p || !rejoin) {
      if (p) this.dropMate(false);
      p = new PlayerCtx('remote');
      p.ui = new RemoteUI((m, a) => this.news(m, a), () => g.me.ui);
      p.sink = this.sink;
      const [x, y, z] = this.spawnSpot();
      p.player = new Actor('player', x, y, z);
      p.player.standingOn = g.fortress;
      p.player.onGround = true;
      p.player.maxHp = g.me.player.maxHp;
      p.player.hp = p.player.maxHp;
      p.yaw = g.me.yaw;
      p.hunger = 20;
      g.partner = p;
      this.track = { frame: FRAME_FORTRESS, giant: 0, local: g.fortress.toLocal(x, y, z), pose: [], epoch: 0 };
      g.ui.toast(`${name} is coming aboard...`, 'ui_coop');
    }
    p.name = name;
    p.away = true;
    this.live = false;
    this.sendWelcome();
    this.changed();
  }

  /** The mate's line dropped: it waits where it stood, untouchable, for it to come back. */
  private lost(): void {
    const p = this.g.partner;
    if (!p) return;
    p.away = true;
    this.live = false;
    p.holdRay = null;
    if (p.helm) this.g.withCtx(p, () => this.g.leaveHelm());
    if (p.gunner) this.g.withCtx(p, () => this.g.leaveGuns());
    this.g.ui.toast(`${p.name} lost the connection: waiting for them...`, 'ui_coop');
  }

  /** The mate has gone for good (left, kicked, or never came back). */
  private dropMate(say: boolean): void {
    const g = this.g;
    const p = g.partner;
    if (!p) return;
    // A hen in its arms flutters down where it stood.
    if (p.carried) {
      const hen = p.carried;
      p.carried = null;
      hen.x = p.player.x;
      hen.y = p.player.y + 0.6;
      hen.z = p.player.z;
      hen.vx = hen.vy = hen.vz = 0;
      g.animals.push(hen);
    }
    if (g.hoist?.by === p) g.hoist.by = g.me;
    if (g.craneDrop?.by === p) g.craneDrop = null;
    g.partner = null;
    g.mark = null;
    this.live = false;
    if (say) g.ui.toast(`${p.name} left the fortress`, 'ui_coop');
    this.changed();
  }

  /** A free spot on the deck near where the game starts (the helm end). */
  private spawnSpot(): Vec3 {
    const g = this.g;
    const F = g.fortress;
    const [sx, , sz] = F.toLocal(...g.startSpot());
    for (let r = 0; r <= 6; r += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = Math.floor(sx) + dx + 1;
          const z = Math.floor(sz) + dz;
          if (!F.solidAt(x, 0, z) || F.solidAt(x, 1, z) || F.solidAt(x, 2, z)) continue;
          return F.toWorld(x + 0.5, 1.002, z + 0.5);
        }
      }
    }
    return g.startSpot();
  }

  private sendWelcome(): void {
    const g = this.g;
    const p = g.partner;
    if (!p || !this.session.open) return;
    this.hookWorld();
    const save = { ...g.saveData(), hens: 0, pet: 0, tutorial: 99 };
    const edits: number[] = [];
    for (const [ci, diff] of g.world.edits) for (const [i, v] of diff) edits.push(ci, i, v);
    this.edits = [];
    this.fx = [];
    this.reset();
    const F = g.fortress;
    const a = p.player;
    const spawn = F.toLocal(a.x, a.y, a.z);
    const state: WelcomeState = { seed: g.seed, host: this.name, save, edits, spawn: [r3(spawn[0]), r3(spawn[1]), r3(spawn[2])], yaw: r3(p.yaw), snap: this.snapshot(true) };
    const text = JSON.stringify(state);
    const n = Math.max(1, Math.ceil(text.length / WELCOME_CHUNK));
    for (let i = 0; i < n; i += 1) this.session.send({ t: 'w', i, n, d: text.slice(i * WELCOME_CHUNK, (i + 1) * WELCOME_CHUNK) });
  }

  /** Forgets what the mate was sent (the next snapshot carries everything). */
  private reset(): void {
    this.sent.clear();
    this.ents.clear();
    this.fortressSync = new BodySync();
    this.giantSync.clear();
    this.giantState.clear();
    this.hoistSync = new BodySync();
    this.hoistSent = { cargo: null, v: -1 };
    this.meSent = '';
    const w = this.g.world;
    this.hoistedSent = w.hoisted.size;
    this.lootedSent = w.lootedChests.size;
  }

  /** Something for the mate's screen (its own: shared news echoes on this one in RemoteUI). */
  private news(method: string, args: unknown[]): void {
    if (this.live) this.fx.push(['u', method, rounded(args)]);
  }

  // ------------------------------------------------------------------ from the mate

  private receive(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const m = data as { t?: unknown; v?: unknown; n?: unknown; a?: unknown };
    const p = this.g.partner;
    if (m.t === 'ready') {
      if (!p) return;
      this.poseAt = performance.now();
      p.away = false;
      this.live = true;
      p.player.invulnerable = Math.max(p.player.invulnerable, 2);
      this.g.ui.toast(`${p.name} is aboard!`, 'ui_coop');
      this.g.sfx('recruit');
      this.changed();
    } else if (m.t === 'again') {
      // The mate lost track of the world: send it all again.
      if (p) this.sendWelcome();
    } else if (m.t === 'p' && Array.isArray(m.v)) {
      this.pose(m.v as number[]);
    } else if (m.t === 'a' && typeof m.n === 'string') {
      this.act(m.n, Array.isArray(m.a) ? m.a : []);
    }
  }

  /** Where the mate's body is (its own device moves it): placed in the frame it stands in. */
  private pose(v: number[]): void {
    const g = this.g;
    const p = g.partner;
    if (!p || !this.live || v.length < POSE_SIZE) return;
    if (v[P.epoch]! < this.track.epoch) return;
    this.poseAt = performance.now();
    const t = this.track;
    t.frame = v[P.frame]!;
    t.giant = v[P.giant]!;
    t.local = [v[P.x]! / 100, v[P.y]! / 100, v[P.z]! / 100];
    t.pose = v;
    const a = p.player;
    this.glue(a);
    a.vx = v[P.vx]! / 100;
    a.vy = v[P.vy]! / 100;
    a.vz = v[P.vz]! / 100;
    p.yaw = v[P.yaw]! / 1000;
    a.yaw = p.yaw;
    p.pitch = v[P.pitch]! / 1000;
    a.walkPhase = v[P.walk]! / 100;
    const fl = v[P.flags]!;
    a.onGround = (fl & PF.ground) !== 0;
    a.climbing = (fl & PF.climbing) !== 0;
    a.standingOn = a.onGround ? this.frameBody() : null;
    a.chute = v[P.chute]! / 100;
    p.move.x = v[P.mx]! / 100;
    p.move.z = v[P.mz]! / 100;
    p.boostHeld = v[P.boost] === 1 && p.helm;
    p.jumpHeld = v[P.jump] === 1;
  }

  private frameBody(): BlockBody | null {
    const t = this.track;
    if (t.frame === FRAME_FORTRESS) return this.g.fortress;
    if (t.frame === FRAME_GIANT) return this.giantById(t.giant)?.body ?? null;
    return null;
  }

  /** Keeps the mate's body where its frame has carried it (a walking deck, a giant's back). */
  private glue(a: Actor): void {
    const t = this.track;
    const body = this.frameBody();
    const [x, y, z] = body ? body.toWorld(t.local[0], t.local[1], t.local[2]) : t.local;
    a.x = x;
    a.y = y;
    a.z = z;
  }

  /** The host moved the mate (a respawn, a pearl, the helm): its device is told where to. */
  private moved(): void {
    const p = this.g.partner;
    if (!p) return;
    const a = p.player;
    const F = this.g.fortress;
    const on = a.standingOn === F || p.helm || p.gunner;
    const [x, y, z] = on ? F.toLocal(a.x, a.y, a.z) : [a.x, a.y, a.z];
    this.track.epoch += 1;
    this.track.frame = on ? FRAME_FORTRESS : FRAME_WORLD;
    this.track.local = [x, y, z];
    if (this.live) this.fx.push(['k', 'moved', on ? FRAME_FORTRESS : FRAME_WORLD, q2(x), q2(y), q2(z), q3(p.yaw), this.track.epoch]);
  }

  /** A view ray from the mate's device (in the frame it stood in) in this world. */
  private ray(v: unknown): Ray | null {
    if (!Array.isArray(v) || v.length < 8) return null;
    const r = v as WireRay;
    const body = r[0] === FRAME_FORTRESS ? this.g.fortress : r[0] === FRAME_GIANT ? this.giantById(r[1]!)?.body ?? null : null;
    let o: Vec3 = [r[2]! / 100, r[3]! / 100, r[4]! / 100];
    let dx = r[5]! / 1000;
    let dz = r[7]! / 1000;
    if (body) {
      o = body.toWorld(o[0], o[1], o[2]);
      [dx, dz] = body.dirToWorld(dx, dz);
    }
    const dy = r[6]! / 1000;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { ox: o[0], oy: o[1], oz: o[2], dx: dx / l, dy: dy / l, dz: dz / l };
  }

  /** One of the mate's actions, played here as the mate (its hands, its view, its hold on things). */
  private act(name: string, args: unknown[]): void {
    const g = this.g;
    const p = g.partner;
    if (!p || !this.live || p.away) return;
    const num = (i: number): number => Number(args[i]) || 0;
    g.withCtx(p, () => {
      const ray = (): Ray | null => {
        const r = this.ray(args[0]);
        if (r) p.aim = r;
        return r;
      };
      switch (name) {
        case 'tap': {
          const r = ray();
          if (r) g.tap(r);
          break;
        }
        case 'hold': {
          const r = ray();
          if (r) g.beginHold(r);
          break;
        }
        case 'aim': {
          // A held press following the finger.
          const r = ray();
          if (r && p.holdRay) p.holdRay = r;
          break;
        }
        case 'unhold':
          g.endHold();
          break;
        case 'strike': {
          const r = ray();
          if (r) g.strike(r);
          break;
        }
        case 'use':
          ray();
          g.use(false);
          break;
        case 'steer':
          // The mate's stick on the crane they are working.
          if (g.hoist?.by === p) g.hoist.steer = Math.max(-1, Math.min(1, num(0)));
          break;
        case 'steer2':
          // ...swinging a TNT crate round and out.
          if (g.craneDrop?.by === p) g.craneDrop.steer = [Math.max(-1, Math.min(1, num(0))), Math.max(-1, Math.min(1, num(1)))];
          break;
        case 'dropoff':
          if (g.craneDrop?.by === p) cancelCraneDrop(g);
          break;
        case 'fire':
          ray();
          g.fireCannon();
          break;
        case 'horn':
          g.blowHorn();
          break;
        case 'stomp':
          if (num(0) === 2) g.stomp();
          else if (num(0) === 1) g.stompPress();
          else g.stompRelease();
          break;
        case 'sel':
          if (num(0) < 0) g.selectPickaxe();
          else g.selectItem(num(0));
          break;
        case 'craft':
          g.craft(String(args[0]));
          break;
        case 'forge':
          forge(g, args[0] === 'coat' ? 'coat' : 'sword');
          break;
        case 'trade': {
          const kind = args[0] === 'turnin' ? 'turnin' : args[0] === 'upgrade' ? 'upgrade' : args[0] === 'crane' ? 'crane' : 'buy';
          const r = g.trade(kind, kind === 'buy' || kind === 'crane' ? String(args[1]) : num(1));
          this.news('tradeResult', [r.ok, r.note]);
          break;
        }
        case 'course':
          g.setWaypoint(num(0), num(1));
          break;
        case 'stop':
          g.stopCourse();
          break;
        case 'march':
          g.startNight(siteFrom(g.world.terrain, args[0]));
          break;
        case 'dest': {
          const s = siteFrom(g.world.terrain, args[0]);
          if (s) g.changeDestination(s);
          break;
        }
        case 'helm':
          if (num(0)) g.takeHelm();
          else g.leaveHelm();
          break;
        case 'guns':
          if (num(0)) g.takeGuns();
          else g.leaveGuns();
          break;
        case 'swap':
          this.swapRoles();
          break;
        case 'fall':
          damagePlayer(g, Math.min(8, num(0)), 0, 0);
          break;
        case 'rescue':
          g.respawnPlayer(false);
          break;
        case 'eat':
          g.eat();
          break;
        default:
          break;
      }
    });
  }

  /** The helmsman and the gunner change places (either of them may ask). */
  swapRoles(): void {
    const g = this.g;
    const p = g.partner;
    if (!p || !this.live) return;
    const me = g.me;
    const helmIsMe = me.helm && p.gunner;
    const helmIsMate = p.helm && me.gunner;
    if (!helmIsMe && !helmIsMate) {
      g.withCtx(g.cx, () => g.deny('Swap works with one of you at the helm and the other on the guns'));
      return;
    }
    const [driver, gunner] = helmIsMe ? [me, p] : [p, me];
    g.withCtx(driver, () => g.leaveHelm());
    g.withCtx(gunner, () => g.leaveGuns());
    g.withCtx(gunner, () => g.takeHelm());
    g.withCtx(driver, () => g.takeGuns());
  }

  // ------------------------------------------------------------------ each step

  /** The mate's share of the world's rules, run as the mate (inside the world's step). */
  upkeep(dt: number): void {
    const g = this.g;
    const p = g.partner;
    if (!p || !this.live || p.away) return;
    g.withCtx(p, () => g.own(() => {
      const a = p.player;
      this.glue(a);
      a.hurt = Math.max(0, a.hurt - dt);
      a.invulnerable = Math.max(0, a.invulnerable - dt);
      p.attackCooldown = Math.max(0, p.attackCooldown - dt);
      p.throwCooldown = Math.max(0, p.throwCooldown - dt);
      p.grappleCooldown = Math.max(0, p.grappleCooldown - dt);
      p.bowCooldown = Math.max(0, p.bowCooldown - dt);
      p.mining.swing = Math.max(0, p.mining.swing - dt);
      if (a.dead) {
        p.holdRay = null;
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) g.respawnPlayer(true);
        return;
      }
      updateMining(g, dt);
      g.updateHunger(dt);
      updateEffects(g, dt, (n) => drainPlayer(g, n));
      g.hauledBack(dt);
    }));
  }

  /** After the world's step: the line's housekeeping and, fifteen times a second, a snapshot. */
  tick(dt: number): void {
    const g = this.g;
    if (this.track.pose.length >= POSE_SIZE) this.shownPose = this.smoother.update(this.track.pose, dt);
    if (this.world !== g.world) {
      // A new game was started (or loaded): a mate aboard is sent the new world.
      this.hookWorld();
      if (g.partner) {
        const p = g.partner;
        const [x, y, z] = this.spawnSpot();
        Object.assign(p.player, { x, y, z, vx: 0, vy: 0, vz: 0, dead: false, hp: p.player.maxHp });
        p.helm = p.gunner = false;
        this.track = { frame: FRAME_FORTRESS, giant: 0, local: g.fortress.toLocal(x, y, z), pose: [], epoch: this.track.epoch + 1 };
        this.live = false;
        p.away = true;
        this.sendWelcome();
      }
    }
    if (!this.live || !g.partner) {
      this.fx.length = 0;
      return;
    }
    // The mate knocked out: this player hears of it (on this screen only).
    const mate = g.partner;
    if (mate.player.dead !== this.mateDown) {
      this.mateDown = mate.player.dead;
      if (this.mateDown) g.own(() => g.me.ui.toast(`${mate.name} is knocked out: back aboard in a moment`, 'ui_coop'));
    }
    this.snapTimer -= dt;
    if (this.snapTimer > 0) return;
    this.snapTimer = Math.max(0, this.snapTimer + 1 / SNAP_HZ);
    // (A backed-up line skips a snapshot; what changed goes with the next.)
    if (this.session.backlog > 192 * 1024) return;
    this.session.send(this.snapshot(false));
  }

  // ------------------------------------------------------------------ what the mate hears and sees

  /** A light flash in the world. */
  lit(l: Light): void {
    if (!this.live || this.g.fxMute > 0) return;
    this.fx.push(['l', r2(l.x), r2(l.y), r2(l.z), r2(l.r), r3(l.color[0]), r3(l.color[1]), r3(l.color[2]), r2(l.life), r2(l.max)]);
  }

  /** A sound this game's own player made (or the world made around it). */
  heard(name: string, material: string, volume: number, rate: number): void {
    const g = this.g;
    if (!this.live || g.fxMute > 0 || PRIVATE_SFX.has(name)) return;
    // The world's own news is heard everywhere; the rest comes from where the player stands.
    if (g.inUpdate && g.privacy === 0) {
      this.fx.push(['s', name, material, r3(volume), r3(rate)]);
      return;
    }
    const a = g.me.player;
    this.fx.push(['S', name, r2(a.x), r2(a.y + 1), r2(a.z), r3(volume * 0.8), r3(rate), 42, material]);
  }

  /** A sound from a spot in the world (the mate hears it by its own distance). */
  heardAt(name: string, x: number, y: number, z: number, volume: number, rate: number, range: number): void {
    if (!this.live || this.g.fxMute > 0) return;
    this.fx.push(['S', name, r2(x), r2(y), r2(z), r3(volume), r3(rate), range, 'stone']);
  }

  /** Fireworks: the mate launches its own (they are sparks and bangs, not shared things). */
  celebrated(n: number): void {
    if (this.live) this.fx.push(['cel', n]);
  }
  /** One of the crane's effects for the mate to play itself (a clod letting go, an unloading). */
  craneFx(e: unknown[]): void {
    if (this.live) this.fx.push(['cr', ...e]);
  }


  /** (Effects made while playing the mate's part are already queued for it.) */
  flushDeferred(): void {
    // nothing to do: every effect goes out with the next snapshot
  }

  // ------------------------------------------------------------------ snapshots

  private readonly sentOnce = new WeakSet<object>();

  private once(o: object): boolean {
    if (this.sentOnce.has(o)) return false;
    this.sentOnce.add(o);
    return true;
  }

  private id(o: object): number {
    let id = this.ids.get(o);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(o, id);
    }
    return id;
  }

  private giantById(id: number): Giant | null {
    for (const gi of this.g.giants) if (this.ids.get(gi) === id) return gi;
    return null;
  }

  private snapshot(full: boolean): Snapshot {
    const g = this.g;
    const F = g.fortress;
    const s: Snapshot = { t: 's', tm: r3(g.time), q: ++this.seq };
    const shared: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(SHARED)) {
      const v = f.get(g, this.refs);
      const j = JSON.stringify(v) ?? 'null';
      if (!full && this.sent.get(k) === j) continue;
      this.sent.set(k, j);
      shared[k] = v ?? null;
    }
    if (Object.keys(shared).length) s.g = shared;
    const f: BodyDelta = { p: encodePose(F), wk: [q2(F.walkPhase), F.moving ? 1 : 0, q2(F.shake), q3(g.walker.scale)], legs: encodeLegs(g.walker) };
    this.fortressSync.delta(F, full, f);
    s.f = f;
    const gi = this.giants(full);
    if (gi) s.gi = gi;
    const ho = this.hoist(full);
    if (ho !== undefined) s.ho = ho;
    // A TNT crate on the crane: its rig and aim while it is out, a 0 when it is gone.
    if (g.craneDrop) {
      s.cd = encodeCraneDrop(g, g.craneDrop);
      this.dropSent = true;
    } else if (this.dropSent || full) {
      s.cd = 0;
      this.dropSent = false;
    }
    if (this.edits.length) {
      s.w = this.edits;
      this.edits = [];
    }
    const w = g.world;
    if (w.hoisted.size !== this.hoistedSent) {
      s.hz = [...w.hoisted].slice(this.hoistedSent);
      this.hoistedSent = w.hoisted.size;
    }
    if (w.lootedChests.size !== this.lootedSent) {
      s.lc = [...w.lootedChests].slice(this.lootedSent);
      this.lootedSent = w.lootedChests.size;
    }
    const e: Record<string, EntDelta> = {};
    const actor = (a: Actor): number[] => encodeActor(a, a.mount ? this.id(a.mount) : 0, a.standingOn === F);
    this.list(e, 'm', g.mobs, actor, full);
    this.list(e, 'v', g.villagers, actor, full);
    this.list(e, 'a', g.animals, actor, full);
    this.list(e, 'c', g.corpses, actor, full);
    this.list(e, 'pr', g.projectiles.filter((pr) => pr.age !== Infinity), encodeProjectile, full);
    this.list(e, 'dr', g.drops.filter((d) => d.age !== Infinity), encodeDrop, full);
    this.list(e, 'fb', g.falling, encodeFalling, full);
    this.list(e, 'ad', g.airdrops, encodeCrate, full);
    this.list(e, 'fg', g.fangs, encodeFang, full);
    const pet = g.pet;
    this.list(e, 'pt', pet ? [pet.a] : [], (a) => [...actor(a), q2(pet!.sit), q2(pet!.happy), q2(pet!.howl)], full);
    if (Object.keys(e).length) s.e = e;
    // Things that come and go by themselves (sword sweeps, stomp rings, arrows sticking): each
    // goes over once and the mate ages it itself.
    for (const sl of g.slashes) if (this.once(sl)) this.fx.push(['sl', r2(sl.x), r2(sl.y), r2(sl.z), r3(sl.yaw), sl.crit ? 1 : 0, r2(sl.t)]);
    for (const sh of g.shocks) if (this.once(sh)) this.fx.push(['sh', r2(sh.x), r2(sh.y), r2(sh.z), r2(sh.r0), r2(sh.r1), r2(sh.t), r2(sh.life), r2(sh.width), r2(sh.power)]);
    for (const ar of g.stuckArrows) if (this.once(ar)) this.fx.push(['ar', rounded(ar)]);
    if (this.fx.length) {
      s.fx = this.fx;
      this.fx = [];
    }
    const me = this.mateState();
    const mj = JSON.stringify(me);
    if (full || mj !== this.meSent) {
      s.me = me;
      this.meSent = mj;
    }
    s.h = this.hostPose();
    return s;
  }

  private list<T extends object>(out: Record<string, EntDelta>, name: ListName, items: readonly T[], encode: (t: T) => number[], full: boolean): void {
    let prev = this.ents.get(name);
    if (!prev || full) {
      prev = new Map();
      this.ents.set(name, prev);
    }
    const d: EntDelta = {};
    const seen = new Set<number>();
    for (const it of items) {
      const id = this.id(it);
      if (seen.has(id)) continue;
      seen.add(id);
      const v = encode(it);
      const old = prev.get(id);
      if (!old) {
        (d.n ??= []).push([id, ...v]);
        prev.set(id, v);
        continue;
      }
      const patch = diffValues(old, v);
      if (patch) {
        (d.u ??= []).push([id, ...patch]);
        prev.set(id, v);
      }
    }
    for (const id of [...prev.keys()]) {
      if (seen.has(id)) continue;
      (d.r ??= []).push(id);
      prev.delete(id);
    }
    if (d.n || d.u || d.r) out[name] = d;
  }

  private giants(full: boolean): Record<string, GiantDelta | 0> | null {
    const out: Record<string, GiantDelta | 0> = {};
    const seen = new Set<number>();
    for (const gi of this.g.giants) {
      const id = this.id(gi);
      seen.add(id);
      let sync = this.giantSync.get(id);
      const fresh = !sync || full;
      if (!sync || full) {
        sync = new BodySync();
        this.giantSync.set(id, sync);
      }
      const d: GiantDelta = { p: encodePose(gi.body), wk: [q2(gi.body.walkPhase), gi.body.moving ? 1 : 0, q2(gi.body.shake), q3(gi.walker.scale)], legs: encodeLegs(gi.walker) };
      if (fresh) {
        d.type = gi.type;
        d.name = gi.name;
      }
      sync.delta(gi.body, fresh, d);
      const st = [gi.dead ? 1 : 0, gi.blind ? 1 : 0, gi.rage, q2(gi.windup), gi.contact ? 1 : 0, q2(gi.charge), gi.heavy ? 1 : 0, gi.aimKey ?? -1, q2(gi.aimT), gi.roared ? 1 : 0, gi.lair ?? -1, gi.dormant ? 1 : 0, gi.guardian ? 1 : 0];
      const sj = st.join(',');
      if (fresh || this.giantState.get(id) !== sj) {
        d.st = st;
        this.giantState.set(id, sj);
      }
      out[String(id)] = d;
    }
    for (const id of [...this.giantSync.keys()]) {
      if (seen.has(id)) continue;
      out[String(id)] = 0;
      this.giantSync.delete(id);
      this.giantState.delete(id);
    }
    return Object.keys(out).length ? out : null;
  }

  private hoist(full: boolean): HoistDelta | 0 | undefined {
    const h = this.g.hoist;
    if (!h) {
      if (this.hoistSent.cargo === null && !full) return undefined;
      this.hoistSent = { cargo: null, v: -1 };
      return 0;
    }
    const fresh = full || this.hoistSent.cargo !== h.cargo;
    if (fresh) {
      this.hoistSync = new BodySync();
      this.hoistSent = { cargo: h.cargo, v: -1 };
    }
    const stage = HOIST_STAGES.indexOf(h.stage);
    const d: HoistDelta = {
      p: [...encodePose(h.cargo), ...encodeLift(this.g, h)], sid: h.s.id, stage, t: r3(h.t), mid: h.mid, by: h.by === this.g.me ? 0 : 1, info: h.info,
      st: r3(h.strain), pf: (h.perfect[0] ? 1 : 0) | (h.perfect[1] ? 2 : 0), eav: h.eaves.flatMap((e) => [r2(e[0]), r2(e[1]), r2(e[2])]),
      base: h.stage === 'swing' || h.stage === 'drop' ? h.base.flat() : undefined,
      ax: h.stage === 'drop' ? [r3(h.axis[0]), r3(h.axis[1])] : undefined,
      tr: h.stage === 'drop' ? r2(h.trim) : undefined,
    };
    this.hoistSync.delta(h.cargo, fresh, d);
    return d;
  }

  /** The mate's own state as this game keeps it (hearts, hunger, effects, its post, what it digs). */
  private mateState(): Record<string, unknown> {
    const p = this.g.partner!;
    const a = p.player;
    const m = p.mining;
    const t = m.target;
    const target = t ? [t.kind === 'world' ? 0 : t.kind === 'fortress' ? 1 : 2, t.giant ? this.id(t.giant) : 0, t.x, t.y, t.z, t.id] : null;
    return {
      hp: r2(a.hp),
      mh: a.maxHp,
      dead: a.dead,
      rs: r2(Math.max(0, p.respawnTimer)),
      hu: p.hunger,
      bh: r2(p.behind),
      ef: [...p.effects].map(([id, e]) => [id, Number.isFinite(e.t) ? Math.round(e.t * 10) / 10 : -1, e.level]),
      helm: p.helm,
      gun: p.gunner,
      car: p.carried ? 1 : 0,
      mp: r2(m.progress),
      mt: target,
      sel: p.selected ?? -1,
      mode: p.mode,
    };
  }

  /** This game's own player, as the mate sees it. */
  private hostPose(): number[] {
    const g = this.g;
    const me = g.me;
    const a = me.player;
    const F = g.fortress;
    const giant = g.giants.find((gi) => !gi.dead && a.standingOn === gi.body) ?? null;
    const onFortress = a.standingOn === F || a.ladder?.body === F || me.helm || me.gunner;
    const frame = onFortress ? FRAME_FORTRESS : giant ? FRAME_GIANT : FRAME_WORLD;
    const [x, y, z] = onFortress ? F.toLocal(a.x, a.y, a.z) : giant ? giant.body.toLocal(a.x, a.y, a.z) : [a.x, a.y, a.z];
    let fl = 0;
    if (a.onGround) fl |= PF.ground;
    if (a.climbing) fl |= PF.climbing;
    if (me.helm) fl |= PF.helm;
    if (me.gunner) fl |= PF.gunner;
    if (a.dead) fl |= PF.dead;
    if (me.carried) fl |= PF.hen;
    if (g.inWater(a)) fl |= PF.swim;
    if (me.mode === 'build') fl |= PF.build;
    if (me.leap) fl |= PF.leap;
    if (me.grapple) fl |= PF.grapple;
    const turn = g.turnRate / Math.max(0.05, g.turnSpeed());
    return [frame, giant ? this.id(giant) : 0, q2(x), q2(y), q2(z), q3(me.yaw), q3(me.pitch), q2(a.vx), q2(a.vy), q2(a.vz), q2(a.walkPhase), fl, me.selected ?? -1, q2(Math.max(me.mining.swing, me.holdRay ? 0.25 : 0)), Math.round(a.chute * 100), 0, 0, 0, 0, 0, q2(turn)];
  }

  // ------------------------------------------------------------------ closing

  /** Sends the mate away (its seat is freed; it may come back with the code). */
  kick(): void {
    this.session.kick();
    this.dropMate(true);
  }

  /** Closes the room (the mate's game ends). */
  close(): void {
    this.session.leave();
  }

  private shutdown(why: string): void {
    if (this.ended) return;
    this.ended = why;
    this.dropMate(false);
    for (const undo of this.restore.splice(0)) undo();
    if (this.world) this.world.onChange = null;
    if (this.g.coopHost === this) this.g.coopHost = null;
    this.changed();
  }

  private smoother = new PoseSmoother();
  private shownPose: number[] | null = null;

  /** The mate's avatar as this screen shows it (eased between its poses). */
  mateShown(): MateShown | null {
    const p = this.g.partner;
    const pose = this.shownPose;
    if (!p || !pose || pose.length < POSE_SIZE) return null;
    // (While its line is down it stands where it was, greyed by the panel.)
    return poseView(pose, this.frameBodyOf(pose), 'builder2', p.name, p.player.hurt);
  }

  private frameBodyOf(pose: number[]): BlockBody | null {
    if (pose[P.frame] === FRAME_FORTRESS) return this.g.fortress;
    if (pose[P.frame] === FRAME_GIANT) return this.giantById(pose[P.giant]!)?.body ?? null;
    return null;
  }

  /** Whose interface is the local one (for the panel). */
  get localUI(): GameUI {
    return this.g.me.ui;
  }

  get lineState(): SessionState {
    return this.session.state;
  }
}
