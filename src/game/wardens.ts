// What guards each wreck (the main quest's six "wardens"): the Hollow Strider that the Heart raised out
// of the Bramble's dead legs, the Pharaoh Husk in the Sun Pyramid's vault, the Bog Hag of the Black
// Lagoon (alive while her cauldrons stand), the outlaws' Evoker Warlord, the Yeti of Frostpeak and
// the Forge Golem Veyra left at her forge. Each wakes when you come to its place; beat it and the
// captain's chest it guards opens. Walk away and it goes back to waiting, whole.
import { B, I } from './blocks';
import { explode } from './combat';
import { addEffect } from './effects';
import { Actor, type ActorKind } from './entities';
import { feat } from './feats';
import type { Game } from './game';
import { createGiant, type Giant } from './giants';
import { EXPEDITIONS, crestChest, wardenBeaten, wardenSpot, type WardenKind } from './mainquest';
import type { Vec3 } from './math3d';
import { damagePlayer, killMob, scaleHealth, spawnMob, walkStep } from './mobs';
import { raider, throwPotion } from './monsters';
import type { Grid } from './physics';
import { clamp } from './rng';
import { covenHuts, FORT_CAGES } from './landmarks';
import { rotXZ } from './structures';
import { CINDER, type ExpeditionSite } from './terrain';
import { spawnCaged } from './company';
import { landMetal } from './gear';

export interface WardenState {
  /** The expedition it guards. */
  exp: number;
  kind: WardenKind;
  stage: 'rise' | 'fight' | 'dying';
  t: number;
  mob: Actor | null;
  giant: Giant | null;
  /** Its health when it rose (its bar is measured against it). */
  maxHp: number;
  /** Move cooldowns, and the thresholds of health it has passed. */
  cd: number[];
  phase: number;
  /** Seconds since it last took harm (see keepInFight). */
  calm: number;
  lastHp: number;
  /** (A co-op mate's copy: its bar as the host has it.) */
  pct?: number;
}

const TITLES: Record<WardenKind, string> = {
  hollow: 'THE HOLLOW STRIDER',
  pharaoh: 'THE PHARAOH HUSK',
  hag: 'THE BOG HAG',
  warlord: 'THE EVOKER WARLORD',
  yeti: 'THE YETI OF FROSTPEAK',
  forgegolem: 'THE FORGE GOLEM',
};

const TNT_G = 9.8;

/** What a captive of the outlaws' fort has for a village (they belong to none: see freeCaptive). */
export const CAPTIVE = -3;

// ------------------------------------------------------------------ waking

/** How near you (or the fortress) must come to an expedition's place for its warden to wake. */
function woken(g: Game, e: ExpeditionSite): boolean {
  const p = g.player;
  const [sx, sy, sz] = wardenSpot(g, e);
  const dp = Math.hypot(p.x - sx, p.z - sz);
  switch (e.id) {
    case 'meadow':
      return dp < 30;
    case 'pyramid':
      // In the vault itself.
      return Math.abs(p.x - e.x - 0.5) < 8 && Math.abs(p.z - e.z - 0.5) < 8 && p.y < e.y + 9 && p.y > e.y - 1;
    case 'lagoon':
      return Math.hypot(p.x - e.x, p.z - e.z) < 44;
    case 'fort':
      // The guards are down (they turned out when you came), or you walked into his hall.
      return (g.guarded.has(`x${e.index}`) && !g.mobs.some((m) => !m.dead && m.guardOf === `x${e.index}`)) || (dp < 7 && Math.abs(p.y - sy) < 4);
    case 'frostpeak':
      return dp < 34 && p.y > e.y + 14;
    case 'cinder':
      return dp < 26 && p.y > e.y + CINDER.lake - 8;
    default:
      return false;
  }
}

/** Per step (the host's world): wardens wake, fight, fall; the fort's guards turn out. */
export function updateWardens(g: Game, dt: number): void {
  const T = g.world.terrain;
  if (T.expeditions.length === 0 || g.coopGuest) return;
  if (g.phase !== 'day' && g.phase !== 'night') return;
  updateFortGuards(g);
  const ws = g.warden;
  if (ws) {
    const e = T.expeditions[ws.exp]!;
    const p = g.player;
    const [fx, , fz] = g.fortressCentre();
    // Everyone gone far away: it goes back to its post, whole (it wakes again when you return).
    if (ws.stage !== 'dying' && Math.hypot(p.x - e.x, p.z - e.z) > e.r * 1.7 + 40 && Math.hypot(fx - e.x, fz - e.z) > e.r * 1.7 + 40) {
      wardenLeave(g, ws);
      g.warden = null;
      g.toast(`${EXPEDITIONS[ws.exp]!.wardenName} goes back to waiting`);
      return;
    }
    ws.t += dt;
    for (let i = 0; i < ws.cd.length; i += 1) ws.cd[i] = ws.cd[i]! - dt;
    if (ws.stage === 'rise' && ws.t > 2.2) {
      ws.stage = 'fight';
      ws.t = 0;
    }
    if (ws.stage === 'fight') {
      wardenMoves(g, ws, e, dt);
      if (!wardenAlive(ws)) {
        ws.stage = 'dying';
        ws.t = 0;
        const at = wardenAt(ws);
        g.renderer.shake(0.8);
        g.sfxAt('bossdeath', at[0], at[1], at[2], 1);
      }
    } else if (ws.stage === 'dying' && ws.t > 2) {
      g.warden = null;
      wardenFalls(g, ws.exp);
    }
    return;
  }
  // A warden wakes: at its place, its crest still sealed in, and not on a night it already fought.
  T.expeditions.forEach((e) => {
    if (g.warden || wardenBeaten(g, e.index)) return;
    if (!g.mq.reached.includes(e.index)) return;
    if (!woken(g, e)) return;
    wakeWarden(g, e);
  });
}

function wakeWarden(g: Game, e: ExpeditionSite): void {
  const info = EXPEDITIONS[e.index]!;
  const ws: WardenState = { exp: e.index, kind: info.warden, stage: 'rise', t: 0, mob: null, giant: null, maxHp: 1, cd: [3, 6, 9, 12, 15], phase: 0, calm: 0, lastHp: 0 };
  riseWarden(g, ws, e);
  g.warden = ws;
  g.ui.banner(TITLES[ws.kind], info.wardenHow, 'danger');
  g.sfx('horn', 'stone', 0.9, 0.7);
  g.renderer.shake(0.5);
  g.crewSay('guardian');
}

/** It rises: a giant raised out of the wreck, or a creature grown monstrous. */
function riseWarden(g: Game, ws: WardenState, e: ExpeditionSite): void {
  const danger = g.danger;
  const [sx, sy, sz] = wardenSpot(g, e);
  const p = g.player;
  const boss = (kind: ActorKind, x: number, y: number, z: number, scale: number, hp: number): Actor => {
    const mob = new Actor(kind, x, y, z);
    mob.resize(scale);
    mob.maxHp = Math.round(hp);
    mob.hp = mob.maxHp;
    mob.boss = TITLES[ws.kind];
    mob.warden = ws.kind;
    mob.homeX = x;
    mob.homeZ = z;
    g.mobs.push(mob);
    ws.mob = mob;
    ws.maxHp = mob.maxHp;
    ws.lastHp = mob.hp;
    return mob;
  };
  let burst: Vec3 = [sx, sy, sz];
  switch (ws.kind) {
    case 'hollow': {
      // Out of the wreck's side, toward the fortress.
      const [fx, , fz] = g.fortressCentre();
      const dx = fx - sx;
      const dz = fz - sz;
      const l = Math.hypot(dx, dz) || 1;
      const x = sx + (dx / l) * 10;
      const z = sz + (dz / l) * 10;
      const giant = createGiant('hollow', x, z, g.world.groundAt(x, z), 2.6 + danger * 0.25, dx / l, dz / l);
      giant.guardian = true;
      giant.walker.layout(giant.body, g.world);
      g.giants.push(giant);
      ws.giant = giant;
      const heart = giant.body.findBlock(B.GIANT_HEART);
      ws.maxHp = heart !== null ? giant.body.cells.get(heart)!.maxHp : 1;
      burst = [x, g.world.groundAt(x, z), z];
      break;
    }
    case 'pharaoh': {
      const mob = boss('husk', sx, sy, sz - 0, 2.4, 300 + danger * 22);
      mob.speed *= 0.95;
      break;
    }
    case 'hag': {
      const [hx, hy, hz] = hutRoof(e, 0);
      boss('witch', hx, hy, hz, 2.1, 230 + danger * 20);
      burst = [hx, hy, hz];
      break;
    }
    case 'warlord': {
      const mob = boss('evoker', sx, sy, sz, 1.7, 240 + danger * 20);
      mob.raid = -1;
      mob.captain = false;
      break;
    }
    case 'yeti': {
      // Down the slope above you.
      const a = Math.atan2(p.z - sz, p.x - sx);
      const x = sx + Math.cos(a) * 4;
      const z = sz + Math.sin(a) * 4;
      boss('polarbear', x, g.world.groundAt(x, z) + 0.2, z, 3, 320 + danger * 24);
      burst = [x, g.world.groundAt(x, z), z];
      break;
    }
    case 'forgegolem': {
      boss('golem', sx, sy, sz, 2.8, 420 + danger * 26);
      break;
    }
    default:
      break;
  }
  const [bx, by, bz] = burst;
  for (let k = 0; k < 4; k += 1) g.particles.dust(bx + (Math.random() - 0.5) * 6, by + 0.5, bz + (Math.random() - 0.5) * 6, 16, 4, false);
  g.particles.ring(bx, by + 1, bz, 8, 0.4, 1, 0.55);
  g.particles.sparks(bx, by + 2, bz, ['#4cff8a', '#b8ffd0', '#ffffff'], 30, 7, 0.12, 0.9);
  g.sfxAt('quake', bx, by, bz, 1, 1, 160);
  g.sfxAt('roar', bx, by + 3, bz, 1.1, 0.6);
}

/** The roof of one of the coven's huts (world), where the Hag stands to cast. */
function hutRoof(e: ExpeditionSite, k: number): Vec3 {
  const [hx, hz] = covenHuts(e.r)[k % 3]!;
  return [e.x + hx + 0.5, 48 + 12, e.z + hz + 0.5];
}

function wardenAlive(ws: WardenState): boolean {
  if (ws.giant) return !ws.giant.dead;
  return ws.mob !== null && !ws.mob.dead;
}

function wardenAt(ws: WardenState): Vec3 {
  if (ws.giant) {
    const [x, z] = ws.giant.body.hullCentre();
    return [x, ws.giant.body.top, z];
  }
  const m = ws.mob;
  return m ? [m.x, m.y + m.h, m.z] : [0, 0, 0];
}

/** How much of the warden is left (0..1), for its bar. */
export function wardenFrac(ws: WardenState): number {
  if (ws.giant) {
    if (ws.giant.dead) return 0;
    const k = ws.giant.body.findBlock(B.GIANT_HEART);
    const c = k !== null ? ws.giant.body.cells.get(k) : undefined;
    return c ? clamp(c.hp / Math.max(1, ws.maxHp), 0, 1) : 0;
  }
  if (!ws.mob || ws.mob.dead) return 0;
  return clamp(ws.mob.hp / Math.max(1, ws.maxHp), 0, 1);
}

function wardenLeave(g: Game, ws: WardenState): void {
  if (ws.giant) {
    ws.giant.dead = true;
    ws.giant.body.cells.clear();
  }
  if (ws.mob) ws.mob.dead = true;
  for (const m of g.mobs) if (m.guardOf === `w${ws.exp}`) m.dead = true;
}

/** Beaten: its crest chest opens, its minions scatter, a fanfare. */
function wardenFalls(g: Game, i: number): void {
  if (!g.mq.wardens.includes(i)) g.mq.wardens.push(i);
  for (const m of g.mobs) if (!m.dead && m.guardOf === `w${i}`) killMob(g, m, false);
  const info = EXPEDITIONS[i]!;
  const chest = crestChest(g, i);
  if (chest) {
    g.particles.ring(chest[0] + 0.5, chest[1] + 1, chest[2] + 0.5, 3, 1, 0.9, 0.4);
    g.particles.sparks(chest[0] + 0.5, chest[1] + 1, chest[2] + 0.5, ['#ffd23a', '#ffffff', info.color], 40, 6, 0.12, 1);
  }
  g.ui.banner(`${info.wardenName.toUpperCase()} FALLS!`, `${info.captain}'s chest is open: take the crest`, 'gold');
  g.addItem(I.EMERALD, 8 + i * 2, true);
  g.addItem(I.IRON_INGOT, 3 + i, true);
  g.addItem(I.TNT, 6, true);
  const metal = landMetal(g.world.terrain.zone(g.fortressCentre()[0], g.fortressCentre()[2]));
  if (metal !== null) g.addItem(metal, 3, true);
  g.xp(50 + i * 12);
  g.stats.giants += 1;
  g.celebrate(3);
  g.cheer();
  feat(g, 'warden');
  g.save();
}

// ------------------------------------------------------------------ the fort's guards

/** The outlaws turn out when you come up to their fort; when they are down the cages open. */
function updateFortGuards(g: Game): void {
  for (const e of g.world.terrain.expeditions) {
    if (e.id !== 'fort') continue;
    const tag = `x${e.index}`;
    const top = e.y + 16;
    const p = g.player;
    const near = Math.hypot(p.x - e.x, p.z - e.z) < 46;
    // The captives in their cages, from the moment the fort comes into the world.
    if (!g.opened.has(tag) && g.world.chunkAt(e.x, e.z) && !g.villagers.some((v) => v.region === CAPTIVE)) {
      const s = g.world.structures.byId.get(`x${e.index}:fort`);
      for (const [i, spot] of (s?.villagers ?? []).entries()) {
        if (i === 0) {
          spawnCaged(g, spot.x, spot.y, spot.z);
          continue;
        }
        const v = new Actor('villager', spot.x, spot.y, spot.z);
        v.captive = true;
        v.region = CAPTIVE;
        v.homeX = spot.x;
        v.homeZ = spot.z;
        g.villagers.push(v);
      }
    }
    // (Tova stays by her cage until she has had a word with you, however long you are gone.)
    if (g.opened.has(tag) && g.world.chunkAt(e.x, e.z)) {
      const spot = g.world.structures.byId.get(`x${e.index}:fort`)?.villagers[0];
      if (spot) spawnCaged(g, spot.x, spot.y, spot.z, false);
    }
    if (!wardenBeaten(g, e.index) && !g.guarded.has(tag) && near && g.world.chunkAt(e.x, e.z)) {
      g.guarded.add(tag);
      const kinds: ActorKind[] = ['pillager', 'pillager', 'vindicator', 'pillager', 'vindicator', 'pillager'];
      const n = kinds.length + Math.min(3, Math.floor(g.danger / 3));
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        const mob = raider(g, kinds[i % kinds.length]!, e.x + Math.cos(a) * 9, e.z + Math.sin(a) * 9);
        if (!mob) continue;
        mob.y = Math.max(mob.y, top + 1);
        mob.raid = -1;
        mob.guardOf = tag;
        mob.homeX = e.x;
        mob.homeZ = e.z;
      }
      g.toast('The outlaws turn out to guard their fort!');
      g.sfx('raidhorn', 'stone', 0.7);
    }
    // Guards down: the cages open (their fences come away) and the captives are free to go.
    if (g.guarded.has(tag) && !g.opened.has(tag) && !g.mobs.some((m) => !m.dead && m.guardOf === tag)) {
      g.opened.add(tag);
      const rot = e.side < 0 ? 0 : 2;
      for (const [cx, cz] of FORT_CAGES) {
        const [rx, rz] = rotXZ(cx, cz, rot);
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            for (let y = 1; y <= 2; y += 1) {
              const x = e.x + rx + dx;
              const z = e.z + rz + dz;
              if (g.world.get(x, top + y, z) === B.FENCE) g.world.set(x, top + y, z, B.AIR);
            }
          }
        }
        for (const v of g.villagers) {
          if (!v.captive || v.region !== CAPTIVE) continue;
          v.captive = false;
          // (Tova goes nowhere until she has had a word with you.)
          v.freed = v.kind !== 'npc';
        }
      }
      g.toast('The guards are down: the cages are open!', 'ui_villager');
    }
  }
}

// ------------------------------------------------------------------ the fights

function wardenMoves(g: Game, ws: WardenState, e: ExpeditionSite, dt: number): void {
  switch (ws.kind) {
    case 'hollow':
      hollowStrider(g, ws, e);
      break;
    case 'pharaoh':
      pharaoh(g, ws, e);
      break;
    case 'hag':
      bogHag(g, ws, e);
      break;
    case 'warlord':
      warlord(g, ws, e);
      break;
    case 'yeti':
      yeti(g, ws, e);
      break;
    case 'forgegolem':
      forgeGolem(g, ws, e);
      break;
    default:
      break;
  }
  keepInFight(g, ws, e, dt);
}

/**
 * A creature warden that has taken no harm for a long while and is far from you (stuck, or strayed)
 * comes back to its place near you: no wreck's crest can be left sealed for good.
 */
function keepInFight(g: Game, ws: WardenState, e: ExpeditionSite, dt: number): void {
  const mob = ws.mob;
  if (!mob || mob.dead || ws.giant) return;
  if (mob.hp < ws.lastHp - 0.01) {
    ws.lastHp = mob.hp;
    ws.calm = 0;
    return;
  }
  ws.calm += dt;
  const p = g.player;
  const far = Math.hypot(mob.x - p.x, mob.z - p.z) > 30 || Math.abs(mob.y - p.y) > 12;
  if (ws.calm < 16 || !far || p.dead) return;
  ws.calm = 0;
  const [sx, sy, sz] = wardenSpot(g, e);
  g.particles.smoke(mob.x, mob.cy, mob.z, 12, 1.4);
  mob.x = sx;
  mob.y = sy + 0.5;
  mob.z = sz;
  mob.vx = mob.vz = 0;
  mob.vy = 2;
}

/** Minions of a warden (counted toward nothing, gone when it falls). */
function minion(g: Game, ws: WardenState, kind: ActorKind, x: number, z: number, y?: number): Actor | null {
  const mob = spawnMob(g, kind, x, z);
  if (!mob) return null;
  if (y !== undefined) mob.y = y;
  mob.guardOf = `w${ws.exp}`;
  scaleHealth(g, mob);
  g.particles.dust(mob.x, mob.y + 0.2, mob.z, 10, 1.5, false);
  return mob;
}

/** A slam: a ring that rolls out and throws whoever is in it. */
function slam(g: Game, x: number, y: number, z: number, r: number, dmg: number, fire = false): void {
  g.particles.ring(x, y + 0.5, z, r, 0.7, fire ? 0.45 : 0.85, fire ? 0.2 : 0.6);
  for (let k = 0; k < 6; k += 1) g.particles.dust(x + (Math.random() - 0.5) * r, y + 0.4, z + (Math.random() - 0.5) * r, 10, 3, false);
  if (fire) g.particles.sparks(x, y + 1, z, ['#ff8a20', '#ffd040', '#ff4010'], 40, 9, 0.12, 0.8);
  g.sfxAt('quake', x, y, z, 1, fire ? 0.8 : 1, 120);
  g.renderer.shake(0.5);
  g.eachPlayer((p) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (p.dead || d > r + 1.5 || Math.abs(p.y - y) > 4) return;
    const k = 1 / (d || 1);
    damagePlayer(g, dmg, (p.x - x) * k * 10, (p.z - z) * k * 10);
  });
}

/** A lump lobbed at a point (a titan-style shell: it bursts where it lands). */
function lob(g: Game, from: Vec3, to: Vec3, block: number, flight = 1.4): void {
  const [sx, sy, sz] = from;
  const [tx, ty, tz] = to;
  const t = clamp(Math.hypot(tx - sx, tz - sz) / 13, 0.8, flight + 1);
  g.projectiles.push({ kind: 'gshell', block, x: sx, y: sy, z: sz, vx: (tx - sx) / t, vy: (ty - sy + 0.5 * TNT_G * t * t) / t, vz: (tz - sz) / t, age: 0, life: t + 1.5, spin: 0, fromCrew: false });
}

// ---- the Hollow Strider: the Bramble's dead walk again (a giant; its crew rise round it)
function hollowStrider(g: Game, ws: WardenState, e: ExpeditionSite): void {
  const giant = ws.giant;
  if (!giant || giant.dead) return;
  const [gx, gz] = giant.body.hullCentre();
  if (ws.cd[0]! <= 0) {
    ws.cd[0] = 16;
    const n = 2 + Math.min(2, Math.floor(g.danger / 3));
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      minion(g, ws, Math.random() < 0.6 ? 'zombie' : 'skeleton', gx + Math.cos(a) * 6, gz + Math.sin(a) * 6);
    }
    g.toast('The Bramble\'s lost crew rise to fight for it!');
    g.sfxAt('groan', gx, giant.body.top, gz, 1);
  }
  // Green bolts of the Heart's light from its cabin's eyes, at the deck.
  if (ws.cd[1]! <= 0) {
    ws.cd[1] = 7;
    const F = g.fortress;
    const keys = [...F.cells.keys()];
    const k = keys[Math.floor(Math.random() * keys.length)];
    if (k !== undefined) {
      const q = F.cellCenter(k % 128 - 64, Math.floor(k / 16384) - 64, (Math.floor(k / 128) % 128) - 64);
      lob(g, [gx, giant.body.top + 1, gz], [q.x, q.y, q.z], B.SEAL_CRYSTAL);
      g.particles.sparks(gx, giant.body.top + 1, gz, ['#4cff8a', '#ffffff'], 12, 4, 0.1, 0.5);
    }
  }
  void e;
}

// ---- the Pharaoh Husk: a king in his vault, husks out of the sand, a storm of it
function pharaoh(g: Game, ws: WardenState, e: ExpeditionSite): void {
  const mob = ws.mob;
  if (!mob || mob.dead) return;
  const p = g.player;
  const frac = mob.hp / mob.maxHp;
  if (ws.cd[0]! <= 0) {
    ws.cd[0] = frac < 0.5 ? 9 : 13;
    const n = frac < 0.5 ? 4 : 3;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      minion(g, ws, 'husk', e.x + 0.5 + Math.cos(a) * 5, e.z + 0.5 + Math.sin(a) * 5, e.y + 1);
    }
    g.toast('Husks claw their way up out of the sand!');
    g.sfxAt('groan', mob.x, mob.y + 2, mob.z, 1, 0.8);
  }
  // The sandstorm: a blast of sand off his staff that throws you back and slows you.
  if (ws.cd[1]! <= 0 && Math.hypot(p.x - mob.x, p.z - mob.z) < 12) {
    ws.cd[1] = 8;
    for (let k = 0; k < 40; k += 1) g.particles.add({ x: mob.x, y: mob.y + 2.5, z: mob.z, vx: (Math.random() - 0.5) * 14, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 14, life: 1.2, size: 0.3, grow: 0.6, r: 0.9, g: 0.8, b: 0.55, a: 0.8, gravity: 0, drag: 1.4, tile: 'smoke', soft: true });
    g.sfxAt('wind', mob.x, mob.y + 2, mob.z, 1, 0.7);
    g.eachPlayer((q) => {
      const d = Math.hypot(q.x - mob.x, q.z - mob.z);
      if (q.dead || d > 9) return;
      damagePlayer(g, 3 + Math.floor(g.danger / 3), ((q.x - mob.x) / (d || 1)) * 12, ((q.z - mob.z) / (d || 1)) * 12, 'slowness', 4);
    });
  }
  if (ws.cd[2]! <= 0 && frac < 0.6) {
    ws.cd[2] = 11;
    slam(g, mob.x, mob.y, mob.z, 7, 4 + Math.floor(g.danger / 2));
  }
}

// ---- the Bog Hag: shielded by her cauldrons, she blinks from hut to hut throwing her brews
function cauldronsLeft(g: Game, e: ExpeditionSite): Vec3[] {
  const s = g.world.structures.byId.get(`x${e.index}:coven`);
  const out: Vec3[] = [];
  if (!s) return out;
  for (let i = 0; i < s.count; i += 1) {
    if (s.ids[i] !== B.CAULDRON) continue;
    const x = s.xs[i]!;
    const y = s.ys[i]!;
    const z = s.zs[i]!;
    if (g.world.get(x, y, z) === B.CAULDRON) out.push([x, y, z]);
  }
  return out;
}

/** Whether a mob is the Bog Hag still shielded by a standing cauldron (blows glance off). */
export function hagShielded(g: Game, mob: Actor): boolean {
  const ws = g.warden;
  if (!ws || ws.kind !== 'hag' || ws.mob !== mob) return false;
  const e = g.world.terrain.expeditions[ws.exp];
  return e ? cauldronsLeft(g, e).length > 0 : false;
}

function bogHag(g: Game, ws: WardenState, e: ExpeditionSite): void {
  const mob = ws.mob;
  if (!mob || mob.dead) return;
  const p = g.player;
  const left = cauldronsLeft(g, e);
  if (left.length !== ws.phase) {
    if (ws.phase > left.length && left.length > 0) g.toast(`A cauldron shatters! ${left.length} left keeping the Hag alive`);
    else if (ws.phase > 0 && left.length === 0) {
      g.ui.banner('HER CAULDRONS ARE BROKEN!', 'The Bog Hag can be hurt now: bring her down!', 'gold');
      g.sfxAt('shatter', mob.x, mob.y + 2, mob.z, 1, 0.8);
    }
    ws.phase = left.length;
  }
  // The shield: a green glow round her while any cauldron bubbles, threads of it to each.
  if (left.length > 0 && Math.random() < 0.5) {
    const [cx, cy, cz] = left[Math.floor(Math.random() * left.length)]!;
    const t = Math.random();
    g.particles.add({ x: mob.x + (cx + 0.5 - mob.x) * t, y: mob.y + 2 + (cy + 1 - mob.y - 2) * t, z: mob.z + (cz + 0.5 - mob.z) * t, vy: 0.2, life: 0.5, size: 0.14, r: 0.4, g: 1, b: 0.5, a: 0.9, emit: 1, gravity: 0, drag: 1, tile: 'spark', soft: true });
  }
  // Blink to another hut's roof now and then (always when you come close).
  const near = Math.hypot(p.x - mob.x, p.z - mob.z) < 4 && Math.abs(p.y - mob.y) < 3;
  if (ws.cd[0]! <= 0 || near) {
    ws.cd[0] = 9 + Math.random() * 4;
    const k = (Math.floor(Math.random() * 2) + 1 + Math.round(ws.t)) % 3;
    const [x, y, z] = hutRoof(e, k);
    g.particles.smoke(mob.x, mob.cy, mob.z, 14, 1.4);
    for (let i = 0; i < 16; i += 1) g.particles.add({ x: mob.x, y: mob.cy, z: mob.z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 4, life: 0.8, size: 0.16, r: 0.6, g: 0.25, b: 0.85, a: 1, emit: 1, gravity: 0, drag: 1.4, tile: 'spark', soft: true });
    mob.x = x;
    mob.y = y;
    mob.z = z;
    mob.vx = mob.vz = 0;
    g.sfxAt('teleport', x, y, z, 0.9, 0.8);
  }
  // Brews thrown at you; the fen's dead called up.
  if (ws.cd[1]! <= 0 && !p.dead && Math.hypot(p.x - mob.x, p.z - mob.z) < 30) {
    ws.cd[1] = left.length > 0 ? 2.4 : 1.8;
    mob.yaw = Math.atan2(p.z - mob.z, p.x - mob.x);
    const brews: Array<Actor['potion']> = ['poison', 'slowness', 'harm', 'weakness'];
    throwPotion(g, mob, p.x, p.y + 1, p.z, brews[Math.floor(Math.random() * brews.length)]!);
  }
  if (ws.cd[2]! <= 0) {
    ws.cd[2] = 15;
    for (let i = 0; i < 2; i += 1) {
      const a = Math.random() * Math.PI * 2;
      minion(g, ws, Math.random() < 0.5 ? 'bogged' : 'drowned', p.x + Math.cos(a) * 7, p.z + Math.sin(a) * 7);
    }
    g.sfxAt('witch', mob.x, mob.y + 2, mob.z, 1, 0.7);
  }
}

// ---- the Evoker Warlord: fangs and vexes (his own kind's moves), his outlaws called in
function warlord(g: Game, ws: WardenState, e: ExpeditionSite): void {
  const mob = ws.mob;
  if (!mob || mob.dead) return;
  if (ws.cd[0]! <= 0) {
    ws.cd[0] = 18;
    for (let i = 0; i < 2; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const m = raider(g, i === 0 ? 'vindicator' : 'pillager', mob.x + Math.cos(a) * 6, mob.z + Math.sin(a) * 6);
      if (m) {
        m.raid = -1;
        m.guardOf = `w${ws.exp}`;
      }
    }
    g.sfx('raidhorn', 'stone', 0.6);
  }
  // At half strength: a ring of fangs round him and a burst that throws you off.
  if (ws.phase === 0 && mob.hp < mob.maxHp * 0.5) {
    ws.phase = 1;
    slam(g, mob.x, mob.y, mob.z, 6, 4);
    g.toast('The Warlord calls his whole band!');
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2;
      const m = raider(g, 'vindicator', mob.x + Math.cos(a) * 8, mob.z + Math.sin(a) * 8);
      if (m) {
        m.raid = -1;
        m.guardOf = `w${ws.exp}`;
      }
    }
  }
  void e;
}

// ---- the Yeti: ice hurled from the slope, a roar that knocks you flat, a charge
function yeti(g: Game, ws: WardenState, e: ExpeditionSite): void {
  const mob = ws.mob;
  if (!mob || mob.dead) return;
  const p = g.player;
  const d = Math.hypot(p.x - mob.x, p.z - mob.z);
  const frac = mob.hp / mob.maxHp;
  if (ws.cd[0]! <= 0 && !p.dead && d < 40) {
    ws.cd[0] = frac < 0.5 ? 5 : 7;
    lob(g, [mob.x, mob.y + mob.h, mob.z], [p.x + (Math.random() - 0.5) * 3, p.y, p.z + (Math.random() - 0.5) * 3], B.PACKED_ICE);
    g.sfxAt('bear', mob.x, mob.y + 3, mob.z, 1, 0.6);
  }
  if (ws.cd[1]! <= 0 && d < 10) {
    ws.cd[1] = 12;
    g.sfxAt('roar', mob.x, mob.y + 3, mob.z, 1.2, 0.5);
    slam(g, mob.x, mob.y, mob.z, 8, 4 + Math.floor(g.danger / 2));
    g.eachPlayer((q) => {
      if (!q.dead && Math.hypot(q.x - mob.x, q.z - mob.z) < 10) addEffect(g, 'slowness', 5);
    });
  }
  if (ws.phase === 0 && frac < 0.5) {
    ws.phase = 1;
    for (let i = 0; i < 3; i += 1) {
      const a = Math.random() * Math.PI * 2;
      minion(g, ws, 'stray', p.x + Math.cos(a) * 8, p.z + Math.sin(a) * 8);
    }
    g.toast('Strays come down the mountain to the Yeti\'s roar!');
  }
  void e;
}

// ---- the Forge Golem: shockwaves of fire, fireballs (bat them back), blazes from the lava
function forgeGolem(g: Game, ws: WardenState, e: ExpeditionSite): void {
  const mob = ws.mob;
  if (!mob || mob.dead) return;
  const p = g.player;
  const d = Math.hypot(p.x - mob.x, p.z - mob.z);
  const frac = mob.hp / mob.maxHp;
  if (ws.cd[0]! <= 0 && d < 12) {
    ws.cd[0] = frac < 0.5 ? 7 : 10;
    slam(g, mob.x, mob.y, mob.z, 9, 5 + Math.floor(g.danger / 2), true);
  }
  if (ws.cd[1]! <= 0 && !p.dead && d < 36) {
    ws.cd[1] = frac < 0.5 ? 3.5 : 5;
    const sx = mob.x;
    const sy = mob.y + mob.h * 0.8;
    const sz = mob.z;
    let dx = p.x - sx;
    let dy = p.y + 1 - sy;
    let dz = p.z - sz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    g.projectiles.push({ kind: 'fireball', x: sx, y: sy, z: sz, vx: dx * 13, vy: dy * 13, vz: dz * 13, age: 0, life: 7, spin: 0, fromCrew: false, owner: mob });
    g.sfxAt('fireball', sx, sy, sz, 1);
  }
  if ((ws.phase === 0 && frac < 0.67) || (ws.phase === 1 && frac < 0.34)) {
    ws.phase += 1;
    for (let i = 0; i < 2; i += 1) {
      const blaze = minion(g, ws, 'blaze', e.x + (i ? 6 : -6), e.z + 4);
      if (blaze) blaze.y = e.y + CINDER.lake + 6;
    }
    g.toast('Blazes rise out of the lava lake!');
  }
}

/**
 * The creature wardens' own walking: they go for you within their place (a heavy blow when they reach
 * you); the Hag keeps to her roofs. Returns false for anything else (it moves its own way).
 */
export function wardenMob(g: Game, mob: Actor, dt: number, grids: Grid[], worldOnly: Grid[]): boolean {
  if (!mob.warden || mob.warden === 'warlord') return false;
  const p = g.player;
  if (mob.warden === 'hag') {
    mob.vx = 0;
    mob.vz = 0;
    if (!p.dead) mob.yaw = Math.atan2(p.z - mob.z, p.x - mob.x);
    walkStep(g, mob, 0, 0, 0, dt, grids, worldOnly);
    return true;
  }
  const dx = p.x - mob.x;
  const dz = p.z - mob.z;
  const d = Math.hypot(dx, dz) || 1;
  const reach = mob.hw + 1.6;
  const chase = !p.dead && d < 40 && Math.abs(p.y - mob.y) < 14;
  if (chase) mob.yaw = Math.atan2(dz, dx);
  // The blow: a windup, then it lands if you are still there.
  if (mob.windup > 0) {
    mob.windup -= dt;
    if (mob.windup <= 0) {
      mob.attackTimer = 1.4;
      if (!p.dead && d < reach + 0.6 && Math.abs(p.y - mob.y) < mob.h) damagePlayer(g, 6 + Math.floor(g.danger / 2), (dx / d) * 11, (dz / d) * 11);
      else g.sfx('swing', 'wood', 0.3, 0.6);
    }
  } else if (chase && d < reach && mob.attackTimer <= 0) {
    mob.windup = 0.55;
    mob.actDur = 0.55;
  }
  mob.attackTimer = Math.max(0, mob.attackTimer - dt);
  const go = chase && d > reach * 0.8 && mob.windup <= 0;
  walkStep(g, mob, go ? dx / d : 0, go ? dz / d : 0, go ? mob.speed : 0, dt, grids, worldOnly);
  return true;
}

/** The warden's bar over the screen (null when none is up). */
export function wardenBar(g: Game): { title: string; sub: string; pct: number } | null {
  const ws = g.warden;
  if (!ws) return null;
  const info = EXPEDITIONS[ws.exp];
  const title = TITLES[ws.kind];
  if (ws.stage === 'rise') return { title, sub: 'AWAKENING', pct: clamp(ws.t / 2.2, 0, 1) };
  if (ws.stage === 'dying') return { title, sub: 'THE CREST IS FREE', pct: 0 };
  let sub = info ? info.strider.toUpperCase() : '';
  if (ws.kind === 'hag') {
    const e = g.world.terrain.expeditions[ws.exp];
    const n = e ? cauldronsLeft(g, e).length : 0;
    if (n > 0) sub = `SHIELDED · CAULDRONS LEFT: ${n}`;
  }
  return { title, sub, pct: ws.pct ?? wardenFrac(ws) };
}

/** Whether a warden fight is on (it holds back the dawn and brings its own music). */
export function wardenActive(g: Game): boolean {
  return g.warden !== null;
}
