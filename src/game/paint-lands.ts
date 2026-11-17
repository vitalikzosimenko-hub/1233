// Textures of the Long March's new lands: the swamp's mud, lily pads, reeds and murky leaves,
// the badlands' banded terracotta and red sand, the ember wastes' basalt, blackstone, magma and
// ash, the frozen pass's packed and blue ice, and the Heart's green seal crystal. Same
// conventions as paint.ts: only the seeded rng and tileable toolkit noise are used, relief
// writes height, ice / wet / crystal surfaces write specular and embers / magma / crystal glow.
import type { Rng } from './rng';
import { clamp01, clearAll, each, outline, shapeFill, TAU, tone } from './paint-extra';
import { hex, register, tileFbm, tileNoise, voronoi, type Pix, type RGB } from './textures';

type Col = string | RGB;
const W = 32;

// ------------------------------------------------------------------ small helpers (mirrors paint.ts)

function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
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

function seedFrom(rng: Rng): number {
  return Math.floor(rng() * 2147483646) + 1;
}

/** Height slope toward the top-left light: > 0 lit, < 0 shaded. */
function lit(p: Pix, x: number, y: number): number {
  return p.getH(x + 1, y + 1) - p.getH(x - 1, y - 1);
}

/** Wrapped horizontal distance. */
function wdx(a: number, b: number): number {
  let d = Math.abs(a - b) % W;
  if (d > W / 2) d = W - d;
  return d;
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

/** Small raised clumps: a lit top-left pixel, a dark bottom-right pixel. */
function pebbles(p: Pix, rng: Rng, count: number, pal: readonly string[], hRaise = 0.15, tLo = 0, tHi = 1): void {
  for (let i = 0; i < count; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const w = 1 + Math.floor(rng() * 2);
    const h = 1 + Math.floor(rng() * 2);
    const t = tLo + rng() * (tHi - tLo);
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

interface BrickOpts {
  rowH: number;
  bw: number;
  offsets: readonly number[];
  pal: readonly string[];
  mortar: readonly string[];
  toneVar: number;
  noise: number;
}

/** Brick wall: rows of bricks with 1px mortar, offset joints and a bevel per brick. */
function paintBricks(p: Pix, rng: Rng, o: BrickOpts): void {
  const g = grainField(rng, 8, 0.55);
  const tones = new Map<number, number>();
  each((x, y) => {
    const row = Math.floor(y / o.rowH);
    const ly = y - row * o.rowH;
    const off = o.offsets[row % o.offsets.length]!;
    const xx = (((x - off) % W) + W) % W;
    const col = Math.floor(xx / o.bw);
    const lx = xx - col * o.bw;
    if (ly === o.rowH - 1 || lx === o.bw - 1) {
      p.set(x, y, tone(o.mortar, g(x, y)));
      p.H(x, y, 0.1);
      return;
    }
    const id = row * 16 + col;
    let bt = tones.get(id);
    if (bt === undefined) {
      bt = rng();
      tones.set(id, bt);
    }
    let t = 0.5 + (bt - 0.5) * o.toneVar + (g(x, y) - 0.5) * o.noise;
    let h = 0.75;
    if (ly === 0 || lx === 0) {
      t += 0.24;
      h = 0.68;
    } else if (ly === o.rowH - 2 || lx === o.bw - 2) {
      t -= 0.24;
      h = 0.68;
    } else if (ly === 1 || lx === 1) t += 0.06;
    p.set(x, y, tone(o.pal, t));
    p.H(x, y, h);
  });
}

/** Log end: growth rings inside a bark rim (mirrors paint.ts logRings). */
function logRings(p: Pix, rng: Rng, wood: readonly string[], bark: readonly string[], rimW = 2): void {
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
}

/** Shaded ball tone (lit top-left), null outside the radius. */
function sphereTone(x: number, y: number, cx: number, cy: number, R: number): number | null {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r > R) return null;
  const nz = Math.sqrt(Math.max(0, 1 - (r / R) ** 2));
  return clamp01((-dx * 0.5 - dy * 0.6) / R + nz * 0.6) * 0.85;
}

// ------------------------------------------------------------------ palettes

const MUD = ['#241f1c', '#2c2622', '#342d29', '#3c3530', '#453c36', '#4e453e', '#584e46', '#655a51'];
const MUD_PEBBLE = ['#4a4038', '#5a5047', '#6a6056', '#7a7064', '#8a8072'];
const MUD_BRICK = ['#6a5140', '#785c48', '#856650', '#917158', '#9c7b60', '#a68569', '#b09072', '#ba9b7d'];
const MUD_MORTAR = ['#4a3a2e', '#544235', '#5d4a3c'];
const LILY = ['#24521e', '#2e6426', '#39772f', '#468a38', '#539c42', '#62ad4d', '#74bd5c', '#8acc70'];
const SWAMP_LEAF = ['#2a4624', '#34542b', '#3e6232', '#49703a', '#557e42', '#618c4b', '#6e9955', '#7ea862'];
const RED_SAND = ['#8e4418', '#9c4c1c', '#aa5520', '#b55e25', '#bf672b', '#c87132', '#d17c3c', '#da8a4a'];
const RED_SANDSTONE = ['#7e3c16', '#8c441a', '#9a4c1e', '#a65522', '#b05d27', '#ba662d', '#c37034', '#cd7c3e'];
const TERRA_ORANGE = ['#7a3d13', '#874416', '#954b19', '#a2531c', '#ab5b22', '#b4642a', '#bc6e33'];
const TERRA_YELLOW = ['#8a6118', '#986b1b', '#a7761f', '#b88524', '#c18e2b', '#c99834', '#d0a240'];
const TERRA_WHITE = ['#a3877a', '#b09283', '#bc9d8e', '#cbaa9a', '#d3b4a5', '#d9bdaf', '#dfc6b9'];
const TERRA_BROWN = ['#33210f', '#3b2717', '#442d1d', '#4e3324', '#563a2a', '#5e4130', '#664836'];
const DIRT = ['#4b311f', '#5a3c26', '#6a472e', '#795234', '#875d3b', '#966944', '#a5774f'];
const GRAVEL = ['#3e3b39', '#4c4845', '#5b5652', '#6a645f', '#79726c', '#89817a', '#999189'];
const BASALT_TOP = ['#232327', '#2b2b30', '#343439', '#3d3d43', '#47474d', '#525258', '#5e5e64', '#6b6b71'];
const BASALT_SIDE = ['#22242a', '#2a2c33', '#32353d', '#3b3e47', '#454851', '#4f535c', '#5b5f68', '#686c76'];
const BLACKSTONE = ['#121014', '#18151b', '#1f1b22', '#26212a', '#2e2833', '#37303c', '#413946', '#4c4352'];
const MAGMA_CRUST = ['#170705', '#220a07', '#2e0e09', '#3c130b', '#4c190d', '#5e2010', '#722913'];
const MAGMA_HOT = ['#8a1e06', '#b8320a', '#e0520e', '#f87a18', '#ffa22a', '#ffc84a', '#ffe68a'];
const ASH = ['#3a3737', '#423f3f', '#4b4848', '#545151', '#5d5a5a', '#676463', '#716e6d', '#7c7978'];
const CHAR = ['#0c0a09', '#12100e', '#191613', '#201c18', '#28231e', '#312b25', '#3b342d', '#463e36'];
const EMBER = ['#4a1406', '#7a2208', '#b03c0c', '#e06414', '#ff9a2e'];
const CHAR_END = ['#1a1310', '#241a15', '#2f221b', '#3a2b21', '#463428', '#523e30'];
const NETHER = ['#26100f', '#2f1413', '#391817', '#431c1b', '#4d2120', '#582725', '#642d2b', '#70342f'];
const NETHER_MORTAR = ['#120708', '#180a0b', '#1e0d0e'];
const PACKED_ICE = ['#7d9dd6', '#88a7dc', '#94b2e2', '#a0bce7', '#acc6eb', '#b9d0ef', '#c6daf3', '#d4e4f7'];
const BLUE_ICE = ['#2f5fc8', '#3769cf', '#4073d6', '#4a7ddc', '#5588e1', '#6194e6', '#70a0eb', '#82aef0'];
const SEAL = ['#03301a', '#064a26', '#0a6633', '#118641', '#1aa751', '#2cc865', '#4cff8a', '#9effc4', '#e4fff0'];
const WIND = ['#2c6a82', '#4588a2', '#62a6be', '#84c4d6', '#a8dcea', '#c8eef6', '#e6faff', '#ffffff'];

// ------------------------------------------------------------------ swamp

function paintMud(p: Pix, rng: Rng): void {
  const f = grainField(rng, 5, 0.28);
  const wet = tileFbm(seedFrom(rng), 4);
  const blob = tileNoise(seedFrom(rng), 8);
  each((x, y) => {
    const w = wet(x, y);
    const b = blob(x, y);
    let t = 0.42 + (f(x, y) - 0.5) * 0.55 + (b - 0.5) * 0.3;
    let h = 0.45 + (b - 0.5) * 0.12 + (f(x, y) - 0.5) * 0.05;
    let s = 0.12;
    if (w < 0.38) {
      // Wet hollows: darker, lower, glossy.
      t -= 0.22 + (0.38 - w) * 0.8;
      h -= 0.1;
      s = 0.45 + (0.38 - w) * 1.2;
    }
    p.set(x, y, tone(MUD, t));
    p.H(x, y, h);
    p.S(x, y, Math.min(0.7, s));
  });
  // Rims of the wet hollows catch a faint light.
  each((x, y) => {
    if (p.spec[p.idx(x, y)]! > 0.4 && p.spec[p.idx(x - 1, y - 1)]! < 0.3) p.set(x, y, MUD[5]!);
  });
  // Small lighter pebbles pressed into the mud.
  for (let i = 0; i < 12; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (wet(x, y) < 0.38) continue;
    const big = rng() < 0.4;
    p.set(x, y, MUD_PEBBLE[big ? 3 : 2]!);
    p.addH(x, y, 0.15);
    if (big) {
      p.set(x + 1, y, MUD_PEBBLE[2]!);
      p.set(x, y + 1, MUD_PEBBLE[1]!);
      p.set(x + 1, y + 1, MUD_PEBBLE[0]!);
      p.addH(x + 1, y, 0.12);
      p.addH(x, y + 1, 0.1);
      p.set(x + 2, y + 2, MUD[0]!);
    } else p.set(x + 1, y + 1, MUD[1]!);
  }
  // Dark sludge pits.
  for (let i = 0; i < 16; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, MUD[0]!);
    p.H(x, y, 0.3);
  }
  p.bump = 0.6;
}

function paintMudBricks(p: Pix, rng: Rng): void {
  paintBricks(p, rng, { rowH: 8, bw: 16, offsets: [0, 8], pal: MUD_BRICK, mortar: MUD_MORTAR, toneVar: 0.35, noise: 0.4 });
  // Straw flecks pressed into the dried mud.
  for (let i = 0; i < 22; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (p.getH(x, y) < 0.7 || p.getH(x + 1, y) < 0.7) continue;
    const light = rng() < 0.6;
    p.set(x, y, light ? '#c8a878' : '#7a5e44');
    if (rng() < 0.6) p.set(x + 1, y, light ? '#bc9c6c' : '#6e543c');
  }
  // Pits and drying cracks.
  for (let i = 0; i < 14; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (p.getH(x, y) < 0.7) continue;
    p.set(x, y, MUD_BRICK[1]!);
    p.set(x - 1, y - 1, MUD_BRICK[6]!);
    p.H(x, y, 0.6);
  }
  p.bump = 0.9;
}

function paintLilyPad(p: Pix, rng: Rng): void {
  clearAll(p);
  const cx = 15.5;
  const cy = 15.5;
  const notch = 0.95; // notch direction (radians): toward the lower right
  const g = grainField(rng, 6, 0.35);
  const edgeN = tileNoise(seedFrom(rng), 8);
  const veinAngles: number[] = [];
  for (let k = 0; k < 9; k += 1) veinAngles.push(notch + 0.42 + (k / 8) * (TAU - 0.84));
  each((x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    const R = 14.2 + (edgeN(x, y) - 0.5) * 1.6;
    if (r > R) return;
    // Wedge notch from the rim to the centre.
    let da = Math.abs(a - notch);
    if (da > Math.PI) da = TAU - da;
    if (r > 1.2 && da < 0.2 + 0.6 / Math.max(1, r)) return;
    let minVein = 99;
    for (const va of veinAngles) {
      let d = (((a - va) % TAU) + TAU) % TAU;
      if (d > Math.PI) d = TAU - d;
      minVein = Math.min(minVein, d * r);
    }
    let t = 0.6 + (g(x, y) - 0.5) * 0.3 - (dx + dy) / 150;
    let h = 0.6;
    if (r > R - 1.2) {
      t -= 0.3;
      h = 0.5;
    } else if (r > R - 2.2) t -= 0.1;
    if (minVein < 0.55 && r > 2.5 && r < R - 1.5) {
      t -= 0.3;
      h = 0.45;
    } else if (minVein < 1.5 && r > 2.5) t += 0.06;
    if (r < 1.8) t += 0.15;
    p.set(x, y, tone(LILY, t));
    p.H(x, y, h);
    p.S(x, y, 0.3);
  });
  // A few lighter waxy highlights on the upper-left half.
  for (let i = 0; i < 10; i += 1) {
    const x = 6 + Math.floor(rng() * 12);
    const y = 6 + Math.floor(rng() * 12);
    if (p.alpha(x, y) === 0) continue;
    p.set(x, y, LILY[6]!);
    p.S(x, y, 0.5);
  }
}

function mushroomStem(p: Pix, x0: number, w: number, top: number): void {
  const stemPal = ['#8e8270', '#a89a86', '#c2b59e', '#d8ccb6', '#e8dfcc', '#f4eedf'];
  for (let y = top; y < W; y += 1) {
    for (let k = 0; k < w; k += 1) {
      let t = k === 0 ? 0.85 : k === w - 1 ? 0.2 : 0.6 - (k / w) * 0.2;
      if (y === top) t -= 0.35;
      if (y >= 30) t -= 0.12;
      put(p, x0 + k, y, tone(stemPal, t));
      p.H(x0 + k, y, 0.6);
    }
  }
}

function paintRedMushroom(p: Pix, rng: Rng): void {
  clearAll(p);
  const cap = ['#4e0a08', '#6e0e0c', '#8e1610', '#b01e16', '#cc2c1e', '#e2442e', '#f26a4e'];
  mushroomStem(p, 13, 6, 21);
  const cx = 15.5;
  const cy = 21;
  const rx = 9.5;
  const ry = 9;
  each((x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    if (dy > 0.12 || dx * dx + dy * dy > 1) return;
    const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    let t = 0.45 + nz * 0.25 - dx * 0.25 - dy * 0.15;
    if (dx * dx + dy * dy > 0.8) t -= 0.2;
    if (dy > -0.05) t = 0.05 + (1 - Math.abs(dx)) * 0.1; // dark gill rim under the cap
    put(p, x, y, tone(cap, t));
    p.H(x, y, 0.5 + nz * 0.4);
    p.S(x, y, 0.25);
  });
  // White spots.
  const spots: [number, number, number][] = [[11, 15, 2], [17, 13, 2], [21, 17, 1], [14, 18, 1], [19, 18, 1], [9, 19, 1], [15, 15, 1]];
  for (const [sx, sy, sz] of spots) {
    for (let yy = 0; yy < sz; yy += 1) {
      for (let xx = 0; xx < sz; xx += 1) {
        if (p.alpha(sx + xx, sy + yy) === 0) continue;
        p.set(sx + xx, sy + yy, xx + yy === 0 ? '#ffffff' : '#e6dcd2');
        p.addH(sx + xx, sy + yy, 0.08);
      }
    }
    if (p.alpha(sx + sz, sy + sz) > 0 && rng() < 0.8) p.mul(sx + sz, sy + sz, 0.85);
  }
}

function paintBrownMushroom(p: Pix, rng: Rng): void {
  clearAll(p);
  const cap = ['#3e2818', '#4e331f', '#604027', '#734d30', '#865b3a', '#9a6b46', '#ad7c54', '#c08f66'];
  mushroomStem(p, 14, 4, 22);
  each((x, y) => {
    const dx = (x + 0.5 - 15.5) / 11;
    if (Math.abs(dx) > 1) return;
    const top = 17 + Math.round(dx * dx * 3.2);
    const bottom = 22 + (Math.abs(dx) > 0.82 ? -1 : 0);
    if (y < top || y > bottom) return;
    let t = 0.5 - dx * 0.2 + (rng() - 0.5) * 0.12;
    if (y === top) t += 0.25;
    else if (y === top + 1) t += 0.08;
    if (y === bottom) t = 0.06;
    else if (y === bottom - 1) t -= 0.2;
    put(p, x, y, tone(cap, t));
    p.H(x, y, y === bottom ? 0.4 : 0.7);
  });
  // Pale speckles on the cap top.
  for (const [x, y] of [[10, 18], [14, 17], [19, 18], [22, 19], [12, 19], [17, 19]] as const) {
    if (p.alpha(x, y) > 0) p.set(x, y, cap[7]!);
  }
}

function paintSwampLeaves(p: Pix, rng: Rng): void {
  const n = tileFbm(seedFrom(rng), 4);
  each((x, y) => {
    const v = n(x, y);
    p.set(x, y, tone(SWAMP_LEAF, v * 0.45 + rng() * 0.25));
    p.H(x, y, 0.35 + v * 0.3);
  });
  // Drooping leaf clusters: a lit crown that trails down into darker tips.
  for (let i = 0; i < 80; i += 1) {
    const cx = Math.floor(rng() * W);
    const cy = Math.floor(rng() * W);
    const t = 0.35 + rng() * 0.55 + (n(cx, cy) - 0.5) * 0.3;
    p.set(cx, cy, tone(SWAMP_LEAF, t));
    p.set(cx - 1, cy, tone(SWAMP_LEAF, t + 0.12));
    p.set(cx, cy - 1, tone(SWAMP_LEAF, t + 0.2));
    p.set(cx + 1, cy, tone(SWAMP_LEAF, t - 0.12));
    p.H(cx, cy, 0.85);
    p.H(cx - 1, cy, 0.75);
    p.H(cx, cy - 1, 0.78);
    p.H(cx + 1, cy, 0.7);
    const drip = 2 + Math.floor(rng() * 3);
    const dx = rng() < 0.5 ? 0 : rng() < 0.5 ? -1 : 1;
    for (let k = 1; k <= drip; k += 1) {
      const xx = cx + (k > 1 ? dx : 0);
      p.set(xx, cy + k, tone(SWAMP_LEAF, t - 0.08 - k * 0.1));
      p.H(xx, cy + k, 0.72 - k * 0.06);
    }
  }
  // Holes elongated vertically (hanging gaps between the drooping fronds).
  const hn = tileNoise(seedFrom(rng), 6);
  const scores: [number, number][] = [];
  each((x, y) => scores.push([hn(x * 2, y) * 0.8 + n(x, y) * 0.35 + rng() * 0.2, y * W + x]));
  scores.sort((a, b) => a[0] - b[0]);
  const holes = Math.round(W * W * 0.12);
  for (let i = 0; i < holes; i += 1) {
    const k = scores[i]![1];
    const x = k % W;
    const y = Math.floor(k / W);
    p.clear(x, y);
    p.H(x, y, 0.05);
  }
  each((x, y) => {
    if (p.alpha(x, y) === 0) return;
    if (p.alpha(x + 1, y) === 0 || p.alpha(x, y + 1) === 0) p.mul(x, y, 0.78);
    else if (p.alpha(x - 1, y) === 0 || p.alpha(x, y - 1) === 0) p.mul(x, y, 1.1);
  });
}

function paintReeds(p: Pix, rng: Rng): void {
  clearAll(p);
  const stalk = ['#33481c', '#3f5822', '#4d6a2a', '#5c7d33', '#6d903e', '#80a34b', '#95b55a'];
  const leaf = ['#4a5e24', '#5a702c', '#6c8436', '#7f9742', '#94aa52', '#a9bc66'];
  const cattail = ['#2e1a0e', '#3e2412', '#503018', '#633d1f', '#764a27', '#8a5a32'];
  // Long leaf blades arching out from the base.
  const blades: [number, number, number][] = [[9, -0.5, 20], [13, 0.35, 24], [20, -0.3, 22], [24, 0.55, 17], [6, -0.75, 13], [27, 0.8, 12]];
  for (const [bx, lean, len] of blades) {
    for (let i = 0; i <= len; i += 1) {
      const f = i / len;
      const x = Math.round(bx + lean * f * f * len * 0.6);
      const y = 31 - i;
      put(p, x, y, tone(leaf, 0.25 + f * 0.65));
      if (f < 0.45) put(p, x + 1, y, tone(leaf, 0.1 + f * 0.5));
    }
  }
  // Upright stalks; two carry a brown cattail head and a thin spike.
  const stalks: [number, number, boolean][] = [[11, 4, true], [17, 8, true], [15, 2, false], [22, 6, false], [7, 11, false]];
  for (const [sx, top, head] of stalks) {
    const x0 = sx + Math.floor(rng() * 2);
    for (let y = top; y < W; y += 1) {
      const node = (y - top) % 9 === 8;
      put(p, x0, y, tone(stalk, node ? 0.3 : 0.75));
      put(p, x0 + 1, y, tone(stalk, node ? 0.1 : 0.35));
    }
    if (head) {
      const hy = top + 3;
      for (let y = hy; y < hy + 8; y += 1) {
        for (let k = -1; k <= 2; k += 1) {
          let t = k === -1 ? 0.7 : k === 0 ? 0.55 : k === 1 ? 0.35 : 0.12;
          if (y === hy || y === hy + 7) t -= 0.2;
          if ((k === -1 || k === 2) && (y === hy || y === hy + 7)) continue;
          t += (rng() - 0.5) * 0.15;
          put(p, x0 + k, y, tone(cattail, t));
          p.H(x0 + k, y, 0.8);
        }
      }
      // Pale spike above the head.
      for (let y = top; y < hy; y += 1) put(p, x0, y, y === top ? '#c8bc8a' : '#a49a68');
      p.set(x0 - 1, hy + 2, '#a0703e');
    }
  }
}

// ------------------------------------------------------------------ badlands

function paintRedSand(p: Pix, rng: Rng): void {
  granular(p, rng, RED_SAND, 6, 0.55, 0.45, 0.15);
  for (let i = 0; i < 24; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, rng() < 0.6 ? RED_SAND[0]! : RED_SAND[7]!);
  }
  // A few pale quartz grains.
  for (let i = 0; i < 6; i += 1) p.set(Math.floor(rng() * W), Math.floor(rng() * W), '#e8a874');
}

function paintRedSandstoneTop(p: Pix, rng: Rng): void {
  granular(p, rng, RED_SANDSTONE, 4, 0.22, 0.5, 0.1, 0.12);
  for (let i = 0; i < 34; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const len = 2 + Math.floor(rng() * 4);
    const light = rng() < 0.5;
    for (let k = 0; k < len; k += 1) {
      p.set(x + k, y, light ? RED_SANDSTONE[6]! : RED_SANDSTONE[2]!);
      p.addH(x + k, y, light ? 0.03 : -0.03);
    }
  }
  for (let i = 0; i < 16; i += 1) p.set(Math.floor(rng() * W), Math.floor(rng() * W), RED_SANDSTONE[1]!);
  p.bump = 0.5;
}

function paintRedSandstoneSide(p: Pix, rng: Rng): void {
  const f = grainField(rng, 6, 0.5);
  const wob = tileNoise(seedFrom(rng), 4);
  const strata = tileNoise(seedFrom(rng), 8);
  // Strata bands: alternate light / dark layers of uneven thickness.
  const bandOf = (x: number, y: number): number => {
    const yy = y + (wob(x, y) - 0.5) * 1.6;
    const s = strata(3, yy);
    return Math.sin((yy / 22) * TAU * 3 + s * 2.2);
  };
  each((x, y) => {
    let h: number;
    if (y < 6) h = 0.64 + (f(x, y) - 0.5) * 0.03;
    else if (y === 6) h = 0.2;
    else if (y === 27) h = 0.22;
    else if (y > 27) h = 0.58 + (f(x, y) - 0.5) * 0.04;
    else h = 0.5 + bandOf(x, y) * 0.06 + (f(x, y) - 0.5) * 0.1;
    p.H(x, y, h);
  });
  bakeLight(p, RED_SANDSTONE, (x, y) => {
    if (y < 6) return 0.68 + (f(x, y) - 0.5) * 0.12 - (y === 5 ? 0.1 : 0);
    if (y === 6) return 0.06;
    if (y === 27) return 0.04;
    if (y > 27) return 0.26 + (f(x, y) - 0.5) * 0.14 - (y === 31 ? 0.1 : 0);
    const b = bandOf(x, y);
    return 0.46 + (b > 0.55 ? 0.2 : b < -0.6 ? -0.2 : 0) + (f(x, y) - 0.5) * 0.36;
  }, 1.2);
  for (let i = 0; i < 22; i += 1) {
    const x = Math.floor(rng() * W);
    const y = 8 + Math.floor(rng() * 18);
    p.set(x, y, rng() < 0.5 ? RED_SANDSTONE[6]! : RED_SANDSTONE[1]!);
  }
  p.bump = 0.7;
}

/** Glazed-free coloured terracotta: flat matte clay, soft mottling, faint dark speckles. */
function paintColoredTerracotta(p: Pix, rng: Rng, pal: readonly string[]): void {
  granular(p, rng, pal, 4, 0.22, 0.48, 0.08);
  const m = tileFbm(seedFrom(rng), 6);
  each((x, y) => {
    const v = m(x, y);
    if (v > 0.66) p.mix(x, y, pal[6]!, 0.3);
    else if (v < 0.32) p.mix(x, y, pal[0]!, 0.3);
  });
  for (let i = 0; i < 26; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const dark = rng() < 0.65;
    p.set(x, y, dark ? scale(pal[1]!, 0.92) : pal[5]!);
    p.addH(x, y, dark ? -0.04 : 0.03);
  }
  p.bump = 0.35;
}

function paintCoarseDirt(p: Pix, rng: Rng): void {
  granular(p, rng, DIRT, 6, 0.45, 0.35, 0.22);
  // Gravel and stone chips: small domed stones with a lit top-left and shaded lower-right.
  for (let i = 0; i < 30; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const w = 2 + Math.floor(rng() * 2);
    const h = 1 + Math.floor(rng() * 2);
    const t = 0.25 + rng() * 0.5;
    const warm = rng() < 0.3;
    for (let yy = 0; yy < h; yy += 1) {
      for (let xx = 0; xx < w; xx += 1) {
        if ((xx === w - 1 && yy === h - 1 && w > 2 && rng() < 0.5)) continue;
        const e = yy === 0 && xx < w - 1 ? 0.25 : yy === h - 1 || xx === w - 1 ? -0.18 : 0;
        let c = rgbOf(tone(GRAVEL, t + e));
        if (warm) c = [c[0] * 1.1, c[1] * 1.0, c[2] * 0.86];
        p.set(x + xx, y + yy, scale(c, 1));
        p.H(x + xx, y + yy, 0.7);
      }
    }
    for (let xx = 0; xx < w; xx += 1) {
      p.set(x + xx, y + h, DIRT[0]!);
      p.H(x + xx, y + h, 0.25);
    }
  }
  pebbles(p, rng, 10, DIRT, 0.12, 0.5, 1);
  for (let i = 0; i < 14; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, DIRT[0]!);
    p.H(x, y, 0.2);
  }
}

// ------------------------------------------------------------------ ember wastes

function paintBasaltTop(p: Pix, rng: Rng): void {
  const n = tileNoise(seedFrom(rng), 6);
  const g = grainField(rng, 8, 0.6);
  each((x, y) => {
    const dx = x - 15.5;
    const dy = y - 15.5;
    const cheb = Math.max(Math.abs(dx), Math.abs(dy));
    let h: number;
    if (cheb > 14.6) h = 0.3;
    else {
      const d = cheb * 0.6 + Math.hypot(dx, dy) * 0.4 + (n(x, y) - 0.5) * 2.2;
      const ring = d / 3;
      const fr = ring - Math.floor(ring);
      // Rough ridges: a raised ring crest with a sharp groove after it.
      h = fr < 0.18 ? 0.25 : 0.45 + Math.sin(fr * Math.PI) * 0.3;
      if (d < 2) h = 0.6;
    }
    p.H(x, y, h + (g(x, y) - 0.5) * 0.08);
  });
  bakeLight(p, BASALT_TOP, (x, y) => {
    const dx = x - 15.5;
    const dy = y - 15.5;
    const cheb = Math.max(Math.abs(dx), Math.abs(dy));
    if (cheb > 14.6) return 0.08 + (g(x, y) - 0.5) * 0.15;
    return p.getH(x, y) * 0.75 + (g(x, y) - 0.5) * 0.35 + (1 - cheb / 16) * 0.12;
  }, 1.4);
  // Pale pumice flecks.
  for (let i = 0; i < 10; i += 1) p.set(Math.floor(rng() * W), Math.floor(rng() * W), BASALT_TOP[7]!);
  p.bump = 0.9;
}

function paintBasaltSide(p: Pix, rng: Rng): void {
  // Fluted column: ridges of uneven width separated by dark creases.
  const creases: number[] = [];
  let cx = rng() * 2;
  while (cx < W - 2.5) {
    creases.push(cx);
    cx += 3 + rng() * 3;
  }
  const g = grainField(rng, 8, 0.45);
  const streak = tileNoise(seedFrom(rng), 8);
  const wob = tileNoise(seedFrom(rng), 4);
  each((x, y) => {
    const xx = x + 0.5 + (wob(x, y) - 0.5) * 0.9;
    let d = 99;
    let d2 = 99;
    for (const c of creases) {
      const dd = wdx(xx, c);
      if (dd < d) {
        d2 = d;
        d = dd;
      } else if (dd < d2) d2 = dd;
    }
    const w = (d + d2) / 2;
    const prof = clamp01(d / Math.max(1, w));
    const h = d < 0.6 ? 0.12 : 0.35 + Math.sin(prof * Math.PI * 0.5) * 0.45 + (streak(x * 4, y) - 0.5) * 0.08;
    p.H(x, y, h);
  });
  bakeLight(p, BASALT_SIDE, (x, y) => p.getH(x, y) * 0.75 + (g(x, y) - 0.5) * 0.3 + (streak(x * 4, y) - 0.5) * 0.35, 1.5);
  // Occasional horizontal cooling cracks across a flute.
  for (let i = 0; i < 6; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const len = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < len; k += 1) {
      p.set(x + k, y, BASALT_SIDE[0]!);
      p.H(x + k, y, 0.2);
      p.set(x + k, y + 1, BASALT_SIDE[5]!);
    }
  }
  p.bump = 0.9;
}

function paintBlackstone(p: Pix, rng: Rng): void {
  const v = spacedVoronoi(rng, 4, 4, 0.9, 1.2);
  const f = grainField(rng, 6, 0.45);
  const blk = tileNoise(seedFrom(rng), 5);
  each((x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    const e = v.edge[i]!;
    p.H(x, y, e < 0.6 ? 0.15 : 0.45 + c.tone * 0.2 + (f(x, y) - 0.5) * 0.12);
  });
  bakeLight(p, BLACKSTONE, (x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    if (v.edge[i]! < 0.6) return 0.02;
    // Blocky darker veins inside each slab.
    const b = blk(x, y);
    return 0.38 + (c.tone - 0.5) * 0.35 + (f(x, y) - 0.5) * 0.4 + (b < 0.35 ? -0.18 : b > 0.68 ? 0.1 : 0);
  }, 1.3);
  // Short hairline cracks.
  for (let i = 0; i < 6; i += 1) {
    let x = rng() * W;
    let y = rng() * W;
    let a = rng() * TAU;
    for (let k = 0; k < 4 + rng() * 4; k += 1) {
      p.set(Math.floor(x), Math.floor(y), BLACKSTONE[0]!);
      p.H(Math.floor(x), Math.floor(y), 0.2);
      a += (rng() - 0.5) * 1.1;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  // A few tiny lighter flecks.
  for (let i = 0; i < 9; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (p.getH(x, y) < 0.3) continue;
    p.set(x, y, rng() < 0.5 ? '#6a5e72' : '#544a5c');
    p.S(x, y, 0.4);
  }
  p.bump = 0.9;
}

function paintMagma(p: Pix, rng: Rng): void {
  const v = spacedVoronoi(rng, 4, 4, 0.85, 1);
  const g = grainField(rng, 8, 0.5);
  const crackW = 0.62;
  each((x, y) => {
    const i = y * W + x;
    const e = v.edge[i]!;
    p.H(x, y, e < crackW ? 0.1 + e * 0.1 : 0.55 + 0.35 * Math.sqrt(clamp01((e - crackW) / 3)) + (g(x, y) - 0.5) * 0.08);
  });
  each((x, y) => {
    const i = y * W + x;
    const e = v.edge[i]!;
    const c = v.cells[v.owner[i]!]!;
    if (e < crackW) {
      // Hot seams: white-yellow core, orange to red at the lip.
      const k = e / crackW;
      const t = 0.8 - k * 0.6 + (g(x, y) - 0.5) * 0.25;
      p.set(x, y, tone(MAGMA_HOT, t));
      p.E(x, y, 0.75 + (1 - k) * 0.25);
      return;
    }
    // Crust plates heat up toward the seams.
    const heat = clamp01(1 - (e - crackW) / 1.6);
    let t = 0.28 + c.tone * 0.25 + (g(x, y) - 0.5) * 0.35 + lit(p, x, y) * 1.3 + heat * 0.2;
    if (heat > 0.7) t += 0.2;
    p.set(x, y, tone(MAGMA_CRUST, t));
    p.E(x, y, heat > 0.55 ? 0.35 * heat : 0.04);
  });
  // Glowing pores in the crust.
  for (let i = 0; i < 9; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (v.edge[y * W + x]! < 2.2) continue;
    p.set(x, y, MAGMA_HOT[rng() < 0.5 ? 3 : 2]!);
    p.E(x, y, 0.8);
    p.H(x, y, 0.35);
    p.set(x + 1, y + 1, MAGMA_CRUST[0]!);
  }
  p.bump = 0.85;
}

function paintAsh(p: Pix, rng: Rng): void {
  granular(p, rng, ASH, 5, 0.55, 0.45, 0.14);
  // Soft drifts: lighter powder in the high noise.
  const d = tileFbm(seedFrom(rng), 3);
  each((x, y) => {
    if (d(x, y) > 0.62) p.mix(x, y, ASH[7]!, 0.3);
  });
  // Dark cinder flecks.
  for (let i = 0; i < 26; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, '#2c2a2a');
    p.H(x, y, 0.62);
    if (rng() < 0.35) {
      p.set(x + 1, y, '#3a3737');
      p.H(x + 1, y, 0.6);
    }
    p.set(x - 1, y - 1, ASH[6]!);
  }
  // A few faint ember specks.
  for (let i = 0; i < 4; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, '#e2681e');
    p.E(x, y, 0.55);
    p.set(x + 1, y, '#7a4630');
    p.E(x + 1, y, 0.15);
  }
  p.bump = 0.45;
}

function paintCharredLog(p: Pix, rng: Rng): void {
  // Deep vertical fissures plus alligator checking: blocky charcoal chunks.
  const grooves: { x: number; amp: number; ph: number }[] = [];
  const n = 6;
  for (let i = 0; i < n; i += 1) grooves.push({ x: (i * W) / n + rng() * 2.5, amp: 0.4 + rng() * 0.9, ph: rng() * TAU });
  const g = grainField(rng, 8, 0.45);
  const rows: number[][] = grooves.map(() => {
    const r: number[] = [];
    let y = Math.floor(rng() * 4);
    while (y < W) {
      r.push(y);
      y += 3 + Math.floor(rng() * 4);
    }
    return r;
  });
  const groove = new Int8Array(W * W).fill(-1);
  each((x, y) => {
    let d = 99;
    let gi = 0;
    for (let k = 0; k < grooves.length; k += 1) {
      const gr = grooves[k]!;
      const dd = wdx(x + 0.5, gr.x + gr.amp * Math.sin((TAU * y) / W + gr.ph));
      if (dd < d) {
        d = dd;
        gi = k;
      }
    }
    // Which column of chunks this texel belongs to: right of groove gi.
    const gr = grooves[gi]!;
    const right = ((x + 0.5 - (gr.x + gr.amp * Math.sin((TAU * y) / W + gr.ph))) % W + W) % W < W / 2;
    const colIdx = right ? gi : (gi + n - 1) % n;
    const crossY = rows[colIdx]!.some((ry) => ry === y);
    let h: number;
    if (d < 0.9) {
      h = 0.08;
      groove[y * W + x] = gi;
    } else if (crossY) h = 0.2;
    else h = 0.45 + 0.35 * clamp01((d - 0.8) / 2) + (g(x, y) - 0.5) * 0.1;
    p.H(x, y, h);
  });
  bakeLight(p, CHAR, (x, y) => (p.getH(x, y) < 0.15 ? 0.0 : p.getH(x, y) * 0.75 + (g(x, y) - 0.5) * 0.4), 1.6);
  each((x, y) => p.S(x, y, p.getH(x, y) > 0.6 ? 0.18 : 0.04));
  // Faint ember lines smouldering inside a couple of the deep fissures.
  const hot = [Math.floor(rng() * n), Math.floor(rng() * n)];
  for (const gi of hot) {
    const y0 = Math.floor(rng() * W);
    const len = 5 + Math.floor(rng() * 6);
    const gr = grooves[gi]!;
    for (let y = y0; y < y0 + len; y += 1) {
      const x = Math.floor(gr.x + gr.amp * Math.sin((TAU * y) / W + gr.ph));
      const k = (y - y0) / (len - 1);
      const hotness = Math.sin(k * Math.PI);
      p.set(x, y, tone(EMBER, 0.15 + hotness * 0.75));
      p.E(x, y, 0.15 + hotness * 0.3);
    }
  }
  p.bump = 1;
}

function paintCharredLogTop(p: Pix, rng: Rng): void {
  logRings(p, rng, CHAR_END, CHAR, 2);
  // Charring darkens the outer rings into a black burnt band.
  each((x, y) => {
    const cheb = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
    if (cheb > 10.5 && cheb < 13.5) p.mul(x, y, 0.72);
  });
  // Radial shrinkage checks from the rim inward (short, tapering).
  for (let c = 0; c < 6; c += 1) {
    const a = (c / 6) * TAU + rng() * 0.6;
    const r0 = 4 + rng() * 4;
    line(15.5 + Math.cos(a) * r0, 15.5 + Math.sin(a) * r0, 15.5 + Math.cos(a) * 13.4, 15.5 + Math.sin(a) * 13.4, (x, y, t) => {
      p.set(x, y, t < 0.35 ? CHAR_END[1]! : CHAR[0]!);
      p.H(x, y, 0.2);
    });
  }
  // A dim ember near the heart.
  for (const [x, y, e] of [[16, 15, 0.35], [15, 16, 0.25], [16, 16, 0.3]] as const) {
    p.set(x, y, e > 0.3 ? EMBER[2]! : EMBER[1]!);
    p.E(x, y, e);
  }
}

function paintNetherBricks(p: Pix, rng: Rng): void {
  paintBricks(p, rng, { rowH: 8, bw: 16, offsets: [0, 8], pal: NETHER, mortar: NETHER_MORTAR, toneVar: 0.4, noise: 0.45 });
  // Pitted, scorched faces.
  for (let i = 0; i < 18; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (p.getH(x, y) < 0.7) continue;
    p.set(x, y, NETHER[0]!);
    p.H(x, y, 0.55);
    if (rng() < 0.5) p.set(x - 1, y - 1, NETHER[6]!);
  }
  p.bump = 1;
}

// ------------------------------------------------------------------ frozen pass

function paintPackedIce(p: Pix, rng: Rng): void {
  const a = tileFbm(seedFrom(rng), 3);
  const b = tileNoise(seedFrom(rng), 8);
  each((x, y) => {
    const t = 0.45 + (a(x, y) - 0.5) * 0.55 + (b(x, y) - 0.5) * 0.2 + (rng() - 0.5) * 0.06;
    p.set(x, y, tone(PACKED_ICE, t));
    p.H(x, y, 0.6);
    p.S(x, y, 0.85);
  });
  // Fine white crack network along compressed grain boundaries.
  const v = spacedVoronoi(rng, 3, 3, 0.9, 1);
  const crackN = tileNoise(seedFrom(rng), 8);
  each((x, y) => {
    const i = y * W + x;
    if (v.edge[i]! < 0.32 && crackN(x, y) > 0.35) {
      p.set(x, y, crackN(x, y) > 0.6 ? PACKED_ICE[7]! : PACKED_ICE[6]!);
      p.H(x, y, 0.52);
      p.S(x, y, 1);
    }
  });
  // Frost sparkles.
  for (let i = 0; i < 6; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, '#ffffff');
    p.S(x, y, 1);
  }
  p.bump = 0.5;
}

function paintBlueIce(p: Pix, rng: Rng): void {
  const a = tileFbm(seedFrom(rng), 3);
  const streak = tileNoise(seedFrom(rng), 8);
  each((x, y) => {
    const s = streak(x - y, (x - y) * 0.5 + 11);
    let t = 0.42 + (a(x, y) - 0.5) * 0.5 + (s > 0.66 ? 0.28 : s > 0.58 ? 0.12 : 0) + (rng() - 0.5) * 0.05;
    if (s < 0.25) t -= 0.1;
    p.set(x, y, tone(BLUE_ICE, t));
    p.H(x, y, 0.6);
    p.S(x, y, 1);
  });
  // Trapped air bubbles: a light dot with a deep-blue shadow.
  for (let i = 0; i < 9; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, '#b4d0f8');
    p.set(x + 1, y + 1, BLUE_ICE[0]!);
    p.H(x, y, 0.64);
  }
  for (let i = 0; i < 4; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    p.set(x, y, '#e8f2ff');
    p.S(x, y, 1);
  }
  p.bump = 0.4;
}

// ------------------------------------------------------------------ the Heart's seal

function paintSealCrystal(p: Pix, rng: Rng): void {
  // Elongated shards (tall Voronoi cells), each split along its axis into a lit and a shaded facet.
  const v = spacedVoronoi(rng, 4, 3, 0.8, 0.55);
  const axes = v.cells.map(() => -Math.PI / 2 + (rng() - 0.5) * 0.9);
  const isCrack = (x: number, y: number): boolean => v.edge[p.idx(x, y)]! < 0.5;
  const g = grainField(rng, 8, 0.5);
  const side = new Float32Array(W * W);
  each((x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    const a = axes[v.owner[i]!]!;
    // Wrapped offset from the shard's seed.
    let dx = x + 0.5 - c.x;
    let dy = (y + 0.5 - c.y);
    if (dx > W / 2) dx -= W;
    if (dx < -W / 2) dx += W;
    if (dy > W / 2) dy -= W;
    if (dy < -W / 2) dy += W;
    const perp = dx * Math.sin(a) - dy * Math.cos(a);
    side[i] = perp;
    const e = v.edge[i]!;
    p.H(x, y, e < 0.5 ? 0.08 : 0.5 + 0.4 * clamp01(e / 4) - Math.min(0.25, Math.abs(perp) * 0.03));
  });
  each((x, y) => {
    const i = y * W + x;
    const c = v.cells[v.owner[i]!]!;
    if (isCrack(x, y)) {
      p.set(x, y, '#021c0c');
      p.E(x, y, 0.15);
      p.S(x, y, 0.2);
      return;
    }
    const perp = side[i]!;
    let t = 0.42 + c.tone * 0.22 + (g(x, y) - 0.5) * 0.1 + clamp01(v.edge[i]! / 5) * 0.12;
    if (Math.abs(perp) < 0.6) t += 0.3; // bright ridge
    else if (perp < 0) t += 0.12; // lit facet
    else t -= 0.12; // shaded facet
    if (isCrack(x - 1, y) || isCrack(x, y - 1)) t += 0.18;
    else if (isCrack(x + 1, y) || isCrack(x, y + 1)) t -= 0.14;
    p.set(x, y, tone(SEAL, t));
    p.E(x, y, 0.5 + 0.5 * clamp01(t));
    p.S(x, y, 0.75);
  });
  // Star glints on ridges.
  for (let i = 0; i < 7; i += 1) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (p.getH(x, y) < 0.55) continue;
    p.set(x, y, SEAL[8]!);
    p.set(x + 1, y, SEAL[7]!);
    p.set(x, y - 1, SEAL[7]!);
    p.E(x, y, 1);
    p.S(x, y, 1);
  }
  // A few small cut-out gaps where three shards meet.
  let gaps = 0;
  each((x, y) => {
    if (gaps >= 5) return;
    const i = y * W + x;
    if (v.edge[i]! > 0.18) return;
    const owners = new Set<number>();
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]] as const) owners.add(v.owner[p.idx(x + dx, y + dy)]!);
    if (owners.size < 3 || rng() < 0.5) return;
    p.clear(x, y);
    if (rng() < 0.5) p.clear(x + 1, y);
    gaps += 1;
  });
}

// ------------------------------------------------------------------ items

function paintWindCharge(p: Pix, rng: Rng): void {
  clearAll(p);
  const cx = 15.5;
  const cy = 16.5;
  const R = 9.2;
  shapeFill(p, (x, y) => {
    const t = sphereTone(x, y, cx, cy, R);
    if (t === null) return null;
    const r = Math.hypot(x - cx, y - cy);
    const a = Math.atan2(y - cy, x - cx);
    // Three spiral arms winding into the eye.
    const sw = Math.sin(a * 3 + r * 0.75);
    let k = t * 0.6 + 0.2 + (sw > 0.6 ? 0.3 : sw > 0.2 ? 0.12 : sw < -0.6 ? -0.15 : 0);
    if (r < 2) k = 0.95;
    return k;
  }, WIND, 0.35);
  // Wind ribbons curling around the ball (2px thick arcs, thinning at their tails).
  const wisps: [number, number, number][] = [[-0.3, 10.2, 1.5], [1.9, 10.2, 1.3], [3.9, 10.4, 1.4]];
  for (const [a0, r0, span] of wisps) {
    for (let s = 0; s <= 40; s += 1) {
      const f = s / 40;
      const a = a0 + span * f;
      const r = r0 + f * 2.4;
      const thick = f < 0.65 ? 1.1 : 0.55;
      for (let dr = 0; dr < thick; dr += 0.5) {
        const x = Math.floor(cx + Math.cos(a) * (r + dr));
        const y = Math.floor(cy + Math.sin(a) * (r + dr));
        if (!inside(x, y) || p.alpha(x, y) > 0) continue;
        p.set(x, y, tone(WIND, 0.9 - f * 0.35 - dr * 0.15));
        p.H(x, y, 0.7);
      }
    }
  }
  // Highlight.
  for (const [x, y, c] of [[11, 11, WIND[7]], [12, 11, WIND[6]], [11, 12, WIND[6]]] as const) {
    p.set(x, y, c!);
    p.S(x, y, 0.8);
  }
  void rng;
  outline(p, 0.4);
}

// ------------------------------------------------------------------ registration

export function installLandPainters(): void {
  const r = (name: string, painter: (p: Pix, rng: Rng) => void): void => register(name, painter, seedOf(name));
  // Swamp
  r('mud', paintMud);
  r('mud_bricks', paintMudBricks);
  r('lily_pad', paintLilyPad);
  r('red_mushroom', paintRedMushroom);
  r('brown_mushroom', paintBrownMushroom);
  r('leaves_swamp', paintSwampLeaves);
  r('reeds', paintReeds);
  // Badlands
  r('red_sand', paintRedSand);
  r('red_sandstone_top', paintRedSandstoneTop);
  r('red_sandstone_side', paintRedSandstoneSide);
  r('terracotta_orange', (p, rng) => paintColoredTerracotta(p, rng, TERRA_ORANGE));
  r('terracotta_yellow', (p, rng) => paintColoredTerracotta(p, rng, TERRA_YELLOW));
  r('terracotta_white', (p, rng) => paintColoredTerracotta(p, rng, TERRA_WHITE));
  r('terracotta_brown', (p, rng) => paintColoredTerracotta(p, rng, TERRA_BROWN));
  r('coarse_dirt', paintCoarseDirt);
  // Ember wastes
  r('basalt_top', paintBasaltTop);
  r('basalt_side', paintBasaltSide);
  r('blackstone', paintBlackstone);
  r('magma', paintMagma);
  r('ash', paintAsh);
  r('charred_log_top', paintCharredLogTop);
  r('charred_log', paintCharredLog);
  r('nether_bricks', paintNetherBricks);
  // Frozen pass
  r('packed_ice', paintPackedIce);
  r('blue_ice', paintBlueIce);
  // The Heart's seals
  r('seal_crystal', paintSealCrystal);
  // Items
  r('wind_charge_item', paintWindCharge);
  // The Strider's hold
  r('shutter', paintShutter);
  r('banner_red', (p, rng) => paintBanner(p, rng, BANNER_RED, '#f2c94a'));
  r('banner_blue', (p, rng) => paintBanner(p, rng, BANNER_BLUE, '#f2c94a'));
  r('banner_green', (p, rng) => paintBanner(p, rng, BANNER_GREEN, '#f4f0e0'));
  r('banner_gold', (p, rng) => paintBanner(p, rng, BANNER_GOLD, '#5a2a14'));
  // The expeditions
  r('gold_block', paintGoldBlock);
  r('cauldron_top', paintCauldronTop);
  r('cauldron_side', paintCauldronSide);
  r('anvil_top', paintAnvilTop);
  r('anvil_side', paintAnvilSide);
}

// ------------------------------------------------------------------ the expeditions

const GOLD = ['#6a4206', '#8a5a0a', '#b07a12', '#d09a1e', '#e8b62c', '#f6cf48', '#ffe57a', '#fff6c0'];
const IRONWORK = ['#1a1a1e', '#232327', '#2c2c32', '#36363c', '#414148', '#4d4d55', '#5a5a63', '#6a6a74'];

/** Plates of beaten gold: soft hammer marks, a bright bevel round each plate, rivets. */
function paintGoldBlock(p: Pix, rng: Rng): void {
  const f = grainField(rng, 5, 0.35);
  each((x, y) => {
    const ex = Math.min(x, 31 - x);
    const ey = Math.min(y, 31 - y);
    const e = Math.min(ex, ey);
    const seam = x === 15 || x === 16;
    let t = 0.55 + (f(x, y) - 0.5) * 0.35;
    if (e === 0) t = 0.25;
    else if (e === 1) t = 0.85;
    if (seam) t = x === 15 ? 0.3 : 0.9;
    p.set(x, y, tone(GOLD, t));
    p.H(x, y, e <= 1 || seam ? 0.75 : 0.55);
    p.S(x, y, 0.75);
  });
  for (const [x, y] of [[4, 4], [27, 4], [4, 27], [27, 27], [11, 15], [20, 15]] as const) {
    put(p, x, y, GOLD[7]!);
    put(p, x + 1, y + 1, GOLD[2]!);
    p.H(x, y, 0.95);
  }
}

/** A cauldron seen from above: its thick iron rim round a bubbling witch's brew. */
function paintCauldronTop(p: Pix, rng: Rng): void {
  const brew = ['#1e3a12', '#2c5a1a', '#3c7a22', '#58a030', '#7ec840', '#b4f070'];
  const f = grainField(rng, 4, 0.4);
  each((x, y) => {
    const e = Math.min(x, y, 31 - x, 31 - y);
    if (e < 4) {
      p.set(x, y, tone(IRONWORK, 0.45 + (f(x, y) - 0.5) * 0.3 + (e === 3 ? -0.25 : e === 0 ? 0.2 : 0)));
      p.H(x, y, 0.8);
      p.S(x, y, 0.4);
      return;
    }
    const swirl = Math.sin((x + y) * 0.35 + f(x, y) * 4) * 0.5 + 0.5;
    p.set(x, y, tone(brew, 0.25 + swirl * 0.45));
    p.H(x, y, 0.3);
    p.S(x, y, 0.85);
    p.E(x, y, 0.35 + swirl * 0.3);
  });
  // Bubbles.
  for (let n = 0; n < 9; n += 1) {
    const bx = 6 + Math.floor(rng() * 20);
    const by = 6 + Math.floor(rng() * 20);
    put(p, bx, by, brew[5]!);
    put(p, bx + 1, by, brew[4]!);
    p.E(bx, by, 0.9);
  }
}

/** A cauldron's side: black iron bands, a lip at the top, stubby feet at the corners. */
function paintCauldronSide(p: Pix, rng: Rng): void {
  const f = grainField(rng, 5, 0.3);
  each((x, y) => {
    let t = 0.4 + (f(x, y) - 0.5) * 0.35;
    if (y < 3) t = y === 0 ? 0.75 : 0.6;
    if (y === 10 || y === 22) t = 0.2;
    if (y === 11 || y === 23) t = 0.65;
    const foot = y > 27 && (x < 6 || x > 25);
    const gap = y > 27 && !foot;
    if (gap) {
      p.set(x, y, '#000000', 0);
      return;
    }
    p.set(x, y, tone(IRONWORK, t));
    p.H(x, y, y < 3 || y === 11 || y === 23 ? 0.8 : 0.5);
    p.S(x, y, 0.35);
  });
}

/** The Builders' anvil from above: a worn, polished face with the old makers' stamp. */
function paintAnvilTop(p: Pix, rng: Rng): void {
  const f = grainField(rng, 6, 0.3);
  each((x, y) => {
    const face = x > 3 && x < 28 && y > 8 && y < 23;
    let t = 0.35 + (f(x, y) - 0.5) * 0.3;
    if (face) t = 0.62 + (f(x, y) - 0.5) * 0.25 + (y === 9 || y === 22 ? 0.2 : 0);
    p.set(x, y, tone(IRONWORK, t));
    p.H(x, y, face ? 0.75 : 0.45);
    p.S(x, y, face ? 0.85 : 0.4);
  });
  // The stamp: a little Strider tower in gold.
  for (const [x, y] of [[14, 13], [15, 13], [16, 13], [17, 13], [15, 14], [16, 14], [15, 15], [16, 15], [14, 16], [17, 16], [14, 17], [17, 17]] as const) {
    put(p, x, y, GOLD[5]!);
    p.E(x, y, 0.25);
  }
}

/** The anvil's side: a waisted iron body (dark where it narrows), hot glints of the forge. */
function paintAnvilSide(p: Pix, rng: Rng): void {
  const f = grainField(rng, 6, 0.3);
  each((x, y) => {
    const waist = y > 10 && y < 22 && (x < 7 || x > 24);
    if (waist) {
      p.set(x, y, tone(IRONWORK, 0.08));
      p.H(x, y, 0.1);
      return;
    }
    let t = 0.45 + (f(x, y) - 0.5) * 0.3;
    if (y < 2) t = 0.8;
    if (y > 28) t = 0.3;
    p.set(x, y, tone(IRONWORK, t));
    p.H(x, y, 0.6);
    p.S(x, y, 0.5);
  });
  for (let n = 0; n < 5; n += 1) {
    const x = 8 + Math.floor(rng() * 16);
    const y = 3 + Math.floor(rng() * 6);
    put(p, x, y, '#ffb050');
    p.E(x, y, 0.8);
  }
}

// ------------------------------------------------------------------ the Strider's hold

/** A spruce window shutter: framed slats with dark gaps, iron hinges. */
function paintShutter(p: Pix, rng: Rng): void {
  const pal = ['#3e2a16', '#4e3620', '#5e4228', '#6e5032', '#7e5e3c'];
  const f = grainField(rng, 6, 0.3);
  each((x, y) => {
    const frame = x < 3 || x > 28 || y < 3 || y > 28;
    const slat = !frame && (y - 3) % 5 === 4;
    let t = 0.45 + (f(x, y) - 0.5) * 0.5 + (frame ? 0.15 : 0);
    if (slat) t = 0.02;
    // Slats lean: lighter at their top edge.
    else if (!frame && (y - 3) % 5 === 0) t += 0.2;
    p.set(x, y, tone(pal, t));
    p.H(x, y, frame ? 0.75 : slat ? 0.15 : 0.55);
  });
  for (const y of [6, 25]) {
    for (let x = 1; x < 9; x += 1) {
      p.set(x, y, x === 1 ? '#8a8a90' : '#55555c');
      p.H(x, y, 0.85);
      p.S(x, y, 0.6);
    }
  }
}

const BANNER_RED = ['#5c1210', '#7a1a16', '#98231c', '#b42e24', '#c8402e'];
const BANNER_BLUE = ['#13234e', '#1a3066', '#22407e', '#2c5096', '#3a62aa'];
const BANNER_GREEN = ['#16381a', '#1e4a22', '#286030', '#32763c', '#3e8a48'];
const BANNER_GOLD = ['#7a5410', '#946818', '#b08020', '#c8962c', '#dcac3c'];

/** A hanging banner: woven cloth with a gold border, the Strider's tower emblem, a notched hem. */
function paintBanner(p: Pix, rng: Rng, pal: readonly string[], trim: string): void {
  clearAll(p);
  const f = grainField(rng, 5, 0.35);
  const hem = (x: number): number => 27 + Math.round(Math.abs(x - 15.5) / 3.5);
  each((x, y) => {
    if (x < 5 || x > 26 || y > hem(x)) return;
    const border = x < 7 || x > 24 || y < 3 || y > hem(x) - 2;
    let t = 0.5 + (f(x, y) - 0.5) * 0.45 + ((x + y) % 2 === 0 ? 0.04 : -0.04);
    // Folds: soft vertical shading.
    t += Math.sin((x - 5) * 0.55) * 0.08;
    p.set(x, y, border ? trim : tone(pal, t));
    p.H(x, y, border ? 0.6 : 0.5);
  });
  // The emblem: a tower on four legs (the Strider) over a chevron.
  const ink = trim;
  const fillRect = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) p.set(x, y, ink);
  };
  fillRect(12, 7, 19, 8);
  fillRect(13, 9, 18, 13);
  fillRect(12, 5, 13, 6);
  fillRect(18, 5, 19, 6);
  fillRect(15, 4, 16, 6);
  for (const lx of [12, 14, 17, 19]) fillRect(lx, 14, lx, 17);
  for (let k = 0; k < 5; k += 1) {
    p.set(11 + k, 21 + k, ink);
    p.set(20 - k, 21 + k, ink);
    p.set(11 + k, 22 + k, ink);
    p.set(20 - k, 22 + k, ink);
  }
}

