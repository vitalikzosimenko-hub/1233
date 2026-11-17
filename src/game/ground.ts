// What the ground is made of, column by column: the block a column shows on top, what lies under
// it and how deep, and the rock below. Chunk generation lays these down and the distant terrain
// paints with them, so the two always agree.
import { B } from './blocks';
import { hash2 } from './rng';
import { Noise2, SEA, type BiomeKind, type Terrain, type Zone } from './terrain';

/** The badlands' strata, two blocks to a band, bottom to top (they repeat up the mesas). */
const BADLANDS_BANDS = [
  B.TERRACOTTA, B.ORANGE_TERRACOTTA, B.ORANGE_TERRACOTTA, B.YELLOW_TERRACOTTA, B.BROWN_TERRACOTTA, B.TERRACOTTA,
  B.WHITE_TERRACOTTA, B.ORANGE_TERRACOTTA, B.RED_SANDSTONE, B.TERRACOTTA, B.YELLOW_TERRACOTTA, B.WHITE_TERRACOTTA, B.ORANGE_TERRACOTTA,
];

function band(y: number, warp: number): number {
  const L = BADLANDS_BANDS.length;
  const i = Math.floor((y + warp * 0.6) / 2);
  return BADLANDS_BANDS[((i % L) + L) % L]!;
}

/** A column as chunk generation sees it: surface height, steepness and land. */
export interface Col {
  h: number;
  slope: number;
  biome: BiomeKind;
  zone: Zone;
  trees: number;
  mountain: number;
}

/** Per-world noise for strata, plant patches and boulders. */
class Detail {
  readonly strata: Noise2;
  readonly patches: Noise2;
  readonly granite: Noise2;

  constructor(seed: number) {
    this.strata = new Noise2(seed * 13 + 5);
    this.patches = new Noise2(seed * 13 + 6);
    this.granite = new Noise2(seed * 13 + 7);
  }
}

const details = new WeakMap<Terrain, Detail>();

export function detail(t: Terrain): Detail {
  let d = details.get(t);
  if (!d) {
    d = new Detail(t.seed);
    details.set(t, d);
  }
  return d;
}

/** Deterministic per-cell random in 0..1. */
export function rnd(x: number, y: number, z: number, salt: number): number {
  return hash2(x * 31 + y * 1013, z * 17 - y * 7, salt);
}

/** Bare rock (or its land's own) where the ground is too steep to hold soil: sooner up the mountains. */
function steepCol(col: Col): boolean {
  return col.slope >= 3 || (col.mountain > 0.4 && col.slope >= 2);
}

export interface Ground {
  top: number;
  under: number;
  /** Blocks of `under` (the top included) before the rock. */
  depth: number;
}

/** The top block of a column, the soil under it and how deep that goes. */
export function groundOf(T: Terrain, x: number, z: number, col: Col): Ground {
  const D = detail(T);
  const h = col.h;
  const steep = steepCol(col);
  let top: number;
  let under: number;
  let depth: number;
  switch (col.biome) {
    case 'peak':
      top = steep ? B.STONE : B.SNOW;
      under = B.STONE;
      depth = 1;
      break;
    case 'mountain':
      top = steep ? B.STONE : B.GRASS;
      under = steep ? B.STONE : B.DIRT;
      depth = 2;
      break;
    case 'beach':
      top = h < SEA - 1 ? (rnd(x, h, z, 3) < 0.3 ? B.GRAVEL : B.SAND) : B.SAND;
      under = B.SAND;
      depth = 3;
      break;
    case 'river':
      top = rnd(x, h, z, 4) < 0.45 ? B.GRAVEL : rnd(x, h, z, 5) < 0.5 ? B.SAND : B.DIRT;
      under = B.DIRT;
      depth = 2;
      break;
    case 'desert':
      top = steep ? B.SANDSTONE : B.SAND;
      under = B.SANDSTONE;
      depth = 4;
      break;
    case 'blight':
      top = steep ? B.STONE : rnd(x, h, z, 7) < 0.12 || D.patches.noise(x * 0.05 + 3, z * 0.05) > 0.45 ? B.BLIGHT_MOSS : B.BLIGHT_GRASS;
      under = steep ? B.STONE : B.DIRT;
      depth = 3;
      break;
    case 'swamp': {
      // Grass over dirt, mud where it is wettest (pool beds, the hollows by the water).
      const wet = h <= SEA || D.patches.noise(x * 0.07 - 5, z * 0.07 + 2) > 0.38;
      top = steep ? B.DIRT : wet ? (rnd(x, h, z, 8) < 0.7 ? B.MUD : B.DIRT) : B.GRASS;
      under = wet ? B.MUD : B.DIRT;
      depth = 3;
      break;
    }
    case 'badlands':
      // Red sand and coarse dirt on the flats; the cliffs show their strata.
      top = steep ? band(h, 0) : rnd(x, h, z, 9) < 0.14 || D.patches.noise(x * 0.06 + 7, z * 0.06) > 0.5 ? B.COARSE_DIRT : B.RED_SAND;
      under = steep ? band(h - 1, 0) : B.RED_SANDSTONE;
      depth = steep ? 1 : 3;
      break;
    case 'ember': {
      // Ash plains, blackstone outcrops, magma seams; basalt where it stands steep.
      const outcrop = D.patches.noise(x * 0.05 - 9, z * 0.05 + 3);
      top = steep ? B.BASALT : outcrop > 0.42 ? B.BLACKSTONE : rnd(x, h, z, 10) < 0.05 || outcrop < -0.5 ? B.MAGMA : B.ASH;
      under = steep ? B.BASALT : B.BLACKSTONE;
      depth = 3;
      break;
    }
    default:
      top = steep ? B.STONE : B.GRASS;
      under = steep ? B.STONE : B.DIRT;
      depth = 3 + (rnd(x, 0, z, 6) < 0.5 ? 1 : 0);
  }
  // Region colouring of the shared biomes: snow over grass (deep on the slopes, where a snowy
  // sod's dirt would show), red rock in the desert hills.
  if (col.zone === 'snow' && top === B.GRASS) {
    top = col.slope >= 1 || col.mountain > 0.08 ? B.SNOW : B.GRASS_SNOW;
    if (top === B.SNOW) under = B.SNOW;
  }
  if (col.zone === 'desert' && top === B.GRASS) top = B.SAND;
  if (col.zone === 'blight' && top === B.GRASS) top = B.BLIGHT_GRASS;
  if (col.zone === 'badlands' && (top === B.GRASS || top === B.STONE)) top = steep ? band(h, 0) : B.RED_SAND;
  if (col.zone === 'ember' && (top === B.GRASS || top === B.STONE || top === B.SNOW)) top = steep ? B.BASALT : B.ASH;
  // The snowfields' ice spikes: packed ice all the way up, a blue core.
  if (col.zone === 'snow' && col.mountain < 0.4) {
    const spike = T.pillar('snow', x, z);
    if (spike) {
      top = B.PACKED_ICE;
      under = rnd(x, 3, z, 11) < 0.35 ? B.BLUE_ICE : B.PACKED_ICE;
      depth = Math.ceil(spike.tall) + 1;
    }
  }
  // The great landmarks' own ground.
  const mark = T.landmarkGround(x, z, h, steep);
  if (mark) {
    top = mark.top;
    under = mark.under;
    depth = mark.depth;
  }
  return { top, under, depth };
}

/** A column's rock layers: their warp and whether granite shows in them. */
export interface Strata {
  warp: number;
  granite: boolean;
  zone: Zone;
}

export function strataOf(T: Terrain, x: number, z: number, zone: Zone): Strata {
  const D = detail(T);
  return { warp: D.strata.noise(x * 0.03, z * 0.03) * 3, granite: D.granite.noise(x * 0.004, z * 0.004) > 0.35, zone };
}

/**
 * The rock at height y under a column whose surface is at h (ores aside): andesite (and in
 * places granite) strata in the stone, the badlands' colour bands, the ember wastes' black rock,
 * the desert's terracotta.
 */
export function rockAt(s: Strata, y: number, h: number): number {
  const layer = Math.floor((y + s.warp) / 4) % 5;
  if (s.zone === 'badlands' && h - y < 36) return band(y, s.warp);
  if (s.zone === 'ember' && h - y < 18) return layer % 2 === 1 ? B.BLACKSTONE : B.BASALT;
  if (s.zone === 'desert' && h - y < 22) return layer === 1 || layer === 3 ? B.TERRACOTTA : layer === 2 ? B.SANDSTONE : B.STONE;
  return layer === 1 ? B.ANDESITE : layer === 3 && s.granite ? B.GRANITE : B.STONE;
}
