// The parachute: it opens by itself whenever you fall from high up (stepping off the deck, a
// cliff, a giant's back, a blast that throws you), lowers you gently wherever you steer it and
// packs itself away the moment you land. JUMP DOWN vaults you over the deck's rail to use it.
import { fluff } from './animals';
import { B } from './blocks';
import type { Actor } from './entities';
import { feat } from './feats';
import type { Game } from './game';
import type { Vec3 } from './math3d';
import { sweep } from './physics';

/** Descent under the open canopy, and how fast (and how briskly) it steers (blocks/s). */
export const CHUTE_FALL = 4.2;
export const CHUTE_STEER = 5.4;
export const CHUTE_ACCEL = 6;
/** It opens once you fall this fast with at least this much air below you (a jump never opens it). */
const OPEN_SPEED = 7;
const OPEN_DROP = 4.5;
/** Seconds for the canopy to fill. */
const OPEN_TIME = 0.4;
/** Seconds a landed canopy takes to settle and fold away. */
export const FOLD_TIME = 0.9;
/** Pushing this long against the rail offers the way over it (JUMP DOWN), over this much drop. */
const PUSH_TO_OFFER = 0.3;
const VAULT_DROP = OPEN_DROP + 1.5;

/** How far down the first thing under an actor's feet is (up to `max`). */
export function airBelow(g: Game, a: Actor, max: number): number {
  const r = sweep({ x: a.x, y: a.y, z: a.z, hw: a.hw, h: a.h }, 1, -max, g.grids());
  return r.hit ? -r.d : max;
}

/** The fastest a falling actor may go this step: an opening canopy bites harder as it fills. */
export function chuteCap(a: Actor, dt: number, free: number): number {
  if (a.chute <= 0) return free;
  return Math.max(CHUTE_FALL, -a.vy * Math.exp(-dt * 7 * a.chute));
}

/** After the player moves: a long fall opens the canopy; landing (a ladder, water) packs it. */
export function updateChute(g: Game, p: Actor, dt: number, swim: boolean): void {
  if (p.chute > 0) {
    if (p.onGround || p.climbing || swim) {
      packChute(g, p, p.onGround);
      return;
    }
    p.chute = Math.min(1, p.chute + dt / OPEN_TIME);
    return;
  }
  if (p.onGround || p.climbing || swim || p.dead || g.carried || p.vy > -OPEN_SPEED) return;
  if (airBelow(g, p, OPEN_DROP) < OPEN_DROP) return;
  p.chute = 0.01;
  g.chuteFrom = p.y;
  g.sfx('whoosh', 'wool', 0.65, 0.7);
  g.sfx('poof', 'wool', 0.5, 0.6);
  g.punch(0.04);
  g.buzz(25);
  g.report('visual_feedback');
}

/** Packs the canopy away (landed: it settles where you came down; a long ride earns a feat). */
export function packChute(g: Game, p: Actor, landed: boolean): void {
  if (p.chute <= 0) return;
  if (landed) {
    g.chuteFold = { x: p.x, y: p.y, z: p.z, yaw: g.yaw, open: p.chute, t: 0 };
    g.sfx('poof', 'wool', 0.55, 0.85);
    // A puff where the canopy settles, behind you.
    fluff(g, p.x - Math.cos(g.yaw) * 1.8, p.y + 0.4, p.z - Math.sin(g.yaw) * 1.8, 6, [0.95, 0.93, 0.88]);
    if (g.chuteFrom !== null && g.chuteFrom - p.y >= 16) feat(g, 'skydive');
  }
  p.chute = 0;
  g.chuteFrom = null;
}

// ------------------------------------------------------------------ over the side

/** The hop over the side: a curve in the deck's frame, from where you stood, over the rail, out. */
export interface OverSide {
  from: Vec3;
  /** The curve's pull (high over the rail). */
  over: Vec3;
  to: Vec3;
  /** Outward, in the deck's frame. */
  dir: [number, number];
  t: number;
  dur: number;
}

/**
 * Standing on the deck pushing (dx, dz) (world) against its rail or open edge: the way over the
 * side when a long drop lies beyond (null for walls, turrets, rail posts, or a short drop).
 */
export function sideExit(g: Game, p: Actor, dx: number, dz: number): OverSide | null {
  const F = g.fortress;
  if (p.standingOn !== F || p.dead) return null;
  const [lx, ly, lz] = F.toLocal(p.x, p.y, p.z);
  const [ldx, ldz] = F.dirToLocal(dx, dz);
  if (Math.hypot(ldx, ldz) < 1e-3) return null;
  // Straight out across the edge the push is mostly against.
  const along = Math.abs(ldx) >= Math.abs(ldz);
  const sx = along ? Math.sign(ldx) : 0;
  const sz = along ? 0 : Math.sign(ldz);
  const fy = Math.floor(ly + 0.05);
  const cx = Math.floor(lx + sx * (p.hw + 0.45));
  const cz = Math.floor(lz + sz * (p.hw + 0.45));
  const rail = F.blockAt(cx, fy, cz) === B.FENCE;
  // A wall, a turret or a rail post (with its lantern): no way over.
  if (!rail && F.solidAt(cx, fy, cz)) return null;
  if (F.solidAt(cx, fy + 1, cz) || F.solidAt(cx, fy + 2, cz)) return null;
  // Open air beyond: no deck under it (past the rail, or right at the deck's edge).
  const ox = rail ? cx + sx : cx;
  const oz = rail ? cz + sz : cz;
  for (let y = fy - 1; y <= fy + 2; y += 1) if (F.solidAt(ox, y, oz)) return null;
  const [wx, wy, wz] = F.toWorld(ox + 0.5, fy, oz + 0.5);
  // (Enough of a drop for the canopy to open and brake fully; a short one you just hop down.)
  const below = sweep({ x: wx, y: wy, z: wz, hw: p.hw, h: p.h }, 1, -(VAULT_DROP + 1), g.grids());
  if (below.hit && -below.d < VAULT_DROP) return null;
  // Out to a stride past the edge (clear of a ladder hanging there), the feet over the rail's top.
  const face = (c: number, s: number): number => (rail ? (s > 0 ? c + 1 : c) : s > 0 ? c : c + 1);
  const to: Vec3 = sx !== 0 ? [face(cx, sx) + sx * 1.6, fy + 0.5, lz] : [lx, fy + 0.5, face(cz, sz) + sz * 1.6];
  const mid: Vec3 = sx !== 0 ? [cx + 0.5, fy + (rail ? 2.4 : 1.2), lz] : [lx, fy + (rail ? 2.4 : 1.2), cz + 0.5];
  return { from: [lx, ly, lz], over: mid, to, dir: [sx, sz], t: 0, dur: rail ? 0.5 : 0.38 };
}

/** Records a push against the deck's edge (it offers JUMP DOWN while it lasts). */
export function notePush(g: Game, p: Actor, dx: number, dz: number, dt: number): void {
  const l = Math.hypot(dx, dz);
  if (l < 1e-3 || !sideExit(g, p, dx, dz)) {
    g.edgePush = 0;
    return;
  }
  const e = g.edge;
  // (A push the other way, or somewhere else, starts the count again.)
  const same = e.dir[0] * dx + e.dir[1] * dz > 0.7 * l && Math.hypot(e.x - p.x, e.z - p.z) < 0.6;
  g.edgePush = same ? g.edgePush + dt : dt;
  e.dir = [dx / l, dz / l];
  e.x = p.x;
  e.z = p.z;
  e.at = g.time;
}

/** The way over the side while a recent push offers it (the button stays a moment after you let go). */
export function offeredExit(g: Game, linger = 1.5, minPush = PUSH_TO_OFFER): OverSide | null {
  const p = g.player;
  const e = g.edge;
  if (g.edgePush < minPush || g.time - e.at > linger || Math.hypot(e.x - p.x, e.z - p.z) > 0.6) return null;
  return sideExit(g, p, e.dir[0], e.dir[1]);
}

/** Over the side you go: a hop across the rail, then the drop (the parachute opens by itself). */
export function goOverSide(g: Game, way: OverSide): void {
  const p = g.player;
  g.overSide = way;
  g.edgePush = 0;
  g.endHold();
  p.standingOn = null;
  p.onGround = false;
  p.climbing = false;
  p.ladder = null;
  p.vx = p.vy = p.vz = 0;
  g.sfx('leap', 'wood', 0.55);
  g.sfx('whoosh', 'wool', 0.35, 1.2);
  g.report('primary_input');
}

/** Per step of the hop: along the curve in the deck's frame (it rides along with the walking hull). */
export function updateOverSide(g: Game, p: Actor, dt: number): void {
  const w = g.overSide!;
  const F = g.fortress;
  w.t += dt;
  const u = Math.min(1, w.t / w.dur);
  const a = 1 - u;
  const at: Vec3 = [
    a * a * w.from[0] + 2 * a * u * w.over[0] + u * u * w.to[0],
    a * a * w.from[1] + 2 * a * u * w.over[1] + u * u * w.to[1],
    a * a * w.from[2] + 2 * a * u * w.over[2] + u * u * w.to[2],
  ];
  [p.x, p.y, p.z] = F.toWorld(at[0], at[1], at[2]);
  g.yaw += F.turned();
  p.vx = p.vy = p.vz = 0;
  if (u < 1) return;
  // Released past the edge, still drifting outward (away from the hull and its ladder).
  g.overSide = null;
  const [ox, oz] = F.dirToWorld(w.dir[0], w.dir[1]);
  p.vx = ox * 3;
  p.vz = oz * 3;
  p.vy = -2;
  p.onGround = false;
  p.standingOn = null;
}
