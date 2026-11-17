// The expeditions' landmarks: the wrecks of the Striders that marched east and never came back (each
// land has worn its own: overgrown in the meadows, drowned in the dunes, sunk in the lagoon, frozen
// on Frostpeak, charred at Mount Cinder), and what stands round them: the Sun Pyramid, the witches'
// coven on its stilts, the outlaws' fort on its mesa, the Builders' Forge in the volcano's crater,
// cairns along the mountain paths. Pure functions of the terrain, like every other structure.
import { B, I } from './blocks';
import { mulberry32, type Rng } from './rng';
import { Blueprint, place, range, rotXZ, type Loot, type StructKind, type Structure } from './structures';
import { CINDER, SEA, type ExpeditionSite, type Terrain } from './terrain';

/** How a wreck has weathered. */
type WreckStyle = 'moss' | 'sand' | 'sunk' | 'ice' | 'ember';

/** DIRS index of a horizontal unit vector (x, z). */
function dirOf(x: number, z: number): number {
  return x > 0 ? 0 : x < 0 ? 1 : z > 0 ? 2 : 3;
}

const HANG = 1;

/** A captain's chest: what the crew carried (the crest itself is the main quest's, not loot). */
function captainLoot(rng: Rng, rich: number): Loot {
  return [
    [I.EMERALD, range(rng, 4, 7) + rich * 2],
    [I.IRON_INGOT, range(rng, 3, 5) + rich],
    [I.TNT, range(rng, 4, 8)],
    [I.GUNPOWDER, range(rng, 2, 4)],
    [I.BREAD, range(rng, 2, 4)],
  ];
}

function spoils(rng: Rng, rich: number): Loot {
  return [
    [I.EMERALD, range(rng, 2, 4) + rich],
    [I.IRON_INGOT, range(rng, 1, 3)],
    [I.TNT, range(rng, 2, 4)],
    [I.COAL, range(rng, 2, 5)],
  ];
}

/** A line of cells from a to b (inclusive, stepping the longest axis). */
function line(a: [number, number, number], b: [number, number, number], fn: (x: number, y: number, z: number) => void): void {
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    fn(Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t));
  }
}

// ------------------------------------------------------------------ the wrecks

/**
 * A fallen Strider, local frame: hull along x 0..16 and across z 0..10, the ground at y 0, its
 * captain's cabin at the stern. The hull broke across the middle; the bow half rests tilted on
 * two snapped legs, the other two lie in the grass. The Heart's green crystal breaks out of the
 * cracks. With `chest`, the captain's chest stands in the cabin (the first chest of the blueprint).
 */
function wreck(rng: Rng, style: WreckStyle, chest: boolean): Blueprint {
  const bp = new Blueprint();
  const L = 16;
  const Wd = 10;
  const tilt = style === 'sunk' || style === 'moss' ? 2 : 3;
  const lift = (x: number): number => (x >= 9 ? Math.floor((x - 8) / tilt) : 0);
  const stone = (): number => {
    const r = rng();
    if (style === 'ember') return r < 0.5 ? B.BLACKSTONE : r < 0.75 ? B.BASALT : B.CRACKED_STONE_BRICKS;
    if (style === 'moss' || style === 'sunk') return r < 0.35 ? B.MOSSY_STONE_BRICKS : r < 0.55 ? B.MOSSY_COBBLE : r < 0.7 ? B.CRACKED_STONE_BRICKS : B.STONE_BRICKS;
    return r < 0.3 ? B.CRACKED_STONE_BRICKS : r < 0.45 ? B.COBBLE : B.STONE_BRICKS;
  };
  const plank = (): number => {
    if (style === 'ember') return rng() < 0.6 ? B.CHARRED_LOG : B.SPRUCE_PLANKS;
    if (style === 'sunk') return rng() < 0.5 ? B.SPRUCE_PLANKS : B.MUD_BRICKS;
    return rng() < 0.85 ? B.PLANKS : B.SPRUCE_PLANKS;
  };
  for (let z = 0; z <= Wd; z += 1) {
    for (let x = 0; x <= L; x += 1) {
      const y0 = lift(x);
      const crack = x === 8;
      // What holds the raised bow up: rubble wedged under it.
      for (let y = 0; y < y0; y += 1) bp.set(x, y, z, style === 'sand' ? B.SAND : rng() < 0.5 ? B.COBBLE : B.DIRT);
      if (crack && rng() < 0.55) {
        if (rng() < 0.5) bp.set(x, 0, z, rng() < 0.5 ? B.GRAVEL : B.COBBLE);
        continue;
      }
      bp.set(x, y0, z, rng() < 0.25 ? B.STONE_BRICKS : style === 'ember' ? B.BLACKSTONE : B.SMOOTH_STONE);
      const rim = x === 0 || x === L || z === 0 || z === Wd;
      if (rim) bp.set(x, y0 + 1, z, (x + z) % 4 === 2 ? B.GLASS : stone());
      else bp.set(x, y0 + 1, z, style === 'sand' ? B.SAND : B.SMOOTH_STONE);
      // The deck, its planks sprung here and there.
      if (rng() < (crack ? 0.3 : 0.1)) continue;
      bp.set(x, y0 + 2, z, rim ? (style === 'ember' ? B.BLACKSTONE : B.COBBLE) : plank());
      // What is left of the railing.
      if ((z === 0 || z === Wd) && x > 0 && x < L && rng() < 0.45) bp.set(x, y0 + 3, z, style === 'ember' ? B.CHARRED_LOG : B.FENCE);
    }
  }
  const deck = (x: number): number => lift(x) + 3;
  // The captain's cabin at the stern, half fallen in, its roof in pieces.
  for (let y = 0; y < 3; y += 1) {
    for (let x = 2; x <= 6; x += 1) {
      for (let z = 6; z <= 9; z += 1) {
        const edge = x === 2 || x === 6 || z === 6 || z === 9;
        if (!edge) continue;
        if (z === 6 && x === 4 && y < 2) continue;
        if (rng() < 0.12 + y * 0.12) continue;
        const corner = (x === 2 || x === 6) && (z === 6 || z === 9);
        const wall = style === 'ember' ? B.CHARRED_LOG : style === 'ice' ? B.SPRUCE_PLANKS : B.SPRUCE_PLANKS;
        bp.set(x, deck(x) + y, z, corner ? (style === 'ember' ? B.BASALT : B.SPRUCE_LOG) : y === 1 && (x === 3 || x === 5) && z === 9 ? B.GLASS_PANE : wall);
      }
    }
  }
  for (let x = 1; x <= 7; x += 1) {
    if (rng() < 0.45) bp.set(x, deck(x) + 3, 6, style === 'ember' ? B.BLACKSTONE : B.OAK_STAIRS, 2);
    if (rng() < 0.35) bp.set(x, deck(x) + 3, 9, style === 'ember' ? B.BLACKSTONE : B.OAK_STAIRS, 3);
  }
  bp.set(4, deck(4) + 2, 8, B.LANTERN, HANG);
  bp.set(4, deck(4) + 3, 8, B.SPRUCE_PLANKS);
  if (chest) bp.chest(4, deck(4), 8, 3, captainLoot(rng, 2));
  bp.set(3, deck(3), 7, B.BARREL);
  bp.set(5, deck(5), 7, style === 'ember' ? B.MAGMA : B.CRAFTING_TABLE, 2);
  // The dead Engine Core: cold iron and a dark lamp where the heart of it beat.
  bp.set(10, deck(10), 2, B.IRON_BLOCK);
  bp.set(10, deck(10) + 1, 2, B.REDSTONE_LAMP);
  bp.set(12, deck(12), 5, B.CANNON);
  bp.set(13, deck(13), 3, B.GEARBOX);
  // The crane mast, still reaching up crooked from the bow, its jib snapped and hanging.
  const mast = style === 'ember' ? B.CHARRED_LOG : B.SPRUCE_LOG;
  line([14, deck(14), 9], [17, deck(14) + 8, 11], (x, y, z) => bp.set(x, y, z, mast));
  line([17, deck(14) + 8, 11], [23, deck(14) + 4, 13], (x, y, z) => bp.set(x, y, z, mast));
  for (let y = deck(14) + 3; y >= deck(14); y -= 1) bp.set(23, y, 13, B.CHAIN);
  // Two legs snapped under the bow, two lying in the grass (iron knees, stone shins, feet).
  for (const z of [1, Wd - 1]) {
    for (let y = 0; y < lift(L - 1); y += 1) {
      bp.set(L - 1, y, z, y === 1 ? B.GEARBOX : stone());
      bp.set(L - 2, y, z, stone());
    }
  }
  for (let z = -1; z >= -9; z -= 1) {
    for (const x of [1, 2]) for (let y = 0; y <= 1; y += 1) bp.set(x, y, z, z === -4 ? B.GEARBOX : stone());
  }
  for (let x = 0; x <= 3; x += 1) for (let z = -10; z <= -9; z += 1) bp.set(x, 0, z, B.COBBLE);
  for (let x = L + 2; x <= L + 9; x += 1) {
    for (const z of [6, 7]) for (let y = 0; y <= 1; y += 1) bp.set(x, y, z, x === L + 5 ? B.GEARBOX : stone());
  }
  // The Heart's green crystal, breaking out through the crack and the deck (it took the crew).
  for (const [x, z, n] of [[8, 4, 6], [8, 5, 4], [7, 4, 3], [11, 7, 3], [6, 2, 2], [8, 8, 3], [13, 2, 2]] as const) {
    for (let k = 0; k < n; k += 1) bp.set(x, lift(x) + 1 + k, z, B.SEAL_CRYSTAL);
  }
  // Each land's weathering.
  if (style === 'moss' || style === 'sunk') {
    for (let n = 0; n < 34; n += 1) {
      const side = Math.floor(rng() * 4);
      const i = 1 + Math.floor(rng() * (side < 2 ? L - 1 : Wd - 1));
      const [x, z] = side === 0 ? [i, -1] : side === 1 ? [i, Wd + 1] : side === 2 ? [-1, i] : [L + 1, i];
      const dir = side === 0 ? 2 : side === 1 ? 3 : side === 2 ? 0 : 1;
      const top = lift(Math.max(0, Math.min(L, x))) + 2;
      for (let y = top; y >= Math.max(0, top - 2); y -= 1) if (bp.get(x, y, z) < 0) bp.set(x, y, z, B.VINE, dir);
    }
    for (let n = 0; n < 9; n += 1) {
      const x = 1 + Math.floor(rng() * (L - 1));
      const z = 1 + Math.floor(rng() * (Wd - 1));
      if (bp.get(x, deck(x), z) < 0) bp.set(x, deck(x), z, B.LEAVES);
    }
  }
  if (style === 'moss') {
    for (let n = 0; n < 60; n += 1) {
      const x = -4 + Math.floor(rng() * (L + 9));
      const z = -4 + Math.floor(rng() * (Wd + 9));
      if (x >= 0 && x <= L && z >= 0 && z <= Wd) continue;
      if (bp.get(x, 0, z) >= 0 || bp.get(x, 1, z) >= 0) continue;
      const r = rng();
      bp.set(x, 1, z, r < 0.35 ? B.POPPY : r < 0.6 ? B.DANDELION : r < 0.75 ? B.CORNFLOWER : B.TALL_GRASS);
    }
  } else if (style === 'sand') {
    // Dunes drifted against the hull and over half the deck; the dead bushes of the dunes.
    for (let z = -2; z <= Wd + 2; z += 1) {
      for (let x = -2; x <= L + 2; x += 1) {
        const inside = x >= 0 && x <= L && z >= 0 && z <= Wd;
        if (!inside && rng() < 0.7) for (let y = 1; y <= 1 + Math.floor(rng() * 2); y += 1) bp.set(x, y, z, B.SAND);
        if (inside && x < 9 && rng() < 0.45) bp.set(x, deck(x), z, B.SAND);
      }
    }
    for (let n = 0; n < 6; n += 1) bp.set(-4 + Math.floor(rng() * 24), 1, -4 + Math.floor(rng() * 18), B.DEAD_BUSH);
  } else if (style === 'ice') {
    // Frozen into a glacier: a rough crust of packed and blue ice over the hull (thick at the
    // bottom, ragged at the top), icicles off its edges, snow on the deck. A crack at the cabin's
    // side lets a captain chip their way in.
    const [cx, cy, cz] = [L / 2, 3, Wd / 2];
    for (let z = -4; z <= Wd + 4; z += 1) {
      for (let x = -4; x <= L + 4; x += 1) {
        for (let y = 0; y <= 11; y += 1) {
          const e = Math.hypot((x - cx) / 12, (y - cy) / 8.5, (z - cz) / 8.5);
          const rough = (rng() - 0.5) * 0.12;
          if (e > 1 + rough || e < 0.86 + rough) continue;
          if (bp.get(x, y, z) >= 0) continue;
          if (z >= Wd && x >= 3 && x <= 5 && y >= 3 && y <= 6) continue;
          if (rng() < (y > 6 ? 0.45 : 0.18)) continue;
          bp.set(x, y, z, rng() < 0.28 ? B.BLUE_ICE : B.PACKED_ICE);
        }
      }
    }
    for (let n = 0; n < 14; n += 1) {
      const x = -2 + Math.floor(rng() * (L + 5));
      const z = rng() < 0.5 ? -3 : Wd + 3;
      for (let y = 4; y >= 2 + Math.floor(rng() * 2); y -= 1) if (bp.get(x, y, z) < 0 && bp.get(x, y + 1, z) >= 0) bp.set(x, y, z, B.ICE);
    }
    for (let n = 0; n < 16; n += 1) {
      const x = Math.floor(rng() * (L + 1));
      const z = Math.floor(rng() * (Wd + 1));
      // (Nothing drifted against the way to the cabin's door.)
      if (x <= 7 && z >= 3 && z <= 7) continue;
      if (bp.get(x, deck(x), z) < 0) bp.set(x, deck(x), z, B.SNOW);
    }
  } else if (style === 'ember') {
    for (let n = 0; n < 14; n += 1) {
      const x = -3 + Math.floor(rng() * (L + 7));
      const z = -3 + Math.floor(rng() * (Wd + 7));
      if (bp.get(x, 0, z) < 0) bp.set(x, 0, z, rng() < 0.5 ? B.MAGMA : B.ASH);
    }
  } else if (style === 'sunk') {
    // (Under the lagoon: the deck is green with weed, mud washed into its corners.)
    for (let n = 0; n < 12; n += 1) {
      const x = Math.floor(rng() * (L + 1));
      const z = Math.floor(rng() * (Wd + 1));
      if (bp.get(x, deck(x), z) < 0) bp.set(x, deck(x), z, B.MUD);
    }
  }
  // However she fell, a way aboard: rubble heaped against the stern, one step up to the deck (and
  // on a glacier, a way chipped through the ice to it).
  if (style !== 'sunk') {
    for (let z = 3; z <= 6; z += 1) {
      if (style === 'ice') for (let x = -6; x <= 1; x += 1) for (let y = x < 0 ? 1 : 3; y <= 7; y += 1) bp.set(x, y, z, B.AIR);
      bp.set(-1, 1, z, style === 'ember' ? B.BASALT : style === 'sand' ? B.SAND : B.COBBLE);
    }
  }
  return bp;
}

// ------------------------------------------------------------------ the Sun Pyramid

/**
 * A stepped pyramid of sandstone (local: centred on 0, 0, its door facing +z), banded in terracotta.
 * A pillared portal and a corridor lead into a torchlit hall: pillars capped in gold, sarcophagi
 * along the walls, and on the dais at the back the Sunstrider's crest chest between gold blocks.
 */
function pyramid(rng: Rng): Blueprint {
  const bp = new Blueprint();
  const R = 19;
  const skin = (y: number, x: number, z: number): number => {
    if (y % 5 === 4) return (x + z) % 2 === 0 ? B.ORANGE_TERRACOTTA : B.TERRACOTTA;
    return rng() < 0.18 ? B.CUT_SANDSTONE : B.SANDSTONE;
  };
  for (let y = 0; y <= R; y += 1) {
    const r = R - y;
    for (let z = -r; z <= r; z += 1) {
      for (let x = -r; x <= r; x += 1) {
        const edge = Math.abs(x) === r || Math.abs(z) === r;
        if (y > 0 && !edge) continue;
        bp.set(x, y, z, y === 0 ? B.SANDSTONE : skin(y, x, z));
      }
    }
  }
  bp.set(0, R + 1, 0, B.GOLD_BLOCK);
  // The hall: walls banded in terracotta, a ceiling, lit by hanging lanterns.
  const H = 8;
  for (let y = 1; y <= H; y += 1) {
    for (let z = -8; z <= 8; z += 1) {
      for (let x = -8; x <= 8; x += 1) {
        const wall = Math.abs(x) === 8 || Math.abs(z) === 8;
        if (y === H) bp.set(x, y, z, B.CUT_SANDSTONE);
        else if (wall) bp.set(x, y, z, y === 4 ? B.ORANGE_TERRACOTTA : y === 1 ? B.SANDSTONE : B.CUT_SANDSTONE);
        else bp.set(x, y, z, B.AIR);
      }
    }
  }
  for (let z = -7; z <= 7; z += 1) {
    for (let x = -7; x <= 7; x += 1) {
      const border = Math.abs(x) === 6 || Math.abs(z) === 6;
      const star = (Math.abs(x) <= 1 && Math.abs(z) <= 1) || (x === 0 && Math.abs(z) <= 3) || (z === 0 && Math.abs(x) <= 3);
      bp.set(x, 0, z, star ? (x === 0 && z === 0 ? B.GLOWSTONE : B.ORANGE_TERRACOTTA) : border ? B.TERRACOTTA : B.CUT_SANDSTONE);
    }
  }
  // Four pillars, gold-capped, a lantern hung from each corner of the ceiling.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let y = 1; y < H; y += 1) {
        for (const dx of [0, 1]) for (const dz of [0, 1]) bp.set(sx * (4 + dx), y, sz * (4 + dz), y === H - 1 ? B.GOLD_BLOCK : y === 4 ? B.ORANGE_TERRACOTTA : B.CUT_SANDSTONE);
      }
      bp.set(sx * 6, H - 1, sz * 6, B.LANTERN, HANG);
    }
  }
  bp.set(0, H - 1, 0, B.LANTERN, HANG);
  // The dais at the back, the crest chest between gold, banners on the wall behind.
  for (let x = -3; x <= 3; x += 1) for (let z = -7; z <= -5; z += 1) bp.set(x, 1, z, B.CUT_SANDSTONE);
  for (let x = -1; x <= 1; x += 1) bp.set(x, 2, -7, B.CUT_SANDSTONE);
  bp.chest(0, 2, -6, 2, captainLoot(rng, 3));
  for (const sx of [-2, 2]) {
    bp.set(sx, 2, -6, B.GOLD_BLOCK);
    bp.set(sx, 3, -6, B.LANTERN, 0);
    bp.set(sx, 5, -7, B.BANNER, 3 | (3 << 3));
  }
  // Sarcophagi along the side walls; two side chests of grave goods.
  for (const sx of [-1, 1]) {
    for (const z of [-2, 2]) {
      for (let dz = 0; dz <= 1; dz += 1) {
        bp.set(sx * 6, 1, z + dz, B.SANDSTONE);
        bp.set(sx * 6, 2, z + dz, B.ORANGE_TERRACOTTA);
      }
    }
    bp.chest(sx * 7, 1, 0, sx < 0 ? 0 : 1, spoils(rng, 2));
  }
  // The corridor in from the door, and the portal round it.
  for (let z = 9; z <= R; z += 1) {
    for (let x = -2; x <= 2; x += 1) {
      for (let y = 1; y <= 5; y += 1) {
        const wall = Math.abs(x) === 2 || y === 5;
        bp.set(x, y, z, wall ? (y === 3 && Math.abs(x) === 2 ? B.ORANGE_TERRACOTTA : B.CUT_SANDSTONE) : B.AIR);
      }
    }
    if (z % 3 === 0) bp.set(0, 4, z, B.LANTERN, HANG);
  }
  for (let x = -1; x <= 1; x += 1) for (let y = 1; y <= 4; y += 1) bp.set(x, y, 8, B.AIR);
  for (const sx of [-3, 3]) {
    for (let y = 1; y <= 7; y += 1) for (const z of [R, R + 1]) bp.set(sx, y, z, y === 7 ? B.GOLD_BLOCK : B.CUT_SANDSTONE);
    bp.set(sx, 4, R + 2, B.BANNER, 3 | (3 << 3));
  }
  for (let x = -3; x <= 3; x += 1) for (const z of [R, R + 1]) bp.set(x, 8, z, B.ORANGE_TERRACOTTA);
  for (let x = -1; x <= 1; x += 1) for (let y = 1; y <= 5; y += 1) for (const z of [R, R + 1]) bp.set(x, y, z, B.AIR);
  // Two obelisks guard the approach; a sandstone walk leads in.
  for (const sx of [-9, 9]) {
    for (let y = 1; y <= 9; y += 1) bp.set(sx, y, R + 8, y === 9 ? B.GOLD_BLOCK : B.CUT_SANDSTONE);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) bp.set(sx + dx, 1, R + 8 + dz, B.SANDSTONE);
  }
  for (let z = R + 2; z <= R + 14; z += 1) for (let x = -2; x <= 2; x += 1) bp.set(x, 0, z, Math.abs(x) === 2 ? B.CUT_SANDSTONE : B.SANDSTONE);
  return bp;
}

// ------------------------------------------------------------------ the coven

/** Where the coven's three huts stand round the lagoon (local, from its middle). */
export function covenHuts(r: number): Array<[number, number]> {
  return [0, 1, 2].map((k) => {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    return [Math.round(Math.cos(a) * r * 0.33), Math.round(Math.sin(a) * r * 0.33)];
  });
}

/**
 * The witches' coven (local: the lagoon's middle at 0, 0; y 0 the lagoon floor SEA - 6): three huts
 * on stilts over their islands, each round a bubbling cauldron, joined by rope walks; a pier from the
 * shore on the pass side (+z).
 */
function coven(rng: Rng, r: number): Blueprint {
  const bp = new Blueprint();
  const base = SEA - 6;
  const island = SEA + 2 - base;
  const floor = SEA + 5 - base;
  const huts = covenHuts(r);
  for (const [hx, hz] of huts) {
    // Stilts down into the island, the floor, the walls, a door toward the lagoon's middle.
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) for (let y = island - 2; y < floor; y += 1) bp.set(hx + dx, y, hz + dz, B.SPRUCE_LOG);
    for (let dz = -3; dz <= 3; dz += 1) for (let dx = -3; dx <= 3; dx += 1) bp.set(hx + dx, floor, hz + dz, B.SPRUCE_PLANKS);
    const toMid = Math.abs(hx) > Math.abs(hz) ? [-Math.sign(hx), 0] : [0, -Math.sign(hz)];
    for (let y = floor + 1; y <= floor + 3; y += 1) {
      for (let dz = -3; dz <= 3; dz += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
          if (!edge) continue;
          const corner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
          const door = dx === toMid[0]! * 3 && dz === toMid[1]! * 3 && y < floor + 3;
          if (door) continue;
          const window = y === floor + 2 && !corner && (dx === 0 || dz === 0);
          bp.set(hx + dx, y, hz + dz, corner ? B.SPRUCE_LOG : window ? B.GLASS_PANE : rng() < 0.2 ? B.MOSSY_COBBLE : B.SPRUCE_PLANKS);
        }
      }
    }
    // A steep hipped roof of oak stairs, a mushroom-red tip.
    for (let k = 0; k <= 3; k += 1) {
      const s = 4 - k;
      const y = floor + 4 + k;
      for (let d = -s; d <= s; d += 1) {
        bp.set(hx + d, y, hz - s, B.SPRUCE_STAIRS, 2);
        bp.set(hx + d, y, hz + s, B.SPRUCE_STAIRS, 3);
        bp.set(hx - s, y, hz + d, B.SPRUCE_STAIRS, 0);
        bp.set(hx + s, y, hz + d, B.SPRUCE_STAIRS, 1);
      }
      for (let dz = -s + 1; dz <= s - 1; dz += 1) for (let dx = -s + 1; dx <= s - 1; dx += 1) bp.set(hx + dx, y, hz + dz, B.SPRUCE_PLANKS);
    }
    bp.set(hx, floor + 8, hz, B.RED_WOOL);
    // The cauldron, its shelves and a lantern; a flower box of mushrooms under a window.
    bp.set(hx, floor + 1, hz, B.CAULDRON);
    bp.set(hx + 2, floor + 1, hz + 2, B.BOOKSHELF);
    bp.set(hx - 2, floor + 1, hz + 2, B.CRAFTING_TABLE);
    bp.set(hx + 2, floor + 1, hz - 2, B.BARREL);
    bp.chest(hx - 2, floor + 1, hz - 2, 0, [[I.POTION, range(rng, 1, 2)], [I.EMERALD, range(rng, 1, 3)], [I.REDSTONE, range(rng, 2, 4)]]);
    bp.set(hx, floor + 3, hz, B.LANTERN, HANG);
    bp.set(hx + toMid[0]! * 4, floor + 2, hz + toMid[1]! * 4, B.LANTERN, 0);
    bp.set(hx + toMid[0]! * 4, floor + 1, hz + toMid[1]! * 4, B.SPRUCE_LOG);
    for (let n = 0; n < 4; n += 1) {
      const dx = Math.floor(rng() * 9) - 4;
      const dz = Math.floor(rng() * 9) - 4;
      if (Math.abs(dx) === 4 || Math.abs(dz) === 4) bp.set(hx + dx, floor + 4 - Math.floor(rng() * 2), hz + dz, B.COBWEB);
    }
  }
  // Rope walks between the huts: slab decks on posts, fence rails, lanterns along them.
  for (let a = 0; a < 3; a += 1) {
    const [ax, az] = huts[a]!;
    const [bx, bz] = huts[(a + 1) % 3]!;
    const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const x = Math.round(ax + (bx - ax) * t);
      const z = Math.round(az + (bz - az) * t);
      if (Math.max(Math.abs(x - ax), Math.abs(z - az)) <= 3 || Math.max(Math.abs(x - bx), Math.abs(z - bz)) <= 3) continue;
      bp.set(x, floor, z, B.OAK_SLAB, 1);
      // Rails either side (across the walk).
      const rx = Math.round(-uz);
      const rz = Math.round(ux);
      for (const s of [-1, 1]) {
        const px = x + rx * s;
        const pz = z + rz * s;
        if (bp.get(px, floor, pz) < 0) bp.set(px, floor, pz, B.OAK_SLAB, 1);
        bp.set(px, floor + 1, pz, i % 8 === 4 ? B.SPRUCE_LOG : B.FENCE);
        if (i % 8 === 4) {
          bp.set(px, floor + 2, pz, B.LANTERN, 0);
          for (let y = 1; y < floor; y += 1) bp.set(px, y, pz, B.SPRUCE_LOG);
        }
      }
    }
  }
  // The pier from the pass-side shore to the nearest hut (a ladder up to its floor).
  const near = [...huts].sort((p, q) => q[1] - p[1])[0]!;
  const z0 = near[1] + 4;
  for (let z = z0; z <= Math.round(r * 0.66); z += 1) {
    for (let x = near[0] - 1; x <= near[0] + 1; x += 1) bp.set(x, island, z, B.SPRUCE_PLANKS);
    if (z % 5 === 0) {
      for (const sx of [-2, 2]) {
        for (let y = island - 3; y <= island + 1; y += 1) bp.set(near[0] + sx, y, z, y === island + 1 ? B.LANTERN : B.SPRUCE_LOG, y === island + 1 ? 0 : -1);
      }
    }
  }
  for (let y = island + 1; y <= floor; y += 1) bp.set(near[0], y, z0 - 1, B.LADDER, 3);
  bp.del(near[0], floor + 1, near[1] + 3);
  bp.del(near[0], floor + 2, near[1] + 3);
  return bp;
}

// ------------------------------------------------------------------ the outlaw fort

/** Where the outlaws keep their captives (local, from the fort's middle). */
export const FORT_CAGES: ReadonlyArray<[number, number]> = [[-9, 4], [0, 7], [9, 4]];

/**
 * The outlaws' fort on its mesa (local: its middle at 0, 0, its gate facing +z): a log palisade with
 * a watchtower at each corner, the Red Hawk's broken hull nailed over the gate (her cannon still on
 * it), the warlord's hall at the back with the crest chest beside his throne, cages in the yard.
 */
function outlawFort(rng: Rng): Blueprint {
  const bp = new Blueprint();
  const S = 17;
  for (let z = -S; z <= S; z += 1) {
    for (let x = -S; x <= S; x += 1) {
      bp.set(x, 0, z, rng() < 0.3 ? B.GRAVEL : rng() < 0.5 ? B.COARSE_DIRT : B.PATH);
      const wall = Math.abs(x) === S || Math.abs(z) === S;
      if (!wall) continue;
      if (z === S && Math.abs(x) <= 2) continue;
      const h = 4 + (rng() < 0.3 ? 1 : 0);
      for (let y = 1; y <= h; y += 1) bp.set(x, y, z, B.SPRUCE_LOG);
      if ((x + z) % 2 === 0) bp.set(x, h + 1, z, B.FENCE);
    }
  }
  // The gatehouse: the Red Hawk's legs as its towers, her hull across the top with her cannon.
  for (const sx of [-4, 3]) {
    for (let y = 1; y <= 9; y += 1) {
      for (const dx of [0, 1]) for (const dz of [S - 1, S]) bp.set(sx + dx, y, dz, y === 4 ? B.GEARBOX : rng() < 0.3 ? B.CRACKED_STONE_BRICKS : B.STONE_BRICKS);
    }
  }
  for (let x = -5; x <= 5; x += 1) {
    for (const z of [S - 2, S - 1, S, S + 1]) {
      bp.set(x, 6, z, z === S - 2 || z === S + 1 ? B.COBBLE : B.SMOOTH_STONE);
      bp.set(x, 7, z, z === S - 2 || z === S + 1 ? B.COBBLE : B.PLANKS);
      if ((z === S - 2 || z === S + 1) && x % 2 === 0) bp.set(x, 8, z, B.FENCE);
    }
  }
  bp.set(0, 8, S, B.CANNON);
  bp.set(-5, 5, S + 1, B.BANNER, 2 | (0 << 3));
  bp.set(5, 5, S + 1, B.BANNER, 2 | (0 << 3));
  for (const sx of [-6, 6]) {
    for (let y = 1; y <= 3; y += 1) bp.set(sx, y, S + 2, B.SPRUCE_LOG);
    bp.set(sx, 4, S + 2, B.LANTERN, 0);
  }
  // Corner watchtowers: log posts, a plank platform with rails, a pointed roof, a ladder.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (S - 2);
      const cz = sz * (S - 2);
      for (let y = 1; y <= 8; y += 1) for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) bp.set(cx + dx, y, cz + dz, B.SPRUCE_LOG);
      for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) bp.set(cx + dx, 8, cz + dz, dx === 0 && dz === 0 ? B.AIR : B.SPRUCE_PLANKS);
      for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) if (Math.abs(dx) === 2 || Math.abs(dz) === 2) bp.set(cx + dx, 9, cz + dz, Math.abs(dx) === 2 && Math.abs(dz) === 2 ? B.SPRUCE_LOG : B.FENCE);
      for (let k = 0; k <= 2; k += 1) {
        const s = 3 - k;
        for (let d = -s; d <= s; d += 1) {
          bp.set(cx + d, 11 + k, cz - s, B.SPRUCE_STAIRS, 2);
          bp.set(cx + d, 11 + k, cz + s, B.SPRUCE_STAIRS, 3);
          bp.set(cx - s, 11 + k, cz + d, B.SPRUCE_STAIRS, 0);
          bp.set(cx + s, 11 + k, cz + d, B.SPRUCE_STAIRS, 1);
        }
      }
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) bp.set(cx + dx, 10, cz + dz, B.SPRUCE_LOG);
      bp.set(cx, 13, cz, B.SPRUCE_PLANKS);
      for (let y = 1; y <= 8; y += 1) bp.set(cx, y, cz + 1, B.LADDER, 3);
      bp.set(cx, 10, cz, B.LANTERN, HANG);
    }
  }
  // The warlord's hall: cobble and dark timber, a gable roof, a red carpet up to his throne.
  const hx0 = -7;
  const hx1 = 7;
  const hz0 = -14;
  const hz1 = -5;
  for (let y = 1; y <= 5; y += 1) {
    for (let z = hz0; z <= hz1; z += 1) {
      for (let x = hx0; x <= hx1; x += 1) {
        const edge = x === hx0 || x === hx1 || z === hz0 || z === hz1;
        if (!edge) {
          if (y === 1) bp.set(x, 0, z, Math.abs(x) <= 1 ? B.RED_WOOL : B.SPRUCE_PLANKS);
          continue;
        }
        const post = (x - hx0) % 4 === 0 || z === hz0 || z === hz1 ? (x - hx0) % 4 === 0 : false;
        const window = y === 3 && !post && (z === hz1 || z === hz0) && (x - hx0) % 4 === 2;
        bp.set(x, y, z, post ? B.SPRUCE_LOG : window ? B.GLASS_PANE : y === 1 ? B.COBBLE : B.SPRUCE_PLANKS);
      }
    }
  }
  for (let x = -1; x <= 1; x += 1) for (let y = 1; y <= 3; y += 1) bp.set(x, y, hz1, B.AIR);
  for (let k = 0; k <= 5; k += 1) {
    for (let x = hx0 - 1; x <= hx1 + 1; x += 1) {
      const zf = hz1 + 1 - k;
      const zb = hz0 - 1 + k;
      if (zf > zb) {
        bp.set(x, 6 + k, zf, B.SPRUCE_STAIRS, 3);
        bp.set(x, 6 + k, zb, B.SPRUCE_STAIRS, 2);
      } else if (zf === zb) bp.set(x, 6 + k, zf, B.SPRUCE_SLAB, 0);
    }
    for (let z = hz0 + k; z <= hz1 - k; z += 1) {
      if (k === 0) continue;
      for (const x of [hx0, hx1]) bp.set(x, 5 + k, z, B.SPRUCE_PLANKS);
    }
  }
  bp.set(0, 1, hz0 + 1, B.SPRUCE_STAIRS, 2);
  bp.set(0, 2, hz0 + 1, B.AIR);
  bp.set(-1, 1, hz0 + 1, B.GOLD_BLOCK);
  bp.set(1, 1, hz0 + 1, B.GOLD_BLOCK);
  bp.chest(2, 1, hz0 + 1, 2, captainLoot(rng, 3));
  for (const x of [-5, 5]) {
    bp.set(x, 3, hz0 + 1, B.BANNER, 2 | (0 << 3));
    bp.set(x, 4, hz1 - 1, B.LANTERN, HANG);
  }
  bp.set(0, 4, (hz0 + hz1) >> 1, B.LANTERN, HANG);
  bp.set(-6, 1, hz0 + 1, B.TNT_BLOCK);
  bp.set(-6, 2, hz0 + 1, B.TNT_BLOCK);
  bp.set(6, 1, hz0 + 1, B.BARREL);
  // Cages for the captives: fence pens under a slab roof.
  for (const [cx, cz] of FORT_CAGES) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        for (let y = 1; y <= 2; y += 1) bp.set(cx + dx, y, cz + dz, B.FENCE);
      }
    }
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) bp.set(cx + dx, 3, cz + dz, B.SPRUCE_SLAB, 0);
    bp.villagers.push([cx, 1, cz]);
  }
  // The yard: a fire, barrels, a stack of TNT, straw targets, a striped tent.
  bp.set(-3, 1, -1, B.COBBLE);
  bp.set(-3, 2, -1, B.LANTERN, 0);
  for (const [x, z] of [[-12, -2], [-12, -1], [12, 9], [11, 9]] as const) bp.set(x, 1, z, B.BARREL);
  for (const [x, z] of [[12, -3], [13, -3], [12, -2]] as const) bp.set(x, 1, z, B.TNT_BLOCK);
  for (const x of [-12, -9]) {
    bp.set(x, 1, 11, B.FENCE);
    bp.set(x, 2, 11, B.HAY);
  }
  for (let x = 4; x <= 7; x += 1) {
    for (let y = 1; y <= 3; y += 1) {
      const half = 3 - y;
      for (let z = -half; z <= half; z += 1) if (Math.abs(z) === half || y === 3) bp.set(x, y, z - 1, (x + y) % 2 === 0 ? B.RED_WOOL : B.WOOL);
    }
  }
  bp.chest(6, 1, -1, 0, spoils(rng, 3));
  return bp;
}

// ------------------------------------------------------------------ the forge

/**
 * The Builders' Forge on its island in Mount Cinder's lava lake (local: the island's top at y 0,
 * its middle at 0, 0; the bridge runs out to the crater rim along +z): a nether-brick floor, black
 * pillars capped in gold under a ring roof open to the sky, the great anvil in the middle with six
 * pedestals round it for the crests, a bank of furnaces behind.
 */
function forge(rng: Rng, rimDist: number, rimRise: number): Blueprint {
  const bp = new Blueprint();
  for (let z = -5; z <= 5; z += 1) for (let x = -5; x <= 5; x += 1) if (Math.hypot(x, z) <= 5.6) bp.set(x, 0, z, Math.abs(x) + Math.abs(z) <= 1 ? B.MAGMA : B.NETHER_BRICKS);
  for (const sx of [-4, 4]) {
    for (const sz of [-4, 4]) {
      for (let y = 1; y <= 6; y += 1) bp.set(sx, y, sz, y === 6 ? B.GOLD_BLOCK : y === 3 ? B.MAGMA : B.BLACKSTONE);
      bp.set(sx - Math.sign(sx), 5, sz, B.LANTERN, HANG);
    }
  }
  for (let z = -5; z <= 5; z += 1) {
    for (let x = -5; x <= 5; x += 1) {
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d >= 4 && d <= 5) bp.set(x, 7, z, B.NETHER_BRICKS);
    }
  }
  for (const [x, z] of [[-5, 0], [5, 0], [0, -5]] as const) bp.set(x, 6, z, B.BANNER, dirOf(-Math.sign(x), -Math.sign(z)) | (3 << 3));
  bp.set(0, 1, 0, B.ANVIL);
  bp.set(0, 6, 0, B.LANTERN, HANG);
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * 2.6);
    const z = Math.round(Math.sin(a) * 2.6);
    bp.set(x, 1, z, B.BLACKSTONE);
    bp.set(x, 2, z, B.COBBLE_WALL);
  }
  for (let x = -2; x <= 2; x += 1) {
    bp.set(x, 1, -4, B.FURNACE, 2);
    bp.set(x, 2, -4, x === 0 ? B.GOLD_BLOCK : B.NETHER_BRICKS);
  }
  bp.chest(3, 1, -3, 1, spoils(rng, 4));
  // The bridge out to the rim: nether-brick steps over the lava, rails and lanterns.
  for (let z = 5; z <= rimDist; z += 1) {
    const y = Math.round(((z - 5) / Math.max(1, rimDist - 5)) * rimRise);
    for (let x = -1; x <= 1; x += 1) {
      bp.set(x, y, z, B.NETHER_BRICKS);
      bp.set(x, y - 1, z, B.NETHER_BRICKS);
      for (let h = 1; h <= 3; h += 1) bp.set(x, y + h, z, B.AIR);
    }
    for (const sx of [-2, 2]) {
      bp.set(sx, y, z, B.NETHER_BRICKS);
      bp.set(sx, y + 1, z, z % 5 === 0 ? B.BLACKSTONE : B.FENCE);
      if (z % 5 === 0) bp.set(sx, y + 2, z, B.LANTERN, 0);
    }
  }
  return bp;
}

// ------------------------------------------------------------------ small things

/** The Bramble crew's graves: cobble-wall markers in a row, a lantern at the end. */
function graves(rng: Rng): Blueprint {
  const bp = new Blueprint();
  for (let k = 0; k < 6; k += 1) {
    const x = k * 2;
    bp.set(x, 0, 0, B.COARSE_DIRT);
    bp.set(x, 0, 1, B.COARSE_DIRT);
    bp.set(x, 1, -1, B.COBBLE_WALL);
    if (rng() < 0.6) bp.set(x, 1, 1, rng() < 0.5 ? B.POPPY : B.OXEYE);
  }
  bp.set(12, 1, -1, B.SPRUCE_LOG);
  bp.set(12, 2, -1, B.LANTERN, 0);
  return bp;
}

/** A cairn by a mountain path: a stack of stones with a lantern on top. */
function cairn(rng: Rng): Blueprint {
  const bp = new Blueprint();
  bp.set(0, 1, 0, B.COBBLE);
  bp.set(0, 2, 0, rng() < 0.5 ? B.MOSSY_COBBLE : B.COBBLE);
  bp.set(0, 3, 0, B.COBBLE_WALL);
  bp.set(0, 4, 0, B.LANTERN, 0);
  return bp;
}

// ------------------------------------------------------------------ placing them

/**
 * Places a blueprint with its local origin at (cx, floorY, cz), turned `rot` quarter turns (turns
 * map local +z, the front, onto the world: 0 +z, 2 -z).
 */
function placeAt(bp: Blueprint, kind: StructKind, name: string, e: ExpeditionSite, rot: number, cx: number, floorY: number, cz: number, id: string, keep = false): Structure {
  let rx0 = Infinity;
  let rz0 = Infinity;
  for (const [x, , z, cell] of bp.cells.values()) {
    if (cell < 0) continue;
    const [a, b] = rotXZ(x, z, rot);
    rx0 = Math.min(rx0, a);
    rz0 = Math.min(rz0, b);
  }
  const s = place(bp, kind, name, e.site, rot, cx + rx0, floorY, cz + rz0, id);
  if (keep) s.keep = true;
  return s;
}

/** The structure holding an expedition's crest chest (its first chest). */
export function crestStructureId(e: ExpeditionSite): string {
  return e.id === 'pyramid' ? `x${e.index}:pyramid` : e.id === 'fort' ? `x${e.index}:fort` : `x${e.index}:wreck`;
}

/** Every structure of an expedition. */
export function expeditionStructures(terrain: Terrain, e: ExpeditionSite): Structure[] {
  const rng = mulberry32(e.x * 92821 + e.z * 31 + e.index);
  // Facing the pass: the front (+z local) turned toward the valley.
  const rot = e.side < 0 ? 0 : 2;
  const toward = -e.side;
  const out: Structure[] = [];
  switch (e.id) {
    case 'meadow': {
      out.push(placeAt(wreck(rng, 'moss', true), 'wreck', 'Wreck of the Bramble', e, rot, e.x, e.y, e.z, `x${e.index}:wreck`));
      out.push(placeAt(graves(rng), 'cairn', 'Graves of the Bramble\'s Crew', e, rot, e.x - 12, e.y, e.z + toward * 18, `x${e.index}:graves`));
      break;
    }
    case 'pyramid': {
      out.push(placeAt(pyramid(rng), 'pyramid', 'The Sun Pyramid', e, rot, e.x, e.y, e.z, `x${e.index}:pyramid`));
      out.push(placeAt(wreck(rng, 'sand', false), 'wreck', 'Wreck of the Sunstrider', e, rot + 1, e.x + 30, e.y, e.z + toward * 12, `x${e.index}:wreck`));
      break;
    }
    case 'lagoon': {
      out.push(placeAt(coven(rng, e.r), 'coven', 'The Black Lagoon Coven', e, 0, e.x, SEA - 6, e.z, `x${e.index}:coven`, true));
      out.push(placeAt(wreck(rng, 'sunk', true), 'wreck', 'Wreck of the Mire Lily', e, rot, e.x, SEA - 6, e.z, `x${e.index}:wreck`, true));
      break;
    }
    case 'fort': {
      out.push(placeAt(outlawFort(rng), 'outlawfort', 'The Outlaw Fort', e, rot, e.x, e.y + 16, e.z, `x${e.index}:fort`));
      break;
    }
    case 'frostpeak': {
      const [sx, sy, sz] = e.summit!;
      out.push(placeAt(wreck(rng, 'ice', true), 'wreck', 'Wreck of the Winter Lark', e, rot, sx, sy, sz, `x${e.index}:wreck`));
      out.push(...pathCairns(terrain, e, rng));
      break;
    }
    case 'cinder': {
      const rim = 24;
      out.push(placeAt(forge(rng, rim + 1, CINDER.rim - CINDER.island), 'forge', 'The Builders\' Forge', e, rot, e.x, e.y + CINDER.island, e.z, `x${e.index}:forge`));
      out.push(placeAt(wreck(rng, 'ember', true), 'wreck', 'Wreck of the Ember Queen', e, rot, e.x - 30, e.y, e.park[1] - toward * 4, `x${e.index}:wreck`));
      out.push(...pathCairns(terrain, e, rng));
      break;
    }
    default:
      break;
  }
  return out;
}

/** Cairns along a mountain's path, every so far up it. */
function pathCairns(terrain: Terrain, e: ExpeditionSite, rng: Rng): Structure[] {
  const out: Structure[] = [];
  const pts = terrain.pathPoints(e, 7);
  pts.forEach(([x, z], i) => {
    const y = terrain.heightInt(x, z);
    out.push(placeAt(cairn(rng), 'cairn', 'Cairn', e, 0, x, y, z, `x${e.index}:cairn${i}`, true));
  });
  return out;
}

export { wreck as wreckBlueprint };
