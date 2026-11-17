// The valley's stranger monsters, each with Minecraft's own habits: endermen that steal blocks and
// hate being stared at, witches lobbing splash potions (and drinking their own when hurt), slimes
// that bounce and split, ghasts whose fireballs can be batted back, and the illagers of a raid:
// pillagers with crossbows, vindicators with axes, evokers conjuring fangs and vexes, and the
// ravager, a beast that charges the fortress's legs.
import { hagShielded, wardenMob } from './wardens';
import { B, I } from './blocks';
import { kx, ky, kz } from './body';
import { explode } from './combat';
import { addEffect, hasEffect, type EffectId } from './effects';
import { feat } from './feats';
import { Actor, type ActorKind, type Projectile } from './entities';
import { checkFortressIntegrity, damageFortressCell } from './fortress';
import type { Game, Ray } from './game';
import { damageLeg, damageMob, damagePlayer, hasLineOfSight, meleeTick, nearestFoot, onFortress, scaleHealth, setSlimeSize, steerFlier, walkStep, type HitHow, type HitSource } from './mobs';
import { updateWither, witherHurt } from './bosses';
import type { Grid } from './physics';
import { clamp } from './rng';
import { beastMob } from './beasts';

/** One of an evoker's fangs: a jaw that bursts from the ground, snaps, and sinks back. */
export interface Fang {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Seconds since it rose (negative: still waiting its turn in the line). */
  t: number;
  bit: boolean;
}

// ------------------------------------------------------------------ voices

/** What a monster says: an idle noise, a cry when struck, its last, or the grunt of a swing. */
export type VoiceKind = 'ambient' | 'hurt' | 'death' | 'attack';

export function monsterVoice(g: Game, mob: Actor, kind: VoiceKind): void {
  const pitch = mob.baby ? 1.55 : mob.kind === 'husk' ? 0.86 : mob.zvillager ? 1.12 : 1;
  const at = (name: Parameters<Game['sfxAt']>[0], vol: number, rate = 1): void => g.sfxAt(name, mob.x, mob.y + mob.h * 0.8, mob.z, vol, rate * pitch * (0.94 + Math.random() * 0.12));
  switch (mob.kind) {
    case 'zombie':
    case 'husk':
      if (kind === 'ambient' || kind === 'attack') at('groan', kind === 'attack' ? 0.7 : 0.55, kind === 'attack' ? 1.15 : 1);
      else at('zhurt', kind === 'death' ? 0.9 : 0.75, kind === 'death' ? 0.82 : 1);
      return;
    case 'skeleton':
    case 'stray':
    case 'witherskel':
      at('rattle', kind === 'ambient' ? 0.35 : 0.7, (kind === 'death' ? 0.8 : kind === 'hurt' ? 1.15 : 1) * (mob.kind === 'witherskel' ? 0.75 : mob.kind === 'stray' ? 1.1 : 1));
      return;
    case 'spider':
    case 'cavespider':
      at('spider', kind === 'ambient' ? 0.4 : 0.7, (kind === 'death' ? 0.75 : kind === 'hurt' ? 1.25 : 1) * (mob.kind === 'cavespider' ? 1.35 : 1));
      return;
    case 'creeper':
      if (kind === 'hurt') at('zhurt', 0.3, 1.6);
      return;
    case 'enderman':
      if (kind === 'ambient') at(mob.anger > 0 ? 'scream' : 'teleport', mob.anger > 0 ? 0.35 : 0.22, mob.anger > 0 ? 1.1 : 0.55);
      else at('scream', kind === 'death' ? 0.9 : 0.6, kind === 'death' ? 0.8 : 1.3);
      return;
    case 'witch':
      if (kind === 'ambient' && Math.random() > 0.4) return;
      at('witch', kind === 'ambient' ? 0.5 : 0.75, kind === 'death' ? 0.78 : kind === 'hurt' ? 1.25 : 1);
      return;
    case 'slime':
      if (kind !== 'ambient') at('slime', 0.7, (kind === 'death' ? 0.7 : 1.2) * (mob.size >= 4 ? 0.7 : mob.size <= 1 ? 1.5 : 1));
      return;
    case 'pillager':
    case 'vindicator':
    case 'evoker':
      at('illager', kind === 'ambient' ? 0.45 : 0.75, (kind === 'death' ? 0.75 : kind === 'hurt' ? 1.3 : 1) * (mob.kind === 'vindicator' ? 0.9 : mob.kind === 'evoker' ? 1.12 : 1));
      return;
    case 'vex':
      at('vex', kind === 'ambient' ? 0.35 : 0.6, kind === 'death' ? 0.8 : kind === 'hurt' ? 1.3 : 1);
      return;
    case 'ravager':
      at('roar', kind === 'ambient' ? 0.3 : kind === 'death' ? 1 : 0.5, kind === 'ambient' ? 1.3 : kind === 'death' ? 0.7 : 1.45);
      return;
    case 'ghast':
      at('ghast', kind === 'ambient' ? 0.55 : 0.85, kind === 'death' ? 0.7 : kind === 'hurt' ? 1.3 : 1);
      return;
    case 'wither':
      if (kind === 'death') at('bossdeath', 1);
      else at('withergrowl', kind === 'ambient' ? 0.7 : 0.6, kind === 'hurt' ? 1.25 : 1);
      return;
    case 'phantom':
      if (kind !== 'ambient') at('phantom', 0.6, kind === 'death' ? 0.8 : 1.2);
      return;
    case 'drowned':
      if (kind === 'ambient' || kind === 'attack') at('gurgle', kind === 'attack' ? 0.7 : 0.5, kind === 'attack' ? 1.1 : 1);
      else at('zhurt', kind === 'death' ? 0.85 : 0.7, kind === 'death' ? 0.75 : 0.9);
      return;
    case 'bogged':
      at('rattle', kind === 'ambient' ? 0.35 : 0.7, (kind === 'death' ? 0.75 : kind === 'hurt' ? 1.1 : 0.9));
      return;
    case 'breeze':
      if (kind !== 'attack') at('wind', kind === 'ambient' ? 0.25 : 0.6, kind === 'death' ? 0.6 : kind === 'hurt' ? 1.4 : 1.2);
      return;
    case 'polarbear':
      at('bear', kind === 'ambient' ? 0.4 : 0.8, kind === 'death' ? 0.75 : kind === 'hurt' ? 1.2 : 1);
      return;
    case 'blaze':
      at('blaze', kind === 'ambient' ? 0.4 : 0.75, kind === 'death' ? 0.7 : kind === 'hurt' ? 1.3 : 1);
      return;
    case 'magmacube':
      if (kind !== 'ambient') at('magma', 0.7, (kind === 'death' ? 0.7 : 1.2) * (mob.size >= 4 ? 0.7 : mob.size <= 1 ? 1.5 : 1));
      return;
    case 'queen':
      at('queen', kind === 'ambient' ? 0.6 : 1, kind === 'death' ? 0.7 : kind === 'hurt' ? 1.2 : 1);
      return;
    case 'golem':
      if (kind !== 'ambient') at('clank', 0.8, kind === 'death' ? 0.6 : 0.8);
      return;
    default:
  }
}

/**
 * A blow about to land on one of the special monsters: returns what it really takes (0: shrugged
 * off). The Wither's armour turns shots aside; a struck enderman flies into a rage; a ravager
 * caught mid-charge by a critical blow is stunned.
 */
export function onMonsterHurt(g: Game, mob: Actor, amount: number, source: HitSource, how: HitHow): number {
  if (mob.warden === 'hag' && hagShielded(g, mob)) {
    // Her cauldrons keep her: the blow glances off a green glow.
    g.particles.sparks(mob.x, mob.cy, mob.z, ['#4cff8a', '#d0ffd0'], 8, 4, 0.1, 0.4);
    g.ui.damage(0, mob.x, mob.y + mob.h + 0.3, mob.z, 'streak', 'SHIELDED');
    return 0;
  }
  switch (mob.kind) {
    case 'wither':
      return witherHurt(g, mob, amount, how);
    case 'enderman':
      if (source && mob.anger <= 0) provoke(g, mob, false);
      return amount;
    case 'ravager':
      if (mob.act === 'charge' && mob.actT > 0.8 && (source === 'crit' || how === 'blast')) stunRavager(g, mob);
      return amount;
    default:
      return amount;
  }
}

// ------------------------------------------------------------------ dispatch

/** Runs the monsters that think for themselves; false for the classic horde (mobs.ts runs those). */
export function specialMob(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): boolean {
  if (mob.warden && wardenMob(g, mob, dt, grids, worldOnly)) return true;
  switch (mob.kind) {
    case 'enderman':
      enderman(g, mob, dt, grids, worldOnly);
      return true;
    case 'witch':
      witch(g, mob, dt, grids, worldOnly);
      return true;
    case 'slime':
      slime(g, mob, dt, grids, worldOnly);
      return true;
    case 'pillager':
      pillager(g, mob, dt, grids, worldOnly);
      return true;
    case 'vindicator':
      vindicator(g, mob, dt, grids, worldOnly);
      return true;
    case 'evoker':
      evoker(g, mob, dt, grids, worldOnly);
      return true;
    case 'vex':
      vex(g, mob, dt);
      return true;
    case 'ravager':
      ravager(g, mob, dt, grids, worldOnly);
      return true;
    case 'ghast':
      ghast(g, mob, dt);
      return true;
    case 'wither':
      updateWither(g, mob, dt);
      return true;
    case 'veyra':
      // (She flies and fights in finalboss.ts.)
      return true;
    default:
      return beastMob(g, mob, dt, grids, worldOnly);
  }
}

// ------------------------------------------------------------------ helpers

/** The standing spot on top of a column (null: unloaded, or water). */
function groundY(g: Game, x: number, z: number): number | null {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  if (!g.world.chunkAt(ix, iz)) return null;
  const top = g.world.topAt(ix, iz);
  if (top < 0 || g.world.liquid(ix, top, iz) || g.world.liquid(ix, top + 1, iz)) return null;
  return top + 1;
}

/** Free deck spots (world positions) with room for a tall body above them. */
function deckSpots(g: Game, room: number): Array<[number, number, number]> {
  const F = g.fortress;
  const out: Array<[number, number, number]> = [];
  for (const key of F.cells.keys()) {
    if (ky(key) !== 0) continue;
    const x = kx(key);
    const z = kz(key);
    let clear = true;
    for (let y = 1; y <= room; y += 1) if (F.hasBlock(x, y, z)) clear = false;
    if (clear) out.push(F.toWorld(x + 0.5, 1.002, z + 0.5));
  }
  return out;
}

/** Moves an actor in a puff of purple (an enderman's teleport). */
function blink(g: Game, mob: Actor, x: number, y: number, z: number, onDeck: boolean): void {
  purple(g, mob.x, mob.y, mob.z, mob.h);
  mob.x = x;
  mob.y = y;
  mob.z = z;
  mob.vx = mob.vy = mob.vz = 0;
  mob.climb = null;
  mob.standingOn = onDeck ? g.fortress : null;
  mob.onGround = true;
  purple(g, x, y, z, mob.h);
  g.sfxAt('teleport', x, y + 1.5, z, 0.85, 0.9 + Math.random() * 0.2);
}

/** The portal particles an enderman leaves behind. */
function purple(g: Game, x: number, y: number, z: number, h: number): void {
  for (let i = 0; i < 16; i += 1) {
    g.particles.add({
      x: x + (Math.random() - 0.5) * 0.9, y: y + Math.random() * h, z: z + (Math.random() - 0.5) * 0.9,
      vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.3) * 1.5, vz: (Math.random() - 0.5) * 2,
      life: 0.6 + Math.random() * 0.6, size: 0.12 + Math.random() * 0.08, r: 0.78, g: 0.3, b: 1, a: 1, emit: 1.2, gravity: 0.6, drag: 1.5, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 4,
    });
  }
}

/** Teleports an enderman somewhere near (dodging a shot, fleeing the rain, or just wandering). */
export function teleportAway(g: Game, mob: Actor, why: 'dodge' | 'rain' | 'flee'): void {
  if (why !== 'dodge' && mob.tpTimer > 0) return;
  const c = g.fortressCentre();
  for (let tries = 0; tries < 14; tries += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = why === 'flee' ? 14 + Math.random() * 12 : 5 + Math.random() * 9;
    // A thief makes off away from the fortress.
    const ox = why === 'flee' ? c[0] : mob.x;
    const oz = why === 'flee' ? c[2] : mob.z;
    const x = ox + Math.cos(a) * (why === 'flee' ? g.fortressRadius() + r : r);
    const z = oz + Math.sin(a) * (why === 'flee' ? g.fortressRadius() + r : r);
    const y = groundY(g, x, z);
    if (y === null) continue;
    blink(g, mob, Math.floor(x) + 0.5, y, Math.floor(z) + 0.5, false);
    mob.tpTimer = why === 'dodge' ? 0.5 : 2 + Math.random() * 2;
    return;
  }
}

/** Teleports an enderman beside the captain (on the deck, if that is where you are). */
function teleportToPlayer(g: Game, mob: Actor): boolean {
  const p = g.player;
  if (p.standingOn === g.fortress || g.helm) {
    const spots = deckSpots(g, 3).filter(([x, , z]) => {
      const d = Math.hypot(x - p.x, z - p.z);
      return d > 1.8 && d < 4.5;
    });
    const s = spots[Math.floor(Math.random() * spots.length)];
    if (!s) return false;
    blink(g, mob, s[0], s[1], s[2], true);
    return true;
  }
  for (let tries = 0; tries < 10; tries += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * 2;
    const x = p.x + Math.cos(a) * r;
    const z = p.z + Math.sin(a) * r;
    const y = groundY(g, x, z);
    if (y === null || Math.abs(y - p.y) > 2.5) continue;
    blink(g, mob, Math.floor(x) + 0.5, y, Math.floor(z) + 0.5, false);
    return true;
  }
  return false;
}

/** Turns an actor to face a point. */
function face(mob: Actor, x: number, z: number): void {
  mob.yaw = Math.atan2(z - mob.z, x - mob.x);
}

/** Starts a move (an animation the model shows) lasting `dur` seconds. */
function begin(mob: Actor, act: Actor['act'], dur: number): void {
  mob.act = act;
  mob.actT = 0;
  mob.actDur = dur;
}

/** Where a monster that is not after you heads: the nearest planted foot of the fortress. */
function footTarget(g: Game, mob: Actor): [number, number, number] {
  const f = nearestFoot(g, mob);
  if (f.i >= 0) {
    const l = g.walker.legs[f.i]!;
    return [l.foot[0], l.foot[2], f.i];
  }
  const c = g.fortressCentre();
  return [c[0], c[2], -1];
}

/** Whether you are fair game for a ground monster this close (not riding a leap, not far above). */
function playerWithin(g: Game, mob: Actor, range: number, dy = 3.5): boolean {
  const p = g.player;
  return !p.dead && !g.leap && Math.hypot(p.x - mob.x, p.z - mob.z) < range && Math.abs(p.y - mob.y) < dy;
}

// ------------------------------------------------------------------ enderman

/** Blocks an enderman will lift out of your hull (never the machinery). */
const STEALABLE = new Set<number>([
  B.PLANKS, B.SPRUCE_PLANKS, B.COBBLE, B.STONE_BRICKS, B.SMOOTH_STONE, B.WOOL, B.RED_WOOL, B.GLASS, B.LOG, B.SPRUCE_LOG, B.BIRCH_LOG,
  B.HAY, B.BARREL, B.BOOKSHELF, B.MOSSY_COBBLE, B.BRICKS, B.MOSSY_STONE_BRICKS, B.CRACKED_STONE_BRICKS, B.IRON_BLOCK, B.SANDSTONE,
  B.CUT_SANDSTONE, B.TERRACOTTA, B.DIRT, B.SAND, B.GRAVEL, B.SNOW, B.GLOWSTONE, B.REDSTONE_LAMP, B.FENCE,
]);

/**
 * Something seen it look back: it shakes and screams, then comes for you (Minecraft's enderman
 * stare). Hit first (or stared at), it stays angry for half a minute.
 */
function provoke(g: Game, mob: Actor, stare: boolean): void {
  mob.anger = 30;
  mob.stare = 0;
  if (stare) {
    begin(mob, 'scream', 0.9);
    g.sfxAt('scream', mob.x, mob.y + 2.5, mob.z, 1);
    g.crewSay('enderman');
    g.buzz(40);
  }
}

/** Whether the captain is looking an enderman in the eye (a narrow cone, the head in plain sight). */
function staredAt(g: Game, mob: Actor): boolean {
  const p = g.player;
  if (p.dead || g.phase !== 'night') return false;
  const ray = g.viewRay();
  const hx = mob.x;
  const hy = mob.y + mob.h - 0.35;
  const hz = mob.z;
  const dx = hx - ray.ox;
  const dy = hy - ray.oy;
  const dz = hz - ray.oz;
  const d = Math.hypot(dx, dy, dz);
  if (d > 48 || d < 1) return false;
  const cos = (dx * ray.dx + dy * ray.dy + dz * ray.dz) / d;
  const cone = (g.camPull > 0.5 ? 0.025 : 0.04) + (g.camPull > 0.5 ? 0.25 : 0.4) / d;
  if (cos < Math.cos(cone)) return false;
  return hasLineOfSight(g, ray.ox, ray.oy, ray.oz, hx, hy, hz);
}

/** A block worth stealing near a spot on the deck: an exposed top block, not machinery. */
function stealTarget(g: Game, wx: number, wz: number): number | null {
  const F = g.fortress;
  const [lx, , lz] = F.toLocal(wx, F.y, wz);
  let best: number | null = null;
  let bestScore = Infinity;
  for (const [key, cell] of F.cells) {
    if (!STEALABLE.has(cell.id)) continue;
    const x = kx(key);
    const y = ky(key);
    const z = kz(key);
    if (F.hasBlock(x, y + 1, z)) continue;
    const d = Math.hypot(x + 0.5 - lx, z + 0.5 - lz);
    if (d > 4.5) continue;
    // Walls and rails above the deck first; the deck floor itself only at a pinch.
    const score = d + (y === 0 ? 6 : 0) + Math.random() * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

function enderman(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const p = g.player;
  mob.tpTimer -= dt;
  mob.aux -= dt;
  mob.anger = Math.max(0, mob.anger - dt);
  // Water and rain burn them: they flinch away from it, teleporting about.
  const rain = g.weather.storm > 0.5 && g.world.skyAt(Math.floor(mob.x), Math.floor(mob.y + 2.6), Math.floor(mob.z)) >= 14;
  if (rain || g.inWater(mob)) {
    mob.shootTimer -= dt;
    if (mob.shootTimer <= 0) {
      mob.shootTimer = 1;
      damageMob(g, mob, 1, 0, 0);
      if (mob.dead) return;
      teleportAway(g, mob, 'rain');
    }
  }
  if (mob.act === 'scream') {
    // Shaking with rage, jaw wide, before it comes for you.
    mob.actT += dt;
    face(mob, p.x, p.z);
    mob.vx = mob.vz = 0;
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      if (!teleportToPlayer(g, mob)) mob.tpTimer = 0;
    }
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    return;
  }
  if (mob.act === 'grab') {
    // Bent over the hull, prising a block loose.
    mob.actT += dt;
    mob.vx = mob.vz = 0;
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      const key = stealTarget(g, mob.x, mob.z);
      const F = g.fortress;
      if (key !== null && mob.carry === 0) {
        const cell = F.cells.get(key)!;
        const q = F.cellCenter(kx(key), ky(key), kz(key));
        g.particles.debris(q.x, q.y, q.z, 'planks_oak', 6, 2);
        purple(g, q.x, q.y - 0.5, q.z, 1);
        mob.carry = cell.id;
        F.removeBlock(kx(key), ky(key), kz(key));
        checkFortressIntegrity(g);
        g.toast('An ENDERMAN stole a block from your fortress! Kill it to get it back', 'ui_eye');
        g.crewSay('thief');
      }
      mob.tpTimer = 0;
      teleportAway(g, mob, 'flee');
      mob.aux = 25 + Math.random() * 20;
    }
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    return;
  }
  // Stared at: it notices (a moment of eye contact is enough).
  if (mob.anger <= 0) {
    if (staredAt(g, mob)) {
      mob.stare += dt;
      if (mob.stare > 0.3) provoke(g, mob, true);
    } else mob.stare = Math.max(0, mob.stare - dt * 2);
  }
  let tx = mob.x;
  let tz = mob.z;
  let speed = 0;
  if (mob.anger > 0 && !p.dead) {
    const d = Math.hypot(p.x - mob.x, p.z - mob.z);
    // Far off (or out of reach above or below): it simply appears beside you.
    if ((d > 10 || Math.abs(p.y - mob.y) > 3) && mob.tpTimer <= 0) {
      mob.tpTimer = 2.5 + Math.random() * 1.5;
      teleportToPlayer(g, mob);
    }
    tx = p.x;
    tz = p.z;
    speed = mob.speed * 1.35;
    meleeTick(g, mob, dt, { reach: 1.7, windup: 0.32, damage: 4 + Math.floor(g.danger / 2), knock: 7, rest: 1.1 });
  } else if (mob.carry === 0 && mob.aux <= 0 && g.phase === 'night' && !rain) {
    // A thief: it blinks onto your deck, lifts out a block and blinks away with it.
    mob.aux = 20 + Math.random() * 15;
    const spots = deckSpots(g, 3);
    const s = spots[Math.floor(Math.random() * spots.length)];
    if (s && stealTarget(g, s[0], s[2]) !== null && Math.hypot(s[0] - p.x, s[2] - p.z) > 3) {
      blink(g, mob, s[0], s[1], s[2], true);
      begin(mob, 'grab', 1.2);
      return;
    }
  } else {
    // Calm: it potters about (a thief makes off from the fortress), now and then blinking elsewhere.
    const c = g.fortressCentre();
    if (mob.carry !== 0) {
      const ax = mob.x - c[0];
      const az = mob.z - c[2];
      const l = Math.hypot(ax, az) || 1;
      tx = mob.x + (ax / l) * 4;
      tz = mob.z + (az / l) * 4;
      speed = mob.speed * 0.8;
    } else {
      tx = mob.homeX + Math.cos(g.time * 0.2 + mob.homeZ) * 6;
      tz = mob.homeZ + Math.sin(g.time * 0.17 + mob.homeX) * 6;
      speed = Math.hypot(tx - mob.x, tz - mob.z) > 1.5 ? mob.speed * 0.45 : 0;
    }
    if (mob.tpTimer <= 0 && Math.random() < dt * 0.08) teleportAway(g, mob, 'rain');
  }
  let dx = tx - mob.x;
  let dz = tz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  if (speed > 0) mob.yaw = Math.atan2(dz, dx);
  walkStep(g, mob, dx, dz, speed, dt, grids, worldOnly);
  if (mob.stuck > 2 && mob.tpTimer <= 0) teleportAway(g, mob, 'rain');
}

// ------------------------------------------------------------------ witch

/** Splash potion colours (Minecraft's). */
export const POTION_RGB: Record<string, [number, number, number]> = {
  heal: [0.97, 0.14, 0.14],
  swift: [0.49, 0.69, 0.78],
  poison: [0.31, 0.58, 0.19],
  slowness: [0.35, 0.42, 0.51],
  weakness: [0.28, 0.3, 0.28],
  harm: [0.26, 0.04, 0.04],
};

/**
 * Which brew a witch throws, by Minecraft's rules: slowness at a captain who is far off and not yet
 * slowed, poison at one who is healthy and not yet poisoned, weakness up close, harming otherwise.
 */
function brewFor(g: Game, d: number): Actor['potion'] {
  const p = g.player;
  if (d > 8 && !hasEffect(g, 'slowness')) return 'slowness';
  if (p.hp >= 8 && !hasEffect(g, 'poison')) return 'poison';
  if (d <= 3 && !hasEffect(g, 'weakness') && Math.random() < 0.25) return 'weakness';
  return 'harm';
}

function witch(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const p = g.player;
  mob.aux -= dt;
  mob.anger = Math.max(0, mob.anger - dt);
  if (Math.random() < dt * 0.6) g.particles.add({ x: mob.x + (Math.random() - 0.5) * 0.6, y: mob.y + 2.1, z: mob.z + (Math.random() - 0.5) * 0.6, vy: 0.5, life: 0.9, size: 0.1, r: 0.6, g: 0.3, b: 0.8, a: 0.9, emit: 0.6, gravity: -0.3, drag: 1, tile: 'spark', soft: true });
  // Drinking: a healing potion when hurt, swiftness when the prey is far.
  if (mob.act === 'drink') {
    mob.actT += dt;
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      const rgb = POTION_RGB[mob.potion] ?? [1, 1, 1];
      if (mob.potion === 'heal') {
        mob.hp = Math.min(mob.maxHp, mob.hp + 8 + g.danger);
        g.ui.damage(0, mob.x, mob.y + mob.h + 0.3, mob.z, 'streak', 'HEALED!');
      } else mob.anger = 9;
      for (let i = 0; i < 18; i += 1) g.particles.add({ x: mob.x + (Math.random() - 0.5), y: mob.y + Math.random() * mob.h, z: mob.z + (Math.random() - 0.5), vy: 0.8 + Math.random(), life: 0.9, size: 0.14, r: rgb[0], g: rgb[1], b: rgb[2], a: 1, emit: 0.8, gravity: -0.5, drag: 1.2, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 3 });
      mob.potion = '';
      mob.aux = 7;
    }
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    return;
  }
  const near = playerWithin(g, mob, 20, 14);
  const d = Math.hypot(p.x - mob.x, p.z - mob.z);
  if (mob.hp < mob.maxHp * 0.5 && mob.aux <= 0) {
    mob.potion = 'heal';
    begin(mob, 'drink', 1.4);
    g.sfxAt('drink', mob.x, mob.y + 1.6, mob.z, 0.9);
    return;
  }
  if (near && d > 12 && mob.anger <= 0 && mob.aux <= 0) {
    mob.potion = 'swift';
    begin(mob, 'drink', 0.9);
    g.sfxAt('drink', mob.x, mob.y + 1.6, mob.z, 0.8, 1.15);
    return;
  }
  if (mob.act === 'throw') {
    mob.actT += dt;
    face(mob, p.x, p.z);
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      throwPotion(g, mob, p.x, p.y + 1, p.z, mob.potion);
      mob.potion = '';
    }
  } else if (near && mob.shootTimer <= 0 && d < 16 && hasLineOfSight(g, mob.x, mob.y + 1.7, mob.z, p.x, p.y + 1.5, p.z)) {
    mob.shootTimer = 2.6 + Math.random() * 1.6;
    mob.potion = brewFor(g, Math.hypot(p.x - mob.x, p.y - mob.y, p.z - mob.z));
    begin(mob, 'throw', 0.5);
  }
  // Keeps a stone's throw away, sidling round.
  let tx: number;
  let tz: number;
  if (near) {
    const ux = (p.x - mob.x) / (d || 1);
    const uz = (p.z - mob.z) / (d || 1);
    const k = d > 11 ? 1 : d < 6 ? -1 : 0;
    tx = mob.x + ux * k - uz * mob.strafe * 0.5;
    tz = mob.z + uz * k + ux * mob.strafe * 0.5;
    mob.strafeT -= dt;
    if (mob.strafeT <= 0) {
      mob.strafeT = 2 + Math.random() * 2;
      mob.strafe = -mob.strafe;
    }
  } else {
    // Out of reach of you: she hangs about the fortress, waiting.
    const c = g.fortressCentre();
    const r = g.fortressRadius() + 9;
    const a = Math.atan2(mob.z - c[2], mob.x - c[0]) + 0.15;
    tx = c[0] + Math.cos(a) * r;
    tz = c[2] + Math.sin(a) * r;
  }
  let dx = tx - mob.x;
  let dz = tz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const speed = l > 0.4 ? mob.speed * (mob.anger > 0 ? 1.7 : 1) : 0;
  if (near) face(mob, p.x, p.z);
  else if (speed > 0) mob.yaw = Math.atan2(dz, dx);
  walkStep(g, mob, dx, dz, speed, dt, grids, worldOnly);
}

/** A splash potion lobbed in an arc at a point. */
export function throwPotion(g: Game, mob: Actor, tx: number, ty: number, tz: number, brew: Actor['potion']): void {
  const sx = mob.x + Math.cos(mob.yaw) * 0.5;
  const sy = mob.y + 1.9;
  const sz = mob.z + Math.sin(mob.yaw) * 0.5;
  const d = Math.hypot(tx - sx, tz - sz);
  const t = clamp(d / 11, 0.45, 1.3);
  const grav = 18;
  const effect: EffectId | undefined = brew === 'poison' || brew === 'slowness' || brew === 'weakness' ? brew : undefined;
  g.projectiles.push({
    kind: 'potion', x: sx, y: sy, z: sz,
    vx: (tx - sx) / t + (Math.random() - 0.5) * 0.8, vy: (ty - sy + 0.5 * grav * t * t) / t, vz: (tz - sz) / t + (Math.random() - 0.5) * 0.8,
    age: 0, life: t + 1.5, spin: 0, fromCrew: false, owner: mob, effect,
  });
  g.sfxAt('witch', mob.x, mob.y + 1.8, mob.z, 0.4, 1.2);
}

/** A splash potion breaks: a burst of its colour, and its brew on whoever stands in the splash. */
export function potionSplash(g: Game, pr: Projectile): void {
  const key = pr.effect ?? 'harm';
  const rgb = POTION_RGB[key] ?? [1, 1, 1];
  for (let i = 0; i < 26; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 3;
    g.particles.add({ x: pr.x, y: pr.y + 0.2, z: pr.z, vx: Math.cos(a) * s, vy: 1 + Math.random() * 2.5, vz: Math.sin(a) * s, life: 0.8 + Math.random() * 0.5, size: 0.15, r: rgb[0], g: rgb[1], b: rgb[2], a: 1, emit: 0.7, gravity: 4, drag: 1.5, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 3 });
  }
  g.particles.ring(pr.x, pr.y + 0.3, pr.z, 2.4, rgb[0], rgb[1], rgb[2]);
  g.particles.debris(pr.x, pr.y + 0.2, pr.z, 'glass', 5, 2.5, 0.08, 0.5);
  g.sfxAt('splash', pr.x, pr.y, pr.z, 1);
  g.eachPlayer((p) => {
    if (p.dead || Math.hypot(p.x - pr.x, p.cy - pr.y, p.z - pr.z) > 2.8) return;
    if (pr.effect) {
      addEffect(g, pr.effect, pr.effect === 'poison' ? 9 : 12);
      g.toast(pr.effect === 'poison' ? 'POISONED! Your hearts drain' : pr.effect === 'slowness' ? 'SLOWED by a witch\'s potion' : 'WEAKENED: your blows are softer', 'potion_item');
    } else damagePlayer(g, 3 + Math.floor(g.danger / 2), 0, 0);
  });
}

// ------------------------------------------------------------------ slime

/** A slime bounces at you (or at the fortress's feet): a squash, a leap, a wet slap on landing. */
export function slime(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const p = g.player;
  const wasAir = !mob.onGround;
  mob.aux -= dt;
  mob.actT = Math.max(0, mob.actT - dt);
  const chase = playerWithin(g, mob, 16, 4);
  const [fx, fz] = chase ? [p.x, p.z] : footTarget(g, mob);
  let dx = fx - mob.x;
  let dz = fz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  if (mob.act === 'pounce') {
    // Squashing down for the jump.
    mob.actT = 0;
    mob.aux += dt;
    if (mob.aux >= 0) {
      mob.act = 'none';
      mob.vy = 5.5 + mob.size * 0.55;
      mob.vx = dx * mob.speed * 1.8;
      mob.vz = dz * mob.speed * 1.8;
      mob.onGround = false;
      mob.standingOn = null;
      mob.aux = 0.7 + Math.random() * 0.8 + mob.size * 0.12;
    }
  } else if (mob.onGround && mob.aux <= 0) {
    mob.act = 'pounce';
    mob.aux = -0.22;
    mob.yaw = Math.atan2(dz, dx);
  }
  walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly, true);
  if (mob.onGround && wasAir) {
    // Splat.
    mob.actT = 0.3;
    mob.vx = mob.vz = 0;
    g.sfxAt('slime', mob.x, mob.y, mob.z, 0.55 + mob.size * 0.1, mob.size >= 4 ? 0.7 : mob.size <= 1 ? 1.5 : 1);
    for (let i = 0; i < 4 + mob.size * 2; i += 1) {
      const a = Math.random() * Math.PI * 2;
      g.particles.add({ x: mob.x + Math.cos(a) * mob.hw, y: mob.y + 0.1, z: mob.z + Math.sin(a) * mob.hw, vx: Math.cos(a) * 1.5, vy: 1.5 + Math.random(), vz: Math.sin(a) * 1.5, life: 0.5, size: 0.1 + mob.size * 0.02, r: 0.45, g: 0.82, b: 0.35, gravity: 14, drag: 0.5 });
    }
    // A big one landing on a foot gums up the leg.
    if (mob.size >= 4) {
      const f = nearestFoot(g, mob);
      if (f.i >= 0 && f.d < 2.2) damageLeg(g, f.i, 0.03);
    }
  }
  // Big and medium slimes hurt on touch; the little ones are harmless (as in Minecraft).
  if (mob.size >= 2 && !p.dead && mob.shootTimer <= 0 && Math.hypot(p.x - mob.x, p.z - mob.z) < mob.hw + 0.6 && p.y < mob.y + mob.h && p.y + p.h > mob.y) {
    mob.shootTimer = 1;
    const k = 1 / (Math.hypot(p.x - mob.x, p.z - mob.z) || 1);
    damagePlayer(g, mob.size >= 4 ? 4 + Math.floor(g.danger / 2) : 2 + Math.floor(g.danger / 3), (p.x - mob.x) * k * 5, (p.z - mob.z) * k * 5);
  }
}

/** A big slime breaks into smaller ones as it dies. */
export function splitSlime(g: Game, mob: Actor): void {
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + Math.random();
    const s = new Actor(mob.kind === 'magmacube' ? 'magmacube' : 'slime', mob.x + Math.cos(a) * 0.4, mob.y + 0.3, mob.z + Math.sin(a) * 0.4);
    setSlimeSize(s, mob.size / 2);
    scaleHealth(g, s);
    s.vx = Math.cos(a) * 3;
    s.vz = Math.sin(a) * 3;
    s.vy = 4;
    s.aux = 0.6 + Math.random() * 0.6;
    s.raid = -1;
    g.mobs.push(s);
  }
  g.sfxAt(mob.kind === 'magmacube' ? 'magma' : 'slime', mob.x, mob.y, mob.z, 1, 0.8);
  if (mob.size >= 4 && mob.kind === 'slime') feat(g, 'slime');
}

// ------------------------------------------------------------------ illagers

/**
 * Where a raider goes: at you if you are close on the ground, else for the fortress (vindicators
 * climb its legs, pillagers and evokers stand off and shoot).
 */
function raiderGoal(g: Game, mob: Actor, standOff: number): { x: number; z: number; you: boolean } {
  const p = g.player;
  if (playerWithin(g, mob, mob.kind === 'vindicator' ? 16 : 26, mob.kind === 'vindicator' ? 3 : 14)) return { x: p.x, z: p.z, you: true };
  const c = g.fortressCentre();
  if (standOff <= 0) {
    const [fx, fz] = footTarget(g, mob);
    return { x: fx, z: fz, you: false };
  }
  const a = Math.atan2(mob.z - c[2], mob.x - c[0]);
  const r = g.fortressRadius() + standOff;
  return { x: c[0] + Math.cos(a) * r, z: c[2] + Math.sin(a) * r, you: false };
}

/** A pillager: it loads its crossbow (you can see the bolt go in), aims, and fires flat and fast. */
function pillager(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const p = g.player;
  const goal = raiderGoal(g, mob, 12);
  const d = Math.hypot(p.x - mob.x, p.z - mob.z);
  const canSee = !p.dead && d < 30 && hasLineOfSight(g, mob.x, mob.y + 1.6, mob.z, p.x, p.y + 1.4, p.z);
  if (canSee) face(mob, p.x, p.z);
  if (mob.act === 'draw') {
    mob.actT += dt;
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      mob.aux = 0.35;
    }
  } else if (mob.aux > 0) {
    // Crossbow loaded and raised: it fires once it has you in sight.
    mob.aux -= dt;
    if (mob.aux <= 0) {
      if (canSee) shootBolt(g, mob, p.x, p.y + 1.1, p.z);
      else {
        // No line on you: a bolt into your hull instead.
        const c = g.fortressCentre();
        if (Math.hypot(c[0] - mob.x, c[2] - mob.z) < g.fortressRadius() + 22) shootBolt(g, mob, c[0] + (Math.random() - 0.5) * 6, c[1] + 1.5, c[2] + (Math.random() - 0.5) * 6);
      }
      mob.shootTimer = 1.2 + Math.random() * 1.2;
    }
  } else if (mob.shootTimer <= 0) {
    begin(mob, 'draw', 1.05);
    g.sfxAt('crossbow', mob.x, mob.y + 1.5, mob.z, 0.35, 0.7);
  }
  if (mob.mount) return;
  let tx = goal.x;
  let tz = goal.z;
  if (goal.you) {
    const ux = (p.x - mob.x) / (d || 1);
    const uz = (p.z - mob.z) / (d || 1);
    const k = d > 14 ? 1 : d < 8 ? -1 : 0;
    tx = mob.x + ux * k - uz * mob.strafe * 0.6;
    tz = mob.z + uz * k + ux * mob.strafe * 0.6;
    mob.strafeT -= dt;
    if (mob.strafeT <= 0) {
      mob.strafeT = 1.5 + Math.random() * 2;
      mob.strafe = -mob.strafe;
    }
  }
  let dx = tx - mob.x;
  let dz = tz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  if (!canSee && l > 0.5) mob.yaw = Math.atan2(dz, dx);
  walkStep(g, mob, dx, dz, l > 0.5 ? mob.speed * (mob.act === 'draw' ? 0.6 : 1) : 0, dt, grids, worldOnly);
}

/** A pillager's crossbow bolt: fast and nearly flat. */
function shootBolt(g: Game, mob: Actor, tx: number, ty: number, tz: number): void {
  const sx = mob.x + Math.cos(mob.yaw) * 0.6;
  const sy = mob.y + 1.45;
  const sz = mob.z + Math.sin(mob.yaw) * 0.6;
  const d = Math.hypot(tx - sx, ty - sy, tz - sz);
  const t = Math.max(0.1, d / 34);
  const grav = 4;
  g.projectiles.push({
    kind: 'ibolt', x: sx, y: sy, z: sz,
    vx: (tx - sx) / t + (Math.random() - 0.5) * 0.6, vy: (ty - sy + 0.5 * grav * t * t) / t, vz: (tz - sz) / t + (Math.random() - 0.5) * 0.6,
    age: 0, life: t + 1, spin: 0, fromCrew: false, owner: mob,
  });
  g.sfxAt('crossbow', mob.x, mob.y + 1.5, mob.z, 0.8, 0.85);
}

/** A vindicator: an axe and a run. On the ground it hunts you; otherwise it climbs and chops the hull. */
function vindicator(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  if (mob.mount) return;
  const deck = onFortress(g, mob);
  const p = g.player;
  if (mob.climb) return;
  const goal = deck && !playerWithin(g, mob, 12, 3) ? coreGoal(g) : raiderGoal(g, mob, 0);
  if (!deck && !goal.you) {
    const f = nearestFoot(g, mob);
    if (f.i >= 0 && f.d < 1.7 && g.phase === 'night') {
      mob.climb = { leg: f.i, t: 0, swinging: false };
      return;
    }
  }
  if (deck && !goal.you) {
    const F = g.fortress;
    // Chopping at the hull: the axe bites deep.
    const [lx, ly, lz] = F.toLocal(mob.x, mob.y, mob.z);
    let target: number | null = null;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = Math.floor(lx + ox * 0.9);
      const z = Math.floor(lz + oz * 0.9);
      const y = Math.floor(ly + 0.5);
      if (F.solidAt(x, y, z)) {
        target = (y + 64) * 16384 + (z + 64) * 128 + (x + 64);
        break;
      }
    }
    if (target !== null && mob.attackTimer <= 0) {
      mob.attackTimer = 1.1;
      mob.windup = 0.3;
      damageFortressCell(g, target, 3 + g.danger * 0.8);
      g.sfx('hit', 'wood', 0.6);
    }
  }
  meleeTick(g, mob, dt, { reach: 1.55, windup: 0.36, damage: 5 + Math.floor(g.danger / 2), knock: 7, rest: 1.05 });
  let dx = goal.x - mob.x;
  let dz = goal.z - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  mob.yaw = Math.atan2(dz, dx);
  const speed = l > 0.8 ? mob.speed * (goal.you && Math.hypot(p.x - mob.x, p.z - mob.z) < 9 ? 1.25 : 1) : 0;
  walkStep(g, mob, dx, dz, speed, dt, grids, worldOnly);
}

/** On the deck: the Engine Core. */
function coreGoal(g: Game): { x: number; z: number; you: boolean } {
  const F = g.fortress;
  const key = g.coreKey();
  if (key === null) {
    const c = g.fortressCentre();
    return { x: c[0], z: c[2], you: false };
  }
  const q = F.cellCenter(kx(key), ky(key), kz(key));
  return { x: q.x, z: q.z, you: false };
}

/**
 * An evoker: it keeps its distance and casts. Fangs burst out of the ground in a line at you (or
 * ring it when you get close), and every so often it raises three vexes. With you out of reach it
 * sends its fangs into the fortress's feet.
 */
function evoker(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const p = g.player;
  mob.aux -= dt;
  const goal = raiderGoal(g, mob, 10);
  const d = Math.hypot(p.x - mob.x, p.z - mob.z);
  if (goal.you) face(mob, p.x, p.z);
  if (mob.act === 'fangs' || mob.act === 'summon') {
    mob.actT += dt;
    // Spell particles rise off its raised hands.
    if (Math.random() < dt * 30) {
      const fang = mob.act === 'fangs';
      g.particles.add({ x: mob.x + (Math.random() - 0.5) * 1.2, y: mob.y + 2 + Math.random() * 0.4, z: mob.z + (Math.random() - 0.5) * 1.2, vy: 1.2, life: 0.8, size: 0.12, r: fang ? 0.65 : 0.75, g: fang ? 0.35 : 0.75, b: fang ? 0.75 : 0.8, a: 1, emit: 1, gravity: -0.4, drag: 1.2, tile: 'spark', soft: true });
    }
    if (mob.actT >= mob.actDur) {
      if (mob.act === 'fangs') castFangs(g, mob, goal.you, d);
      else summonVexes(g, mob);
      mob.act = 'none';
    }
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    return;
  }
  const vexes = g.mobs.filter((m) => !m.dead && m.kind === 'vex').length;
  if (mob.shootTimer <= 0 && vexes < 4 && (goal.you || d < 40)) {
    mob.shootTimer = 16 + Math.random() * 6;
    begin(mob, 'summon', 1.5);
    g.sfxAt('cast', mob.x, mob.y + 2, mob.z, 1, 0.85);
    monsterVoice(g, mob, 'attack');
    return;
  }
  if (mob.aux <= 0) {
    mob.aux = 4.5 + Math.random() * 2;
    const footNear = nearestFoot(g, mob);
    if (goal.you || footNear.d < 18) {
      begin(mob, 'fangs', 1);
      g.sfxAt('cast', mob.x, mob.y + 2, mob.z, 0.8, 1.1);
      return;
    }
  }
  if (mob.mount) return;
  let tx = goal.x;
  let tz = goal.z;
  if (goal.you) {
    const ux = (p.x - mob.x) / (d || 1);
    const uz = (p.z - mob.z) / (d || 1);
    const k = d > 12 ? 1 : d < 7 ? -1 : 0;
    tx = mob.x + ux * k - uz * mob.strafe * 0.4;
    tz = mob.z + uz * k + ux * mob.strafe * 0.4;
  }
  let dx = tx - mob.x;
  let dz = tz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  if (!goal.you && l > 0.5) mob.yaw = Math.atan2(dz, dx);
  walkStep(g, mob, dx, dz, l > 0.5 ? mob.speed : 0, dt, grids, worldOnly);
}

/** Lays a line of fangs from the evoker to its target (or a ring round it when you are right there). */
function castFangs(g: Game, mob: Actor, atYou: boolean, d: number): void {
  const p = g.player;
  if (atYou && d < 3.2) {
    // Too close: two rings of fangs round the caster.
    for (let i = 0; i < 5; i += 1) addFang(g, mob.x + Math.cos((i / 5) * Math.PI * 2) * 1.5, mob.z + Math.sin((i / 5) * Math.PI * 2) * 1.5, mob.y, (i / 5) * Math.PI * 2, 0);
    for (let i = 0; i < 8; i += 1) addFang(g, mob.x + Math.cos((i / 8) * Math.PI * 2 + 0.4) * 2.5, mob.z + Math.sin((i / 8) * Math.PI * 2 + 0.4) * 2.5, mob.y, (i / 8) * Math.PI * 2, 0.15);
    return;
  }
  let tx = p.x;
  let tz = p.z;
  if (!atYou) {
    const [fx, fz] = footTarget(g, mob);
    tx = fx;
    tz = fz;
  }
  const yaw = Math.atan2(tz - mob.z, tx - mob.x);
  const n = 16;
  for (let i = 0; i < n; i += 1) {
    const r = 1.25 * (i + 1);
    addFang(g, mob.x + Math.cos(yaw) * r, mob.z + Math.sin(yaw) * r, mob.y, yaw, i * 0.05);
  }
}

function addFang(g: Game, x: number, z: number, y0: number, yaw: number, delay: number): void {
  // Fangs only rise from solid ground within a couple of blocks of the caster's footing.
  let y: number | null = null;
  for (let dy = 2; dy >= -3; dy -= 1) {
    const yy = Math.floor(y0) + dy;
    if (g.world.solid(Math.floor(x), yy - 1, Math.floor(z)) && !g.world.solid(Math.floor(x), yy, Math.floor(z))) {
      y = yy;
      break;
    }
  }
  if (y === null) return;
  g.fangs.push({ x, y, z, yaw, t: -delay, bit: false });
}

/** Fangs rise, snap (biting whoever stands on them, illagers aside) and sink back. */
export function updateFangs(g: Game, dt: number): void {
  if (g.fangs.length === 0) return;
  for (const f of g.fangs) {
    const before = f.t;
    f.t += dt;
    if (before < 0 && f.t >= 0) {
      g.sfxAt('fangs', f.x, f.y, f.z, 0.7, 0.9 + Math.random() * 0.2);
      g.particles.debris(f.x, f.y + 0.1, f.z, 'stone', 3, 2, 0.08, 0.4);
    }
    if (f.bit || f.t < 0.28) continue;
    f.bit = true;
    g.eachPlayer((p) => {
      if (!p.dead && Math.hypot(p.x - f.x, p.z - f.z) < 0.95 && Math.abs(p.y - f.y) < 1.5) damagePlayer(g, 4 + Math.floor(g.day / 3), 0, 0);
    });
    for (const m of g.mobs) {
      if (m.dead || m.raid >= 0 || m.kind === 'vex' || m.flying) continue;
      if (Math.hypot(m.x - f.x, m.z - f.z) < 0.9 && Math.abs(m.y - f.y) < 1.5) damageMob(g, m, 6, 0, 0);
    }
    // Fangs at a fortress foot gnaw the leg.
    g.walker.legs.forEach((l, i) => {
      if (Math.hypot(l.foot[0] - f.x, l.foot[2] - f.z) < 1.8 && Math.abs(l.foot[1] - f.y) < 2) damageLeg(g, i, 0.03);
    });
  }
  g.fangs = g.fangs.filter((f) => f.t < 0.95);
}

/** Three vexes spring out of the air round the evoker. */
function summonVexes(g: Game, mob: Actor): void {
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + Math.random();
    const v = new Actor('vex', mob.x + Math.cos(a) * 1.2, mob.y + 2, mob.z + Math.sin(a) * 1.2);
    scaleHealth(g, v);
    v.life = 30 + Math.random() * 30;
    v.homeX = a;
    v.aux = 1.5 + Math.random() * 2;
    v.raid = -1;
    g.mobs.push(v);
    for (let k = 0; k < 8; k += 1) g.particles.add({ x: v.x, y: v.y, z: v.z, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3, life: 0.6, size: 0.15, r: 0.85, g: 0.9, b: 1, a: 1, emit: 1, gravity: 0, drag: 2, tile: 'spark', soft: true });
  }
  g.sfxAt('vex', mob.x, mob.y + 2, mob.z, 0.9);
}

/**
 * A vex: a little winged spirit with a sword that flies straight through walls. It circles you,
 * then charges (glowing red, as in Minecraft); its borrowed life runs out after a while.
 */
function vex(g: Game, mob: Actor, dt: number): void {
  const p = g.player;
  mob.life -= dt;
  mob.aux -= dt;
  if (mob.life <= 0) {
    mob.life = 1;
    damageMob(g, mob, 1, 0, 0);
    if (mob.dead) return;
  }
  mob.walkPhase += dt * 14;
  const target = p.dead ? null : p;
  if (!target) {
    steerFlier(g, mob, mob.x, mob.y + 1, mob.z, 2, dt, 3, 0.3);
    return;
  }
  if (mob.act === 'charge') {
    mob.actT += dt;
    steerFlier(g, mob, p.x, p.y + 1.2, p.z, 10, dt, 7, 0.3);
    if (Math.hypot(p.x - mob.x, p.y + 1.1 - mob.cy, p.z - mob.z) < 1) {
      damagePlayer(g, 3 + Math.floor(g.day / 4), mob.vx * 0.3, mob.vz * 0.3);
      mob.act = 'none';
      mob.aux = 2 + Math.random() * 2;
    }
    if (mob.actT > 1.8) {
      mob.act = 'none';
      mob.aux = 1.5;
    }
    return;
  }
  mob.homeX += dt * 1.6;
  const r = 3.2 + Math.sin(g.time * 1.3 + mob.homeX) * 0.8;
  steerFlier(g, mob, p.x + Math.cos(mob.homeX) * r, p.y + 2.4 + Math.sin(g.time * 2 + mob.homeX) * 0.6, p.z + Math.sin(mob.homeX) * r, 5, dt, 4, 0.3);
  mob.yaw = Math.atan2(p.z - mob.z, p.x - mob.x);
  if (mob.aux <= 0) {
    begin(mob, 'charge', 1.8);
    g.sfxAt('vex', mob.x, mob.y, mob.z, 0.8, 1 + Math.random() * 0.2);
  }
}

// ------------------------------------------------------------------ ravager

/** Hit hard in the middle of its charge: it reels, dizzy, then roars. */
function stunRavager(g: Game, mob: Actor): void {
  begin(mob, 'stunned', 2.2);
  mob.vx *= 0.2;
  mob.vz *= 0.2;
  g.ui.damage(0, mob.x, mob.y + mob.h + 0.6, mob.z, 'big', 'STUNNED!');
  g.sfxAt('ram', mob.x, mob.y, mob.z, 0.7);
  g.freeze(0.08);
}

/**
 * A ravager: a horned beast as big as a cart. It goes for you on the ground, or for the fortress's
 * feet: it paws the earth, lowers its horns and charges (a hit buckles a leg). Strike it hard
 * mid-charge and it reels, stunned; then it ROARS, and everything near is thrown back.
 */
function ravager(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const p = g.player;
  mob.aux -= dt;
  const atYou = playerWithin(g, mob, 16, 3);
  const [fx, fz, leg] = footTarget(g, mob);
  const tx = atYou ? p.x : fx;
  const tz = atYou ? p.z : fz;
  const d = Math.hypot(tx - mob.x, tz - mob.z);
  if (mob.act === 'stunned') {
    mob.actT += dt;
    if (Math.random() < dt * 6) g.particles.sparks(mob.x, mob.y + mob.h + 0.3, mob.z, ['#ffe070', '#ffffff'], 1, 1.2, 0.07, 0.45);
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    if (mob.actT >= mob.actDur) {
      begin(mob, 'roar', 0.9);
      g.sfxAt('roar', mob.x, mob.y + 1.5, mob.z, 1);
    }
    return;
  }
  if (mob.act === 'roar') {
    mob.actT += dt;
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    if (mob.actT >= 0.35 && mob.actT - dt < 0.35) roarBlast(g, mob);
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      mob.aux = 3;
    }
    return;
  }
  if (mob.act === 'charge') {
    mob.actT += dt;
    const dx = Math.cos(mob.wanderYaw);
    const dz = Math.sin(mob.wanderYaw);
    mob.yaw = mob.wanderYaw;
    if (mob.actT < 0.8) {
      // Pawing the ground, head down.
      if (Math.random() < dt * 12) g.particles.dust(mob.x + dx * 0.8, mob.y + 0.1, mob.z + dz * 0.8, 1, 0.8, false);
      walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
      return;
    }
    walkStep(g, mob, dx, dz, 7.5, dt, grids, worldOnly);
    if (Math.random() < dt * 20) g.particles.dust(mob.x, mob.y + 0.1, mob.z, 1, 1, false);
    trample(g, mob);
    let done = mob.actT >= mob.actDur || mob.stuck > 0.25;
    if (!p.dead && !g.leap && Math.hypot(p.x - mob.x, p.z - mob.z) < 1.9 && Math.abs(p.y - mob.y) < 2.2) {
      damagePlayer(g, 7 + Math.round(g.danger), dx * 13, dz * 13);
      p.vy = 8;
      done = true;
    }
    g.walker.legs.forEach((l, i) => {
      if (done || Math.hypot(l.foot[0] - mob.x, l.foot[2] - mob.z) > 2.6) return;
      damageLeg(g, i, 0.28 + g.day * 0.02);
      g.fortress.shake = Math.max(g.fortress.shake, 0.6);
      g.renderer.shake(0.45);
      g.sfxAt('ram', mob.x, mob.y, mob.z, 1);
      g.particles.debris(l.foot[0], l.foot[1] + 1, l.foot[2], 'stone_bricks', 12, 5);
      g.crewSay('ravager');
      done = true;
    });
    if (done) {
      mob.act = 'none';
      mob.aux = 4 + Math.random() * 2;
      mob.vx *= 0.3;
      mob.vz *= 0.3;
    }
    return;
  }
  if (mob.windup > 0) {
    // A gore wound up (head raised): it lands on you, or on the leg it is nosing at.
    mob.windup -= dt;
    if (mob.windup <= 0) {
      mob.attackTimer = 1.4;
      if (atYou && Math.hypot(p.x - mob.x, p.z - mob.z) < 2.6 && Math.abs(p.y - mob.y) < 2.4) {
        const k = 1 / (Math.hypot(p.x - mob.x, p.z - mob.z) || 1);
        damagePlayer(g, 5 + Math.floor(g.day / 2), (p.x - mob.x) * k * 10, (p.z - mob.z) * k * 10);
      } else if (!atYou && leg >= 0 && d < 3) {
        damageLeg(g, leg, 0.1);
        g.sfxAt('legdamage', mob.x, mob.y, mob.z, 0.7);
      }
    }
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    return;
  }
  if (d > 6 && d < 20 && mob.aux <= 0 && mob.onGround) {
    mob.wanderYaw = Math.atan2(tz - mob.z, tx - mob.x);
    begin(mob, 'charge', 0.8 + 2.2);
    g.sfxAt('roar', mob.x, mob.y + 1.5, mob.z, 0.75, 1.15);
    return;
  }
  if (d < 2.8 && mob.attackTimer <= 0) {
    mob.windup = 0.5;
    mob.actDur = 0.5;
    return;
  }
  let dx = tx - mob.x;
  let dz = tz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  mob.yaw = Math.atan2(dz, dx);
  walkStep(g, mob, dx, dz, l > 2 ? mob.speed : 0, dt, grids, worldOnly);
  trample(g, mob);
}

/** A ravager tramples the leaves, crops and fences in its way (as in Minecraft). */
function trample(g: Game, mob: Actor): void {
  const w = g.world;
  for (let dy = 0; dy <= 2; dy += 1) {
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = Math.floor(mob.x + ox * 0.9);
      const y = Math.floor(mob.y) + dy;
      const z = Math.floor(mob.z + oz * 0.9);
      const id = w.get(x, y, z);
      if (id === B.LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES || id === B.WHEAT || id === B.FENCE) {
        w.set(x, y, z, B.AIR);
        g.particles.debris(x + 0.5, y + 0.5, z + 0.5, id === B.FENCE ? 'planks_oak' : 'leaves_oak', 4, 2);
      }
    }
  }
}

/** The roar: a shock ring that throws back everything close (you included). */
function roarBlast(g: Game, mob: Actor): void {
  g.particles.ring(mob.x, mob.y + 1, mob.z, 6, 0.9, 0.85, 0.75);
  g.particles.dust(mob.x, mob.y + 0.2, mob.z, 14, 3, false);
  g.renderer.shake(0.5);
  g.eachPlayer((p) => {
    const d = Math.hypot(p.x - mob.x, p.z - mob.z);
    if (!p.dead && d < 5 && Math.abs(p.y - mob.y) < 3) damagePlayer(g, 3 + Math.floor(g.day / 3), ((p.x - mob.x) / (d || 1)) * 12, ((p.z - mob.z) / (d || 1)) * 12);
  });
  for (const m of g.mobs) {
    if (m === mob || m.dead || m.raid >= 0 || m.flying) continue;
    const e = Math.hypot(m.x - mob.x, m.z - mob.z);
    if (e < 5) damageMob(g, m, 4, ((m.x - mob.x) / (e || 1)) * 10, ((m.z - mob.z) / (e || 1)) * 10);
  }
}

// ------------------------------------------------------------------ ghast

/**
 * A ghast drifts high round the fortress, crying. It turns its face, opens its eyes and mouth,
 * and spits a fireball at you (or into your hull). Bat the fireball back (a sword stroke or a
 * bolt) and it flies home: one of its own fireballs is enough to kill a ghast.
 */
function ghast(g: Game, mob: Actor, dt: number): void {
  const p = g.player;
  const c = g.fortressCentre();
  const F = g.fortress;
  mob.homeX += dt * 0.07;
  const r = g.fortressRadius() + 18 + Math.sin(g.time * 0.21 + mob.homeZ) * 6;
  const ty = F.y + F.maxY + 9 + Math.sin(g.time * 0.33 + mob.homeX * 3) * 3;
  const tx = c[0] + Math.cos(mob.homeX) * r;
  const tz = c[2] + Math.sin(mob.homeX) * r;
  const target: [number, number, number] | null = !p.dead && Math.hypot(p.x - mob.x, p.z - mob.z) < 60 && hasLineOfSight(g, mob.x, mob.cy, mob.z, p.x, p.y + 1.4, p.z) ? [p.x, p.y + 1, p.z] : null;
  steerFlier(g, mob, tx, ty, tz, mob.speed, dt, 1.2, 4);
  // It always turns its face to you when it can see you.
  if (target) mob.yaw = Math.atan2(target[2] - mob.z, target[0] - mob.x);
  mob.walkPhase += dt * 2;
  if (mob.act === 'shoot') {
    mob.actT += dt;
    mob.mouth = Math.min(1, mob.mouth + dt * 4);
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      let aim = target;
      if (!aim) {
        // Nothing to see: a fireball into the deck.
        const keys = [...F.cells.keys()];
        const k = keys[Math.floor(Math.random() * keys.length)];
        if (k !== undefined) {
          const q = F.cellCenter(kx(k), ky(k), kz(k));
          aim = [q.x, q.y, q.z];
        }
      }
      if (aim) shootFireball(g, mob, aim[0], aim[1], aim[2]);
    }
    return;
  }
  mob.mouth = Math.max(0, mob.mouth - dt * 2);
  if (mob.shootTimer <= 0 && Math.hypot(c[0] - mob.x, c[2] - mob.z) < 56) {
    mob.shootTimer = 4.5 + Math.random() * 2.5;
    begin(mob, 'shoot', 0.9);
    g.sfxAt('ghast', mob.x, mob.cy, mob.z, 0.9, 1.15);
  }
}

/** A ghast's fireball: straight, steady, and (a moment after launch) explosive. */
function shootFireball(g: Game, mob: Actor, tx: number, ty: number, tz: number): void {
  const fx = Math.cos(mob.yaw);
  const fz = Math.sin(mob.yaw);
  const sx = mob.x + fx * 2.2;
  const sy = mob.y + 1.6;
  const sz = mob.z + fz * 2.2;
  let dx = tx - sx;
  let dy = ty - sy;
  let dz = tz - sz;
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  const speed = 13;
  g.projectiles.push({ kind: 'fireball', x: sx, y: sy, z: sz, vx: dx * speed, vy: dy * speed, vz: dz * speed, age: 0, life: 8, spin: 0, fromCrew: false, owner: mob });
  g.sfxAt('fireball', sx, sy, sz, 1);
}

/**
 * Bats a fireball back the way it came: at its ghast if that still flies (a deflected fireball
 * kills a ghast outright), else straight back out.
 */
export function deflect(g: Game, pr: Projectile, byYou: boolean): void {
  if (pr.deflected) return;
  pr.deflected = true;
  pr.age = 0;
  pr.life = 6;
  const o = pr.owner;
  const speed = 19;
  if (o && !o.dead) {
    let dx = o.x - pr.x;
    let dy = o.cy - pr.y;
    let dz = o.z - pr.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    pr.vx = dx * speed;
    pr.vy = dy * speed;
    pr.vz = dz * speed;
  } else {
    const l = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
    pr.vx = (-pr.vx / l) * speed;
    pr.vy = (-pr.vy / l) * speed;
    pr.vz = (-pr.vz / l) * speed;
  }
  g.particles.sparks(pr.x, pr.y, pr.z, ['#ffffff', '#ffd040', '#ff8020'], 14, 5, 0.08, 0.4);
  g.sfx('crit', 'metal', 0.9);
  if (byYou) {
    g.ui.damage(0, pr.x, pr.y + 0.6, pr.z, 'big', 'DEFLECTED!');
    g.freeze(0.07);
    g.buzz(30);
  }
}

/** A swing (or tap) aimed at a fireball close in front of you bats it back. Returns true if it did. */
export function swatFireball(g: Game, ray: Ray): boolean {
  if (g.attackCooldown > 0 || g.player.dead) return false;
  let best: Projectile | null = null;
  let bestScore = Infinity;
  for (const pr of g.projectiles) {
    if (pr.kind !== 'fireball' || pr.deflected) continue;
    const dx = pr.x - ray.ox;
    const dy = pr.y - ray.oy;
    const dz = pr.z - ray.oz;
    const d = Math.hypot(dx, dy, dz);
    if (d > 4.6 || d < 0.2) continue;
    const angle = Math.acos(clamp((dx * ray.dx + dy * ray.dy + dz * ray.dz) / d, -1, 1));
    if (angle > 0.5 + Math.max(0, 2 - d) * 0.25) continue;
    if (angle + d * 0.1 < bestScore) {
      bestScore = angle + d * 0.1;
      best = pr;
    }
  }
  if (!best) return false;
  g.attackCooldown = 0.35;
  g.mining.swing = 0.25;
  g.sfx('swing', 'wood', 0.6);
  deflect(g, best, true);
  return true;
}

/** A deflected fireball reaching a ghast: it bursts (feat: Return to Sender). */
export function fireballHitsGhast(g: Game, pr: Projectile, m: Actor): void {
  damageMob(g, m, 1000, 0, 0, 'player', 'blast');
  explode(g, pr.x, pr.y, pr.z, { radius: 2.2, fortress: 0, giant: 8, mob: 12, player: 0, terrain: 0, source: 'player' });
  g.ui.banner('RETURN TO SENDER!', 'You knocked the ghast out of the sky with its own fireball', 'gold');
  feat(g, 'sender');
}

/** Monsters of a kind the raid sends in (each one counts down the raid bar). */
export function raider(g: Game, kind: ActorKind, x: number, z: number): Actor | null {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const y = groundY(g, ix + 0.5, iz + 0.5);
  if (y === null) return null;
  const mob = new Actor(kind, ix + 0.5, y, iz + 0.5);
  scaleHealth(g, mob);
  mob.speed *= 0.95 + Math.random() * 0.1;
  mob.shootTimer = 1.5 + Math.random() * 2;
  mob.voiceT = 1 + Math.random() * 4;
  mob.strafe = Math.random() < 0.5 ? -1 : 1;
  mob.aux = kind === 'evoker' ? 3 : Math.random() * 2;
  g.mobs.push(mob);
  return mob;
}

