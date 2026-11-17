import { B, I, blockDef } from './blocks';
import { key3, kx, ky, kz } from './body';
import { TURRET_IDS } from './blocks';
import { spawnDrop } from './build';
import { autoTarget, explode, launchShot, planShot, shootArrow, spawnGiant, turretKind, turretRange, turretReady, usesTnt } from './combat';
import { addEffect, clearBadEffects, damageFactor, meleeBonus, type EffectId } from './effects';
import { Actor, JUMP_V, moveActor, type ActorKind } from './entities';
import { cargoPower, crewCapacity, damageFortressCell } from './fortress';
import { approach, type Game } from './game';
import type { GiantType } from './giants';
import { bodyGrid, depenetrate, overlaps, worldGrid, type Grid } from './physics';
import { raycastGrid } from './raycast';
import { freeCaptive, visitTrader } from './quests';
import { bountyCount, fleeFrom, goldenJackpot } from './events';
import { spawnVillageAnimals } from './animals';
import { feat } from './feats';
import { bossSpawnFactor, bossesTakeTheNight, onBossKilled, raidKilled } from './bosses';
import { hasTrophy, sealAhead } from './seals';
import type { CrewEvent } from './chatter';
import { drownedThrow } from './beasts';
import { spawnVillageFolk } from './folk';
import { officerKill, spawnVillageOfficer, talkTo } from './company';
import { setDone } from './curios';
import { landMetal, swordOf } from './gear';
import { monsterVoice, onMonsterHurt, specialMob, splitSlime, teleportAway } from './monsters';
import { clamp } from './rng';
import type { Structure } from './structures';
import type { Zone } from './terrain';
import { WX, WZ } from './world';

/** Giants per night: when (march progress) and what kind. They stride in as the waves break. */
const NIGHT_GIANTS: Array<Array<{ at: number; type: GiantType }>> = [
  [{ at: 0.45, type: 'brute' }],
  [{ at: 0.22, type: 'brute' }, { at: 0.5, type: 'warden' }],
  [{ at: 0.2, type: 'warden' }, { at: 0.78, type: 'brute' }],
  [{ at: 0.2, type: 'warden' }, { at: 0.48, type: 'warden' }],
  [{ at: 0.18, type: 'brute' }, { at: 0.8, type: 'titan' }],
];

/** Seconds a monster needs to climb a leg from the foot to the deck. */
const CLIMB_TIME = 4.5;

/** TNT the gun crews leave in the hold for the captain's own shots and throws. */
export const CREW_RESERVE = 6;

export type BeatName = 'dusk' | 'wave' | 'lull' | 'final' | 'dawn';

/** A stretch of the night: how hard the horde presses (spawn rate, group size) and its name. */
export interface NightBeat {
  name: BeatName;
  index: number;
  rate: number;
  group: number;
  label: string;
}

/**
 * The night's rhythm by march progress: a quiet dusk, the first wave, a lull to repair, a second
 * wave (the giant's), another lull, the final assault, then the horde falters as dawn breaks.
 */
export function nightBeat(p: number): NightBeat {
  if (p < 0.1) return { name: 'dusk', index: 0, rate: 0.35, group: 0, label: 'DUSK' };
  if (p < 0.3) return { name: 'wave', index: 1, rate: 1.1, group: 0, label: 'WAVE 1' };
  if (p < 0.42) return { name: 'lull', index: 2, rate: 0.28, group: -1, label: 'LULL' };
  if (p < 0.62) return { name: 'wave', index: 3, rate: 1.25, group: 1, label: 'WAVE 2' };
  if (p < 0.74) return { name: 'lull', index: 4, rate: 0.28, group: -1, label: 'LULL' };
  if (p < 0.93) return { name: 'final', index: 5, rate: 1.7, group: 2, label: 'FINAL ASSAULT' };
  return { name: 'dawn', index: 6, rate: 0, group: 0, label: 'DAWN' };
}

/** Calls each new stretch of the night: drums and a banner for a wave, a breath for a lull. */
function announceBeat(g: Game, b: NightBeat): void {
  // A boss fight has its own announcements (the raid's horn, the Wither's roar).
  if (bossesTakeTheNight(g) && b.name !== 'dawn') return;
  if (b.name === 'wave') {
    g.ui.banner(b.index === 1 ? 'THE HORDE COMES!' : 'SECOND WAVE!', b.index === 1 ? 'Hold the legs and the deck' : 'Bigger, and a giant with it', 'danger');
    g.sfx('wave', 'stone', 1);
    g.buzz(80);
    g.crewSay('wave');
  } else if (b.name === 'lull') {
    g.toast('A lull: repair, reload, eat. They will be back');
    g.sfx('bell', 'metal', 0.4);
    g.crewSay('lull');
  } else if (b.name === 'final') {
    g.ui.banner('FINAL ASSAULT!', 'Everything they have left: hold on until dawn', 'danger');
    g.sfx('wave', 'stone', 1);
    g.sfx('horn', 'stone', 0.6);
    g.buzz(120);
    g.crewSay('final');
  } else if (b.name === 'dawn') {
    g.toast('Dawn is breaking: the horde falters');
  }
}

/** Which region of the valley a point lies in. */
function zoneAt(g: Game, x: number, z: number): Zone {
  return g.world.terrain.zone(x, z);
}

/** Living monsters of a kind (for the caps on the rarer ones). */
function alive(g: Game, kind: ActorKind): number {
  let n = 0;
  for (const m of g.mobs) if (!m.dead && m.kind === kind) n += 1;
  return n;
}

/**
 * Who comes out of the dark here tonight. The horde changes with the land: husks in the desert,
 * strays on the snowfields, wither skeletons and slimes in the blight; with the nights come
 * skeletons and spiders, then witches and endermen.
 */
function nightKind(g: Game, night: number, x: number, z: number): ActorKind {
  const zone = zoneAt(g, x, z);
  const theme = g.nightTheme;
  const dry = zone === 'desert' || zone === 'badlands';
  const table: Array<[ActorKind, number]> = [
    ['zombie', dry ? 6 : zone === 'swamp' ? 12 : zone === 'ember' ? 5 : 30],
    ['husk', zone === 'desert' ? 30 : zone === 'badlands' ? 22 : night >= 3 ? 6 : 0],
    ['drowned', zone === 'swamp' ? 24 : 0],
    ['creeper', 14 + night * 2.5],
    ['skeleton', night >= 2 ? (zone === 'snow' ? 4 : zone === 'swamp' || zone === 'ember' ? 6 : 15 + night * 3) : 0],
    ['bogged', night >= 2 && zone === 'swamp' ? 14 + night * 2 : 0],
    ['stray', night >= 2 && zone === 'snow' ? 18 + night * 2 : 0],
    ['spider', night >= 2 ? 12 + night * 2 : 0],
    ['breeze', zone === 'badlands' && alive(g, 'breeze') < 3 ? 9 : 0],
    ['polarbear', zone === 'snow' && alive(g, 'polarbear') < 2 ? 5 : 0],
    ['blaze', zone === 'ember' && alive(g, 'blaze') < 4 ? 10 : 0],
    ['magmacube', zone === 'ember' && alive(g, 'magmacube') < 6 ? 12 : 0],
    ['enderman', night >= 2 && theme !== 'storm' && alive(g, 'enderman') < 2 + (zone === 'snow' || zone === 'blight' ? 1 : 0) ? 3 + (zone === 'blight' ? 2 : 0) : 0],
    ['witch', night >= 3 && alive(g, 'witch') < (zone === 'blight' || zone === 'swamp' ? 3 : 1) ? (zone === 'blight' ? 7 : zone === 'swamp' ? 6 : 2) : 0],
    ['slime', (zone === 'blight' || zone === 'swamp' || night >= 3) && alive(g, 'slime') < 6 ? (zone === 'blight' ? 7 : zone === 'swamp' ? 9 : 2) : 0],
    ['witherskel', zone === 'blight' || zone === 'ember' || g.siege ? (zone === 'ember' ? 6 : 10 + night * 2) : 0],
  ];
  let total = 0;
  for (const [, w] of table) total += w;
  let roll = Math.random() * total;
  for (const [kind, w] of table) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return 'zombie';
}

/** Dresses a freshly spawned night monster: babies, armour, villager faces, charges, riders. */
function outfit(g: Game, mob: Actor, night: number): void {
  const zone = zoneAt(g, mob.x, mob.z);
  if (mob.kind === 'zombie' || mob.kind === 'husk') {
    const r = Math.random();
    if (r < 0.07) makeBaby(mob);
    else if (mob.kind === 'zombie' && r < 0.17 && zone !== 'blight') mob.zvillager = true;
    // Later nights bring zombies in iron: a helmet first, then a chestplate too.
    if (!mob.baby && night >= 2 && Math.random() < 0.08 + night * 0.07) {
      mob.armor = night >= 3 && Math.random() < 0.5 ? 2 : 1;
      mob.armorHp = mob.armor === 2 ? 22 : 10;
    }
  } else if (mob.kind === 'creeper') {
    // A storm charges them (and now and then one turns up charged already).
    if ((g.nightTheme === 'storm' && Math.random() < 0.25) || Math.random() < 0.02 * night) mob.charged = true;
    // Most go for the feet: they blow a leg out from under the fortress.
    mob.tactic = Math.random() < 0.6 ? 1 : 0;
  } else if (mob.kind === 'spider' && night >= 3 && Math.random() < 0.12) {
    // A spider jockey: a skeleton riding on its back.
    const rider = new Actor('skeleton', mob.x, mob.y + 0.8, mob.z);
    scaleHealth(g, rider);
    rider.shootTimer = 1.5 + Math.random();
    mount(rider, mob);
    g.mobs.push(rider);
  } else if (mob.kind === 'slime' || mob.kind === 'magmacube') {
    setSlimeSize(mob, Math.random() < (zone === 'blight' || mob.kind === 'magmacube' ? 0.35 : 0.2) ? 4 : 2);
    scaleHealth(g, mob);
  } else if (mob.kind === 'blaze') {
    // Up off the ground at once, somewhere on its own circle round the fortress.
    mob.y += 5;
    mob.homeX = Math.random() * Math.PI * 2;
    mob.homeZ = Math.random() * 10;
    mob.shootTimer = 2 + Math.random() * 2;
  } else if (mob.kind === 'breeze' || mob.kind === 'drowned') {
    mob.shootTimer = 1.5 + Math.random() * 2;
  }
}

export function makeBaby(mob: Actor): void {
  mob.baby = true;
  mob.resize(0.5);
  mob.speed *= 1.65;
  mob.maxHp = Math.max(4, Math.round(mob.maxHp * 0.8));
  mob.hp = mob.maxHp;
}

/** A slime's size sets its body and its health (Minecraft's size squared). */
export function setSlimeSize(mob: Actor, size: number): void {
  mob.size = size;
  mob.resize(size / 2);
  mob.maxHp = size >= 4 ? 16 : size >= 2 ? 4 : 1;
  mob.hp = mob.maxHp;
  mob.speed = size >= 4 ? 1.9 : size >= 2 ? 2.2 : 2.5;
}

/** Puts a rider on a mount (a skeleton on a spider, an illager on a ravager). */
export function mount(rider: Actor, base: Actor): void {
  rider.mount = base;
  base.rider = rider;
  rider.climb = null;
}

/** Where a rider sits on its mount. */
function seatOf(base: Actor): number {
  return base.kind === 'ravager' ? 1.55 : base.kind === 'spider' ? 0.62 : base.h * 0.7;
}

/** The crew's warning at each of the new lands' monsters. */
const NEW_FOES: Partial<Record<ActorKind, CrewEvent>> = { drowned: 'drowned', bogged: 'drowned', breeze: 'breeze', polarbear: 'bear', blaze: 'blaze', magmacube: 'blaze' };

export function updateNightSpawns(g: Game, dt: number): void {
  const night = Math.min(Math.round(g.danger), 8);
  const theme = g.nightTheme;
  // The siege keeps its own pace (its bursts call in here without the night's rhythm).
  const beat = g.siege ? { name: 'wave' as const, index: g.beatIndex, rate: 1, group: 0, label: 'SIEGE' } : nightBeat(g.progress);
  if (beat.index !== g.beatIndex) {
    g.beatIndex = beat.index;
    announceBeat(g, beat);
  }
  // Blood moons and storms bring more of them, faster; waves press harder than lulls, and a
  // giant barring the way thins the horde (the fight is with it) without stopping it. So does a
  // boss: the raid and the Wither bring their own.
  g.spawnTimer -= dt * (theme === 'blood' ? 1.45 : theme === 'storm' ? 1.15 : 1) * beat.rate * (g.blocked ? 0.5 : 1) * bossSpawnFactor(g);
  if (g.spawnTimer <= 0) {
    g.spawnTimer = Math.max(1.3, 4.6 - night * 0.5) * (0.7 + Math.random() * 0.6);
    const living = g.mobs.filter((m) => !m.dead).length;
    // Phantoms circle in from the third night (and on any storm or blood moon).
    const phantoms = alive(g, 'phantom');
    if ((night >= 3 || theme !== 'clear') && theme !== 'raid' && phantoms < Math.min(2 + Math.floor(night / 2), 5) && Math.random() < (beat.name === 'lull' ? 0.1 : 0.3)) spawnPhantom(g);
    // Ghasts drift over the blight, and over the Citadel.
    const c0 = g.fortressCentre();
    if ((g.siege || zoneAt(g, c0[0], c0[2]) === 'blight') && alive(g, 'ghast') < (g.siege ? 3 : 1) && Math.random() < (g.siege ? 0.3 : 0.12)) spawnGhast(g);
    // (The first night is a gentler one: fewer at once while you learn the ropes.)
    const cap = (night <= 1 ? 8 : 7 + night * 3) + (theme === 'blood' ? 6 : 0) + (beat.name === 'final' ? (night <= 1 ? 4 : 6) : 0);
    if (living < cap) {
      const c = g.fortressCentre();
      const group = Math.max(1, 1 + Math.floor(night / 2) + (Math.random() < 0.35 ? 1 : 0) + (theme === 'blood' ? 1 : 0) + beat.group);
      // Ahead of the march, from the flanks, or from behind.
      const roll = Math.random();
      const base = roll < 0.7 ? 0 : roll < 0.92 ? (Math.random() < 0.5 ? 1 : -1) * Math.PI * 0.35 : Math.PI;
      const heading = Math.atan2(g.marchDir[1], g.marchDir[0]);
      for (let i = 0; i < group; i += 1) {
        const a = heading + base + (Math.random() - 0.5) * 0.9;
        const r = g.fortressRadius() + 18 + Math.random() * 10;
        const x = c[0] + Math.cos(a) * r;
        const z = c[2] + Math.sin(a) * r;
        const kind = nightKind(g, night, x, z);
        const mob = spawnMob(g, kind, x + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 2);
        if (!mob) continue;
        outfit(g, mob, night);
        if (theme === 'blood') mob.speed *= 1.25;
        // The crew sings out at the new lands' monsters (each warning has its own pause).
        const shout = NEW_FOES[mob.kind];
        if (shout) g.crewSay(shout);
      }
    }
  }
  // The raid and the Wither are the night's big fights: no giants on those nights (nor on the
  // march up to a Heart Seal, whose guardian is the night's giant).
  if (bossesTakeTheNight(g) && !g.siege) return;
  const seal = sealAhead(g);
  if (seal && g.destination && g.destination.x > seal.x) return;
  const base = NIGHT_GIANTS[Math.max(1, Math.min(Math.round(g.danger), NIGHT_GIANTS.length)) - 1]!;
  // A great fortress draws more of them.
  const blocks = g.fortress.cells.size;
  const schedule = blocks > 2200 ? [...base, { at: 0.85, type: 'warden' as GiantType }] : blocks > 1300 ? [...base, { at: 0.8, type: 'brute' as GiantType }] : base;
  const next = schedule[g.giantsSpawned];
  if (next && g.progress >= next.at) {
    g.giantsSpawned += 1;
    spawnGiant(g, next.type);
  }
}

/** A phantom swoops in high over the fortress. */
export function spawnPhantom(g: Game): Actor | null {
  const c = g.fortressCentre();
  const a = Math.random() * Math.PI * 2;
  const F = g.fortress;
  const mob = new Actor('phantom', c[0] + Math.cos(a) * 46, F.y + 22, c[2] + Math.sin(a) * 46);
  const scale = 1 + (g.danger - 1) * 0.15;
  mob.maxHp = Math.round(mob.maxHp * scale);
  mob.hp = mob.maxHp;
  mob.fly = { mode: 'circle', t: 4 + Math.random() * 4, angle: a, radius: 14 + Math.random() * 9, height: 12 + Math.random() * 6, tx: 0, ty: 0, tz: 0 };
  g.mobs.push(mob);
  g.crewSay('phantom');
  return mob;
}

/** A ghast drifts in high over the fortress, crying. */
export function spawnGhast(g: Game): Actor | null {
  const c = g.fortressCentre();
  const a = Math.random() * Math.PI * 2;
  const mob = new Actor('ghast', c[0] + Math.cos(a) * 44, g.fortress.y + 16 + Math.random() * 6, c[2] + Math.sin(a) * 44);
  scaleHealth(g, mob);
  mob.homeX = a;
  mob.shootTimer = 3 + Math.random() * 2;
  g.mobs.push(mob);
  g.crewSay('ghast');
  return mob;
}

/**
 * Phantoms circle the fortress, shriek, dive at you (or the deck), then climb away and circle
 * again. The shriek (its green eyes flare as it folds its wings) is the moment to look up.
 */
function updatePhantom(g: Game, mob: Actor, dt: number): void {
  const f = mob.fly!;
  const F = g.fortress;
  const c = g.fortressCentre();
  const p = g.player;
  f.t -= dt;
  let tx: number;
  let ty: number;
  let tz: number;
  let speed = mob.speed;
  if (mob.act === 'scream') {
    // Hanging on the air, wings folding, before the dive.
    mob.actT += dt;
    tx = mob.x + mob.vx * 0.2;
    ty = mob.cy + 0.4;
    tz = mob.z + mob.vz * 0.2;
    speed *= 0.25;
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      f.mode = 'dive';
      f.t = 4;
    }
  } else if (f.mode === 'circle') {
    f.angle += dt * (speed / f.radius) * 0.55;
    tx = c[0] + Math.cos(f.angle) * f.radius;
    tz = c[2] + Math.sin(f.angle) * f.radius;
    ty = F.y + f.height + Math.sin(g.time * 1.3 + f.radius) * 0.8;
    if (f.t <= 0 && g.phase === 'night') {
      // Pick a victim: you if you are up on the fortress, else a deck block.
      if (!p.dead && Math.hypot(p.x - c[0], p.z - c[2]) < 40 && !g.leap) {
        f.tx = p.x;
        f.ty = p.y + 1;
        f.tz = p.z;
      } else {
        const cells = [...F.cells.keys()].filter((k) => ky(k) >= 1);
        const k = cells[Math.floor(Math.random() * cells.length)];
        if (k === undefined) {
          f.t = 3;
          return;
        }
        const q = F.cellCenter(kx(k), ky(k), kz(k));
        f.tx = q.x;
        f.ty = q.y;
        f.tz = q.z;
      }
      mob.act = 'scream';
      mob.actT = 0;
      mob.actDur = 0.55;
      g.sfxAt('phantom', mob.x, mob.y, mob.z, 1);
    }
  } else if (f.mode === 'dive') {
    // Home in on the target (you keep moving).
    if (!p.dead && Math.hypot(f.tx - p.x, f.tz - p.z) < 6) {
      f.tx = p.x;
      f.ty = p.y + 1;
      f.tz = p.z;
    }
    tx = f.tx;
    ty = f.ty;
    tz = f.tz;
    speed *= 1.7;
    if (Math.random() < dt * 20) g.particles.add({ x: mob.x, y: mob.cy, z: mob.z, vx: 0, vy: 0, vz: 0, life: 0.5, size: 0.35, grow: 0.6, r: 0.55, g: 0.6, b: 0.7, a: 0.35, gravity: -0.4, drag: 2, tile: 'smoke', soft: true });
    const d = Math.hypot(tx - mob.x, ty - mob.cy, tz - mob.z);
    if (d < 1.3 || f.t <= 0) {
      if (d < 1.6) {
        if (!p.dead && Math.hypot(p.x - mob.x, p.cy - mob.cy, p.z - mob.z) < 2) damagePlayer(g, 3 + Math.floor(g.danger / 3), mob.vx * 0.4, mob.vz * 0.4);
        else {
          const target = fortressCellNear(g, mob, 1.2);
          if (target !== null) damageFortressCell(g, target, 4 + g.danger * 0.5);
        }
      }
      f.mode = 'climb';
      f.t = 1.8;
    }
  } else {
    tx = mob.x + mob.vx;
    tz = mob.z + mob.vz;
    ty = F.y + f.height + 6;
    if (f.t <= 0) {
      f.mode = 'circle';
      f.t = 5 + Math.random() * 5;
      f.angle = Math.atan2(mob.z - c[2], mob.x - c[0]);
    }
  }
  steerFlier(g, mob, tx, ty, tz, speed, dt, 6);
  mob.walkPhase += dt * (f.mode === 'dive' || mob.act === 'scream' ? 3 : 7);
}

/** Flies an actor towards a point (smooth turns, never into the ground). */
export function steerFlier(g: Game, mob: Actor, tx: number, ty: number, tz: number, speed: number, dt: number, agility: number, clearance = 1.5): void {
  let dx = tx - mob.x;
  let dy = ty - mob.cy;
  let dz = tz - mob.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  const k = agility * dt;
  mob.vx = approach(mob.vx, dx * speed, k * speed);
  mob.vy = approach(mob.vy, dy * speed, k * speed);
  mob.vz = approach(mob.vz, dz * speed, k * speed);
  mob.x += mob.vx * dt;
  mob.y += mob.vy * dt;
  mob.z += mob.vz * dt;
  const floor = g.world.groundAt(mob.x, mob.z) + clearance;
  if (mob.y < floor) {
    mob.y = floor;
    mob.vy = Math.max(0, mob.vy);
  }
  if (Math.hypot(mob.vx, mob.vz) > 0.3) mob.yaw = Math.atan2(mob.vz, mob.vx);
}

/** The night makes them tougher (each night a little more health). */
export function scaleHealth(g: Game, mob: Actor): void {
  const scale = 1 + (g.danger - 1) * 0.18;
  mob.maxHp = Math.max(1, Math.round(mob.maxHp * scale));
  mob.hp = mob.maxHp;
}

export function spawnMob(g: Game, kind: ActorKind, x: number, z: number): Actor | null {
  const cx = Math.floor(Math.max(3, Math.min(WX - 4, x)));
  const cz = Math.floor(Math.max(3, Math.min(WZ - 4, z)));
  if (!g.world.chunkAt(cx, cz)) return null;
  const top = g.world.topAt(cx, cz);
  if (top < 0 || g.world.liquid(cx, top + 1, cz)) return null;
  const mob = new Actor(kind, cx + 0.5, top + 1, cz + 0.5);
  scaleHealth(g, mob);
  mob.speed *= 0.92 + Math.random() * 0.2;
  mob.shootTimer = 1 + Math.random() * 2;
  mob.voiceT = 2 + Math.random() * 6;
  mob.strafe = Math.random() < 0.5 ? -1 : 1;
  mob.yaw = Math.random() * Math.PI * 2;
  if (kind === 'enderman') mob.tpTimer = 6 + Math.random() * 8;
  g.mobs.push(mob);
  return mob;
}

// ------------------------------------------------------------------ damage

export function damagePlayer(g: Game, amount: number, knockX: number, knockZ: number, effect?: EffectId, seconds = 0): void {
  g.own(() => hurtPlayer(g, amount, knockX, knockZ, effect, seconds));
}

function hurtPlayer(g: Game, amount: number, knockX: number, knockZ: number, effect: EffectId | undefined, seconds: number): void {
  const p = g.player;
  if (p.dead || p.invulnerable > 0 || g.leap || amount <= 0 || g.cx.away) return;
  if (g.phase !== 'day' && g.phase !== 'night') return;
  amount *= damageFactor(g);
  p.hp -= amount;
  p.hurt = 0.35;
  p.invulnerable = 0.5;
  p.vx += knockX;
  p.vz += knockZ;
  p.vy = Math.max(p.vy, 4);
  p.onGround = false;
  p.standingOn = null;
  if (effect && seconds > 0) addEffect(g, effect, seconds);
  g.sfx('oof');
  g.renderer.shake(0.25 + Math.min(0.3, amount * 0.04));
  g.tookHit(amount, knockX, knockZ);
  if (p.hp <= 0) {
    // A Totem of Undying in the pack: it shatters and you live (Minecraft's last chance).
    if (g.count(I.TOTEM) > 0) {
      useTotem(g);
      return;
    }
    p.hp = 0;
    p.dead = true;
    g.respawnTimer = 3;
    g.particles.smoke(p.x, p.cy, p.z, 10, 1);
    g.toast('Knocked out! Respawning on the fortress...');
  }
}

/** Hearts lost to something inside you (poison, wither): no shove, no hurt-cam, just the loss. */
export function drainPlayer(g: Game, amount: number): void {
  const p = g.player;
  if (p.dead || amount <= 0 || g.cx.away || (g.phase !== 'day' && g.phase !== 'night')) return;
  p.hp -= amount;
  p.hurt = Math.max(p.hurt, 0.18);
  g.sfx('oof', 'flesh', 0.35, 1.1);
  if (p.hp > 0) return;
  if (g.count(I.TOTEM) > 0) {
    useTotem(g);
    return;
  }
  p.hp = 0;
  p.dead = true;
  g.respawnTimer = 3;
  g.particles.smoke(p.x, p.cy, p.z, 10, 1, true);
  g.toast('Withered away! Respawning on the fortress...');
}

/** A blow that would have killed you: the totem pops, you stand back up glowing gold and green. */
function useTotem(g: Game): void {
  const p = g.player;
  g.useItem(I.TOTEM, 1);
  p.hp = Math.max(4, Math.round(p.maxHp * 0.3));
  p.invulnerable = 1.5;
  clearBadEffects(g);
  addEffect(g, 'regen', 20, 2);
  addEffect(g, 'resistance', 8, 2);
  g.sfx('totem', 'glass', 1);
  g.buzz(200);
  g.freeze(0.2);
  g.ui.totem();
  g.ui.flash('gold');
  for (let i = 0; i < 60; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 4;
    const gold = i % 3 !== 0;
    g.particles.add({ x: p.x, y: p.y + 1, z: p.z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 5, vz: Math.sin(a) * s, life: 1.2 + Math.random() * 0.8, size: 0.16, r: gold ? 1 : 0.5, g: gold ? 0.85 : 1, b: gold ? 0.3 : 0.4, a: 1, emit: 1.2, gravity: 4, drag: 1.2, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 5 });
  }
  g.ui.banner('SAVED BY THE TOTEM!', 'The Totem of Undying shatters, and you stand back up', 'gold');
  feat(g, 'totem');
}

/** Who landed a blow: your own (a damage number pops up; a critical one in gold), or anything else. */
export type HitSource = 'player' | 'crit' | null;

/** How a blow landed: in melee, a shot (bolts, arrows), a blast, or anything else. */
export type HitHow = 'melee' | 'shot' | 'blast' | 'other';

/** How much a body shrugs off being shoved about (heavy beasts and bosses barely move). */
function knockTaken(mob: Actor): number {
  switch (mob.kind) {
    case 'ravager':
      return 0.15;
    case 'wither':
      return 0;
    case 'ghast':
      return 0.35;
    case 'enderman':
    case 'witherskel':
      return 0.6;
    default:
      return 1;
  }
}

export function damageMob(g: Game, mob: Actor, amount: number, knockX: number, knockZ: number, source: HitSource = null, how: HitHow = 'other'): void {
  if (mob.dead || amount <= 0) return;
  // An enderman sidesteps anything shot at it (Minecraft's ender dodge): it has to be fought hand to hand.
  if (mob.kind === 'enderman' && how === 'shot' && mob.stun <= 0) {
    teleportAway(g, mob, 'dodge');
    return;
  }
  const react = onMonsterHurt(g, mob, amount, source, how);
  if (react <= 0) return;
  amount = react;
  // Iron armour takes part of the blow (and wears through).
  if (mob.armor > 0 && mob.armorHp > 0) {
    const share = mob.armor === 2 ? 0.45 : 0.25;
    const soaked = amount * share;
    amount -= soaked;
    mob.armorHp -= soaked;
    g.sfxAt('clank', mob.x, mob.y + mob.h, mob.z, 0.8, 0.9 + Math.random() * 0.2);
    g.particles.sparks(mob.x, mob.y + mob.h * 0.8, mob.z, ['#ffffff', '#d0d4dc'], 4, 2.5, 0.05, 0.25);
    if (mob.armorHp <= 0) {
      mob.armor = 0;
      g.particles.debris(mob.x, mob.y + mob.h * 0.8, mob.z, 'iron_block', 8, 3, 0.12, 0.6);
      if (source) g.ui.damage(0, mob.x, mob.y + mob.h + 0.3, mob.z, 'streak', 'ARMOR BROKEN!');
    }
  }
  // (The Blight's relics: your blows bite deeper into the great ones.)
  if (mob.boss && source && setDone(g, 6)) amount *= 1.25;
  const dealt = Math.min(amount, Math.max(0, mob.hp));
  mob.hp -= amount;
  mob.hurt = 0.25;
  // A blow interrupts one being wound up (and a bow being drawn).
  if (mob.windup > 0) {
    mob.windup = 0;
    mob.attackTimer = Math.max(mob.attackTimer, 0.5);
  }
  if (mob.act === 'draw' || mob.act === 'pounce') {
    mob.act = 'none';
    mob.shootTimer = Math.max(mob.shootTimer, 0.7);
  }
  if (mob.climb) {
    // Knocked off the leg.
    mob.climb = null;
    mob.vy = 2;
  }
  const k = knockTaken(mob);
  if (!mob.mount) {
    mob.vx += knockX * k;
    mob.vz += knockZ * k;
    if (!mob.flying && k > 0.5) {
      mob.vy = Math.max(mob.vy, 4);
      mob.onGround = false;
    }
  }
  if (mob.kind === 'creeper' && mob.fuse > 0) mob.fuse = Math.max(0, mob.fuse - 0.4);
  if (source) g.ui.damage(Math.max(1, Math.round(dealt)), mob.x, mob.y + mob.h * 0.85, mob.z, source === 'crit' ? 'crit' : 'hit');
  if (mob.hp <= 0) killMob(g, mob, true, source);
  else monsterVoice(g, mob, 'hurt');
}

/** Experience for a kill, by kind. */
const XP: Partial<Record<ActorKind, number>> = {
  creeper: 5, enderman: 8, witch: 8, slime: 2, witherskel: 7, ghast: 10, pillager: 6, vindicator: 7, evoker: 18, vex: 2, ravager: 25, wither: 80,
};

export function killMob(g: Game, mob: Actor, drops: boolean, source: HitSource = null): void {
  if (mob.dead) return;
  mob.dead = true;
  g.stats.slain += 1;
  // It tips over, flashing red, and puffs away a moment later (see Game.updateCorpses).
  mob.deathT = 0;
  mob.climb = null;
  mob.fly = null;
  mob.fuse = 0;
  mob.act = 'none';
  // Riders fall off their mounts; a mount loses its rider.
  if (mob.rider) {
    mob.rider.mount = null;
    mob.rider.vy = 3;
    mob.rider = null;
  }
  if (mob.mount) {
    mob.mount.rider = null;
    mob.mount = null;
  }
  // Ghasts and slimes do not tip over; the Wither has a death of its own.
  if (mob.kind !== 'wither') g.corpses.push(mob);
  monsterVoice(g, mob, 'death');
  if (source) {
    g.killStreak(mob);
    bountyCount(g, 'slay');
  }
  if (mob.raid >= 0) raidKilled(g, mob);
  if (mob.boss) onBossKilled(g, mob);
  if (mob.golden > 0) {
    goldenJackpot(g, mob);
    return;
  }
  // A big slime splits in two to four smaller ones.
  if ((mob.kind === 'slime' || mob.kind === 'magmacube') && mob.size > 1) splitSlime(g, mob);
  // An enderman lets go of the block it took (your block back).
  if (mob.carry) {
    spawnDrop(g, mob.carry, 1, mob.x, mob.y + 1.6, mob.z);
    if (source) {
      g.ui.damage(0, mob.x, mob.y + mob.h + 0.4, mob.z, 'big', 'BLOCK RECOVERED!');
      feat(g, 'thief');
    }
    mob.carry = 0;
  }
  if (mob.captain && source) bannerFell(g, mob);
  g.bestiary[mob.kind] = (g.bestiary[mob.kind] ?? 0) + 1;
  if (!drops) return;
  g.xp(XP[mob.kind] ?? 4);
  const at = (id: number, n = 1): void => spawnDrop(g, id, n, mob.x, mob.cy, mob.z);
  const roll = Math.random();
  // An errand's count (and what it wants off them), and this land's metal now and then.
  officerKill(g, mob.kind, at);
  const metal = landMetal(g.world.terrain.zone(mob.x, mob.z));
  if (metal !== null && Math.random() < 0.07) at(metal);
  switch (mob.kind) {
    case 'creeper':
      at(I.GUNPOWDER, 1 + (Math.random() < 0.5 ? 1 : 0) + (mob.charged ? 2 : 0));
      if (Math.random() < (mob.charged ? 0.5 : 0.08)) at(I.EMERALD);
      return;
    case 'skeleton':
    case 'stray':
      if (roll < 0.5) at(I.GUNPOWDER);
      return;
    case 'witherskel':
      // Coal, as in Minecraft.
      if (roll < 0.6) at(I.COAL, 1 + (Math.random() < 0.4 ? 1 : 0));
      if (Math.random() < 0.06) at(I.EMERALD);
      return;
    case 'enderman':
      if (roll < 0.6) at(I.PEARL);
      return;
    case 'witch':
      // Witches drop the makings of their brews (and now and then a healing potion).
      at(roll < 0.4 ? I.REDSTONE : roll < 0.75 ? I.GUNPOWDER : B.GLOWSTONE, 1 + (Math.random() < 0.5 ? 1 : 0));
      if (Math.random() < 0.35) at(I.POTION);
      return;
    case 'slime':
      if (mob.size <= 1 && roll < 0.04) at(I.EMERALD);
      return;
    case 'ghast':
      at(I.GUNPOWDER, 2);
      if (Math.random() < 0.3) at(I.EMERALD);
      return;
    case 'pillager':
      if (roll < 0.3) at(I.EMERALD);
      if (Math.random() < 0.15) at(I.IRON_INGOT);
      return;
    case 'vindicator':
      if (roll < 0.55) at(I.EMERALD);
      if (Math.random() < 0.3) at(I.IRON_INGOT);
      return;
    case 'evoker':
      // Every evoker carries a Totem of Undying.
      at(I.TOTEM);
      at(I.EMERALD, 2);
      return;
    case 'ravager':
      at(I.EMERALD, 4);
      at(I.IRON_INGOT, 3);
      return;
    case 'vex':
    case 'wither':
    case 'phantom':
      if (mob.kind === 'phantom' && roll < 0.08) at(I.EMERALD);
      return;
    default:
      if (Math.random() < 0.03) at(I.EMERALD);
      if (roll < 0.14) at(I.IRON_INGOT);
      else if (roll < 0.34) at(I.COAL);
      else if (roll < 0.44) at(I.BREAD);
  }
}

/** A captain falls with his banner: you are marked (Bad Omen), and the illagers will come. */
function bannerFell(g: Game, mob: Actor): void {
  mob.captain = false;
  g.omen();
  g.particles.sparks(mob.x, mob.y + 2.2, mob.z, ['#1e9a52', '#0b6138', '#ffffff'], 18, 3, 0.1, 0.9);
}

/** Splat colours by kind (what squirts out from under the foot). */
const SPLAT: Partial<Record<ActorKind, [number, number, number]>> = {
  zombie: [0.33, 0.52, 0.27], husk: [0.66, 0.55, 0.36], skeleton: [0.84, 0.83, 0.79], stray: [0.75, 0.84, 0.86], creeper: [0.3, 0.62, 0.22], spider: [0.2, 0.15, 0.12],
  cavespider: [0.1, 0.25, 0.3], witherskel: [0.18, 0.18, 0.18], slime: [0.45, 0.8, 0.35], enderman: [0.1, 0.06, 0.12], witch: [0.32, 0.2, 0.42], pillager: [0.4, 0.42, 0.42], vindicator: [0.25, 0.32, 0.36],
};

/**
 * Caught under one of the fortress's feet: it squirts out at the rim of the foot flat as a pancake
 * (a splat, a squeak, a cheer from the crew) and puffs away a moment later.
 */
export function squashMob(g: Game, mob: Actor, fx: number, fy: number, fz: number, reach: number): void {
  // From the helm the foot is yours: it counts as your kill.
  killMob(g, mob, true, g.helm ? 'player' : null);
  mob.squash = 1;
  let dx = mob.x - fx;
  let dz = mob.z - fz;
  let l = Math.hypot(dx, dz);
  if (l < 0.05) {
    const a = Math.random() * Math.PI * 2;
    dx = Math.cos(a);
    dz = Math.sin(a);
    l = 1;
  } else {
    dx /= l;
    dz /= l;
  }
  const r = Math.max(l, reach + 0.25);
  mob.x = fx + dx * r;
  mob.z = fz + dz * r;
  mob.y = Math.max(fy, g.world.groundAt(mob.x, mob.z));
  mob.vx = mob.vy = mob.vz = 0;
  // Feet at the rim, laid out flat away from the foot (see drawPancake).
  mob.yaw = Math.atan2(-dz, -dx);
  mob.hurt = 0;
  const [cr, cg, cb] = SPLAT[mob.kind] ?? [0.5, 0.5, 0.5];
  for (let i = 0; i < 12; i += 1) {
    const a = Math.atan2(dz, dx) + (Math.random() - 0.5) * 2.2;
    const s = 2 + Math.random() * 3.5;
    g.particles.add({ x: mob.x, y: mob.y + 0.25, z: mob.z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 3, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.4, size: 0.12 + Math.random() * 0.1, r: cr, g: cg, b: cb, gravity: 16, drag: 0.8 });
  }
  g.particles.dust(mob.x, mob.y + 0.1, mob.z, 6, 1.2, false);
  const p = g.player;
  const d = Math.hypot(p.x - mob.x, p.z - mob.z);
  g.sfx('squish', 'flesh', clamp(1.15 - d / 50, 0.25, 1), 0.9 + Math.random() * 0.2);
  // Close by (or steering), the splat holds the world for a beat.
  if (g.helm || d < 24) {
    g.freeze(0.05);
    g.buzz(25);
  }
  g.ui.damage(0, mob.x, mob.y + 1.4, mob.z, 'big', 'SQUASH!');
  g.xp(2);
  feat(g, 'pancake');
  feat(g, 'stack');
  g.crewSay('squash');
}

export function meleeMob(g: Game, mob: Actor): void {
  if (g.attackCooldown > 0) return;
  const sword = g.wieldsSword();
  g.attackCooldown = sword ? 0.42 : 0.32;
  g.mining.swing = 0.25;
  const p = g.player;
  const dx = mob.x - p.x;
  const dz = mob.z - p.z;
  const l = Math.hypot(dx, dz) || 1;
  // A blow struck while falling from a jump is a critical hit, as in Minecraft.
  g.blows += 1;
  const tier = sword ? g.gear.sword : 0;
  const crit = (!p.onGround && !p.climbing && p.vy < -0.2 && !g.inWater(p)) || (tier === 3 && g.blows % 4 === 0);
  const base = meleeBonus(g, sword ? 8 + Math.floor(g.level() / 3) + swordOf(g).power : 4 + Math.floor(g.level() / 5));
  const damage = crit ? Math.round(base * 1.5) : base;
  if (crit) bountyCount(g, 'crit');
  const knock = (sword ? 8 : 6) * (crit ? 1.4 : 1);
  const before = mob.hp;
  damageMob(g, mob, damage, (dx / l) * knock, (dz / l) * knock, crit ? 'crit' : 'player', 'melee');
  const killed = before > 0 && mob.dead;
  // What the forged blades leave in the wound.
  if (!mob.dead) {
    if (tier === 2 || tier === 5) {
      mob.sear = 3;
      mob.searFire = tier === 5;
    } else if (tier === 4) mob.stun = Math.max(mob.stun, 0.45);
  }
  g.particles.sparks(mob.x, mob.cy, mob.z, ['#ffffff', '#ff5040', '#ff8060'], 7, 3.2, 0.05, 0.28);
  if (crit) {
    g.particles.crit(mob.x, mob.cy + 0.2, mob.z);
    g.sfx('crit', 'metal', 1);
  }
  g.sfx('slash', 'flesh', sword ? 1 : 0.75, killed ? 0.85 : 1);
  g.sfx('swing', 'wood', sword ? 0.4 : 0.25);
  // The hit lands: the world holds for a beat, the view jolts, the phone thumps.
  g.freeze(killed ? 0.09 : crit ? 0.075 : 0.045);
  g.punch(crit ? 0.03 : 0.014);
  g.buzz(killed || crit ? 22 : 12);
  if (killed) g.hitMarker(true);
  // The sword sweeps: everything else close in front takes a share of the blow.
  if (sword) {
    const fx = Math.cos(g.yaw);
    const fz = Math.sin(g.yaw);
    g.slashes.push({ x: p.x, y: p.y + 1.4, z: p.z, yaw: g.yaw, t: 0, crit });
    for (const other of g.mobs) {
      if (other === mob || other.dead) continue;
      const ox = other.x - p.x;
      const oz = other.z - p.z;
      const d = Math.hypot(ox, oz);
      if (d > 2.8 || Math.abs(other.cy - p.cy) > 1.8 || (ox * fx + oz * fz) / (d || 1) < 0.35) continue;
      damageMob(g, other, damage * 0.6, (ox / (d || 1)) * knock, (oz / (d || 1)) * knock, 'player', 'melee');
    }
    g.particles.sparks(p.x + fx * 1.4, p.cy, p.z + fz * 1.4, ['#ffffff', '#c8d8ff'], 5, 2.5, 0.06, 0.2);
  }
  g.report('visual_feedback');
}

// ------------------------------------------------------------------ monsters

/** Nearest solid fortress cell touching an actor's padded box. */
export function fortressCellNear(g: Game, actor: Actor, pad: number): number | null {
  const F = g.fortress;
  // The padded box, turned into the fortress frame (its corners stay within this radius).
  const [lx, ly, lz] = F.toLocal(actor.x, actor.y, actor.z);
  const r = actor.hw * 1.42 + pad;
  const x0 = Math.floor(lx - r);
  const x1 = Math.floor(lx + r);
  const z0 = Math.floor(lz - r);
  const z1 = Math.floor(lz + r);
  const y0 = Math.floor(ly - 0.2);
  const y1 = Math.floor(ly + actor.h + 0.7);
  let best: number | null = null;
  let bestD = Infinity;
  for (let y = y0; y <= y1; y += 1) {
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (!F.solidAt(x, y, z)) continue;
        const c = F.cellCenter(x, y, z);
        const d = Math.hypot(c.x - actor.x, c.y - actor.cy, c.z - actor.z);
        if (d < bestD) {
          bestD = d;
          best = key3(x, y, z);
        }
      }
    }
  }
  return best;
}

export function canStepUp(actor: Actor, dx: number, dz: number, grids: Grid[]): boolean {
  const box = { x: actor.x + dx * 0.35, y: actor.y + 1.05, z: actor.z + dz * 0.35, hw: actor.hw, h: actor.h };
  for (const grid of grids) if (overlaps(box, grid, 0.02)) return false;
  return true;
}

/** Whether an actor stands on the fortress deck (or anywhere on its body). */
export function onFortress(g: Game, a: Actor): boolean {
  return a.standingOn === g.fortress;
}

export function nearestFoot(g: Game, a: Actor): { i: number; d: number } {
  let best = -1;
  let bestD = Infinity;
  g.walker.legs.forEach((l, i) => {
    if (l.t >= 0) return;
    const d = Math.hypot(l.foot[0] - a.x, l.foot[2] - a.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return { i: best, d: bestD };
}

/** Climbing a fortress leg: follow it from the foot to the hip, then hop onto the deck. */
function climbLeg(g: Game, mob: Actor, dt: number): void {
  const c = mob.climb!;
  const leg = g.walker.legs[c.leg];
  const F = g.fortress;
  if (!leg) {
    mob.climb = null;
    return;
  }
  // A swinging leg may shake its climber off (spiders hold on); otherwise they cling and wait.
  const stepping = leg.t >= 0;
  const spider = mob.kind === 'spider' || mob.kind === 'cavespider';
  if (stepping && !c.swinging && !spider && Math.random() < 0.22) {
    mob.climb = null;
    mob.vy = 3;
    mob.vx = (Math.random() - 0.5) * 6;
    mob.vz = (Math.random() - 0.5) * 6;
    return;
  }
  c.swinging = stepping;
  if (!stepping || spider) c.t += dt / (spider ? CLIMB_TIME / (mob.kind === 'cavespider' ? 3.2 : 2.6) : mob.baby ? CLIMB_TIME / 1.6 : CLIMB_TIME);
  // Climbers chew at the leg's joints as they go.
  damageLeg(g, c.leg, dt * (spider ? 0.03 : 0.01) * (1 + g.danger * 0.08));
  const hip = g.walker.hipWorld(F, leg);
  const knee = g.walker.knee(F, leg, hip);
  const t = Math.min(1, c.t);
  const p = t < 0.5 ? lerp3(leg.foot, knee, t * 2) : lerp3(knee, hip, (t - 0.5) * 2);
  mob.x = p[0];
  mob.y = p[1] - 0.6;
  mob.z = p[2];
  mob.vx = mob.vy = mob.vz = 0;
  mob.walkPhase += dt * 2;
  mob.yaw = Math.atan2(hip[2] - leg.foot[2], hip[0] - leg.foot[0]);
  if (c.t < 1) return;
  // Over the rim onto the deck, at the free deck cell nearest the hip.
  mob.climb = null;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const key of F.cells.keys()) {
    if (ky(key) !== 0) continue;
    const x = kx(key);
    const z = kz(key);
    if (F.solidAt(x, 1, z) || F.solidAt(x, 2, z)) continue;
    const d = Math.hypot(x + 0.5 - leg.hx, z + 0.5 - leg.hz);
    if (d < bestD) {
      bestD = d;
      best = [x, z];
    }
  }
  if (!best) return;
  const [wx, wy, wz] = F.toWorld(best[0] + 0.5, 1.002, best[1] + 0.5);
  mob.x = wx;
  mob.y = wy;
  mob.z = wz;
  mob.standingOn = F;
  mob.onGround = true;
  monsterVoice(g, mob, 'ambient');
}

function lerp3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
}

export function hasLineOfSight(g: Game, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.1) return true;
  const hit = raycastGrid(ax, ay, az, dx / d, dy / d, dz / d, d, (x, y, z) => g.world.solid(x, y, z));
  return hit === null;
}

/**
 * The head turns to watch you (Minecraft mobs track the player with their eyes): within a few
 * blocks and in front of it, the head follows, smoothly, up to a quarter turn either way.
 */
function watch(g: Game, mob: Actor, dt: number): void {
  const p = g.player;
  let wantYaw = 0;
  let wantPitch = 0;
  if (!p.dead && mob.deathT < 0) {
    const dx = p.x - mob.x;
    const dz = p.z - mob.z;
    const d = Math.hypot(dx, dz);
    if (d < 14 && d > 0.3) {
      let rel = Math.atan2(dz, dx) - mob.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (Math.abs(rel) < 1.9) {
        wantYaw = clamp(rel, -1.1, 1.1);
        wantPitch = clamp(Math.atan2(p.y + 1.6 - (mob.y + mob.h * 0.9), d), -0.7, 0.7);
      }
    }
  }
  const k = Math.min(1, dt * 7);
  mob.headYaw += (wantYaw - mob.headYaw) * k;
  mob.headPitch += (wantPitch - mob.headPitch) * k;
}

/**
 * Walks a ground monster one step towards (dx, dz) at a speed: it hops up single steps, a spider
 * climbs straight up any wall it walks into, and one stuck behind a wall counts the seconds.
 */
export function walkStep(g: Game, mob: Actor, dx: number, dz: number, speed: number, dt: number, grids: Grid[], worldOnly: Grid[], keepAir = false): void {
  if (!keepAir || mob.onGround) {
    mob.vx = approach(mob.vx, dx * speed, 14 * dt);
    mob.vz = approach(mob.vz, dz * speed, 14 * dt);
  }
  mob.wantJump = false;
  const result = moveActor(mob, dt, grids, worldOnly, () => null, (a) => g.inWater(a));
  const moving = speed > 0.01;
  const spider = mob.kind === 'spider' || mob.kind === 'cavespider';
  if (result.hitWall && moving) {
    if (spider) {
      // Spiders walk straight up walls, as in Minecraft.
      mob.vy = Math.max(mob.vy, 3.2);
      mob.onGround = false;
      mob.stuck = 0;
    } else if ((mob.onGround || g.inWater(mob)) && canStepUp(mob, dx, dz, grids)) {
      mob.vy = JUMP_V;
      mob.onGround = false;
    } else {
      mob.stuck += dt;
    }
  } else {
    mob.stuck = Math.max(0, mob.stuck - dt);
  }
  mob.walkPhase += Math.hypot(mob.vx, mob.vz) * dt * 1.6;
}

/** A blow wound up (arms raised) and landed if you are still in reach. */
export interface MeleeSpec {
  reach: number;
  windup: number;
  damage: number;
  knock: number;
  rest: number;
  effect?: EffectId;
  seconds?: number;
}

export function meleeTick(g: Game, mob: Actor, dt: number, m: MeleeSpec): void {
  const p = g.player;
  const dx = p.x - mob.x;
  const dz = p.z - mob.z;
  const d = Math.hypot(dx, dz) || 1;
  const inReach = !p.dead && !g.leap && d < m.reach && Math.abs(p.cy - mob.cy) < 1.5 + mob.h * 0.25;
  if (mob.windup > 0) {
    mob.windup -= dt;
    if (mob.windup <= 0) {
      mob.windup = 0;
      mob.attackTimer = m.rest;
      if (!p.dead && !g.leap && d < m.reach + 0.35 && Math.abs(p.cy - mob.cy) < 1.6 + mob.h * 0.25) damagePlayer(g, m.damage, (dx / d) * m.knock, (dz / d) * m.knock, m.effect, m.seconds ?? 0);
      else g.sfx('swing', 'wood', 0.25, 0.7);
    }
  } else if (inReach && mob.attackTimer <= 0.6) {
    mob.windup = m.windup;
    mob.actDur = m.windup;
    if (Math.random() < 0.5) monsterVoice(g, mob, 'attack');
  }
}

/** The classic horde: zombies (and their kin), skeletons and strays, creepers, spiders, wither skeletons. */
function classicMob(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): void {
  const p = g.player;
  const F = g.fortress;
  const c = g.fortressCentre();
  const dpx = p.x - mob.x;
  const dpz = p.z - mob.z;
  const distP = Math.hypot(dpx, dpz);
  const deck = onFortress(g, mob);
  const sameLevel = Math.abs(p.y - mob.y) < 3;
  const chasePlayer = !p.dead && !g.leap && distP < (mob.kind === 'witherskel' ? 14 : 11) && sameLevel;
  const archer = mob.kind === 'skeleton' || mob.kind === 'stray' || mob.kind === 'bogged';
  const spider = mob.kind === 'spider' || mob.kind === 'cavespider';
  let tx: number;
  let tz: number;
  let moving = true;
  let speedK = 1;
  if (mob.golden > 0) {
    // A golden creeper never fights: it runs from you, zig-zagging, sparkling.
    [tx, tz] = fleeFrom(g, mob);
    if (Math.random() < dt * 8) g.particles.sparks(mob.x, mob.y + 0.4 + Math.random() * 1.2, mob.z, ['#ffd23a', '#fff4b0'], 1, 1.2, 0.08, 0.6);
  } else if (archer && g.pet && !g.pet.a.dead && Math.hypot(g.pet.a.x - mob.x, g.pet.a.z - mob.z) < 6 && Math.abs(g.pet.a.y - mob.y) < 3) {
    // Skeletons are afraid of wolves (as in Minecraft): Pip sends them running.
    const wx = mob.x - g.pet.a.x;
    const wz = mob.z - g.pet.a.z;
    const l = Math.hypot(wx, wz) || 1;
    tx = mob.x + (wx / l) * 4;
    tz = mob.z + (wz / l) * 4;
    speedK = 1.35;
    mob.act = 'none';
    if (mob.voiceT > 1.5 && Math.random() < dt) monsterVoice(g, mob, 'hurt');
  } else if (archer && (!deck || distP < 26)) {
    [tx, tz, moving] = archerMove(g, mob, dt, distP, dpx, dpz);
  } else if (chasePlayer) {
    tx = p.x;
    tz = p.z;
  } else if (deck) {
    // On the deck: go for the Engine Core.
    const core = F.findBlock(B.CORE);
    const cc = core !== null ? F.cellCenter(kx(core), ky(core), kz(core)) : { x: c[0], y: 0, z: c[2] };
    tx = cc.x;
    tz = cc.z;
  } else {
    // On the ground: make for the nearest planted foot and climb it (a sapper creeper blows it up).
    const foot = nearestFoot(g, mob);
    if (foot.i >= 0 && g.phase === 'night') {
      const leg = g.walker.legs[foot.i]!;
      tx = leg.foot[0];
      tz = leg.foot[2];
      if (foot.d < 1.6 && !archer && mob.kind !== 'creeper') {
        mob.climb = { leg: foot.i, t: 0, swinging: false };
        if (spider) g.sfxAt('spider', mob.x, mob.y, mob.z, 0.8);
        g.crewSay('climbers');
        return;
      }
      if (mob.kind === 'creeper' && mob.tactic === 0 && foot.d < 1.6) {
        mob.climb = { leg: foot.i, t: 0, swinging: false };
        g.crewSay('climbers');
        return;
      }
    } else {
      tx = mob.homeX;
      tz = mob.homeZ;
      if (Math.hypot(tx - mob.x, tz - mob.z) < 2) moving = false;
    }
  }
  let dx = tx - mob.x;
  let dz = tz - mob.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  if (mob.kind === 'creeper' && mob.golden <= 0) {
    if (creeperFuse(g, mob, dt, deck, l, distP, dpx, dpz)) return;
    if (mob.fuse > 0) moving = false;
  } else if (!archer && mob.kind !== 'creeper') {
    if (deck) {
      const target = fortressCellNear(g, mob, 0.7);
      if (target !== null && !chasePlayer && mob.attackTimer <= 0) {
        mob.attackTimer = 1.0;
        damageFortressCell(g, target, (1.2 + g.danger * 0.35) * (mob.kind === 'witherskel' ? 1.6 : mob.baby ? 0.6 : 1));
        g.sfx('hit', 'wood', 0.5);
        if (Math.random() < 0.3) monsterVoice(g, mob, 'ambient');
      }
      if (target !== null && !chasePlayer) moving = false;
    }
    if (spider) spiderPounce(g, mob, dt, distP, dpx, dpz);
    const day = g.danger;
    if (mob.kind === 'witherskel') meleeTick(g, mob, dt, { reach: 1.7, windup: 0.28, damage: 4 + Math.floor(day / 2), knock: 6, rest: 1.1, effect: 'wither', seconds: 8 });
    else if (mob.kind === 'cavespider') meleeTick(g, mob, dt, { reach: 1.4, windup: 0.18, damage: 1 + Math.floor(day / 3), knock: 3, rest: 0.9, effect: 'poison', seconds: 6 });
    else if (mob.kind === 'spider') meleeTick(g, mob, dt, { reach: 1.6, windup: 0.2, damage: 2 + Math.floor(day / 2), knock: 5, rest: 1 });
    else if (mob.kind === 'husk') meleeTick(g, mob, dt, { reach: 1.25, windup: 0.32, damage: 2 + Math.floor(day / 2), knock: 5, rest: 1, effect: 'hunger', seconds: 10 });
    else meleeTick(g, mob, dt, { reach: mob.baby ? 1.0 : 1.2, windup: mob.baby ? 0.22 : 0.32, damage: (mob.baby ? 1 : 2) + Math.floor(day / 2), knock: 5, rest: mob.baby ? 0.7 : 1 });
  }
  // A drowned throws its trident from a few blocks off (and stands to throw).
  if (mob.kind === 'drowned' && drownedThrow(g, mob, dt, distP)) moving = false;
  if (!(archer && !p.dead && distP < 26)) mob.yaw = Math.atan2(dz, dx);
  const speed = moving ? mob.speed * speedK * (g.inWeb(mob) ? 0.3 : 1) : 0;
  // Mid-pounce a spider keeps its leap.
  walkStep(g, mob, dx, dz, speed, dt, grids, worldOnly, spider && !mob.onGround && mob.attackTimer > 1.2);
}

/**
 * A skeleton (or a stray) keeps its distance and circles you (strafing, as since Minecraft 1.9),
 * backs off when you close in, and draws its bow before each shot: the string comes back, the
 * arrow is nocked, then it looses. Strays tip theirs with slowness.
 */
function archerMove(g: Game, mob: Actor, dt: number, distP: number, dpx: number, dpz: number): [number, number, boolean] {
  const p = g.player;
  const d3 = Math.hypot(dpx, p.y - mob.y, dpz);
  if (p.dead || d3 > 26) {
    const c = g.fortressCentre();
    return [c[0], c[2], true];
  }
  mob.strafeT -= dt;
  if (mob.strafeT <= 0) {
    mob.strafeT = 1.6 + Math.random() * 2.4;
    if (Math.random() < 0.6) mob.strafe = -mob.strafe;
  }
  const want = 12;
  const ux = dpx / (distP || 1);
  const uz = dpz / (distP || 1);
  const close = d3 < 6;
  const k = close ? -1.2 : d3 > want + 3 ? 1 : d3 < want - 3 ? -0.6 : 0;
  // Sideways while drawing, so it is never a sitting target.
  const side = mob.act === 'draw' ? 0.55 : 0.8;
  const tx = mob.x + ux * k - uz * mob.strafe * side;
  const tz = mob.z + uz * k + ux * mob.strafe * side;
  mob.yaw = Math.atan2(dpz, dpx);
  const sight = (): boolean => hasLineOfSight(g, mob.x, mob.y + mob.h * 0.8, mob.z, p.x, p.y + 1.4, p.z);
  if (mob.act === 'draw') {
    mob.actT += dt;
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      mob.shootTimer = 1.3 + Math.random() * 0.9;
      if (sight()) {
        const fx = Math.cos(mob.yaw);
        const fz = Math.sin(mob.yaw);
        shootArrow(g, mob.x + fx * 0.5, mob.y + mob.h * 0.78, mob.z + fz * 0.5, p.x, p.y + 1.1, p.z, mob.kind === 'stray' ? 'slowness' : mob.kind === 'bogged' ? 'poison' : undefined, mob);
      }
    }
  } else if (mob.shootTimer <= 0 && d3 < 24 && sight()) {
    mob.act = 'draw';
    mob.actT = 0;
    mob.actDur = Math.max(0.55, 1 - g.danger * 0.06);
  }
  return [tx, tz, true];
}

/**
 * A creeper's fuse (Minecraft's: it hisses within three blocks of you and goes off a second and a
 * half later, unless you get well clear). A sapper lights it at a fortress foot: the blast wrecks
 * the leg. A charged creeper (struck by lightning) blows twice as big. Returns true if it went off.
 */
function creeperFuse(g: Game, mob: Actor, dt: number, deck: boolean, distTarget: number, distP: number, dpx: number, dpz: number): boolean {
  const p = g.player;
  const dy = p.cy - mob.cy;
  const nearPlayer = !p.dead && Math.hypot(dpx, dy, dpz) < 2.8;
  const nearCore = deck && fortressCellNear(g, mob, 1.3) !== null && distTarget < 4;
  const foot = !deck && mob.tactic === 1 ? nearestFoot(g, mob) : null;
  const atFoot = foot !== null && foot.i >= 0 && foot.d < 2.1 && g.phase === 'night';
  if (nearPlayer || nearCore || atFoot) {
    if (mob.fuse === 0) {
      g.sfxAt('fuse', mob.x, mob.y, mob.z, 1);
      if (atFoot) g.crewSay('sapper');
    }
    mob.fuse += dt;
  } else if (mob.fuse > 0) {
    // Out of reach (Minecraft: seven blocks): the fuse goes out, slowly.
    const far = Math.hypot(dpx, dy, dpz) > 7 || !nearPlayer;
    if (far) mob.fuse = Math.max(0, mob.fuse - dt * 0.7);
  }
  if (mob.charged && Math.random() < dt * 3) g.particles.sparks(mob.x, mob.y + Math.random() * mob.h, mob.z, ['#9fe4ff', '#ffffff'], 1, 1.5, 0.06, 0.25);
  if (mob.fuse < 1.5) return false;
  mob.dead = true;
  const k = mob.charged ? 2 : 1;
  explode(g, mob.x, mob.y + 0.8, mob.z, { radius: 3.4 * (mob.charged ? 1.6 : 1), fortress: 26 * k, giant: 6 * k, mob: 14 * k, player: 13 * k, terrain: 2.6 * (mob.charged ? 1.5 : 1) });
  if (atFoot && foot) {
    damageLeg(g, foot.i, 0.32 * k);
    g.renderer.shake(0.5);
    g.toast(mob.charged ? 'A CHARGED creeper blew a leg!' : 'A creeper blew up at a leg!');
  }
  if (mob.charged) {
    g.particles.ring(mob.x, mob.y + 1, mob.z, 8, 0.6, 0.9, 1);
    g.sfxAt('charged', mob.x, mob.y, mob.z, 1);
  }
  return true;
}

/** A spider crouches (a beat to see it coming), hisses, and pounces at you from a few blocks off. */
function spiderPounce(g: Game, mob: Actor, dt: number, distP: number, dpx: number, dpz: number): void {
  const p = g.player;
  if (mob.act === 'pounce') {
    mob.actT += dt;
    mob.vx *= 0.8;
    mob.vz *= 0.8;
    if (mob.actT >= mob.actDur) {
      mob.act = 'none';
      if (p.dead || g.leap) return;
      const d = Math.hypot(dpx, dpz) || 1;
      mob.attackTimer = 1.6;
      mob.vy = 6.5;
      mob.vx = (dpx / d) * 7.5;
      mob.vz = (dpz / d) * 7.5;
      mob.onGround = false;
      mob.standingOn = null;
      g.sfxAt('spider', mob.x, mob.y, mob.z, 0.8, 1.1);
    }
    return;
  }
  if (mob.onGround && !p.dead && !g.leap && distP < 4.8 && distP > 1.6 && Math.abs(p.y - mob.y) < 2 && mob.attackTimer <= 0) {
    mob.act = 'pounce';
    mob.actT = 0;
    mob.actDur = mob.kind === 'cavespider' ? 0.2 : 0.3;
  }
}

export function updateMobs(g: Game, dt: number): void {
  const grids = g.grids();
  const worldOnly = [grids[0]!];
  const c = g.fortressCentre();
  const two = g.players().length > 1;
  for (const mob of g.mobs) {
    if (mob.dead) continue;
    // With two players, each monster goes after the nearer one (its AI sees that one as "you").
    if (two) g.withCtx(g.hunted(mob.x, mob.z), () => thinkMob(g, mob, dt, grids, worldOnly, c));
    else thinkMob(g, mob, dt, grids, worldOnly, c);
  }
  // Riders sit on their mounts wherever those went this step.
  for (const mob of g.mobs) {
    const base = mob.mount;
    if (!base || mob.dead) continue;
    if (base.dead) {
      mob.mount = null;
      continue;
    }
    mob.x = base.x;
    mob.y = base.y + seatOf(base);
    mob.z = base.z;
    mob.vx = base.vx;
    mob.vy = 0;
    mob.vz = base.vz;
    mob.standingOn = base.standingOn;
    mob.onGround = true;
    mob.climb = null;
  }
  g.mobs = g.mobs.filter((m) => !m.dead);
}

function thinkMob(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[], c: [number, number, number]): void {
  const p = g.player;
  mob.hurt = Math.max(0, mob.hurt - dt);
  mob.attackTimer -= dt;
  mob.shootTimer -= dt;
  mob.voiceT -= dt;
  if (mob.sear > 0) {
    mob.sear -= dt;
    // (Poison or flame from your blade: a little harm, every fifth of a second.)
    if (Math.floor(mob.sear * 5) !== Math.floor((mob.sear + dt) * 5)) {
      damageMob(g, mob, 1.2, 0, 0, 'player');
      g.particles.sparks(mob.x, mob.cy, mob.z, mob.searFire ? ['#ff8a20', '#ffd040'] : ['#7ad040', '#3a8a2a'], 2, 1.5, 0.06, 0.3);
      if (mob.dead) return;
    }
  }
  if (mob.burn > 0) {
    mob.burn -= dt;
    // Husks crumble to sand and wither skeletons to ash; the rest catch fire.
    if (Math.random() < 0.3) {
      if (mob.kind === 'husk') g.particles.debris(mob.x, mob.y + Math.random() * mob.h, mob.z, 'sand', 1, 1.2, 0.1, 0.6);
      else if (mob.kind === 'witherskel' || mob.kind === 'wither') g.particles.smoke(mob.x, mob.y + Math.random() * mob.h, mob.z, 1, 0.5, true);
      else g.particles.sparks(mob.x, mob.y + Math.random() * mob.h, mob.z, ['#ff8a20', '#ffd040'], 1, 1.5, 0.12, 0.5);
    }
    if (mob.burn <= 0) killMob(g, mob, false);
    if (mob.dead) return;
  }
  if (mob.voiceT <= 0) {
    mob.voiceT = 4 + Math.random() * 7;
    if (g.nearestDist(mob.x, mob.z) < 26) monsterVoice(g, mob, 'ambient');
  }
  watch(g, mob, dt);
  if (mob.kind === 'phantom' && mob.fly) {
    updatePhantom(g, mob, dt);
    return;
  }
  // Reeling from the war horn: no chasing, no blows; it tumbles where the blast threw it.
  if (mob.stun > 0 && !mob.flying) {
    mob.stun -= dt;
    const k = mob.onGround ? Math.max(0, 1 - dt * 5) : 1;
    mob.vx *= k;
    mob.vz *= k;
    mob.wantJump = false;
    mob.fuse = 0;
    mob.act = mob.act === 'stunned' ? 'stunned' : 'none';
    if (mob.mount) {
      mob.mount.rider = null;
      mob.mount = null;
    }
    moveActor(mob, dt, grids, worldOnly, () => null, (a) => g.inWater(a));
    if (Math.random() < dt * 5) g.particles.sparks(mob.x, mob.y + mob.h + 0.2, mob.z, ['#ffe070', '#ffffff'], 1, 1.2, 0.06, 0.4);
    if (mob.y < -5) mob.dead = true;
    return;
  }
  if (mob.stun > 0) mob.stun -= dt;
  // Endermen, witches, slimes, illagers, ghasts and the Wither think for themselves.
  if (specialMob(g, mob, dt, grids, worldOnly)) {
    if (mob.y < -5) mob.dead = true;
    return;
  }
  // A rider sits on its mount (it still looks about and shoots).
  if (mob.mount) {
    if (mob.kind === 'skeleton' || mob.kind === 'stray' || mob.kind === 'bogged') {
      const dpx = p.x - mob.x;
      const dpz = p.z - mob.z;
      archerMove(g, mob, dt, Math.hypot(dpx, dpz), dpx, dpz);
    }
    return;
  }
  if (mob.climb) {
    climbLeg(g, mob, dt);
    return;
  }
  classicMob(g, mob, dt, grids, worldOnly);
  // Out of everyone's way (far from every player and the fortress): it wanders off for good.
  if ((Math.hypot(mob.x - c[0], mob.z - c[2]) > 110 && g.nearestDist(mob.x, mob.z) > 90 && !mob.boss && mob.raid < 0) || mob.y < -5) mob.dead = true;
}

/** Moving bodies shove (and can crush) actors in their way. Villagers, Pip and the farm animals are only ever shoved. */
export function resolveBodyPushes(g: Game): void {
  const actors: Actor[] = [g.player, ...g.mobs, ...g.villagers, ...g.animals];
  if (g.pet) actors.push(g.pet.a);
  const bodies = [g.fortress, ...g.giants.filter((gi) => !gi.dead).map((gi) => gi.body)];
  const world = worldGrid(g.world);
  for (const actor of actors) {
    if (actor.dead || (actor === g.player && (g.leap || g.overSide)) || actor.climb || actor.flying || actor.mount) continue;
    for (const body of bodies) {
      if (actor.standingOn === body) continue;
      // Shoved the way the hull moved where it touches (a turning hull sweeps its ends sideways).
      const [mx, , mz] = body.motionAt(actor.x, actor.cy, actor.z);
      const push = depenetrate(actor, bodyGrid(body), Math.abs(mx) > 1e-4 ? Math.sign(mx) : 0, Math.abs(mz) > 1e-4 ? Math.sign(mz) : 0);
      if (!push) continue;
      actor.x += push.dx;
      actor.y += push.dy;
      actor.z += push.dz;
      if (push.dy > 0) {
        actor.standingOn = body;
        actor.onGround = true;
        actor.vy = 0;
      }
      if (overlaps(actor, world)) {
        actor.y += 1;
        if (actor.kind === 'player') damagePlayer(g, 2, 0, 0);
        else if (hostile(actor)) damageMob(g, actor, 4, 0, 0);
      }
    }
  }
}

/** Monsters (the things you fight), as opposed to villagers, Pip and the farm animals. */
export function hostile(a: Actor): boolean {
  return a.kind !== 'player' && a.kind !== 'villager' && a.kind !== 'wolf' && a.kind !== 'chicken' && a.kind !== 'sheep';
}

// ------------------------------------------------------------------ castles

/** Who keeps an old castle: the land decides (husks in the sand, strays in the snow, wither skeletons in the blight). */
function guardKind(zone: Zone, i: number): ActorKind {
  const slot = i % 3;
  if (zone === 'blight') return slot === 0 ? 'skeleton' : 'witherskel';
  if (zone === 'snow') return slot === 0 ? 'stray' : slot === 1 ? 'zombie' : 'stray';
  if (zone === 'desert') return slot === 0 ? 'skeleton' : 'husk';
  return slot === 0 ? 'skeleton' : slot === 1 ? 'zombie' : 'husk';
}

/** Ruins are guarded: monsters gather in a castle the first time you come close by day. */
export function updateCastleGuards(g: Game): void {
  for (const s of g.world.terrain.castles) {
    if (g.guarded.has(s.name)) continue;
    if (g.nearestDist(s.x, s.z) > 44) continue;
    if (!g.world.chunkAt(s.x, s.z)) continue;
    g.guarded.add(s.name);
    const n = 3 + Math.min(4, Math.round(g.danger));
    const zone = zoneAt(g, s.x, s.z);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const mob = spawnMob(g, guardKind(zone, i), s.x + Math.cos(a) * 5, s.z + Math.sin(a) * 5);
      if (mob) {
        mob.homeX = s.x;
        mob.homeZ = s.z;
        if ((mob.kind === 'zombie' || mob.kind === 'husk') && g.danger >= 2 && Math.random() < 0.4) {
          mob.armor = Math.random() < 0.5 ? 2 : 1;
          mob.armorHp = mob.armor === 2 ? 22 : 10;
        }
      }
    }
    g.toast(`${s.name}: the ruins are guarded!`);
  }
}

// ------------------------------------------------------------------ villagers & crew

/** Villagers move into the buildings of villages that stream in. */
export function populateVillages(g: Game): void {
  for (const v of g.world.terrain.villages) {
    if (g.populated.has(v.index)) continue;
    if (!g.world.chunkAt(v.x, v.z)) continue;
    g.populated.add(v.index);
    for (const s of g.world.structures.all) {
      if (s.site !== v || g.world.hoisted.has(s.id)) continue;
      for (const spot of s.villagers) addVillager(g, s, spot.x, spot.y, spot.z);
    }
    // The village trader keeps a stall by the well.
    const well = g.world.structures.byId.get(`v${v.index}:well`);
    if (well) {
      const x = well.maxX + 2.5;
      const z = (well.minZ + well.maxZ + 1) / 2;
      const t = new Actor('villager', x, g.world.groundAt(x, z), z);
      t.trader = true;
      t.role = 'trader';
      t.region = v.index;
      t.home = well.id;
      t.homeX = x;
      t.homeZ = z;
      g.villagers.push(t);
    }
    // Hens round the farms, sheep on the meadows; golems, camels and frogs in the new lands.
    spawnVillageAnimals(g, v);
    spawnVillageFolk(g, v);
    spawnVillageOfficer(g, v);
  }
}

function addVillager(g: Game, s: Structure, x: number, y: number, z: number): void {
  const v = new Actor('villager', x, y, z);
  v.region = s.site.index;
  v.home = s.id;
  v.role = s.kind === 'smithy' ? 'smith' : s.kind === 'farm' || s.kind === 'windmill' ? 'farmer' : 'villager';
  v.idleTimer = Math.random() * 2;
  g.villagers.push(v);
}

export function updateVillagers(g: Game, dt: number): void {
  const grids = g.grids(true, false);
  const worldOnly = [grids[0]!];
  const p = g.player;
  for (const v of [...g.villagers]) {
    // (Golems and officers aboard keep their own watch: see folk.ts and company.ts.)
    if (v.boarded) continue;
    v.hurt = Math.max(0, v.hurt - dt);
    let dx = 0;
    let dz = 0;
    if (v.recruited) {
      // Walk to the foot of the boarding ladder.
      const ladder = g.ladderFoot();
      dx = ladder[0] - v.x;
      dz = ladder[2] - v.z;
      const l = Math.hypot(dx, dz);
      if (l < 1.8 || v.stuck > 6 || l > 90) {
        board(g, v, v.stuck > 6 || l > 90);
        continue;
      }
      dx /= l;
      dz /= l;
    } else if (v.trader || v.captive) {
      // Traders mind their stall and captives their pen: they just watch you.
      if (Math.hypot(p.x - v.x, p.z - v.z) < 7) v.yaw = Math.atan2(p.z - v.z, p.x - v.x);
    } else {
      v.idleTimer -= dt;
      if (v.idleTimer <= 0) {
        v.idleTimer = 1.5 + Math.random() * 2.5;
        v.wandering = Math.random() < 0.55;
        v.wanderYaw = Math.random() * Math.PI * 2;
        if (Math.hypot(v.x - v.homeX, v.z - v.homeZ) > 4) v.wanderYaw = Math.atan2(v.homeZ - v.z, v.homeX - v.x);
      }
      if (v.wandering) {
        dx = Math.cos(v.wanderYaw);
        dz = Math.sin(v.wanderYaw);
      }
      if (Math.hypot(p.x - v.x, p.z - v.z) < 4 && !v.wandering) v.yaw = Math.atan2(p.z - v.z, p.x - v.x);
    }
    if (dx !== 0 || dz !== 0) v.yaw = Math.atan2(dz, dx);
    const speed = v.recruited ? v.speed : 0.9;
    v.vx = approach(v.vx, dx * speed, 14 * dt);
    v.vz = approach(v.vz, dz * speed, 14 * dt);
    v.wantJump = false;
    const result = moveActor(v, dt, grids, worldOnly, () => null, (a) => g.inWater(a));
    if (result.hitWall && v.onGround && (dx !== 0 || dz !== 0)) {
      if (canStepUp(v, dx, dz, grids)) {
        v.vy = JUMP_V;
        v.onGround = false;
      } else {
        v.stuck += dt;
        if (!v.recruited) v.wanderYaw += Math.PI;
      }
    }
    if (v.recruited && Math.hypot(v.vx, v.vz) < 0.2) v.stuck += dt;
    v.walkPhase += Math.hypot(v.vx, v.vz) * dt * 1.6;
    if (g.nearestDist(v.x, v.z) > 160 && !v.recruited) {
      g.villagers = g.villagers.filter((o) => o !== v);
      // Its village fills up again when it next streams in.
      if (v.trader && v.kind !== 'npc') g.populated.delete(v.region);
    }
  }
}

export function recruit(g: Game, v: Actor): void {
  if (v.recruited) return;
  if (v.kind === 'npc') {
    talkTo(g, v);
    return;
  }
  if (v.trader) {
    visitTrader(g, v.region);
    return;
  }
  if (v.captive) {
    g.deny('Defeat the camp guards first');
    return;
  }
  if (v.freed) {
    freeCaptive(g, v);
    return;
  }
  if (g.crew + g.villagers.filter((o) => o.recruited).length >= crewCapacity(g)) {
    g.deny('No free bunks! Hoist a house onto the fortress');
    return;
  }
  v.recruited = true;
  v.vy = 5;
  v.onGround = false;
  g.flags.recruited += 1;
  g.particles.sparks(v.x, v.y + 2.2, v.z, ['#ffe070', '#9cff7a'], 8, 2, 0.08, 0.6);
  g.sfx('recruit');
  g.toast('Villager recruited! Heading to your fortress', 'ui_villager');
  g.xp(6);
  g.villagerReact('recruit', v.x, v.z, v);
}

export function board(g: Game, v: Actor, teleport: boolean): void {
  g.villagers = g.villagers.filter((other) => other !== v);
  g.crew += 1;
  g.crewRoles.push(v.role);
  if (teleport) g.particles.smoke(v.x, v.cy, v.z, 6, 1);
  g.sfx('recruit');
  g.toast(`Crew ${g.crew}: villagers man the cannons`, 'ui_villager');
  g.crewPostsVersion = -1;
}

export function updateCrewPosts(g: Game): void {
  const F = g.fortress;
  if (g.crewPostsVersion === F.version) return;
  g.crewPostsVersion = F.version;
  const posts: Game['crewPosts'] = [];
  const used = new Set<number>();
  const free = (x: number, y: number, z: number): boolean => !F.solidAt(x, y, z) && !F.solidAt(x, y + 1, z) && F.solidAt(x, y - 1, z) && !used.has(key3(x, y, z));
  const cannons = [...F.cells.entries()].filter(([, cell]) => TURRET_IDS.has(cell.id)).map(([key]) => key);
  cannons.sort((a, b) => Number(turretReady(F, b)) - Number(turretReady(F, a)));
  for (const key of cannons) {
    const [x, y, z] = [kx(key), ky(key), kz(key)];
    // Gunners stand beside the breech, leaving the spot behind the cannon for you.
    for (const [dx, dz] of [[0, 1], [0, -1], [-1, 1], [-1, -1], [-1, 0], [1, 0]] as const) {
      if (!free(x + dx, y, z + dz)) continue;
      used.add(key3(x + dx, y, z + dz));
      posts.push({ x: x + dx, y, z: z + dz, cannon: key });
      break;
    }
  }
  const core = F.findBlock(B.CORE);
  const cx = core === null ? 7 : kx(core);
  const cz = core === null ? 5 : kz(core);
  const floor: Array<{ x: number; y: number; z: number; d: number }> = [];
  for (let y = F.minY; y <= F.maxY + 1; y += 1) {
    for (let z = F.minZ; z <= F.maxZ; z += 1) {
      for (let x = F.minX; x <= F.maxX; x += 1) {
        if (free(x, y, z) && blockDef(F.blockAt(x, y - 1, z)).solid) floor.push({ x, y, z, d: Math.abs(x - cx) + Math.abs(z - cz) + y * 0.1 });
      }
    }
  }
  floor.sort((a, b) => a.d - b.d);
  for (const s of floor.slice(0, 40)) posts.push({ x: s.x, y: s.y, z: s.z, cannon: null });
  g.crewPosts = posts;
}

export function updateCrew(g: Game, dt: number): void {
  if (g.crew <= 0) return;
  const F = g.fortress;
  updateCrewPosts(g);
  // A player on the guns (co-op) has the turrets: the crew turns to repairs instead.
  const manned = g.players().some((ctx) => ctx.gunner && !ctx.player.dead);
  let gunners = 0;
  for (let i = 0; i < Math.min(g.crew, g.crewPosts.length); i += 1) {
    const post = g.crewPosts[i]!;
    if (manned || post.cannon === null || !turretReady(F, post.cannon)) continue;
    gunners += 1;
    const state = F.cannons.get(post.cannon);
    const kind = turretKind(F, post.cannon);
    if (!state || !kind || g.phase !== 'night') continue;
    // Rallied by the war horn, the gun crews load twice as fast.
    const timer = (g.crewTimers.get(post.cannon) ?? Math.random() * 2) - dt * (g.rally > 0 ? 2 : 1);
    if (timer > 0) {
      g.crewTimers.set(post.cannon, timer);
      continue;
    }
    if (usesTnt(kind) && state.ammo <= 0) {
      // Crews restock from the hold when they can, but leave the captain a few to fire and throw.
      if (g.count(I.TNT) > CREW_RESERVE) {
        g.useItem(I.TNT, 1);
        state.ammo += 1;
      } else {
        g.crewTimers.set(post.cannon, 1);
        continue;
      }
    }
    const target = autoTarget(g, post.cannon, turretRange(kind));
    const spread = kind === 'ballista' ? 0.4 : 1.5;
    const shot = target ? planShot(F, post.cannon, target.x + (Math.random() - 0.5) * spread, target.y, target.z + (Math.random() - 0.5) * spread) : null;
    if (shot) {
      if (usesTnt(kind)) state.ammo -= 1;
      launchShot(g, post.cannon, shot, true);
      g.crewTimers.set(post.cannon, kind === 'ballista' ? 1.4 : kind === 'mortar' ? 5 : 3.6);
    } else {
      g.crewTimers.set(post.cannon, 0.6);
    }
  }
  const spare = g.crew - gunners;
  if (spare <= 0) return;
  // Spare hands mend a damaged leg first, then the most damaged blocks (smiths twice as fast; a beacon doubles it again).
  const smithy = (1 + cargoPower(g, 'smithy')) * (g.rally > 0 ? 2 : 1) * (g.beacon ? 2 : 1) * (hasTrophy(g, 'frost') ? 1.5 : 1);
  let leg = -1;
  let legDamage = 0.15;
  g.walker.legs.forEach((l, i) => {
    if (l.damage > legDamage) {
      legDamage = l.damage;
      leg = i;
    }
  });
  if (leg >= 0) {
    repairLeg(g, leg, spare * 0.012 * smithy * dt);
    return;
  }
  let worst: number | null = null;
  let worstRatio = 1;
  for (const [key, cell] of F.cells) {
    const ratio = cell.hp / cell.maxHp;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = key;
    }
  }
  if (worst !== null) {
    const cell = F.cells.get(worst)!;
    cell.hp = Math.min(cell.maxHp, cell.hp + spare * 0.7 * smithy * dt);
  }
}

// ------------------------------------------------------------------ legs

/** Wear on one of the fortress's legs (climbers, blasts, giant fists); it limps when they fail. */
export function damageLeg(g: Game, index: number, amount: number): void {
  const l = g.walker.legs[index];
  if (!l || amount <= 0) return;
  // (The Brood Queen's silk binds them.)
  if (hasTrophy(g, 'queen')) amount *= 0.65;
  const before = l.damage;
  l.damage = Math.min(1, l.damage + amount);
  // Warnings as it gives way.
  if (before < 0.5 && l.damage >= 0.5) {
    g.sfx('legdamage', 'metal', 0.9);
    g.toast('A leg is buckling! The fortress slows');
  } else if (before < 1 && l.damage >= 1) {
    g.sfx('legdamage', 'metal', 1);
    g.ui.banner('LEG WRECKED!', 'The fortress limps: repair it with iron', 'danger');
  } else if (amount > 0.08) {
    g.sfx('legdamage', 'metal', 0.6);
  }
}

export function repairLeg(g: Game, index: number, amount: number): void {
  const l = g.walker.legs[index];
  if (!l) return;
  l.damage = Math.max(0, l.damage - amount);
}
