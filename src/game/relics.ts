// The relics' powers: the grapple that zips you up cliffs and back onto your deck, Millford's
// crossbow, Stonewater's war horn, Ashvale's storm rod, Redcliff's Heartbreakers, and the
// Heartstones felled giants leave behind for the Engine Core.
import { I } from './blocks';
import { hasOfficer } from './company';
import { kx, ky, kz, type BlockBody } from './body';
import { pick } from './build';
import { aimPoint, planThrow } from './combat';
import { moveActor, type Actor } from './entities';
import { feat } from './feats';
import { dist3, type Game, type Ray } from './game';
import { rightOf, type Vec3 } from './math3d';
import { damageMob } from './mobs';
import { overlaps } from './physics';
import { clamp } from './rng';
import { page, RELICS, type RelicId } from './story';
import { bodyShown, heldOut } from './perspective';

// ------------------------------------------------------------------ the grapple

export const GRAPPLE_RANGE = 34;
const HOOK_SPEED = 95;

export interface Grapple {
  /** What the hook bit into (null: the terrain) and where, in that body's own frame. */
  body: BlockBody | null;
  at: Vec3;
  /** The face it bit (normal) and the cell, in the same frame. */
  n: Vec3;
  cell: Vec3;
  /** fly: the hook is in the air; pull: the rope reels you in; vault: up and over onto the ledge. */
  stage: 'fly' | 'pull' | 'vault';
  t: number;
  fly: number;
  /** Closest you have come so far, and how long the reel has made no progress. */
  best: number;
  stall: number;
  /** Where you will stand once over the top (null: nowhere to stand: you hang and drop). */
  land: Vec3 | null;
  /** The vault's path (in the hook's frame) and how long it takes. */
  path: Vec3[];
  dur: number;
}

/** The hook's world position. */
export function hookPoint(g: Game): Vec3 | null {
  const G = g.grapple;
  if (!G) return null;
  return G.body ? G.body.toWorld(G.at[0], G.at[1], G.at[2]) : G.at;
}

function worldNormal(G: Grapple): Vec3 {
  if (!G.body) return G.n;
  const [x, z] = G.body.dirToWorld(G.n[0], G.n[2]);
  return [x, G.n[1], z];
}

function anchored(g: Game, G: Grapple): boolean {
  const [x, y, z] = G.cell;
  return G.body ? G.body.hasBlock(x, y, z) : g.world.solid(x, y, z);
}

/** Fires the hook along a ray (tapping again while it reels lets go). */
export function fireGrapple(g: Game, ray: Ray): boolean {
  if (g.grapple) {
    releaseGrapple(g, true);
    return true;
  }
  if (g.grappleCooldown > 0 || g.player.dead) return false;
  const hit = pick(g, ray, GRAPPLE_RANGE).block;
  g.mining.swing = 0.2;
  if (!hit) {
    g.deny(`Nothing within ${GRAPPLE_RANGE} blocks for the hook to bite`);
    return false;
  }
  const wx = ray.ox + ray.dx * hit.dist;
  const wy = ray.oy + ray.dy * hit.dist;
  const wz = ray.oz + ray.dz * hit.dist;
  const at: Vec3 = hit.body ? hit.body.toLocal(wx, wy, wz) : [wx, wy, wz];
  const G: Grapple = {
    body: hit.body, at, n: [hit.nx, hit.ny, hit.nz], cell: [hit.x, hit.y, hit.z],
    stage: 'fly', t: 0, fly: Math.max(0.05, hit.dist / HOOK_SPEED), best: Infinity, stall: 0, land: null, path: [], dur: 0,
  };
  G.land = landing(g, G);
  g.grapple = G;
  g.grappleCooldown = 0.3;
  g.sfx('grapple', 'metal', 0.9);
  g.punch(0.012);
  g.buzz(15);
  g.report('primary_input');
  return true;
}

/** Lets go of the rope; flung, you keep your speed (and a little lift). */
export function releaseGrapple(g: Game, fling: boolean): void {
  if (!g.grapple || g.grapple.stage === 'vault') return;
  const wasPulling = g.grapple.stage === 'pull';
  g.grapple = null;
  if (fling && wasPulling) g.player.vy += 2.5;
}

function solidIn(g: Game, body: BlockBody | null, x: number, y: number, z: number): boolean {
  return body ? body.solidAt(x, y, z) : g.world.solid(x, y, z);
}

/**
 * Where the climb ends, in the hook's frame: on your own fortress, the free deck spot nearest
 * the hook (whatever face of the hull it bit); on a giant, its top above the hook; on the land,
 * the top of the ledge if it is within a short scramble. Null: nowhere to stand.
 */
function landing(g: Game, G: Grapple): Vec3 | null {
  const B0 = G.body;
  const [cx, cy, cz] = G.cell;
  if (B0 && B0 === g.fortress) {
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (const k of B0.cells.keys()) {
      if (ky(k) !== 0) continue;
      const x = kx(k);
      const z = kz(k);
      if (B0.solidAt(x, 1, z) || B0.solidAt(x, 2, z) || !B0.solidAt(x, 0, z)) continue;
      const d = Math.hypot(x + 0.5 - G.at[0], z + 0.5 - G.at[2]);
      if (d < bestD) {
        bestD = d;
        best = [x + 0.5, 1.002, z + 0.5];
      }
    }
    return best;
  }
  if (B0) {
    const top = B0.topSolid(cx, cz);
    return top === null ? null : [cx + 0.5, top + 1.002, cz + 0.5];
  }
  for (let k = 0; k <= 3; k += 1) {
    if (solidIn(g, null, cx, cy + k, cz) && !solidIn(g, null, cx, cy + k + 1, cz) && !solidIn(g, null, cx, cy + k + 2, cz)) return [cx + 0.5, cy + k + 1.002, cz + 0.5];
  }
  return null;
}

/**
 * Per step while the hook is out: flying, the player moves as usual; reeling, the rope pulls
 * them to the hook (moving with whatever it bit into); then a vault carries them up and over
 * onto the ledge. Returns true when it moved the player.
 */
export function updateGrapple(g: Game, p: Actor, dt: number): boolean {
  const G = g.grapple;
  if (!G) return false;
  if (p.dead || g.helm || g.leap || !anchored(g, G)) {
    g.grapple = null;
    return false;
  }
  G.t += dt;
  if (G.stage === 'vault') {
    vaultStep(g, G, p);
    return true;
  }
  if (G.stage === 'fly') {
    if (G.t < G.fly) return false;
    G.stage = 'pull';
    G.t = 0;
    const h = hookPoint(g)!;
    g.sfx('reel', 'metal', 0.8);
    g.particles.sparks(h[0], h[1], h[2], ['#ffffff', '#d0d0d0', '#ffd060'], 7, 3, 0.06, 0.3);
    g.buzz(20);
  }
  const h = hookPoint(g)!;
  const n = worldNormal(G);
  const top = n[1] > 0.5;
  // Where the reel takes your feet: onto a ledge it bit from above, else just under the hook.
  const tx = h[0] + n[0] * 0.5;
  const ty = top ? h[1] + 0.05 : h[1] + Math.min(0, n[1]) * 2 - 1.1;
  const tz = h[2] + n[2] * 0.5;
  const dx = tx - p.x;
  const dy = ty - p.y;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dy, dz);
  // Close enough (or stuck on the way): up and over if there is somewhere to stand.
  if (d < 1.1 || G.t > 4 || G.stall > 0.22) {
    if (G.land) startVault(g, G, p);
    else {
      p.vy = Math.max(p.vy * 0.3, 6);
      p.vx *= 0.35;
      p.vz *= 0.35;
      g.grapple = null;
    }
    return true;
  }
  // The reel bites harder the longer it runs; the last metres ease in so you do not slam.
  let speed = Math.min(26, 11 + G.t * 36);
  if (d < 3) speed *= Math.max(0.55, d / 3);
  p.vx = (dx / d) * speed;
  p.vy = (dy / d) * speed + 0.35;
  p.vz = (dz / d) * speed;
  p.standingOn = null;
  p.onGround = false;
  p.climbing = false;
  p.ladder = null;
  const grids = g.grids();
  moveActor(p, dt, grids, [grids[0]!], () => null);
  if (d < G.best - 0.03) {
    G.best = d;
    G.stall = 0;
  } else {
    G.stall += dt;
  }
  return true;
}

/** The climb over the top: a quick arc in the hook's frame (it rides along with a walking body). */
function startVault(g: Game, G: Grapple, p: Actor): void {
  const L = G.land!;
  const frame = (x: number, y: number, z: number): Vec3 => (G.body ? G.body.toLocal(x, y, z) : [x, y, z]);
  const A = frame(p.x, p.y, p.z);
  const path: Vec3[] = [A];
  if (G.body === g.fortress && A[1] < L[1] - 0.6) {
    // From below: out past the hull's edge beside the landing spot, up its side, over the rail.
    const F = g.fortress;
    const mx = (F.minX + F.maxX + 1) / 2;
    const mz = (F.minZ + F.maxZ + 1) / 2;
    let ox = L[0] - mx;
    let oz = L[2] - mz;
    const l = Math.hypot(ox, oz) || 1;
    ox = L[0] + (ox / l) * 2;
    oz = L[2] + (oz / l) * 2;
    path.push([ox, Math.min(A[1], L[1] - 2.5), oz], [ox, L[1] + 1.3, oz]);
  } else if (A[1] < L[1] - 0.2) {
    // Up the face in front of the hook, then onto the top.
    const n = G.n;
    path.push([G.at[0] + n[0] * 0.6, L[1] + 0.6, G.at[2] + n[2] * 0.6]);
  }
  path.push(L);
  let len = 0;
  for (let i = 1; i < path.length; i += 1) len += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1], path[i]![2] - path[i - 1]![2]);
  G.stage = 'vault';
  G.t = 0;
  G.path = path;
  G.dur = clamp(len / 14 + 0.12, 0.3, 0.95);
  p.vx = p.vy = p.vz = 0;
  g.sfx('leap', 'wood', 0.5);
}

function vaultStep(g: Game, G: Grapple, p: Actor): void {
  const u = Math.min(1, G.t / G.dur);
  const e = u * u * (3 - 2 * u);
  // Walk the polyline by length.
  const path = G.path;
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const l = Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1], path[i]![2] - path[i - 1]![2]);
    lens.push(l);
    total += l;
  }
  let at = e * total;
  let q: Vec3 = path[path.length - 1]!;
  for (let i = 0; i < lens.length; i += 1) {
    if (at <= lens[i]! || i === lens.length - 1) {
      const k = lens[i]! > 0 ? Math.min(1, at / lens[i]!) : 1;
      const a = path[i]!;
      const b = path[i + 1]!;
      q = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      break;
    }
    at -= lens[i]!;
  }
  const [wx, wy, wz] = G.body ? G.body.toWorld(q[0], q[1], q[2]) : q;
  p.x = wx;
  p.y = wy;
  p.z = wz;
  p.vx = p.vy = p.vz = 0;
  p.standingOn = null;
  p.onGround = false;
  if (u < 1) return;
  // Over the top: feet down on the deck (or the ledge, or the giant's back).
  p.onGround = true;
  p.standingOn = G.body;
  const box = { x: p.x, y: p.y, z: p.z, hw: p.hw, h: p.h };
  const grids = g.grids();
  for (let k = 0; k < 3 && grids.some((gr) => overlaps(box, gr, 0.02)); k += 1) box.y = p.y += 1;
  g.sfx('land', 'stone', 0.75);
  g.particles.dust(p.x, p.y + 0.1, p.z, 6, 1.2, false);
  g.buzz(22);
  if (G.body === g.fortress) g.flags.grappled += 1;
  g.grapple = null;
}

// ------------------------------------------------------------------ Millford's crossbow

const BOLT_SPEED = 56;
const BOLT_GRAVITY = 6;

/** Looses a bolt where you aim (a monster near the line takes it). No ammo; a breath to reload. */
export function fireCrossbow(g: Game, ray: Ray): boolean {
  if (g.bowCooldown > 0 || g.player.dead) return false;
  const target = aimPoint(g, ray);
  // (From the bow: just under your eyes, or held out in your hand when the view shows you.)
  const shown = bodyShown(g);
  const e = shown ? heldOut(g) : g.eye();
  const r = rightOf(g.yaw);
  const k = shown ? 0 : 1;
  const sx = e[0] + ray.dx * 0.6 + r[0] * 0.18 * k;
  const sy = e[1] + ray.dy * 0.6 - 0.15 * k;
  const sz = e[2] + ray.dz * 0.6 + r[2] * 0.18 * k;
  let tx = target.x;
  let ty = target.y + (target.mob ? target.mob.h * 0.45 : 0);
  let tz = target.z;
  const d = dist3(sx, sy, sz, tx, ty, tz);
  const t = Math.max(0.04, d / BOLT_SPEED);
  if (target.mob) {
    tx += target.mob.vx * t;
    ty += target.mob.fly ? target.mob.vy * t : 0;
    tz += target.mob.vz * t;
  }
  g.projectiles.push({
    kind: 'bolt', x: sx, y: sy, z: sz,
    vx: (tx - sx) / t, vy: (ty - sy + 0.5 * BOLT_GRAVITY * t * t) / t, vz: (tz - sz) / t,
    age: 0, life: t + 0.9, spin: 0, fromCrew: false,
  });
  g.bowCooldown = 0.55;
  g.mining.swing = 0.12;
  g.punch(0.012);
  g.sfx('crossbow', 'wood', 0.9);
  g.buzz(10);
  g.report('primary_input');
  return true;
}

// ------------------------------------------------------------------ Stonewater's war horn

/**
 * The horn's blast: everything on the deck, on the legs or close around you is hurled off and
 * stunned, and the crew fires twice as fast for a while. Once a night.
 */
export function blowHorn(g: Game): boolean {
  if (!g.relics.has('horn') || !g.isPlaying() || g.player.dead) return false;
  if (g.hornCharges <= 0) {
    g.deny('The horn is spent: it can be blown again next night');
    return false;
  }
  g.hornCharges -= 1;
  const p = g.player;
  const c = g.fortressCentre();
  g.sfx('warhorn', 'metal', 1);
  g.renderer.shake(0.5);
  g.freeze(0.07);
  g.punch(0.03);
  g.buzz(160);
  g.particles.ring(p.x, p.y + 1.2, p.z, 7, 1, 0.85, 0.45);
  g.particles.ring(c[0], c[1] + 1, c[2], 12, 1, 0.7, 0.3);
  g.light({ x: p.x, y: p.y + 2, z: p.z, r: 18, color: [1, 0.78, 0.4], life: 0.7, max: 0.7 });
  let blasted = 0;
  for (const m of g.mobs) {
    if (m.dead) continue;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    const aboard = m.standingOn === g.fortress || m.climb !== null;
    if (!aboard && d > 16 && !(m.fly && d < 28)) continue;
    // Away from the fortress: off its deck and down its legs.
    const ax = m.x - c[0];
    const az = m.z - c[2];
    const l = Math.hypot(ax, az) || 1;
    damageMob(g, m, 3, (ax / l) * 12, (az / l) * 12, 'player');
    if (m.dead) {
      blasted += 1;
      continue;
    }
    m.vy = 7.5;
    m.standingOn = null;
    m.climb = null;
    m.stun = 2.4;
    if (m.fly) {
      m.fly.mode = 'climb';
      m.fly.t = 3;
    }
    blasted += 1;
  }
  g.rally = 20;
  g.ui.banner('RALLY!', `The crew fires twice as fast${blasted ? ` · ${blasted} monster${blasted > 1 ? 's' : ''} hurled back` : ''}`, 'gold');
  g.report('primary_input');
  return true;
}

// ------------------------------------------------------------------ Ashvale's storm rod

/** With the rod on the mast a storm's lightning picks a monster near the fortress (or the rod). */
export function rodTarget(g: Game): { x: number; y: number; z: number; mob: Actor | null } {
  const c = g.fortressCentre();
  const foes = g.mobs.filter((m) => !m.dead && Math.hypot(m.x - c[0], m.z - c[2]) < 36);
  if (foes.length > 0) {
    // The closest ones to the deck first (climbers, boarders), with some luck in it.
    foes.sort((a, b) => Math.hypot(a.x - c[0], a.z - c[2]) - Math.hypot(b.x - c[0], b.z - c[2]));
    const m = foes[Math.floor(Math.random() * Math.min(4, foes.length))]!;
    return { x: m.x, y: m.y, z: m.z, mob: m };
  }
  const F = g.fortress;
  let best: number | null = null;
  for (const k of F.cells.keys()) if (best === null || ky(k) > ky(best)) best = k;
  if (best === null) return { x: c[0], y: c[1] + 8, z: c[2], mob: null };
  const q = F.cellCenter(kx(best), ky(best), kz(best));
  return { x: q.x, y: q.y + 0.5, z: q.z, mob: null };
}

// ------------------------------------------------------------------ Redcliff's Heartbreakers

/** Throws a Heartbreaker along the arc: a huge blast when it lands. */
export function throwBreaker(g: Game, ray: Ray): boolean {
  if (g.throwCooldown > 0 || g.player.dead) return false;
  if (!g.useItem(I.BREAKER, 1)) return false;
  const s = planThrow(g, ray);
  g.projectiles.push({ kind: 'breaker', x: s.sx, y: s.sy, z: s.sz, vx: s.vx, vy: s.vy, vz: s.vz, age: 0, life: s.t + 1.4, spin: 0, fromCrew: false });
  g.throwCooldown = 0.8;
  g.mining.swing = 0.3;
  g.sfx('leap', 'wood', 0.6);
  g.sfx('hiss', 'stone', 0.5);
  g.report('primary_input');
  return true;
}

// ------------------------------------------------------------------ Heartstones

/** Engine Core health for the Heartstones socketed into it (Lumen's work doubles it). */
export function coreMaxHp(g: Game): number {
  return (80 + g.heartstones * 20) * (hasOfficer(g, 'lumen') ? 2 : 1);
}

/** Sets the Core's maximum health from the Heartstones it carries (after loads and rebuilds). */
export function applyHeartstones(g: Game): void {
  const key = g.coreKey();
  const c = key === null ? null : g.fortress.cells.get(key);
  if (!c) return;
  c.maxHp = coreMaxHp(g);
  c.hp = Math.min(c.hp, c.maxHp);
}

export function socketHeartstone(g: Game): void {
  const key = g.coreKey();
  const c = key === null ? null : g.fortress.cells.get(key);
  if (!c || key === null || !g.useItem(I.HEARTSTONE, 1)) return;
  g.heartstones += 1;
  c.maxHp = coreMaxHp(g);
  c.hp = c.maxHp;
  const q = g.fortress.cellCenter(kx(key), ky(key), kz(key));
  g.particles.sparks(q.x, q.y, q.z, ['#ff4a5a', '#ffd0d4', '#ffd060'], 30, 6, 0.12, 0.8);
  g.particles.ring(q.x, q.y, q.z, 3, 1, 0.3, 0.35);
  g.light({ x: q.x, y: q.y + 1, z: q.z, r: 12, color: [1.3, 0.25, 0.3], life: 1.2, max: 1.2 });
  g.renderer.shake(0.35);
  g.buzz(60);
  g.sfx('relic', 'metal', 0.9);
  g.ui.banner('THE CORE BEATS STRONGER', `Heartstone socketed: Engine Core health ${c.maxHp}`, 'gold');
  g.xp(15);
  g.addPage('heartstone');
  feat(g, 'heartstone');
  g.report('primary_input');
  g.save();
}

// ------------------------------------------------------------------ granting

/** What a relic puts in your hands when it is given to you. */
export function relicItems(id: RelicId): Array<[number, number]> {
  const def = RELICS[id];
  return def.item === null ? [] : [[def.item, def.count]];
}

/** True when a journal page id exists. */
export function isPage(id: string): boolean {
  return page(id) !== undefined;
}

/** Lerps the rope's hand end toward the hook while the hook flies (for drawing). */
export function hookFlight(g: Game): number {
  const G = g.grapple;
  if (!G) return 0;
  return G.stage === 'pull' ? 1 : clamp(G.t / G.fly, 0, 1);
}
