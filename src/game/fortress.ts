import { crestSafe } from './mainquest';
import { B, I, blockDef, ITEM_BASE } from './blocks';
import { BlockBody, colKey, key3, kx, ky, kz, N6 } from './body';
import { journalFrom, spawnDrop } from './build';
import type { Game } from './game';
import type { Actor } from './entities';
import { approach, materialOf } from './game';
import type { PlayerCtx } from './player-ctx';
import { damageGiantCell, MAGAZINE } from './combat';
import type { Vec3 } from './math3d';
import { damageMob, squashMob } from './mobs';
import { startle } from './animals';
import { feat } from './feats';
import { clamp } from './rng';
import { trusts } from './quests';
import { DIRECTIONAL_IDS, deckModule, isHoistable, rotateDir, type StructKind, type Structure } from './structures';
import type { Site, Zone } from './terrain';
import { holdPlan, nextHoldSlot, type HoldEntry, type HoldPlan } from './hold';
import { updateCraneDrop, updateHoist } from './crane';
import { DIR_DOWN, DIRS, WX, WY, WZ } from './world';
import { hasTrophy, sealBars } from './seals';

/** Bolting limits around the deck (local cells). */
export const F_MIN: Vec3 = [-26, -4, -22];
export const F_MAX: Vec3 = [46, 32, 34];
export const F_MAX_BLOCKS = 4200;

export interface CargoInfo {
  kind: StructKind;
  /** Windmill hub (fortress-local key) whose sails spin, the way it faces, and how long its sails are. */
  hub: number | null;
  dir: number;
  sail?: number;
  /** Upgrades bought for it, and buildings of its kind built into it (1 = as hoisted). */
  level?: number;
  /** Its place in the hold (-1: stowed, past the hold's last slot; none: a game from before the hold). */
  slot?: number;
  /** The land it came from (the hold builds it in that land's materials). */
  zone?: Zone | null;
  /** Games from before the hold: packed down into a deck module (true), or bolted on at full size. */
  mini?: boolean;
}

/** How much a kind of hoisted building contributes: one per building plus its upgrades. */
export function cargoPower(g: Game, kind: StructKind): number {
  let n = 0;
  for (const c of g.cargo) if (c.kind === kind) n += c.level ?? 1;
  return n;
}

// ------------------------------------------------------------------ starter

/** The walking fortress as it starts: a plank deck on a stone hull, a crew cabin, a cannon. */
export function buildStarterFortress(F: BlockBody): void {
  const cells: Array<[number, number, number, number, number]> = [];
  const put = (x: number, y: number, z: number, id: number, dir = 0): void => {
    cells.push([x, y, z, id, dir]);
  };
  const X = 14;
  const Z = 10;
  // Hull: a smooth-stone underside with gearboxes over each hip, ringed by a stone skirt
  // with portholes, iron corners and vines.
  for (let z = 0; z <= Z; z += 1) {
    for (let x = 0; x <= X; x += 1) {
      const hip = (x === 1 || x === X - 1) && (z === 1 || z === Z - 1);
      put(x, -1, z, hip ? B.GEARBOX : (x + z) % 5 === 0 ? B.STONE_BRICKS : B.SMOOTH_STONE);
      const ring = x === 0 || x === X || z === 0 || z === Z;
      if (!ring) continue;
      const corner = (x === 0 || x === X) && (z === 0 || z === Z);
      const port = !corner && ((z === 0 || z === Z) ? x % 4 === 2 : z % 4 === 2);
      put(x, -2, z, corner ? B.IRON_BLOCK : port ? B.GLASS : (x * 7 + z * 3) % 5 === 0 ? B.MOSSY_STONE_BRICKS : (x + z) % 3 === 0 ? B.COBBLE : B.STONE_BRICKS);
    }
  }
  for (const [x, z, dz, dir] of [[3, -1, 0, 2], [9, -1, 0, 2], [5, Z + 1, 0, 3], [11, Z + 1, 0, 3]] as const) {
    for (let y = -2; y >= -4; y -= 1) put(x, y, z + dz, B.VINE, dir);
  }
  // Deck: oak planks with a cobblestone rim.
  for (let z = 0; z <= Z; z += 1) {
    for (let x = 0; x <= X; x += 1) {
      const rim = x === 0 || x === X || z === 0 || z === Z;
      put(x, 0, z, rim ? B.COBBLE : B.PLANKS);
    }
  }
  // Low railings so the valley stays in view; stone posts carrying lanterns.
  const posts = new Set(['0,0', '7,0', '14,0', '0,10', '7,10', '14,10', '14,5']);
  for (let x = 0; x <= X; x += 1) {
    for (const z of [0, Z]) {
      const post = posts.has(`${x},${z}`);
      put(x, 1, z, post ? B.STONE_BRICKS : B.FENCE);
      if (post) put(x, 2, z, B.LANTERN, 0);
    }
  }
  for (let z = 1; z < Z; z += 1) {
    // A three-wide gap in the stern rail where the boarding ladder comes up.
    if (z < 4 || z > 6) put(0, 1, z, B.FENCE);
    if (z === 5) {
      put(X, 1, z, B.STONE_BRICKS);
      put(X, 2, z, B.LANTERN, 0);
    } else put(X, 1, z, B.FENCE);
  }
  // Workshop row along the port rail: table, furnaces, chests, a lamp-lit core.
  put(1, 1, 1, B.CRAFTING_TABLE, 3);
  put(2, 1, 1, B.FURNACE, 2);
  put(3, 1, 1, B.FURNACE, 2);
  put(4, 1, 1, B.CHEST, 2);
  put(5, 1, 1, B.BARREL);
  put(5, 2, 1, B.BARREL);
  put(6, 1, 1, B.HAY);
  // Engine core with a redstone lamp; red wire across the planks to the bow cannon.
  put(8, 1, 2, B.CORE);
  put(8, 1, 1, B.IRON_BLOCK);
  put(8, 2, 1, B.REDSTONE_LAMP);
  for (const [x, z] of [[9, 2], [10, 2], [11, 2], [11, 3], [11, 4], [11, 5]] as const) put(x, 1, z, B.WIRE);
  put(12, 1, 5, B.CANNON);
  // Helm at the stern, facing forward.
  put(2, 1, 5, B.HELM, 0);
  // The tiny wooden house it all started from: a crew cabin on the starboard side.
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 8; x <= 12; x += 1) {
      for (let z = 7; z <= 9; z += 1) {
        const edge = x === 8 || x === 12 || z === 7 || z === 9;
        if (!edge) continue;
        const corner = (x === 8 || x === 12) && (z === 7 || z === 9);
        if (z === 7 && x === 10 && y <= 2) continue;
        const window = y === 2 && ((z === 9 && (x === 9 || x === 11)) || (x === 12 && z === 8) || (z === 7 && x === 9));
        put(x, y, z, corner ? B.SPRUCE_LOG : window ? B.GLASS : B.SPRUCE_PLANKS);
      }
    }
  }
  for (let x = 7; x <= 13; x += 1) {
    put(x, 4, 6, B.OAK_STAIRS, 2);
    put(x, 4, 10, B.OAK_STAIRS, 3);
    put(x, 5, 7, B.OAK_STAIRS, 2);
    put(x, 5, 9, B.OAK_STAIRS, 3);
    put(x, 6, 8, B.PLANKS);
  }
  for (const x of [8, 12]) {
    put(x, 4, 7, B.SPRUCE_PLANKS);
    put(x, 4, 8, B.SPRUCE_PLANKS);
    put(x, 4, 9, B.SPRUCE_PLANKS);
    put(x, 5, 8, B.SPRUCE_PLANKS);
  }
  put(9, 1, 8, B.BARREL);
  put(11, 1, 8, B.CHEST, 3);
  put(10, 3, 8, B.LANTERN, 1);
  put(10, 3, 6, B.LANTERN, 1);
  put(12, 3, 6, B.LANTERN, 1);
  // Wheat planter along the starboard rail at the stern.
  for (let x = 2; x <= 6; x += 1) {
    put(x, 1, 9, B.FARMLAND);
    put(x, 2, 9, B.WHEAT);
  }
  // Crane mast at the starboard bow.
  for (let y = 1; y <= 6; y += 1) put(13, y, 9, B.SPRUCE_LOG);
  // Boarding ladder hanging off the stern to the ground.
  for (let y = 0; y >= -13; y -= 1) put(-1, y, 5, B.LADDER, 0);
  // Lanterns hanging under the hull.
  for (const [x, z] of [[0, 0], [X, 0], [0, Z], [X, Z], [7, 0], [7, Z]] as const) put(x, -3, z, B.LANTERN, 1);
  F.setMany(cells);
  clearLadderLandings(F);
}

/**
 * Railings where a ladder comes up onto the deck make way, so a climber can step off the top
 * rung (older fortresses had a gap only one block wide).
 */
export function clearLadderLandings(F: BlockBody): void {
  const remove: number[] = [];
  for (const [k, c] of F.cells) {
    if (c.id !== B.LADDER) continue;
    const x = kx(k);
    const y = ky(k);
    const z = kz(k);
    if (F.blockAt(x, y + 1, z) === B.LADDER) continue;
    const d = DIRS[c.dir];
    if (!d || d[1] !== 0) continue;
    const sx = x + d[0];
    const sz = z + d[2];
    for (let lat = -1; lat <= 1; lat += 1) {
      const fx = d[0] !== 0 ? sx : sx + lat;
      const fz = d[0] !== 0 ? sz + lat : sz;
      for (const fy of [y + 1, y + 2]) if (F.blockAt(fx, fy, fz) === B.FENCE) remove.push(key3(fx, fy, fz));
    }
  }
  if (remove.length) F.removeMany(remove);
}

/**
 * The crew bolts a bought turret onto the deck: a free deck cell on the rim (clear field of
 * fire), away from other turrets, the helm, the boarding ladder and the Core. It comes with its
 * own power. Returns the cell, or null if there is no room.
 */
export function installTurret(g: Game, id: number): Vec3 | null {
  const F = g.fortress;
  const helm = g.helmSpot();
  const core = g.coreKey();
  const turrets = [...F.cannons.keys()].map((k) => [kx(k), kz(k)] as const);
  const landings: Array<[number, number]> = [];
  for (const [k, c] of F.cells) {
    if (c.id !== B.LADDER || F.blockAt(kx(k), ky(k) + 1, kz(k)) === B.LADDER) continue;
    const d = DIRS[c.dir];
    if (d) landings.push([kx(k) + d[0], kz(k) + d[2]]);
  }
  const [mx, mz] = [(F.minX + F.maxX + 1) / 2, (F.minZ + F.maxZ + 1) / 2];
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (const k of F.cells.keys()) {
    if (ky(k) !== 0) continue;
    const x = kx(k);
    const z = kz(k);
    if (!F.solidAt(x, 0, z) || F.hasBlock(x, 1, z) || F.hasBlock(x, 2, z)) continue;
    if (helm && Math.abs(x + 0.5 - helm[0]) < 1.6 && Math.abs(z + 0.5 - helm[2]) < 1.6) continue;
    if (core !== null && Math.abs(x - kx(core)) <= 1 && Math.abs(z - kz(core)) <= 1) continue;
    if (landings.some(([lx, lz]) => Math.abs(lx - x) <= 2 && Math.abs(lz - z) <= 2)) continue;
    let spacing = 99;
    for (const [tx, tz] of turrets) spacing = Math.min(spacing, Math.hypot(tx - x, tz - z));
    if (spacing < 3) continue;
    // On the rim: next to the deck's edge or its railing.
    const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !F.hasBlock(x + dx!, 0, z + dz!) || F.blockAt(x + dx!, 1, z + dz!) === B.FENCE);
    const score = (rim ? 6 : 0) + Math.min(spacing, 9) * 0.5 + Math.hypot(x + 0.5 - mx, z + 0.5 - mz) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = [x, z];
    }
  }
  if (!best) return null;
  const [x, z] = best;
  F.setBlock(x, 1, z, id);
  F.selfPowered.add(key3(x, 1, z));
  F.changed();
  const q = F.cellCenter(x, 1, z);
  g.particles.sparks(q.x, q.y, q.z, ['#ffe070', '#ffffff'], 16, 4, 0.1, 0.5);
  g.particles.smoke(q.x, q.y, q.z, 6, 0.8);
  return [x, 1, z];
}

// ------------------------------------------------------------------ walking

/**
 * Route from the fortress to a destination: along the valley trail, then onto the site. Expeditions
 * lie off the trail behind the valley wall: into one (and out of it) the way is down its pass.
 */
export function planRoute(g: Game, toX: number, toZ: number): Array<[number, number]> {
  const T = g.world.terrain;
  const c = g.fortressCentre();
  const from = T.expeditionAt(c[0], c[2]);
  const to = T.expeditionAt(toX, toZ);
  if (from === to) return trailRoute(g, c[0], c[2], toX, toZ);
  const pts: Array<[number, number]> = [[c[0], c[2]]];
  let [x, z] = [c[0], c[2]];
  if (from) {
    // Back out to the mouth of the pass.
    [x, z] = [from.x, T.centerZ(from.x)];
    if (Math.abs(c[0] - x) > 8) pts.push([x, c[2]]);
    pts.push([x, (c[2] + z) / 2], [x, z]);
  }
  // (Already abreast of the pass: straight up it.)
  const near = to !== null && Math.abs(x - to.x) < 36;
  const [mx, mz] = to ? [to.x, near ? z + (to.z - z) * 0.3 : T.centerZ(to.x)] : [toX, toZ];
  for (const q of trailRoute(g, x, z, mx, mz).slice(1)) pts.push(q);
  if (to) pts.push([to.x, (mz + toZ) / 2], [toX, toZ]);
  return densify(pts);
}

/** Long straight legs cut into short ones (the crew replans when its next mark lies far off). */
function densify(pts: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [pts[0]!];
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 24);
    for (let k = 1; k <= n; k += 1) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

function trailRoute(g: Game, fromX: number, fromZ: number, toX: number, toZ: number): Array<[number, number]> {
  const T = g.world.terrain;
  const c = [fromX, 0, fromZ] as const;
  const pts: Array<[number, number]> = [[c[0], c[2]]];
  const dir = toX >= c[0] ? 1 : -1;
  const span = Math.abs(toX - c[0]);
  // Short hops (and mostly sideways ones) go straight there.
  if (span > 60 && span > Math.abs(toZ - c[2])) {
    for (let d = 10; d < span - 30; d += 10) {
      const x = c[0] + d * dir;
      // Ease from the start onto the trail and from the trail onto the destination.
      const a = clamp(d / 50, 0, 1);
      const b = clamp((span - d) / 60, 0, 1);
      const trail = T.centerZ(x);
      const z = c[2] + (trail - c[2]) * a;
      pts.push([x, toZ + (z - toZ) * b]);
    }
  }
  pts.push([toX, toZ]);
  return pts;
}

export function routeLength(route: Array<[number, number]>): number {
  let l = 0;
  for (let i = 1; i < route.length; i += 1) l += Math.hypot(route[i]![0] - route[i - 1]![0], route[i]![1] - route[i - 1]![1]);
  return l;
}

export function wrapAngle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Where the autopilot walks: a point, the site it belongs to, and the path there. */
export interface Autopilot {
  x: number;
  z: number;
  site: Site | null;
  route: Array<[number, number]>;
  index: number;
  /** Seconds it has been held up by the terrain (it then ploughs straight through). */
  stuck: number;
}

const LOOKAHEAD = 12;

export function makeAutopilot(g: Game, x: number, z: number, site: Site | null): Autopilot {
  return { x, z, site, route: planRoute(g, x, z), index: 1, stuck: 0 };
}

/** Pure pursuit along the route: throttle and turn (-1..1), or null once it has arrived. */
function autopilotDrive(g: Game, a: Autopilot): { throttle: number; turn: number } | null {
  const F = g.fortress;
  const [cx, cz] = F.centre();
  const route = a.route;
  while (a.index < route.length - 1 && Math.hypot(route[a.index]![0] - cx, route[a.index]![1] - cz) < LOOKAHEAD) a.index += 1;
  const last = route[route.length - 1]!;
  const left = Math.hypot(last[0] - cx, last[1] - cz);
  if (left < 1.5) return null;
  // Drifted far off the path (hand steering, a detour): plan again from here.
  const tgt = route[a.index]!;
  if (Math.hypot(tgt[0] - cx, tgt[1] - cz) > 60 && a.index < route.length - 1) {
    a.route = planRoute(g, a.x, a.z);
    a.index = 1;
  }
  const t = a.route[a.index]!;
  const err = wrapAngle(Math.atan2(t[1] - cz, t[0] - cx) - F.yaw);
  // Turn on the spot for sharp corners, slow down to stop on the mark.
  const throttle = Math.min(clamp(1 - Math.abs(err) / 1.0, 0, 1), clamp(left / 9, 0.15, 1));
  return { throttle, turn: clamp(err * 2.4, -1, 1) };
}

/** Hand steering from the helm: the stick (or WASD) of whoever holds it is throttle and rudder. */
function helmDrive(g: Game): { throttle: number; turn: number } | null {
  const driver = g.helmsman();
  if (!driver) return null;
  return g.withCtx(driver, () => steer(g));
}

function steer(g: Game): { throttle: number; turn: number } | null {
  const throttle = clamp(g.move.z + (g.keys.forward ? 1 : 0) - (g.keys.back ? 1 : 0), -1, 1);
  const turn = clamp(g.move.x + (g.keys.right ? 1 : 0) - (g.keys.left ? 1 : 0), -1, 1);
  if (Math.abs(throttle) < 0.08 && Math.abs(turn) < 0.08) return null;
  return { throttle, turn };
}

interface HullSamples {
  body: BlockBody;
  version: number;
  /** Local column centres and the lowest solid y of each. */
  pts: Array<[number, number, number]>;
}

let samplesCache: HullSamples | null = null;

/** The hull's rim columns and a sparse grid inside: where the terrain could touch it. */
function hullSamples(F: BlockBody): HullSamples {
  if (samplesCache && samplesCache.body === F && samplesCache.version === F.version) return samplesCache;
  const cols = F.columns();
  const pts: Array<[number, number, number]> = [];
  for (const [k, [y0]] of cols) {
    const x = Math.floor(k / 256) - 64;
    const z = (k % 256) - 64;
    const rim = !cols.has(colKey(x + 1, z)) || !cols.has(colKey(x - 1, z)) || !cols.has(colKey(x, z + 1)) || !cols.has(colKey(x, z - 1));
    if (rim || (x % 3 === 0 && z % 3 === 0)) pts.push([x + 0.5, z + 0.5, y0]);
  }
  samplesCache = { body: F, version: F.version, pts };
  return samplesCache;
}

/** Height the hull settles at for its current pose (its legs stand on the natural ground). */
function standY(g: Game): number {
  const F = g.fortress;
  const W = g.walker;
  return W.groundUnder(g.world, F) + W.rideHeight() - (F.floorY - 0.4);
}

/** How far the hull's underside keeps clear of the ground when it has to ride up over it. */
const CLEARANCE = 0.8;
/** The deepest the legs crouch under the hull (a share of their standing height). */
const CROUCH = 0.45;

/**
 * The hull height (F.y) at which its underside would just touch the highest natural ground beneath
 * it. The standing pillars of the new lands (hoodoos, basalt columns, ice spikes) do not count: the
 * hull smashes straight through those.
 */
function contactY(g: Game): number {
  const F = g.fortress;
  const w = g.world;
  let top = -Infinity;
  // (F.toWorld written out: this runs over the whole hull every frame of a march.)
  const pts = hullSamples(F).pts;
  for (let i = 0; i < pts.length; i += 1) {
    const q = pts[i]!;
    const dx = q[0] - F.px;
    const dz = q[1] - F.pz;
    const wx = F.x + F.px + F.c * dx - F.s * dz;
    const wz = F.z + F.pz + F.s * dx + F.c * dz;
    const h = w.naturalGround(wx, wz) - q[2];
    if (h <= top) continue;
    if (h > top + 1 && w.terrain.spikeAt(wx, wz)) continue;
    top = h;
  }
  return top;
}

interface Footing {
  /** Hull height the pose wants: its stance, raised to clear the ground and to keep every leg some bend. */
  need: number;
  /** Where its underside would touch the ground (see contactY). */
  contact: number;
  /** The highest the legs can hold it, their rams run out (one leg in four may hang over a pit). */
  reach: number;
}

let footCache: { body: BlockBody; version: number; x: number; z: number; yaw: number; f: Footing } | null = null;

/** What the ground under the hull asks of the legs in its current pose (kept while it stands still). */
export function footing(g: Game): Footing {
  const F = g.fortress;
  const W = g.walker;
  const c = footCache;
  if (c && c.body === F && c.version === F.version && c.x === F.x && c.z === F.z && c.yaw === F.yaw) return c.f;
  const contact = contactY(g);
  let need = Math.max(standY(g), contact + CLEARANCE);
  const reaches: number[] = [];
  for (const l of W.legs) {
    const [hx, , hz] = F.toWorld(l.hx, 0, l.hz);
    const ground = W.groundNear(g.world, hx, hz);
    need = Math.max(need, ground + W.rideHeight() * CROUCH - l.hy);
    reaches.push(ground + W.maxDrop() - l.hy);
  }
  reaches.sort((a, b) => a - b);
  const reach = reaches[Math.min(reaches.length - 1, Math.ceil(reaches.length / 4))] ?? Infinity;
  const f = { need, contact, reach };
  footCache = { body: F, version: F.version, x: F.x, z: F.z, yaw: F.yaw, f };
  return f;
}

/** Height the hull rides at for its current pose (exported for placing it on loading). */
export function restHeight(g: Game): number {
  const f = footing(g);
  return Math.min(f.need, Math.max(f.reach, standY(g)));
}

/**
 * Why the fortress cannot stand where it now is: a short tag for the helm board, 'climb' when it
 * only has to rise first (the legs run their rams out, then it steps on), or null. Ploughing (the
 * crew's last resort when stuck) it goes on through whatever is in the way. `strain`: how far the
 * pose it comes from was beyond its legs (a step that leaves it no worse off is always allowed).
 */
function poseBlocked(g: Game, plough: boolean, strain: number): BlockReason | 'climb' | null {
  const F = g.fortress;
  const [cx, cz] = F.centre();
  const r = g.fortressRadius();
  if (cx < r + 8 || cz < r + 8 || cx > WX - r - 8 || cz > WZ - r - 8) return 'edge';
  const cit = g.world.terrain.citadel;
  if (Math.hypot(cit.x - cx, cit.z - cz) < 21 + r) return 'walls';
  if (sealBars(g, cx, r)) return 'seal';
  if (plough) return null;
  const f = footing(g);
  // A cliff higher than the legs can span, or up where the air thins.
  if (overreach(g, f) > strain + 0.05) return 'steep';
  if (f.contact > g.fortressBaseY - 0.05) {
    holdClimb(g, f.need);
    return 'climb';
  }
  return null;
}

/**
 * How far a pose asks more of the legs than they can give (0 when they manage); the hull also stays
 * a little under the sky's limit (the high peaks are out of reach).
 */
function overreach(g: Game, f: Footing): number {
  return Math.max(0, f.need - f.reach, f.need + g.fortress.floorY - (WY - 10));
}

/** The hull rises to a height before it steps on (kept a moment while the way ahead asks for it). */
function holdClimb(g: Game, y: number): void {
  g.climbY = g.climbTime > 0 ? Math.max(g.climbY, y) : y;
  g.climbTime = 0.5;
}

/** The ride height ahead of the hull along its way (it starts up a slope before it reaches it). */
function aheadHeight(g: Game, lead: number): number {
  const F = g.fortress;
  const ox = F.x;
  const oz = F.z;
  const oyaw = F.yaw;
  F.setYaw(oyaw + g.turnRate * lead);
  const [cx, cz] = F.centre();
  F.setCentre(cx + F.c * g.speed * lead, cz + F.s * g.speed * lead);
  const f = footing(g);
  F.x = ox;
  F.z = oz;
  F.setYaw(oyaw);
  // (A cliff ahead it cannot take: no use rising for it.)
  return f.need > f.reach ? -Infinity : f.need;
}

/** The legs running their rams out to lift the hull: a hydraulic hiss and steam from the knees. */
function climbFx(g: Game, rise: number, dt: number): void {
  if (rise < 0.6) return;
  const F = g.fortress;
  const W = g.walker;
  if (rise > 1.2 && g.time - g.climbSfx > 1.6) {
    g.climbSfx = g.time;
    const [cx, cz] = F.centre();
    g.sfxAt('steam', cx, F.y, cz, 0.55, 1.35);
  }
  if (Math.random() < dt * 9) {
    const l = W.legs[Math.floor(Math.random() * W.legs.length)];
    if (!l) return;
    const k = W.knee(F, l, W.hipWorld(F, l));
    g.particles.smoke(k[0], k[1] - 1.2, k[2], 1, 0.5);
  }
}

export type BlockReason = 'edge' | 'walls' | 'steep' | 'giant' | 'seal';

export const BLOCK_TEXT: Record<BlockReason, string> = {
  edge: 'The valley ends here: turn back',
  walls: 'The Citadel walls stop the fortress',
  seal: 'A Heart Seal bars the way: bring down its guardian to break it',
  steep: 'Too steep for the hull: turn, or back up',
  giant: 'A giant blocks the way: FULL STEAM rams it, or fire!',
};

/** Top walking speed and turn rate of the fortress (thrusters, sails and mass). */
export function turnSpeed(g: Game): number {
  const mass = g.fortress.cells.size - 0.8 * g.holdSize();
  return (0.36 + Math.min(8, g.poweredThrusters()) * 0.02) / (1 + Math.max(0, mass - 500) / 1800);
}

/** How long full steam lasts from a full boiler, and how fast it refills. */
const STEAM_BURN = 0.22;
const STEAM_FILL = 0.075;

/**
 * Full steam rams a giant blocking the bow: a heavy blow to its front, a shove backwards, and a
 * jolt through the deck. Returns true if a giant was hit.
 */
function ram(g: Game, mx: number, mz: number): boolean {
  if (g.ramTimer > 0) return false;
  const F = g.fortress;
  const c = g.fortressCentre();
  let hit = false;
  for (const giant of g.giants) {
    if (giant.dead) continue;
    const [gx, gz] = giant.body.hullCentre();
    const ahead = (gx - c[0]) * mx + (gz - c[2]) * mz;
    const side = Math.abs((gx - c[0]) * mz - (gz - c[2]) * mx);
    if (ahead <= 0 || ahead > g.fortressRadius() + 6 || side > 10) continue;
    hit = true;
    giant.push = [mx * 9, mz * 9];
    giant.body.shake = 0.6;
    giant.attackTimer = Math.max(giant.attackTimer, 1.6);
    // The cells facing the bow take the blow.
    const cells = [...giant.body.cells.keys()].map((k) => {
      const q = giant.body.cellCenter(kx(k), ky(k), kz(k));
      return { k, d: Math.hypot(q.x - c[0], q.z - c[2]) + Math.abs(q.y - (F.y + 1)) * 0.5 };
    }).sort((a, b) => a.d - b.d);
    const horn = hasTrophy(g, 'ravager') ? 2 : 1;
    for (const { k } of cells.slice(0, 8)) damageGiantCell(g, giant, k, (14 + g.danger * 2) * horn);
  }
  if (!hit) return false;
  g.ramTimer = 1.4;
  g.speed *= 0.3;
  F.shake = Math.max(F.shake, 0.5);
  g.renderer.shake(0.9);
  // The impact: the world holds for a beat, a crash, a shock ring and a thump through the phone.
  g.freeze(0.14);
  g.punch(0.04);
  g.buzz(90);
  g.sfx('ram', 'stone', 1);
  g.sfx('giant', 'stone', 1.1);
  const [bx, , bz] = [c[0] + mx * (g.fortressRadius() + 1), 0, c[2] + mz * (g.fortressRadius() + 1)];
  g.particles.debris(bx, F.y + 1, bz, 'mossy_cobble', 20, 7);
  g.particles.dust(bx, F.y, bz, 16, 3.5, false);
  g.particles.ring(bx, F.y + 1.5, bz, 4, 1, 0.95, 0.8);
  g.ui.damage(0, bx, F.y + 4, bz, 'big', 'RAM!');
  g.flags.rammed = true;
  feat(g, 'ram');
  g.crewSay('ram');
  return true;
}

export function updateFortress(g: Game, dt: number): void {
  const F = g.fortress;
  const W = g.walker;
  F.savePose();
  W.layout(F, g.world);
  // Who steers: you at the helm, else the autopilot (the crew), else nobody.
  let input = helmDrive(g);
  const auto = g.autopilot;
  if (!input && auto) {
    input = autopilotDrive(g, auto);
    if (!input) {
      g.autopilot = null;
      g.reached(auto);
    }
  }
  const limp = W.limp();
  const throttle = input?.throttle ?? 0;
  const turn = input?.turn ?? 0;
  // Full steam: the boiler drives the legs harder for a few seconds (only from the helm).
  g.ramTimer = Math.max(0, g.ramTimer - dt);
  const driver = g.helmsman();
  const boosting = driver !== null && driver.boostHeld && throttle > 0.1 && g.steam > 0.02;
  if (boosting) {
    // Opening the valve: a whistle, a burst of steam from the deck, a shove through the hull.
    if (!g.boosting) {
      g.sfx('steam', 'metal', 0.9);
      g.withCtx(driver, () => g.buzz(30));
      const [sx, , sz] = F.toWorld((F.minX + F.maxX + 1) / 2, 0, (F.minZ + F.maxZ + 1) / 2);
      g.particles.smoke(sx, F.y + F.maxY + 1.5, sz, 10, 2.5);
      g.punch(0.015);
    }
    g.steam = Math.max(0, g.steam - STEAM_BURN * dt);
    g.steamIdle = 0;
    g.flags.boosted = true;
  } else {
    g.steamIdle += dt;
    if (g.steamIdle > 1) g.steam = Math.min(1, g.steam + STEAM_FILL * dt);
  }
  g.boosting = boosting;
  const vmax = g.fortressSpeed() * (1 - 0.45 * limp) * (boosting ? 1.8 : 1);
  const wmax = turnSpeed(g) * (boosting ? 1.2 : 1);
  const targetV = throttle >= 0 ? throttle * vmax : throttle * vmax * 0.55;
  g.speed = approach(g.speed, targetV, (Math.abs(targetV) > Math.abs(g.speed) ? (boosting ? 3.4 : 2) : 3.5) * dt);
  g.turnRate = approach(g.turnRate, turn * wmax, (Math.abs(turn * wmax) > Math.abs(g.turnRate) ? 1.3 : 2.4) * dt);
  // Giants in the way hold the fortress up (unless it rams them at full steam).
  g.blocked = false;
  const c = g.fortressCentre();
  const dir = g.speed >= 0 ? 1 : -1;
  const mx = F.c * dir;
  const mz = F.s * dir;
  for (const giant of g.giants) {
    if (giant.dead || giant.dormant) continue;
    const [gx, gz] = giant.body.hullCentre();
    const ahead = (gx - c[0]) * mx + (gz - c[2]) * mz;
    const side = Math.abs((gx - c[0]) * mz - (gz - c[2]) * mx);
    if (ahead > 0 && ahead < g.fortressRadius() + 4 && side < 10) {
      g.blocked = true;
      if (boosting && dir > 0 && ram(g, mx, mz)) continue;
      if (Math.abs(g.speed) > 0.05) g.speed = 0;
    }
  }
  F.moving = false;
  g.climbTime = Math.max(0, g.climbTime - dt);
  let climbing = false;
  if (Math.abs(g.speed) > 0.01 || Math.abs(g.turnRate) > 0.002) {
    const ox = F.x;
    const oz = F.z;
    const oyaw = F.yaw;
    const plough = Boolean(auto && g.autopilot === auto && auto.stuck > 1.2);
    const strain = overreach(g, footing(g));
    const tryPose = (turnOnly: boolean): BlockReason | 'climb' | null => {
      F.x = ox;
      F.z = oz;
      F.setYaw(oyaw + g.turnRate * dt);
      if (!turnOnly) {
        const [cx, cz] = F.centre();
        F.setCentre(cx + F.c * g.speed * dt, cz + F.s * g.speed * dt);
      }
      return poseBlocked(g, plough, strain);
    };
    const hard = (w: BlockReason | 'climb' | null): w is BlockReason => w !== null && w !== 'climb';
    let why = tryPose(false);
    // Blocked ahead: slide along the obstacle (a slight turn and a slower step), else turn on the spot.
    if (hard(why) && Math.abs(g.speed) > 0.05) {
      const keep = g.speed;
      const keepTurn = g.turnRate;
      for (const nudge of [0.5, -0.5, 1, -1]) {
        g.speed = keep * 0.45;
        g.turnRate = keepTurn + nudge;
        if (!tryPose(false)) {
          why = null;
          break;
        }
      }
      if (why) {
        g.speed = keep;
        g.turnRate = keepTurn;
      }
    }
    if (hard(why) && Math.abs(g.turnRate) > 0.002) {
      g.speed = 0;
      why = tryPose(true);
    }
    // Walking into a cliff or the valley's end: the hull bumps to a halt (felt, heard, seen).
    if (hard(why) && why !== g.blockReason && driver && Math.abs(throttle) > 0.25) {
      g.sfx('bump', 'stone', 0.9);
      g.renderer.shake(0.3);
      g.withCtx(driver, () => g.buzz(45));
      const r = g.fortressRadius();
      const d = throttle >= 0 ? 1 : -1;
      const [cx, cz] = F.centre();
      const bx = cx + F.c * d * r;
      const bz = cz + F.s * d * r;
      g.particles.dust(bx, g.world.groundAt(bx, bz) + 0.5, bz, 10, 3, false);
    }
    g.blockReason = hard(why) ? why : g.blocked ? 'giant' : null;
    if (why) {
      F.x = ox;
      F.z = oz;
      F.setYaw(oyaw);
      if (why === 'climb') {
        // Up a slope or a ledge: it holds its stride (speed and turn kept) while the legs lift the
        // hull clear, then walks on. A wait that drags on counts as being stuck for the crew.
        climbing = true;
        g.climbWait += dt;
        if (g.autopilot && g.climbWait > 3) g.autopilot.stuck += dt;
      } else {
        g.speed = 0;
        g.turnRate = 0;
        if (g.autopilot) g.autopilot.stuck += dt;
      }
    } else {
      if (g.autopilot) g.autopilot.stuck = Math.max(0, g.autopilot.stuck - dt * 0.5);
      F.moving = true;
      F.walkPhase += Math.abs(g.speed) * dt + Math.abs(g.turnRate) * g.fortressRadius() * 0.6 * dt;
      if (Math.abs(g.speed) > 0.05) g.marchDir = [mx, mz];
    }
  } else {
    g.speed = 0;
    g.turnRate = 0;
    g.blockReason = g.blocked ? 'giant' : null;
  }
  if (!climbing) g.climbWait = 0;
  if (F.moving && g.me.helm) g.flags.drove += Math.abs(g.speed) * dt;
  // Full steam: smoke and sparks pour from the deck.
  if (boosting && F.moving && Math.random() < 0.5) {
    const [sx, , sz] = F.toWorld((F.minX + F.maxX + 1) / 2 + (Math.random() - 0.5) * 4, 0, (F.minZ + F.maxZ + 1) / 2 + (Math.random() - 0.5) * 4);
    g.particles.smoke(sx, F.y + F.maxY + 1.5, sz, 2, 0.8, true);
  }
  W.vx = F.moving ? F.c * g.speed : 0;
  W.vz = F.moving ? F.s * g.speed : 0;
  // Ride height follows the ground under the hips, and rises over whatever the hull would hit (on
  // the way ahead as well, so it starts up a slope before it gets there).
  let rideTo = restHeight(g);
  if (g.climbTime > 0) rideTo = Math.max(rideTo, g.climbY);
  if (F.moving && Math.abs(g.speed) > 0.3) rideTo = Math.max(rideTo, aheadHeight(g, 0.8));
  const rise = rideTo - g.fortressBaseY;
  g.fortressBaseY = approach(g.fortressBaseY, rideTo, (rise > 0 ? 4 + Math.min(6, rise * 2) : F.moving ? 5 : 2) * dt);
  climbFx(g, rise, dt);
  const bob = F.moving ? Math.sin(F.walkPhase * (Math.PI * 2) / (W.spec.stride)) * 0.12 : 0;
  updatePound(g, dt);
  F.y = g.fortressBaseY + bob + (g.pound ? poundLift(g.pound) : 0);
  const landed = W.update(F, g.world, dt, F.moving);
  if (landed > 0) {
    for (const l of W.legs) {
      if (!l.landed) continue;
      l.landed = false;
      stomp(g, l.foot, W.spec.size, true);
    }
  }
  if (F.moving) crushTerrain(g, F, true);
  updateHoist(g, dt);
  updateCraneDrop(g, dt);
  updateHold(g, dt);
  updateFarms(g, dt);
}

// ------------------------------------------------------------------ the ground pound

/** Seconds to wind a stomp up to full power (hold the button), and how long a full one is held. */
export const POUND_CHARGE = 0.9;
const POUND_HOLD_MAX = 1.6;
/** Steam a stomp costs. */
export const POUND_STEAM = 0.3;

/** A stomp under way: winding up (held), then the drop, the slam and the settle. */
export interface Pound {
  /** Seconds since the press. */
  t: number;
  /** 0..1: how far it was wound up (fixed on release). */
  charge: number;
  held: boolean;
  /** Seconds since the release (the drop), -1 while still winding. */
  drop: number;
  fired: boolean;
  /** How high the hull rode when it was let go. */
  from: number;
}

/** Whether you can stomp from where you are: aboard the fortress (or at its helm), in play. */
export function canStomp(g: Game): boolean {
  const p = g.player;
  return g.isPlaying() && !p.dead && !g.leap && (g.helm || p.standingOn === g.fortress);
}

/** How far a stomp of a given power reaches out from the hull. */
export function poundReach(g: Game, power: number): number {
  return g.fortressRadius() + 6 + 8 * power;
}

/** Press: the hull starts heaving up on every leg (hold to wind it up further). */
export function beginPound(g: Game): boolean {
  if (!canStomp(g)) return false;
  if (g.pound || g.poundCooldown > 0) {
    if (!g.pound) g.deny('The legs are still recoiling');
    return false;
  }
  if (g.steam < POUND_STEAM) {
    g.deny('Not enough steam: let the boiler refill');
    return false;
  }
  g.steam -= POUND_STEAM;
  g.steamIdle = 0;
  g.pound = { t: 0, charge: 0, held: true, drop: -1, fired: false, from: 0 };
  g.sfx('steam', 'metal', 0.7, 0.8);
  g.report('primary_input');
  return true;
}

/** Release: down it comes, as hard as it was wound up. */
export function releasePound(g: Game): void {
  const p = g.pound;
  if (!p || !p.held) return;
  p.held = false;
  p.from = poundLift(p);
  p.drop = 0;
}

/** A tap: a quick stomp at the least power (the wind-up is cut short). */
export function groundPound(g: Game): boolean {
  if (!beginPound(g)) return false;
  g.pound!.charge = 0.15;
  releasePound(g);
  return true;
}

/** How high the hull rides: up as the stomp winds (shuddering at full power), a hard drop, then settling. */
export function poundLift(p: Pound): number {
  if (p.drop < 0) {
    const up = 0.45 + 1.55 * p.charge;
    const ease = Math.min(1, p.t / 0.18);
    return up * ease * ease * (3 - 2 * ease) + (p.charge >= 1 ? Math.sin(p.t * 70) * 0.05 : 0);
  }
  const fall = 0.08;
  if (p.drop < fall) return p.from - (p.from + 0.9) * (p.drop / fall) ** 2;
  return -0.9 * Math.max(0, 1 - (p.drop - fall) / 0.45);
}

/** The slam: shock rings at every foot and round the hull, monsters flung away, climbers shaken off, giants rocked. */
function poundSlam(g: Game, power: number): void {
  const W = g.walker;
  const F = g.fortress;
  const c = g.fortressCentre();
  const reach = poundReach(g, power);
  const ground = g.world.groundAt(c[0], c[2]);
  for (const l of W.legs) {
    stomp(g, l.foot, W.spec.size * (1.2 + power * 0.4), true);
    g.particles.ring(l.foot[0], l.foot[1] + 0.4, l.foot[2], 7 + power * 4, 1, 0.8, 0.45);
    g.particles.dust(l.foot[0], l.foot[1] + 0.3, l.foot[2], 18 + Math.round(power * 16), 4.5 + power * 3, false);
    g.shocks.push({ x: l.foot[0], y: l.foot[1], z: l.foot[2], r0: 0.8, r1: 4 + power * 3, t: 0, life: 0.35, width: 0.7, power });
  }
  // The big ring rolls out over the ground to the stomp's reach (a second, fainter one behind it).
  g.shocks.push({ x: c[0], y: ground, z: c[2], r0: g.fortressRadius() * 0.7, r1: reach, t: 0, life: 0.5 + power * 0.25, width: 1.6 + power, power });
  g.shocks.push({ x: c[0], y: ground, z: c[2], r0: g.fortressRadius() * 0.5, r1: reach * 0.8, t: -0.12, life: 0.55 + power * 0.25, width: 1, power: power * 0.6 });
  let flung = 0;
  for (const m of g.mobs) {
    if (m.dead || m.flying) continue;
    const dx = m.x - c[0];
    const dz = m.z - c[2];
    const d = Math.hypot(dx, dz) || 1;
    const onDeck = m.standingOn === F;
    if (!m.climb && !onDeck && (d > reach || m.y > c[1] + 2)) continue;
    // Away from the hull, up into the air (the nearer and the harder the stomp, the further).
    const k = (m.climb ? 9 : onDeck ? 11 : 8 + Math.max(0, reach - d) * 0.4) * (1 + power * 0.5);
    m.climb = null;
    m.standingOn = null;
    damageMob(g, m, onDeck ? 8 + power * 6 : 14 + g.danger + power * 12, (dx / d) * k, (dz / d) * k, 'player', 'blast');
    if (!m.dead) {
      m.vy = 7 + Math.random() * 2 + power * 3;
      m.stun = 1.4 + power;
    }
    flung += 1;
  }
  for (const giant of g.giants) {
    if (giant.dead || giant.dormant) continue;
    const [gx, gz] = giant.body.hullCentre();
    const d = Math.hypot(gx - c[0], gz - c[2]) || 1;
    if (d > reach + 6) continue;
    giant.push = [((gx - c[0]) / d) * (6 + power * 6), ((gz - c[2]) / d) * (6 + power * 6)];
    giant.body.shake = 0.6 + power * 0.4;
    giant.attackTimer = Math.max(giant.attackTimer, 1.8 + power * 1.5);
  }
  F.shake = Math.max(F.shake, 0.6 + power * 0.4);
  g.renderer.shake(0.9 + power * 0.6);
  g.freeze(0.1 + power * 0.08);
  g.punch(0.05 + power * 0.04);
  g.buzz(power > 0.8 ? 260 : 160);
  g.sfx('groundpound', 'stone', 1, 1 - power * 0.12);
  if (power > 0.6) g.sfx('explode', 'stone', 0.5, 0.55);
  // The word goes up right before your eyes (the hull's middle may well be behind you).
  const mega = power >= 0.95;
  g.ui.flash(mega ? 'white' : 'impact');
  const e = g.eye();
  const at: Vec3 = [e[0] + Math.cos(g.yaw) * Math.cos(g.pitch) * 5, e[1] + Math.sin(g.pitch) * 5 + 0.6, e[2] + Math.sin(g.yaw) * Math.cos(g.pitch) * 5];
  g.ui.damage(0, at[0], at[1], at[2], 'big', `${mega ? 'MEGA STOMP!' : 'STOMP!'}${flung > 0 ? ` ×${flung}` : ''}`);
  if (flung >= 5) feat(g, 'strike');
  if (flung >= 3) g.cheer();
  g.crewSay('stomp');
  startle(g, c[0], c[1], c[2], reach + 8, 8);
  g.report('visual_feedback');
}

function updatePound(g: Game, dt: number): void {
  g.poundCooldown = Math.max(0, g.poundCooldown - dt);
  for (const s of g.shocks) s.t += dt;
  if (g.shocks.length) g.shocks = g.shocks.filter((s) => s.t < s.life);
  const p = g.pound;
  if (!p) return;
  p.t += dt;
  if (p.held) {
    // Winding up: the legs groan and dust sifts from the feet; a full wind-up lets go by itself.
    const was = p.charge;
    p.charge = Math.min(1, p.t / POUND_CHARGE);
    if (was < 1 && p.charge >= 1) {
      g.sfx('steam', 'metal', 0.9, 1.25);
      g.buzz(40);
    }
    // At full power the whole hull shudders, straining to come down.
    if (p.charge >= 1) g.renderer.shake(0.12);
    if (Math.random() < dt * 20) {
      const l = g.walker.legs[Math.floor(Math.random() * g.walker.legs.length)];
      if (l) g.particles.dust(l.foot[0], l.foot[1] + 0.3, l.foot[2], 2, 1.2, false);
    }
    if (p.t > POUND_HOLD_MAX) releasePound(g);
    return;
  }
  p.drop += dt;
  if (!p.fired && p.drop >= 0.08) {
    p.fired = true;
    poundSlam(g, p.charge);
    g.poundCooldownMax = (7 + 6 * p.charge) * (hasTrophy(g, 'slime') ? 0.6 : 1);
    g.poundCooldown = g.poundCooldownMax;
  }
  if (p.drop > 0.6) g.pound = null;
}

/** A foot comes down: dust, a thud, flattened plants and anything soft beneath it crushed. */
export function stomp(g: Game, foot: Vec3, size: number, fortress: boolean): void {
  const w = g.world;
  const fx = foot[0];
  const fz = foot[2];
  const fy = foot[1];
  const r = fortress ? 1.4 * size : 0.9 * size;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = Math.floor(fx + dx * r * 0.7);
      const z = Math.floor(fz + dz * r * 0.7);
      for (let y = Math.floor(fy); y <= Math.floor(fy) + (fortress ? 3 : 1); y += 1) {
        const id = w.get(x, y, z);
        if (id === B.AIR || id === B.WATER || id === B.BEDROCK || id === B.FALLING_WATER) continue;
        const def = blockDef(id);
        if (def.shape === 'cross' || def.shape === 'crop' || id === B.LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES) w.set(x, y, z, B.AIR);
        else if (fortress) crushBlock(g, x, y, z, id, false);
      }
      const top = w.topAt(x, z);
      if (w.get(x, top, z) === B.GRASS && Math.random() < 0.5) w.set(x, top, z, B.DIRT);
    }
  }
  const dust = w.get(Math.floor(fx), Math.floor(fy) - 1, Math.floor(fz));
  const tile = blockDef(dust === B.AIR ? B.DIRT : dust).tiles.side;
  g.particles.dust(fx, fy + 0.2, fz, fortress ? 14 : 6, r * 1.6, w.liquid(Math.floor(fx), Math.floor(fy), Math.floor(fz)));
  g.particles.debris(fx, fy + 0.3, fz, tile, fortress ? 8 : 3, 4, 0.16, 0.9);
  g.eachPlayer((p) => {
    const d = Math.hypot(p.x - fx, p.y - fy, p.z - fz);
    // Riding the fortress the steps are felt, not a camera quake (gentler still at the helm).
    const aboard = fortress && (p.standingOn === g.fortress || g.helm);
    const feel = aboard ? (g.camPull > 0.5 || g.gunner ? 0.25 : 0.4) : 1;
    g.own(() => {
      g.renderer.shake(clamp((fortress ? 0.55 : 0.35) * (1 - d / 40) * feel, 0, 0.5));
      g.ear('stomp', 'stone', clamp(1.2 - d / 45, 0.15, 1));
    });
  });
  for (const mob of g.mobs) {
    if (mob.dead) continue;
    if (Math.abs(mob.x - fx) < r + 0.4 && Math.abs(mob.z - fz) < r + 0.4 && mob.y < fy + 2) {
      const dmg = fortress ? 30 : 8;
      // A monster caught under one of your own feet goes flat as a pancake.
      if (fortress && !mob.climb && !mob.fly && mob.hp <= dmg) squashMob(g, mob, fx, fy, fz, r);
      else damageMob(g, mob, dmg, Math.sign(mob.x - fx || 1) * 7, Math.sign(mob.z - fz || 1) * 7);
    }
  }
  // The farm animals scatter from a stamping foot.
  startle(g, fx, fy, fz, r + (fortress ? 6 : 4), fortress ? 5 : 3);
}

/** Blocks the moving hull passes through are smashed (and partly salvaged). */
export function crushTerrain(g: Game, body: BlockBody, salvage: boolean): void {
  const w = g.world;
  const cols = body.columns();
  const b = body.worldBounds();
  const [hx, hz] = body.centre();
  for (let wz = Math.floor(b.z0); wz <= Math.floor(b.z1); wz += 1) {
    for (let wx = Math.floor(b.x0); wx <= Math.floor(b.x1); wx += 1) {
      // (body.toLocal written out: every column under the hull, every frame of a march.)
      const dx = wx + 0.5 - body.x - body.px;
      const dz = wz + 0.5 - body.z - body.pz;
      const lx = body.px + body.c * dx + body.s * dz;
      const lz = body.pz - body.s * dx + body.c * dz;
      const col = cols.get(colKey(Math.floor(lx), Math.floor(lz)));
      if (!col) continue;
      const y0 = Math.floor(body.y + col[0]);
      const top = w.topAt(wx, wz);
      if (top < y0) continue;
      // The deck also sweeps the space its riders stand in (leaves would scrape them off).
      const y1 = Math.min(top, Math.floor(body.y + col[1] + 3.999));
      for (let wy = y0; wy <= y1; wy += 1) {
        const id = w.get(wx, wy, wz);
        if (id !== B.AIR && id !== B.BEDROCK && id !== B.WATER && id !== B.FALLING_WATER && id !== B.OBSIDIAN && id !== B.CITADEL_HEART) crushBlock(g, wx, wy, wz, id, salvage);
      }
      // A standing pillar it smashed into comes down whole: what rose above the deck topples off.
      if (top > y1 && w.terrain.spikeAt(wx, wz)) toppleColumn(g, wx, wz, y1 + 1, top, hx, hz);
    }
  }
}

/** The rest of a smashed pillar falls away from the hull in tumbling blocks. */
function toppleColumn(g: Game, x: number, z: number, y0: number, y1: number, hx: number, hz: number): void {
  const w = g.world;
  const dx = x + 0.5 - hx;
  const dz = z + 0.5 - hz;
  const l = Math.hypot(dx, dz) || 1;
  for (let y = y0; y <= y1; y += 1) {
    const id = w.get(x, y, z);
    if (id === B.AIR || id === B.WATER || id === B.BEDROCK) continue;
    w.set(x, y, z, B.AIR);
    if (g.falling.length < 160 && Math.random() < 0.6) {
      const k = 2.5 + Math.random() * 2 + (y - y0) * 0.15;
      g.falling.push({ id, x: x + 0.5, y: y + 0.5, z: z + 0.5, vx: (dx / l) * k + (Math.random() - 0.5), vy: 1 + Math.random() * 2, vz: (dz / l) * k + (Math.random() - 0.5), rot: 0, vr: (Math.random() - 0.5) * 6, age: 0, drop: false });
    }
  }
  if (Math.random() < 0.5) g.sfxAt('break', x, y0, z, 0.7, 0.8);
}

function crushBlock(g: Game, x: number, y: number, z: number, id: number, salvage: boolean): void {
  const def = blockDef(id);
  if (id === B.ANVIL || (id === B.CHEST && crestSafe(g, x, y, z))) return;
  if (def.shape === 'cross' || def.shape === 'crop') {
    g.world.set(x, y, z, B.AIR);
    return;
  }
  if (id === B.CHEST) spillChest(g, x, y, z);
  if (id === B.TNT_BLOCK) {
    // Trampled TNT is salvaged as ammo rather than detonating under your own walls.
    g.world.set(x, y, z, B.AIR);
    if (salvage) g.addItem(I.TNT, 2);
    return;
  }
  g.world.set(x, y, z, B.AIR);
  if (Math.random() < 0.5) g.particles.debris(x + 0.5, y + 0.5, z + 0.5, def.tiles.side, 4, 3);
  if (salvage && def.drops.length > 0 && Math.random() < 0.3) g.addItem(def.drops[0]![0], def.drops[0]![1], true);
  if (Math.random() < 0.2) g.sfx('break', materialOf(id), 0.45);
}

export function spillChest(g: Game, x: number, y: number, z: number): void {
  for (const [id, n] of g.world.lootAt(x, y, z)) spawnDrop(g, id, n, x + 0.5, y + 0.5, z + 0.5);
  g.world.markLooted(x, y, z);
  journalFrom(g, x, y, z);
}

// ------------------------------------------------------------------ damage & integrity

export function damageFortressCell(g: Game, key: number, amount: number): void {
  const F = g.fortress;
  const c = F.cells.get(key);
  if (!c || amount <= 0) return;
  // (Plated with the Dune Titan's stone.)
  if (hasTrophy(g, 'dune')) amount *= 0.8;
  c.hp -= amount;
  if (c.id === B.CORE) g.crewSay('core');
  F.shake = Math.max(F.shake, 0.12);
  const lx = kx(key);
  const ly = ky(key);
  const lz = kz(key);
  const p = F.cellCenter(lx, ly, lz);
  if (c.hp > 0) {
    g.particles.debris(p.x, p.y, p.z, blockDef(c.id).tiles.side, 2, 2, 0.1, 0.4);
    return;
  }
  if (c.id === B.CORE) {
    coreDestroyed(g);
    return;
  }
  const id = F.removeBlock(lx, ly, lz);
  g.particles.debris(p.x, p.y, p.z, blockDef(id).tiles.side, 8, 4);
  g.sfx('break', materialOf(id), 0.8);
  checkFortressIntegrity(g);
}

/** Pieces no longer connected to the Engine Core break off and fall. */
export function checkFortressIntegrity(g: Game): void {
  const F = g.fortress;
  const core = F.findBlock(B.CORE);
  if (core === null) return;
  let connected = F.connectedTo(core);
  if (connected.size === F.cells.size) return;
  // Blasted loose from the deck, the Core would take the whole fortress down with it: the crew
  // braces it back onto the bigger piece instead (out of a strut's reach, it holds on where it is
  // and the biggest piece stays with it).
  if (connected.size * 2 < F.cells.size) {
    if (braceCore(g, connected)) connected = F.connectedTo(core);
    else for (const key of largestPiece(F, connected)) connected.add(key);
  }
  const detached = [...F.cells.keys()].filter((key) => !connected.has(key));
  if (detached.length === 0) return;
  const removed: number[] = [];
  for (const key of detached) {
    const lx = kx(key);
    const ly = ky(key);
    const lz = kz(key);
    const p = F.cellCenter(lx, ly, lz);
    const cell = F.cells.get(key)!;
    removed.push(key);
    if (g.falling.length < 160) g.falling.push({ id: cell.id, x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 3, vy: 2, vz: (Math.random() - 0.5) * 3, rot: 0, vr: (Math.random() - 0.5) * 6, age: 0, drop: Math.random() < 0.5 });
  }
  F.removeMany(removed);
  if (detached.length > 1) g.toast('Part of your fortress broke off!');
}

/** The biggest connected piece of the fortress outside `skip`. */
function largestPiece(F: BlockBody, skip: Set<number>): Set<number> {
  const seen = new Set(skip);
  let best = new Set<number>();
  for (const key of F.cells.keys()) {
    if (seen.has(key)) continue;
    const piece = F.connectedTo(key);
    for (const k of piece) seen.add(k);
    if (piece.size > best.size) best = piece;
  }
  return best;
}

/**
 * Bridges the shortest gap (a few cells at most) between the Core's loose piece and the rest of
 * the fortress with planks. True when it did.
 */
function braceCore(g: Game, held: Set<number>): boolean {
  const F = g.fortress;
  const prev = new Map<number, number>();
  const seen = new Set(held);
  let frontier = [...held];
  for (let step = 0; step < 7 && frontier.length > 0; step += 1) {
    const next: number[] = [];
    for (const key of frontier) {
      for (const [dx, dy, dz] of N6) {
        const n = key3(kx(key) + dx, ky(key) + dy, kz(key) + dz);
        if (seen.has(n)) continue;
        seen.add(n);
        if (!F.cells.has(n)) {
          prev.set(n, key);
          next.push(n);
          continue;
        }
        // The rest of the fortress: plank the way back to the Core.
        const strut: Array<[number, number, number, number, number]> = [];
        for (let at = key; !held.has(at); at = prev.get(at)!) strut.push([kx(at), ky(at), kz(at), B.PLANKS, 0]);
        F.setMany(strut);
        for (const [x, y, z] of strut) {
          const p = F.cellCenter(x, y, z);
          g.particles.debris(p.x, p.y, p.z, 'planks_oak', 4, 2);
        }
        g.sfx('place', 'wood', 0.8);
        g.toast('The crew braces the Engine Core back onto the deck!');
        return true;
      }
    }
    frontier = next;
  }
  return false;
}

export function coreDestroyed(g: Game): void {
  const F = g.fortress;
  const key = F.findBlock(B.CORE);
  let at: Vec3 = g.fortressCentre();
  if (key !== null) {
    const p = F.cellCenter(kx(key), ky(key), kz(key));
    at = [p.x, p.y, p.z];
    g.particles.sparks(p.x, p.y, p.z, ['#ff3a2a', '#ffd040', '#ffffff'], 40, 9, 0.16, 1);
    g.particles.smoke(p.x, p.y, p.z, 18, 3, true);
    g.light({ x: p.x, y: p.y, z: p.z, r: 12, color: [1, 0.5, 0.25], life: 1.2, max: 1.2 });
    F.cells.get(key)!.hp = 0;
  }
  g.renderer.shake(1.2);
  g.sfx('explode', 'stone', 1.2);
  // The fortress goes up around its Core before the tally.
  g.startFinale('defeat', at[0], at[1], at[2]);
}

/** Total structural health of the fortress (0..1) for the HUD. */
export function integrity(F: BlockBody): number {
  let hp = 0;
  let max = 0;
  for (const c of F.cells.values()) {
    if (c.maxHp <= 1) continue;
    hp += Math.max(0, c.hp);
    max += c.maxHp;
  }
  const lost = Math.max(0, F.peakCells - F.cells.size) * 6;
  return max > 0 ? clamp(hp / (max + lost), 0, 1) : 0;
}

// ------------------------------------------------------------------ hoisting into the hold

export type CellRow = [number, number, number, number, number];

/** The buildings with a place in the hold, as the planner takes them. */
export function holdEntries(cargo: readonly CargoInfo[]): HoldEntry[] {
  const out: HoldEntry[] = [];
  for (const c of cargo) if (c.slot !== undefined && c.slot >= 0) out.push({ kind: c.kind, slot: c.slot, zone: c.zone ?? null });
  return out;
}

/** The hold as planned for a set of buildings aboard. */
export function holdFor(cargo: readonly CargoInfo[]): HoldPlan {
  return holdPlan(holdEntries(cargo));
}

/** With the hold full: the building of a kind another of its kind is built into (the least built up), or -1. */
export function mergeInto(g: Game, kind: StructKind): number {
  let best = -1;
  g.cargo.forEach((c, i) => {
    if (c.kind !== kind || (c.level ?? 1) >= 3) return;
    if (best < 0 || (c.level ?? 1) < (g.cargo[best]!.level ?? 1)) best = i;
  });
  return best;
}

/** What rebuilding the hold from one plan to the next takes off the hull and puts on it. */
export interface HoldChanges {
  remove: Set<number>;
  add: CellRow[];
  /** TNT in the turrets that come off, by their slot (it goes into the turrets that go on). */
  ammo: Map<number, number>;
}

/** Railings, rail posts and their lanterns, torches. */
function isRailing(F: BlockBody, x: number, y: number, z: number, id: number): boolean {
  if (id === B.FENCE || id === B.LANTERN || id === B.TORCH) return true;
  if (y === 1 && id === B.STONE_BRICKS && F.blockAt(x, 2, z) === B.LANTERN) return true;
  return false;
}

/** Railings, their posts and lanterns, torches: what the hold may sweep aside. */
function railingAt(F: BlockBody, key: number): boolean {
  const c = F.cells.get(key);
  return c !== undefined && isRailing(F, kx(key), ky(key), kz(key), c.id);
}

/**
 * Works out rebuilding the hold from one plan to the next. What the old plan laid that the new one
 * does not want comes away (where it is still as it was laid); what is new to the plan goes in where
 * the hull is free, or holds a railing or the old plan's block. Nothing else is touched: blocks of
 * your own, and the battle damage and repairs of everything that stays. `part` picks the owners
 * rebuilt now (the rest is left for a later call).
 */
export function holdChanges(g: Game, before: HoldPlan, after: HoldPlan, part: ((owner: number) => boolean) | null): HoldChanges {
  const F = g.fortress;
  const take = (o: number | undefined): boolean => !part || part(o ?? -1);
  const remove = new Set<number>();
  const ammo = new Map<number, number>();
  const gunSlot = new Map(before.turrets.map((t) => [t.key, t.slot] as const));
  for (const [k, v] of before.cells) {
    if (after.cells.get(k) === v || !take(before.owner.get(k))) continue;
    if (F.cells.get(k)?.id !== (v & 255)) continue;
    const slot = gunSlot.get(k);
    const gun = F.cannons.get(k);
    if (slot !== undefined && gun) ammo.set(slot, (ammo.get(slot) ?? 0) + gun.ammo);
    remove.add(k);
  }
  if (take(-1)) for (const k of after.clear) if (railingAt(F, k)) remove.add(k);
  const add: CellRow[] = [];
  for (const [k, v] of after.cells) {
    const was = before.cells.get(k);
    if (was === v || !take(after.owner.get(k))) continue;
    const c = F.cells.get(k);
    const id = v & 255;
    if (c && c.id === id && c.dir === v >> 8) {
      remove.delete(k);
      continue;
    }
    if (c && !remove.has(k) && !railingAt(F, k)) continue;
    remove.delete(k);
    add.push([kx(k), ky(k), kz(k), id, v >> 8]);
  }
  return { remove, add, ammo };
}

/** Makes worked-out changes to the hull (turrets that moved carry their TNT along). Returns cells changed. */
export function applyHoldChanges(g: Game, ch: HoldChanges, after: HoldPlan): number {
  const F = g.fortress;
  if (ch.remove.size) F.removeMany([...ch.remove]);
  if (ch.add.length) F.setMany(ch.add);
  const added = new Set(ch.add.map(([x, y, z]) => key3(x, y, z)));
  for (const t of after.turrets) {
    const left = ch.ammo.get(t.slot);
    const gun = F.cannons.get(t.key);
    if (!left || !gun || !added.has(t.key)) continue;
    gun.ammo = Math.min(MAGAZINE, left);
    ch.ammo.delete(t.slot);
  }
  return ch.add.length + ch.remove.size;
}

/** Rebuilds the hold from one plan to the next at once (see holdChanges). Returns cells changed. */
function applyHold(g: Game, before: HoldPlan, after: HoldPlan, part: ((owner: number) => boolean) | null): number {
  return applyHoldChanges(g, holdChanges(g, before, after, part), after);
}

/** The building's cells turned by quarter turns about the vertical, re-cornered at (0, y, 0). */
function turnCells(base: readonly CellRow[], rot: number): { cells: CellRow[]; w: number; d: number } {
  const r = rot & 3;
  const out: CellRow[] = [];
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, y, z, id, dir] of base) {
    const [a, b] = r === 1 ? [-z, x] : r === 2 ? [-x, -z] : r === 3 ? [z, -x] : [x, z];
    out.push([a, y, b, id, dir >= 0 && DIRECTIONAL_IDS.has(id) ? rotateDir(dir, r) : dir]);
    x0 = Math.min(x0, a);
    z0 = Math.min(z0, b);
    x1 = Math.max(x1, a);
    z1 = Math.max(z1, b);
  }
  for (const c of out) {
    c[0] -= x0;
    c[2] -= z0;
  }
  return { cells: out, w: x1 - x0 + 1, d: z1 - z0 + 1 };
}

/** Tooling: a building of a kind straight into the hold (no crane), or false when it is full. */
export function addToHold(g: Game, kind: StructKind, zone: Zone | null): boolean {
  const slot = nextHoldSlot(holdEntries(g.cargo));
  if (slot < 0) return false;
  const before = holdFor(g.cargo);
  g.cargo.push({ kind, hub: null, dir: 0, slot, zone });
  const after = holdFor(g.cargo);
  applyHold(g, before, after, null);
  holdMachines(g, after);
  return true;
}

/** Points every windmill aboard at its hub, powers the hold's turrets and hubs, and keeps the plan. */
export function holdMachines(g: Game, plan: HoldPlan): void {
  const F = g.fortress;
  for (const c of g.cargo) {
    if (c.kind !== 'windmill' || c.slot === undefined || c.slot < 0) continue;
    const hub = plan.hubs.get(c.slot);
    c.hub = hub && F.cells.get(hub.key)?.id === B.WINDMILL_HUB ? hub.key : null;
    if (hub) {
      c.dir = hub.dir;
      c.sail = hub.sail;
    }
  }
  for (const t of plan.turrets) if (F.cells.get(t.key)?.id === B.CANNON) F.selfPowered.add(t.key);
  for (const hub of plan.hubs.values()) if (F.cells.get(hub.key)?.id === B.WINDMILL_HUB) F.selfPowered.add(hub.key);
  F.computePower();
  g.hold = plan;
}

/** The hold as it stands for a loaded game (planned again from the buildings aboard). */
export function loadHold(g: Game): void {
  const plan = holdFor(g.cargo);
  g.hold = plan.cells.size > 0 ? plan : null;
}

/** Chimneys in the hold smoke now and then. */
function updateHold(g: Game, dt: number): void {
  const plan = g.hold;
  if (!plan || plan.chimneys.length === 0) return;
  const F = g.fortress;
  for (const k of plan.chimneys) {
    if (Math.random() > dt * 2.2 || !F.cells.has(k)) continue;
    const [x, y, z] = F.toWorld(kx(k) + 0.5, ky(k) + 1.2, kz(k) + 0.5);
    g.particles.smoke(x, y, z, 1, 0.35);
  }
}

// ------------------------------------------------------------------ games from before the hold

/**
 * Games saved before the hold: every building that was bolted on (at full size, or packed down into
 * a deck module) is found on the deck by its own blocks and lifted off, the bare deck it stood on is
 * cleared away, and the buildings are rebuilt as the hold, in the order they came aboard. One that
 * cannot be found, or holds up something built onto it, stays where it is (stowed: no place in the
 * hold, its perks still count). Returns how many buildings moved into the hold.
 */
export function migrateHold(g: Game): number {
  const old = g.cargo.filter((c) => c.slot === undefined);
  if (old.length === 0) return 0;
  const F = g.fortress;
  // The village buildings hoisted, by kind (buildings of a kind share their blueprint, so any one
  // not yet matched will do: only its land's materials have to match).
  const pool = new Map<StructKind, Structure[]>();
  for (const id of g.world.hoisted) {
    const s = g.world.structures.byId.get(id);
    if (!s || !isHoistable(s)) continue;
    pool.set(s.kind, [...(pool.get(s.kind) ?? []), s]);
  }
  let ammo = 0;
  const moved: CargoInfo[] = [];
  for (const info of old) {
    const list = pool.get(info.kind) ?? [];
    let found = -1;
    for (let i = 0; i < list.length && found < 0; i += 1) {
      const got = liftOff(g, list[i]!, info.mini === true);
      if (got < 0) continue;
      found = i;
      ammo += got;
    }
    const s = list[found >= 0 ? found : 0];
    if (s) info.zone = g.world.terrain.zone(s.site.x, s.site.z);
    if (found >= 0) {
      list.splice(found, 1);
      moved.push(info);
      info.hub = null;
    } else info.slot = -1;
    delete info.mini;
  }
  if (moved.length > 0) trimDeck(g);
  // Places in the hold, in the order they came aboard (any past its last slot is stowed too).
  const entries = holdEntries(g.cargo);
  for (const info of moved) {
    const slot = nextHoldSlot(entries);
    info.slot = slot;
    if (slot >= 0) entries.push({ kind: info.kind, slot, zone: info.zone ?? null });
  }
  const plan = holdFor(g.cargo);
  applyHold(g, NO_HOLD, plan, null);
  holdMachines(g, plan);
  // The old guns' TNT goes into the hold's turrets.
  for (const t of plan.turrets) {
    const gun = F.cannons.get(t.key);
    if (!gun || ammo <= 0) continue;
    const n = Math.min(MAGAZINE - gun.ammo, ammo);
    gun.ammo += n;
    ammo -= n;
  }
  // (What came off is no damage: the fortress is whole at its new size.)
  F.changed();
  F.peakCells = F.cells.size;
  return moved.length;
}

/** An empty hold (before the first building comes aboard). */
const NO_HOLD: HoldPlan = holdPlan([]);

/** Finds one old building on the deck (at full size, or as its packed-down module) and lifts it off: the TNT its guns held, or -1. */
function liftOff(g: Game, s: Structure, mini: boolean): number {
  const F = g.fortress;
  const base: CellRow[] = [];
  if (mini) {
    const m = deckModule(s, g.world.terrain);
    if (!m) return -1;
    for (const [x, y, z, id] of m.cells) base.push([x, y, z, id === B.DISPENSER ? B.CANNON : id, 0]);
  } else {
    for (let i = 0; i < s.count; i += 1) {
      const id = s.ids[i]!;
      const x = s.xs[i]!;
      const z = s.zs[i]!;
      if (id === B.AIR) continue;
      if (s.kind === 'windmill' && s.hub && (id === B.FENCE || id === B.WOOL) && (x - s.hub.x) * DIRS[s.front]![0] + (z - s.hub.z) * DIRS[s.front]![2] >= 1) continue;
      base.push([x - s.minX, s.ys[i]! - s.floorY, z - s.minZ, id === B.DISPENSER ? B.CANNON : id, 0]);
    }
  }
  const where = new Map<number, number[]>();
  for (const [key, c] of F.cells) {
    if (ky(key) < 1) continue;
    const list = where.get(c.id);
    if (list) list.push(key);
    else where.set(c.id, [key]);
  }
  // Each quarter turn: the rarest of its blocks vote for where its corner stands; the best placing is
  // the one that matches most of the building.
  let best: number[] | null = null;
  for (let rot = 0; rot < 4; rot += 1) {
    const t = turnCells(base, rot);
    const anchors = [...t.cells].sort((a, b) => (where.get(a[3])?.length ?? 0) - (where.get(b[3])?.length ?? 0)).slice(0, 12);
    const votes = new Map<number, number>();
    for (const [ax, ay, az, id] of anchors) {
      for (const key of where.get(id) ?? []) {
        const v = key3(kx(key) - ax, ky(key) - ay, kz(key) - az);
        votes.set(v, (votes.get(v) ?? 0) + 1);
      }
    }
    for (const [v] of [...votes].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      const hits: number[] = [];
      for (const [x, y, z, id] of t.cells) {
        const key = key3(kx(v) + x, ky(v) + y, kz(v) + z);
        if (F.cells.get(key)?.id === id) hits.push(key);
      }
      if (!best || hits.length > best.length) best = hits;
    }
  }
  if (!best || best.length < Math.max(12, base.length * 0.55)) return -1;
  // Lift it off, unless that would cut loose something built onto it.
  const core = F.findBlock(B.CORE);
  if (core === null) return -1;
  const held = F.connectedTo(core);
  const removed = best.map((key) => ({ key, cell: F.cells.get(key)!, ammo: F.cannons.get(key)?.ammo ?? 0, self: F.selfPowered.has(key) }));
  F.removeMany(best);
  if (F.connectedTo(core).size !== held.size - removed.filter((r) => held.has(r.key)).length) {
    F.setMany(removed.map(({ key, cell }) => [kx(key), ky(key), kz(key), cell.id, cell.dir] as CellRow));
    for (const r of removed) {
      F.cells.get(r.key)!.hp = r.cell.hp;
      const gun = F.cannons.get(r.key);
      if (gun) gun.ammo = r.ammo;
      if (r.self) F.selfPowered.add(r.key);
    }
    F.changed();
    return -1;
  }
  return removed.reduce((n, r) => n + r.ammo, 0);
}

/** Bare deck: a column holding nothing but the planking, hull and railing the crane laid for a lot. */
function deckCell(y: number, id: number): boolean {
  switch (y) {
    case 1:
      return id === B.FENCE;
    case 0:
      return id === B.SPRUCE_PLANKS || id === B.COBBLE;
    case -1:
      return id === B.STONE_BRICKS || id === B.SMOOTH_STONE;
    case -2:
      return id === B.IRON_BLOCK || id === B.MOSSY_STONE_BRICKS || id === B.COBBLE || id === B.STONE_BRICKS;
    case -3:
      return id === B.LANTERN;
    default:
      return false;
  }
}

/**
 * Once the old buildings have packed down, the bare deck they stood on is cleared away from the edge
 * inwards, to a margin of one round whatever stands there, and the new edge gets its railing. The
 * starting deck, planks of your own and anything built or hung on the deck stay. False if it left
 * the deck as it was (nothing to clear, or clearing would cut something loose).
 */
function trimDeck(g: Game): boolean {
  const F = g.fortress;
  const cols = new Map<number, number[]>();
  for (const key of F.cells.keys()) {
    const k = colKey(kx(key), kz(key));
    const list = cols.get(k);
    if (list) list.push(key);
    else cols.set(k, [key]);
  }
  const at = (k: number): [number, number] => [Math.floor(k / 256) - 64, (k % 256) - 64];
  const keep = new Set<number>();
  for (const [k, keys] of cols) {
    const [x, z] = at(k);
    if (x >= 0 && x <= 14 && z >= 0 && z <= 10) keep.add(k);
    if (keys.every((key) => deckCell(ky(key), F.cells.get(key)!.id))) continue;
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) keep.add(colKey(x + dx, z + dz));
  }
  // Off the deck: the columns reachable from beyond its bounds without crossing planking.
  const [x0, x1, z0, z1] = [F.minX - 1, F.maxX + 1, F.minZ - 1, F.maxZ + 1];
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const outside = new Set<number>([colKey(x0, z0)]);
  const stack = [colKey(x0, z0)];
  while (stack.length > 0) {
    const [x, z] = at(stack.pop()!);
    for (const [dx, dz] of N4) {
      const nx = x + dx;
      const nz = z + dz;
      const n = colKey(nx, nz);
      if (nx < x0 || nx > x1 || nz < z0 || nz > z1 || outside.has(n) || F.hasBlock(nx, 0, nz)) continue;
      outside.add(n);
      stack.push(n);
    }
  }
  // Peel the bare edge, round after round, never cutting a part that stays off from the Core.
  const core = F.findBlock(B.CORE);
  if (core === null) return false;
  const coreCol = colKey(kx(core), kz(core));
  const alive = new Set([...cols.keys()].filter((k) => !outside.has(k)));
  const need = [...alive].filter((k) => keep.has(k));
  const joined = (without: number): boolean => {
    const reached = new Set<number>([coreCol]);
    const queue = [coreCol];
    while (queue.length > 0) {
      const [x, z] = at(queue.pop()!);
      for (const [dx, dz] of N4) {
        const n = colKey(x + dx, z + dz);
        if (n === without || reached.has(n) || !alive.has(n)) continue;
        reached.add(n);
        queue.push(n);
      }
    }
    return need.every((k) => reached.has(k));
  };
  const gone: number[] = [];
  for (let round = 0; round < 80; round += 1) {
    let peeled = false;
    for (const k of [...alive]) {
      if (keep.has(k)) continue;
      const [x, z] = at(k);
      if (!N4.some(([dx, dz]) => outside.has(colKey(x + dx, z + dz)))) continue;
      if (!joined(k)) {
        keep.add(k);
        continue;
      }
      alive.delete(k);
      outside.add(k);
      gone.push(...cols.get(k)!);
      cols.delete(k);
      peeled = true;
    }
    if (!peeled) break;
  }
  if (gone.length === 0) return false;
  const held = F.connectedTo(core);
  const removed = gone.map((key) => ({ key, cell: F.cells.get(key)! }));
  F.removeMany(gone);
  if (F.connectedTo(core).size !== held.size - removed.filter((r) => held.has(r.key)).length) {
    F.setMany(removed.map(({ key, cell }) => [kx(key), ky(key), kz(key), cell.id, cell.dir] as [number, number, number, number, number]));
    for (const r of removed) F.cells.get(r.key)!.hp = r.cell.hp;
    F.changed();
    return false;
  }
  // The new edge: a railing along it (where the deck is wide enough to walk past it) and the stone
  // skirt under it, as round the rest of the deck.
  const add: Array<[number, number, number, number, number]> = [];
  for (const k of cols.keys()) {
    const [x, z] = at(k);
    if (!F.hasBlock(x, 0, z)) continue;
    const open = N4.filter(([dx, dz]) => outside.has(colKey(x + dx, z + dz)));
    if (open.length === 0) continue;
    const wide = open.every(([dx, dz]) => F.hasBlock(x - dx, 0, z - dz) && F.hasBlock(x - 2 * dx, 0, z - 2 * dz));
    if (wide && !F.hasBlock(x, 1, z)) add.push([x, 1, z, B.FENCE, 0]);
    if (F.hasBlock(x, -1, z) && !F.hasBlock(x, -2, z)) add.push([x, -2, z, (x * 7 + z * 3) % 5 === 0 ? B.MOSSY_STONE_BRICKS : (x + z) % 3 === 0 ? B.COBBLE : B.STONE_BRICKS, 0]);
  }
  if (add.length) F.setMany(add);
  return true;
}

// ------------------------------------------------------------------ cargo perks

export function cargoCount(g: Game, kind: StructKind): number {
  let n = 0;
  for (const c of g.cargo) if (c.kind === kind) n += 1;
  return n;
}

/** Crew bunks: the starter cabin sleeps two, every house two more, cottages one (and bought bunks). */
export function crewCapacity(g: Game): number {
  return 2 + cargoCount(g, 'house') * 2 + (cargoPower(g, 'house') - cargoCount(g, 'house')) + cargoPower(g, 'cottage') + g.extraBunks;
}

/** Farms on the deck bake bread for the crew now and then. */
function updateFarms(g: Game, dt: number): void {
  const farms = cargoPower(g, 'farm');
  if (farms === 0) return;
  g.farmTimer -= dt * farms;
  if (g.farmTimer <= 0) {
    g.farmTimer = 50;
    g.addItem(I.BREAD, 1);
  }
}

export function itemIsBlock(id: number): boolean {
  return id < ITEM_BASE;
}

export { DIR_DOWN };
