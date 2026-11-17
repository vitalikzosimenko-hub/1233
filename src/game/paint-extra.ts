// Extra procedural 32x32 painters: desert and snow biomes, the blighted Creeper Citadel lands,
// caves, turret blocks, quest / weather effects and quest items. Same conventions as paint.ts:
// only the seeded rng and tileable toolkit noise are used, relief writes height, metal / ice
// write specular and self-lit texels write glow.
import { base, hex, lerpRGB, register, tileFbm, tileNoise, voronoi, type Pix, type RGB } from './textures';
import type { Rng } from './rng';

type Col = string | RGB;
const W = 32;
export const TAU = Math.PI * 2;

// ------------------------------------------------------------------ small helpers (mirrors paint.ts)

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Discrete palette tone (dark -> light) for t in 0..1. */
export function tone(pal: readonly string[], t: number): string {
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

function put(p: Pix, x: number, y: number, c: Col, a = 255): void {
  if (inside(x, y)) p.set(x, y, c, a);
}

export function each(fn: (x: number, y: number) => void): void {
  for (let y = 0; y < W; y += 1) for (let x = 0; x < W; x += 1) fn(x, y);
}

function seedFrom(rng: Rng): number {
  return Math.floor(rng() * 2147483646) + 1;
}

/** Height slope toward the top-left light: > 0 lit, < 0 shaded. */
function lit(p: Pix, x: number, y: number): number {
  return p.getH(x + 1, y + 1) - p.getH(x - 1, y - 1);
}

export function clearAll(p: Pix): void {
  each((x, y) => {
    p.set(x, y, '#000000', 0);
    p.H(x, y, 0.5);
  });
  p.heightSet = false;
}

/** Wrapped horizontal distance. */
function wdx(a: number, b: number): number {
  let d = Math.abs(a - b) % W;
  if (d > W / 2) d = W - d;
  return d;
}

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

/** 1px item outline (a dark version of the neighbouring colour) around opaque shapes. */
export function outline(p: Pix, k = 0.42): void {
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
    p.E(x, y, 0);
  }
}

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

function granular(p: Pix, rng: Rng, pal: readonly string[], cells: number, grain: number, hBase = 0.4, hAmp = 0.25, bias = 0): void {
  const f = grainField(rng, cells, grain);
  each((x, y) => {
    const v = f(x, y) + bias;
    p.set(x, y, tone(pal, v));
    p.H(x, y, hBase + clamp01(v) * hAmp);
  });
}

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

/** Bevelled metal plate filling the rectangle (writes spec everywhere). */
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

export function shapeFill(p: Pix, test: (x: number, y: number) => number | null, pal: readonly string[], spec = 0, glow = 0): void {
  each((x, y) => {
    const t = test(x + 0.5, y + 0.5);
    if (t === null) return;
    p.set(x, y, tone(pal, t));
    p.S(x, y, spec);
    p.E(x, y, glow);
    p.H(x, y, 0.7);
  });
}

export function stick(p: Pix, ax: number, ay: number, bx: number, by: number, w: number, pal: readonly string[]): void {
  shapeFill(p, (x, y) => {
    const s = seg(x, y, ax, ay, bx, by);
    if (s.d > w) return null;
    return 0.55 + (s.side < 0 ? 0.25 : -0.2) + (s.d < w * 0.4 ? 0.05 : 0);
  }, pal);
}

/** Calls fn for each texel on a line (sub-pixel stepping, coordinates rounded). */
function line(ax: number, ay: number, bx: number, by: number, fn: (x: number, y: number, t: number) => void): void {
  const len = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
  let lx = Number.NaN;
  let ly = Number.NaN;
  for (let i = 0; i <= len; i += 1) {
    const t = i / len;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    fn(x, y, t);
  }
}

/** Toroidal distance between two points on the tile. */
function wrapDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(wdx(ax, bx), wdx(ay, by));
}

// ------------------------------------------------------------------ palettes

const SANDSTONE = ['#a68f58', '#b49d65', '#c1aa71', '#ccb67d', '#d6c189', '#dfcb95', '#e8d6a3', '#f1e2b4'];
const TERRACOTTA = ['#7a432e', '#874c34', '#93553b', '#9e5e41', '#a86747', '#b1704e', '#ba7a56', '#c4865f'];
const CACTUS = ['#0e3815', '#13471b', '#195721', '#206828', '#297a30', '#348c39', '#43a045', '#58b456'];
const SPINE = '#e6e2bc';
const DEAD = ['#3e2610', '#523316', '#66401c', '#7a4f24', '#8e5f2e', '#a2713a', '#b48448'];
const SNOW = ['#c3d0e2', '#cfdaea', '#dae3f1', '#e4ebf6', '#edf2fa', '#f6f9fd'];
const ICE = ['#7ea4d6', '#8bb0de', '#98bbe4', '#a6c6ea', '#b4d1ef', '#c4dcf4', '#d4e6f8', '#e6f1fc'];
const WOOL_BLUE = ['#1b2864', '#223177', '#2a3b8a', '#33469b', '#3d52aa', '#4960b9', '#5770c6'];
const WOOL_YELLOW = ['#9c7410', '#b48914', '#c89d1c', '#d8af26', '#e5bf33', '#efcd45', '#f7da5c'];
const BLIGHT = ['#1f1726', '#281e31', '#31263b', '#3a2e45', '#443750', '#4f415b', '#5b4c67', '#695a74'];
const ACID = ['#4e9a1c', '#78d02e', '#a4f04a', '#d0ff8a'];
const BLIGHT_MOSS = ['#140f1a', '#1c1524', '#241c2e', '#2b2635', '#2f3433', '#354434', '#3d5438', '#47643e'];
const LAVA = ['#5a1406', '#8a2208', '#b83a0c', '#de5a12', '#f2801e', '#ffa62e', '#ffcc52', '#ffe88e', '#fff6c8'];
const CRUST = ['#1e0a06', '#2e1008', '#40180a', '#54200c', '#6a2a0e'];
const EMERALD = ['#063c1c', '#0a5426', '#0f7032', '#159040', '#1eb050', '#3ccf6c', '#7aeb9c', '#c8ffda'];
const SILK = ['#9c9ca6', '#bcbcc6', '#d8d8e0', '#f0f0f4'];
const DARK_IRON = ['#16171b', '#1f2126', '#292b31', '#33363d', '#3f424a', '#4c5058', '#5c616a', '#70757f'];
const GUNMETAL = ['#1a1c20', '#24272c', '#2e3238', '#393d44', '#454a52', '#535962', '#646a74', '#7a818c'];
const OAK = ['#6a4826', '#7d5732', '#8e663b', '#a07444', '#b0824c', '#bd8f56', '#cb9d62', '#d9ad70'];
const SPRUCE = ['#33220f', '#422d17', '#4f371e', '#5c4126', '#684a2c', '#745433', '#815f3b', '#8e6b44'];
const BEAM = ['#3e2814', '#4e331a', '#5e3e20', '#6e4a28', '#7e5630', '#8e6238', '#9c6e42', '#aa7b4c'];
const ROPE = ['#4e3a1c', '#6a522a', '#86693a', '#a2834c', '#bc9c62', '#d2b47c', '#e2c896'];
export const HANDLE = ['#3e2812', '#5a3a1a', '#7a5226', '#946632', '#ae7c40', '#c49452'];
export const ITEM_IRON = ['#4e545c', '#6c737c', '#8c949d', '#aab1b9', '#c6ccd2', '#e0e4e8', '#f6f8fa'];
const GOLD = ['#5e3a06', '#8a5a0e', '#b47e18', '#d8a226', '#f0c03a', '#fcd862', '#fff0a6'];
const PARCH = ['#6a5030', '#8a6c40', '#a88852', '#c2a268', '#d6ba82', '#e6cf9c', '#f2e2b8'];
const BALL = ['#0c0d10', '#15171b', '#1e2126', '#282b31', '#33373e', '#41464e', '#575d66', '#7a818b'];

// ------------------------------------------------------------------ desert

function paintSandstoneTop(p: Pix, rng: Rng): void {
  granular(p, rng, SANDSTONE, 4, 0.22, 0.5, 0.1, 0.12);
  // Faint wind-packed grain: short horizontal streaks.
  for (let i = 0; i < 34; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const len = 2 + Math.floor(rng() * 4);
    const light = rng() < 0.5;
    for (let k = 0; k < len; k += 1) {
      p.set(x + k, y, light ? SANDSTONE[6]! : SANDSTONE[2]!);
      p.addH(x + k, y, light ? 0.03 : -0.03);
    }
  }
  for (let i = 0; i < 16; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, SANDSTONE[1]!);
  }
  p.bump = 0.5;
}

function paintSandstoneSide(p: Pix, rng: Rng): void {
  const f = grainField(rng, 6, 0.5);
  const strata = tileNoise(seedFrom(rng), 8);
  const wob = tileNoise(seedFrom(rng), 4);
  const band = (x: number, y: number): number => strata(5, y + (wob(x, y) - 0.5) * 3) - 0.5;
  each((x, y) => {
    if (y < 7) p.H(x, y, 0.62 + (f(x, y) - 0.5) * 0.03);
    else if (y === 7) p.H(x, y, 0.2);
    else p.H(x, y, 0.5 + (f(x, y) - 0.5) * 0.14 + band(x, y) * 0.1);
  });
  bakeLight(p, SANDSTONE, (x, y) => {
    if (y < 7) return 0.66 + (f(x, y) - 0.5) * 0.12 - (y === 6 ? 0.1 : 0);
    if (y === 7) return 0.08;
    let t = 0.44 + band(x, y) * 0.55 + (f(x, y) - 0.5) * 0.42;
    if (y === 31) t -= 0.14;
    return t;
  }, 1.2);
  // Lighter sand grains in the body.
  for (let i = 0; i < 26; i += 1) {
    const x = Math.floor(rng() * W);
    const y = 9 + Math.floor(rng() * 22);
    p.set(x, y, rng() < 0.5 ? SANDSTONE[6]! : SANDSTONE[1]!);
  }
  p.bump = 0.7;
}

function paintSandstoneBottom(p: Pix, rng: Rng): void {
  granular(p, rng, SANDSTONE, 6, 0.48, 0.45, 0.16, -0.06);
  for (let i = 0; i < 30; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const dark = rng() < 0.6;
    p.set(x, y, dark ? SANDSTONE[0]! : SANDSTONE[5]!);
    p.addH(x, y, dark ? -0.06 : 0.05);
  }
  p.bump = 0.6;
}

function paintCutSandstone(p: Pix, rng: Rng): void {
  const f = grainField(rng, 5, 0.25);
  each((x, y) => {
    const d = Math.min(x, y, 31 - x, 31 - y);
    let h = 0.6;
    if (d === 2) h = 0.18;
    else if (d < 2) h = 0.66;
    p.H(x, y, h + (f(x, y) - 0.5) * 0.02);
  });
  bakeLight(p, SANDSTONE, (x, y) => {
    const d = Math.min(x, y, 31 - x, 31 - y);
    if (d === 2) return 0.1;
    if (d === 0) return x === 0 || y === 0 ? 0.82 : 0.32;
    return 0.6 + (f(x, y) - 0.5) * 0.22;
  }, 1.3);
  // Centre seam: a faint horizontal joint as on a stacked slab.
  for (let x = 4; x < 28; x += 1) {
    p.set(x, 15, SANDSTONE[3]!);
    p.set(x, 16, SANDSTONE[6]!);
    p.H(x, 15, 0.52);
  }
  p.bump = 0.8;
}

function paintChiseledSandstone(p: Pix, rng: Rng): void {
  const f = grainField(rng, 5, 0.3);
  // Creeper glyph, 2x scale, carved into the middle panel.
  const face = ['.##..##.', '.##..##.', '...##...', '..####..', '..####..', '..#..#..'];
  const glyph = (x: number, y: number): boolean => {
    const fx = Math.floor((x - 8) / 2);
    const fy = Math.floor((y - 10) / 2);
    return x >= 8 && y >= 10 && face[fy]?.[fx] === '#';
  };
  each((x, y) => {
    let h = 0.55;
    if (y < 5 || y > 26) h = 0.66;
    else if (y === 5 || y === 26) h = 0.15;
    else if (x === 2 || x === 29) h = 0.25;
    if (y > 5 && y < 26 && glyph(x, y)) h = 0.18;
    p.H(x, y, h + (f(x, y) - 0.5) * 0.02);
  });
  bakeLight(p, SANDSTONE, (x, y) => {
    if (y === 5 || y === 26) return 0.06;
    if (y < 5 || y > 26) {
      let t = 0.66 + (f(x, y) - 0.5) * 0.14;
      if (y === 0) t += 0.12;
      if (y === 31) t -= 0.2;
      return t;
    }
    if (glyph(x, y)) return 0.18 + (f(x, y) - 0.5) * 0.1;
    if (x === 2 || x === 29) return 0.22;
    return 0.52 + (f(x, y) - 0.5) * 0.2;
  }, 1.3);
  // Small carved diamonds flanking the glyph.
  for (const cx of [5, 26]) {
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [0, 0]] as const) {
      p.set(cx + dx, 15 + dy, dx + dy < 0 ? SANDSTONE[1]! : dx + dy > 0 ? SANDSTONE[6]! : SANDSTONE[0]!);
      p.H(cx + dx, 15 + dy, 0.3);
    }
  }
  p.bump = 0.8;
}

function paintTerracotta(p: Pix, rng: Rng): void {
  granular(p, rng, TERRACOTTA, 4, 0.24, 0.48, 0.1);
  const m = tileFbm(seedFrom(rng), 6);
  each((x, y) => {
    const v = m(x, y);
    if (v > 0.66) p.mix(x, y, TERRACOTTA[7]!, 0.35);
    else if (v < 0.3) p.mix(x, y, TERRACOTTA[0]!, 0.35);
  });
  for (let i = 0; i < 22; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, rng() < 0.5 ? TERRACOTTA[1]! : TERRACOTTA[6]!);
  }
  p.bump = 0.4;
}

const CACTUS_RIBS = 5;

function paintCactusSide(p: Pix, rng: Rng): void {
  const g = grainField(rng, 8, 0.35);
  const rib = (x: number): number => Math.cos(((x + 0.5) / W) * TAU * CACTUS_RIBS);
  each((x, y) => {
    const r = rib(x);
    p.H(x, y, 0.45 + r * 0.28 + (g(x, y) - 0.5) * 0.05);
  });
  bakeLight(p, CACTUS, (x, y) => 0.42 + rib(x) * 0.28 + (g(x, y) - 0.5) * 0.3, 0.9);
  // Dark crease in every valley.
  const period = W / CACTUS_RIBS;
  for (let k = 0; k < CACTUS_RIBS; k += 1) {
    const vx = Math.floor(period * (k + 0.5));
    for (let y = 0; y < W; y += 1) {
      p.set(vx, y, tone(CACTUS, 0.02 + (g(vx, y) - 0.5) * 0.1));
      p.H(vx, y, 0.1);
    }
  }
  // Pale spines along the ridges, staggered per rib.
  for (let k = 0; k < CACTUS_RIBS; k += 1) {
    const rx = Math.round(period * k) % W;
    const off = Math.floor(rng() * 6);
    for (let y = off; y < W + off; y += 6) {
      const sy = y % W;
      p.set(rx, sy, SPINE);
      p.H(rx, sy, 0.95);
      p.set(rx + 1, sy + 1, tone(CACTUS, 0.15));
      if (rng() < 0.5) p.set(rx - 1, sy, '#c8c49a');
    }
  }
}

function cactusEnd(p: Pix, rng: Rng, top: boolean): void {
  const g = grainField(rng, 6, 0.4);
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    const cheb = Math.max(Math.abs(dx), Math.abs(dy));
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    let h = 0.55;
    let t: number;
    if (cheb > 15) {
      t = 0.1;
      h = 0.4;
    } else if (cheb > 13) {
      t = 0.4 + (cheb > 14 ? -0.1 : 0.05);
      h = 0.6;
    } else if (r < 6.5) {
      // Lighter crown in the centre.
      t = (top ? 0.78 : 0.48) - r * 0.03;
      h = 0.62;
    } else {
      // Rib ring: ribs radiate toward the centre.
      const ribs = Math.cos(a * 10);
      t = 0.42 + ribs * 0.14 + (top ? 0.08 : -0.1);
      h = 0.5 + ribs * 0.12;
      if (r < 7.5) t = top ? 0.32 : 0.22;
    }
    t += (g(x, y) - 0.5) * 0.18;
    p.set(x, y, tone(CACTUS, top ? t : t - 0.12));
    p.H(x, y, h);
  });
  if (top) {
    p.set(15, 15, SPINE);
    p.set(16, 16, tone(CACTUS, 0.5));
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * TAU + 0.3;
      const x = Math.round(15.5 + Math.cos(a) * 10);
      const y = Math.round(15.5 + Math.sin(a) * 10);
      p.set(x, y, SPINE);
      p.H(x, y, 0.95);
      p.set(x + 1, y + 1, tone(CACTUS, 0.1));
    }
  }
}

function paintDeadBush(p: Pix, rng: Rng): void {
  clearAll(p);
  const twig = (x: number, y: number, t: number): void => {
    if (!inside(x, y)) return;
    p.set(x, y, tone(DEAD, t));
    p.H(x, y, 0.7);
  };
  const branch = (x: number, y: number, a: number, len: number, depth: number): void => {
    let cx = x;
    let cy = y;
    let ang = a;
    for (let i = 0; i < len; i += 1) {
      ang += (rng() - 0.5) * 0.3 + (-Math.PI / 2 - ang) * 0.04;
      const nx = cx + Math.cos(ang);
      const ny = cy + Math.sin(ang);
      line(cx, cy, nx, ny, (px, py) => {
        twig(px, py, 0.55 + (Math.cos(ang) < 0 ? 0.2 : -0.05) - depth * 0.05 + (rng() - 0.5) * 0.15);
        if (depth === 0 && i < len * 0.5) twig(px + 1, py, 0.25);
      });
      cx = nx;
      cy = ny;
      if (depth < 2 && i > 2 && rng() < 0.24) {
        const side = rng() < 0.5 ? -1 : 1;
        branch(cx, cy, ang + side * (0.55 + rng() * 0.45), Math.max(3, Math.floor((len - i) * (0.5 + rng() * 0.3))), depth + 1);
      }
    }
    // Brittle tip: a lighter, sun-bleached end.
    if (inside(Math.round(cx), Math.round(cy))) twig(Math.round(cx), Math.round(cy), 0.95);
  };
  const stems: [number, number, number][] = [[15.5, -Math.PI / 2 + 0.08, 22], [14.5, -Math.PI / 2 - 0.42, 19], [16.5, -Math.PI / 2 + 0.5, 19], [14.5, -Math.PI / 2 - 0.85, 13], [16.5, -Math.PI / 2 + 0.95, 12]];
  for (const [x, a, len] of stems) branch(x, 30.5, a, len, 0);
  // Root crown.
  for (let x = 13; x <= 18; x += 1) twig(x, 31, x < 16 ? 0.3 : 0.15);
}

// ------------------------------------------------------------------ snow

function paintGrassSnowSide(p: Pix, rng: Rng): void {
  p.copy(base('dirt'));
  const n = tileNoise(seedFrom(rng), 8);
  const depth: number[] = [];
  for (let x = 0; x < W; x += 1) depth.push(5 + Math.floor(n(x, 3) * 2.99));
  for (let i = 0; i < 5; i += 1) {
    const x = Math.floor(rng() * W);
    depth[x] = Math.min(8, depth[x]! + 1 + Math.floor(rng() * 2));
    if (rng() < 0.5) depth[(x + 1) % W] = Math.max(depth[(x + 1) % W]!, depth[x]! - 1);
  }
  for (let x = 0; x < W; x += 1) {
    const d = depth[x]!;
    for (let y = 0; y < d; y += 1) {
      let t = 0.85 - (y / d) * 0.35 + (rng() - 0.5) * 0.25;
      if (y === d - 1) t -= 0.3;
      if (y === 0) t = 0.95;
      p.set(x, y, tone(SNOW, t));
      p.H(x, y, 0.72 - (y === d - 1 ? 0.08 : 0));
      p.S(x, y, y < 2 ? 0.2 : 0.1);
    }
    p.mul(x, d, 0.68);
    p.H(x, d, 0.3);
  }
  // A couple of glints in the snow lip.
  for (let i = 0; i < 6; i += 1) {
    const x = Math.floor(rng() * W);
    p.set(x, 1, '#ffffff');
    p.S(x, 1, 0.45);
  }
}

function paintIce(p: Pix, rng: Rng): void {
  const a = tileFbm(seedFrom(rng), 3);
  const streak = tileNoise(seedFrom(rng), 8);
  each((x, y) => {
    // Lighter diagonal streaks: noise sampled along the anti-diagonal only.
    const s = streak(x - y, (x - y) * 0.5 + 7);
    let t = 0.38 + (a(x, y) - 0.5) * 0.4 + (s > 0.62 ? 0.22 : s > 0.55 ? 0.1 : 0) + (rng() - 0.5) * 0.05;
    if (s < 0.25) t -= 0.08;
    p.set(x, y, tone(ICE, t));
    p.H(x, y, 0.6);
    p.S(x, y, 0.9);
  });
  // Long diagonal cracks that wrap across the tile edges.
  const cracks: [number, number, number, number][] = [[2, 31, 0.8, 40], [20, 29, 0.9, 22], [27, 9, 2.3, 9]];
  for (const [x0, y0, ang, len] of cracks) {
    let x = x0;
    let y = y0;
    let an = -ang;
    for (let i = 0; i < len; i += 1) {
      const px = Math.floor(x);
      const py = Math.floor(y);
      p.set(px, py, i % 7 === 3 ? ICE[7]! : ICE[6]!);
      p.H(px, py, 0.45);
      p.S(px, py, 0.6);
      p.set(px + 1, py + 1, ICE[1]!);
      an += (rng() - 0.5) * 0.25;
      x += Math.cos(an);
      y += Math.sin(an);
      if (rng() < 0.05) {
        // Short side fracture.
        const sa = an + (rng() < 0.5 ? 1 : -1) * 1.1;
        for (let k = 1; k < 4; k += 1) p.set(Math.floor(x + Math.cos(sa) * k), Math.floor(y + Math.sin(sa) * k), ICE[5]!);
      }
    }
  }
  // Frost sparkles.
  for (let i = 0; i < 4; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, '#ffffff');
    p.S(x, y, 1);
  }
  p.bump = 0.5;
}

function paintWool(p: Pix, rng: Rng, pal: readonly string[]): void {
  const f = grainField(rng, 4, 0.25);
  each((x, y) => {
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

// ------------------------------------------------------------------ blighted lands

function acidSpeck(p: Pix, rng: Rng, x: number, y: number, glow: number): void {
  const big = rng() < 0.35;
  p.set(x, y, big ? ACID[3]! : ACID[2]!);
  p.E(x, y, glow);
  p.H(x, y, 0.8);
  if (big) {
    p.set(x + 1, y, ACID[1]!);
    p.E(x + 1, y, glow * 0.8);
    p.set(x, y + 1, ACID[0]!);
    p.E(x, y + 1, glow * 0.6);
  }
}

function paintBlightGrassTop(p: Pix, rng: Rng): void {
  granular(p, rng, BLIGHT, 5, 0.5, 0.45, 0.25, -0.05);
  for (let i = 0; i < 110; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const t = 0.45 + rng() * 0.55;
    p.set(x, y, tone(BLIGHT, t));
    p.set(x, y + 1, tone(BLIGHT, t - 0.3));
    p.addH(x, y, 0.12);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, BLIGHT[0]!);
    p.H(x, y, 0.3);
  }
  // Sickly grey-green tint in patches.
  const n = tileFbm(seedFrom(rng), 4);
  each((x, y) => {
    if (n(x, y) > 0.62) p.mix(x, y, '#3e4a3a', 0.35);
  });
  for (let i = 0; i < 16; i += 1) acidSpeck(p, rng, Math.floor(rng() * W), Math.floor(rng() * W), 0.6);
}

function paintBlightGrassSide(p: Pix, rng: Rng): void {
  p.copy(base('dirt'));
  // Drained, ashen dirt.
  each((x, y) => p.mix(x, y, '#3a3036', 0.22));
  const n = tileNoise(seedFrom(rng), 8);
  const depth: number[] = [];
  for (let x = 0; x < W; x += 1) depth.push(5 + Math.floor(n(x, 3) * 3.2));
  for (let i = 0; i < 6; i += 1) {
    const x = Math.floor(rng() * W);
    depth[x] = depth[x]! + 1 + Math.floor(rng() * 3);
    if (rng() < 0.5) depth[(x + 1) % W] = Math.max(depth[(x + 1) % W]!, depth[x]! - 1);
  }
  for (let x = 0; x < W; x += 1) {
    const d = Math.min(9, depth[x]!);
    for (let y = 0; y < d; y += 1) {
      const t = 0.62 - (y / d) * 0.28 + (rng() - 0.5) * 0.38;
      p.set(x, y, tone(BLIGHT, y === d - 1 ? t - 0.22 : t));
      p.H(x, y, 0.7 - (y === d - 1 ? 0.08 : 0));
      p.S(x, y, 0);
    }
    p.mul(x, d, 0.72);
    p.H(x, d, 0.3);
  }
  for (let i = 0; i < 7; i += 1) {
    const x = Math.floor(rng() * W);
    acidSpeck(p, rng, x, Math.floor(rng() * Math.max(1, depth[x]! - 2)), 0.6);
  }
  // Corruption seeping into the dirt.
  for (let i = 0; i < 5; i += 1) {
    const x = Math.floor(rng() * W);
    const y = 11 + Math.floor(rng() * 19);
    p.set(x, y, ACID[0]!);
    p.E(x, y, 0.35);
  }
}

function paintBlightMoss(p: Pix, rng: Rng): void {
  const v = spacedVoronoi(rng, 6, 6, 0.9, 1.05);
  const g = grainField(rng, 8, 0.65);
  const hue = tileFbm(seedFrom(rng), 3);
  each((x, y) => {
    const i = y * W + x;
    const e = v.edge[i]!;
    // Soft, fuzzy clumps rather than hard stones.
    p.H(x, y, e < 0.5 ? 0.25 : 0.45 + 0.3 * Math.sqrt(clamp01((e - 0.5) / 2.5)) + (g(x, y) - 0.5) * 0.18);
  });
  bakeLight(p, BLIGHT_MOSS, (x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    // Patches lean violet (low tones) or corrupted green (high tones).
    return 0.12 + hue(x, y) * 0.45 + c.tone * 0.2 + (g(x, y) - 0.5) * 0.4 + (v.edge[i]! < 0.5 ? -0.12 : 0);
  }, 1.1);
  // Fibrous tufts.
  for (let i = 0; i < 60; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const t = 0.45 + rng() * 0.5 + (hue(x, y) - 0.5) * 0.4;
    p.set(x, y, tone(BLIGHT_MOSS, t));
    p.set(x, y + 1, tone(BLIGHT_MOSS, t - 0.3));
    p.addH(x, y, 0.08);
  }
  // Glowing veins snaking through the crevices.
  for (let c = 0; c < 3; c += 1) {
    let x = rng() * W;
    let y = rng() * W;
    let a = rng() * TAU;
    const len = 7 + Math.floor(rng() * 6);
    for (let i = 0; i < len; i += 1) {
      const px = Math.floor(x);
      const py = Math.floor(y);
      p.set(px, py, i % 4 === 0 ? ACID[3]! : ACID[2]!);
      p.E(px, py, 0.75);
      p.H(px, py, 0.2);
      if (rng() < 0.4) {
        p.mix(px + 1, py, ACID[0]!, 0.6);
        p.E(px + 1, py, 0.3);
      }
      a += (rng() - 0.5) * 1.1;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  p.bump = 0.9;
}

// ------------------------------------------------------------------ caves

function paintLavaStill(p: Pix, rng: Rng): void {
  const a = tileFbm(seedFrom(rng), 3);
  const b = tileNoise(seedFrom(rng), 5);
  const crust = tileFbm(seedFrom(rng), 4);
  const crackV = spacedVoronoi(rng, 5, 5, 0.9, 1);
  const g = grainField(rng, 8, 0.5);
  each((x, y) => {
    const v = a(x, y) * 0.7 + b(x, y) * 0.3;
    const c = crust(x, y);
    if (c > 0.6) {
      // Cooling crust plates: dark, raised, split by hot glowing cracks.
      const i = y * W + x;
      const deep = clamp01((c - 0.6) / 0.15);
      if (crackV.edge[i]! < 0.5 && deep < 0.9) {
        p.set(x, y, tone(LAVA, 0.3 + (1 - deep) * 0.3));
        p.H(x, y, 0.45);
        p.E(x, y, 1);
        return;
      }
      const t = 0.75 - deep * 0.45 + (g(x, y) - 0.5) * 0.45;
      p.set(x, y, tone(CRUST, t));
      p.H(x, y, 0.62 + deep * 0.12);
      p.E(x, y, 0.6);
      return;
    }
    let t = 0.32 + v * 0.6 + (g(x, y) - 0.5) * 0.12;
    // Thin bright seams where the melt churns.
    const r = (v * 4) % 1;
    if (r < 0.08) t += 0.22;
    // Melt darkens and cools near the crust.
    if (c > 0.54) t -= (c - 0.54) * 4;
    p.set(x, y, tone(LAVA, t));
    p.H(x, y, 0.4);
    p.E(x, y, 1);
  });
  // Crust edges catch light on their top-left lip.
  each((x, y) => {
    if (p.glow[p.idx(x, y)]! > 0.7) return;
    if (lit(p, x, y) < -0.1) p.mix(x, y, CRUST[4]!, 0.5);
  });
  // Bright bubbling spots.
  for (let i = 0; i < 7; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (p.glow[p.idx(x, y)]! < 1 || p.glow[p.idx(x + 1, y + 1)]! < 1) continue;
    p.set(x, y, LAVA[8]!);
    p.set(x + 1, y, LAVA[7]!);
    p.set(x, y + 1, LAVA[6]!);
  }
  p.bump = 0.7;
}

function paintLavaFlow(p: Pix, rng: Rng): void {
  const n = tileNoise(seedFrom(rng), 8);
  const cols: number[] = [];
  for (let x = 0; x < W; x += 1) cols.push(n(x, 0));
  each((x, y) => {
    p.set(x, y, tone(LAVA, 0.42 + cols[x]! * 0.28 + (rng() - 0.5) * 0.06));
    p.H(x, y, 0.4);
    p.E(x, y, 1);
  });
  // Bright vertical streams (wrap vertically).
  for (let x = 0; x < W; x += 1) {
    const count = 1 + Math.floor(rng() * 2);
    for (let s = 0; s < count; s += 1) {
      const y0 = Math.floor(rng() * W);
      const len = 6 + Math.floor(rng() * 12);
      const t = 0.62 + rng() * 0.3;
      for (let k = 0; k < len; k += 1) p.set(x, y0 + k, tone(LAVA, t - (k / len) * 0.22));
    }
  }
  // Crust chunks drifting downstream: dark, elongated, with a hot leading edge below.
  for (let i = 0; i < 6; i += 1) {
    const x0 = Math.floor(rng() * W);
    const y0 = Math.floor(rng() * W);
    const w = 2 + Math.floor(rng() * 2);
    const h = 4 + Math.floor(rng() * 5);
    for (let yy = 0; yy < h; yy += 1) {
      const inset = yy === 0 || yy === h - 1 ? 1 : 0;
      for (let xx = inset; xx < w - (yy === h - 1 ? 0 : inset); xx += 1) {
        const t = 0.45 + (xx === 0 ? 0.35 : xx === w - 1 ? -0.2 : 0) + (yy === 0 ? 0.15 : 0) + (rng() - 0.5) * 0.25;
        p.set(x0 + xx, y0 + yy, tone(CRUST, t));
        p.E(x0 + xx, y0 + yy, 0.6);
        p.H(x0 + xx, y0 + yy, 0.7);
      }
    }
    for (let xx = 0; xx < w; xx += 1) p.set(x0 + xx, y0 + h, LAVA[7]!);
    for (let xx = 0; xx < w; xx += 1) p.set(x0 + xx, y0 - 1, LAVA[2]!);
  }
  p.bump = 0.7;
}

function paintEmeraldOre(p: Pix, rng: Rng): void {
  p.copy(base('stone'));
  // One gem per row and column (a shuffled diagonal) plus a small extra, so they spread evenly.
  const cols = [0, 1, 2];
  for (let i = 2; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cols[i], cols[j]] = [cols[j]!, cols[i]!];
  }
  const slots: [number, number][] = cols.map((gx, gy) => [gx, gy]);
  const extra = Math.floor(rng() * 3);
  slots.push([(cols[extra]! + 1 + Math.floor(rng() * 2)) % 3, extra]);
  for (const [k, [gx, gy]] of slots.entries()) {
    const small = k === 3;
    // Elongated hexagonal crystal (row half-widths), like the emerald item.
    const rows = small ? [0, 1, 1, 0] : [0, 1, 2, 2, 2, 1, 0];
    const r = small ? 2 : 3;
    const cx = gx * 11 + 4 + Math.floor(rng() * 3) + (small ? 1 : 0);
    const cy = gy * 11 + 4 + Math.floor(rng() * 3);
    const top = small ? -1 : -3;
    const inGem = (dx: number, dy: number): boolean => {
      const hw = rows[dy - top];
      return hw !== undefined && Math.abs(dx) <= hw;
    };
    const mid = top + (rows.length - 1) / 2;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (!inGem(dx, dy)) continue;
        const x = cx + dx;
        const y = cy + dy;
        const rim = !inGem(dx - 1, dy) || !inGem(dx + 1, dy) || !inGem(dx, dy - 1) || !inGem(dx, dy + 1);
        const up = dy < mid - 0.6;
        const down = dy > mid + 0.6;
        let t: number;
        if (!rim && dx === 0) t = up ? 0.95 : down ? 0.55 : 0.82; // table ridge
        else if (up) t = dx < 0 ? 0.8 : 0.6;
        else if (down) t = dx < 0 ? 0.4 : 0.16;
        else t = dx < 0 ? 0.68 : 0.32;
        if (rim && !up) t -= 0.1;
        p.set(x, y, tone(EMERALD, t));
        p.H(x, y, rim ? 0.75 : 0.88);
        p.S(x, y, 0.8);
        p.E(x, y, 0.15);
      }
    }
    p.set(cx - 1, cy + top + 1, EMERALD[7]!);
    // Shadow cast onto the stone below-right.
    for (let dy = -r; dy <= r + 1; dy += 1) {
      for (let dx = -r; dx <= r + 1; dx += 1) {
        if (!inGem(dx, dy) && inGem(dx - 1, dy - 1)) {
          p.mul(cx + dx, cy + dy, 0.7);
          p.H(cx + dx, cy + dy, 0.3);
        }
      }
    }
  }
}

function paintCobweb(p: Pix, rng: Rng): void {
  clearAll(p);
  const cx = 15.5;
  const cy = 14.5;
  const silk = (x: number, y: number, t: number): void => {
    if (!inside(x, y)) return;
    p.set(x, y, tone(SILK, t));
    p.H(x, y, 0.6);
  };
  const spokes = 8;
  const ang: number[] = [];
  for (let k = 0; k < spokes; k += 1) ang.push((k / spokes) * TAU + 0.2 + (rng() - 0.5) * 0.3);
  // Radial threads out to the tile edge.
  for (const a of ang) {
    const ex = cx + Math.cos(a) * 24;
    const ey = cy + Math.sin(a) * 24;
    line(cx, cy, ex, ey, (x, y, t) => {
      if (t < 0.04) return;
      silk(x, y, 0.7 + (rng() - 0.5) * 0.5);
    });
  }
  // Sagging spiral rings between the spokes.
  for (const r0 of [3.5, 7, 10.5, 14]) {
    for (let k = 0; k < spokes; k += 1) {
      const a0 = ang[k]!;
      const a1 = ang[(k + 1) % spokes]! + (k === spokes - 1 ? TAU : 0);
      const r1 = r0 + 0.5;
      const ax = cx + Math.cos(a0) * r0;
      const ay = cy + Math.sin(a0) * r0;
      const bx = cx + Math.cos(a1) * r1;
      const by = cy + Math.sin(a1) * r1;
      // Slight inward sag at the middle of each span.
      const mx = cx + Math.cos((a0 + a1) / 2) * (r0 - 0.9);
      const my = cy + Math.sin((a0 + a1) / 2) * (r0 - 0.9);
      if (r0 > 12 && rng() < 0.3) continue;
      line(ax, ay, mx, my, (x, y) => silk(x, y, 0.95));
      line(mx, my, bx, by, (x, y) => silk(x, y, 0.95));
    }
  }
  // Knotted centre.
  silk(15, 14, 1);
  silk(16, 14, 0.6);
  silk(15, 15, 0.6);
}

function paintSpawner(p: Pix, rng: Rng): void {
  clearAll(p);
  const isBar = (x: number, y: number): boolean => {
    const d = Math.min(x, y, 31 - x, 31 - y);
    if (d < 2) return true;
    const gx = x % 8;
    const gy = y % 8;
    return gx === 0 || gx === 7 || gy === 0 || gy === 7;
  };
  each((x, y) => {
    if (!isBar(x, y)) return;
    // Bars are lit on their top-left side and shaded toward the gaps below / right.
    let t = 0.45 + (rng() - 0.5) * 0.12;
    const up = y > 0 && isBar(x, y - 1);
    const left = x > 0 && isBar(x - 1, y);
    const down = y < 31 && isBar(x, y + 1);
    const right = x < 31 && isBar(x + 1, y);
    if (!up || !left) t += 0.36;
    if (!down || !right) t -= 0.34;
    if (x === 0 || y === 0) t = 0.85;
    if (x === 31 || y === 31) t = 0.05;
    p.set(x, y, tone(DARK_IRON, t));
    p.H(x, y, 0.8);
    p.S(x, y, 0.5);
  });
  // Rivets on the frame crossings.
  for (const k of [7, 15, 23]) {
    for (const [x, y] of [[k, 0], [k, 30], [0, k], [30, k]] as const) {
      p.set(x, y, DARK_IRON[7]!);
      p.H(x, y, 0.95);
      p.S(x, y, 0.7);
    }
  }
  // Embers smouldering in the cage.
  const embers: [number, number][] = [[10, 15], [19, 23], [21, 7], [12, 24], [28, 16]];
  for (const [x, y] of embers) {
    p.set(x, y, '#ffb43a');
    p.E(x, y, 1);
    p.H(x, y, 0.6);
    p.set(x + 1, y, '#d0500e');
    p.E(x + 1, y, 0.7);
    if (rng() < 0.6) {
      p.set(x - 1, y, '#a02c0a');
      p.E(x - 1, y, 0.5);
    }
  }
}

function paintIronBars(p: Pix, _rng: Rng): void {
  clearAll(p);
  const bar = (x: number, y: number, t: number): void => {
    p.set(x, y, tone(DARK_IRON, t));
    p.H(x, y, 0.8);
    p.S(x, y, 0.55);
  };
  for (const bx of [3, 11, 19, 27]) {
    for (let y = 0; y < W; y += 1) {
      bar(bx, y, 0.88);
      bar(bx + 1, y, 0.55);
      bar(bx + 2, y, 0.2);
    }
  }
  for (const ry of [0, 29]) {
    for (let x = 0; x < W; x += 1) {
      bar(x, ry, 0.9);
      bar(x, ry + 1, 0.6);
      bar(x, ry + 2, 0.12);
    }
    for (const bx of [4, 12, 20, 28]) {
      p.set(bx, ry + 1, DARK_IRON[7]!);
      p.H(bx, ry + 1, 0.95);
    }
  }
}

function paintRail(p: Pix, rng: Rng): void {
  clearAll(p);
  const f = grainField(rng, 6, 0.35);
  // Sleepers every 8px so the track tiles vertically.
  for (const sy of [1, 9, 17, 25]) {
    const jitter = Math.floor(rng() * 2);
    for (let y = sy; y < sy + 4; y += 1) {
      for (let x = 3 + jitter; x < 29 + jitter; x += 1) {
        let t = 0.42 + (f(x * 0.5, y * 2) - 0.5) * 0.4;
        if (y === sy) t += 0.28;
        if (y === sy + 3) t = 0.04;
        if (x === 3 + jitter) t += 0.15;
        if (x === 28 + jitter) t -= 0.25;
        p.set(x, y, tone(SPRUCE, t));
        p.H(x, y, y === sy + 3 ? 0.45 : 0.6);
      }
    }
  }
  // Iron rails.
  for (const rx of [7, 22]) {
    for (let y = 0; y < W; y += 1) {
      p.set(rx, y, ITEM_IRON[4]!);
      p.set(rx + 1, y, ITEM_IRON[2]!);
      p.set(rx + 2, y, ITEM_IRON[0]!);
      for (let k = 0; k < 3; k += 1) {
        p.H(rx + k, y, 0.9);
        p.S(rx + k, y, 0.8);
      }
      // Shadow under the rail where it crosses a sleeper.
      if (p.alpha(rx + 3, y) > 0) p.mul(rx + 3, y, 0.6);
    }
    // Spikes pinning the rail to each sleeper.
    for (const sy of [2, 10, 18, 26]) {
      p.set(rx - 1, sy, '#2a2a30');
      p.set(rx + 3, sy + 1, '#2a2a30');
    }
  }
}

// ------------------------------------------------------------------ turrets

/** Wooden beam texel with grain running along the beam. */
function beamWood(p: Pix, f: (x: number, y: number) => number, x: number, y: number, t: number, vertical: boolean, h = 0.75): void {
  const g = vertical ? f(x * 2, y * 0.5) : f(x * 0.5, y * 2);
  p.set(x, y, tone(BEAM, t + (g - 0.5) * 0.4));
  p.H(x, y, h);
}

/** Rope lashing: diagonal wraps across a beam band. */
function lashing(p: Pix, x0: number, y0: number, w: number, h: number, vertical: boolean): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const u = vertical ? y - y0 : x - x0;
      const v = vertical ? x - x0 : y - y0;
      const s = (u + v) % 3;
      const t = s === 0 ? 0.85 : s === 1 ? 0.55 : 0.2;
      p.set(x, y, tone(ROPE, t));
      p.H(x, y, s === 2 ? 0.75 : 0.9);
      p.S(x, y, 0);
    }
  }
  // Shadow just past the lashing.
  if (vertical) for (let x = x0; x < x0 + w; x += 1) p.mul(x, y0 + h, 0.7);
  else for (let y = y0; y < y0 + h; y += 1) p.mul(x0 + w, y, 0.7);
}

/** Iron L-shaped corner plate with rivets. */
function cornerPlate(p: Pix, cx: number, cy: number, sx: number, sy: number): void {
  for (let k = 0; k < 9; k += 1) {
    for (let j = 0; j < 3; j += 1) {
      for (const [x, y] of [[cx + sx * k, cy + sy * j], [cx + sx * j, cy + sy * k]] as const) {
        const edge = j === 2 || k === 8;
        const t = edge ? 0.12 : j === 0 ? 0.88 : 0.62;
        p.set(x, y, tone(GUNMETAL, t));
        p.H(x, y, 0.88);
        p.S(x, y, 0.6);
      }
    }
  }
  for (const [x, y] of [[cx + sx * 1, cy + sy * 1], [cx + sx * 6, cy + sy * 1], [cx + sx * 1, cy + sy * 6]] as const) {
    p.set(x, y, '#9aa1ab');
    p.set(x + sx, y + sy, GUNMETAL[1]!);
    p.H(x, y, 0.98);
    p.S(x, y, 0.8);
  }
}

function heavyWoodFrame(p: Pix, rng: Rng, inner: 'planks_v' | 'planks_h'): (x: number, y: number) => number {
  const f = grainField(rng, 6, 0.35);
  const fw = 5;
  each((x, y) => {
    const d = Math.min(x, y, 31 - x, 31 - y);
    if (d >= fw) {
      // Recessed inner boards.
      const vertical = inner === 'planks_v';
      const u = vertical ? x : y;
      const r = (u - fw) % 6;
      let t = 0.42 + (vertical ? f(x * 2, y * 0.5) : f(x * 0.5, y * 2)) * 0.3 - 0.15;
      let h = 0.5;
      if (r === 5) {
        t = 0.02;
        h = 0.3;
      } else if (r === 0) t += 0.18;
      p.set(x, y, tone(SPRUCE, t + 0.15));
      p.H(x, y, h);
      return;
    }
    const top = y < fw && y <= x && y <= 31 - x;
    const bottom = 31 - y < fw && 31 - y <= x && 31 - y <= 31 - x;
    const vertical = !(top || bottom);
    let t = 0.55;
    if (d === 0) t = x === 0 || y === 0 ? 0.85 : 0.08;
    else if (d === fw - 1) t = x === fw - 1 || y === fw - 1 ? 0.15 : 0.82;
    else if (d === 1) t = 0.7;
    // Mitred corners.
    if ((top || bottom) && (x < fw || 31 - x < fw) && Math.abs(Math.min(x, 31 - x) - Math.min(y, 31 - y)) === 0) t -= 0.25;
    beamWood(p, f, x, y, t, vertical, 0.8);
  });
  // Shadow cast by the frame onto the boards.
  for (let k = fw; k < 32 - fw; k += 1) {
    p.mul(k, fw, 0.7);
    p.mul(fw, k, 0.7);
  }
  return f;
}

function paintBallistaSide(p: Pix, rng: Rng): void {
  const f = heavyWoodFrame(p, rng, 'planks_v');
  // Diagonal brace from bottom-left to top-right.
  each((x, y) => {
    if (Math.min(x, y, 31 - x, 31 - y) < 5) return;
    const s = (x + y) - 31;
    if (Math.abs(s) > 2) return;
    const t = s === -2 ? 0.85 : s === 2 ? 0.1 : 0.55;
    beamWood(p, f, x, y, t, false, 0.72);
    if (s === 2) p.mul(x + 1, y + 1, 0.7);
  });
  lashing(p, 13, 0, 6, 5, false);
  lashing(p, 13, 27, 6, 5, false);
  lashing(p, 0, 13, 5, 6, true);
  lashing(p, 27, 13, 5, 6, true);
  cornerPlate(p, 0, 0, 1, 1);
  cornerPlate(p, 31, 0, -1, 1);
  cornerPlate(p, 0, 31, 1, -1);
  cornerPlate(p, 31, 31, -1, -1);
}

function paintBallistaTop(p: Pix, rng: Rng): void {
  heavyWoodFrame(p, rng, 'planks_h');
  // Iron swivel ring in the middle with a bolt-channel groove.
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    const r = Math.hypot(dx, dy);
    if (r > 8.5) return;
    const light = -(dx + dy) / (Math.SQRT2 * Math.max(r, 0.01));
    if (r > 6) {
      p.set(x, y, tone(DARK_IRON, 0.5 + light * 0.35 + (r > 7.8 ? -0.2 : 0)));
      p.H(x, y, 0.9);
      p.S(x, y, 0.6);
    } else {
      p.set(x, y, tone(BEAM, 0.55 + light * 0.15 + (rng() - 0.5) * 0.12));
      p.H(x, y, 0.65);
      p.S(x, y, 0);
    }
  });
  // Bolt channel running along the turret's aim.
  for (let x = 9; x < 23; x += 1) {
    p.set(x, 15, tone(BEAM, 0.05));
    p.set(x, 16, tone(BEAM, 0.12));
    p.set(x, 17, tone(BEAM, 0.8));
    p.H(x, 15, 0.3);
    p.H(x, 16, 0.3);
  }
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * TAU + TAU / 16;
    rivet(p, Math.round(15.5 + Math.cos(a) * 7) - 1, Math.round(15.5 + Math.sin(a) * 7) - 1, DARK_IRON, 0.7, false);
  }
  lashing(p, 0, 0, 5, 5, true);
  lashing(p, 27, 0, 5, 5, false);
  lashing(p, 0, 27, 5, 5, false);
  lashing(p, 27, 27, 5, 5, true);
}

function paintMortarTop(p: Pix, rng: Rng): void {
  for (const [x, y] of [[0, 0], [16, 0], [0, 16], [16, 16]] as const) {
    plate(p, rng, x, y, 16, 16, GUNMETAL, 0.55, 2, 'h');
    rivet(p, x + 3, y + 3, GUNMETAL, 0.7, true);
  }
  each((x, y) => {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    const r = Math.hypot(dx, dy);
    if (r > 13) return;
    const light = -(dx + dy) / (Math.SQRT2 * Math.max(r, 0.01));
    if (r > 12) {
      // Drop shadow ring of the barrel onto the deck.
      p.set(x, y, tone(GUNMETAL, 0.04));
      p.H(x, y, 0.3);
    } else if (r > 7) {
      // Thick rounded muzzle rim: brightest on the top-left crest.
      const crest = 1 - Math.abs(r - 9.5) / 2.5;
      p.set(x, y, tone(GUNMETAL, 0.35 + light * 0.3 * crest + crest * 0.25 + (rng() - 0.5) * 0.06));
      p.H(x, y, 0.75 + crest * 0.2);
      p.S(x, y, 0.65);
    } else if (r > 5.5) {
      // Inner bore wall: lit on the far (bottom-right) side.
      p.set(x, y, tone(BALL, 0.25 - light * 0.25));
      p.H(x, y, 0.3);
      p.S(x, y, 0.3);
    } else {
      p.set(x, y, tone(BALL, 0.02 + (r > 4 ? 0.06 : 0)));
      p.H(x, y, 0.05);
      p.S(x, y, 0);
    }
  });
  // Rim bolts.
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * TAU + 0.3;
    rivet(p, Math.round(15.5 + Math.cos(a) * 9.5), Math.round(15.5 + Math.sin(a) * 9.5), GUNMETAL, 0.8, false);
  }
}

function paintMortarSide(p: Pix, rng: Rng): void {
  const n = tileNoise(seedFrom(rng), 8);
  each((x, y) => {
    let t = 0.32 + (n(x, y) - 0.5) * 0.14 + (n(3, y * 7) - 0.5) * 0.08 + (rng() - 0.5) * 0.05;
    if (y === 0) t += 0.25;
    if (y === 31) t = 0.02;
    p.set(x, y, tone(GUNMETAL, t));
    p.H(x, y, 0.6);
    p.S(x, y, 0.6);
  });
  // Two lighter reinforcing bands.
  for (const by of [5, 22]) {
    for (let x = 0; x < W; x += 1) {
      for (let k = 0; k < 5; k += 1) {
        let t = k === 0 ? 0.95 : k === 1 ? 0.78 : k === 4 ? 0.2 : 0.62 + (rng() - 0.5) * 0.06;
        t += (n(x * 5, by) - 0.5) * 0.06;
        p.set(x, by + k, tone(GUNMETAL, t));
        p.H(x, by + k, k === 4 ? 0.75 : 0.85);
        p.S(x, by + k, 0.7);
      }
      p.mul(x, by + 5, 0.7);
      p.H(x, by + 5, 0.4);
    }
    for (let x = 2; x < W; x += 8) rivet(p, x, by + 1, GUNMETAL, 0.8, true);
  }
  // Vertical cast seam.
  for (let y = 11; y < 21; y += 1) {
    p.set(15, y, GUNMETAL[0]!);
    p.set(16, y, GUNMETAL[4]!);
    p.H(15, y, 0.35);
  }
}

// ------------------------------------------------------------------ quest / effects

function paintQuestBeam(p: Pix, rng: Rng): void {
  const pal = ['#d88a1a', '#f0b032', '#ffd25a', '#ffe794', '#fff4cc', '#ffffff'];
  const shimmer = tileNoise(seedFrom(rng), 8);
  each((x, y) => {
    const dx = Math.abs(x + 0.5 - 16) / 16;
    const fall = clamp01(1 - dx);
    // Horizontal shimmer bands (integer frequencies so the beam tiles vertically).
    const band = 0.5 + 0.5 * Math.sin((y / W) * TAU * 4 + shimmer(0, y) * 2.5);
    const s = shimmer(x * 0.0 + 7, y) * 0.5 + band * 0.5;
    const core = Math.pow(fall, 3.5);
    const t = core * 0.9 + s * 0.15 + fall * 0.1;
    const a = Math.round(255 * clamp01(Math.pow(fall, 1.6) * (0.78 + s * 0.22)));
    p.set(x, y, tone(pal, t), a);
    p.E(x, y, 1);
  });
}

function paintRain(p: Pix, rng: Rng): void {
  each((x, y) => p.set(x, y, '#a8c4ec', 0));
  const streaks = 8;
  for (let i = 0; i < streaks; i += 1) {
    const x0 = ((i + 0.5) / streaks) * W + (rng() - 0.5) * 3;
    const y0 = rng() * W;
    const len = 7 + Math.floor(rng() * 7);
    const peak = 100 + Math.floor(rng() * 40);
    for (let k = 0; k < len; k += 1) {
      const f = k / (len - 1);
      const x = Math.floor(x0 - k * 0.22);
      const y = Math.floor(y0 + k);
      // Fades in at the head, brightest mid-streak, fades out in the tail.
      const a = Math.round(peak * Math.sin(Math.PI * (0.1 + f * 0.85)));
      p.set(x, y, f < 0.5 ? '#d8e6fa' : '#b4ccf0', Math.max(a, 60));
    }
  }
}

function paintSnowflake(p: Pix, rng: Rng): void {
  each((x, y) => p.set(x, y, '#ffffff', 0));
  const flakes: [number, number, number][] = [[6, 7, 2.2], [21, 5, 1.6], [14, 15, 2.6], [26, 18, 1.8], [8, 24, 1.7], [19, 27, 2.1], [29, 29, 1.2]];
  for (const [fx, fy, r] of flakes) {
    const cx = fx + (rng() - 0.5);
    const cy = fy + (rng() - 0.5);
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d >= 1) continue;
        const a = Math.round(235 * Math.pow(1 - d, 0.7));
        const i = p.idx(x, y) * 4 + 3;
        if (a > p.d[i]!) p.set(x, y, d < 0.4 ? '#ffffff' : '#e8f0fa', a);
      }
    }
  }
}

function paintShield(p: Pix, rng: Rng): void {
  // Hex lattice that tiles the 32px square: 3 cells across, 4 staggered rows.
  const pts: [number, number][] = [];
  for (let j = 0; j < 4; j += 1) for (let i = 0; i < 3; i += 1) pts.push([(i + (j % 2) * 0.5) * (W / 3), j * 8 + 4]);
  const flick = tileNoise(seedFrom(rng), 4);
  each((x, y) => {
    let best = 1e9;
    let second = 1e9;
    for (const [px, py] of pts) {
      const d = wrapDist(x + 0.5, y + 0.5, px, py);
      if (d < best) {
        second = best;
        best = d;
      } else if (d < second) second = d;
    }
    const edge = (second - best) * 0.5;
    const f = flick(x, y);
    if (edge < 0.55) {
      p.set(x, y, edge < 0.25 ? '#e0ffc0' : '#b4ff7a', Math.round(105 + f * 40));
      p.E(x, y, 1);
    } else if (edge < 1.2) {
      p.set(x, y, '#8ef050', Math.round(45 + f * 20));
      p.E(x, y, 1);
    } else {
      // Faint energy fill, brighter toward the cell centres.
      p.set(x, y, '#6ad83a', Math.round(14 + f * 18));
      p.E(x, y, 1);
    }
  });
}

function paintSpark(p: Pix): void {
  each((x, y) => {
    const dx = Math.abs(x + 0.5 - 16);
    const dy = Math.abs(y + 0.5 - 16);
    const armX = Math.exp(-dy * 1.3) * clamp01(1 - dx / 14);
    const armY = Math.exp(-dx * 1.3) * clamp01(1 - dy / 14);
    const r = Math.hypot(dx, dy);
    const core = clamp01(1 - r / 6);
    const diag = Math.exp(-Math.abs(dx - dy) * 1.6) * clamp01(1 - r / 8) * 0.45;
    const v = clamp01(Math.max(armX, armY, diag) * 0.9 + core * core);
    const c = lerpRGB(hex('#ffd060'), hex('#ffffff'), clamp01(v * 1.3 - 0.2));
    p.set(x, y, c, Math.round(255 * Math.pow(v, 1.1)));
    p.E(x, y, 1);
  });
}

function paintRing(p: Pix): void {
  each((x, y) => {
    const r = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
    const d = Math.abs(r - 13);
    const a = clamp01(1 - d / 1.6);
    p.set(x, y, d < 0.6 ? '#ffffff' : '#e8f2ff', Math.round(230 * Math.pow(a, 1.2)));
    p.E(x, y, 1);
  });
}

/** A soft glowing heart (Pip's pats). */
function paintHeart(p: Pix): void {
  each((x, y) => {
    // Implicit heart: (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0, scaled into the tile.
    const u = (x + 0.5 - 16) / 12;
    const v = (16 - (y + 0.5)) / 12 + 0.25;
    const f = Math.pow(u * u + v * v - 1, 3) - u * u * v * v * v;
    if (f > 0.02) return;
    const edge = Math.min(1, -f * 12);
    const c = lerpRGB(hex('#ff3a5a'), hex('#ffd0dc'), Math.max(0, v * 0.5 - u * 0.4));
    p.set(x, y, c, Math.round(255 * Math.min(1, 0.35 + edge)));
    p.E(x, y, 1);
  });
}

function paintArrowMarker(p: Pix): void {
  clearAll(p);
  const shaft: [number, number][] = [[11, 3], [21, 3], [21, 14], [11, 14]];
  const head: [number, number][] = [[4, 14], [28, 14], [16, 28.5]];
  shapeFill(p, (x, y) => {
    const inS = inPoly(shaft, x, y);
    const inH = inPoly(head, x, y);
    if (!inS && !inH) return null;
    let t = 0.6;
    if (inS && !inH) {
      if (x < 13) t = 0.85;
      else if (x > 19) t = 0.3;
      if (y < 5) t += 0.1;
    } else {
      // Bevelled head: lit left facet, shaded right facet, bright centre ridge.
      const ridge = Math.abs(x - 16);
      t = x < 16 ? 0.72 : 0.42;
      if (ridge < 1.2) t = 0.95;
      if (y < 16) t += 0.1;
      if (x > 16 && (x - 16) > (28.5 - y) * 0.85 - 1.5) t = 0.22;
      if (x < 16 && (16 - x) > (28.5 - y) * 0.85 - 1.5) t = 0.55;
    }
    return t;
  }, GOLD, 0.6, 0.8);
  outline(p, 0.3);
}

// ------------------------------------------------------------------ items

function paintEmerald(p: Pix): void {
  clearAll(p);
  const outer: [number, number][] = [[16, 3], [24, 9], [24, 22], [16, 29], [8, 22], [8, 9]];
  const table: [number, number][] = [[16, 8], [20, 11], [20, 20], [16, 24], [12, 20], [12, 11]];
  shapeFill(p, (x, y) => {
    if (!inPoly(outer, x, y)) return null;
    if (inPoly(table, x, y)) {
      // Table: light top-left falling to mid tone.
      return 0.62 + (16 - x + 16 - y) / 40;
    }
    if (y < 11 && x < 16) return 0.86;
    if (y < 11) return 0.66;
    if (y > 20 && x < 16) return 0.32;
    if (y > 20) return 0.12;
    return x < 16 ? 0.74 : 0.24;
  }, EMERALD, 0.85, 0.15);
  // Sparkle on the table.
  for (const [x, y] of [[13, 12], [14, 12], [13, 13], [13, 14]] as const) p.set(x, y, EMERALD[7]!);
  outline(p, 0.45);
}

function paintTreasureMap(p: Pix, rng: Rng): void {
  clearAll(p);
  const g = grainField(rng, 6, 0.4);
  const edgeN = tileNoise(seedFrom(rng), 16);
  // Parchment sheet with ragged edges and rolled ends.
  shapeFill(p, (x, y) => {
    const ragT = (edgeN(x, 0) - 0.5) * 1.6;
    const ragB = (edgeN(x, 9) - 0.5) * 1.6;
    if (x < 4 || x > 28 || y < 6 + ragT || y > 26 + ragB) return null;
    if (x < 7 || x > 25) {
      // Rolls: cylinder shading across the roll.
      const u = x < 7 ? (x - 4) / 3 : (x - 25) / 3;
      return 0.3 + Math.sin(u * Math.PI) * 0.45 + (y < 7.5 + ragT ? 0.1 : 0);
    }
    return 0.66 + (g(x, y) - 0.5) * 0.3 + (y > 24 + ragB ? -0.15 : 0);
  }, PARCH);
  // Stains.
  for (let i = 0; i < 6; i += 1) {
    const x = 9 + Math.floor(rng() * 14);
    const y = 9 + Math.floor(rng() * 14);
    p.set(x, y, PARCH[3]!);
  }
  // Dotted trail ending in a red X.
  const path: [number, number][] = [[9, 22], [10, 19], [12, 17], [15, 18], [17, 19], [19, 17], [20, 15]];
  for (let k = 0; k < path.length - 1; k += 1) {
    const [ax, ay] = path[k]!;
    const [bx, by] = path[k + 1]!;
    let n = 0;
    line(ax, ay, bx, by, (x, y) => {
      if (n++ % 2 === 0) p.set(x, y, '#5a3a1c');
    });
  }
  for (let k = -2; k <= 2; k += 1) {
    p.set(21 + k, 12 + k, '#c42a1c');
    p.set(21 + k, 12 - k, '#c42a1c');
  }
  for (const [x, y] of [[22, 15], [24, 11], [24, 15], [20, 13]] as const) p.set(x, y, '#7a1a10');
  // Little landmarks: a tree and a wave.
  for (const [x, y, c] of [[11, 10, '#3e6a26'], [12, 10, '#4e8030'], [11, 11, '#3e6a26'], [12, 11, '#2e5020'], [11, 12, '#5a3a1c']] as const) p.set(x, y, c);
  for (const [x, y] of [[17, 23], [18, 22], [19, 23], [20, 22], [21, 23]] as const) p.set(x, y, '#3a68a8');
  outline(p, 0.45);
}

function paintBoltItem(p: Pix): void {
  clearAll(p);
  // Fletching vanes at the tail (bottom-left).
  shapeFill(p, (x, y) => {
    const along = (x - y) / Math.SQRT2 + 15.6; // 0 at the tail end of the shaft
    const u = (x + y) / Math.SQRT2 - 22.6; // across the shaft (- is top-left)
    if (along < 0.5 || along > 8) return null;
    const w = along < 6 ? 1.2 + along * 0.45 : 1.2 + (8 - along) * 1.35;
    if (Math.abs(u) > w || Math.abs(u) < 1) return null;
    return u < 0 ? 0.85 : 0.45 + (Math.floor(along) % 2) * 0.1;
  }, ['#5a1a12', '#8a2a1a', '#b23c26', '#d8584a', '#ecd8c8', '#fbf4ec']);
  // Shaft.
  stick(p, 5, 27, 23, 9, 1.25, HANDLE);
  // Wrapped binding behind the head.
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 20, 12, 22, 10);
    return s.d < 1.6 ? (s.side < 0 ? 0.8 : 0.4) : null;
  }, ROPE);
  // Iron head: a long four-faced point.
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 21.5, 10.5, 29, 3);
    const w = 2.6 * (1 - s.t) + 0.3;
    if (s.d > w) return null;
    return s.side < 0 ? 0.85 : 0.35;
  }, ITEM_IRON, 0.75);
  outline(p);
}

function paintShellItem(p: Pix): void {
  clearAll(p);
  const cx = 15;
  const cy = 18.5;
  const R = 10;
  shapeFill(p, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    if (r > R) return null;
    // Sphere shading from the top-left light.
    const nz = Math.sqrt(Math.max(0, 1 - (r / R) * (r / R)));
    const l = clamp01((-dx * 0.5 - dy * 0.6) / R + nz * 0.65);
    let t = l * 0.75 + 0.05;
    if (r > R - 1.2) t -= 0.08;
    return t;
  }, BALL, 0.6);
  // Specular glint.
  for (const [x, y] of [[10, 12], [11, 12], [10, 13]] as const) p.set(x, y, BALL[7]!);
  // Fuse socket and short fuse.
  shapeFill(p, (x, y) => (Math.hypot(x - 21.5, y - 10.5) < 2.1 ? 0.6 - (x - 21.5 + y - 10.5) / 5 : null), GUNMETAL, 0.7);
  for (const [x, y, t] of [[22, 8, 0.8], [23, 7, 0.6], [23, 6, 0.8], [24, 5, 0.5]] as const) {
    p.set(x, y, tone(ROPE, t));
    p.H(x, y, 0.7);
  }
  outline(p, 0.45);
  // Lit fuse spark (drawn after the outline so it stays bright).
  for (const [x, y, c, e] of [[25, 4, '#fff4c0', 1], [26, 3, '#ffc848', 1], [24, 3, '#ffa02c', 0.9], [26, 5, '#f07418', 0.8], [27, 2, '#ffcc58', 0.7], [25, 3, '#ffe890', 1]] as const) {
    put(p, x, y, c);
    p.E(x, y, e);
    p.H(x, y, 0.8);
  }
}

function paintHammer(p: Pix): void {
  clearAll(p);
  stick(p, 5.5, 27.5, 21, 12, 1.3, HANDLE);
  // Grip wrap near the end of the handle.
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 5.5, 27.5, 9.5, 23.5);
    if (s.d > 1.6) return null;
    const k = Math.floor((x + y) * 0.75) % 2;
    return k === 0 ? 0.7 : 0.35;
  }, ['#2a1408', '#4a2410', '#6e3a1c', '#8e5230']);
  // Iron head across the handle: a heavy square striking face (top-left) and a tapered peen.
  const hx = 20.5;
  const hy = 12.5;
  shapeFill(p, (x, y) => {
    const dx = x - hx;
    const dy = y - hy;
    const u = (dx + dy) / Math.SQRT2; // along the head (+ toward bottom-right)
    const v = (dx - dy) / Math.SQRT2; // along the handle (+ toward top-right)
    if (u < -8.5 || u > 7.5) return null;
    let half: number;
    if (u < -3.5) half = 3.3;
    else if (u < 2.5) half = 2.4;
    else half = 2.4 - (u - 2.5) * 0.3;
    if (Math.abs(v) > half) return null;
    let t = 0.55 + v / (half * 2.6);
    if (u < -7.5) t = 0.92; // polished striking face
    if (Math.abs(u + 3.5) < 0.7) t -= 0.3; // collar step
    if (u > 6.5) t -= 0.2;
    return t;
  }, ITEM_IRON, 0.75);
  outline(p);
}

// ------------------------------------------------------------------ relics (story items)

const IVORY = ['#6a5a40', '#8a7854', '#a8966c', '#c4b388', '#dccca4', '#ece0c0', '#f8f2de'];
const BRASS = ['#4a3008', '#6e4a10', '#94681c', '#b8862c', '#d4a43e', '#e8c05a', '#f8dc86'];
const HEART = ['#3a0610', '#5c0a18', '#820f22', '#a8162e', '#d0243c', '#ee4a5a', '#ff8a92', '#ffd0d4'];
const LEATHER = ['#2a1408', '#3e2010', '#542c16', '#6a3a1e', '#7e4826', '#925830'];

/** The Builders' Grapple: an iron three-pronged hook on a coiled rope. */
function paintGrappleItem(p: Pix): void {
  clearAll(p);
  // Rope: a loose coil at the bottom-left trailing up to the shank.
  shapeFill(p, (x, y) => {
    const r = Math.hypot(x - 10, y - 23);
    const ring = Math.abs(r - 5.2);
    if (ring < 1.15) return 0.4 + (y < 23 ? 0.35 : 0) + ((Math.floor(Math.atan2(y - 23, x - 10) * 4) & 1) ? 0.1 : -0.05);
    return null;
  }, ROPE);
  stick(p, 13.5, 19.5, 18.5, 14.5, 1.0, ROPE);
  // Iron shank with an eye at its base.
  stick(p, 17, 16, 24, 9, 1.45, ITEM_IRON);
  shapeFill(p, (x, y) => (Math.abs(Math.hypot(x - 16.5, y - 16.5) - 1.9) < 0.8 ? 0.55 : null), ITEM_IRON, 0.6);
  // Three prongs curling back from the crown.
  for (const [ex, ey] of [[19, 3], [29, 13], [27, 4]] as const) {
    shapeFill(p, (x, y) => {
      const s = seg(x, y, 24, 9, ex, ey);
      if (s.d > 1.25 - s.t * 0.45) return null;
      return s.side < 0 ? 0.85 : 0.4;
    }, ITEM_IRON, 0.8);
  }
  for (const [x, y] of [[18, 4], [28, 14], [26, 3]] as const) p.set(x, y, ITEM_IRON[6]!);
  outline(p);
}

/** Millford's crossbow: a dark stock, a recurve bow and a loaded bolt. */
function paintCrossbowItem(p: Pix): void {
  clearAll(p);
  // Stock along the diagonal, a grip at the back.
  stick(p, 5, 27, 21, 11, 1.9, SPRUCE);
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 5, 27, 9, 23);
    return s.d < 2.3 ? (s.side < 0 ? 0.7 : 0.3) : null;
  }, LEATHER);
  // The bow: a curved limb across the front of the stock.
  shapeFill(p, (x, y) => {
    const u = (x - y) / Math.SQRT2; // across the stock
    const v = (x + y) / Math.SQRT2 - 22.6; // along it (+ forward)
    const bend = (u * u) / 40;
    if (Math.abs(u) > 11 || Math.abs(v - 1.5 + bend) > 1.15) return null;
    return 0.45 + (v - 1.5 + bend < 0 ? 0.35 : 0) + (Math.abs(u) > 9 ? -0.2 : 0);
  }, OAK);
  // Bowstring drawn back to the latch.
  line(9, 20, 17, 18, (x, y) => p.set(x, y, '#e8e0cc'));
  line(20, 9, 18, 17, (x, y) => p.set(x, y, '#e8e0cc'));
  // Loaded bolt with an iron tip.
  stick(p, 15, 17, 26, 6, 0.75, HANDLE);
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 25, 7, 29, 3);
    return s.d < 1.5 * (1 - s.t) + 0.3 ? (s.side < 0 ? 0.85 : 0.4) : null;
  }, ITEM_IRON, 0.8);
  // Brass trigger plate.
  shapeFill(p, (x, y) => (Math.hypot(x - 12.5, y - 19.5) < 1.6 ? 0.6 : null), BRASS, 0.6);
  outline(p);
}

/** Stonewater's war horn: a curved ivory horn with brass bands on a leather strap. */
function paintHornItem(p: Pix): void {
  clearAll(p);
  // Strap looping under the horn.
  shapeFill(p, (x, y) => {
    const r = Math.hypot((x - 16) * 0.9, y - 13);
    return Math.abs(r - 11) < 0.9 && y > 16 ? 0.5 : null;
  }, LEATHER);
  // The horn: a tapering crescent from the mouthpiece (left) to the bell (right).
  shapeFill(p, (x, y) => {
    const a = Math.atan2(y - 26, x - 16); // centre of the curve below the horn
    const r = Math.hypot(x - 16, y - 26);
    const t = clamp01((a + Math.PI * 0.92) / (Math.PI * 0.84)); // 0 mouthpiece .. 1 bell
    const w = 1.2 + t * t * 4.2;
    if (a > -0.08 || a < -Math.PI * 0.95) return null;
    if (Math.abs(r - 15) > w) return null;
    const shade = (r - 15) / w; // -1 inner .. 1 outer
    return 0.5 - shade * 0.3 + t * 0.15;
  }, IVORY);
  // Brass bands and the bell's rim.
  for (const ta of [0.3, 0.62]) {
    const a = -Math.PI * 0.92 + ta * Math.PI * 0.84;
    const w = 1.2 + ta * ta * 4.2;
    for (let d = -w; d <= w; d += 0.5) {
      const x = Math.round(16 + Math.cos(a) * (15 + d));
      const y = Math.round(26 + Math.sin(a) * (15 + d));
      if (p.alpha(x, y) > 0) {
        p.set(x, y, tone(BRASS, 0.55 - d / (w * 3)));
        p.S(x, y, 0.7);
      }
    }
  }
  shapeFill(p, (x, y) => {
    const a = Math.atan2(y - 26, x - 16);
    const r = Math.hypot(x - 16, y - 26);
    return a > -0.32 && a < -0.08 && Math.abs(r - 15) < 5.4 ? 0.7 - (a + 0.2) : null;
  }, BRASS, 0.75);
  outline(p);
}

/** Ashvale's storm rod: a copper-tipped iron rod crackling with a captured spark. */
function paintRodItem(p: Pix): void {
  clearAll(p);
  stick(p, 7, 28, 22, 9, 1.3, ITEM_IRON);
  // Copper coil around the middle.
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 12, 22, 16, 17);
    return s.d < 2.1 ? ((Math.floor((x + y) * 0.7) & 1) ? 0.75 : 0.35) : null;
  }, ['#5a2a10', '#7e3c18', '#a4522a', '#c86c3a', '#e48a52', '#f4aa74']);
  // Pointed copper tip.
  shapeFill(p, (x, y) => {
    const s = seg(x, y, 21, 10, 26, 4);
    return s.d < 1.6 * (1 - s.t) + 0.25 ? (s.side < 0 ? 0.9 : 0.45) : null;
  }, ['#5a2a10', '#7e3c18', '#a4522a', '#c86c3a', '#e48a52', '#f4aa74', '#ffd0a0'], 0.8);
  outline(p);
  // The spark it caught: a little forked bolt (bright, after the outline).
  for (const [x, y] of [[27, 2], [28, 3], [27, 4], [28, 5], [29, 6], [26, 1], [29, 2], [30, 7]] as const) {
    put(p, x, y, x === 28 || y === 4 ? '#ffffff' : '#9ad8ff');
    p.E(x, y, 1);
  }
}

/** Redcliff's Heartbreaker: a banded black charge set with a green Citadel shard. */
function paintBreakerItem(p: Pix): void {
  clearAll(p);
  shapeFill(p, (x, y) => {
    const dx = x - 15.5;
    const dy = y - 18;
    const r = Math.hypot(dx * 0.95, dy);
    if (r > 10.5) return null;
    const nz = Math.sqrt(Math.max(0, 1 - (r / 10.5) ** 2));
    return clamp01((-dx * 0.45 - dy * 0.55) / 10.5 + nz * 0.6) * 0.8;
  }, BALL, 0.55);
  // Red iron bands.
  shapeFill(p, (x, y) => {
    const r = Math.hypot((x - 15.5) * 0.95, y - 18);
    if (r > 10.6) return null;
    return Math.abs(y - 13.5) < 0.9 || Math.abs(y - 22.5) < 0.9 ? 0.55 - (x - 15.5) / 30 : null;
  }, ['#3a0a06', '#621208', '#8e1c0c', '#b82a12', '#d8401c']);
  // The green shard in its socket.
  shapeFill(p, (x, y) => (inPoly([[15.5, 13], [19, 18], [15.5, 23], [12, 18]], x, y) ? 0.55 + (15.5 - x + 18 - y) / 14 : null), ACID, 0.3, 1);
  // Fuse.
  for (const [x, y, t] of [[19, 8, 0.8], [20, 7, 0.6], [21, 6, 0.8], [22, 5, 0.5]] as const) {
    p.set(x, y, tone(ROPE, t));
    p.H(x, y, 0.7);
  }
  outline(p, 0.45);
  for (const [x, y, c] of [[23, 4, '#fff4c0'], [24, 3, '#ffc848'], [22, 3, '#ffa02c'], [24, 5, '#f07418']] as const) {
    put(p, x, y, c);
    p.E(x, y, 1);
  }
}

/** A giant's Heartstone: a faceted, glowing red shard of the Citadel's Heart. */
function paintHeartstoneItem(p: Pix): void {
  clearAll(p);
  const outer: [number, number][] = [[16, 3], [25, 11], [22, 26], [16, 29], [9, 24], [7, 12]];
  const table: [number, number][] = [[16, 8], [21, 12], [19, 22], [16, 24], [12, 21], [11, 13]];
  shapeFill(p, (x, y) => {
    if (!inPoly(outer, x, y)) return null;
    if (inPoly(table, x, y)) return 0.6 + (16 - x + 16 - y) / 36;
    if (y < 12 && x < 16) return 0.9;
    if (y < 12) return 0.7;
    if (y > 21 && x < 16) return 0.32;
    if (y > 21) return 0.14;
    return x < 16 ? 0.76 : 0.26;
  }, HEART, 0.7, 0.75);
  for (const [x, y] of [[13, 12], [14, 12], [13, 13], [13, 14], [14, 11]] as const) p.set(x, y, HEART[7]!);
  outline(p, 0.4);
}

/** A page of the Builders' Journal: a leather book with a brass clasp. */
function paintJournalItem(p: Pix): void {
  clearAll(p);
  // Pages (the fore-edge peeking out on the right).
  shapeFill(p, (x, y) => (x >= 9 && x <= 26 && y >= 6 && y <= 27 ? 0.75 - ((x + y) % 3 === 0 ? 0.12 : 0) : null), PARCH);
  // Leather cover.
  shapeFill(p, (x, y) => {
    if (x < 6 || x > 24 || y < 4 || y > 26) return null;
    if (x < 9) return 0.25 + (x - 6) * 0.08; // spine
    return 0.45 + (y < 6 ? 0.25 : 0) - (x > 22 ? 0.12 : 0);
  }, LEATHER);
  // Gold tooling: a border and a little fortress emblem.
  for (let x = 11; x <= 22; x += 1) {
    p.set(x, 7, GOLD[4]!);
    p.set(x, 23, GOLD[3]!);
  }
  for (let y = 7; y <= 23; y += 1) {
    p.set(11, y, GOLD[4]!);
    p.set(22, y, GOLD[3]!);
  }
  for (const [x, y] of [[15, 13], [16, 12], [17, 12], [18, 13], [14, 14], [15, 14], [16, 14], [17, 14], [18, 14], [19, 14], [15, 15], [18, 15], [15, 16], [18, 16], [16, 17], [17, 17]] as const) p.set(x, y, GOLD[5]!);
  // Brass clasp.
  shapeFill(p, (x, y) => (x >= 23 && x <= 27 && y >= 14 && y <= 17 ? 0.7 - (y - 14) * 0.1 : null), BRASS, 0.8);
  outline(p);
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

export function installExtraPainters(): void {
  const r = (name: string, painter: (p: Pix, rng: Rng) => void): void => register(name, painter, seedOf(name));

  // Desert
  r('sandstone_top', paintSandstoneTop);
  r('sandstone_side', paintSandstoneSide);
  r('sandstone_bottom', paintSandstoneBottom);
  r('cut_sandstone', paintCutSandstone);
  r('chiseled_sandstone', paintChiseledSandstone);
  r('terracotta', paintTerracotta);
  r('cactus_top', (p, rng) => cactusEnd(p, rng, true));
  r('cactus_side', paintCactusSide);
  r('cactus_bottom', (p, rng) => cactusEnd(p, rng, false));
  r('dead_bush', paintDeadBush);

  // Snow
  r('grass_snow_side', paintGrassSnowSide);
  r('ice', paintIce);
  r('wool_blue', (p, rng) => paintWool(p, rng, WOOL_BLUE));
  r('wool_yellow', (p, rng) => paintWool(p, rng, WOOL_YELLOW));

  // Blighted lands
  r('blight_grass_top', paintBlightGrassTop);
  r('blight_grass_side', paintBlightGrassSide);
  r('blight_moss', paintBlightMoss);

  // Caves
  r('lava_still', paintLavaStill);
  r('lava_flow', paintLavaFlow);
  r('emerald_ore', paintEmeraldOre);
  r('cobweb', paintCobweb);
  r('spawner', paintSpawner);
  r('iron_bars', paintIronBars);
  r('rail', paintRail);

  // Turrets
  r('ballista_top', paintBallistaTop);
  r('ballista_side', paintBallistaSide);
  r('mortar_top', paintMortarTop);
  r('mortar_side', paintMortarSide);

  // Quest / effects
  r('quest_beam', paintQuestBeam);
  r('rain', paintRain);
  r('snowflake', paintSnowflake);
  r('shield', paintShield);
  r('spark', paintSpark);
  r('ring', paintRing);
  r('arrow_marker', paintArrowMarker);
  r('heart', paintHeart);

  // Items
  r('emerald', paintEmerald);
  r('treasure_map', paintTreasureMap);
  r('bolt_item', paintBoltItem);
  r('shell_item', paintShellItem);
  r('ui_hammer', paintHammer);

  // Relics and the journal
  r('grapple_item', paintGrappleItem);
  r('crossbow_item', paintCrossbowItem);
  r('horn_item', paintHornItem);
  r('rod_item', paintRodItem);
  r('breaker_item', paintBreakerItem);
  r('heartstone_item', paintHeartstoneItem);
  r('journal_item', paintJournalItem);
}
