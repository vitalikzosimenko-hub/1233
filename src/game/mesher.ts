// Turns voxel grids into triangle meshes: world sections (16^3, read through a padded cache
// that includes the neighbouring cells) and the moving bodies (fortress, giants). Output is
// split into an opaque mesh, a double-sided cut-out mesh (leaves, plants, ladders, chains)
// and a translucent water mesh.
import { B, BLOCKS, blockDef } from './blocks';
import { kx, ky, kz, type BlockBody } from './body';
import { F_FALLS, F_LEAVES, F_PLANT, F_WATER, type MeshBuilder, type TexRect } from './gl';
import type { BodyLight } from './light';
import type { Vec3 } from './math3d';
import { fbm2, hash2 } from './rng';
import type { Terrain } from './terrain';
import { layerOf } from './textures';
import { CHUNKS_X, CS, DIR_DOWN, DIRS, WX, WY, WZ, type World } from './world';

interface FaceDef {
  n: readonly [number, number, number];
  corners: ReadonlyArray<readonly [number, number, number]>;
  slot: 'top' | 'side' | 'bottom';
}

// Corners in BL, TL, TR, BR order seen from outside the block.
export const FACES: readonly FaceDef[] = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]], slot: 'side' },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], slot: 'side' },
  { n: [0, 1, 0], corners: [[0, 1, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1]], slot: 'top' },
  { n: [0, -1, 0], corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], slot: 'bottom' },
  { n: [0, 0, 1], corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]], slot: 'side' },
  { n: [0, 0, -1], corners: [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]], slot: 'side' },
];
/** DIRS index -> FACES index with the same normal. */
export const DIR_FACE = [0, 1, 4, 5, 2, 3];
const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4];
/** Ambient occlusion per number of occluding neighbours (3 = open corner). */
const AO = [0.38, 0.58, 0.79, 1.0];

// Per-id lookup tables (meshing is the hot loop).
const OPAQUE = new Uint8Array(256);
const OCCLUDE = new Uint8Array(256);
const SHAPE = new Uint8Array(256);
const SH = { cube: 1, stairs: 2, fence: 3, ladder: 4, vine: 5, wire: 6, cross: 7, crop: 8, torch: 9, lantern: 10, chain: 11, liquid: 12, falls: 13, helm: 14, pad: 15, slab: 16, pane: 17, shutter: 18, wall: 19, banner: 20, planter: 21 } as const;
const LEAFY = new Uint8Array(256);
/** Cubes with see-through texels: drawn in the alpha-tested cut-out pass. */
const CUT = new Uint8Array(256);
const CONNECT = new Uint8Array(256);
/** What glass panes and stone walls join up with: solid cubes, fences, panes and walls. */
const JOIN = new Uint8Array(256);
for (let id = 0; id < 256; id += 1) {
  const def = blockDef(id);
  OPAQUE[id] = def.opaque ? 1 : 0;
  OCCLUDE[id] = def.occluder ? 1 : 0;
  SHAPE[id] = id === 0 ? 0 : SH[def.shape];
  LEAFY[id] = id === B.LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES || id === B.SWAMP_LEAVES ? 1 : 0;
  CUT[id] = LEAFY[id] || id === B.GLASS || id === B.SEAL_CRYSTAL ? 1 : 0;
  CONNECT[id] = (def.solid && def.shape === 'cube') || def.shape === 'fence' ? 1 : 0;
  JOIN[id] = CONNECT[id] || def.shape === 'pane' || def.shape === 'wall' ? 1 : 0;
}

const rects = new Map<string, TexRect>();
/** A whole texture-array layer. */
export function tileRect(name: string): TexRect {
  let r = rects.get(name);
  if (!r) {
    r = [0, 0, 1, 1, layerOf(name)];
    rects.set(name, r);
  }
  return r;
}

/** A pixel sub-rectangle of a 32x32 texture (in 32nds). */
export function subRect(name: string, x0: number, y0: number, x1: number, y1: number): TexRect {
  return [x0 / 32, y0 / 32, x1 / 32, y1 / 32, layerOf(name)];
}

// ------------------------------------------------------------------ colour maps

/** The world being meshed: its lands tint the grass and the water (the swamp's are murky). */
let lands: Terrain | null = null;

/** Sets the lands before any section is meshed (the distant terrain's worker has no world). */
export function useLands(t: Terrain): void {
  lands = t;
}

function swampy(x: number, z: number): boolean {
  return lands !== null && lands.version >= 2 && lands.zone(x, z) === 'swamp';
}

/** Biome tint of grass: warm meadows, deep green forests, cool blue-green taiga, murky swamp. */
export function grassTint(x: number, z: number): Vec3 {
  const n = fbm2(x * 0.012, z * 0.012, 4242);
  const m = fbm2(x * 0.05, z * 0.05, 4244);
  // (Minecraft's swamp olive: less green than red against the meadows.)
  if (swampy(x, z)) return [0.5 + 0.04 * m, 0.43 + 0.03 * m, 0.21];
  const warm = Math.max(0, Math.min(1, n * 1.6 - 0.3));
  return [0.84 + 0.2 * warm + 0.05 * m, 0.96 + 0.05 * m, 0.78 - 0.12 * warm];
}

export function foliageTint(x: number, z: number, id: number): Vec3 {
  const n = fbm2(x * 0.03 + 31, z * 0.03, 4243);
  if (id === B.BIRCH_LEAVES) return [0.95 + 0.08 * n, 1.0, 0.85];
  if (id === B.SPRUCE_LEAVES) return [0.85, 0.92 + 0.05 * n, 0.95];
  // Swamp foliage: murky olive, darker in the hollows.
  if (id === B.SWAMP_LEAVES) return [0.54 + 0.06 * n, 0.5 + 0.04 * n, 0.28];
  if (id === B.LILY_PAD) return [0.66 + 0.1 * n, 0.82 + 0.06 * n, 0.5];
  return [0.82 + 0.22 * n, 0.95 + 0.06 * n, 0.82 - 0.06 * n];
}

const WATER_TINT: Vec3 = [0.9, 1, 1];
const SWAMP_WATER: Vec3 = [0.85, 0.74, 0.34];
const BLACK_WATER: Vec3 = [0.12, 0.17, 0.13];
const WHITE: Vec3 = [1, 1, 1];

// ------------------------------------------------------------------ padded grid

/** A box of cells copied out of the world or a body, with a one-cell border. */
export class Grid {
  ox = 0;
  oy = 0;
  oz = 0;
  sx = 0;
  sy = 0;
  sz = 0;
  ids = new Uint8Array(0);
  sky = new Uint8Array(0);
  blk = new Uint8Array(0);
  meta = new Int8Array(0);
  /** Per-cell extra flags (powered redstone). */
  extra = new Uint8Array(0);
  /** Light outside the grid (bodies: open daylight). */
  outsideSky = 15;

  resize(sx: number, sy: number, sz: number): void {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    const n = sx * sy * sz;
    if (this.ids.length < n) {
      this.ids = new Uint8Array(n);
      this.sky = new Uint8Array(n);
      this.blk = new Uint8Array(n);
      this.meta = new Int8Array(n);
      this.extra = new Uint8Array(n);
    }
    this.ids.fill(0, 0, n);
    this.sky.fill(0, 0, n);
    this.blk.fill(0, 0, n);
    this.meta.fill(-1, 0, n);
    this.extra.fill(0, 0, n);
  }

  i(x: number, y: number, z: number): number {
    return (x - this.ox) + this.sx * ((z - this.oz) + this.sz * (y - this.oy));
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= this.ox && y >= this.oy && z >= this.oz && x < this.ox + this.sx && y < this.oy + this.sy && z < this.oz + this.sz;
  }

  id(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.ids[this.i(x, y, z)]! : 0;
  }

  skyAt(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.sky[this.i(x, y, z)]! : this.outsideSky;
  }

  blkAt(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.blk[this.i(x, y, z)]! : 0;
  }

  metaAt(x: number, y: number, z: number): number {
    const m = this.inside(x, y, z) ? this.meta[this.i(x, y, z)]! : -1;
    return m < 0 ? 0 : m;
  }

  /** Copies a world section plus its border (cells of missing chunks count as stone). */
  fromWorld(w: World, sx: number, sy: number, sz: number): void {
    this.ox = sx * CS - 1;
    this.oy = sy * 16 - 1;
    this.oz = sz * CS - 1;
    this.resize(18, 18, 18);
    this.outsideSky = 15;
    for (let z = 0; z < 18; z += 1) {
      const wz = this.oz + z;
      for (let x = 0; x < 18; x += 1) {
        const wx = this.ox + x;
        const outside = wx < 0 || wz < 0 || wx >= WX || wz >= WZ;
        const c = outside ? null : w.chunks[(wz >> 4) * CHUNKS_X + (wx >> 4)];
        const col = (wx & 15) | ((wz & 15) << 4);
        for (let y = 0; y < 18; y += 1) {
          const wy = this.oy + y;
          const gi = x + 18 * (z + 18 * y);
          if (wy < 0) {
            this.ids[gi] = B.BEDROCK;
            continue;
          }
          if (wy >= WY) {
            this.sky[gi] = 15;
            continue;
          }
          if (!c) {
            this.ids[gi] = outside ? B.BEDROCK : w.virtual(wx, wy, wz);
            this.sky[gi] = this.ids[gi] === B.AIR ? 15 : 0;
            continue;
          }
          const li = col | (wy << 8);
          this.ids[gi] = c.blocks[li]!;
          this.sky[gi] = c.sky[li]!;
          this.blk[gi] = c.blk[li]!;
        }
      }
    }
    // Sparse metadata from the (up to nine) overlapped chunks.
    for (let cz = this.oz >> 4; cz <= (this.oz + 17) >> 4; cz += 1) {
      for (let cx = this.ox >> 4; cx <= (this.ox + 17) >> 4; cx += 1) {
        const c = w.chunk(cx, cz);
        if (!c || c.meta.size === 0) continue;
        for (const [li, m] of c.meta) {
          const wx = cx * CS + (li & 15);
          const wz = cz * CS + ((li >> 4) & 15);
          const wy = li >> 8;
          if (this.inside(wx, wy, wz)) this.meta[this.i(wx, wy, wz)] = m;
        }
      }
    }
  }

  /** Copies a body's cells (local coordinates) with its light field. */
  fromBody(body: BlockBody, light: BodyLight): void {
    this.ox = body.minX - 1;
    this.oy = body.minY - 1;
    this.oz = body.minZ - 1;
    this.resize(body.maxX - body.minX + 3, body.maxY - body.minY + 3, body.maxZ - body.minZ + 3);
    this.outsideSky = 15;
    for (let y = 0; y < this.sy; y += 1) {
      for (let z = 0; z < this.sz; z += 1) {
        for (let x = 0; x < this.sx; x += 1) {
          const gi = x + this.sx * (z + this.sz * y);
          const lx = this.ox + x - light.ox;
          const ly = this.oy + y - light.oy;
          const lz = this.oz + z - light.oz;
          if (lx >= 0 && ly >= 0 && lz >= 0 && lx < light.sx && ly < light.sy && lz < light.sz) {
            const li = lx + light.sx * (lz + light.sz * ly);
            this.sky[gi] = light.sky[li]!;
            this.blk[gi] = light.blk[li]!;
          } else {
            this.sky[gi] = 15;
          }
        }
      }
    }
    for (const [k, cell] of body.cells) {
      const gi = this.i(kx(k), ky(k), kz(k));
      this.ids[gi] = cell.id;
      this.meta[gi] = cell.dir;
      if (body.poweredWires.has(k)) this.extra[gi] = 1;
    }
  }
}

// ------------------------------------------------------------------ outputs

export interface MeshOut {
  opaque: MeshBuilder;
  cutout: MeshBuilder;
  water: MeshBuilder;
}

const quadPos = new Array<number>(12);
const aoV = [1, 1, 1, 1];
const skyV = [1, 1, 1, 1];
const blkV = [0, 0, 0, 0];

function faceVisible(id: number, nb: number): boolean {
  if (OPAQUE[nb]) return false;
  if (nb === id) return false;
  // Leaves of any kind hide each other's faces; the cut-out pass draws both sides.
  if (LEAFY[id] && LEAFY[nb]) return false;
  // Stairs' full back faces are opaque against cubes.
  return true;
}

function texFor(id: number, f: number, meta: number): TexRect {
  const def = BLOCKS[id]!;
  const face = FACES[f]!;
  if (def.tiles.front !== null && f === DIR_FACE[meta & 3]) return tileRect(def.tiles.front);
  return tileRect(def.tiles[face.slot]);
}

function tintFor(id: number, f: number, x: number, z: number): Vec3 {
  const def = BLOCKS[id]!;
  if (def.tint === 'grass') return f === 2 ? grassTint(x, z) : WHITE;
  if (def.tint === 'foliage' || def.tint === 'birch' || def.tint === 'spruce') return foliageTint(x, z, id);
  return WHITE;
}

/** Full cube faces with ambient occlusion and smooth lighting. */
function cubeFaces(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number, wx: number, wz: number): void {
  const meta = g.metaAt(x, y, z);
  b.flags = LEAFY[id] ? F_LEAVES : 0;
  for (let f = 0; f < 6; f += 1) {
    const face = FACES[f]!;
    const [nx, ny, nz] = face.n;
    const fx = x + nx;
    const fy = y + ny;
    const fz = z + nz;
    const nbId = g.id(fx, fy, fz);
    if (!faceVisible(id, nbId)) continue;
    const faceSky = g.skyAt(fx, fy, fz);
    const faceBlk = g.blkAt(fx, fy, fz);
    for (let i = 0; i < 4; i += 1) {
      const c = face.corners[i]!;
      const sx = c[0] * 2 - 1;
      const sy = c[1] * 2 - 1;
      const sz = c[2] * 2 - 1;
      // Tangent offsets: zero along the normal axis.
      const ax = fx + (nx !== 0 ? 0 : sx);
      const ay = fy + (nx !== 0 ? sy : 0);
      const az = fz;
      const bx = fx;
      const by = fy + (nz !== 0 ? sy : 0);
      const bz = fz + (nz !== 0 ? 0 : sz);
      const cx = ax;
      const cy = fy + (nx !== 0 ? sy : 0) + (nz !== 0 ? sy : 0);
      const cz = bz;
      const id1 = g.id(ax, ay, az);
      const id2 = g.id(bx, by, bz);
      const idc = g.id(cx, cy, cz);
      const o1 = OCCLUDE[id1]!;
      const o2 = OCCLUDE[id2]!;
      const oc = OCCLUDE[idc]!;
      aoV[i] = AO[o1 && o2 ? 0 : 3 - (o1 + o2 + oc)]!;
      // Smooth lighting: average the open cells around this corner (Minecraft's algorithm).
      let ls = faceSky;
      let lb = faceBlk;
      let n = 1;
      if (!OPAQUE[id1]) {
        ls += g.skyAt(ax, ay, az);
        lb += g.blkAt(ax, ay, az);
        n += 1;
      }
      if (!OPAQUE[id2]) {
        ls += g.skyAt(bx, by, bz);
        lb += g.blkAt(bx, by, bz);
        n += 1;
      }
      if (!OPAQUE[idc] && !(OPAQUE[id1] && OPAQUE[id2])) {
        ls += g.skyAt(cx, cy, cz);
        lb += g.blkAt(cx, cy, cz);
        n += 1;
      }
      skyV[i] = ls / (n * 15);
      blkV[i] = lb / (n * 15);
      quadPos[i * 3] = x + c[0];
      quadPos[i * 3 + 1] = y + c[1];
      quadPos[i * 3 + 2] = z + c[2];
    }
    b.tint = tintFor(id, f, wx, wz);
    b.quad(quadPos, texFor(id, f, meta), nx, ny, nz, aoV, skyV, blkV, aoV[1]! + aoV[3]! > aoV[0]! + aoV[2]!);
  }
  b.flags = 0;
  b.tint = WHITE;
}

/** Axis-aligned sub-box in cell units (0..1), lit by its cell's light, faces culled against cubes. */
function partBox(b: MeshBuilder, g: Grid, x: number, y: number, z: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tex: (f: number) => TexRect, cull = true): void {
  const sky = g.skyAt(x, y, z) / 15;
  const blk = g.blkAt(x, y, z) / 15;
  for (let f = 0; f < 6; f += 1) {
    const face = FACES[f]!;
    const [nx, ny, nz] = face.n;
    // Faces flush with the cell boundary are hidden by an opaque neighbour.
    const flush = (nx > 0 && x1 >= 1) || (nx < 0 && x0 <= 0) || (ny > 0 && y1 >= 1) || (ny < 0 && y0 <= 0) || (nz > 0 && z1 >= 1) || (nz < 0 && z0 <= 0);
    if (cull && flush && OPAQUE[g.id(x + nx, y + ny, z + nz)]) continue;
    // A face inside the cell (a step's tread, a slab's top) is lit like the open cell it looks
    // into: the part's own cell may be dark (stairs and slabs stop light like full blocks). A side
    // face against another part block looks into that block's open top (a step's tread beside it).
    let ns = g.skyAt(x + nx, y + ny, z + nz) / 15;
    let nb = g.blkAt(x + nx, y + ny, z + nz) / 15;
    const nid = ny === 0 ? g.id(x + nx, y, z + nz) : 0;
    if (nid !== 0 && !OPAQUE[nid] && SHAPE[nid] !== SH.cube) {
      ns = Math.max(ns, (g.skyAt(x + nx, y + 1, z + nz) / 15) * 0.85);
      nb = Math.max(nb, (g.blkAt(x + nx, y + 1, z + nz) / 15) * 0.85);
    }
    const ls = flush ? ns : Math.max(sky, ns);
    const lb = flush ? nb : Math.max(blk, nb);
    for (let i = 0; i < 4; i += 1) {
      const c = face.corners[i]!;
      quadPos[i * 3] = x + (c[0] ? x1 : x0);
      quadPos[i * 3 + 1] = y + (c[1] ? y1 : y0);
      quadPos[i * 3 + 2] = z + (c[2] ? z1 : z0);
    }
    // Map the texture to the part's position inside the cell (like Minecraft models).
    const t = tex(f);
    const [u0, u1, v0, v1] = faceUV(f, x0, y0, z0, x1, y1, z1);
    const r: TexRect = [t[0] + (t[2] - t[0]) * u0, t[1] + (t[3] - t[1]) * v0, t[0] + (t[2] - t[0]) * u1, t[1] + (t[3] - t[1]) * v1, t[4]];
    b.sky = Math.max(ls, sky * 0.85);
    b.blk = Math.max(lb, blk * 0.85);
    b.quad(quadPos, r, nx, ny, nz);
  }
}

/** Texture window (u0, u1, v0, v1 in 0..1) for a sub-box face, from the part's own extent. */
function faceUV(f: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): [number, number, number, number] {
  switch (f) {
    case 0:
      return [1 - z1, 1 - z0, 1 - y1, 1 - y0];
    case 1:
      return [z0, z1, 1 - y1, 1 - y0];
    case 2:
      return [x0, x1, z0, z1];
    case 3:
      return [x0, x1, 1 - z1, 1 - z0];
    case 4:
      return [x0, x1, 1 - y1, 1 - y0];
    default:
      return [1 - x1, 1 - x0, 1 - y1, 1 - y0];
  }
}

function stairs(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number): void {
  const def = BLOCKS[id]!;
  const meta = g.metaAt(x, y, z) & 3;
  const tex = (f: number): TexRect => tileRect(def.tiles[FACES[f]!.slot]);
  // Bottom slab, then the raised half on the side the stairs face away from (their back).
  b.tint = WHITE;
  partBox(b, g, x, y, z, 0, 0, 0, 1, 0.5, 1, tex);
  const [dx, , dz] = DIRS[meta]!;
  // meta = the side the steps rise toward: the upper half stands there.
  const x0 = dx > 0 ? 0.5 : 0;
  const x1 = dx < 0 ? 0.5 : 1;
  const z0 = dz > 0 ? 0.5 : 0;
  const z1 = dz < 0 ? 0.5 : 1;
  partBox(b, g, x, y, z, x0, 0.5, z0, x1, 1, z1, tex);
}

function fence(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number): void {
  const def = BLOCKS[id]!;
  const tex = (): TexRect => tileRect(def.tiles.side);
  const p0 = 6 / 16;
  const p1 = 10 / 16;
  partBox(b, g, x, y, z, p0, 0, p0, p1, 1, p1, tex, false);
  const r0 = 7 / 16;
  const r1 = 9 / 16;
  for (const [d, ax0, ax1, az0, az1] of [[0, p1, 1, r0, r1], [1, 0, p0, r0, r1], [2, r0, r1, p1, 1], [3, r0, r1, 0, p0]] as const) {
    const [dx, , dz] = DIRS[d]!;
    if (!CONNECT[g.id(x + dx, y, z + dz)]) continue;
    partBox(b, g, x, y, z, ax0, 6 / 16, az0, ax1, 9 / 16, az1, tex, false);
    partBox(b, g, x, y, z, ax0, 12 / 16, az0, ax1, 15 / 16, az1, tex, false);
  }
}

/** Half a block: the lower half, or with meta 1 the upper half (a floor, an eave, a balcony). */
function slab(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number): void {
  const def = BLOCKS[id]!;
  const tex = (f: number): TexRect => tileRect(def.tiles[FACES[f]!.slot]);
  b.tint = WHITE;
  if (g.metaAt(x, y, z) & 1) partBox(b, g, x, y, z, 0, 0.5, 0, 1, 1, 1, tex);
  else partBox(b, g, x, y, z, 0, 0, 0, 1, 0.5, 1, tex);
}

/** A glass pane: a thin panel running to the solid neighbours (a lone pane is a narrow post). */
function pane(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number): void {
  const tex = (): TexRect => tileRect(BLOCKS[id]!.tiles.side);
  const t0 = 7 / 16;
  const t1 = 9 / 16;
  const e = JOIN[g.id(x + 1, y, z)];
  const w = JOIN[g.id(x - 1, y, z)];
  const s = JOIN[g.id(x, y, z + 1)];
  const n = JOIN[g.id(x, y, z - 1)];
  b.tint = WHITE;
  // A pane with nothing beside it (or only one side) still spans its cell along that line.
  const alongX = e || w || !(s || n);
  const alongZ = s || n;
  if (alongX) partBox(b, g, x, y, z, w || !e ? 0 : t0, 0, t0, e || !w ? 1 : t1, 1, t1, tex, false);
  if (alongZ) partBox(b, g, x, y, z, t0, 0, n || !s ? 0 : t0, t1, 1, s || !n ? 1 : t1, tex, false);
}

/** A shutter: a slatted board standing against the wall on the meta side. */
function shutter(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number): void {
  const t = tileRect(BLOCKS[id]!.tiles.side);
  const tex = (): TexRect => t;
  const [dx, , dz] = DIRS[g.metaAt(x, y, z) & 3]!;
  const d = 3 / 16;
  b.tint = WHITE;
  partBox(b, g, x, y, z, dx > 0 ? 1 - d : 0, 0.02, dz > 0 ? 1 - d : 0, dx < 0 ? d : 1, 0.98, dz < 0 ? d : 1, tex, false);
}

/** A cobblestone wall: a square post with low walls joining its neighbours. */
function wallPost(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number): void {
  const def = BLOCKS[id]!;
  const tex = (f: number): TexRect => tileRect(def.tiles[FACES[f]!.slot]);
  b.tint = WHITE;
  const above = JOIN[g.id(x, y + 1, z)];
  partBox(b, g, x, y, z, 4 / 16, 0, 4 / 16, 12 / 16, above ? 1 : 1, 12 / 16, tex);
  const a0 = 5 / 16;
  const a1 = 11 / 16;
  const top = 13 / 16;
  for (const [d, ax0, ax1, az0, az1] of [[0, 12 / 16, 1, a0, a1], [1, 0, 4 / 16, a0, a1], [2, a0, a1, 12 / 16, 1], [3, a0, a1, 0, 4 / 16]] as const) {
    const [dx, , dz] = DIRS[d]!;
    if (!JOIN[g.id(x + dx, y, z + dz)]) continue;
    partBox(b, g, x, y, z, ax0, 0, az0, ax1, top, az1, tex);
  }
}

const BANNERS = ['banner_red', 'banner_blue', 'banner_green', 'banner_gold'];

/** A banner hanging on the wall on the meta side: its cloth, and the rod it hangs from. */
function banner(b: MeshBuilder, g: Grid, x: number, y: number, z: number): void {
  const meta = g.metaAt(x, y, z);
  const [dx, , dz] = DIRS[meta & 3]!;
  const cloth = tileRect(BANNERS[(meta >> 3) & 3]!);
  const rod = tileRect('planks_spruce');
  b.tint = WHITE;
  // The cloth hangs just off the wall, the full height of its cell.
  const c0 = 1 / 16;
  const c1 = 2 / 16;
  const x0 = dx > 0 ? 1 - c1 : dx < 0 ? c0 : 0;
  const x1 = dx > 0 ? 1 - c0 : dx < 0 ? c1 : 1;
  const z0 = dz > 0 ? 1 - c1 : dz < 0 ? c0 : 0;
  const z1 = dz > 0 ? 1 - c0 : dz < 0 ? c1 : 1;
  partBox(b, g, x, y, z, x0, -0.1, z0, x1, 0.94, z1, () => cloth, false);
  const r0 = dx > 0 ? 1 - 3 / 16 : dx < 0 ? 0 : -0.02;
  const r1 = dx > 0 ? 1 : dx < 0 ? 3 / 16 : 1.02;
  const s0 = dz > 0 ? 1 - 3 / 16 : dz < 0 ? 0 : -0.02;
  const s1 = dz > 0 ? 1 : dz < 0 ? 3 / 16 : 1.02;
  partBox(b, g, x, y, z, r0, 0.92, s0, r1, 1, s1, () => rod, false);
}

const BOX_FLOWERS = ['poppy', 'dandelion', 'cornflower', 'oxeye'];

/** A flower box on the wall on the meta side: a planked trough of earth with flowers in it. */
function planter(out: MeshOut, g: Grid, x: number, y: number, z: number, wx: number, wz: number): void {
  const b = out.opaque;
  const [dx, , dz] = DIRS[g.metaAt(x, y, z) & 3]!;
  const wood = tileRect('planks_spruce');
  const soil = tileRect('dirt');
  const d = 7 / 16;
  const x0 = dx > 0 ? 1 - d : dx < 0 ? 0 : 0.03;
  const x1 = dx > 0 ? 1 : dx < 0 ? d : 0.97;
  const z0 = dz > 0 ? 1 - d : dz < 0 ? 0 : 0.03;
  const z1 = dz > 0 ? 1 : dz < 0 ? d : 0.97;
  b.tint = WHITE;
  partBox(b, g, x, y, z, x0, 0, z0, x1, 6 / 16, z1, (f) => (f === 2 ? soil : wood), false);
  // Three little flowers along the trough.
  const c = out.cutout;
  c.sky = g.skyAt(x, y, z) / 15;
  c.blk = g.blkAt(x, y, z) / 15;
  c.tint = WHITE;
  c.flags = F_PLANT;
  for (let k = 0; k < 3; k += 1) {
    const t = tileRect(BOX_FLOWERS[Math.floor(hash2(wx * 7 + k, wz * 13 + y, 61) * BOX_FLOWERS.length)]!);
    const u = (k + 0.5) / 3;
    const cx = dx !== 0 ? (x0 + x1) / 2 : 0.1 + u * 0.8;
    const cz = dz !== 0 ? (z0 + z1) / 2 : 0.1 + u * 0.8;
    const r = 0.17;
    const h0 = 5 / 16;
    const h1 = h0 + 0.5;
    for (const [ax, az] of [[r, r], [r, -r]] as const) {
      const p = [x + cx - ax, y + h0, z + cz - az, x + cx - ax, y + h1, z + cz - az, x + cx + ax, y + h1, z + cz + az, x + cx + ax, y + h0, z + cz + az];
      c.quad(p, t, -az * 2, 0.86, ax * 2, PLANT_AO, null, null, false, PLANT_TOP);
    }
  }
  c.flags = 0;
}

/** A flat quad hugging the cell face toward dir (drawn double-sided in the cut-out pass). */
function flatQuad(b: MeshBuilder, g: Grid, x: number, y: number, z: number, dir: number, t: TexRect, tint: Vec3, emit: number, inset = 0.95): void {
  const [dx, dy, dz] = DIRS[dir]!;
  const front = FACES[OPPOSITE_FACE[DIR_FACE[dir]!]!]!;
  b.tint = tint;
  b.emit = emit;
  b.sky = g.skyAt(x, y, z) / 15;
  b.blk = g.blkAt(x, y, z) / 15;
  for (let i = 0; i < 4; i += 1) {
    const c = front.corners[i]!;
    quadPos[i * 3] = x + c[0] + dx * inset;
    quadPos[i * 3 + 1] = y + c[1] + dy * inset;
    quadPos[i * 3 + 2] = z + c[2] + dz * inset;
  }
  b.quad(quadPos, t, -dx, -dy, -dz);
  b.emit = 0;
  b.tint = WHITE;
}

function wireDir(g: Grid, x: number, y: number, z: number): number {
  if (blockDef(g.id(x, y - 1, z)).solid) return DIR_DOWN;
  for (const d of [0, 1, 2, 3]) {
    const [dx, , dz] = DIRS[d]!;
    if (blockDef(g.id(x + dx, y, z + dz)).solid) return d;
  }
  return DIR_DOWN;
}

const PLANT_TOP = [0, F_PLANT, F_PLANT, 0];
const PLANT_AO = [0.72, 1, 1, 0.72];

/** X-shaped plant sprite, nudged off-centre per cell like Minecraft's random offsets. */
function crossPlant(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number, wx: number, wz: number): void {
  const def = BLOCKS[id]!;
  const t = tileRect(def.tiles.side);
  const cane = id === B.SUGAR_CANE;
  const ox = cane ? 0 : (hash2(wx * 3 + 1, wz * 7 + y, 51) - 0.5) * 0.36;
  const oz = cane ? 0 : (hash2(wx * 5 + 2, wz * 3 + y, 52) - 0.5) * 0.36;
  const h = id === B.TALL_GRASS || id === B.FERN ? 0.8 + hash2(wx, wz, 53) * 0.35 : 1;
  b.tint = def.tint === 'grass' ? grassTint(wx, wz) : WHITE;
  b.sky = g.skyAt(x, y, z) / 15;
  b.blk = g.blkAt(x, y, z) / 15;
  const lo = 0.14;
  const hi = 0.86;
  const diagonals: Array<[number, number, number, number]> = [[lo, lo, hi, hi], [hi, lo, lo, hi]];
  b.flags = cane ? 0 : F_PLANT;
  for (const [ax, az, bx, bz] of diagonals) {
    const x0 = x + ax + ox;
    const z0 = z + az + oz;
    const x1 = x + bx + ox;
    const z1 = z + bz + oz;
    const p = [x0, y, z0, x0, y + h, z0, x1, y + h, z1, x1, y, z1];
    const nx = -(z1 - z0);
    const nz = x1 - x0;
    const l = Math.hypot(nx, nz);
    b.quad(p, t, nx / l * 0.5, 0.86, nz / l * 0.5, PLANT_AO, null, null, false, cane ? null : PLANT_TOP);
  }
  b.flags = 0;
  b.tint = WHITE;
}

/** Wheat: four planes in a # pattern. */
function crop(b: MeshBuilder, g: Grid, x: number, y: number, z: number, id: number): void {
  const t = tileRect(BLOCKS[id]!.tiles.side);
  b.sky = g.skyAt(x, y, z) / 15;
  b.blk = g.blkAt(x, y, z) / 15;
  b.tint = WHITE;
  b.flags = F_PLANT;
  const h = 0.95;
  for (const k of [0.25, 0.75]) {
    b.quad([x + k, y, z, x + k, y + h, z, x + k, y + h, z + 1, x + k, y, z + 1], t, 1, 0.3, 0, PLANT_AO, null, null, false, PLANT_TOP);
    b.quad([x + 1, y, z + k, x + 1, y + h, z + k, x, y + h, z + k, x, y, z + k], t, 0, 0.3, 1, PLANT_AO, null, null, false, PLANT_TOP);
  }
  b.flags = 0;
}

/** Minecraft torch: a 2x10 pixel stick, standing or tilted away from its wall. */
export function torchModel(b: MeshBuilder, x: number, y: number, z: number, dir: number, sky: number, blk: number, tex = 'torch'): void {
  const side = subRect(tex, 14, 10, 18, 32);
  const top = subRect(tex, 14, 10, 18, 14);
  const bottom = subRect(tex, 14, 28, 18, 32);
  const faces = [side, side, top, bottom, side, side];
  const half = 5.5 / 16;
  const w = 1 / 16;
  b.emit = 0.5;
  b.sky = sky;
  b.blk = blk;
  if (dir === DIR_DOWN || dir < 0 || dir > 3) {
    b.box([x + 0.5, y + half, z + 0.5], [w, 0, 0], [0, half, 0], [0, 0, w], faces);
  } else {
    const [dx, , dz] = DIRS[dir]!;
    const up = [-dx * 0.4, 1, -dz * 0.4];
    const ul = Math.hypot(up[0]!, up[1]!, up[2]!);
    const e2: Vec3 = [up[0]! / ul, up[1]! / ul, up[2]! / ul];
    const ref: Vec3 = dx !== 0 ? [0, 0, 1] : [1, 0, 0];
    const e1: Vec3 = [e2[1] * ref[2] - e2[2] * ref[1], e2[2] * ref[0] - e2[0] * ref[2], e2[0] * ref[1] - e2[1] * ref[0]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1;
    e1[0] /= l1;
    e1[1] /= l1;
    e1[2] /= l1;
    const e3: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const baseX = x + 0.5 + dx * 0.42;
    const baseZ = z + 0.5 + dz * 0.42;
    const baseY = y + 0.22;
    const c: Vec3 = [baseX + e2[0] * half, baseY + e2[1] * half, baseZ + e2[2] * half];
    b.box(c, [e1[0] * w, e1[1] * w, e1[2] * w], [e2[0] * half, e2[1] * half, e2[2] * half], [e3[0] * w, e3[1] * w, e3[2] * w], faces);
  }
  b.emit = 0;
}

/** Lantern: a small iron-framed lamp standing on the floor (meta 0) or hanging (meta 1). */
export function lanternModel(b: MeshBuilder, x: number, y: number, z: number, hanging: boolean, sky: number, blk: number): void {
  const side = tileRect('lantern');
  const top = tileRect('lantern_top');
  const y0 = hanging ? 0.25 : 0;
  const w = 3 / 16;
  const h = 4.5 / 16;
  b.sky = sky;
  b.blk = blk;
  b.emit = 0;
  b.box([x + 0.5, y + y0 + h, z + 0.5], [w, 0, 0], [0, h, 0], [0, 0, w], [side, side, top, top, side, side]);
  const cap = 2 / 16;
  b.box([x + 0.5, y + y0 + h * 2 + cap * 0.5, z + 0.5], [cap, 0, 0], [0, cap * 0.5, 0], [0, 0, cap], [top]);
  if (hanging) {
    const chain = tileRect('chain');
    const top0 = y + y0 + h * 2 + cap;
    const len = y + 1 - top0;
    b.box([x + 0.5, top0 + len / 2, z + 0.5], [0.04, 0, 0], [0, len / 2, 0], [0, 0, 0.04], [chain, chain, null, null, chain, chain]);
  }
}

function chainModel(b: MeshBuilder, g: Grid, x: number, y: number, z: number): void {
  const t = tileRect('chain');
  b.sky = g.skyAt(x, y, z) / 15;
  b.blk = g.blkAt(x, y, z) / 15;
  b.tint = WHITE;
  b.quad([x + 0.3, y, z + 0.3, x + 0.3, y + 1, z + 0.3, x + 0.7, y + 1, z + 0.7, x + 0.7, y, z + 0.7], t, 0.7, 0, -0.7);
  b.quad([x + 0.7, y, z + 0.3, x + 0.7, y + 1, z + 0.3, x + 0.3, y + 1, z + 0.7, x + 0.3, y, z + 0.7], t, 0.7, 0, 0.7);
}

/** Ship's wheel: eight spokes with brass handles on a post, the wheel facing along meta. */
function helmModel(b: MeshBuilder, g: Grid, x: number, y: number, z: number): void {
  const meta = g.metaAt(x, y, z) & 3;
  const wood = tileRect('planks_spruce');
  const brass = tileRect('brass');
  b.sky = g.skyAt(x, y, z) / 15;
  b.blk = g.blkAt(x, y, z) / 15;
  b.tint = WHITE;
  const [fx, , fz] = DIRS[meta]!;
  const axis: Vec3 = [fx, 0, fz];
  const side: Vec3 = [-fz, 0, fx];
  const c: Vec3 = [x + 0.5 + fx * 0.1, y + 1.0, z + 0.5 + fz * 0.1];
  b.box([x + 0.5, y + 0.45, z + 0.5], [0.1, 0, 0], [0, 0.45, 0], [0, 0, 0.1], [wood]);
  if (!helmWheels) return;
  const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
  for (let k = 0; k < 8; k += 1) {
    const a = (k * Math.PI) / 4;
    const d: Vec3 = [side[0] * Math.cos(a), Math.sin(a), side[2] * Math.cos(a)];
    const perp: Vec3 = [-side[0] * Math.sin(a), Math.cos(a), -side[2] * Math.sin(a)];
    b.box([c[0] + d[0] * 0.28, c[1] + d[1] * 0.28, c[2] + d[2] * 0.28], scale(d, 0.28), scale(axis, 0.035), scale(perp, 0.035), [wood]);
    b.box([c[0] + d[0] * 0.6, c[1] + d[1] * 0.6, c[2] + d[2] * 0.6], scale(d, 0.06), scale(axis, 0.045), scale(perp, 0.045), [brass]);
  }
  b.box(c, scale(side, 0.09), [0, 0.09, 0], scale(axis, 0.07), [brass]);
}

/** A lily pad: one leaf lying on the water surface below it (turned per cell), seen from both sides. */
function padCell(b: MeshBuilder, g: Grid, x: number, y: number, z: number, wx: number, wz: number): void {
  const t = tileRect('lily_pad');
  const turn = Math.floor(hash2(wx, wz, 61) * 4);
  // The water surface below sits 2px under the cell floor.
  const h = y - 0.1;
  const ring: Array<[number, number]> = [[0, 1], [0, 0], [1, 0], [1, 1]];
  for (let k = 0; k < turn; k += 1) ring.push(ring.shift()!);
  b.tint = foliageTint(wx, wz, B.LILY_PAD);
  b.sky = g.skyAt(x, y, z) / 15;
  b.blk = g.blkAt(x, y, z) / 15;
  for (let i = 0; i < 4; i += 1) {
    quadPos[i * 3] = x + ring[i]![0];
    quadPos[i * 3 + 1] = h;
    quadPos[i * 3 + 2] = z + ring[i]![1];
  }
  b.quad(quadPos, t, 0, 1, 0);
  const under = [quadPos[9]!, h, quadPos[11]!, quadPos[6]!, h, quadPos[8]!, quadPos[3]!, h, quadPos[5]!, quadPos[0]!, h, quadPos[2]!];
  b.quad(under, t, 0, -1, 0);
  b.tint = WHITE;
}

/** Translucent water: hidden against water and opaque blocks; the surface sits 2px low. */
function waterCell(b: MeshBuilder, g: Grid, x: number, y: number, z: number, wx: number, wz: number): void {
  const above = g.id(x, y + 1, z);
  const top = above === B.WATER || above === B.FALLING_WATER ? 1 : 14 / 16;
  const t = tileRect('water_still');
  b.flags = F_WATER;
  b.tint = lands?.blackWater(wx, wz) ? BLACK_WATER : swampy(wx, wz) ? SWAMP_WATER : WATER_TINT;
  for (let f = 0; f < 6; f += 1) {
    const face = FACES[f]!;
    const [nx, ny, nz] = face.n;
    const nb = g.id(x + nx, y + ny, z + nz);
    if (nb === B.WATER || nb === B.FALLING_WATER || OPAQUE[nb]) continue;
    b.sky = g.skyAt(x + nx, y + ny, z + nz) / 15;
    b.blk = g.blkAt(x + nx, y + ny, z + nz) / 15;
    if (f === 2 && b.sky === 0) b.sky = g.skyAt(x, y, z) / 15;
    for (let i = 0; i < 4; i += 1) {
      const c = face.corners[i]!;
      quadPos[i * 3] = x + c[0];
      quadPos[i * 3 + 1] = y + c[1] * top;
      quadPos[i * 3 + 2] = z + c[2];
    }
    b.quad(quadPos, t, nx, ny, nz);
    if (f === 2) {
      // The surface seen from below (swimming).
      const q = [quadPos[9]!, quadPos[10]!, quadPos[11]!, quadPos[6]!, quadPos[7]!, quadPos[8]!, quadPos[3]!, quadPos[4]!, quadPos[5]!, quadPos[0]!, quadPos[1]!, quadPos[2]!];
      b.quad(q, t, 0, -1, 0);
    }
  }
  b.flags = 0;
  b.tint = WHITE;
}

/** Waterfall curtain: front and back sheets of falling water, shifted so the stream reads as one. */
function fallsCell(b: MeshBuilder, g: Grid, x: number, y: number, z: number, wx: number, wz: number): void {
  const t = tileRect('water_flow');
  b.flags = F_WATER | F_FALLS;
  b.tint = [0.92, 0.98, 1];
  b.sky = Math.max(g.skyAt(x, y, z), 10) / 15;
  b.blk = g.blkAt(x, y, z) / 15;
  // Orientation: the sheet spans the axis along which neighbouring curtain cells sit.
  const alongX = g.id(x + 1, y, z) === B.FALLING_WATER || g.id(x - 1, y, z) === B.FALLING_WATER;
  const j = (hash2(wx, wz, 77) - 0.5) * 0.2;
  const v0 = (y % 4) / 4;
  const tr: TexRect = [t[0], v0, t[2], v0 + 0.25, t[4]];
  for (const off of [0.3 + j, 0.7 + j]) {
    if (alongX) {
      b.quad([x, y, z + off, x, y + 1, z + off, x + 1, y + 1, z + off, x + 1, y, z + off], tr, 0, 0, 1);
      b.quad([x + 1, y, z + off, x + 1, y + 1, z + off, x, y + 1, z + off, x, y, z + off], tr, 0, 0, -1);
    } else {
      b.quad([x + off, y, z + 1, x + off, y + 1, z + 1, x + off, y + 1, z, x + off, y, z], tr, 1, 0, 0);
      b.quad([x + off, y, z, x + off, y + 1, z, x + off, y + 1, z + 1, x + off, y, z + 1], tr, -1, 0, 0);
    }
  }
  b.flags = 0;
  b.tint = WHITE;
}

function cell(out: MeshOut, g: Grid, x: number, y: number, z: number, id: number, wx: number, wz: number): void {
  switch (SHAPE[id]) {
    case 1:
      cubeFaces(CUT[id] ? out.cutout : out.opaque, g, x, y, z, id, wx, wz);
      break;
    case 2:
      stairs(out.opaque, g, x, y, z, id);
      break;
    case 3:
      fence(out.opaque, g, x, y, z, id);
      break;
    case 4:
      flatQuad(out.cutout, g, x, y, z, g.metaAt(x, y, z), tileRect('ladder'), WHITE, 0);
      break;
    case 5:
      out.cutout.flags = F_LEAVES;
      flatQuad(out.cutout, g, x, y, z, g.metaAt(x, y, z), tileRect('vine'), foliageTint(wx, wz, B.LEAVES), 0, 0.92);
      out.cutout.flags = 0;
      break;
    case 6: {
      if (id === B.RAIL) {
        flatQuad(out.cutout, g, x, y, z, DIR_DOWN, tileRect('rail'), WHITE, 0, 0.97);
        break;
      }
      const d = wireDir(g, x, y, z);
      const powered = g.inside(x, y, z) && g.extra[g.i(x, y, z)] === 1;
      flatQuad(out.cutout, g, x, y, z, d, tileRect('redstone_wire'), powered ? WHITE : [0.45, 0.3, 0.3], powered ? 0.35 : 0, 0.97);
      break;
    }
    case 7:
      crossPlant(out.cutout, g, x, y, z, id, wx, wz);
      break;
    case 8:
      crop(out.cutout, g, x, y, z, id);
      break;
    case 9:
      torchModel(out.opaque, x, y, z, g.metaAt(x, y, z), g.skyAt(x, y, z) / 15, 1, id === B.REDSTONE_TORCH ? 'redstone_torch' : 'torch');
      break;
    case 10:
      lanternModel(out.opaque, x, y, z, g.metaAt(x, y, z) === 1, g.skyAt(x, y, z) / 15, 1);
      break;
    case 11:
      chainModel(out.cutout, g, x, y, z);
      break;
    case 12:
      waterCell(out.water, g, x, y, z, wx, wz);
      break;
    case 13:
      fallsCell(out.water, g, x, y, z, wx, wz);
      break;
    case 14:
      helmModel(out.opaque, g, x, y, z);
      break;
    case 15:
      padCell(out.cutout, g, x, y, z, wx, wz);
      break;
    case 16:
      slab(out.opaque, g, x, y, z, id);
      break;
    case 17:
      pane(out.cutout, g, x, y, z, id);
      break;
    case 18:
      shutter(out.opaque, g, x, y, z, id);
      break;
    case 19:
      wallPost(out.opaque, g, x, y, z, id);
      break;
    case 20:
      banner(out.cutout, g, x, y, z);
      break;
    case 21:
      planter(out, g, x, y, z, wx, wz);
      break;
    default:
      break;
  }
}

const sectionGrid = new Grid();

/** Meshes one 16^3 world section in world coordinates. */
export function meshSection(w: World, sx: number, sy: number, sz: number, out: MeshOut): void {
  lands = w.terrain;
  sectionGrid.fromWorld(w, sx, sy, sz);
  meshGrid(sectionGrid, out);
}

/** A section's copied cells (see copySection). */
export interface SectionCopy {
  ox: number;
  oy: number;
  oz: number;
  ids: Uint8Array;
  sky: Uint8Array;
  blk: Uint8Array;
  meta: Int8Array;
}

/** Cells in a section's grid with its border. */
export const SECTION_CELLS = 18 * 18 * 18;

/**
 * A world section copied out with its border (for the mesh worker: see mesh-worker.ts), into the
 * arrays given (they come back with the worker's reply, to be used again) or new ones.
 */
export function copySection(w: World, sx: number, sy: number, sz: number, into?: { ids: Uint8Array; sky: Uint8Array; blk: Uint8Array; meta: Int8Array }): SectionCopy {
  const g = sectionGrid;
  g.fromWorld(w, sx, sy, sz);
  const n = SECTION_CELLS;
  if (!into) return { ox: g.ox, oy: g.oy, oz: g.oz, ids: g.ids.slice(0, n), sky: g.sky.slice(0, n), blk: g.blk.slice(0, n), meta: g.meta.slice(0, n) };
  into.ids.set(g.ids.subarray(0, n));
  into.sky.set(g.sky.subarray(0, n));
  into.blk.set(g.blk.subarray(0, n));
  into.meta.set(g.meta.subarray(0, n));
  return { ox: g.ox, oy: g.oy, oz: g.oz, ids: into.ids, sky: into.sky, blk: into.blk, meta: into.meta };
}

/** Meshes a section copied out elsewhere (the worker's half of copySection). */
export function meshCopied(c: SectionCopy, out: MeshOut): void {
  const g = sectionGrid;
  g.ox = c.ox;
  g.oy = c.oy;
  g.oz = c.oz;
  g.resize(18, 18, 18);
  g.outsideSky = 15;
  g.ids.set(c.ids);
  g.sky.set(c.sky);
  g.blk.set(c.blk);
  g.meta.set(c.meta);
  meshGrid(g, out);
}

/** The cells of a world section's grid (with its border), as quads into the three meshes. */
function meshGrid(g: Grid, out: MeshOut): void {
  out.opaque.reset();
  out.cutout.reset();
  out.water.reset();
  const ids = g.ids;
  for (let ly = 1; ly <= 16; ly += 1) {
    const y = g.oy + ly;
    for (let lz = 1; lz <= 16; lz += 1) {
      const z = g.oz + lz;
      const row = 18 * (lz + 18 * ly);
      for (let lx = 1; lx <= 16; lx += 1) {
        const id = ids[row + lx]!;
        if (id === 0) continue;
        const x = g.ox + lx;
        cell(out, g, x, y, z, id, x, z);
      }
    }
  }
}

/** True when a section holds nothing but air (skips meshing work). */
export function sectionEmpty(w: World, sx: number, sy: number, sz: number): boolean {
  const c = w.chunk(sx, sz);
  if (!c) return true;
  const from = sy * 16 * 256;
  const to = from + 16 * 256;
  for (let i = from; i < to; i += 1) if (c.blocks[i] !== 0) return false;
  return true;
}

const bodyGrid = new Grid();

/** Meshes a body's cells in its local coordinates, lit by its own light field. */
export function meshBody(body: BlockBody, light: BodyLight, out: MeshOut): void {
  out.opaque.reset();
  out.cutout.reset();
  out.water.reset();
  const g = bodyGrid;
  g.fromBody(body, light);
  // The fortress's wheel turns as you steer: it is drawn live (dynamic.ts), only its post here.
  helmWheels = body.kind !== 'fortress';
  for (const k of body.cells.keys()) {
    const x = kx(k);
    const y = ky(k);
    const z = kz(k);
    cell(out, g, x, y, z, g.ids[g.i(x, y, z)]!, x, z);
  }
  helmWheels = true;
}

/** Whether helm cells mesh their wheel (off for the fortress, whose wheel spins). */
let helmWheels = true;
