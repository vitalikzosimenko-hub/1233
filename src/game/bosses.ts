// The night's boss fights, both straight out of Minecraft. On the third night the illagers RAID
// (a horn across the valley, then wave after wave: pillagers, vindicators, witches, a ravager, and
// the evoker who leads them) with a raid bar counting down who is left; beat them and you are the
// Hero of the Village. On the fourth night, where the blight begins, the WITHER rises: it blots out
// the sky and holds back the dawn, bombards the fortress with skulls, and at half health puts on
// its armour (shots bounce off), comes down onto the deck, smashes through the hull and calls up
// wither skeletons. Its Nether Star lights a beacon on your Engine Core.
import { wardenActive, wardenBar } from './wardens';
import { finalBossBar } from './finalboss';
import { B, I } from './blocks';
import { kx, ky, kz } from './body';
import { spawnDrop } from './build';
import { explode } from './combat';
import { addEffect, hasEffect, clearEffect } from './effects';
import { Actor, type ActorKind } from './entities';
import { feat } from './feats';
import { damageFortressCell } from './fortress';
import type { Game } from './game';
import type { MusicName } from './audio';
import type { Vec3 } from './math3d';
import { damagePlayer, mount, scaleHealth, steerFlier, type HitHow } from './mobs';
import { raider } from './monsters';
import { clamp } from './rng';
import { guardianActive, guardianBar } from './seals';

// ------------------------------------------------------------------ state

export interface RaidState {
  /** Wave under way (0-based) and how many there are (a Bad Omen adds one). */
  wave: number;
  waves: number;
  state: 'gather' | 'wave' | 'break' | 'won' | 'fled';
  /** Seconds left in the state (the gathering, the break between waves, the victory bar). */
  t: number;
  /** Raiders the wave came with, and how many still stand. */
  total: number;
  left: number;
  omen: boolean;
  elapsed: number;
  waveT: number;
}

export interface WitherHead {
  cd: number;
  yaw: number;
  pitch: number;
  /** What it is looking at (world). */
  tx: number;
  ty: number;
  tz: number;
}

export interface WitherState {
  mob: Actor | null;
  stage: 'pending' | 'summon' | 'fight' | 'dying' | 'fled' | 'dead';
  t: number;
  at: Vec3;
  armored: boolean;
  heads: WitherHead[];
  blueCd: number;
  dashCd: number;
  summonCd: number;
  grindCd: number;
  dash: { from: Vec3; to: Vec3; hit: Set<number>; struck: boolean } | null;
  orbit: number;
  regen: number;
  fightT: number;
  noted: number;
}

/** Seconds the Wither takes to wake (its bar fills), as in Minecraft. */
const SUMMON = 9;
/** The Wither grows to this many times Minecraft's size (it must read against a walking fortress). */
export const WITHER_SCALE = 1.9;

/** The waves of a raid (the fourth only comes with a Bad Omen). */
const WAVES: Array<Array<[ActorKind, number]>> = [
  [['pillager', 3], ['vindicator', 1]],
  [['pillager', 3], ['vindicator', 2], ['witch', 1]],
  [['pillager', 2], ['vindicator', 2], ['ravager', 1], ['witch', 1]],
  [['pillager', 3], ['vindicator', 3], ['ravager', 1]],
  [['pillager', 3], ['vindicator', 2], ['ravager', 1], ['evoker', 1], ['witch', 1]],
];

// ------------------------------------------------------------------ the night's plan

/** Dusk: the third night is the raid, the fourth the Wither (the Citadel siege has its own). */
export function planBossNight(g: Game): void {
  g.raid = null;
  g.witherFight = null;
  if (g.siege) return;
  if (g.nightTheme === 'raid') {
    const omen = hasEffect(g, 'omen');
    if (omen) clearEffect(g, 'omen');
    g.raid = { wave: -1, waves: omen ? 5 : 4, state: 'gather', t: 9, total: 0, left: 0, omen, elapsed: 0, waveT: 0 };
  } else if (g.nightTheme === 'wither') {
    g.witherFight = {
      mob: null, stage: 'pending', t: 0, at: [0, 0, 0], armored: false,
      heads: [0, 1, 2].map((i) => ({ cd: 2 + i * 0.6, yaw: 0, pitch: 0, tx: 0, ty: 0, tz: 0 })),
      blueCd: 8, dashCd: 6, summonCd: 0, grindCd: 1, dash: null, orbit: 0, regen: 1, fightT: 0, noted: -10,
    };
  }
}

/** A raid, the Wither or a seal's guardian is under way right now. */
export function bossActive(g: Game): boolean {
  const r = g.raid;
  const w = g.witherFight;
  return (r !== null && (r.state === 'gather' || r.state === 'wave' || r.state === 'break')) || (w !== null && (w.stage === 'summon' || w.stage === 'fight' || w.stage === 'dying')) || guardianActive(g) || wardenActive(g) || g.finalBoss !== null;
}

/** Boss nights bring no giants (the raid, the Wither or a seal's guardian is the night's big fight). */
export function bossesTakeTheNight(g: Game): boolean {
  return !g.siege && (g.nightTheme === 'raid' || g.nightTheme === 'wither' || guardianActive(g));
}

/** Dawn waits for a boss: the night is not over until the raid is beaten or the Wither falls. */
export function bossHoldsNight(g: Game): boolean {
  return bossActive(g);
}

/** The horde thins while a boss fight is on (it brings its own). */
export function bossSpawnFactor(g: Game): number {
  const r = g.raid;
  if (r && (r.state === 'wave' || r.state === 'break' || r.state === 'gather')) return 0.3;
  const w = g.witherFight;
  if (w && (w.stage === 'summon' || w.stage === 'fight')) return w.armored ? 0.35 : 0.55;
  if (guardianActive(g)) return 0.5;
  return 1;
}

/** The music a boss fight wants (null: the usual). */
export function bossMusic(g: Game): MusicName | null {
  const r = g.raid;
  if (r && (r.state === 'wave' || r.state === 'break' || r.state === 'gather')) return 'raid';
  const w = g.witherFight;
  if (w && (w.stage === 'summon' || w.stage === 'fight' || w.stage === 'dying')) return 'wither';
  if (guardianActive(g)) return 'guardian';
  if (g.finalBoss) return 'final';
  if (wardenActive(g)) return 'warden';
  return null;
}

/** How dark the Wither makes the sky (0..1, Minecraft's boss-bar sky darkening). */
export function bossDarkness(g: Game): number {
  const w = g.witherFight;
  if (!w) return 0;
  if (w.stage === 'summon') return clamp(w.t / SUMMON, 0, 1);
  return w.stage === 'fight' || w.stage === 'dying' ? 1 : 0;
}

/** Per step: the raid's waves, the Wither's summoning and death. */
export function updateBosses(g: Game, dt: number): void {
  if (g.phase !== 'night') return;
  updateRaid(g, dt);
  const w = g.witherFight;
  if (!w) return;
  w.t += dt;
  if (w.stage === 'pending' && g.progress >= 0.24 && !g.siege) beginWither(g, w);
  else if (w.stage === 'dying') witherDying(g, w, dt);
  else if (w.stage === 'fled' && w.mob) {
    const m = w.mob;
    m.y += dt * 9;
    m.x += m.vx * dt;
    m.z += m.vz * dt;
    if (w.t > 4) {
      m.dead = true;
      w.mob = null;
    }
  }
}

/** At dawn the boss state is cleared (a beaten raid leaves its hero behind). */
export function bossDawn(g: Game): void {
  g.raid = null;
  g.witherFight = null;
}

// ------------------------------------------------------------------ the raid

function updateRaid(g: Game, dt: number): void {
  const r = g.raid;
  if (!r) return;
  r.elapsed += dt;
  r.t -= dt;
  if (r.state === 'gather') {
    if (r.t + dt >= 9 && r.t < 9) {
      // The horn: something is coming.
      g.sfx('raidhorn', 'stone', 1);
      g.ui.banner('RAID!', r.omen ? 'Your Bad Omen called them: the illagers come for your fortress' : 'The illagers come for your fortress! Hold every wave', 'danger');
      g.crewSay('raid');
      g.buzz(120);
    }
    if (r.t <= 0) spawnWave(g, r, 0);
  } else if (r.state === 'wave') {
    r.waveT += dt;
    if (r.left <= 0) {
      if (r.wave + 1 >= r.waves) raidWon(g, r);
      else {
        r.state = 'break';
        r.t = 8;
        g.toast(`Wave ${r.wave + 1} beaten! The next is coming...`, 'fx_omen');
        g.cheer(false);
      }
    } else stragglers(g, r);
  } else if (r.state === 'break') {
    if (r.t <= 0) spawnWave(g, r, r.wave + 1);
  } else if (r.t <= 0) {
    g.raid = null;
    return;
  }
  // Too long: the raid breaks up and the last of them slink off into the dark.
  if ((r.state === 'wave' || r.state === 'break') && r.elapsed > 480) {
    for (const m of g.mobs) {
      if (m.dead || m.raid < 0) continue;
      m.dead = true;
      g.particles.smoke(m.x, m.cy, m.z, 6, 1);
    }
    r.state = 'fled';
    r.t = 4;
    g.toast('The raiders fall back into the dark');
  }
}

/** The raid's wave arrives from one side (behind or a flank), horn first. */
function spawnWave(g: Game, r: RaidState, i: number): void {
  r.wave = i;
  r.state = 'wave';
  r.waveT = 0;
  const comp = WAVES[r.waves === 5 ? i : i >= 3 ? 4 : i] ?? WAVES[4]!;
  const final = i === r.waves - 1;
  const c = g.fortressCentre();
  const heading = Math.atan2(g.marchDir[1], g.marchDir[0]);
  const side = heading + Math.PI + (Math.random() - 0.5) * 1.6;
  const radius = g.fortressRadius() + 24;
  let n = 0;
  let count = 0;
  for (const [kind, k] of comp) count += k;
  let ravager: Actor | null = null;
  const spawned: Actor[] = [];
  for (const [kind, k] of comp) {
    for (let j = 0; j < k; j += 1) {
      const a = side + ((n / Math.max(1, count - 1)) - 0.5) * 1.2;
      n += 1;
      const mob = raider(g, kind, c[0] + Math.cos(a) * (radius + Math.random() * 4), c[2] + Math.sin(a) * (radius + Math.random() * 4));
      if (!mob) continue;
      mob.raid = i;
      spawned.push(mob);
      if (kind === 'ravager') ravager = mob;
      if (kind === 'evoker') mob.boss = null;
    }
  }
  // A ravager always carries a rider: a pillager, and in the final wave the evoker himself.
  if (ravager) {
    const evoker = final ? spawned.find((m) => m.kind === 'evoker') : undefined;
    const rider = evoker ?? raider(g, 'pillager', ravager.x, ravager.z);
    if (rider) {
      rider.raid = i;
      if (!evoker) spawned.push(rider);
      mount(rider, ravager);
    }
  }
  // One pillager carries the illagers' banner.
  const flag = spawned.find((m) => m.kind === 'pillager' && !m.mount) ?? spawned.find((m) => m.kind === 'vindicator');
  if (flag) flag.captain = true;
  r.total = spawned.length;
  r.left = spawned.length;
  g.sfx('raidhorn', 'stone', 0.8);
  g.ui.banner(final ? 'FINAL WAVE!' : `RAID · WAVE ${i + 1}`, final ? 'The evoker leads them, riding a ravager' : ravager ? 'A RAVAGER charges in with them!' : `${spawned.length} raiders${i === 0 ? ': pillagers shoot, vindicators chop' : ''}`, 'danger');
  if (ravager) g.crewSay('ravager');
  // Raiders know where you are.
  if (spawned.length === 0) r.left = 0;
}

/** A raider is down: the raid bar ticks down. */
export function raidKilled(g: Game, mob: Actor): void {
  const r = g.raid;
  mob.raid = -1;
  if (!r || r.state !== 'wave') return;
  r.left = Math.max(0, r.left - 1);
}

/** Raiders left behind by the march come back in (on a flank, ready to fight); the last few show on the screen's edge. */
function stragglers(g: Game, r: RaidState): void {
  if (Math.floor(r.waveT * 2) === Math.floor((r.waveT - 0.0001) * 2)) return;
  const c = g.fortressCentre();
  const behind = g.fortressRadius() + 30;
  const heading = Math.atan2(g.marchDir[1], g.marchDir[0]);
  for (const m of g.mobs) {
    if (m.dead || m.raid !== r.wave || m.mount) continue;
    if (Math.hypot(m.x - c[0], m.z - c[2]) < behind && m.y > -2) continue;
    // Out of the fight (the fortress walked away from them): they run in on a flank, ahead of the march.
    const a = heading + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.9);
    const x = c[0] + Math.cos(a) * (g.fortressRadius() + 16);
    const z = c[2] + Math.sin(a) * (g.fortressRadius() + 16);
    const y = g.world.groundAt(x, z);
    g.particles.smoke(m.x, m.cy, m.z, 4, 0.8);
    m.x = x;
    m.y = y + 0.01;
    m.z = z;
    m.vx = m.vy = m.vz = 0;
    m.standingOn = null;
    m.climb = null;
    m.stuck = 0;
    if (m.rider) {
      m.rider.x = x;
      m.rider.z = z;
      m.rider.y = y + 1.5;
    }
  }
}

/** The raid is beaten: horns, fireworks, gifts, and the Hero of the Village. */
function raidWon(g: Game, r: RaidState): void {
  r.state = 'won';
  r.t = 6;
  const gems = 4 + r.waves * 2 + (r.omen ? 4 : 0);
  g.addItem(I.EMERALD, gems, true);
  g.addItem(I.TNT, 6, true);
  g.xp(60);
  // Everyone who stood against the raid is a hero.
  g.eachPlayer(() => addEffect(g, 'hero', 900));
  g.ui.banner('RAID VICTORY!', `HERO OF THE VILLAGE: +${gems} emeralds, and traders sell for less tomorrow`, 'gold');
  g.sfx('quest', 'metal', 1);
  g.sfx('levelup', 'metal', 0.8);
  g.celebrate(9);
  g.cheer();
  g.buzz(160);
  g.addPage('illagers', false);
  feat(g, 'hero');
}

// ------------------------------------------------------------------ the Wither

/** The Wither rises out of the blight ahead of the march: soul fire, dark lightning, a growing shape. */
function beginWither(g: Game, w: WitherState): void {
  const c = g.fortressCentre();
  const r = g.fortressRadius() + 24;
  const side = (Math.random() - 0.5) * 0.8;
  const a = Math.atan2(g.marchDir[1], g.marchDir[0]) + side;
  const x = c[0] + Math.cos(a) * r;
  const z = c[2] + Math.sin(a) * r;
  const ground = g.world.groundAt(x, z);
  const y = Math.max(ground + 3, c[1] + 4);
  w.at = [x, y, z];
  const mob = new Actor('wither', x, y, z);
  mob.boss = 'WITHER';
  mob.maxHp = 300 + Math.max(0, g.danger - 4) * 40;
  mob.hp = mob.maxHp;
  mob.yaw = Math.atan2(c[2] - z, c[0] - x);
  mob.act = 'summon';
  mob.actT = 0;
  mob.actDur = SUMMON;
  g.mobs.push(mob);
  w.mob = mob;
  w.stage = 'summon';
  w.t = 0;
  w.orbit = Math.atan2(z - c[2], x - c[0]);
  // A black bolt from the sky where it wakes.
  g.bolt = { x, y: ground, z, t: 0.5, seed: Math.random() * 1000 };
  g.weather.flash = 0.6;
  g.sfx('thunder', 'stone', 1);
  g.sfx('withergrowl', 'stone', 1, 0.8);
  g.ui.banner('THE WITHER RISES!', 'Out of the blight it wakes: three heads, and the sky goes dark', 'danger');
  g.crewSay('wither');
  g.buzz(200);
  g.renderer.shake(0.6);
}

/** Its bar full, it wakes with a blast that shakes the valley. */
function witherAwake(g: Game, w: WitherState, mob: Actor): void {
  w.stage = 'fight';
  w.t = 0;
  mob.act = 'none';
  explode(g, mob.x, mob.y + 2, mob.z, { radius: 7, fortress: 30, giant: 20, mob: 30, player: 12, terrain: 4 });
  g.particles.ring(mob.x, mob.y + 2, mob.z, 14, 0.75, 0.8, 1);
  g.particles.smoke(mob.x, mob.y + 2, mob.z, 30, 5, true);
  g.light({ x: mob.x, y: mob.y + 3, z: mob.z, r: 40, color: [0.7, 0.8, 1.3], life: 0.9, max: 0.9 });
  g.sfx('witherspawn', 'stone', 1);
  g.renderer.shake(1.2);
  g.freeze(0.15);
  g.buzz(300);
  g.ui.flash('white');
  g.ui.banner('THE WITHER!', 'Shoot it down: ballistas, crossbow bolts. At half health its armour comes up', 'danger');
}

/** A blow on the Wither: nothing while it wakes; its armour (below half health) turns shots aside. */
export function witherHurt(g: Game, mob: Actor, amount: number, how: HitHow): number {
  const w = g.witherFight;
  if (!w || w.mob !== mob || w.stage !== 'fight') return 0;
  if (w.armored && how === 'shot') {
    g.particles.sparks(mob.x, mob.y + mob.h * 0.6, mob.z, ['#bfe8ff', '#ffffff'], 6, 3, 0.06, 0.3);
    g.sfxAt('clank', mob.x, mob.y + 3, mob.z, 0.7, 0.7);
    if (g.time - w.noted > 1.6) {
      w.noted = g.time;
      g.ui.damage(0, mob.x, mob.y + mob.h + 0.5, mob.z, 'streak', 'ARMORED! Use the SWORD or TNT');
    }
    return 0;
  }
  return amount;
}

/** The Wither's three heads, in the world: centre, then its left and right. */
export function witherHeads(mob: Actor): Vec3[] {
  const s = mob.h / 3.5;
  const f: Vec3 = [Math.cos(mob.yaw), 0, Math.sin(mob.yaw)];
  const r: Vec3 = [-Math.sin(mob.yaw), 0, Math.cos(mob.yaw)];
  const bob = Math.sin(mob.walkPhase * 0.6) * 0.15 * s;
  return [
    [mob.x + f[0] * 0.15 * s, mob.y + 3.05 * s + bob, mob.z + f[2] * 0.15 * s],
    [mob.x - r[0] * 0.62 * s, mob.y + 2.78 * s + bob, mob.z - r[2] * 0.62 * s],
    [mob.x + r[0] * 0.62 * s, mob.y + 2.78 * s + bob, mob.z + r[2] * 0.62 * s],
  ];
}

/** A target for one of the heads: you (the centre head), else a block of your fortress, a turret by choice. */
function headTarget(g: Game, w: WitherState, i: number, from: Vec3): Vec3 | null {
  const p = g.player;
  if (i === 0 && !p.dead && Math.hypot(p.x - from[0], p.z - from[2]) < 64) return [p.x, p.y + 1, p.z];
  // The side heads go for other monsters now and then (as in Minecraft), mostly for your hull.
  if (i > 0 && Math.random() < 0.12) {
    const near = g.mobs.filter((m) => !m.dead && m !== w.mob && !m.boss && Math.hypot(m.x - from[0], m.z - from[2]) < 26);
    const m = near[Math.floor(Math.random() * near.length)];
    if (m) return [m.x, m.cy, m.z];
  }
  const F = g.fortress;
  const keys = [...F.cannons.keys()];
  const pool = keys.length > 0 && Math.random() < 0.45 ? keys : [...F.cells.keys()];
  const k = pool[Math.floor(Math.random() * pool.length)];
  if (k === undefined) return null;
  const q = F.cellCenter(kx(k), ky(k), kz(k));
  return [q.x, q.y + 0.5, q.z];
}

/** A wither skull from a head: black and quick, or (now and then) a slow blue one that hits much harder. */
function shootSkull(g: Game, mob: Actor, from: Vec3, to: Vec3, blue: boolean): void {
  let dx = to[0] - from[0];
  let dy = to[1] - from[1];
  let dz = to[2] - from[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  const speed = blue ? 6.5 : 13;
  g.projectiles.push({ kind: blue ? 'blueskull' : 'skull', x: from[0] + dx * 0.8, y: from[1] + dy * 0.8, z: from[2] + dz * 0.8, vx: dx * speed, vy: dy * speed, vz: dz * speed, age: 0, life: 7, spin: 0, fromCrew: false, owner: mob, effect: 'wither' });
  g.sfxAt('withershoot', from[0], from[1], from[2], blue ? 1 : 0.8, blue ? 0.8 : 1);
}

/** The Wither's flight and attacks (it is one of the mobs; its fight state lives on the game). */
export function updateWither(g: Game, mob: Actor, dt: number): void {
  const w = g.witherFight;
  mob.walkPhase += dt * 3;
  if (!w || w.mob !== mob) {
    steerFlier(g, mob, mob.x, mob.y, mob.z, 1, dt, 1, 3);
    return;
  }
  if (w.stage === 'summon') {
    // Waking: it hangs over the spot, blue and flickering, swelling as its bar fills.
    mob.actT += dt;
    mob.yaw += dt * 0.6;
    mob.x = w.at[0];
    mob.y = w.at[1] + Math.sin(mob.actT * 2) * 0.3;
    mob.z = w.at[2];
    if (Math.random() < dt * 30) g.particles.add({ x: mob.x + (Math.random() - 0.5) * 4, y: mob.y + Math.random() * mob.h, z: mob.z + (Math.random() - 0.5) * 4, vx: 0, vy: 1.5, vz: 0, life: 1, size: 0.25, r: 0.55, g: 0.75, b: 1, a: 0.9, emit: 1, gravity: -0.5, drag: 1, tile: 'spark', soft: true });
    if (mob.actT >= mob.actDur) witherAwake(g, w, mob);
    return;
  }
  if (w.stage !== 'fight') return;
  w.fightT += dt;
  const F = g.fortress;
  const c = g.fortressCentre();
  const p = g.player;
  // It mends itself (slowly) as long as it lives.
  w.regen -= dt;
  if (w.regen <= 0) {
    w.regen = 1.3;
    mob.hp = Math.min(mob.maxHp, mob.hp + 1);
  }
  if (!w.armored && mob.hp <= mob.maxHp / 2) armourUp(g, w, mob);
  // Too long a fight: it tires of the fortress and rises into the dark (the dawn may come).
  if (w.fightT > 420) {
    w.stage = 'fled';
    w.t = 0;
    mob.vx = Math.cos(mob.yaw) * 6;
    mob.vz = Math.sin(mob.yaw) * 6;
    g.ui.banner('THE WITHER RETREATS', 'It rises into the dark, wounded. The dawn can come', 'night');
    return;
  }
  if (w.dash) {
    witherDash(g, w, mob, dt);
    return;
  }
  // Flight: high circles over the fortress, then (armoured) low over the deck itself.
  w.orbit += dt * (w.armored ? 0.35 : 0.22);
  const deckY = F.y + F.floorY;
  const radius = w.armored ? 6 + Math.sin(g.time * 0.4) * 2 : g.fortressRadius() + 8 + Math.sin(g.time * 0.3) * 4;
  const tx = c[0] + Math.cos(w.orbit) * radius;
  const tz = c[2] + Math.sin(w.orbit) * radius;
  const ty = w.armored ? deckY + 3.5 + Math.sin(g.time * 1.1) * 0.6 : Math.max(deckY + 11, F.y + F.maxY + 7) + Math.sin(g.time * 0.7) * 1.5;
  steerFlier(g, mob, tx, ty, tz, w.armored ? 3.6 : 5.2, dt, 1.4, 3);
  // It always faces you when it can.
  if (!p.dead) mob.yaw = Math.atan2(p.z - mob.z, p.x - mob.x);
  // The heads look about and fire.
  const heads = witherHeads(mob);
  w.heads.forEach((h, i) => {
    h.cd -= dt;
    const at = heads[i]!;
    if (h.cd <= 0) {
      const target = headTarget(g, w, i, at);
      h.cd = (w.armored ? 2.6 : i === 0 ? 1.3 : 1.8) + Math.random() * 0.9;
      if (target) {
        h.tx = target[0];
        h.ty = target[1];
        h.tz = target[2];
        shootSkull(g, mob, at, target, false);
      }
    }
    const yaw = Math.atan2(h.tz - at[2], h.tx - at[0]) - mob.yaw;
    h.yaw += (Math.atan2(Math.sin(yaw), Math.cos(yaw)) - h.yaw) * Math.min(1, dt * 6);
    h.pitch += (clamp(Math.atan2(h.ty - at[1], Math.hypot(h.tx - at[0], h.tz - at[2])), -1, 0.7) - h.pitch) * Math.min(1, dt * 6);
  });
  w.blueCd -= dt;
  if (w.blueCd <= 0 && !p.dead) {
    w.blueCd = w.armored ? 7 : 9;
    shootSkull(g, mob, heads[0]!, [p.x, p.y + 1, p.z], true);
  }
  if (!w.armored) return;
  // Armoured: it grinds through what it touches, calls up wither skeletons and dashes across the deck.
  w.grindCd -= dt;
  if (w.grindCd <= 0) {
    w.grindCd = 1.2;
    grind(g, mob, 8);
  }
  w.summonCd -= dt;
  if (w.summonCd <= 0) {
    w.summonCd = 26;
    summonSkeletons(g, mob);
  }
  w.dashCd -= dt;
  if (w.dashCd <= 0) startDash(g, w, mob);
}

/** Below half health its armour comes up (the shimmer you see): shots bounce off from now on. */
function armourUp(g: Game, w: WitherState, mob: Actor): void {
  w.armored = true;
  w.dashCd = 5;
  w.summonCd = 0;
  g.ui.banner('WITHER ARMOR!', 'Bolts bounce off now: hit it with the SWORD, TNT and cannons as it comes down', 'danger');
  g.ui.flash('white');
  g.sfxAt('charged', mob.x, mob.y + 3, mob.z, 1, 0.7);
  g.sfxAt('withergrowl', mob.x, mob.y + 3, mob.z, 1, 0.75);
  g.particles.ring(mob.x, mob.y + 3, mob.z, 7, 0.6, 0.85, 1);
  g.renderer.shake(0.5);
  g.crewSay('witherArmor');
}

/** Fortress cells inside the Wither's body take a battering. */
function grind(g: Game, mob: Actor, dmg: number): number {
  const F = g.fortress;
  const r = mob.hw + 0.9;
  let n = 0;
  for (const key of [...F.cells.keys()]) {
    const q = F.cellCenter(kx(key), ky(key), kz(key));
    if (Math.abs(q.x - mob.x) > r || Math.abs(q.z - mob.z) > r || q.y < mob.y - 0.3 || q.y > mob.y + mob.h) continue;
    damageFortressCell(g, key, dmg);
    n += 1;
  }
  return n;
}

/** Wither skeletons rise on your deck around the Wither. */
function summonSkeletons(g: Game, mob: Actor): void {
  const F = g.fortress;
  const spots: Array<[number, number, number]> = [];
  for (const key of F.cells.keys()) {
    if (ky(key) !== 0) continue;
    const x = kx(key);
    const z = kz(key);
    if (F.hasBlock(x, 1, z) || F.hasBlock(x, 2, z) || F.hasBlock(x, 3, z)) continue;
    const at = F.toWorld(x + 0.5, 1.002, z + 0.5);
    if (Math.hypot(at[0] - mob.x, at[2] - mob.z) < 10) spots.push(at);
  }
  for (let i = 0; i < 3 && spots.length > 0; i += 1) {
    const s = spots.splice(Math.floor(Math.random() * spots.length), 1)[0]!;
    const sk = new Actor('witherskel', s[0], s[1], s[2]);
    scaleHealth(g, sk);
    sk.standingOn = F;
    sk.onGround = true;
    sk.voiceT = 1;
    g.mobs.push(sk);
    g.particles.smoke(s[0], s[1] + 1, s[2], 8, 1, true);
    g.particles.sparks(s[0], s[1] + 1, s[2], ['#6a8cff', '#c8d8ff'], 8, 2, 0.08, 0.6);
  }
  g.sfxAt('withergrowl', mob.x, mob.y + 3, mob.z, 0.8, 1.2);
  g.toast('The Wither raises WITHER SKELETONS on your deck!', 'fx_wither');
}

/** It rears up, its eyes flare, then it tears across the deck in a straight line. */
function startDash(g: Game, w: WitherState, mob: Actor): void {
  const p = g.player;
  const F = g.fortress;
  const core = g.coreKey();
  const aim: Vec3 = !p.dead && p.standingOn === F ? [p.x, p.y, p.z] : core !== null ? (() => {
    const q = F.cellCenter(kx(core), ky(core), kz(core));
    return [q.x, q.y, q.z] as Vec3;
  })() : g.fortressCentre();
  let dx = aim[0] - mob.x;
  let dz = aim[2] - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const y = F.y + F.floorY + 1.2;
  w.dash = { from: [mob.x, mob.y, mob.z], to: [aim[0] + dx * 9, y, aim[2] + dz * 9], hit: new Set(), struck: false };
  mob.act = 'charge';
  mob.actT = 0;
  mob.actDur = 1.1;
  mob.yaw = Math.atan2(dz, dx);
  g.sfxAt('withergrowl', mob.x, mob.y + 3, mob.z, 1, 1.25);
  g.toast('The Wither is about to DASH: get out of its way!', 'fx_wither');
}

function witherDash(g: Game, w: WitherState, mob: Actor, dt: number): void {
  const d = w.dash!;
  mob.actT += dt;
  if (mob.actT < mob.actDur) {
    // The tell: it rises a little, eyes blazing, and a dark trail marks its path.
    mob.y += dt * 1.2;
    if (Math.random() < dt * 40) {
      const u = Math.random();
      g.particles.add({ x: mob.x + (d.to[0] - mob.x) * u, y: d.to[1] + 1 + Math.random(), z: mob.z + (d.to[2] - mob.z) * u, vy: 0.4, life: 0.8, size: 0.5, grow: 0.5, r: 0.1, g: 0.08, b: 0.15, a: 0.6, gravity: -0.2, drag: 1, tile: 'smoke', soft: true });
    }
    return;
  }
  // The dash itself.
  const sx = mob.x;
  const sz = mob.z;
  const dx = d.to[0] - sx;
  const dy = d.to[1] - mob.y;
  const dz = d.to[2] - sz;
  const l = Math.hypot(dx, dy, dz);
  const step = Math.min(l, 17 * dt);
  if (l > 0.05) {
    mob.x += (dx / l) * step;
    mob.y += (dy / l) * step;
    mob.z += (dz / l) * step;
  }
  mob.vx = l > 0.05 ? (dx / l) * 17 : 0;
  mob.vz = l > 0.05 ? (dz / l) * 17 : 0;
  const F = g.fortress;
  const r = mob.hw + 1.1;
  for (const key of [...F.cells.keys()]) {
    if (d.hit.has(key)) continue;
    const q = F.cellCenter(kx(key), ky(key), kz(key));
    if (Math.hypot(q.x - mob.x, q.z - mob.z) > r || q.y < mob.y - 0.5 || q.y > mob.y + mob.h * 0.8) continue;
    d.hit.add(key);
    damageFortressCell(g, key, 24);
  }
  g.eachPlayer((p) => {
    if (d.struck || p.dead || Math.hypot(p.x - mob.x, p.z - mob.z) >= r + 0.4 || Math.abs(p.cy - (mob.y + mob.h * 0.4)) >= mob.h * 0.6) return;
    d.struck = g.players().length < 2;
    const k = 1 / (Math.hypot(p.x - mob.x, p.z - mob.z) || 1);
    damagePlayer(g, 8 + Math.floor(g.danger / 2), (p.x - mob.x) * k * 12, (p.z - mob.z) * k * 12, 'wither', 8);
  });
  g.renderer.shake(0.15);
  if (Math.random() < dt * 30) g.particles.smoke(mob.x, mob.y + 2, mob.z, 1, 1.5, true);
  if (l <= 0.1) {
    w.dash = null;
    w.dashCd = 11;
    mob.act = 'none';
    g.renderer.shake(0.5);
  }
}

/** Its last moments: it convulses, bursting with blasts, then goes up in one great explosion. */
function witherDying(g: Game, w: WitherState, dt: number): void {
  const mob = w.mob;
  if (!mob) return;
  mob.y = Math.max(mob.y - dt * 0.6, g.world.groundAt(mob.x, mob.z) + 1);
  mob.yaw += dt * (2 + w.t * 2);
  mob.walkPhase += dt * 8;
  if (Math.random() < dt * 7) {
    const x = mob.x + (Math.random() - 0.5) * 3;
    const y = mob.y + Math.random() * mob.h;
    const z = mob.z + (Math.random() - 0.5) * 3;
    g.particles.flash(x, y, z, 1.6);
    g.particles.sparks(x, y, z, ['#c8e0ff', '#ffffff', '#5a6a9a'], 12, 6, 0.1, 0.6);
    g.particles.smoke(x, y, z, 4, 1.2, true);
    g.sfxAt('explode', x, y, z, 0.6);
    g.renderer.shake(0.3);
  }
  if (w.t < 3.4) return;
  w.stage = 'dead';
  mob.deathT = 99;
  w.mob = null;
  // The great blast (it spares your hull) and what it leaves: the Nether Star.
  explode(g, mob.x, mob.y + 2, mob.z, { radius: 5, fortress: 0, giant: 0, mob: 30, player: 0, terrain: 0, source: 'player' });
  g.particles.ring(mob.x, mob.y + 2, mob.z, 16, 0.8, 0.9, 1);
  g.light({ x: mob.x, y: mob.y + 2, z: mob.z, r: 46, color: [1.2, 1.25, 1.4], life: 1.2, max: 1.2 });
  g.freeze(0.2);
  g.buzz(300);
  g.ui.flash('white');
  spawnDrop(g, I.NETHER_STAR, 1, mob.x, mob.y + 2, mob.z);
  spawnDrop(g, I.EMERALD, 8, mob.x, mob.y + 2, mob.z);
  g.ui.banner('THE WITHER IS SLAIN!', 'It dropped a NETHER STAR: socket it in your Engine Core to light a beacon', 'gold');
  g.celebrate(10);
  g.cheer();
  g.addPage('wither', false);
  feat(g, 'wither');
}

/** Bosses fall differently: the Wither starts its death throes (the bar empties, the sky clears). */
export function onBossKilled(g: Game, mob: Actor): void {
  const w = g.witherFight;
  if (mob.kind === 'wither' && w && w.mob === mob) {
    w.stage = 'dying';
    w.t = 0;
    w.dash = null;
    g.sfxAt('bossdeath', mob.x, mob.y + 3, mob.z, 1);
    g.renderer.shake(0.8);
    g.stats.giants += 1;
  }
}

/** The Wither as it should be drawn: waking (and how far), armoured, dying. */
export function witherPose(g: Game, mob: Actor): { grow: number; armored: boolean; dying: number; heads: WitherHead[] | null; tell: number } {
  const w = g.witherFight;
  if (!w || w.mob !== mob) return { grow: 1, armored: false, dying: 0, heads: null, tell: 0 };
  const grow = w.stage === 'summon' ? 0.35 + 0.65 * clamp(mob.actT / SUMMON, 0, 1) : 1;
  const tell = w.dash && mob.actT < mob.actDur ? mob.actT / mob.actDur : 0;
  return { grow, armored: w.armored, dying: w.stage === 'dying' ? clamp(w.t / 3.4, 0, 1) : 0, heads: w.heads, tell };
}

// ------------------------------------------------------------------ boss bars

export interface BossBar {
  key: string;
  title: string;
  sub: string;
  /** 0..1 */
  pct: number;
  tone: 'red' | 'purple' | 'green';
  /** Marks along the bar (fractions), e.g. where the Wither's armour comes up. */
  marks: number[];
}

/** The bars over the screen (Minecraft-style) for the bosses in the fight right now. */
export function bossBars(g: Game): BossBar[] {
  const out: BossBar[] = [];
  const gb = guardianBar(g);
  if (gb) out.push({ key: 'guardian', title: gb.title, sub: gb.sub, pct: gb.pct, tone: 'green', marks: [] });
  const wb = wardenBar(g);
  if (wb) out.push({ key: 'warden', title: wb.title, sub: wb.sub, pct: wb.pct, tone: 'red', marks: [] });
  const fb = finalBossBar(g);
  if (fb) out.push({ key: 'final', title: fb.title, sub: fb.sub, pct: fb.pct, tone: 'green', marks: [] });
  const w = g.witherFight;
  if (w && w.mob && (w.stage === 'summon' || w.stage === 'fight' || w.stage === 'dying')) {
    const m = w.mob;
    const pct = w.stage === 'summon' ? clamp(m.actT / SUMMON, 0, 1) : w.stage === 'dying' ? 0 : clamp(m.hp / m.maxHp, 0, 1);
    out.push({ key: 'wither', title: 'WITHER', sub: w.stage === 'summon' ? 'WAKING' : w.armored ? 'ARMORED' : '', pct, tone: 'purple', marks: [0.5] });
  }
  const r = g.raid;
  if (r) {
    if (r.state === 'gather') out.push({ key: 'raid', title: 'RAID', sub: 'THEY ARE COMING', pct: clamp(1 - r.t / 9, 0, 1), tone: 'red', marks: [] });
    else if (r.state === 'wave') out.push({ key: 'raid', title: 'RAID', sub: `WAVE ${r.wave + 1}/${r.waves} · ${r.left} LEFT`, pct: r.total > 0 ? r.left / r.total : 0, tone: 'red', marks: [] });
    else if (r.state === 'break') out.push({ key: 'raid', title: 'RAID', sub: `WAVE ${r.wave + 2}/${r.waves} COMING`, pct: clamp(1 - r.t / 8, 0, 1), tone: 'red', marks: [] });
    else if (r.state === 'won') out.push({ key: 'raid', title: 'RAID', sub: 'VICTORY', pct: 1, tone: 'green', marks: [] });
  }
  return out;
}

/** Raiders still standing in the current wave (the last few show at the screen's edge). */
export function raidersLeft(g: Game): Actor[] {
  const r = g.raid;
  if (!r || r.state !== 'wave' || r.left > 3) return [];
  return g.mobs.filter((m) => !m.dead && m.raid === r.wave);
}

/** Lights the Engine Core's beacon with a Nether Star: a beam to the sky, regeneration and strength aboard. */
export function lightBeacon(g: Game): void {
  const F = g.fortress;
  const key = g.coreKey();
  if (key === null || g.beacon || !g.useItem(I.NETHER_STAR, 1)) return;
  g.beacon = true;
  const x = kx(key);
  const y = ky(key);
  const z = kz(key);
  if (!F.hasBlock(x, y + 1, z)) F.setBlock(x, y + 1, z, B.BEACON);
  const core = F.cells.get(key);
  if (core) {
    core.maxHp += 40;
    core.hp = core.maxHp;
  }
  g.eachPlayer(() => addEffect(g, 'beacon', Infinity));
  const q = F.cellCenter(x, y, z);
  g.particles.ring(q.x, q.y + 1, q.z, 6, 0.75, 0.95, 1);
  g.particles.sparks(q.x, q.y + 1, q.z, ['#ffffff', '#bff4ff', '#7fd4ff'], 40, 6, 0.12, 1);
  g.light({ x: q.x, y: q.y + 2, z: q.z, r: 24, color: [0.8, 1.1, 1.3], life: 1.5, max: 1.5 });
  g.sfx('beacon', 'glass', 1);
  g.buzz(120);
  g.ui.banner('THE BEACON IS LIT!', 'Aboard: regeneration and strength. The crew repairs twice as fast. Core +40', 'gold');
  g.xp(30);
  feat(g, 'beacon');
  g.save();
}
