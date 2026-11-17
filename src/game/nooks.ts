// The small places off the trail: the survey stones on Greenvale's hills, the desert's three shrines, the
// Drowned Chapel, Rustmane's hideout, the lens cairns in the snow, the Ember Vein, and the lost stashes
// (each a chest, and something left to mark it, in the stone of its land). Pure functions of the
// terrain, like every other structure.
import { B, I } from './blocks';
import { mulberry32, type Rng } from './rng';
import { Blueprint, place, range, regionPalette, repaint, type Loot, type Structure } from './structures';
import type { Nook, Terrain } from './terrain';

const HANG = 1;

/** Ground under a blueprint: a pad so it sits on rolling land. */
function pad(bp: Blueprint, r: number, id: number): void {
  for (let z = -r; z <= r; z += 1) for (let x = -r; x <= r; x += 1) if (Math.hypot(x, z) <= r + 0.4) bp.set(x, 0, z, id);
}

/** A survey stone: a stepped plinth and a stone needle with a dark lamp at its head (lit, it glows). */
function surveyStone(): Blueprint {
  const bp = new Blueprint();
  pad(bp, 2, B.COBBLE);
  for (let z = -1; z <= 1; z += 1) for (let x = -1; x <= 1; x += 1) bp.set(x, 1, z, B.STONE_BRICKS);
  for (let y = 2; y <= 6; y += 1) bp.set(0, y, 0, y % 2 === 0 ? B.MOSSY_STONE_BRICKS : B.STONE_BRICKS);
  bp.set(0, 7, 0, B.REDSTONE_LAMP);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) bp.set(dx, 2, dz, B.COBBLE_WALL);
  return bp;
}

/** A desert shrine: a sandstone court, four banded pillars under a stepped roof, the chest on a dais. */
function shrine(rng: Rng): Blueprint {
  const bp = new Blueprint();
  pad(bp, 5, B.SANDSTONE);
  for (let z = -3; z <= 3; z += 1) for (let x = -3; x <= 3; x += 1) bp.set(x, 1, z, Math.abs(x) + Math.abs(z) < 2 ? B.ORANGE_TERRACOTTA : B.CUT_SANDSTONE);
  for (const sx of [-3, 3]) {
    for (const sz of [-3, 3]) {
      for (let y = 2; y <= 5; y += 1) bp.set(sx, y, sz, y === 4 ? B.ORANGE_TERRACOTTA : B.CUT_SANDSTONE);
    }
  }
  for (let k = 0; k < 3; k += 1) {
    const r = 3 - k;
    for (let z = -r; z <= r; z += 1) for (let x = -r; x <= r; x += 1) if (Math.max(Math.abs(x), Math.abs(z)) === r) bp.set(x, 6 + k, z, k === 2 ? B.GOLD_BLOCK : B.CUT_SANDSTONE);
  }
  bp.set(0, 8, 0, B.GOLD_BLOCK);
  bp.set(0, 5, 0, B.LANTERN, HANG);
  bp.chest(0, 2, 0, 2, [[I.SUN_TABLET, 1], [I.EMERALD, range(rng, 2, 4)], [I.SUN_AMBER, 2]]);
  return bp;
}

/** The Drowned Chapel: mud-brick walls fallen in on one side, a bell frame, the altar and its chest. */
function chapel(rng: Rng): Blueprint {
  const bp = new Blueprint();
  pad(bp, 7, B.MUD);
  const [W, D] = [4, 6];
  for (let z = -D; z <= D; z += 1) {
    for (let x = -W; x <= W; x += 1) {
      const wall = Math.abs(x) === W || Math.abs(z) === D;
      bp.set(x, 1, z, wall ? B.MUD_BRICKS : rng() < 0.3 ? B.MOSSY_COBBLE : B.COBBLE);
      if (!wall) continue;
      const door = z === D && Math.abs(x) <= 1;
      const fallen = x < 0 ? 2 : 6;
      const h = fallen - (rng() < 0.4 ? 1 : 0);
      for (let y = 2; y <= h; y += 1) if (!door || y > 4) bp.set(x, y, z, y === 4 && !door && (z + x) % 3 === 0 ? B.GLASS_PANE : rng() < 0.25 ? B.MOSSY_COBBLE : B.MUD_BRICKS);
    }
  }
  // The tower at the back with its empty bell frame; vines down the walls.
  for (let y = 2; y <= 10; y += 1) for (const [x, z] of [[2, -5], [3, -5], [2, -4], [3, -4]] as const) if (y < 8 || (x + z) % 2 === 0) bp.set(x, y, z, B.MUD_BRICKS);
  bp.set(2, 11, -5, B.SPRUCE_SLAB, 0);
  bp.set(3, 11, -4, B.SPRUCE_SLAB, 0);
  for (let n = 0; n < 14; n += 1) {
    const x = rng() < 0.5 ? -W - 1 : W + 1;
    const z = -D + Math.floor(rng() * (D * 2 + 1));
    bp.set(x, 3 + Math.floor(rng() * 3), z, B.VINE, x < 0 ? 0 : 1);
  }
  bp.set(0, 2, -D + 1, B.COBBLE);
  bp.set(-1, 2, -D + 1, B.COBBLE);
  bp.set(1, 2, -D + 1, B.COBBLE);
  bp.chest(0, 3, -D + 1, 2, [[I.FERRY_LANTERN, 1], [I.BOG_IRON, 2], [I.EMERALD, range(rng, 2, 4)]]);
  bp.set(-2, 2, 0, B.LANTERN, 0);
  return bp;
}

/** Rustmane's hideout: a palisade against the rock, a lean-to, powder kegs, and his strongbox. */
function hideout(rng: Rng): Blueprint {
  const bp = new Blueprint();
  pad(bp, 6, B.COARSE_DIRT);
  for (let z = -5; z <= 5; z += 1) {
    for (let x = -5; x <= 5; x += 1) {
      if (Math.max(Math.abs(x), Math.abs(z)) !== 5 || (z === 5 && Math.abs(x) <= 1)) continue;
      const h = 3 + (rng() < 0.3 ? 1 : 0);
      for (let y = 1; y <= h; y += 1) bp.set(x, y, z, B.SPRUCE_LOG);
    }
  }
  for (let x = -4; x <= 1; x += 1) {
    for (const z of [-4, -3, -2]) bp.set(x, 4, z, B.SPRUCE_SLAB, 0);
  }
  for (const [x, z] of [[-4, -1], [1, -1]] as const) for (let y = 1; y <= 3; y += 1) bp.set(x, y, z, B.SPRUCE_LOG);
  bp.set(3, 1, -3, B.TNT_BLOCK);
  bp.set(3, 2, -3, B.TNT_BLOCK);
  bp.set(4, 1, -3, B.TNT_BLOCK);
  bp.set(3, 1, 3, B.BARREL);
  bp.set(4, 1, 3, B.BARREL);
  bp.set(-3, 1, 3, B.CANNON);
  bp.set(-1, 2, -3, B.LANTERN, 0);
  bp.set(-1, 1, -3, B.BARREL);
  bp.chest(-3, 1, -3, 2, [[I.CANNON_PLANS, 1], [I.RUST_IRON, 2], [I.TNT, range(rng, 4, 8)]]);
  bp.set(0, 3, 5, B.BANNER, 2);
  return bp;
}

/** A lens cairn: a ring of stones under the snow, the box at its heart, a lantern to find it by. */
function lensCairn(rng: Rng): Blueprint {
  const bp = new Blueprint();
  pad(bp, 4, B.PACKED_ICE);
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * 4);
    const z = Math.round(Math.sin(a) * 4);
    const h = 2 + Math.floor(rng() * 3);
    for (let y = 1; y <= h; y += 1) bp.set(x, y, z, y === h ? B.BLUE_ICE : rng() < 0.5 ? B.STONE_BRICKS : B.PACKED_ICE);
  }
  bp.set(0, 1, 0, B.SMOOTH_STONE);
  bp.chest(0, 2, 0, 2, [[I.STAR_LENS, 1], [I.FROST_SHARD, 2], [I.EMERALD, range(rng, 2, 4)]]);
  for (let y = 1; y <= 3; y += 1) bp.set(2, y, 2, B.SPRUCE_LOG);
  bp.set(2, 4, 2, B.LANTERN, 0);
  return bp;
}

/** The Ember Vein: a split in the black rock, glowing, with a miner's strongbox still beside it. */
function vein(rng: Rng): Blueprint {
  const bp = new Blueprint();
  pad(bp, 6, B.BASALT);
  for (let k = -6; k <= 6; k += 1) {
    const z = Math.round(Math.sin(k * 0.6) * 1.6);
    bp.set(k, 0, z, B.MAGMA);
    bp.set(k, 0, z + 1, rng() < 0.6 ? B.MAGMA : B.BLACKSTONE);
    if (rng() < 0.5) bp.set(k, 1, z - 1, B.BLACKSTONE);
    if (rng() < 0.4) bp.set(k, 1, z + 2, B.BASALT);
  }
  for (const [x, z] of [[-4, 3], [3, -4], [5, 3]] as const) for (let y = 1; y <= 2 + Math.floor(rng() * 3); y += 1) bp.set(x, y, z, B.BASALT);
  for (let y = 1; y <= 2; y += 1) bp.set(-1, y, 4, B.CHARRED_LOG);
  bp.set(-1, 3, 4, B.LANTERN, 0);
  bp.chest(1, 1, 4, 2, [[I.EMBER_ORE, 4], [I.EMBER_STEEL, 2], [I.COAL, range(rng, 3, 6)]]);
  return bp;
}

/** What each land's stash has round it: a broken wall, a fallen post, a little flag. */
function stash(rng: Rng, nook: Nook): Blueprint {
  const bp = new Blueprint();
  pad(bp, 2, B.COBBLE);
  const shape = Math.floor(rng() * 3);
  if (shape === 0) {
    // A corner of old wall.
    for (let k = -2; k <= 2; k += 1) {
      const h = 3 - Math.abs(k) + Math.floor(rng() * 2);
      for (let y = 1; y <= h; y += 1) bp.set(k, y, -2, y === h ? B.MOSSY_COBBLE : B.STONE_BRICKS);
      for (let y = 1; y <= Math.max(1, h - 1); y += 1) bp.set(-2, y, k, B.STONE_BRICKS);
    }
  } else if (shape === 1) {
    // Two posts and a beam, like the ribs of an old shelter.
    for (const x of [-2, 2]) for (let y = 1; y <= 3; y += 1) bp.set(x, y, -1, B.SPRUCE_LOG);
    for (let x = -2; x <= 2; x += 1) bp.set(x, 4, -1, B.SPRUCE_SLAB, 0);
    bp.set(1, 1, -1, B.BARREL);
  } else {
    // A heap of stones with a pole on it.
    for (let z = -2; z <= -1; z += 1) for (let x = -1; x <= 1; x += 1) if (rng() < 0.8) bp.set(x, 1, z, B.COBBLE);
    bp.set(0, 2, -2, B.COBBLE);
    for (let y = 3; y <= 4; y += 1) bp.set(0, y, -2, B.SPRUCE_LOG);
  }
  bp.set(1, 1, 1, B.SPRUCE_LOG);
  bp.set(1, 2, 1, B.SPRUCE_LOG);
  bp.set(1, 3, 1, B.LANTERN, 0);
  const metal = [I.IRON_INGOT, I.SUN_AMBER, I.BOG_IRON, I.RUST_IRON, I.FROST_SHARD, I.EMBER_STEEL, I.IRON_INGOT][nook.land] ?? I.IRON_INGOT;
  const loot: Loot = [[I.EMERALD, range(rng, 2, 5)], [metal, range(rng, 1, 2)]];
  bp.chest(0, 1, 0, 2, loot);
  return bp;
}

export function nookStructure(terrain: Terrain, n: Nook): Structure {
  const rng = mulberry32(n.x * 4099 + n.z * 37);
  let bp: Blueprint;
  switch (n.kind) {
    case 'survey':
      bp = surveyStone();
      break;
    case 'shrine':
      bp = shrine(rng);
      break;
    case 'chapel':
      bp = chapel(rng);
      break;
    case 'hideout':
      bp = hideout(rng);
      break;
    case 'lens':
      bp = lensCairn(rng);
      break;
    case 'vein':
      bp = vein(rng);
      break;
    default:
      bp = stash(rng, n);
  }
  const rot = Math.floor(rng() * 4);
  // (Blueprints are drawn about their middle.)
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, , z, cell] of bp.cells.values()) {
    if (cell < 0) continue;
    const a = rot % 2 === 0 ? x : z;
    const b = rot % 2 === 0 ? z : x;
    x0 = Math.min(x0, a);
    z0 = Math.min(z0, b);
    x1 = Math.max(x1, a);
    z1 = Math.max(z1, b);
  }
  const s = place(bp, 'nook', n.name, n.site, rot, n.x - Math.floor((x1 - x0) / 2), n.y, n.z - Math.floor((z1 - z0) / 2), `n:${n.id}`);
  if (n.kind === 'stash') repaint(s, regionPalette(terrain.zone(n.x, n.z)));
  return s;
}
