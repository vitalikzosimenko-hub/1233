// Things that turn up: supply crates parachuting in by day (the first one lands beside you as you
// step off the ladder) and crates of TNT dropped onto your deck by night, a golden creeper to chase
// for its emeralds, a bounty each night with emeralds for the captain who earns it, and in the
// lulls of the night a shooting star to wish on.
import { B, I, blockDef } from './blocks';
import { kx, kz } from './body';
import { pick } from './build';
import { turretKind, usesTnt } from './combat';
import { Actor } from './entities';
import { feat } from './feats';
import type { Game, Ray } from './game';
import type { Vec3 } from './math3d';
import { nightBeat, spawnMob } from './mobs';
import { clamp } from './rng';
import type { Loot } from './structures';

// ------------------------------------------------------------------ supply drops

export interface Airdrop {
  x: number;
  y: number;
  z: number;
  /** The ground it lands on (a chest appears there). */
  ground: number;
  sway: number;
  loot: Loot;
  /** Landed: the chest's cell, until it is looted. */
  chest: Vec3 | null;
  /** Seconds since it landed (the canopy settles over it). */
  t: number;
  /** A night crate: the deck column (fortress-local x, z) it comes down on, riding along with the march. */
  deck?: [number, number];
}

const FALL_SPEED = 3.4;

/** Supplies in a crate: TNT and iron always, with a few treats. */
function crateLoot(g: Game, first: boolean): Loot {
  if (first) return [[I.TNT, 4], [I.IRON_INGOT, 3], [I.BREAD, 2], [I.EMERALD, 2], [I.COAL, 2]];
  const loot: Loot = [[I.TNT, 3 + Math.floor(Math.random() * 3)], [I.IRON_INGOT, 2 + Math.floor(Math.random() * 2)]];
  const roll = Math.random();
  if (roll < 0.35) loot.push([I.EMERALD, 2 + Math.floor(g.danger / 2)]);
  else if (roll < 0.6) loot.push([I.GUNPOWDER, 3]);
  else if (roll < 0.8) loot.push([B.WIRE, 8]);
  else loot.push([I.BREAD, 3]);
  if (Math.random() < 0.25) loot.push([I.REDSTONE, 2]);
  return loot;
}

/** A crate drops from the sky over a ground spot (it takes a few seconds to come down). */
export function dropCrate(g: Game, x: number, z: number, first = false): Airdrop | null {
  const w = g.world;
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  if (!w.chunkAt(ix, iz)) return null;
  const ground = w.topAt(ix, iz) + 1;
  if (w.liquid(ix, ground - 1, iz) || w.liquid(ix, ground, iz)) return null;
  const a: Airdrop = { x: ix + 0.5, y: ground + (first ? 16 : 34), z: iz + 0.5, ground, sway: Math.random() * 6, loot: crateLoot(g, first), chest: null, t: 0 };
  g.airdrops.push(a);
  return a;
}

/** A free ground spot a few blocks out from a point, away from a centre (and from the legs). */
function landingNear(g: Game, x: number, z: number, awayX: number, awayZ: number, dist: number): [number, number] | null {
  const w = g.world;
  let dx = x - awayX;
  let dz = z - awayZ;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  for (let tries = 0; tries < 12; tries += 1) {
    const a = (tries - 6) * 0.22;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = dist + (tries % 3);
    const px = x + (dx * c - dz * s) * r;
    const pz = z + (dx * s + dz * c) * r;
    const ix = Math.floor(px);
    const iz = Math.floor(pz);
    if (!w.chunkAt(ix, iz)) continue;
    const top = w.topAt(ix, iz);
    // Open sky, solid footing, not in a building and not under a planted foot.
    if (w.liquid(ix, top, iz) || w.structureAt(ix, top, iz) || w.structureAt(ix, top + 1, iz)) continue;
    if (g.walker.legs.some((leg) => Math.hypot(leg.foot[0] - px, leg.foot[2] - pz) < 3)) continue;
    if (Math.abs(top - w.groundAt(x, z)) > 3) continue;
    return [px, pz];
  }
  return null;
}

/** The day-one crate: it comes down beside you the moment you step off the ladder. */
export function tutorialCrate(g: Game): void {
  if (g.airdrops.length > 0) return;
  const p = g.player;
  const c = g.fortressCentre();
  const spot = landingNear(g, p.x, p.z, c[0], c[2], 4.5) ?? [p.x + 3, p.z];
  if (dropCrate(g, spot[0], spot[1], true)) {
    g.sfx('whoosh', 'wool', 0.8);
    g.toast('A supply crate is coming down: look up!', 'chest_front');
  }
}

/** The crate the training (or the goal line) wants you to open: the nearest unopened one. */
export function crateTarget(g: Game): Vec3 | null {
  const p = g.player;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (const a of g.airdrops) {
    const at: Vec3 = a.chest ? [a.chest[0] + 0.5, a.chest[1] + 1, a.chest[2] + 0.5] : [a.x, a.y, a.z];
    const d = Math.hypot(at[0] - p.x, at[2] - p.z);
    if (d < bestD) {
      bestD = d;
      best = at;
    }
  }
  return best;
}

export function crateFalling(g: Game): boolean {
  return g.airdrops.some((a) => !a.chest);
}

function updateAirdrops(g: Game, dt: number): void {
  const w = g.world;
  for (const a of g.airdrops) {
    if (a.deck) {
      deckCrate(g, a, dt);
      continue;
    }
    if (a.chest) {
      a.t += dt;
      // Looted (or gone): the canopy folds away.
      if (w.get(a.chest[0], a.chest[1], a.chest[2]) !== B.CHEST) a.t = Math.max(a.t, 99);
      continue;
    }
    a.sway += dt;
    a.y -= FALL_SPEED * dt;
    a.x += Math.sin(a.sway * 1.3) * 0.25 * dt;
    a.z += Math.cos(a.sway * 1.1) * 0.25 * dt;
    if (Math.random() < 0.25) g.particles.add({ x: a.x, y: a.y + 0.3, z: a.z, vx: (Math.random() - 0.5) * 0.4, vy: -0.3, vz: (Math.random() - 0.5) * 0.4, life: 0.8, size: 0.12, r: 1, g: 0.25, b: 0.15, a: 1, emit: 1.4, gravity: -0.5, drag: 1, tile: 'spark', soft: true });
    const ix = Math.floor(a.x);
    const iz = Math.floor(a.z);
    const top = w.topAt(ix, iz) + 1;
    if (a.y > top + 0.05) continue;
    // Down: the crate becomes a chest (or shatters on the deck and spills its supplies there). Grass
    // and flowers it lands in are flattened under it.
    a.y = top;
    const under = w.get(ix, top, iz);
    const plant = under !== B.AIR && blockDef(under).shape === 'cross' && !blockDef(under).solid;
    if (under === B.AIR || plant) {
      w.set(ix, top, iz, B.CHEST, 2);
      w.chestLoot.set(w.chestKey(ix, top, iz), a.loot);
      a.chest = [ix, top, iz];
    } else {
      for (const [id, n] of a.loot) g.addItem(id, n);
      // (Its supplies came to hand all the same: as good as opened.)
      g.flags.looted += 1;
      a.t = 99;
      a.chest = [ix, top, iz];
    }
    g.particles.dust(a.x, top + 0.1, a.z, 10, 1.6, false);
    const p = g.player;
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    g.sfx('crate', 'wood', Math.max(0.25, 1 - d / 60));
    g.renderer.shake(Math.max(0, 0.25 - d / 80));
  }
  g.airdrops = g.airdrops.filter((a) => a.t < 99);
}

// ------------------------------------------------------------------ night supplies

/** TNT in your hold and in the turrets' magazines. */
export function ammoLeft(g: Game): number {
  let n = g.count(I.TNT);
  for (const [k, s] of g.fortress.cannons) if (usesTnt(turretKind(g.fortress, k))) n += s.ammo;
  return n;
}

/** The night's supply run: the beat it last answered, and when the last crate went out. */
const supply = { day: -1, beat: -1, at: -999 };

/**
 * The village behind you keeps the guns fed: a crate of TNT parachutes onto your deck at each
 * lull and at the final assault, and at once if the hold runs dry in the middle of a wave.
 */
export function resupply(g: Game, why: 'lull' | 'final' | 'empty'): boolean {
  if (g.phase !== 'night' || g.siege) return false;
  const F = g.fortress;
  // It comes down a few steps from you when you are aboard, else by the Engine Core.
  const p = g.player;
  const aboard = p.standingOn === F || g.helm;
  const core = g.coreKey();
  const [ax, , az] = aboard ? F.toLocal(p.x, p.y, p.z) : core !== null ? [kx(core) + 0.5, 0, kz(core) + 0.5] : [(F.minX + F.maxX + 1) / 2, 0, (F.minZ + F.maxZ + 1) / 2];
  let best: [number, number] | null = null;
  let bestScore = Infinity;
  for (let x = F.minX; x <= F.maxX; x += 1) {
    for (let z = F.minZ; z <= F.maxZ; z += 1) {
      if (F.topSolid(x, z) === null) continue;
      const d = Math.hypot(x + 0.5 - ax, z + 0.5 - az);
      // Not on your head: two to four steps away.
      const score = Math.abs(d - 3) + Math.random() * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = [x, z];
      }
    }
  }
  if (!best) return false;
  const n = g.day <= 1 ? 8 : 6 + Math.min(4, Math.floor(g.danger / 2));
  const loot: Loot = [[I.TNT, n]];
  if (why === 'lull' && p.hp < p.maxHp * 0.6) loot.push([I.BREAD, 2]);
  const [wx, , wz] = F.toWorld(best[0] + 0.5, 0, best[1] + 0.5);
  g.airdrops.push({ x: wx, y: F.top + 24, z: wz, ground: 0, sway: Math.random() * 6, loot, chest: null, t: 0, deck: best });
  supply.at = g.time;
  g.toast(why === 'empty' ? 'Low on TNT: a supply crate is coming down onto the deck!' : `AMMO DROP: ${n} TNT parachuting onto the deck!`, 'tnt_side');
  g.sfx('whoosh', 'wool', 0.8);
  return true;
}

/** A night crate drifting down onto its deck column (it rides along as the fortress walks). */
function deckCrate(g: Game, a: Airdrop, dt: number): void {
  const F = g.fortress;
  const [lx, lz] = a.deck!;
  const top = F.topSolid(lx, lz);
  const [wx, , wz] = F.toWorld(lx + 0.5, 0, lz + 0.5);
  a.sway += dt;
  a.x = wx + Math.sin(a.sway * 1.3) * 0.2;
  a.z = wz + Math.cos(a.sway * 1.1) * 0.2;
  a.y -= FALL_SPEED * 1.7 * dt;
  if (Math.random() < 0.3) g.particles.add({ x: a.x, y: a.y + 0.3, z: a.z, vx: (Math.random() - 0.5) * 0.4, vy: -0.3, vz: (Math.random() - 0.5) * 0.4, life: 0.8, size: 0.12, r: 1, g: 0.25, b: 0.15, a: 1, emit: 1.4, gravity: -0.5, drag: 1, tile: 'spark', soft: true });
  const land = F.y + (top ?? 0) + 1;
  if (a.y > land) return;
  // Down: the crate bursts open and its supplies go straight into the hold.
  let tnt = 0;
  for (const [id, n] of a.loot) {
    g.addItem(id, n);
    if (id === I.TNT) tnt += n;
  }
  g.particles.debris(a.x, land + 0.4, a.z, 'planks_oak', 10, 3);
  g.particles.dust(a.x, land + 0.1, a.z, 8, 1.4, false);
  g.particles.sparks(a.x, land + 0.6, a.z, ['#ffe070', '#ff8a20', '#ffffff'], 12, 3, 0.08, 0.5);
  g.ui.damage(0, a.x, land + 1.3, a.z, 'big', `+${tnt} TNT`);
  g.ui.flyItem(I.TNT, a.x, land + 0.5, a.z);
  g.sfx('crate', 'wood', 0.9);
  g.buzz(30);
  a.y = land;
  a.chest = [Math.floor(a.x), Math.floor(land), Math.floor(a.z)];
  a.t = 99;
}

/** Each night: a crate at every lull and at the final assault, and one at once if the hold runs dry. */
function nightSupplies(g: Game): void {
  if (g.phase !== 'night' || g.siege) return;
  if (supply.day !== g.day) {
    supply.day = g.day;
    supply.beat = -1;
    supply.at = -999;
  }
  const beat = nightBeat(g.progress);
  if (beat.index !== supply.beat) {
    supply.beat = beat.index;
    if (beat.name === 'lull' || beat.name === 'final') resupply(g, beat.name === 'final' ? 'final' : 'lull');
    return;
  }
  if (beat.name === 'dusk' || beat.name === 'dawn' || g.airdrops.some((a) => a.deck)) return;
  if (ammoLeft(g) <= 2 && g.time - supply.at > 30) resupply(g, 'empty');
}

/** Once a day (from day two), around midday, a crate comes down somewhere near the fortress. */
function dailyDrop(g: Game): void {
  if (g.phase !== 'day' || g.day < 2 || g.today.crate || g.siege) return;
  const f = 1 - g.dayTime / Math.max(1, g.dayLength);
  if (f < 0.28) return;
  g.today.crate = true;
  const c = g.fortressCentre();
  const a = Math.random() * Math.PI * 2;
  const r = g.fortressRadius() + 18 + Math.random() * 16;
  const spot = landingNear(g, c[0] + Math.cos(a) * r, c[2] + Math.sin(a) * r, c[0], c[2], 0.01);
  if (!spot || !dropCrate(g, spot[0], spot[1])) return;
  g.ui.banner('SUPPLY DROP!', 'A crate is coming down: follow the gold marker', 'gold');
  g.sfx('whoosh', 'wool', 1);
}

// ------------------------------------------------------------------ the golden creeper

const GOLDEN_TIME = 70;

/** Once a day (from day two) a golden creeper turns up near you by day: catch it! */
function goldenCreeper(g: Game, dt: number): void {
  const alive = g.mobs.find((m) => !m.dead && m.golden > 0);
  if (alive) {
    alive.golden -= dt;
    if (alive.golden <= 0 || g.phase !== 'day') {
      // It burrows away.
      alive.dead = true;
      g.particles.dust(alive.x, alive.y + 0.2, alive.z, 14, 1.6, false);
      g.particles.sparks(alive.x, alive.y + 0.8, alive.z, ['#ffd23a', '#fff0a0'], 12, 4, 0.1, 0.6);
      g.sfx('poof', 'dirt', 0.8);
      g.toast('The golden creeper burrowed away!');
    }
    return;
  }
  if (g.phase !== 'day' || g.day < 2 || g.today.golden || g.siege) return;
  const f = 1 - g.dayTime / Math.max(1, g.dayLength);
  if (f < 0.12) return;
  // Only once you are down on the ground, where you can chase it.
  const p = g.player;
  if (p.standingOn === g.fortress || g.helm || p.y > g.world.groundAt(p.x, p.z) + 4) return;
  g.today.golden = true;
  for (let tries = 0; tries < 8; tries += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = 14 + Math.random() * 8;
    const mob = spawnMob(g, 'creeper', p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
    if (!mob) continue;
    if (Math.abs(mob.y - p.y) > 5) {
      mob.dead = true;
      continue;
    }
    mob.golden = GOLDEN_TIME;
    mob.maxHp = 18;
    mob.hp = 18;
    mob.speed = 3.7;
    g.ui.banner('A GOLDEN CREEPER!', 'It is full of emeralds: catch it before it burrows away!', 'gold');
    g.sfx('jackpot', 'metal', 0.6);
    return;
  }
}

/** A golden creeper runs from you (and zig-zags); returns where it wants to go. */
export function fleeFrom(g: Game, m: Actor): [number, number] {
  const p = g.player;
  const dx = m.x - p.x;
  const dz = m.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  if (d > 16) {
    // Out of reach: it potters about, waiting.
    return [m.x + Math.cos(g.time * 0.7 + m.homeX) * 2, m.z + Math.sin(g.time * 0.6 + m.homeZ) * 2];
  }
  const zig = Math.sin(g.time * 2.2 + m.homeX) * 0.8;
  return [m.x + (dx / d) * 4 - (dz / d) * zig * 3, m.z + (dz / d) * 4 + (dx / d) * zig * 3];
}

/** Caught: it bursts into a fountain of emeralds. */
export function goldenJackpot(g: Game, m: Actor): void {
  const gems = 6 + Math.floor(g.danger / 2);
  g.addItem(I.EMERALD, gems, true);
  g.addItem(I.TNT, 3, true);
  g.xp(25);
  for (let i = 0; i < 40; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 4;
    g.particles.add({ x: m.x, y: m.y + 1, z: m.z, vx: Math.cos(a) * s, vy: 6 + Math.random() * 5, vz: Math.sin(a) * s, life: 1.1 + Math.random() * 0.6, size: 0.2, r: i % 2 ? 0.35 : 1, g: i % 2 ? 1 : 0.85, b: i % 2 ? 0.45 : 0.25, a: 1, emit: 1.3, gravity: 14, drag: 0.6, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 6 });
  }
  g.particles.ring(m.x, m.y + 0.8, m.z, 4, 1, 0.85, 0.3);
  g.sfx('jackpot', 'metal', 1);
  g.buzz(90);
  g.freeze(0.1);
  g.ui.banner('JACKPOT!', `+${gems} emeralds and 3 TNT from the golden creeper`, 'gold');
  g.celebrate(2);
  feat(g, 'gold');
}

// ------------------------------------------------------------------ night bounties

export type BountyKind = 'slay' | 'giant' | 'core' | 'crit' | 'turret';

export interface Bounty {
  kind: BountyKind;
  goal: number;
  have: number;
  reward: number;
  /** Lost (the Core fell below the line), or paid out. */
  failed: boolean;
  paid: boolean;
}

export function bountyText(b: Bounty): string {
  switch (b.kind) {
    case 'slay':
      return `Slay ${b.goal} monsters yourself`;
    case 'giant':
      return 'Fell tonight\'s giant';
    case 'core':
      return 'Keep the Engine Core above 60%';
    case 'crit':
      return `Land ${b.goal} critical hits`;
    default:
      return `Your turrets slay ${b.goal} monsters`;
  }
}

export function bountyProgress(b: Bounty): string {
  if (b.kind === 'core') return b.failed ? 'FAILED' : 'HOLDING';
  return `${Math.min(b.have, b.goal)}/${b.goal}`;
}

/** Tonight's bounty: something worth doing beyond surviving. */
export function newBounty(g: Game): Bounty {
  const night = Math.round(g.danger);
  const kinds: BountyKind[] = g.day <= 1 ? ['slay'] : ['slay', 'giant', 'core', 'crit', 'turret'];
  const kind = kinds[(g.day * 7 + (g.seed & 7)) % kinds.length]!;
  const goal = kind === 'slay' ? 8 + night * 3 : kind === 'crit' ? 4 + night : kind === 'turret' ? 10 + night * 3 : 1;
  return { kind, goal, have: 0, reward: 3 + Math.min(4, Math.floor(night / 2)) + (kind === 'giant' || kind === 'core' ? 1 : 0), failed: false, paid: false };
}

/** Counts towards tonight's bounty. */
export function bountyCount(g: Game, kind: BountyKind, n = 1): void {
  const b = g.bounty;
  if (!b || b.kind !== kind || b.paid || b.failed || g.phase !== 'night') return;
  const before = b.have;
  b.have += n;
  if (before < b.goal && b.have >= b.goal) {
    g.sfx('success', 'metal', 0.8);
    g.toast(`Bounty done: ${bountyText(b)}! Paid at dawn`, 'emerald');
  }
}

function updateBounty(g: Game): void {
  const b = g.bounty;
  if (!b || g.phase !== 'night' || b.kind !== 'core' || b.failed) return;
  const core = g.coreHp();
  if (core.hp < core.max * 0.6) {
    b.failed = true;
    g.toast('Bounty lost: the Core took too much damage');
  }
}

/** At dawn: the bounty pays out (or not). Returns a line for the dawn report. */
export function settleBounty(g: Game): string | null {
  const b = g.bounty;
  g.bounty = null;
  if (!b || b.paid) return null;
  const won = b.kind === 'core' ? !b.failed : b.have >= b.goal;
  if (!won) return `Bounty missed: ${bountyText(b)}`;
  b.paid = true;
  g.addItem(I.EMERALD, b.reward, true);
  g.xp(15);
  return `Bounty paid: +${b.reward} emeralds`;
}

// ------------------------------------------------------------------ the shooting star

export interface ShootingStar {
  /** Directions from your eye where it starts and ends, and how far across the sky it is (0..1). */
  from: Vec3;
  to: Vec3;
  t: number;
  dur: number;
}

/** How long it takes to cross the sky (seconds), and how near a tap must be to catch it (radians). */
const STAR_TIME = 6;
const STAR_CATCH = 0.15;

/** Where the star is now, as a direction from the eye (index back in time along its trail). */
export function starDir(s: ShootingStar, back = 0): Vec3 {
  const u = clamp(s.t - back, 0, 1);
  const x = s.from[0] + (s.to[0] - s.from[0]) * u;
  const y = s.from[1] + (s.to[1] - s.from[1]) * u;
  const z = s.from[2] + (s.to[2] - s.from[2]) * u;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function dirAt(yaw: number, el: number): Vec3 {
  return [Math.cos(el) * Math.cos(yaw), Math.sin(el), Math.cos(el) * Math.sin(yaw)];
}

/** In the lulls of a night (once each, until one is caught), a shooting star crosses the sky ahead of you. */
function updateStar(g: Game, dt: number): void {
  const s = g.star;
  if (s) {
    s.t += dt / s.dur;
    if (s.t >= 1) g.star = null;
    return;
  }
  const n = g.starNight;
  if (g.phase !== 'night' || g.siege || n.caught || g.player.dead) return;
  const beat = nightBeat(g.progress);
  if (beat.name !== 'lull' || n.lulls.includes(beat.index)) {
    n.wait = -1;
    return;
  }
  if (n.wait < 0) n.wait = 2.5 + Math.random() * 3;
  n.wait -= dt;
  if (n.wait > 0) return;
  n.lulls.push(beat.index);
  n.wait = -1;
  spawnStar(g);
}

/** Whether the sky is open along a direction from the eye (no terrain, hull or giant in the way). */
function openSky(g: Game, d: Vec3): boolean {
  const [ox, oy, oz] = g.eye();
  return pick(g, { ox, oy, oz, dx: d[0], dy: d[1], dz: d[2] }, 90).block === null;
}

/**
 * A shooting star sets off in front of you, sweeping across the open middle of the view: through
 * open sky (a path that houses or hills would hide is turned for a clearer one; an arrow at the
 * screen's edge then points the way).
 */
export function spawnStar(g: Game): void {
  const first = Math.random() < 0.5 ? -1 : 1;
  const base = clamp(g.pitch + 0.24, 0.1, 0.7);
  let star: ShootingStar | null = null;
  search: for (const el of [base, base + 0.16]) {
    for (const turn of [0, 0.5, -0.5, 1.2, -1.2, 2.1, -2.1, Math.PI]) {
      for (const side of [first, -first]) {
        const s: ShootingStar = { from: dirAt(g.yaw + turn + side * 0.66, el), to: dirAt(g.yaw + turn - side * 0.52, Math.max(0.06, el - 0.15)), t: 0, dur: STAR_TIME };
        star ??= s;
        if ([0.15, 0.5, 0.85].every((t) => openSky(g, starDir({ ...s, t })))) {
          star = s;
          break search;
        }
      }
    }
  }
  g.star = star;
  g.sfx('star', 'glass', 0.9);
  g.toast('A shooting star! Tap it to make a wish!', 'ui_star');
  g.crewSay('star');
}

/** A tap (or click) on the shooting star: the wish is granted. Returns true if it was caught. */
export function catchStar(g: Game, ray: Ray): boolean {
  const s = g.star;
  if (!s || s.t < 0.03) return false;
  const d = starDir(s);
  if (ray.dx * d[0] + ray.dy * d[1] + ray.dz * d[2] < Math.cos(STAR_CATCH)) return false;
  g.star = null;
  g.starNight.caught = true;
  const p = g.player;
  const roll = Math.random();
  let what: string;
  if (roll < 0.1) {
    g.addItem(I.HEARTSTONE, 1, true);
    what = 'A Heartstone falls from the sky!';
  } else if (roll < 0.36) {
    const n = 5 + Math.floor(g.danger / 2);
    g.addItem(I.EMERALD, n, true);
    what = `A pouch of ${n} emeralds`;
  } else if (roll < 0.6) {
    g.addItem(I.TNT, 8, true);
    what = '8 TNT for the cannons';
  } else if (roll < 0.8) {
    p.hp = p.maxHp;
    g.hunger = 20;
    what = 'Full health and a full belly';
  } else {
    g.rally = Math.max(g.rally, 40);
    what = 'Your crew loads twice as fast for a while';
  }
  g.ui.banner('WISH GRANTED!', what, 'gold');
  g.sfx('relic', 'metal', 0.9);
  g.sfx('star', 'glass', 0.6);
  g.buzz(60);
  // Stardust drifts down all around you.
  for (let i = 0; i < 46; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 3.5;
    const gold = i % 3 !== 0;
    g.particles.add({ x: p.x + Math.cos(a) * r, y: p.y + 3 + Math.random() * 3, z: p.z + Math.sin(a) * r, vx: (Math.random() - 0.5) * 0.4, vy: -0.6 - Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.4, life: 1.6 + Math.random() * 1.2, size: 0.16, r: 1, g: gold ? 0.88 : 1, b: gold ? 0.45 : 1, a: 1, emit: 1.2, gravity: 0.2, drag: 0.6, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 3 });
  }
  g.xp(10);
  feat(g, 'wish');
  g.crewSay('wish');
  g.report('visual_feedback');
  return true;
}

// ------------------------------------------------------------------ per frame

export function updateEvents(g: Game, dt: number): void {
  updateAirdrops(g, dt);
  nightSupplies(g);
  dailyDrop(g);
  goldenCreeper(g, dt);
  updateBounty(g);
  updateStar(g, dt);
}
