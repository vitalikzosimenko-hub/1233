// The six seal guardians: how each rises, what it does in the fight, and when it is beaten.
// Three are giants of the Heart's own stone with tricks of their land (the Dune Titan's sandstone
// boulders, the Frost Titan's freezing breath, the Magma Titan's fire and blazes); three are
// creatures grown monstrous (the Brood Queen, the Slime King, the Ravager King and his warlord).
import { B } from './blocks';
import { kx, ky, kz } from './body';
import { explode } from './combat';
import { addEffect } from './effects';
import { Actor, type ActorKind } from './entities';
import type { Game } from './game';
import { createGiant, type Giant, type GiantType } from './giants';
import { damageLeg, damagePlayer, killMob, mount, setSlimeSize, spawnMob } from './mobs';
import { raider } from './monsters';
import { clamp } from './rng';
import { GUARDIANS, type GuardianState } from './seals';
import type { SealSite } from './terrain';

const TNT_G = 9.8;

const GIANT_OF: Partial<Record<GuardianState['kind'], GiantType>> = { dune: 'dune', frost: 'frost', magma: 'magma' };

/**
 * A guardian creature rises on dry, loaded ground near (x, z), searched outwards; failing that,
 * right where it is (it must rise: its seal only falls with it).
 */
function riseMob(g: Game, kind: ActorKind, x: number, z: number): Actor {
  for (let r = 0; r <= 12; r += 4) {
    const n = r === 0 ? 1 : 8;
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * Math.PI * 2;
      const mob = spawnMob(g, kind, x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (mob) return mob;
    }
  }
  const mob = new Actor(kind, Math.floor(x) + 0.5, g.world.groundAt(x, z), Math.floor(z) + 0.5);
  g.mobs.push(mob);
  return mob;
}

/** The guardian rises between the fortress and its seal. */
export function beginGuardian(g: Game, gs: GuardianState, s: SealSite): void {
  const T = g.world.terrain;
  const x = s.x - 34;
  const z = Math.round(T.centerZ(x) + (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10));
  const ground = g.world.groundAt(x, z);
  const danger = g.danger;
  const giantType = GIANT_OF[gs.kind];
  if (giantType) {
    const giant = createGiant(giantType, x, z, ground, 2.4 + danger * 0.25, -1, 0);
    giant.guardian = true;
    giant.walker.layout(giant.body, g.world);
    g.giants.push(giant);
    gs.giant = giant;
    gs.maxHp = heartHp(giant).max;
  } else if (gs.kind === 'slime') {
    const king = new Actor('slime', x, ground, z);
    setSlimeSize(king, 8);
    king.maxHp = Math.round(220 + danger * 24);
    king.hp = king.maxHp;
    king.speed = 1.7;
    king.boss = 'THE SLIME KING';
    g.mobs.push(king);
    gs.mob = king;
    gs.maxHp = king.maxHp;
  } else if (gs.kind === 'ravager') {
    const king = riseMob(g, 'ravager', x, z);
    king.resize(1.8);
    king.maxHp = Math.round(360 + danger * 28);
    king.hp = king.maxHp;
    king.speed *= 1.1;
    king.boss = 'THE RAVAGER KING';
    const lord = new Actor('evoker', king.x, king.y + king.h * 0.7, king.z);
    lord.maxHp = Math.round(60 + danger * 6);
    lord.hp = lord.maxHp;
    lord.captain = true;
    mount(lord, king);
    g.mobs.push(lord);
    gs.mob = king;
    gs.maxHp = king.maxHp;
  } else {
    const queen = riseMob(g, 'queen', x, z);
    queen.maxHp = Math.round(320 + danger * 26);
    queen.hp = queen.maxHp;
    queen.boss = 'THE BROOD QUEEN';
    gs.mob = queen;
    gs.maxHp = queen.maxHp;
  }
  // It bursts up out of the ground: a fountain of earth, a quake, a ring.
  for (let k = 0; k < 4; k += 1) g.particles.dust(x + (Math.random() - 0.5) * 8, ground + 0.5, z + (Math.random() - 0.5) * 8, 18, 4, false);
  g.particles.debris(x, ground + 1, z, gs.kind === 'frost' ? 'snow' : gs.kind === 'magma' ? 'magma' : gs.kind === 'dune' ? 'sand' : 'dirt', 30, 8);
  g.particles.ring(x, ground + 1, z, 10, 0.9, 0.85, 0.7);
  g.sfxAt('quake', x, ground, z, 1, 1, 160);
  g.sfxAt('roar', x, ground + 4, z, 1.1, 0.6);
}

function heartHp(giant: Giant): { hp: number; max: number } {
  const key = giant.body.findBlock(B.GIANT_HEART);
  const cell = key !== null ? giant.body.cells.get(key) : undefined;
  return cell ? { hp: cell.hp, max: cell.maxHp } : { hp: 0, max: 1 };
}

export function guardianAlive(gs: GuardianState): boolean {
  if (gs.giant) return !gs.giant.dead;
  return gs.mob !== null && !gs.mob.dead;
}

/** How much of the guardian is left (0..1), for its bar. */
export function guardianFrac(gs: GuardianState): number {
  if (gs.giant) return gs.giant.dead ? 0 : clamp(heartHp(gs.giant).hp / Math.max(1, gs.maxHp), 0, 1);
  if (!gs.mob || gs.mob.dead) return 0;
  return clamp(gs.mob.hp / Math.max(1, gs.maxHp), 0, 1);
}

/** The fortress walked away: the guardian goes back to its post (gone until you return). */
export function guardianLeave(g: Game, gs: GuardianState): void {
  if (gs.giant) {
    gs.giant.dead = true;
    gs.giant.body.cells.clear();
  }
  if (gs.mob) {
    gs.mob.dead = true;
    if (gs.mob.rider) gs.mob.rider.dead = true;
  }
}

/** The guardian is beaten: whatever rode it falls with it (the Ravager King's warlord). */
export function guardianFalls(g: Game, gs: GuardianState): void {
  const rider = gs.mob?.rider;
  if (rider && !rider.dead) killMob(g, rider, true);
}

/** A guardian's moves, beyond what its kind does anyway. */
export function updateGuardian(g: Game, gs: GuardianState, dt: number): void {
  for (let i = 0; i < gs.cd.length; i += 1) gs.cd[i] = gs.cd[i]! - dt;
  switch (gs.kind) {
    case 'slime':
      slimeKing(g, gs);
      break;
    case 'ravager':
      ravagerKing(g, gs);
      break;
    case 'dune':
    case 'frost':
    case 'magma':
      if (gs.giant && !gs.giant.dead) titanTricks(g, gs, gs.giant, dt);
      break;
    default:
      break;
  }
  keepInFight(g, gs, dt);
}

/** Whether a creature stands under the fortress's hull (where no turret can reach it). */
function underHull(g: Game, mob: Actor): boolean {
  const F = g.fortress;
  const [lx, , lz] = F.toLocal(mob.x, F.y + F.floorY, mob.z);
  return lx > F.minX - 0.5 && lx < F.maxX + 1.5 && lz > F.minZ - 0.5 && lz < F.maxZ + 1.5 && mob.y + mob.h * 0.5 < F.y + F.floorY - 1;
}

/**
 * A creature guardian that has taken no harm for a long while and is out of the fight (wedged
 * under the hull, or strayed far off) bursts back out in front of the fortress, so a seal can
 * never be left standing for good.
 */
function keepInFight(g: Game, gs: GuardianState, dt: number): void {
  const mob = gs.mob;
  if (!mob || mob.dead || gs.giant || mob.climb) return;
  if (gs.lastHp === undefined || mob.hp < gs.lastHp - 0.01) {
    gs.lastHp = mob.hp;
    gs.calm = 0;
    return;
  }
  gs.calm = (gs.calm ?? 0) + dt;
  if (gs.calm < 18) return;
  const c = g.fortressCentre();
  const far = Math.hypot(mob.x - c[0], mob.z - c[2]) > 70;
  if (!far && !underHull(g, mob)) return;
  gs.calm = 0;
  const s = g.world.terrain.seals[gs.seal]!;
  const x = c[0] + Math.sign(s.x - c[0] || 1) * (g.fortressRadius() + 9);
  const z = c[2] + (Math.random() - 0.5) * 12;
  g.particles.smoke(mob.x, mob.cy, mob.z, 12, 1.4);
  mob.x = x;
  mob.y = g.world.groundAt(x, z) + 0.5;
  mob.z = z;
  mob.vx = mob.vz = 0;
  mob.vy = 4;
  mob.onGround = false;
  mob.standingOn = null;
  for (let k = 0; k < 3; k += 1) g.particles.dust(x + (Math.random() - 0.5) * 4, mob.y, z + (Math.random() - 0.5) * 4, 12, 3, false);
  g.sfxAt('roar', x, mob.y + 2, z, 0.9, 0.7);
  g.toast(`${GUARDIANS[gs.kind].name} bursts out before the fortress!`);
}

// ------------------------------------------------------------------ the Slime King

/** A point on the deck (world) to leap at: near you if you are aboard, else anywhere on top. */
function deckPoint(g: Game): [number, number, number] {
  const F = g.fortress;
  const p = g.player;
  if (p.standingOn === F && !p.dead) return [p.x + (Math.random() - 0.5) * 3, p.y, p.z + (Math.random() - 0.5) * 3];
  const [x, z] = F.centre();
  return [x + (Math.random() - 0.5) * 6, F.y + F.floorY + 1, z + (Math.random() - 0.5) * 6];
}

function slimeKing(g: Game, gs: GuardianState): void {
  const king = gs.mob;
  if (!king || king.dead) return;
  const F = g.fortress;
  // Breaking up: at two thirds and a third it sheds two big slimes.
  const frac = king.hp / king.maxHp;
  if ((gs.phase === 0 && frac < 0.67) || (gs.phase === 1 && frac < 0.34)) {
    gs.phase += 1;
    for (let i = 0; i < 2; i += 1) {
      const s = new Actor('slime', king.x + (i ? 1 : -1), king.y + 1, king.z);
      setSlimeSize(s, 4);
      s.vy = 6;
      s.vx = (i ? 1 : -1) * 3;
      g.mobs.push(s);
    }
    g.sfxAt('slime', king.x, king.y, king.z, 1, 0.6);
    g.toast('The Slime King sheds its young!');
  }
  const onDeck = king.standingOn === F;
  // Under the hull it cannot leap for the deck (nor be shot): it bounces out from under first.
  if (king.onGround && !onDeck && underHull(g, king)) {
    const [cx, cz] = F.centre();
    const ax = king.x - cx;
    const az = king.z - cz;
    const l = Math.hypot(ax, az) || 1;
    king.vx = (ax / l) * 10;
    king.vz = (az / l) * 10;
    king.vy = 11;
    king.onGround = false;
    king.standingOn = null;
    king.act = 'none';
    king.aux = 1.4;
    gs.cd[0] = Math.max(gs.cd[0]!, 1.5);
    return;
  }
  // The great leap onto the deck (when it is down on the ground and has a breath).
  if (king.onGround && !onDeck && gs.cd[0]! <= 0) {
    gs.cd[0] = 7 + Math.random() * 3;
    const [tx, ty, tz] = deckPoint(g);
    const t = 1.7;
    king.vx = (tx - king.x) / t;
    king.vz = (tz - king.z) / t;
    king.vy = (ty - king.y + 0.5 * 28 * t * t) / t;
    king.onGround = false;
    king.standingOn = null;
    king.aux = 2.5;
    king.act = 'none';
    gs.cd[1] = 0;
    g.sfxAt('slime', king.x, king.y, king.z, 1.2, 0.5);
    g.toast('The Slime King leaps for the deck!');
  }
  // Landing on the deck: the whole fortress shudders, the deck buckles where it hits.
  if (onDeck && gs.cd[1]! <= 0) {
    gs.cd[1] = 99;
    explode(g, king.x, king.y + 0.5, king.z, { radius: 3.4, fortress: 10 + g.danger * 1.5, giant: 0, mob: 0, player: 5, terrain: 0 });
    F.shake = Math.max(F.shake, 0.6);
    g.renderer.shake(0.7);
    g.particles.ring(king.x, king.y + 0.3, king.z, 6, 0.45, 0.85, 0.35);
    // A few hops about the deck, then off again.
    gs.cd[2] = 5;
  }
  if (onDeck && gs.cd[2]! <= 0 && king.onGround) {
    // Off again, clear over the rail (down where the turrets can reach it).
    gs.cd[2] = 99;
    gs.cd[1] = 0;
    gs.cd[0] = Math.max(gs.cd[0]!, 6);
    const [cx, cz] = F.centre();
    let ax = king.x - cx;
    let az = king.z - cz;
    const d = Math.hypot(ax, az);
    if (d < 0.5) {
      const a = Math.random() * Math.PI * 2;
      ax = Math.cos(a);
      az = Math.sin(a);
    }
    const l = Math.hypot(ax, az) || 1;
    const speed = clamp((g.fortressRadius() + 5 - d) / 1.3, 6, 15);
    king.vx = (ax / l) * speed;
    king.vz = (az / l) * speed;
    king.vy = 9;
    king.onGround = false;
    king.standingOn = null;
    king.act = 'none';
    king.aux = 1.6;
  }
}

// ------------------------------------------------------------------ the Ravager King

function ravagerKing(g: Game, gs: GuardianState): void {
  const king = gs.mob;
  if (!king || king.dead) return;
  // Escorts: pillagers and a vindicator come over the rise every little while.
  if (gs.cd[0]! <= 0) {
    gs.cd[0] = 20 + Math.random() * 6;
    const n = 2 + Math.min(2, Math.floor(g.danger / 3));
    for (let i = 0; i < n + 1; i += 1) {
      const a = Math.random() * Math.PI * 2;
      raider(g, i === n ? 'vindicator' : 'pillager', king.x + Math.cos(a) * 8, king.z + Math.sin(a) * 8);
    }
    g.sfx('raidhorn', 'stone', 0.6);
  }
  // A charge into a leg every so often: the whole fortress staggers.
  if (gs.cd[1]! <= 0) {
    gs.cd[1] = 9;
    const W = g.walker;
    let best = -1;
    let bestD = 1e9;
    W.legs.forEach((l, i) => {
      const d = Math.hypot(l.foot[0] - king.x, l.foot[2] - king.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD < 5) {
      damageLeg(g, best, 0.12);
      g.fortress.shake = Math.max(g.fortress.shake, 0.5);
      g.renderer.shake(0.5);
      g.sfxAt('ram', king.x, king.y, king.z, 1);
    }
  }
  if (king.rider && king.rider.dead) king.rider = null;
}

// ------------------------------------------------------------------ the titans

/** A boulder (or a lump of fire) lobbed from the giant at the deck. */
function lobBoulder(g: Game, giant: Giant, block: number): void {
  const F = g.fortress;
  const keys = [...F.cells.keys()];
  const k = keys[Math.floor(Math.random() * keys.length)];
  if (k === undefined) return;
  const q = F.cellCenter(kx(k), ky(k), kz(k));
  const [gx, gz] = giant.body.hullCentre();
  const sx = gx + giant.dirX * 2;
  const sy = giant.body.top + 1;
  const sz = gz + giant.dirZ * 2;
  const tx = q.x + (Math.random() - 0.5) * 4;
  const ty = q.y + 0.5;
  const tz = q.z + (Math.random() - 0.5) * 4;
  const d = Math.hypot(tx - sx, tz - sz);
  const t = clamp(d / 14, 1, 2.6);
  g.projectiles.push({ kind: 'gshell', block, x: sx, y: sy, z: sz, vx: (tx - sx) / t, vy: (ty - sy + 0.5 * TNT_G * t * t) / t, vz: (tz - sz) / t, age: 0, life: t + 1.5, spin: 0, fromCrew: false });
  g.particles.debris(sx, sy, sz, block === B.PACKED_ICE ? 'packed_ice' : 'sandstone_side', 8, 3);
}

function titanTricks(g: Game, gs: GuardianState, giant: Giant, dt: number): void {
  const [gx, gz] = giant.body.hullCentre();
  const top = giant.body.top;
  const c = g.fortressCentre();
  const dist = Math.hypot(c[0] - gx, c[2] - gz);
  const frac = heartHp(giant).hp / Math.max(1, gs.maxHp);
  if (gs.kind === 'dune') {
    // Sandstone boulders, three at a time; a slam that throws a ring of sand when it is close.
    if (gs.cd[0]! <= 0 && dist < 70) {
      gs.cd[0] = frac < 0.5 ? 5.5 : 7.5;
      for (let i = 0; i < 2; i += 1) lobBoulder(g, giant, i === 1 ? B.ORANGE_TERRACOTTA : B.SANDSTONE);
      g.sfxAt('roar', gx, top, gz, 0.6, 0.8);
    }
    if (gs.cd[1]! <= 0 && dist < g.fortressRadius() + 14) {
      gs.cd[1] = 12;
      quakeRing(g, gx, giant.body.y, gz, 12, 4 + g.danger * 0.6);
    }
  } else if (gs.kind === 'frost') {
    // Freezing breath (a tell, then the blast) and blocks of packed ice.
    if (gs.cd[0]! <= 0 && dist < 60) {
      gs.cd[0] = frac < 0.5 ? 7 : 9.5;
      gs.cd[3] = 1.1;
      g.sfxAt('freeze', gx, top, gz, 0.6, 0.6, 120);
      g.toast('The Frost Titan draws breath!');
    }
    if (gs.cd[3]! > 0 && gs.cd[3]! - dt <= 0) frostBreath(g, giant);
    if (gs.cd[3]! > 0) {
      for (let i = 0; i < 2; i += 1) g.particles.add({ x: gx + giant.dirX * 2, y: top - 1, z: gz + giant.dirZ * 2, vx: (Math.random() - 0.5) * 2, vy: Math.random(), vz: (Math.random() - 0.5) * 2, life: 0.6, size: 0.3, r: 0.8, g: 0.92, b: 1, a: 0.8, gravity: -0.5, drag: 1, tile: 'smoke', soft: true });
    }
    if (gs.cd[1]! <= 0 && dist < 70) {
      gs.cd[1] = 8;
      for (let i = 0; i < 2; i += 1) lobBoulder(g, giant, B.PACKED_ICE);
    }
  } else if (gs.kind === 'magma') {
    // Fireballs (bat them back!), blazes called up as its Heart cracks, an eruption when close.
    if (gs.cd[0]! <= 0 && dist < 70) {
      gs.cd[0] = frac < 0.5 ? 4.5 : 6;
      for (let i = 0; i < 2; i += 1) magmaFireball(g, giant, i);
    }
    if ((gs.phase === 0 && frac < 0.67) || (gs.phase === 1 && frac < 0.34)) {
      gs.phase += 1;
      for (let i = 0; i < 2; i += 1) {
        const blaze = spawnMob(g, 'blaze', gx + (i ? 4 : -4), gz + 3);
        if (blaze) blaze.y = giant.body.y + 6;
      }
      g.toast('The Magma Titan calls up blazes!');
      g.sfxAt('blaze', gx, top, gz, 1);
    }
    if (gs.cd[1]! <= 0 && dist < g.fortressRadius() + 14) {
      gs.cd[1] = 11;
      quakeRing(g, gx, giant.body.y, gz, 11, 5 + g.danger * 0.6, true);
    }
  }
}

/** A slam: a ring rolls out, knocking anyone in it off their feet. */
function quakeRing(g: Game, x: number, y: number, z: number, r: number, dmg: number, fire = false): void {
  g.particles.ring(x, y + 0.5, z, r, 0.7, fire ? 0.45 : 0.85, fire ? 0.2 : 0.6);
  for (let k = 0; k < 6; k += 1) g.particles.dust(x + (Math.random() - 0.5) * r, y + 0.4, z + (Math.random() - 0.5) * r, 10, 3, false);
  if (fire) g.particles.sparks(x, y + 1, z, ['#ff8a20', '#ffd040', '#ff4010'], 40, 9, 0.12, 0.8);
  g.sfxAt('quake', x, y, z, 1, fire ? 0.8 : 1, 140);
  g.renderer.shake(0.6);
  g.eachPlayer((p) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (p.dead || d > r + 2 || p.y > y + 12) return;
    const k = 1 / (d || 1);
    damagePlayer(g, dmg, (p.x - x) * k * 9, (p.z - z) * k * 9);
  });
}

function frostBreath(g: Game, giant: Giant): void {
  const [gx, gz] = giant.body.hullCentre();
  const top = giant.body.top;
  const dx = giant.dirX;
  const dz = giant.dirZ;
  g.sfxAt('freeze', gx, top, gz, 1, 1, 160);
  for (let i = 0; i < 40; i += 1) {
    const along = 2 + Math.random() * 22;
    const spread = (Math.random() - 0.5) * along * 0.5;
    g.particles.add({ x: gx + dx * along - dz * spread, y: top - 1 - along * 0.25, z: gz + dz * along + dx * spread, vx: dx * 6, vy: -1, vz: dz * 6, life: 0.9, size: 0.6, grow: 0.8, r: 0.85, g: 0.95, b: 1, a: 0.7, gravity: 0, drag: 1.2, tile: 'smoke', soft: true });
  }
  // The fortress freezes in its tracks; whoever stands in the blast is chilled to the bone.
  const c = g.fortressCentre();
  const toF = (c[0] - gx) * dx + (c[2] - gz) * dz;
  if (toF > 0 && toF < 34) {
    g.chill = Math.max(g.chill, 7);
    g.toast('The fortress is frozen in its tracks!');
  }
  g.eachPlayer((p) => {
    const ax = p.x - gx;
    const az = p.z - gz;
    const along = ax * dx + az * dz;
    const side = Math.abs(ax * dz - az * dx);
    if (p.dead || along < 0 || along > 26 || side > 4 + along * 0.3) return;
    damagePlayer(g, 3 + Math.floor(g.danger / 3), dx * 4, dz * 4);
    addEffect(g, 'slowness', 6);
  });
}

function magmaFireball(g: Game, giant: Giant, i: number): void {
  const [gx, gz] = giant.body.hullCentre();
  const sx = gx + giant.dirX * 2.5;
  const sy = giant.body.top - 1;
  const sz = gz + giant.dirZ * 2.5;
  const p = g.player;
  const F = g.fortress;
  // One at you, the other anywhere on the deck.
  const aimAtYou = i === 0 && !p.dead && Math.hypot(p.x - gx, p.z - gz) < 60;
  const keys = [...F.cells.keys()];
  const k = keys[Math.floor(Math.random() * keys.length)];
  const q = k !== undefined ? F.cellCenter(kx(k), ky(k), kz(k)) : { x: F.centre()[0], y: F.y + F.floorY, z: F.centre()[1] };
  const tx = aimAtYou ? p.x : q.x;
  const ty = aimAtYou ? p.y + 1 : q.y + 0.5;
  const tz = aimAtYou ? p.z : q.z;
  let dx = tx - sx;
  let dy = ty - sy;
  let dz = tz - sz;
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  const speed = 14;
  g.projectiles.push({ kind: 'fireball', x: sx, y: sy, z: sz, vx: dx * speed, vy: dy * speed, vz: dz * speed, age: 0, life: 8, spin: 0, fromCrew: false, owner: null });
  g.sfxAt('fireball', sx, sy, sz, 1);
}
