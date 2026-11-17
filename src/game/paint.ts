// Procedural 32x32 pixel-art painters for every block, item, sky and effect texture.
// Each painter only uses its seeded rng and the tileable toolkit noise, so every device
// paints identical tiles. Relief materials write the height channel (normal map), metals,
// glass and water write specular, and light sources write glow.
import { base, hex, lerpRGB, register, tileFbm, tileNoise, voronoi, type Pix, type RGB } from './textures';
import { mulberry32, type Rng } from './rng';

type Col = string | RGB;
const W = 32;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ small helpers

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Discrete palette tone (dark -> light) for t in 0..1: crisp, no interpolation. */
function tone(pal: readonly string[], t: number): string {
  if (Number.isNaN(t)) t = 0;
  const i = Math.floor(clamp01(t) * pal.length);
  return pal[i >= pal.length ? pal.length - 1 : i]!;
}

function rgbOf(c: Col): RGB {
  return typeof c === 'string' ? hex(c) : c;
}

function scale(c: Col, k: number): RGB {
  const v = rgbOf(c);
  return [Math.min(255, v[0] * k), Math.min(255, v[1] * k), Math.min(255, v[2] * k)];
}

function inside(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < W;
}

/** Bounds-checked set (sprites never wrap). */
function put(p: Pix, x: number, y: number, c: Col, a = 255): void {
  if (inside(x, y)) p.set(x, y, c, a);
}

function each(fn: (x: number, y: number) => void): void {
  for (let y = 0; y < W; y += 1) for (let x = 0; x < W; x += 1) fn(x, y);
}

function seedFrom(rng: Rng): number {
  return Math.floor(rng() * 2147483646) + 1;
}

/** Height slope toward the top-left light: > 0 lit, < 0 shaded. */
function lit(p: Pix, x: number, y: number): number {
  return p.getH(x + 1, y + 1) - p.getH(x - 1, y - 1);
}

function clearAll(p: Pix): void {
  each((x, y) => {
    p.set(x, y, '#000000', 0);
    p.H(x, y, 0.5);
  });
  p.heightSet = false;
}

function rectH(p: Pix, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) p.H(xx, yy, v);
}

function rectS(p: Pix, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) p.S(xx, yy, v);
}

/** Wrapped horizontal distance. */
function wdx(a: number, b: number): number {
  let d = Math.abs(a - b) % W;
  if (d > W / 2) d = W - d;
  return d;
}

/** Distance from point to segment, plus the segment parameter and signed side. */
function seg(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number; side: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? clamp01(((px - ax) * vx + (py - ay) * vy) / l2) : 0;
  const qx = ax + vx * t;
  const qy = ay + vy * t;
  const side = (vx * (py - ay) - vy * (px - ax)) / Math.sqrt(l2 || 1);
  return { d: Math.hypot(px - qx, py - qy), t, side };
}

function inPoly(pts: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Draws a 1px item outline (a dark version of the neighbouring colour) around opaque shapes. */
function outline(p: Pix, k = 0.42): void {
  const add: [number, number, RGB][] = [];
  each((x, y) => {
    if (p.alpha(x, y) > 0) return;
    let best: RGB | null = null;
    let bestL = 1e9;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || p.alpha(nx, ny) === 0) continue;
      const c = p.rgb(nx, ny);
      const l = c[0] + c[1] + c[2];
      if (l < bestL) {
        bestL = l;
        best = c;
      }
    }
    if (best) add.push([x, y, scale(best, k)]);
  });
  for (const [x, y, c] of add) {
    p.set(x, y, c);
    p.S(x, y, 0);
  }
}

/** Colour grain noise: blends smooth tileable fbm with per-pixel grain. */
function grainField(rng: Rng, cells: number, grain: number): (x: number, y: number) => number {
  const n = tileFbm(seedFrom(rng), cells);
  const g = new Float32Array(W * W);
  for (let i = 0; i < g.length; i += 1) g[i] = rng();
  return (x, y) => {
    const ix = ((Math.floor(x) % W) + W) % W;
    const iy = ((Math.floor(y) % W) + W) % W;
    return n(x, y) * (1 - grain) + g[iy * W + ix]! * grain;
  };
}

/** Fills the tile from a palette with smooth noise + grain; writes a gentle height. */
function granular(p: Pix, rng: Rng, pal: readonly string[], cells: number, grain: number, hBase = 0.4, hAmp = 0.25, bias = 0): void {
  const f = grainField(rng, cells, grain);
  each((x, y) => {
    const v = f(x, y) + bias;
    p.set(x, y, tone(pal, v));
    p.H(x, y, hBase + clamp01(v) * hAmp);
  });
}

/** Small raised clumps (pebbles, roots): a lit top-left pixel, a dark bottom-right pixel. */
function pebbles(p: Pix, rng: Rng, count: number, pal: readonly string[], hRaise = 0.15): void {
  for (let i = 0; i < count; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const w = 1 + Math.floor(rng() * 2);
    const h = 1 + Math.floor(rng() * 2);
    const t = rng();
    for (let yy = 0; yy < h; yy += 1) {
      for (let xx = 0; xx < w; xx += 1) {
        const edge = xx === 0 && yy === 0 ? 0.25 : xx === w - 1 && yy === h - 1 && (w > 1 || h > 1) ? -0.25 : 0;
        p.set(x + xx, y + yy, tone(pal, t + edge));
        p.addH(x + xx, y + yy, hRaise);
      }
    }
    p.mul(x + w, y + h, 0.88);
  }
}

/** Voronoi with well-spaced seeds: a jittered (staggered) grid fed to the toolkit through the rng. */
function spacedVoronoi(rng: Rng, nx: number, ny: number, jitter: number, squash: number, stagger = true): ReturnType<typeof voronoi> {
  const vals: number[] = [];
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const off = stagger && gy % 2 === 1 ? 0.5 : 0;
      vals.push((((gx + 0.5 + off + (rng() - 0.5) * jitter) / nx) % 1 + 1) % 1);
      vals.push((((gy + 0.5 + (rng() - 0.5) * jitter) / ny) % 1 + 1) % 1);
      vals.push(rng());
    }
  }
  let i = 0;
  const feed: Rng = () => (i < vals.length ? vals[i++]! : rng());
  return voronoi(feed, nx * ny, W, squash);
}

/** Re-tones a whole tile from a palette using height + slope lighting. */
function bakeLight(p: Pix, pal: readonly string[], toneAt: (x: number, y: number) => number, k = 1.4): void {
  const out: string[] = [];
  each((x, y) => out.push(tone(pal, toneAt(x, y) + lit(p, x, y) * k)));
  each((x, y) => p.set(x, y, out[y * W + x]!));
}

// ------------------------------------------------------------------ palettes

const STONE = ['#56575e', '#62636a', '#6e6f74', '#797a7c', '#838382', '#8e8d8a', '#9a9893'];
const COBBLE = ['#4f5057', '#5d5e65', '#6b6c72', '#78797d', '#858688', '#939392', '#a2a19d', '#b2b0aa'];
const MORTAR = ['#323238', '#3b3b41', '#43434a', '#4b4b51'];
const DIRT = ['#4b311f', '#5a3c26', '#6a472e', '#795234', '#875d3b', '#966944', '#a5774f'];
const GRASS = ['#3d6824', '#4a7a2c', '#598c34', '#6a9e3e', '#7bae48', '#8cbd53', '#9eca60', '#b2d672'];
const SAND = ['#bcab72', '#c8b880', '#d2c48b', '#dbce95', '#e2d6a0', '#e9deac', '#f1e8bb'];
const OAK = ['#6a4826', '#7d5732', '#8e663b', '#a07444', '#b0824c', '#bd8f56', '#cb9d62', '#d9ad70'];
const OAK_GAP = '#3e2914';
const SPRUCE = ['#33220f', '#422d17', '#4f371e', '#5c4126', '#684a2c', '#745433', '#815f3b', '#8e6b44'];
const SPRUCE_GAP = '#20140a';
const BARK_OAK = ['#33251a', '#3f2e1f', '#4c3824', '#5a432b', '#685033', '#765c3c', '#846947'];
const BARK_SPRUCE = ['#24180f', '#2e2015', '#39291b', '#453221', '#523c28', '#5f4630', '#6d5139'];
const IRON = ['#7c838c', '#8f969f', '#a2a9b1', '#b4bac1', '#c5cad0', '#d5d9de', '#e3e6ea', '#f1f3f5'];
const DARK_IRON = ['#16171b', '#1f2126', '#292b31', '#33363d', '#3f424a', '#4c5058', '#5c616a', '#70757f'];
const BRASS = ['#4e3410', '#6a4816', '#87601f', '#a3782a', '#bd9037', '#d4a848', '#e6c062', '#f4d886'];
const FIRE = ['#6a1404', '#a12a08', '#d24a0c', '#f07418', '#ffa02c', '#ffcc58', '#fff0a8'];
const LEAF_OAK = ['#1f4417', '#29561c', '#346822', '#407a29', '#4f8f2f', '#5ea037', '#70b243', '#86c455'];
const LEAF_BIRCH = ['#476a28', '#557c30', '#648e38', '#749f42', '#86b24f', '#96c05c', '#a8ce6c', '#bcdc80'];
const LEAF_SPRUCE = ['#132a1c', '#183421', '#1f3f28', '#264b30', '#2f5a3a', '#386844', '#43774f', '#50865b'];
const WOOL_W = ['#b4b4b0', '#c4c4c0', '#d2d2ce', '#dededa', '#e8e8e4', '#f2f2ee', '#fbfbf8'];
const WOOL_R = ['#5e1210', '#741a15', '#88221a', '#9c2b20', '#ae3527', '#c04230', '#d0523c'];
const REDSTONE = ['#5a0606', '#7e0c0a', '#a8140e', '#cc2016', '#ee3a24', '#ff6a4a', '#ff9a80'];
const GOLD_GLOW = ['#9a4e12', '#c06c1a', '#de8c26', '#f2aa38', '#fcc652', '#ffdf7e', '#fff3bc'];

// ------------------------------------------------------------------ terrain

function paintDirt(p: Pix, rng: Rng): void {
  granular(p, rng, DIRT, 6, 0.42, 0.35, 0.25);
  pebbles(p, rng, 16, DIRT, 0.18);
  // A few dark root/void specks.
  for (let i = 0; i < 18; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, DIRT[0]!);
    p.H(x, y, 0.2);
  }
  // Warm highlight crumbs.
  for (let i = 0; i < 14; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, DIRT[6]!);
    p.addH(x, y, 0.1);
  }
}

function paintGrassTop(p: Pix, rng: Rng): void {
  granular(p, rng, GRASS, 5, 0.5, 0.45, 0.25, -0.05);
  // Short blade strokes: a lit tip over a darker root.
  for (let i = 0; i < 110; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const t = 0.45 + rng() * 0.55;
    p.set(x, y, tone(GRASS, t));
    p.set(x, y + 1, tone(GRASS, t - 0.3));
    p.addH(x, y, 0.12);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, GRASS[0]!);
    p.H(x, y, 0.3);
  }
}

function grassOverhang(p: Pix, rng: Rng): void {
  const n = tileNoise(seedFrom(rng), 8);
  const depth: number[] = [];
  for (let x = 0; x < W; x += 1) depth.push(5 + Math.floor(n(x, 3) * 3.2));
  // Uneven drips: a few columns hang further down.
  for (let i = 0; i < 6; i += 1) {
    const x = Math.floor(rng() * W);
    depth[x] = depth[x]! + 1 + Math.floor(rng() * 3);
    if (rng() < 0.5) depth[(x + 1) % W] = Math.max(depth[(x + 1) % W]!, depth[x]! - 1);
  }
  for (let x = 0; x < W; x += 1) {
    const d = Math.min(9, depth[x]!);
    for (let y = 0; y < d; y += 1) {
      const t = 0.62 - (y / d) * 0.28 + (rng() - 0.5) * 0.38;
      p.set(x, y, tone(GRASS, y === d - 1 ? t - 0.22 : t));
      p.H(x, y, 0.7 - (y === d - 1 ? 0.08 : 0));
      p.S(x, y, 0);
    }
    // Shadow the dirt right under the overhang.
    p.mul(x, d, 0.72);
    p.H(x, d, 0.3);
  }
}

function paintGrassSide(p: Pix, rng: Rng): void {
  p.copy(base('dirt'));
  grassOverhang(p, rng);
}

function paintStone(p: Pix, rng: Rng): void {
  const a = tileFbm(seedFrom(rng), 4);
  const b = tileNoise(seedFrom(rng), 16);
  each((x, y) => {
    const v = a(x, y) * 0.62 + b(x, y) * 0.18 + rng() * 0.2;
    p.H(x, y, 0.42 + v * 0.22);
    p.set(x, y, tone(STONE, (v - 0.5) * 1.5 + 0.5));
  });
  // Short horizontal fissures with a lit lip above them.
  for (let i = 0; i < 9; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const len = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < len; k += 1) {
      const yy = y + (k > 1 && rng() < 0.3 ? 1 : 0);
      p.set(x + k, yy, STONE[1]!);
      p.H(x + k, yy, 0.25);
      p.set(x + k, yy - 1, STONE[5]!);
    }
  }
  for (let i = 0; i < 20; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, rng() < 0.5 ? STONE[6]! : STONE[0]!);
  }
}

interface StoneOpts {
  nx: number;
  ny: number;
  squash: number;
  pal: readonly string[];
  mortar: readonly string[];
  mortarW: number;
  lo: number;
  hi: number;
  toneVar: number;
  k: number;
}

/** Rounded stones (Voronoi cells) in deep mortar, domed heights and baked bevel light. */
function paintStones(p: Pix, rng: Rng, o: StoneOpts): void {
  const v = spacedVoronoi(rng, o.nx, o.ny, 0.75, o.squash);
  const g = grainField(rng, 8, 0.6);
  const isMortar = new Uint8Array(W * W);
  each((x, y) => {
    const i = y * W + x;
    const e = v.edge[i]!;
    if (e < o.mortarW) {
      isMortar[i] = 1;
      p.H(x, y, 0.05 + 0.1 * (e / o.mortarW));
    } else {
      const dome = clamp01((e - o.mortarW) / 3.4);
      p.H(x, y, o.lo + (o.hi - o.lo) * Math.sqrt(dome) + (g(x, y) - 0.5) * 0.06);
    }
  });
  const out: string[] = [];
  each((x, y) => {
    const i = y * W + x;
    if (isMortar[i]) {
      out.push(tone(o.mortar, g(x, y) + lit(p, x, y) * 0.8));
      return;
    }
    const cell = v.cells[v.owner[i]!]!;
    const t = 0.5 + (cell.tone - 0.5) * o.toneVar + (g(x, y) - 0.5) * 0.28 + lit(p, x, y) * o.k;
    out.push(tone(o.pal, t));
  });
  each((x, y) => p.set(x, y, out[y * W + x]!));
}

function paintCobble(p: Pix, rng: Rng): void {
  paintStones(p, rng, { nx: 4, ny: 4, squash: 1.1, pal: COBBLE, mortar: MORTAR, mortarW: 0.7, lo: 0.55, hi: 0.9, toneVar: 0.45, k: 0.9 });
}

const MOSS = ['#2c4a1c', '#365a22', '#41692a', '#4d7832', '#5a873a', '#689644'];

function mossOver(p: Pix, rng: Rng, amount: number): void {
  const n = tileFbm(seedFrom(rng), 5);
  const fine = tileNoise(seedFrom(rng), 16);
  each((x, y) => {
    const h = p.getH(x, y);
    // Moss settles in low mortar first, then creeps over the stones in soft patches.
    const m = n(x, y) * 0.8 + fine(x, y) * 0.2 + (h < 0.3 ? 0.07 : 0) + (rng() - 0.5) * 0.1;
    if (m > 1 - amount) {
      const t = clamp01((m - (1 - amount)) / amount) * 0.5 + 0.25 + lit(p, x, y) * 1.2 + (rng() - 0.5) * 0.3;
      p.set(x, y, tone(MOSS, t));
      p.addH(x, y, 0.05);
    }
  });
}

function paintMossyCobble(p: Pix, rng: Rng): void {
  p.copy(base('cobble'));
  mossOver(p, rng, 0.4);
}

function paintSand(p: Pix, rng: Rng): void {
  granular(p, rng, SAND, 6, 0.55, 0.45, 0.15);
  for (let i = 0; i < 22; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, rng() < 0.6 ? SAND[0]! : SAND[6]!);
  }
}

function paintGravel(p: Pix, rng: Rng): void {
  const pal = ['#4a4644', '#58534f', '#67615c', '#76706a', '#857e77', '#958d85', '#a69d94'];
  const v = spacedVoronoi(rng, 6, 6, 0.9, 1.15);
  const hue: number[] = v.cells.map(() => rng());
  each((x, y) => {
    const i = y * W + x;
    const e = v.edge[i]!;
    if (e < 0.55) p.H(x, y, 0.1);
    else p.H(x, y, 0.5 + 0.4 * Math.sqrt(clamp01((e - 0.55) / 2.2)));
  });
  each((x, y) => {
    const i = y * W + x;
    if (v.edge[i]! < 0.55) {
      p.set(x, y, pal[rng() < 0.5 ? 0 : 1]!);
      return;
    }
    const c = v.cells[v.owner[i]!]!;
    const t = 0.3 + c.tone * 0.55 + lit(p, x, y) * 1.6 + (rng() - 0.5) * 0.15;
    let col = rgbOf(tone(pal, t));
    const h = hue[v.owner[i]!]!;
    if (h < 0.25) col = lerpRGB(col, [col[0] * 1.08, col[1] * 0.98, col[2] * 0.88], 1); // warm brown pebble
    else if (h > 0.85) col = lerpRGB(col, [col[0] * 0.95, col[1] * 0.98, col[2] * 1.06], 1); // cool pebble
    p.set(x, y, scale(col, 1));
  });
}

function paintSnow(p: Pix, rng: Rng): void {
  const pal = ['#c3d0e2', '#cfdaea', '#dae3f1', '#e4ebf6', '#edf2fa', '#f6f9fd'];
  granular(p, rng, pal, 5, 0.35, 0.5, 0.12, 0.08);
  for (let i = 0; i < 14; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, '#ffffff');
    p.S(x, y, 0.4);
  }
}

function paintBedrock(p: Pix, rng: Rng): void {
  const pal = ['#18181b', '#252528', '#343438', '#46464a', '#5a5a5e', '#707074', '#8a8a8e'];
  const v = spacedVoronoi(rng, 6, 6, 1, 1);
  const f = grainField(rng, 8, 0.5);
  each((x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    const t = c.tone * 0.8 + (f(x, y) - 0.5) * 0.5 + (v.edge[i]! < 0.7 ? -0.25 : 0.05);
    p.H(x, y, 0.2 + clamp01(t) * 0.6);
  });
  bakeLight(p, pal, (x, y) => p.getH(x, y) * 1.1 - 0.05 + (f(x, y) - 0.5) * 0.25, 1.2);
}

interface OreOpts {
  pal: readonly string[];
  count: number;
  spec: number;
  glow: number;
}

/** Stone with raised mineral nuggets: lit top-left texels, dark rims, soft shadow below. */
function paintOre(p: Pix, rng: Rng, o: OreOpts): void {
  p.copy(base('stone'));
  const slots: [number, number][] = [];
  for (let gy = 0; gy < 3; gy += 1) for (let gx = 0; gx < 3; gx += 1) slots.push([gx, gy]);
  // Shuffle and keep `count` slots so nuggets spread evenly over the face.
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  for (const [gx, gy] of slots.slice(0, o.count)) {
    const ox = gx * 11 + 1 + Math.floor(rng() * 4);
    const oy = gy * 11 + 1 + Math.floor(rng() * 5);
    // Grow a chunky blob inside a 5x5 box.
    const cells = new Set<string>(['2,2']);
    const size = 9 + Math.floor(rng() * 6);
    let guard = 0;
    while (cells.size < size && guard < 200) {
      guard += 1;
      const list = [...cells];
      const [cx, cy] = list[Math.floor(rng() * list.length)]!.split(',').map(Number) as [number, number];
      const dir = Math.floor(rng() * 4);
      const nx = cx + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
      const ny = cy + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx > 5 || ny > 4) continue;
      cells.add(`${nx},${ny}`);
    }
    for (const key of cells) {
      const [sx, sy] = key.split(',').map(Number) as [number, number];
      const x = ox + sx;
      const y = oy + sy;
      const up = cells.has(`${sx},${sy - 1}`);
      const left = cells.has(`${sx - 1},${sy}`);
      const down = cells.has(`${sx},${sy + 1}`);
      const right = cells.has(`${sx + 1},${sy}`);
      let t = 0.55;
      if (!up || !left) t = 0.8;
      if (!up && !left) t = 1;
      if (!down || !right) t = 0.3;
      if (!down && !right) t = 0.1;
      t += (rng() - 0.5) * 0.12;
      p.set(x, y, tone(o.pal, t));
      p.H(x, y, 0.8 + (t > 0.7 ? 0.08 : 0));
      p.S(x, y, o.spec);
      p.E(x, y, o.glow);
      if (!down && !cells.has(`${sx + 1},${sy + 1}`)) {
        p.mul(x + 1, y + 1, 0.72);
        p.H(x + 1, y + 1, 0.3);
      }
      if (!down) {
        p.mul(x, y + 1, 0.8);
        p.H(x, y + 1, 0.35);
      }
      if (!right) p.mul(x + 1, y, 0.86);
    }
  }
}

function paintAndesite(p: Pix, rng: Rng): void {
  const pal = ['#6c6d70', '#77787a', '#828384', '#8b8c8c', '#959594', '#a09f9d', '#abaaa6'];
  granular(p, rng, pal, 4, 0.3, 0.5, 0.1, 0.05);
  for (let i = 0; i < 70; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const dark = rng() < 0.65;
    p.set(x, y, dark ? '#5e5f63' : '#b6b4af');
    if (dark && rng() < 0.4) p.set(x + 1, y, '#66676a');
    p.addH(x, y, dark ? -0.08 : 0.05);
  }
  p.bump = 0.6;
}

function paintGranite(p: Pix, rng: Rng): void {
  const pal = ['#7a4a3c', '#895444', '#965e4c', '#a26955', '#ad735e', '#b98068', '#c48e76'];
  granular(p, rng, pal, 5, 0.45, 0.45, 0.15);
  for (let i = 0; i < 80; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const r = rng();
    p.set(x, y, r < 0.4 ? '#5e3a30' : r < 0.75 ? '#d4a08c' : '#e8c2b0');
    p.addH(x, y, r < 0.4 ? -0.06 : 0.06);
  }
  p.bump = 0.7;
}

const PATH = ['#6e552c', '#7b6033', '#896b3b', '#957643', '#a1814c', '#ad8c55', '#b9985f'];

function paintPathTop(p: Pix, rng: Rng): void {
  granular(p, rng, PATH, 5, 0.38, 0.45, 0.15);
  pebbles(p, rng, 10, PATH, 0.12);
  for (let i = 0; i < 12; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, PATH[0]!);
    p.set(x + 1, y, PATH[1]!);
    p.H(x, y, 0.3);
  }
}

function paintPathSide(p: Pix, rng: Rng): void {
  p.copy(base('dirt'));
  for (let x = 0; x < W; x += 1) {
    const d = 3 + (rng() < 0.3 ? 1 : 0);
    for (let y = 0; y < d; y += 1) {
      p.set(x, y, tone(PATH, 0.55 - y * 0.1 + (rng() - 0.5) * 0.3));
      p.H(x, y, 0.6);
    }
    p.mul(x, d, 0.8);
  }
}

function paintFarmland(p: Pix, rng: Rng): void {
  const pal = ['#2c1c10', '#382415', '#442c1a', '#50351f', '#5c3e25', '#69482b', '#765233'];
  const f = grainField(rng, 6, 0.5);
  each((x, y) => {
    // Four furrows: ridge crests at row 2 of each 8px band, wet troughs at the bottom.
    const r = y % 8;
    const ridge = r <= 4 ? 1 - Math.abs(r - 2) / 3 : 0;
    const h = 0.25 + ridge * 0.5 + (f(x, y) - 0.5) * 0.12;
    p.H(x, y, h);
  });
  each((x, y) => {
    const r = y % 8;
    const t = 0.15 + p.getH(x, y) * 0.55 + (f(x, y) - 0.5) * 0.45 + lit(p, x, y) * 0.8;
    p.set(x, y, tone(pal, t));
    p.S(x, y, r >= 5 ? 0.25 : 0.08);
  });
  // Dark wet trough lines.
  for (let y = 6; y < W; y += 8) for (let x = 0; x < W; x += 1) if (rng() < 0.7) p.set(x, y, pal[0]!);
}

// ------------------------------------------------------------------ wood

function paintBarkOak(p: Pix, rng: Rng): void {
  const grooves: { x: number; amp: number; k: number; ph: number }[] = [];
  const n = 7;
  for (let i = 0; i < n; i += 1) grooves.push({ x: (i * W) / n + rng() * 2.5, amp: 0.6 + rng() * 1.2, k: 1 + Math.floor(rng() * 2), ph: rng() * TAU });
  const g = grainField(rng, 8, 0.4);
  each((x, y) => {
    let d = 99;
    for (const gr of grooves) d = Math.min(d, wdx(x + 0.5, gr.x + gr.amp * Math.sin((TAU * gr.k * y) / W + gr.ph)));
    const h = d < 0.75 ? 0.18 : 0.35 + 0.5 * clamp01((d - 0.5) / 2.2) + (g(x, y) - 0.5) * 0.08;
    p.H(x, y, h);
  });
  // Horizontal fissures bridging a ridge.
  for (let i = 0; i < 7; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const len = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < len; k += 1) p.H(x + k, y, 0.22);
  }
  bakeLight(p, BARK_OAK, (x, y) => p.getH(x, y) * 0.75 + (g(x, y) - 0.5) * 0.35, 1.3);
}

function logRings(p: Pix, rng: Rng, wood: readonly string[], bark: readonly string[], rimW = 2, barkSpots: string | null = null): void {
  const n = tileNoise(seedFrom(rng), 6);
  each((x, y) => {
    const dx = x - 15.5;
    const dy = y - 15.5;
    const cheb = Math.max(Math.abs(dx), Math.abs(dy));
    if (cheb > 15.5 - rimW) {
      const outer = cheb > 14.6;
      p.set(x, y, tone(bark, (outer ? 0.25 : 0.6) + (rng() - 0.5) * 0.4));
      p.H(x, y, outer ? 0.7 : 0.75);
      return;
    }
    const d = cheb * 0.55 + Math.hypot(dx, dy) * 0.45 + (n(x, y) - 0.5) * 1.6;
    const ring = Math.floor(d / 2.3);
    const inner = cheb > 15.5 - rimW - 1;
    let t = ring % 2 === 0 ? 0.7 : 0.38;
    t += (rng() - 0.5) * 0.12 + (1 - d / 16) * 0.1;
    if (inner) t = 0.12;
    if (d < 1.6) t = 0.2;
    p.set(x, y, tone(wood, t));
    p.H(x, y, inner ? 0.35 : 0.5 + (ring % 2 === 0 ? 0.04 : 0));
  });
  if (barkSpots) {
    for (let i = 0; i < 10; i += 1) {
      const side = Math.floor(rng() * 4);
      const a = 2 + Math.floor(rng() * 27);
      const len = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < len; k += 1) {
        const pos = a + k;
        const [x, y] = side === 0 ? [pos, 0] : side === 1 ? [pos, 31] : side === 2 ? [0, pos] : [31, pos];
        p.set(x, y, barkSpots);
      }
    }
  }
}

const OAK_END = ['#6e4c28', '#8a6236', '#a07442', '#b4874f', '#c2955a', '#cfa366'];

function paintLogOakTop(p: Pix, rng: Rng): void {
  logRings(p, rng, OAK_END, BARK_OAK, 2);
}

function paintPlanks(p: Pix, rng: Rng, pal: readonly string[], gap: string, nails = true): void {
  const s1 = seedFrom(rng);
  const s2 = seedFrom(rng);
  const joints = [4, 20, 12, 28].map((j) => j + Math.floor(rng() * 3));
  const segTone: number[] = [];
  for (let i = 0; i < 8; i += 1) segTone.push((rng() - 0.5) * 0.22);
  const streak = tileNoise(s1, 6);
  const groove = tileNoise(s2, 10);
  each((x, y) => {
    const b = Math.floor(y / 8);
    const r = y % 8;
    const j = joints[b]!;
    const seg = ((x - j + W) % W) < 16 ? 0 : 1;
    let h = 0.65;
    let t = 0.52 + segTone[b * 2 + seg]! + (streak(x, y * 3 + b * 9) - 0.5) * 0.45 + (rng() - 0.5) * 0.12;
    const gv = groove(x * 1, y * 4 + b * 17);
    if (r === 7) {
      p.set(x, y, gap);
      p.H(x, y, 0.1);
      return;
    }
    if (x === j) {
      p.set(x, y, gap);
      p.H(x, y, 0.1);
      return;
    }
    if (gv > 0.7 && r > 0 && r < 6) {
      t -= 0.28;
      h = 0.45;
    }
    if (r === 0) t += 0.16;
    if (r === 6) {
      t -= 0.18;
      h = 0.58;
    }
    if (x === (j + 1) % W) t += 0.1;
    if (x === (j + W - 1) % W) {
      t -= 0.14;
      h = 0.58;
    }
    p.set(x, y, tone(pal, t));
    p.H(x, y, h);
  });
  if (nails) {
    for (let b = 0; b < 4; b += 1) {
      const j = joints[b]!;
      for (const nx of [j + 2, j - 2]) {
        const ny = b * 8 + 3;
        p.set(nx, ny, scale(gap, 1.3));
        p.set(nx - 1, ny - 1, tone(pal, 0.95));
        p.H(nx, ny, 0.4);
      }
    }
  }
}

function paintLeaves(p: Pix, rng: Rng, pal: readonly string[], needles: boolean, holeFrac = 0.18): void {
  const n = tileFbm(seedFrom(rng), 4);
  each((x, y) => {
    const v = n(x, y);
    p.set(x, y, tone(pal, v * 0.5 + rng() * 0.25));
    p.H(x, y, 0.35 + v * 0.3);
  });
  const count = needles ? 120 : 70;
  for (let i = 0; i < count; i += 1) {
    const cx = Math.floor(rng() * W);
    const cy = Math.floor(rng() * W);
    const t = 0.35 + rng() * 0.55 + (n(cx, cy) - 0.5) * 0.3;
    if (needles) {
      const dir = rng() < 0.5 ? 1 : -1;
      const len = 3 + Math.floor(rng() * 2);
      for (let k = 0; k < len; k += 1) {
        p.set(cx + k * dir, cy + k, tone(pal, t + 0.1 - k * 0.06));
        p.H(cx + k * dir, cy + k, 0.75);
        p.set(cx + k * dir, cy + k + 1, tone(pal, t - 0.35));
      }
    } else {
      p.set(cx, cy, tone(pal, t));
      p.set(cx - 1, cy, tone(pal, t + 0.14));
      p.set(cx, cy - 1, tone(pal, t + 0.2));
      p.set(cx + 1, cy, tone(pal, t - 0.15));
      p.set(cx, cy + 1, tone(pal, t - 0.22));
      p.set(cx + 1, cy + 1, tone(pal, t - 0.35));
      p.H(cx, cy, 0.85);
      p.H(cx - 1, cy, 0.75);
      p.H(cx, cy - 1, 0.75);
      p.H(cx + 1, cy, 0.7);
      p.H(cx, cy + 1, 0.65);
    }
  }
  // Holes in small groups where the cluster noise is lowest.
  const hn = tileNoise(seedFrom(rng), 9);
  const scores: [number, number][] = [];
  each((x, y) => scores.push([hn(x, y) * 0.8 + n(x, y) * 0.4 + rng() * 0.25, y * W + x]));
  scores.sort((a, b) => a[0] - b[0]);
  const holes = Math.round(W * W * holeFrac);
  for (let i = 0; i < holes; i += 1) {
    const k = scores[i]![1];
    const x = k % W;
    const y = Math.floor(k / W);
    p.clear(x, y);
    p.H(x, y, 0.05);
  }
  // Leaf edges facing bottom-right of a hole read as shaded.
  each((x, y) => {
    if (p.alpha(x, y) === 0) return;
    if (p.alpha(x + 1, y) === 0 || p.alpha(x, y + 1) === 0) p.mul(x, y, 0.8);
    else if (p.alpha(x - 1, y) === 0 || p.alpha(x, y - 1) === 0) p.mul(x, y, 1.1);
  });
}

const BIRCH_BARK = ['#a7a196', '#bdb7aa', '#cfcabd', '#dcd8cd', '#e6e3da', '#efede6', '#f8f7f2'];

function paintLogBirch(p: Pix, rng: Rng): void {
  const f = grainField(rng, 6, 0.3);
  each((x, y) => {
    const v = f(x, y);
    p.set(x, y, tone(BIRCH_BARK, 0.35 + v * 0.65));
    p.H(x, y, 0.6 + v * 0.1);
  });
  // Black horizontal lenticels / scars.
  for (let i = 0; i < 16; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const len = 2 + Math.floor(rng() * 6);
    const thick = rng() < 0.35 ? 2 : 1;
    for (let k = 0; k < len; k += 1) {
      for (let t = 0; t < thick; t += 1) {
        const end = k === 0 || k === len - 1;
        p.set(x + k, y + t, end ? '#4a443c' : t === 0 ? '#25211d' : '#3a352f');
        p.H(x + k, y + t, 0.3);
      }
      p.set(x + k, y + thick, BIRCH_BARK[2]!);
    }
  }
  // Faint grey bark flecks.
  for (let i = 0; i < 24; i += 1) p.set(Math.floor(rng() * W), Math.floor(rng() * W), BIRCH_BARK[1]!);
}

function paintLogBirchTop(p: Pix, rng: Rng): void {
  logRings(p, rng, ['#a8936a', '#bca67c', '#cbb68b', '#d7c398', '#e1cfa6', '#e9d9b2'], BIRCH_BARK, 2, '#2a2520');
}

function paintLogSpruce(p: Pix, rng: Rng): void {
  const v = spacedVoronoi(rng, 6, 4, 0.7, 0.45);
  const g = grainField(rng, 8, 0.5);
  each((x, y) => {
    const i = y * W + x;
    const e = v.edge[i]!;
    p.H(x, y, e < 0.6 ? 0.12 : 0.4 + 0.45 * Math.sqrt(clamp01((e - 0.6) / 2.5)));
  });
  bakeLight(p, BARK_SPRUCE, (x, y) => {
    const c = v.cells[v.owner[y * W + x]!]!;
    return p.getH(x, y) * 0.6 + (c.tone - 0.5) * 0.3 + (g(x, y) - 0.5) * 0.3;
  }, 1.4);
}

function paintLogSpruceTop(p: Pix, rng: Rng): void {
  logRings(p, rng, ['#5a3e22', '#6c4c2c', '#7c5934', '#8a653c', '#967046', '#a07a4e'], BARK_SPRUCE, 2);
}

// ------------------------------------------------------------------ plants

const BLADE = ['#2d5a1d', '#3a6c24', '#487f2c', '#579236', '#68a440', '#7bb44c', '#8fc35a'];

function blade(p: Pix, bx: number, height: number, lean: number, pal: readonly string[], wide: number): void {
  for (let i = 0; i <= height; i += 1) {
    const y = 31 - i;
    const f = i / height;
    const x = Math.round(bx + lean * f * f * height);
    const t = 0.1 + f * 0.85;
    put(p, x, y, tone(pal, t));
    if (f < wide) put(p, x + 1, y, tone(pal, t - 0.2));
  }
}

function paintTallGrass(p: Pix, rng: Rng): void {
  clearAll(p);
  for (let i = 0; i < 12; i += 1) {
    const bx = 2 + i * 2.4 + rng() * 1.5;
    const h = 9 + Math.floor(rng() * 17);
    const lean = (rng() - 0.5) * 0.7 + (bx < 16 ? -0.12 : 0.12);
    blade(p, bx, h, lean, BLADE, rng() < 0.5 ? 0.45 : 0.25);
  }
}

function paintFern(p: Pix, rng: Rng): void {
  clearAll(p);
  const pal = ['#1f4318', '#29541e', '#336625', '#3e782d', '#4a8a35', '#589b3f', '#68ab4a'];
  const fronds = [-0.95, -0.55, -0.2, 0.15, 0.5, 0.9];
  for (const a of fronds) {
    const len = 18 + rng() * 9;
    const dx = Math.sin(a) * 0.9;
    let x = 16 + a * 2;
    let y = 31;
    for (let i = 0; i < len; i += 1) {
      const f = i / len;
      x += dx * (0.6 + f);
      y -= 1 - f * f * 0.75;
      const px = Math.round(x);
      const py = Math.round(y);
      const t = 0.15 + f * 0.6;
      put(p, px, py, tone(pal, t));
      if (i > 2 && i % 2 === 0) {
        const w = Math.max(1, Math.round((1 - f) * 3));
        for (let k = 1; k <= w; k += 1) {
          put(p, px - k, py - (k > 1 ? 1 : 0), tone(pal, t + 0.25));
          put(p, px + k, py - (k > 1 ? 1 : 0), tone(pal, t + 0.05));
        }
      }
    }
  }
}

function stem(p: Pix, top: number, leaves: boolean, pal: readonly string[] = BLADE): void {
  for (let y = top; y < W; y += 1) {
    put(p, 15, y, tone(pal, 0.55));
    put(p, 16, y, tone(pal, 0.3));
  }
  if (leaves) {
    const l: [number, number, number][] = [
      [14, 25, 0.6], [13, 24, 0.7], [12, 23, 0.8], [11, 23, 0.65], [13, 25, 0.45], [12, 24, 0.5],
      [17, 22, 0.5], [18, 21, 0.6], [19, 20, 0.7], [20, 20, 0.55], [18, 22, 0.35], [19, 21, 0.45],
    ];
    for (const [x, y, t] of l) put(p, x, y, tone(pal, t));
  }
}

function flowerHead(p: Pix, cx: number, cy: number, rBase: number, amp: number, petals: number, pal: readonly string[], center: string | null, cr: number, rot = 0): void {
  for (let y = Math.floor(cy - rBase - amp - 1); y <= cy + rBase + amp + 1; y += 1) {
    for (let x = Math.floor(cx - rBase - amp - 1); x <= cx + rBase + amp + 1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) + rot;
      const R = rBase + amp * Math.abs(Math.cos((petals * a) / 2));
      if (r > R) continue;
      if (center && r < cr) {
        put(p, x, y, center);
        continue;
      }
      const light = -(dx + dy) / (Math.SQRT2 * Math.max(1, R));
      put(p, x, y, tone(pal, 0.45 + light * 0.35 + (r / R) * 0.2 - (r > R - 1 ? 0.25 : 0)));
    }
  }
}

function paintPoppy(p: Pix, _rng: Rng): void {
  clearAll(p);
  stem(p, 14, true);
  flowerHead(p, 16, 10, 4.2, 1.6, 4, ['#6a0c0c', '#8e1210', '#b41a14', '#d42a1a', '#ec4630', '#ff7458'], null, 0, 0.4);
  put(p, 15, 9, '#2a1a12');
  put(p, 16, 9, '#3a2416');
  put(p, 15, 10, '#3a2416');
  put(p, 16, 10, '#1e130c');
  put(p, 16, 8, '#c8b84a');
}

function paintDandelion(p: Pix, rng: Rng): void {
  clearAll(p);
  stem(p, 15, true);
  const pal = ['#9a7414', '#c09a1e', '#e0bc2a', '#f2d83a', '#fae868', '#fff6a8'];
  flowerHead(p, 16, 12, 3.6, 0.9, 10, pal, null, 0);
  for (let i = 0; i < 6; i += 1) put(p, 13 + Math.floor(rng() * 6), 9 + Math.floor(rng() * 6), pal[5]!);
  put(p, 16, 13, pal[1]!);
}

function paintCornflower(p: Pix, _rng: Rng): void {
  clearAll(p);
  stem(p, 14, true);
  flowerHead(p, 16, 10, 3.2, 2.6, 7, ['#18205e', '#22308a', '#3046b8', '#4a64e0', '#6e88f0', '#9aaef8'], '#2a1a5a', 1.4, 0.3);
}

function paintOxeye(p: Pix, _rng: Rng): void {
  clearAll(p);
  stem(p, 14, true);
  flowerHead(p, 16, 10, 3.5, 2.4, 8, ['#9a9a90', '#bdbdb2', '#d8d8ce', '#ececE4'.toLowerCase(), '#f8f8f2', '#ffffff'], null, 0);
  flowerHead(p, 16, 10, 1.9, 0, 1, ['#a87a10', '#d8a820', '#f2c832', '#fde060'], null, 0);
}

function paintSugarCane(p: Pix, rng: Rng): void {
  clearAll(p);
  const pal = ['#3e6a24', '#4f8030', '#62963c', '#78ad4a', '#8fc25c', '#a9d676'];
  for (const sx of [5, 15, 25]) {
    const phase = Math.floor(rng() * 8);
    const x0 = sx + Math.floor(rng() * 2) - 1;
    for (let y = 0; y < W; y += 1) {
      const node = (y + phase) % 8;
      for (let k = 0; k < 3; k += 1) {
        let t = k === 0 ? 0.75 : k === 1 ? 0.55 : 0.3;
        if (node === 0) t -= 0.3;
        if (node === 1) t += 0.2;
        put(p, x0 + k, y, tone(pal, t));
      }
      if (node === 0) {
        p.H(x0, y, 0.35);
        p.H(x0 + 1, y, 0.35);
        p.H(x0 + 2, y, 0.35);
      }
      // Leaves from some nodes.
      if (node === 1 && rng() < 0.45) {
        const dir = rng() < 0.5 ? -1 : 1;
        const start = dir < 0 ? x0 - 1 : x0 + 3;
        for (let k = 0; k < 4; k += 1) put(p, start + k * dir, y - Math.floor(k / 2), tone(pal, 0.85 - k * 0.12));
      }
    }
  }
}

function paintWheat(p: Pix, rng: Rng): void {
  clearAll(p);
  const pal = ['#7a5a16', '#9a7820', '#b8952c', '#cdac3c', '#dfc256', '#eed67a', '#f8e8a4'];
  const xs = [2, 6, 10, 14, 18, 22, 26, 29];
  for (const sx of xs) {
    const x0 = sx + Math.floor(rng() * 2);
    const top = 1 + Math.floor(rng() * 7);
    const lean = (rng() - 0.5) * 1.6;
    const earLen = 9 + Math.floor(rng() * 3);
    for (let y = top; y < W; y += 1) {
      const f = (W - y) / (W - top);
      const x = Math.round(x0 + lean * f * f);
      if (y < top + earLen) {
        // Ear: kernels alternating left/right of the rachis.
        const k = (y - top) % 3;
        put(p, x, y, tone(pal, 0.55));
        if (k === 0) {
          put(p, x - 1, y, tone(pal, 0.85));
          put(p, x - 1, y + 1, tone(pal, 0.5));
        } else if (k === 1) {
          put(p, x + 1, y, tone(pal, 0.7));
          put(p, x + 1, y + 1, tone(pal, 0.35));
        }
        if (y === top) put(p, x, y - 1, tone(pal, 0.95));
      } else {
        put(p, x, y, tone(pal, 0.2 + (1 - f) * 0.15 + (y % 7 === 0 ? 0.25 : 0)));
      }
    }
  }
}

function paintVine(p: Pix, rng: Rng): void {
  clearAll(p);
  const pal = ['#1a4214', '#24541a', '#306722', '#3c7a2a', '#4a8d34', '#5aa03f', '#6cb04c'];
  const strands = 5;
  for (let s = 0; s < strands; s += 1) {
    const x0 = (s * W) / strands + rng() * 3;
    const amp = 1 + rng() * 1.6;
    const ph = rng() * TAU;
    let lastLeaf = -10;
    for (let y = 0; y < W; y += 1) {
      const x = Math.round(x0 + amp * Math.sin((TAU * y) / W + ph));
      p.set(x, y, pal[1]!);
      p.H(x, y, 0.55);
      if (y - lastLeaf > 3 && rng() < 0.45) {
        lastLeaf = y;
        const dir = rng() < 0.5 ? -1 : 1;
        const cx = x + dir * 2;
        const t = 0.4 + rng() * 0.4;
        const leaf: [number, number, number][] = [
          [0, -1, 0.2], [-1, 0, 0.15], [0, 0, 0], [1, 0, -0.15], [0, 1, -0.3], [-1, -1, 0.25], [1, 1, -0.35], [dir, -1, 0.05],
        ];
        for (const [lx, ly, dt] of leaf) {
          p.set(cx + lx, y + ly, tone(pal, t + dt));
          p.H(cx + lx, y + ly, 0.7);
        }
        p.set(x + dir, y, pal[2]!);
      }
    }
  }
}

// ------------------------------------------------------------------ built blocks

interface BrickOpts {
  rowH: number;
  bw: number;
  offsets: readonly number[];
  pal: readonly string[];
  mortar: readonly string[];
  toneVar: number;
  noise: number;
}

/** Brick wall: rows of bricks with 1px mortar, half-offset joints and a bevel per brick. */
function paintBricks(p: Pix, rng: Rng, o: BrickOpts): { brickId: (x: number, y: number) => number } {
  const g = grainField(rng, 8, 0.55);
  const tones = new Map<number, number>();
  const brickAt = (x: number, y: number): { id: number; lx: number; ly: number } | null => {
    const yy = ((y % W) + W) % W;
    const row = Math.floor(yy / o.rowH);
    const ly = yy - row * o.rowH;
    if (ly === o.rowH - 1) return null;
    const off = o.offsets[row % o.offsets.length]!;
    const xx = (((x - off) % W) + W) % W;
    const col = Math.floor(xx / o.bw);
    const lx = xx - col * o.bw;
    if (lx === o.bw - 1) return null;
    return { id: row * 16 + col, lx, ly };
  };
  each((x, y) => {
    const b = brickAt(x, y);
    if (!b) {
      p.set(x, y, tone(o.mortar, g(x, y)));
      p.H(x, y, 0.1);
      return;
    }
    let bt = tones.get(b.id);
    if (bt === undefined) {
      bt = rng();
      tones.set(b.id, bt);
    }
    let t = 0.5 + (bt - 0.5) * o.toneVar + (g(x, y) - 0.5) * o.noise;
    let h = 0.75;
    const w = o.bw - 1;
    const hh = o.rowH - 1;
    if (b.ly === 0 || b.lx === 0) {
      t += 0.24;
      h = 0.68;
    } else if (b.ly === hh - 1 || b.lx === w - 1) {
      t -= 0.24;
      h = 0.68;
    } else if (b.ly === 1 || b.lx === 1) t += 0.06;
    p.set(x, y, tone(o.pal, t));
    p.H(x, y, h);
  });
  return { brickId: (x, y) => brickAt(x, y)?.id ?? -1 };
}

const SBRICK = ['#5a5a5e', '#666669', '#717174', '#7b7b7d', '#868685', '#91908e', '#9d9b97', '#aba8a2'];
const SBRICK_MORTAR = ['#3c3c41', '#45454a', '#4c4c51'];

function paintStoneBricks(p: Pix, rng: Rng): void {
  paintBricks(p, rng, { rowH: 16, bw: 32, offsets: [0, 16], pal: SBRICK, mortar: SBRICK_MORTAR, toneVar: 0.2, noise: 0.4 });
  // Chips and pits.
  for (let i = 0; i < 12; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (p.getH(x, y) < 0.7) continue;
    p.set(x, y, SBRICK[1]!);
    p.set(x - 1, y - 1, SBRICK[6]!);
    p.H(x, y, 0.6);
  }
}

function paintMossyStoneBricks(p: Pix, rng: Rng): void {
  p.copy(base('stone_bricks'));
  mossOver(p, rng, 0.36);
}

function paintCrackedStoneBricks(p: Pix, rng: Rng): void {
  p.copy(base('stone_bricks'));
  for (let c = 0; c < 4; c += 1) {
    let x = rng() * W;
    let y = rng() * W;
    let a = rng() * TAU;
    const len = 8 + rng() * 10;
    for (let i = 0; i < len; i += 1) {
      const px = Math.floor(x);
      const py = Math.floor(y);
      p.set(px, py, '#2e2e33');
      p.H(px, py, 0.15);
      p.set(px + 1, py + 1, SBRICK[2]!);
      if (rng() < 0.2) {
        p.set(px, py + 1, '#3a3a3f');
        p.H(px, py + 1, 0.2);
      }
      a += (rng() - 0.5) * 1.1;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
}

function paintClayBricks(p: Pix, rng: Rng): void {
  const pal = ['#6a2c22', '#7c3428', '#8c3d2e', '#9b4634', '#a8503b', '#b45c45', '#c06a52'];
  const mortar = ['#958a7e', '#a69b8e', '#b4aa9d', '#c0b7aa'];
  paintBricks(p, rng, { rowH: 8, bw: 16, offsets: [0, 8], pal, mortar, toneVar: 0.55, noise: 0.35 });
  // Mortar is light, so make it slightly recessed but lit.
  each((x, y) => {
    if (p.getH(x, y) < 0.2 && rng() < 0.15) p.set(x, y, mortar[0]!);
  });
}

const SMOOTH = ['#8e8e91', '#99999b', '#a2a2a4', '#aaaaab', '#b2b2b2', '#bbbab8'];

function paintSmoothStone(p: Pix, rng: Rng, seam: boolean): void {
  granular(p, rng, SMOOTH, 4, 0.3, 0.6, 0.04, 0.1);
  each((x, y) => {
    p.S(x, y, 0.3);
    const edge = x === 0 || y === 0 || x === 31 || y === 31;
    const inner = x === 1 || y === 1;
    const innerDark = x === 30 || y === 30;
    if (edge) {
      p.set(x, y, '#7e7e82');
      p.H(x, y, 0.4);
    } else if (inner) p.set(x, y, SMOOTH[5]!);
    else if (innerDark) p.set(x, y, SMOOTH[0]!);
    if (seam && !edge) {
      if (y === 15) {
        p.set(x, y, '#76767a');
        p.H(x, y, 0.2);
      } else if (y === 16) p.set(x, y, SMOOTH[5]!);
      else if (y === 14) p.set(x, y, SMOOTH[0]!);
    }
  });
}

function rivet(p: Pix, x: number, y: number, pal: readonly string[], spec: number, big = true): void {
  const pts: [number, number, number][] = big
    ? [[0, 0, 0.95], [1, 0, 0.75], [0, 1, 0.7], [1, 1, 0.45]]
    : [[0, 0, 0.9]];
  for (const [dx, dy, t] of pts) {
    p.set(x + dx, y + dy, tone(pal, t));
    p.H(x + dx, y + dy, 0.95);
    p.S(x + dx, y + dy, spec);
  }
  p.set(x + (big ? 2 : 1), y + (big ? 1 : 0), tone(pal, 0.12));
  p.set(x + (big ? 1 : 0), y + (big ? 2 : 1), tone(pal, 0.12));
  if (big) p.set(x + 2, y + 2, tone(pal, 0.05));
}

/** Bevelled metal plate filling the rectangle; returns nothing, writes spec everywhere. */
function plate(p: Pix, rng: Rng, x0: number, y0: number, w: number, h: number, pal: readonly string[], spec: number, bevel = 2, brushed: 'h' | 'v' | null = 'v'): void {
  const n = tileNoise(seedFrom(rng), 8);
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const lx = x - x0;
      const ly = y - y0;
      const dl = Math.min(lx, ly);
      const dr = Math.min(w - 1 - lx, h - 1 - ly);
      let t = 0.5 + (n(x, y) - 0.5) * 0.18;
      if (brushed === 'v') t += (n(x * 7, 3) - 0.5) * 0.12;
      if (brushed === 'h') t += (n(3, y * 7) - 0.5) * 0.12;
      t += (rng() - 0.5) * 0.06;
      let hgt = 0.7;
      if (dl < bevel && dl <= dr) {
        t += 0.32 - dl * 0.08;
        hgt = 0.5 + dl * 0.1;
      } else if (dr < bevel) {
        t -= 0.32 - dr * 0.08;
        hgt = 0.5 + dr * 0.1;
      }
      if (lx === 0 || ly === 0 || lx === w - 1 || ly === h - 1) {
        hgt = 0.35;
        if (lx === w - 1 || ly === h - 1) t = 0;
      }
      p.set(x, y, tone(pal, t));
      p.H(x, y, hgt);
      p.S(x, y, spec);
    }
  }
}

function paintIronBlock(p: Pix, rng: Rng): void {
  plate(p, rng, 0, 0, 32, 32, IRON, 0.75, 3, 'v');
  for (const [x, y] of [[4, 4], [26, 4], [4, 26], [26, 26]] as const) rivet(p, x, y, IRON, 0.85);
  // Horizontal panel seam.
  for (let x = 3; x < 29; x += 1) {
    p.set(x, 15, IRON[1]!);
    p.H(x, 15, 0.45);
    p.set(x, 16, IRON[6]!);
  }
}

function paintWool(p: Pix, rng: Rng, pal: readonly string[]): void {
  const f = grainField(rng, 4, 0.25);
  each((x, y) => {
    // Knit "V" stitches: 4x4 cells, offset every other column of stitches.
    const cx = Math.floor(x / 4);
    const lx = x % 4;
    const ly = (y + (cx % 2) * 2) % 4;
    const v = lx < 2 ? (ly === lx ? 0.25 : ly === lx + 1 ? 0.05 : -0.08) : ly === 3 - lx ? 0.18 : ly === 4 - lx ? 0 : -0.12;
    const t = 0.5 + v * 1.7 + (f(x, y) - 0.5) * 0.3;
    p.set(x, y, tone(pal, t));
    p.H(x, y, 0.5 + v * 0.5);
  });
  p.bump = 0.5;
}

function paintObsidian(p: Pix, rng: Rng): void {
  const pal = ['#08060c', '#0f0a17', '#160f22', '#1e142e', '#271a3c', '#33224e', '#45306a'];
  const v = spacedVoronoi(rng, 3, 4, 0.9, 1);
  const f = grainField(rng, 6, 0.35);
  each((x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    p.H(x, y, 0.5 + c.tone * 0.2 + v.edge[i]! * 0.03);
  });
  each((x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    let t = 0.2 + c.tone * 0.35 + (f(x, y) - 0.5) * 0.5;
    if (v.edge[i]! < 0.6) t -= 0.2;
    p.set(x, y, tone(pal, t));
    p.S(x, y, 0.8);
  });
  // Violet glints along diagonal facets.
  for (let i = 0; i < 7; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const len = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < len; k += 1) p.set(x + k, y - k, k === 0 ? '#8a6ac4' : '#5e4290');
    p.set(x - 1, y + 1, '#3a2758');
  }
}

function paintGlass(p: Pix, rng: Rng): void {
  clearAll(p);
  const frame = ['#9fb8c2', '#b9d0d8', '#d2e4ea', '#e8f4f7'];
  each((x, y) => {
    const edge = x === 0 || y === 0 || x === 31 || y === 31;
    if (!edge) return;
    const t = x === 0 || y === 0 ? 0.8 : 0.25;
    p.set(x, y, tone(frame, t + (rng() - 0.5) * 0.2));
    p.S(x, y, 0.8);
  });
  // 2px corners.
  for (const [x, y] of [[1, 1], [30, 1], [1, 30], [30, 30], [2, 1], [1, 2], [29, 30], [30, 29]] as const) {
    p.set(x, y, frame[2]!);
    p.S(x, y, 0.8);
  }
  // Diagonal streak highlights.
  const streaks: [number, number, number][] = [[6, 10, 5], [9, 11, 3], [20, 26, 6], [23, 27, 3]];
  for (const [sx, sy, len] of streaks) {
    for (let k = 0; k < len; k += 1) {
      p.set(sx + k, sy - k, k === 0 || k === len - 1 ? '#dcecf2' : '#ffffff');
      p.S(sx + k, sy - k, 0.8);
    }
  }
}

function paintBookshelf(p: Pix, rng: Rng): void {
  const planks = base('planks_oak');
  p.copy(planks);
  const spines = [
    ['#5a1a16', '#7a2620', '#9a3428'],
    ['#1c2e5a', '#28417a', '#3a5898'],
    ['#1e4a24', '#2a6232', '#3a7c42'],
    ['#5e4420', '#7c5c2c', '#9a7638'],
    ['#4a2050', '#62306a', '#7c4486'],
    ['#6a5a2a', '#8c7a3a', '#b09a4e'],
    ['#2a2a2e', '#3c3c42', '#55555c'],
  ];
  const shelf = (y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y += 1) for (let x = 1; x < 31; x += 1) {
      p.set(x, y, '#24160a');
      p.H(x, y, 0.15);
    }
    let x = 1;
    while (x < 31) {
      const w = Math.min(31 - x, 2 + Math.floor(rng() * 3));
      const top = y0 + Math.floor(rng() * 4);
      const col = spines[Math.floor(rng() * spines.length)]!;
      const band = top + 2 + Math.floor(rng() * 2);
      for (let yy = top; yy <= y1; yy += 1) {
        for (let k = 0; k < w; k += 1) {
          let c = k === 0 ? col[2]! : k === w - 1 ? col[0]! : col[1]!;
          if (yy === top) c = col[2]!;
          if (yy === band || yy === y1 - 2) c = '#c8b27a';
          p.set(x + k, yy, c);
          p.H(x + k, yy, k === w - 1 ? 0.5 : 0.6);
        }
      }
      x += w;
      if (rng() < 0.15 && x < 29) x += 1;
    }
  };
  shelf(4, 14);
  shelf(19, 28);
  // Shelf boards.
  for (const [y0, y1] of [[0, 3], [15, 18], [29, 31]] as [number, number][]) {
    for (let y = y0; y <= y1; y += 1) for (let x = 0; x < W; x += 1) {
      let t = 0.55 + (rng() - 0.5) * 0.2;
      if (y === y0) t += 0.2;
      if (y === y1) t -= 0.3;
      p.set(x, y, tone(OAK, t));
      p.H(x, y, 0.65);
    }
  }
  for (let y = 0; y < W; y += 1) {
    p.set(0, y, tone(OAK, 0.6));
    p.set(31, y, tone(OAK, 0.25));
  }
}

const BARREL = ['#4a3019', '#5a3b1f', '#6a4626', '#7a522d', '#885d34', '#95683c', '#a27445'];

function paintBarrelSide(p: Pix, rng: Rng): void {
  const f = grainField(rng, 6, 0.4);
  const staves = [0, 5, 11, 16, 21, 27];
  const toneOf = staves.map(() => (rng() - 0.5) * 0.25);
  each((x, y) => {
    let s = 0;
    for (let i = 0; i < staves.length; i += 1) if (x >= staves[i]!) s = i;
    const lx = x - staves[s]!;
    const w = (staves[s + 1] ?? 32) - staves[s]!;
    let t = 0.5 + toneOf[s]! + (f(x * 0.5, y * 2) - 0.5) * 0.4;
    let h = 0.65;
    if (lx === 0) {
      p.set(x, y, '#2a1a0c');
      p.H(x, y, 0.1);
      return;
    }
    if (lx === 1) t += 0.18;
    if (lx === w - 1) {
      t -= 0.2;
      h = 0.55;
    }
    // Barrel bulge: middle a touch brighter.
    t += (1 - Math.abs(y - 15.5) / 16) * 0.08;
    p.set(x, y, tone(BARREL, t));
    p.H(x, y, h);
  });
  for (const hy of [5, 24]) {
    for (let x = 0; x < W; x += 1) {
      for (let k = 0; k < 3; k += 1) {
        const t = k === 0 ? 0.75 : k === 1 ? 0.5 : 0.2;
        p.set(x, hy + k, tone(DARK_IRON, t + (rng() - 0.5) * 0.1));
        p.H(x, hy + k, 0.8);
        p.S(x, hy + k, 0.6);
      }
      p.mul(x, hy + 3, 0.7);
    }
    for (const rx of [3, 19]) {
      p.set(rx, hy + 1, DARK_IRON[7]!);
      p.H(rx, hy + 1, 0.95);
    }
  }
}

function paintBarrelEnd(p: Pix, rng: Rng, hole: boolean): void {
  const f = grainField(rng, 6, 0.35);
  each((x, y) => {
    const board = Math.floor((y - 2) / 7);
    const ly = (y - 2) % 7;
    let t = 0.55 + (f(x * 2, y * 0.5) - 0.5) * 0.4 + ((board * 37) % 10) * 0.012;
    let h = 0.6;
    if (ly === 6) {
      t = 0.05;
      h = 0.15;
    } else if (ly === 0) t += 0.15;
    p.set(x, y, tone(BARREL, t));
    p.H(x, y, h);
    // Iron rim.
    const cheb = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
    if (cheb > 13.5) {
      const tt = cheb > 14.5 ? 0.2 : x < 16 && y < 16 ? 0.75 : 0.5;
      p.set(x, y, tone(DARK_IRON, tt));
      p.H(x, y, 0.8);
      p.S(x, y, 0.6);
    }
  });
  if (hole) {
    for (let y = 13; y <= 18; y += 1) for (let x = 13; x <= 18; x += 1) {
      const edge = x === 13 || y === 13 || x === 18 || y === 18;
      p.set(x, y, edge ? (x === 13 || y === 13 ? BARREL[0]! : BARREL[5]!) : '#1a0f06');
      p.H(x, y, edge ? 0.55 : 0.05);
    }
  }
}

const HAY = ['#7e5e18', '#9a7820', '#b4902a', '#c8a436', '#d8b646', '#e6c85a', '#f2da78'];

function paintHayTop(p: Pix, rng: Rng): void {
  each((x, y) => {
    p.set(x, y, tone(HAY, 0.35 + rng() * 0.3));
    p.H(x, y, 0.5);
  });
  // Straw ends: short strokes in random directions.
  for (let i = 0; i < 140; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const dir = Math.floor(rng() * 4);
    const t = 0.4 + rng() * 0.6;
    const [dx, dy] = dir === 0 ? [1, 0] : dir === 1 ? [0, 1] : dir === 2 ? [1, 1] : [1, -1];
    for (let k = 0; k < 3; k += 1) {
      p.set(x + dx * k, y + dy * k, tone(HAY, t - k * 0.1));
      p.H(x + dx * k, y + dy * k, 0.65);
    }
  }
  for (let i = 0; i < 40; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, HAY[0]!);
    p.H(x, y, 0.3);
  }
  // Binding frame.
  each((x, y) => {
    const cheb = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
    if (cheb > 14.5) {
      p.set(x, y, tone(HAY, 0.12));
      p.H(x, y, 0.4);
    }
  });
}

function paintHaySide(p: Pix, rng: Rng): void {
  each((x, y) => p.set(x, y, tone(HAY, 0.3 + rng() * 0.2)));
  // Vertical straw strands.
  for (let x = 0; x < W; x += 1) {
    let y = Math.floor(rng() * W);
    let left = W + 4;
    while (left > 0) {
      const len = 3 + Math.floor(rng() * 8);
      const t = 0.35 + rng() * 0.65;
      for (let k = 0; k < len; k += 1) {
        p.set(x, y + k, tone(HAY, k === len - 1 ? t - 0.3 : t));
        p.H(x, y + k, k === len - 1 ? 0.45 : 0.6 + t * 0.1);
      }
      y += len;
      left -= len;
    }
  }
  const band = ['#5a140c', '#7a1c12', '#962818', '#b03820', '#c44a2c'];
  for (const by of [6, 22]) {
    for (let x = 0; x < W; x += 1) {
      for (let k = 0; k < 4; k += 1) {
        let t = k === 0 ? 0.85 : k === 3 ? 0.1 : 0.5 + (rng() - 0.5) * 0.3;
        if ((x + k * 2) % 5 === 0 && k > 0 && k < 3) t -= 0.25;
        p.set(x, by + k, tone(band, t));
        p.H(x, by + k, 0.75);
      }
      p.mul(x, by + 4, 0.75);
      p.H(x, by + 4, 0.4);
    }
  }
}

function paintGlowstone(p: Pix, rng: Rng): void {
  const v = spacedVoronoi(rng, 4, 4, 0.8, 1);
  each((x, y) => {
    const i = y * W + x;
    const e = v.edge[i]!;
    p.H(x, y, e < 0.7 ? 0.15 : 0.5 + 0.4 * Math.sqrt(clamp01((e - 0.7) / 3)));
  });
  const crack = ['#3e2410', '#5a3616', '#74471c'];
  each((x, y) => {
    const i = y * W + x;
    const e = v.edge[i]!;
    const c = v.cells[v.owner[i]!]!;
    if (e < 0.7) {
      p.set(x, y, tone(crack, rng()));
      p.E(x, y, 0.05);
      return;
    }
    const t = 0.25 + c.tone * 0.4 + clamp01((e - 0.7) / 4) * 0.35 + lit(p, x, y) * 1.4 + (rng() - 0.5) * 0.15;
    p.set(x, y, tone(GOLD_GLOW, t));
    p.E(x, y, 0.75 + clamp01(t) * 0.25);
  });
}

// ------------------------------------------------------------------ functional blocks

function tableTopBand(p: Pix, rng: Rng): void {
  for (let y = 0; y < 5; y += 1) for (let x = 0; x < W; x += 1) {
    let t = 0.4 + (rng() - 0.5) * 0.2;
    if (y === 0) t = 0.85;
    if (y === 1) t = 0.6 + (rng() - 0.5) * 0.15;
    if (y === 4) t = 0.05;
    p.set(x, y, tone(OAK, t));
    p.H(x, y, y === 4 ? 0.2 : 0.75);
  }
  for (let y = 5; y < W; y += 1) {
    p.set(0, y, tone(OAK, 0.3));
    p.set(31, y, tone(OAK, 0.15));
  }
}

/** Sprite from a char map; ' ' / '.' skip; height & spec from a per-char table. */
function sprite(p: Pix, x0: number, y0: number, rows: readonly string[], map: Record<string, { c: string; h?: number; s?: number; e?: number }>): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x]!;
      const m = map[ch];
      if (!m) continue;
      put(p, x0 + x, y0 + y, m.c);
      if (inside(x0 + x, y0 + y)) {
        p.H(x0 + x, y0 + y, m.h ?? 0.8);
        p.S(x0 + x, y0 + y, m.s ?? 0);
        p.E(x0 + x, y0 + y, m.e ?? 0);
      }
    }
  });
}

const TOOL_MAP: Record<string, { c: string; h?: number; s?: number; e?: number }> = {
  k: { c: '#1c1c20', h: 0.6 },
  a: { c: '#e8ecf0', h: 0.85, s: 0.8 },
  b: { c: '#bcc3cb', h: 0.85, s: 0.8 },
  c: { c: '#8a929c', h: 0.8, s: 0.7 },
  d: { c: '#5c636c', h: 0.75, s: 0.6 },
  w: { c: '#c49058', h: 0.8 },
  m: { c: '#8e5e30', h: 0.8 },
  n: { c: '#5a3a1c', h: 0.75 },
  s: { c: '#2a1a0c', h: 0.2 },
};

function paintCraftingTop(p: Pix, rng: Rng): void {
  p.copy(base('planks_oak'));
  // Darker worktop frame.
  each((x, y) => {
    const cheb = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
    if (cheb > 13.5) {
      let t = 0.35 + (rng() - 0.5) * 0.15;
      if (cheb > 14.5) t = x === 0 || y === 0 ? 0.55 : 0.1;
      else if (x === 1 || y === 1) t = 0.6;
      p.set(x, y, tone(OAK, t - 0.1));
      p.H(x, y, 0.78);
    }
  });
  // 3x3 work grid: grooves with a lit lip on the lower-right side.
  const lines = [4, 12, 20, 27];
  for (const l of lines) {
    for (let k = 4; k <= 27; k += 1) {
      p.set(l, k, '#3a2712');
      p.H(l, k, 0.15);
      p.set(l + 1, k, tone(OAK, 0.85));
      p.set(k, l, '#3a2712');
      p.H(k, l, 0.15);
      p.set(k, l + 1, tone(OAK, 0.85));
    }
  }
  for (const l of lines) for (const m of lines) p.set(l, m, '#2a1a0a');
}

function paintCraftingSide(p: Pix, rng: Rng): void {
  p.copy(base('planks_oak'));
  tableTopBand(p, rng);
  // Hanging saw: handle on the left, toothed blade to the right.
  sprite(p, 5, 9, [
    '  nmmn',
    ' nwwwmn',
    ' nw  mn',
    ' nw  mnkkkkkkkkkkkkkkk',
    ' nwwwmnabbbbbbbbbbbbbbk',
    '  nmmn bbbbbbbbbbbbbbbk',
    '       cccccccccccccccck',
    '       dcdcdcdcdcdcdcdc',
    '        d d d d d d d d',
  ], TOOL_MAP);
  // Hook nails.
  for (const x of [8, 20]) {
    p.set(x, 7, '#2a2a2e');
    p.set(x, 8, '#55555c');
  }
  // A coil of rope / ruler below.
  sprite(p, 6, 22, [
    'wwwwwwwwwwwwwwwwwww',
    'mnmmnmmnmmnmmnmmnmn',
  ], TOOL_MAP);
}

function paintCraftingFront(p: Pix, rng: Rng): void {
  p.copy(base('planks_oak'));
  tableTopBand(p, rng);
  // Hammer.
  sprite(p, 4, 8, [
    'kkkkkkkk',
    'kaabbbck',
    'kbbbbcck',
    'kkkwmkkk',
    '   wm',
    '   wm',
    '   wm',
    '   wm',
    '   wm',
    '   wm',
    '   wm',
    '   wm',
    '   wn',
    '   nn',
  ], TOOL_MAP);
  // Pliers / tongs.
  sprite(p, 14, 8, [
    ' kk  kk',
    ' kak kak',
    '  kbkbk',
    '   kck',
    '   kdk',
    '  kcdck',
    '  kd kd',
    ' kd   kd',
    ' kd   kd',
    'kd     kd',
    'kn     kn',
    'kn     kn',
  ], TOOL_MAP);
  // Chisel.
  sprite(p, 25, 9, [
    ' k',
    'kak',
    'kbk',
    'kck',
    'kck',
    'kdk',
    'kwk',
    'kwk',
    'kmk',
    'kmk',
    'knk',
    ' k',
  ], TOOL_MAP);
  // Bench lip at the bottom.
  for (let x = 0; x < W; x += 1) {
    p.set(x, 27, tone(OAK, 0.85));
    p.set(x, 28, tone(OAK, 0.5));
    p.set(x, 29, tone(OAK, 0.1));
  }
}

const FSTONE = ['#4e4e53', '#5a5a5f', '#66666a', '#717174', '#7c7c7e', '#878787', '#939291', '#a09e9b'];

function paintFurnaceTop(p: Pix, rng: Rng): void {
  granular(p, rng, FSTONE, 5, 0.35, 0.6, 0.06, 0.05);
  each((x, y) => {
    p.S(x, y, 0.12);
    const dl = Math.min(x, y);
    const dr = Math.min(31 - x, 31 - y);
    if (dl < 2 && dl <= dr) {
      p.set(x, y, tone(FSTONE, dl === 0 ? 0.55 : 0.9));
      p.H(x, y, 0.5);
    } else if (dr < 2) {
      p.set(x, y, tone(FSTONE, dr === 0 ? 0.0 : 0.2));
      p.H(x, y, 0.5);
    }
  });
  // Inner recessed square.
  for (let k = 7; k <= 24; k += 1) {
    p.set(k, 7, FSTONE[1]!);
    p.set(7, k, FSTONE[1]!);
    p.set(k, 24, FSTONE[6]!);
    p.set(24, k, FSTONE[6]!);
    p.H(k, 7, 0.4);
    p.H(7, k, 0.4);
  }
}

function paintFurnaceSide(p: Pix, rng: Rng): void {
  paintStones(p, rng, { nx: 5, ny: 4, squash: 1.3, pal: FSTONE, mortar: MORTAR, mortarW: 0.6, lo: 0.55, hi: 0.75, toneVar: 0.3, k: 0.9 });
  // Top frame band of smooth stone.
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < W; x += 1) {
    const t = y === 0 ? 0.85 : y === 3 ? 0.05 : 0.55 + (rng() - 0.5) * 0.15;
    p.set(x, y, tone(FSTONE, t));
    p.H(x, y, y === 3 ? 0.3 : 0.75);
  }
}

function paintFurnaceFront(p: Pix, rng: Rng): void {
  p.copy(base('furnace_side'));
  // Stone lintel and jambs around the opening.
  const ox = 8;
  const oy = 16;
  const ow = 16;
  const oh = 12;
  for (let y = oy - 3; y < oy + oh + 2; y += 1) for (let x = ox - 2; x < ox + ow + 2; x += 1) {
    const edge = y < oy || y >= oy + oh || x < ox || x >= ox + ow;
    if (!edge) continue;
    let t = 0.55 + (rng() - 0.5) * 0.15;
    if (y === oy - 3 || x === ox - 2) t = 0.9;
    if (y === oy + oh + 1 || x === ox + ow + 1) t = 0.05;
    p.set(x, y, tone(FSTONE, t));
    p.H(x, y, 0.8);
  }
  // Fire box.
  const fireN = tileNoise(seedFrom(rng), 8);
  for (let y = oy; y < oy + oh; y += 1) for (let x = ox; x < ox + ow; x += 1) {
    const depth = (y - oy) / oh;
    const flame = depth * 1.25 - 0.35 + (fireN(x * 2, y) - 0.5) * 0.7;
    p.H(x, y, 0.05);
    if (flame > 0.2) {
      const t = clamp01(flame);
      p.set(x, y, tone(FIRE, t));
      p.E(x, y, 0.65 + t * 0.35);
    } else {
      p.set(x, y, y === oy ? '#0a0806' : '#16110d');
      p.E(x, y, 0.05);
    }
  }
  // Glowing coals on the grate.
  for (let x = ox; x < ox + ow; x += 1) {
    const c = rng() < 0.5 ? FIRE[6]! : FIRE[5]!;
    p.set(x, oy + oh - 1, rng() < 0.3 ? '#3a1a0a' : c);
    p.E(x, oy + oh - 1, 1);
  }
  // Top slot (ash vent).
  for (let x = 12; x < 20; x += 1) {
    p.set(x, 8, '#141210');
    p.set(x, 9, '#1c1916');
    p.H(x, 8, 0.1);
    p.H(x, 9, 0.1);
    p.set(x, 10, FSTONE[6]!);
  }
}

const CHEST = ['#4e3014', '#5e3a18', '#6e461e', '#7e5226', '#8e5e2e', '#9c6a36', '#a8763e', '#b6844a'];

function chestWood(p: Pix, rng: Rng, vertical: boolean): void {
  const f = grainField(rng, 6, 0.35);
  each((x, y) => {
    const a = vertical ? x : y;
    const b = vertical ? y : x;
    const board = Math.floor(a / 8);
    const la = a % 8;
    let t = 0.5 + (f(vertical ? x * 3 : b * 0.4, vertical ? b * 0.4 : y * 3) - 0.5) * 0.45 + ((board * 29) % 7) * 0.02;
    let h = 0.65;
    if (la === 7) {
      t = 0.02;
      h = 0.15;
    } else if (la === 0) t += 0.15;
    p.set(x, y, tone(CHEST, t));
    p.H(x, y, h);
  });
}

function ironEdges(p: Pix, w: number): void {
  each((x, y) => {
    const dl = Math.min(x, y);
    const dr = Math.min(31 - x, 31 - y);
    const d = Math.min(dl, dr);
    if (d >= w) return;
    let t = 0.45;
    if (dl === 0 && dl <= dr) t = 0.75;
    else if (d === w - 1) t = 0.15;
    if (dr === 0) t = 0.05;
    p.set(x, y, tone(DARK_IRON, t));
    p.H(x, y, 0.85);
    p.S(x, y, 0.6);
  });
}

function paintChestTop(p: Pix, rng: Rng): void {
  chestWood(p, rng, false);
  ironEdges(p, 2);
  for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27]] as const) rivet(p, x, y, DARK_IRON, 0.7, false);
}

function paintChestSide(p: Pix, rng: Rng): void {
  chestWood(p, rng, false);
  ironEdges(p, 2);
  // Lid seam iron band.
  for (let x = 0; x < W; x += 1) {
    for (let k = 0; k < 3; k += 1) {
      p.set(x, 11 + k, tone(DARK_IRON, k === 0 ? 0.75 : k === 1 ? 0.45 : 0.1));
      p.H(x, 11 + k, 0.85);
      p.S(x, 11 + k, 0.6);
    }
  }
}

function paintChestFront(p: Pix, rng: Rng): void {
  p.copy(base('chest_side'));
  sprite(p, 13, 9, [
    'kkkkkk',
    'kaabck',
    'kabbck',
    'kbccdk',
    'kbkkdk',
    'kckkdk',
    'kccddk',
    'kkkkkk',
  ], {
    k: { c: '#121214', h: 0.7 },
    a: { c: '#f2eccc', h: 0.95, s: 0.8 },
    b: { c: '#d8c88a', h: 0.95, s: 0.8 },
    c: { c: '#b09a54', h: 0.9, s: 0.75 },
    d: { c: '#7a6630', h: 0.85, s: 0.7 },
  });
}

const TNT_RED = ['#6e140c', '#8e1c10', '#ac2616', '#c83420', '#dc4a30', '#ec6a4a'];

function paintTntSide(p: Pix, rng: Rng): void {
  each((x, y) => {
    const lx = x % 4;
    let t = lx === 0 ? 0.75 : lx === 3 ? 0.12 : 0.5;
    t += (rng() - 0.5) * 0.14;
    p.set(x, y, tone(TNT_RED, t));
    p.H(x, y, lx === 3 ? 0.4 : 0.7);
    if (y === 0 || y === 31) p.set(x, y, tone(TNT_RED, 0.05));
  });
  // White paper band.
  const paper = ['#a6a49c', '#c6c4bc', '#dedcd4', '#eeece6', '#fafaf6'];
  for (let y = 10; y <= 21; y += 1) for (let x = 0; x < W; x += 1) {
    let t = 0.65 + (rng() - 0.5) * 0.2;
    if (y === 10) t = 0.95;
    if (y === 21) t = 0.05;
    p.set(x, y, tone(paper, t));
    p.H(x, y, 0.8);
  }
  const T = ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'];
  const N = ['##...##', '###..##', '###..##', '####.##', '##.####', '##..###', '##..###', '##...##'];
  const letters: [readonly string[], number][] = [[T, 5], [N, 12], [T, 21]];
  for (const [g, x0] of letters) {
    g.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx += 1) {
        if (row[xx] !== '#') continue;
        p.set(x0 + xx, 12 + yy, '#1c1616');
        p.H(x0 + xx, 12 + yy, 0.65);
      }
    });
  }
}

function tntEnd(p: Pix, rng: Rng, fuse: boolean): void {
  each((x, y) => {
    const cx = (x % 8) - 3.5;
    const cy = (y % 8) - 3.5;
    const r = Math.hypot(cx, cy);
    let t: number;
    if (r > 3.9) t = 0.05;
    else if (r > 3) t = cx + cy < 0 ? 0.35 : 0.2;
    else t = 0.55 + (-(cx + cy) / 8) * 0.4 + (rng() - 0.5) * 0.1;
    if (r < 1) t = 0.15;
    p.set(x, y, tone(TNT_RED, t));
    p.H(x, y, r > 3.9 ? 0.2 : r < 1 ? 0.4 : 0.7);
  });
  if (fuse) {
    sprite(p, 13, 11, [
      '   kk',
      '  kaak',
      '  kbk',
      ' kbk',
      'kbbk',
      'kccck',
      'kddddk',
      ' kkkk',
    ], {
      k: { c: '#141414', h: 0.6 },
      a: { c: '#e6e2d6', h: 0.95 },
      b: { c: '#9a968c', h: 0.9 },
      c: { c: '#6a665e', h: 0.85 },
      d: { c: '#3e3a34', h: 0.8 },
    });
  }
}

function paintDispenserFront(p: Pix, rng: Rng): void {
  p.copy(base('furnace_side'));
  const cx = 15.5;
  const cy = 17;
  each((x, y) => {
    const r = Math.hypot(x + 0.5 - (cx + 0.5), y + 0.5 - (cy + 0.5));
    if (r > 8.2) return;
    const dx = x - cx;
    const dy = y - cy;
    if (r > 6.3) {
      const t = 0.5 - (dx + dy) / (r * 2.2) + (rng() - 0.5) * 0.1;
      p.set(x, y, tone(FSTONE, t));
      p.H(x, y, 0.85);
    } else {
      // Dark mouth: shadowed toward the top-left inner lip.
      const t = 0.15 + ((dx + dy) / 12) * 0.3 + (1 - r / 6.3) * 0.1;
      p.set(x, y, tone(['#08080a', '#101012', '#18181b', '#222226'], t));
      p.H(x, y, 0.05 + (r / 6.3) * 0.1);
    }
  });
}

function paintLadder(p: Pix, rng: Rng): void {
  clearAll(p);
  const f = grainField(rng, 6, 0.3);
  const wood = (x: number, y: number, t: number, h: number): void => {
    p.set(x, y, tone(OAK, t + (f(x, y) - 0.5) * 0.25));
    p.H(x, y, h);
  };
  for (let y = 0; y < W; y += 1) {
    for (const rx of [3, 25]) {
      wood(rx, y, 0.8, 0.7);
      wood(rx + 1, y, 0.55, 0.8);
      wood(rx + 2, y, 0.45, 0.75);
      wood(rx + 3, y, 0.15, 0.6);
    }
  }
  for (const ry of [3, 11, 19, 27]) {
    for (let x = 7; x < 25; x += 1) {
      wood(x, ry, 0.75, 0.7);
      wood(x, ry + 1, 0.5, 0.7);
      wood(x, ry + 2, 0.1, 0.55);
    }
    for (const nx of [5, 26]) {
      p.set(nx, ry + 1, '#3a3a40');
      p.set(nx - 1, ry, '#7a7a82');
      p.S(nx, ry + 1, 0.5);
    }
  }
}

function paintRedstoneWire(p: Pix, rng: Rng): void {
  clearAll(p);
  const n = tileNoise(seedFrom(rng), 16);
  each((x, y) => {
    const dx = Math.abs(x - 15.5);
    const dy = Math.abs(y - 15.5);
    const wob = (n(x, y) - 0.5) * 2.4;
    const inBar = dy < 2.8 + wob || dx < 2.8 + wob;
    const inHub = Math.hypot(dx, dy) < 5 + wob;
    if (!(inBar || inHub)) return;
    if (rng() < 0.03) return;
    const t = 0.35 + rng() * 0.55;
    p.set(x, y, tone(REDSTONE, t));
    p.E(x, y, 0.6);
    p.H(x, y, 0.55 + t * 0.1);
  });
}

function paintTorch(p: Pix, _rng: Rng, red: boolean): void {
  clearAll(p);
  const stick = ['#4a3018', '#6e4a26', '#8e6434', '#a87a42'];
  for (let y = 16; y < W; y += 1) {
    const cols = [0.9, 0.6, 0.4, 0.1];
    for (let k = 0; k < 4; k += 1) {
      p.set(14 + k, y, tone(stick, cols[k]!));
      p.H(14 + k, y, k === 3 ? 0.55 : 0.75);
    }
  }
  const flame = red
    ? ['.rr.', 'rRRr', 'RWWR', 'rRRr', 'drrd', 'dddd']
    : ['.oo.', 'oYYo', 'YWWY', 'oYYo', 'eooe', 'eeee'];
  const map: Record<string, [string, number]> = red
    ? { r: ['#d81c10', 0.9], R: ['#ff4a32', 1], W: ['#ffb0a0', 1], d: ['#7a120c', 0.6] }
    : { o: ['#f08a1a', 0.95], Y: ['#ffd23a', 1], W: ['#fff8d0', 1], e: ['#a8501a', 0.6] };
  flame.forEach((row, yy) => {
    for (let xx = 0; xx < 4; xx += 1) {
      const m = map[row[xx]!];
      if (!m) continue;
      p.set(14 + xx, 10 + yy, m[0]);
      p.E(14 + xx, 10 + yy, m[1]);
      p.H(14 + xx, 10 + yy, 0.8);
    }
  });
}

function paintLantern(p: Pix, rng: Rng): void {
  const amber = ['#9a4a10', '#b65e16', '#d07a22', '#e49634', '#f2b44a', '#fcd068', '#ffe9a0'];
  each((x, y) => {
    const dl = Math.min(x, y);
    const dr = Math.min(31 - x, 31 - y);
    const d = Math.min(dl, dr);
    if (d < 3) {
      let t = 0.45 + (rng() - 0.5) * 0.12;
      if (dl === 0 && dl <= dr) t = 0.75;
      else if (dr === 0) t = 0.05;
      else if (d === 2) t = dl === 2 ? 0.15 : 0.6;
      p.set(x, y, tone(DARK_IRON, t));
      p.H(x, y, 0.85);
      p.S(x, y, 0.6);
      return;
    }
    // Glass: brighter toward the flame in the middle.
    const r = Math.hypot(x - 15.5, (y - 16.5) * 0.8);
    const t = 0.85 - r / 16 + (rng() - 0.5) * 0.12;
    p.set(x, y, tone(amber, t));
    p.E(x, y, 0.75);
    p.H(x, y, 0.5);
    p.S(x, y, 0.5);
  });
  for (const [x, y] of [[1, 1], [29, 1], [1, 29], [29, 29]] as const) rivet(p, x, y, DARK_IRON, 0.7, true);
  // Central vertical glazing bar.
  sprite(p, 14, 12, [
    '  W ',
    ' WY ',
    ' YYo',
    'oYWY',
    'oWWY',
    'YWWY',
    'oYYo',
    ' oo ',
  ], {
    W: { c: '#fffbe8', e: 1, h: 0.6 },
    Y: { c: '#ffe066', e: 1, h: 0.6 },
    o: { c: '#ffa030', e: 1, h: 0.6 },
  });
  // Wick.
  p.set(15, 20, '#3a2010');
  p.set(16, 20, '#3a2010');
}

function paintLanternTop(p: Pix, rng: Rng): void {
  plate(p, rng, 0, 0, 32, 32, DARK_IRON, 0.6, 3, null);
  each((x, y) => {
    const r = Math.hypot(x - 15.5, y - 15.5);
    if (r > 3 && r < 5.5) {
      const t = 0.6 - ((x - 15.5) + (y - 15.5)) / 12;
      p.set(x, y, tone(DARK_IRON, t + 0.15));
      p.H(x, y, 0.95);
      p.S(x, y, 0.7);
    } else if (r <= 3) {
      p.set(x, y, DARK_IRON[0]!);
      p.H(x, y, 0.2);
    }
  });
  for (const [x, y] of [[5, 5], [25, 5], [5, 25], [25, 25]] as const) rivet(p, x, y, DARK_IRON, 0.7, false);
}

function chainLinks(p: Pix, cx: number, y0: number, h: number, faceOn: boolean, pal: readonly string[]): void {
  // A face-on link is an oval ring; an edge-on link is a narrow bar.
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = cx - 4; x <= cx + 3; x += 1) {
      const dx = (x + 0.5 - cx) / (faceOn ? 4 : 1.5);
      const dy = (y + 0.5 - (y0 + h / 2)) / (h / 2);
      const r = Math.hypot(dx, dy);
      const ring = faceOn ? r <= 1 && r > 0.5 : r <= 1;
      if (!ring) continue;
      const light = -(dx + dy * 0.5);
      const t = 0.5 + light * 0.4 + (faceOn && r < 0.7 ? -0.2 : 0);
      p.set(x, y, tone(pal, t));
      p.H(x, y, 0.6 + (1 - r) * 0.3);
      p.S(x, y, 0.6);
    }
  }
}

function paintChain(p: Pix, _rng: Rng): void {
  clearAll(p);
  const pal = ['#15161a', '#1e2026', '#2a2c33', '#363940', '#43474f', '#535861', '#686e78'];
  chainLinks(p, 16, 12, 9, false, pal);
  chainLinks(p, 16, 28, 9, false, pal); // wraps across the tile edge
  chainLinks(p, 16, 1, 13, true, pal);
  chainLinks(p, 16, 17, 13, true, pal);
}

interface GearOpts {
  cx: number;
  cy: number;
  rOut: number;
  rRoot: number;
  teeth: number;
  hub: number;
  holes: number;
  pal: readonly string[];
  spec: number;
  rot: number;
}

/** Draws a gear disc; returns nothing. Pixels outside the gear are left untouched. */
function gear(p: Pix, o: GearOpts, bg: string | null): void {
  each((x, y) => {
    const dx = x + 0.5 - o.cx;
    const dy = y + 0.5 - o.cy;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx) + o.rot;
    const ph = ((((a / TAU) * o.teeth) % 1) + 1) % 1;
    const tooth = Math.abs(ph - 0.5) < 0.24;
    const lim = tooth ? o.rOut : o.rRoot;
    if (r > lim) return;
    const light = -(dx + dy) / (Math.SQRT2 * Math.max(r, 0.01));
    let t = 0.5;
    let h = 0.75;
    // Spoke holes between the hub and the rim.
    const midR = (o.hub + o.rRoot - 2) / 2 + 0.5;
    if (o.holes > 0) {
      const ha = ((((Math.atan2(dy, dx) / TAU) * o.holes) % 1) + 1) % 1;
      const hd = Math.hypot((ha - 0.5) * ((TAU * midR) / o.holes), r - midR);
      if (hd < (o.rRoot - o.hub - 3) / 2) {
        if (bg) {
          p.set(x, y, bg);
          p.H(x, y, 0.05);
          p.S(x, y, 0);
        } else p.clear(x, y);
        return;
      }
    }
    if (r > o.rRoot - 2) {
      t = 0.55 + light * 0.3;
      h = 0.85;
      if (r > lim - 1) t += light > 0 ? 0.15 : -0.2;
    } else if (r < o.hub) {
      t = r < o.hub * 0.45 ? 0.02 : 0.28 + light * 0.15;
      h = r < o.hub * 0.45 ? 0.1 : 0.6;
    } else if (r < o.hub + 1.5) {
      t = 0.75 + light * 0.25;
      h = 0.9;
    } else {
      t = 0.4 + light * 0.1;
      h = 0.65;
    }
    p.set(x, y, tone(o.pal, t));
    p.H(x, y, h);
    p.S(x, y, o.spec);
    p.E(x, y, 0);
  });
}

function paintGearbox(p: Pix, rng: Rng): void {
  each((x, y) => {
    p.set(x, y, '#0e0e11');
    p.H(x, y, 0.05);
  });
  gear(p, { cx: 16, cy: 16, rOut: 14, rRoot: 11.5, teeth: 10, hub: 4, holes: 5, pal: BRASS, spec: 0.75, rot: 0.15 }, '#0e0e11');
  // Iron frame in front of the gear.
  each((x, y) => {
    const dl = Math.min(x, y);
    const dr = Math.min(31 - x, 31 - y);
    const d = Math.min(dl, dr);
    if (d >= 4) return;
    let t = 0.5 + (rng() - 0.5) * 0.1;
    if (dl === 0 && dl <= dr) t = 0.8;
    else if (dr === 0) t = 0.05;
    else if (d === 3) t = dl === 3 ? 0.1 : 0.7;
    p.set(x, y, tone(DARK_IRON, t));
    p.H(x, y, 0.9);
    p.S(x, y, 0.6);
  });
  for (const [x, y] of [[1, 1], [29, 1], [1, 29], [29, 29], [15, 1], [15, 29], [1, 15], [29, 15]] as const) rivet(p, x, y, DARK_IRON, 0.7, false);
}

function paintGearboxTop(p: Pix, rng: Rng): void {
  plate(p, rng, 0, 0, 32, 32, DARK_IRON, 0.6, 3, 'h');
  // Brass bearing in the middle with the shaft end.
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    const r = Math.hypot(dx, dy);
    if (r > 8) return;
    const light = -(dx + dy) / (Math.SQRT2 * Math.max(r, 0.01));
    let t = 0.5 + light * 0.3;
    let h = 0.85;
    if (r > 7) t = light > 0 ? 0.8 : 0.1;
    else if (r < 3) {
      t = 0.35 - light * 0.2;
      h = 0.6;
    } else if (r < 4) {
      t = 0.1;
      h = 0.4;
    }
    p.set(x, y, tone(BRASS, t));
    p.H(x, y, h);
    p.S(x, y, 0.75);
  });
  for (const [x, y] of [[4, 4], [26, 4], [4, 26], [26, 26]] as const) rivet(p, x, y, DARK_IRON, 0.7, true);
}

function ironBand(p: Pix, x0: number, y0: number, w: number, h: number, spec = 0.6): void {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) {
    const ly = y - y0;
    const lx = x - x0;
    let t = 0.45;
    if (ly === 0 || lx === 0) t = 0.75;
    if (ly === h - 1 || lx === w - 1) t = 0.12;
    p.set(x, y, tone(DARK_IRON, t));
    p.H(x, y, 0.85);
    p.S(x, y, spec);
  }
}

function paintPistonTop(p: Pix, rng: Rng): void {
  p.copy(base('planks_oak'));
  ironBand(p, 0, 0, 32, 3);
  ironBand(p, 0, 29, 32, 3);
  ironBand(p, 0, 0, 3, 32);
  ironBand(p, 29, 0, 3, 32);
  ironBand(p, 14, 3, 4, 26);
  ironBand(p, 3, 14, 26, 4);
  for (const [x, y] of [[15, 15], [5, 15], [25, 15], [15, 5], [15, 25]] as const) rivet(p, x, y, DARK_IRON, 0.7, false);
  void rng;
}

function paintPistonSide(p: Pix, rng: Rng): void {
  p.copy(base('cobble'));
  const planks = base('planks_oak');
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < W; x += 1) {
    const c = planks.get(x, y);
    p.set(x, y, [c[0], c[1], c[2]]);
    p.H(x, y, planks.getH(x, y));
  }
  ironBand(p, 0, 7, 32, 2);
  // Iron trim pin in the middle and corner straps.
  ironBand(p, 14, 9, 4, 6);
  ironBand(p, 0, 9, 2, 23);
  ironBand(p, 30, 9, 2, 23);
  rivet(p, 15, 11, DARK_IRON, 0.7, false);
  void rng;
}

function paintPistonBottom(p: Pix, rng: Rng): void {
  p.copy(base('cobble'));
  ironBand(p, 10, 10, 12, 12);
  for (let y = 13; y < 19; y += 1) for (let x = 13; x < 19; x += 1) {
    p.set(x, y, tone(DARK_IRON, 0.2 + rng() * 0.1));
    p.H(x, y, 0.5);
  }
  rivet(p, 15, 15, DARK_IRON, 0.7, false);
}

function paintRedstoneLamp(p: Pix, rng: Rng): void {
  const frame = ['#2e1a0c', '#3e2412', '#4e2e18', '#5e3a1e', '#704626'];
  const v = spacedVoronoi(rng, 3, 3, 0.8, 1, false);
  each((x, y) => {
    const dl = Math.min(x, y);
    const dr = Math.min(31 - x, 31 - y);
    const d = Math.min(dl, dr);
    if (d < 3) {
      let t = 0.5 + (rng() - 0.5) * 0.2;
      if (dl === 0 && dl <= dr) t = 0.9;
      else if (dr === 0) t = 0.05;
      else if (d === 2) t = dl === 2 ? 0.1 : 0.7;
      p.set(x, y, tone(frame, t));
      p.H(x, y, 0.8);
      return;
    }
    const i = y * W + x;
    const e = v.edge[i]!;
    const c = v.cells[v.owner[i]!]!;
    if (e < 0.6) {
      p.set(x, y, '#8a4a16');
      p.E(x, y, 0.45);
      p.H(x, y, 0.4);
      return;
    }
    const r = Math.hypot(x - 15.5, y - 15.5);
    const t = 0.35 + c.tone * 0.25 + (1 - r / 16) * 0.35 + clamp01((e - 0.6) / 3) * 0.15 + (rng() - 0.5) * 0.1;
    p.set(x, y, tone(GOLD_GLOW, t));
    p.E(x, y, 0.8 + clamp01(t) * 0.2);
    p.H(x, y, 0.6);
  });
}

function heavyFrame(p: Pix, rng: Rng, w: number, pal: readonly string[], spec: number): void {
  each((x, y) => {
    const dl = Math.min(x, y);
    const dr = Math.min(31 - x, 31 - y);
    const d = Math.min(dl, dr);
    if (d >= w) return;
    let t = 0.5 + (rng() - 0.5) * 0.12;
    if (d === 0) t = dl <= dr ? 0.85 : 0.05;
    else if (d === 1) t = dl <= dr ? 0.65 : 0.25;
    else if (d === w - 1) t = dl === d ? 0.1 : 0.75;
    p.set(x, y, tone(pal, t));
    p.H(x, y, 0.9);
    p.S(x, y, spec);
  });
}

function paintCore(p: Pix, rng: Rng): void {
  const core = ['#3a0604', '#6a0e06', '#a01a08', '#d0360e', '#f06218', '#ff9a30', '#ffd060', '#fff4c0'];
  each((x, y) => {
    const r = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
    const ring = Math.sin(r * 1.6) * 0.06;
    const t = 1 - r / 11 + ring + (rng() - 0.5) * 0.08;
    p.set(x, y, tone(core, t));
    p.E(x, y, clamp01(0.5 + t * 0.6));
    p.H(x, y, 0.4);
  });
  // Containment grill lines across the reactor.
  for (const k of [11, 20]) for (let j = 6; j < 26; j += 1) {
    p.set(k, j, '#2a1410');
    p.E(k, j, 0.1);
    p.set(j, k, '#2a1410');
    p.E(j, k, 0.1);
    p.H(k, j, 0.8);
    p.H(j, k, 0.8);
  }
  heavyFrame(p, rng, 6, DARK_IRON, 0.6);
  for (const [x, y] of [[1, 1], [28, 1], [1, 28], [28, 28]] as const) rivet(p, x, y, DARK_IRON, 0.7, true);
  for (const [x, y] of [[15, 1], [15, 29], [1, 15], [29, 15]] as const) rivet(p, x, y, DARK_IRON, 0.7, false);
  // Clear frame glow.
  each((x, y) => {
    if (Math.min(x, y, 31 - x, 31 - y) < 6) p.E(x, y, 0);
  });
}

const GUNMETAL = ['#1a1c20', '#24272c', '#2e3238', '#393d44', '#454a52', '#535962', '#646a74', '#7a818c'];

function paintCannonTop(p: Pix, rng: Rng): void {
  for (const [x, y] of [[0, 0], [16, 0], [0, 16], [16, 16]] as const) {
    plate(p, rng, x, y, 16, 16, GUNMETAL, 0.55, 2, 'h');
    for (const [rx, ry] of [[3, 3], [11, 3], [3, 11], [11, 11]] as const) rivet(p, x + rx, y + ry, GUNMETAL, 0.7, true);
  }
  // Barrel mount socket.
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    const r = Math.hypot(dx, dy);
    if (r > 7) return;
    const light = -(dx + dy) / (Math.SQRT2 * Math.max(r, 0.01));
    if (r > 5) {
      p.set(x, y, tone(GUNMETAL, 0.55 + light * 0.4));
      p.H(x, y, 0.95);
      p.S(x, y, 0.6);
    } else {
      p.set(x, y, tone(GUNMETAL, 0.05 - light * 0.1 + 0.05));
      p.H(x, y, 0.05);
    }
  });
}

function paintCannonSide(p: Pix, rng: Rng): void {
  p.copy(base('stone_bricks'));
  plate(p, rng, 0, 0, 32, 20, GUNMETAL, 0.55, 2, 'h');
  for (let x = 2; x < 32; x += 7) {
    rivet(p, x, 3, GUNMETAL, 0.7, false);
    rivet(p, x, 16, GUNMETAL, 0.7, false);
  }
  // Seam between plates.
  for (let y = 1; y < 19; y += 1) {
    p.set(15, y, GUNMETAL[0]!);
    p.set(16, y, GUNMETAL[5]!);
    p.H(15, y, 0.3);
  }
  // Shadow cast on the stone below.
  for (let x = 0; x < W; x += 1) p.mul(x, 20, 0.6);
}

function paintThrusterSide(p: Pix, rng: Rng): void {
  p.copy(base('planks_oak'));
  // Vent slats.
  for (let y = 4; y < 28; y += 1) for (const x of [6, 10, 22, 26]) {
    p.set(x, y, '#2a1a0a');
    p.H(x, y, 0.1);
    p.set(x + 1, y, tone(OAK, 0.85));
  }
  // Iron corner brackets.
  for (const [x, y, sx, sy] of [[0, 0, 1, 1], [31, 0, -1, 1], [0, 31, 1, -1], [31, 31, -1, -1]] as const) {
    for (let k = 0; k < 9; k += 1) for (let w = 0; w < 3; w += 1) {
      for (const [px, py] of [[x + sx * k, y + sy * w], [x + sx * w, y + sy * k]] as const) {
        const t = w === 0 ? 0.7 : w === 2 ? 0.15 : 0.45;
        p.set(px, py, tone(DARK_IRON, t));
        p.H(px, py, 0.85);
        p.S(px, py, 0.6);
      }
    }
    rivet(p, x + sx * 5 - (sx < 0 ? 0 : 0), y + sy * 1, DARK_IRON, 0.7, false);
  }
  // Central iron bearing with the propeller shaft.
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    const r = Math.hypot(dx, dy);
    if (r > 7) return;
    const light = -(dx + dy) / (Math.SQRT2 * Math.max(r, 0.01));
    let t = 0.5 + light * 0.3;
    if (r > 6) t = light > 0 ? 0.75 : 0.05;
    if (r < 3) t = 0.2 - light * 0.15;
    p.set(x, y, tone(DARK_IRON, t));
    p.H(x, y, r < 3 ? 0.5 : 0.9);
    p.S(x, y, 0.65);
  });
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * TAU;
    const x = Math.round(16 + Math.cos(a) * 4.6 - 0.5);
    const y = Math.round(16 + Math.sin(a) * 4.6 - 0.5);
    p.set(x, y, DARK_IRON[7]!);
    p.H(x, y, 1);
  }
  void rng;
}

function paintHubSide(p: Pix, rng: Rng): void {
  const f = grainField(rng, 6, 0.4);
  each((x, y) => {
    p.set(x, y, tone(SPRUCE, 0.35 + (f(x, y) - 0.5) * 0.5));
    p.H(x, y, 0.4);
  });
  // Eight spokes radiating from the centre.
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * TAU;
      const s = seg(dx, dy, 0, 0, Math.cos(a) * 22, Math.sin(a) * 22);
      if (s.d < 1.7) {
        const t = 0.65 + (s.side > 0 ? 0.15 : -0.15) + (f(x * 2, y * 2) - 0.5) * 0.25;
        p.set(x, y, tone(OAK, t));
        p.H(x, y, 0.75);
        return;
      }
    }
  });
  // Axle cap.
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    const r = Math.hypot(dx, dy);
    if (r > 7.5) return;
    const light = -(dx + dy) / (Math.SQRT2 * Math.max(r, 0.01));
    if (r > 6.3) {
      p.set(x, y, tone(DARK_IRON, light > 0 ? 0.75 : 0.15));
      p.S(x, y, 0.6);
      p.H(x, y, 0.95);
    } else {
      const ring = Math.floor(r / 2) % 2;
      p.set(x, y, tone(OAK_END, 0.45 + ring * 0.2 + light * 0.2));
      p.H(x, y, 0.85);
    }
  });
  rivet(p, 15, 15, DARK_IRON, 0.75, true);
}

function paintGiantEye(p: Pix, rng: Rng): void {
  p.copy(base('mossy_cobble'));
  const iris = ['#3a1604', '#6a2a06', '#a04a0c', '#d27416', '#f49a26', '#ffc24a', '#ffe48e'];
  each((x, y) => {
    const dx = (x + 0.5 - 16) / 13;
    const dy = (y + 0.5 - 16) / 7.5;
    // Almond shaped eye.
    const almond = Math.abs(dy) + dx * dx * 0.95;
    if (almond > 1.25) return;
    if (almond > 0.98) {
      // Dark lid rim.
      p.set(x, y, tone(MORTAR, 0.2 + rng() * 0.3));
      p.H(x, y, 0.2);
      p.E(x, y, 0);
      return;
    }
    const r = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
    if (r < 6.5) {
      const t = 1 - r / 6.5 + (rng() - 0.5) * 0.15;
      p.set(x, y, tone(iris, t * 0.9 + 0.15));
      p.E(x, y, 1);
      p.H(x, y, 0.75);
      if (Math.abs(x + 0.5 - 16) < 1.1 && Math.abs(y + 0.5 - 16) < 5) {
        p.set(x, y, '#120804');
        p.E(x, y, 0.2);
      }
    } else {
      const t = 0.5 - dy * 0.35 + (rng() - 0.5) * 0.15;
      p.set(x, y, tone(['#a08a5a', '#bea770', '#d6c288', '#e8d8a4'], t));
      p.E(x, y, 0.5);
      p.H(x, y, 0.7);
    }
  });
  // Catch-light.
  p.set(13, 13, '#fffbe8');
  p.set(14, 13, '#fff0c0');
  p.set(13, 14, '#fff0c0');
}

function paintCrystal(p: Pix, rng: Rng, pal: readonly string[], crack: string, glowLo: number, glowHi: number, cells: number): void {
  const v = spacedVoronoi(rng, cells, cells, 0.85, 1);
  const isCrack = (x: number, y: number): boolean => v.edge[p.idx(x, y)]! < 0.55;
  each((x, y) => {
    const e = v.edge[y * W + x]!;
    p.H(x, y, e < 0.55 ? 0.1 : 0.55 + 0.35 * Math.sqrt(clamp01((e - 0.55) / 3)));
  });
  each((x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    if (isCrack(x, y)) {
      p.set(x, y, crack);
      p.E(x, y, 0);
      return;
    }
    // Each facet is a tilted plane: a gradient along its own direction, a lit top-left rim.
    const a = c.tone * TAU;
    const grad = ((x - c.x) * Math.cos(a) + (y - c.y) * Math.sin(a)) * 0.035;
    let t = 0.35 + c.tone * 0.3 + grad + clamp01(v.edge[i]! / 5) * 0.15 + (rng() - 0.5) * 0.06;
    if (isCrack(x - 1, y) || isCrack(x, y - 1)) t += 0.22;
    else if (isCrack(x + 1, y) || isCrack(x, y + 1)) t -= 0.18;
    p.set(x, y, tone(pal, t));
    p.E(x, y, glowLo + (glowHi - glowLo) * clamp01(t));
    p.S(x, y, 0.5);
  });
  // Sparkle highlights.
  for (let i = 0; i < 8; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (p.getH(x, y) < 0.6) continue;
    p.set(x, y, pal[pal.length - 1]!);
    p.set(x + 1, y - 1, pal[pal.length - 2]!);
    p.E(x, y, glowHi);
  }
}

function paintGiantHeart(p: Pix, rng: Rng): void {
  const pal = ['#3a0610', '#560a18', '#760f22', '#98182e', '#ba243c', '#d83a50', '#f06a78', '#ffb0b8'];
  paintCrystal(p, rng, pal, '#1e0408', 0.45, 0.85, 3);
  // A brighter heart-shaped core glowing through.
  each((x, y) => {
    const dx = (x + 0.5 - 16) / 8;
    const dy = -(y + 0.5 - 16.5) / 8;
    const q = dx * dx + dy * dy - 1;
    if (q * q * q - dx * dx * dy * dy * dy < 0 && p.getH(x, y) > 0.2) {
      p.mix(x, y, '#ff6a6a', 0.45);
      p.E(x, y, Math.min(1, p.glow[p.idx(x, y)]! + 0.2));
    }
  });
}

function paintCitadelHeart(p: Pix, rng: Rng): void {
  const pal = ['#0c260a', '#154212', '#1f601a', '#2e8424', '#46a632', '#6ac848', '#a0ea6e', '#d8ffa8'];
  paintCrystal(p, rng, pal, '#050805', 0.7, 1, 4);
  // Creeper face cracks (8x8 pattern scaled 2x, centred).
  const face = ['.##..##.', '.##..##.', '...##...', '..####..', '..####..', '..#..#..'];
  const isFace = (fx: number, fy: number): boolean => face[fy]?.[fx] === '#';
  // A bright halo around the face so it reads through the crystal facets.
  for (let y = 0; y < W; y += 1) for (let x = 0; x < W; x += 1) {
    const fx = Math.floor((x - 4) / 3);
    const fy = Math.floor((y - 7) / 3);
    if (x < 4 || y < 7 || isFace(fx, fy)) continue;
    let near = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 4 && ny >= 7 && isFace(Math.floor((nx - 4) / 3), Math.floor((ny - 7) / 3))) near = true;
    }
    if (near) {
      p.set(x, y, pal[6]!);
      p.E(x, y, 1);
      p.H(x, y, 0.7);
    }
  }
  face.forEach((row, fy) => {
    for (let fx = 0; fx < 8; fx += 1) {
      if (row[fx] !== '#') continue;
      for (let k = 0; k < 9; k += 1) {
        const x = 4 + fx * 3 + (k % 3);
        const y = 7 + fy * 3 + Math.floor(k / 3);
        p.set(x, y, '#081008');
        p.E(x, y, 0.05);
        p.H(x, y, 0.15);
      }
    }
  });
  // Extra black cracks.
  for (let c = 0; c < 3; c += 1) {
    let x = rng() * W;
    let y = rng() * W;
    let a = rng() * TAU;
    for (let i = 0; i < 9; i += 1) {
      p.set(Math.floor(x), Math.floor(y), '#040604');
      p.E(Math.floor(x), Math.floor(y), 0);
      a += (rng() - 0.5) * 1.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
}

// ------------------------------------------------------------------ machinery

const STEEL = ['#3a3e44', '#474c53', '#555a62', '#636971', '#717780', '#80878f', '#9299a2', '#a8afb7'];

function paintLegPlate(p: Pix, rng: Rng): void {
  plate(p, rng, 0, 0, 32, 32, STEEL, 0.5, 3, null);
  // Scratches.
  for (let i = 0; i < 6; i += 1) {
    const x = 4 + Math.floor(rng() * 22);
    const y = 4 + Math.floor(rng() * 22);
    const len = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < len; k += 1) p.set(x + k, y + (k > len / 2 ? 1 : 0), STEEL[rng() < 0.5 ? 6 : 2]!);
  }
  // Hex bolts at corners and edge midpoints.
  const bolt = (bx: number, by: number): void => {
    sprite(p, bx, by, [' ab ', 'abbc', 'bccd', ' dd '], {
      a: { c: STEEL[7]!, h: 1, s: 0.7 },
      b: { c: STEEL[5]!, h: 0.95, s: 0.6 },
      c: { c: STEEL[3]!, h: 0.9, s: 0.6 },
      d: { c: STEEL[0]!, h: 0.8, s: 0.5 },
    });
  };
  for (const [x, y] of [[4, 4], [24, 4], [4, 24], [24, 24], [14, 4], [14, 24], [4, 14], [24, 14]] as const) bolt(x, y);
}

function paintPistonRod(p: Pix, rng: Rng): void {
  const pal = ['#3e444c', '#565e68', '#727a84', '#8e96a0', '#aab2bb', '#c6ccd4', '#e2e6ea', '#f8fafc'];
  each((x, y) => {
    // Cylinder shading across x with a sharp highlight stripe.
    const u = (x + 0.5) / W;
    const shade = Math.sin(u * Math.PI);
    let t = shade * 0.75 + 0.05;
    if (x === 9 || x === 10) t = 0.98;
    if (x === 11) t = 0.85;
    if (x === 22) t = 0.7;
    t += (rng() - 0.5) * 0.04;
    p.set(x, y, tone(pal, t));
    p.H(x, y, 0.3 + shade * 0.6);
    p.S(x, y, 0.9);
  });
}

function paintBrass(p: Pix, rng: Rng): void {
  plate(p, rng, 0, 0, 32, 32, BRASS, 0.7, 2, 'h');
  for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27], [15, 3], [15, 27], [3, 15], [27, 15]] as const) rivet(p, x, y, BRASS, 0.8, true);
}

function paintGearFace(p: Pix, _rng: Rng): void {
  clearAll(p);
  gear(p, { cx: 16, cy: 16, rOut: 15, rRoot: 12.2, teeth: 9, hub: 4.5, holes: 6, pal: BRASS, spec: 0.75, rot: 0.2 }, null);
}

function paintCannonBarrel(p: Pix, rng: Rng): void {
  each((x, y) => {
    const v = (y + 0.5) / W;
    const shade = Math.sin(v * Math.PI);
    let t = shade * 0.6 + 0.05 + (rng() - 0.5) * 0.05;
    if (y === 8 || y === 9) t += 0.2;
    let h = 0.3 + shade * 0.5;
    const band = (x >= 5 && x <= 8) || (x >= 21 && x <= 24);
    if (band) {
      t += 0.22;
      h += 0.15;
      if (x === 5 || x === 21) t += 0.1;
      if (x === 8 || x === 24) t -= 0.25;
    }
    p.set(x, y, tone(GUNMETAL, t));
    p.H(x, y, h);
    p.S(x, y, 0.6);
  });
}

// ------------------------------------------------------------------ water

const WATER = ['#244f9e', '#2b5bb0', '#3266bd', '#3a6fc8', '#4a7fd2', '#5c90dc', '#76a6e6', '#9cc2f0'];

function paintWaterStill(p: Pix, rng: Rng): void {
  const a = tileFbm(seedFrom(rng), 3);
  const b = tileNoise(seedFrom(rng), 6);
  each((x, y) => {
    const v = a(x, y) * 0.7 + b(x, y) * 0.3;
    let t = 0.3 + v * 0.35;
    // Crisp ripple lines along noise contours.
    const c = (v * 7) % 1;
    if (c < 0.12) t += 0.35;
    else if (c < 0.2) t += 0.18;
    else if (c > 0.9) t -= 0.12;
    p.set(x, y, tone(WATER, t + (rng() - 0.5) * 0.06));
    p.S(x, y, 1);
  });
}

function paintWaterFlow(p: Pix, rng: Rng): void {
  const cols: number[] = [];
  const n = tileNoise(seedFrom(rng), 8);
  for (let x = 0; x < W; x += 1) cols.push(n(x, 0));
  each((x, y) => {
    p.set(x, y, tone(WATER, 0.25 + cols[x]! * 0.35 + (rng() - 0.5) * 0.08));
    p.S(x, y, 1);
  });
  // Vertical streaks (wrap vertically).
  for (let x = 0; x < W; x += 1) {
    const count = 1 + Math.floor(rng() * 2);
    for (let s = 0; s < count; s += 1) {
      const y0 = Math.floor(rng() * W);
      const len = 5 + Math.floor(rng() * 12);
      const t = 0.6 + rng() * 0.35;
      for (let k = 0; k < len; k += 1) p.set(x, y0 + k, tone(WATER, t - (k / len) * 0.25));
    }
  }
  // Foam flecks.
  for (let i = 0; i < 20; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const len = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < len; k += 1) p.set(x, y + k, k === 0 ? '#ffffff' : '#d6e8fa');
  }
}

// ------------------------------------------------------------------ sky & effects

function paintSun(p: Pix, rng: Rng): void {
  clearAll(p);
  const core = ['#fff4d0', '#fffae6', '#fffdf4'];
  const rim = ['#ffd878', '#ffe49a', '#ffecb4'];
  for (let y = 6; y < 26; y += 1) for (let x = 6; x < 26; x += 1) {
    const inCore = x >= 9 && x < 23 && y >= 9 && y < 23;
    if (inCore) p.set(x, y, tone(core, 0.4 + rng() * 0.6));
    else p.set(x, y, tone(rim, rng()));
    p.E(x, y, 1);
  }
}

function paintMoon(p: Pix, rng: Rng): void {
  clearAll(p);
  const pal = ['#8e94a4', '#a6acba', '#bcc1cc', '#d0d4dc', '#e2e5eb', '#f0f2f6'];
  for (let y = 7; y < 25; y += 1) for (let x = 7; x < 25; x += 1) {
    const edge = x === 7 || y === 7 || x === 24 || y === 24;
    p.set(x, y, tone(pal, edge ? 0.5 : 0.72 + rng() * 0.28));
    p.E(x, y, 1);
  }
  // Craters: a dark floor with a lit lower-right rim.
  const craters: [number, number, number, number][] = [[10, 10, 4, 3], [18, 9, 3, 2], [16, 15, 5, 4], [9, 18, 3, 3], [20, 20, 2, 2], [13, 21, 2, 2]];
  for (const [cx, cy, w, h] of craters) {
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) p.set(cx + x, cy + y, pal[(x + y) % 3 === 0 ? 1 : 2]!);
    for (let k = 0; k < w; k += 1) {
      p.set(cx + k, cy - 1, pal[0]!);
      p.set(cx + k, cy + h, pal[5]!);
    }
    for (let k = 0; k < h; k += 1) {
      p.set(cx - 1, cy + k, pal[1]!);
      p.set(cx + w, cy + k, pal[5]!);
    }
  }
}

function paintWhite(p: Pix): void {
  p.fill('#ffffff');
}

function softBlob(p: Pix, rng: Rng, color: Col, maxA: number, radius: number, light: Col | null, noiseAmt: number): void {
  const n = tileFbm(seedFrom(rng), 4);
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    const r = Math.hypot(dx, dy) / radius + (n(x, y) - 0.5) * noiseAmt;
    const a = clamp01(1 - r);
    const alpha = Math.round(maxA * Math.pow(a, 0.8));
    let c = rgbOf(color);
    if (light) c = lerpRGB(c, rgbOf(light), clamp01(-(dx + dy) / (radius * 1.5) + 0.3));
    p.set(x, y, c, alpha);
  });
}

function paintShadow(p: Pix): void {
  each((x, y) => {
    const r = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
    const a = clamp01(1 - r / 15);
    p.set(x, y, '#000000', Math.round(200 * Math.pow(a, 0.75)));
  });
}

function paintFlame(p: Pix, _rng: Rng): void {
  clearAll(p);
  sprite(p, 9, 5, [
    '      o',
    '     oo',
    '    ooo   o',
    '    oYoo oo',
    '   ooYYooo',
    '   oYYYYo',
    '  ooYWYYoo',
    '  oYYWWYYo',
    ' ooYWWWWYoo',
    ' oYYWWWWYYo',
    ' oYWWWWWWYo',
    'ooYWWWWWWYoo',
    'oYYWWWWWWYYo',
    'oYWWWWWWWWYo',
    'oYYWWWWWWYYo',
    'roYYWWWWYYor',
    ' rooYYYYoor',
    '  rrooooorr',
    '    rrrr',
  ], {
    r: { c: '#c03a0a', e: 1 },
    o: { c: '#f07a18', e: 1 },
    Y: { c: '#ffc838', e: 1 },
    W: { c: '#fff4c8', e: 1 },
  });
}

let crackStage: Int8Array | null = null;

/** One shared crack network; each pixel records the stage (0..9) it appears at. */
function crackNetwork(): Int8Array {
  if (crackStage) return crackStage;
  const stage = new Int8Array(W * W).fill(99);
  const rng = mulberry32(0x5eedc4a);
  const tips: [number, number, number][] = [];
  const mark = (x: number, y: number, s: number): void => {
    const k = ((((Math.floor(y) % W) + W) % W) * W) + (((Math.floor(x) % W) + W) % W);
    if (stage[k]! > s) stage[k] = s;
  };
  const walk = (x: number, y: number, a: number, len: number, s: number): void => {
    for (let i = 0; i < len; i += 1) {
      mark(x, y, s);
      a += (rng() - 0.5) * 0.9;
      x += Math.cos(a);
      y += Math.sin(a);
    }
    tips.push([x, y, a]);
  };
  // Stage 0: a small star from near the centre.
  for (let b = 0; b < 3; b += 1) walk(15 + rng() * 2, 15 + rng() * 2, (b / 3) * TAU + rng(), 5 + rng() * 3, 0);
  for (let s = 1; s < 10; s += 1) {
    const branches = 2 + Math.floor(s * 0.75);
    for (let b = 0; b < branches; b += 1) {
      if (tips.length > 0 && rng() < 0.6) {
        // Extend an existing tip, sometimes forking.
        const k = Math.floor(rng() * tips.length);
        const [x, y, a] = tips[k]!;
        if (rng() < 0.6) tips.splice(k, 1);
        walk(x, y, a + (rng() - 0.5) * 1.2, 4 + rng() * 6, s);
      } else {
        // A new fracture somewhere else on the face.
        walk(rng() * W, rng() * W, rng() * TAU, 4 + rng() * 5 + s * 0.3, s);
      }
    }
  }
  crackStage = stage;
  return stage;
}

function paintCrack(p: Pix, n: number): void {
  const stage = crackNetwork();
  each((x, y) => p.set(x, y, '#000000', 0));
  each((x, y) => {
    if (stage[y * W + x]! <= n) {
      p.set(x, y, '#141210', 190);
      // Lit lip on the lower-right side of the crack.
      const k = ((y + 1) % W) * W + ((x + 1) % W);
      if (stage[k]! > n && p.alpha(x + 1, y + 1) === 0) p.set(x + 1, y + 1, '#d8d4cc', 50);
    }
  });
}

// ------------------------------------------------------------------ items

function shapeFill(p: Pix, test: (x: number, y: number) => number | null, pal: readonly string[], spec = 0, glow = 0): void {
  each((x, y) => {
    const t = test(x + 0.5, y + 0.5);
    if (t === null) return;
    p.set(x, y, tone(pal, t));
    p.S(x, y, spec);
    p.E(x, y, glow);
    p.H(x, y, 0.7);
  });
}

const HANDLE = ['#3e2812', '#5a3a1a', '#7a5226', '#946632', '#ae7c40', '#c49452'];
const ITEM_IRON = ['#4e545c', '#6c737c', '#8c949d', '#aab1b9', '#c6ccd2', '#e0e4e8', '#f6f8fa'];

function stick(p: Pix, ax: number, ay: number, bx: number, by: number, w: number, pal: readonly string[]): void {
  shapeFill(p, (x, y) => {
    const s = seg(x, y, ax, ay, bx, by);
    if (s.d > w) return null;
    return 0.55 + (s.side < 0 ? 0.25 : -0.2) + (s.d < w * 0.4 ? 0.05 : 0);
  }, pal);
}

function paintPickaxe(p: Pix, _rng: Rng): void {
  clearAll(p);
  stick(p, 5.5, 27.5, 21, 12, 1.2, HANDLE);
  const cx = 5;
  const cy = 27;
  const R = 20.5;
  shapeFill(p, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx); // -pi/2 is up, 0 is right
    const lo = -Math.PI / 2 - 0.1;
    const hi = 0.1;
    if (a < lo || a > hi) return null;
    const f = (a - lo) / (hi - lo); // 0 top-left tip .. 1 bottom-right tip
    const thick = 1 + 1.9 * Math.pow(Math.sin(f * Math.PI), 0.7);
    const off = r - R;
    if (Math.abs(off) > thick) return null;
    // Lit outer (top-right) face, dark inner edge, darker tips.
    return 0.38 + (off / thick) * 0.3 + (off > thick - 1 ? 0.2 : 0) - (Math.abs(f - 0.5) > 0.4 ? 0.12 : 0);
  }, ITEM_IRON, 0.7);
  outline(p);
}

function paintSword(p: Pix, _rng: Rng): void {
  clearAll(p);
  // Blade from the guard to the tip at the top-right.
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 10, 22, 26.5, 5.5);
    if (s.d > 2.1 - s.t * 0.6) return null;
    if (s.t > 0.98 && s.d > 0.8) return null;
    return Math.abs(s.side) < 0.6 ? 0.85 : s.side < 0 ? 0.65 : 0.3;
  }, ITEM_IRON, 0.75);
  // Guard.
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 5.5, 18.5, 13.5, 26.5);
    if (s.d > 1.3) return null;
    return s.side > 0 ? 0.75 : 0.35;
  }, ['#3a2a14', '#5a4020', '#7a5a2c', '#9a7638', '#b89248']);
  // Grip and pommel.
  stick(p, 8.5, 23.5, 4.5, 27.5, 1, HANDLE);
  shapeFill(p, (x, y) => (Math.hypot(x - 4, y - 28) < 1.7 ? 0.6 : null), ['#3a2a14', '#5a4020', '#7a5a2c', '#9a7638', '#b89248']);
  outline(p);
}

function paintCannonItem(p: Pix, _rng: Rng): void {
  clearAll(p);
  // Wooden carriage.
  shapeFill(p, (x, y) => (inPoly([[6, 20], [22, 20], [24, 24], [5, 24]], x, y) ? 0.5 + (y < 21 ? 0.3 : 0) : null), HANDLE);
  // Barrel.
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 6, 19, 25, 10);
    const r = s.t > 0.88 ? 3.6 : 3 - s.t * 0.5;
    if (s.d > r) return null;
    let t = 0.5 - (s.side / r) * 0.35;
    if (s.t > 0.88) t += 0.15;
    if (s.t > 0.45 && s.t < 0.52) t += 0.2;
    return t;
  }, GUNMETAL, 0.6);
  // Muzzle bore.
  shapeFill(p, (x, y) => (Math.hypot(x - 25.6, y - 9.6) < 1.4 ? 0 : null), ['#08080a']);
  // Wheel.
  shapeFill(p, (x, y) => {
    const r = Math.hypot(x - 13, y - 23);
    if (r > 5) return null;
    if (r < 1.5) return 0.9;
    if (r > 3.8) return 0.35 - (x - 13 + y - 23) / 20;
    const a = Math.atan2(y - 23, x - 13);
    return Math.abs(Math.sin(a * 2)) < 0.35 ? 0.7 : null;
  }, HANDLE);
  outline(p);
}

function paintThrusterItem(p: Pix, _rng: Rng): void {
  clearAll(p);
  const blades = [-Math.PI / 2 + 0.3, Math.PI / 6 + 0.3, (5 * Math.PI) / 6 + 0.3];
  shapeFill(p, (x, y) => {
    const dx = x - 16;
    const dy = y - 16;
    for (const a of blades) {
      const u = dx * Math.cos(a) + dy * Math.sin(a);
      const v = -dx * Math.sin(a) + dy * Math.cos(a);
      if (u < 2 || u > 13) continue;
      const w = 3.4 * Math.sin(((u - 2) / 11) * Math.PI * 0.9 + 0.2);
      if (Math.abs(v - 0.8) < w) return 0.5 + ((v - 0.8) / w) * -0.3 + (u > 11 ? 0.1 : 0);
    }
    return null;
  }, OAK);
  shapeFill(p, (x, y) => {
    const r = Math.hypot(x - 16, y - 16);
    if (r > 3.6) return null;
    return r < 1.3 ? 0.95 : 0.5 - (x - 16 + y - 16) / 8;
  }, ITEM_IRON, 0.6);
  outline(p);
}

function paintWireItem(p: Pix, _rng: Rng): void {
  clearAll(p);
  const loops: [number, number][] = [[16, 21], [16, 16], [16, 11]];
  for (const [cx, cy] of loops) {
    shapeFill(p, (x, y) => {
      const e = Math.hypot((x - cx) / 10, (y - cy) / 5);
      if (e > 1 || e < 0.72) return null;
      const front = y > cy;
      return (front ? 0.65 : 0.35) + (e > 0.88 ? -0.15 : 0.1);
    }, REDSTONE, 0, 0.5);
  }
  // Dust grains sparkle on top.
  for (const [x, y] of [[9, 9], [21, 13], [12, 23], [24, 20], [7, 17]] as const) {
    p.set(x, y, REDSTONE[6]!);
    p.E(x, y, 0.7);
  }
  outline(p);
}

function paintLanternItem(p: Pix, _rng: Rng): void {
  clearAll(p);
  sprite(p, 8, 2, [
    '      kkkk      ',
    '     kc  ck     ',
    '     kc  ck     ',
    '      kddk      ',
    '   kkkkkkkkkk   ',
    '  kbbbbbbbbbbk  ',
    '  kccccccccccdk ',
    '  kakggggggkdk  ',
    '  kakgyyyygkdk  ',
    '  kakgyWWygkdk  ',
    '  kakgyWWygkdk  ',
    '  kakgyWWygkdk  ',
    '  kakgyyyygkdk  ',
    '  kakgyyyygkdk  ',
    '  kakggggggkdk  ',
    '  kakggggggkdk  ',
    '  kbbbbbbbbbbk  ',
    '  kccccccccccdk ',
    '   kddddddddk   ',
    '    kkkkkkkk    ',
  ], {
    k: { c: '#141518' },
    a: { c: '#5c616a', s: 0.6 },
    b: { c: '#4c5058', s: 0.6 },
    c: { c: '#33363d', s: 0.6 },
    d: { c: '#1f2126', s: 0.5 },
    g: { c: '#e08a26', e: 0.8 },
    y: { c: '#fcc652', e: 1 },
    W: { c: '#fff4c0', e: 1 },
  });
}

function paintChainItem(p: Pix, _rng: Rng): void {
  clearAll(p);
  const pal = ['#15161a', '#22242a', '#30333a', '#40444c', '#525760', '#686e78', '#8a909a'];
  for (let k = 0; k < 4; k += 1) {
    const cx = 8 + k * 5.6;
    const cy = 24 - k * 5.6;
    const face = k % 2 === 0;
    shapeFill(p, (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      // Rotate 45 degrees so links run along the diagonal.
      const u = (dx - dy) / Math.SQRT2;
      const v = (dx + dy) / Math.SQRT2;
      const e = Math.hypot(u / 5.8, v / (face ? 3.8 : 1.3));
      if (e > 1 || (face && e < 0.56)) return null;
      return 0.55 - (dx + dy) / 12 + (e > 0.82 ? -0.15 : 0.12);
    }, pal, 0.6);
  }
  outline(p, 0.6);
}

function paintFenceItem(p: Pix, rng: Rng): void {
  clearAll(p);
  const f = grainField(rng, 6, 0.3);
  const wood = (x: number, y: number, t: number): void => {
    p.set(x, y, tone(OAK, t + (f(x, y) - 0.5) * 0.2));
    p.H(x, y, 0.7);
  };
  for (const px of [6, 22]) for (let y = 3; y < 29; y += 1) {
    wood(px, y, y === 3 ? 0.9 : 0.75);
    wood(px + 1, y, 0.55);
    wood(px + 2, y, 0.45);
    wood(px + 3, y, 0.15);
  }
  for (const ry of [9, 19]) for (let x = 10; x < 22; x += 1) {
    wood(x, ry, 0.75);
    wood(x, ry + 1, 0.5);
    wood(x, ry + 2, 0.12);
  }
  outline(p);
}

function paintCoal(p: Pix, rng: Rng): void {
  clearAll(p);
  const pal = ['#0e0e10', '#18181b', '#222226', '#2e2e33', '#3c3c42', '#50505a', '#6c6c78'];
  const blobs: [number, number, number][] = [[15, 17, 8], [10, 13, 5], [21, 13, 5.5], [13, 22, 5], [20, 21, 5]];
  const v = voronoi(rng, 7, W, 1);
  shapeFill(p, (x, y) => {
    let inside2 = false;
    for (const [bx, by, br] of blobs) if (Math.hypot(x - bx, y - by) < br) inside2 = true;
    if (!inside2) return null;
    const i = Math.floor(y) * W + Math.floor(x);
    const c = v.cells[v.owner[i]!]!;
    return 0.25 + c.tone * 0.35 - (x - 16 + y - 16) / 40 + (v.edge[i]! < 0.6 ? -0.2 : 0);
  }, pal, 0.3);
  for (const [x, y] of [[10, 11], [11, 10], [19, 11], [14, 15], [13, 16]] as const) p.set(x, y, pal[6]!);
  outline(p, 0.5);
}

function paintIronIngot(p: Pix, _rng: Rng): void {
  clearAll(p);
  const top: [number, number][] = [[4, 15], [18, 8], [28, 13], [14, 20]];
  const front: [number, number][] = [[14, 20], [28, 13], [28, 18], [14, 25]];
  const left: [number, number][] = [[4, 15], [14, 20], [14, 25], [4, 20]];
  shapeFill(p, (x, y) => (inPoly(top, x, y) ? 0.72 + (x + y < 26 ? 0.12 : 0) : null), ITEM_IRON, 0.8);
  shapeFill(p, (x, y) => (inPoly(front, x, y) ? 0.45 : null), ITEM_IRON, 0.7);
  shapeFill(p, (x, y) => (inPoly(left, x, y) ? 0.25 : null), ITEM_IRON, 0.6);
  // Edge highlight along the top ridge.
  for (let k = 0; k <= 10; k += 1) put(p, 4 + k, 15 + Math.round(k / 2), ITEM_IRON[6]!);
  for (let k = 0; k <= 14; k += 1) put(p, 14 + k, 20 - Math.round(k / 2), ITEM_IRON[5]!);
  outline(p, 0.45);
}

function grainPile(p: Pix, rng: Rng, pal: readonly string[], glow: number): void {
  clearAll(p);
  shapeFill(p, (x, y) => {
    // Mound: wide base, rounded top.
    const dx = (x - 16) / 11;
    const dy = (y - 23) / 9;
    if (y > 26 || dx * dx + dy * dy > 1) return null;
    if (rng() < 0.12) return null;
    return 0.3 + rng() * 0.5 - dy * 0.15 - dx * 0.15;
  }, pal, 0, glow);
  // Scattered loose grains.
  for (let i = 0; i < 14; i += 1) {
    const x = 5 + Math.floor(rng() * 22);
    const y = 12 + Math.floor(rng() * 16);
    if (p.alpha(x, y) > 0) continue;
    p.set(x, y, tone(pal, 0.4 + rng() * 0.5));
    p.E(x, y, glow);
  }
  outline(p, 0.5);
}

function paintRedstoneDust(p: Pix, rng: Rng): void {
  grainPile(p, rng, REDSTONE, 0.6);
}

function paintGunpowder(p: Pix, rng: Rng): void {
  grainPile(p, rng, ['#2a2a2c', '#3c3c40', '#505056', '#66666c', '#7e7e84', '#9a9aa0', '#b8b8bc'], 0);
}

function paintBread(p: Pix, _rng: Rng): void {
  clearAll(p);
  const crust = ['#5a3410', '#7a4816', '#9a601e', '#b87a2a', '#cc9038', '#dca84e', '#eac46e'];
  shapeFill(p, (x, y) => {
    const dx = x - 16;
    const dy = y - 17;
    const u = (dx - dy) / Math.SQRT2;
    const v = (dx + dy) / Math.SQRT2;
    const e = Math.hypot(u / 13, v / 6.5);
    if (e > 1) return null;
    let t = 0.55 - v / 14 + (e > 0.85 ? -0.2 : 0);
    // Scoring cuts across the top.
    for (const s of [-6, -1, 4]) if (Math.abs(u - s - v * 0.6) < 0.8 && v < 1.5 && v > -4.5) t = 0.15;
    return t;
  }, crust);
  outline(p, 0.5);
}

function paintWheatItem(p: Pix, rng: Rng): void {
  clearAll(p);
  const pal = ['#7a5a16', '#9a7820', '#b8952c', '#cdac3c', '#dfc256', '#eed67a', '#f8e8a4'];
  const stalks: [number, number, number, number][] = [[6, 28, 20, 6], [7, 28, 24, 10], [6, 27, 15, 4]];
  for (const [ax, ay, bx, by] of stalks) {
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = 0; i <= len; i += 0.5) {
      const f = i / len;
      const x = Math.round(ax + (bx - ax) * f);
      const y = Math.round(ay + (by - ay) * f);
      if (f < 0.55) put(p, x, y, tone(pal, 0.3));
      else {
        put(p, x, y, tone(pal, 0.55));
        const k = Math.floor(i) % 3;
        if (k === 0) {
          put(p, x - 1, y, tone(pal, 0.85));
          put(p, x - 1, y - 1, tone(pal, 0.95));
        } else if (k === 1) {
          put(p, x + 1, y + 1, tone(pal, 0.4));
          put(p, x + 1, y, tone(pal, 0.65));
        }
      }
    }
  }
  // Tie around the bundle.
  for (const [x, y] of [[8, 24], [9, 23], [9, 25], [10, 24]] as const) put(p, x, y, '#8a2a1a');
  void rng;
  outline(p, 0.5);
}

// ------------------------------------------------------------------ registry

function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

export function installPainters(): void {
  const r = (name: string, painter: (p: Pix, rng: Rng) => void): void => register(name, painter, seedOf(name));

  // Terrain
  r('dirt', paintDirt);
  r('grass_top', paintGrassTop);
  r('grass_side', paintGrassSide);
  r('stone', paintStone);
  r('cobble', paintCobble);
  r('mossy_cobble', paintMossyCobble);
  r('sand', paintSand);
  r('gravel', paintGravel);
  r('snow', paintSnow);
  r('bedrock', paintBedrock);
  r('coal_ore', (p, rng) => paintOre(p, rng, { pal: ['#121214', '#1c1c20', '#26262b', '#323238', '#46464e'], count: 6, spec: 0.2, glow: 0 }));
  r('iron_ore', (p, rng) => paintOre(p, rng, { pal: ['#8a5e40', '#a8775a', '#c89272', '#dcab88', '#ecc6a4', '#f6dcc0'], count: 5, spec: 0.7, glow: 0 }));
  r('redstone_ore', (p, rng) => paintOre(p, rng, { pal: ['#6a0808', '#981010', '#c41a14', '#ea3424', '#ff6a50'], count: 6, spec: 0.3, glow: 0.5 }));
  r('andesite', paintAndesite);
  r('granite', paintGranite);
  r('path_top', paintPathTop);
  r('path_side', paintPathSide);
  r('farmland', paintFarmland);

  // Wood
  r('log_oak', paintBarkOak);
  r('log_oak_top', paintLogOakTop);
  r('planks_oak', (p, rng) => paintPlanks(p, rng, OAK, OAK_GAP));
  r('leaves_oak', (p, rng) => paintLeaves(p, rng, LEAF_OAK, false));
  r('log_birch', paintLogBirch);
  r('log_birch_top', paintLogBirchTop);
  r('leaves_birch', (p, rng) => paintLeaves(p, rng, LEAF_BIRCH, false));
  r('log_spruce', paintLogSpruce);
  r('log_spruce_top', paintLogSpruceTop);
  r('planks_spruce', (p, rng) => paintPlanks(p, rng, SPRUCE, SPRUCE_GAP));
  r('leaves_spruce', (p, rng) => paintLeaves(p, rng, LEAF_SPRUCE, true));

  // Plants
  r('tall_grass', paintTallGrass);
  r('fern', paintFern);
  r('poppy', paintPoppy);
  r('dandelion', paintDandelion);
  r('cornflower', paintCornflower);
  r('oxeye', paintOxeye);
  r('sugar_cane', paintSugarCane);
  r('wheat', paintWheat);
  r('vine', paintVine);

  // Built
  r('stone_bricks', paintStoneBricks);
  r('mossy_stone_bricks', paintMossyStoneBricks);
  r('cracked_stone_bricks', paintCrackedStoneBricks);
  r('bricks', paintClayBricks);
  r('smooth_stone', (p, rng) => paintSmoothStone(p, rng, false));
  r('smooth_stone_side', (p, rng) => paintSmoothStone(p, rng, true));
  r('iron_block', paintIronBlock);
  r('wool_white', (p, rng) => paintWool(p, rng, WOOL_W));
  r('wool_red', (p, rng) => paintWool(p, rng, WOOL_R));
  r('obsidian', paintObsidian);
  r('glass', paintGlass);
  r('bookshelf', paintBookshelf);
  r('barrel_top', (p, rng) => paintBarrelEnd(p, rng, true));
  r('barrel_side', paintBarrelSide);
  r('barrel_bottom', (p, rng) => paintBarrelEnd(p, rng, false));
  r('hay_top', paintHayTop);
  r('hay_side', paintHaySide);
  r('glowstone', paintGlowstone);

  // Functional
  r('crafting_table_top', paintCraftingTop);
  r('crafting_table_side', paintCraftingSide);
  r('crafting_table_front', paintCraftingFront);
  r('furnace_top', paintFurnaceTop);
  r('furnace_side', paintFurnaceSide);
  r('furnace_front', paintFurnaceFront);
  r('chest_top', paintChestTop);
  r('chest_side', paintChestSide);
  r('chest_front', paintChestFront);
  r('tnt_top', (p, rng) => tntEnd(p, rng, true));
  r('tnt_side', paintTntSide);
  r('tnt_bottom', (p, rng) => tntEnd(p, rng, false));
  r('dispenser_front', paintDispenserFront);
  r('ladder', paintLadder);
  r('redstone_wire', paintRedstoneWire);
  r('torch', (p, rng) => paintTorch(p, rng, false));
  r('redstone_torch', (p, rng) => paintTorch(p, rng, true));
  r('lantern', paintLantern);
  r('lantern_top', paintLanternTop);
  r('chain', paintChain);
  r('gearbox', paintGearbox);
  r('gearbox_top', paintGearboxTop);
  r('piston_top', paintPistonTop);
  r('piston_side', paintPistonSide);
  r('piston_bottom', paintPistonBottom);
  r('redstone_lamp', paintRedstoneLamp);
  r('core', paintCore);
  r('cannon_top', paintCannonTop);
  r('cannon_side', paintCannonSide);
  r('thruster_side', paintThrusterSide);
  r('hub_side', paintHubSide);
  r('giant_eye', paintGiantEye);
  r('giant_heart', paintGiantHeart);
  r('citadel_heart', paintCitadelHeart);

  // Machinery
  r('leg_plate', paintLegPlate);
  r('piston_rod', paintPistonRod);
  r('brass', paintBrass);
  r('gear_face', paintGearFace);
  r('cannon_barrel', paintCannonBarrel);

  // Water
  r('water_still', paintWaterStill);
  r('water_flow', paintWaterFlow);

  // Sky & effects
  r('sun', paintSun);
  r('moon', paintMoon);
  r('white', paintWhite);
  r('shadow', paintShadow);
  r('smoke', (p, rng) => softBlob(p, rng, '#c8c8c8', 220, 14, '#f4f4f4', 0.35));
  r('dust', (p, rng) => softBlob(p, rng, '#8a6a48', 200, 14, '#b89670', 0.35));
  r('flame', paintFlame);
  for (let i = 0; i < 10; i += 1) r(`crack${i}`, (p) => paintCrack(p, i));

  // Items
  r('ui_pickaxe', paintPickaxe);
  r('ui_sword', paintSword);
  r('cannon_item', paintCannonItem);
  r('thruster_item', paintThrusterItem);
  r('wire_item', paintWireItem);
  r('lantern_item', paintLanternItem);
  r('chain_item', paintChainItem);
  r('fence_item', paintFenceItem);
  r('coal', paintCoal);
  r('iron_ingot', paintIronIngot);
  r('redstone_dust', paintRedstoneDust);
  r('gunpowder', paintGunpowder);
  r('bread', paintBread);
  r('wheat_item', paintWheatItem);
}

/** Every texture name this module paints (handy for tests and contact sheets). */
export const PAINTED_NAMES: readonly string[] = [
  'dirt', 'grass_top', 'grass_side', 'stone', 'cobble', 'mossy_cobble', 'sand', 'gravel', 'snow', 'bedrock',
  'coal_ore', 'iron_ore', 'redstone_ore', 'andesite', 'granite', 'path_top', 'path_side', 'farmland',
  'log_oak', 'log_oak_top', 'planks_oak', 'leaves_oak', 'log_birch', 'log_birch_top', 'leaves_birch',
  'log_spruce', 'log_spruce_top', 'planks_spruce', 'leaves_spruce',
  'tall_grass', 'fern', 'poppy', 'dandelion', 'cornflower', 'oxeye', 'sugar_cane', 'wheat', 'vine',
  'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'bricks', 'smooth_stone', 'smooth_stone_side',
  'iron_block', 'wool_white', 'wool_red', 'obsidian', 'glass', 'bookshelf', 'barrel_top', 'barrel_side',
  'barrel_bottom', 'hay_top', 'hay_side', 'glowstone',
  'crafting_table_top', 'crafting_table_side', 'crafting_table_front', 'furnace_top', 'furnace_side',
  'furnace_front', 'chest_top', 'chest_side', 'chest_front', 'tnt_top', 'tnt_side', 'tnt_bottom',
  'dispenser_front', 'ladder', 'redstone_wire', 'torch', 'redstone_torch', 'lantern', 'lantern_top', 'chain',
  'gearbox', 'gearbox_top', 'piston_top', 'piston_side', 'piston_bottom', 'redstone_lamp', 'core',
  'cannon_top', 'cannon_side', 'thruster_side', 'hub_side', 'giant_eye', 'giant_heart', 'citadel_heart',
  'leg_plate', 'piston_rod', 'brass', 'gear_face', 'cannon_barrel', 'water_still', 'water_flow',
  'sun', 'moon', 'white', 'shadow', 'smoke', 'dust', 'flame',
  'crack0', 'crack1', 'crack2', 'crack3', 'crack4', 'crack5', 'crack6', 'crack7', 'crack8', 'crack9',
  'ui_pickaxe', 'ui_sword', 'cannon_item', 'thruster_item', 'wire_item', 'lantern_item', 'chain_item',
  'fence_item', 'coal', 'iron_ingot', 'redstone_dust', 'gunpowder', 'bread', 'wheat_item',
];
