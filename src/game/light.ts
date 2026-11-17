// Minecraft-style light engine over the chunked world: per-cell sky light (sunlight falling
// straight down, then spreading sideways) and block light (torches, lanterns, furnaces), both
// 0..15 with one level of falloff per step. A chunk is lit when it streams in (its own columns
// plus whatever flows across the seams from lit neighbours); edits re-propagate locally with
// the classic removal + refill passes, so mining a roof lets daylight pour back in.
import { blockDef } from './blocks';
import { kx, ky, kz, type BlockBody } from './body';
import { CHUNKS_X, CS, WX, WY, WZ, type Chunk, type World, sectionKey } from './world';

const OPACITY = new Uint8Array(256);
const EMISSION = new Uint8Array(256);
const EMITTERS: number[] = [];
for (let id = 0; id < 256; id += 1) {
  const def = blockDef(id);
  OPACITY[id] = def.lightOpacity;
  EMISSION[id] = def.light;
  if (id > 0 && def.light > 0) EMITTERS.push(id);
}

/** Growable FIFO of packed world cells, each with a light level. */
class Queue {
  keys = new Int32Array(1 << 15);
  levels = new Uint8Array(1 << 15);
  head = 0;
  tail = 0;

  reset(): void {
    this.head = 0;
    this.tail = 0;
  }

  get size(): number {
    return this.tail - this.head;
  }

  push(key: number, level = 0): void {
    if (this.tail === this.keys.length) {
      const live = this.tail - this.head;
      if (this.head > this.keys.length >> 1) {
        this.keys.copyWithin(0, this.head, this.tail);
        this.levels.copyWithin(0, this.head, this.tail);
      } else {
        const keys = new Int32Array(this.keys.length * 2);
        const levels = new Uint8Array(this.keys.length * 2);
        keys.set(this.keys.subarray(this.head, this.tail));
        levels.set(this.levels.subarray(this.head, this.tail));
        this.keys = keys;
        this.levels = levels;
      }
      this.head = 0;
      this.tail = live;
    }
    this.keys[this.tail] = key;
    this.levels[this.tail] = level;
    this.tail += 1;
  }
}

const addQ = new Queue();
const remQ = new Queue();

type Grid = 'sky' | 'blk';

/** Light entering a neighbour: straight-down sunlight keeps full strength through clear cells. */
function skyInto(level: number, down: boolean, op: number): number {
  if (down && level === 15) return op === 0 ? 15 : 15 - op;
  return level - 1 - op;
}

function key(x: number, y: number, z: number): number {
  return x | (z << 12) | (y << 24);
}

/** Records every section touched by a light change so it remeshes. */
function touch(w: World, x: number, y: number, z: number): void {
  w.markDirty(x, y, z);
}

/** Flood fills from the queued cells; changes outside `own` mark their meshes dirty. */
function spread(w: World, q: Queue, grid: Grid, own: Chunk | null): void {
  const chunks = w.chunks;
  const isSky = grid === 'sky';
  while (q.size > 0) {
    const k = q.keys[q.head]!;
    q.head += 1;
    const x = k & 4095;
    const z = (k >> 12) & 4095;
    const y = k >>> 24;
    const c = chunks[(z >> 4) * CHUNKS_X + (x >> 4)];
    if (!c) continue;
    const arr = isSky ? c.sky : c.blk;
    const level = arr[(x & 15) | ((z & 15) << 4) | (y << 8)]!;
    if (level <= 1) continue;
    for (let d = 0; d < 6; d += 1) {
      let nx = x;
      let ny = y;
      let nz = z;
      if (d === 0) nx += 1;
      else if (d === 1) nx -= 1;
      else if (d === 2) nz += 1;
      else if (d === 3) nz -= 1;
      else if (d === 4) ny += 1;
      else ny -= 1;
      if (nx < 0 || nz < 0 || ny < 0 || nx >= WX || nz >= WZ || ny >= WY) continue;
      const n = chunks[(nz >> 4) * CHUNKS_X + (nx >> 4)];
      if (!n) continue;
      const i = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
      const op = OPACITY[n.blocks[i]!]!;
      if (op >= 15) continue;
      const nl = isSky ? skyInto(level, d === 5, op) : level - 1 - op;
      const na = isSky ? n.sky : n.blk;
      if (nl > na[i]!) {
        na[i] = nl;
        if (n !== own) touch(w, nx, ny, nz);
        q.push(key(nx, ny, nz));
      }
    }
  }
}

/** Full light for a chunk that just streamed in, including light flowing in from neighbours. */
export function lightChunk(w: World, c: Chunk): void {
  const { blocks, sky, blk } = c;
  sky.fill(0);
  blk.fill(0);
  const x0 = c.cx * CS;
  const z0 = c.cz * CS;
  // Open-sky columns: full sunlight down to the first light-absorbing block. `low` is the
  // lowest sunlit y of each column (WY when even the top cell absorbs light).
  const low = new Int16Array(18 * 18);
  const lowAt = (lx: number, lz: number): number => low[(lz + 1) * 18 + lx + 1]!;
  for (let lz = -1; lz <= 16; lz += 1) {
    for (let lx = -1; lx <= 16; lx += 1) {
      const inside = lx >= 0 && lz >= 0 && lx < 16 && lz < 16;
      let y = WY - 1;
      if (inside) {
        for (; y >= 0; y -= 1) {
          const i = lx | (lz << 4) | (y << 8);
          if (OPACITY[blocks[i]!] !== 0) break;
          sky[i] = 15;
        }
      } else {
        const n = w.chunkAt(x0 + lx, z0 + lz);
        if (n) {
          const bx = (x0 + lx) & 15;
          const bz = (z0 + lz) & 15;
          for (; y >= 0; y -= 1) if (OPACITY[n.blocks[bx | (bz << 4) | (y << 8)]!] !== 0) break;
        } else {
          y = w.terrain.heightInt(x0 + lx, z0 + lz);
        }
      }
      low[(lz + 1) * 18 + lx + 1] = y + 1;
    }
  }
  addQ.reset();
  // Seed only where light can go: down into the absorbing block under each column, and
  // sideways into neighbouring columns whose sunlight stops higher up.
  for (let lz = 0; lz < 16; lz += 1) {
    for (let lx = 0; lx < 16; lx += 1) {
      const l = lowAt(lx, lz);
      if (l >= WY) continue;
      const high = Math.max(lowAt(lx - 1, lz), lowAt(lx + 1, lz), lowAt(lx, lz - 1), lowAt(lx, lz + 1));
      for (let y = l; y < high && y < WY; y += 1) addQ.push(key(x0 + lx, y, z0 + lz));
      if (l > 0 && high <= l) addQ.push(key(x0 + lx, l, z0 + lz));
    }
  }
  // Light already in lit neighbours flows across the seams.
  seedBorders(w, c, 'sky');
  spread(w, addQ, 'sky', c);
  addQ.reset();
  // Emitters are rare: find each kind with a native scan instead of visiting every cell.
  for (const id of EMITTERS) {
    for (let i = blocks.indexOf(id); i >= 0; i = blocks.indexOf(id, i + 1)) {
      blk[i] = EMISSION[id]!;
      addQ.push(key(x0 + (i & 15), i >> 8, z0 + ((i >> 4) & 15)));
    }
  }
  seedBorders(w, c, 'blk');
  spread(w, addQ, 'blk', c);
}

function seedBorders(w: World, c: Chunk, grid: Grid): void {
  const sides: Array<[number, number, number, number]> = [
    // neighbour chunk offset, then the column offset of its border layer
    [-1, 0, 15, -1],
    [1, 0, 0, -1],
    [0, -1, -1, 15],
    [0, 1, -1, 0],
  ];
  const own = grid === 'sky' ? c.sky : c.blk;
  for (const [dcx, dcz, bx, bz] of sides) {
    const n = w.chunk(c.cx + dcx, c.cz + dcz);
    if (!n || !n.lit) continue;
    const arr = grid === 'sky' ? n.sky : n.blk;
    for (let t = 0; t < 16; t += 1) {
      const lx = bx >= 0 ? bx : t;
      const lz = bz >= 0 ? bz : t;
      // (The cell just across the seam, in this chunk.)
      const ax = bx >= 0 ? 15 - bx : t;
      const az = bz >= 0 ? 15 - bz : t;
      const wx = (c.cx + dcx) * CS + lx;
      const wz = (c.cz + dcz) * CS + lz;
      for (let y = 0; y < WY; y += 1) {
        const v = arr[lx | (lz << 4) | (y << 8)]!;
        // Light that cannot brighten the cell across the seam would flow nowhere new (open sky on
        // both sides, most of a border): it is not queued at all.
        if (v > 1 && own[ax | (az << 4) | (y << 8)]! < v - 1) addQ.push(key(wx, y, wz));
      }
    }
  }
}

function forNeighbours(k: number, fn: (n: number, down: boolean) => void): void {
  const x = k & 4095;
  const z = (k >> 12) & 4095;
  const y = k >>> 24;
  if (x > 0) fn(key(x - 1, y, z), false);
  if (x < WX - 1) fn(key(x + 1, y, z), false);
  if (z > 0) fn(key(x, y, z - 1), false);
  if (z < WZ - 1) fn(key(x, y, z + 1), false);
  if (y < WY - 1) fn(key(x, y + 1, z), false);
  if (y > 0) fn(key(x, y - 1, z), true);
}

function cellChunk(w: World, k: number): Chunk | null {
  return w.chunks[(((k >> 12) & 4095) >> 4) * CHUNKS_X + ((k & 4095) >> 4)] ?? null;
}

function idx(k: number): number {
  return (k & 15) | (((k >> 12) & 15) << 4) | ((k >>> 24) << 8);
}

function getL(w: World, k: number, grid: Grid): number {
  const c = cellChunk(w, k);
  if (!c) return 0;
  return (grid === 'sky' ? c.sky : c.blk)[idx(k)]!;
}

function setL(w: World, k: number, grid: Grid, v: number): void {
  const c = cellChunk(w, k);
  if (!c) return;
  (grid === 'sky' ? c.sky : c.blk)[idx(k)] = v;
  touch(w, k & 4095, k >>> 24, (k >> 12) & 4095);
}

function blockOf(w: World, k: number): number {
  const c = cellChunk(w, k);
  if (!c) return 0;
  return c.blocks[idx(k)]!;
}

/** Re-propagates light around a changed cell. */
export function relightCell(w: World, x: number, y: number, z: number): void {
  const k0 = key(x, y, z);
  const id = blockOf(w, k0);
  const clear = OPACITY[id]! < 15;

  // ---- sky light: remove what flowed through this cell, then refill from the boundary.
  remQ.reset();
  addQ.reset();
  const oldSky = getL(w, k0, 'sky');
  if (oldSky > 0) {
    setL(w, k0, 'sky', 0);
    remQ.push(k0, oldSky);
  }
  while (remQ.size > 0) {
    const k = remQ.keys[remQ.head]!;
    const level = remQ.levels[remQ.head]!;
    remQ.head += 1;
    forNeighbours(k, (n, down) => {
      const nl = getL(w, n, 'sky');
      if (nl === 0) return;
      if (nl < level || (down && level === 15 && nl === 15)) {
        setL(w, n, 'sky', 0);
        remQ.push(n, nl);
      } else {
        addQ.push(n);
      }
    });
  }
  if (clear) {
    if (y === WY - 1 && OPACITY[id] === 0) {
      setL(w, k0, 'sky', 15);
      addQ.push(k0);
    }
    forNeighbours(k0, (n) => {
      if (getL(w, n, 'sky') > 0) addQ.push(n);
    });
  }
  spread(w, addQ, 'sky', null);

  // ---- block light: same, with emitters re-seeded after the removal pass.
  remQ.reset();
  addQ.reset();
  const reseed: number[] = [];
  const oldBlock = getL(w, k0, 'blk');
  if (oldBlock > 0) {
    setL(w, k0, 'blk', 0);
    remQ.push(k0, oldBlock);
  }
  while (remQ.size > 0) {
    const k = remQ.keys[remQ.head]!;
    const level = remQ.levels[remQ.head]!;
    remQ.head += 1;
    forNeighbours(k, (n) => {
      const nl = getL(w, n, 'blk');
      if (nl === 0) return;
      if (nl < level) {
        setL(w, n, 'blk', 0);
        remQ.push(n, nl);
        if (EMISSION[blockOf(w, n)]! > 0) reseed.push(n);
      } else {
        addQ.push(n);
      }
    });
  }
  for (const n of reseed) {
    setL(w, n, 'blk', EMISSION[blockOf(w, n)]!);
    addQ.push(n);
  }
  const e = EMISSION[id]!;
  if (e > 0) {
    setL(w, k0, 'blk', e);
    addQ.push(k0);
  }
  if (clear) {
    forNeighbours(k0, (n) => {
      if (getL(w, n, 'blk') > 0) addQ.push(n);
    });
  }
  spread(w, addQ, 'blk', null);
}

export const chunkLighting = {
  light: lightChunk,
  relight: relightCell,
};

/** Section keys are re-exported for callers that track light-only changes. */
export { sectionKey };

// ------------------------------------------------------------------ moving bodies

/** Light inside a fortress or giant, in its own grid (outside the box is open daylight). */
export interface BodyLight {
  version: number;
  ox: number;
  oy: number;
  oz: number;
  sx: number;
  sy: number;
  sz: number;
  sky: Uint8Array;
  blk: Uint8Array;
}

export function computeBodyLight(body: BlockBody): BodyLight {
  const ox = body.minX - 1;
  const oy = body.minY - 1;
  const oz = body.minZ - 1;
  const sx = body.maxX - body.minX + 3;
  const sy = body.maxY - body.minY + 3;
  const sz = body.maxZ - body.minZ + 3;
  const n = sx * sy * sz;
  const op = new Uint8Array(n);
  const emit = new Uint8Array(n);
  const at = (x: number, y: number, z: number): number => x + sx * (z + sz * y);
  for (const [k, cell] of body.cells) {
    const i = at(kx(k) - ox, ky(k) - oy, kz(k) - oz);
    op[i] = OPACITY[cell.id]!;
    emit[i] = EMISSION[cell.id]!;
  }
  const sky = new Uint8Array(n);
  const blk = new Uint8Array(n);
  const queue: number[] = [];
  for (let z = 0; z < sz; z += 1) {
    for (let x = 0; x < sx; x += 1) {
      for (let y = sy - 1; y >= 0; y -= 1) {
        const i = at(x, y, z);
        if (op[i] !== 0) break;
        sky[i] = 15;
        queue.push(i);
      }
    }
  }
  const run = (grid: Uint8Array, isSky: boolean): void => {
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head]!;
      const level = grid[i]!;
      if (level <= 1) continue;
      const x = i % sx;
      const z = ((i / sx) | 0) % sz;
      const y = (i / (sx * sz)) | 0;
      const go = (nx: number, ny: number, nz: number, down: boolean): void => {
        if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) return;
        const j = at(nx, ny, nz);
        const o = op[j]!;
        if (o >= 15) return;
        const nl = isSky ? skyInto(level, down, o) : level - 1 - o;
        if (nl > grid[j]!) {
          grid[j] = nl;
          queue.push(j);
        }
      };
      go(x - 1, y, z, false);
      go(x + 1, y, z, false);
      go(x, y, z - 1, false);
      go(x, y, z + 1, false);
      go(x, y + 1, z, false);
      go(x, y - 1, z, true);
    }
  };
  run(sky, true);
  queue.length = 0;
  for (let i = 0; i < n; i += 1) {
    if (emit[i]! > 0) {
      blk[i] = emit[i]!;
      queue.push(i);
    }
  }
  run(blk, false);
  return { version: body.version, ox, oy, oz, sx, sy, sz, sky, blk };
}

/** Sky and block light (0..15) at a body-local cell. */
export function bodyLightAt(L: BodyLight, x: number, y: number, z: number): [number, number] {
  const lx = x - L.ox;
  const ly = y - L.oy;
  const lz = z - L.oz;
  if (lx < 0 || ly < 0 || lz < 0 || lx >= L.sx || ly >= L.sy || lz >= L.sz) return [15, 0];
  const i = lx + L.sx * (lz + L.sz * ly);
  return [L.sky[i]!, L.blk[i]!];
}
