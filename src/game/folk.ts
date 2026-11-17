// The new folk of the Long March. Every village past the first two keeps an iron golem, which joins
// your fortress for emeralds once the village trusts you and then guards the deck, punching
// whatever climbs aboard clean off it. Some mornings a wandering trader comes down the trail with
// his two llamas, selling rare things for a day. Camels graze by the desert and canyon villages,
// and frogs croak round the swamp's pools.
import { B, I } from './blocks';
import { Actor, JUMP_V, moveActor } from './entities';
import { feat } from './feats';
import { approach, type Game } from './game';
import { canStepUp, damageMob, hostile, onFortress } from './mobs';
import type { Trade } from './quests';
import type { Site } from './terrain';

/** What a golem costs to take aboard (emeralds), and how many the deck can keep. */
export const GOLEM_PRICE = 8;
export const MAX_GOLEMS = 3;

/** The wandering trader's wares (four of them each day he comes). */
export const WANDERER_TRADES: Trade[] = [
  { id: 'w_totem', label: 'Totem of Undying', icon: 'totem_item', item: I.TOTEM, count: 1, price: 10 },
  { id: 'w_pearls', label: '3 Ender Pearls', icon: 'pearl_item', item: I.PEARL, count: 3, price: 4 },
  { id: 'w_potions', label: '2 Potions of Healing', icon: 'potion_item', item: I.POTION, count: 2, price: 4 },
  { id: 'w_wind', label: '4 Wind Charges', icon: 'wind_charge_item', item: I.WIND_CHARGE, count: 4, price: 3 },
  { id: 'w_heart', label: 'Heartstone', icon: 'heartstone_item', item: I.HEARTSTONE, count: 1, price: 14 },
  { id: 'w_tnt', label: '12 TNT', icon: 'tnt_side', item: I.TNT, count: 12, price: 5 },
  { id: 'w_obsidian', label: '6 Obsidian', icon: 'obsidian', item: B.OBSIDIAN, count: 6, price: 4 },
  { id: 'w_iron', label: '6 Iron Ingots', icon: 'iron_ingot', item: I.IRON_INGOT, count: 6, price: 5 },
];

/** Today's four offers (the same all day). */
export function wandererStock(g: Game): Trade[] {
  const list = [...WANDERER_TRADES];
  let seed = (g.seed * 31 + g.day * 977) >>> 0;
  const out: Trade[] = [];
  while (out.length < 4 && list.length > 0) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    out.push(list.splice(seed % list.length, 1)[0]!);
  }
  return out;
}

// ------------------------------------------------------------------ golems

/** The villages that keep a golem (the Long March's, from Stonewater on). */
function keepsGolem(g: Game, v: Site): boolean {
  return g.world.terrain.version >= 2 && v.index >= 2;
}

/** A village streams in: its golem by the well (unless it already serves aboard), camels or frogs. */
export function spawnVillageFolk(g: Game, v: Site): void {
  const zone = g.world.terrain.zone(v.x, v.z);
  if (keepsGolem(g, v) && !g.golemsTaken.has(v.index) && !g.villagers.some((o) => o.kind === 'golem' && o.region === v.index && !o.boarded)) {
    const x = v.x + 6;
    const z = v.z + 4;
    const golem = new Actor('golem', x, g.world.groundAt(x, z), z);
    golem.region = v.index;
    golem.home = 'golem';
    golem.homeX = x;
    golem.homeZ = z;
    golem.idleTimer = Math.random() * 3;
    // Now and then it holds a poppy (Minecraft's golems offer them to villagers).
    golem.aux = Math.random() < 0.5 ? 1 : 0;
    g.villagers.push(golem);
  }
  const kind = zone === 'desert' || zone === 'badlands' ? 'camel' : zone === 'swamp' ? 'frog' : null;
  if (!kind) return;
  const n = kind === 'camel' ? 2 : 5;
  for (let i = 0; i < n; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = v.x + (Math.random() - 0.5) * (kind === 'frog' ? 50 : 40);
    const z = v.z + side * (kind === 'frog' ? 20 + Math.random() * 20 : 24 + Math.random() * 8);
    const a = new Actor(kind, x, g.world.groundAt(x, z), z);
    a.region = v.index;
    a.yaw = Math.random() * Math.PI * 2;
    a.idleTimer = Math.random() * 3;
    a.voice = 3 + Math.random() * 10;
    g.animals.push(a);
  }
}

/** Free deck spots (fortress-local cells with headroom), for a golem to stand its guard on. */
function deckPost(g: Game): [number, number] | null {
  const F = g.fortress;
  const taken = g.villagers.filter((o) => o.kind === 'golem' && o.boarded).map((o) => F.toLocal(o.x, o.y, o.z));
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (const k of F.cells.keys()) {
    const y = Math.floor(k / 16384) - 64;
    if (y !== 0) continue;
    const x = (k % 128) - 64;
    const z = (Math.floor(k / 128) % 128) - 64;
    if (F.solidAt(x, 1, z) || F.solidAt(x, 2, z) || F.solidAt(x, 3, z) || F.hasBlock(x, 1, z)) continue;
    // Spread out, away from the middle (the rail is where they climb aboard).
    const spread = Math.min(99, ...taken.map((t) => Math.hypot(t[0] - x, t[2] - z)));
    const score = spread * 0.5 + Math.hypot(x - 7, z - 5) * 0.3 + Math.random() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = [x, z];
    }
  }
  return best;
}

function standOnDeck(g: Game, golem: Actor, x: number, z: number): void {
  const F = g.fortress;
  const [wx, wy, wz] = F.toWorld(x + 0.5, 1.002, z + 0.5);
  golem.x = wx;
  golem.y = wy;
  golem.z = wz;
  golem.vx = golem.vy = golem.vz = 0;
  golem.homeX = x + 0.5;
  golem.homeZ = z + 0.5;
  golem.standingOn = F;
  golem.onGround = true;
  golem.boarded = true;
}

/** The village's golem joins the fortress (its thanks, for emeralds). */
export function takeGolem(g: Game, golem: Actor): void {
  if (g.golemsTaken.size >= MAX_GOLEMS) {
    g.deny(`The deck can keep ${MAX_GOLEMS} golems: they have all the room they need`);
    return;
  }
  if (g.questState[golem.region] !== 'claimed') {
    g.deny('The golem guards this village: help it first (its quest), then it may come');
    return;
  }
  if (g.count(I.EMERALD) < GOLEM_PRICE) {
    g.deny(`The village asks ${GOLEM_PRICE} emeralds for its golem`);
    return;
  }
  const post = deckPost(g);
  if (!post) {
    g.deny('No room on the deck for a golem: clear a spot two blocks high');
    return;
  }
  g.useItem(I.EMERALD, GOLEM_PRICE);
  g.golemsTaken.add(golem.region);
  g.particles.poof(golem.x, golem.y + 1.4, golem.z, 12);
  standOnDeck(g, golem, post[0], post[1]);
  golem.region = -1;
  g.particles.poof(golem.x, golem.y + 1.4, golem.z, 12);
  g.sfx('clank', 'metal', 1, 0.7);
  g.ui.banner('A GOLEM JOINS YOU!', 'It guards the deck: whatever climbs aboard, it punches off', 'gold');
  feat(g, 'golem');
  g.save();
}

/** Golems that served aboard in a saved game come back with it. */
export function restoreGolems(g: Game): void {
  for (let i = 0; i < g.golemsTaken.size; i += 1) {
    const post = deckPost(g);
    if (!post) return;
    const golem = new Actor('golem', 0, 0, 0);
    golem.region = -1;
    golem.home = 'golem';
    standOnDeck(g, golem, post[0], post[1]);
    g.villagers.push(golem);
  }
}

/**
 * Golems aboard: each keeps its post on the deck; anything hostile that climbs aboard near it, it
 * strides over to and punches clean off the fortress (Minecraft's golem uppercut).
 */
export function updateGolems(g: Game, dt: number): void {
  const F = g.fortress;
  const grids = g.grids(true, false);
  const worldOnly = [grids[0]!];
  for (const golem of g.villagers) {
    if (golem.kind !== 'golem' || !golem.boarded) continue;
    golem.attackTimer -= dt;
    golem.hurt = Math.max(0, golem.hurt - dt);
    let target: Actor | null = null;
    let best = 9;
    for (const m of g.mobs) {
      if (m.dead || !hostile(m) || m.flying || m.boss) continue;
      if (!onFortress(g, m) && !(m.climb && m.climb.t > 0.6)) continue;
      const d = Math.hypot(m.x - golem.x, m.z - golem.z);
      if (d < best) {
        best = d;
        target = m;
      }
    }
    const [hx, , hz] = F.toWorld(golem.homeX, 1.002, golem.homeZ);
    const tx = target ? target.x : hx;
    const tz = target ? target.z : hz;
    let dx = tx - golem.x;
    let dz = tz - golem.z;
    const l = Math.hypot(dx, dz);
    if (target && l < 2.3 && golem.attackTimer <= 0) {
      // The uppercut: up and off the deck it goes.
      golem.attackTimer = 1;
      golem.yaw = Math.atan2(dz, dx);
      const k = 1 / (l || 1);
      damageMob(g, target, 14 + g.danger * 1.5, dx * k * 7, dz * k * 7);
      target.vy = Math.max(target.vy, 11);
      target.onGround = false;
      target.standingOn = null;
      target.climb = null;
      g.sfx('clank', 'metal', 0.9, 0.8);
      g.particles.sparks(target.x, target.y + 1, target.z, ['#ffffff', '#d0d0d0'], 6, 3, 0.08, 0.3);
    }
    const moving = target ? l > 1.8 : l > 0.4;
    if (moving) {
      dx /= l || 1;
      dz /= l || 1;
      golem.yaw = Math.atan2(dz, dx);
    } else {
      dx = 0;
      dz = 0;
    }
    const speed = target ? golem.speed : 1.2;
    golem.vx = approach(golem.vx, dx * speed, 12 * dt);
    golem.vz = approach(golem.vz, dz * speed, 12 * dt);
    const result = moveActor(golem, dt, grids, worldOnly, () => null, (a) => g.inWater(a), (a, x, z) => g.deckSupport(a, x, z));
    if (result.carrier) golem.yaw += result.carrier.turned();
    if (result.hitWall && golem.onGround && moving && canStepUp(golem, dx, dz, grids)) {
      golem.vy = JUMP_V;
      golem.onGround = false;
    }
    golem.walkPhase += Math.hypot(golem.vx, golem.vz) * dt * 1.3;
    // Knocked off the deck (a blast, a giant's shrug): it is lifted back to its post.
    if (golem.standingOn !== F && golem.onGround) standOnDeck(g, golem, golem.homeX - 0.5, golem.homeZ - 0.5);
  }
}

// ------------------------------------------------------------------ the wandering trader

/** The trader and his llamas for today (null: he did not come). */
export interface Wanderer {
  trader: Actor;
  llamas: Actor[];
  day: number;
}

/** Some mornings (from the second day on) he comes down the trail; at dusk he moves on. */
export function updateWanderer(g: Game): void {
  const w = g.wanderer;
  if (g.phase !== 'day') {
    if (w) dismissWanderer(g);
    return;
  }
  if (w) {
    if (!g.villagers.includes(w.trader)) dismissWanderer(g);
    return;
  }
  if (g.day < 2 || g.wandererDay === g.day) return;
  g.wandererDay = g.day;
  // Two mornings in three.
  if (((g.seed * 17 + g.day * 131) % 3) === 0) return;
  const c = g.fortressCentre();
  const T = g.world.terrain;
  const x = c[0] + 28;
  const z = T.centerZ(x) + 5;
  const trader = new Actor('wtrader', x, g.world.groundAt(x, z), z);
  trader.homeX = x;
  trader.homeZ = z;
  trader.region = -2;
  trader.home = 'wanderer';
  g.villagers.push(trader);
  const llamas: Actor[] = [];
  for (const side of [-1, 1]) {
    const lx = x - 1.5;
    const lz = z + side * 2.2;
    const llama = new Actor('llama', lx, g.world.groundAt(lx, lz), lz);
    llama.region = -2;
    llama.homeX = lx;
    llama.homeZ = lz;
    llama.yaw = Math.random() * Math.PI * 2;
    llama.voice = 99;
    g.animals.push(llama);
    llamas.push(llama);
  }
  g.wanderer = { trader, llamas, day: g.day };
  g.toast('A wandering trader comes down the trail with his llamas', 'ui_villager');
}

function dismissWanderer(g: Game): void {
  const w = g.wanderer;
  if (!w) return;
  g.villagers = g.villagers.filter((v) => v !== w.trader);
  g.animals = g.animals.filter((a) => !w.llamas.includes(a));
  for (const a of [w.trader, ...w.llamas]) g.particles.poof(a.x, a.y + 1, a.z, 6);
  g.wanderer = null;
}
