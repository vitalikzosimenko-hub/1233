// Pure, seeded terrain functions for the open world: a long river valley walled by mountains,
// with lakes, waterfall cliffs, hills and flattened village plateaus. Chunk generation, the
// distant LOD terrain and the world map all sample these, so they always agree.
//
// Two layouts share the code: the classic valley (games saved before the Long March: five
// villages and the Citadel) and the Long March (new games): a valley three times as long through
// seven lands, from Greenvale's meadows by way of the desert, the Mirefen swamp, the Rustcanyon
// badlands, the Frostfang snowfields and the Ember Wastes to the Blight, barred by six Heart Seals.
import { B } from './blocks';
import { mulberry32, type Rng } from './rng';

export const CS = 16;
/** Chunks along x (the long march east) and along z (across the valley). */
export const CHUNKS_X = 256;
export const CHUNKS_Z = 96;
export const WX = CS * CHUNKS_X;
export const WZ = CS * CHUNKS_Z;
export const WY = 128;
export const SEA = 48;

export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** How far Frostpeak and Mount Cinder spread from their middles. */
const FROST_R = 92;
const CINDER_R = 98;
/** How far a mountain path's shoulders run out from its edge. */
const SHOULDER = 6;

/** Seeded 2D gradient (Perlin) noise in about -1..1. */
export class Noise2 {
  private readonly perm = new Uint8Array(512);
  private readonly gx = new Float32Array(256);
  private readonly gy = new Float32Array(256);

  constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) p[i] = i;
    for (let i = 255; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i += 1) this.perm[i] = p[i & 255]!;
    for (let i = 0; i < 256; i += 1) {
      const a = rng() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const p = this.perm;
    const aa = p[p[X]! + Y]!;
    const ab = p[p[X]! + Y + 1]!;
    const ba = p[p[X + 1]! + Y]!;
    const bb = p[p[X + 1]! + Y + 1]!;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const gx = this.gx;
    const gy = this.gy;
    const n00 = gx[aa]! * xf + gy[aa]! * yf;
    const n10 = gx[ba]! * (xf - 1) + gy[ba]! * yf;
    const n01 = gx[ab]! * xf + gy[ab]! * (yf - 1);
    const n11 = gx[bb]! * (xf - 1) + gy[bb]! * (yf - 1);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.41;
  }

  /** Fractal sum, normalised to about -1..1. */
  fbm(x: number, y: number, octaves: number, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += this.noise(x * freq + o * 17.31, y * freq - o * 9.17) * amp;
      norm += amp;
      amp *= gain;
      freq *= 2.03;
    }
    return sum / norm;
  }

  /** Ridged multifractal (0..1): sharp crests, used for mountain ranges. */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o += 1) {
      let n = 1 - Math.abs(this.noise(x * freq + o * 31.7, y * freq + o * 11.3));
      n *= n;
      n *= weight;
      weight = Math.max(0, Math.min(1, n * 1.6));
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  }
}

export type SiteKind = 'village' | 'castle' | 'citadel' | 'camp' | 'expedition';

export interface Site {
  kind: SiteKind;
  index: number;
  name: string;
  x: number;
  z: number;
  /** Plateau height (the floor everything stands on). */
  y: number;
  /** Flattened radius. */
  radius: number;
}

/** A waterfall: water pours off a cliff edge facing (fx, fz) into a plunge pool. */
export interface FallSite {
  x: number;
  z: number;
  fx: number;
  fz: number;
  top: number;
  bottom: number;
  width: number;
}

export type BiomeKind = 'meadow' | 'forest' | 'birch' | 'taiga' | 'mountain' | 'peak' | 'beach' | 'river' | 'desert' | 'snowfield' | 'blight' | 'swamp' | 'badlands' | 'ember';

/** The lands of the valley as the fortress travels east. */
export type Zone = 'green' | 'desert' | 'swamp' | 'badlands' | 'snow' | 'ember' | 'blight';

export interface ColumnInfo {
  h: number;
  /** 0 valley floor .. 1 deep in the mountains. */
  mountain: number;
  biome: BiomeKind;
  zone: Zone;
  /** Trees per column (probability scale). */
  trees: number;
  /** Below sea level water, river channel or lake. */
  water: boolean;
}

/** One land of the valley: what it is, what it is called and where (along x) it begins. */
export interface Region {
  zone: Zone;
  name: string;
  x0: number;
}

/** Who guards each Heart Seal. */
export type GuardianKind = 'queen' | 'dune' | 'slime' | 'ravager' | 'frost' | 'magma';

/** A Heart Seal: a wall of green crystal across the valley at x, until its guardian falls. */
export interface SealSite {
  index: number;
  name: string;
  x: number;
  /** The valley centre at the seal, and its floor there. */
  z: number;
  y: number;
  guardian: GuardianKind;
  /** The region it bars the way into. */
  region: number;
}

/** Mount Cinder, in blocks over its basin's floor: the crater's rim, the lava lake, the forge's island. */
export const CINDER = { rim: 56, lake: 38, island: 42 } as const;

/** The great landmarks off the trail, one in each land before the Blight (the main quest's expeditions). */
export type ExpeditionId = 'meadow' | 'pyramid' | 'lagoon' | 'fort' | 'frostpeak' | 'cinder';

/**
 * An expedition: a land's landmark in a basin carved out of the mountains beside the valley, reached
 * by a wide pass the fortress can walk.
 */
export interface ExpeditionSite {
  index: number;
  id: ExpeditionId;
  name: string;
  /** The landmark's middle, and the basin floor round it. */
  x: number;
  z: number;
  y: number;
  /** The side of the valley it lies on (-1 toward low z, 1 toward high z), and the basin's radius. */
  side: number;
  r: number;
  /** Where the fortress stands while you explore (the basin floor between the pass and the landmark). */
  park: [number, number];
  /** Frostpeak's ledge and Mount Cinder's forge island: the high place the climb leads to (else null). */
  summit: [number, number, number] | null;
  /** The march destination for it. */
  site: Site;
}

/** What stands at a nook: an errand's stone, shrine, chapel, hideout, cairn or vein, or a lost stash. */
export type NookKind = 'survey' | 'shrine' | 'chapel' | 'hideout' | 'lens' | 'vein' | 'stash';

/** A small place off the trail: somewhere an errand sends you, or a lost stash with a curio in it. */
export interface Nook {
  id: string;
  kind: NookKind;
  name: string;
  x: number;
  z: number;
  y: number;
  /** The land it lies in, and (a stash) the curio's place among the land's five. */
  land: number;
  slot: number;
  site: Site;
}

/** A world's layout: its lands, villages, ruins, lairs, mines, treasure and seals, west to east. */
interface Layout {
  version: number;
  endX: number;
  citadelX: number;
  /** How far the borders between lands wander (blocks). */
  wobble: number;
  regions: Region[];
  villages: Array<[number, string]>;
  castles: Array<[number, string]>;
  lairs: Array<[number, string]>;
  mines: number[];
  treasures: number[];
  /** Waterfalls strung along the walls (after the one in view of the first village). */
  falls: number;
  seals: Array<[number, string, GuardianKind]>;
  /** Expeditions: x, side, kind, name, basin radius. */
  expeditions: Array<[number, number, ExpeditionId, string, number]>;
  /** How much wider the valley floor grows from a point east (the open lands of the late march). */
  widen: [x0: number, x1: number, extra: number] | null;
  /** The errands' places: id, x, side of the trail, how far out (shares of the floor's half width), kind, name. */
  nooks: Array<[string, number, number, number, NookKind, string]>;
}

/** The valley as it was before the Long March (saved games keep it, exactly). */
const CLASSIC: Layout = {
  version: 1,
  endX: 1450,
  citadelX: 1405,
  wobble: 45,
  regions: [
    { zone: 'green', name: 'Greenvale', x0: -1e9 },
    { zone: 'desert', name: 'Sunscorch Desert', x0: 590 },
    { zone: 'snow', name: 'Frostfang Snowfields', x0: 840 },
    { zone: 'blight', name: 'The Blight', x0: 1085 },
  ],
  villages: [[235, 'Oakbrook'], [470, 'Millford'], [712, 'Stonewater'], [955, 'Ashvale'], [1198, 'Redcliff']],
  castles: [[360, 'Old Watch'], [590, 'Fort Ember'], [840, 'Mossgate'], [1080, 'Grey Keep'], [1300, 'Hollow Spire']],
  lairs: [[600, 'Brute Hollow'], [1075, 'Warden Crater']],
  mines: [395, 820, 1130],
  treasures: [310, 660, 905, 1160],
  falls: 11,
  seals: [],
  expeditions: [],
  widen: null,
  nooks: [],
};

/** The Long March: seven lands, fourteen villages, six seals, the Citadel at the far end. */
const LONG_MARCH: Layout = {
  version: 2,
  endX: 3960,
  citadelX: 3915,
  wobble: 30,
  regions: [
    { zone: 'green', name: 'Greenvale', x0: -1e9 },
    { zone: 'desert', name: 'Sunscorch Desert', x0: 700 },
    { zone: 'swamp', name: 'Mirefen Swamp', x0: 1240 },
    { zone: 'badlands', name: 'Rustcanyon Badlands', x0: 1780 },
    { zone: 'snow', name: 'Frostfang Snowfields', x0: 2320 },
    { zone: 'ember', name: 'The Ember Wastes', x0: 2860 },
    { zone: 'blight', name: 'The Blight', x0: 3400 },
  ],
  villages: [
    [235, 'Oakbrook'], [475, 'Millford'],
    [800, 'Stonewater'], [1050, 'Dunmere'],
    [1340, 'Bogholm'], [1590, 'Fenwick'],
    [1880, 'Redrock'], [2130, 'Dustwell'],
    [2420, 'Ashvale'], [2670, 'Frosthold'],
    [2960, 'Cinderhold'], [3210, 'Emberfall'],
    [3500, 'Redcliff'], [3720, 'Lastlight'],
  ],
  castles: [[360, 'Old Watch'], [930, 'Sunfall Keep'], [1465, 'Sunken Keep'], [2005, 'Outlaw Fort'], [2545, 'Hollow Spire'], [3085, 'Fort Ember'], [3610, 'Black Keep']],
  lairs: [[1135, 'Brute Hollow'], [2215, 'Warden Crater']],
  mines: [395, 910, 1500, 2040, 2590, 3130, 3600],
  treasures: [310, 640, 980, 1420, 1690, 2000, 2290, 2560, 2780, 3060, 3330, 3660],
  falls: 32,
  seals: [[680, 'Seal of Greenvale', 'queen'], [1220, 'Seal of the Sands', 'dune'], [1760, 'Seal of the Fen', 'slime'], [2300, 'Seal of the Canyon', 'ravager'], [2840, 'Seal of the Frost', 'frost'], [3380, 'Seal of Embers', 'magma']],
  expeditions: [
    [585, -1, 'meadow', 'The Whispering Meadows', 82],
    [925, 1, 'pyramid', 'The Sun Pyramid', 86],
    [1470, -1, 'lagoon', 'The Black Lagoon', 86],
    [2010, 1, 'fort', 'The Outlaw Fort', 82],
    [2560, -1, 'frostpeak', 'Frostpeak', 104],
    [3090, 1, 'cinder', 'Mount Cinder', 108],
  ],
  widen: [1240, 2700, 120],
  nooks: [
    ['survey0', 300, 1, 0.72, 'survey', 'Oak Hill Stone'],
    ['survey1', 430, -1, 0.78, 'survey', 'Millrace Stone'],
    ['survey2', 620, 1, 0.68, 'survey', 'Eastwatch Stone'],
    ['shrine0', 780, 1, 0.6, 'shrine', 'Shrine of the Morning'],
    ['shrine1', 1000, -1, 0.66, 'shrine', 'Shrine of Noon'],
    ['shrine2', 1170, 1, 0.55, 'shrine', 'Shrine of Evening'],
    ['chapel', 1400, 1, 0.6, 'chapel', 'The Drowned Chapel'],
    ['hideout', 1930, -1, 0.58, 'hideout', 'Rustmane\'s Old Hideout'],
    ['lens0', 2400, 1, 0.55, 'lens', 'Lens Cairn'],
    ['lens1', 2640, 1, 0.5, 'lens', 'Lens Cairn'],
    ['lens2', 2790, -1, 0.52, 'lens', 'Lens Cairn'],
    ['vein', 3010, -1, 0.5, 'vein', 'The Ember Vein'],
  ],
};

/** The layout new games get. */
export const WORLD_VERSION = LONG_MARCH.version;

function layoutFor(version: number): Layout {
  return version >= 2 ? LONG_MARCH : CLASSIC;
}

/** Hash of a lattice cell (0..1). */
function cellHash(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The scattered standing pillars of three lands: lattice size, odds, size and how far off the trail. */
const PILLARS = {
  hoodoo: { grid: 26, salt: 71, chance: 0.2, road: 32, r0: 1.6, r1: 1.8, h0: 9, h1: 14 },
  basalt: { grid: 17, salt: 81, chance: 0.3, road: 16, r0: 0.9, r1: 1.4, h0: 3, h1: 8 },
  ice: { grid: 34, salt: 91, chance: 0.14, road: 30, r0: 1.4, r1: 1.2, h0: 10, h1: 16 },
} as const;

export class Terrain {
  readonly seed: number;
  /** 1: the classic valley; 2: the Long March. */
  readonly version: number;
  private readonly layout: Layout;
  private readonly n1: Noise2;
  private readonly n2: Noise2;
  private readonly n3: Noise2;
  private readonly n4: Noise2;
  readonly villages: Site[] = [];
  readonly castles: Site[] = [];
  readonly citadel: Site;
  readonly falls: FallSite[] = [];
  /** Quest sites, one in the woods by each village (a nest, a raiders' camp, a lost cache). */
  readonly camps: Site[] = [];
  /** Giants' lairs: craters where a dormant giant waits (flattened like the camps). */
  readonly lairs: Site[] = [];
  /** Mine entrances cut into the valley walls: [x, y, z, direction into the hill (+1/-1 along z)]. */
  readonly mines: Array<[number, number, number, number]> = [];
  /** Buried treasure spots (shown by treasure maps): [x, y, z]. */
  readonly treasures: Array<[number, number, number]> = [];
  /** The valley's lands, west to east. */
  readonly regions: Region[];
  /** The Heart Seals barring the valley (none in the classic valley). */
  readonly seals: SealSite[] = [];
  /** The expeditions off the trail (none in the classic valley). */
  readonly expeditions: ExpeditionSite[] = [];
  /** The small places off the trail (none in the classic valley). */
  readonly nooks: Nook[] = [];
  /** Route start/end along x. */
  readonly startX = 120;
  readonly endX: number;
  private readonly phase: number[];

  constructor(seed: number, version = 1) {
    this.seed = seed;
    this.layout = layoutFor(version);
    this.version = this.layout.version;
    this.regions = this.layout.regions;
    this.endX = this.layout.endX;
    this.n1 = new Noise2(seed * 7 + 1);
    this.n2 = new Noise2(seed * 7 + 2);
    this.n3 = new Noise2(seed * 7 + 3);
    this.n4 = new Noise2(seed * 7 + 4);
    const rng = mulberry32(seed ^ 0x5bd1e995);
    this.phase = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
    this.placeVillages(rng);
    this.placeExpeditions();
    const cx = this.layout.citadelX;
    const cz = Math.round(this.centerZ(cx));
    this.citadel = { kind: 'citadel', index: 0, name: 'Creeper Citadel', x: cx, z: cz, y: Math.round(this.baseHeight(cx, cz) + 4), radius: 34 };
    this.placeCastles(rng);
    this.placeFalls(rng);
    this.placeCamps(mulberry32(seed ^ 0x2c1b3c6d));
    this.placeWilds(mulberry32(seed ^ 0x7f4a7c15));
    this.placeSeals();
    this.placeNooks();
  }

  private cachedClearings: Site[] | null = null;

  /** Everywhere trees must not grow: sites, camps, lairs, mine mouths and treasure crosses. */
  clearings(): Site[] {
    if (!this.cachedClearings) {
      const extra: Site[] = [];
      for (const [x, y, z] of this.treasures) extra.push({ kind: 'camp', index: -1, name: '', x, z, y, radius: 3 });
      for (const [x, y, z] of this.mines) extra.push({ kind: 'camp', index: -1, name: '', x, z, y, radius: 4 });
      for (const n of this.nooks) extra.push(n.site);
      for (const e of this.expeditions) {
        extra.push({ kind: 'camp', index: -1, name: '', x: e.x, z: e.z, y: e.y, radius: e.id === 'cinder' || e.id === 'frostpeak' ? 20 : 34 });
        extra.push({ kind: 'camp', index: -1, name: '', x: e.park[0], z: e.park[1], y: e.y, radius: 22 });
      }
      this.cachedClearings = [...this.sites(), ...this.camps, ...this.lairs, ...extra];
    }
    return this.cachedClearings;
  }

  /** Lairs, mines and treasure, spread down the valley. */
  private placeWilds(rng: Rng): void {
    for (const [x0, name] of this.layout.lairs) {
      const x = Math.round(x0 + (rng() - 0.5) * 30);
      const c = this.centerZ(x);
      const side = this.castles.some((k) => Math.abs(k.x - x) < 120 && k.z > c) ? -1 : 1;
      const z = Math.round(c + side * (this.halfWidth(x) - 22));
      const y = Math.round(Math.max(SEA + 4, this.baseHeight(x, z)));
      this.lairs.push({ kind: 'camp', index: 10 + this.lairs.length, name, x, z, y, radius: 9 });
    }
    for (const x0 of this.layout.mines) {
      const x = Math.round(x0 + (rng() - 0.5) * 40);
      const side = rng() < 0.5 ? -1 : 1;
      const c = this.centerZ(x);
      const floor = this.baseHeight(x, Math.round(c + side * (this.halfWidth(x) - 10)));
      // Walk out to where the valley wall starts to climb.
      let z = Math.round(c + side * this.halfWidth(x));
      for (let d = this.halfWidth(x) - 20; d < this.halfWidth(x) + 70; d += 1) {
        const zz = Math.round(c + side * d);
        if (this.baseHeight(x, zz + side * 6) > floor + 9) {
          z = zz;
          break;
        }
      }
      if (this.falls.some((f) => Math.hypot(f.x - x, f.z - z) < 30)) continue;
      if (this.nearExpedition(x, z, 40)) continue;
      if (this.heightInt(x, z - side * 2) < SEA + 2) continue;
      this.mines.push([x, this.heightInt(x, z - side * 2), z, side]);
    }
    for (const x0 of this.layout.treasures) {
      for (let k = 0; k < 10; k += 1) {
        const x = Math.round(x0 + (rng() - 0.5) * 60);
        const side = rng() < 0.5 ? -1 : 1;
        const z = Math.round(this.centerZ(x) + side * (30 + rng() * 40));
        const y = this.heightInt(x, z);
        if (y < SEA + 2 || this.mountainFactor(x, z) > 0.3) continue;
        if (this.sites().some((s) => Math.hypot(s.x - x, s.z - z) < s.radius + 12)) continue;
        this.treasures.push([x, y, z]);
        break;
      }
    }
  }

  /**
   * The expeditions: each in a basin beyond the valley wall on its side, its pass running straight
   * out from the trail. The basin floor is levelled near the landmark (see landmark()).
   */
  private placeExpeditions(): void {
    this.layout.expeditions.forEach(([x, side, id, name, r], index) => {
      const c = this.centerZ(x);
      const z = Math.round(c + side * (this.halfWidth(x) + 58 + r));
      const y = id === 'lagoon' ? SEA + 1 : SEA + 9;
      // The fortress stops in the basin on the pass side, short of the landmark (and of a mountain's foot).
      const stand = id === 'cinder' ? r * 0.9 : id === 'frostpeak' ? r * 0.62 : id === 'lagoon' ? r * 0.7 : id === 'fort' ? r * 0.76 : r * 0.5;
      const park: [number, number] = [x, Math.round(z - side * stand)];
      let summit: [number, number, number] | null = null;
      if (id === 'frostpeak') {
        const [px, pz] = this.peakCentre(x, z, side, r);
        summit = [px, y + 34, Math.round(pz - side * 27)];
      } else if (id === 'cinder') summit = [x, y + CINDER.island + 1, z];
      const site: Site = { kind: 'expedition', index, name, x, z, y, radius: Math.round(stand) };
      this.expeditions.push({ index, id, name, x, z, y, side, r, park, summit, site });
    });
  }

  /** Frostpeak's summit stands toward the far side of its basin. */
  private peakCentre(x: number, z: number, side: number, r: number): [number, number] {
    return [x, Math.round(z + side * r * 0.28)];
  }

  /** The expedition whose basin or pass a point lies in (null: the valley). */
  expeditionAt(x: number, z: number): ExpeditionSite | null {
    for (const e of this.expeditions) {
      if (Math.hypot(x - e.x, z - e.z) < e.r + 12) return e;
      const c = this.centerZ(e.x);
      const beyond = (z - c) * e.side;
      if (Math.abs(x - e.x) < 38 && beyond > this.halfWidth(e.x) && beyond < Math.abs(e.z - c)) return e;
    }
    return null;
  }

  /** Whether a point is in (or near) an expedition's basin or pass. */
  nearExpedition(x: number, z: number, margin: number): boolean {
    for (const e of this.expeditions) {
      if (Math.hypot(x - e.x, z - e.z) < e.r + margin) return true;
      const c = this.centerZ(e.x);
      const lo = Math.min(c, e.z);
      const hi = Math.max(c, e.z);
      if (Math.abs(x - e.x) < 34 + margin && z > lo - margin && z < hi + margin) return true;
    }
    return false;
  }

  /**
   * How far the mountains are cut away at a point for the expeditions (0 none .. 1 a basin or pass
   * floor): a basin with a ragged rim, and a pass straight out from the trail to it.
   */
  private carve(x: number, z: number): number {
    let k = 0;
    for (const e of this.expeditions) {
      const dx = x - e.x;
      if (Math.abs(dx) > e.r + 60) continue;
      const dz = z - e.z;
      const d = Math.hypot(dx, dz);
      if (d < e.r + 40) {
        const a = Math.atan2(dz, dx);
        const rr = e.r * (0.9 + 0.12 * this.n3.noise(Math.cos(a) * 1.7 + e.index * 9.1, Math.sin(a) * 1.7 - 3.3));
        k = Math.max(k, 1 - smoothstep(rr - 30, rr + 4, d));
      }
      const c = this.centerZ(e.x);
      const t = (z - c) / (e.z - c);
      if (t > -0.1 && t < 1) k = Math.max(k, 1 - smoothstep(20, 38, Math.abs(dx)));
    }
    return k;
  }

  /** The errands' places, and five lost stashes in each land, well off the trail. */
  private placeNooks(): void {
    const add = (id: string, kind: NookKind, name: string, x: number, z: number, land: number, slot: number): void => {
      const y = Math.round(Math.max(SEA + 1, this.baseHeight(x, z)));
      const site: Site = { kind: 'camp', index: 200 + this.nooks.length, name, x, z, y, radius: kind === 'stash' ? 4 : 7 };
      this.nooks.push({ id, kind, name, x, z, y, land, slot, site });
    };
    for (const [id, x, side, off, kind, name] of this.layout.nooks) add(id, kind, name, x, Math.round(this.centerZ(x) + side * this.halfWidth(x) * off), this.regionIndex(x), -1);
    if (this.layout.nooks.length === 0) return;
    this.regions.forEach((r, land) => {
      const a = Math.max(r.x0, this.startX + 60);
      const b = (this.regions[land + 1]?.x0 ?? this.citadel.x - 60) - 40;
      for (let k = 0; k < 5; k += 1) {
        let spot: [number, number] | null = null;
        for (let t = 0; t < 24 && !spot; t += 1) {
          const h = (s: number): number => cellHash(land * 7 + k, t, s + this.seed % 1000);
          const x = Math.round(a + ((b - a) * (k + 0.1 + h(201) * 0.8)) / 5);
          const side = (land + k + t) % 2 === 0 ? 1 : -1;
          const z = Math.round(this.centerZ(x) + side * this.halfWidth(x) * (0.42 + h(202) * 0.72));
          const y = this.baseHeight(x, z);
          if (y < SEA + 2 || y > 96 || this.nearExpedition(x, z, 12)) continue;
          if (this.sites().some((s) => Math.hypot(s.x - x, s.z - z) < s.radius + 12)) continue;
          if (this.camps.some((s) => Math.hypot(s.x - x, s.z - z) < 16) || this.nooks.some((n) => Math.hypot(n.x - x, n.z - z) < 40)) continue;
          spot = [x, z];
        }
        if (spot) add(`stash${land}_${k}`, 'stash', 'Lost Stash', spot[0], spot[1], land, k);
      }
    });
  }

  /** The seals stand where one land gives way to the next, across the valley floor. */
  private placeSeals(): void {
    this.layout.seals.forEach(([x, name, guardian], index) => {
      const z = Math.round(this.centerZ(x));
      const y = Math.round(Math.max(SEA + 2, this.baseHeight(x, z)));
      this.seals.push({ index, name, x, z, y, guardian, region: this.regionIndex(x + 40) });
    });
  }

  // ---------------------------------------------------------------- layout curves

  /** Valley centreline: the fortress route winds along it. */
  centerZ(x: number): number {
    const p = this.phase;
    return WZ / 2 + Math.sin(x * 0.0042 + p[0]!) * 120 + Math.sin(x * 0.0105 + p[1]!) * 45;
  }

  /** Half width of the flat valley floor (the late march opens out into wide lands). */
  halfWidth(x: number): number {
    const w = this.layout.widen;
    const extra = w ? smoothstep(w[0], w[1], x) * w[2] : 0;
    return 118 + extra + this.n4.noise(x * 0.006, 3.7) * 40;
  }

  private baseRiverZ(x: number): number {
    const p = this.phase;
    const off = Math.sin(x * 0.0085 + p[2]!) * 62 + Math.sin(x * 0.023 + p[3]!) * 18;
    // Keep the river on the valley floor where the valley narrows.
    const room = Math.max(10, this.halfWidth(x) - 34);
    return this.centerZ(x) + Math.max(-room, Math.min(room, off));
  }

  /** Main river course, pushed around village plateaus. */
  riverZ(x: number): number {
    let z = this.baseRiverZ(x);
    for (const v of this.villages) {
      const dx = Math.abs(x - v.x);
      if (dx > 110) continue;
      // Always bend round the same side of a village, so the course never jumps.
      const side = this.baseRiverZ(v.x) >= v.z ? 1 : -1;
      const k = 1 - smoothstep(35, 110, dx);
      const target = v.z + side * (v.radius + 22);
      if (side > 0 ? z < target : z > target) z = lerp(z, target, k);
    }
    return z;
  }

  riverWidth(x: number): number {
    return 6 + this.n3.noise(x * 0.01, 1.3) * 2.5;
  }

  // ---------------------------------------------------------------- sites

  private placeVillages(rng: Rng): void {
    this.layout.villages.forEach(([x0, name], index) => {
      const x = Math.round(x0 + (index === 0 ? 0 : (rng() - 0.5) * 40));
      const river = this.baseRiverZ(x);
      const c = this.centerZ(x);
      const away = c - river >= 0 ? 1 : -1;
      const z = Math.round(c + away * 26);
      const y = Math.round(Math.max(SEA + 5, Math.min(62, this.baseHeight(x, z))));
      this.villages.push({ kind: 'village', index, name, x, z, y, radius: 40 });
    });
  }

  private placeCastles(rng: Rng): void {
    this.layout.castles.forEach(([x0, name], index) => {
      const x = Math.round(x0 + (rng() - 0.5) * 50);
      const side = index % 2 === 0 ? 1 : -1;
      const c = this.centerZ(x);
      const z = Math.round(c + side * (this.halfWidth(x) + 8));
      const y = Math.round(this.baseHeight(x, z));
      this.castles.push({ kind: 'castle', index, name, x, z, y: Math.max(SEA + 6, y), radius: 18 });
    });
  }

  private placeCamps(rng: Rng): void {
    this.villages.forEach((v, index) => {
      // Into the woods on the far side from the river, clear of the village and the cliffs.
      const away = v.z - this.riverZ(v.x) >= 0 ? 1 : -1;
      let spot: [number, number, number] | null = null;
      for (let k = 0; k < 12 && !spot; k += 1) {
        const x = Math.round(v.x + (rng() - 0.5) * 80);
        const z = Math.round(v.z + away * (v.radius + 22 + rng() * 26));
        if (this.mountainFactor(x, z) > 0.4) continue;
        const y = Math.round(this.baseHeight(x, z));
        if (y < SEA + 3) continue;
        if (this.falls.some((f) => Math.hypot(f.x - x, f.z - z) < 30)) continue;
        spot = [x, y, z];
      }
      const [x, y, z] = spot ?? [v.x + 30, v.y, v.z + away * (v.radius + 20)];
      this.camps.push({ kind: 'camp', index, name: `${v.name} Woods`, x, z, y, radius: 6 });
    });
  }

  private placeFalls(rng: Rng): void {
    // A guaranteed one in view of the starting village, then a string along both walls.
    const start = this.villages[0]!;
    const spots: Array<{ x: number; side: number }> = [{ x: start.x - 70, side: start.z > this.centerZ(start.x) ? 1 : -1 }];
    for (let k = 0; k < this.layout.falls; k += 1) spots.push({ x: 180 + k * 115 + (rng() - 0.5) * 50, side: k % 2 === 0 ? -1 : 1 });
    for (const s of spots) {
      const x = Math.round(s.x);
      // (No water pours off the dry canyon walls or into the lava wastes.)
      const land = this.regionAt(x).zone;
      const dry = land === 'badlands' || land === 'ember';
      const c = this.centerZ(x);
      // Walk outward until the slope starts to climb.
      const hw = this.halfWidth(x);
      let z = Math.round(c + s.side * (hw + 18));
      const floor = this.baseHeight(x, Math.round(c + s.side * (hw - 10)));
      for (let d = hw; d < hw + 90; d += 2) {
        const zz = Math.round(c + s.side * d);
        if (this.baseHeight(x, zz) > floor + 10) {
          z = zz;
          break;
        }
      }
      const bottom = Math.round(Math.max(SEA + 2, this.baseHeight(x, z - s.side * 8)));
      const top = Math.round(Math.max(bottom + 20, Math.min(WY - 22, this.baseHeight(x, z + s.side * 10) + 4)));
      const width = 3 + Math.floor(rng() * 2);
      if (!dry && !this.nearExpedition(x, z, 40)) this.falls.push({ x, z, fx: 0, fz: -s.side, top, bottom, width });
    }
  }

  /** Every flattened site (villages, castles, the citadel). */
  sites(): Site[] {
    return [...this.villages, ...this.castles, this.citadel];
  }

  // ---------------------------------------------------------------- the lands

  /** Index of the land a point of the route lies in (by x alone, its border unwandered). */
  regionIndex(x: number): number {
    const R = this.regions;
    let i = 0;
    while (i + 1 < R.length && x >= R[i + 1]!.x0) i += 1;
    return i;
  }

  regionAt(x: number): Region {
    return this.regions[this.regionIndex(x)]!;
  }

  /** Where a point's land is decided: x pushed about a little, so borders are never straight. */
  private zoneX(x: number, z: number): number {
    return x + this.n3.noise(x * 0.008 + 5.5, z * 0.008 - 2.5) * this.layout.wobble;
  }

  /** Which land a column lies in. */
  zone(x: number, z: number): Zone {
    return this.regions[this.regionIndex(this.zoneX(x, z))]!.zone;
  }

  /**
   * How much of each land's own shaping a column carries: its land, the neighbouring land it
   * shades into near a border, and the share of that neighbour (0..0.5).
   */
  private landMix(x: number, z: number): { a: Zone; b: Zone; t: number } {
    const R = this.regions;
    const xx = this.zoneX(x, z);
    const i = this.regionIndex(xx);
    const a = R[i]!.zone;
    const BLEND = 24;
    const toNext = i + 1 < R.length ? R[i + 1]!.x0 - xx : Infinity;
    const fromPrev = i > 0 ? xx - R[i]!.x0 : Infinity;
    if (toNext < BLEND) return { a, b: R[i + 1]!.zone, t: 0.5 * (1 - toNext / BLEND) };
    if (fromPrev < BLEND) return { a, b: R[i - 1]!.zone, t: 0.5 * (1 - fromPrev / BLEND) };
    return { a, b: a, t: 0 };
  }

  // ---------------------------------------------------------------- height

  /** 0 on the valley floor rising to 1 in the mountains (and at the valley ends). */
  mountainFactor(x: number, z: number): number {
    const d = Math.abs(z - this.centerZ(x));
    let beyond = Math.max(0, d - this.halfWidth(x));
    if (beyond > 0 && this.expeditions.length > 0) beyond *= 1 - this.carve(x, z);
    const ends = Math.max(0, this.startX - x, x - this.endX);
    const edge = Math.max(0, 70 - Math.min(x, z, WX - x, WZ - z)) * 3;
    return smoothstep(0, 135, beyond + ends * 1.25 + edge);
  }

  /** Terrain before rivers, lakes and site flattening. */
  baseHeight(x: number, z: number): number {
    const m = this.mountainFactor(x, z);
    const n1 = this.n1;
    // Valley floor: gentle rolls and the odd grassy hill.
    let valley = 55 + n1.fbm(x * 0.009, z * 0.009, 3) * 4.5 + this.n2.fbm(x * 0.03, z * 0.03, 2) * 1.6;
    const hill = this.n2.noise(x * 0.0045 + 7.1, z * 0.0045 - 3.3);
    if (hill > 0.25) valley += (hill - 0.25) * 34;
    if (m <= 0.001) return valley;
    // Mountains: ridged ranges with terraced cliff bands.
    const ridge = this.n3.ridged(x * 0.0042, z * 0.0042, 5);
    let mtn = 62 + Math.pow(ridge, 1.3) * 58 + n1.fbm(x * 0.02, z * 0.02, 3) * 7;
    const step = 7;
    const t = mtn / step;
    const ti = Math.floor(t);
    const tf = t - ti;
    mtn = (ti + smoothstep(0.32, 0.68, tf)) * step * 0.65 + mtn * 0.35;
    const k = m * m * (3 - 2 * m);
    return lerp(valley, mtn, k);
  }

  /**
   * A land's own reshaping of the valley floor (the Long March's new lands): the swamp sinks to
   * the water and pools, the badlands rise in banded mesas and hoodoos, the ember wastes heave
   * with basalt and sink into lava pits, the snowfields grow ice spikes. `m` fades it out up the
   * mountains, and the trail stays walkable.
   */
  private landShape(zone: Zone, x: number, z: number, h: number, m: number): number {
    const off = Math.abs(z - this.centerZ(x));
    const floor = 1 - smoothstep(0.15, 0.55, m);
    if (floor <= 0) return h;
    switch (zone) {
      case 'swamp': {
        // Down to the waterline, barely rolling, broken by shallow pools.
        const flat = SEA + 1.3 + this.n1.fbm(x * 0.02 + 3, z * 0.02, 2) * 1.6;
        let s = lerp(h, Math.min(h, flat), 0.9);
        const pool = this.n2.noise(x * 0.034 + 21, z * 0.034 - 8);
        const road = smoothstep(7, 16, off);
        if (pool > 0.16) s = Math.min(s, lerp(s, SEA - 1.2 - (pool - 0.16) * 7, smoothstep(0.16, 0.24, pool) * road));
        return lerp(h, Math.max(SEA - 3, s), floor);
      }
      case 'badlands': {
        // Flat-topped mesas in strata steps, clear of the trail, and the odd standing hoodoo.
        const keep = smoothstep(26, 48, off);
        const mesa = this.n3.fbm(x * 0.0075 + 40, z * 0.0075 - 13, 3);
        const rise = smoothstep(0.06, 0.14, mesa) * keep;
        let s = h;
        if (rise > 0) {
          const top = 15 + this.n1.noise(x * 0.01 - 7, z * 0.01 + 4) * 7;
          const raw = h + rise * top;
          s = Math.floor(raw / 4) * 4 + smoothstep(0.55, 0.95, (raw / 4) % 1) * 4;
        }
        const p = this.pillar('badlands', x, z);
        if (p) s = Math.max(s, h + p.tall);
        return lerp(h, s, floor);
      }
      case 'ember': {
        // Heaving basalt ground, lava pits off the trail, basalt columns.
        let s = h + this.n1.fbm(x * 0.06 + 11, z * 0.06 - 5, 2) * 2.4;
        const pit = this.n4.noise(x * 0.03 - 17, z * 0.03 + 29);
        const road = smoothstep(9, 18, off);
        if (pit > 0.24) s = Math.min(s, lerp(s, SEA - 2, smoothstep(0.24, 0.32, pit) * road));
        const p = this.pillar('ember', x, z);
        if (p) s = Math.max(s, h + p.tall);
        return lerp(h, s, floor);
      }
      case 'snow': {
        // Ice spikes (the Long March's snowfields only), well off the trail.
        if (this.version < 2) return h;
        const p = this.pillar('snow', x, z);
        return p ? lerp(h, h + p.tall, floor) : h;
      }
      default:
        return h;
    }
  }

  /**
   * The standing pillar a column belongs to, if any: the badlands' hoodoos, the ember wastes'
   * basalt columns, the snowfields' ice spikes (each on its own scattered lattice, off the trail).
   * `tall`: how far it rises over the ground around it.
   */
  pillar(zone: Zone, x: number, z: number): { tall: number } | null {
    const spec = zone === 'badlands' ? PILLARS.hoodoo : zone === 'ember' ? PILLARS.basalt : zone === 'snow' && this.version >= 2 ? PILLARS.ice : null;
    if (!spec) return null;
    const G = spec.grid;
    const ix = Math.floor(x / G);
    const iz = Math.floor(z / G);
    let best: { tall: number } | null = null;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = ix + dx;
        const cz = iz + dz;
        if (cellHash(cx, cz, spec.salt) > spec.chance) continue;
        const px = (cx + 0.2 + cellHash(cx, cz, spec.salt + 1) * 0.6) * G;
        const pz = (cz + 0.2 + cellHash(cx, cz, spec.salt + 2) * 0.6) * G;
        if (Math.abs(pz - this.centerZ(px)) < spec.road || this.expeditions.some((e) => this.besidePath(e, px, pz))) continue;
        const r = spec.r0 + cellHash(cx, cz, spec.salt + 3) * spec.r1;
        const d = Math.hypot(x - px, z - pz);
        if (d > r) continue;
        let tall = spec.h0 + cellHash(cx, cz, spec.salt + 4) * spec.h1;
        // Ice spikes taper to a point.
        if (spec === PILLARS.ice) tall *= 1 - (d / r) * 0.35;
        if (!best || tall > best.tall) best = { tall };
      }
    }
    return best;
  }

  private readonly spikes = new Map<number, boolean>();

  /**
   * Whether a column is part of one of the standing pillars (a hoodoo, a basalt column, an ice
   * spike): the walking fortress smashes through those rather than climbing over them.
   */
  spikeAt(x: number, z: number): boolean {
    if (this.version < 2) return false;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const k = ix * 2048 + iz;
    let v = this.spikes.get(k);
    if (v === undefined) {
      v = this.pillar(this.zone(ix, iz), ix, iz) !== null;
      if (this.spikes.size > 60000) this.spikes.clear();
      this.spikes.set(k, v);
    }
    return v;
  }

  /** Final natural surface height (float) at a column. */
  height(x: number, z: number): number {
    let h = this.baseHeight(x, z);
    const m = this.mountainFactor(x, z);
    // Lakes in valley hollows and at both ends of the river.
    if (m < 0.35) {
      const lake = this.n4.noise(x * 0.0065 + 11.3, z * 0.0065 - 4.1);
      const endLake = Math.max(smoothstep(this.startX + 60, this.startX + 10, x), smoothstep(this.endX - 70, this.endX - 20, x)) * smoothstep(60, 20, Math.abs(z - this.riverZ(x)));
      const depth = Math.max(smoothstep(0.42, 0.56, lake) * (1 - m / 0.35), endLake);
      if (depth > 0) h = lerp(h, SEA - 5, depth);
    }
    // The Long March's lands reshape the floor (blended across their borders).
    if (this.version >= 2) {
      const mix = this.landMix(x, z);
      const a = this.landShape(mix.a, x, z, h, m);
      h = mix.t > 0 ? lerp(a, this.landShape(mix.b, x, z, h, m), mix.t) : a;
    }
    // The river channel and its banks.
    if (m < 0.6 && x > this.startX - 40 && x < this.endX + 40) {
      const dr = Math.abs(z - this.riverZ(x));
      const w = this.riverWidth(x);
      if (dr < w + 16) {
        const bank = Math.min(h, SEA + 2.2 + smoothstep(w, w + 16, dr) * (h - SEA - 2.2));
        const bed = SEA - 4 + (dr / w) * 3;
        h = dr < w ? Math.min(bank, bed) : bank;
      }
    }
    // The expeditions' landmarks: dunes, a lagoon, a mesa, a mountain, a volcano.
    for (const e of this.expeditions) {
      if (Math.abs(x - e.x) > e.r + 40 || Math.abs(z - e.z) > e.r + 40) continue;
      h = this.landmark(e, x, z, h);
    }
    // Waterfall cliffs: raised behind the edge, cut down in front of it.
    for (const f of this.falls) {
      const dx = x - f.x;
      const dz = z - f.z;
      if (Math.abs(dx) > 26 || Math.abs(dz) > 26) continue;
      const along = dx * f.fx + dz * f.fz;
      const across = Math.abs(dx * f.fz - dz * f.fx);
      const reach = 1 - smoothstep(10, 22, across);
      if (reach <= 0) continue;
      if (along < 0) {
        const back = 1 - smoothstep(14, 24, -along);
        h = lerp(h, Math.max(h, f.top), reach * back);
      } else {
        const front = 1 - smoothstep(6, 18, along);
        const pool = along < 5 && across < f.width + 2 ? f.bottom - 2 : f.bottom;
        h = lerp(h, Math.min(h, pool), reach * front);
      }
    }
    // Flattened plateaus for villages, castles and the citadel.
    for (const s of this.sitesCache()) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (Math.abs(dx) > s.radius + 40 || Math.abs(dz) > s.radius + 40) continue;
      const d = Math.hypot(dx, dz);
      const k = 1 - smoothstep(s.radius, s.radius + 34, d);
      if (k > 0) h = lerp(h, s.y, k);
    }
    return h;
  }

  /**
   * An expedition's own ground: the meadow's levelled bowl and pond, the pyramid's court in a sea of
   * dunes, the lagoon's black water round the coven's islands, the outlaws' mesa and its ramp,
   * Frostpeak and Mount Cinder (each with a path winding up it).
   */
  private landmark(e: ExpeditionSite, x: number, z: number, h: number): number {
    const dx = x - e.x;
    const dz = z - e.z;
    const d = Math.hypot(dx, dz);
    const inner = 1 - smoothstep(e.r * 0.7, e.r * 0.98, d);
    const level = (r0: number, r1: number, y: number, s: number): number => lerp(s, y, 1 - smoothstep(r0, r1, d));
    switch (e.id) {
      case 'meadow': {
        // A gentle green bowl: the wreck's ground levelled, a pond off to one side.
        let s = lerp(h, e.y + (h - e.y) * 0.4, inner);
        s = level(30, 48, e.y, s);
        const pd = Math.hypot(x - (e.x + e.r * 0.45), z - (e.z + e.side * e.r * 0.12));
        if (pd < 20) s = lerp(s, SEA - 3, 1 - smoothstep(9, 20, pd));
        return s;
      }
      case 'pyramid': {
        // Dunes: long sand ripples, round the level court the pyramid stands in.
        const dune = (Math.sin(x * 0.07 + Math.sin(z * 0.043) * 2.3) * 0.5 + 0.5) * 5 + this.n2.noise(x * 0.025 + 5, z * 0.025) * 2.5;
        const s = lerp(h, e.y + dune, inner);
        return level(40, 56, e.y, s);
      }
      case 'lagoon': {
        // Black water over most of the basin, three islands for the coven's huts, the wreck sunk deep.
        let s = lerp(h, SEA + 1 + this.n1.fbm(x * 0.04, z * 0.04, 2) * 1.2, inner);
        const pool = 1 - smoothstep(e.r * 0.42, e.r * 0.6, d);
        s = lerp(s, SEA - 3 - (1 - d / (e.r * 0.6)) * 2, pool);
        for (let k = 0; k < 3; k += 1) {
          const a = (k / 3) * Math.PI * 2 + 0.5;
          const id = Math.hypot(x - (e.x + Math.cos(a) * e.r * 0.33), z - (e.z + Math.sin(a) * e.r * 0.33));
          s = lerp(s, SEA + 2, 1 - smoothstep(5, 9, id));
        }
        return lerp(s, SEA - 6, 1 - smoothstep(8, 14, d));
      }
      case 'fort': {
        // A flat-topped mesa in strata steps, a ramp up its pass side.
        const top = e.y + 16;
        let s = lerp(h, e.y + (h - e.y) * 0.5, inner);
        const rise = 1 - smoothstep(27, 36, d);
        if (rise > 0) {
          const raw = lerp(s, top, rise);
          s = Math.floor(raw / 3) * 3 + smoothstep(0.6, 0.95, (raw / 3) % 1) * 3;
        }
        // The ramp: four wide, from the plain up to the gate on the pass side.
        const along = -dz * e.side;
        if (Math.abs(dx) < 3.5 && along > 24 && along < 54) s = Math.max(s, top - (along - 26) * 0.6);
        return s;
      }
      case 'frostpeak': {
        // A great snow mountain at the far side of the basin, a path winding up to the wreck's ledge.
        const [px, pz] = this.peakCentre(e.x, e.z, e.side, e.r);
        const pd = Math.hypot(x - px, z - pz);
        let s = lerp(h, e.y + (h - e.y) * 0.5, inner);
        if (pd < FROST_R) {
          // A cone, ridges running down from the summit, and crags on them.
          const t = 1 - pd / FROST_R;
          const a = Math.atan2(z - pz, x - px);
          const spoke = 1 - Math.abs(Math.sin(a * 2.5 + this.n2.noise(x * 0.012, z * 0.012) * 1.2));
          const crag = this.n1.ridged(x * 0.026, z * 0.026, 4);
          const cone = Math.pow(t, 1.3) * 50 + spoke * spoke * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 12 + crag * 8 * t;
          s = Math.max(s, e.y + cone);
          // The ledge where the Winter Lark froze, facing the basin.
          const ld = Math.hypot(x - px, z - (pz - e.side * 27));
          if (ld < 11) s = lerp(s, e.y + 34, 1 - smoothstep(8, 11, ld));
          s = this.onPath(e, x, z, s);
        }
        return s;
      }
      case 'cinder': {
        // The volcano: an ash cone, a crater rim, a lava lake inside and the forge's island.
        let s = lerp(h, e.y + (h - e.y) * 0.4, inner);
        if (d < CINDER_R) {
          const rim = 24;
          const rimY = e.y + CINDER.rim;
          // Steep up by the crater, flaring out over the plain, torn by gullies and old flows.
          const u = clamp01((d - rim) / (CINDER_R - rim));
          let cone = d > rim ? e.y + CINDER.rim * Math.pow(1 - u, 1.75) : rimY - smoothstep(rim, rim - 8, d) * (CINDER.rim - CINDER.lake + 2);
          if (d > rim + 3) cone += (this.n2.noise(x * 0.06, z * 0.06) * 2 + this.n1.ridged(x * 0.03 + 9, z * 0.03, 3) * 7 * (1 - u)) * smoothstep(0, 0.1, u);
          // A walk round the rim, four wide.
          if (d >= rim - 1 && d <= rim + 3) cone = rimY;
          // The lava rivers run in channels of their own.
          if (this.lavaRiver(e, x, z)) cone -= 1;
          s = Math.max(s, cone);
          if (d < rim - 7) s = e.y + CINDER.lake - 2;
          if (d < 7) s = lerp(s, e.y + CINDER.island, 1 - smoothstep(5, 7, d));
          s = this.onPath(e, x, z, s);
        }
        return s;
      }
      default:
        return h;
    }
  }

  /** Where the great mountains stand: [x, z, radius]. */
  mountains(): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    for (const e of this.expeditions) {
      if (e.id === 'cinder') out.push([e.x, e.z, CINDER_R]);
      else if (e.id === 'frostpeak') out.push([...this.peakCentre(e.x, e.z, e.side, e.r), FROST_R]);
    }
    return out;
  }

  /** Whether a column lies on one of Mount Cinder's lava rivers (four, down from the crater's rim). */
  private lavaRiver(e: ExpeditionSite, x: number, z: number): boolean {
    const dx = x - e.x;
    const dz = z - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 27 || d > CINDER_R - 9) return false;
    const a = Math.atan2(dz, dx);
    for (let k = 0; k < 4; k += 1) {
      // (Down the face that looks out over the pass, either side of where the fortress stands.)
      const line = Math.atan2(-e.side, 0) + (k - 1.5) * 0.95 + this.n2.noise(d * 0.028 + k * 7.3, k * 3.1) * 0.42;
      let da = a - line;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) * d < 1.3 + (d / CINDER_R) * 2.2) return true;
    }
    return false;
  }

  /**
   * A path winding up a mountain: its height where (x, z) lies on it, else NaN. It starts at radius
   * r0 (height y0) facing `start` and spirals in to r1 (height y1) over `turns` turns.
   */
  /** A mountain's ground with its path cut in: the shoulders fall away a step at a time, so nobody is stranded under a wall. */
  private onPath(e: ExpeditionSite, x: number, z: number, s: number): number {
    const p = this.pathOf(e)!;
    const at = this.spiralAt(x, z, p.cx, p.cz, p.r0, p.r1, p.y0, p.y1, p.turns, p.start, 5 + SHOULDER * 2);
    if (!at) return s;
    const away = at.err - 2.5;
    return away <= 0 ? at.y : Math.max(s, at.y - away);
  }

  /** Whether a column lies close by a mountain's path (kept clear of trees and spikes). */
  private besidePath(e: ExpeditionSite, x: number, z: number): boolean {
    const p = this.pathOf(e);
    return p !== null && this.spiralAt(x, z, p.cx, p.cz, p.r0, p.r1, p.y0, p.y1, p.turns, p.start, 5 + SHOULDER * 2) !== null;
  }

  /** The nearest pass of a spiral path: its height, and how far off its centre line a column lies. */
  private spiralAt(x: number, z: number, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, turns: number, start: number, width: number): { y: number; err: number } | null {
    const d = Math.hypot(x - cx, z - cz);
    if (d > r0 + width || d < r1 - width) return null;
    const TAU = Math.PI * 2;
    let a = Math.atan2(z - cz, x - cx) - start;
    a = ((a % TAU) + TAU) % TAU;
    const total = turns * TAU;
    let best = NaN;
    let err = Infinity;
    for (let k = 0; k <= Math.ceil(turns); k += 1) {
      const th = a + k * TAU;
      if (th > total) break;
      const t = th / total;
      const e = Math.abs(d - (r0 + (r1 - r0) * t));
      if (e < err) {
        err = e;
        best = y0 + (y1 - y0) * t;
      }
    }
    return err <= width / 2 ? { y: Math.round(best), err } : null;
  }

  private spiral(x: number, z: number, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, turns: number, start: number, width: number): number {
    return this.spiralAt(x, z, cx, cz, r0, r1, y0, y1, turns, start, width)?.y ?? NaN;
  }

  private pathOf(e: ExpeditionSite): { cx: number; cz: number; r0: number; r1: number; y0: number; y1: number; turns: number; start: number } | null {
    const start = Math.atan2(-e.side, 0);
    if (e.id === 'frostpeak') {
      const [px, pz] = this.peakCentre(e.x, e.z, e.side, e.r);
      return { cx: px, cz: pz, r0: 80, r1: 27, y0: e.y + 1, y1: e.y + 34, turns: 1, start };
    }
    if (e.id === 'cinder') return { cx: e.x, cz: e.z, r0: 88, r1: 26, y0: e.y + 1, y1: e.y + CINDER.rim, turns: 1, start };
    return null;
  }

  /** Points along the outer edge of an expedition's mountain path (for cairns), evenly up it. */
  pathPoints(e: ExpeditionSite, n: number): Array<[number, number]> {
    const p = this.pathOf(e);
    if (!p) return [];
    const out: Array<[number, number]> = [];
    for (let k = 0; k < n; k += 1) {
      const t = (k + 0.5) / n;
      const a = p.start + t * p.turns * Math.PI * 2;
      const r = p.r0 + (p.r1 - p.r0) * t + 3.6;
      out.push([Math.round(p.cx + Math.cos(a) * r), Math.round(p.cz + Math.sin(a) * r)]);
    }
    return out;
  }

  /** The lava standing at a column (Mount Cinder's lake and rivers, a cinder cone's crater), or -1. */
  lavaLevel(x: number, z: number, h: number): number {
    for (const e of this.expeditions) {
      if (e.id !== 'cinder') continue;
      const d = Math.hypot(x - e.x, z - e.z);
      if (d < 17) return e.y + CINDER.lake;
      if (d < CINDER_R && this.lavaRiver(e, x, z) && Number.isNaN(this.pathHeight(e, x, z))) return h + 1;
    }
    return -1;
  }

  /** The height of an expedition's mountain path at a column, NaN off it. */
  private pathHeight(e: ExpeditionSite, x: number, z: number): number {
    const p = this.pathOf(e);
    return p ? this.spiral(x, z, p.cx, p.cz, p.r0, p.r1, p.y0, p.y1, p.turns, p.start, 5) : NaN;
  }

  /**
   * What a landmark's ground is made of, where it differs from its land's: Frostpeak's snow, glacier
   * and bare rock; Mount Cinder's basalt, ash and glowing seams by its lava rivers.
   */
  landmarkGround(x: number, z: number, h: number, steep: boolean): { top: number; under: number; depth: number } | null {
    for (const e of this.expeditions) {
      if (e.id === 'frostpeak') {
        const [px, pz] = this.peakCentre(e.x, e.z, e.side, e.r);
        const pd = Math.hypot(x - px, z - pz);
        if (pd > FROST_R) continue;
        if (!Number.isNaN(this.pathHeight(e, x, z))) return { top: B.PACKED_ICE, under: B.STONE, depth: 2 };
        // The glacier the Winter Lark froze into, tonguing down toward the basin.
        const across = Math.abs(x - px - this.n2.noise(z * 0.04, 3.3) * 7);
        const along = -(z - pz) * e.side;
        if (along > 18 && along < 74 && across < 7 + along * 0.06) return { top: this.n1.noise(x * 0.12, z * 0.12) > 0.1 ? B.BLUE_ICE : B.PACKED_ICE, under: B.PACKED_ICE, depth: 4 };
        const high = h - e.y;
        if (steep) return { top: this.n3.noise(x * 0.2, h * 0.3) > 0.25 ? B.PACKED_ICE : high > 26 && this.n1.noise(x * 0.09, z * 0.09) > 0 ? B.SNOW : B.STONE, under: B.STONE, depth: 2 };
        return { top: B.SNOW, under: B.SNOW, depth: high > 8 ? 3 : 1 };
      }
      if (e.id === 'cinder') {
        const d = Math.hypot(x - e.x, z - e.z);
        if (d > CINDER_R) continue;
        const near = this.n1.noise(x * 0.07, z * 0.07);
        if (!Number.isNaN(this.pathHeight(e, x, z))) return { top: B.BLACKSTONE, under: B.BASALT, depth: 2 };
        if (d < 30) return { top: near > 0.2 ? B.MAGMA : near > -0.1 ? B.BLACKSTONE : B.BASALT, under: B.BLACKSTONE, depth: 3 };
        // Ash low down, black rock up the cone, a glow along the rivers' banks.
        if (this.lavaRiver(e, x + 2, z) || this.lavaRiver(e, x - 2, z) || this.lavaRiver(e, x, z + 2) || this.lavaRiver(e, x, z - 2)) return { top: B.MAGMA, under: B.BASALT, depth: 2 };
        if (steep) return { top: B.BASALT, under: B.BASALT, depth: 2 };
        return { top: h - e.y > 22 ? (near > 0 ? B.BLACKSTONE : B.BASALT) : near > 0.25 ? B.BLACKSTONE : B.ASH, under: B.BLACKSTONE, depth: 2 };
      }
    }
    return null;
  }

  /** The Black Lagoon's dark water (the mesher's tint and the map's colour). */
  blackWater(x: number, z: number): boolean {
    for (const e of this.expeditions) if (e.id === 'lagoon' && Math.hypot(x - e.x, z - e.z) < e.r * 0.75) return true;
    return false;
  }

  /** The Whispering Meadows: the grass stands tall and thick with flowers. */
  meadowAt(x: number, z: number): boolean {
    for (const e of this.expeditions) if (e.id === 'meadow' && Math.hypot(x - e.x, z - e.z) < e.r * 1.05) return true;
    return false;
  }

  private cachedSites: Site[] | null = null;

  private sitesCache(): Site[] {
    if (!this.cachedSites) this.cachedSites = [...this.sites(), ...this.camps, ...this.lairs];
    return this.cachedSites;
  }

  heightInt(x: number, z: number): number {
    return Math.max(4, Math.min(WY - 8, Math.round(this.height(x, z))));
  }

  /** Biome and vegetation density for a column with surface height h. */
  column(x: number, z: number, h: number, slope: number): ColumnInfo {
    const m = this.mountainFactor(x, z);
    const water = h < SEA;
    const zone = this.zone(x, z);
    let biome: BiomeKind;
    const forest = this.n2.noise(x * 0.011 + 40, z * 0.011 - 20);
    const birch = this.n4.noise(x * 0.008 - 13, z * 0.008 + 77);
    let trees = 0;
    if (water) biome = Math.abs(z - this.riverZ(x)) < this.riverWidth(x) + 2 ? 'river' : 'beach';
    else if (h <= SEA + 1.5 && zone !== 'swamp') biome = 'beach';
    else if (h > 108 + this.n1.noise(x * 0.05, z * 0.05) * 5) biome = 'peak';
    else if (m > 0.55 || slope > 2.2) biome = h > 84 ? 'mountain' : 'taiga';
    else if (m > 0.3) biome = 'taiga';
    else if (forest > 0.12) biome = birch > 0.25 ? 'birch' : 'forest';
    else biome = 'meadow';
    switch (biome) {
      case 'forest':
        trees = 0.045 + Math.min(0.06, (forest - 0.12) * 0.25);
        break;
      case 'birch':
        trees = 0.05;
        break;
      case 'taiga':
        trees = slope > 1.6 ? 0.008 : 0.035;
        break;
      case 'mountain':
        trees = slope > 1.4 ? 0 : 0.012;
        break;
      case 'meadow':
        trees = 0.0035;
        break;
      default:
        trees = 0;
    }
    const lowland = biome === 'meadow' || biome === 'forest' || biome === 'birch' || biome === 'taiga';
    // The lands repaint the green valley: sand and cacti, snow under spruces, dead blight, swamp
    // oaks over the pools, bare red rock, ash and charred stumps.
    if (zone === 'desert' && lowland) {
      biome = 'desert';
      trees = 0;
    } else if (zone === 'snow' && (biome === 'meadow' || biome === 'forest' || biome === 'birch')) {
      biome = 'snowfield';
      trees = trees > 0.01 ? 0.03 : 0.008;
    } else if (zone === 'blight' && lowland) {
      biome = 'blight';
      trees = 0.007;
    } else if (zone === 'swamp' && (lowland || biome === 'beach')) {
      biome = 'swamp';
      trees = h <= SEA + 0.5 ? 0 : 0.012 + Math.max(0, forest) * 0.03;
    } else if (zone === 'badlands' && (lowland || biome === 'mountain')) {
      biome = 'badlands';
      trees = 0;
    } else if (zone === 'ember' && (lowland || biome === 'mountain' || biome === 'beach')) {
      biome = 'ember';
      trees = slope > 1.5 ? 0 : 0.005;
    }
    // (No trees up the great mountains; old oaks stand about the Whispering Meadows.)
    for (const e of this.expeditions) {
      if (Math.abs(x - e.x) > e.r + 30 || Math.abs(z - e.z) > e.r + 30) continue;
      if ((e.id === 'cinder' && Math.hypot(x - e.x, z - e.z) < CINDER_R) || (e.id === 'frostpeak' && (h > e.y + 10 || this.besidePath(e, x, z)))) trees = 0;
      if (e.id === 'meadow' && biome === 'meadow') trees = 0.006;
    }
    return { h, mountain: m, biome, zone, trees, water };
  }

  /** Point of interest nearest to a world position. */
  nearestSite(x: number, z: number): Site | null {
    let best: Site | null = null;
    let bestD = Infinity;
    for (const s of this.sitesCache()) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
}
