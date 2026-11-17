// The valley's farm animals: hens pecking round the farms and sheep grazing the meadows past the
// houses. Pick a hen up and she flaps you down gently from any height (jump off your deck!); set
// her down on the deck and she rides along. Shear a sheep for wool (thrusters are sewn from it)
// and it grows back. Nothing hurts them: blasts, stamping feet and a playful wolf only send them
// running, feathers and wool flying.
import { B } from './blocks';
import { spawnDrop } from './build';
import { Actor, JUMP_V, moveActor } from './entities';
import { feat } from './feats';
import { approach, type Game } from './game';
import { WOOL_TINTS } from './models';
import { overlaps } from './physics';
import type { Site } from './terrain';

/** How fast a hen (or you, holding one) falls: a flapping glide. */
export const HEN_GLIDE = 2.4;
/** Seconds for a shorn fleece to grow back (grazing doubles it up). */
const WOOL_REGROW = 80;
/** Ground a farm animal may be put down on. */
const PASTURE = new Set<number>([B.GRASS, B.DIRT, B.PATH, B.GRAVEL, B.SAND, B.SNOW, B.GRASS_SNOW, B.BLIGHT_GRASS, B.FARMLAND]);

export function isAnimal(a: Actor): boolean {
  return a.kind === 'chicken' || a.kind === 'sheep';
}

function makeAnimal(g: Game, kind: 'chicken' | 'sheep', x: number, y: number, z: number, region: number): Actor {
  const a = new Actor(kind, x, y, z);
  a.region = region;
  a.yaw = Math.random() * Math.PI * 2;
  a.idleTimer = Math.random() * 3;
  a.voice = 3 + Math.random() * 10;
  if (kind === 'chicken') a.fallCap = HEN_GLIDE;
  g.animals.push(a);
  return a;
}

/** A free patch of open ground near (x, z) for an animal (tries a few spots). */
function pasture(g: Game, x: number, z: number, spread: number): [number, number, number] | null {
  const w = g.world;
  for (let tries = 0; tries < 8; tries += 1) {
    const px = x + (Math.random() - 0.5) * spread * (tries === 0 ? 0 : 1);
    const pz = z + (Math.random() - 0.5) * spread * (tries === 0 ? 0 : 1);
    const ix = Math.floor(px);
    const iz = Math.floor(pz);
    if (!w.chunkAt(ix, iz)) continue;
    const top = w.topAt(ix, iz);
    if (!PASTURE.has(w.get(ix, top, iz)) || w.liquid(ix, top + 1, iz)) continue;
    if (w.structureAt(ix, top, iz) || w.structureAt(ix, top + 1, iz)) continue;
    if (w.solid(ix, top + 1, iz) || w.solid(ix, top + 2, iz)) continue;
    return [ix + 0.5, top + 1.002, iz + 0.5];
  }
  return null;
}

/** Wool colour for a new sheep: mostly white, some grey, brown and black, and once in a while pink. */
function woolFor(village: number, n: number): number {
  // Millford always keeps one pink sheep (the rest of the valley rarely does).
  if (village === 1 && n === 0) return 4;
  const r = Math.random();
  return r < 0.04 ? 4 : r < 0.14 ? 3 : r < 0.3 ? 2 : r < 0.46 ? 1 : 0;
}

/** A village streams in: hens round its farms, sheep out on the meadows beyond the houses. */
export function spawnVillageAnimals(g: Game, v: Site): void {
  // Any left from an earlier visit go first (none are lost: they are simply put back).
  g.animals = g.animals.filter((a) => a.region !== v.index || a.boarded);
  const all = g.world.structures.all.filter((s) => s.site === v && !g.world.hoisted.has(s.id));
  const farms = all.filter((s) => s.kind === 'farm');
  const homes = farms.length > 0 ? farms : all.filter((s) => s.kind === 'house' || s.kind === 'cottage');
  for (let i = 0; i < 5 && homes.length > 0; i += 1) {
    const s = homes[i % homes.length]!;
    // Just outside the farm's fence, on the road side or round its ends.
    const cx = (s.minX + s.maxX + 1) / 2;
    const cz = (s.minZ + s.maxZ + 1) / 2;
    const side = Math.sign(v.z - cz) || 1;
    const spot = pasture(g, cx + (Math.random() - 0.5) * (s.maxX - s.minX + 4), side > 0 ? s.maxZ + 2.5 : s.minZ - 1.5, 3);
    if (spot) makeAnimal(g, 'chicken', spot[0], spot[1], spot[2], v.index);
  }
  for (let i = 0; i < 4; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const spot = pasture(g, v.x + (Math.random() - 0.5) * 60, v.z + side * (25 + Math.random() * 10), 10);
    if (!spot) continue;
    const a = makeAnimal(g, 'sheep', spot[0], spot[1], spot[2], v.index);
    a.tint = woolFor(v.index, i);
  }
}

/** Free spots on the deck floor (fortress-local cell columns), for hens to stand on. */
function deckSpots(g: Game): Array<[number, number]> {
  const F = g.fortress;
  const spots: Array<[number, number]> = [];
  for (const k of F.cells.keys()) {
    const y = Math.floor(k / 16384) - 64;
    if (y !== 0) continue;
    const x = (k % 128) - 64;
    const z = (Math.floor(k / 128) % 128) - 64;
    if (F.solidAt(x, 1, z) || F.solidAt(x, 2, z) || F.hasBlock(x, 1, z)) continue;
    spots.push([x, z]);
  }
  return spots;
}

function putOnDeck(g: Game, a: Actor, x: number, z: number): void {
  const F = g.fortress;
  const [wx, wy, wz] = F.toWorld(x + 0.5, 1.002, z + 0.5);
  a.x = wx;
  a.y = wy;
  a.z = wz;
  a.vx = a.vy = a.vz = 0;
  a.standingOn = F;
  a.onGround = true;
  a.boarded = true;
  a.region = -1;
}

/** Hens that rode along on the deck in a saved game come back aboard with it. */
export function restoreDeckHens(g: Game, n: number): void {
  const spots = deckSpots(g);
  for (let i = 0; i < n && spots.length > 0; i += 1) {
    const [x, z] = spots.splice(Math.floor(Math.random() * spots.length), 1)[0]!;
    const a = makeAnimal(g, 'chicken', 0, 0, 0, -1);
    putOnDeck(g, a, x, z);
  }
}

/** A deck hen that tumbled off (through a hole the monsters chewed): the crew fetches her back up. */
function fetchBack(g: Game, a: Actor): boolean {
  const spots = deckSpots(g);
  if (spots.length === 0) return false;
  const [x, z] = spots[Math.floor(Math.random() * spots.length)]!;
  g.particles.poof(a.x, a.y + 0.4, a.z, 6);
  putOnDeck(g, a, x, z);
  a.flap = 1;
  g.particles.poof(a.x, a.y + 0.4, a.z, 6);
  return true;
}

/** White flecks of down drifting off a hen (or, tinted, tufts of fleece off a sheep). */
export function fluff(g: Game, x: number, y: number, z: number, n: number, tint: readonly number[] = [1, 1, 1]): void {
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const s = 0.6 + Math.random() * 1.8;
    g.particles.add({
      x: x + (Math.random() - 0.5) * 0.4, y: y + (Math.random() - 0.5) * 0.3, z: z + (Math.random() - 0.5) * 0.4,
      vx: Math.cos(a) * s, vy: 0.8 + Math.random() * 1.6, vz: Math.sin(a) * s,
      life: 1.3 + Math.random() * 0.9, size: 0.09 + Math.random() * 0.06,
      r: tint[0]!, g: tint[1]!, b: tint[2]!, gravity: 1.5, drag: 2.6,
      tile: 'wool_white', u: Math.floor(Math.random() * 24), v: Math.floor(Math.random() * 24),
    });
  }
}

/** A fright near (x, y, z): animals run from it (flung a little by a blast), hens flap and squawk. */
export function startle(g: Game, x: number, y: number, z: number, radius: number, fling = 0): void {
  let hen = false;
  let ewe = false;
  for (const a of g.animals) {
    const d = Math.hypot(a.x - x, a.z - z);
    if (d > radius || Math.abs(a.y - y) > radius) continue;
    a.panic = 2.2 + Math.random() * 1.6;
    a.wanderYaw = Math.atan2(a.z - z, a.x - x) + (Math.random() - 0.5) * 0.7;
    a.munch = 0;
    if (fling > 0 && !a.boarded) {
      const k = fling * (1 - d / radius);
      a.vx += Math.cos(a.wanderYaw) * k;
      a.vz += Math.sin(a.wanderYaw) * k;
      a.vy = Math.max(a.vy, 2.5 + k * 0.45);
      a.onGround = false;
      a.standingOn = null;
    }
    if (a.kind === 'chicken') {
      a.flap = 1.4;
      fluff(g, a.x, a.y + 0.5, a.z, 4);
      hen = true;
    } else {
      if (a.wool >= 1 && fling > 0) fluff(g, a.x, a.y + 0.9, a.z, 3, WOOL_TINTS[a.tint] ?? [1, 1, 1]);
      ewe = true;
    }
  }
  const p = g.player;
  const v = Math.max(0.15, 0.8 - Math.hypot(p.x - x, p.z - z) / 40);
  if (hen) g.sfx('cluck', 'flesh', v, 1.2);
  if (ewe) g.sfx('baa', 'wool', v, 1.1);
}

export function updateAnimals(g: Game, dt: number): void {
  if (g.animals.length === 0) return;
  const grids = g.grids(true, false);
  const worldOnly = [grids[0]!];
  const deckGrid = grids[1]!;
  const F = g.fortress;
  const p = g.player;
  const pet = g.pet;
  for (const a of g.animals) {
    const hen = a.kind === 'chicken';
    a.hurt = Math.max(0, a.hurt - dt);
    a.panic = Math.max(0, a.panic - dt);
    a.flap = Math.max(0, a.flap - dt);
    a.munch = Math.max(0, a.munch - dt);
    a.head += ((a.munch > 0.2 ? 1 : 0) - a.head) * Math.min(1, dt * 5);
    // A shorn fleece grows back (faster while it grazes); it fluffs out when it is done.
    if (!hen && a.wool < 1) {
      a.wool = Math.min(1, a.wool + (dt / WOOL_REGROW) * (a.munch > 0 ? 2 : 1));
      if (a.wool >= 1) {
        fluff(g, a.x, a.y + 1, a.z, 8, WOOL_TINTS[a.tint] ?? [1, 1, 1]);
        if (Math.hypot(p.x - a.x, p.z - a.z) < 16) g.sfx('baa', 'wool', 0.5);
      }
    }
    // Pip comes bounding over: hens scatter (sheep just shuffle off).
    if (pet && !pet.a.dead && Math.hypot(pet.a.x - a.x, pet.a.z - a.z) < (pet.chase === a ? 3.2 : 1.6) && Math.abs(pet.a.y - a.y) < 2 && a.panic < 0.5) {
      a.panic = hen ? 1.6 : 1;
      a.wanderYaw = Math.atan2(a.z - pet.a.z, a.x - pet.a.x);
      if (hen) {
        a.flap = 1;
        if (Math.random() < 0.5) g.sfx('cluck', 'flesh', 0.5, 1.25);
      }
    }
    // A monster shambling past (on the deck at night, say): they scurry out of its way.
    if (a.panic < 0.3 && g.phase === 'night') {
      for (const m of g.mobs) {
        if (m.dead || m.fly || Math.abs(m.y - a.y) > 2 || Math.hypot(m.x - a.x, m.z - a.z) > 2.6) continue;
        a.panic = 1.2;
        a.wanderYaw = Math.atan2(a.z - m.z, a.x - m.x);
        if (hen) {
          a.flap = 1;
          g.sfx('cluck', 'flesh', 0.45, 1.3);
        }
        break;
      }
    }
    let dx = 0;
    let dz = 0;
    let speed = 0;
    const onDeck = a.standingOn === F;
    if (a.panic > 0) {
      // Running from the fright, zig-zagging (hens hop and flap as they go; not on the deck,
      // where a hop could carry her over the rail).
      const yaw = a.wanderYaw + Math.sin(g.time * 7 + a.homeX) * (hen ? 0.7 : 0.3);
      dx = Math.cos(yaw);
      dz = Math.sin(yaw);
      speed = a.boarded ? 1.6 : hen ? 3.3 : 2.6;
      if (hen && a.onGround && !a.boarded && Math.random() < dt * 1.8) {
        a.vy = 4.2;
        a.onGround = false;
        a.standingOn = null;
      }
    } else {
      a.idleTimer -= dt;
      if (a.idleTimer <= 0) {
        a.wandering = Math.random() < (hen ? 0.5 : 0.4);
        a.idleTimer = a.wandering ? 1.2 + Math.random() * 2.4 : 1.5 + Math.random() * 3.5;
        a.wanderYaw = Math.random() * Math.PI * 2;
        // Never far from home: the farm, the meadow (deck hens just potter about).
        const away = Math.hypot(a.x - a.homeX, a.z - a.homeZ);
        if (!onDeck && !a.boarded && away > (hen ? 6 : 9)) {
          a.wanderYaw = Math.atan2(a.homeZ - a.z, a.homeX - a.x);
          a.wandering = true;
        }
        // Sheep graze where they stand.
        if (!hen && !a.wandering) a.munch = Math.min(a.idleTimer, 2 + Math.random() * 2.5);
      }
      if (a.wandering) {
        dx = Math.cos(a.wanderYaw);
        dz = Math.sin(a.wanderYaw);
        speed = a.speed;
      } else if (hen && a.munch <= 0 && Math.random() < dt * 1.4) {
        // Hens peck in quick bursts.
        a.munch = 0.35;
      } else if (a.munch <= 0 && Math.hypot(p.x - a.x, p.z - a.z) < 4.5 && Math.abs(p.y - a.y) < 2.5) {
        // Curious: it turns to look at you.
        const want = Math.atan2(p.z - a.z, p.x - a.x);
        let d = want - a.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        a.yaw += d * Math.min(1, dt * 3);
      }
    }
    if (dx !== 0 || dz !== 0) {
      let d = Math.atan2(dz, dx) - a.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.yaw += d * Math.min(1, dt * 8);
    }
    const k = (a.onGround ? 12 : 3) * dt;
    a.vx = approach(a.vx, dx * speed, k * Math.max(1, Math.abs(a.vx)));
    a.vz = approach(a.vz, dz * speed, k * Math.max(1, Math.abs(a.vz)));
    // Water: they paddle and keep their heads up.
    a.wantJump = g.inWater(a);
    const result = moveActor(a, dt, grids, worldOnly, () => null, (x) => g.inWater(x), (x, nx, nz) => g.deckSupport(x, nx, nz));
    if (result.carrier) a.yaw += result.carrier.turned();
    if (result.hitWall && a.onGround && speed > 0) {
      const l = Math.hypot(dx, dz) || 1;
      const head = { x: a.x + (dx / l) * 0.4, y: a.y + 1.05, z: a.z + (dz / l) * 0.4, hw: a.hw, h: a.h };
      // (Deck hens never hop up: over the rail is a long way down.)
      if (!a.boarded && !grids.some((gr) => overlaps(head, gr, 0.02))) {
        a.vy = JUMP_V * (hen ? 0.72 : 0.82);
        a.onGround = false;
        a.standingOn = null;
      } else if (a.panic <= 0) {
        a.wanderYaw += Math.PI * (0.6 + Math.random() * 0.8);
        a.idleTimer = Math.min(a.idleTimer, 0.8);
      }
    }
    // A hen in the air flaps all the way down; a frog gets about in hops.
    if (hen && !a.onGround) a.flap = Math.max(a.flap, 0.2);
    if (a.kind === 'frog' && a.onGround && speed > 0 && Math.random() < dt * 3) {
      a.vy = 5.2;
      a.vx = dx * 3.2;
      a.vz = dz * 3.2;
      a.onGround = false;
      a.standingOn = null;
    }
    a.walkPhase += Math.hypot(a.vx, a.vz) * dt * (hen ? 2.4 : 1.4);
    // Their voices, now and then, when you are close.
    a.voice -= dt;
    if (a.voice <= 0) {
      a.voice = (hen ? 5 : a.kind === 'frog' ? 4 : 8) + Math.random() * 12;
      const d = Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
      // (Camels and llamas keep their thoughts to themselves.)
      const say = hen ? 'cluck' : a.kind === 'sheep' ? 'baa' : a.kind === 'frog' ? 'croak' : null;
      if (say && d < 14) g.sfx(say, hen ? 'flesh' : 'wool', Math.max(0.12, 0.6 - d / 28), 0.92 + Math.random() * 0.2);
    }
    // A hen set down on the deck has stowed away: she rides with you now.
    if (hen && onDeck && a.onGround && !a.boarded) {
      a.boarded = true;
      a.region = -1;
      feat(g, 'stowaway');
      if (g.animals.filter((o) => o.boarded).length >= 3) feat(g, 'flock');
      g.crewSay('stowaway');
    }
    // A building set down on top of her: she pops up onto its roof, ruffled.
    if (a.boarded && overlaps(a, deckGrid, 0.02)) {
      a.y += 1.05;
      a.vy = 2;
      a.flap = 1;
    }
    if (a.boarded && !onDeck && a.onGround && !fetchBack(g, a)) {
      // Nowhere left to stand aboard: she lives where she landed.
      a.boarded = false;
      a.homeX = a.x;
      a.homeZ = a.z;
    }
  }
  // Fallen out of the world, or left far behind: gone (the village fills up again next visit).
  g.animals = g.animals.filter((a) => a.y > -6 && (a.boarded || g.nearestDist(a.x, a.z) < 170));
}

// ------------------------------------------------------------------ hands-on

/** Scoops up a hen: she sits in your arms clucking (holding her, you glide down from any height). */
export function pickUpHen(g: Game, hen: Actor): void {
  if (g.carried) setDownHen(g, true);
  g.animals = g.animals.filter((a) => a !== hen);
  hen.vx = hen.vy = hen.vz = 0;
  hen.panic = 0;
  hen.munch = 0;
  hen.boarded = false;
  g.carried = hen;
  g.endHold();
  g.sfx('cluck', 'flesh', 0.9, 1.15);
  fluff(g, hen.x, hen.y + 0.5, hen.z, 5);
  g.villagerReact('hen', hen.x, hen.z);
  g.report('primary_input');
}

/** Sets the hen down in front of you (she flutters to the ground, or onto the deck). */
export function setDownHen(g: Game, quiet = false): void {
  const hen = g.carried;
  if (!hen) return;
  g.carried = null;
  const p = g.player;
  const fx = Math.cos(g.yaw);
  const fz = Math.sin(g.yaw);
  let x = p.x + fx * 0.75;
  let y = p.y + 0.9;
  let z = p.z + fz * 0.75;
  const grids = g.grids();
  if (grids.some((gr) => overlaps({ x, y, z, hw: hen.hw, h: hen.h }, gr, 0.01))) {
    x = p.x;
    y = p.y + 0.05;
    z = p.z;
  }
  hen.x = x;
  hen.y = y;
  hen.z = z;
  hen.vx = fx * (quiet ? 0.5 : 1.6);
  hen.vz = fz * (quiet ? 0.5 : 1.6);
  hen.vy = 1.5;
  hen.onGround = false;
  hen.standingOn = null;
  hen.climb = null;
  hen.yaw = g.yaw;
  hen.flap = 0.8;
  hen.panic = quiet ? 1.5 : 0;
  hen.homeX = x;
  hen.homeZ = z;
  hen.idleTimer = 1.5;
  g.animals.push(hen);
  if (!quiet) g.sfx('cluck', 'flesh', 0.7, 1.05);
}

/** Shears a woolly sheep (wool drops at its feet); a shorn one just gets a pat. */
export function shearSheep(g: Game, s: Actor): void {
  g.mining.swing = 0.25;
  g.report('primary_input');
  if (s.wool < 1) {
    for (let i = 0; i < 4; i += 1) {
      g.particles.add({ x: s.x + (Math.random() - 0.5) * 0.6, y: s.y + 1.5, z: s.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.6, vy: 1.3 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 1, size: 0.2, r: 1, g: 0.3, b: 0.42, a: 1, emit: 1, gravity: -0.4, drag: 1, tile: 'heart', soft: true });
    }
    g.sfx('baa', 'wool', 0.7, 1.1);
    if (s.wool < 0.5) g.toast('Her fleece is growing back', 'ui_sheep');
    return;
  }
  s.wool = 0;
  const pink = s.tint === 4;
  const n = pink ? 3 : 1 + Math.floor(Math.random() * 3);
  spawnDrop(g, pink ? B.RED_WOOL : B.WOOL, n, s.x, s.y + 0.9, s.z);
  fluff(g, s.x, s.y + 0.9, s.z, 14, WOOL_TINTS[s.tint] ?? [1, 1, 1]);
  g.sfx('shear', 'wool', 1);
  g.sfx('baa', 'wool', 0.6, 1.15);
  s.vy = 3.2;
  s.onGround = false;
  s.standingOn = null;
  s.munch = 0;
  s.panic = 0.6;
  s.wanderYaw = Math.atan2(s.z - g.player.z, s.x - g.player.x);
  g.xp(2);
  feat(g, 'haircut');
  if (pink) feat(g, 'pink');
  g.villagerReact('shear', s.x, s.z);
  g.report('visual_feedback');
}
