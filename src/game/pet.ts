// Pip, the old smith's wolf: follows you everywhere (up the ladder it simply appears beside you),
// bites the monsters that come for you, barks when they come close, digs up little finds by day,
// chases the village hens for fun (never catching one), howls at the moon when night falls and
// sits for a pat. Pip never gets hurt.
import { B, I } from './blocks';
import { spawnDrop } from './build';
import { Actor, JUMP_V, moveActor } from './entities';
import { feat } from './feats';
import type { Game } from './game';
import { damageMob } from './mobs';
import { overlaps } from './physics';

export interface Pet {
  a: Actor;
  name: string;
  /** Seconds left sitting (after a pat), and how happy it is (0..1: the tail wags faster). */
  sit: number;
  happy: number;
  target: Actor | null;
  bite: number;
  bark: number;
  /** Seconds it has been unable to keep up (then it hops to you). */
  lost: number;
  /** Seconds until it next sniffs out something in the ground. */
  dig: number;
  petted: number;
  /** Seconds before it hops along with you again. */
  hop: number;
  /** A hen it is chasing for fun (and for how much longer); seconds until a howl, and of howling. */
  chase: Actor | null;
  chaseT: number;
  howlAt: number;
  howl: number;
}

export function makePet(x: number, y: number, z: number): Pet {
  const a = new Actor('wolf', x, y, z);
  a.speed = 5.2;
  return { a, name: 'Pip', sit: 0, happy: 0.6, target: null, bite: 0, bark: 3, lost: 0, dig: 70, petted: 0, hop: 0, chase: null, chaseT: 0, howlAt: -1, howl: 0 };
}

/** Night falls: in a moment Pip sits back and howls at the moon. */
export function planHowl(g: Game, delay = 3): void {
  if (g.pet) g.pet.howlAt = delay;
}

/** How far Pip's head is thrown back in a howl (0..1). */
export function howlPose(pet: Pet): number {
  if (pet.howl <= 0) return 0;
  return Math.min(1, (HOWL_TIME - pet.howl) * 5, pet.howl * 4);
}

const HOWL_TIME = 2.6;

/** Pats on the head: Pip sits, wags, and hearts pop. */
export function petPet(g: Game): void {
  const pet = g.pet;
  if (!pet) return;
  pet.sit = 2.6;
  pet.happy = 1;
  pet.petted += 1;
  pet.chase = null;
  const a = pet.a;
  a.vx = a.vz = 0;
  for (let i = 0; i < 6; i += 1) {
    g.particles.add({ x: a.x + (Math.random() - 0.5) * 0.6, y: a.y + 1.1, z: a.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.6, vy: 1.4 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 1.1, size: 0.22, r: 1, g: 0.3, b: 0.42, a: 1, emit: 1, gravity: -0.4, drag: 1, tile: 'heart', soft: true });
  }
  g.sfx('bark', 'flesh', 0.75, 1.08);
  if (pet.petted === 1) g.toast(`Good dog, ${pet.name}!`, 'ui_wolf');
  feat(g, 'goodboy');
  g.report('primary_input');
}

/** A spot beside (and a little behind) you that the wolf can stand on. */
function besidePlayer(g: Game): [number, number, number] | null {
  const p = g.player;
  const grids = g.grids();
  for (const [ox, oz] of [[-1.2, 0.8], [-1.2, -0.8], [0, 1.2], [0, -1.2], [1.1, 0], [-1.6, 0]] as const) {
    const fx = Math.cos(g.yaw);
    const fz = Math.sin(g.yaw);
    const x = p.x + fx * ox - fz * oz;
    const z = p.z + fz * ox + fx * oz;
    for (const dy of [0, 1, -1]) {
      const y = p.y + dy + 0.002;
      const box = { x, y, z, hw: 0.3, h: 0.85 };
      if (grids.some((gr) => overlaps(box, gr, 0.01))) continue;
      const under = { x, y: y - 0.3, z, hw: 0.28, h: 0.28 };
      if (!grids.some((gr) => overlaps(under, gr, 0.01))) continue;
      return [x, y, z];
    }
  }
  return null;
}

function hopTo(g: Game, pet: Pet): boolean {
  const spot = besidePlayer(g);
  if (!spot) return false;
  const a = pet.a;
  g.particles.poof(a.x, a.y + 0.4, a.z, 6);
  [a.x, a.y, a.z] = spot;
  a.vx = a.vy = a.vz = 0;
  a.standingOn = g.player.standingOn;
  a.onGround = true;
  pet.lost = 0;
  g.particles.poof(a.x, a.y + 0.4, a.z, 6);
  return true;
}

/** The monster Pip goes for: the nearest one coming at you on your level (not the fliers). */
function pickTarget(g: Game, pet: Pet): Actor | null {
  const p = g.player;
  const a = pet.a;
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const m of g.mobs) {
    if (m.dead || m.fly || m.climb || m.stun > 0) continue;
    // Wolves keep clear of creepers (all but the golden one, which they love to chase).
    if (m.kind === 'creeper' && m.golden <= 0) continue;
    if (Math.abs(m.y - a.y) > 2.5) continue;
    const dp = Math.hypot(m.x - p.x, m.z - p.z);
    const dw = Math.hypot(m.x - a.x, m.z - a.z);
    if (dp > 11 || dw > 14) continue;
    if (dw < bestD) {
      bestD = dw;
      best = m;
    }
  }
  return best;
}

export function updatePet(g: Game, dt: number): void {
  const pet = g.pet;
  if (!pet) return;
  const a = pet.a;
  const p = g.player;
  pet.happy = Math.max(0.15, pet.happy - dt * 0.12);
  pet.bite = Math.max(0, pet.bite - dt);
  pet.bark -= dt;
  a.hurt = Math.max(0, a.hurt - dt);
  const dx = p.x - a.x;
  const dz = p.z - a.z;
  const dist = Math.hypot(dx, dz);
  // Too far, or you went up (or down) where it cannot follow: it hops to your side.
  if (!p.dead && !g.leap && !g.grapple && (dist > 22 || a.y < -4 || (Math.abs(p.y - a.y) > 3.5 && dist < 10 && !p.climbing) || pet.lost > 2.2)) {
    if (!hopTo(g, pet)) pet.lost = Math.min(pet.lost, 2);
  }
  let tx = a.x;
  let tz = a.z;
  let speed = 0;
  if (pet.target && (pet.target.dead || pet.target.climb || Math.hypot(pet.target.x - p.x, pet.target.z - p.z) > 14)) pet.target = null;
  if (!pet.target && pet.sit <= 0) {
    const t = pickTarget(g, pet);
    if (t) {
      pet.target = t;
      pet.chase = null;
      if (pet.bark <= 0) {
        pet.bark = 5;
        g.sfx('bark', 'flesh', Math.max(0.3, 0.9 - dist / 40));
      }
    }
  }
  // Night falls: Pip sits back and howls at the moon (unless it is busy biting something).
  if (pet.howlAt > 0) {
    pet.howlAt -= dt;
    if (pet.howlAt <= 0) {
      if (pet.target) pet.howlAt = 1.5;
      else {
        pet.howlAt = -1;
        pet.howl = HOWL_TIME;
        pet.sit = HOWL_TIME;
        pet.chase = null;
        g.sfx('howl', 'flesh', Math.max(0.3, 0.95 - dist / 50));
        g.crewSay('howl');
      }
    }
  }
  if (pet.howl > 0) {
    pet.howl -= dt;
    // Little silver notes drift up from the song.
    if (Math.random() < dt * 5) {
      const fx = Math.cos(a.yaw);
      const fz = Math.sin(a.yaw);
      g.particles.add({ x: a.x + fx * 0.55, y: a.y + 1.3, z: a.z + fz * 0.55, vx: fx * 0.3 + (Math.random() - 0.5) * 0.3, vy: 0.9 + Math.random() * 0.4, vz: fz * 0.3 + (Math.random() - 0.5) * 0.3, life: 1.3, size: 0.14, r: 0.78, g: 0.88, b: 1, a: 1, emit: 1, gravity: -0.3, drag: 1, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 2 });
    }
  }
  // By day, now and then, Pip bounds after a hen for fun (it never catches one).
  if (pet.chase) {
    pet.chaseT -= dt;
    const h = pet.chase;
    if (pet.chaseT <= 0 || !g.animals.includes(h) || Math.hypot(h.x - p.x, h.z - p.z) > 22 || Math.abs(h.y - a.y) > 3) pet.chase = null;
  } else if (g.phase === 'day' && !pet.target && pet.sit <= 0 && pet.howl <= 0 && Math.random() < dt / 28) {
    let best: Actor | null = null;
    let bestD = 9;
    for (const h of g.animals) {
      if (h.kind !== 'chicken' || Math.abs(h.y - a.y) > 1.5) continue;
      const d = Math.hypot(h.x - a.x, h.z - a.z);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best) {
      pet.chase = best;
      pet.chaseT = 2.8 + Math.random() * 1.5;
      g.sfx('bark', 'flesh', Math.max(0.25, 0.7 - dist / 40), 1.2);
    }
  }
  if (pet.sit > 0) {
    pet.sit -= dt;
    if (pet.howl > 0) {
      // Facing the moon.
      const s = g.renderer.env.sunDir;
      a.yaw = Math.atan2(-s[2], -s[0]);
    } else a.yaw = Math.atan2(dz, dx);
  } else if (pet.target) {
    const m = pet.target;
    tx = m.x;
    tz = m.z;
    speed = 5.6;
    const d = Math.hypot(m.x - a.x, m.z - a.z);
    if (d < 1.35 && Math.abs(m.y - a.y) < 1.6 && pet.bite <= 0) {
      // A bite: a lunge, a blow, a shove.
      pet.bite = 0.75;
      const n = 4 + Math.floor(g.day / 2);
      const l = d || 1;
      damageMob(g, m, n, ((m.x - a.x) / l) * 5, ((m.z - a.z) / l) * 5);
      g.ui.damage(n, m.x, m.y + m.h * 0.9, m.z, 'hit');
      g.particles.sparks(m.x, m.cy, m.z, ['#ffffff', '#ff6a50'], 5, 2.5, 0.05, 0.25);
      g.sfx('slash', 'flesh', 0.45, 1.25);
      a.vy = 3;
      a.onGround = false;
      if (Math.random() < 0.3) g.sfx('bark', 'flesh', 0.5, 1.15);
    }
  } else if (pet.chase) {
    const h = pet.chase;
    tx = h.x;
    tz = h.z;
    speed = 4.6;
    if (Math.hypot(h.x - a.x, h.z - a.z) < 1.2) {
      // So close! The hen gets away in a flurry, Pip is delighted.
      pet.chase = null;
      pet.happy = 1;
      pet.sit = 1.1;
      g.sfx('bark', 'flesh', Math.max(0.25, 0.75 - dist / 40), 1.25);
    }
  } else if (dist > 3.2 && !p.dead) {
    tx = p.x;
    tz = p.z;
    speed = Math.min(5.4, 2 + dist * 0.45);
  } else {
    // At heel: it watches you, now and then sniffing about.
    a.yaw = Math.atan2(dz, dx) + Math.sin(g.time * 0.6) * 0.4;
  }
  let mx = tx - a.x;
  let mz = tz - a.z;
  const ml = Math.hypot(mx, mz);
  if (ml > 0.05 && speed > 0) {
    mx /= ml;
    mz /= ml;
    a.yaw = Math.atan2(mz, mx);
  } else {
    mx = mz = 0;
  }
  const k = Math.min(1, dt * (a.onGround ? 12 : 3));
  a.vx += (mx * speed - a.vx) * k;
  a.vz += (mz * speed - a.vz) * k;
  a.wantJump = false;
  const grids = g.grids();
  const result = moveActor(a, dt, grids, [grids[0]!], () => null, (x) => g.inWater(x), (x, nx, nz) => g.deckSupport(x, nx, nz));
  if (result.carrier) a.yaw += 0;
  if (result.hitWall && a.onGround && speed > 0) {
    // A step up: hop it; a wall: count it towards hopping to you.
    const fx = a.x + mx * 0.45;
    const fz = a.z + mz * 0.45;
    const head = { x: fx, y: a.y + 1.05, z: fz, hw: 0.28, h: 0.85 };
    if (!grids.some((gr) => overlaps(head, gr, 0.02))) {
      a.vy = JUMP_V * 0.92;
      a.onGround = false;
      a.standingOn = null;
    } else pet.lost += dt;
  } else if (speed > 0 && Math.hypot(a.vx, a.vz) < 0.4) {
    pet.lost += dt;
  } else {
    pet.lost = Math.max(0, pet.lost - dt);
  }
  a.walkPhase += Math.hypot(a.vx, a.vz) * dt * 1.4;
  // You hop, Pip hops (when it is at heel and not busy).
  if (!pet.target && pet.sit <= 0 && a.onGround && p.vy > 6 && !p.onGround && dist < 4 && Math.abs(p.y - a.y) < 1.5 && pet.hop <= 0) {
    pet.hop = 0.6;
    a.vy = JUMP_V * 0.75;
    a.onGround = false;
    a.standingOn = null;
    pet.happy = Math.min(1, pet.happy + 0.25);
  }
  pet.hop = Math.max(0, pet.hop - dt);
  // Out on the meadows by day it sniffs out little finds.
  if (g.phase === 'day' && !pet.target && a.onGround && a.standingOn === null) {
    pet.dig -= dt;
    if (pet.dig <= 0) {
      pet.dig = 75 + Math.random() * 60;
      const under = g.world.get(Math.floor(a.x), Math.floor(a.y - 0.5), Math.floor(a.z));
      if (under === B.GRASS || under === B.DIRT || under === B.SAND || under === B.SNOW) {
        const roll = Math.random();
        const id = roll < 0.15 ? I.EMERALD : roll < 0.4 ? I.COAL : roll < 0.6 ? I.BREAD : roll < 0.8 ? I.IRON_INGOT : I.GUNPOWDER;
        g.particles.debris(a.x, a.y + 0.2, a.z, under === B.SAND ? 'sand' : 'dirt', 10, 3);
        spawnDrop(g, id, 1, a.x, a.y + 0.4, a.z);
        g.sfx('bark', 'flesh', 0.7, 1.1);
        g.toast(`${pet.name} dug something up!`, 'ui_wolf');
        pet.happy = 1;
      }
    }
  }
}
