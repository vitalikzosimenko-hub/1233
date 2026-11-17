// Distant terrain: the land beyond the real chunks, built from the terrain functions alone and
// split into tiles the renderer can cull. It stands in steps like the blocks: columns 2, 4 or 8
// blocks square (wider farther off) at the heights the chunks will have, their sides cut through
// the soil and rock the chunks will show. Colours come from the blocks' own textures, by the same
// rules chunk generation lays the ground with, so the distance shows what the chunks will. Blocky
// stand-in trees stand at the exact spots where the real trees will stream in. The shader hides
// any part where real chunks are drawn.
import { B, BLOCKS, blockDef } from './blocks';
import { F_FALLS, F_FLAT, F_WATER, MeshBuilder } from './gl';
import { groundOf, rockAt, strataOf, type Col, type Ground, type Strata } from './ground';
import type { Vec3 } from './math3d';
import { grassTint, tileRect } from './mesher';
import { hash2 } from './rng';
import { SEA, WX, WZ, type BiomeKind, type Terrain } from './terrain';
import { base, hasTexture } from './textures';

export const LOD_TILE = 128;
export const LOD_TILES_X = WX / LOD_TILE;
export const LOD_TILES_Z = WZ / LOD_TILE;
/** Blocks to a side of the nearest tiles' columns (the stand-in trees stand on these). */
export const NEAR_COLS = 2;

export interface LodTile {
  x: number;
  z: number;
  minY: number;
  maxY: number;
  /** Blocks to a side of its columns. */
  cols: number;
  ground: MeshBuilder;
  water: MeshBuilder;
}

/** A tile's stand-in trees, built apart: only the tiles near enough to show them need them. */
export interface LodTrees {
  mesh: MeshBuilder;
  maxY: number;
}

// ------------------------------------------------------------------ the blocks' colours

/** Linear-light mean colour of every block's top (0..2) and side (3..5) texture. */
let faces: Float32Array = new Float32Array(256 * 6).fill(0.25);

/** The textures' mean colours as the main thread measured them (the worker paints nothing). */
export function useFaceColors(table: Float32Array): void {
  faces = table;
  soils.length = 0;
  soilIds.clear();
}

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Measures every block's top and side textures (main thread, once they are painted). */
export function measureFaceColors(): Float32Array {
  const out = new Float32Array(256 * 6).fill(0.25);
  const mean = (name: string, o: number): void => {
    if (!hasTexture(name)) return;
    const p = base(name);
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let i = 0; i < p.w * p.h; i += 1) {
      const w = p.d[i * 4 + 3]! / 255;
      r += toLinear(p.d[i * 4]!) * w;
      g += toLinear(p.d[i * 4 + 1]!) * w;
      b += toLinear(p.d[i * 4 + 2]!) * w;
      a += w;
    }
    if (a <= 0) return;
    out[o] = r / a;
    out[o + 1] = g / a;
    out[o + 2] = b / a;
  };
  for (const def of BLOCKS) {
    if (!def) continue;
    mean(def.tiles.top, def.id * 6);
    mean(def.tiles.side, def.id * 6 + 3);
  }
  return out;
}

/** A block's top as the chunks show it here (grass takes its biome's tint). Linear. */
function topOf(id: number, x: number, z: number): Vec3 {
  const o = id * 6;
  if (blockDef(id).tint === 'grass') {
    const t = grassTint(x, z);
    return [faces[o]! * t[0], faces[o + 1]! * t[1], faces[o + 2]! * t[2]];
  }
  return [faces[o]!, faces[o + 1]!, faces[o + 2]!];
}

/** Stone's strata (andesite, granite) read as stone from afar. */
function sideId(id: number): number {
  return id === B.ANDESITE || id === B.GRANITE ? B.STONE : id;
}

function sideOf(id: number): Vec3 {
  if (id >= SOIL) return soils[id - SOIL]!.c;
  const o = sideId(id) * 6 + 3;
  return [faces[o]!, faces[o + 1]!, faces[o + 2]!];
}

/** Soil bands (a top block's side over its under-blocks) are numbered from here. */
const SOIL = 1000;
const soils: Array<{ key: string; c: Vec3 }> = [];
const soilIds = new Map<string, number>();

/** The side of a column's soil, `tall` blocks of it: its top block's, then what lies under. */
function soilId(g: Ground, tall: number): number {
  const key = `${g.top},${g.under},${tall}`;
  let id = soilIds.get(key);
  if (id === undefined) {
    const a = sideOf(g.top);
    const b = sideOf(g.under);
    const k = (tall - 1) / tall;
    id = SOIL + soils.length;
    soils.push({ key, c: mix3(a, b, k) });
    soilIds.set(key, id);
  }
  return id;
}

const ONE4 = [1, 1, 1, 1];

function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function mul(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** Linear colour to the vertex encoding (the shader squares it back). */
function enc(c: Vec3): Vec3 {
  return [Math.sqrt(Math.max(0, c[0])), Math.sqrt(Math.max(0, c[1])), Math.sqrt(Math.max(0, c[2]))];
}

/** Matches the canopy colours of the real leaves (texture average times biome tint). */
function crownColor(biome: BiomeKind, kind: number, x: number, z: number): Vec3 {
  const v = 0.9 + hash2(x, z, 911) * 0.2;
  if (kind === B.SPRUCE_LEAVES) return mul([0.2, 0.36, 0.25], v);
  if (kind === B.BIRCH_LEAVES) return mul([0.47, 0.66, 0.3], v);
  if (kind === B.SWAMP_LEAVES) return mul([0.22, 0.34, 0.14], v);
  return mul(biome === 'meadow' ? [0.32, 0.55, 0.2] : [0.28, 0.5, 0.18], v);
}

function crownKind(biome: BiomeKind): number {
  if (biome === 'taiga' || biome === 'mountain' || biome === 'snowfield') return B.SPRUCE_LEAVES;
  if (biome === 'birch') return B.BIRCH_LEAVES;
  if (biome === 'swamp') return B.SWAMP_LEAVES;
  return B.LEAVES;
}

/** A column as chunk generation sees it. */
function colOf(T: Terrain, x: number, z: number, h: number, slope: number): Col {
  const c = T.column(x, z, h, slope);
  return { h, slope, biome: c.biome, zone: c.zone, trees: c.trees, mountain: c.mountain };
}

/** Lava and magma glow (the shader's share of self-light). */
const LAVA_GLOW = 1;

/** A liquid's top over a column (the water and lava its chunk fills it with), or null. Linear. */
function liquidOf(T: Terrain, x: number, z: number, h: number, col: Col): { y: number; c: Vec3; water: boolean; glow: number } | null {
  const lava = T.lavaLevel(x, z, h);
  if (lava > h) return { y: lava + 0.875, c: topOf(B.LAVA, x, z), water: false, glow: LAVA_GLOW };
  if (h >= SEA) return null;
  if (col.zone === 'ember') return { y: SEA - 0.125, c: topOf(B.LAVA, x, z), water: false, glow: LAVA_GLOW };
  // (Frozen over in the snowfields.)
  if (col.zone === 'snow') return { y: SEA, c: topOf(B.ICE, x, z), water: false, glow: 0 };
  const c: Vec3 = T.blackWater(x, z) ? [0.004, 0.008, 0.007] : col.zone === 'swamp' ? [0.025, 0.06, 0.035] : [0.03, 0.11, 0.33];
  return { y: SEA - 0.125, c, water: true, glow: 0 };
}

// ------------------------------------------------------------------ the land in steps

/** One stretch of a column's side: blocks of one kind from y0 up to y1. */
interface Band {
  y0: number;
  y1: number;
  id: number;
}

function sameBands(a: Band[], b: Band[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i]!.y0 !== b[i]!.y0 || a[i]!.y1 !== b[i]!.y1 || a[i]!.id !== b[i]!.id) return false;
  return true;
}

/**
 * Builds one tile in steps: columns C blocks square, each at its middle column's height (the
 * nearest at their corner's, so they line up with the blocks), its top that column's top block and
 * its sides, where it stands above a neighbour, the top block's side, the soil under it and then
 * its land's rock, merged into runs. Its rim hangs a skirt, so nothing shows through where a
 * neighbour of another column size meets it. Tens of milliseconds for the finest: the renderer has
 * them built off the main thread, nearest first, as the view needs them.
 */
export function buildLodTile(T: Terrain, ti: number, tj: number, C: number): LodTile {
  const x0 = ti * LOD_TILE;
  const z0 = tj * LOD_TILE;
  const N = LOD_TILE / C;
  const M = N + 2;
  // Each cell stands at its middle column's height (a ring of the neighbours' too). Heights on
  // demand: those and the blocks beside each, for its slope.
  const off = C === NEAR_COLS ? 0 : C / 2;
  const G = LOD_TILE + 2 * C + 3;
  const hs = new Int16Array(G * G).fill(-1);
  const hAt = (x: number, z: number): number => {
    const k = (z - z0 + C + 1) * G + (x - x0 + C + 1);
    let h = hs[k]!;
    if (h < 0) {
      h = T.heightInt(Math.max(0, Math.min(WX - 1, x)), Math.max(0, Math.min(WZ - 1, z)));
      hs[k] = h;
    }
    return h;
  };
  const height = new Int16Array(M * M);
  for (let j = 0; j < M; j += 1) for (let i = 0; i < M; i += 1) height[j * M + i] = hAt(x0 + (i - 1) * C + off, z0 + (j - 1) * C + off);
  const hc = (i: number, j: number): number => height[(j + 1) * M + i + 1]!;

  // What each cell shows on top, and the ground its sides are cut through.
  const top = new Float32Array(N * N);
  const liquid = new Uint8Array(N * N);
  const glow = new Float32Array(N * N);
  const colour = new Float32Array(N * N * 3);
  const grounds: Ground[] = new Array(N * N);
  const strata: Array<Strata | null> = new Array(N * N).fill(null);
  const zones: Col['zone'][] = new Array(N * N);
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const k = j * N + i;
      const x = x0 + i * C + off;
      const z = z0 + j * C + off;
      const h = hc(i, j);
      const slope = Math.max(Math.abs(h - hAt(x + 1, z)), Math.abs(h - hAt(x - 1, z)), Math.abs(h - hAt(x, z + 1)), Math.abs(h - hAt(x, z - 1)));
      const col = colOf(T, x, z, h, slope);
      const g = groundOf(T, x, z, col);
      grounds[k] = g;
      zones[k] = col.zone;
      const wet = liquidOf(T, x, z, h, col);
      let c: Vec3;
      if (wet) {
        top[k] = wet.y;
        liquid[k] = wet.water ? 1 : 2;
        glow[k] = wet.glow;
        c = wet.c;
      } else {
        top[k] = h + 1;
        glow[k] = g.top === B.MAGMA ? LAVA_GLOW : 0;
        c = topOf(g.top, x, z);
        // (Big columns stand where the stand-in trees may not: thick woods darken them.)
        if (C > NEAR_COLS && col.trees > 0.012) {
          const crown = crownColor(col.biome, crownKind(col.biome), x, z);
          c = mix3(c, [crown[0] * crown[0], crown[1] * crown[1], crown[2] * crown[2]], Math.min(1, col.trees * 16) * 0.72);
        }
      }
      colour[k * 3] = c[0];
      colour[k * 3 + 1] = c[1];
      colour[k * 3 + 2] = c[2];
    }
  }

  const ground = new MeshBuilder(N * N);
  const water = new MeshBuilder(64);
  let minY = Infinity;
  let maxY = -Infinity;
  const white = tileRect('white');
  ground.sky = 1;
  ground.blk = 0;
  const quad = (p: number[], n: Vec3, c: Vec3, ao: number[], flags: number): void => {
    ground.flags = flags;
    ground.tint = enc(c);
    ground.quad(p, white, n[0], n[1], n[2], ao);
    for (let k = 1; k < 12; k += 3) {
      minY = Math.min(minY, p[k]!);
      maxY = Math.max(maxY, p[k]!);
    }
  };
  const cellColour = (k: number): Vec3 => [colour[k * 3]!, colour[k * 3 + 1]!, colour[k * 3 + 2]!];

  // ---- tops: rectangles of level, alike cells (in the first one's colour: the rest are a shade off at most)
  const near = (a: number, b: number): boolean => {
    if (top[a] !== top[b] || liquid[a] !== liquid[b] || glow[a] !== glow[b]) return false;
    for (let c = 0; c < 3; c += 1) if (Math.abs(Math.sqrt(colour[a * 3 + c]!) - Math.sqrt(colour[b * 3 + c]!)) > 0.016) return false;
    return true;
  };
  const used = new Uint8Array(N * N);
  for (let j = 0; j < N; j += 1) {
    let i = 0;
    while (i < N) {
      const k = j * N + i;
      if (used[k]) {
        i += 1;
        continue;
      }
      let e = i;
      while (e + 1 < N && !used[j * N + e + 1] && near(k, j * N + e + 1)) e += 1;
      // Down the rows while the same stretch is level and alike there too.
      let f = j;
      for (;;) {
        const r = f + 1;
        if (r >= N) break;
        let ok = true;
        for (let q = i; q <= e && ok; q += 1) ok = !used[r * N + q] && near(k, r * N + q);
        if (!ok) break;
        f = r;
      }
      for (let r = j; r <= f; r += 1) used.fill(1, r * N + i, r * N + e + 1);
      const y = top[k]!;
      const xa = x0 + i * C;
      const xb = x0 + (e + 1) * C;
      const za = z0 + j * C;
      const zb = z0 + (f + 1) * C;
      ground.emit = glow[k]!;
      quad([xa, y, zb, xa, y, za, xb, y, za, xb, y, zb], [0, 1, 0], cellColour(k), ONE4, F_FLAT | (liquid[k] === 1 ? F_WATER : 0));
      i = e + 1;
    }
  }
  ground.emit = 0;

  // ---- sides: where a column stands above its neighbour (cut short at water, which hides the rest)
  const bandsOf = (i: number, j: number, di: number, dj: number): Band[] | null => {
    const k = j * N + i;
    if (liquid[k]) return null;
    const h = hc(i, j);
    const hn = hc(i + di, j + dj);
    const ni = i + di;
    const nj = j + dj;
    const edge = ni < 0 || nj < 0 || ni >= N || nj >= N;
    let y0 = hn + 1;
    if (hn < SEA) y0 = Math.max(y0, SEA - 1);
    // (The tile's rim: a skirt below the top, whatever the neighbour, deeper as its columns are
    // wider: a neighbour of another size samples other columns.)
    if (edge) y0 = Math.min(y0, h - 1) - (C - NEAR_COLS);
    if (y0 >= h + 1) return null;
    const g = grounds[k]!;
    // The soil (the top block's side and what lies under it, one colour from afar), then the rock
    // in its layers.
    const out: Band[] = [];
    const soil = Math.max(y0, h - g.depth + 1);
    out.push({ y0: soil, y1: h + 1, id: soilId(g, h - soil + 1) });
    for (let y = soil - 1; y >= y0; y -= 1) {
      let s = strata[k];
      if (!s) {
        s = strataOf(T, x0 + i * C + off, z0 + j * C + off, zones[k]!);
        strata[k] = s;
      }
      const id = sideId(rockAt(s, y, h));
      const last = out[out.length - 1]!;
      if (last.id === id) last.y0 = y;
      else out.push({ y0: y, y1: y + 1, id });
    }
    return out;
  };
  // (Occlusion darkens a side's foot where it meets the ground below.)
  const sideRun = (bands: Band[], n: Vec3, ax: number, az: number, bx: number, bz: number, foot: boolean): void => {
    for (let s = 0; s < bands.length; s += 1) {
      const bd = bands[s]!;
      const c = sideOf(bd.id);
      const lo = foot && s === bands.length - 1 ? 0.78 : 1;
      quad([ax, bd.y0, az, ax, bd.y1, az, bx, bd.y1, bz, bx, bd.y0, bz], n, c, [lo, 1, 1, lo], F_FLAT);
    }
  };
  const footed = (i: number, j: number, di: number, dj: number): boolean => {
    const ni = i + di;
    const nj = j + dj;
    return ni >= 0 && nj >= 0 && ni < N && nj < N && hc(ni, nj) >= SEA;
  };
  // Faces toward -z and +z, merged along x.
  for (const dj of [-1, 1]) {
    for (let j = 0; j < N; j += 1) {
      const z = z0 + (dj > 0 ? j + 1 : j) * C;
      let run: { i0: number; i1: number; bands: Band[] } | null = null;
      for (let i = 0; i <= N; i += 1) {
        const bands = i < N ? bandsOf(i, j, 0, dj) : null;
        if (run && bands && sameBands(run.bands, bands)) {
          run.i1 = i;
          continue;
        }
        if (run) {
          const xa = x0 + run.i0 * C;
          const xb = x0 + (run.i1 + 1) * C;
          const foot = footed(run.i0, j, 0, dj);
          if (dj > 0) sideRun(run.bands, [0, 0, 1], xa, z, xb, z, foot);
          else sideRun(run.bands, [0, 0, -1], xb, z, xa, z, foot);
        }
        run = bands ? { i0: i, i1: i, bands } : null;
      }
    }
  }
  // Faces toward -x and +x, merged along z.
  for (const di of [-1, 1]) {
    for (let i = 0; i < N; i += 1) {
      const x = x0 + (di > 0 ? i + 1 : i) * C;
      let run: { j0: number; j1: number; bands: Band[] } | null = null;
      for (let j = 0; j <= N; j += 1) {
        const bands = j < N ? bandsOf(i, j, di, 0) : null;
        if (run && bands && sameBands(run.bands, bands)) {
          run.j1 = j;
          continue;
        }
        if (run) {
          const za = z0 + run.j0 * C;
          const zb = z0 + (run.j1 + 1) * C;
          const foot = footed(i, run.j0, di, 0);
          if (di > 0) sideRun(run.bands, [1, 0, 0], x, zb, x, za, foot);
          else sideRun(run.bands, [-1, 0, 0], x, za, x, zb, foot);
        }
        run = bands ? { j0: j, j1: j, bands } : null;
      }
    }
  }
  ground.flags = 0;
  ground.emit = 0;
  maxY = Math.max(maxY, addFalls(T, x0, z0, water));
  return { x: x0, z: z0, minY, maxY, cols: C, ground, water };
}

/** Waterfalls as falling sheets (drawn in the water pass); returns the top of the highest. */
function addFalls(T: Terrain, x0: number, z0: number, water: MeshBuilder): number {
  let maxY = -Infinity;
  for (const f of T.falls) {
    if (f.x < x0 || f.x >= x0 + LOD_TILE || f.z < z0 || f.z >= z0 + LOD_TILE) continue;
    const t = tileRect('water_flow');
    water.flags = F_WATER | F_FALLS;
    water.tint = [0.92, 0.98, 1];
    water.sky = 1;
    const half = Math.floor(f.width / 2) + 0.5;
    const ax = Math.abs(f.fz);
    const az = Math.abs(f.fx);
    const ex = f.x + 0.5 + f.fx * 0.5;
    const ez = f.z + 0.5 + f.fz * 0.5;
    const bottom = f.bottom - 1;
    const top = f.top + 1;
    const tr = [t[0], 0, t[2], (top - bottom) / 4, t[4]] as const;
    water.quad([ex - ax * half, bottom, ez - az * half, ex - ax * half, top, ez - az * half, ex + ax * half, top, ez + az * half, ex + ax * half, bottom, ez + az * half], tr, f.fx, 0, f.fz);
    water.quad([ex + ax * half, bottom, ez + az * half, ex + ax * half, top, ez + az * half, ex - ax * half, top, ez - az * half, ex - ax * half, bottom, ez - az * half], tr, -f.fx, 0, -f.fz);
    maxY = Math.max(maxY, top);
  }
  water.flags = 0;
  return maxY;
}

// ------------------------------------------------------------------ stand-in trees

interface TreeSpot {
  x: number;
  z: number;
  g: number;
  kind: number;
  size: number;
  biome: BiomeKind;
}

/** Same jittered 5x5 tree grid as the chunk generator, evaluated without chunks. */
function treesIn(T: Terrain, x0: number, z0: number, x1: number, z1: number): TreeSpot[] {
  const out: TreeSpot[] = [];
  const G = 5;
  const sites = T.clearings();
  for (let gz = Math.floor(z0 / G); gz <= Math.floor((z1 - 1) / G); gz += 1) {
    for (let gx = Math.floor(x0 / G); gx <= Math.floor((x1 - 1) / G); gx += 1) {
      const tx = gx * G + Math.floor(hash2(gx, gz, 101) * G);
      const tz = gz * G + Math.floor(hash2(gx, gz, 102) * G);
      if (tx < x0 || tz < z0 || tx >= x1 || tz >= z1) continue;
      const h = T.heightInt(tx, tz);
      if (h < SEA) continue;
      let slope = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) slope = Math.max(slope, Math.abs(h - T.heightInt(tx + dx, tz + dz)));
      if (slope > 2) continue;
      const col = T.column(tx, tz, h, slope);
      if (col.trees <= 0) continue;
      if (hash2(gx, gz, 103) > col.trees * G * G * 0.9) continue;
      let blocked = false;
      for (const s of sites) if (Math.hypot(tx - s.x, tz - s.z) < s.radius + 7) blocked = true;
      if (blocked || Math.abs(tz - T.centerZ(tx)) < 3.5) continue;
      const r = hash2(tx, tz, 105);
      let kind: number = B.LEAVES;
      let size = 1;
      // Dead blight trees and charred stumps have no crowns to show from afar.
      if (col.biome === 'blight' || col.biome === 'ember') continue;
      if (col.biome === 'taiga' || col.biome === 'mountain' || col.biome === 'snowfield') kind = B.SPRUCE_LEAVES;
      else if (col.biome === 'birch') kind = r < 0.85 ? B.BIRCH_LEAVES : B.LEAVES;
      else if (col.biome === 'swamp') {
        kind = B.SWAMP_LEAVES;
        size = 1.3;
      }
      else if (col.biome === 'meadow' && r < 0.3) size = 1.4;
      else if (col.biome === 'forest' && r < 0.18) size = 1.4;
      out.push({ x: tx, z: tz, g: h, kind, size, biome: col.biome });
    }
  }
  return out;
}

/** Top-coloured box (sides darker): the shader lights it with the sun. */
function flatBox(b: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, top: Vec3, side: Vec3): void {
  const white = tileRect('white');
  b.flags = F_FLAT;
  b.sky = 1;
  b.blk = 0;
  b.tint = top;
  b.quad([x0, y1, z1, x0, y1, z0, x1, y1, z0, x1, y1, z1], white, 0, 1, 0);
  b.tint = side;
  b.quad([x1, y0, z1, x1, y1, z1, x1, y1, z0, x1, y0, z0], white, 1, 0, 0);
  b.quad([x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1], white, -1, 0, 0);
  b.quad([x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1], white, 0, 0, 1);
  b.quad([x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z0], white, 0, 0, -1);
  b.flags = 0;
}

/** A tile's crowns and trunks, at the exact spots where the real trees will stream in. */
export function buildLodTrees(T: Terrain, ti: number, tj: number): LodTrees {
  const x0 = ti * LOD_TILE;
  const z0 = tj * LOD_TILE;
  const mesh = new MeshBuilder(256);
  let maxY = -Infinity;
  for (const t of treesIn(T, x0, z0, x0 + LOD_TILE, z0 + LOD_TILE)) {
    const c = crownColor(t.biome, t.kind, t.x, t.z);
    const base = t.g + 1;
    const cx = t.x + 0.5;
    const cz = t.z + 0.5;
    let crownLo: number;
    let crownHi: number;
    if (t.kind === B.SPRUCE_LEAVES) {
      // A stepped cone like the real spruces.
      crownLo = base + 2;
      crownHi = base + 10;
      flatBox(mesh, cx - 2.5, crownLo, cz - 2.5, cx + 2.5, crownLo + 3, cz + 2.5, c, mul(c, 0.72));
      flatBox(mesh, cx - 1.6, crownLo + 3, cz - 1.6, cx + 1.6, crownLo + 6, cz + 1.6, c, mul(c, 0.72));
      flatBox(mesh, cx - 0.7, crownLo + 6, cz - 0.7, cx + 0.7, crownHi, cz + 0.7, c, mul(c, 0.72));
    } else {
      const r = 2.5 * t.size;
      crownLo = base + 3 * t.size;
      crownHi = base + 6.5 * t.size;
      flatBox(mesh, cx - r, crownLo, cz - r, cx + r, crownHi - 1.2 * t.size, cz + r, c, mul(c, 0.72));
      flatBox(mesh, cx - r * 0.6, crownHi - 1.2 * t.size, cz - r * 0.6, cx + r * 0.6, crownHi, cz + r * 0.6, c, mul(c, 0.72));
    }
    const bark: Vec3 = t.kind === B.BIRCH_LEAVES ? [0.8, 0.78, 0.72] : [0.35, 0.26, 0.17];
    // (The trunk reaches well down: wider columns farther off stand a little off the true ground.)
    flatBox(mesh, t.x + 0.3, base - 5, t.z + 0.3, t.x + 0.7, crownLo, t.z + 0.7, bark, mul(bark, 0.8));
    maxY = Math.max(maxY, crownHi + 2);
  }
  return { mesh, maxY };
}
