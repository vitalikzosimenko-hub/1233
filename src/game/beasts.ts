// The new lands' beasts, each thinking for itself: the canyon's breezes hop about and blow you off
// your feet with wind charges, the ember wastes' blazes hover round the fortress and loose volleys
// of fire, magma cubes bounce like slimes and burn what they touch, polar bears maul whoever comes
// near (or claw at the fortress's feet), and the Brood Queen gnaws at the legs and breeds her young.
import { feat } from './feats';
import { Actor } from './entities';
import type { Game } from './game';
import { damageLeg, damagePlayer, hasLineOfSight, meleeTick, nearestFoot, spawnMob, steerFlier, walkStep } from './mobs';
import { monsterVoice, slime } from './monsters';
import type { Grid } from './physics';
import { kx, ky, kz } from './body';

/** Runs the new lands' beasts (false: not one of them). */
export function beastMob(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): boolean {
  switch (mob.kind) {
    case 'breeze':
      breeze(g, mob, dt, grids, worldOnly);
      return true;
    case 'blaze':
      blaze(g, mob, dt);
      return true;
    case 'magmacube':
      magmaCube(g, mob, dt, grids, worldOnly);
      return true;
    case 'polarbear':
      polarBear(g, mob, dt, grids, worldOnly);
      return true;
    case 'queen':
      queen(g, mob, dt, grids, worldOnly);
      return true;
    default:
      return false;
  }
}

function begin(mob: Actor, act: Actor['act'], dur: number): void {
  mob.act = act;
  mob.actT = 0;
  mob.actDur = dur;
}

/** Where the target is: you (within range and sight), else a deck cell or the fortress. */
function targetOf(g: Game, mob: Actor, range: number): [number, number, number, boolean] {
  const p = g.player;
  if (!p.dead && !g.leap && Math.hypot(p.x - mob.x, p.z - mob.z) < range && hasLineOfSight(g, mob.x, mob.y + mob.h * 0.7, mob.z, p.x, p.y + 1.2, p.z)) return [p.x, p.y + 1.1, p.z, true];
  const F = g.fortress;
  const keys = [...F.cells.keys()];
  const k = keys[Math.floor(Math.random() * keys.length)];
  if (k === undefined) {
    const c = g.fortressCentre();
    return [c[0], c[1] + 1, c[2], false];
  }
  const q = F.cellCenter(kx(k), ky(k), kz(k));
  return [q.x, q.y + 0.5, q.z, false];
}

function shoot(g: Game, kind: 'wind' | 'ember' | 'web' | 'trident', from: [number, number, number], to: [number, number, number], speed: number, owner: Actor, arc = 0): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const d = Math.hypot(dx, dz) || 1;
  const t = Math.max(0.2, Math.hypot(dx, dy, dz) / speed);
  // A lobbed one (an arc: gravity `arc`) or a straight one.
  const vy = arc > 0 ? (dy + 0.5 * arc * t * t) / t : dy / t;
  g.projectiles.push({ kind, x: from[0], y: from[1], z: from[2], vx: (dx / d) * (d / t), vy, vz: (dz / d) * (d / t), age: 0, life: t + 2, spin: 0, fromCrew: false, owner });
}

// ------------------------------------------------------------------ drowned

/**
 * A drowned (a zombie of the swamp's pools) throws its trident from a few blocks off: it raises
 * it over its head (a beat to see it coming), then hurls it. True while it stands to throw.
 */
export function drownedThrow(g: Game, mob: Actor, dt: number, distP: number): boolean {
  const p = g.player;
  if (mob.act === 'throw') {
    mob.actT += dt;
    mob.yaw = Math.atan2(p.z - mob.z, p.x - mob.x);
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      mob.shootTimer = 3.5 + Math.random() * 2;
      if (!p.dead) shoot(g, 'trident', [mob.x, mob.y + mob.h * 0.9, mob.z], [p.x, p.y + 1, p.z], 20, mob, 9);
      g.sfxAt('whoosh', mob.x, mob.y + 1, mob.z, 0.7, 0.9);
    }
    return true;
  }
  if (mob.shootTimer <= 0 && !p.dead && !g.leap && distP > 4 && distP < 17 && hasLineOfSight(g, mob.x, mob.y + mob.h * 0.85, mob.z, p.x, p.y + 1.3, p.z)) {
    begin(mob, 'throw', 0.8);
    g.sfxAt('gurgle', mob.x, mob.y + 1, mob.z, 0.7);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ breeze

/**
 * A breeze keeps its distance, hopping from spot to spot, and every few seconds rears back and
 * fires a wind charge: where it bursts, everything is hurled away (you off the deck, too).
 */
function breeze(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  mob.aux -= dt;
  const [tx, ty, tz, you] = targetOf(g, mob, 30);
  const dx = tx - mob.x;
  const dz = tz - mob.z;
  const d = Math.hypot(dx, dz) || 1;
  mob.yaw = Math.atan2(dz, dx);
  mob.walkPhase += dt * 3;
  if (mob.act === 'shoot') {
    mob.actT += dt;
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      mob.shootTimer = 2.8 + Math.random() * 1.6;
      shoot(g, 'wind', [mob.x + (dx / d) * 0.6, mob.y + 1.3, mob.z + (dz / d) * 0.6], [tx, ty, tz], 15, mob);
      g.sfxAt('wind', mob.x, mob.y + 1, mob.z, 0.8, 1.2);
    }
  } else if (mob.shootTimer <= 0 && d < 26 && mob.onGround) {
    begin(mob, 'shoot', 0.55);
  }
  // Hops: away if you are close, in if far, always a little sideways.
  if (mob.onGround && mob.aux <= 0 && mob.act !== 'shoot') {
    mob.strafe = Math.random() < 0.5 ? -1 : 1;
    const want = you ? 9 : 16;
    const k = d < want - 3 ? -1 : d > want + 4 ? 1 : 0;
    const ux = dx / d;
    const uz = dz / d;
    const hx = ux * k * 0.8 - uz * mob.strafe;
    const hz = uz * k * 0.8 + ux * mob.strafe;
    const hl = Math.hypot(hx, hz) || 1;
    begin(mob, 'charge', 0.25);
    mob.vx = (hx / hl) * 5.5;
    mob.vz = (hz / hl) * 5.5;
    mob.vy = 7.5 + Math.random() * 2.5;
    mob.onGround = false;
    mob.standingOn = null;
    mob.aux = 1.1 + Math.random() * 1.1;
  }
  if (mob.act === 'charge') {
    mob.actT += dt;
    if (mob.actT >= mob.actDur) mob.act = 'none';
  }
  walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly, true);
  if (mob.onGround) {
    mob.vx *= 0.7;
    mob.vz *= 0.7;
  }
}

/** A wind charge bursts: everything near is hurled away from it (no harm done, but a long way down). */
export function windBurst(g: Game, x: number, y: number, z: number, fromPlayer: boolean): void {
  g.particles.ring(x, y, z, 3.5, 0.75, 0.9, 1);
  for (let i = 0; i < 14; i += 1) {
    const a = Math.random() * Math.PI * 2;
    g.particles.add({ x, y, z, vx: Math.cos(a) * 6, vy: (Math.random() - 0.3) * 4, vz: Math.sin(a) * 6, life: 0.5, size: 0.5, grow: 1, r: 0.85, g: 0.95, b: 1, a: 0.6, gravity: 0, drag: 2.5, tile: 'smoke', soft: true });
  }
  g.sfxAt('wind', x, y, z, 1, 0.9);
  const F = g.fortress;
  g.eachPlayer((p) => {
    const dx = p.x - x;
    const dy = p.y + 0.9 - y;
    const dz = p.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (p.dead || d > 3.2) return;
    const k = 1 / (Math.hypot(dx, dz) || 1);
    const onDeck = p.standingOn === F;
    // Your own charge launches you higher (a rocket jump); a breeze's throws you clear.
    const push = fromPlayer ? 6 : 10;
    g.fling(dx * k * push, fromPlayer ? 13 : 9, dz * k * push);
    if (onDeck && !fromPlayer) {
      g.toast('A wind charge blows you off your feet!');
      feat(g, 'windrider');
    }
    if (fromPlayer) feat(g, 'rocketjump');
  });
  // (A captain's own charge throws them harder: it is a weapon, a breeze's is a nuisance.)
  const out = fromPlayer ? 12 : 9;
  for (const m of g.mobs) {
    if (m.dead || m.boss) continue;
    const dx = m.x - x;
    const dz = m.z - z;
    const d = Math.hypot(dx, m.cy - y, dz);
    if (d > 3.6) continue;
    const k = 1 / (Math.hypot(dx, dz) || 1);
    m.vx = dx * k * out;
    m.vz = dz * k * out;
    m.vy = fromPlayer ? 11 : 8;
    m.onGround = false;
    m.standingOn = null;
    m.climb = null;
    if (m.mount) {
      m.mount.rider = null;
      m.mount = null;
    }
  }
}

// ------------------------------------------------------------------ blaze

/** A blaze hovers round the fortress, heats up (its rods glow), then looses three small fireballs. */
function blaze(g: Game, mob: Actor, dt: number): void {
  const F = g.fortress;
  const c = g.fortressCentre();
  mob.homeX += dt * 0.18;
  const r = g.fortressRadius() + 9 + Math.sin(g.time * 0.4 + mob.homeZ) * 4;
  const tx = c[0] + Math.cos(mob.homeX) * r;
  const tz = c[2] + Math.sin(mob.homeX) * r;
  const ty = F.y + F.floorY + 4 + Math.sin(g.time * 1.3 + mob.homeZ * 5) * 1.5;
  steerFlier(g, mob, tx, ty, tz, mob.speed, dt, 1.6, 2);
  mob.walkPhase += dt * 2;
  if (Math.random() < dt * 6) g.particles.smoke(mob.x, mob.y + 1, mob.z, 1, 0.3, true);
  const [ax, ay, az] = targetOf(g, mob, 34);
  mob.yaw = Math.atan2(az - mob.z, ax - mob.x);
  if (mob.act === 'charge') {
    mob.actT += dt;
    if (Math.random() < dt * 20) g.particles.sparks(mob.x, mob.y + 1, mob.z, ['#ffd040', '#ff8a20'], 1, 1.5, 0.08, 0.3);
    if (mob.actT >= mob.actDur) begin(mob, 'shoot', 0.9);
  } else if (mob.act === 'shoot') {
    const before = Math.floor(mob.actT / 0.3);
    mob.actT += dt;
    const after = Math.floor(mob.actT / 0.3);
    if (after > before && after <= 3) {
      shoot(g, 'ember', [mob.x, mob.y + 1.2, mob.z], [ax + (Math.random() - 0.5), ay, az + (Math.random() - 0.5)], 16, mob);
      g.sfxAt('fireball', mob.x, mob.y + 1, mob.z, 0.5, 1.5);
    }
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      mob.shootTimer = 4 + Math.random() * 2;
    }
  } else if (mob.shootTimer <= 0 && Math.hypot(c[0] - mob.x, c[2] - mob.z) < 48) {
    begin(mob, 'charge', 1);
    g.sfxAt('blaze', mob.x, mob.y + 1, mob.z, 0.8);
  }
  // Too close: it burns.
  const p = g.player;
  if (!p.dead && mob.attackTimer <= 0 && Math.hypot(p.x - mob.x, p.z - mob.z) < 1.2 && Math.abs(p.cy - mob.cy) < 1.6) {
    mob.attackTimer = 1;
    damagePlayer(g, 3 + Math.floor(g.danger / 3), (p.x - mob.x) * 3, (p.z - mob.z) * 3);
  }
}

// ------------------------------------------------------------------ magma cube

/** A magma cube hops like a slime (higher), burns what it lands on, and shrugs off lava. */
function magmaCube(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const wasAir = !mob.onGround;
  const vy0 = mob.vy;
  slime(g, mob, dt, grids, worldOnly);
  // (A higher bounce than a slime's.)
  if (vy0 <= 0 && mob.vy > 4 && wasAir === false) mob.vy += 2;
  if (mob.onGround && wasAir) {
    g.particles.sparks(mob.x, mob.y + 0.2, mob.z, ['#ff8a20', '#ffd040', '#3a0a04'], 4 + mob.size * 2, 2.5, 0.1, 0.5);
    g.sfxAt('magma', mob.x, mob.y, mob.z, 0.5 + mob.size * 0.08, mob.size >= 4 ? 0.75 : 1.2);
  }
}

// ------------------------------------------------------------------ polar bear

/**
 * A polar bear rears up and roars before it charges (a beat to get clear), hits hard, and when
 * nobody is near it goes for a fortress foot and claws at the leg.
 */
function polarBear(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const p = g.player;
  const dpx = p.x - mob.x;
  const dpz = p.z - mob.z;
  const distP = Math.hypot(dpx, dpz);
  const chase = !p.dead && !g.leap && distP < 16 && Math.abs(p.y - mob.y) < 3;
  if (mob.act === 'roar') {
    mob.actT += dt;
    mob.vx *= 0.8;
    mob.vz *= 0.8;
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    if (mob.actT >= mob.actDur) mob.act = 'none';
    return;
  }
  let tx: number;
  let tz: number;
  if (chase) {
    tx = p.x;
    tz = p.z;
    if (mob.aux <= 0 && distP < 7) {
      mob.aux = 9;
      begin(mob, 'roar', 0.9);
      mob.yaw = Math.atan2(dpz, dpx);
      g.sfxAt('bear', mob.x, mob.y + 1, mob.z, 1);
      return;
    }
  } else {
    const f = nearestFoot(g, mob);
    if (f.i >= 0 && g.phase === 'night') {
      const leg = g.walker.legs[f.i]!;
      tx = leg.foot[0];
      tz = leg.foot[2];
      if (f.d < 2 && mob.attackTimer <= 0) {
        mob.attackTimer = 1.4;
        damageLeg(g, f.i, 0.025);
        g.sfxAt('bear', mob.x, mob.y + 1, mob.z, 0.5, 1.2);
      }
    } else {
      tx = mob.homeX;
      tz = mob.homeZ;
    }
  }
  mob.aux -= dt;
  const dx = tx - mob.x;
  const dz = tz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  mob.yaw = Math.atan2(dz, dx);
  meleeTick(g, mob, dt, { reach: 1.9, windup: 0.4, damage: 5 + Math.floor(g.danger / 2), knock: 9, rest: 1.3 });
  const near = l < (chase ? 1.4 : 1.8);
  walkStep(g, mob, dx / l, dz / l, near ? 0 : mob.speed, dt, grids, worldOnly);
  if (Math.random() < dt * 0.15) monsterVoice(g, mob, 'ambient');
}

// ------------------------------------------------------------------ the Brood Queen

/**
 * The Brood Queen goes for the fortress's legs. She climbs one partway and hangs there gnawing at
 * it (the leg suffers), spitting webs at whoever stands on the deck above; hurt enough, or after a
 * while, she drops off, lays a clutch of spiderlings, and goes for another leg.
 */
function queen(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const F = g.fortress;
  const p = g.player;
  mob.aux -= dt;
  if (mob.act === 'summon') {
    mob.actT += dt;
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      const n = 3 + Math.min(2, Math.floor(g.danger / 4));
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2 + Math.random();
        const s = spawnMob(g, 'cavespider', mob.x + Math.cos(a) * 2, mob.z + Math.sin(a) * 2);
        if (s) {
          s.vy = 4;
          s.vx = Math.cos(a) * 3;
          s.vz = Math.sin(a) * 3;
        }
      }
      g.particles.debris(mob.x, mob.y + 0.6, mob.z, 'cobweb', 10, 4);
    }
    return;
  }
  const clinging = mob.climb;
  if (clinging) {
    const leg = g.walker.legs[clinging.leg];
    if (!leg) {
      mob.climb = null;
      return;
    }
    clinging.t = Math.min(0.42, clinging.t + dt / 4);
    const hip = g.walker.hipWorld(F, leg);
    const knee = g.walker.knee(F, leg, hip);
    const t = clinging.t * 2;
    mob.x = leg.foot[0] + (knee[0] - leg.foot[0]) * t;
    mob.y = leg.foot[1] + (knee[1] - leg.foot[1]) * t - 0.8;
    mob.z = leg.foot[2] + (knee[2] - leg.foot[2]) * t;
    mob.vx = mob.vy = mob.vz = 0;
    mob.walkPhase += dt * 1.5;
    mob.yaw = Math.atan2(hip[2] - leg.foot[2], hip[0] - leg.foot[0]);
    damageLeg(g, clinging.leg, dt * 0.022 * (1 + g.danger * 0.06));
    // Webs at whoever is up on the deck.
    if (mob.shootTimer <= 0 && !p.dead && p.standingOn === F) {
      mob.shootTimer = 2.6 + Math.random();
      begin(mob, 'shoot', 0.5);
      shoot(g, 'web', [mob.x, mob.y + mob.h * 0.8, mob.z], [p.x, p.y + 1, p.z], 14, mob, 9.8);
      g.sfxAt('queen', mob.x, mob.y + 1, mob.z, 0.6, 1.3);
    }
    if (mob.act === 'shoot') {
      mob.actT += dt;
      if (mob.actT >= mob.actDur) mob.act = 'none';
    }
    // Shaken off by a stomp, hurt enough, or done here: she drops and lays her clutch.
    const hurt = mob.anger - mob.hp;
    if (hurt > mob.maxHp * 0.12 || mob.aux <= 0 || leg.t >= 0) {
      mob.climb = null;
      mob.vy = -1;
      mob.vx = (Math.random() - 0.5) * 3;
      mob.vz = (Math.random() - 0.5) * 3;
      mob.aux = 6;
      begin(mob, 'summon', 1.3);
      g.sfxAt('queen', mob.x, mob.y, mob.z, 1, 0.9);
    }
    return;
  }
  // On the ground: for the nearest foot (or you, if you came down to her).
  const near = !p.dead && !g.leap && Math.hypot(p.x - mob.x, p.z - mob.z) < 7 && Math.abs(p.y - mob.y) < 3;
  let tx: number;
  let tz: number;
  const f = nearestFoot(g, mob);
  if (near) {
    tx = p.x;
    tz = p.z;
    meleeTick(g, mob, dt, { reach: 2.6, windup: 0.35, damage: 5 + Math.floor(g.danger / 2), knock: 9, rest: 1.1, effect: 'poison', seconds: 6 });
  } else if (f.i >= 0) {
    const leg = g.walker.legs[f.i]!;
    tx = leg.foot[0];
    tz = leg.foot[2];
    if (f.d < 2.8 && mob.aux <= 0) {
      mob.climb = { leg: f.i, t: 0, swinging: false };
      mob.anger = mob.hp;
      mob.aux = 9 + Math.random() * 3;
      g.sfxAt('queen', mob.x, mob.y + 1, mob.z, 1);
      g.toast('The Brood Queen is gnawing at a leg! Shoot her off it!');
      return;
    }
  } else {
    const c = g.fortressCentre();
    tx = c[0];
    tz = c[2];
  }
  const dx = tx - mob.x;
  const dz = tz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  mob.yaw = Math.atan2(dz, dx);
  walkStep(g, mob, dx / l, dz / l, l < 1.5 ? 0 : mob.speed, dt, grids, worldOnly);
  if (mob.voiceT <= 0) {
    mob.voiceT = 5 + Math.random() * 4;
    g.sfxAt('queen', mob.x, mob.y + 1, mob.z, 0.7);
  }
}
