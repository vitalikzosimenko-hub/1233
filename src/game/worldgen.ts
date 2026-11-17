// Chunk generator for the open world. Everything is a pure function of the seed and the
// chunk position, so chunks can be dropped and regenerated at will (player edits are
// replayed on top from World.edits).
import { B, blockDef } from './blocks';
import { detail, groundOf, rnd, rockAt, strataOf, type Col } from './ground';
import { hash2, mulberry32 } from './rng';
import type { Structure } from './structures';
import type { Terrain } from './terrain';
import { Chunk, chunkIndex, CS, LAYER, SEA, WY, type World } from './world';

const PAD = 5;
const SPAN = CS + PAD * 2;

const NATURAL = new Uint8Array(256);
for (let id = 0; id < 256; id += 1) {
  const def = blockDef(id);
  NATURAL[id] = def.terrain || def.shape === 'cross' || def.shape === 'pad' || id === B.LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES
    || id === B.SWAMP_LEAVES || id === B.LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG || id === B.CHARRED_LOG || id === B.VINE
    || id === B.WATER || id === B.FALLING_WATER || id === B.SUGAR_CANE || id === B.LAVA ? 1 : 0;
}

/** What chunk generation needs: the pure terrain and the buildings still standing. */
export interface GenSource {
  terrain: Terrain;
  structures: World['structures'];
  structuresIn(cx: number, cz: number): Structure[];
}

/** Natural chunk content (terrain, plants, buildings) without any player edits. */
export function generateRaw(w: GenSource, cx: number, cz: number): Chunk {
  const T = w.terrain;
  const D = detail(T);
  const c = new Chunk(cx, cz);
  const x0 = cx * CS;
  const z0 = cz * CS;

  // ---- heights for the padded area (trees reach across chunk seams)
  const H = new Int16Array(SPAN * SPAN);
  for (let pz = 0; pz < SPAN; pz += 1) {
    for (let px = 0; px < SPAN; px += 1) H[pz * SPAN + px] = T.heightInt(x0 + px - PAD, z0 + pz - PAD);
  }
  const hAt = (lx: number, lz: number): number => H[(lz + PAD) * SPAN + lx + PAD]!;
  const cols: Col[] = new Array(SPAN * SPAN);
  for (let pz = 1; pz < SPAN - 1; pz += 1) {
    for (let px = 1; px < SPAN - 1; px += 1) {
      const h = H[pz * SPAN + px]!;
      let slope = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) slope = Math.max(slope, Math.abs(h - H[(pz + dz) * SPAN + px + dx]!));
      const info = T.column(x0 + px - PAD, z0 + pz - PAD, h, slope);
      cols[pz * SPAN + px] = { h, slope, biome: info.biome, zone: info.zone, trees: info.trees, mountain: info.mountain };
    }
  }
  const colAt = (lx: number, lz: number): Col => cols[(lz + PAD) * SPAN + lx + PAD]!;

  // ---- terrain columns
  for (let lz = 0; lz < CS; lz += 1) {
    for (let lx = 0; lx < CS; lx += 1) {
      const x = x0 + lx;
      const z = z0 + lz;
      const col = colAt(lx, lz);
      const h = col.h;
      const { top, under, depth } = groundOf(T, x, z, col);
      const strata = strataOf(T, x, z, col.zone);
      const base = lx | (lz << 4);
      for (let y = 0; y <= h && y < WY; y += 1) {
        let id: number;
        if (y === 0 || (y <= 2 && rnd(x, y, z, 1) < 0.5)) id = B.BEDROCK;
        else if (y === h) id = top;
        else if (y > h - depth) id = under;
        else {
          id = rockAt(strata, y, h);
          const r = rnd(x, y, z, 2);
          const d = h - y;
          if (r < 0.014) id = B.COAL_ORE;
          else if (r < 0.022 && d > 4) id = B.IRON_ORE;
          else if (r < 0.026 && d > 8) id = B.REDSTONE_ORE;
          else if (r < 0.0285 && d > 10 && col.mountain > 0.3) id = B.EMERALD_ORE;
        }
        c.blocks[base | (y << 8)] = id;
      }
      // Rivers and lakes (frozen over in the snowfields, molten in the ember wastes).
      const fill = col.zone === 'ember' ? B.LAVA : B.WATER;
      for (let y = h + 1; y < SEA; y += 1) c.blocks[base | (y << 8)] = col.zone === 'snow' && y === SEA - 1 ? B.ICE : fill;
      // Mount Cinder's lava lake and rivers.
      const lava = T.lavaLevel(x, z, h);
      for (let y = h + 1; y <= lava; y += 1) c.blocks[base | (y << 8)] = B.LAVA;
      c.ground[base] = h;
    }
  }

  // ---- waterfalls: a stream on the cliff top, the falling curtain, and a plunge pool
  for (const f of T.falls) {
    if (f.x + 30 < x0 || f.x - 30 > x0 + CS || f.z + 30 < z0 || f.z - 30 > z0 + CS) continue;
    const half = Math.floor(f.width / 2);
    for (let lz = 0; lz < CS; lz += 1) {
      for (let lx = 0; lx < CS; lx += 1) {
        const x = x0 + lx;
        const z = z0 + lz;
        const dx = x - f.x;
        const dz = z - f.z;
        const along = dx * f.fx + dz * f.fz;
        const across = Math.abs(dx * f.fz - dz * f.fx);
        const base = lx | (lz << 4);
        const h = c.ground[base]!;
        if (across <= half && along >= -6 && along <= -1) {
          // Stream channel cut into the cliff top.
          c.blocks[base | (h << 8)] = B.WATER;
        } else if (across <= half && along === 0) {
          for (let y = f.top; y > h; y -= 1) if (c.blocks[base | (y << 8)] === B.AIR) c.blocks[base | (y << 8)] = B.FALLING_WATER;
        } else if (along >= 1 && along <= 6 && across <= half + 2) {
          // Plunge pool.
          for (let y = h + 1; y < f.bottom; y += 1) c.blocks[base | (y << 8)] = B.WATER;
        }
      }
    }
  }

  // ---- caves: winding tunnels (where two noise fields both cross zero), deep caverns, lava
  carveCaves(T, c, x0, z0, colAt);

  // ---- the valley trail and village roads
  const sites = T.clearings();
  for (let lz = 0; lz < CS; lz += 1) {
    for (let lx = 0; lx < CS; lx += 1) {
      const x = x0 + lx;
      const z = z0 + lz;
      const base = lx | (lz << 4);
      const h = c.ground[base]!;
      const i = base | (h << 8);
      const surface = c.blocks[i]!;
      // A trodden track: a dirt path in the grass, coarse dirt in the red sand, dark stone in the ash.
      const track = surface === B.GRASS ? B.PATH : surface === B.RED_SAND ? B.COARSE_DIRT : surface === B.ASH ? B.BLACKSTONE : 0;
      if (!track) continue;
      let road = false;
      if (x > T.startX - 10 && x < T.endX + 10) {
        const off = Math.abs(z - T.centerZ(x) - Math.sin(x * 0.05) * 2);
        road = off < 1.3 || (off < 2.1 && rnd(x, 1, z, 9) < 0.55);
      }
      if (!road) {
        for (const r of w.structures.roads) {
          if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
            road = true;
            break;
          }
        }
      }
      if (road) c.blocks[i] = track;
    }
  }

  // ---- trees on a jittered grid (one candidate per 5x5 cell), across the padded area
  const G = 5;
  const gx0 = Math.floor((x0 - PAD) / G);
  const gx1 = Math.floor((x0 + CS + PAD) / G);
  const gz0 = Math.floor((z0 - PAD) / G);
  const gz1 = Math.floor((z0 + CS + PAD) / G);
  for (let gz = gz0; gz <= gz1; gz += 1) {
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const tx = gx * G + Math.floor(hash2(gx, gz, 101) * G);
      const tz = gz * G + Math.floor(hash2(gx, gz, 102) * G);
      const lx = tx - x0;
      const lz = tz - z0;
      if (lx < -PAD + 1 || lz < -PAD + 1 || lx >= CS + PAD - 1 || lz >= CS + PAD - 1) continue;
      const col = colAt(lx, lz);
      if (col.trees <= 0 || col.slope > 2) continue;
      // Grid cells hold up to one tree: scale the per-column density to the cell.
      if (hash2(gx, gz, 103) > col.trees * G * G * 0.9) continue;
      if (col.h < SEA) continue;
      if (nearSite(sites, tx, tz, 7)) continue;
      if (Math.abs(tz - T.centerZ(tx)) < 3.5) continue;
      if (nearFall(T, tx, tz)) continue;
      const rng = mulberry32(Math.floor(hash2(tx, tz, 104) * 4294967295));
      const g = col.h;
      switch (col.biome) {
        case 'birch':
          if (rng() < 0.85) birchTree(w, c, lx, g, lz, rng);
          else oakTree(w, c, lx, g, lz, rng);
          break;
        case 'taiga':
        case 'mountain':
        case 'snowfield':
          spruceTree(w, c, lx, g, lz, rng, col.biome === 'mountain');
          break;
        case 'blight':
          deadTree(c, lx, g, lz, rng);
          break;
        case 'swamp':
          swampOak(c, lx, g, lz, rng);
          break;
        case 'ember':
          deadTree(c, lx, g, lz, rng, B.CHARRED_LOG);
          break;
        case 'meadow':
          if (rng() < 0.3) bigOak(w, c, lx, g, lz, rng);
          else oakTree(w, c, lx, g, lz, rng);
          break;
        default:
          if (rng() < 0.18) bigOak(w, c, lx, g, lz, rng);
          else if (rng() < 0.2) birchTree(w, c, lx, g, lz, rng);
          else oakTree(w, c, lx, g, lz, rng);
      }
    }
  }

  // ---- ground cover: grass, flowers in patches, ferns, sugar cane, boulders
  const flowers = [B.POPPY, B.DANDELION, B.CORNFLOWER, B.OXEYE];
  for (let lz = 0; lz < CS; lz += 1) {
    for (let lx = 0; lx < CS; lx += 1) {
      const x = x0 + lx;
      const z = z0 + lz;
      const base = lx | (lz << 4);
      const h = c.ground[base]!;
      if (h + 1 >= WY) continue;
      const surface = c.blocks[base | (h << 8)]!;
      const above = base | ((h + 1) << 8);
      const col = colAt(lx, lz);
      const r = rnd(x, h, z, 21);
      // (Swamp pools carry lily pads on their surface.)
      if (col.biome === 'swamp' && h < SEA - 1) {
        swampCover(c, lx, lz, h, surface, x, z, r, hAt);
        continue;
      }
      if (c.blocks[above] !== B.AIR) continue;
      if (surface === B.SAND && h === SEA) {
        // Sugar cane on banks next to water.
        let wet = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (hAt(lx + dx, lz + dz) < SEA) wet = true;
        if (wet && r < 0.12) {
          const tall = 2 + Math.floor(rnd(x, 1, z, 22) * 2);
          for (let k = 1; k <= tall; k += 1) c.blocks[base | ((h + k) << 8)] = B.SUGAR_CANE;
        }
        continue;
      }
      if (surface === B.SAND && col.biome === 'desert') {
        if (r < 0.006) {
          const tall = 1 + Math.floor(rnd(x, 2, z, 24) * 3);
          for (let k = 1; k <= tall; k += 1) c.blocks[base | ((h + k) << 8)] = B.CACTUS;
        } else if (r < 0.02) c.blocks[above] = B.DEAD_BUSH;
        continue;
      }
      if ((surface === B.BLIGHT_GRASS || surface === B.BLIGHT_MOSS) && r < 0.03) {
        c.blocks[above] = B.DEAD_BUSH;
        continue;
      }
      if (col.biome === 'badlands' && (surface === B.RED_SAND || surface === B.COARSE_DIRT)) {
        if (r < 0.004 && surface === B.RED_SAND) {
          const tall = 1 + Math.floor(rnd(x, 2, z, 25) * 3);
          for (let k = 1; k <= tall; k += 1) c.blocks[base | ((h + k) << 8)] = B.CACTUS;
        } else if (r < 0.03) c.blocks[above] = B.DEAD_BUSH;
        continue;
      }
      if (col.biome === 'ember') {
        if (surface === B.ASH && r < 0.012) c.blocks[above] = B.DEAD_BUSH;
        else if (surface === B.ASH && r > 0.9975) boulder(c, lx, h, lz, x, z, B.BASALT, B.BLACKSTONE);
        continue;
      }
      if (col.biome === 'swamp') {
        swampCover(c, lx, lz, h, surface, x, z, r, hAt);
        continue;
      }
      if (surface === B.GRASS_SNOW && r < 0.04) {
        c.blocks[above] = B.FERN;
        continue;
      }
      if (surface !== B.GRASS) continue;
      const patch = D.patches.noise(x * 0.06, z * 0.06);
      const lush = D.patches.noise(x * 0.02 + 9, z * 0.02 - 4) * 0.5 + 0.5;
      // The Whispering Meadows: waist-high grass, flowers everywhere.
      if (col.biome === 'meadow' && T.meadowAt(x, z)) {
        if (r < 0.34) c.blocks[above] = flowers[Math.floor(hash2(Math.floor(x / 6), Math.floor(z / 6), 23) * flowers.length * 0.999)]!;
        else if (r < 0.92) {
          c.blocks[above] = B.TALL_GRASS;
          if (r < 0.62 && h + 2 < WY) c.blocks[base | ((h + 2) << 8)] = B.TALL_GRASS;
        }
        continue;
      }
      switch (col.biome) {
        case 'meadow':
        case 'forest':
        case 'birch':
          if (patch > 0.35 && r < 0.3) {
            const kind = flowers[Math.floor(hash2(Math.floor(x / 9), Math.floor(z / 9), 23) * flowers.length * 0.999)]!;
            c.blocks[above] = kind;
          } else if (r < 0.1 + lush * 0.38) {
            c.blocks[above] = col.biome === 'forest' && r < 0.08 ? B.FERN : B.TALL_GRASS;
          } else if (col.biome === 'meadow' && r > 0.9985) {
            boulder(c, lx, h, lz, x, z);
          }
          break;
        case 'taiga':
        case 'mountain':
          if (r < 0.14) c.blocks[above] = B.FERN;
          else if (r < 0.26) c.blocks[above] = B.TALL_GRASS;
          else if (r > 0.997) boulder(c, lx, h, lz, x, z);
          break;
        default:
          break;
      }
    }
  }

  // ---- buildings
  for (const s of w.structuresIn(cx, cz)) placeStructure(c, s, x0, z0);

  // ---- heightmaps
  for (let i = 0; i < LAYER; i += 1) {
    let y = WY - 1;
    while (y > 0 && !blockDef(c.blocks[i | (y << 8)]!).solid) y -= 1;
    c.top[i] = y;
  }
  return c;
}

/** Player edits replayed over freshly generated content. */
export function finishChunk(w: World, c: Chunk): Chunk {
  w.applyEdits(c);
  if (w.edits.has(chunkIndex(c.cx, c.cz))) for (let i = 0; i < LAYER; i += 1) c.recomputeTop(i & 15, i >> 4);
  return c;
}

export function generateChunk(w: World, cx: number, cz: number): Chunk {
  return finishChunk(w, generateRaw(w, cx, cz));
}

function nearSite(sites: ReturnType<Terrain['sites']>, x: number, z: number, margin: number): boolean {
  for (const s of sites) {
    const r = s.radius + margin;
    if (Math.abs(x - s.x) < r && Math.abs(z - s.z) < r && Math.hypot(x - s.x, z - s.z) < r) return true;
  }
  return false;
}

function nearFall(T: Terrain, x: number, z: number): boolean {
  for (const f of T.falls) if (Math.abs(x - f.x) < 9 && Math.abs(z - f.z) < 9) return true;
  return false;
}

// ------------------------------------------------------------------ vegetation writers
// All take chunk-local coordinates that may lie outside 0..15; only cells inside are written.

function put(c: Chunk, lx: number, y: number, lz: number, id: number, overwrite = false): void {
  if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= WY) return;
  const i = lx | (lz << 4) | (y << 8);
  const cur = c.blocks[i]!;
  if (cur === B.AIR || (overwrite && NATURAL[cur]) || blockDef(cur).shape === 'cross') c.blocks[i] = id;
}

function canopy(c: Chunk, lx: number, y: number, lz: number, r: number, leaf: number, rng: () => number, cut = 0.45): void {
  for (let dz = -r; dz <= r; dz += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (Math.abs(dx) === r && Math.abs(dz) === r && rng() < cut) continue;
      put(c, lx + dx, y, lz + dz, leaf);
    }
  }
}

function oakTree(_w: GenSource, c: Chunk, lx: number, g: number, lz: number, rng: () => number): void {
  const trunk = 4 + Math.floor(rng() * 3);
  const top = g + trunk;
  canopy(c, lx, top - 2, lz, 2, B.LEAVES, rng);
  canopy(c, lx, top - 1, lz, 2, B.LEAVES, rng, 0.7);
  canopy(c, lx, top, lz, 1, B.LEAVES, rng, 0.3);
  canopy(c, lx, top + 1, lz, 1, B.LEAVES, rng, 1);
  for (let y = g + 1; y <= top; y += 1) put(c, lx, y, lz, B.LOG, true);
  setDirt(c, lx, g, lz);
}

/** A broad oak with a thick trunk, side branches and a wide, layered crown. */
function bigOak(_w: GenSource, c: Chunk, lx: number, g: number, lz: number, rng: () => number): void {
  const trunk = 6 + Math.floor(rng() * 3);
  const top = g + trunk;
  for (let k = 0; k < 4; k += 1) {
    const a = rng() * Math.PI * 2;
    const len = 2 + Math.floor(rng() * 2);
    const by = top - 2 - Math.floor(rng() * 2);
    let bx = 0;
    let bz = 0;
    for (let s = 1; s <= len; s += 1) {
      bx = Math.round(Math.cos(a) * s);
      bz = Math.round(Math.sin(a) * s);
      put(c, lx + bx, by + Math.floor(s / 2), lz + bz, B.LOG, true);
    }
    for (let dy = 0; dy <= 1; dy += 1) canopy(c, lx + bx, by + Math.floor(len / 2) + dy, lz + bz, 2 - dy, B.LEAVES, rng);
  }
  for (let dy = -2; dy <= 2; dy += 1) {
    const r = dy === 2 ? 1 : dy === -2 ? 2 : 3;
    for (let dz = -r; dz <= r; dz += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dz * dz + dy * dy * 1.6 > r * r + 1.2 + rng() * 1.5) continue;
        put(c, lx + dx, top + dy, lz + dz, B.LEAVES);
      }
    }
  }
  for (let y = g + 1; y <= top; y += 1) put(c, lx, y, lz, B.LOG, true);
  if (rng() < 0.5) for (let y = g + 1; y <= g + 3; y += 1) put(c, lx + 1, y, lz, B.LOG, true);
  setDirt(c, lx, g, lz);
}

function birchTree(_w: GenSource, c: Chunk, lx: number, g: number, lz: number, rng: () => number): void {
  const trunk = 5 + Math.floor(rng() * 3);
  const top = g + trunk;
  canopy(c, lx, top - 2, lz, 2, B.BIRCH_LEAVES, rng);
  canopy(c, lx, top - 1, lz, 2, B.BIRCH_LEAVES, rng, 0.75);
  canopy(c, lx, top, lz, 1, B.BIRCH_LEAVES, rng, 0.3);
  canopy(c, lx, top + 1, lz, 1, B.BIRCH_LEAVES, rng, 1);
  for (let y = g + 1; y <= top; y += 1) put(c, lx, y, lz, B.BIRCH_LOG, true);
  setDirt(c, lx, g, lz);
}

function spruceTree(_w: GenSource, c: Chunk, lx: number, g: number, lz: number, rng: () => number, small: boolean): void {
  const trunk = (small ? 6 : 8) + Math.floor(rng() * (small ? 3 : 5));
  const top = g + trunk;
  // Cone of alternating wide and narrow rings.
  let r = 1;
  for (let y = top; y >= g + 3; y -= 1) {
    const ring = (top - y) % 2 === 0 ? Math.min(3, Math.floor((top - y) / 3) + 1) : Math.max(1, r - 1);
    r = ring;
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.abs(dx) + Math.abs(dz) > ring + (ring > 1 ? 1 : 0)) continue;
        put(c, lx + dx, y, lz + dz, B.SPRUCE_LEAVES);
      }
    }
  }
  put(c, lx, top + 1, lz, B.SPRUCE_LEAVES);
  for (let y = g + 1; y <= top - 1; y += 1) put(c, lx, y, lz, B.SPRUCE_LOG, true);
  setDirt(c, lx, g, lz);
}

/** A bare, blackened tree of the blighted lands (or a charred stump of the ember wastes): a crooked trunk and a few dead branches. */
function deadTree(c: Chunk, lx: number, g: number, lz: number, rng: () => number, wood: number = B.SPRUCE_LOG): void {
  const trunk = (wood === B.CHARRED_LOG ? 2 : 4) + Math.floor(rng() * 4);
  let x = lx;
  let z = lz;
  for (let y = g + 1; y <= g + trunk; y += 1) {
    put(c, x, y, z, wood, true);
    if (y > g + 2 && rng() < 0.25) {
      const d = Math.floor(rng() * 4);
      const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
      const dz = d === 2 ? 1 : d === 3 ? -1 : 0;
      put(c, x + dx, y, z + dz, wood, true);
      if (rng() < 0.5) put(c, x + dx * 2, y + 1, z + dz * 2, wood, true);
    }
    if (rng() < 0.15 && y < g + trunk - 1) x += rng() < 0.5 ? 1 : -1;
  }
}

/** A vine hanging off a support next to it (`dir`: the DIRS index pointing at the support), `len` down. */
function hangVine(c: Chunk, lx: number, y: number, lz: number, dir: number, len: number): void {
  for (let k = 0; k < len; k += 1) {
    const yy = y - k;
    if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || yy < 1 || yy >= WY) return;
    const i = lx | (lz << 4) | (yy << 8);
    if (c.blocks[i] !== B.AIR) return;
    c.blocks[i] = B.VINE;
    c.meta.set(i, dir);
  }
}

/** A swamp oak: a short trunk under a broad, flat, drooping crown hung with vines. */
function swampOak(c: Chunk, lx: number, g: number, lz: number, rng: () => number): void {
  const trunk = 4 + Math.floor(rng() * 3);
  const top = g + trunk;
  for (let dz = -3; dz <= 3; dz += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const d = Math.abs(dx) + Math.abs(dz);
      if (d > 4 || (d === 4 && rng() < 0.5)) continue;
      put(c, lx + dx, top - 1, lz + dz, B.SWAMP_LEAVES);
      if (d <= 2) put(c, lx + dx, top, lz + dz, B.SWAMP_LEAVES);
      if (d <= 1 && rng() < 0.7) put(c, lx + dx, top + 1, lz + dz, B.SWAMP_LEAVES);
    }
  }
  for (let y = g + 1; y <= top; y += 1) put(c, lx, y, lz, B.LOG, true);
  // Vines hanging from the crown's rim, each against the leaf it grows from.
  for (let dz = -3; dz <= 3; dz += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const d = Math.abs(dx) + Math.abs(dz);
      if (d < 3 || d > 4 || rng() > 0.45) continue;
      // The cell just outside the rim, leaning back on it.
      const ox = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0;
      const oz = ox === 0 ? Math.sign(dz) : 0;
      const dir = ox > 0 ? 1 : ox < 0 ? 0 : oz > 0 ? 3 : 2;
      hangVine(c, lx + dx + ox, top - 1, lz + dz + oz, dir, 2 + Math.floor(rng() * 4));
    }
  }
  setDirt(c, lx, g, lz);
}

/** The swamp floor: lily pads on still water, reeds along the edges, mushrooms and ferns in the shade. */
function swampCover(c: Chunk, lx: number, lz: number, h: number, surface: number, x: number, z: number, r: number, hAt: (lx: number, lz: number) => number): void {
  const base = lx | (lz << 4);
  const above = base | ((h + 1) << 8);
  // Still water (a pad floats on the cell above the surface water).
  if (h < SEA - 1 && c.blocks[base | ((SEA - 1) << 8)] === B.WATER && c.blocks[base | (SEA << 8)] === B.AIR) {
    if (r < 0.09 && SEA - 1 - h <= 3) c.blocks[base | (SEA << 8)] = B.LILY_PAD;
    return;
  }
  if (c.blocks[above] !== B.AIR) return;
  let wet = false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (hAt(lx + dx, lz + dz) < SEA) wet = true;
  if (wet && r < 0.3) {
    c.blocks[above] = B.REEDS;
    if (rnd(x, 3, z, 26) < 0.4 && h + 2 < WY) c.blocks[base | ((h + 2) << 8)] = B.REEDS;
    return;
  }
  if (surface === B.GRASS || surface === B.MUD || surface === B.DIRT) {
    if (r < 0.012) c.blocks[above] = rnd(x, 4, z, 27) < 0.5 ? B.RED_MUSHROOM : B.BROWN_MUSHROOM;
    else if (surface === B.GRASS && r < 0.34) c.blocks[above] = r < 0.1 ? B.FERN : B.TALL_GRASS;
  }
}

/** Value noise in 3D (smooth, -1..1) from the per-cell hash. */
function vnoise3(x: number, y: number, z: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const v = (i: number, j: number, k: number): number => rnd(xi + i, yi + j, zi + k, salt);
  const x00 = v(0, 0, 0) + (v(1, 0, 0) - v(0, 0, 0)) * sx;
  const x10 = v(0, 1, 0) + (v(1, 1, 0) - v(0, 1, 0)) * sx;
  const x01 = v(0, 0, 1) + (v(1, 0, 1) - v(0, 0, 1)) * sx;
  const x11 = v(0, 1, 1) + (v(1, 1, 1) - v(0, 1, 1)) * sx;
  const y0 = x00 + (x10 - x00) * sy;
  const y1 = x01 + (x11 - x01) * sy;
  return (y0 + (y1 - y0) * sz) * 2 - 1;
}

/** Cave fields sampled on a coarse 4-block lattice and blended per cell. */
function carveCaves(T: Terrain, c: Chunk, x0: number, z0: number, colAt: (lx: number, lz: number) => Col): void {
  const STEP = 4;
  const NX = CS / STEP + 1;
  const NY = 72 / STEP + 1;
  const a = new Float32Array(NX * NX * NY);
  const b = new Float32Array(NX * NX * NY);
  const k = new Float32Array(NX * NX * NY);
  for (let j = 0; j < NY; j += 1) {
    for (let iz = 0; iz < NX; iz += 1) {
      for (let ix = 0; ix < NX; ix += 1) {
        const x = x0 + ix * STEP;
        const y = j * STEP;
        const z = z0 + iz * STEP;
        const i = (j * NX + iz) * NX + ix;
        a[i] = vnoise3(x / 22, y / 14, z / 22, 61);
        b[i] = vnoise3(x / 22 + 31.7, y / 14 + 7.3, z / 22 - 11.1, 62);
        k[i] = vnoise3(x / 38, y / 18, z / 38, 63);
      }
    }
  }
  const sample = (f: Float32Array, lx: number, y: number, lz: number): number => {
    const gx = lx / STEP;
    const gy = y / STEP;
    const gz = lz / STEP;
    const ix = Math.min(NX - 2, Math.floor(gx));
    const iy = Math.min(NY - 2, Math.floor(gy));
    const iz = Math.min(NX - 2, Math.floor(gz));
    const tx = gx - ix;
    const ty = gy - iy;
    const tz = gz - iz;
    const at = (dx: number, dy: number, dz: number): number => f[((iy + dy) * NX + iz + dz) * NX + ix + dx]!;
    const c00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * tx;
    const c10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * tx;
    const c01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * tx;
    const c11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * tx;
    const y0 = c00 + (c10 - c00) * ty;
    const y1 = c01 + (c11 - c01) * ty;
    return y0 + (y1 - y0) * tz;
  };
  const sites = T.sites();
  for (let lz = 0; lz < CS; lz += 1) {
    for (let lx = 0; lx < CS; lx += 1) {
      const x = x0 + lx;
      const z = z0 + lz;
      const col = colAt(lx, lz);
      const h = col.h;
      // Nothing under buildings, and keep river and lake beds sealed.
      if (nearSite(sites, x, z, 10) || nearSite(T.camps, x, z, 6)) continue;
      const roof = h < SEA + 1 ? h - 9 : col.mountain > 0.25 ? h : h - 5;
      const base = lx | (lz << 4);
      for (let y = 5; y <= Math.min(roof, 70); y += 1) {
        const i = base | (y << 8);
        const id = c.blocks[i]!;
        if (id === B.AIR || id === B.BEDROCK || id === B.WATER || id === B.ICE) continue;
        // Mostly under the hills and mountains (where caves open on the slopes); thin under the valley.
        const t = col.mountain > 0.12 ? 0.075 : 0.045;
        const tunnel = Math.abs(sample(a, lx, y, lz)) < t && Math.abs(sample(b, lx, y, lz)) < t;
        const cavern = col.mountain > 0.2 && y < 34 && y > 8 && sample(k, lx, y, lz) > 0.55;
        if (!tunnel && !cavern) continue;
        c.blocks[i] = y <= 9 ? B.LAVA : B.AIR;
      }
    }
  }
}

function setDirt(c: Chunk, lx: number, g: number, lz: number): void {
  if (lx < 0 || lz < 0 || lx >= CS || lz >= CS) return;
  const i = lx | (lz << 4) | (g << 8);
  if (c.blocks[i] === B.GRASS) c.blocks[i] = B.DIRT;
}

function boulder(c: Chunk, lx: number, h: number, lz: number, x: number, z: number, a: number = B.MOSSY_COBBLE, b: number = B.COBBLE): void {
  const big = rnd(x, 7, z, 31) < 0.4;
  for (let dy = 0; dy <= (big ? 1 : 0); dy += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
        if (!big && Math.abs(dx) + Math.abs(dz) > 1) continue;
        if (rnd(x + dx, dy, z + dz, 32) < 0.25) continue;
        put(c, lx + dx, h + 1 + dy, lz + dz, rnd(x + dx, dy, z + dz, 33) < 0.5 ? a : b);
      }
    }
  }
}

// ------------------------------------------------------------------ structures

function placeStructure(c: Chunk, s: Structure, x0: number, z0: number): void {
  const bx0 = Math.max(s.minX, x0);
  const bx1 = Math.min(s.maxX, x0 + CS - 1);
  const bz0 = Math.max(s.minZ, z0);
  const bz1 = Math.min(s.maxZ, z0 + CS - 1);
  if (bx0 > bx1 || bz0 > bz1) return;
  // Clear vegetation and stray terrain inside the footprint above the floor (dug-in ones keep it).
  for (let z = bz0; z <= bz1 && !s.keep; z += 1) {
    for (let x = bx0; x <= bx1; x += 1) {
      const base = (x - x0) | ((z - z0) << 4);
      for (let y = s.floorY + 1; y <= Math.min(WY - 1, s.maxY + 2); y += 1) {
        const i = base | (y << 8);
        if (NATURAL[c.blocks[i]!]) c.blocks[i] = B.AIR;
      }
    }
  }
  for (let k = 0; k < s.count; k += 1) {
    const x = s.xs[k]!;
    const z = s.zs[k]!;
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) continue;
    const y = s.ys[k]!;
    if (y < 0 || y >= WY) continue;
    const lx = x - x0;
    const lz = z - z0;
    const i = lx | (lz << 4) | (y << 8);
    const id = s.ids[k]!;
    c.blocks[i] = id;
    const meta = s.metas[k]!;
    if (meta >= 0) c.meta.set(i, meta);
    // Foundations reach down to the ground so nothing floats.
    if (y === s.floorY && id !== B.AIR && !s.keep) {
      for (let yy = y - 1; yy > 0; yy -= 1) {
        const j = lx | (lz << 4) | (yy << 8);
        const cur = c.blocks[j]!;
        if (cur !== B.AIR && cur !== B.WATER && !blockDef(cur).replaceable) break;
        c.blocks[j] = yy >= y - 1 ? B.COBBLE : B.DIRT;
      }
    }
  }
}
