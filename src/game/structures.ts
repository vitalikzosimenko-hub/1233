// Buildings of the open world as voxel blueprints, rotated and placed at their sites. Every
// structure keeps its own cell list and id, so the generator can rasterise it chunk by chunk
// and the fortress crane can later hoist a whole village building onto the deck.
import { B, I } from './blocks';
import { mulberry32, type Rng } from './rng';
import { CS, CHUNKS_X, CHUNKS_Z, SEA, type SealSite, type Site, type Terrain } from './terrain';
import { expeditionStructures } from './landmarks';
import { nookStructure } from './nooks';

export type StructKind = 'house' | 'cottage' | 'windmill' | 'watchtower' | 'smithy' | 'farm' | 'well' | 'lamp' | 'castle' | 'citadel' | 'nest' | 'raidcamp' | 'cache' | 'mine' | 'lair' | 'treasure' | 'seal'
  // The expeditions' landmarks, and the small places off the trail.
  | 'wreck' | 'pyramid' | 'coven' | 'outlawfort' | 'forge' | 'cairn' | 'nook';

/** The quest each village of the classic valley sets (by village index): its camp in the woods is built to match. */
export const VILLAGE_QUESTS: ReadonlyArray<'fetch' | 'nest' | 'rescue'> = ['fetch', 'nest', 'rescue', 'nest', 'rescue'];

/** The Long March's fourteen villages and the help each asks for. */
const LONG_QUESTS: ReadonlyArray<'fetch' | 'nest' | 'rescue'> = ['fetch', 'nest', 'rescue', 'fetch', 'nest', 'rescue', 'fetch', 'rescue', 'nest', 'rescue', 'fetch', 'nest', 'rescue', 'nest'];

/** The quest a village sets in this world. */
export function questKind(terrain: Terrain, index: number): 'fetch' | 'nest' | 'rescue' {
  return (terrain.version >= 2 ? LONG_QUESTS[index] : VILLAGE_QUESTS[index]) ?? 'nest';
}

/** Village buildings the fortress crane can lift onto the deck, and what they become there. */
export const HOIST_INFO: Partial<Record<StructKind, { label: string; perk: string }>> = {
  house: { label: 'House', perk: '+2 crew bunks and armour' },
  cottage: { label: 'Cottage', perk: '+1 crew bunk and armour' },
  windmill: { label: 'Windmill', perk: 'Becomes a thruster tower: march faster' },
  watchtower: { label: 'Watchtower', perk: 'A TNT cannon turret' },
  smithy: { label: 'Smithy', perk: 'Crew repair twice as fast' },
  farm: { label: 'Farm', perk: 'Grows bread for the crew' },
};

export type Loot = Array<[item: number, count: number]>;

export interface Structure {
  id: string;
  kind: StructKind;
  name: string;
  site: Site;
  /** Door direction (DIRS index, 0 +x 1 -x 2 +z 3 -z). */
  front: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Floor level (world y of the foundation layer). */
  floorY: number;
  count: number;
  xs: Int16Array;
  ys: Int16Array;
  zs: Int16Array;
  ids: Uint8Array;
  metas: Int8Array;
  chests: Array<{ x: number; y: number; z: number; loot: Loot }>;
  villagers: Array<{ x: number; y: number; z: number }>;
  /** Hub of a windmill (world cell), for spinning sails once hoisted. */
  hub: { x: number; y: number; z: number } | null;
  /** Dug into the ground (mines, buried treasure): the terrain around it is kept, not cleared. */
  keep?: boolean;
}

// ------------------------------------------------------------------ blueprint builder

/** Blocks whose meta is a horizontal direction and turns with the building. */
export const DIRECTIONAL_IDS = new Set<number>([
  B.LADDER, B.TORCH, B.REDSTONE_TORCH, B.VINE, B.OAK_STAIRS, B.COBBLE_STAIRS, B.SPRUCE_STAIRS,
  B.FURNACE, B.CHEST, B.DISPENSER, B.CRAFTING_TABLE, B.HELM, B.WINDMILL_HUB,
]);
/** Blocks hung on a wall side (their meta's low bits), which turn with the building too. */
const SIDE_IDS = new Set<number>([B.SHUTTER, B.BANNER, B.PLANTER]);

/** DIRS index after one quarter turn (x, z) -> (-z, x). */
const TURN = [2, 3, 1, 0, 4, 5];

export function rotateDir(dir: number, rot: number): number {
  let d = dir;
  for (let i = 0; i < (rot & 3); i += 1) d = TURN[d] ?? d;
  return d;
}

export function rotXZ(x: number, z: number, rot: number): [number, number] {
  switch (rot & 3) {
    case 1:
      return [-z, x];
    case 2:
      return [-x, -z];
    case 3:
      return [z, -x];
    default:
      return [x, z];
  }
}

const KEY_OFF = 64;
function bkey(x: number, y: number, z: number): number {
  return (x + KEY_OFF) + 160 * ((z + KEY_OFF) + 160 * (y + KEY_OFF));
}

export class Blueprint {
  readonly cells = new Map<number, [x: number, y: number, z: number, id: number, meta: number]>();
  readonly chests: Array<[number, number, number, Loot]> = [];
  readonly villagers: Array<[number, number, number]> = [];
  hub: [number, number, number] | null = null;

  set(x: number, y: number, z: number, id: number, meta = -1): void {
    this.cells.set(bkey(x, y, z), [x, y, z, id, meta]);
  }

  get(x: number, y: number, z: number): number {
    return this.cells.get(bkey(x, y, z))?.[3] ?? -1;
  }

  del(x: number, y: number, z: number): void {
    this.cells.delete(bkey(x, y, z));
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = -1): void {
    for (let y = y0; y <= y1; y += 1) for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) this.set(x, y, z, id, meta);
  }

  /** The four side walls of a box (no floor or ceiling). */
  walls(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        this.set(x, y, z0, id);
        this.set(x, y, z1, id);
      }
      for (let z = z0; z <= z1; z += 1) {
        this.set(x0, y, z, id);
        this.set(x1, y, z, id);
      }
    }
  }

  chest(x: number, y: number, z: number, facing: number, loot: Loot): void {
    this.set(x, y, z, B.CHEST, facing);
    this.chests.push([x, y, z, loot]);
  }
}

// ------------------------------------------------------------------ loot

export function range(rng: Rng, a: number, b: number): number {
  return a + Math.floor(rng() * (b - a + 1));
}

function houseLoot(rng: Rng, rich: number): Loot {
  return [
    [I.BREAD, range(rng, 1, 3)],
    [I.COAL, range(rng, 2, 4)],
    [I.WHEAT_ITEM, range(rng, 1, 4)],
    [B.SAND, range(rng, 1, 3)],
    [I.TNT, range(rng, 0, 2) + Math.ceil(rich / 2)],
    [I.REDSTONE, range(rng, 1, 2)],
    [I.IRON_INGOT, range(rng, 0, 1) + Math.floor(rich / 2)],
  ];
}

function smithLoot(rng: Rng, rich: number): Loot {
  return [
    [I.IRON_INGOT, range(rng, 3, 5) + rich],
    [I.COAL, range(rng, 4, 7)],
    [I.REDSTONE, range(rng, 2, 4)],
    [I.GUNPOWDER, range(rng, 1, 3)],
    [I.TNT, range(rng, 2, 3)],
  ];
}

function towerLoot(rng: Rng, rich: number): Loot {
  return [
    [I.TNT, range(rng, 3, 5) + Math.ceil(rich / 2)],
    [I.EMERALD, range(rng, 0, 1)],
    [I.GUNPOWDER, range(rng, 2, 3)],
    [B.SAND, range(rng, 2, 3)],
    [I.REDSTONE, 2],
    [I.BREAD, 1],
  ];
}

function castleLoot(rng: Rng, rich: number): Loot {
  return [
    [I.TNT, range(rng, 4, 6) + rich],
    [I.EMERALD, range(rng, 1, 3)],
    [I.IRON_INGOT, range(rng, 2, 4) + rich],
    [I.GUNPOWDER, range(rng, 3, 5)],
    [I.REDSTONE, range(rng, 3, 6)],
    [I.BREAD, range(rng, 2, 3)],
    [B.LANTERN, range(rng, 1, 2)],
  ];
}

// ------------------------------------------------------------------ roofs & details

/**
 * Gable roof over x0..x1, z0..z1 with the ridge along x: stair rows climbing from both long
 * sides (overhanging one block), gable ends filled with `gable`.
 */
function gableRoof(bp: Blueprint, x0: number, x1: number, z0: number, z1: number, y: number, stairs: number, gable: number, ridge: number): number {
  let lo = z0 - 1;
  let hi = z1 + 1;
  let yy = y;
  while (lo < hi - 1) {
    for (let x = x0 - 1; x <= x1 + 1; x += 1) {
      bp.set(x, yy, lo, stairs, 2);
      bp.set(x, yy, hi, stairs, 3);
    }
    // Gable ends between the slopes, one layer below the stairs.
    for (let z = lo + 1; z <= hi - 1; z += 1) {
      if (yy > y) {
        bp.set(x0, yy, z, gable);
        bp.set(x1, yy, z, gable);
      }
    }
    lo += 1;
    hi -= 1;
    yy += 1;
  }
  if (lo === hi - 1) {
    for (let x = x0 - 1; x <= x1 + 1; x += 1) {
      bp.set(x, yy, lo, stairs, 2);
      bp.set(x, yy, hi, stairs, 3);
    }
    return yy;
  }
  for (let x = x0 - 1; x <= x1 + 1; x += 1) bp.set(x, yy, lo, ridge);
  return yy;
}

/** Pyramid roof of stairs over a square, ending in a centre block. */
function pyramidRoof(bp: Blueprint, x0: number, x1: number, z0: number, z1: number, y: number, stairs: number, cap: number): number {
  let a = x0 - 1;
  let b = x1 + 1;
  let c = z0 - 1;
  let d = z1 + 1;
  let yy = y;
  while (a < b && c < d) {
    for (let x = a; x <= b; x += 1) {
      bp.set(x, yy, c, stairs, 2);
      bp.set(x, yy, d, stairs, 3);
    }
    for (let z = c + 1; z <= d - 1; z += 1) {
      bp.set(a, yy, z, stairs, 0);
      bp.set(b, yy, z, stairs, 1);
    }
    a += 1;
    b -= 1;
    c += 1;
    d -= 1;
    yy += 1;
  }
  bp.set(Math.floor((x0 + x1) / 2), yy, Math.floor((z0 + z1) / 2), cap);
  return yy;
}

function hangingLantern(bp: Blueprint, x: number, y: number, z: number, chain = 0): void {
  for (let k = 0; k < chain; k += 1) bp.set(x, y + chain - k, z, B.CHAIN);
  bp.set(x, y, z, B.LANTERN, 1);
}

// ------------------------------------------------------------------ village buildings
// Local frame: the door faces +z; the floor (foundation) is y = 0.

function house(rng: Rng, rich: number): Blueprint {
  const bp = new Blueprint();
  const w = 7;
  const d = 7;
  bp.box(0, 0, 0, w - 1, 0, d - 1, B.COBBLE);
  bp.box(1, 0, 1, w - 2, 0, d - 2, B.PLANKS);
  bp.walls(0, 1, 0, w - 1, 4, d - 1, B.PLANKS);
  for (const [x, z] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]] as const) bp.box(x, 1, z, x, 4, z, B.LOG);
  // A log beam band under the eaves.
  for (let x = 0; x < w; x += 1) {
    bp.set(x, 4, 0, B.LOG);
    bp.set(x, 4, d - 1, B.LOG);
  }
  // Windows: two on each side wall, one each side of the door, one at the back.
  for (const z of [2, 4]) {
    bp.set(0, 2, z, B.GLASS);
    bp.set(w - 1, 2, z, B.GLASS);
  }
  bp.set(1, 2, d - 1, B.GLASS);
  bp.set(w - 2, 2, d - 1, B.GLASS);
  bp.set(3, 2, 0, B.GLASS);
  bp.set(3, 3, 0, B.GLASS);
  // Doorway with a step.
  bp.del(3, 1, d - 1);
  bp.del(3, 2, d - 1);
  bp.set(3, 0, d, B.COBBLE_STAIRS, 3);
  const roofTop = gableRoof(bp, 0, w - 1, 0, d - 1, 5, B.SPRUCE_STAIRS, B.PLANKS, B.SPRUCE_PLANKS);
  // Brick chimney through the back slope.
  for (let y = 1; y <= roofTop + 1; y += 1) bp.set(w - 2, y, 1, y <= 4 ? B.COBBLE : B.BRICKS);
  // Interior.
  bp.set(1, 1, 1, B.CRAFTING_TABLE, 2);
  bp.set(w - 2, 1, 2, B.FURNACE, 1);
  bp.chest(1, 1, d - 2, 0, houseLoot(rng, rich));
  bp.set(w - 2, 1, d - 2, B.BARREL);
  bp.set(2, 1, 1, B.BOOKSHELF);
  bp.set(3, 1, 1, B.BOOKSHELF);
  hangingLantern(bp, 3, roofTop - 3, 3, 2);
  // Porch lantern under the eave, flowers by the door.
  bp.set(5, 4, d, B.LANTERN, 1);
  bp.set(1, 1, d, B.POPPY);
  bp.set(5, 1, d, B.DANDELION);
  bp.villagers.push([3, 1, 3]);
  return bp;
}

function cottage(rng: Rng, rich: number): Blueprint {
  const bp = new Blueprint();
  const w = 5;
  const d = 6;
  bp.box(0, 0, 0, w - 1, 0, d - 1, B.COBBLE);
  bp.walls(0, 1, 0, w - 1, 3, d - 1, B.SPRUCE_PLANKS);
  for (const [x, z] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]] as const) bp.box(x, 1, z, x, 3, z, B.SPRUCE_LOG);
  bp.set(0, 2, 2, B.GLASS);
  bp.set(w - 1, 2, 3, B.GLASS);
  bp.del(2, 1, d - 1);
  bp.del(2, 2, d - 1);
  const top = gableRoof(bp, 0, w - 1, 0, d - 1, 4, B.OAK_STAIRS, B.PLANKS, B.PLANKS);
  bp.chest(1, 1, 1, 2, houseLoot(rng, rich));
  bp.set(3, 1, 1, B.CRAFTING_TABLE, 2);
  hangingLantern(bp, 2, top - 2, 2, 1);
  bp.set(4, 3, d, B.LANTERN, 1);
  bp.villagers.push([2, 1, 3]);
  return bp;
}

function windmill(): Blueprint {
  const bp = new Blueprint();
  bp.box(0, 0, 0, 4, 3, 4, B.COBBLE);
  bp.box(1, 1, 1, 3, 3, 3, B.AIR);
  bp.box(1, 0, 1, 3, 0, 3, B.PLANKS);
  bp.walls(0, 4, 0, 4, 10, 4, B.PLANKS);
  for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]] as const) bp.box(x, 4, z, x, 10, z, B.LOG);
  for (let x = 0; x <= 4; x += 1) {
    bp.set(x, 7, 0, B.LOG);
    bp.set(x, 7, 4, B.LOG);
  }
  bp.set(0, 5, 2, B.GLASS);
  bp.set(4, 8, 2, B.GLASS);
  bp.del(2, 1, 4);
  bp.del(2, 2, 4);
  for (let y = 1; y <= 10; y += 1) bp.set(2, y, 1, B.LADDER, 3);
  bp.box(1, 10, 1, 3, 10, 3, B.PLANKS);
  bp.del(2, 10, 1);
  pyramidRoof(bp, 0, 4, 0, 4, 11, B.SPRUCE_STAIRS, B.SPRUCE_PLANKS);
  // Hub on an axle out of the front wall, sails in the plane in front of it.
  const hx = 2;
  const hy = 8;
  bp.set(hx, hy, 5, B.LOG);
  bp.set(hx, hy, 6, B.WINDMILL_HUB, 2);
  bp.hub = [hx, hy, 6];
  const z = 7;
  for (let k = 1; k <= 6; k += 1) {
    bp.set(hx, hy + k, z, B.FENCE);
    bp.set(hx + k, hy, z, B.FENCE);
    if (hy - k >= 2) bp.set(hx, hy - k, z, B.FENCE);
    bp.set(hx - k, hy, z, B.FENCE);
  }
  for (let k = 2; k <= 6; k += 1) {
    bp.set(hx + 1, hy + k, z, B.WOOL);
    bp.set(hx + k, hy - 1, z, B.WOOL);
    if (hy - k >= 2) bp.set(hx - 1, hy - k, z, B.WOOL);
    bp.set(hx - k, hy + 1, z, B.WOOL);
  }
  bp.set(1, 1, 5, B.HAY);
  bp.set(3, 1, 5, B.HAY);
  bp.set(3, 2, 5, B.HAY);
  bp.set(1, 3, 5, B.LANTERN, 0);
  return bp;
}

function watchtower(rng: Rng, rich: number): Blueprint {
  const bp = new Blueprint();
  const top = 12;
  for (let y = 0; y < top; y += 1) {
    for (let x = 0; x <= 4; x += 1) {
      for (let z = 0; z <= 4; z += 1) {
        const edge = x === 0 || x === 4 || z === 0 || z === 4;
        const corner = (x === 0 || x === 4) && (z === 0 || z === 4);
        if (edge) bp.set(x, y, z, corner ? B.STONE_BRICKS : rng() < 0.18 ? B.MOSSY_STONE_BRICKS : rng() < 0.6 ? B.COBBLE : B.STONE_BRICKS);
        else if (y === 0) bp.set(x, y, z, B.PLANKS);
      }
    }
  }
  bp.del(2, 1, 4);
  bp.del(2, 2, 4);
  bp.set(2, 6, 4, B.GLASS);
  bp.set(0, 8, 2, B.GLASS);
  bp.set(4, 8, 2, B.GLASS);
  for (let y = 1; y <= top; y += 1) bp.set(2, y, 1, B.LADDER, 3);
  bp.box(-1, top, -1, 5, top, 5, B.SPRUCE_PLANKS);
  bp.del(2, top, 1);
  for (let x = -1; x <= 5; x += 1) {
    for (let z = -1; z <= 5; z += 1) {
      if (x === -1 || x === 5 || z === -1 || z === 5) bp.set(x, top + 1, z, B.FENCE);
    }
  }
  for (const [x, z] of [[-1, -1], [5, -1], [-1, 5], [5, 5]] as const) {
    bp.box(x, top + 1, z, x, top + 3, z, B.LOG);
  }
  const roof = pyramidRoof(bp, -1, 5, -1, 5, top + 4, B.SPRUCE_STAIRS, B.SPRUCE_PLANKS);
  void roof;
  bp.set(2, top + 1, 3, B.DISPENSER, 2);
  bp.chest(4, top + 1, 4, 1, towerLoot(rng, rich));
  hangingLantern(bp, 0, top + 3, 2, 0);
  hangingLantern(bp, 4, top + 3, 2, 0);
  bp.set(1, 4, 1, B.TORCH, 1);
  return bp;
}

function smithy(rng: Rng, rich: number): Blueprint {
  const bp = new Blueprint();
  const w = 9;
  const d = 7;
  bp.box(0, 0, 0, w - 1, 0, d - 1, B.COBBLE);
  bp.walls(0, 1, 0, w - 1, 4, d - 1, B.STONE_BRICKS);
  for (const [x, z] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]] as const) bp.box(x, 1, z, x, 4, z, B.COBBLE);
  // Wide open workshop front.
  for (let x = 2; x <= 6; x += 1) {
    bp.del(x, 1, d - 1);
    bp.del(x, 2, d - 1);
    bp.del(x, 3, d - 1);
  }
  bp.set(2, 3, d - 1, B.SPRUCE_LOG);
  bp.set(6, 3, d - 1, B.SPRUCE_LOG);
  for (let x = 2; x <= 6; x += 1) bp.set(x, 4, d - 1, B.SPRUCE_LOG);
  bp.set(0, 2, 3, B.GLASS);
  bp.set(w - 1, 2, 3, B.GLASS);
  const roofTop = gableRoof(bp, 0, w - 1, 0, d - 1, 5, B.COBBLE_STAIRS, B.STONE_BRICKS, B.STONE_BRICKS);
  // Forge: a glowing hearth under a brick hood and chimney.
  bp.box(1, 1, 1, 2, 1, 2, B.COBBLE);
  bp.set(1, 1, 1, B.GLOWSTONE);
  bp.set(2, 1, 1, B.GLOWSTONE);
  for (let y = 2; y <= roofTop + 2; y += 1) {
    bp.set(1, y, 1, B.BRICKS);
    bp.set(2, y, 1, B.BRICKS);
  }
  bp.set(4, 1, 1, B.FURNACE, 2);
  bp.set(5, 1, 1, B.FURNACE, 2);
  bp.set(7, 1, 1, B.IRON_BLOCK);
  bp.chest(7, 1, 4, 1, smithLoot(rng, rich));
  bp.set(7, 1, 2, B.BARREL);
  bp.set(1, 1, 4, B.CRAFTING_TABLE, 0);
  hangingLantern(bp, 4, 4, 3, 0);
  bp.villagers.push([4, 1, 4]);
  return bp;
}

function farm(rng: Rng): Blueprint {
  const bp = new Blueprint();
  const w = 9;
  const d = 7;
  for (let x = 0; x < w; x += 1) {
    for (let z = 0; z < d; z += 1) {
      const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;
      if (edge) {
        bp.set(x, 0, z, B.SPRUCE_LOG);
        if (!(z === d - 1 && x === 4)) bp.set(x, 1, z, B.FENCE);
      } else if (x === 4) {
        bp.set(x, 0, z, B.WATER);
      } else {
        bp.set(x, 0, z, B.FARMLAND);
        if (rng() < 0.92) bp.set(x, 1, z, B.WHEAT);
      }
    }
  }
  bp.set(0, 2, 0, B.LANTERN, 0);
  bp.set(w - 1, 2, d - 1, B.LANTERN, 0);
  bp.set(w, 0, 1, B.HAY);
  bp.set(w, 1, 1, B.HAY);
  bp.set(w, 0, 2, B.HAY);
  return bp;
}

function well(): Blueprint {
  const bp = new Blueprint();
  bp.box(0, -2, 0, 3, 1, 3, B.COBBLE);
  bp.box(1, -2, 1, 2, 0, 2, B.WATER);
  bp.box(1, 1, 1, 2, 1, 2, B.AIR);
  for (const [x, z] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) bp.box(x, 2, z, x, 3, z, B.FENCE);
  for (let x = -1; x <= 4; x += 1) {
    bp.set(x, 4, -1, B.COBBLE_STAIRS, 2);
    bp.set(x, 4, 4, B.COBBLE_STAIRS, 3);
    bp.set(x, 5, 0, B.COBBLE_STAIRS, 2);
    bp.set(x, 5, 3, B.COBBLE_STAIRS, 3);
  }
  for (let x = 0; x <= 3; x += 1) {
    bp.set(x, 4, 0, B.COBBLE);
    bp.set(x, 4, 3, B.COBBLE);
    bp.set(x, 6, 1, B.COBBLE_STAIRS, 2);
    bp.set(x, 6, 2, B.COBBLE_STAIRS, 3);
  }
  bp.set(1, 3, 1, B.CHAIN);
  bp.set(1, 2, 1, B.LANTERN, 1);
  return bp;
}

function lamp(): Blueprint {
  const bp = new Blueprint();
  bp.set(0, 0, 0, B.COBBLE);
  bp.box(0, 1, 0, 0, 3, 0, B.FENCE);
  bp.set(0, 4, 0, B.LANTERN, 0);
  return bp;
}

// ------------------------------------------------------------------ deck modules
// The compact versions village buildings packed down into aboard in games from before the hold (see
// hold.ts): kept so those games can find them on the deck and move them into the hold. Same frame as
// the buildings: the door faces +z, the floor is y = 0.

function houseModule(): Blueprint {
  const bp = new Blueprint();
  bp.box(0, 0, 0, 4, 0, 3, B.COBBLE);
  bp.box(1, 0, 1, 3, 0, 2, B.PLANKS);
  bp.walls(0, 1, 0, 4, 2, 3, B.PLANKS);
  for (const [x, z] of [[0, 0], [4, 0], [0, 3], [4, 3]] as const) bp.box(x, 1, z, x, 2, z, B.LOG);
  // The door between two windows, a window in each gable wall and one at the back.
  bp.del(2, 1, 3);
  bp.del(2, 2, 3);
  bp.set(1, 2, 3, B.GLASS);
  bp.set(3, 2, 3, B.GLASS);
  bp.set(0, 2, 1, B.GLASS);
  bp.set(4, 2, 2, B.GLASS);
  bp.set(2, 2, 0, B.GLASS);
  // A spruce gable roof, plank gables and a brick chimney up through the back slope.
  for (let x = 0; x <= 4; x += 1) {
    bp.set(x, 3, 0, B.SPRUCE_STAIRS, 2);
    bp.set(x, 3, 3, B.SPRUCE_STAIRS, 3);
    bp.set(x, 4, 1, B.SPRUCE_STAIRS, 2);
    bp.set(x, 4, 2, B.SPRUCE_STAIRS, 3);
  }
  for (const x of [0, 4]) {
    bp.set(x, 3, 1, B.PLANKS);
    bp.set(x, 3, 2, B.PLANKS);
  }
  for (let y = 3; y <= 5; y += 1) bp.set(3, y, 0, B.BRICKS);
  return bp;
}

function cottageModule(): Blueprint {
  const bp = new Blueprint();
  bp.box(0, 0, 0, 3, 0, 2, B.COBBLE);
  bp.walls(0, 1, 0, 3, 2, 2, B.SPRUCE_PLANKS);
  for (const [x, z] of [[0, 0], [3, 0], [0, 2], [3, 2]] as const) bp.box(x, 1, z, x, 2, z, B.SPRUCE_LOG);
  bp.del(1, 1, 2);
  bp.del(1, 2, 2);
  bp.set(2, 2, 2, B.GLASS);
  bp.set(0, 2, 1, B.GLASS);
  bp.set(3, 2, 1, B.GLASS);
  for (let x = 0; x <= 3; x += 1) {
    bp.set(x, 3, 0, B.OAK_STAIRS, 2);
    bp.set(x, 3, 2, B.OAK_STAIRS, 3);
    bp.set(x, 4, 1, B.PLANKS);
  }
  bp.set(0, 3, 1, B.PLANKS);
  bp.set(3, 3, 1, B.PLANKS);
  return bp;
}

function windmillModule(): Blueprint {
  const bp = new Blueprint();
  // A cobble base with its door, a plank tower on log corners and a spruce cap.
  bp.box(0, 0, 0, 2, 1, 2, B.COBBLE);
  bp.del(1, 1, 2);
  bp.walls(0, 2, 0, 2, 4, 2, B.PLANKS);
  for (const [x, z] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) bp.box(x, 2, z, x, 4, z, B.LOG);
  bp.set(0, 3, 1, B.GLASS);
  bp.set(2, 3, 1, B.GLASS);
  for (let x = 0; x <= 2; x += 1) {
    bp.set(x, 5, 0, B.SPRUCE_STAIRS, 2);
    bp.set(x, 5, 2, B.SPRUCE_STAIRS, 3);
  }
  bp.set(0, 5, 1, B.SPRUCE_STAIRS, 0);
  bp.set(2, 5, 1, B.SPRUCE_STAIRS, 1);
  bp.set(1, 5, 1, B.SPRUCE_PLANKS);
  bp.set(1, 6, 1, B.SPRUCE_PLANKS);
  // The hub on its axle out of the front wall (the sails turn on it), a hay bale by the door.
  bp.set(1, 3, 3, B.LOG);
  bp.set(1, 3, 4, B.WINDMILL_HUB, 2);
  bp.hub = [1, 3, 4];
  bp.set(0, 0, 3, B.HAY);
  return bp;
}

function towerModule(): Blueprint {
  const bp = new Blueprint();
  // A stone tower with a doorway; on its platform the cannon between four merlons.
  for (let y = 0; y <= 3; y += 1) {
    for (let x = 0; x <= 2; x += 1) {
      for (let z = 0; z <= 2; z += 1) {
        if (x === 1 && z === 1) {
          if (y === 0) bp.set(x, y, z, B.PLANKS);
          continue;
        }
        const corner = (x === 0 || x === 2) && (z === 0 || z === 2);
        bp.set(x, y, z, corner ? B.STONE_BRICKS : (x + y * 2 + z) % 3 === 0 ? B.MOSSY_STONE_BRICKS : B.COBBLE);
      }
    }
  }
  bp.del(1, 1, 2);
  bp.del(1, 2, 2);
  bp.set(1, 3, 0, B.GLASS);
  bp.box(0, 4, 0, 2, 4, 2, B.SPRUCE_PLANKS);
  for (const [x, z] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) bp.set(x, 5, z, B.STONE_BRICKS);
  bp.set(0, 6, 0, B.LANTERN, 0);
  bp.set(2, 6, 2, B.LANTERN, 0);
  bp.set(1, 5, 1, B.DISPENSER, 2);
  // A ladder up the back to the gun.
  for (let y = 0; y <= 4; y += 1) bp.set(1, y, -1, B.LADDER, 2);
  return bp;
}

function smithyModule(): Blueprint {
  const bp = new Blueprint();
  // A stone forge open at the front: the glowing hearth, a furnace and an anvil under a stone roof.
  bp.box(0, 0, 0, 3, 0, 2, B.COBBLE);
  for (let y = 1; y <= 2; y += 1) {
    for (let x = 0; x <= 3; x += 1) bp.set(x, y, 0, B.STONE_BRICKS);
    bp.set(0, y, 1, B.STONE_BRICKS);
    bp.set(3, y, 1, B.STONE_BRICKS);
    bp.set(0, y, 2, B.COBBLE);
    bp.set(3, y, 2, B.COBBLE);
  }
  bp.set(1, 2, 2, B.SPRUCE_LOG);
  bp.set(2, 2, 2, B.SPRUCE_LOG);
  bp.set(1, 1, 1, B.GLOWSTONE);
  bp.set(2, 1, 1, B.FURNACE, 2);
  bp.set(2, 1, 2, B.IRON_BLOCK);
  for (let x = 0; x <= 3; x += 1) {
    bp.set(x, 3, 0, B.COBBLE_STAIRS, 2);
    bp.set(x, 3, 2, B.COBBLE_STAIRS, 3);
    bp.set(x, 4, 1, B.STONE_BRICKS);
  }
  bp.set(0, 3, 1, B.STONE_BRICKS);
  bp.set(3, 3, 1, B.STONE_BRICKS);
  for (let y = 3; y <= 5; y += 1) bp.set(1, y, 0, B.BRICKS);
  return bp;
}

function farmModule(): Blueprint {
  const bp = new Blueprint();
  // A fenced planter on a log frame: wheat either side of a water channel, two corner lanterns.
  for (let x = 0; x <= 4; x += 1) {
    for (let z = 0; z <= 3; z += 1) {
      if (x === 0 || x === 4 || z === 0 || z === 3) {
        bp.set(x, 0, z, B.SPRUCE_LOG);
        if (!(z === 3 && x === 2)) bp.set(x, 1, z, B.FENCE);
      } else if (x === 2) {
        bp.set(x, 0, z, B.WATER);
      } else {
        bp.set(x, 0, z, B.FARMLAND);
        bp.set(x, 1, z, B.WHEAT);
      }
    }
  }
  bp.set(0, 2, 0, B.LANTERN, 0);
  bp.set(4, 2, 3, B.LANTERN, 0);
  return bp;
}

/** A compact deck module: its cells (as the building stood, cornered at 0, 0, 0), size and windmill hub. */
export interface DeckModule {
  cells: Array<[number, number, number, number, number]>;
  w: number;
  d: number;
  hub: [number, number, number] | null;
}

/** The compact version a village building packs down into aboard: facing as it stood, in its land's materials. */
export function deckModule(s: Structure, terrain: Terrain): DeckModule | null {
  const make: Partial<Record<StructKind, () => Blueprint>> = {
    house: houseModule, cottage: cottageModule, windmill: windmillModule, watchtower: towerModule, smithy: smithyModule, farm: farmModule,
  };
  const bp = make[s.kind]?.();
  if (!bp) return null;
  let rot = 0;
  while (rot < 3 && rotateDir(2, rot) !== s.front) rot += 1;
  const pal = regionPalette(terrain.zone(s.site.x, s.site.z));
  const cells: DeckModule['cells'] = [];
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, y, z, id, meta] of bp.cells.values()) {
    if (id <= 0) continue;
    const [a, b] = rotXZ(x, z, rot);
    cells.push([a, y, b, pal?.get(id) ?? id, meta >= 0 && DIRECTIONAL_IDS.has(id) ? rotateDir(meta, rot) : Math.max(0, meta)]);
    x0 = Math.min(x0, a);
    z0 = Math.min(z0, b);
    x1 = Math.max(x1, a);
    z1 = Math.max(z1, b);
  }
  for (const c of cells) {
    c[0] -= x0;
    c[2] -= z0;
  }
  let hub: DeckModule['hub'] = null;
  if (bp.hub) {
    const [a, b] = rotXZ(bp.hub[0], bp.hub[2], rot);
    hub = [a - x0, bp.hub[1], b - z0];
  }
  return { cells, w: x1 - x0 + 1, d: z1 - z0 + 1, hub };
}

// ------------------------------------------------------------------ ruins

function castle(rng: Rng, rich: number): Blueprint {
  const bp = new Blueprint();
  const S = 17;
  const wall = (): number => {
    const r = rng();
    return r < 0.25 ? B.MOSSY_STONE_BRICKS : r < 0.4 ? B.CRACKED_STONE_BRICKS : r < 0.5 ? B.COBBLE : B.STONE_BRICKS;
  };
  bp.box(0, 0, 0, S - 1, 0, S - 1, B.STONE_BRICKS);
  for (let y = 1; y <= 6; y += 1) {
    for (let i = 0; i < S; i += 1) {
      for (const [x, z] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]] as const) bp.set(x, y, z, wall());
    }
  }
  // Battlements.
  for (let i = 0; i < S; i += 2) for (const [x, z] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]] as const) bp.set(x, 7, z, wall());
  // Corner towers.
  for (const [tx, tz] of [[-1, -1], [S - 4, -1], [-1, S - 4], [S - 4, S - 4]] as const) {
    for (let y = 0; y <= 10; y += 1) {
      for (let x = tx; x < tx + 5; x += 1) {
        for (let z = tz; z < tz + 5; z += 1) {
          const edge = x === tx || x === tx + 4 || z === tz || z === tz + 4;
          if (edge) bp.set(x, y, z, wall());
          else if (y === 0 || y === 7) bp.set(x, y, z, B.SPRUCE_PLANKS);
          else bp.set(x, y, z, B.AIR);
        }
      }
    }
    for (let x = tx; x < tx + 5; x += 2) for (const z of [tz, tz + 4]) bp.set(x, 11, z, wall());
    for (let z = tz; z < tz + 5; z += 2) for (const x of [tx, tx + 4]) bp.set(x, 11, z, wall());
    bp.set(tx + 2, 8, tz + 2, B.LANTERN, 0);
  }
  // Gate in the +z wall.
  for (let x = 7; x <= 9; x += 1) for (let y = 1; y <= 4; y += 1) bp.del(x, y, S - 1);
  // Keep in the middle.
  const k0 = 5;
  const k1 = 11;
  for (let y = 1; y <= 9; y += 1) {
    for (let x = k0; x <= k1; x += 1) {
      for (let z = k0; z <= k1; z += 1) {
        const edge = x === k0 || x === k1 || z === k0 || z === k1;
        if (edge) bp.set(x, y, z, wall());
        else if (y === 5) bp.set(x, y, z, B.SPRUCE_PLANKS);
      }
    }
  }
  for (let y = 1; y <= 2; y += 1) bp.del(8, y, k1);
  for (let y = 1; y <= 9; y += 1) bp.set(k0 + 1, y, k0 + 1, B.LADDER, 1);
  bp.del(k0 + 1, 5, k0 + 1);
  bp.chest(k1 - 1, 1, k0 + 1, 1, castleLoot(rng, rich));
  bp.chest(k1 - 1, 6, k1 - 1, 1, castleLoot(rng, rich));
  bp.set(k0 + 3, 4, k0 + 3, B.LANTERN, 1);
  for (let x = k0; x <= k1; x += 2) for (const z of [k0, k1]) bp.set(x, 10, z, wall());
  // Ruin: knock holes in the walls and let vines creep over them.
  for (let n = 0; n < 50; n += 1) {
    const x = Math.floor(rng() * S);
    const z = rng() < 0.5 ? (rng() < 0.5 ? 0 : S - 1) : Math.floor(rng() * S);
    const y = 3 + Math.floor(rng() * 6);
    for (let dy = 0; dy < 3; dy += 1) bp.del(x, y + dy, z);
  }
  for (let n = 0; n < 60; n += 1) {
    const side = Math.floor(rng() * 4);
    const i = 1 + Math.floor(rng() * (S - 2));
    const y = 2 + Math.floor(rng() * 5);
    const [x, z, dir] = side === 0 ? [i, -1, 2] : side === 1 ? [i, S, 3] : side === 2 ? [-1, i, 0] : [S, i, 1];
    if (bp.get(x - (dir === 0 ? -1 : dir === 1 ? 1 : 0), y, z - (dir === 2 ? -1 : dir === 3 ? 1 : 0)) > 0) bp.set(x, y, z, B.VINE, dir);
  }
  return bp;
}

function citadel(rng: Rng): Blueprint {
  const bp = new Blueprint();
  const S = 33;
  const dark = (): number => {
    const r = rng();
    return r < 0.35 ? B.OBSIDIAN : r < 0.6 ? B.MOSSY_STONE_BRICKS : r < 0.75 ? B.CRACKED_STONE_BRICKS : B.STONE_BRICKS;
  };
  bp.box(0, 0, 0, S - 1, 0, S - 1, B.OBSIDIAN);
  for (let y = 1; y <= 10; y += 1) for (let i = 0; i < S; i += 1) for (const [x, z] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]] as const) bp.set(x, y, z, dark());
  for (let i = 0; i < S; i += 2) for (const [x, z] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]] as const) bp.set(x, 11, z, dark());
  // Gate facing west (-x), toward the approaching fortress.
  for (let z = 14; z <= 18; z += 1) for (let y = 1; y <= 7; y += 1) bp.del(0, y, z);
  // Corner towers crowned with glowstone.
  for (const [tx, tz] of [[-2, -2], [S - 5, -2], [-2, S - 5], [S - 5, S - 5]] as const) {
    for (let y = 0; y <= 16; y += 1) {
      for (let x = tx; x < tx + 7; x += 1) {
        for (let z = tz; z < tz + 7; z += 1) {
          const edge = x === tx || x === tx + 6 || z === tz || z === tz + 6;
          if (edge) bp.set(x, y, z, dark());
          else bp.set(x, y, z, y === 0 ? B.OBSIDIAN : B.AIR);
        }
      }
    }
    bp.box(tx + 2, 17, tz + 2, tx + 4, 17, tz + 4, B.GLOWSTONE);
  }
  // Central spire with the Citadel Heart caged at the top.
  const c0 = 11;
  const c1 = 21;
  for (let y = 1; y <= 26; y += 1) {
    const inset = y > 18 ? 2 : 0;
    for (let x = c0 + inset; x <= c1 - inset; x += 1) {
      for (let z = c0 + inset; z <= c1 - inset; z += 1) {
        const edge = x === c0 + inset || x === c1 - inset || z === c0 + inset || z === c1 - inset;
        if (edge) bp.set(x, y, z, dark());
      }
    }
  }
  for (let y = 1; y <= 4; y += 1) for (let z = 15; z <= 17; z += 1) bp.del(c0, y, z);
  bp.box(c0 + 3, 27, c0 + 3, c1 - 3, 27, c1 - 3, B.OBSIDIAN);
  bp.box(15, 28, 15, 17, 30, 17, B.CITADEL_HEART);
  for (const [x, z] of [[14, 14], [18, 14], [14, 18], [18, 18]] as const) bp.box(x, 28, z, x, 31, z, B.OBSIDIAN);
  bp.box(14, 32, 14, 18, 32, 18, B.OBSIDIAN);
  for (let n = 0; n < 30; n += 1) bp.set(c0 + 1 + Math.floor(rng() * 9), 1 + Math.floor(rng() * 20), c0 + (rng() < 0.5 ? 0 : 10), B.GLOWSTONE);
  return bp;
}

// ------------------------------------------------------------------ quest camps

/** A lost village strongbox in a ruined woodland shrine. */
function cache(rng: Rng): Blueprint {
  const bp = new Blueprint();
  for (let z = -3; z <= 3; z += 1) {
    for (let x = -3; x <= 3; x += 1) {
      if (Math.abs(x) === 3 && Math.abs(z) === 3) continue;
      if (rng() < 0.2) continue;
      bp.set(x, 0, z, rng() < 0.5 ? B.MOSSY_STONE_BRICKS : B.CRACKED_STONE_BRICKS);
    }
  }
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
    const h = 1 + Math.floor(rng() * 3);
    for (let y = 1; y <= h; y += 1) bp.set(x, y, z, y === h && rng() < 0.5 ? B.MOSSY_COBBLE : B.STONE_BRICKS);
  }
  bp.set(0, 0, 0, B.STONE_BRICKS);
  bp.chest(0, 1, 0, 2, [[I.STRONGBOX, 1], [I.EMERALD, range(rng, 1, 2)], [I.TNT, 2], [I.BREAD, 1]]);
  bp.set(-1, 1, 1, B.VINE, 3);
  return bp;
}

/** A spider nest: a mound of mossy rubble strung with cobwebs round a spawner cage. */
function nest(rng: Rng): Blueprint {
  const bp = new Blueprint();
  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const d = Math.hypot(x, z) + (rng() - 0.5) * 1.2;
      if (d > 4.3) continue;
      const h = d < 1.6 ? 1 : d < 3 ? 2 : d < 3.8 ? 1 : 0;
      for (let y = 0; y <= h; y += 1) bp.set(x, y, z, rng() < 0.45 ? B.MOSSY_COBBLE : rng() < 0.5 ? B.COBBLE : B.GRAVEL);
    }
  }
  // A hollow in the middle holds the spawner.
  bp.del(0, 2, 0);
  bp.set(0, 1, 0, B.COBBLE);
  bp.set(0, 2, 0, B.SPAWNER);
  for (let n = 0; n < 22; n += 1) {
    const x = Math.floor((rng() - 0.5) * 9);
    const z = Math.floor((rng() - 0.5) * 9);
    const y = 2 + Math.floor(rng() * 3);
    if (bp.get(x, y, z) < 0 && !(x === 0 && z === 0)) bp.set(x, y, z, B.COBWEB);
  }
  return bp;
}

/** Raiders' camp: a log palisade, a striped tent, a fire, and a captive in a pen. */
function raidcamp(rng: Rng): Blueprint {
  const bp = new Blueprint();
  for (let z = -5; z <= 5; z += 1) {
    for (let x = -5; x <= 5; x += 1) {
      const d = Math.hypot(x, z);
      if (d > 5.6) continue;
      bp.set(x, 0, z, rng() < 0.3 ? B.GRAVEL : B.PATH);
      // The palisade ring, open on the +x side.
      if (d > 4.6 && !(x >= 4 && Math.abs(z) <= 1)) {
        const h = 2 + (rng() < 0.4 ? 1 : 0);
        for (let y = 1; y <= h; y += 1) bp.set(x, y, z, B.SPRUCE_LOG);
      }
    }
  }
  // Tent of white and red wool.
  for (let x = -3; x <= -1; x += 1) {
    for (let y = 1; y <= 3; y += 1) {
      const half = 3 - y;
      for (let z = -half; z <= half; z += 1) if (Math.abs(z) === half || y === 3) bp.set(x, y, z, (x + y) % 2 === 0 ? B.RED_WOOL : B.WOOL);
    }
  }
  // Campfire.
  bp.set(1, 1, -2, B.COBBLE);
  bp.set(1, 2, -2, B.LANTERN, 0);
  // The captive's pen (fences), with a loot chest of what the raiders took.
  for (const [x, z] of [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3], [1, 2], [3, 2]] as const) bp.set(x, 1, z, B.FENCE);
  bp.villagers.push([2, 1, 2]);
  bp.chest(-2, 1, 3, 3, [[I.EMERALD, range(rng, 1, 3)], [I.IRON_INGOT, range(rng, 1, 2)], [I.TNT, 2]]);
  return bp;
}

/** An abandoned mine: a timbered tunnel with rails running into the hillside to a spawner den. */
function mine(rng: Rng): Blueprint {
  const bp = new Blueprint();
  const L = 28;
  for (let z = 0; z <= L; z += 1) {
    for (let x = -1; x <= 1; x += 1) {
      bp.set(x, 0, z, rng() < 0.15 ? B.GRAVEL : B.PLANKS);
      for (let y = 1; y <= 3; y += 1) bp.set(x, y, z, B.AIR);
    }
    bp.set(0, 1, z, B.RAIL);
    // Timber frames every few steps; cobwebs gather in their corners.
    if (z % 5 === 1) {
      for (let y = 1; y <= 2; y += 1) {
        bp.set(-1, y, z, B.FENCE);
        bp.set(1, y, z, B.FENCE);
      }
      for (let x = -1; x <= 1; x += 1) bp.set(x, 3, z, B.PLANKS);
      if (z > 4 && rng() < 0.6) bp.set(rng() < 0.5 ? -1 : 1, 2, z + 1, B.COBWEB);
      if (z > 2 && rng() < 0.5) bp.set(0, 2, z, B.LANTERN, 1);
    }
  }
  // The mouth: a log frame in the hillside.
  for (let y = 1; y <= 3; y += 1) {
    bp.set(-2, y, 0, B.LOG);
    bp.set(2, y, 0, B.LOG);
  }
  for (let x = -2; x <= 2; x += 1) bp.set(x, 4, 0, B.LOG);
  // The den at the end: a rough chamber, a spawner and the miners' last chest.
  for (let z = L + 1; z <= L + 6; z += 1) {
    for (let x = -3; x <= 3; x += 1) {
      bp.set(x, 0, z, rng() < 0.3 ? B.GRAVEL : B.COBBLE);
      for (let y = 1; y <= 4; y += 1) bp.set(x, y, z, Math.abs(x) === 3 && y > 2 && rng() < 0.5 ? B.COBWEB : B.AIR);
    }
  }
  bp.set(0, 1, L + 4, B.SPAWNER);
  bp.chest(2, 1, L + 5, 3, [[I.TREASURE_MAP, 1], [I.IRON_INGOT, range(rng, 2, 4)], [I.COAL, range(rng, 3, 6)], [I.EMERALD, range(rng, 1, 3)], [I.TNT, range(rng, 2, 4)]]);
  bp.chest(-2, 1, L + 5, 3, [[I.GUNPOWDER, range(rng, 2, 4)], [I.REDSTONE, range(rng, 2, 4)], [B.RAIL, 4]]);
  return bp;
}

/** A giant's lair: a crater of tumbled boulders round a hoard. */
function lair(rng: Rng): Blueprint {
  const bp = new Blueprint();
  for (let n = 0; n < 26; n += 1) {
    const a = (n / 26) * Math.PI * 2 + rng() * 0.2;
    const r = 7 + rng() * 1.6;
    const x = Math.round(Math.cos(a) * r);
    const z = Math.round(Math.sin(a) * r);
    const h = 1 + Math.floor(rng() * 3);
    for (let y = 1; y <= h; y += 1) bp.set(x, y, z, rng() < 0.5 ? B.MOSSY_COBBLE : B.COBBLE);
  }
  for (let z = -6; z <= 6; z += 1) for (let x = -6; x <= 6; x += 1) if (Math.hypot(x, z) < 6.2 && rng() < 0.35) bp.set(x, 0, z, rng() < 0.5 ? B.GRAVEL : B.COBBLE);
  bp.chest(0, 1, 0, 2, [[I.TREASURE_MAP, 1], [I.EMERALD, range(rng, 3, 5)], [I.IRON_INGOT, range(rng, 3, 5)], [B.CANNON, 1]]);
  return bp;
}

/** Buried treasure: a gravel cross on the ground, a chest two blocks down. */
function treasure(rng: Rng): Blueprint {
  const bp = new Blueprint();
  for (let k = -2; k <= 2; k += 1) {
    bp.set(k, 0, k, B.GRAVEL);
    bp.set(k, 0, -k, B.GRAVEL);
  }
  bp.set(0, -1, 0, B.DIRT);
  bp.chest(0, -2, 0, 2, [[I.EMERALD, range(rng, 4, 7)], [I.IRON_INGOT, range(rng, 2, 4)], [I.TNT, range(rng, 3, 6)], [I.GUNPOWDER, 3]]);
  return bp;
}

/**
 * Village building materials by region: sandstone in the desert, spruce in the snow and the
 * blight, mud bricks and dark timber in the swamp, adobe and red sandstone in the badlands,
 * blackstone, basalt and nether brick in the ember wastes.
 */
export function regionPalette(zone: string): Map<number, number> | null {
  if (zone === 'desert') return new Map([[B.PLANKS, B.CUT_SANDSTONE], [B.SPRUCE_PLANKS, B.SANDSTONE], [B.COBBLE, B.SANDSTONE], [B.STONE_BRICKS, B.CUT_SANDSTONE], [B.LOG, B.SANDSTONE], [B.SPRUCE_LOG, B.TERRACOTTA]]);
  if (zone === 'snow') return new Map([[B.PLANKS, B.SPRUCE_PLANKS], [B.LOG, B.SPRUCE_LOG], [B.WOOL, B.SNOW]]);
  if (zone === 'blight') return new Map([[B.PLANKS, B.SPRUCE_PLANKS], [B.COBBLE, B.MOSSY_COBBLE], [B.STONE_BRICKS, B.MOSSY_STONE_BRICKS], [B.WOOL, B.RED_WOOL]]);
  if (zone === 'swamp') return new Map([[B.PLANKS, B.SPRUCE_PLANKS], [B.COBBLE, B.MUD_BRICKS], [B.STONE_BRICKS, B.MUD_BRICKS], [B.LOG, B.SPRUCE_LOG], [B.SMOOTH_STONE, B.MUD_BRICKS]]);
  if (zone === 'badlands') return new Map([[B.PLANKS, B.WHITE_TERRACOTTA], [B.SPRUCE_PLANKS, B.ORANGE_TERRACOTTA], [B.COBBLE, B.RED_SANDSTONE], [B.STONE_BRICKS, B.RED_SANDSTONE], [B.LOG, B.TERRACOTTA], [B.SPRUCE_LOG, B.BROWN_TERRACOTTA]]);
  if (zone === 'ember') return new Map([[B.PLANKS, B.SPRUCE_PLANKS], [B.COBBLE, B.BLACKSTONE], [B.STONE_BRICKS, B.NETHER_BRICKS], [B.LOG, B.BASALT], [B.SPRUCE_LOG, B.BASALT], [B.WOOL, B.RED_WOOL], [B.SMOOTH_STONE, B.BLACKSTONE]]);
  return null;
}

/** Castle ruins in the new lands are built of their stone. */
function ruinPalette(zone: string): Map<number, number> | null {
  if (zone === 'swamp') return new Map([[B.STONE_BRICKS, B.MOSSY_STONE_BRICKS], [B.COBBLE, B.MOSSY_COBBLE], [B.CRACKED_STONE_BRICKS, B.MUD_BRICKS]]);
  if (zone === 'badlands') return new Map([[B.STONE_BRICKS, B.RED_SANDSTONE], [B.COBBLE, B.RED_SANDSTONE], [B.MOSSY_STONE_BRICKS, B.ORANGE_TERRACOTTA], [B.MOSSY_COBBLE, B.TERRACOTTA], [B.CRACKED_STONE_BRICKS, B.BROWN_TERRACOTTA]]);
  if (zone === 'ember') return new Map([[B.STONE_BRICKS, B.NETHER_BRICKS], [B.COBBLE, B.BLACKSTONE], [B.MOSSY_STONE_BRICKS, B.BLACKSTONE], [B.MOSSY_COBBLE, B.BASALT], [B.CRACKED_STONE_BRICKS, B.NETHER_BRICKS]]);
  return null;
}

export function repaint(st: Structure, pal: Map<number, number> | null): void {
  if (!pal) return;
  for (let i = 0; i < st.count; i += 1) {
    const to = pal.get(st.ids[i]!);
    if (to !== undefined) st.ids[i] = to;
  }
}

/**
 * A Heart Seal: a wall of green crystal straight across the valley floor and up both slopes
 * until the mountains rise above it, crowned with taller shards, and at the trail a towering
 * seal-stone cluster. Built cell by cell from the terrain (it is far too wide for a blueprint).
 */
function sealStructure(terrain: Terrain, seal: SealSite): Structure {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const add = (x: number, y: number, z: number): void => {
    xs.push(x);
    ys.push(y);
    zs.push(z);
  };
  const x = seal.x;
  const c = seal.z;
  const reach = Math.round(terrain.halfWidth(x) + 110);
  const rng = mulberry32(seal.x * 7919 + 17);
  let minY = Infinity;
  for (let z = c - reach; z <= c + reach; z += 1) {
    const g = terrain.heightInt(x, z);
    const top = seal.y + 11;
    // Into the mountains: once the ground is above the wall, the wall is done on that side.
    if (g >= top + 2) continue;
    const off = Math.abs(z - c);
    // Shards every nine blocks stand higher (three thick), and the seal-stone at the trail.
    const shard = (z - c + 900) % 9 === 0;
    const crown = off <= 3 ? 26 - off * 2 : shard ? 6 + Math.floor(rng() * 6) : Math.floor(rng() * 2);
    // (From the riverbed up where it crosses the water.)
    const y0 = g + 1;
    for (let y = y0; y <= top + crown; y += 1) add(x, y, z);
    if (shard || off <= 3) for (const dx of [-1, 1]) for (let y = y0; y <= top + crown - 2; y += 1) add(x + dx, y, z);
    minY = Math.min(minY, y0);
  }
  const n = xs.length;
  const st: Structure = {
    id: `seal${seal.index}`, kind: 'seal', name: seal.name,
    site: { kind: 'camp', index: 50 + seal.index, name: seal.name, x: seal.x, z: seal.z, y: seal.y, radius: 0 },
    front: 1, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
    floorY: minY, count: n,
    xs: new Int16Array(xs), ys: new Int16Array(ys), zs: new Int16Array(zs), ids: new Uint8Array(n).fill(B.SEAL_CRYSTAL), metas: new Int8Array(n).fill(-1),
    chests: [], villagers: [], hub: null, keep: true,
  };
  for (let i = 0; i < n; i += 1) {
    st.minX = Math.min(st.minX, xs[i]!);
    st.maxX = Math.max(st.maxX, xs[i]!);
    st.minY = Math.min(st.minY, ys[i]!);
    st.maxY = Math.max(st.maxY, ys[i]!);
    st.minZ = Math.min(st.minZ, zs[i]!);
    st.maxZ = Math.max(st.maxZ, zs[i]!);
  }
  return st;
}

// ------------------------------------------------------------------ placement

let serial = 0;

export function place(bp: Blueprint, kind: StructKind, name: string, site: Site, rot: number, minX: number, floorY: number, minZ: number, id: string): Structure {
  const list = [...bp.cells.values()].filter(([, , , cell]) => cell >= 0);
  let rx0 = Infinity;
  let rz0 = Infinity;
  for (const [x, , z] of list) {
    const [a, b] = rotXZ(x, z, rot);
    rx0 = Math.min(rx0, a);
    rz0 = Math.min(rz0, b);
  }
  const n = list.length;
  const s: Structure = {
    id, kind, name, site, front: rotateDir(2, rot),
    minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
    floorY,
    count: n,
    xs: new Int16Array(n), ys: new Int16Array(n), zs: new Int16Array(n), ids: new Uint8Array(n), metas: new Int8Array(n),
    chests: [], villagers: [], hub: null,
  };
  const map = (x: number, y: number, z: number): [number, number, number] => {
    const [a, b] = rotXZ(x, z, rot);
    return [minX + a - rx0, floorY + y, minZ + b - rz0];
  };
  list.forEach(([x, y, z, cell, meta], i) => {
    const [wx, wy, wz] = map(x, y, z);
    s.xs[i] = wx;
    s.ys[i] = wy;
    s.zs[i] = wz;
    s.ids[i] = cell;
    s.metas[i] = meta >= 0 && DIRECTIONAL_IDS.has(cell) ? rotateDir(meta, rot) : meta >= 0 && SIDE_IDS.has(cell) ? (meta & ~7) | rotateDir(meta & 7, rot) : meta;
    s.minX = Math.min(s.minX, wx);
    s.minY = Math.min(s.minY, wy);
    s.minZ = Math.min(s.minZ, wz);
    s.maxX = Math.max(s.maxX, wx);
    s.maxY = Math.max(s.maxY, wy);
    s.maxZ = Math.max(s.maxZ, wz);
  });
  for (const [x, y, z, loot] of bp.chests) {
    const [wx, wy, wz] = map(x, y, z);
    s.chests.push({ x: wx, y: wy, z: wz, loot: loot.filter(([, c]) => c > 0) });
  }
  for (const [x, y, z] of bp.villagers) {
    const [wx, wy, wz] = map(x, y, z);
    s.villagers.push({ x: wx + 0.5, y: wy, z: wz + 0.5 });
  }
  if (bp.hub) {
    const [wx, wy, wz] = map(bp.hub[0], bp.hub[1], bp.hub[2]);
    s.hub = { x: wx, y: wy, z: wz };
  }
  serial += 1;
  return s;
}

/** Rotated footprint size of a blueprint. */
function footprint(bp: Blueprint, rot: number): { w: number; d: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, , z, id] of bp.cells.values()) {
    if (id < 0) continue;
    const [a, b] = rotXZ(x, z, rot);
    x0 = Math.min(x0, a);
    x1 = Math.max(x1, a);
    z0 = Math.min(z0, b);
    z1 = Math.max(z1, b);
  }
  return { w: x1 - x0 + 1, d: z1 - z0 + 1 };
}

const VILLAGE_SLOTS: Array<{ dx: number; side: -1 | 1; kind: StructKind }> = [
  { dx: -27, side: -1, kind: 'house' },
  { dx: -11, side: -1, kind: 'windmill' },
  { dx: 6, side: -1, kind: 'cottage' },
  { dx: 22, side: -1, kind: 'watchtower' },
  { dx: -25, side: 1, kind: 'farm' },
  { dx: -8, side: 1, kind: 'smithy' },
  { dx: 9, side: 1, kind: 'house' },
  { dx: 25, side: 1, kind: 'farm' },
];

const NAMES: Record<StructKind, string> = {
  nest: 'Spider Nest',
  raidcamp: 'Raiders\' Camp',
  cache: 'Old Shrine',
  mine: 'Old Mine',
  lair: 'Giant\'s Lair',
  treasure: 'Buried Treasure',
  house: 'House',
  cottage: 'Cottage',
  windmill: 'Windmill',
  watchtower: 'Watchtower',
  smithy: 'Smithy',
  farm: 'Farm',
  well: 'Well',
  lamp: 'Lamp',
  castle: 'Castle Ruins',
  citadel: 'Creeper Citadel',
  seal: 'Heart Seal',
  wreck: 'Strider Wreck',
  pyramid: 'Sun Pyramid',
  coven: 'Witch Coven',
  outlawfort: 'Outlaw Fort',
  forge: 'The Builders\' Forge',
  cairn: 'Cairn',
  nook: 'Old Place',
};

/** Gap between the road centre line and the facades. */
export const VILLAGE_GAP = 11;

function villageStructures(site: Site, out: Structure[], zone: string): void {
  const rng = mulberry32(site.x * 73856093 ^ site.z * 19349663);
  const rich = site.index;
  const start = out.length;
  for (const slot of VILLAGE_SLOTS) {
    let bp: Blueprint;
    switch (slot.kind) {
      case 'house':
        bp = house(rng, rich);
        break;
      case 'cottage':
        bp = cottage(rng, rich);
        break;
      case 'windmill':
        bp = windmill();
        break;
      case 'watchtower':
        bp = watchtower(rng, rich);
        break;
      case 'smithy':
        bp = smithy(rng, rich);
        break;
      default:
        bp = farm(rng);
    }
    // North-side buildings face +z (toward the road), south-side ones face -z.
    const rot = slot.side < 0 ? 0 : 2;
    const { w, d } = footprint(bp, rot);
    const minX = site.x + slot.dx - Math.floor(w / 2);
    const minZ = slot.side < 0 ? site.z - VILLAGE_GAP - d : site.z + VILLAGE_GAP + 1;
    out.push(place(bp, slot.kind, NAMES[slot.kind], site, rot, minX, site.y, minZ, `v${site.index}:${slot.kind}@${slot.dx}`));
  }
  // The well in a widened plaza beside the road, and lamp posts along it.
  out.push(place(well(), 'well', 'Well', site, 0, site.x - 2, site.y, site.z - VILLAGE_GAP + 2, `v${site.index}:well`));
  for (const [dx, side] of [[-34, 1], [-18, -1], [-2, 1], [14, -1], [30, 1]] as const) {
    out.push(place(lamp(), 'lamp', 'Lamp', site, 0, site.x + dx, site.y, site.z + side * 5, `v${site.index}:lamp${dx}`));
  }
  // The region's own materials.
  const pal = regionPalette(zone);
  for (let k = start; k < out.length; k += 1) repaint(out[k]!, pal);
}

export interface StructureIndex {
  all: Structure[];
  byId: Map<string, Structure>;
  /** Structures overlapping each chunk (by chunk index). */
  byChunk: Map<number, Structure[]>;
  /** Columns reserved from trees (village plazas, roads), by chunk index -> bitmap of 256. */
  roads: Array<{ x0: number; z0: number; x1: number; z1: number; y: number }>;
}

export function buildStructures(terrain: Terrain): StructureIndex {
  serial = 0;
  const all: Structure[] = [];
  const roads: StructureIndex['roads'] = [];
  for (const v of terrain.villages) {
    villageStructures(v, all, terrain.zone(v.x, v.z));
    roads.push({ x0: v.x - 44, z0: v.z - 3, x1: v.x + 44, z1: v.z + 3, y: v.y });
    roads.push({ x0: v.x - 4, z0: v.z - VILLAGE_GAP + 1, x1: v.x + 4, z1: v.z - 3, y: v.y });
  }
  for (const c of terrain.castles) {
    const rng = mulberry32(c.x * 31 + c.z * 977);
    const bp = castle(rng, c.index);
    const { w, d } = footprint(bp, 0);
    // Gate faces the valley centre.
    const rot = c.z > terrain.centerZ(c.x) ? 2 : 0;
    const st = place(bp, 'castle', c.name, c, rot, c.x - Math.floor(w / 2), c.y, c.z - Math.floor(d / 2), `c${c.index}`);
    repaint(st, ruinPalette(terrain.zone(c.x, c.z)));
    all.push(st);
  }
  for (const camp of terrain.camps) {
    const kind = questKind(terrain, camp.index);
    const rng = mulberry32(camp.x * 131 + camp.z * 7919);
    const bp = kind === 'fetch' ? cache(rng) : kind === 'nest' ? nest(rng) : raidcamp(rng);
    const sk: StructKind = kind === 'fetch' ? 'cache' : kind === 'nest' ? 'nest' : 'raidcamp';
    const { w, d } = footprint(bp, 0);
    all.push(place(bp, sk, camp.name, camp, 0, camp.x - Math.floor(w / 2), camp.y, camp.z - Math.floor(d / 2), `q${camp.index}`));
    roads.push({ x0: camp.x - 6, z0: camp.z - 6, x1: camp.x + 6, z1: camp.z + 6, y: camp.y });
  }
  for (const l of terrain.lairs) {
    const bp = lair(mulberry32(l.x * 17 + l.z * 31));
    const { w, d } = footprint(bp, 0);
    all.push(place(bp, 'lair', l.name, l, 0, l.x - Math.floor(w / 2), l.y, l.z - Math.floor(d / 2), `l${l.index}`));
  }
  terrain.mines.forEach(([x, y, z, side], i) => {
    const bp = mine(mulberry32(x * 13 + z * 101));
    // The tunnel runs +z in the blueprint; turn it to dig into the hill (-z: half a turn).
    const rot = side > 0 ? 0 : 2;
    const { w, d } = footprint(bp, rot);
    const minZ = side > 0 ? z - 1 : z - d + 2;
    const site: Site = { kind: 'camp', index: 20 + i, name: 'Old Mine', x, z, y, radius: 0 };
    const st = place(bp, 'mine', 'Old Mine', site, rot, x - Math.floor(w / 2), y, minZ, `m${i}`);
    st.keep = true;
    all.push(st);
  });
  terrain.treasures.forEach(([x, y, z], i) => {
    const bp = treasure(mulberry32(x * 7 + z * 13 + i));
    const site: Site = { kind: 'camp', index: 30 + i, name: 'Buried Treasure', x, z, y, radius: 0 };
    const st = place(bp, 'treasure', 'Buried Treasure', site, 0, x - 2, y, z - 2, `t${i}`);
    st.keep = true;
    all.push(st);
  });
  {
    const c = terrain.citadel;
    const bp = citadel(mulberry32(c.x * 7 + 3));
    const { w, d } = footprint(bp, 0);
    all.push(place(bp, 'citadel', c.name, c, 0, c.x - Math.floor(w / 2), c.y, c.z - Math.floor(d / 2), 'citadel'));
  }
  for (const seal of terrain.seals) all.push(sealStructure(terrain, seal));
  for (const e of terrain.expeditions) all.push(...expeditionStructures(terrain, e));
  for (const n of terrain.nooks) all.push(nookStructure(terrain, n));
  const byId = new Map<string, Structure>();
  const byChunk = new Map<number, Structure[]>();
  for (const s of all) {
    byId.set(s.id, s);
    for (let cz = Math.floor(s.minZ / CS); cz <= Math.floor(s.maxZ / CS); cz += 1) {
      for (let cx = Math.floor(s.minX / CS); cx <= Math.floor(s.maxX / CS); cx += 1) {
        if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) continue;
        const key = cz * CHUNKS_X + cx;
        let list = byChunk.get(key);
        if (!list) {
          list = [];
          byChunk.set(key, list);
        }
        list.push(s);
      }
    }
  }
  return { all, byId, byChunk, roads };
}

/** Village or ruin structures the crane may lift. */
export function isHoistable(s: Structure): boolean {
  return HOIST_INFO[s.kind] !== undefined;
}

export { SEA };
