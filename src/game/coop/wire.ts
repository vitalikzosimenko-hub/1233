// The co-op wire format: what the host sends about the world and what the guest sends back.
// Numbers travel quantized (positions in centimetres, angles in milliradians) inside JSON arrays.
// Entities are sent as fixed-length value arrays; after the first full copy an update carries only
// the values that changed, selected by a bit mask.
import { blockDef, TURRET_IDS } from '../blocks';
import type { BlockBody } from '../body';
import type { ActKind, Actor, ActorKind, FallingBlock, ItemDrop, Projectile, VillagerRole } from '../entities';
import type { Airdrop } from '../events';
import type { Fang } from '../monsters';
import type { Leg, Walker } from '../walker';

/** Must match worker/index.ts. */
export const PROTOCOL = 'bf-coop-1';
/** Snapshots per second from the host (and poses per second from the guest). */
export const SNAP_HZ = 15;
/** How far behind the newest snapshot the guest draws the world (seconds). */
export const INTERP_DELAY = 0.12;
/** Silence from the other side for this long (ms) and the HUD says so (its app is in the background, its tab frozen). */
export const STALL_MS = 2500;
/** Welcome state is cut into pieces of this many characters. */
export const WELCOME_CHUNK = 180_000;

export const q2 = (v: number): number => Math.round(v * 100);
export const q3 = (v: number): number => Math.round(v * 1000);

/** Per value of an entity record: 0 taken as is, 1 interpolated, 2 interpolated as an angle. */
export type Lerp = 0 | 1 | 2;

// ------------------------------------------------------------------ enums

export const KINDS: ActorKind[] = [
  'player', 'villager', 'wolf', 'chicken', 'sheep', 'zombie', 'husk', 'skeleton', 'stray', 'creeper', 'spider', 'cavespider', 'phantom',
  'enderman', 'witch', 'slime', 'witherskel', 'ghast', 'pillager', 'vindicator', 'evoker', 'vex', 'ravager', 'wither',
  'drowned', 'bogged', 'breeze', 'polarbear', 'blaze', 'magmacube', 'queen', 'golem', 'wtrader', 'llama', 'camel', 'frog',
  'veyra', 'npc',
];
export const ACTS: ActKind[] = ['none', 'draw', 'pounce', 'cast', 'fangs', 'summon', 'drink', 'throw', 'charge', 'roar', 'stunned', 'shoot', 'grab', 'scream'];
export const POTIONS: Array<Actor['potion']> = ['', 'heal', 'swift', 'poison', 'slowness', 'weakness', 'harm'];
export const ROLES: VillagerRole[] = ['villager', 'smith', 'farmer', 'trader'];
export const PROJECTILES: Array<Projectile['kind']> = ['tnt', 'arrow', 'bolt', 'shell', 'thrown', 'breaker', 'ibolt', 'fireball', 'skull', 'blueskull', 'potion', 'pearl', 'gshell', 'trident', 'wind', 'ember', 'web', 'crate'];
export const EFFECT_IDS = ['poison', 'wither', 'slowness', 'weakness', 'hunger', 'regen', 'strength', 'resistance', 'omen', 'hero', 'beacon'] as const;

const idx = <T>(list: readonly T[], v: T): number => Math.max(0, list.indexOf(v));

// ------------------------------------------------------------------ actors

/** Actor flag bits. */
export const AF = {
  ground: 1, climb: 2, baby: 4, zvillager: 8, charged: 16, captain: 32, fly: 64, trader: 128, freed: 256, recruited: 512,
  captive: 1024, boarded: 2048, deck: 4096, dead: 8192, boss: 16384, mounted: 32768,
} as const;

/** x y z yaw headYaw headPitch vx vy vz walkPhase hurt deathT act actT actDur windup attackTimer fuse flags armor
 * potion life mouth aux anger size carry kind h hw hp maxHp mount panic stun squash flap munch head wool tint role burn golden */
export const ACTOR_LERP: Lerp[] = [1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0];

export function encodeActor(a: Actor, mountId: number, deck: boolean): number[] {
  let f = 0;
  if (a.onGround) f |= AF.ground;
  if (a.climb) f |= AF.climb;
  if (a.baby) f |= AF.baby;
  if (a.zvillager) f |= AF.zvillager;
  if (a.charged) f |= AF.charged;
  if (a.captain) f |= AF.captain;
  if (a.fly) f |= AF.fly;
  if (a.trader) f |= AF.trader;
  if (a.freed) f |= AF.freed;
  if (a.recruited) f |= AF.recruited;
  if (a.captive) f |= AF.captive;
  if (a.boarded) f |= AF.boarded;
  if (deck) f |= AF.deck;
  if (a.dead) f |= AF.dead;
  if (a.boss) f |= AF.boss;
  if (a.mount) f |= AF.mounted;
  return [
    q2(a.x), q2(a.y), q2(a.z), q3(a.yaw), q3(a.headYaw), q3(a.headPitch), q2(a.vx), q2(a.vy), q2(a.vz), q2(a.walkPhase),
    q2(a.hurt), q2(a.deathT), idx(ACTS, a.act), q2(a.actT), q2(a.actDur), q2(a.windup), q2(Math.max(-9, a.attackTimer)), q2(a.fuse), f, a.armor,
    idx(POTIONS, a.potion), q2(Math.max(-1, a.life)), q2(a.mouth), q2(a.aux), q2(a.anger), a.size, a.carry, idx(KINDS, a.kind), q2(a.h), q2(a.hw),
    Math.round(a.hp * 10), Math.round(a.maxHp * 10), mountId, q2(a.panic), q2(a.stun), q2(a.squash), q2(a.flap), q2(a.munch), q2(a.head), q2(a.wool),
    a.tint, idx(ROLES, a.role), q2(a.burn), Math.round(a.golden * 10),
  ];
}

/** Writes an actor record (interpolated or not) onto a mirror actor. */
export function applyActor(a: Actor, v: number[]): void {
  a.x = v[0]! / 100;
  a.y = v[1]! / 100;
  a.z = v[2]! / 100;
  a.yaw = v[3]! / 1000;
  a.headYaw = v[4]! / 1000;
  a.headPitch = v[5]! / 1000;
  a.vx = v[6]! / 100;
  a.vy = v[7]! / 100;
  a.vz = v[8]! / 100;
  a.walkPhase = v[9]! / 100;
  a.hurt = v[10]! / 100;
  a.deathT = v[11]! / 100;
  a.act = ACTS[v[12]!] ?? 'none';
  a.actT = v[13]! / 100;
  a.actDur = v[14]! / 100;
  a.windup = v[15]! / 100;
  a.attackTimer = v[16]! / 100;
  a.fuse = v[17]! / 100;
  const f = v[18]!;
  a.onGround = (f & AF.ground) !== 0;
  // (Shapes the models read: a monster on a leg, a phantom on the wing.)
  a.climb = (f & AF.climb) !== 0 ? (a.climb ?? { leg: 0, t: 0, swinging: false }) : null;
  a.fly = (f & AF.fly) !== 0 ? (a.fly ?? { mode: 'circle', t: 0, angle: 0, radius: 0, height: 0, tx: 0, ty: 0, tz: 0 }) : null;
  a.baby = (f & AF.baby) !== 0;
  a.zvillager = (f & AF.zvillager) !== 0;
  a.charged = (f & AF.charged) !== 0;
  a.captain = (f & AF.captain) !== 0;
  a.trader = (f & AF.trader) !== 0;
  a.freed = (f & AF.freed) !== 0;
  a.recruited = (f & AF.recruited) !== 0;
  a.captive = (f & AF.captive) !== 0;
  a.boarded = (f & AF.boarded) !== 0;
  a.dead = (f & AF.dead) !== 0;
  // (Only the Wither is a named boss.)
  a.boss = (f & AF.boss) !== 0 ? 'WITHER' : null;
  a.armor = v[19]!;
  a.potion = POTIONS[v[20]!] ?? '';
  a.life = v[21]! / 100;
  a.mouth = v[22]! / 100;
  a.aux = v[23]! / 100;
  a.anger = v[24]! / 100;
  a.size = v[25]!;
  a.carry = v[26]!;
  a.h = v[28]! / 100;
  a.hw = v[29]! / 100;
  a.hp = v[30]! / 10;
  a.maxHp = v[31]! / 10;
  a.panic = v[33]! / 100;
  a.stun = v[34]! / 100;
  a.squash = v[35]! / 100;
  a.flap = v[36]! / 100;
  a.munch = v[37]! / 100;
  a.head = v[38]! / 100;
  a.wool = v[39]! / 100;
  a.tint = v[40]!;
  a.role = ROLES[v[41]!] ?? 'villager';
  a.burn = v[42]! / 100;
  a.golden = v[43]! / 10;
}

// ------------------------------------------------------------------ small things in flight or lying about

/** Projectiles: kind x y z vx vy vz age spin deflected effect fromCrew block */
export const PROJ_LERP: Lerp[] = [0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0];

export function encodeProjectile(p: Projectile): number[] {
  return [idx(PROJECTILES, p.kind), q2(p.x), q2(p.y), q2(p.z), q2(p.vx), q2(p.vy), q2(p.vz), q2(p.age), q2(p.spin), p.deflected ? 1 : 0, p.effect ? EFFECT_IDS.indexOf(p.effect as (typeof EFFECT_IDS)[number]) + 1 : 0, p.fromCrew ? 1 : 0, p.block ?? 0];
}

/** Writes a projectile record onto a mirror (its trail is drawn by whoever watches it). */
export function applyProjectile(p: Projectile, v: number[]): void {
  p.kind = PROJECTILES[v[0]!] ?? 'tnt';
  p.x = v[1]! / 100;
  p.y = v[2]! / 100;
  p.z = v[3]! / 100;
  p.vx = v[4]! / 100;
  p.vy = v[5]! / 100;
  p.vz = v[6]! / 100;
  p.age = v[7]! / 100;
  p.spin = v[8]! / 100;
  p.deflected = v[9] === 1;
  p.effect = v[10] ? EFFECT_IDS[v[10] - 1] : undefined;
  p.fromCrew = v[11] === 1;
  p.block = v[12] ? v[12] : undefined;
}

export function encodeDrop(d: ItemDrop): number[] {
  return [d.id, d.count, q2(d.x), q2(d.y), q2(d.z), q2(Math.min(d.age, 600))];
}

export function applyDrop(d: ItemDrop, v: number[]): void {
  d.id = v[0]!;
  d.count = v[1]!;
  d.x = v[2]! / 100;
  d.y = v[3]! / 100;
  d.z = v[4]! / 100;
  d.age = v[5]! / 100;
}

export function encodeFalling(f: FallingBlock): number[] {
  return [f.id, q2(f.x), q2(f.y), q2(f.z), q3(f.rot)];
}

export function applyFalling(f: FallingBlock, v: number[]): void {
  f.id = v[0]!;
  f.x = v[1]! / 100;
  f.y = v[2]! / 100;
  f.z = v[3]! / 100;
  f.rot = v[4]! / 1000;
}

export function encodeCrate(c: Airdrop): number[] {
  return [q2(c.x), q2(c.y), q2(c.z), q3(c.sway), c.chest ? 1 : 0, q2(c.t)];
}

export function applyCrate(c: Airdrop, v: number[]): void {
  c.x = v[0]! / 100;
  c.y = v[1]! / 100;
  c.z = v[2]! / 100;
  c.sway = v[3]! / 1000;
  c.chest = v[4] ? [Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)] : null;
  c.t = v[5]! / 100;
}

export function encodeFang(f: Fang): number[] {
  return [q2(f.x), q2(f.y), q2(f.z), q3(f.yaw), q2(f.t)];
}

export function applyFang(f: Fang, v: number[]): void {
  f.x = v[0]! / 100;
  f.y = v[1]! / 100;
  f.z = v[2]! / 100;
  f.yaw = v[3]! / 1000;
  f.t = v[4]! / 100;
}

// ------------------------------------------------------------------ block bodies

/** Pose of a body: its hull centre (so both sides agree whatever its pivot), height and turn. */
export function encodePose(b: BlockBody): number[] {
  const [cx, cz] = b.centre();
  return [q2(cx), q2(b.y), q2(cz), q3(b.yaw)];
}

export function applyPose(b: BlockBody, v: number[]): void {
  b.setYaw(v[3]! / 1000);
  b.y = v[1]! / 100;
  b.setCentre(v[0]! / 100, v[2]! / 100);
}

/** Legs: hip xyz (body-local), foot xyz (world), damage, swing progress. */
export function encodeLegs(w: Walker): number[] {
  const out: number[] = [];
  for (const l of w.legs) out.push(q2(l.hx), q2(l.hy), q2(l.hz), q2(l.foot[0]), q2(l.foot[1]), q2(l.foot[2]), q2(l.damage), q2(l.t));
  return out;
}

export function applyLegs(w: Walker, v: number[]): void {
  const n = Math.floor(v.length / 8);
  while (w.legs.length > n) w.legs.pop();
  for (let i = 0; i < n; i += 1) {
    const o = i * 8;
    let l: Leg | undefined = w.legs[i];
    if (!l) {
      l = { hx: 0, hy: 0, hz: 0, foot: [0, 0, 0], from: [0, 0, 0], to: [0, 0, 0], t: -1, group: i % 2, landed: false, lastHip: [0, 0, 0], damage: 0 };
      w.legs.push(l);
    }
    l.hx = v[o]! / 100;
    l.hy = v[o + 1]! / 100;
    l.hz = v[o + 2]! / 100;
    l.foot[0] = v[o + 3]! / 100;
    l.foot[1] = v[o + 4]! / 100;
    l.foot[2] = v[o + 5]! / 100;
    l.damage = v[o + 6]! / 100;
    l.t = v[o + 7]! / 100;
  }
}

/** The host's memory of what a body looked like when last sent (cells, turrets, powered set). */
export class BodySync {
  private cells = new Map<number, string>();
  private turrets = new Map<number, string>();
  private self = '';
  private version = -1;

  /** Cells added or changed (id, dir, hp, max hp), removed, turrets, self-powered: what is new. */
  delta(b: BlockBody, full: boolean, out: BodyDelta): void {
    if (full) {
      this.cells.clear();
      this.turrets.clear();
      this.self = '';
    }
    const c: number[] = [];
    const seen = new Set<number>();
    for (const [key, cell] of b.cells) {
      seen.add(key);
      const hp = Math.round(cell.hp);
      const v = `${cell.id},${cell.dir},${hp},${cell.maxHp}`;
      if (this.cells.get(key) === v) continue;
      this.cells.set(key, v);
      c.push(key, cell.id, cell.dir, hp, cell.maxHp);
    }
    if (c.length) out.c = c;
    if (full || this.version !== b.version || this.cells.size !== seen.size) {
      const r: number[] = [];
      for (const key of this.cells.keys()) {
        if (seen.has(key)) continue;
        r.push(key);
        this.cells.delete(key);
      }
      if (r.length) out.r = r;
      this.version = b.version;
    }
    const tu: number[] = [];
    for (const [key, s] of b.cannons) {
      const v = [key, q3(s.yaw), q3(s.pitch), q2(s.recoil), s.ammo, q2(s.cooldown)];
      const j = v.join(',');
      if (this.turrets.get(key) === j) continue;
      this.turrets.set(key, j);
      tu.push(...v);
    }
    if (tu.length) out.tu = tu;
    const self = [...b.selfPowered].sort((x, y) => x - y).join(',');
    if (self !== this.self) {
      this.self = self;
      out.sp = [...b.selfPowered];
    }
  }
}

/** Applies a body delta's cells, turrets and powered set on the guest (true: the shape changed). */
export function applyBody(b: BlockBody, d: BodyDelta, full: boolean): boolean {
  let shape = false;
  if (full) {
    b.cells.clear();
    b.cannons.clear();
    shape = true;
  }
  const c = d.c;
  if (c) {
    for (let i = 0; i + 4 < c.length; i += 5) {
      const key = c[i]!;
      const id = c[i + 1]!;
      const dir = c[i + 2]!;
      const old = b.cells.get(key);
      if (!old || old.id !== id || old.dir !== dir) shape = true;
      b.cells.set(key, { id, dir, hp: c[i + 3]!, maxHp: c[i + 4]! || blockDef(id).hp });
      if (TURRET_IDS.has(id) && !b.cannons.has(key)) b.cannons.set(key, { cooldown: 0, yaw: 0, pitch: 0.6, recoil: 0, ammo: 0 });
      else if (!TURRET_IDS.has(id)) b.cannons.delete(key);
    }
  }
  if (d.r?.length) {
    shape = true;
    for (const key of d.r) {
      b.cells.delete(key);
      b.cannons.delete(key);
      b.selfPowered.delete(key);
    }
  }
  if (d.sp) {
    b.selfPowered.clear();
    for (const key of d.sp) b.selfPowered.add(key);
    shape = true;
  }
  const tu = d.tu;
  if (tu) {
    for (let i = 0; i + 5 < tu.length; i += 6) {
      const s = b.cannons.get(tu[i]!);
      if (!s) continue;
      s.yaw = tu[i + 1]! / 1000;
      s.pitch = tu[i + 2]! / 1000;
      s.recoil = tu[i + 3]! / 100;
      s.ammo = tu[i + 4]!;
      s.cooldown = tu[i + 5]! / 100;
    }
  }
  if (shape) b.changed();
  return shape;
}

/** Item drops: item count x y z age */
export const DROP_LERP: Lerp[] = [0, 0, 1, 1, 1, 1];
/** Falling blocks: block x y z rot */
export const FALL_LERP: Lerp[] = [0, 1, 1, 1, 1];
/** Supply crates: x y z sway landed t */
export const CRATE_LERP: Lerp[] = [1, 1, 1, 1, 0, 1];
/** Evoker fangs: x y z yaw t */
export const FANG_LERP: Lerp[] = [0, 0, 0, 0, 1];

// ------------------------------------------------------------------ deltas

/** Values that differ from what was sent last: [mask, ...values] (null when nothing changed). */
export function diffValues(prev: number[], next: number[]): number[] | null {
  let mask = 0;
  const out: number[] = [];
  for (let i = 0; i < next.length; i += 1) {
    if (prev[i] === next[i]) continue;
    mask += 2 ** i;
    out.push(next[i]!);
  }
  return mask === 0 ? null : [mask, ...out];
}

/** Applies [mask, ...values] onto a full record (in place). */
export function patchValues(base: number[], patch: number[], from = 0): void {
  let mask = patch[from]!;
  let k = from + 1;
  for (let i = 0; mask > 0; i += 1) {
    const bit = mask % 2;
    mask = (mask - bit) / 2;
    if (bit) base[i] = patch[k++]!;
  }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI * 1000) d -= Math.PI * 2000;
  while (d < -Math.PI * 1000) d += Math.PI * 2000;
  return a + d * t;
}

/** Interpolates two quantized records by their lerp table (discrete values come from `b`). */
export function lerpValues(a: number[], b: number[], t: number, lerp: Lerp[], out: number[]): number[] {
  for (let i = 0; i < b.length; i += 1) {
    const mode = lerp[i] ?? 0;
    const x = a[i] ?? b[i]!;
    out[i] = mode === 0 ? b[i]! : mode === 2 ? lerpAngle(x, b[i]!, t) : x + (b[i]! - x) * t;
  }
  out.length = b.length;
  return out;
}

// ------------------------------------------------------------------ messages

/** What a pose (or a view ray) is placed relative to: the world, the fortress, a giant. */
export const FRAME_WORLD = 0;
export const FRAME_FORTRESS = 1;
export const FRAME_GIANT = 2;

/** Player avatar flags. */
export const PF = {
  ground: 1, climbing: 2, helm: 4, gunner: 8, dead: 16, hen: 32, swim: 64, away: 128, build: 256, leap: 512, grapple: 1024,
} as const;

/**
 * A player's pose: frame, giant id (frame 2), position in the frame (cm), yaw and pitch (world,
 * milliradians), velocity (cm/s), walk phase, flags, held item (-1 the pick), arm swing,
 * parachute (hundredths), the stick (hundredths), full steam and jump held, the host's move
 * count it knows of (older poses are stale), the helm's turn (hundredths).
 */
export const P = { frame: 0, giant: 1, x: 2, y: 3, z: 4, yaw: 5, pitch: 6, vx: 7, vy: 8, vz: 9, walk: 10, flags: 11, item: 12, swing: 13, chute: 14, mx: 15, mz: 16, boost: 17, jump: 18, epoch: 19, turn: 20 } as const;
export const POSE_SIZE = 21;
export const POSE_LERP: Lerp[] = [0, 0, 1, 1, 1, 2, 2, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1];

/** A view ray in a frame: [frame, giant, ox, oy, oz (cm), dx, dy, dz (thousandths)]. */
export type WireRay = number[];

/** One entity list's changes in a snapshot: new records ([id, ...values]), updates ([id, mask, ...values]), removed ids. */
export interface EntDelta {
  n?: number[][];
  u?: number[][];
  r?: number[];
}

/**
 * The fortress (or a giant's body): pose [centre x, y, centre z (cm), yaw (thousandths)],
 * walk [phase, moving, shake, leg scale], legs (8 values each: hip xyz, foot xyz, damage,
 * swing), changed cells [key, id, dir, hp], removed keys, self-powered keys, changed turrets
 * [key, yaw, pitch, recoil, ammo, cooldown].
 */
export interface BodyDelta {
  p: number[];
  wk?: number[];
  legs?: number[];
  c?: number[];
  r?: number[];
  sp?: number[];
  tu?: number[];
}

/** A giant: its body, and on arrival what it is; then the facts its bar and model show. */
export interface GiantDelta extends BodyDelta {
  type?: string;
  name?: string;
  /** dead, blind, rage, windup, contact, charge, heavy, aimKey, aimT, roared, lair (-1: none), dormant, a seal's guardian. */
  st?: number[];
}

/** A building on the crane: stage, progress, where it settles in the hold, who lifted it. */
export interface HoistDelta extends BodyDelta {
  sid: string;
  /** Its stage (crane.ts HOIST_STAGES) and seconds into it. */
  stage: number;
  t: number;
  /** Fortress-local middle of its storey at its floor. */
  mid: number[];
  /** 0 the host lifted it, 1 the guest. */
  by: number;
  info: unknown;
  /** The heave's strain, the perfect beats (bits: heave, drop). */
  st?: number;
  pf?: number;
  /** Where its chains take hold (cargo-local x y z, four times). */
  eav?: number[];
  /** The storey it becomes (cell rows, flat), while its blueprint shows. */
  base?: number[];
  /** Over its mark: the way it swings there (level unit x z), and the jib's trim across it (blocks). */
  ax?: number[];
  tr?: number;
}

/** A TNT crate on the crane (crane.ts encodeCraneDrop): who works it, its stage, the rig, where it would land. */
export interface DropDelta {
  by: number;
  st: number;
  t: number;
  r: number[];
  aim: number[] | 0;
  n: number;
  /** It has burst (the view lingers a moment). */
  b: number;
}

export interface Snapshot {
  t: 's';
  /** Host game time (seconds) and the snapshot's number. */
  tm: number;
  q: number;
  /** Changed parts of the shared state (see SHARED). */
  g?: Record<string, unknown>;
  f?: BodyDelta;
  /** Giants by id (0: gone). */
  gi?: Record<string, GiantDelta | 0>;
  /** The building on the crane (0: none). */
  ho?: HoistDelta | 0;
  cd?: DropDelta | 0;
  /** World cells changed: x y z id meta, ... */
  w?: number[];
  /** Structures hoisted, chests looted since the last snapshot. */
  hz?: string[];
  lc?: number[];
  e?: Record<string, EntDelta>;
  /** One-off effects: sounds, particles, lights, news, things happening to the guest's own player. */
  fx?: unknown[][];
  /** The guest's own state as the host keeps it (when it changed). */
  me?: Record<string, unknown>;
  /** The host's avatar (a pose). */
  h?: number[];
}

export interface WelcomeState {
  seed: number;
  host: string;
  /** The game as a save (fortress, hold, quests...) and the world's edits ([chunk, cell, value], ...). */
  save: unknown;
  edits: number[];
  /** Where the guest starts (fortress-local) and which way it faces. */
  spawn: [number, number, number];
  yaw: number;
  snap: Snapshot;
}

/** Entity lists on the wire. */
export const LISTS = ['m', 'v', 'a', 'c', 'pr', 'dr', 'fb', 'ad', 'fg', 'pt'] as const;
export type ListName = (typeof LISTS)[number];
