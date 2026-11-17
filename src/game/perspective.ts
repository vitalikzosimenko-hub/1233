// Third person (Minecraft's F5): the view drawn back behind your right shoulder, pulled in short of
// any wall, roof or hull in its way so it never looks through one. You aim along the same line of
// sight: what sits under the crosshair is what you dig, strike or build on, and reach counts from
// your shoulder (nothing between the camera and you is in reach).
import { I } from './blocks';
import { approach, EYE, type Game, type Ray } from './game';
import { swordOf } from './gear';
import { forward, rightOf, type Vec3 } from './math3d';
import { mySkin, type MateView } from './models';
import { raycastGrid } from './raycast';

/** Where the view stands: this far behind your shoulder, itself this far out to your right and up from your eyes. */
const BACK = 4;
const SIDE = 0.75;
const RISE = 0.35;
/** The view keeps this far off a wall (it is a little box, not a point). */
const MARGIN = 0.1;

function ease(k: number): number {
  return k * k * (3 - 2 * k);
}

/**
 * Once a frame, for this device's own player: draws the view back over your shoulder while `on`
 * (and in again while not), and finds how much of the way the walls leave it. It snaps in at once,
 * never through a wall, and eases back out.
 */
export function frameShoulder(g: Game, dt: number, on: boolean): void {
  const was = g.shoulderPull;
  g.shoulderPull = approach(was, on ? 1 : 0, dt * 2.5);
  if (g.shoulderPull <= 0) return;
  const p = g.player;
  const eye: Vec3 = [p.x, p.y + EYE + g.bob, p.z];
  const r = rightOf(g.yaw);
  const f = forward(g.yaw, g.pitch);
  const len = Math.hypot(SIDE, RISE);
  const out: Vec3 = [(r[0] * SIDE) / len, RISE / len, (r[2] * SIDE) / len];
  const side = clearance(g, eye, out, len) / len;
  // (Drawing back from your eyes: straight out to where it can stand.)
  g.shoulderSide = was <= 0 || side < g.shoulderSide ? side : approach(g.shoulderSide, side, dt * 1.5);
  const k = g.shoulderSide * len;
  const shoulder: Vec3 = [eye[0] + out[0] * k, eye[1] + out[1] * k, eye[2] + out[2] * k];
  const back = clearance(g, shoulder, [-f[0], -f[1], -f[2]], BACK);
  g.shoulderDist = was <= 0 || back < g.shoulderDist ? back : approach(g.shoulderDist, back, dt * 5);
}

/** The view from your eyes `fp`, drawn back over your shoulder as far as it has come. */
export function shoulderEye(g: Game, fp: Vec3): Vec3 {
  const e = ease(g.shoulderPull);
  if (e <= 0) return fp;
  const r = rightOf(g.yaw);
  const f = forward(g.yaw, g.pitch);
  const s = g.shoulderSide;
  const back = g.shoulderDist;
  return [fp[0] + (r[0] * SIDE * s - f[0] * back) * e, fp[1] + (RISE * s - f[1] * back) * e, fp[2] + (r[2] * SIDE * s - f[2] * back) * e];
}

/** How far ahead of the view, along its line of sight, your shoulder stands (0 in first person). */
export function shoulderLead(g: Game): number {
  return g.shoulderDist * ease(g.shoulderPull);
}

/**
 * A ray from the view, moved up its own line to where it passes closest to your shoulder (on the
 * line of sight, the shoulder itself): reach counts from there, and nothing between the view and
 * you is in it (unchanged in first person, and while the helm's or the crane's view takes over).
 */
export function fromShoulder(g: Game, r: Ray): Ray {
  const lead = g.camPull > 0.001 ? 0 : shoulderLead(g);
  if (lead <= 0) return r;
  const f = forward(g.yaw, g.pitch);
  const t = lead * Math.max(0, r.dx * f[0] + r.dy * f[1] + r.dz * f[2]);
  return { ox: r.ox + r.dx * t, oy: r.oy + r.dy * t, oz: r.oz + r.dz * t, dx: r.dx, dy: r.dy, dz: r.dz };
}

/**
 * Whether the view stands far enough back to show you whole. Closer in (a wall right behind you)
 * it is as good as your own eyes, and your hand shows instead.
 */
export function bodyShown(g: Game): boolean {
  return shoulderLead(g) > 1.1;
}

/** You as the third-person view shows you (`swing`: 0..1 through a blow or a dig). */
export function selfView(g: Game, swing: number): MateView {
  const p = g.player;
  const item = g.heldItem();
  const aim = g.mode === 'mine' && (g.selected === I.CROSSBOW || g.selected === I.GRAPPLE);
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: g.yaw,
    pitch: g.pitch,
    walkPhase: p.walkPhase,
    speed: Math.hypot(p.vx, p.vz),
    swing,
    skin: mySkin(),
    pose: p.dead ? 'down' : p.climbing ? 'climb' : !p.onGround && g.inWater(p) ? 'swim' : 'stand',
    turn: 0,
    hen: g.carried !== null,
    hurt: p.hurt,
    item,
    arms: p.chute > 0.3 ? 'chute' : aim ? 'aim' : undefined,
    icon: item === null ? 'ui_pickaxe' : item === I.SWORD ? swordOf(g).icon : undefined,
  };
}

/** Your right hand as the third-person view shows it, held out along your aim (where the grapple's rope starts). */
export function heldOut(g: Game): Vec3 {
  const p = g.player;
  const r = rightOf(g.yaw);
  const f = forward(g.yaw, g.pitch);
  const px = 1.8 / 32;
  return [p.x + (r[0] * 6 + f[0] * 9) * px, p.y + (22 + f[1] * 9) * px, p.z + (r[2] * 6 + f[2] * 9) * px];
}

/**
 * How far the view can go from `from` along `dir` (up to `max`) before it meets a solid block of
 * the world, the fortress or a giant: the nearest of eight rays from the corners of a little box
 * round it, less a margin.
 */
function clearance(g: Game, from: Vec3, dir: Vec3, max: number): number {
  let best = max + MARGIN;
  for (let i = 0; i < 8; i += 1) {
    const ox = from[0] + (i & 1 ? MARGIN : -MARGIN);
    const oy = from[1] + (i & 2 ? MARGIN : -MARGIN);
    const oz = from[2] + (i & 4 ? MARGIN : -MARGIN);
    best = solidAlong(g, ox, oy, oz, dir, best);
  }
  return Math.max(0, Math.min(max, best - MARGIN));
}

/** Distance along a ray to the first solid block of the world, the fortress or a giant (or `max`). */
function solidAlong(g: Game, ox: number, oy: number, oz: number, d: Vec3, max: number): number {
  const w = g.world;
  let best = max;
  const hit = raycastGrid(ox, oy, oz, d[0], d[1], d[2], best, (x, y, z) => w.solid(x, y, z));
  if (hit) best = hit.dist;
  const bodies = [g.fortress];
  for (const gi of g.giants) if (!gi.dead) bodies.push(gi.body);
  for (const body of bodies) {
    const [lx, ly, lz] = body.toLocal(ox, oy, oz);
    const [dx, dz] = body.dirToLocal(d[0], d[2]);
    const h = raycastGrid(lx, ly, lz, dx, d[1], dz, best, (x, y, z) => body.solidAt(x, y, z));
    if (h) best = Math.min(best, h.dist);
  }
  return best;
}
