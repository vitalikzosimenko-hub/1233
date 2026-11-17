// The fortress crane: a slewing, luffing jib crane on the bow mast that hoists village buildings
// into the hold. A lift goes in six stages: the jib swings out over the building and the hook comes
// down onto its roof, four chains latch on its eaves (REACH); the crane takes the strain while the
// ground cracks round it (HEAVE: tap as the needle reaches the gold); it tears out of the ground
// with the soil still hanging off its foundations (LIFT); it swings across on its rope, lagging
// and overshooting like a real load, shedding clods (SWING); it hangs over its place in the hold
// while a blueprint of the storey it becomes glows there (DROP: trim the jib under it with the stick
// to steady it, and tap as it swings over the mark);
// and it unloads block by block, each block flying down into the storey from the bottom up, until
// the chains hang empty (BUILD).
//
// Between lifts the crane drops TNT: by its mast, the operator has the crew hook a crate on, swings the
// jib round and out over the monsters (the crate swings on its rope the same way a load does: lead it),
// and lets go where the red ring on the ground shows it will land.
//
// The host runs the lift; a co-op mate is sent the crane's pose, the load and its gauge, and the
// unloading as one effect it plays out itself.
import { B, I, blockDef } from './blocks';
import { kx, ky, kz, key3, tiltApply, type BlockBody } from './body';
import { BlockBody as Body } from './body';
import type { Game } from './game';
import { F_OVERLAY, F_UNLIT, type MeshBuilder } from './gl';
import { applyHoldChanges, holdChanges, holdEntries, holdFor, holdMachines, mergeInto, wrapAngle, type CargoInfo, type CellRow } from './fortress';
import { TNT_GRAVITY } from './combat';
import { feat } from './feats';
import { holdPlan, holdSlotFront, holdSlotSpot, nextHoldSlot, STOREY } from './hold';
import type { Vec3 } from './math3d';
import { add, beam, blobShadow, blockCube, scale } from './models';
import { tileRect } from './mesher';
import type { PlayerCtx } from './player-ctx';
import type { Projectile } from './entities';
import { startle } from './animals';
import { trusts } from './quests';
import { clamp } from './rng';
import { HOIST_INFO, isHoistable, type Structure } from './structures';
import { DIRS } from './world';

/** How far from the fortress a building may be lifted. */
export const HOIST_RANGE = 64;

export type HoistStage = 'reach' | 'heave' | 'lift' | 'swing' | 'drop' | 'build';
export const HOIST_STAGES: readonly HoistStage[] = ['reach', 'heave', 'lift', 'swing', 'drop', 'build'];

/** Seconds: the jib swinging out, each chain latching, the longest heave, the lift, the drop's wait. */
const REACH_T = 1.25;
const LATCH_T = 0.14;
const HEAVE_T = 2.2;
const LIFT_T = 1.0;
const DROP_T = 5.5;
/** Gold on the heave gauge (share of full strain); how near over its mark a load counts as on it. */
export const HEAVE_GOLD: readonly [number, number] = [0.72, 0.9];
export const DROP_NEAR = 0.42;
/** Hook block over the load's roof; shortest rope below the jib tip; rope at cruise height. */
const SLING = 2.4;
const ROPE_MIN = 1.4;
const ROPE_CRUISE = 3;
/** Steepest and flattest jib (radians from level). */
const LUFF_MAX = 1.32;
const LUFF_MIN = 0.12;
/** Pendulum: gravity (stiffer than real, for a lively swing) and damping. */
const SWING_G = 26;
/** How far the operator can trim the jib across the swing (blocks at its tip), and how briskly it answers. */
const TRIM = 1.7;
const TRIM_K = 4.5;
/** The jib when stowed: pointing out over the bow quarter, raised, short. */
const STOW_SLEW = 0.55;
const STOW_LUFF = 0.95;
const STOW_REACH = 5.5;
const STOW_ROPE = 2.6;

/** All it takes to draw the crane (the host's, mirrored to a co-op mate). */
export interface CraneRig {
  /** World heading of the jib (radians, 0 = +x), its elevation, its length from the pivot. */
  slew: number;
  luff: number;
  reach: number;
  /** How far the telescoping mast has run up. */
  mast: number;
  /** Rope paid out below the jib tip. */
  rope: number;
  /** Hook swing: horizontal offset from straight below the tip, and its velocity. */
  o: [number, number];
  ov: [number, number];
  /** The tip's velocity last frame (its acceleration swings the hook). */
  tipV: Vec3;
  /** Winch drum's turn (radians). */
  drum: number;
  /** Chains on the load, 0..4 (fractional while one goes on). */
  latch: number;
  /** How hard the crane pulls (the jib bends a little), 0..1. */
  strain: number;
}

export function newRig(): CraneRig {
  return { slew: 0, luff: STOW_LUFF, reach: STOW_REACH, mast: 0, rope: STOW_ROPE, o: [0, 0], ov: [0, 0], tipV: [0, 0, 0], drum: 0, latch: 0, strain: 0 };
}

/** One block of the unloading, flying from the load into the storey. */
export interface FlyBlock {
  id: number;
  /** Source cell (cargo-local key) it leaves from, and where it was when it left (world). */
  src: number;
  from: Vec3 | null;
  /** Where it goes (fortress-local cell centre), or a point it vanishes at (`vanish`). */
  to: Vec3;
  vanish: boolean;
  /** Seconds after the unloading began that it leaves, and its flight. */
  t0: number;
  dur: number;
  arc: number;
  spin: number;
  half: number;
  landed: boolean;
}

/** A clod of soil dropping off the load's foundations. */
interface Clod {
  id: number;
  p: Vec3;
  v: Vec3;
  spin: number;
  vspin: number;
}

/** What the crane leaves in the air for the eye (every machine plays its own). */
export interface CraneFx {
  blocks: FlyBlock[];
  /** Game time the unloading began. */
  start: number;
  /** Cargo cells (keys) to leave the load at their time, not yet taken off it. */
  pending: Array<{ key: number; t0: number; poof: boolean }>;
  clods: Clod[];
  /** Notes played so far (the unloading climbs a scale). */
  notes: number;
  lastNote: number;
  /** When the last block of the unloading lands (seconds after it began). */
  end: number;
  /** Journal pages to hand over once the moment has passed (game time). */
  pages: Array<{ id: string; at: number }>;
}

export function newCraneFx(): CraneFx {
  return { blocks: [], start: 0, pending: [], clods: [], notes: 0, lastNote: -1, end: 0, pages: [] };
}

export interface Hoist {
  s: Structure;
  cargo: BlockBody;
  stage: HoistStage;
  /** Seconds into the stage. */
  t: number;
  /** Where it settles (fortress-local: the middle of its storey at its floor), and the turn it makes to face the deck. */
  mid: Vec3;
  turn: number;
  /** The storey (and roof) it becomes in the hold, cornered at its floor; empty when built into another. */
  base: CellRow[];
  /** With the hold full: the building aboard (cargo index) it is built into, else -1. */
  merge: number;
  /** World cells still to be cleared (the building and the soil under it, a few a frame). */
  clear: Array<[number, number, number]>;
  info: CargoInfo;
  /** The player who lifted it. */
  by: PlayerCtx;
  /** The rig as it stood when this stage began (the jib eases from it). */
  rig0: { slew: number; luff: number; reach: number; mast: number; rope: number };
  /** Mast run up for the work, and the height the load cruises at (its top, world). */
  mastWork: number;
  cruise: number;
  /** 0..1: the strain on the heave. */
  strain: number;
  /** Perfect beats: the heave, the drop. */
  perfect: [boolean, boolean];
  /** Where the chains take hold (cargo-local), and the load's height (cells). */
  eaves: Vec3[];
  height: number;
  /** Soil under the foundations (cargo-local keys), shed one by one in flight. */
  clump: number[];
  /** World columns (x * 4096 + z) dug out under it: they are left a pit. */
  pit: Set<number>;
  clodTimer: number;
  /** The building's footprint edge at the ground (cracks open there). */
  rim: Array<[number, number, number]>;
  /** How near over its mark the load was lately (a late tap still counts what it saw). */
  near: number[];
  /** The way the load swings over its mark (unit, level): across the jib, as it came in. */
  axis: [number, number];
  /** The bearing and radius the swing starts from (world, from the pivot). */
  swingFrom: [number, number];
  /** Unloading: when the last block lands (seconds into the stage). */
  buildEnd: number;
  /** The whoosh of the swing has been heard. */
  whooshed: boolean;
  /** The operator's stick across the swing (-1..1, along `axis`), and the jib's trim it drives (blocks) and its speed. */
  steer: number;
  trim: number;
  trimV: number;
  /** Seconds of slow motion left (a perfect heave tears it out in style). */
  slow: number;
  /** The needle has reached the gold (the operator felt it). */
  gold: boolean;
  /** Which way the load last swung along its mark (its chains clink as it turns). */
  swingDir: number;
}

// ------------------------------------------------------------------ the mast

const MAST_FALLBACK: Vec3 = [13.5, 1, 9.5];
const mastCache = { body: null as BlockBody | null, version: -1, at: MAST_FALLBACK, real: false };

/** The mast top (fortress-local, middle of its top face): the starboard bow's spruce column. */
export function craneBase(F: BlockBody): { at: Vec3; real: boolean } {
  if (mastCache.body === F && mastCache.version === F.version) return mastCache;
  mastCache.body = F;
  mastCache.version = F.version;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (const [k, c] of F.cells) {
    if (c.id !== B.SPRUCE_LOG) continue;
    const x = kx(k);
    const y = ky(k);
    const z = kz(k);
    if (F.blockAt(x, y + 1, z) !== B.AIR) continue;
    if (F.blockAt(x, y - 1, z) !== B.SPRUCE_LOG || F.blockAt(x, y - 4, z) !== B.SPRUCE_LOG) continue;
    // (The column nearest where the first mast stood: the hold's own posts never take its place.)
    const d = Math.hypot(x - 13, z - 9) * 4 - y;
    if (d < bestD) {
      bestD = d;
      best = [x + 0.5, y + 1, z + 0.5];
    }
  }
  mastCache.at = best ?? MAST_FALLBACK;
  mastCache.real = best !== null;
  return mastCache;
}

/** The pivot of the jib (world): over the mast top, run up by `mast`. */
function pivotAt(g: Game, mast: number): Vec3 {
  const F = g.fortress;
  const m = craneBase(F).at;
  return F.toWorld(m[0], m[1] + 0.45 + mast, m[2]);
}

function tipOf(p: Vec3, slew: number, luff: number, reach: number): Vec3 {
  const c = Math.cos(luff) * reach;
  return [p[0] + Math.cos(slew) * c, p[1] + Math.sin(luff) * reach, p[2] + Math.sin(slew) * c];
}

/** Jib heading, elevation and length that put its tip at (x, z), as near height y as it may go. */
function aimAt(p: Vec3, x: number, y: number, z: number): { slew: number; luff: number; reach: number } {
  const dx = x - p[0];
  const dz = z - p[2];
  const D = Math.max(2.5, Math.hypot(dx, dz));
  const luff = clamp(Math.atan2(y - p[1], D), LUFF_MIN, LUFF_MAX);
  return { slew: Math.atan2(dz, dx), luff, reach: D / Math.cos(luff) };
}

function smooth(u: number): number {
  const t = clamp(u, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

// ------------------------------------------------------------------ the load on its rope

/**
 * Where the hook and the load's top hang (world), and the way the rope runs (down, unit). `extra` is
 * how far below the hook the swinging weight hangs (the load's middle, or the bare hook's own).
 */
function hang(rig: CraneRig, tip: Vec3, extra: number): { hook: Vec3; top: Vec3; dir: Vec3 } {
  const [ox, oz] = rig.o;
  const L = rig.rope + extra;
  const d = Math.hypot(ox, oz);
  const k = d > L * 0.6 ? (L * 0.6) / d : 1;
  const hx = ox * k;
  const hz = oz * k;
  const dy = -Math.sqrt(Math.max(0.01, L * L - hx * hx - hz * hz));
  const n = Math.hypot(hx, dy, hz);
  const dir: Vec3 = [hx / n, dy / n, hz / n];
  return { hook: add(tip, scale(dir, rig.rope)), top: add(tip, scale(dir, rig.rope + SLING)), dir };
}

/** The rope swings: the tip's acceleration drags the hook (and what hangs on it) behind. */
function swingStep(rig: CraneRig, tip: Vec3, dt: number, length: number, damping: number): void {
  if (dt <= 0) return;
  const tv: Vec3 = [(tip[0] - lastTip[0]) / dt, 0, (tip[2] - lastTip[2]) / dt];
  const ax = clamp((tv[0] - rig.tipV[0]) / dt, -30, 30);
  const az = clamp((tv[2] - rig.tipV[2]) / dt, -30, 30);
  rig.tipV = tv;
  lastTip[0] = tip[0];
  lastTip[1] = tip[1];
  lastTip[2] = tip[2];
  const w2 = SWING_G / Math.max(1.5, length);
  const w = Math.sqrt(w2);
  const steps = Math.max(1, Math.ceil(dt / 0.02));
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    rig.ov[0] += (-w2 * rig.o[0] - ax - 2 * damping * w * rig.ov[0]) * h;
    rig.ov[1] += (-w2 * rig.o[1] - az - 2 * damping * w * rig.ov[1]) * h;
    rig.o[0] += rig.ov[0] * h;
    rig.o[1] += rig.ov[1] * h;
  }
  const lim = length * 0.55;
  const d = Math.hypot(rig.o[0], rig.o[1]);
  if (d > lim) {
    rig.o[0] *= lim / d;
    rig.o[1] *= lim / d;
  }
}

/** The tip last frame (one crane per game). */
const lastTip: Vec3 = [0, 0, 0];

/** Puts the load where its rope holds it: its top under the hook, tilted along the rope, turned to `yaw`. */
function placeLoad(h: Hoist, top: Vec3, dir: Vec3, yaw: number, tilt: number): void {
  const C = h.cargo;
  C.setYaw(yaw);
  C.setCentre(top[0], top[2]);
  C.y = top[1] - (C.maxY + 1);
  // (Rigid on its chains, the load leans with the rope: not quite all the way.)
  const up: Vec3 = [-dir[0] * tilt, 1, -dir[2] * tilt];
  const n = Math.hypot(up[0], up[1], up[2]);
  C.tilt[0] = up[0] / n;
  C.tilt[1] = up[1] / n;
  C.tilt[2] = up[2] / n;
  C.tiltAt[0] = top[0];
  C.tiltAt[1] = top[1];
  C.tiltAt[2] = top[2];
}

/** A point of the load (cargo-local) where it is drawn (world): turned, then leaning on its rope. */
export function loadPoint(C: BlockBody, lx: number, ly: number, lz: number): Vec3 {
  const w = C.toWorld(lx, ly, lz);
  if (C.tilt[1] >= 0.99999) return w;
  const r = tiltApply(C.tilt, [w[0] - C.tiltAt[0], w[1] - C.tiltAt[1], w[2] - C.tiltAt[2]]);
  return [r[0] + C.tiltAt[0], r[1] + C.tiltAt[1], r[2] + C.tiltAt[2]];
}

// ------------------------------------------------------------------ starting a lift

/** A village building the crane can lift right now, or why not. */
export function hoistCheck(g: Game, s: Structure | null): { ok: boolean; why: string } {
  if (!s || !isHoistable(s)) return { ok: false, why: '' };
  if (g.world.hoisted.has(s.id)) return { ok: false, why: '' };
  if (g.hoist || g.craneDrop) return { ok: false, why: 'The crane is busy' };
  if (!trusts(g, s.site)) return { ok: false, why: `${s.site.name} won't part with its buildings yet: help them first (see your quest)` };
  const c = g.fortressCentre();
  const sx = (s.minX + s.maxX + 1) / 2;
  const sz = (s.minZ + s.maxZ + 1) / 2;
  if (Math.hypot(sx - c[0], sz - c[2]) > hoistRange(g)) return { ok: false, why: 'Too far from the fortress crane' };
  if (nextHoldSlot(holdEntries(g.cargo)) < 0 && mergeInto(g, s.kind) < 0) return { ok: false, why: 'The hold is full, and every building of this kind in it fully built up' };
  return { ok: true, why: '' };
}

/** Heading (radians) of a DIRS direction. */
function dirAngle(d: number): number {
  const v = DIRS[d] ?? DIRS[0]!;
  return Math.atan2(v[2], v[0]);
}

/**
 * The crane goes for a building: its standing blocks (and a clump of the soil under them) become
 * the load, its villagers jump clear, and the jib swings out. With the hold full it will be built
 * into a building of its kind aboard instead (a level up).
 */
export function startHoist(g: Game, s: Structure): boolean {
  const check = hoistCheck(g, s);
  if (!check.ok) {
    if (check.why) g.deny(check.why);
    return false;
  }
  const entries = holdEntries(g.cargo);
  const slot = nextHoldSlot(entries);
  const merge = slot < 0 ? mergeInto(g, s.kind) : -1;
  const cargo = new Body('cargo');
  const cells: CellRow[] = [];
  const clear: Array<[number, number, number]> = [];
  const foot = new Set<number>();
  for (let i = 0; i < s.count; i += 1) {
    const x = s.xs[i]!;
    const y = s.ys[i]!;
    const z = s.zs[i]!;
    const id = s.ids[i]!;
    if (id === B.AIR) continue;
    // Only what still stands goes up (the player may have mined parts of it).
    if (g.world.get(x, y, z) !== id) continue;
    clear.push([x, y, z]);
    if (y === s.floorY) foot.add((x - s.minX) * 256 + (z - s.minZ));
    // Windmill sails come off: they spin as a model aboard.
    if (s.kind === 'windmill' && s.hub && (id === B.FENCE || id === B.WOOL) && (x - s.hub.x) * DIRS[s.front]![0] + (z - s.hub.z) * DIRS[s.front]![2] >= 1) continue;
    cells.push([x - s.minX, y - s.floorY, z - s.minZ, id, Math.max(0, s.metas[i]!)]);
  }
  if (cells.length < 8) {
    g.deny('Not enough of it left to lift');
    return false;
  }
  // The soil it stands on comes up with it, a root ball under its middle: it leaves a bowl a block
  // deep inside its walls, two in the middle (a villager can climb out of it).
  const W = s.maxX - s.minX + 1;
  const D = s.maxZ - s.minZ + 1;
  const clump: CellRow[] = [];
  const pit = new Set<number>();
  const has = new Set(cells.map((c) => key3(c[0], c[1], c[2])));
  for (const k of foot) {
    const lx = Math.floor(k / 256);
    const lz = k % 256;
    const edge = Math.min(lx, lz, W - 1 - lx, D - 1 - lz);
    if (edge < 1) continue;
    pit.add((s.minX + lx) * 4096 + s.minZ + lz);
    const r = Math.abs(Math.sin(lx * 12.9898 + lz * 78.233 + s.minX) * 43758.5453) % 1;
    const depth = edge < 2 ? 0 : r < 0.3 && edge >= 3 ? 2 : 1;
    for (let d = 1; d <= depth; d += 1) {
      if (has.has(key3(lx, -d, lz))) continue;
      const wx = s.minX + lx;
      const wy = s.floorY - d;
      const wz = s.minZ + lz;
      const id = g.world.get(wx, wy, wz);
      if (id === B.AIR || id === B.WATER || id === B.BEDROCK || !blockDef(id).solid) break;
      clump.push([lx, -d, lz, id, 0]);
      clear.push([wx, wy, wz]);
    }
  }
  cargo.setMany([...cells, ...clump]);
  cargo.x = s.minX;
  cargo.y = s.floorY;
  cargo.z = s.minZ;
  cargo.savePose();
  const zone = g.world.terrain.zone(s.site.x, s.site.z);
  const info: CargoInfo = { kind: s.kind, hub: null, dir: s.front, slot, zone };
  // What it becomes: its storey (and roof) in the hold as the hold will stand, cornered at its floor.
  let base: CellRow[] = [];
  let mid: Vec3;
  let face = 0;
  if (slot >= 0) {
    const after = holdPlan([...entries, { kind: s.kind, slot, zone }]);
    const own = [...after.cells].filter(([k]) => after.owner.get(k) === slot);
    let [x0, y0, z0, x1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity];
    for (const [k] of own) {
      x0 = Math.min(x0, kx(k));
      y0 = Math.min(y0, ky(k));
      z0 = Math.min(z0, kz(k));
      x1 = Math.max(x1, kx(k));
      z1 = Math.max(z1, kz(k));
    }
    base = own.map(([k, v]) => [kx(k) - x0, ky(k) - y0, kz(k) - z0, v & 255, v >> 8]);
    mid = [(x0 + x1 + 1) / 2, y0, (z0 + z1 + 1) / 2];
    face = holdSlotFront(slot);
  } else {
    // Into a building of its kind: over the top of its stack.
    const spot = holdSlotSpot(g.cargo[merge]!.slot ?? -1);
    const F = g.fortress;
    mid = spot ? [spot.x, Math.max(spot.y + STOREY, F.maxY - 2), spot.z] : [(F.minX + F.maxX + 1) / 2, F.maxY, (F.minZ + F.maxZ + 1) / 2];
    face = s.front;
  }
  // The chains take hold at the eaves: the highest block near each corner of the roof.
  const cols = cargo.columns();
  const eaves: Vec3[] = [];
  for (const [cx, cz] of [[0, 0], [W - 1, 0], [W - 1, D - 1], [0, D - 1]] as const) {
    let best: Vec3 | null = null;
    for (let r = 0; r <= 3 && !best; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dz = -r; dz <= r; dz += 1) {
          const x = clamp(cx + (cx === 0 ? dx + r : dx - r), 0, W - 1);
          const z = clamp(cz + (cz === 0 ? dz + r : dz - r), 0, D - 1);
          const c = cols.get((x + 64) * 256 + (z + 64));
          if (!c || c[1] < 1) continue;
          if (!best || c[1] + 1 > best[1]) best = [x + (cx === 0 ? 0.2 : 0.8), c[1] + 1, z + (cz === 0 ? 0.2 : 0.8)];
        }
      }
    }
    eaves.push(best ?? [cx + 0.5, cargo.maxY + 1, cz + 0.5]);
  }
  const rim: Array<[number, number, number]> = [];
  for (let x = -1; x <= W; x += 1) {
    for (let z = -1; z <= D; z += 1) {
      if (x >= 0 && z >= 0 && x < W && z < D) continue;
      if ((x + z) % 2 !== 0 && rim.length > 30) continue;
      const wx = s.minX + x;
      const wz = s.minZ + z;
      if (blockDef(g.world.get(wx, s.floorY, wz)).solid) rim.push([wx, s.floorY, wz]);
    }
  }
  const F = g.fortress;
  const height = cargo.maxY - cargo.minY + 1;
  // The mast runs up clear of the hold; the load cruises with its feet above it.
  const holdTop = F.y + F.maxY + 1.5;
  const cruise = Math.max(holdTop, s.floorY + 3) + (cargo.maxY + 1) - cargo.minY + 1;
  const pivot0 = pivotAt(g, 0);
  const mastWork = clamp(holdTop + 2.5 - pivot0[1], 0, 26);
  const rig = g.crane;
  g.hoist = {
    s, cargo, stage: 'reach', t: 0, mid, turn: wrapAngle(dirAngle(face) - dirAngle(s.front)),
    base, merge, clear, info, by: g.cx,
    rig0: { slew: rig.slew, luff: rig.luff, reach: rig.reach, mast: rig.mast, rope: rig.rope },
    mastWork, cruise, strain: 0, perfect: [false, false], eaves, height,
    clump: clump.map(([x, y, z]) => key3(x, y, z)), pit, clodTimer: 0.2, rim, near: [], axis: [1, 0], swingFrom: [0, 0], buildEnd: 0, whooshed: false,
    steer: 0, trim: 0, trimV: 0, slow: 0, gold: false, swingDir: 0,
  };
  g.hoistHub = null;
  g.world.hoisted.add(s.id);
  // Its villagers jump off (one of them is not happy about it); chests come along.
  let owner = null;
  for (const v of g.villagers) {
    if (v.home !== s.id || v.recruited) continue;
    v.vy = 6;
    owner = v;
  }
  g.villagerReact('hoist', (s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2, owner);
  // Hens about the farm scatter.
  startle(g, (s.minX + s.maxX) / 2, s.floorY, (s.minZ + s.maxZ) / 2, 9, 2);
  g.sfx('winch', 'metal', 0.9);
  g.toast(`Hoisting the ${HOIST_INFO[s.kind]?.label ?? s.name}...`);
  g.report('primary_input');
  return true;
}

// ------------------------------------------------------------------ the lift, frame by frame

/** The stage moves on: the jib eases on from where it stands. */
function nextStage(g: Game, h: Hoist, stage: HoistStage): void {
  h.stage = stage;
  h.t = 0;
  const r = g.crane;
  h.rig0 = { slew: r.slew, luff: r.luff, reach: r.reach, mast: r.mast, rope: r.rope };
}

/** Eases the rig from where the stage began toward a pose. */
function easeRig(g: Game, h: Hoist, e: number, to: { slew: number; luff: number; reach: number; mast: number; rope: number }): void {
  const r = g.crane;
  const a = h.rig0;
  r.slew = lerpAngle(a.slew, to.slew, e);
  r.luff = lerp(a.luff, to.luff, e);
  r.reach = lerp(a.reach, to.reach, e);
  r.mast = lerp(a.mast, to.mast, e);
  r.rope = lerp(a.rope, to.rope, e);
}

/** The building's middle (world, at its roof line). */
function buildingTop(h: Hoist): Vec3 {
  const s = h.s;
  return [(s.minX + s.maxX + 1) / 2, s.floorY + h.cargo.maxY + 1, (s.minZ + s.maxZ + 1) / 2];
}

/** Where the load settles over (world: the middle of its storey's floor). */
function slotPoint(g: Game, h: Hoist): Vec3 {
  return g.fortress.toWorld(h.mid[0], h.mid[1], h.mid[2]);
}

/**
 * The world cells of the building and its soil clear a few a frame (each one relights its
 * neighbourhood): the soil dug out leaves a pit; elsewhere its floor is grassed over (and anything
 * it had below the floor filled in).
 */
function clearSome(g: Game, h: Hoist, n: number): void {
  const floor = h.s.floorY;
  for (let i = 0; i < n && h.clear.length > 0; i += 1) {
    const [x, y, z] = h.clear.pop()!;
    const dug = h.pit.has(x * 4096 + z);
    let id: number = B.AIR;
    if (y === floor && !dug) id = B.GRASS;
    else if (y < floor && !dug) id = g.world.get(x, y + 1, z) === B.AIR ? B.GRASS : B.DIRT;
    g.world.set(x, y, z, id);
  }
}

/** Host, per frame (from the fortress's update). */
export function updateHoist(g: Game, dt: number): void {
  const h = g.hoist;
  if (!h) return;
  const F = g.fortress;
  const rig = g.crane;
  if (h.slow > 0) {
    h.slow -= dt;
    dt *= 0.3;
  }
  h.t += dt;
  clearSome(g, h, 48);
  const C = h.cargo;
  C.savePose();
  C.nudge[0] = C.nudge[1] = C.nudge[2] = 0;
  const work = pivotAt(g, h.mastWork);
  const loadLen = SLING + (C.maxY + 1 - C.minY) / 2;
  if (h.stage === 'reach' || h.stage === 'heave') {
    // The jib swings out over the building and the hook comes down onto its roof.
    const bt = buildingTop(h);
    const aim = aimAt(work, bt[0], bt[1] + SLING + 3.5, bt[2]);
    const tipY = work[1] + Math.sin(aim.luff) * aim.reach;
    const to = { ...aim, mast: h.mastWork, rope: Math.max(ROPE_MIN, tipY - bt[1] - SLING) };
    if (h.stage === 'reach') {
      easeRig(g, h, smooth(h.t / REACH_T), to);
      rig.drum += dt * 7;
      const latch = clamp((h.t - REACH_T) / LATCH_T, 0, 4);
      if (Math.floor(latch) > Math.floor(rig.latch)) {
        const e = h.eaves[Math.min(3, Math.floor(latch) - 1)]!;
        const p = C.toWorld(e[0], e[1], e[2]);
        g.sfxAt('latch', p[0], p[1], p[2], 0.9, 0.9 + Math.floor(latch) * 0.08, 48);
        g.particles.sparks(p[0], p[1], p[2], ['#ffe9a8', '#ffffff', '#ffb040'], 6, 3.5, 0.07, 0.35);
        buzzLifter(g, h, 12);
      }
      rig.latch = latch;
      // (Straight down until the load is off the ground.)
      rig.o = [0, 0];
      rig.ov = [0, 0];
      if (latch >= 4) {
        nextStage(g, h, 'heave');
        g.sfxAt('strain', bt[0], bt[1], bt[2], 1, 1, 56);
        g.crewSay('heave');
      }
    } else {
      easeRig(g, h, 1, to);
      h.strain = clamp(h.t / HEAVE_T, 0, 1);
      rig.strain = h.strain;
      rig.drum += dt * (1.5 + h.strain * 5);
      heaveFx(g, h, dt);
      // (A tick in the hand as the needle reaches the gold.)
      if (!h.gold && h.strain >= heaveGold(g)[0]) {
        h.gold = true;
        buzzLifter(g, h, 18);
      }
      if (h.strain >= 1) tearOut(g, h, false);
    }
    const tip = tipOf(pivotAt(g, rig.mast), rig.slew, rig.luff, rig.reach);
    lastTip[0] = tip[0];
    lastTip[1] = tip[1];
    lastTip[2] = tip[2];
    rig.tipV = [0, 0, 0];
    return;
  }
  // Off the ground: the load hangs on its rope from here on.
  rig.strain = Math.max(0, rig.strain - dt * 3);
  rig.latch = 4;
  const slot = slotPoint(g, h);
  const finalYaw = wrapAngle(F.yaw + h.turn);
  let topY = h.cruise;
  let yaw = 0;
  let damping = 0.06;
  if (h.stage === 'lift') {
    const bt = buildingTop(h);
    const u = clamp(h.t / LIFT_T, 0, 1);
    // A yank off the ground, then a steady haul up to cruising height.
    topY = lerp(bt[1] + 0.9, h.cruise, 1 - (1 - u) ** 3);
    const aim = aimAt(work, bt[0], h.cruise + SLING + ROPE_CRUISE, bt[2]);
    const tipY = work[1] + Math.sin(aim.luff) * aim.reach;
    easeRig(g, h, smooth(u), { ...aim, mast: h.mastWork, rope: Math.max(ROPE_MIN, tipY - topY - SLING) });
    rig.rope = Math.max(ROPE_MIN, work[1] + Math.sin(rig.luff) * rig.reach - topY - SLING);
    rig.drum -= dt * 9;
    if (u >= 1) {
      nextStage(g, h, 'swing');
      h.swingFrom = [Math.atan2(bt[2] - work[2], bt[0] - work[0]), Math.hypot(bt[0] - work[0], bt[2] - work[2])];
    }
  } else if (h.stage === 'swing') {
    // The jib slews round to its place in the hold; the load lags behind, then swings past.
    const to = [Math.atan2(slot[2] - work[2], slot[0] - work[0]), Math.hypot(slot[0] - work[0], slot[2] - work[2])] as const;
    const turn = Math.abs(wrapAngle(to[0] - h.swingFrom[0]));
    const dur = 1.5 + turn * 0.55 + Math.abs(to[1] - h.swingFrom[1]) * 0.02;
    const e = smooth(h.t / dur);
    const ang = lerpAngle(h.swingFrom[0], to[0], e);
    const R = Math.max(2.5, lerp(h.swingFrom[1], to[1], e));
    const tipY = Math.max(h.cruise + SLING + ROPE_CRUISE, work[1] + Math.tan(LUFF_MIN) * R);
    const luff = clamp(Math.atan2(tipY - work[1], R), LUFF_MIN, LUFF_MAX);
    rig.slew = ang;
    rig.luff = luff;
    rig.reach = R / Math.cos(luff);
    rig.mast = h.mastWork;
    rig.rope = Math.max(ROPE_MIN, work[1] + Math.sin(luff) * rig.reach - topY - SLING);
    yaw = finalYaw * e;
    damping = hasPart(g, 'taglines') ? 0.09 : 0.05;
    if (!h.whooshed && e > 0.35) {
      h.whooshed = true;
      g.sfxAt('whoosh', slot[0], h.cruise, slot[2], 0.7, 0.8, 56);
    }
    if (h.t >= dur) {
      nextStage(g, h, 'drop');
      const sx = slot[0] - work[0];
      const sz = slot[2] - work[2];
      const l = Math.hypot(sx, sz) || 1;
      h.axis = [-sz / l, sx / l];
      g.sfxAt('strain', slot[0], h.cruise, slot[2], 0.55, 1.25, 56);
    }
  } else {
    // Over its place: it hangs there swinging, and settles a little lower. The operator trims the
    // jib across the swing: kept under the load it steadies it, worked against it it pumps it.
    const aimS = aimAt(work, slot[0], h.cruise + SLING + ROPE_CRUISE, slot[2]);
    const want = h.stage === 'drop' ? clamp(h.steer, -1, 1) * TRIM : 0;
    h.trimV += ((want - h.trim) * TRIM_K * TRIM_K - 2 * TRIM_K * h.trimV) * dt;
    h.trim += h.trimV * dt;
    rig.slew = aimS.slew + h.trim / Math.max(2.5, Math.hypot(slot[0] - work[0], slot[2] - work[2]));
    rig.luff = aimS.luff;
    rig.reach = aimS.reach;
    rig.mast = h.mastWork;
    const low = Math.max(slot[1] + STOREY + 1.2 + (C.maxY + 1 - C.minY), h.cruise - 1.4);
    topY = lerp(h.cruise, low, smooth(h.t / 0.9));
    rig.rope = Math.max(ROPE_MIN, work[1] + Math.sin(rig.luff) * rig.reach - topY - SLING);
    yaw = finalYaw;
    damping = h.stage === 'build' ? 0.3 : hasPart(g, 'taglines') ? 0.15 : 0.075;
  }
  const pivot = pivotAt(g, rig.mast);
  const tip = tipOf(pivot, rig.slew, rig.luff, rig.reach);
  swingStep(rig, tip, dt, rig.rope + loadLen, damping);
  if (h.stage === 'drop' || h.stage === 'build') {
    // The crew's tag lines steady it across its swing: it swings to and fro over its mark, not round it.
    const [ax, az] = h.axis;
    const along = rig.o[0] * ax + rig.o[1] * az;
    const vAlong = rig.ov[0] * ax + rig.ov[1] * az;
    const ko = Math.exp(-dt * 1.8);
    const kv = Math.exp(-dt * 3.5);
    const ox = (rig.o[0] - along * ax) * ko;
    const oz = (rig.o[1] - along * az) * ko;
    const vx = (rig.ov[0] - vAlong * ax) * kv;
    const vz = (rig.ov[1] - vAlong * az) * kv;
    rig.o = [along * ax + ox, along * az + oz];
    rig.ov = [vAlong * ax + vx, vAlong * az + vz];
  }
  if (h.stage === 'drop' || h.stage === 'swing') swingClink(g, h);
  if (h.stage === 'drop') {
    h.near.push(offMark(g, h));
    if (h.near.length > 10) h.near.shift();
    if (h.t > 1.2 && offMark(g, h) > 1.1) g.crewSay('steady');
    if (h.t >= DROP_T) release(g, h, false);
  }
  const hung = hang(rig, tip, loadLen);
  placeLoad(h, hung.top, hung.dir, yaw, 0.8);
  // Clods of soil let go of the foundations now and then.
  if (h.stage !== 'build' && h.clump.length > 0) {
    h.clodTimer -= dt;
    if (h.clodTimer <= 0) {
      h.clodTimer = 0.12 + Math.random() * 0.35;
      dropClod(g, h);
    }
  }
  if (h.stage === 'build') {
    unload(g, h);
    if (h.t >= h.buildEnd) finish(g, h);
  }
}

/** The ground gives: it cracks round the building, dust spurts, the load shudders. */
function heaveFx(g: Game, h: Hoist, dt: number): void {
  const k = h.strain;
  h.cargo.nudge[0] = (Math.random() - 0.5) * 0.09 * k * k;
  h.cargo.nudge[1] = Math.random() * 0.05 * k;
  h.cargo.nudge[2] = (Math.random() - 0.5) * 0.09 * k * k;
  if (h.rim.length && Math.random() < dt * (2 + k * 14)) {
    const [x, y, z] = h.rim[Math.floor(Math.random() * h.rim.length)]!;
    g.particles.dust(x + 0.5, y + 1, z + 0.5, 1, 0.6, false);
    if (Math.random() < 0.5) g.particles.debris(x + 0.5, y + 1, z + 0.5, 'dirt', 2, 2.2, 0.09, 0.45);
  }
  if (k > 0.5 && Math.random() < dt * 3) g.renderer.shake(0.05 + k * 0.08);
  // The winch's pawl clicks faster as the strain comes on.
  h.clodTimer -= dt;
  if (h.clodTimer <= 0) {
    h.clodTimer = 0.24 - k * 0.16;
    const p = pivotAt(g, g.crane.mast);
    g.sfxAt('click', p[0], p[1], p[2], 0.55 + k * 0.4, 0.7 + k * 0.6, 40);
  }
}

/** It tears out of the ground (on the gold: with a bigger bang and a bonus). */
function tearOut(g: Game, h: Hoist, perfect: boolean): void {
  h.perfect[0] = perfect;
  h.strain = 1;
  h.clodTimer = 0.25;
  const s = h.s;
  const cx = (s.minX + s.maxX + 1) / 2;
  const cz = (s.minZ + s.maxZ + 1) / 2;
  const y = s.floorY + 0.6;
  // Whatever is left of it in the ground goes now.
  clearSome(g, h, h.clear.length);
  for (const [x, , z] of h.rim) {
    if (Math.random() < 0.55) g.particles.debris(x + 0.5, y + 0.4, z + 0.5, Math.random() < 0.5 ? 'dirt' : 'grass_side', 3, 4.5, 0.12, 0.8);
  }
  const r = Math.max(s.maxX - s.minX, s.maxZ - s.minZ) / 2 + 1;
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    g.particles.dust(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 2, 1.5, false);
  }
  g.particles.ring(cx, y + 0.2, cz, r * 0.9, 0.9, 0.8, 0.6);
  g.sfxAt('rip', cx, y, cz, 1, 1, 64);
  g.sfxAt('stomp', cx, y, cz, 0.6, 0.8, 56);
  g.renderer.shake(perfect ? 0.6 : 0.42);
  g.crane.ov = [(Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2];
  buzzLifter(g, h, perfect ? 90 : 45);
  if (perfect) {
    g.particles.sparks(cx, y + h.height * 0.6, cz, ['#ffd23a', '#fff4b0', '#ffffff'], 26, 7, 0.13, 0.9);
    g.ui.damage(0, cx, y + h.height + 1.5, cz, 'big', 'PERFECT HEAVE!');
    g.addItem(I.EMERALD, 2, true);
    g.xp(8);
    g.sfx('crit', 'metal', 0.8, 1.2);
    // (It comes up out of the ground in slow motion, roots and all.)
    h.slow = 0.5;
    g.crewSay('cleanLift');
  }
  nextStage(g, h, 'lift');
  g.sfxAt('winch', cx, y + h.height, cz, 0.85, 1.15, 56);
}

/** A clod of soil lets go of the load's foundations. */
function dropClod(g: Game, h: Hoist): void {
  const C = h.cargo;
  // The lowest first, the ragged edges before the middle.
  let pick = -1;
  let low = Infinity;
  for (let i = 0; i < h.clump.length; i += 1) {
    const k = h.clump[i]!;
    const score = ky(k) * 10 + Math.random() * 6;
    if (score < low) {
      low = score;
      pick = i;
    }
  }
  if (pick < 0) return;
  const k = h.clump.splice(pick, 1)[0]!;
  const id = C.blockAt(kx(k), ky(k), kz(k));
  if (id === B.AIR) return;
  const p = loadPoint(C, kx(k) + 0.5, ky(k) + 0.5, kz(k) + 0.5);
  C.removeMany([k]);
  const v: Vec3 = [g.crane.tipV[0] * 0.6 + (Math.random() - 0.5), -0.5, g.crane.tipV[2] * 0.6 + (Math.random() - 0.5)];
  addClod(g, id, p, v);
  g.coopHost?.craneFx(['clod', id, p[0], p[1], p[2], v[0], v[1], v[2]]);
}

export function addClod(g: Game, id: number, p: Vec3, v: Vec3): void {
  g.craneFx.clods.push({ id, p: [...p], v: [...v], spin: 0, vspin: (Math.random() - 0.5) * 9 });
  g.particles.debris(p[0], p[1] - 0.4, p[2], blockDef(id).tiles.side, 3, 1.2, 0.08, 0.5);
}

// ------------------------------------------------------------------ the beats

/** How far off its mark the load hangs, along its swing (and a little across it). */
function offMark(g: Game, h: Hoist): number {
  const [ax, az] = h.axis;
  const o = g.crane.o;
  // (The hook's own swing off the jib tip, across and along; the jib's trim moves the tip along.)
  const along = o[0] * ax + o[1] * az;
  const across = Math.hypot(o[0] - along * ax, o[1] - along * az);
  return Math.abs(along + h.trim) + Math.max(0, across - 0.6);
}

/** The beat open to this player right now: the heave, the drop, letting a TNT crate go, or none. */
export function craneBeat(g: Game): 'heave' | 'drop' | 'bomb' | null {
  const d = g.craneDrop;
  if (d && d.by === g.cx) return d.stage === 'aim' ? 'bomb' : null;
  const h = g.hoist;
  if (!h || h.by !== g.cx) return null;
  if (h.stage === 'heave') return 'heave';
  if (h.stage === 'drop' && h.t > 0.35) return 'drop';
  return null;
}

/** The lifter taps: the heave tears it out now, the drop lets it down (a TNT crate goes). */
export function craneTap(g: Game): void {
  const d = g.craneDrop;
  if (d) {
    if (d.stage === 'aim' && d.rigTo === null) letGo(g, d);
    return;
  }
  const h = g.hoist;
  if (!h) return;
  if (h.stage === 'heave') {
    // (A little grace past the gold: a mate's tap is a moment late getting here.)
    const late = h.by !== g.me ? 0.08 : 0.03;
    const [goldLo, goldHi] = heaveGold(g);
    tearOut(g, h, h.strain >= goldLo && h.strain <= goldHi + late);
    return;
  }
  if (h.stage === 'drop') release(g, h, Math.min(...h.near.slice(h.by !== g.me ? -8 : -3)) < dropNear(g));
}

/** Which way the load's swing runs on this screen (+1: its axis points to the right of the view). */
function screenSign(g: Game, h: Hoist): number {
  const r = g.renderer.cam.r;
  return h.axis[0] * r[0] + h.axis[1] * r[2] >= 0 ? 1 : -1;
}

/**
 * What the gauge shows: the heave's strain, or the load swinging over its mark with the jib's hook
 * above it (`tip`) and the time it will still hang there (`left`, 0..1).
 */
export function craneGauge(g: Game): { kind: 'heave' | 'drop' | 'bomb'; value: number; lo: number; hi: number; hot: boolean; tip: number; left: number } | null {
  const d = g.craneDrop;
  if (d) {
    if (d.by !== g.me || d.stage !== 'aim') return null;
    // The monsters in the blast where it would land (`value`), and the wait the crew will stand.
    return { kind: 'bomb', value: d.inBlast, lo: 0, hi: 0, hot: d.inBlast > 0, tip: -1, left: clamp(1 - d.t / AIM_MAX, 0, 1) };
  }
  const h = g.hoist;
  if (!h || h.by !== g.me) return null;
  if (h.stage === 'heave') {
    const v = h.strain;
    const [goldLo, goldHi] = heaveGold(g);
    return { kind: 'heave', value: v, lo: goldLo, hi: goldHi, hot: v >= goldLo && v <= goldHi, tip: -1, left: -1 };
  }
  if (h.stage === 'drop' && h.t > 0.35) {
    // Along its swing, turned the way it moves on the screen.
    const sign = screenSign(g, h);
    const [ax, az] = h.axis;
    const along = (g.crane.o[0] * ax + g.crane.o[1] * az + h.trim) * sign;
    const span = 2.4;
    const at = (v: number): number => clamp(0.5 + v / (2 * span), 0, 1);
    const near = dropNear(g);
    const lo = 0.5 - near / (2 * span);
    return { kind: 'drop', value: at(along), lo, hi: 1 - lo, hot: offMark(g, h) < near, tip: at(h.trim * sign), left: clamp(1 - h.t / DROP_T, 0, 1) };
  }
  return null;
}

/**
 * The operator's stick (or A/D) across the view while the load hangs over its mark: it trims the
 * jib that way (a co-op mate's goes to the host, who runs the crane).
 */
export function steerCrane(g: Game, mx: number, mz: number): void {
  const d = g.craneDrop;
  if (d) {
    if (d.by !== g.me || d.stage !== 'aim') return;
    // Round the way the stick points on the screen; out (away from you) and in.
    const r = g.renderer.cam.r;
    const sign = -Math.sin(d.slew) * r[0] + Math.cos(d.slew) * r[2] >= 0 ? 1 : -1;
    const v: [number, number] = [Math.round(clamp(mx, -1, 1) * sign * 10) / 10, Math.round(clamp(mz, -1, 1) * 10) / 10];
    if (v[0] === d.steer[0] && v[1] === d.steer[1]) return;
    d.steer = v;
    g.remote('steer2', v[0], v[1]);
    return;
  }
  const h = g.hoist;
  if (!h || h.by !== g.me || h.stage !== 'drop') return;
  const v = Math.round(clamp(mx, -1, 1) * screenSign(g, h) * 10) / 10;
  if (v === h.steer) return;
  h.steer = v;
  g.remote('steer', v);
}

/** A buzz in the hand of whoever is working the crane. */
function buzzLifter(g: Game, h: Hoist, ms: number): void {
  g.withCtx(h.by, () => g.buzz(ms));
}

/** The chains clink as the load turns at the end of each swing (louder the wider it swings). */
function swingClink(g: Game, h: Hoist): void {
  const [ax, az] = h.axis;
  const r = g.crane;
  const v = r.ov[0] * ax + r.ov[1] * az;
  const dir = v > 0.15 ? 1 : v < -0.15 ? -1 : 0;
  if (dir === 0 || dir === h.swingDir) return;
  const was = h.swingDir;
  h.swingDir = dir;
  const amp = Math.abs(r.o[0] * ax + r.o[1] * az);
  if (was === 0 || amp < 0.35) return;
  const C = h.cargo;
  const p = loadPoint(C, (C.minX + C.maxX + 1) / 2, C.maxY + 1, (C.minZ + C.maxZ + 1) / 2);
  g.sfxAt('latch', p[0], p[1], p[2], clamp(0.2 + amp * 0.25, 0.2, 0.6), 1.25 + Math.random() * 0.15, 40);
  if (amp > 1) g.sfxAt('strain', p[0], p[1], p[2], 0.25, 1.4, 40);
}

// ------------------------------------------------------------------ unloading into the storey

/**
 * The load is let down over its place: its blocks peel off from the bottom up and fly down into the
 * storey it becomes, which builds itself from the floor up (on the mark: a bonus). With the hold full,
 * they fly into the building of its kind aboard instead.
 */
function release(g: Game, h: Hoist, perfect: boolean): void {
  h.perfect[1] = perfect;
  h.steer = 0;
  const F = g.fortress;
  const C = h.cargo;
  const slot = slotPoint(g, h);
  buzzLifter(g, h, perfect ? 70 : 35);
  if (perfect) {
    g.particles.sparks(slot[0], slot[1] + STOREY, slot[2], ['#ffd23a', '#fff4b0', '#ffffff'], 24, 6, 0.12, 0.9);
    g.ui.damage(0, slot[0], h.cruise + 1, slot[2], 'big', 'PERFECT DROP!');
    g.addItem(I.EMERALD, 2, true);
    g.xp(8);
    g.sfx('crit', 'metal', 0.8, 1.35);
    g.crewSay('onMark');
  } else g.crewSay('offMark');
  // The lot makes ready: an old roof comes off where it goes on top; the wings, stairs and galleries
  // it needs are laid.
  const targets: Vec3[] = [];
  const ids: number[] = [];
  if (h.merge < 0) {
    const before = holdFor(g.cargo);
    const after = holdFor([...g.cargo, h.info]);
    const ready = holdChanges(g, before, after, (o) => o !== h.info.slot);
    let n = 0;
    for (const k of ready.remove) {
      if (n++ > 36) break;
      const c = F.cells.get(k);
      if (!c) continue;
      const [x, y, z] = F.toWorld(kx(k) + 0.5, ky(k) + 0.5, kz(k) + 0.5);
      g.particles.debris(x, y, z, blockDef(c.id).tiles.side, 3, 3, 0.1, 0.6);
    }
    if (ready.remove.size + ready.add.length > 0) {
      const [wx, wy, wz] = F.toWorld(h.mid[0], h.mid[1] + 1, h.mid[2]);
      g.particles.dust(wx, wy, wz, 10, 4, false);
      g.sfx('poof', 'wool', 0.6, 0.9);
    }
    applyHoldChanges(g, ready, after);
    holdMachines(g, after);
    const own = holdChanges(g, before, after, (o) => o === h.info.slot);
    for (const [x, y, z, id] of own.add) {
      targets.push([x + 0.5, y + 0.5, z + 0.5]);
      ids.push(id);
    }
  } else {
    // Into the stack of its kind: blocks pour onto its roof and are gone into it.
    const spot = holdSlotSpot(g.cargo[h.merge]?.slot ?? -1);
    const cx = spot ? spot.x : h.mid[0];
    const cz = spot ? spot.z : h.mid[2];
    let top = h.mid[1];
    for (const k of F.cells.keys()) if (Math.abs(kx(k) + 0.5 - cx) < 3.5 && Math.abs(kz(k) + 0.5 - cz) < 2.5) top = Math.max(top, ky(k) + 1);
    for (let i = 0; i < 48; i += 1) {
      targets.push([cx + (Math.random() - 0.5) * 5, top + 0.5, cz + (Math.random() - 0.5) * 3.5]);
      ids.push(-1);
    }
  }
  const spec = cascade(C, targets, ids, h.merge >= 0);
  startCascade(g, C, spec);
  h.buildEnd = spec.end + 0.12;
  g.coopHost?.craneFx(['build', spec.end, spec.list]);
  // The chains slacken as the weight comes off; the hook rides up.
  g.sfxAt('latch', slot[0], h.cruise, slot[2], 0.8, 0.75, 56);
  nextStage(g, h, 'build');
}

/** The unloading's plan: which block leaves the load when, and where it goes. */
interface CascadeSpec {
  end: number;
  /** Per target: [source key, id (-1: the source's own), to x, y, z, leaves at, flight] ... */
  list: number[];
  /** Load cells no target takes: they vanish in a puff at their time ([key, time] ...). */
  spare: number[];
}

function cascade(C: BlockBody, targets: Vec3[], ids: number[], vanish: boolean): CascadeSpec {
  const src = [...C.cells.keys()];
  // Bottom up on both sides: the load's lowest blocks feed the storey's floor first.
  const cx = (C.minX + C.maxX + 1) / 2;
  const cz = (C.minZ + C.maxZ + 1) / 2;
  src.sort((a, b) => ky(a) - ky(b) || Math.hypot(kx(a) + 0.5 - cx, kz(a) + 0.5 - cz) - Math.hypot(kx(b) + 0.5 - cx, kz(b) + 0.5 - cz));
  let tx = 0;
  let tz = 0;
  for (const t of targets) {
    tx += t[0] / targets.length;
    tz += t[2] / targets.length;
  }
  const order = targets.map((_, i) => i);
  order.sort((a, b) => targets[a]![1] - targets[b]![1] || Math.hypot(targets[a]![0] - tx, targets[a]![2] - tz) - Math.hypot(targets[b]![0] - tx, targets[b]![2] - tz));
  const n = order.length;
  const m = src.length;
  const spread = clamp(0.85 + n / 420, 1, 1.7);
  const leave = (j: number): number => spread * (j / Math.max(1, m)) ** 0.9;
  const list: number[] = [];
  const used = new Set<number>();
  for (let r = 0; r < n; r += 1) {
    const i = order[r]!;
    const j = Math.min(m - 1, Math.floor((r * m) / Math.max(1, n)));
    used.add(j);
    const t = targets[i]!;
    const t0 = Math.max(leave(j), spread * (r / Math.max(1, n)) ** 0.9) + Math.random() * 0.03;
    list.push(src[j]!, ids[i]!, t[0], t[1], t[2], Math.round(t0 * 1000) / 1000, Math.round((0.42 + Math.random() * 0.14) * 1000) / 1000);
  }
  const spare: number[] = [];
  for (let j = 0; j < m; j += 1) if (!used.has(j)) spare.push(src[j]!, leave(j));
  void vanish;
  return { end: spread + 0.6, list, spare };
}

/** Plays an unloading out (the host, and a co-op mate from the host's plan). */
export function startCascade(g: Game, C: BlockBody, spec: { list: number[]; spare?: number[] }, vanishAll = false): void {
  const fx = g.craneFx;
  fx.blocks = [];
  fx.pending = [];
  fx.start = g.time;
  fx.notes = 0;
  fx.lastNote = -1;
  const l = spec.list;
  const leaves = new Map<number, number>();
  for (let i = 0; i + 6 < l.length + 1; i += 7) {
    const key = l[i]!;
    const own = C.cells.get(key)?.id ?? B.STONE;
    const id = l[i + 1]! >= 0 ? l[i + 1]! : own;
    const vanish = l[i + 1]! < 0 || vanishAll;
    const t0 = l[i + 5]!;
    const shape = blockDef(id).shape;
    fx.blocks.push({
      id, src: key, from: null, to: [l[i + 2]!, l[i + 3]!, l[i + 4]!], vanish, t0, dur: l[i + 6]!,
      arc: 1.2 + Math.random() * 1.4, spin: (Math.random() - 0.5) * 10, half: shape === 'cube' ? 0.5 : 0.3, landed: false,
    });
    leaves.set(key, Math.min(leaves.get(key) ?? Infinity, t0));
  }
  fx.end = Math.max(0, ...fx.blocks.map((b) => b.t0 + b.dur));
  for (const [key, t0] of leaves) fx.pending.push({ key, t0, poof: false });
  const sp = spec.spare ?? [];
  for (let i = 0; i + 1 < sp.length; i += 2) fx.pending.push({ key: sp[i]!, t0: sp[i + 1]!, poof: true });
  fx.pending.sort((a, b) => a.t0 - b.t0);
}

/** Blocks leave the load at their time (the host takes them off it; a mate's copy follows). */
function unload(g: Game, h: Hoist): void {
  const fx = g.craneFx;
  const C = h.cargo;
  const now = g.time - fx.start;
  const gone: number[] = [];
  while (fx.pending.length && fx.pending[0]!.t0 <= now) {
    const p = fx.pending.shift()!;
    const id = C.blockAt(kx(p.key), ky(p.key), kz(p.key));
    if (id === B.AIR) continue;
    gone.push(p.key);
    if (p.poof) {
      const w = loadPoint(C, kx(p.key) + 0.5, ky(p.key) + 0.5, kz(p.key) + 0.5);
      if (Math.random() < 0.35) g.particles.poof(w[0], w[1], w[2], 3);
    }
  }
  // (Taken off in a batch: the load is meshed once a frame at most.)
  if (gone.length) C.removeMany(gone);
}

/** The storey stands: its cells bolt on, the crew cheers. */
function finish(g: Game, h: Hoist): void {
  const F = g.fortress;
  clearSome(g, h, h.clear.length);
  g.craneFx.blocks = [];
  g.craneFx.pending = [];
  h.cargo.cells.clear();
  h.cargo.changed();
  g.hoist = null;
  g.hoistHub = null;
  g.stats.hoisted += 1;
  g.today.hoisted += 1;
  F.shake = 0.45;
  g.renderer.shake(0.4);
  const info = HOIST_INFO[h.info.kind];
  const both = h.perfect[0] && h.perfect[1];
  buzzLifter(g, h, 60);
  // Perfect lifts in a row pay more each time (up to +4 on top).
  const streak = both ? (g.stats.craneStreak ?? 0) + 1 : 0;
  g.stats.craneStreak = streak;
  const bonus = 3 + Math.min(4, Math.max(0, streak - 1));
  if (both) {
    g.addItem(I.EMERALD, bonus, true);
    g.stats.perfectLifts = (g.stats.perfectLifts ?? 0) + 1;
    g.withCtx(h.by, () => feat(g, 'crane'));
  }
  const perk = info?.perk ?? 'Your fortress grows';
  const sub = !both ? perk : streak > 1 ? `CRANE MASTER ×${streak}! +${4 + bonus} emeralds · ${perk}` : `CRANE MASTER! +7 emeralds · ${perk}`;
  if (h.merge >= 0) {
    const c = g.cargo[h.merge];
    if (c) c.level = Math.min(3, (c.level ?? 1) + 1);
    g.sfx('quest', 'metal', 0.8);
    const level = c?.level ?? 2;
    g.ui.banner(`${info?.label.toUpperCase() ?? 'BUILDING'} BUILT UP!`, !both ? `The hold is full: it went into your ${info?.label ?? 'building'} (level ${level})` : streak > 1 ? `CRANE MASTER ×${streak}! +${4 + bonus} emeralds · level ${level}` : `CRANE MASTER! +7 emeralds · level ${level}`, 'gold');
    const [wx, wy, wz] = F.toWorld(h.mid[0], h.mid[1] + 2, h.mid[2]);
    g.particles.sparks(wx, wy, wz, ['#ffd23a', '#7ee05a', '#5ad0ff', '#ffffff'], 30, 6, 0.12, 1);
  } else {
    const before = holdFor(g.cargo);
    const after = holdFor([...g.cargo, h.info]);
    g.cargo.push(h.info);
    applyHoldChanges(g, holdChanges(g, before, after, (o) => o === h.info.slot), after);
    holdMachines(g, after);
    g.sfx('thud', 'wood', 1);
    g.sfx('stomp', 'stone', 0.55);
    g.ui.banner(`${info?.label.toUpperCase() ?? 'BUILDING'} ABOARD!`, sub, 'gold');
    // Dust off its foundations, a puff of confetti over the roof, and rockets for the first one.
    const topY = Math.max(...h.base.map((c) => c[1]), 4) + 1.5;
    const [wx, wy, wz] = F.toWorld(h.mid[0], h.mid[1] + topY, h.mid[2]);
    const [, fy] = F.toWorld(0, h.mid[1] + 1, 0);
    g.particles.dust(wx, fy + 0.3, wz, 18, 3.5, false);
    g.particles.sparks(wx, wy, wz, ['#ffd23a', '#7ee05a', '#5ad0ff', '#ff6a8a', '#ffffff'], 36, 7, 0.14, 1.1);
    if (g.stats.hoisted === 1) g.celebrate(2);
    if (g.cargo.length >= 5) feat(g, 'village');
  }
  // The crane-wright's page: how to steady a load (after a perfect lift, or a few lifts in).
  if (both || g.stats.hoisted >= 3) pageLater(g, 'crane');
  if (both) g.celebrate(1);
  // The crew (and the villagers watching) cheer the new arrival.
  g.cheer(false);
  g.report('visual_feedback');
  g.xp(25);
}

/** A journal page, a few seconds after the moment that earned it. */
function pageLater(g: Game, id: string): void {
  if (!g.journal.has(id) && !g.craneFx.pages.some((p) => p.id === id)) g.craneFx.pages.push({ id, at: g.time + 3.5 });
}

/** Finishes a lift at once (the game is being saved, or left): it lands as it would have. */
export function finishHoistNow(g: Game): void {
  const h = g.hoist;
  if (!h) return;
  if (h.stage === 'reach' || h.stage === 'heave') tearOut(g, h, false);
  finish(g, h);
}

// ------------------------------------------------------------------ every frame, every machine

/**
 * The crane between lifts (stowing itself, its hook swinging as the fortress walks), and what
 * flies off it: clods of soil, and the blocks of an unloading.
 */
export function animateCrane(g: Game, dt: number): void {
  const rig = g.crane;
  const F = g.fortress;
  const dd = g.craneDrop;
  if (dd?.rigTo) easeToHost(rig, dd.rigTo, dt);
  else if (!g.hoist && !dd) {
    rig.slew = lerpAngle(rig.slew, F.yaw + STOW_SLEW, Math.min(1, dt * 1.6));
    rig.luff += clamp(STOW_LUFF - rig.luff, -dt * 0.7, dt * 0.7);
    rig.reach += clamp(STOW_REACH - rig.reach, -dt * 9, dt * 9);
    rig.mast += clamp(-rig.mast, -dt * 5, dt * 5);
    const r0 = rig.rope;
    rig.rope += clamp(STOW_ROPE - rig.rope, -dt * 6, dt * 6);
    rig.drum += (r0 - rig.rope) * 1.6;
    rig.latch = Math.max(0, rig.latch - dt * 5);
    rig.strain = Math.max(0, rig.strain - dt * 3);
    const tip = tipOf(pivotAt(g, rig.mast), rig.slew, rig.luff, rig.reach);
    swingStep(rig, tip, dt, rig.rope + 0.6, 0.12);
  }
  const fx = g.craneFx;
  // A journal page waits for the cheering to die down and the view to come back to you.
  if (fx.pages.length && !g.coopGuest && !g.craneCam && g.time >= fx.pages[0]!.at && g.isPlaying()) g.addPage(fx.pages.shift()!.id);
  // Clods tumble down and burst where they land.
  for (let i = fx.clods.length - 1; i >= 0; i -= 1) {
    const c = fx.clods[i]!;
    c.v[1] -= 26 * dt;
    c.p[0] += c.v[0] * dt;
    c.p[1] += c.v[1] * dt;
    c.p[2] += c.v[2] * dt;
    c.spin += c.vspin * dt;
    const [lx, ly, lz] = F.toLocal(c.p[0], c.p[1] - 0.5, c.p[2]);
    const onDeck = F.solidAt(Math.floor(lx), Math.floor(ly), Math.floor(lz));
    if (onDeck || c.p[1] - 0.5 <= g.world.groundAt(c.p[0], c.p[2]) || c.p[1] < -20) {
      const tile = blockDef(c.id).tiles.side;
      g.particles.debris(c.p[0], c.p[1], c.p[2], tile, 7, 3.5, 0.12, 0.7);
      g.particles.dust(c.p[0], c.p[1] - 0.3, c.p[2], 2, 0.8, false);
      g.sfxHere('break', c.p[0], c.p[1], c.p[2], 0.45, 0.9 + Math.random() * 0.3, 36, 'dirt');
      fx.clods.splice(i, 1);
    }
  }
  if (fx.blocks.length === 0) return;
  // Unloading: each block takes off from where it is on the load when its time comes, and lands.
  const C = g.hoist?.cargo ?? null;
  const now = g.time - fx.start;
  // (Once the lift is over, the storey stands in their place: a co-op mate's copy lets them go.)
  if (!g.hoist && now > fx.end) {
    fx.blocks = [];
    fx.pending = [];
    return;
  }
  for (const b of fx.blocks) {
    if (now < b.t0) continue;
    if (!b.from) b.from = C ? loadPoint(C, kx(b.src) + 0.5, ky(b.src) + 0.5, kz(b.src) + 0.5) : [...b.to];
    if (b.landed || now < b.t0 + b.dur) continue;
    b.landed = true;
    const at = b.vanish ? b.to : F.toWorld(b.to[0], b.to[1], b.to[2]);
    if (b.vanish) g.particles.sparks(at[0], at[1], at[2], ['#ffd23a', '#ffffff', '#9af07a'], 2, 2.5, 0.08, 0.4);
    else if (Math.random() < 0.18) g.particles.dust(at[0], at[1] - 0.4, at[2], 1, 0.4, false);
    // The storey goes up to a climbing tune (a note at a time, not a clatter).
    if (now - fx.lastNote > 0.055) {
      fx.lastNote = now;
      const scale = [1, 1.125, 1.25, 1.5, 1.667];
      const n = fx.notes++;
      const rate = scale[n % 5]! * 2 ** Math.min(2, Math.floor(n / 5) * 0.34);
      g.audio.play('snap', 'wood', 0.5, rate * 0.82);
    }
  }
}

// ------------------------------------------------------------------ drawing

const ORIGIN: Vec3 = [0, 0, 0];

/** The crane, the chains on its load, the blueprint at its mark, and what flies off it. */
/** The idle crane as last built (see drawCrane), and what it was built from. */
let idleCut: { v: Uint8Array; i: Uint32Array; base: number } | null = null;
let idleKey: number[] = [];
let idleLight: [number, number] = [1, 0];

export function drawCrane(g: Game, b: MeshBuilder, o: MeshBuilder, lit: (mb: MeshBuilder, x: number, y: number, z: number) => void): void {
  const F = g.fortress;
  const rig = g.crane;
  const h = g.hoist;
  const base = craneBase(F);
  const foot = F.toWorld(base.at[0], base.at[1], base.at[2]);
  const pivot = pivotAt(g, rig.mast);
  // The jib bends a little under the strain.
  const tip0 = tipOf(pivot, rig.slew, rig.luff, rig.reach);
  const tip: Vec3 = [tip0[0], tip0[1] - rig.strain * 0.5, tip0[2]];
  // Idle (nothing on the hook, nothing flying off it) and where it was: the same crane as last
  // frame, copied back instead of built again (copied out once it has held still for a frame:
  // slewing, or on the march, it changes every frame).
  const idle = !h && !g.craneDrop && g.craneFx.clods.length === 0 && g.craneFx.blocks.length === 0;
  let key: number[] | null = null;
  if (idle) {
    const hook = hang(rig, tip, 0.6).hook;
    const [s0, l0] = g.lightAt(pivot[0], pivot[1], pivot[2]);
    const [s1, l1] = g.lightAt(hook[0], hook[1], hook[2]);
    key = [foot[0], foot[1], foot[2], pivot[0], pivot[1], pivot[2], tip[0], tip[1], tip[2], hook[0], hook[1], hook[2], rig.slew, rig.luff, rig.mast, rig.drum, s0, l0, s1, l1];
    if (idleCut && key.length === idleKey.length && key.every((v, i) => v === idleKey[i])) {
      b.paste(idleCut);
      b.sky = idleLight[0];
      b.blk = idleLight[1];
      return;
    }
  }
  const v0 = b.verts;
  const c0 = b.count;
  drawRig(g, b, o, lit, rig, h, foot, pivot, tip);
  const still = key !== null && key.length === idleKey.length && key.every((v, i) => v === idleKey[i]);
  idleCut = still ? b.cut(v0, c0) : null;
  if (still) idleLight = [b.sky, b.blk];
  idleKey = key ?? [];
}

/** The crane itself (see drawCrane). */
function drawRig(g: Game, b: MeshBuilder, o: MeshBuilder, lit: (mb: MeshBuilder, x: number, y: number, z: number) => void, rig: CraneRig, h: Hoist | null, foot: Vec3, pivot: Vec3, tip: Vec3): void {
  const fwd: Vec3 = [Math.cos(rig.slew), 0, Math.sin(rig.slew)];
  const side: Vec3 = [-fwd[2], 0, fwd[0]];
  const back = scale(fwd, -1);
  const plate = [tileRect('leg_plate')];
  const iron = [tileRect('iron_block')];
  const brass = [tileRect('brass')];
  const wood = [tileRect('log_spruce')];
  const planks = [tileRect('planks_spruce')];
  const chain = [tileRect('chain')];
  // (The jib in pale oak and iron: it reads against the sky from across the valley.)
  const oak = [tileRect('log_oak')];
  const oakPlanks = [tileRect('planks_oak')];
  lit(b, pivot[0], pivot[1], pivot[2]);
  // Telescoping mast: iron sections run up out of the log mast, a brass collar at each joint.
  if (rig.mast > 0.05) {
    const n = Math.max(1, Math.ceil(rig.mast / 4));
    for (let i = 0; i < n; i += 1) {
      const y0 = (rig.mast * i) / n;
      const y1 = (rig.mast * (i + 1)) / n + 0.3;
      const w = 0.36 - i * 0.04;
      b.box(add(foot, [0, (y0 + y1) / 2, 0]), [w, 0, 0], [0, (y1 - y0) / 2, 0], [0, 0, w], plate);
      b.box(add(foot, [0, y0 + 0.1, 0]), [w + 0.06, 0, 0], [0, 0.1, 0], [0, 0, w + 0.06], brass);
    }
  }
  // The slewing head: a geared turntable, the winch house behind it with its drum turning.
  b.box(add(pivot, [0, -0.25, 0]), scale(fwd, 0.6), [0, 0.2, 0], scale(side, 0.6), [tileRect('gearbox')]);
  const house = add(add(pivot, scale(back, 0.75)), [0, 0.35, 0]);
  b.box(house, scale(fwd, 0.5), [0, 0.38, 0], scale(side, 0.45), planks);
  b.box(add(house, [0, 0.42, 0]), scale(fwd, 0.58), [0, 0.06, 0], scale(side, 0.52), [tileRect('stone_bricks')]);
  const drumC = add(add(pivot, scale(back, 0.2)), [0, 0.15, 0]);
  for (let k = 0; k < 6; k += 1) {
    const a = rig.drum + (k * Math.PI) / 3;
    const spoke: Vec3 = add(scale(fwd, Math.cos(a) * 0.26), [0, Math.sin(a) * 0.26, 0]);
    beam(b, add(add(drumC, scale(side, -0.42)), spoke), add(add(drumC, scale(side, 0.42)), spoke), 0.05, k % 2 ? brass : wood);
  }
  // The counter-jib and its weight.
  const tail = add(add(pivot, scale(back, 3.1)), [0, Math.sin(rig.luff) * 0.4, 0]);
  beam(b, pivot, tail, 0.14, wood);
  b.box(add(tail, [0, -0.25, 0]), scale(fwd, 0.55), [0, 0.5, 0], scale(side, 0.6), [tileRect('cobble')]);
  // The A-frame over the head, its pendants to both ends.
  const apex = add(pivot, [0, 2.3, 0]);
  beam(b, add(pivot, scale(side, 0.4)), apex, 0.08, wood);
  beam(b, add(pivot, scale(side, -0.4)), apex, 0.08, wood);
  b.box(apex, [0.14, 0, 0], [0, 0.14, 0], [0, 0, 0.14], brass);
  beam(b, apex, tip, 0.035, chain);
  beam(b, apex, add(tail, [0, 0.25, 0]), 0.035, chain);
  // The jib: a lattice of spruce chords and plank braces, tapering to its sheave.
  const dir: Vec3 = [tip[0] - pivot[0], tip[1] - pivot[1], tip[2] - pivot[2]];
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const up: Vec3 = [-Math.sin(rig.luff) * fwd[0], Math.cos(rig.luff), -Math.sin(rig.luff) * fwd[2]];
  const chord = (s: number, u: number, t: number): Vec3 => add(add(add(pivot, scale(dir, t)), scale(side, s * (1 - t * 0.65))), scale(up, u * (1 - t * 0.65)));
  lit(b, (pivot[0] + tip[0]) / 2, (pivot[1] + tip[1]) / 2, (pivot[2] + tip[2]) / 2);
  beam(b, chord(0.4, -0.14, 0), chord(0.4, -0.14, 1), 0.11, oak);
  beam(b, chord(-0.4, -0.14, 0), chord(-0.4, -0.14, 1), 0.11, oak);
  beam(b, chord(0, 0.36, 0), chord(0, 0.36, 1), 0.09, oak);
  const bays = Math.max(2, Math.round(len / 1.6));
  for (let i = 0; i < bays; i += 1) {
    const t0 = i / bays;
    const t1 = (i + 1) / bays;
    const s = i % 2 ? 1 : -1;
    beam(b, chord(0.4 * s, -0.14, t0), chord(-0.4 * s, -0.14, t1), 0.05, oakPlanks);
    beam(b, chord(0.4, -0.14, t0), chord(0, 0.36, t1), 0.045, iron);
    beam(b, chord(-0.4, -0.14, t1), chord(0, 0.36, t0), 0.045, iron);
    // (A brass collar where each telescoping section slides out of the last.)
    if (i > 0 && i % 4 === 0) b.box(chord(0, 0.08, t0), scale(dir, 0.09 / len), scale(up, 0.46 * (1 - t0 * 0.65)), scale(side, 0.52 * (1 - t0 * 0.65)), brass);
  }
  b.box(tip, scale(fwd, 0.22), [0, 0.22, 0], scale(side, 0.12), brass);
  // Rope (two falls) down to the hook block.
  const loadLen = h ? SLING + (h.cargo.maxY + 1 - h.cargo.minY) / 2 : 0.6;
  const dd = g.craneDrop;
  const hung = hang(rig, tip, h && h.stage !== 'reach' && h.stage !== 'heave' ? loadLen : dd && hooked(dd) ? CRATE_HANG : 0.6);
  const hook = hung.hook;
  lit(b, hook[0], hook[1], hook[2]);
  beam(b, add(tip, scale(side, 0.1)), add(hook, add(scale(side, 0.1), [0, 0.45, 0])), 0.035, chain);
  beam(b, add(tip, scale(side, -0.1)), add(hook, add(scale(side, -0.1), [0, 0.45, 0])), 0.035, chain);
  b.box(add(hook, [0, 0.15, 0]), scale(fwd, 0.3), [0, 0.36, 0], scale(side, 0.28), iron);
  b.box(add(hook, [0, 0.22, 0]), scale(fwd, 0.1), [0, 0.26, 0], scale(side, 0.32), brass);
  // The chains: down to the load's eaves as each one latches, slack after it is let go.
  if (h && rig.latch > 0) {
    const C = h.cargo;
    const free = h.stage === 'build' && C.cells.size === 0;
    for (let i = 0; i < 4; i += 1) {
      const k = clamp(rig.latch - i, 0, 1);
      if (k <= 0) continue;
      const e = h.eaves[i]!;
      const end = free ? add(hook, [(i % 2 ? 0.6 : -0.6), -1.6, (i < 2 ? -0.6 : 0.6)]) : loadPoint(C, e[0], e[1], e[2]);
      const from = add(hook, [0, -0.1, 0]);
      const to: Vec3 = [lerp(from[0], end[0], k), lerp(from[1], end[1], k), lerp(from[2], end[2], k)];
      lit(b, to[0], to[1], to[2]);
      beam(b, from, to, 0.07, chain);
      b.box(to, [0.14, 0, 0], [0, 0.14, 0], [0, 0, 0.14], iron);
    }
  }
  if (h) drawWork(g, h, b, o, lit);
  if (dd) drawDrop(g, dd, hung, b, o, lit);
  drawFlying(g, b, lit);
}

/** The cracks round a building under strain, and the blueprint glowing at the load's mark. */
function drawWork(g: Game, h: Hoist, b: MeshBuilder, o: MeshBuilder, lit: (mb: MeshBuilder, x: number, y: number, z: number) => void): void {
  void b;
  void lit;
  if (h.stage !== 'reach' && h.stage !== 'heave' && h.cargo.cells.size > 0) loadShadow(g, h, o);
  if (h.stage === 'heave') {
    const stage = Math.min(9, Math.floor(h.strain * 10));
    for (const [x, y, z] of h.rim) crackAt(o, x, y, z, stage);
  }
  if ((h.stage === 'swing' || h.stage === 'drop') && h.base.length > 0) {
    const F = g.fortress;
    const on = h.stage === 'drop' && offMark(g, h) < dropNear(g);
    const pulse = 0.5 + 0.5 * Math.sin(g.time * 6);
    const tint: Vec3 = on ? [1, 0.85, 0.3] : [0.5, 0.9, 1];
    const alpha = (h.stage === 'swing' ? 0.5 : 0.7) + pulse * 0.2 + (on ? 0.1 : 0);
    ghost(o, F, h, tint, alpha);
  }
}

/** The top of whatever is under a point (the fortress's deck or the ground), or -Infinity. */
function surfaceUnder(g: Game, x: number, y: number, z: number): number {
  const F = g.fortress;
  const [lx, ly, lz] = F.toLocal(x, y, z);
  const cx = Math.floor(lx);
  const cz = Math.floor(lz);
  let deck = -Infinity;
  if (cx >= F.minX && cx <= F.maxX && cz >= F.minZ && cz <= F.maxZ) {
    for (let cy = Math.min(Math.floor(ly), F.maxY); cy >= F.minY; cy -= 1) {
      if (F.solidAt(cx, cy, cz)) {
        deck = F.toWorld(lx, cy + 1, lz)[1];
        break;
      }
    }
  }
  const ground = g.world.groundAt(x, z);
  return Math.max(deck, ground <= y ? ground : -Infinity);
}

/** A soft shadow straight under the hanging load (where it would land): sharper as it comes down. */
function loadShadow(g: Game, h: Hoist, o: MeshBuilder): void {
  const C = h.cargo;
  const c = loadPoint(C, (C.minX + C.maxX + 1) / 2, C.minY, (C.minZ + C.maxZ + 1) / 2);
  const under = surfaceUnder(g, c[0], c[1] - 0.1, c[2]);
  if (!Number.isFinite(under)) return;
  const gap = Math.max(0, c[1] - under);
  const r = Math.max(C.maxX - C.minX + 1, C.maxZ - C.minZ + 1) * 0.55 + gap * 0.05;
  const day = 0.45 + 0.4 * g.renderer.env.daylight;
  blobShadow(o, c[0], under, c[2], r, day * (1 - clamp(gap / 26, 0, 0.75)));
}

function crackAt(o: MeshBuilder, x: number, y: number, z: number, stage: number): void {
  const uv = tileRect(`crack${stage}`);
  o.flags = F_OVERLAY;
  o.alpha = 1;
  o.box([x + 0.5, y + 0.5, z + 0.5], [0.503, 0, 0], [0, 0.503, 0], [0, 0, 0.503], [uv]);
  o.flags = 0;
}

/**
 * The storey to come, marked at its place: a glowing frame round where it will stand, its floor
 * lit, and a line straight up from the middle of it (the load is on its mark when it hangs on it).
 */
function ghost(o: MeshBuilder, F: BlockBody, h: Hoist, tint: Vec3, alpha: number): void {
  let W = 0;
  let H = 0;
  let D = 0;
  for (const [x, y, z] of h.base) {
    W = Math.max(W, x + 1);
    H = Math.max(H, y + 1);
    D = Math.max(D, z + 1);
  }
  const x0 = h.mid[0] - W / 2;
  const z0 = h.mid[2] - D / 2;
  const y0 = h.mid[1];
  const P = (x: number, y: number, z: number): Vec3 => F.toWorld(x0 + x, y0 + y, z0 + z);
  const white = [tileRect('white')];
  o.flags = F_OVERLAY | F_UNLIT;
  o.tint = tint;
  o.emit = 1;
  o.alpha = alpha;
  const e = 0.07;
  const corners: Array<[number, number]> = [[0, 0], [W, 0], [W, D], [0, D]];
  for (let i = 0; i < 4; i += 1) {
    const [ax, az] = corners[i]!;
    const [bx, bz] = corners[(i + 1) % 4]!;
    for (const y of [0.04, H]) beam(o, P(ax, y, az), P(bx, y, bz), e, white);
    beam(o, P(ax, 0.04, az), P(ax, H, az), e, white);
  }
  // The floor, faintly lit; the line up to the load.
  o.alpha = alpha * 0.28;
  const f = [P(0, 0.06, D), P(0, 0.06, 0), P(W, 0.06, 0), P(W, 0.06, D)];
  o.quad(f.flat(), white[0]!, 0, 1, 0);
  o.alpha = alpha * 0.7;
  beam(o, P(W / 2, H, D / 2), P(W / 2, H + 9, D / 2), 0.05, white);
  o.flags = 0;
  o.alpha = 1;
  o.emit = 0;
  o.tint = [1, 1, 1];
}

/** Clods in the air, and the blocks of an unloading on their way (or landed, waiting to bolt on). */
function drawFlying(g: Game, b: MeshBuilder, lit: (mb: MeshBuilder, x: number, y: number, z: number) => void): void {
  const fx = g.craneFx;
  for (const c of fx.clods) {
    lit(b, c.p[0], c.p[1], c.p[2]);
    blockCube(b, c.id, c.p, 0.5, c.spin, c.spin * 0.6);
  }
  if (fx.blocks.length === 0) return;
  const F = g.fortress;
  const now = g.time - fx.start;
  for (const k of fx.blocks) {
    if (now < k.t0 || !k.from) continue;
    const u = clamp((now - k.t0) / k.dur, 0, 1);
    const end = k.vanish ? k.to : F.toWorld(k.to[0], k.to[1], k.to[2]);
    if (k.vanish && u >= 1) continue;
    // Out and over in an arc, turning, and squarely into its cell at the end with a little pop.
    const e = u * u * (3 - 2 * u);
    const pos: Vec3 = [lerp(k.from[0], end[0], e), lerp(k.from[1], end[1], e) + Math.sin(Math.PI * u) * k.arc, lerp(k.from[2], end[2], e)];
    const settle = u >= 1 ? clamp((now - k.t0 - k.dur) / 0.14, 0, 1) : 0;
    const half = u >= 1 ? k.half * (1 + 0.16 * Math.sin(Math.PI * settle)) : k.half * (k.vanish ? 1 - u * 0.6 : 0.85 + 0.15 * u);
    const turn = (1 - e) * k.spin;
    lit(b, pos[0], pos[1], pos[2]);
    blockCube(b, k.id, pos, half, F.yaw + turn, turn * 0.5);
  }
  void ORIGIN;
}

/** Spare loads: a body for a co-op mate's copy of the crane's load (until the host's arrives). */
export function emptyCargo(): BlockBody {
  return new Body('cargo');
}

// ------------------------------------------------------------------ crane parts

export type CranePart = 'taglines' | 'winch' | 'bigcrates' | 'counterweight';

/** What the village traders can fit to your crane (each once; they stay fitted for the march). */
export const CRANE_PARTS: ReadonlyArray<{ id: CranePart; label: string; perk: string; icon: string; gems: number; iron: number }> = [
  { id: 'taglines', label: 'Tag Lines', perk: 'The crew holds every load steadier: it swings less, and the DROP gold is wider', icon: 'chain', gems: 4, iron: 0 },
  { id: 'winch', label: 'Steam Winch', perk: 'The crane reaches 24 blocks further, and the next TNT crate is hooked on twice as fast', icon: 'gearbox', gems: 6, iron: 2 },
  { id: 'bigcrates', label: 'Big Crates', perk: 'TNT crates from the crane burst wider and hit harder', icon: 'tnt_side', gems: 8, iron: 3 },
  { id: 'counterweight', label: 'Counterweight', perk: 'The jib hangs steady: the HEAVE gold band is half again as wide, so the perfect lift is easier to hit', icon: 'iron_block', gems: 10, iron: 4 },
];

export function hasPart(g: Game, id: CranePart): boolean {
  return g.craneParts.includes(id);
}

/** A trader fits a part to the crane (the buyer pays). */
export function buyPart(g: Game, id: string): { ok: boolean; note: string } {
  const p = CRANE_PARTS.find((x) => x.id === id);
  if (!p) return { ok: false, note: '' };
  if (hasPart(g, p.id)) return { ok: false, note: `Your crane already has ${p.label}` };
  if (g.count(I.EMERALD) < p.gems || g.count(I.IRON_INGOT) < p.iron) {
    g.sfx('deny');
    return { ok: false, note: p.iron ? `${p.label} costs ${p.gems} emeralds and ${p.iron} iron ingots` : `${p.label} costs ${p.gems} emeralds` };
  }
  g.useItem(I.EMERALD, p.gems);
  if (p.iron) g.useItem(I.IRON_INGOT, p.iron);
  g.craneParts.push(p.id);
  g.sfx('craft', 'metal', 0.9);
  g.sfx('latch', 'metal', 0.8, 0.9);
  g.report('primary_input');
  // The whole rig fitted: a feat (and the crane works at its best from here on).
  if (CRANE_PARTS.every((x) => g.craneParts.includes(x.id))) feat(g, 'cranekit');
  return { ok: true, note: `${p.label} fitted to your crane: ${p.perk}` };
}

/** How far from the fortress a building may be lifted. */
function hoistRange(g: Game): number {
  return HOIST_RANGE + (hasPart(g, 'winch') ? 24 : 0);
}

/** How near over its mark a load counts as on it (tag lines: nearer than it looks). */
function dropNear(g: Game): number {
  return DROP_NEAR * (hasPart(g, 'taglines') ? 1.35 : 1);
}

/**
 * The heave gauge's gold band. A counterweight steadies the jib, so the band reaches wider on both
 * sides of its middle (the tap that tears the load out perfectly is the same two ends, longer).
 */
export function heaveGold(g: Game): readonly [number, number] {
  if (!hasPart(g, 'counterweight')) return HEAVE_GOLD;
  const mid = (HEAVE_GOLD[0] + HEAVE_GOLD[1]) / 2;
  const half = (HEAVE_GOLD[1] - HEAVE_GOLD[0]) / 2 * 1.5;
  return [mid - half, mid + half];
}

/** The blast of a crane's TNT crate, and how hard it hits (big crates: wider and harder). */
export function crateBlast(g: Game): { radius: number; power: number } {
  return hasPart(g, 'bigcrates') ? { radius: CRATE_BLAST + 1.4, power: 1.35 } : { radius: CRATE_BLAST, power: 1 };
}

// ------------------------------------------------------------------ the crane drop

/** TNT a crane drop takes, and the seconds the crew takes to hook on the next crate. */
export const DROP_TNT = 2;
const DROP_COOL = 6;
/** How far out from the pivot (level) the operator can run the jib. */
const DROP_OUT: readonly [number, number] = [5, 26];
/** The hook going down to the crate by the mast and up with it; the longest the crew waits on an aim. */
const PICK_T = 1.3;
const AIM_MAX = 30;
/** Hook to the crate's middle; the crate's blast (the red ring on the ground). */
const CRATE_HANG = 1.3;
export const CRATE_BLAST = 4.4;

export interface CraneDrop {
  /** Who works it. */
  by: PlayerCtx;
  /** The crew hooking the crate on, the operator swinging it out, then watching it fall. */
  stage: 'pick' | 'aim' | 'fall';
  t: number;
  /** Falling: the crate (the host's), and when it burst (game time; 0: not yet). */
  crate: Projectile | null;
  boom: number;
  /** The operator's stick: round (+: slewing to a larger heading) and out (+: away). */
  steer: [number, number];
  /** The jib's heading and how far out its tip stands (level), and how fast each is changing. */
  slew: number;
  out: number;
  slewV: number;
  outV: number;
  /** The rig as the pick began (the jib eases from it). */
  rig0: { slew: number; luff: number; reach: number; mast: number; rope: number };
  /** Where the crate would land if let go now (world), and the monsters in its blast there. */
  aim: Vec3 | null;
  inBlast: number;
  /** A co-op mate's copy: the host's rig, which this one's eases toward (null on the host). */
  rigTo: number[] | null;
}

/** Whether the crate is on the hook yet (half-way through the pick, the chains take it). */
function hooked(d: CraneDrop): boolean {
  return d.stage === 'aim' || d.t > PICK_T * 0.45;
}

/** Whether the player stands at the crane's controls: on the deck, by its mast. */
export function atCraneControls(g: Game): boolean {
  const p = g.player;
  const F = g.fortress;
  if (p.dead || p.standingOn !== F) return false;
  const m = craneBase(F);
  if (!m.real) return false;
  const [lx, ly, lz] = F.toLocal(p.x, p.y, p.z);
  return Math.hypot(lx - m.at[0], lz - m.at[2]) < 3.4 && ly > m.at[1] - 12 && ly < m.at[1] + 1.5;
}

/**
 * Old Hob, the crane hand (he hung the cranes of all twelve Striders): where he stands by the mast
 * (world, at his feet), on the deck beside it, inboard of the crate's spot; null with no room there.
 */
export function hobSpot(g: Game): Vec3 | null {
  const F = g.fortress;
  const m = craneBase(F);
  if (!m.real) return null;
  const spot = crateSpot(g);
  const [sx, sy, sz] = F.toLocal(spot[0], spot[1], spot[2]);
  const floor = Math.round(sy - 1.4);
  const mx = Math.floor(m.at[0]);
  const mz = Math.floor(m.at[2]);
  const ox = sx - m.at[0];
  const oz = sz - m.at[2];
  let best: Vec3 | null = null;
  let bestScore = Infinity;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      const x = mx + dx;
      const z = mz + dz;
      if ((dx === 0 && dz === 0) || (x === Math.floor(sx) && z === Math.floor(sz))) continue;
      if (!F.solidAt(x, floor - 1, z) || F.solidAt(x, floor, z) || F.solidAt(x, floor + 1, z)) continue;
      // Inboard of the crate, close to the mast.
      const score = dx * ox + dz * oz + Math.hypot(dx, dz) * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = [x + 0.5, floor, z + 0.5];
      }
    }
  }
  return best ? F.toWorld(best[0], best[1], best[2]) : null;
}

/** Heading from the fortress's middle out through the mast (where the jib first swings out to). */
function outboard(g: Game): number {
  const F = g.fortress;
  const m = craneBase(F).at;
  const w = F.toWorld(m[0], m[1], m[2]);
  const [cx, cz] = F.centre();
  return Math.atan2(w[2] - cz, w[0] - cx);
}

/** The crew hooks a TNT crate on: the operator swings it out over the monsters and lets it go. */
export function startCraneDrop(g: Game): boolean {
  if (g.hoist || g.craneDrop) {
    g.deny('The crane is busy');
    return false;
  }
  if (g.craneDropCool > 0) {
    g.deny('The crew is still hooking on the next crate');
    return false;
  }
  if (!g.useItem(I.TNT, DROP_TNT)) {
    g.deny(`A crane drop takes ${DROP_TNT} TNT: craft it or buy it`);
    return false;
  }
  const r = g.crane;
  g.craneDrop = {
    by: g.cx, stage: 'pick', t: 0, crate: null, boom: 0, steer: [0, 0], slew: outboard(g), out: 12, slewV: 0, outV: 0,
    rig0: { slew: r.slew, luff: r.luff, reach: r.reach, mast: r.mast, rope: r.rope }, aim: null, inBlast: 0, rigTo: null,
  };
  g.sfx('winch', 'metal', 0.8, 1.15);
  g.report('primary_input');
  return true;
}

/** The crate goes back on the deck (the operator called it off, left, or took too long): the TNT is theirs again. */
export function cancelCraneDrop(g: Game, why = ''): void {
  const d = g.craneDrop;
  if (!d) return;
  g.craneDrop = null;
  // (Already let go: nothing to put back.)
  if (d.stage === 'fall') return;
  g.withCtx(d.by, () => {
    g.addItem(I.TNT, DROP_TNT);
    if (why) g.toast(why);
  });
  g.sfx('latch', 'metal', 0.6, 0.8);
}

/** Where the deck's crate waits for the hook (world): at the mast's foot, on the outboard side. */
export function crateSpot(g: Game): Vec3 {
  const F = g.fortress;
  const m = craneBase(F).at;
  const top = F.toWorld(m[0], m[1], m[2]);
  const a = outboard(g);
  const [lx, ly, lz] = F.toLocal(top[0] + Math.cos(a) * 1.4, top[1], top[2] + Math.sin(a) * 1.4);
  const cx = Math.floor(lx);
  const cz = Math.floor(lz);
  for (let y = Math.floor(ly); y >= F.minY; y -= 1) if (F.solidAt(cx, y, cz)) return F.toWorld(lx, y + 1.4, lz);
  return F.toWorld(lx, ly - 3, lz);
}

/** The crate's middle as it hangs (world) and how fast it is going (it leaves with the swing). */
function crateNow(g: Game): { p: Vec3; v: Vec3 } {
  const rig = g.crane;
  const tip = tipOf(pivotAt(g, rig.mast), rig.slew, rig.luff, rig.reach);
  const hung = hang(rig, tip, CRATE_HANG);
  return { p: add(hung.hook, scale(hung.dir, CRATE_HANG)), v: [rig.tipV[0] + rig.ov[0], 0, rig.tipV[2] + rig.ov[1]] };
}

/** Where a crate let go here at this speed comes down (world). */
function landing(g: Game, p: Vec3, v: Vec3): Vec3 {
  let [x, y, z] = p;
  let [vx, vy, vz] = v;
  const step = 0.04;
  for (let i = 0; i < 150; i += 1) {
    vy -= TNT_GRAVITY * step;
    x += vx * step;
    y += vy * step;
    z += vz * step;
    if (g.world.solid(Math.floor(x), Math.floor(y), Math.floor(z)) || g.fortress.solidAtWorld(x, y, z)) break;
  }
  return [x, y, z];
}

/** Host, per frame (from the fortress's update): the pick, the operator's swing, the aim. */
export function updateCraneDrop(g: Game, dt: number): void {
  if (g.craneDropCool > 0) g.craneDropCool = Math.max(0, g.craneDropCool - dt);
  const d = g.craneDrop;
  if (!d || d.rigTo) return;
  const op = d.by.player;
  if (op.dead || (d.by !== g.me && !g.partner)) {
    cancelCraneDrop(g);
    return;
  }
  d.t += dt;
  const rig = g.crane;
  const mastTo = 3;
  if (d.stage === 'pick') {
    // The jib swings round over the crate by the mast, the hook goes down to it and comes up with it.
    const u = clamp(d.t / PICK_T, 0, 1);
    const e = smooth(u / 0.5);
    rig.slew = lerpAngle(d.rig0.slew, d.slew, e);
    rig.luff = lerp(d.rig0.luff, 1.2, e);
    rig.reach = lerp(d.rig0.reach, 3.6, e);
    rig.mast = lerp(d.rig0.mast, mastTo, smooth(u));
    const tip = tipOf(pivotAt(g, rig.mast), rig.slew, rig.luff, rig.reach);
    const spot = crateSpot(g);
    const down = Math.sin(Math.PI * clamp(u / 0.9, 0, 1));
    rig.rope = Math.max(ROPE_MIN, lerp(d.rig0.rope, tip[1] - spot[1] - CRATE_HANG, down));
    rig.drum += (u < 0.45 ? 1 : -1) * dt * 8;
    rig.o = [0, 0];
    rig.ov = [0, 0];
    if (u >= 0.45 && rig.latch < 4) {
      rig.latch = 4;
      g.sfxAt('latch', spot[0], spot[1], spot[2], 0.9, 0.85, 40);
      buzzOperator(g, d, 14);
    }
    if (u >= 1) {
      d.stage = 'aim';
      d.t = 0;
      d.slew = rig.slew;
      d.out = Math.max(DROP_OUT[0], Math.cos(rig.luff) * rig.reach);
      g.sfx('winch', 'metal', 0.6, 1.3);
    }
  } else if (d.stage === 'fall') {
    // Let go: the hook rides up empty while the crate falls; the view stays on it until it bursts.
    const r0 = rig.rope;
    rig.rope += clamp(STOW_ROPE - rig.rope, -dt * 4, dt * 4);
    rig.drum += (r0 - rig.rope) * 1.6;
    if (!d.boom && (!d.crate || d.crate.age === Infinity || !g.projectiles.includes(d.crate))) d.boom = g.time;
    if ((d.boom && g.time - d.boom > 1.3) || d.t > 5) {
      g.craneDrop = null;
      return;
    }
  } else {
    // The stick swings the jib round and runs it out and in, with the weight of it behind every move;
    // at first it runs out over the side by itself.
    const [sx, sz] = d.steer;
    d.slewV += clamp(sx * 0.85 - d.slewV, -dt * 2.6, dt * 2.6);
    d.outV += clamp((d.t < 0.9 ? 9 : sz * 8) - d.outV, -dt * 20, dt * 20);
    d.slew = wrapAngle(d.slew + d.slewV * dt);
    d.out += d.outV * dt;
    if (d.out <= DROP_OUT[0] || d.out >= DROP_OUT[1]) {
      d.out = clamp(d.out, DROP_OUT[0], DROP_OUT[1]);
      d.outV = 0;
    }
    if (d.t < 0.9) d.out = Math.min(d.out, 12);
    const pivot = pivotAt(g, rig.mast);
    const luff = clamp(Math.atan2(2.5, d.out), LUFF_MIN, LUFF_MAX);
    rig.slew = d.slew;
    rig.luff = luff;
    rig.reach = d.out / Math.cos(luff);
    rig.mast += clamp(mastTo - rig.mast, -dt * 5, dt * 5);
    const r0 = rig.rope;
    rig.rope += clamp(4.2 - rig.rope, -dt * 6, dt * 6);
    rig.drum += (r0 - rig.rope) * 1.6;
    rig.latch = 4;
    void pivot;
    if (d.t > AIM_MAX) {
      cancelCraneDrop(g, 'The crew set the crate back on the deck');
      return;
    }
  }
  const tip = tipOf(pivotAt(g, rig.mast), rig.slew, rig.luff, rig.reach);
  swingStep(rig, tip, dt, rig.rope + (d.stage === 'fall' ? 0.6 : CRATE_HANG), d.stage === 'pick' ? 0.4 : 0.08);
  if (d.stage === 'aim') {
    const c = crateNow(g);
    d.aim = landing(g, c.p, c.v);
    const [ax, ay, az] = d.aim;
    const blast = crateBlast(g).radius;
    d.inBlast = g.mobs.filter((m) => !m.dead && Math.hypot(m.x - ax, m.y + m.h / 2 - ay, m.z - az) < blast + 0.4).length;
  }
}

/** The operator lets the crate go: it flies off the hook with the swing it had, and bursts where it lands. */
function letGo(g: Game, d: CraneDrop): void {
  const c = crateNow(g);
  const crate: Projectile = { kind: 'crate', x: c.p[0], y: c.p[1], z: c.p[2], vx: c.v[0], vy: c.v[1], vz: c.v[2], age: 0, life: 6, spin: 0, fromCrew: false, by: d.by };
  g.projectiles.push(crate);
  d.stage = 'fall';
  d.t = 0;
  d.crate = crate;
  d.steer = [0, 0];
  g.craneDropCool = hasPart(g, 'winch') ? DROP_COOL / 2 : DROP_COOL;
  // Free of the weight, the hook jumps on its rope.
  const rig = g.crane;
  rig.ov = [rig.ov[0] * 0.3 - c.v[0] * 0.2, rig.ov[1] * 0.3 - c.v[2] * 0.2];
  rig.latch = 0;
  g.sfxAt('latch', c.p[0], c.p[1], c.p[2], 0.9, 0.7, 48);
  g.sfx('whoosh', 'wool', 0.6, 0.8);
  buzzOperator(g, d, 40);
  g.crewSay('bombAway');
  g.stats.craneDrops = (g.stats.craneDrops ?? 0) + 1;
}

/** A buzz in the hand of whoever works the drop. */
function buzzOperator(g: Game, d: CraneDrop, ms: number): void {
  g.withCtx(d.by, () => g.buzz(ms));
}

/** A co-op mate's crane follows the host's as it comes (a snapshot at a time, eased between). */
function easeToHost(rig: CraneRig, v: number[], dt: number): void {
  if (v.length < 9) return;
  const k = 1 - Math.exp(-dt * 14);
  rig.slew = lerpAngle(rig.slew, v[0]! / 1000, k);
  rig.luff += (v[1]! / 1000 - rig.luff) * k;
  rig.reach += (v[2]! / 100 - rig.reach) * k;
  rig.mast += (v[3]! / 100 - rig.mast) * k;
  rig.rope += (v[4]! / 100 - rig.rope) * k;
  rig.latch = v[5]! / 100;
  rig.o[0] += (v[6]! / 100 - rig.o[0]) * k;
  rig.o[1] += (v[7]! / 100 - rig.o[1]) * k;
  rig.drum += (v[8]! / 100 - rig.drum) * k;
}

/** What a co-op mate is sent of a drop while it is under way (wire.ts DropDelta). */
interface DropWire {
  by: number;
  st: number;
  t: number;
  r: number[];
  aim: number[] | 0;
  n: number;
  b: number;
}

export function encodeCraneDrop(g: Game, d: CraneDrop): DropWire {
  const r = g.crane;
  const q = (v: number, k: number): number => Math.round(v * k);
  return {
    by: d.by === g.me ? 0 : 1, st: d.stage === 'pick' ? 0 : d.stage === 'aim' ? 1 : 2, t: q(d.t, 100) / 100,
    r: [q(r.slew, 1000), q(r.luff, 1000), q(r.reach, 100), q(r.mast, 100), q(r.rope, 100), q(r.latch, 100), q(r.o[0], 100), q(r.o[1], 100), q(r.drum, 100)],
    aim: d.aim ? [q(d.aim[0], 10) / 10, q(d.aim[1], 10) / 10, q(d.aim[2], 10) / 10] : 0, n: d.inBlast, b: d.boom ? 1 : 0,
  };
}

/** A co-op mate's copy of the host's drop (null: none under way). */
export function mirrorCraneDrop(g: Game, m: DropWire | 0, host: PlayerCtx): void {
  if (!m) {
    g.craneDrop = null;
    return;
  }
  const by = m.by === 1 ? g.me : host;
  let d = g.craneDrop;
  if (!d || d.by !== by) {
    const r = g.crane;
    d = { by, stage: 'pick', t: 0, crate: null, boom: 0, steer: [0, 0], slew: r.slew, out: 12, slewV: 0, outV: 0, rig0: { slew: r.slew, luff: r.luff, reach: r.reach, mast: r.mast, rope: r.rope }, aim: null, inBlast: 0, rigTo: null };
    g.craneDrop = d;
  }
  d.stage = m.st === 2 ? 'fall' : m.st === 1 ? 'aim' : 'pick';
  d.t = m.t;
  d.rigTo = m.r;
  d.slew = (m.r[0] ?? 0) / 1000;
  d.aim = m.aim ? [m.aim[0] ?? 0, m.aim[1] ?? 0, m.aim[2] ?? 0] : null;
  d.inBlast = m.n;
  d.boom = m.b ? d.boom || g.time : 0;
}

/**
 * The view while you work a drop: over the operator's shoulder, behind the mast and off to one side
 * of the jib (looking straight down its length would hide the crate and the ring behind it), high
 * enough to see the ring on the ground. The side is chosen once, clear of what stands in the way.
 */
function dropView(g: Game, d: CraneDrop, cam: CraneCam): { focus: Vec3; want: Vec3 } {
  const rig = g.crane;
  const F = g.fortress;
  const pivot = pivotAt(g, rig.mast);
  const tip = tipOf(pivot, rig.slew, rig.luff, rig.reach);
  const land: Vec3 = d.aim ?? [tip[0], g.world.groundAt(tip[0], tip[2]), tip[2]];
  const dx = land[0] - pivot[0];
  const dz = land[2] - pivot[2];
  const far = Math.hypot(dx, dz);
  const ux = far > 2 ? dx / far : Math.cos(rig.slew);
  const uz = far > 2 ? dz / far : Math.sin(rig.slew);
  // (Falling, the view follows the crate down to the ground.)
  const from: Vec3 = d.stage === 'fall' && d.crate && !d.boom ? [d.crate.x, d.crate.y + 3, d.crate.z] : tip;
  const k = d.stage === 'fall' ? 0.8 : 0.65;
  const focus: Vec3 = [lerp(from[0], land[0], k), lerp(from[1] - 3, land[1], k), lerp(from[2], land[2], k)];
  const back = 9 + far * 0.35;
  const off = 7 + far * 0.15;
  const high = Math.max(pivot[1] + 3, F.y + F.maxY + 4) + far * 0.2;
  const at = (side: number): Vec3 => [pivot[0] - ux * back - uz * off * side, high, pivot[2] - uz * back + ux * off * side];
  if (cam.side === 0) cam.side = blockedBetween(g, at(1), focus) <= blockedBetween(g, at(-1), focus) ? 1 : -1;
  return { focus, want: at(cam.side) };
}

/** A crane's crate: four TNT in a cradle of planks (`spin` tumbles it as it falls, `lit` flashes its fuse). */
export function drawCrate(b: MeshBuilder, c: Vec3, turn: number, spin: number, fuse: boolean): void {
  const ca = Math.cos(turn) * 0.32;
  const sa = Math.sin(turn) * 0.32;
  const up = Math.cos(spin);
  const tilt = Math.sin(spin) * 0.32;
  for (const [i, j] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    blockCube(b, B.TNT_BLOCK, [c[0] + ca * i - sa * j, c[1] + 0.05 + tilt * i, c[2] + sa * i + ca * j], 0.3, turn, spin, fuse ? 1.4 : 1, fuse ? 0.6 : 0);
  }
  if (up > 0.6) b.box([c[0], c[1] - 0.33, c[2]], [0.68 * Math.cos(turn), 0, 0.68 * Math.sin(turn)], [0, 0.05, 0], [-0.68 * Math.sin(turn), 0, 0.68 * Math.cos(turn)], [tileRect('planks_spruce')]);
}

/** A crate burst where it landed: the crew cheers a good one; a big one is a feat. */
export function crateLanded(g: Game, pr: { x: number; y: number; z: number; by?: PlayerCtx | null }, kills: number): void {
  pageLater(g, 'cranebomb');
  if (kills >= 2) {
    g.ui.damage(0, pr.x, pr.y + 2.5, pr.z, 'big', `${kills} IN ONE DROP!`);
    g.crewSay('bombHit');
  }
  if (kills >= 3) g.freeze(0.08);
  if (kills >= 4) g.withCtx(pr.by ?? g.me, () => feat(g, 'cranebomb'));
}

/** The crate (on the deck, then on the hook in its sling) and the red ring where it would land. */
function drawDrop(g: Game, d: CraneDrop, hung: { hook: Vec3; dir: Vec3 }, b: MeshBuilder, o: MeshBuilder, lit: (mb: MeshBuilder, x: number, y: number, z: number) => void): void {
  const rig = g.crane;
  const on = hooked(d);
  const c: Vec3 = on ? add(hung.hook, scale(hung.dir, CRATE_HANG)) : d.stage === 'fall' ? (d.crate ? [d.crate.x, d.crate.y, d.crate.z] : hung.hook) : crateSpot(g);
  const chain = [tileRect('chain')];
  lit(b, c[0], c[1], c[2]);
  const turn = rig.slew;
  if (d.stage !== 'fall') drawCrate(b, c, turn, 0, false);
  const ca = Math.cos(turn) * 0.32;
  const sa = Math.sin(turn) * 0.32;
  if (on) {
    const from = add(hung.hook, [0, -0.1, 0]);
    for (const [i, j] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) beam(b, from, [c[0] + ca * i * 1.6 - sa * j * 1.6, c[1] + 0.35, c[2] + sa * i * 1.6 + ca * j * 1.6], 0.035, chain);
  }
  if (d.stage === 'pick' || !d.aim || d.boom) return;
  // The ring: as wide as the blast, laid over whatever it would land on (the ground, your deck), a
  // cross at its middle and a line up to the crate.
  const [ax, ay, az] = d.aim;
  const top = surfaceUnder(g, ax, ay + 1.2, az);
  const y = (Number.isFinite(top) ? top : ay) + 0.06;
  const at = (a: number, r: number): Vec3 => {
    const x = ax + Math.cos(a) * r;
    const z = az + Math.sin(a) * r;
    const h = surfaceUnder(g, x, y + 2.5, z);
    return [x, Number.isFinite(h) ? clamp(h, y - 2.5, y + 2.5) + 0.06 : y, z];
  };
  const pulse = 0.5 + 0.5 * Math.sin(g.time * 7);
  const hot = d.inBlast > 0;
  const white = [tileRect('white')];
  o.flags = F_OVERLAY | F_UNLIT;
  o.tint = hot ? [1, 0.12, 0.05] : [1, 0.45, 0.08];
  o.emit = 1;
  o.alpha = 0.7 + pulse * 0.3;
  const n = 28;
  const R = crateBlast(g).radius;
  let prev = at(0, R);
  for (let i = 0; i < n; i += 1) {
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const next = at(a1, R);
    beam(o, prev, next, 0.2, white);
    // (Ticks pointing in, every quarter turn.)
    if (i % 7 === 0) beam(o, prev, at((i / n) * Math.PI * 2, R - 1.1), 0.12, white);
    prev = next;
  }
  beam(o, [ax - 0.9, y, az], [ax + 0.9, y, az], 0.1, white);
  beam(o, [ax, y, az - 0.9], [ax, y, az + 0.9], 0.1, white);
  o.alpha = 0.3 + pulse * 0.2;
  beam(o, [ax, y, az], [c[0], c[1] - 0.4, c[2]], 0.035, white);
  o.flags = 0;
  o.alpha = 1;
  o.emit = 0;
  o.tint = [1, 1, 1];
}

// ------------------------------------------------------------------ co-op

/** How a lift's pose travels after the load's own (its lean, then the rig): its lerp per value. */
export const LIFT_LERP: ReadonlyArray<0 | 1 | 2> = [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/** The load's lean and the rig, as whole numbers. */
export function encodeLift(g: Game, h: Hoist): number[] {
  const C = h.cargo;
  const r = g.crane;
  const q = (v: number, k: number): number => Math.round(v * k);
  return [
    q(C.tilt[0], 1000), q(C.tilt[1], 1000), q(C.tilt[2], 1000), q(C.tiltAt[0], 100), q(C.tiltAt[1], 100), q(C.tiltAt[2], 100),
    q(r.slew, 1000), q(r.luff, 1000), q(r.reach, 100), q(r.mast, 100), q(r.rope, 100), q(r.latch, 100), q(r.strain, 100), q(r.o[0], 100), q(r.o[1], 100), q(r.drum, 100),
  ];
}

/** A co-op mate's copy: the load leans and the crane stands as the host's did (`v` after the load's pose). */
export function applyLift(g: Game, h: Hoist, v: number[], at = 4): void {
  if (v.length < at + 16) return;
  const n = (i: number, k: number): number => v[at + i]! / k;
  const C = h.cargo;
  C.tilt[0] = n(0, 1000);
  C.tilt[1] = n(1, 1000);
  C.tilt[2] = n(2, 1000);
  C.tiltAt[0] = n(3, 100);
  C.tiltAt[1] = n(4, 100);
  C.tiltAt[2] = n(5, 100);
  const r = g.crane;
  r.slew = n(6, 1000);
  r.luff = n(7, 1000);
  r.reach = n(8, 100);
  r.mast = n(9, 100);
  r.rope = n(10, 100);
  r.latch = n(11, 100);
  r.strain = n(12, 100);
  r.o[0] = n(13, 100);
  r.o[1] = n(14, 100);
  r.drum = n(15, 100);
}

/** A co-op mate's copy of a lift (filled in from the host's as it comes). */
export function mirrorHoist(s: Structure, by: PlayerCtx, info: CargoInfo): Hoist {
  return {
    s, cargo: new Body('cargo'), stage: 'reach', t: 0, mid: [0, 0, 0], turn: 0, base: [], merge: -1, clear: [], info, by,
    rig0: { slew: 0, luff: 0, reach: 0, mast: 0, rope: 0 }, mastWork: 0, cruise: 0, strain: 0, perfect: [false, false],
    eaves: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], height: 1, clump: [], pit: new Set(), clodTimer: 0, rim: [], near: [], axis: [1, 0], swingFrom: [0, 0], buildEnd: 0, whooshed: false,
    steer: 0, trim: 0, trimV: 0, slow: 0, gold: false, swingDir: 0,
  };
}

/** One of the host's crane effects: a clod letting go, or an unloading beginning. */
export function playCraneFx(g: Game, e: unknown[]): void {
  const n = (i: number): number => Number(e[i]) || 0;
  if (e[0] === 'clod') addClod(g, n(1), [n(2), n(3), n(4)], [n(5), n(6), n(7)]);
  else if (e[0] === 'build' && g.hoist) startCascade(g, g.hoist.cargo, { list: (e[2] as number[]) ?? [] });
}

// ------------------------------------------------------------------ the crane camera

/** The view of a lift you are working: from the side, gliding to keep the hook, the load and its place in frame. */
export interface CraneCam {
  eye: Vec3;
  yaw: number;
  pitch: number;
  /** Your own view, given back afterwards. */
  saved: [number, number];
  /** Which side of the jib a drop is watched from (+1 / -1; 0: not chosen yet). */
  side: number;
  /** While the building is still on the ground: the angle it is watched from (radians off the line to the fortress), chosen clear of anything in the way. */
  angle: number | null;
}

/** Glides the crane's view toward a spot to watch from, looking at what it follows. */
function aimCam(g: Game, cam: CraneCam, focus: Vec3, want: Vec3, dt: number): void {
  want[1] = Math.max(want[1], g.world.groundAt(want[0], want[2]) + 4);
  const ke = 1 - Math.exp(-dt * 2.2);
  for (let i = 0; i < 3; i += 1) cam.eye[i] = cam.eye[i]! + (want[i]! - cam.eye[i]!) * ke;
  // (Aimed a little under it: it sits above the middle of the view, clear of the gauge.)
  const dx = focus[0] - cam.eye[0];
  const dz = focus[2] - cam.eye[2];
  const dy = focus[1] - cam.eye[1] - Math.hypot(dx, dz) * 0.1;
  const kl = 1 - Math.exp(-dt * 5);
  cam.yaw = lerpAngle(cam.yaw, Math.atan2(dz, dx), kl);
  cam.pitch += (Math.atan2(dy, Math.hypot(dx, dz)) - cam.pitch) * kl;
}

/** Where the side view of a building on the ground stands (`angle` off the line from it to the fortress). */
function sideEye(g: Game, h: Hoist, mid: Vec3, angle: number): Vec3 {
  const [fx, fz] = g.fortress.centre();
  const a = Math.atan2(fz - mid[2], fx - mid[0]) + angle;
  const D = 13 + h.height * 1.05;
  return [mid[0] + Math.cos(a) * D, mid[1] + 6 + h.height * 0.65, mid[2] + Math.sin(a) * D];
}

/** Blocks (and the fortress's cells) in the way between two points, the last few left out. */
function blockedBetween(g: Game, a: Vec3, b: Vec3): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.floor(d);
  let hits = 0;
  for (let i = 1; i < n - 3; i += 1) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    if (blockDef(g.world.get(Math.floor(x), Math.floor(y), Math.floor(z))).solid || g.fortress.solidAtWorld(x, y, z)) hits += 1;
  }
  return hits;
}

/** The side to watch a building from: the clearest view, the fortress beside it rather than behind. */
function clearAngle(g: Game, h: Hoist, mid: Vec3): number {
  let best = Math.PI / 2.6;
  let bestScore = Infinity;
  for (const deg of [70, -70, 50, -50, 95, -95, 120, -120]) {
    const a = (deg * Math.PI) / 180;
    const eye = sideEye(g, h, mid, a);
    const score = blockedBetween(g, eye, mid) * 10 + Math.abs(Math.abs(deg) - 70) / 25;
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/**
 * This device's camera while its player works the crane (from the hook going down to the last
 * block landing), and back to the player's own view after. `pull` is how far the view has pulled
 * out (0: your own eyes). It watches over the crane's shoulder: from behind and above the mast,
 * looking out along the jib at the building, following the load in, then down at its place.
 */
export function craneCamera(g: Game, dt: number, on: boolean, pull: number): void {
  const h = g.hoist;
  const dd = g.craneDrop;
  let cam = g.craneCam;
  if (!cam) {
    if (!on || (!h && !dd)) return;
    cam = { eye: [...g.eye()], yaw: g.yaw, pitch: g.pitch, saved: [g.yaw, g.pitch], side: 0, angle: null };
    g.craneCam = cam;
  }
  if (on && dd) {
    const v = dropView(g, dd, cam);
    aimCam(g, cam, v.focus, v.want, dt);
  } else if (on && h) {
    const F = g.fortress;
    const C = h.cargo;
    const pivot = pivotAt(g, g.crane.mast);
    const S = slotPoint(g, h);
    const B0 = buildingTop(h);
    const air = h.stage !== 'reach' && h.stage !== 'heave';
    const load: Vec3 = air && C.cells.size > 0 ? loadPoint(C, (C.minX + C.maxX + 1) / 2, (C.minY + C.maxY + 1) / 2, (C.minZ + C.maxZ + 1) / 2) : [B0[0], B0[1] - h.height / 2, B0[2]];
    // Out along the jib to the building; at the end, outward over its place in the hold.
    const [fcx, fcz] = F.centre();
    const unit = (x: number, z: number): [number, number] => {
      const l = Math.hypot(x, z) || 1;
      return [x / l, z / l];
    };
    const outS = unit(S[0] - fcx, S[2] - fcz);
    const S1: Vec3 = [S[0], S[1] + STOREY / 2, S[2]];
    let focus: Vec3;
    let want: Vec3;
    if (h.stage === 'reach' || h.stage === 'heave' || h.stage === 'lift') {
      // On the ground (and coming up): from the side and above, the fortress and its jib off to one
      // side, wherever nothing stands in the way.
      const mid: Vec3 = [B0[0], B0[1] - h.height * 0.35, B0[2]];
      focus = h.stage === 'lift' ? [load[0], lerp(mid[1], load[1], 0.7), load[2]] : mid;
      cam.angle ??= clearAngle(g, h, mid);
      want = sideEye(g, h, mid, cam.angle);
    } else {
      // In the air: from outside the fortress, over its place in the hold, the crane behind it.
      const k = h.stage === 'swing' ? smooth(h.t / 2.2) : 1;
      focus = h.stage === 'swing' ? [lerp(load[0], S1[0], k * 0.4), lerp(load[1], S1[1], k * 0.4), lerp(load[2], S1[2], k * 0.4)] : [lerp(S1[0], load[0], 0.45), lerp(S1[1], load[1], 0.45), lerp(S1[2], load[2], 0.45)];
      const reach = Math.hypot(focus[0] - pivot[0], focus[2] - pivot[2]);
      const back = clamp(reach * 0.55 + 14, 16, 34);
      want = [
        pivot[0] - outS[0] * back + outS[1] * 3,
        Math.max(pivot[1] + 6, focus[1] + back * 0.32),
        pivot[2] - outS[1] * back - outS[0] * 3,
      ];
    }
    aimCam(g, cam, focus, want, dt);
  }
  const e = pull * pull * (3 - 2 * pull);
  g.yaw = lerpAngle(cam.saved[0], cam.yaw, e);
  g.pitch = lerp(cam.saved[1], cam.pitch, e);
  if (!on && pull <= 0.001) {
    g.yaw = cam.saved[0];
    g.pitch = cam.saved[1];
    g.craneCam = null;
  }
}
