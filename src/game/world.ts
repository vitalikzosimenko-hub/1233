// The open world: 96x96 chunks of 16x16x128 cells, generated lazily around the player and
// the fortress and dropped again when far away. Player edits are kept as per-chunk diffs, so
// an unloaded chunk regenerates exactly as it was left.
import { B, blockDef } from './blocks';
import type { Loot, Structure, StructureIndex } from './structures';
import { CHUNKS_X, CHUNKS_Z, CS, SEA, WX, WY, WZ, type Terrain } from './terrain';

export { CHUNKS_X, CHUNKS_Z, CS, SEA, WX, WY, WZ };

/** Cells per chunk layer (y stride inside a chunk). */
export const LAYER = CS * CS;
export const CHUNK_CELLS = LAYER * WY;
/** Mesh sections per chunk column (16 tall each). */
export const SECTIONS = WY / 16;

/** Ladder/torch/stairs attachment: DIRS index of the neighbour a block leans on or faces. */
export const DIRS: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
export const DIR_UP = 4;
export const DIR_DOWN = 5;

const SOLID = new Uint8Array(256);
const CLIMB = new Uint8Array(256);
const LIQUID = new Uint8Array(256);
const CROSS = new Uint8Array(256);
for (let id = 0; id < 256; id += 1) {
  const def = blockDef(id);
  SOLID[id] = def.solid ? 1 : 0;
  CLIMB[id] = def.climbable ? 1 : 0;
  LIQUID[id] = id === B.WATER || id === B.FALLING_WATER ? 1 : 0;
  CROSS[id] = def.shape === 'cross' || def.shape === 'crop' ? 1 : 0;
}
export { SOLID };

export function chunkIndex(cx: number, cz: number): number {
  return cz * CHUNKS_X + cx;
}

/** Packed world cell key: x 12 bits, z 12 bits, y 7 bits. */
export function cellKey(x: number, y: number, z: number): number {
  return x | (z << 12) | (y << 24);
}

export function keyX(k: number): number {
  return k & 4095;
}

export function keyZ(k: number): number {
  return (k >> 12) & 4095;
}

export function keyY(k: number): number {
  return k >>> 24;
}

/** A cell key saved by an older version (x 11 bits, z 11 bits, y 7 bits) in today's packing. */
export function cellKeyV1(k: number): number {
  return cellKey(k & 2047, k >>> 22, (k >> 11) & 2047);
}

export function sectionKey(cx: number, sy: number, cz: number): number {
  return cx | (cz << 8) | (sy << 15);
}

export function local(x: number, y: number, z: number): number {
  return (x & 15) | ((z & 15) << 4) | (y << 8);
}

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks = new Uint8Array(CHUNK_CELLS);
  readonly sky = new Uint8Array(CHUNK_CELLS);
  readonly blk = new Uint8Array(CHUNK_CELLS);
  /** Attachment / facing per cell (local index), only for the few blocks that need one. */
  readonly meta = new Map<number, number>();
  /** Highest solid y per column, or -1. */
  readonly top = new Int16Array(LAYER);
  /** Natural ground height per column as generated (leg footing, map, mobs). */
  readonly ground = new Int16Array(LAYER);
  lit = false;
  /** Frame counter of the last time this chunk was wanted (for unloading). */
  touched = 0;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
  }

  recomputeTop(lx: number, lz: number): void {
    const col = lx | (lz << 4);
    let y = WY - 1;
    while (y >= 0 && !SOLID[this.blocks[col | (y << 8)]!]) y -= 1;
    this.top[col] = y;
  }
}

export type ChunkGenerator = (w: World, cx: number, cz: number) => Chunk;

export interface Lighting {
  light(w: World, c: Chunk): void;
  relight(w: World, x: number, y: number, z: number): void;
}

export class World {
  readonly terrain: Terrain;
  readonly structures: StructureIndex;
  readonly chunks: Array<Chunk | null> = new Array<Chunk | null>(CHUNKS_X * CHUNKS_Z).fill(null);
  loaded = 0;
  /** Player changes per chunk: local index -> id | ((meta + 1) << 8). */
  readonly edits = new Map<number, Map<number, number>>();
  readonly lootedChests = new Set<number>();
  readonly chestLoot = new Map<number, Loot>();
  /** Structures removed from the world (hoisted onto the fortress). */
  readonly hoisted = new Set<string>();
  /** Mesh sections that must be rebuilt. */
  readonly dirty = new Set<number>();
  /** Chunks dropped since the renderer last looked (their meshes can go). */
  readonly dropped = new Set<number>();
  generator: ChunkGenerator;
  lighting: Lighting;
  frame = 0;
  /** Background generation (a Web Worker), when available. */
  private worker: Worker | null = null;
  /** How many hoisted ids the worker was last told of. */
  private hoistedSent = -1;
  private readonly requested = new Set<number>();
  private readonly arrived = new Map<number, Chunk>();
  /** Finishes a chunk that arrived from the worker (replays edits). */
  finisher: ((c: Chunk) => Chunk) | null = null;
  /** Called after a cell changes through set(). */
  onChange: ((x: number, y: number, z: number, before: number, after: number) => void) | null = null;

  constructor(terrain: Terrain, structures: StructureIndex, generator: ChunkGenerator, lighting: Lighting) {
    this.terrain = terrain;
    this.structures = structures;
    this.generator = generator;
    this.lighting = lighting;
    for (const s of structures.all) for (const chest of s.chests) this.chestLoot.set(cellKey(chest.x, chest.y, chest.z), chest.loot);
  }

  // ---------------------------------------------------------------- chunks

  chunk(cx: number, cz: number): Chunk | null {
    if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) return null;
    return this.chunks[cz * CHUNKS_X + cx]!;
  }

  chunkAt(x: number, z: number): Chunk | null {
    if (x < 0 || z < 0 || x >= WX || z >= WZ) return null;
    return this.chunks[(z >> 4) * CHUNKS_X + (x >> 4)]!;
  }

  /** Starts background generation (falls back to the main thread if workers fail). */
  useWorker(worker: Worker, seed: number, version: number): void {
    this.worker = worker;
    this.hoistedSent = -1;
    worker.onmessage = (e: MessageEvent<{ type: string; cx: number; cz: number; blocks: Uint8Array; ground: Int16Array; top: Int16Array; meta: Int32Array }>) => {
      const m = e.data;
      if (m.type !== 'chunk') return;
      const i = m.cz * CHUNKS_X + m.cx;
      this.requested.delete(i);
      if (this.chunks[i]) return;
      const c = new Chunk(m.cx, m.cz);
      c.blocks.set(m.blocks);
      c.ground.set(m.ground);
      c.top.set(m.top);
      for (let k = 0; k < m.meta.length; k += 2) c.meta.set(m.meta[k]!, m.meta[k + 1]!);
      this.arrived.set(i, this.finisher ? this.finisher(c) : c);
    };
    worker.onerror = () => {
      // Generation simply continues on the main thread.
      this.worker = null;
      this.requested.clear();
    };
    worker.postMessage({ type: 'init', seed, version });
  }

  /** Asks the worker for a chunk (no-op without one, or when already loaded or pending). */
  request(cx: number, cz: number): boolean {
    if (!this.worker || cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) return false;
    const i = cz * CHUNKS_X + cx;
    if (this.chunks[i] || this.arrived.has(i)) return true;
    if (this.requested.has(i)) return true;
    this.requested.add(i);
    // (The hoisted list only grows: it goes along only when it has, not with every chunk.)
    const fresh = this.hoisted.size !== this.hoistedSent;
    this.hoistedSent = this.hoisted.size;
    this.worker.postMessage(fresh ? { type: 'gen', cx, cz, hoisted: [...this.hoisted] } : { type: 'gen', cx, cz });
    return true;
  }

  /** Whether a chunk is loaded or has arrived from the worker. */
  available(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) return true;
    const i = cz * CHUNKS_X + cx;
    return Boolean(this.chunks[i]) || this.arrived.has(i);
  }

  /** Generates (without lighting) a chunk if it is not loaded yet. */
  generate(cx: number, cz: number): Chunk | null {
    if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) return null;
    const i = cz * CHUNKS_X + cx;
    let c = this.chunks[i]!;
    if (!c) {
      const ready = this.arrived.get(i);
      if (ready) this.arrived.delete(i);
      c = ready ?? this.generator(this, cx, cz);
      this.chunks[i] = c;
      this.loaded += 1;
      this.dropped.delete(i);
    }
    c.touched = this.frame;
    return c;
  }

  /** A chunk generated and lit (lights it, generating first if needed). */
  ensure(cx: number, cz: number): Chunk | null {
    const c = this.generate(cx, cz);
    if (c && !c.lit) {
      this.lighting.light(this, c);
      c.lit = true;
      // Neighbours that are already meshed must pick up light and faces along the seam.
      for (let sy = 0; sy < SECTIONS; sy += 1) {
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = this.chunk(cx + dx, cz + dz);
          if (n) this.dirty.add(sectionKey(cx + dx, sy, cz + dz));
        }
      }
    }
    return c;
  }

  /** Every chunk in the square around (cx, cz) generated and lit. */
  ready(cx: number, cz: number, r: number): boolean {
    for (let z = cz - r; z <= cz + r; z += 1) {
      for (let x = cx - r; x <= cx + r; x += 1) {
        if (x < 0 || z < 0 || x >= CHUNKS_X || z >= CHUNKS_Z) continue;
        const c = this.chunks[z * CHUNKS_X + x];
        if (!c || !c.lit) return false;
      }
    }
    return true;
  }

  /**
   * Streams chunks in around the given centres, nearest first, within a time budget; drops
   * the farthest ones beyond `keep` chunks when too many are loaded.
   */
  stream(centres: Array<{ x: number; z: number; r: number }>, budgetMs: number, keep: number, maxLoaded: number): number {
    this.frame += 1;
    const start = performance.now();
    const todo: Array<{ cx: number; cz: number; d: number }> = [];
    for (const c of centres) {
      const ccx = Math.floor(c.x / CS);
      const ccz = Math.floor(c.z / CS);
      const r = c.r;
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
          const cx = ccx + dx;
          const cz = ccz + dz;
          if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) continue;
          const ch = this.chunks[cz * CHUNKS_X + cx];
          if (ch) {
            ch.touched = this.frame;
            if (ch.lit) continue;
          }
          todo.push({ cx, cz, d: dx * dx + dz * dz });
        }
      }
    }
    todo.sort((a, b) => a.d - b.d);
    let done = 0;
    for (const t of todo) {
      // Light needs the neighbours' blocks: with a worker, wait until the ring has arrived.
      if (this.worker && budgetMs < 1e8) {
        let waiting = false;
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (!this.available(t.cx + dx, t.cz + dz)) {
            this.request(t.cx + dx, t.cz + dz);
            waiting = true;
          }
        }
        if (waiting) continue;
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) this.generate(t.cx + dx, t.cz + dz);
      this.ensure(t.cx, t.cz);
      done += 1;
      if (performance.now() - start > budgetMs) break;
    }
    if (this.loaded > maxLoaded) this.unloadFar(centres, keep, Math.floor(maxLoaded * 0.8));
    return todo.length - done;
  }

  private unloadFar(centres: Array<{ x: number; z: number; r: number }>, keep: number, target: number): void {
    const far: Array<{ i: number; d: number }> = [];
    for (let i = 0; i < this.chunks.length; i += 1) {
      const c = this.chunks[i];
      if (!c) continue;
      let d = Infinity;
      for (const p of centres) d = Math.min(d, Math.max(Math.abs(c.cx * CS + 8 - p.x), Math.abs(c.cz * CS + 8 - p.z)) / CS - p.r);
      if (d > keep) far.push({ i, d });
    }
    far.sort((a, b) => b.d - a.d);
    for (const f of far) {
      if (this.loaded <= target) break;
      this.chunks[f.i] = null;
      this.loaded -= 1;
      this.dropped.add(f.i);
    }
    // Worker results nobody waited for.
    if (this.arrived.size > 64) this.arrived.clear();
  }

  // ---------------------------------------------------------------- cells

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < WX && y < WY && z < WZ;
  }

  /** Outside the map counts as bedrock (an invisible wall), above it as air. */
  get(x: number, y: number, z: number): number {
    if (y >= WY) return B.AIR;
    if (y < 0 || x < 0 || z < 0 || x >= WX || z >= WZ) return B.BEDROCK;
    const c = this.chunks[(z >> 4) * CHUNKS_X + (x >> 4)];
    if (!c) return this.virtual(x, y, z);
    return c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)]!;
  }

  /** Stand-in for a chunk that is not loaded: plain terrain from the height function. */
  virtual(x: number, y: number, z: number): number {
    const h = this.terrain.heightInt(x, z);
    if (y <= h) return B.STONE;
    return y <= SEA - 1 ? B.WATER : B.AIR;
  }

  getMeta(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c || y < 0 || y >= WY) return 0;
    return c.meta.get(local(x, y, z)) ?? 0;
  }

  solid(x: number, y: number, z: number): boolean {
    return SOLID[this.get(x, y, z)] === 1;
  }

  liquid(x: number, y: number, z: number): boolean {
    return LIQUID[this.get(x, y, z)] === 1;
  }

  climbable(x: number, y: number, z: number): boolean {
    return CLIMB[this.get(x, y, z)] === 1;
  }

  skyAt(x: number, y: number, z: number): number {
    if (y >= WY) return 15;
    if (y < 0) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return y > this.terrain.heightInt(x, z) ? 15 : 0;
    return c.sky[local(x, y, z)]!;
  }

  blockLightAt(x: number, y: number, z: number): number {
    if (y < 0 || y >= WY) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.blk[local(x, y, z)]!;
  }

  /** y of the highest solid block in a column (current state), or -1. */
  topAt(x: number, z: number): number {
    const c = this.chunkAt(Math.floor(x), Math.floor(z));
    if (!c) return this.terrain.heightInt(Math.floor(x), Math.floor(z));
    return c.top[(Math.floor(x) & 15) | ((Math.floor(z) & 15) << 4)]!;
  }

  /** Standing height on top of the highest solid block of a column. */
  groundAt(x: number, z: number): number {
    return this.topAt(x, z) + 1;
  }

  /** Natural ground (as generated) of a column. */
  naturalGround(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const c = this.chunkAt(ix, iz);
    if (!c) return this.terrain.heightInt(ix, iz) + 1;
    return c.ground[(ix & 15) | ((iz & 15) << 4)]! + 1;
  }

  /** Writes a cell during generation: no edits, light or meshes. */
  raw(c: Chunk, lx: number, y: number, lz: number, id: number, meta = -1): void {
    if (y < 0 || y >= WY) return;
    const i = lx | (lz << 4) | (y << 8);
    c.blocks[i] = id;
    if (meta >= 0) c.meta.set(i, meta);
    else if (c.meta.size > 0) c.meta.delete(i);
  }

  /** Changes a cell as gameplay: recorded, relit and remeshed. */
  set(x: number, y: number, z: number, id: number, meta = -1): void {
    if (!this.inBounds(x, y, z)) return;
    let c = this.chunkAt(x, z);
    if (!c) c = this.ensure(x >> 4, z >> 4);
    if (!c) return;
    const i = local(x, y, z);
    const before = c.blocks[i]!;
    const beforeMeta = c.meta.get(i) ?? -1;
    if (before === id && meta === beforeMeta) return;
    c.blocks[i] = id;
    if (meta >= 0) c.meta.set(i, meta);
    else c.meta.delete(i);
    const ci = chunkIndex(c.cx, c.cz);
    let diff = this.edits.get(ci);
    if (!diff) {
      diff = new Map();
      this.edits.set(ci, diff);
    }
    diff.set(i, id | ((meta + 1) << 8));
    const col = (x & 15) | ((z & 15) << 4);
    if (SOLID[id] && y > c.top[col]!) c.top[col] = y;
    else if (!SOLID[id] && y === c.top[col]) c.recomputeTop(x & 15, z & 15);
    this.markDirty(x, y, z);
    if (c.lit) this.lighting.relight(this, x, y, z);
    if (id !== before && !SOLID[id]) this.popUnsupported(x, y, z);
    this.onChange?.(x, y, z, before, id);
  }

  /** A cell changed in another game (a co-op host's): applied now if its chunk is here, else when it loads. */
  setRemote(x: number, y: number, z: number, id: number, meta = -1): void {
    if (!this.inBounds(x, y, z)) return;
    if (this.chunkAt(x, z)) {
      this.set(x, y, z, id, meta);
      return;
    }
    const ci = chunkIndex(x >> 4, z >> 4);
    let diff = this.edits.get(ci);
    if (!diff) {
      diff = new Map();
      this.edits.set(ci, diff);
    }
    diff.set(local(x, y, z), id | ((meta + 1) << 8));
  }

  /** Another game's edits as [chunk, cell, value] triples (see `edits`). */
  setRemoteEdits(flat: readonly number[]): void {
    for (let i = 0; i + 2 < flat.length; i += 3) {
      const ci = flat[i]!;
      const li = flat[i + 1]!;
      const v = flat[i + 2]!;
      const x = (ci % CHUNKS_X) * 16 + (li & 15);
      const z = Math.floor(ci / CHUNKS_X) * 16 + ((li >> 4) & 15);
      this.setRemote(x, li >> 8, z, v & 255, (v >> 8) - 1);
    }
  }

  /** Plants on top of, and torches or lanterns attached to, a block that just disappeared fall off. */
  private popUnsupported(x: number, y: number, z: number): void {
    const above = this.get(x, y + 1, z);
    if (CROSS[above]) this.set(x, y + 1, z, B.AIR);
    if (above === B.LANTERN && this.getMeta(x, y + 1, z) === 0) this.set(x, y + 1, z, B.AIR);
    const below = this.get(x, y - 1, z);
    if (below === B.LANTERN && this.getMeta(x, y - 1, z) === 1) this.set(x, y - 1, z, B.AIR);
    if (below === B.CHAIN) this.set(x, y - 1, z, B.AIR);
    for (let d = 0; d < DIRS.length; d += 1) {
      const [dx, dy, dz] = DIRS[d]!;
      const tx = x - dx;
      const ty = y - dy;
      const tz = z - dz;
      const t = this.get(tx, ty, tz);
      if ((t === B.TORCH || t === B.REDSTONE_TORCH || t === B.LADDER || t === B.VINE) && this.getMeta(tx, ty, tz) === d) this.set(tx, ty, tz, B.AIR);
    }
  }

  /** Sections whose meshes (faces, ambient occlusion or smooth light) depend on this cell. */
  markDirty(x: number, y: number, z: number): void {
    const x0 = Math.max(0, x - 1) >> 4;
    const x1 = Math.min(WX - 1, x + 1) >> 4;
    const y0 = Math.max(0, y - 1) >> 4;
    const y1 = Math.min(WY - 1, y + 1) >> 4;
    const z0 = Math.max(0, z - 1) >> 4;
    const z1 = Math.min(WZ - 1, z + 1) >> 4;
    for (let sy = y0; sy <= y1; sy += 1) for (let sz = z0; sz <= z1; sz += 1) for (let sx = x0; sx <= x1; sx += 1) this.dirty.add(sectionKey(sx, sy, sz));
  }

  /** Re-applies the recorded edits of a freshly generated chunk. */
  applyEdits(c: Chunk): void {
    const diff = this.edits.get(chunkIndex(c.cx, c.cz));
    if (!diff) return;
    for (const [i, v] of diff) {
      c.blocks[i] = v & 255;
      const meta = (v >> 8) - 1;
      if (meta >= 0) c.meta.set(i, meta);
      else c.meta.delete(i);
    }
  }

  // ---------------------------------------------------------------- chests & structures

  lootAt(x: number, y: number, z: number): Loot {
    const key = cellKey(x, y, z);
    if (this.lootedChests.has(key)) return [];
    return this.chestLoot.get(key) ?? [];
  }

  markLooted(x: number, y: number, z: number): void {
    this.lootedChests.add(cellKey(x, y, z));
  }

  chestKey(x: number, y: number, z: number): number {
    return cellKey(x, y, z);
  }

  /**
   * Takes a structure out of the loaded world at once (a Heart Seal shattering): its cells go
   * where they still stand, without being recorded as edits (the generator skips it from now on,
   * once its id is in `hoisted`). Its blocks must neither give nor block light.
   */
  clearStructure(s: Structure): void {
    const cols = new Set<number>();
    for (let i = 0; i < s.count; i += 1) {
      const x = s.xs[i]!;
      const y = s.ys[i]!;
      const z = s.zs[i]!;
      const c = this.chunkAt(x, z);
      if (!c || y < 0 || y >= WY) continue;
      const li = local(x, y, z);
      if (c.blocks[li] !== s.ids[i]) continue;
      c.blocks[li] = B.AIR;
      cols.add(cellKey(x, 0, z));
      this.markDirty(x, y, z);
    }
    for (const k of cols) this.chunkAt(keyX(k), keyZ(k))?.recomputeTop(keyX(k) & 15, keyZ(k) & 15);
  }

  /** Structures overlapping a chunk that still stand in the world. */
  structuresIn(cx: number, cz: number): Structure[] {
    return (this.structures.byChunk.get(chunkIndex(cx, cz)) ?? []).filter((s) => !this.hoisted.has(s.id));
  }

  /** The standing structure containing a world cell, if any. */
  structureAt(x: number, y: number, z: number): Structure | null {
    if (x < 0 || z < 0 || x >= WX || z >= WZ) return null;
    for (const s of this.structuresIn(x >> 4, z >> 4)) {
      if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY || z < s.minZ || z > s.maxZ) continue;
      return s;
    }
    return null;
  }
}
