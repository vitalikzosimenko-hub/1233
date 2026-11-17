// Texture registry and GPU packing. Every block, item and sky texture is a 32x32 pixel-art
// tile painted procedurally from a fixed seed (see paint.ts), so the world looks identical on
// every device. Besides colour each tile carries three extra channels the painters fill in:
//   height  0..1  -> turned into a normal map (bevelled stones, plank grooves, bark ridges)
//   spec    0..1  -> sun glints on metal, glass, water and polished stone
//   glow    0..1  -> self-lit texels (lantern glass, furnace fire, redstone, ores)
// Colour layers become one sRGB texture array; normal/spec/glow become a second array.
import { mulberry32, type Rng } from './rng';

export const TEX = 32;

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

const hexCache = new Map<string, RGB>();
export function hex(s: string): RGB {
  let c = hexCache.get(s);
  if (!c) {
    const v = Number.parseInt(s.slice(1), 16);
    c = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    hexCache.set(s, c);
  }
  return c;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas unavailable');
  context.imageSmoothingEnabled = false;
  return context;
}

/** An RGBA pixel grid plus height / specular / glow channels. Coordinates wrap (tileable). */
export class Pix {
  readonly w: number;
  readonly h: number;
  readonly d: Uint8ClampedArray;
  readonly hgt: Float32Array;
  readonly spec: Float32Array;
  readonly glow: Float32Array;
  /** True once a painter wrote heights; otherwise heights are derived from brightness. */
  heightSet = false;
  /** Normal-map strength for this tile. */
  bump = 1;

  constructor(w = TEX, h = TEX) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
    this.hgt = new Float32Array(w * h).fill(0.5);
    this.spec = new Float32Array(w * h);
    this.glow = new Float32Array(w * h);
  }

  idx(x: number, y: number): number {
    return (((y % this.h) + this.h) % this.h) * this.w + (((x % this.w) + this.w) % this.w);
  }

  set(x: number, y: number, color: string | RGB, a = 255): void {
    const c = typeof color === 'string' ? hex(color) : color;
    const i = this.idx(x, y) * 4;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = a;
  }

  get(x: number, y: number): RGBA {
    const i = this.idx(x, y) * 4;
    return [this.d[i]!, this.d[i + 1]!, this.d[i + 2]!, this.d[i + 3]!];
  }

  rgb(x: number, y: number): RGB {
    const i = this.idx(x, y) * 4;
    return [this.d[i]!, this.d[i + 1]!, this.d[i + 2]!];
  }

  alpha(x: number, y: number): number {
    return this.d[this.idx(x, y) * 4 + 3]!;
  }

  clear(x: number, y: number): void {
    this.d[this.idx(x, y) * 4 + 3] = 0;
  }

  /** Multiplies a pixel's colour (k > 1 brightens). */
  mul(x: number, y: number, k: number): void {
    const i = this.idx(x, y) * 4;
    this.d[i] = this.d[i]! * k;
    this.d[i + 1] = this.d[i + 1]! * k;
    this.d[i + 2] = this.d[i + 2]! * k;
  }

  /** Blends a pixel toward a colour by t (0..1). */
  mix(x: number, y: number, color: string | RGB, t: number): void {
    const c = typeof color === 'string' ? hex(color) : color;
    const i = this.idx(x, y) * 4;
    this.d[i] = this.d[i]! + (c[0] - this.d[i]!) * t;
    this.d[i + 1] = this.d[i + 1]! + (c[1] - this.d[i + 1]!) * t;
    this.d[i + 2] = this.d[i + 2]! + (c[2] - this.d[i + 2]!) * t;
  }

  rect(x: number, y: number, w: number, h: number, color: string | RGB, a = 255): void {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) this.set(xx, yy, color, a);
  }

  fill(color: string | RGB): void {
    this.rect(0, 0, this.w, this.h, color);
  }

  /** Copies colour and every extra channel from another grid of the same size. */
  copy(from: Pix): void {
    this.d.set(from.d);
    this.hgt.set(from.hgt);
    this.spec.set(from.spec);
    this.glow.set(from.glow);
    this.heightSet = from.heightSet;
    this.bump = from.bump;
  }

  /** Sets the height (0 deep .. 1 raised) of a pixel. */
  H(x: number, y: number, h: number): void {
    this.hgt[this.idx(x, y)] = h;
    this.heightSet = true;
  }

  addH(x: number, y: number, dh: number): void {
    const i = this.idx(x, y);
    this.hgt[i] = this.hgt[i]! + dh;
    this.heightSet = true;
  }

  getH(x: number, y: number): number {
    return this.hgt[this.idx(x, y)]!;
  }

  /** Specular strength / smoothness 0..1. */
  S(x: number, y: number, s: number): void {
    this.spec[this.idx(x, y)] = s;
  }

  /** Emissive strength 0..1 (the pixel glows in the dark and blooms). */
  E(x: number, y: number, e: number): void {
    this.glow[this.idx(x, y)] = e;
  }

  toCanvas(): HTMLCanvasElement {
    const canvas = makeCanvas(this.w, this.h);
    const c = ctx2d(canvas);
    const img = c.createImageData(this.w, this.h);
    img.data.set(this.d);
    c.putImageData(img, 0, 0);
    return canvas;
  }
}

export type Painter = (p: Pix, rng: Rng) => void;

// ------------------------------------------------------------------ painter toolkit

export function pick<T>(rng: Rng, palette: readonly T[], weights?: readonly number[]): T {
  if (!weights) return palette[Math.floor(rng() * palette.length)]!;
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng() * total;
  for (let i = 0; i < palette.length; i += 1) {
    roll -= weights[i]!;
    if (roll <= 0) return palette[i]!;
  }
  return palette[palette.length - 1]!;
}

/** Tileable value noise with `cells` lattice points per `size`-pixel period. */
export function tileNoise(seed: number, cells: number, size = TEX): (x: number, y: number) => number {
  const rng = mulberry32(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();
  const at = (ix: number, iy: number): number => lattice[(((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells)]!;
  return (x, y) => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Two-octave tileable noise (0..1). */
export function tileFbm(seed: number, cells: number, size = TEX): (x: number, y: number) => number {
  const a = tileNoise(seed, cells, size);
  const b = tileNoise(seed + 7, cells * 2, size);
  return (x, y) => a(x, y) * 0.66 + b(x, y) * 0.34;
}

/** Picks palette entries (dark -> light) from smooth noise blended with per-pixel grain. */
export function noiseFill(p: Pix, rng: Rng, palette: readonly string[], seed: number, cells = 4, grain = 0.45, bias = 0): void {
  const n = tileNoise(seed, cells, p.w);
  for (let y = 0; y < p.h; y += 1) {
    for (let x = 0; x < p.w; x += 1) {
      const v = Math.max(0, Math.min(0.999, n(x, y) * (1 - grain) + rng() * grain + bias));
      p.set(x, y, palette[Math.floor(v * palette.length)]!);
    }
  }
}

export interface VoronoiCell {
  x: number;
  y: number;
  tone: number;
}

/** Tileable Voronoi: owner cell per pixel, distance to its seed and to the nearest border. */
export function voronoi(rng: Rng, count: number, size = TEX, squashY = 1.15): { cells: VoronoiCell[]; owner: Int16Array; edge: Float32Array; dist: Float32Array } {
  const cells: VoronoiCell[] = [];
  for (let i = 0; i < count; i += 1) cells.push({ x: rng() * size, y: rng() * size, tone: rng() });
  const owner = new Int16Array(size * size);
  const edge = new Float32Array(size * size);
  const dist = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let best = 1e9;
      let second = 1e9;
      let bestIndex = 0;
      for (let index = 0; index < cells.length; index += 1) {
        const c = cells[index]!;
        for (const ox of [-size, 0, size]) {
          for (const oy of [-size, 0, size]) {
            const dx = x + 0.5 - (c.x + ox);
            const dy = (y + 0.5 - (c.y + oy)) * squashY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < best) {
              second = best;
              best = d;
              bestIndex = index;
            } else if (d < second) second = d;
          }
        }
      }
      owner[y * size + x] = bestIndex;
      edge[y * size + x] = (second - best) * 0.5;
      dist[y * size + x] = best;
    }
  }
  return { cells, owner, edge, dist };
}

export function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Palette sample at t in 0..1 with linear interpolation between stops. */
export function ramp(stops: readonly string[], t: number): RGB {
  const v = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(v);
  return lerpRGB(hex(stops[i]!), hex(stops[Math.min(stops.length - 1, i + 1)]!), v - i);
}

// ------------------------------------------------------------------ registry

interface Entry {
  painter: Painter;
  seed: number;
  pix: Pix | null;
}

const entries = new Map<string, Entry>();
const layerIndex = new Map<string, number>();
const canvases = new Map<string, HTMLCanvasElement>();
const iconURLs = new Map<string, string>();

/** Registers a painter for a texture name (later registrations replace earlier ones). */
export function register(name: string, painter: Painter, seed: number): void {
  entries.set(name, { painter, seed, pix: null });
}

/** The painted grid of a texture, painting it (and its dependencies) on first use. */
export function base(name: string): Pix {
  const entry = entries.get(name);
  if (!entry) throw new Error(`texture ${name} has no painter`);
  if (!entry.pix) {
    const p = new Pix();
    entry.painter(p, mulberry32(entry.seed));
    entry.pix = p;
  }
  return entry.pix;
}

export function hasTexture(name: string): boolean {
  return entries.has(name);
}

let built = false;

/** Paints every registered texture and assigns texture-array layers. */
export function buildTextures(install: () => void): void {
  if (built) return;
  built = true;
  install();
  for (const name of entries.keys()) {
    base(name);
    if (!layerIndex.has(name)) layerIndex.set(name, layerIndex.size);
  }
}

export function tex(key: string): HTMLCanvasElement {
  let c = canvases.get(key);
  if (!c) {
    const entry = entries.get(key) ?? entries.get('dirt')!;
    c = (entry.pix ?? base(key)).toCanvas();
    canvases.set(key, c);
  }
  return c;
}

/** Texture-array layer of a tile. */
export function layerOf(key: string): number {
  return layerIndex.get(key) ?? 0;
}

/** Every texture's layer number (for a worker's copy). */
export function layerTable(): Array<[string, number]> {
  return [...layerIndex];
}

/** A worker's copy of the main thread's layer numbers (it paints nothing itself). */
export function adoptLayers(list: ReadonlyArray<readonly [string, number]>): void {
  for (const [name, layer] of list) layerIndex.set(name, layer);
}

export function layerCount(): number {
  return layerIndex.size;
}

/** Opaque pixel mask of a texture (for extruded 3D item models). */
export function alphaMask(key: string): Uint8Array {
  const p = entries.get(key)?.pix ?? base('dirt');
  const mask = new Uint8Array(p.w * p.h);
  for (let i = 0; i < mask.length; i += 1) mask[i] = p.d[i * 4 + 3]! >= 128 ? 1 : 0;
  return mask;
}

export const MIP_LEVELS = 6;

function orderedLayers(): Pix[] {
  const ordered: Pix[] = [];
  for (const [key, layer] of layerIndex) ordered[layer] = base(key);
  return ordered;
}

/**
 * RGBA data for every mip level of the colour array (all layers concatenated). Colours are
 * alpha-weighted and cut-out coverage is preserved, so leaves stay leafy far away.
 */
export function colorMips(): Uint8Array[] {
  const ordered = orderedLayers();
  const count = ordered.length;
  const levels: Uint8Array[] = [];
  for (let level = 0; level < MIP_LEVELS; level += 1) {
    const size = TEX >> level;
    levels.push(new Uint8Array(size * size * 4 * count));
  }
  ordered.forEach((p, layer) => {
    // Level 0, with transparent texels taking their neighbours' colours (no dark fringes).
    let cur = new Float32Array(TEX * TEX * 4);
    for (let i = 0; i < TEX * TEX * 4; i += 1) cur[i] = p.d[i]! / 255;
    dilate(cur, TEX);
    const coverage = coverageOf(cur, TEX, 1);
    let size = TEX;
    for (let level = 0; level < MIP_LEVELS; level += 1) {
      const out = levels[level]!;
      const offset = layer * size * size * 4;
      for (let i = 0; i < size * size * 4; i += 1) out[offset + i] = Math.round(Math.max(0, Math.min(1, cur[i]!)) * 255);
      if (level === MIP_LEVELS - 1) break;
      const half = size >> 1;
      const next = new Float32Array(half * half * 4);
      for (let y = 0; y < half; y += 1) {
        for (let x = 0; x < half; x += 1) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            const i = ((y * 2 + dy) * size + (x * 2 + dx)) * 4;
            const w = cur[i + 3]! + 0.002;
            // Average in linear light so mips do not darken.
            r += Math.pow(cur[i]!, 2.2) * w;
            g += Math.pow(cur[i + 1]!, 2.2) * w;
            b += Math.pow(cur[i + 2]!, 2.2) * w;
            a += w;
          }
          const o = (y * half + x) * 4;
          next[o] = Math.pow(r / a, 1 / 2.2);
          next[o + 1] = Math.pow(g / a, 1 / 2.2);
          next[o + 2] = Math.pow(b / a, 1 / 2.2);
          next[o + 3] = Math.min(1, (a - 0.008) / 4);
        }
      }
      if (coverage < 0.999) preserveCoverage(next, half, coverage);
      cur = next;
      size = half;
    }
  });
  return levels;
}

/** Height of a texel, derived from brightness when the painter did not set one. */
function heightField(p: Pix): Float32Array {
  if (p.heightSet) return p.hgt;
  const h = new Float32Array(p.w * p.h);
  for (let i = 0; i < h.length; i += 1) {
    const r = p.d[i * 4]!;
    const g = p.d[i * 4 + 1]!;
    const b = p.d[i * 4 + 2]!;
    h[i] = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
  }
  return h;
}

/**
 * Per-layer material data for every mip level: RG = tangent-space normal (x, y), B = specular,
 * A = glow. Normals come from a wrapped Sobel filter over the height field.
 */
export function materialMips(): Uint8Array[] {
  const ordered = orderedLayers();
  const count = ordered.length;
  const levels: Uint8Array[] = [];
  for (let level = 0; level < MIP_LEVELS; level += 1) {
    const size = TEX >> level;
    levels.push(new Uint8Array(size * size * 4 * count));
  }
  ordered.forEach((p, layer) => {
    const h = heightField(p);
    const strength = (p.heightSet ? 3.2 : 1.6) * p.bump;
    let cur = new Float32Array(TEX * TEX * 4);
    const at = (x: number, y: number): number => h[(((y + TEX) % TEX) * TEX) + ((x + TEX) % TEX)]!;
    for (let y = 0; y < TEX; y += 1) {
      for (let x = 0; x < TEX; x += 1) {
        const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
        const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
        // Tangent frame: +x along u, +y along v (down the tile), +z out of the face.
        let nx = -dx * strength;
        let ny = -dy * strength;
        let nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l;
        ny /= l;
        nz /= l;
        const i = (y * TEX + x) * 4;
        cur[i] = nx;
        cur[i + 1] = ny;
        cur[i + 2] = p.spec[y * TEX + x]!;
        cur[i + 3] = p.glow[y * TEX + x]!;
      }
    }
    let size = TEX;
    for (let level = 0; level < MIP_LEVELS; level += 1) {
      const out = levels[level]!;
      const offset = layer * size * size * 4;
      for (let i = 0; i < size * size; i += 1) {
        out[offset + i * 4] = Math.round((cur[i * 4]! * 0.5 + 0.5) * 255);
        out[offset + i * 4 + 1] = Math.round((cur[i * 4 + 1]! * 0.5 + 0.5) * 255);
        out[offset + i * 4 + 2] = Math.round(Math.max(0, Math.min(1, cur[i * 4 + 2]!)) * 255);
        out[offset + i * 4 + 3] = Math.round(Math.max(0, Math.min(1, cur[i * 4 + 3]!)) * 255);
      }
      if (level === MIP_LEVELS - 1) break;
      const half = size >> 1;
      const next = new Float32Array(half * half * 4);
      for (let y = 0; y < half; y += 1) {
        for (let x = 0; x < half; x += 1) {
          let nx = 0;
          let ny = 0;
          let s = 0;
          let e = 0;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            const i = ((y * 2 + dy) * size + (x * 2 + dx)) * 4;
            nx += cur[i]!;
            ny += cur[i + 1]!;
            s += cur[i + 2]!;
            e += cur[i + 3]!;
          }
          // Distant mips flatten out, like a real surface seen from afar.
          const o = (y * half + x) * 4;
          next[o] = (nx / 4) * 0.8;
          next[o + 1] = (ny / 4) * 0.8;
          next[o + 2] = s / 4;
          next[o + 3] = e / 4;
        }
      }
      cur = next;
      size = half;
    }
  });
  return levels;
}

function dilate(d: Float32Array, size: number): void {
  for (let pass = 0; pass < 3; pass += 1) {
    const src = d.slice();
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        if (src[i + 3]! > 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = ((((y + dy) % size) + size) % size * size + ((((x + dx) % size) + size) % size)) * 4;
          if (src[j + 3]! > 0 || (pass > 0 && (src[j]! + src[j + 1]! + src[j + 2]!) > 0)) {
            r += src[j]!;
            g += src[j + 1]!;
            b += src[j + 2]!;
            n += 1;
          }
        }
        if (n > 0) {
          d[i] = r / n;
          d[i + 1] = g / n;
          d[i + 2] = b / n;
        }
      }
    }
  }
}

function coverageOf(d: Float32Array, size: number, scale: number): number {
  let n = 0;
  for (let i = 0; i < size * size; i += 1) if (d[i * 4 + 3]! * scale >= 0.5) n += 1;
  return n / (size * size);
}

function preserveCoverage(d: Float32Array, size: number, target: number): void {
  let lo = 0;
  let hi = 8;
  for (let it = 0; it < 14; it += 1) {
    const mid = (lo + hi) / 2;
    if (coverageOf(d, size, mid) < target) lo = mid;
    else hi = mid;
  }
  for (let i = 0; i < size * size; i += 1) d[i * 4 + 3] = Math.min(1, d[i * 4 + 3]! * hi);
}

// ------------------------------------------------------------------ mob skins

/** Skin atlas: 2x-resolution Minecraft box-UV sheets (128x128 each, sixteen rows of four). */
export const SKIN_W = 512;
export const SKIN_H = 2048;
/** Texels per model pixel in the skin atlas. */
export const SKIN_SCALE = 2;
const skinOrigin = new Map<string, [number, number]>([
  ['zombie', [0, 0]],
  ['creeper', [128, 0]],
  ['villager', [256, 0]],
  ['skeleton', [384, 0]],
  ['builder', [0, 128]],
  ['smith', [128, 128]],
  ['farmer', [256, 128]],
  ['husk', [384, 128]],
  ['spider', [0, 256]],
  ['phantom', [128, 256]],
  ['trader', [256, 256]],
  ['raider', [384, 256]],
  ['goldcreeper', [0, 384]],
  ['wolf', [128, 384]],
  ['chicken', [256, 384]],
  ['sheep', [384, 384]],
  ['enderman', [0, 512]],
  ['witch', [128, 512]],
  ['slime', [256, 512]],
  ['pillager', [384, 512]],
  ['vindicator', [0, 640]],
  ['evoker', [128, 640]],
  ['vex', [256, 640]],
  ['cavespider', [384, 640]],
  ['stray', [0, 768]],
  ['witherskel', [128, 768]],
  ['armor', [256, 768]],
  ['ravager', [384, 768]],
  ['ghast', [0, 896]],
  ['wither', [128, 896]],
  ['zvillager', [256, 896]],
  ['builder2', [384, 896]],
  // The Long March: the new lands' monsters, the seal guardians and the new folk.
  ['drowned', [0, 1024]],
  ['bogged', [128, 1024]],
  ['breeze', [256, 1024]],
  ['polarbear', [384, 1024]],
  ['blaze', [0, 1152]],
  ['magmacube', [128, 1152]],
  ['golem', [256, 1152]],
  ['golem2', [384, 1152]],
  ['wtrader', [0, 1280]],
  ['llama', [128, 1280]],
  ['camel', [256, 1280]],
  ['frog', [384, 1280]],
  ['queen', [0, 1408]],
  ['ravking', [128, 1408]],
  ['veyra', [256, 1408]],
  // The officers.
  ['npc_brannoc', [384, 1408]],
  ['npc_wren', [0, 1536]],
  ['npc_bo', [128, 1536]],
  ['npc_amina', [256, 1536]],
  ['npc_moss', [384, 1536]],
  ['npc_gil', [0, 1664]],
  ['npc_kel', [128, 1664]],
  ['npc_tova', [256, 1664]],
  ['npc_aurel', [384, 1664]],
  ['npc_yrsa', [0, 1792]],
  ['npc_orsa', [128, 1792]],
  ['npc_lumen', [256, 1792]],
]);

export type SkinPainter = (atlas: Pix, origin: (name: string) => [number, number]) => void;

const skinPainters: SkinPainter[] = [];

/** Adds a painter for some of the atlas's sheets (each paints its own). */
export function registerSkins(painter: SkinPainter): void {
  skinPainters.push(painter);
}

/**
 * Mob skins packed in one atlas for the GPU. Self-lit texels (eyes that glow in the dark) ride in
 * the alpha channel: an opaque texel's alpha drops towards 135 as its glow rises to 1, which the
 * shader turns back into glow (cut-outs keep everything at or above half alpha).
 */
export function buildSkinAtlas(): Uint8Array {
  const atlas = new Pix(SKIN_W, SKIN_H);
  for (const paint of skinPainters) paint(atlas, (name) => skinOrigin.get(name) ?? [0, 0]);
  const out = new Uint8Array(atlas.d.buffer.slice(0));
  for (let i = 0; i < atlas.glow.length; i += 1) {
    const glow = atlas.glow[i]!;
    if (glow > 0 && out[i * 4 + 3] === 255) out[i * 4 + 3] = 255 - Math.round(Math.min(1, glow) * 120);
  }
  return out;
}

/** Top-left atlas texel of a skin sheet. */
export function skinPx(key: string): [number, number] {
  return skinOrigin.get(key) ?? [0, 0];
}

// ------------------------------------------------------------------ DOM icons

/** Data URL for DOM icons; drawn at 64x64 so browsers keep crisp pixels. */
export function iconURL(key: string): string {
  const cached = iconURLs.get(key);
  if (cached) return cached;
  const source = hudCanvases.get(key) ?? tex(key);
  const canvas = makeCanvas(64, 64);
  const c = ctx2d(canvas);
  c.drawImage(source, 0, 0, 64, 64);
  const url = canvas.toDataURL('image/png');
  iconURLs.set(key, url);
  return url;
}

const hudCanvases = new Map<string, HTMLCanvasElement>();

/** HUD-only icons (not GPU layers): painted on their own small grids. */
export function registerHudIcon(key: string, size: number, draw: (p: Pix, rng: Rng) => void, seed: number): void {
  const p = new Pix(size, size);
  draw(p, mulberry32(seed));
  hudCanvases.set(key, p.toCanvas());
}
