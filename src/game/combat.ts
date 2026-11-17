import { hasOfficer } from './company';
import { crestSafe } from './mainquest';
import { B, I, blockDef } from './blocks';
import { key3, kx, ky, kz, type BlockBody } from './body';
import { spawnDrop } from './build';
import { crushTerrain, damageFortressCell, spillChest, stomp, wrapAngle } from './fortress';
import { approach, dist3, EYE as EYE_HEIGHT, type Game, type Ray } from './game';
import { createGiant, type Giant, type GiantType } from './giants';
import { forward, type Vec3 } from './math3d';
import type { Actor, Projectile } from './entities';
import { addEffect, type EffectId } from './effects';
import { feat } from './feats';
import { damageLeg, damageMob, damagePlayer, spawnMob, type HitSource } from './mobs';
import { deflect, fireballHitsGhast, potionSplash } from './monsters';
import { bountyCount } from './events';
import { startle } from './animals';
import { bodyGrid, overlaps } from './physics';
import { rayBox, raycastGrid } from './raycast';
import { clamp } from './rng';
import { windBurst } from './beasts';
import { hasTrophy } from './seals';
import { crateBlast, crateLanded } from './crane';

export const TNT_GRAVITY = 20;
const LEAP_RANGE = 20;
export const MAGAZINE = 8;

// ------------------------------------------------------------------ giants

/** A giant strides in from ahead of the marching fortress. */
export function spawnGiant(g: Game, type: GiantType): void {
  const c = g.fortressCentre();
  const ahead = g.fortressRadius() + 30;
  const x = Math.round(c[0] + g.marchDir[0] * ahead);
  const z = Math.round(c[2] + g.marchDir[1] * ahead);
  const footing = g.world.groundAt(x, z);
  const T = g.world.terrain;
  const giant = createGiant(type, x, z, footing, 1 + (g.danger - 1) * 0.2, -g.marchDir[0], -g.marchDir[1], T.version >= 2 ? T.zone(x, z) : undefined);
  giant.walker.layout(giant.body, g.world);
  g.giants.push(giant);
  g.ui.banner(type === 'titan' ? 'TITAN APPROACHES!' : 'GIANT INCOMING!', `${giant.name}: leap on it and steal its parts`, 'danger');
  g.sfx('giant', 'stone', 1.2);
  g.crewSay('giant');
}

/** The Citadel's guardian strides out of its gate towards the fortress. */
export function spawnColossus(g: Game): Giant {
  const T = g.world.terrain;
  const cit = T.citadel;
  const c = g.fortressCentre();
  let dx = c[0] - cit.x;
  let dz = c[2] - cit.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const x = Math.round(cit.x + dx * 24);
  const z = Math.round(cit.z + dz * 24);
  const giant = createGiant('colossus', x, z, g.world.groundAt(x, z), 2.2 + (g.danger - 1) * 0.2, dx, dz);
  giant.walker.layout(giant.body, g.world);
  g.giants.push(giant);
  return giant;
}

export function updateGiants(g: Game, dt: number): void {
  const F = g.fortress;
  const c = g.fortressCentre();
  for (const giant of g.giants) {
    const body = giant.body;
    body.savePose();
    if (giant.dead) continue;
    body.moving = false;
    body.shake = Math.max(0, body.shake - dt);
    const [gx, gz] = body.hullCentre();
    // A lair's giant sleeps where it lies; awake, it goes for you unless the fortress is nearer.
    if (giant.dormant) {
      giant.walker.layout(body, g.world);
      giant.walker.update(body, g.world, dt, false);
      continue;
    }
    if (!giant.roared) roar(g, giant);
    let tx = c[0];
    let tz = c[2];
    const prey = g.hunted(gx, gz).player;
    if (giant.lair !== undefined && !prey.dead && Math.hypot(prey.x - gx, prey.z - gz) < Math.hypot(c[0] - gx, c[2] - gz)) {
      tx = prey.x;
      tz = prey.z;
    }
    let dx = tx - gx;
    let dz = tz - gz;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    giant.dirX = dx;
    giant.dirZ = dz;
    // Blinded (both eyes put out), it lurches about and swings wild.
    if (!giant.blind && body.findBlock(B.GIANT_EYE) === null) {
      giant.blind = true;
      g.ui.damage(0, gx, body.top + 1.5, gz, 'big', 'BLINDED!');
      g.toast(`The ${giant.name} is blind: it swings wild and walks slow`);
    }
    // Turn its face (local -x) towards the fortress, ponderously.
    const turn = wrapAngle(Math.atan2(-dz, -dx) - body.yaw + (giant.blind ? Math.sin(g.time * 1.3) * 0.5 : 0));
    body.setYaw(body.yaw + clamp(turn, -0.9 * dt, 0.9 * dt));
    // Stop against the hull (or a few steps from you).
    const chasing = tx !== c[0] || tz !== c[2];
    const reach = chasing ? 3 + Math.max(body.maxX - body.minX, body.maxZ - body.minZ) * 0.5 : g.fortressRadius() + Math.max(body.maxX - body.minX, body.maxZ - body.minZ) * 0.5 + 1.5;
    // Thrusters on its back let it charge the last stretch (steam roaring out of them).
    giantCharge(g, giant, dist, reach, dt);
    const pace = giant.speed * (giant.blind ? 0.7 : 1) * (giant.rage >= 2 ? 1.4 : 1) * (giant.charge > 0 ? 4.5 : 1);
    let vx = 0;
    let vz = 0;
    if (dist > reach) {
      const step = Math.min(pace * dt, dist - reach);
      body.x += dx * step;
      body.z += dz * step;
      vx = (dx * step) / dt;
      vz = (dz * step) / dt;
      body.moving = true;
      body.walkPhase += step;
      giant.contact = false;
    } else {
      giant.contact = true;
      // A charge that reaches the hull lands as a battering blow.
      if (giant.charge > 0) {
        giant.charge = 0;
        giant.attackTimer = 0;
        giant.windup = 0.01;
        giant.heavy = true;
        chargeImpact(g, giant);
      }
    }
    // Rammed: staggers backwards.
    if (giant.push) {
      const [px, pz] = giant.push;
      body.x += px * dt;
      body.z += pz * dt;
      vx += px;
      vz += pz;
      body.moving = true;
      const k = Math.max(0, 1 - dt * 3);
      giant.push = Math.hypot(px, pz) > 0.2 ? [px * k, pz * k] : undefined;
      giant.charge = 0;
    }
    const W = giant.walker;
    W.layout(body, g.world);
    W.vx = vx;
    W.vz = vz;
    const ground = W.groundUnder(g.world, body);
    body.y = approach(body.y, ground + W.spec.height + 0.4 - body.floorY, 3 * dt);
    const landed = W.update(body, g.world, dt, body.moving);
    if (landed > 0) {
      for (const l of W.legs) {
        if (!l.landed) continue;
        l.landed = false;
        stomp(g, l.foot, W.spec.size * (giant.charge > 0 ? 1.3 : 1), false);
      }
    }
    crushTerrain(g, body, false);
    giantCannons(g, giant, dist, dt);
    if (giant.type === 'colossus') colossusFury(g, giant);
    // The punch: wound up first (it rears back, its eyes blaze), then it lunges into the blow.
    if (giant.windup > 0) {
      giant.windup -= dt;
      const u = 1 - Math.max(0, giant.windup) / 0.8;
      body.nudge[0] = -giant.dirX * 0.55 * Math.sin(u * Math.PI * 0.5);
      body.nudge[1] = 0.25 * Math.sin(u * Math.PI * 0.5);
      body.nudge[2] = -giant.dirZ * 0.55 * Math.sin(u * Math.PI * 0.5);
      if (giant.windup <= 0) {
        body.nudge[0] = giant.dirX * 0.7;
        body.nudge[1] = -0.1;
        body.nudge[2] = giant.dirZ * 0.7;
        giantPunch(g, giant);
      }
    } else {
      // Settling back after the lunge.
      const k = Math.max(0, 1 - dt * 5);
      body.nudge[0] *= k;
      body.nudge[1] *= k;
      body.nudge[2] *= k;
    }
    if (giant.contact) {
      giant.attackTimer -= dt;
      if (giant.attackTimer <= 0 && giant.windup <= 0) {
        giant.attackTimer = giant.rage >= 2 ? 1.5 : 2.3;
        giant.windup = 0.8;
        g.sfx('giant', 'stone', 0.8, 0.7);
      }
    }
    const riders = g.players().filter((ctx) => ctx.player.standingOn === body && !ctx.player.dead);
    if (riders.length > 0) {
      giant.shrugTimer -= dt;
      if (giant.shrugTimer <= 0) {
        giant.shrugTimer = 3.6 + Math.random() * 1.6;
        body.shake = 0.35;
        for (const ctx of riders) {
          g.withCtx(ctx, () => {
            const a = Math.random() * Math.PI * 2;
            g.fling(Math.cos(a) * 4, 8, Math.sin(a) * 4);
            g.sfx('giant', 'stone', 1);
            g.toast('The giant shrugs! Hold on!');
          });
        }
      }
    }
  }
  g.giants = g.giants.filter((gi) => !gi.dead || gi.body.cells.size > 0);
  void F;
}

/** A giant arrives: it throws its head back and roars, and the ground shakes. */
function roar(g: Game, giant: Giant): void {
  giant.roared = true;
  const [gx, gz] = giant.body.hullCentre();
  const p = g.player;
  const d = Math.hypot(gx - p.x, gz - p.z);
  g.sfxAt('roar', gx, giant.body.top, gz, 1.1, giant.type === 'colossus' ? 0.5 : giant.type === 'titan' ? 0.58 : 0.66);
  g.renderer.shake(clamp(0.8 - d / 80, 0.15, 0.6));
  for (const l of giant.walker.legs) g.particles.dust(l.foot[0], l.foot[1] + 0.2, l.foot[2], 10, 2.5, false);
  g.particles.ring(gx, giant.body.y + 1, gz, 6, 0.9, 0.85, 0.7);
}

/**
 * Giants with thrusters on their backs (brutes, wardens) charge the last stretch: steam roars out
 * of them and they come on four times as fast, to land a battering blow. A ram or a stomp stops one.
 */
function giantCharge(g: Game, giant: Giant, dist: number, reach: number, dt: number): void {
  const body = giant.body;
  giant.chargeCd -= dt;
  if (giant.charge > 0) {
    giant.charge -= dt;
    for (const [key, cell] of body.cells) {
      if (cell.id !== B.THRUSTER || Math.random() > dt * 20) continue;
      const q = body.cellCenter(kx(key), ky(key), kz(key));
      g.particles.smoke(q.x - giant.dirX * 0.8, q.y, q.z - giant.dirZ * 0.8, 1, 0.4);
    }
    return;
  }
  if (giant.chargeCd > 0 || dist < reach + 5 || dist > reach + 26 || giant.blind) return;
  let thrusters = 0;
  for (const cell of body.cells.values()) if (cell.id === B.THRUSTER) thrusters += 1;
  if (thrusters === 0) return;
  giant.chargeCd = 14 + Math.random() * 5;
  giant.charge = 2.2;
  const [gx, gz] = body.hullCentre();
  g.sfxAt('steam', gx, body.top, gz, 1, 0.75);
  g.sfxAt('giant', gx, body.top, gz, 1, 0.8);
  g.ui.damage(0, gx, body.top + 1.2, gz, 'big', 'CHARGE!');
  g.crewSay('charge');
}

/** A charging giant reaching the hull: the whole fortress rocks and the legs take it. */
function chargeImpact(g: Game, giant: Giant): void {
  const F = g.fortress;
  F.shake = Math.max(F.shake, 0.7);
  g.renderer.shake(0.9);
  g.freeze(0.1);
  g.buzz(120);
  g.sfx('ram', 'stone', 1);
  g.walker.legs.forEach((_, i) => damageLeg(g, i, 0.05));
}

/**
 * A giant's cannons (the Titan's, the Colossus's two) lob shells at the fortress: a glow at the
 * muzzle, a puff, and a shell arcing in. Dig the cannon out of its chest (or blow it off) and it
 * falls silent.
 */
function giantCannons(g: Game, giant: Giant, dist: number, dt: number): void {
  const body = giant.body;
  if (giant.aimKey !== null) {
    giant.aimT -= dt;
    const cell = body.cells.get(giant.aimKey);
    if (!cell || cell.id !== B.CANNON) {
      giant.aimKey = null;
      g.toast(`A cannon of the ${giant.name} is silenced!`);
      return;
    }
    const q = body.cellCenter(kx(giant.aimKey), ky(giant.aimKey), kz(giant.aimKey));
    if (Math.random() < dt * 25) g.particles.sparks(q.x - giant.dirX * 0.6, q.y, q.z - giant.dirZ * 0.6, ['#ffd040', '#ff8020'], 1, 1.5, 0.08, 0.3);
    if (giant.aimT > 0) return;
    giant.aimKey = null;
    fireGiantShell(g, giant, q.x + giant.dirX * 0.8, q.y + 0.3, q.z + giant.dirZ * 0.8);
    return;
  }
  giant.cannonCd -= dt;
  if (giant.cannonCd > 0 || dist > 52) return;
  const cannons: number[] = [];
  for (const [key, cell] of body.cells) if (cell.id === B.CANNON) cannons.push(key);
  if (cannons.length === 0) {
    giant.cannonCd = 9;
    return;
  }
  giant.cannonCd = (giant.rage >= 2 ? 3.5 : giant.type === 'colossus' ? 5.5 : 7.5) + Math.random() * 2;
  giant.aimKey = cannons[Math.floor(Math.random() * cannons.length)]!;
  giant.aimT = 0.8;
  const q = body.cellCenter(kx(giant.aimKey), ky(giant.aimKey), kz(giant.aimKey));
  g.light({ x: q.x, y: q.y, z: q.z, r: 6, color: [1.2, 0.6, 0.2], life: 0.8, max: 0.8 });
  g.sfxAt('fuse', q.x, q.y, q.z, 0.6, 1.6);
}

/** A giant's shell, lobbed at your deck (the Core by preference, else wherever it lands). */
function fireGiantShell(g: Game, giant: Giant, sx: number, sy: number, sz: number): void {
  const F = g.fortress;
  const keys = [...F.cells.keys()];
  const core = g.coreKey();
  const k = core !== null && Math.random() < 0.35 ? core : keys[Math.floor(Math.random() * keys.length)];
  if (k === undefined) return;
  const q = F.cellCenter(kx(k), ky(k), kz(k));
  const tx = q.x + (Math.random() - 0.5) * 3;
  const ty = q.y + 0.5;
  const tz = q.z + (Math.random() - 0.5) * 3;
  const d = Math.hypot(tx - sx, tz - sz);
  const t = clamp(d / 15, 0.8, 2.4);
  g.projectiles.push({ kind: 'gshell', x: sx, y: sy, z: sz, vx: (tx - sx) / t, vy: (ty - sy + 0.5 * TNT_GRAVITY * t * t) / t, vz: (tz - sz) / t, age: 0, life: t + 1.5, spin: 0, fromCrew: false });
  g.particles.smoke(sx, sy, sz, 8, 0.8);
  g.particles.sparks(sx, sy, sz, ['#ffe070', '#ff8a20'], 10, 5, 0.1, 0.3);
  g.sfxAt('cannon', sx, sy, sz, 1, 0.8);
  giant.body.shake = Math.max(giant.body.shake, 0.2);
}

/**
 * The Colossus fights in phases: its Heart cracked to two thirds, it calls creepers out of the
 * Citadel; to a third, it RAGES (faster, harder, its cannons firing twice as often).
 */
function colossusFury(g: Game, giant: Giant): void {
  const heart = giant.body.findBlock(B.GIANT_HEART);
  const cell = heart !== null ? giant.body.cells.get(heart) : undefined;
  if (!cell) return;
  const pct = cell.hp / cell.maxHp;
  const [gx, gz] = giant.body.hullCentre();
  if (giant.rage === 0 && pct <= 0.66) {
    giant.rage = 1;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const m = spawnMob(g, 'creeper', gx + Math.cos(a) * 7, gz + Math.sin(a) * 7);
      if (m) {
        m.charged = i % 3 === 0;
        g.particles.smoke(m.x, m.cy, m.z, 6, 0.8);
      }
    }
    g.sfxAt('roar', gx, giant.body.top, gz, 1, 0.5);
    g.ui.banner('THE COLOSSUS CALLS!', 'Creepers pour out of the Citadel to guard it', 'danger');
  } else if (giant.rage === 1 && pct <= 0.33) {
    giant.rage = 2;
    giant.cannonCd = Math.min(giant.cannonCd, 2);
    g.sfxAt('roar', gx, giant.body.top, gz, 1.2, 0.45);
    g.renderer.shake(0.8);
    g.ui.banner('THE COLOSSUS RAGES!', 'It strikes faster and its cannons never stop: finish it!', 'danger');
  }
}

function giantPunch(g: Game, giant: Giant): void {
  const F = g.fortress;
  const body = giant.body;
  const [gx, gz] = body.hullCentre();
  const px = gx + giant.dirX * 2.5;
  const py = body.y + giant.fistY + 0.5;
  const pz = gz + giant.dirZ * 2.5;
  // A charge's battering blow lands harder, and so does an enraged one.
  const power = giant.punch * (giant.heavy ? 1.6 : 1) * (giant.rage >= 2 ? 1.25 : 1);
  giant.heavy = false;
  // Blind, it swings wild: half its blows hit nothing but air (and the ground).
  if (giant.blind && Math.random() < 0.5) {
    body.shake = 0.25;
    g.sfx('giant', 'stone', 0.9);
    g.particles.dust(px + (Math.random() - 0.5) * 4, g.world.groundAt(px, pz) + 0.3, pz + (Math.random() - 0.5) * 4, 10, 2.5, false);
    g.ui.damage(0, px, py + 1, pz, 'streak', 'MISSED!');
    return;
  }
  let best: number | null = null;
  let bestD = Infinity;
  for (const [key, c] of F.cells) {
    if (!blockDef(c.id).solid) continue;
    const p = F.cellCenter(kx(key), ky(key), kz(key));
    const d = dist3(p.x, p.y, p.z, px, py, pz);
    if (d < bestD) {
      bestD = d;
      best = key;
    }
  }
  body.shake = 0.25;
  g.renderer.shake(0.5);
  g.sfx('giant', 'stone', 1.2);
  // A leg in reach (and nearer than the hull) takes the blow instead.
  const W = g.walker;
  let leg = -1;
  let legD = Math.min(bestD, 4);
  W.legs.forEach((l, i) => {
    const hip = W.hipWorld(F, l);
    const knee = W.knee(F, l, hip);
    const d = Math.min(segmentDist(px, py, pz, hip, knee), segmentDist(px, py, pz, knee, l.foot));
    if (d < legD) {
      legD = d;
      leg = i;
    }
  });
  if (leg >= 0) {
    damageLeg(g, leg, 0.12 + power * 0.012);
    g.particles.sparks(px, py, pz, ['#ffd040', '#ffffff'], 10, 5, 0.1, 0.4);
  } else if (best !== null && bestD < 6) {
    const p = F.cellCenter(kx(best), ky(best), kz(best));
    g.particles.debris(p.x, p.y, p.z, 'mossy_cobble', 10, 5);
    // A punch rattles the cells around the impact too.
    damageFortressCell(g, best, power);
    for (const [key] of [...F.cells]) {
      const q = F.cellCenter(kx(key), ky(key), kz(key));
      if (key !== best && dist3(q.x, q.y, q.z, p.x, p.y, p.z) < 1.8) damageFortressCell(g, key, power * 0.35);
    }
  }
  g.eachPlayer((pl) => {
    if (!pl.dead && dist3(pl.x, pl.cy, pl.z, px, py, pz) < 3) damagePlayer(g, 3, giant.dirX * 6, giant.dirZ * 6);
  });
}

export function damageGiantCell(g: Game, giant: Giant, key: number, amount: number): void {
  const body = giant.body;
  const c = body.cells.get(key);
  if (!c || giant.dead || amount <= 0) return;
  c.hp -= amount;
  if (c.hp > 0) return;
  const lx = kx(key);
  const ly = ky(key);
  const lz = kz(key);
  const p = body.cellCenter(lx, ly, lz);
  const id = body.removeBlock(lx, ly, lz);
  g.particles.debris(p.x, p.y, p.z, blockDef(id).tiles.side, 8, 4);
  if (id === B.GIANT_HEART) killGiant(g, giant, false);
  else checkGiantIntegrity(g, giant);
}

export function checkGiantIntegrity(g: Game, giant: Giant): void {
  const body = giant.body;
  const heart = body.findBlock(B.GIANT_HEART);
  if (heart === null) {
    killGiant(g, giant, false);
    return;
  }
  const connected = body.connectedTo(heart);
  const gone: number[] = [];
  for (const [key, c] of body.cells) {
    if (connected.has(key)) continue;
    const p = body.cellCenter(kx(key), ky(key), kz(key));
    gone.push(key);
    g.falling.push({ id: c.id, x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 3, vy: 2, vz: (Math.random() - 0.5) * 3, rot: 0, vr: (Math.random() - 0.5) * 5, age: 0, drop: c.id !== B.MOSSY_COBBLE });
  }
  if (gone.length) body.removeMany(gone);
  // Blasted down to a stump round its Heart, it cannot stand: it falls.
  if (gone.length && connected.size < Math.max(8, body.peakCells * 0.12)) killGiant(g, giant, false);
}

export function killGiant(g: Game, giant: Giant, crumble: boolean): void {
  if (giant.dead) return;
  giant.dead = true;
  const body = giant.body;
  // Felled (not crumbled at dawn): its machines and armour go straight to your hold.
  const salvage = new Map<number, number>();
  for (const [key, c] of [...body.cells]) {
    const p = body.cellCenter(kx(key), ky(key), kz(key));
    const valuable = c.id === B.CANNON || c.id === B.THRUSTER || c.id === B.IRON_BLOCK;
    if (valuable && !crumble) salvage.set(c.id, (salvage.get(c.id) ?? 0) + 1);
    const drop = !valuable && c.id === B.MOSSY_COBBLE && Math.random() < 0.25;
    if (g.falling.length < 200) g.falling.push({ id: c.id, x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 5, vy: 3 + Math.random() * 3, vz: (Math.random() - 0.5) * 5, rot: 0, vr: (Math.random() - 0.5) * 8, age: 0, drop });
  }
  const [cx, cz] = body.hullCentre();
  const cy = (body.bottom + body.top) / 2;
  body.cells.clear();
  body.changed();
  g.particles.smoke(cx, cy, cz, 24, 4, true);
  g.particles.sparks(cx, cy, cz, ['#5b8f43', '#a01030', '#9a9a9a'], 30, 8, 0.16, 0.9);
  g.renderer.shake(0.9);
  g.sfx('explode', 'stone', 1);
  if (g.player.standingOn === body) {
    g.player.standingOn = null;
    g.player.onGround = false;
  }
  if (!crumble) {
    g.stats.giants += 1;
    bountyCount(g, 'giant');
    g.xp(40);
    // It falls: a beat of stillness, a shock ring and a thump.
    g.freeze(0.14);
    g.particles.ring(cx, cy, cz, 7, 1, 0.75, 0.5);
    g.sfx('ram', 'stone', 0.75);
    g.buzz(110);
    const gems = giant.type === 'colossus' ? 6 : giant.type === 'titan' ? 4 : 2;
    g.addItem(I.EMERALD, gems, true);
    // The splinter of the Citadel's Heart that animated it: a Heartstone for the Engine Core.
    g.addItem(I.HEARTSTONE, 1, true);
    const parts: string[] = [];
    for (const [id, n] of salvage) {
      g.addItem(id, n, true);
      g.nightLog.salvage += n;
      // (Each count a phrase of its own, so every language can word it.)
      if (n > 1) parts.push(id === B.CANNON ? `${n} Cannons` : id === B.THRUSTER ? `${n} Thrusters` : `${n} Iron Blocks`);
      else parts.push(id === B.CANNON ? '1 Cannon' : id === B.THRUSTER ? '1 Thruster' : '1 Iron Block');
    }
    parts.push(`${gems} Emeralds`, 'a Heartstone');
    g.ui.banner('GIANT FELLED!', `Salvaged: ${parts.join(', ')}`, 'gold');
    g.addPage('giants');
    g.cheer();
    g.report('visual_feedback');
  }
}

// ------------------------------------------------------------------ turrets

const BOLT_GRAVITY = 6;
const BOLT_SPEED = 42;

export type TurretKind = 'cannon' | 'ballista' | 'mortar';

export function turretKind(F: BlockBody, key: number): TurretKind | null {
  const id = F.cells.get(key)?.id;
  return id === B.CANNON ? 'cannon' : id === B.BALLISTA ? 'ballista' : id === B.MORTAR ? 'mortar' : null;
}

/** Cannons and mortars need power from the Core; a ballista is cranked by hand. */
export function turretReady(F: BlockBody, key: number): boolean {
  return turretKind(F, key) === 'ballista' || F.poweredMachines.has(key);
}

export function usesTnt(kind: TurretKind | null): boolean {
  return kind === 'cannon' || kind === 'mortar';
}

export function turretRange(kind: TurretKind, g?: Game): number {
  return TURRET[kind].range * (g && hasOfficer(g, 'aurel') ? 1.25 : 1);
}

/** Seconds between shots when you fire a turret yourself. */
export function turretCooldown(kind: TurretKind): number {
  return TURRET[kind].cooldown;
}

/** Reload time of a turret fired from the gunner's station (co-op), as a share of the usual. */
export const GUNNER_RELOAD = 0.6;

const TURRET = {
  cannon: { cooldown: 0.7, crew: 1.4, range: 30, min: 3 },
  ballista: { cooldown: 0.5, crew: 1.0, range: 36, min: 2 },
  mortar: { cooldown: 2.4, crew: 3.8, range: 50, min: 12 },
} as const;

/** The turret the builder is standing next to (at the helm or the guns: any of them), if any. */
export function nearestCannon(g: Game): { key: number } | null {
  const p = g.player;
  if (p.dead || g.leap) return null;
  const F = g.fortress;
  if (g.helm || g.gunner) {
    const any = [...F.cannons.keys()][0];
    return any === undefined ? null : { key: any };
  }
  let best: { key: number } | null = null;
  let bestD = 3.2;
  for (const key of F.cannons.keys()) {
    const c = F.cellCenter(kx(key), ky(key), kz(key));
    const d = dist3(c.x, c.y, c.z, p.x, p.y + 0.9, p.z);
    if (d < bestD) {
      bestD = d;
      best = { key };
    }
  }
  return best;
}

/** Fills a cannon's or mortar's magazine from the TNT in your pack. */
export function loadCannon(g: Game, key: number): boolean {
  const state = g.fortress.cannons.get(key);
  if (!state) return false;
  if (!usesTnt(turretKind(g.fortress, key))) {
    g.deny('Ballistas need no ammo: just fire');
    return false;
  }
  const room = MAGAZINE - state.ammo;
  if (room <= 0) {
    g.deny('This turret is fully loaded');
    return false;
  }
  const have = g.count(I.TNT);
  if (have <= 0) {
    g.deny('No TNT! Loot chests or craft it (gunpowder + sand)');
    return false;
  }
  const n = Math.min(room, have);
  g.useItem(I.TNT, n);
  state.ammo += n;
  g.sfx('craft', 'metal', 0.8);
  g.toast(`Loaded ${n} TNT (${state.ammo}/${MAGAZINE})`, 'tnt_side');
  g.flags.loaded = true;
  g.report('primary_input');
  return true;
}

/** A flight plan: where a shot leaves the muzzle, its velocity, gravity and time to the target. */
export interface Shot {
  kind: TurretKind;
  sx: number;
  sy: number;
  sz: number;
  vx: number;
  vy: number;
  vz: number;
  grav: number;
  t: number;
}

/** Ballistics from a turret to a point: cannons lob, mortars arc high, ballistas shoot flat. */
export function planShot(F: BlockBody, key: number, tx: number, ty: number, tz: number): Shot | null {
  const kind = turretKind(F, key);
  if (!kind) return null;
  const c = F.cellCenter(kx(key), ky(key), kz(key));
  const sx = c.x;
  const sy = c.y + 0.7;
  const sz = c.z;
  const d = dist3(sx, sy, sz, tx, ty, tz);
  const grav = kind === 'ballista' ? BOLT_GRAVITY : TNT_GRAVITY;
  const t = kind === 'ballista' ? Math.max(0.12, d / BOLT_SPEED) : kind === 'mortar' ? clamp(1.5 + d / 28, 1.8, 3.6) : clamp(d / 16, 0.5, 2.2);
  return { kind, sx, sy, sz, vx: (tx - sx) / t, vy: (ty - sy + 0.5 * grav * t * t) / t, vz: (tz - sz) / t, grav, t };
}

/** Points along a planned shot (the aiming arc). */
export function shotPath(s: Shot, n = 18): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = (s.t * i) / n;
    pts.push([s.sx + s.vx * t, s.sy + s.vy * t - 0.5 * s.grav * t * t, s.sz + s.vz * t]);
  }
  return pts;
}

/** Something a crew might shoot at, and how badly they want to. */
export function autoTarget(g: Game, key: number, range: number): { x: number; y: number; z: number } | null {
  const F = g.fortress;
  const kind = turretKind(F, key);
  if (!kind) return null;
  const c = F.cellCenter(kx(key), ky(key), kz(key));
  const sx = c.x;
  const sy = c.y + 0.7;
  const sz = c.z;
  const spec = TURRET[kind];
  // TNT is precious: a gun crew only spends it on what is worth a shell (a climber, a creeper, a
  // pack of them, anything close to the legs); ballista bolts cost nothing and fly at anything.
  const [fx, fz] = F.centre();
  const near = g.fortressRadius() + 10;
  const worthShell = (mob: Actor): boolean => {
    if (kind === 'ballista' || mob.climb || mob.kind === 'creeper' || mob.boss || mob.kind === 'ravager' || mob.kind === 'witch') return true;
    if (Math.hypot(mob.x - fx, mob.z - fz) < near) return true;
    let pack = 0;
    for (const o of g.mobs) if (o !== mob && !o.dead && Math.abs(o.x - mob.x) < 3.5 && Math.abs(o.z - mob.z) < 3.5) pack += 1;
    return pack >= 1;
  };
  let best: { x: number; y: number; z: number } | null = null;
  let bestScore = Infinity;
  const consider = (x: number, y: number, z: number, score: number): void => {
    if (score >= bestScore) return;
    if (!planShot(F, key, x, y, z)) return;
    bestScore = score;
    best = { x, y, z };
  };
  for (const mob of g.mobs) {
    if (mob.dead || mob.burn > 0) continue;
    // Gunners leave a calm enderman be (shooting one only makes it angry, and it dodges anyway).
    if (mob.kind === 'enderman' && mob.anger <= 0) continue;
    const flying = mob.flying;
    // Lobbed TNT cannot catch a flier; mortars only reach far off.
    if (flying && kind !== 'ballista') continue;
    const d = dist3(mob.x, mob.cy, mob.z, sx, sy, sz);
    if (d > range + (mob.kind === 'wither' || mob.kind === 'ghast' ? 10 : 0) || d < spec.min) continue;
    if (!worthShell(mob)) continue;
    let score = d - (mob.kind === 'creeper' ? 8 : 0) - (mob.fuse > 0 ? 10 : 0) - (mob.climb ? 12 : 0) - (mob.kind === 'ravager' ? 10 : 0);
    if (kind === 'ballista' && (flying || mob.climb || mob.kind === 'spider')) score -= 14;
    // The Wither is everyone's target (until its armour turns bolts aside); a ghast too.
    if (mob.kind === 'wither') score -= g.witherFight?.armored && kind === 'ballista' ? -40 : 30;
    if (mob.kind === 'ghast') score -= 10;
    if (g.mark && g.mark.mob === mob && g.time < g.mark.until) score -= 25;
    if (kind === 'mortar') {
      // Mortars like a crowd.
      for (const o of g.mobs) if (o !== mob && !o.dead && Math.abs(o.x - mob.x) < 4 && Math.abs(o.z - mob.z) < 4) score -= 5;
    }
    const lead = kind === 'ballista' ? d / BOLT_SPEED : clamp(d / 14, 0.5, 1.6);
    consider(mob.x + mob.vx * lead, mob.y + (mob.kind === 'wither' || mob.kind === 'ghast' ? mob.h * 0.55 : 0.3), mob.z + mob.vz * lead, score);
  }
  for (const giant of g.giants) {
    if (giant.dead) continue;
    const heart = giant.body.findBlock(B.GIANT_HEART);
    if (heart === null) continue;
    const h = giant.body.cellCenter(kx(heart), ky(heart), kz(heart));
    const d = dist3(h.x, h.y, h.z, sx, sy, sz);
    if (d > range + 6 || d < spec.min) continue;
    consider(h.x, h.y, h.z, d - (kind === 'mortar' ? 12 : 3));
  }
  return best;
}

/** Where the builder is looking: the first thing hit by the view ray (with a little aim assist). */
export function aimPoint(g: Game, ray?: Ray): { x: number; y: number; z: number; mob: Actor | null } {
  const r = ray ?? g.viewRay();
  // On the guns, a shot anywhere near the helmsman's mark goes to the mark.
  const marked = g.gunner ? markPoint(g) : null;
  if (marked) {
    const dx = marked.x - r.ox;
    const dy = marked.y - r.oy;
    const dz = marked.z - r.oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    if (Math.acos(clamp((dx * r.dx + dy * r.dy + dz * r.dz) / l, -1, 1)) < 0.4) return marked;
  }
  let bestAngle = 0.2;
  let assisted: { x: number; y: number; z: number; mob: Actor | null } | null = null;
  for (const mob of g.mobs) {
    if (mob.dead) continue;
    const dx = mob.x - r.ox;
    const dy = mob.cy - r.oy;
    const dz = mob.z - r.oz;
    const l = Math.hypot(dx, dy, dz);
    if (l > 70 || l < 2) continue;
    const angle = Math.acos(clamp((dx * r.dx + dy * r.dy + dz * r.dz) / l, -1, 1));
    if (angle < bestAngle) {
      bestAngle = angle;
      assisted = { x: mob.x, y: mob.y + 0.3, z: mob.z, mob };
    }
  }
  if (assisted) return assisted;
  let t = 70;
  const hit = raycastGrid(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, 70, (x, y, z) => g.world.solid(x, y, z));
  if (hit) t = hit.dist;
  for (const giant of g.giants) {
    if (giant.dead) continue;
    const b = giant.body;
    const wb = b.worldBounds();
    const d = rayBox(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, wb.x0, b.bottom, wb.z0, wb.x1, b.top, wb.z1);
    if (d !== null && d < t) t = d;
  }
  return { x: r.ox + r.dx * t, y: r.oy + r.dy * t, z: r.oz + r.dz * t, mob: null };
}

/** From the helm you command every turret: the readiest one that can make the shot. */
function helmTurret(g: Game, target: { x: number; y: number; z: number; mob: Actor | null }): { key: number; why: string } {
  const F = g.fortress;
  const pack = g.count(I.TNT) > 0 || (g.selected === I.BREAKER && g.count(I.BREAKER) > 0);
  let best: number | null = null;
  let bestScore = Infinity;
  let why = 'No turret on the fortress';
  for (const [key, s] of F.cannons) {
    const kind = turretKind(F, key);
    if (!kind) continue;
    if (!turretReady(F, key)) {
      why = 'No power! Lay Redstone Wire from the Engine Core';
      continue;
    }
    if (usesTnt(kind) && s.ammo <= 0 && !pack) {
      why = 'Out of TNT! Loot chests or craft it';
      continue;
    }
    const shot = planShot(F, key, target.x, target.y, target.z);
    if (!shot) continue;
    const d = Math.hypot(target.x - shot.sx, target.z - shot.sz);
    if (d < TURRET[kind].min) {
      why = 'Too close for that turret';
      continue;
    }
    let score = s.cooldown * 4 + (usesTnt(kind) && s.ammo <= 0 ? 3 : 0);
    if (target.mob?.flying) score += kind === 'ballista' ? -6 : 20;
    if (kind === 'mortar') score += d > 26 ? -3 : 6;
    if (kind === 'ballista' && target.mob === null && d > 20) score += 3;
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best === null ? { key: -1, why } : { key: best, why: '' };
}

export function fireCannon(g: Game, ray?: Ray): boolean {
  const F = g.fortress;
  let key: number;
  // With a co-op gunner on the guns, the helmsman's shots become target marks for the gunner.
  if (g.helm && g.otherGunner()) {
    markTarget(g, ray);
    return true;
  }
  const target = aimPoint(g, ray);
  if (g.helm || g.gunner) {
    const pick = helmTurret(g, target);
    if (pick.key < 0) {
      g.deny(pick.why);
      return false;
    }
    key = pick.key;
  } else {
    const manned = nearestCannon(g);
    if (!manned) {
      g.deny('Stand next to a turret to fire it');
      return false;
    }
    key = manned.key;
    if (!turretReady(F, key)) {
      g.deny('No power! Lay Redstone Wire from the Engine Core');
      return false;
    }
  }
  const state = F.cannons.get(key);
  const kind = turretKind(F, key);
  if (!state || !kind || state.cooldown > 0) return false;
  // A Heartbreaker in your hand goes into the barrel instead of TNT (cannons and mortars).
  const breaker = g.selected === I.BREAKER && g.count(I.BREAKER) > 0 && usesTnt(kind);
  if (usesTnt(kind) && state.ammo <= 0 && !breaker) {
    // Auto-load straight from the pack if there is TNT to spare.
    if (g.count(I.TNT) > 0) loadCannon(g, key);
    else {
      g.deny('Out of TNT! Loot chests or craft it');
      return false;
    }
  }
  const shot = planShot(F, key, target.x, target.y, target.z);
  if (!shot) return false;
  if (breaker) g.useItem(I.BREAKER, 1);
  else if (usesTnt(kind)) state.ammo -= 1;
  launchShot(g, key, shot, false, breaker);
  g.flags.fired += 1;
  g.report('primary_input');
  return true;
}

/** How long a target marked from the helm stays marked (seconds). */
export const MARK_TIME = 9;

/**
 * Co-op: the helmsman marks a target for the gunner (a monster, a giant's heart or a spot on the
 * ground). The gunner's shots and the gun crews favour it, and both screens show it.
 */
export function markTarget(g: Game, ray?: Ray): void {
  const t = aimPoint(g, ray);
  let mob: Actor | null = t.mob;
  if (!mob) {
    // A giant in the line of sight: its heart.
    const r = ray ?? g.viewRay();
    for (const giant of g.giants) {
      if (giant.dead) continue;
      const wb = giant.body.worldBounds();
      if (rayBox(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, wb.x0, giant.body.bottom, wb.z0, wb.x1, giant.body.top, wb.z1) === null) continue;
      const heart = giant.body.findBlock(B.GIANT_HEART);
      if (heart !== null) {
        const h = giant.body.cellCenter(kx(heart), ky(heart), kz(heart));
        g.mark = { x: h.x, y: h.y, z: h.z, mob: null, giant, until: g.time + MARK_TIME };
        markFx(g);
        return;
      }
    }
  }
  g.mark = { x: t.x, y: t.y, z: t.z, mob, giant: null, until: g.time + MARK_TIME };
  markFx(g);
}

function markFx(g: Game): void {
  const m = g.mark!;
  g.sfx('click', 'metal', 0.9, 1.4);
  g.sfx('bell', 'metal', 0.35, 1.6);
  g.particles.ring(m.x, m.y + 0.3, m.z, 2.2, 1, 0.3, 0.2);
  g.flags.fired += 1;
  g.report('primary_input');
}

/** Where the marked target is now (it follows a monster or a giant), or null once it has gone. */
export function markPoint(g: Game): { x: number; y: number; z: number; mob: Actor | null } | null {
  const m = g.mark;
  if (!m || g.time > m.until) return null;
  if (m.mob) {
    if (m.mob.dead) return null;
    return { x: m.mob.x, y: m.mob.y + m.mob.h * 0.5, z: m.mob.z, mob: m.mob };
  }
  if (m.giant) {
    if (m.giant.dead) return null;
    const heart = m.giant.body.findBlock(B.GIANT_HEART);
    if (heart === null) return null;
    const h = m.giant.body.cellCenter(kx(heart), ky(heart), kz(heart));
    return { x: h.x, y: h.y, z: h.z, mob: null };
  }
  return { x: m.x, y: m.y, z: m.z, mob: null };
}

/** Crew and builder alike: send a planned shot on its way (a Heartbreaker if `breaker`). */
export function launchShot(g: Game, key: number, s: Shot, crew: boolean, breaker = false): void {
  const F = g.fortress;
  const state = F.cannons.get(key);
  if (!state) return;
  // The barrel's aim is kept relative to the deck, so it turns with the fortress.
  const aim = Math.atan2(s.vz, s.vx);
  state.yaw = aim - F.yaw;
  state.pitch = Math.atan2(s.vy, Math.hypot(s.vx, s.vz));
  const spec = TURRET[s.kind];
  // A gunner on the guns (co-op) reloads them faster by hand.
  state.cooldown = (crew ? spec.crew : spec.cooldown * (g.gunner ? GUNNER_RELOAD : 1)) * (hasOfficer(g, 'kel') ? 0.67 : 1);
  state.recoil = 1;
  const [ax, ay, az] = forward(aim, state.pitch);
  const mx = s.sx + ax * 1.1;
  const my = s.sy + ay * 1.1;
  const mz = s.sz + az * 1.1;
  const kind = breaker ? 'breaker' : s.kind === 'ballista' ? 'bolt' : s.kind === 'mortar' ? 'shell' : 'tnt';
  g.projectiles.push({ kind, x: mx, y: my, z: mz, vx: s.vx, vy: s.vy, vz: s.vz, age: 0, life: s.t + (kind === 'bolt' ? 0.6 : 0.8), spin: 0, fromCrew: crew, by: crew ? null : g.cx });
  // Your own shot kicks: the view jolts up and the phone thumps.
  if (!crew) {
    g.punch(kind === 'shell' || kind === 'breaker' ? 0.05 : kind === 'tnt' ? 0.035 : 0.014);
    g.buzz(kind === 'bolt' ? 12 : 28);
  }
  if (kind === 'bolt') {
    g.particles.smoke(mx, my, mz, 2, 0.3);
    g.sfx('ballista', 'wood', crew ? 0.55 : 0.9);
    return;
  }
  g.particles.smoke(mx, my, mz, kind === 'shell' ? 12 : 7, kind === 'shell' ? 1 : 0.6);
  g.particles.sparks(mx, my, mz, kind === 'breaker' ? ['#a4f04a', '#ffffff'] : ['#ffe070', '#ff8a20'], crew ? 8 : 14, crew ? 4 : 6, 0.1, 0.3);
  g.light({ x: mx, y: my, z: mz, r: kind === 'shell' ? 8 : crew ? 5 : 7, color: [1, 0.75, 0.35], life: crew ? 0.18 : 0.24, max: crew ? 0.18 : 0.24 });
  if (kind === 'shell') g.sfx('mortar', 'metal', crew ? 0.6 : 1);
  else g.sfx('cannon', 'stone', crew ? 0.6 : 1);
  g.renderer.shake(crew ? 0.08 : kind === 'shell' ? 0.3 : 0.2);
}

const THROW_RANGE = 26;

/** Where a hand-thrown TNT goes when thrown along a ray: a lob to the aim point (or as far as you can throw). */
export function planThrow(g: Game, ray: Ray): Shot {
  const target = aimPoint(g, ray);
  const p = g.player;
  const sx = p.x + ray.dx * 0.5;
  const sy = p.y + EYE_HEIGHT - 0.25;
  const sz = p.z + ray.dz * 0.5;
  let tx = target.x;
  let ty = target.y;
  let tz = target.z;
  const d = dist3(sx, sy, sz, tx, ty, tz);
  if (d > THROW_RANGE) {
    const k = THROW_RANGE / d;
    tx = sx + (tx - sx) * k;
    ty = sy + (ty - sy) * k;
    tz = sz + (tz - sz) * k;
  }
  const t = clamp(Math.min(d, THROW_RANGE) / 15, 0.3, 1.5);
  return { kind: 'cannon', sx, sy, sz, vx: (tx - sx) / t, vy: (ty - sy + 0.5 * TNT_GRAVITY * t * t) / t, vz: (tz - sz) / t, grav: TNT_GRAVITY, t };
}

/** Throws a lit TNT from your pack at what you aim at. */
export function throwTnt(g: Game, ray: Ray): boolean {
  if (g.throwCooldown > 0 || g.player.dead) return false;
  if (!g.useItem(I.TNT, 1)) {
    g.deny('No TNT left! Loot chests, craft it or buy it');
    return false;
  }
  const s = planThrow(g, ray);
  g.projectiles.push({ kind: 'thrown', x: s.sx, y: s.sy, z: s.sz, vx: s.vx, vy: s.vy, vz: s.vz, age: 0, life: s.t + 1.2, spin: 0, fromCrew: false, by: g.cx });
  g.throwCooldown = 0.5;
  g.mining.swing = 0.3;
  g.flags.threw += 1;
  g.sfx('leap', 'wood', 0.5);
  g.sfx('hiss', 'stone', 0.4);
  g.report('primary_input');
  return true;
}

/** A skeleton looses an arrow at a point (a stray's carries slowness). */
export function shootArrow(g: Game, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, effect?: EffectId, owner?: Actor): void {
  const d = dist3(sx, sy, sz, tx, ty, tz);
  const t = clamp(d / 22, 0.3, 1.2);
  const grav = 14;
  const vx = (tx - sx) / t + (Math.random() - 0.5) * 1.2;
  const vz = (tz - sz) / t + (Math.random() - 0.5) * 1.2;
  const vy = (ty - sy + 0.5 * grav * t * t) / t;
  g.projectiles.push({ kind: 'arrow', x: sx, y: sy, z: sz, vx, vy, vz, age: 0, life: 3, spin: 0, fromCrew: false, effect, owner });
  g.sfxAt('bow', sx, sy, sz, 0.9);
}

/** A mob hit by one of your shots: a hit marker for the shots you fired yourself. */
function marked(g: Game, pr: Projectile, kill: boolean): void {
  if (pr.fromCrew) return;
  g.hitMarker(kill);
}

/**
 * A projectile's trail (flame, smoke, sparks) for one step. In co-op each device draws trails for
 * itself (they are not sent over the line).
 */
export function projectileTrail(g: Game, pr: Projectile): void {
  switch (pr.kind) {
    case 'fireball': {
  if (Math.random() < 0.8) g.particles.add({ x: pr.x, y: pr.y, z: pr.z, vx: (Math.random() - 0.5) * 0.6, vy: 0.5, vz: (Math.random() - 0.5) * 0.6, life: 0.45, size: 0.5, grow: -0.5, r: 1, g: 0.55, b: 0.15, a: 0.9, emit: 1.2, gravity: -1, drag: 1.5, tile: 'flame', soft: true, spin: Math.random() * 6 });
  if (Math.random() < 0.3) g.particles.smoke(pr.x, pr.y, pr.z, 1, 0.3, true);
      return;
    }
    case 'skull':
    case 'blueskull': {
      const blue = pr.kind === 'blueskull';
  if (Math.random() < 0.7) g.particles.add({ x: pr.x, y: pr.y, z: pr.z, vx: 0, vy: 0.3, vz: 0, life: 0.6, size: 0.4, grow: 0.5, r: blue ? 0.4 : 0.12, g: blue ? 0.55 : 0.1, b: blue ? 1 : 0.14, a: 0.6, emit: blue ? 0.8 : 0, gravity: -0.5, drag: 1.5, tile: 'smoke', soft: true, spin: Math.random() * 6 });
      return;
    }
    case 'pearl': {
  if (Math.random() < 0.6) g.particles.add({ x: pr.x, y: pr.y, z: pr.z, vx: 0, vy: 0, vz: 0, life: 0.5, size: 0.1, r: 0.5, g: 0.3, b: 0.9, a: 1, emit: 1, gravity: 0, drag: 1, tile: 'spark', soft: true });
      return;
    }
    case 'tnt':
    case 'shell':
    case 'thrown':
    case 'breaker':
    case 'crate':
    case 'gshell': {
  if (Math.random() < 0.6) g.particles.sparks(pr.x, pr.y + 0.35, pr.z, pr.kind === 'breaker' ? ['#a4f04a', '#d0ff8a'] : ['#ffe070', '#ff8a20'], 1, 0.8, 0.07, 0.3);
  if (Math.random() < (pr.kind === 'shell' || pr.kind === 'gshell' ? 0.7 : 0.4)) g.particles.smoke(pr.x, pr.y, pr.z, 1, 0.1);
      return;
    }
    default:
  }
}

function trail(g: Game, pr: Projectile): void {
  g.fxMute += 1;
  try {
    projectileTrail(g, pr);
  } finally {
    g.fxMute -= 1;
  }
}

export function updateProjectiles(g: Game, dt: number): void {
  // (Hit-tests below add stuck arrows and splashes; new projectiles join next step.)
  for (const pr of g.projectiles) {
    pr.age += dt;
    if (pr.by && pr.by !== g.cx) g.withCtx(pr.by, () => flyProjectile(g, pr, dt));
    else flyProjectile(g, pr, dt);
  }
  g.projectiles = g.projectiles.filter((pr) => pr.age !== Infinity && pr.y > -10);
  if (g.stuckArrows.length) {
    for (const a of g.stuckArrows) a.t -= dt;
    g.stuckArrows = g.stuckArrows.filter((a) => a.t > 0).slice(-40);
  }
}

function flyProjectile(g: Game, pr: Projectile, dt: number): void {
  {
    switch (pr.kind) {
      case 'arrow':
      case 'ibolt':
        flyArrow(g, pr, dt);
        break;
      case 'bolt':
        flyBolt(g, pr, dt);
        break;
      case 'fireball':
        flyFireball(g, pr, dt);
        break;
      case 'skull':
      case 'blueskull':
        flySkull(g, pr, dt);
        break;
      case 'potion':
        flyPotion(g, pr, dt);
        break;
      case 'pearl':
        flyPearl(g, pr, dt);
        break;
      case 'trident':
        flyArrow(g, pr, dt);
        break;
      case 'wind':
        flyWind(g, pr, dt);
        break;
      case 'ember':
        flyEmber(g, pr, dt);
        break;
      case 'web':
        flyWeb(g, pr, dt);
        break;
      default:
        flyTnt(g, pr, dt);
    }
  }
}

/** Whether a point is inside a player's body (with a little padding). */
function hitsPlayer(g: Game, x: number, y: number, z: number, pad: number): boolean {
  return g.playerAt(x, y, z, pad) !== null;
}

/** A monster a point is inside of (besides one to ignore). */
function mobAt(g: Game, x: number, y: number, z: number, pad: number, skip: Actor | null | undefined): Actor | null {
  for (const m of g.mobs) {
    if (m.dead || m === skip) continue;
    if (Math.abs(m.x - x) < m.hw + pad && Math.abs(m.z - z) < m.hw + pad && y > m.y - 0.2 && y < m.y + m.h + 0.2) return m;
  }
  return null;
}

/** An arrow (or bolt) stays stuck where it landed for a while; one in your hull rides along. */
function stick(g: Game, pr: Projectile, intoFortress: boolean): void {
  const l = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
  const dx = pr.vx / l;
  const dy = pr.vy / l;
  const dz = pr.vz / l;
  const F = g.fortress;
  const local = intoFortress ? F.toLocal(pr.x, pr.y, pr.z) : null;
  const ldir = intoFortress ? (() => {
    const [lx, lz] = F.dirToLocal(dx, dz);
    return [lx, dy, lz] as Vec3;
  })() : null;
  g.stuckArrows.push({ x: pr.x, y: pr.y, z: pr.z, dx, dy, dz, t: 7, local, ldir, big: pr.kind === 'ibolt' });
  g.sfxAt('arrowhit', pr.x, pr.y, pr.z, 0.7, 0.9 + Math.random() * 0.2);
}

/** A skeleton's arrow (gravity), a pillager's crossbow bolt (fast, nearly flat) or a drowned's trident. */
function flyArrow(g: Game, pr: Projectile, dt: number): void {
  const bolt = pr.kind === 'ibolt';
  const trident = pr.kind === 'trident';
  const steps = bolt ? 3 : 2;
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    pr.vy -= (bolt ? 4 : trident ? 9 : 14) * h;
    pr.x += pr.vx * h;
    pr.y += pr.vy * h;
    pr.z += pr.vz * h;
    const victim = g.playerAt(pr.x, pr.y, pr.z, 0.2);
    if (victim) {
      const dmg = trident ? 4 + Math.floor(g.danger / 2) : bolt ? 3 + Math.floor(g.danger / 3) : 2 + Math.floor(g.danger / 3);
      g.withCtx(victim, () => {
        damagePlayer(g, dmg, pr.vx * 0.15, pr.vz * 0.15, pr.effect, pr.effect ? 6 : 0);
        if (pr.effect === 'slowness') g.toast('A stray\'s arrow: SLOWED', 'fx_slowness');
        if (pr.effect === 'poison') g.toast('A bogged\'s arrow: POISONED', 'fx_poison');
      });
      pr.age = Infinity;
      return;
    }
    if (g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z))) {
      stick(g, pr, false);
      pr.age = Infinity;
      return;
    }
    if (g.fortress.solidAtWorld(pr.x, pr.y, pr.z)) {
      stick(g, pr, true);
      // Crossbow bolts chip the hull.
      if (bolt) {
        const [lx, ly, lz] = g.fortress.cellAt(pr.x, pr.y, pr.z);
        damageFortressCell(g, key3(lx, ly, lz), 1.5);
      }
      pr.age = Infinity;
      return;
    }
  }
  if (pr.age > pr.life) pr.age = Infinity;
}

/** A ballista's (or your crossbow's) bolt: fast, sub-stepped, it can bat a fireball back. */
function flyBolt(g: Game, pr: Projectile, dt: number): void {
  // Sub-steps: bolts are fast enough to skip through a mob in one frame.
  const steps = 3;
  const h = dt / steps;
  for (let i = 0; i < steps && pr.age !== Infinity; i += 1) {
    pr.vy -= BOLT_GRAVITY * h;
    pr.x += pr.vx * h;
    pr.y += pr.vy * h;
    pr.z += pr.vz * h;
    // A bolt through a fireball sends it back where it came from.
    for (const f of g.projectiles) {
      if (f.kind !== 'fireball' || f.deflected || f.age === Infinity) continue;
      if (Math.hypot(f.x - pr.x, f.y - pr.y, f.z - pr.z) > 1) continue;
      deflect(g, f, !pr.fromCrew);
      pr.age = Infinity;
      break;
    }
    if (pr.age === Infinity) break;
    for (const mob of g.mobs) {
      if (mob.dead || Math.abs(mob.x - pr.x) > mob.hw + 0.35 || Math.abs(mob.z - pr.z) > mob.hw + 0.35 || pr.y < mob.y - 0.2 || pr.y > mob.y + mob.h + 0.2) continue;
      const l = Math.hypot(pr.vx, pr.vz) || 1;
      const hpBefore = mob.hp;
      damageMob(g, mob, 9 + g.danger * 0.6, (pr.vx / l) * 5, (pr.vz / l) * 5, pr.fromCrew ? null : 'player', 'shot');
      // An enderman sidestepped it: the bolt flies on through where it stood.
      if (mob.kind === 'enderman' && !mob.dead && mob.hp === hpBefore) continue;
      marked(g, pr, hpBefore > 0 && mob.hp <= 0);
      if (hpBefore > 0 && mob.hp <= 0) bountyCount(g, 'turret');
      g.particles.sparks(pr.x, pr.y, pr.z, ['#ffffff', '#c0c0c0'], 4, 2, 0.06, 0.25);
      pr.age = Infinity;
      break;
    }
    if (pr.age === Infinity) break;
    for (const giant of g.giants) {
      if (giant.dead) continue;
      const [lx, ly, lz] = giant.body.cellAt(pr.x, pr.y, pr.z);
      if (!giant.body.solidAt(lx, ly, lz)) continue;
      damageGiantCell(g, giant, key3(lx, ly, lz), 6);
      marked(g, pr, false);
      g.particles.sparks(pr.x, pr.y, pr.z, ['#ffffff', '#a0a0a0'], 5, 2, 0.06, 0.25);
      pr.age = Infinity;
      break;
    }
    if (pr.age === Infinity) break;
    // (Bolts are all yours, a turret's or your crossbow's: they fly out through your own walls.)
    if (g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z))) {
      g.particles.debris(pr.x, pr.y, pr.z, 'planks_oak', 2, 1.5, 0.08, 0.3);
      if (!pr.fromCrew) stick(g, pr, false);
      pr.age = Infinity;
    } else if (pr.age > pr.life) pr.age = Infinity;
  }
}

/** A wind charge: straight and quick; it bursts against whatever it meets and hurls everything away. */
function flyWind(g: Game, pr: Projectile, dt: number): void {
  const mine = pr.by !== undefined && pr.by !== null;
  // (A thrown one is quick: it moves in short steps so it cannot skip through a one-block deck.)
  const steps = mine ? Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy, pr.vz) * dt) / 0.45)) : 1;
  for (let i = 0; i < steps && pr.age !== Infinity; i += 1) windStep(g, pr, dt / steps, mine);
}

function windStep(g: Game, pr: Projectile, dt: number, mine: boolean): void {
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.z += pr.vz * dt;
  pr.spin += dt * 14;
  if (Math.random() < 0.6) g.particles.add({ x: pr.x, y: pr.y, z: pr.z, vx: 0, vy: 0, vz: 0, life: 0.35, size: 0.3, grow: 1.2, r: 0.88, g: 0.96, b: 1, a: 0.5, gravity: 0, drag: 1, tile: 'smoke', soft: true });
  let hit = pr.age >= pr.life || g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z));
  // (A breeze's charge flies clear of the hull before it can burst on it; yours bursts on the deck
  // at your feet: a leap.)
  if (!hit && pr.age > (mine ? 0.02 : 0.12) && g.fortress.solidAtWorld(pr.x, pr.y, pr.z)) hit = true;
  if (!hit && !mine && hitsPlayer(g, pr.x, pr.y, pr.z, 0.6)) hit = true;
  if (!hit && mine && pr.age > 0.05 && mobAt(g, pr.x, pr.y, pr.z, 0.6, null)) hit = true;
  if (!hit) return;
  pr.age = Infinity;
  windBurst(g, pr.x, pr.y, pr.z, mine);
}

/** A blaze's small fireball: it singes whoever it hits, and scorches the hull a little. */
function flyEmber(g: Game, pr: Projectile, dt: number): void {
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.z += pr.vz * dt;
  pr.spin += dt * 9;
  if (Math.random() < 0.7) g.particles.sparks(pr.x, pr.y, pr.z, ['#ffd040', '#ff8a20'], 1, 0.6, 0.06, 0.25);
  const victim = g.playerAt(pr.x, pr.y, pr.z, 0.3);
  if (victim) {
    g.withCtx(victim, () => damagePlayer(g, 3 + Math.floor(g.danger / 3), pr.vx * 0.12, pr.vz * 0.12));
    pr.age = Infinity;
  } else if (pr.age > 0.1 && g.fortress.solidAtWorld(pr.x, pr.y, pr.z)) {
    const [lx, ly, lz] = g.fortress.cellAt(pr.x, pr.y, pr.z);
    damageFortressCell(g, key3(lx, ly, lz), 2 + g.danger * 0.2);
    pr.age = Infinity;
  } else if (pr.age >= pr.life || g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z))) pr.age = Infinity;
  if (pr.age === Infinity) {
    g.particles.sparks(pr.x, pr.y, pr.z, ['#ffd040', '#ff8a20', '#ff4010'], 10, 3, 0.1, 0.4);
    g.sfxAt('fireball', pr.x, pr.y, pr.z, 0.35, 1.6);
  }
}

/** The Brood Queen's web: a lobbed glob that tangles whoever it hits (and strings a cobweb where it lands). */
function flyWeb(g: Game, pr: Projectile, dt: number): void {
  pr.vy -= 9.8 * dt;
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.z += pr.vz * dt;
  pr.spin += dt * 5;
  const victim = g.playerAt(pr.x, pr.y, pr.z, 0.4);
  const ix = Math.floor(pr.x);
  const iy = Math.floor(pr.y);
  const iz = Math.floor(pr.z);
  if (victim) {
    g.withCtx(victim, () => {
      damagePlayer(g, 1, 0, 0, 'slowness', 5);
      g.toast('Tangled in web: SLOWED', 'fx_slowness');
    });
  } else if (!(pr.age >= pr.life || g.world.solid(ix, iy, iz) || (pr.age > 0.15 && g.fortress.solidAtWorld(pr.x, pr.y, pr.z)))) return;
  pr.age = Infinity;
  g.particles.debris(pr.x, pr.y, pr.z, 'cobweb', 8, 2.5);
  // A web strung where it landed (in the open air above the ground only).
  const above = iy + 1;
  if (!victim && g.world.get(ix, above, iz) === B.AIR && g.world.solid(ix, iy, iz)) g.world.set(ix, above, iz, B.COBWEB);
}

/**
 * A ghast's fireball: straight and steady, trailing fire. It bursts against whatever it meets (your
 * hull too). Batted back, it seeks out its ghast instead (and it spares your deck).
 */
function flyFireball(g: Game, pr: Projectile, dt: number): void {
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.z += pr.vz * dt;
  pr.spin += dt * 6;
  trail(g, pr);
  let hit = pr.age >= pr.life || g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z));
  if (!hit && pr.age > 0.15 && g.fortress.solidAtWorld(pr.x, pr.y, pr.z)) hit = true;
  // (A titan's own fireball clears its body before it can burst on it.)
  if (!hit && pr.age > 0.35) for (const giant of g.giants) if (!giant.dead && giant.body.solidAtWorld(pr.x, pr.y, pr.z)) hit = true;
  if (!hit && !pr.deflected && hitsPlayer(g, pr.x, pr.y, pr.z, 0.5)) hit = true;
  const m = !hit && pr.deflected ? mobAt(g, pr.x, pr.y, pr.z, 0.6, null) : null;
  if (m && m.kind === 'ghast') {
    pr.age = Infinity;
    fireballHitsGhast(g, pr, m);
    return;
  }
  if (!hit && !m) return;
  pr.age = Infinity;
  const yours = pr.deflected;
  explode(g, pr.x, pr.y, pr.z, { radius: 2, fortress: yours ? 0 : 16 + g.danger * 1.5, giant: 8, mob: 12, player: yours ? 0 : 6, terrain: 1.4, source: yours ? 'player' : null });
  g.sfxAt('fireball', pr.x, pr.y, pr.z, 0.6, 0.7);
}

/** One of the Wither's skulls: straight, smoking; black ones are quick, blue ones slow and terrible. */
function flySkull(g: Game, pr: Projectile, dt: number): void {
  const blue = pr.kind === 'blueskull';
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.z += pr.vz * dt;
  pr.spin += dt * 4;
  trail(g, pr);
  let hit = pr.age >= pr.life || g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z));
  if (!hit && pr.age > 0.1 && g.fortress.solidAtWorld(pr.x, pr.y, pr.z)) hit = true;
  if (!hit) for (const giant of g.giants) if (!giant.dead && giant.body.solidAtWorld(pr.x, pr.y, pr.z)) hit = true;
  if (!hit && hitsPlayer(g, pr.x, pr.y, pr.z, 0.4)) hit = true;
  if (!hit && pr.age > 0.2 && mobAt(g, pr.x, pr.y, pr.z, 0.4, pr.owner)) hit = true;
  if (!hit) return;
  pr.age = Infinity;
  const r = blue ? 2.4 : 1.4;
  explode(g, pr.x, pr.y, pr.z, { radius: r, fortress: blue ? 22 : 10, giant: blue ? 14 : 6, mob: blue ? 18 : 10, player: blue ? 9 : 5, terrain: blue ? 2.2 : 1 });
  g.eachPlayer((p) => {
    if (!p.dead && dist3(p.x, p.cy, p.z, pr.x, pr.y, pr.z) < r + 1.2) addEffect(g, 'wither', blue ? 12 : 8);
  });
  g.particles.smoke(pr.x, pr.y, pr.z, 8, r, true);
}

/** A witch's splash potion, lobbed: it shatters on whatever it meets. */
function flyPotion(g: Game, pr: Projectile, dt: number): void {
  pr.vy -= 18 * dt;
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.z += pr.vz * dt;
  pr.spin += dt * 10;
  let hit = pr.age >= pr.life || g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z));
  if (!hit && pr.age > 0.1 && g.fortress.solidAtWorld(pr.x, pr.y, pr.z)) hit = true;
  if (!hit && hitsPlayer(g, pr.x, pr.y, pr.z, 0.3)) hit = true;
  if (!hit) return;
  pr.age = Infinity;
  potionSplash(g, pr);
}

/**
 * Your ender pearl: where it lands, you appear (a few hearts' worth of jolt, as in Minecraft). It is
 * how a captain left on the ground gets back aboard in a hurry.
 */
function flyPearl(g: Game, pr: Projectile, dt: number): void {
  const px = pr.x;
  const py = pr.y;
  const pz = pr.z;
  pr.vy -= TNT_GRAVITY * dt;
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.z += pr.vz * dt;
  trail(g, pr);
  const F = g.fortress;
  const world = g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z));
  const hull = pr.age > 0.1 && F.solidAtWorld(pr.x, pr.y, pr.z);
  if (!world && !hull) {
    if (pr.age > pr.life) pr.age = Infinity;
    return;
  }
  pr.age = Infinity;
  const p = g.player;
  if (p.dead || g.cx.away) return;
  const from: Vec3 = [p.x, p.y, p.z];
  // Arrive just above the spot it struck, nudged clear of whatever is there.
  p.x = px;
  p.y = py - 0.5;
  p.z = pz;
  p.vx = p.vy = p.vz = 0;
  const grids = g.grids();
  for (let k = 0; k < 6 && grids.some((gr) => overlaps(p, gr)); k += 1) p.y += 0.6;
  p.standingOn = hull ? F : null;
  p.onGround = false;
  g.helm = false;
  g.gunner = false;
  g.leap = null;
  g.cx.sink?.moved();
  for (const at of [from, [p.x, p.y, p.z] as Vec3]) {
    for (let i = 0; i < 14; i += 1) g.particles.add({ x: at[0] + (Math.random() - 0.5), y: at[1] + Math.random() * 1.8, z: at[2] + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.3) * 1.5, vz: (Math.random() - 0.5) * 2, life: 0.8, size: 0.12, r: 0.78, g: 0.3, b: 1, a: 1, emit: 1.2, gravity: 0.6, drag: 1.5, tile: 'spark', soft: true });
  }
  g.sfx('teleport', 'glass', 1);
  damagePlayer(g, 2, 0, 0);
  feat(g, 'pearl');
}

/** Throws an ender pearl along the arc (you appear where it lands). */
export function throwPearl(g: Game, ray: Ray): boolean {
  if (g.throwCooldown > 0 || g.player.dead) return false;
  if (!g.useItem(I.PEARL, 1)) return false;
  const s = planThrow(g, ray);
  g.projectiles.push({ kind: 'pearl', x: s.sx, y: s.sy, z: s.sz, vx: s.vx, vy: s.vy, vz: s.vz, age: 0, life: s.t + 2.5, spin: 0, fromCrew: false, by: g.cx });
  g.throwCooldown = 0.8;
  g.mining.swing = 0.3;
  g.sfx('whoosh', 'wool', 0.6, 1.2);
  g.report('primary_input');
  return true;
}

/**
 * Throws a wind charge straight along the view: it bursts on whatever it meets (a monster, a wall,
 * the ground) and hurls everything near it away. Thrown at your own feet, it throws you up.
 */
export function throwWindCharge(g: Game, ray: Ray): boolean {
  if (g.throwCooldown > 0 || g.player.dead) return false;
  if (!g.useItem(I.WIND_CHARGE, 1)) return false;
  const speed = 24;
  const sx = ray.ox + ray.dx * 0.5;
  const sy = ray.oy + ray.dy * 0.5 - 0.15;
  const sz = ray.oz + ray.dz * 0.5;
  g.projectiles.push({ kind: 'wind', x: sx, y: sy, z: sz, vx: ray.dx * speed, vy: ray.dy * speed, vz: ray.dz * speed, age: 0, life: 1.5, spin: 0, fromCrew: false, by: g.cx });
  g.throwCooldown = 0.45;
  g.mining.swing = 0.3;
  g.sfx('whoosh', 'wool', 0.7, 1.4);
  g.report('primary_input');
  return true;
}

/** Cannon TNT, mortar shells, thrown TNT, Heartbreakers and giants' shells: lobbed, they burst where they land. */
function flyTnt(g: Game, pr: Projectile, dt: number): void {
  pr.vy -= TNT_GRAVITY * dt;
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.z += pr.vz * dt;
  pr.spin += dt * 9;
  const hostile = pr.kind === 'gshell';
  trail(g, pr);
  let hit = pr.age >= pr.life || g.world.solid(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z));
  // Your own shots fly out through your own walls and buildings; a giant's shell bursts on them (and
  // a crane's crate let go over your own deck lands on it, harmlessly loud).
  const crate = pr.kind === 'crate';
  if (!hit && (hostile || crate) && g.fortress.solidAtWorld(pr.x, pr.y, pr.z)) hit = true;
  if (!hit && !hostile) {
    for (const giant of g.giants) {
      if (!giant.dead && giant.body.solidAtWorld(pr.x, pr.y, pr.z)) {
        hit = true;
        break;
      }
    }
  }
  if (!hit && hostile && hitsPlayer(g, pr.x, pr.y, pr.z, 0.4)) hit = true;
  if (!hit && !hostile && mobAt(g, pr.x, pr.y, pr.z, crate ? 0.9 : 0.5, null)) hit = true;
  if (!hit) return;
  pr.age = Infinity;
  if (hostile) {
    // A giant's shell: your hull takes this one (a titan's hurled boulder a little less).
    const boulder = pr.block !== undefined;
    explode(g, pr.x, pr.y, pr.z, { radius: boulder ? 2.4 : 2.6, fortress: boulder ? 13 + g.danger * 1.5 : 18 + g.danger * 2, giant: 0, mob: 10, player: 7, terrain: 1.6 });
    return;
  }
  const before = g.mobs.filter((m) => !m.dead).length;
  const source = pr.fromCrew ? null : 'player';
  // (With the Magma Titan's core, the turrets' shells burn.)
  const burn = pr.kind !== 'thrown' && hasTrophy(g, 'magma') ? 1.3 : 1;
  if (pr.kind === 'breaker') {
    // A Heartbreaker: the biggest blast you can make (it spares your deck, not your ears).
    explode(g, pr.x, pr.y, pr.z, { radius: 5.4, fortress: 0, giant: 46, mob: 44, player: 4, terrain: 3.8, source });
    g.particles.ring(pr.x, pr.y, pr.z, 7, 0.55, 1, 0.5);
    g.particles.sparks(pr.x, pr.y, pr.z, ['#a4f04a', '#d0ff8a', '#ffffff'], 30, 12, 0.16, 0.8);
    g.renderer.shake(1.1);
    g.freeze(0.12);
    g.sfx('ram', 'stone', 0.8);
  } else if (crate) {
    // The crane's crate: four TNT at once, from on high (it spares your deck).
    const b = crateBlast(g);
    explode(g, pr.x, pr.y, pr.z, { radius: b.radius, fortress: 0, giant: 24 * b.power, mob: 34 * b.power, player: 3, terrain: 2.6, source });
    g.particles.ring(pr.x, pr.y, pr.z, b.radius + 1, 0.5, 0.9, 0.45);
    g.particles.sparks(pr.x, pr.y + 0.5, pr.z, ['#ffd060', '#ff7a2a', '#ffffff'], 30, 10, 0.15, 0.8);
    g.renderer.shake(0.85);
    g.sfx('ram', 'stone', 0.7, 0.9);
  } else if (pr.kind === 'shell') explode(g, pr.x, pr.y, pr.z, { radius: 4.4, fortress: 0, giant: 14 * burn, mob: 24 * burn, player: 0, terrain: 3.0, source });
  // Hand-thrown TNT: a smaller blast that spares your own deck (but not your eyebrows).
  else if (pr.kind === 'thrown') explode(g, pr.x, pr.y, pr.z, { radius: 2.8, fortress: 0, giant: 9, mob: 17, player: 3, terrain: 1.8, source });
  else explode(g, pr.x, pr.y, pr.z, { radius: 3.2, fortress: 0, giant: 10 * burn, mob: 18 * burn, player: 0, terrain: 2.2, source });
  const after = g.mobs.filter((m) => !m.dead).length;
  if (!pr.fromCrew && after < before) marked(g, pr, true);
  if (crate) crateLanded(g, pr, before - after);
  else if (after < before && pr.kind !== 'thrown' && pr.kind !== 'breaker') bountyCount(g, 'turret', before - after);
}

export interface Blast {
  radius: number;
  fortress: number;
  giant: number;
  mob: number;
  player: number;
  terrain: number;
  /** Whose blast it is (yours: damage numbers pop and the world holds for a beat). */
  source?: HitSource;
}

function segmentDist(x: number, y: number, z: number, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz || 1;
  const t = clamp(((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / l2, 0, 1);
  return Math.hypot(x - a[0] - abx * t, y - a[1] - aby * t, z - a[2] - abz * t);
}

export function explode(g: Game, x: number, y: number, z: number, o: Blast): void {
  const w = g.world;
  const tr = o.terrain;
  for (let cy = Math.floor(y - tr); cy <= Math.floor(y + tr); cy += 1) {
    for (let cz = Math.floor(z - tr); cz <= Math.floor(z + tr); cz += 1) {
      for (let cx = Math.floor(x - tr); cx <= Math.floor(x + tr); cx += 1) {
        const d = dist3(cx + 0.5, cy + 0.5, cz + 0.5, x, y, z);
        if (d > tr + 0.6) continue;
        const id = w.get(cx, cy, cz);
        if (id === B.AIR || id === B.BEDROCK || id === B.WATER || id === B.FALLING_WATER) continue;
        // The Citadel's heart cracks under any blast that reaches it.
        if (id === B.CITADEL_HEART) {
          if (d <= tr + 0.6) g.heartHit(cx, cy, cz);
          continue;
        }
        if (d > tr) continue;
        if (id === B.OBSIDIAN || id === B.ANVIL) continue;
        if (Math.random() > 1 - (d / tr) * 0.4) continue;
        if (id === B.CHEST && crestSafe(g, cx, cy, cz)) continue;
        if (id === B.CHEST) spillChest(g, cx, cy, cz);
        if (id === B.TNT_BLOCK) g.chainQueue.push({ x: cx + 0.5, y: cy + 0.5, z: cz + 0.5, t: 0.35 });
        w.set(cx, cy, cz, B.AIR);
        const def = blockDef(id);
        if (Math.random() < 0.4) g.particles.debris(cx + 0.5, cy + 0.5, cz + 0.5, def.tiles.side, 2, 5, 0.16, 0.8);
        if (def.drops.length > 0 && Math.random() < 0.12) spawnDrop(g, def.drops[0]![0], 1, cx + 0.5, cy + 0.5, cz + 0.5);
      }
    }
  }
  const hitBody = (body: BlockBody, dmg: number, apply: (key: number, amount: number) => void): void => {
    const hits: Array<[number, number]> = [];
    for (const key of body.cells.keys()) {
      const c = body.cellCenter(kx(key), ky(key), kz(key));
      const d = dist3(c.x, c.y, c.z, x, y, z);
      if (d < o.radius) hits.push([key, dmg * (1 - d / o.radius)]);
    }
    for (const [key, amount] of hits) apply(key, amount);
  };
  if (o.fortress > 0) {
    hitBody(g.fortress, o.fortress, (key, amount) => damageFortressCell(g, key, amount));
    // Blasts at its feet wreck the fortress's legs.
    const W = g.walker;
    W.legs.forEach((l, i) => {
      const hip = W.hipWorld(g.fortress, l);
      const knee = W.knee(g.fortress, l, hip);
      const d = Math.min(segmentDist(x, y, z, hip, knee), segmentDist(x, y, z, knee, l.foot));
      if (d < o.radius + 1) damageLeg(g, i, (o.fortress / 26) * 0.28 * (1 - d / (o.radius + 1)));
    });
  }
  if (o.giant > 0) for (const giant of g.giants) if (!giant.dead) hitBody(giant.body, o.giant, (key, amount) => damageGiantCell(g, giant, key, amount));
  for (const mob of g.mobs) {
    if (mob.dead) continue;
    const d = dist3(mob.x, mob.cy, mob.z, x, y, z);
    if (d < o.radius + 0.8) {
      const l = Math.hypot(mob.x - x, mob.z - z) || 1;
      damageMob(g, mob, o.mob * (1 - d / (o.radius + 0.8)), ((mob.x - x) / l) * 9, ((mob.z - z) / l) * 9, o.source ?? null);
    }
  }
  if (o.player > 0) {
    g.eachPlayer((p) => {
      if (p.dead) return;
      const d = dist3(p.x, p.cy, p.z, x, y, z);
      if (d >= o.radius + 0.6) return;
      const l = Math.hypot(p.x - x, p.z - z) || 1;
      damagePlayer(g, Math.round(o.player * (1 - d / (o.radius + 0.6))), ((p.x - x) / l) * 9, ((p.z - z) / l) * 9);
    });
  }
  g.particles.sparks(x, y, z, ['#ffe070', '#ff8a20', '#ffffff'], 22, 10, 0.15, 0.55);
  g.particles.smoke(x, y, z, 18, o.radius * 1.0);
  g.particles.flash(x, y, z, o.radius * 1.4);
  g.particles.ring(x, y, z, o.radius);
  g.light({ x, y, z, r: o.radius * 3.6, color: [1, 0.7, 0.3], life: 0.5, max: 0.5 });
  // Hens and sheep nearby bolt from the bang (unhurt, if a little ruffled).
  startle(g, x, y, z, o.radius * 2.5 + 4, 6);
  // Each player hears and feels it by how far away they are.
  const source = g.cx;
  g.eachPlayer((p) => {
    const pd = dist3(p.x, p.y, p.z, x, y, z);
    g.own(() => {
      g.renderer.shake(Math.min(1, (0.25 + o.radius * 0.12) * clamp(1.4 - pd / 30, 0.2, 1)));
      g.ear('explode', 'stone', clamp(1.3 - pd / 60, 0.25, 1));
      // Close by, a blast punches through the phone; your own ones hold the world for a beat.
      if (pd < 22) g.buzz(Math.round(clamp(80 - pd * 3, 20, 70)));
    });
    if (o.source && pd < 30 && g.cx === source) g.freeze(0.045);
  });
  g.report('visual_feedback');
}

// ------------------------------------------------------------------ leap

export interface LeapTarget {
  body: BlockBody;
  lx: number;
  ly: number;
  lz: number;
  back: boolean;
}

export function leapTarget(g: Game): LeapTarget | null {
  const p = g.player;
  if (p.dead || g.leap) return null;
  const onGiant = g.giants.find((gi) => !gi.dead && p.standingOn === gi.body);
  if (onGiant) {
    const F = g.fortress;
    // Back onto the deck: the free deck cell nearest the giant.
    const [gx, gz] = onGiant.body.hullCentre();
    let best: LeapTarget | null = null;
    let bestD = Infinity;
    for (const key of F.cells.keys()) {
      if (ky(key) !== 0) continue;
      const x = kx(key);
      const z = kz(key);
      if (F.hasBlock(x, 1, z) || F.hasBlock(x, 2, z)) continue;
      const [wx, , wz] = F.toWorld(x + 0.5, 0, z + 0.5);
      const d = Math.hypot(wx - gx, wz - gz);
      if (d < bestD) {
        bestD = d;
        best = { body: F, lx: x, ly: 1, lz: z, back: true };
      }
    }
    return best;
  }
  let best: Giant | null = null;
  let bestD = LEAP_RANGE;
  for (const giant of g.giants) {
    if (giant.dead) continue;
    const [bx, bz] = giant.body.hullCentre();
    const d = Math.hypot(bx - p.x, bz - p.z);
    if (d < bestD) {
      bestD = d;
      best = giant;
    }
  }
  if (!best) return null;
  const b = best.body;
  const midX = Math.round((b.minX + b.maxX) / 2);
  const midZ = Math.round((b.minZ + b.maxZ) / 2);
  for (const [dx, dz] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]] as const) {
    const top = b.topSolid(midX + dx, midZ + dz);
    if (top !== null) return { body: b, lx: midX + dx, ly: top + 1, lz: midZ + dz, back: false };
  }
  return null;
}

export function doLeap(g: Game): void {
  const target = leapTarget(g);
  if (!target || !g.isPlaying()) return;
  const p = g.player;
  const [tx, ty, tz] = target.body.toWorld(target.lx + 0.5, target.ly, target.lz + 0.5);
  const d = Math.hypot(tx - p.x, tz - p.z);
  g.leap = { body: target.body, lx: target.lx, ly: target.ly, lz: target.lz, sx: p.x, sy: p.y, sz: p.z, t: 0, dur: clamp(0.6 + d * 0.035, 0.6, 1.2), arc: 3 + Math.abs(ty - p.y) * 0.3 + d * 0.08 };
  p.standingOn = null;
  p.onGround = false;
  g.flags.leapt = true;
  g.particles.smoke(p.x, p.y, p.z, 6, 1);
  g.sfx('leap');
  g.report('primary_input');
}

export function updateLeap(g: Game, dt: number): void {
  const leap = g.leap!;
  const p = g.player;
  leap.t += dt;
  const u = Math.min(1, leap.t / leap.dur);
  const [tx, ty, tz] = leap.body.toWorld(leap.lx + 0.5, leap.ly, leap.lz + 0.5);
  p.x = leap.sx + (tx - leap.sx) * u;
  p.y = leap.sy + (ty - leap.sy) * u + Math.sin(u * Math.PI) * leap.arc;
  p.z = leap.sz + (tz - leap.sz) * u;
  p.vx = p.vy = p.vz = 0;
  if (u < 1) return;
  g.leap = null;
  p.x = tx;
  p.y = ty + 0.002;
  p.z = tz;
  p.onGround = true;
  p.standingOn = leap.body;
  p.invulnerable = 0.4;
  g.particles.smoke(p.x, p.y, p.z, 6, 1.2);
  g.sfx('land', 'stone', 1);
  const grid = bodyGrid(leap.body);
  for (let k = 0; k < 4 && overlaps(p, grid); k += 1) p.y += 1;
}
