// The last fight. The Builders' Key opens the Heart's last shell; when the Heart breaks, what it kept
// rises out of the shards: Veyra, the Heart-Architect. First she fights as herself, high over the
// fortress (crystal hurled at the deck, the Heart's beam at you, creepers called down); then she
// pulls the Citadel's stone round her into the Heart Colossus; when its heart breaks she comes out
// for a last stand, her ring of shards breaking up. Beat her and the Heart is free of her, and she
// of it.
import { B } from './blocks';
import { Actor } from './entities';
import { feat } from './feats';
import type { Game } from './game';
import { createGiant, type Giant } from './giants';
import type { Vec3 } from './math3d';
import { damagePlayer, spawnMob, steerFlier } from './mobs';
import { clamp } from './rng';

export interface FinalBoss {
  stage: 'rise' | 'architect' | 'colossus' | 'splinter' | 'dying';
  t: number;
  /** Veyra, and the Heart Colossus she becomes for a while. */
  mob: Actor;
  giant: Giant | null;
  /** Her health when she rose (her bar measures against it). */
  maxHp: number;
  colossusHp: number;
  /** Move cooldowns; the beam being drawn (its aim and seconds left). */
  cd: number[];
  beam: { to: Vec3; t: number } | null;
  orbit: number;
  /** Where the Heart stood. */
  at: Vec3;
  /** (A co-op mate's copy: its bar as the host has it.) */
  pct?: number;
}

const TNT_G = 9.8;

/** The Heart breaks: Veyra rises out of it. */
export function beginFinalBoss(g: Game, x: number, y: number, z: number): void {
  const danger = g.danger;
  const mob = new Actor('veyra', x, y + 2, z);
  mob.maxHp = Math.round(720 + danger * 40);
  mob.hp = mob.maxHp;
  mob.boss = 'VEYRA, THE HEART-ARCHITECT';
  mob.invulnerable = 4;
  g.mobs.push(mob);
  g.finalBoss = { stage: 'rise', t: 0, mob, giant: null, maxHp: mob.maxHp, colossusHp: 1, cd: [3, 7, 16, 12], beam: null, orbit: 0, at: [x, y, z] };
  g.particles.ring(x, y, z, 14, 0.4, 1, 0.55);
  g.particles.sparks(x, y, z, ['#4cff8a', '#ffffff', '#b8ffd0'], 90, 14, 0.18, 1.6);
  g.light({ x, y: y + 4, z, r: 40, color: [0.4, 1.4, 0.6], life: 2, max: 2 });
  g.renderer.shake(1);
  g.sfx('shatter', 'glass', 1);
  g.sfx('witherspawn', 'stone', 0.9);
  g.ui.story('saga', 'veyra');
  g.ui.banner('VEYRA, THE HEART-ARCHITECT', 'What the Heart kept rises from its shards!', 'danger');
  g.audio.playMusic('final');
}

/** Per step of the last fight. */
export function updateFinalBoss(g: Game, dt: number): void {
  const fb = g.finalBoss;
  if (!fb || g.coopGuest) return;
  const mob = fb.mob;
  fb.t += dt;
  for (let i = 0; i < fb.cd.length; i += 1) fb.cd[i] = fb.cd[i]! - dt;
  switch (fb.stage) {
    case 'rise': {
      // Up out of the shards, turning, the light pouring off her.
      mob.y += dt * 2.2;
      mob.yaw += dt * 1.2;
      mob.invulnerable = 1;
      if (Math.random() < dt * 30) g.particles.sparks(mob.x + (Math.random() - 0.5) * 3, mob.y + Math.random() * mob.h, mob.z + (Math.random() - 0.5) * 3, ['#4cff8a', '#ffffff'], 1, 2, 0.1, 0.6);
      if (fb.t > 3.5) {
        fb.stage = 'architect';
        fb.t = 0;
      }
      return;
    }
    case 'architect':
      fly(g, fb, dt, false);
      attacks(g, fb, false);
      if (mob.hp <= mob.maxHp * 0.55) becomeColossus(g, fb);
      return;
    case 'colossus': {
      const giant = fb.giant;
      // The Heart's shards rain round the fortress while the colossus walks.
      if (fb.cd[2]! <= 0) {
        fb.cd[2] = 9;
        shardRain(g, 5);
      }
      if (!giant || giant.dead) {
        fb.stage = 'splinter';
        fb.t = 0;
        const [gx, gz] = giant ? giant.body.hullCentre() : [fb.at[0], fb.at[2]];
        mob.x = gx;
        mob.z = gz;
        mob.y = g.world.groundAt(gx, gz) + 8;
        mob.dead = false;
        mob.deathT = -1;
        mob.aux = 2;
        mob.invulnerable = 1.5;
        if (!g.mobs.includes(mob)) g.mobs.push(mob);
        fb.cd = [2, 4, 10, 8];
        g.ui.banner('HER LAST STAND!', 'The colossus falls apart: Veyra comes out of it. End it!', 'danger');
        g.sfx('witherspawn', 'stone', 0.8);
        g.renderer.shake(0.8);
      }
      return;
    }
    case 'splinter':
      fly(g, fb, dt, true);
      attacks(g, fb, true);
      if (mob.dead || mob.hp <= 0) {
        fb.stage = 'dying';
        fb.t = 0;
        g.sfx('bossdeath', 'stone', 1);
        g.renderer.shake(1);
      }
      return;
    case 'dying':
      if (Math.random() < dt * 20) g.particles.sparks(fb.at[0] + (Math.random() - 0.5) * 10, fb.at[1] + Math.random() * 16, fb.at[2] + (Math.random() - 0.5) * 10, ['#4cff8a', '#ffffff', '#ffd23a'], 3, 6, 0.12, 0.8);
      if (fb.t > 2.5) {
        g.finalBoss = null;
        g.mq.won = true;
        feat(g, 'veyra');
        g.startFinale('victory', fb.at[0], fb.at[1] + 6, fb.at[2]);
      }
      return;
    default:
  }
}

/** Her flight: wide circles high over the fortress, lower and quicker in her last stand. */
function fly(g: Game, fb: FinalBoss, dt: number, last: boolean): void {
  const mob = fb.mob;
  const F = g.fortress;
  const c = g.fortressCentre();
  const p = g.player;
  fb.orbit += dt * (last ? 0.42 : 0.24);
  const deckY = F.y + F.floorY;
  const r = g.fortressRadius() + (last ? 6 : 12) + Math.sin(g.time * 0.35) * 3;
  const tx = c[0] + Math.cos(fb.orbit) * r;
  const tz = c[2] + Math.sin(fb.orbit) * r;
  const ty = (last ? deckY + 7 : Math.max(deckY + 13, F.y + F.maxY + 4)) + Math.sin(g.time * 0.8) * 1.5;
  steerFlier(g, mob, tx, ty, tz, last ? 6 : 4.4, dt, 1.4, 3);
  if (!p.dead) mob.yaw = Math.atan2(p.z - mob.z, p.x - mob.x);
  if (mob.act !== 'none') {
    mob.actT += dt;
    if (mob.actT >= mob.actDur) mob.act = 'none';
  }
}

function cast(mob: Actor, dur: number): void {
  mob.act = 'cast';
  mob.actT = 0;
  mob.actDur = dur;
}

/** Crystal lobbed at the deck; the Heart's beam at you (drawn first, so you can step out of it); creepers. */
function attacks(g: Game, fb: FinalBoss, last: boolean): void {
  const mob = fb.mob;
  const p = g.player;
  const F = g.fortress;
  if (fb.cd[0]! <= 0) {
    fb.cd[0] = last ? 2.2 : 3.4;
    const keys = [...F.cells.keys()];
    for (let i = 0; i < (last ? 3 : 2); i += 1) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      if (k === undefined) break;
      const q = F.cellCenter((k % 128) - 64, Math.floor(k / 16384) - 64, (Math.floor(k / 128) % 128) - 64);
      lob(g, [mob.x, mob.y + mob.h * 0.6, mob.z], [q.x + (Math.random() - 0.5) * 3, q.y, q.z + (Math.random() - 0.5) * 3]);
    }
    cast(mob, 0.6);
  }
  // The beam: a thread of green from her heart to where you stood; it burns a moment later.
  if (!fb.beam && fb.cd[1]! <= 0 && !p.dead) {
    fb.cd[1] = last ? 6 : 9;
    fb.beam = { to: [p.x, p.y + 1, p.z], t: 1.2 };
    cast(mob, 1.2);
    g.sfxAt('charged', mob.x, mob.y + 4, mob.z, 1, 0.6);
    g.toast('The Heart\'s beam! Step out of the green line!');
  }
  const b = fb.beam;
  if (b) {
    b.t -= 1 / 60;
    const from: Vec3 = [mob.x, mob.y + mob.h * 0.55, mob.z];
    const n = 14;
    for (let i = 0; i < n; i += 1) {
      const t = Math.random();
      g.particles.add({ x: from[0] + (b.to[0] - from[0]) * t, y: from[1] + (b.to[1] - from[1]) * t, z: from[2] + (b.to[2] - from[2]) * t, vy: 0, life: 0.15, size: b.t > 0 ? 0.12 : 0.35, r: 0.3, g: 1, b: 0.5, a: 1, emit: 1, gravity: 0, drag: 1, tile: 'spark', soft: true });
    }
    if (b.t <= 0) {
      fb.beam = null;
      g.light({ x: b.to[0], y: b.to[1], z: b.to[2], r: 10, color: [0.4, 1.4, 0.6], life: 0.4, max: 0.4 });
      g.particles.sparks(b.to[0], b.to[1], b.to[2], ['#4cff8a', '#ffffff'], 30, 7, 0.12, 0.6);
      g.sfxAt('zap', b.to[0], b.to[1], b.to[2], 1, 0.7);
      g.eachPlayer((q) => {
        if (q.dead) return;
        if (distToSegment([q.x, q.y + 1, q.z], from, b.to) < 1.8) damagePlayer(g, 8 + Math.floor(g.danger / 2), 0, 0);
      });
    }
  }
  if (fb.cd[3]! <= 0) {
    fb.cd[3] = last ? 18 : 22;
    const c = g.fortressCentre();
    for (let i = 0; i < 3; i += 1) {
      const a = Math.random() * Math.PI * 2;
      spawnMob(g, i === 2 ? 'witherskel' : 'creeper', c[0] + Math.cos(a) * (g.fortressRadius() + 5), c[2] + Math.sin(a) * (g.fortressRadius() + 5));
    }
    cast(mob, 1);
    g.sfxAt('witch', mob.x, mob.y + 4, mob.z, 0.8, 0.5);
  }
  if (last && fb.cd[2]! <= 0) {
    fb.cd[2] = 12;
    shardRain(g, 7);
  }
}

function distToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
  const t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L, 0, 1);
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

function lob(g: Game, from: Vec3, to: Vec3): void {
  const [sx, sy, sz] = from;
  const [tx, ty, tz] = to;
  const t = clamp(Math.hypot(tx - sx, tz - sz) / 14, 0.8, 2.4);
  g.projectiles.push({ kind: 'gshell', block: B.SEAL_CRYSTAL, x: sx, y: sy, z: sz, vx: (tx - sx) / t, vy: (ty - sy + 0.5 * TNT_G * t * t) / t, vz: (tz - sz) / t, age: 0, life: t + 1.5, spin: 0, fromCrew: false });
}

/** Shards of the Heart falling all round the fortress. */
function shardRain(g: Game, n: number): void {
  const c = g.fortressCentre();
  const r = g.fortressRadius() + 4;
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r;
    const x = c[0] + Math.cos(a) * d;
    const z = c[2] + Math.sin(a) * d;
    lob(g, [x + (Math.random() - 0.5) * 6, c[1] + 40, z + (Math.random() - 0.5) * 6], [x, c[1], z]);
  }
  g.toast('Shards of the Heart rain down!');
}

/** She pulls the Citadel's stone round herself: the Heart Colossus. */
function becomeColossus(g: Game, fb: FinalBoss): void {
  const mob = fb.mob;
  const T = g.world.terrain;
  const cit = T.citadel;
  const c = g.fortressCentre();
  let dx = c[0] - cit.x;
  let dz = c[2] - cit.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const x = Math.round(cit.x + dx * 26);
  const z = Math.round(cit.z + dz * 26);
  const giant = createGiant('heartcolossus', x, z, g.world.groundAt(x, z), 3.2 + (g.danger - 1) * 0.25, dx, dz);
  giant.guardian = true;
  giant.walker.layout(giant.body, g.world);
  g.giants.push(giant);
  fb.giant = giant;
  const heart = giant.body.findBlock(B.GIANT_HEART);
  fb.colossusHp = heart !== null ? giant.body.cells.get(heart)!.maxHp : 1;
  fb.stage = 'colossus';
  fb.t = 0;
  fb.cd[2] = 6;
  // She streams into it, out of the sky.
  g.particles.smoke(mob.x, mob.cy, mob.z, 20, 2);
  for (let k = 0; k < 40; k += 1) {
    const t = k / 40;
    g.particles.add({ x: mob.x + (x - mob.x) * t, y: mob.cy + (g.world.groundAt(x, z) + 10 - mob.cy) * t, z: mob.z + (z - mob.z) * t, vy: 0.4, life: 1.2, size: 0.3, r: 0.3, g: 1, b: 0.5, a: 1, emit: 1, gravity: 0, drag: 1, tile: 'spark', soft: true });
  }
  g.mobs = g.mobs.filter((m) => m !== mob);
  g.ui.banner('THE HEART COLOSSUS!', 'She pulls the Citadel round her: break its Heart!', 'danger');
  g.sfx('giant', 'stone', 1.3);
  g.renderer.shake(1);
}

/** How full the last fight's bar is (0..1). */
export function finalBossPct(fb: FinalBoss): number {
  switch (fb.stage) {
    case 'rise':
      return clamp(fb.t / 3.5, 0, 1);
    case 'colossus': {
      const giant = fb.giant;
      const k = giant ? giant.body.findBlock(B.GIANT_HEART) : null;
      const c = k !== null && giant ? giant.body.cells.get(k) : undefined;
      return c ? clamp(c.hp / Math.max(1, fb.colossusHp), 0, 1) : 0;
    }
    case 'dying':
      return 0;
    default:
      return clamp(fb.mob.hp / fb.maxHp, 0, 1);
  }
}

/** The bar over the screen for the last fight. */
export function finalBossBar(g: Game): { title: string; sub: string; pct: number } | null {
  const fb = g.finalBoss;
  if (!fb) return null;
  const pct = fb.pct ?? finalBossPct(fb);
  switch (fb.stage) {
    case 'rise':
      return { title: 'VEYRA, THE HEART-ARCHITECT', sub: 'RISING', pct };
    case 'architect':
      return { title: 'VEYRA, THE HEART-ARCHITECT', sub: 'PHASE 1 OF 3', pct };
    case 'colossus':
      return { title: 'THE HEART COLOSSUS', sub: 'PHASE 2 OF 3', pct };
    case 'splinter':
      return { title: 'VEYRA, THE HEART-ARCHITECT', sub: 'PHASE 3 OF 3 · HER LAST STAND', pct };
    default:
      return { title: 'VEYRA', sub: 'FREED', pct: 0 };
  }
}
