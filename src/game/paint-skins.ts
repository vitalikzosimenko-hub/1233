// Procedural mob skins. Every sheet uses Minecraft box-UV unwrapping in model pixels, painted
// at SKIN_SCALE texels per model pixel so faces, cloth folds and shading read like a 32x pack.
import { hex, lerpRGB, ramp, registerSkins, SKIN_SCALE, type Pix, type RGB } from './textures';
import { clamp, fbm2, hash2, mulberry32 } from './rng';
import { paintPlayerSkin } from './player-skin';

const S = SKIN_SCALE;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = 'right' | 'front' | 'left' | 'back';

export interface BoxUV {
  top: Rect;
  bottom: Rect;
  right: Rect;
  front: Rect;
  left: Rect;
  back: Rect;
  /** Texel sizes. */
  w: number;
  h: number;
  d: number;
}

type Shade = (x: number, y: number) => RGB | null;
/** s = texel distance around the box starting at the right face, y = texel row, x = face-local column. */
type SideShade = (s: number, y: number, side: Side, x: number) => RGB | null;

export function boxUV(o: [number, number], u: number, v: number, w: number, h: number, d: number): BoxUV {
  const R = (x: number, y: number, rw: number, rh: number): Rect => ({ x: o[0] + x * S, y: o[1] + y * S, w: rw * S, h: rh * S });
  return {
    top: R(u + d, v, w, d),
    bottom: R(u + d + w, v, w, d),
    right: R(u, v + d, d, h),
    front: R(u + d, v + d, w, h),
    left: R(u + d + w, v + d, d, h),
    back: R(u + d + w + d, v + d, w, h),
    w: w * S,
    h: h * S,
    d: d * S,
  };
}

export function paint(a: Pix, r: Rect, fn: Shade): void {
  for (let y = 0; y < r.h; y += 1) {
    for (let x = 0; x < r.w; x += 1) {
      const c = fn(x, y);
      if (c) a.set(r.x + x, r.y + y, c);
    }
  }
}

export function paintSides(a: Pix, b: BoxUV, fn: SideShade): void {
  const order: [Side, Rect, number][] = [
    ['right', b.right, 0],
    ['front', b.front, b.d],
    ['left', b.left, b.d + b.w],
    ['back', b.back, b.d + b.w + b.d],
  ];
  for (const [side, r, off] of order) paint(a, r, (x, y) => fn(off + x, y, side, x));
}

/** Face-local drawing helpers. */
export function on(a: Pix, r: Rect) {
  return {
    set: (x: number, y: number, c: string | RGB): void => a.set(r.x + x, r.y + y, c),
    mul: (x: number, y: number, k: number): void => a.mul(r.x + x, r.y + y, k),
    mix: (x: number, y: number, c: string | RGB, t: number): void => a.mix(r.x + x, r.y + y, c, t),
    rect: (x: number, y: number, w: number, h: number, c: string | RGB): void => {
      for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) a.set(r.x + xx, r.y + yy, c);
    },
    mulRect: (x: number, y: number, w: number, h: number, k: number): void => {
      for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) a.mul(r.x + xx, r.y + yy, k);
    },
    mixRect: (x: number, y: number, w: number, h: number, c: string | RGB, t: number): void => {
      for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) a.mix(r.x + xx, r.y + yy, c, t);
    },
    rgb: (x: number, y: number): RGB => a.rgb(r.x + x, r.y + y),
  };
}

/** Copies a painted face rectangle (used for the duplicate villager nose slot). */
function copyRect(a: Pix, from: Rect, to: Rect): void {
  for (let y = 0; y < from.h; y += 1) {
    for (let x = 0; x < from.w; x += 1) {
      const c = a.get(from.x + x, from.y + y);
      a.set(to.x + x, to.y + y, [c[0], c[1], c[2]], c[3]);
    }
  }
}

// ------------------------------------------------------------------ colour helpers

export const C = (h: string): RGB => hex(h);
export const k = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
export const mixc = (a: RGB, b: RGB | string, t: number): RGB => lerpRGB(a, typeof b === 'string' ? hex(b) : b, t);
export const grain = (x: number, y: number, seed: number, amt: number): number => 1 + (hash2(x, y, seed) - 0.5) * amt;

/** Soft organic material: blotchy low-frequency noise plus fine grain. */
export function flesh(stops: readonly string[], x: number, y: number, seed: number, blotch = 0.55, bias = 0): RGB {
  const n = fbm2(x / 4.5, y / 4.5, seed);
  const t = 0.55 + bias + (n - 0.5) * blotch * 1.6 + (hash2(x, y, seed + 3) - 0.5) * 0.12;
  return ramp(stops, clamp(t, 0, 1));
}

/** Woven cloth: soft vertical folds, mottling and a faint weave. */
export function cloth(stops: readonly string[], s: number, y: number, seed: number, fold = 0.12, bias = 0): RGB {
  const n = fbm2(s / 5, y / 7, seed);
  const f = Math.sin(s * 0.62 + n * 5 + y * 0.04);
  const t = 0.55 + bias + (n - 0.5) * 0.55 + f * fold + (hash2(s, y, seed + 7) - 0.5) * 0.1;
  const weave = ((s + y) & 1) === 0 ? 1.025 : 0.975;
  return k(ramp(stops, clamp(t, 0, 1)), weave);
}

/** Leather: dark mottling with scuffs. */
export function leather(stops: readonly string[], x: number, y: number, seed: number): RGB {
  const n = fbm2(x / 3.5, y / 3.5, seed);
  let t = 0.55 + (n - 0.5) * 0.9 + (hash2(x, y, seed + 1) - 0.5) * 0.14;
  if (hash2(x, y, seed + 2) < 0.04) t += 0.18;
  return ramp(stops, clamp(t, 0, 1));
}

/** Limb roundness: darken the outer columns of a narrow face. */
export function round(x: number, w: number): number {
  const e = Math.abs((x + 0.5) / w - 0.5) * 2;
  return 1.03 - 0.1 * e * e;
}

// ------------------------------------------------------------------ zombie & husk

/** Hand-placed torn holes (centre s, centre y, radius s, radius y) with ragged noisy edges. */
export type Tear = readonly [number, number, number, number];
export function tearDist(s: number, y: number, tears: readonly Tear[], seed: number): number {
  let m = 9;
  for (const [cx, cy, rx, ry] of tears) {
    const d = Math.hypot((s - cx) / rx, (y - cy) / ry) + (hash2(s, y, seed) - 0.5) * 0.45;
    if (d < m) m = d;
  }
  return m;
}
const BODY_TEARS: readonly Tear[] = [[12.5, 9, 2.3, 1.7], [19.5, 14.5, 1.6, 2.3], [28, 6, 1.4, 1.9], [38, 11, 2.5, 1.8], [44.5, 5, 1.4, 1.4]];
const KNEE_TEARS: readonly Tear[] = [[12, 11, 1.8, 1.4]];

interface UndeadPalette {
  skin: readonly string[];
  hair: readonly string[];
  shirt: readonly string[];
  pants: readonly string[];
  shoe: readonly string[];
  eye: string;
  eyeRim: string;
  mouth: string;
  teeth: string;
  rot: string;
}

const ZOMBIE: UndeadPalette = {
  skin: ['#2c4f22', '#3f6c30', '#548a3f', '#6ba24f', '#86b965'],
  hair: ['#15270f', '#1f3818', '#2b4a20', '#375c29'],
  shirt: ['#06474d', '#0b6b72', '#118f96', '#1bb0b2', '#46cfca'],
  pants: ['#1c1848', '#2a2570', '#3a3392', '#4c45ad', '#625dc4'],
  shoe: ['#2c2c2e', '#434346', '#5a5a5e', '#727277'],
  eye: '#070a05',
  eyeRim: '#1a2614',
  mouth: '#152011',
  teeth: '#9a9a78',
  rot: '#3c4420',
};

const HUSK: UndeadPalette = {
  skin: ['#5a4b30', '#776645', '#94825a', '#ab9a6e', '#c2b385'],
  hair: ['#2e2518', '#3d3220', '#4d402b', '#5d4f36'],
  shirt: ['#36261a', '#4f3a26', '#6a4f33', '#836441', '#9b7a52'],
  pants: ['#231a12', '#33271b', '#463626', '#594633', '#6c5840'],
  shoe: ['#2a211a', '#3b2f24', '#4e4031', '#625240'],
  eye: '#0e0905',
  eyeRim: '#2c2116',
  mouth: '#24190f',
  teeth: '#b3a479',
  rot: '#5d4a2a',
};

function paintUndead(a: Pix, o: [number, number], p: UndeadPalette, seed: number, husk: boolean): void {
  const rng = mulberry32(seed);
  const sd = (): number => Math.floor(rng() * 100000);
  const skinSeed = sd();
  const hairSeed = sd();
  const clothSeed = sd();
  const holeSeed = sd();
  const jagSeed = sd();

  const skin = (x: number, y: number, bias = 0): RGB => {
    let c = flesh(p.skin, x, y, skinSeed, 0.6, bias);
    const rot = fbm2(x / 3, y / 3, skinSeed + 9);
    if (rot > 0.66) c = mixc(c, p.rot, clamp((rot - 0.66) * 5, 0, 0.6));
    return c;
  };
  const hair = (x: number, y: number): RGB => {
    const n = fbm2(x / 1.6, y / 5, hairSeed);
    return k(ramp(p.hair, clamp(0.5 + (n - 0.5) * 1.6, 0, 1)), grain(x, y, hairSeed, 0.12));
  };

  // ---- head
  const head = boxUV(o, 0, 0, 8, 8, 8);
  paintSides(a, head, (s, y, side, x) => {
    const toBack = side === 'right' ? 1 - x / (head.d - 1) : side === 'left' ? x / (head.d - 1) : side === 'back' ? 1 : 0;
    const jag = hash2(s, 1, hairSeed) < 0.4 ? 1 : 0;
    let depth = side === 'front' ? 1 + jag : side === 'back' ? 8 + Math.floor(hash2(s >> 1, 2, hairSeed) * 3) : 3 + Math.round(toBack * 4) + jag;
    if (husk) depth = Math.max(0, depth - 1 - (hash2(s, 3, hairSeed) < 0.5 ? 1 : 0));
    if (y < depth) return hair(s, y);
    let c = skin(s, y + 40);
    if (y === depth) c = k(c, 0.82);
    if (y >= 14) c = k(c, 0.9);
    return c;
  });
  paint(a, head.top, (x, y) => hair(x + 3, y + 90));
  paint(a, head.bottom, (x, y) => k(skin(x, y + 200), 0.72));

  // Ears on both sides.
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(6, 8, 4, 5, 0.86);
    e.mulRect(7, 9, 2, 3, 0.8);
    e.mulRect(6, 8, 4, 1, 1.12);
  }

  // Face.
  const f = on(a, head.front);
  f.mulRect(1, 6, 6, 5, 0.76); // sunken sockets
  f.mulRect(9, 6, 6, 5, 0.76);
  f.mulRect(2, 6, 4, 4, 0.82);
  f.mulRect(10, 6, 4, 4, 0.82);
  f.mulRect(1, 5, 14, 1, 1.12); // brow ridge
  f.mulRect(2, 10, 4, 1, 0.85); // bags under the eyes
  f.mulRect(10, 10, 4, 1, 0.85);
  for (const ex of [2, 10]) {
    f.rect(ex, 7, 4, 2, p.eyeRim);
    f.rect(ex + 1, 7, 2, 2, p.eye);
  }
  f.set(3, 7, husk ? '#3a2d1e' : '#24331c'); // dull glint
  f.set(11, 7, husk ? '#3a2d1e' : '#24331c');
  f.mulRect(7, 8, 2, 3, 1.06); // nose bridge
  f.mulRect(6, 10, 4, 1, 0.85);
  f.set(7, 10, p.mouth);
  f.set(8, 10, p.mouth);
  f.mulRect(1, 11, 3, 3, 0.86); // hollow cheeks
  f.mulRect(12, 11, 3, 3, 0.86);
  f.mulRect(4, 11, 8, 1, 0.85);
  f.rect(5, 12, 6, 2, p.mouth);
  f.rect(4, 13, 1, 2, p.mouth); // downturned corners
  f.rect(11, 13, 1, 2, p.mouth);
  f.mix(6, 12, p.teeth, 0.55);
  f.mix(9, 12, p.teeth, 0.45);
  f.mulRect(5, 14, 6, 1, 0.82);
  f.mulRect(4, 11, 8, 1, 0.9);
  f.mulRect(0, 15, 16, 1, 0.85);
  if (!husk) {
    f.mix(12, 3, p.rot, 0.5);
    f.mix(13, 4, p.rot, 0.4);
  } else {
    // Dry cracks across the forehead and cheek.
    for (const [cx, cy] of [[4, 3], [5, 4], [6, 4], [11, 12], [12, 13]] as const) f.mul(cx, cy, 0.72);
  }

  // ---- body
  const body = boxUV(o, 16, 16, 8, 12, 4);
  paintSides(a, body, (s, y, side, x) => {
    const jag = 18 + Math.floor(hash2(s >> 1, 0, jagSeed) * 2) + (hash2(s, 1, jagSeed) < 0.3 ? 1 : 0);
    if (y >= 21) {
      const c = cloth(p.pants, s, y, clothSeed + 5, 0.05);
      return y === 21 ? k(c, 0.78) : c;
    }
    if (y >= jag) return k(skin(s, y), y === 20 ? 0.75 : 0.88);
    if (side === 'front' && y < 4 && Math.abs(x - 7.5) < 4.5 - y) return k(skin(s, y), 0.9 - (3 - y) * 0.04);
    const hole = tearDist(husk ? 47 - s : s, y, BODY_TEARS, holeSeed);
    if (hole < 1) return k(skin(s, y + 7), 0.8 - (1 - hole) * 0.1);
    let c = cloth(p.shirt, s, y, clothSeed, 0.13);
    if (hole < 1.4) c = k(c, 0.62 + (hole - 1) * 0.5);
    if (x === 0 || x === (side === 'front' || side === 'back' ? body.w : body.d) - 1) c = k(c, 0.92); // seams
    if (y === jag - 1) c = k(c, 0.8);
    if (side === 'front' && y < 5 && Math.abs(x - 7.5) < 5.5 - y) c = k(c, 0.85); // collar edge
    if (y === 0) c = k(c, 1.1);
    return c;
  });
  paint(a, body.top, (x, y) => k(cloth(p.shirt, x, y + 60, clothSeed), 1.02));
  paint(a, body.bottom, (x, y) => k(cloth(p.pants, x, y + 60, clothSeed + 5), 0.7));

  // ---- arms
  const arm = boxUV(o, 40, 16, 4, 12, 4);
  paintSides(a, arm, (s, y, side, x) => {
    const end = 7 + Math.floor(hash2(s >> 1, 4, jagSeed) * 2) + (hash2(s, 5, jagSeed) < 0.35 ? 1 : 0);
    const r = round(x, side === 'front' || side === 'back' ? arm.w : arm.d);
    if (y < end) {
      let c = cloth(p.shirt, s, y + 30, clothSeed, 0.08);
      if (y === end - 1) c = k(c, 0.75);
      if (y < 2) c = k(c, 0.92);
      return k(c, r);
    }
    let c = skin(s, y + 70);
    if (y === end) c = k(c, 0.78);
    if (y >= 21) c = k(c, 0.95);
    if (side === 'front' && y === 21 && (x === 1 || x === 3 || x === 5)) c = k(c, 1.12); // knuckles
    if (y === 23) c = k(c, 0.85);
    return k(c, r);
  });
  paint(a, arm.top, (x, y) => k(cloth(p.shirt, x, y + 80, clothSeed), 0.95));
  paint(a, arm.bottom, (x, y) => {
    let c = k(skin(x, y + 120), 0.88);
    if (x === 2 || x === 4 || x === 6) c = k(c, 0.82); // fingers
    return c;
  });

  // ---- legs
  const leg = boxUV(o, 0, 16, 4, 12, 4);
  paintSides(a, leg, (s, y, side, x) => {
    const r = round(x, side === 'front' || side === 'back' ? leg.w : leg.d);
    if (y >= 19) {
      let c = flesh(p.shoe, s, y, clothSeed + 9, 0.4);
      if (y === 19) c = k(c, 1.15);
      if (y === 23) c = k(c, 0.6);
      if (husk && y === 20) c = k(c, 0.75);
      return k(c, r);
    }
    let c = cloth(p.pants, s, y, clothSeed + 5, 0.07);
    if (y < 2) c = k(c, 0.78);
    if (y === 18) c = k(c, 0.78);
    if (side === 'front' && (x === 3 || x === 4)) c = k(c, x === 3 ? 0.9 : 1.05); // crease
    if (side === 'front' && y >= 9 && y <= 12 && x >= 1 && x <= 6) c = k(c, 1.06); // worn knee
    if (husk) {
      // Rag wrappings spiralling down the leg.
      const band = (((s + y * 0.6) % 7) + 7) % 7;
      if (band < 1) c = k(c, 0.7);
      else if (band < 2) c = k(c, 1.12);
    } else {
      const t = tearDist(s, y, KNEE_TEARS, holeSeed + 3);
      if (t < 1) c = k(skin(s, y), 0.78);
      else if (t < 1.35) c = k(c, 0.65);
    }
    return k(c, r);
  });
  paint(a, leg.top, (x, y) => k(cloth(p.pants, x, y + 90, clothSeed + 5), 0.7));
  paint(a, leg.bottom, (x, y) => k(flesh(p.shoe, x, y + 50, clothSeed + 9, 0.3), (x + y) % 4 === 0 ? 0.45 : 0.55));
}

// ------------------------------------------------------------------ creeper

const CREEPER = ['#174f14', '#24701f', '#2f8a28', '#3ea033', '#58b847', '#86d073', '#b9e3ab'] as const;
/** The golden creeper: the same mottle in old gold, with bright glints. */
const GOLD_CREEPER = ['#5a3a06', '#83580c', '#ad7d14', '#d2a224', '#ecc440', '#f8e27c', '#fff6c8'] as const;
/** Upper bounds of each palette band: mostly mid greens, rare dark and pale flecks. */
const CREEPER_STEPS = [0.1, 0.26, 0.5, 0.7, 0.85, 0.95] as const;

function paintCreeper(a: Pix, o: [number, number], seed: number, palette: readonly string[] = CREEPER): void {
  const mottle = (x: number, y: number, bias = 0): RGB => {
    const n = 0.62 * fbm2(x / 2.8, y / 2.8, seed) + 0.24 * hash2(x >> 1, y >> 1, seed + 1) + 0.14 * hash2(x, y, seed + 2);
    const t = clamp((n - 0.3) / 0.4 + bias, 0, 1);
    let i = 0;
    while (i < CREEPER_STEPS.length && t > CREEPER_STEPS[i]!) i += 1;
    return k(hex(palette[i]!), grain(x, y, seed + 3, 0.07));
  };

  const head = boxUV(o, 0, 0, 8, 8, 8);
  paintSides(a, head, (s, y) => k(mottle(s, y), y === 15 ? 0.85 : 1));
  paint(a, head.top, (x, y) => mottle(x + 100, y, 0.05));
  paint(a, head.bottom, (x, y) => k(mottle(x + 140, y), 0.6));

  // The face: an inset black mask with a slightly darkened green rim.
  const face = (mx: number, my: number): boolean =>
    (my >= 2 && my <= 3 && (mx === 1 || mx === 2 || mx === 5 || mx === 6)) ||
    (my === 4 && (mx === 3 || mx === 4)) ||
    (my >= 5 && my <= 6 && mx >= 2 && mx <= 5) ||
    (my === 7 && (mx === 2 || mx === 5));
  const black = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < 16 && y < 16 && face(x >> 1, y >> 1);
  const f = on(a, head.front);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if (black(x, y)) {
        let c = C('#121312');
        if (!black(x, y - 1)) c = C('#030303'); // shadowed top lip of the hole
        else if (!black(x, y + 1)) c = C('#1f211f');
        else if (!black(x - 1, y)) c = C('#0a0a0a');
        f.set(x, y, k(c, grain(x, y, seed + 9, 0.15)));
      } else {
        let near = false;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (black(x + dx, y + dy)) near = true;
        if (near) f.mul(x, y, 0.74);
      }
    }
  }

  const body = boxUV(o, 16, 16, 8, 12, 4);
  paintSides(a, body, (s, y) => k(mottle(s + 200, y), y < 2 ? 0.8 : 1));
  paint(a, body.top, (x, y) => k(mottle(x + 260, y), 0.9));
  paint(a, body.bottom, (x, y) => k(mottle(x + 300, y), 0.6));

  const leg = boxUV(o, 0, 16, 4, 6, 4);
  paintSides(a, leg, (s, y, side, x) => {
    let c = mottle(s + 400, y);
    if (y < 2) c = k(c, 0.78);
    if (y >= 7) c = k(mixc(c, '#0d2a0b', 0.35 + (y - 7) * 0.08), 0.85);
    if (y === 11) c = k(c, 0.7);
    return k(c, round(x, side === 'front' || side === 'back' ? leg.w : leg.d));
  });
  paint(a, leg.top, (x, y) => k(mottle(x + 460, y), 0.75));
  paint(a, leg.bottom, (x, y) => k(mottle(x + 500, y), 0.35));
}

// ------------------------------------------------------------------ villagers

type VillagerKind = 'villager' | 'smith' | 'farmer' | 'trader';

const STRAW = ['#7a5a1c', '#a17c2e', '#c49d42', '#dcbb5e', '#ecd585'] as const;

function straw(x: number, y: number, seed: number, bias = 0): RGB {
  const cell = ((x >> 1) + (y >> 1)) & 1;
  const along = cell === 0 ? x : y;
  const across = cell === 0 ? y : x;
  let t = 0.6 + bias + (fbm2(x / 4, y / 4, seed) - 0.5) * 0.4 + (hash2(along >> 2, across, seed + 1) - 0.5) * 0.2;
  t += (across & 1) === 0 ? 0.08 : -0.1;
  return ramp(STRAW, clamp(t, 0, 1));
}

const TRADER_ROBE = ['#121b52', '#1b2a77', '#263b99', '#3550b6', '#4f6dcf'] as const;
const SASH = ['#b7a57a', '#d1c095', '#e6d8b0', '#f3e9c8', '#fdf7e2'] as const;
const GOLD = ['#6e4d0e', '#9c7419', '#c99d2b', '#e6c454', '#f7e38c'] as const;

/** Embroidered gold thread: bright stitches over a warm base. */
function gold(x: number, y: number, seed: number): RGB {
  const t = 0.58 + (fbm2(x / 3, y / 3, seed) - 0.5) * 0.5 + ((x + y) & 1 ? 0.1 : -0.08) + (hash2(x, y, seed + 1) - 0.5) * 0.12;
  return ramp(GOLD, clamp(t, 0, 1));
}

function paintVillager(a: Pix, o: [number, number], kind: VillagerKind, seed: number): void {
  const rng = mulberry32(seed);
  const sd = (): number => Math.floor(rng() * 100000);
  const skinSeed = sd();
  const robeSeed = sd();
  const extraSeed = sd();
  const sootSeed = sd();

  const skinStops =
    kind === 'smith'
      ? ['#6e4532', '#8d5c44', '#a87257', '#bf896c', '#d29e80']
      : kind === 'farmer'
        ? ['#7a4d32', '#9a6544', '#b47c58', '#c99470', '#dcab88']
        : kind === 'trader'
          ? ['#7a5038', '#9a6a4c', '#b58262', '#cb9a7a', '#ddb08f']
          : ['#7f553c', '#a06f51', '#ba8666', '#cf9e7e', '#e1b495'];
  const robeStops =
    kind === 'smith'
      ? ['#17171a', '#232327', '#303036', '#3e3e45', '#4f4f58']
      : kind === 'farmer'
        ? ['#3f2a18', '#5b3e24', '#74512f', '#8d653c', '#a57a4c']
        : kind === 'trader'
          ? TRADER_ROBE
          : ['#38251a', '#523523', '#6b452c', '#835736', '#9a6a43'];
  const browColor = kind === 'smith' ? '#1c140e' : kind === 'farmer' ? '#4a321f' : kind === 'trader' ? '#2e1c12' : '#3a2416';

  const skin = (x: number, y: number, bias = 0): RGB => flesh(skinStops, x, y, skinSeed, 0.38, bias);
  const soot = (c: RGB, x: number, y: number, amt = 1): RGB => {
    if (kind !== 'smith') return c;
    const n = fbm2(x / 5, y / 5, sootSeed);
    return n > 0.56 ? mixc(c, '#1a1714', clamp((n - 0.56) * 2.6 * amt, 0, 0.42)) : c;
  };

  // ---- head (8 x 10 x 8)
  const head = boxUV(o, 0, 0, 8, 10, 8);
  paintSides(a, head, (s, y, side, x) => {
    if (kind === 'trader') {
      const toBack = side === 'right' ? 1 - x / (head.d - 1) : side === 'left' ? x / (head.d - 1) : side === 'back' ? 1 : 0;
      const depth = side === 'front' ? 3 : side === 'back' ? 16 : 3 + Math.round(toBack * toBack * 12);
      if (y < depth) {
        const c = cloth(TRADER_ROBE, s, y + 300, robeSeed, 0.1, 0.05);
        return side === 'front' ? k(c, y === 0 ? 0.95 : 1.05) : k(c, y === depth - 1 ? 0.8 : 1);
      }
      if (y === depth) return k(gold(s, y, extraSeed), side === 'back' ? 0.8 : 1);
      if (y === depth + 1) return k(skin(s, y), 0.72); // shadow under the hood rim
    }
    if (kind === 'farmer') {
      if (y < 3) return straw(s, y, extraSeed, -0.05);
      if (y < 5) return k(leather(['#4f1f12', '#6e2c18', '#8a3b20', '#a44c2a'], s, y, extraSeed + 3), y === 4 ? 0.8 : 1);
      if (y === 5 && side !== 'front' && hash2(s, y, extraSeed) < 0.7) return k(C('#4a321f'), grain(s, y, extraSeed, 0.3));
    }
    let c = skin(s, y);
    if (y >= 18) c = k(c, 0.88);
    if (side === 'back' && y >= 14) c = k(c, 0.94);
    if (y < 2) c = k(c, 0.95);
    return c;
  });
  paint(a, head.top, (x, y) => {
    if (kind === 'farmer') return straw(x, y, extraSeed, 0.05);
    if (kind === 'trader') {
      const d = Math.hypot(x - 7.5, y - 7.5);
      return k(cloth(TRADER_ROBE, x + 40, y + 320, robeSeed, 0.08, 0.08), 1.04 - d * 0.015 + (x === 7 || x === 8 ? 0.06 : 0)); // hood seam
    }
    const d = Math.hypot(x - 7.5, y - 7.5);
    return k(skin(x + 50, y + 50), 1.05 - d * 0.012 + (d < 3 ? 0.04 : 0));
  });
  paint(a, head.bottom, (x, y) => k(skin(x + 80, y + 80), 0.7));

  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(6, 9, 4, 6, 0.88);
    e.mulRect(7, 10, 2, 4, 0.84);
    e.mulRect(6, 9, 4, 1, 1.08);
  }

  const f = on(a, head.front);
  f.mulRect(4, 3, 8, 1, 0.94); // forehead wrinkle
  f.mulRect(5, 4, 6, 1, 0.97);
  // Unibrow.
  for (let x = 2; x <= 13; x += 1) {
    f.mix(x, 6, browColor, kind === 'smith' ? 0.95 : x === 2 || x === 13 || hash2(x, 6, extraSeed) < 0.3 ? 0.55 : 0.85);
    f.set(x, 7, k(C(browColor), grain(x, 7, extraSeed, 0.25)));
  }
  if (kind === 'smith') for (let x = 3; x <= 12; x += 1) f.mix(x, 5, browColor, 0.5);
  f.mulRect(2, 8, 12, 1, 0.97);
  // Eyes: whites outside, green irises inside.
  f.rect(2, 8, 2, 2, '#e9e5dc');
  f.rect(12, 8, 2, 2, '#e9e5dc');
  f.set(2, 9, '#cdc7bc');
  f.set(13, 9, '#cdc7bc');
  for (const ix of [4, 10]) {
    f.rect(ix, 8, 2, 2, '#2f8f3c');
    f.set(ix, 8, '#4fb35a');
  }
  f.set(5, 9, '#15421c');
  f.set(10, 9, '#15421c');
  f.set(5, 8, '#2a7a35');
  f.set(11, 8, '#2a7a35');
  f.mulRect(2, 10, 4, 1, 0.86); // lower lids
  f.mulRect(10, 10, 4, 1, 0.86);
  f.mulRect(6, 8, 4, 4, 1.04); // nose bridge
  f.mulRect(6, 11, 4, 9, 0.86); // shadow behind the nose
  f.mixRect(1, 12, 4, 3, '#d2735c', 0.22); // cheeks
  f.mixRect(11, 12, 4, 3, '#d2735c', 0.22);
  f.mulRect(4, 17, 2, 1, 0.78); // mouth corners
  f.mulRect(10, 17, 2, 1, 0.78);
  f.mulRect(5, 18, 6, 1, 0.92);
  f.mulRect(0, 19, 16, 1, 0.86);
  if (kind === 'smith') {
    // A few soft smudges of forge soot on the cheek and forehead.
    for (const [cx, cy, r] of [[3, 13, 2.2], [11.5, 3, 2.6], [13, 15, 1.6]] as const) {
      for (let y = 0; y < 20; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          const d = Math.hypot(x - cx, y - cy) / r + (hash2(x, y, sootSeed) - 0.5) * 0.5;
          if (d < 1) f.mix(x, y, '#2a2420', (1 - d) * 0.45);
        }
      }
    }
  }

  // ---- nose (2 x 4 x 2), painted at the canonical slot and mirrored to (32, 0)
  const noseRegion = (u: number): Rect => ({ x: o[0] + u * S, y: o[1], w: 8 * S, h: 6 * S });
  const nose = boxUV(o, 24, 0, 2, 4, 2);
  paintSides(a, nose, (s, y, side, x) => {
    let c = skin(s + 120, y + 30, side === 'front' ? 0.02 : -0.06);
    if (side === 'front' && (x === 1 || x === 2) && y < 5) c = k(c, 1.06);
    if (y >= 5) c = mixc(c, '#c9705a', 0.18);
    if (side === 'front' && y === 7 && (x === 0 || x === 3)) c = k(c, 0.6);
    if (y === 7) c = k(c, 0.85);
    if (side === 'back') c = k(c, 0.8);
    return c;
  });
  paint(a, nose.top, (x, y) => skin(x + 140, y));
  paint(a, nose.bottom, (x, y) => {
    const c = k(skin(x + 150, y), 0.75);
    return (x === 0 || x === 3) && (y === 1 || y === 2) ? k(c, 0.55) : c;
  });
  copyRect(a, noseRegion(24), noseRegion(32));

  // ---- robe (8 x 20 x 6)
  const robe = boxUV(o, 0, 20, 8, 20, 6);
  const apronStops =
    kind === 'smith' ? ['#3d2312', '#57331b', '#704424', '#88562f', '#a06a3c'] : ['#545d18', '#6f7b22', '#8a9830', '#a4b244', '#bccb62'];
  const inApron = (x: number, y: number): boolean => {
    if (kind === 'smith') return (y >= 3 && y < 20 && x >= 3 && x <= 12) || (y >= 20 && y < 36 && x >= 1 && x <= 14);
    if (kind === 'farmer') return y >= 20 && y < 37 && x >= 2 && x <= 13;
    return false;
  };
  paintSides(a, robe, (s, y, side, x) => {
    let c = cloth(robeStops, s, y, robeSeed, y > 22 ? 0.2 : 0.08);
    if (y < 2) c = k(c, y === 0 ? 1.15 : 1.08); // collar trim
    if (y === 2) c = k(c, 0.85);
    if (y >= 37) c = k(c, 0.72); // hem
    if (y === 37) c = k(c, 1.35);
    if (y === 39) c = k(c, 0.8);
    if (kind === 'villager' && y >= 20 && y <= 22) {
      c = leather(['#22150c', '#2f1e12', '#3f2918', '#52361f'], s, y, robeSeed + 4);
      if (y === 22) c = k(c, 0.8);
      if (side === 'front' && x >= 6 && x <= 9) c = x === 6 || x === 9 || y !== 21 ? C('#c6a04a') : C('#5a4320');
      if (side === 'front' && x === 6 && y === 20) c = C('#ead07a');
    }
    if (kind === 'trader') {
      if (y < 2 || (y >= 36 && y <= 37)) c = k(gold(s, y, robeSeed + 2), y === 0 || y === 36 ? 1.08 : 0.92); // gold collar and hem trim
      if (side === 'front' && y >= 2 && y < 36 && (x === 6 || x === 9)) c = k(gold(s, y, robeSeed + 2), 0.92); // gold placket edges
      if (side === 'front' && y >= 2 && y < 36 && (x === 7 || x === 8)) c = k(c, x === 7 ? 0.78 : 0.88); // robe opening
      if (side === 'front' && y >= 2 && y < 36 && (x === 5 || x === 10)) c = k(c, 0.9);
      if (y >= 19 && y <= 22) {
        c = cloth(SASH, s, y, robeSeed + 4, 0.05);
        if (y === 19) c = k(c, 1.05);
        if (y === 22) c = k(c, 0.82);
        if ((s + y) % 4 === 0) c = k(c, 0.94);
      }
      if (side === 'front' && x >= 10 && x <= 13 && y >= 18 && y <= 23) {
        c = cloth(SASH, x, y, robeSeed + 5, 0.02, 0.1); // knot
        if (x === 10 || x === 13 || y === 18 || y === 23) c = k(c, 0.8);
      }
      if (side === 'front' && (x === 11 || x === 12) && y >= 24 && y <= 30) {
        c = k(cloth(SASH, x, y, robeSeed + 5, 0.02), x === 11 ? 0.92 : 0.84); // hanging sash end
        if (y === 30) c = k(gold(x, y, robeSeed + 2), 1);
      }
      if (side === 'back' && y >= 6 && y <= 13 && Math.abs(x - 7.5) + Math.abs(y - 9.5) < 4.2) {
        const d = Math.abs(x - 7.5) + Math.abs(y - 9.5);
        c = d > 3.2 ? k(gold(s, y, robeSeed + 2), 0.95) : d < 1.2 ? C('#f2e6c4') : c; // embroidered gold diamond
      }
    }
    if (kind !== 'villager' && kind !== 'trader' && y >= 20 && y <= 21 && side !== 'front') {
      c = kind === 'smith' ? leather(['#2a170b', '#3a2212', '#4c2e19'], s, y, robeSeed + 4) : k(cloth(apronStops, s, y, robeSeed + 6), 0.75);
    }
    if (side === 'front' && inApron(x, y)) {
      c = kind === 'smith' ? leather(apronStops, x, y, robeSeed + 8) : cloth(apronStops, x, y, robeSeed + 6, 0.1);
      const edge = !inApron(x - 1, y) || !inApron(x + 1, y) || !inApron(x, y + 1) || !inApron(x, y - 1);
      if (edge) c = k(c, 0.78);
      else if (!inApron(x - 2, y) || !inApron(x + 2, y) || !inApron(x, y + 2)) {
        if ((x + y) % 3 === 0) c = k(c, 1.22); // stitching
      }
      // Pocket.
      if (x >= 5 && x <= 10 && y >= 25 && y <= 30) {
        c = k(c, 0.94);
        if (y === 25) c = k(c, 0.72);
        if ((x === 5 || x === 10 || y === 30) && (x + y) % 2 === 0) c = k(c, 1.2);
      }
    }
    if (kind === 'smith' && side === 'front' && y < 3 && (x === 3 || x === 4 || x === 11 || x === 12)) {
      c = k(leather(apronStops, x, y, robeSeed + 8), 0.85); // straps
    }
    if (kind === 'smith' && side === 'back' && y < 20 && Math.abs(x - 7.5) > 1 && Math.abs(Math.abs(x - 7.5) - (8 - y * 0.35)) < 0.8) {
      c = k(leather(apronStops, x, y, robeSeed + 8), 0.8); // crossed straps on the back
    }
    if (kind === 'farmer' && side === 'back' && x >= 9 && x <= 13 && y >= 26 && y <= 31) {
      c = cloth(['#4e3420', '#6a4a2c', '#86613a'], x, y, robeSeed + 11, 0.02); // sewn patch
      if ((x === 9 || x === 13 || y === 26 || y === 31) && (x + y) % 2 === 0) c = k(c, 1.3);
    }
    return soot(c, s, y);
  });
  paint(a, robe.top, (x, y) => {
    let c = k(cloth(robeStops, x, y + 90, robeSeed), 0.9);
    if (kind === 'smith' && (x === 3 || x === 4 || x === 11 || x === 12)) c = k(leather(apronStops, x, y, robeSeed + 8), 0.8);
    return soot(c, x, y + 90);
  });
  paint(a, robe.bottom, (x, y) => {
    const rim = x < 2 || x > 13 || y < 2 || y > 9;
    return rim ? k(cloth(robeStops, x, y + 120, robeSeed), 0.6) : k(C('#120c08'), grain(x, y, robeSeed, 0.3));
  });

  // ---- crossed arms (8 x 4 x 4)
  const arms = boxUV(o, 32, 20, 8, 4, 4);
  const sleeve = (x: number, y: number, bias = 0): RGB => soot(cloth(robeStops, x, y + 160, robeSeed, 0.06, bias), x, y + 160);
  paint(a, arms.front, (x, y) => {
    if (x < 4 || x >= 12) {
      let c = sleeve(x, y);
      if (x === 3 || x === 12) c = k(c, 0.72); // cuff opening
      if (x === 2 || x === 13) c = kind === 'trader' ? gold(x, y, robeSeed + 2) : k(c, 1.12); // cuff trim
      return c;
    }
    let c = skin(x + 200, y + 200);
    if (y === 0) c = k(c, 1.08);
    if (y === 7) c = k(c, 0.82);
    if (x === 7) c = k(c, 0.78);
    if (x === 8) c = k(c, 0.9);
    if ((y === 2 || y === 4 || y === 6) && x !== 4 && x !== 11 && hash2(x, y, extraSeed) < 0.8) c = k(c, 0.88); // fingers
    return soot(c, x + 200, y, 0.5);
  });
  paint(a, arms.top, (x, y) => {
    if (x >= 4 && x < 12 && y >= 4) return k(skin(x + 220, y), y === 4 ? 0.85 : 1.02);
    return k(sleeve(x + 30, y), 1.02);
  });
  paint(a, arms.bottom, (x, y) => k(sleeve(x + 50, y), 0.68));
  paint(a, arms.back, (x, y) => k(sleeve(x + 70, y), 0.8));
  for (const r of [arms.right, arms.left]) {
    paint(a, r, (x, y) => {
      const d = Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5));
      return k(sleeve(x + 90, y + r.x), d > 2.6 ? 1.04 : 0.86);
    });
  }

  // ---- farmer hat brim (12 x 1 x 12)
  if (kind === 'farmer') {
    const brim = boxUV(o, 0, 48, 12, 1, 12);
    const edge = (x: number, y: number, n: number): number => Math.min(x, y, n - 1 - x, n - 1 - y);
    paint(a, brim.top, (x, y) => {
      const e = edge(x, y, 24);
      let c = straw(x, y, extraSeed + 20);
      if (e === 0) c = k(c, 0.78);
      if (e === 1) c = k(c, 0.9);
      if (e >= 4 && e <= 5) c = k(c, 0.9); // crown shadow ring
      return c;
    });
    paint(a, brim.bottom, (x, y) => {
      const e = edge(x, y, 24);
      return k(straw(x, y, extraSeed + 30), e === 0 ? 0.68 : 0.78);
    });
    paintSides(a, brim, (s, y) => {
      const c = straw(s, y, extraSeed + 40, -0.08);
      return hash2(s, y, extraSeed + 41) < 0.2 ? k(c, 0.75) : c;
    });
  }
}

// ------------------------------------------------------------------ skeleton

const BONE = ['#77766f', '#9d9c94', '#bdbcb3', '#d6d5cc', '#ecebe3'] as const;

function paintSkeleton(a: Pix, o: [number, number], seed: number): void {
  const bone = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 4, y / 4, seed);
    let t = 0.62 + bias + (n - 0.5) * 0.55 + (hash2(x, y, seed + 1) - 0.5) * 0.1;
    if (Math.abs(fbm2(x / 3, y / 3, seed + 5) - 0.5) < 0.012) t -= 0.25; // hairline cracks
    return ramp(BONE, clamp(t, 0, 1));
  };
  const gap = (x: number, y: number): RGB => k(C('#1a1918'), grain(x, y, seed + 2, 0.3));

  // ---- head
  const head = boxUV(o, 0, 0, 8, 8, 8);
  paintSides(a, head, (s, y) => {
    let c = bone(s, y);
    if (y === 15) c = k(c, 0.82);
    if (y === 0) c = k(c, 1.04);
    return c;
  });
  paint(a, head.top, (x, y) => {
    let c = bone(x + 60, y, 0.04);
    const suture = Math.round(7.5 + Math.sin(y * 1.7) * 0.9);
    if (x === suture && y > 3) c = k(c, 0.75);
    if (y === 4 && x > 2 && x < 13 && (x & 1) === 0) c = k(c, 0.8);
    return c;
  });
  paint(a, head.bottom, (x, y) => k(bone(x + 90, y), 0.62));
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(4, 6, 8, 5, 0.93); // temple hollow
    e.mulRect(7, 9, 2, 2, 0.8);
    e.mulRect(2, 12, 12, 1, 0.88); // jaw line
  }
  const back = on(a, head.back);
  back.mulRect(4, 12, 8, 3, 0.9);

  const f = on(a, head.front);
  f.mulRect(1, 5, 14, 1, 0.86); // brow overhang
  for (const ex of [2, 10]) {
    f.rect(ex, 6, 4, 4, '#353331');
    f.rect(ex + 1, 7, 2, 2, '#0c0b0b');
    f.set(ex, 6, '#1e1d1c');
    f.set(ex + 3, 6, '#1e1d1c');
    f.mulRect(ex, 10, 4, 1, 0.88);
  }
  f.mulRect(6, 10, 4, 2, 0.82); // nose cavity rim
  f.rect(7, 10, 2, 2, '#1a1918');
  f.set(7, 11, '#2a2826');
  f.set(8, 11, '#2a2826');
  f.mulRect(1, 10, 2, 3, 0.85); // cheekbones
  f.mulRect(13, 10, 2, 3, 0.85);
  f.mulRect(3, 12, 10, 3, 1.02);
  for (let x = 3; x <= 12; x += 1) {
    if ((x & 1) === 0) {
      f.mul(x, 12, 0.6);
      f.mul(x, 14, 0.62);
    }
    f.set(x, 13, '#1c1b1a');
  }
  f.mulRect(3, 15, 10, 1, 0.85);

  // ---- body: ribcage over a dark hollow
  const body = boxUV(o, 16, 16, 8, 12, 4);
  // Ribs are two texels thick and droop away from the sternum (front) and spine (back).
  const ribPart = (side: Side, x: number, y: number): number => {
    const off = Math.abs(x - 7.5);
    for (let i = 0; i < 3; i += 1) {
      const y0 = 3 + i * 4;
      let c: number;
      if (side === 'front') {
        if (i === 2 && off > 5.6) continue; // short floating ribs
        c = y0 + Math.round(off * 0.28);
      } else if (side === 'back') c = y0 + 1 + Math.round(off * 0.14);
      else {
        if (i === 2) continue;
        c = y0 + 2;
      }
      if (y === c) return 1;
      if (y === c + 1) return 2;
      if (y === c + 2) return 3;
    }
    return 0;
  };
  paintSides(a, body, (s, y, side, x) => {
    const mid = x === 7 || x === 8;
    if (side === 'front' && mid && y >= 2 && y <= 12) return k(bone(s, y, 0.06), y === 12 ? 0.8 : 1); // sternum
    if ((side === 'front' || side === 'back') && mid && y < 19) {
      let c = bone(s, y, side === 'back' ? 0.02 : -0.06);
      if (y % 3 === 2) c = k(c, 0.68); // vertebrae
      return c;
    }
    if (y <= 1) return k(bone(s, y), y === 1 ? 0.82 : 1.04); // collarbones and shoulders
    if (y >= 19 && y <= 20 && (side !== 'front' || (x >= 2 && x <= 13))) return k(bone(s, y), y === 20 ? 0.85 : 1.02); // hip crest
    if (y >= 21 && (side === 'right' || side === 'left' || x <= 5 || x >= 10)) return k(bone(s, y), y === 23 ? 0.72 : 0.94);
    if (y >= 21 && y <= 22 && (side === 'front' || side === 'back')) return k(bone(s, y), 0.86); // sacrum
    const rib = ribPart(side, x, y);
    if (rib === 1) return k(bone(s, y), 1.04);
    if (rib === 2) return k(bone(s, y), 0.8);
    if (side === 'back' && y >= 2 && y <= 9) {
      const half = Math.abs(x - 7.5);
      if (half >= 2.5 && half <= 6.5 - (y - 2) * 0.45) return k(bone(s, y), y === 2 ? 1 : 0.9); // shoulder blades
    }
    if (side === 'back' && (x === 6 || x === 9) && y % 3 === 0 && y < 19) return k(bone(s, y), 0.86); // spinal processes
    const c = gap(s, y);
    return rib === 3 || y === 2 || y === 18 ? k(c, 0.6) : c;
  });
  paint(a, body.top, (x, y) => {
    const rim = x < 2 || x > 13 || y < 2 || y > 5 || x === 7 || x === 8;
    return rim ? bone(x + 70, y + 30, 0.03) : gap(x, y);
  });
  paint(a, body.bottom, (x, y) => {
    const rim = x < 2 || x > 13 || y < 2 || y > 5;
    return rim ? k(bone(x + 90, y + 30), 0.7) : gap(x, y);
  });

  // ---- limbs (2 x 12 x 2)
  const limb = (b: BoxUV, off: number, isArm: boolean): void => {
    paintSides(a, b, (s, y, _side, x) => {
      let c = bone(s + off, y);
      if (y === 11) c = k(c, 1.06);
      if (y === 12) c = k(c, 0.66); // elbow / knee joint
      if (y === 13) c = k(c, 1.04);
      if (y < 2) c = k(c, isArm ? 1.05 : 0.82);
      if (y >= 22) c = k(c, isArm ? 0.9 : 0.85);
      return k(c, round(x, 4) * (x === 0 || x === 3 ? 0.95 : 1));
    });
    paint(a, b.top, (x, y) => k(bone(x + off, y + 50), (x === 1 || x === 2) && (y === 1 || y === 2) ? 0.7 : 1));
    paint(a, b.bottom, (x, y) => k(bone(x + off, y + 60), (x === 1 || x === 2) && (y === 1 || y === 2) ? 0.55 : 0.75));
  };
  limb(boxUV(o, 40, 16, 2, 12, 2), 300, true);
  limb(boxUV(o, 0, 16, 2, 12, 2), 400, false);
}

// ------------------------------------------------------------------ builder (the co-op mate)

/** Shirt colours: teal by default, and the co-op mate's ember red. */
const TEAL_SHIRT = ['#0a4a4d', '#0f6668', '#168483', '#22a29c', '#47c2b7'];
const EMBER_SHIRT = ['#4d1208', '#73200f', '#9a3214', '#c24a1c', '#e2733a'];

function paintBuilder(a: Pix, o: [number, number], seed: number, sleeveStops: string[] = TEAL_SHIRT): void {
  const skinStops = ['#8f5a3e', '#ab704f', '#c38662', '#d69d78', '#e6b590'];
  const arm = boxUV(o, 40, 16, 4, 12, 4);
  paintSides(a, arm, (s, y, side, x) => {
    const r = round(x, side === 'front' || side === 'back' ? arm.w : arm.d);
    if (y < 8) {
      let c = cloth(sleeveStops, s, y, seed, 0.1);
      if (y === 6) c = k(c, (x & 1) === 0 ? 1.18 : 0.92); // stitched cuff
      if (y === 7) c = k(c, 0.72);
      if (y === 0) c = k(c, 1.06);
      return k(c, r);
    }
    let c = flesh(skinStops, s, y, seed + 3, 0.3);
    if (y === 8) c = k(c, 0.82); // shadow under the cuff
    if (y >= 20) c = k(c, 0.97);
    if (side === 'front' && y === 21 && (x === 1 || x === 3 || x === 5)) c = k(c, 1.07);
    if (y === 23) c = k(c, 0.88);
    return k(c, r);
  });
  paint(a, arm.top, (x, y) => k(cloth(sleeveStops, x, y + 40, seed, 0.06), 1.04));
  paint(a, arm.bottom, (x, y) => {
    let c = flesh(skinStops, x, y + 60, seed + 3, 0.3);
    if (x === 2 || x === 4 || x === 6) c = k(c, 0.86); // fingers
    if (y === 0 || y === 7 || x === 0 || x === 7) c = k(c, 0.9);
    return c;
  });
}

/** The rest of the builder (head, shirt, jeans, boots), for the whole figure. */
function paintBuilderBody(a: Pix, o: [number, number], seed: number, shirtStops: string[] = TEAL_SHIRT, hairStops = ['#2a1a0e', '#3b2614', '#4e331b', '#624225']): void {
  const rng = mulberry32(seed);
  const sd = (): number => Math.floor(rng() * 100000);
  const skinSeed = sd();
  const hairSeed = sd();
  const clothSeed = sd();
  const skinStops = ['#8f5a3e', '#ab704f', '#c38662', '#d69d78', '#e6b590'];
  const jeanStops = ['#1c2350', '#28336e', '#36458c', '#4a5aa6', '#6070bb'];
  const bootStops = ['#2a2018', '#3a2c20', '#4c3a2a', '#5e4934'];
  const skin = (x: number, y: number, bias = 0): RGB => flesh(skinStops, x, y, skinSeed, 0.3, bias);
  const hair = (x: number, y: number): RGB => {
    const n = fbm2(x / 1.6, y / 5, hairSeed);
    return k(ramp(hairStops, clamp(0.5 + (n - 0.5) * 1.6, 0, 1)), grain(x, y, hairSeed, 0.12));
  };

  // ---- head: short brown hair, a fringe, blue eyes, a stubbly jaw
  const head = boxUV(o, 0, 0, 8, 8, 8);
  paintSides(a, head, (s, y, side, x) => {
    const toBack = side === 'right' ? 1 - x / (head.d - 1) : side === 'left' ? x / (head.d - 1) : side === 'back' ? 1 : 0;
    const jag = hash2(s, 1, hairSeed) < 0.4 ? 1 : 0;
    const depth = side === 'front' ? 3 + jag : side === 'back' ? 9 + Math.floor(hash2(s >> 1, 2, hairSeed) * 3) : 4 + Math.round(toBack * 5) + jag;
    if (y < depth) return hair(s, y);
    let c = skin(s, y + 40);
    if (y === depth) c = k(c, 0.84);
    if (y >= 14) c = k(c, 0.92);
    return c;
  });
  paint(a, head.top, (x, y) => hair(x + 3, y + 90));
  paint(a, head.bottom, (x, y) => k(skin(x, y + 200), 0.75));
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(6, 8, 4, 5, 0.88);
    e.mulRect(7, 9, 2, 3, 0.84);
  }
  const f = on(a, head.front);
  f.mulRect(1, 5, 14, 1, 0.86); // brow shadow under the fringe
  for (const ex of [2, 10]) {
    f.rect(ex, 7, 4, 2, '#f2f2ee');
    f.rect(ex + 2 - (ex === 2 ? 0 : 2), 7, 2, 2, '#3a5ab0');
    f.set(ex + (ex === 2 ? 2 : 0), 7, '#7aa0e8');
  }
  f.mulRect(7, 8, 2, 3, 1.06); // nose
  f.mulRect(6, 11, 4, 1, 0.9);
  f.rect(5, 12, 6, 1, '#7a4430'); // mouth
  f.mulRect(3, 13, 10, 3, 0.9); // stubble
  f.mulRect(0, 15, 16, 1, 0.88);

  // ---- body: teal shirt with a collar and a leather belt, jeans below
  const body = boxUV(o, 16, 16, 8, 12, 4);
  paintSides(a, body, (s, y, side, x) => {
    if (y >= 20) {
      let c = cloth(jeanStops, s, y, clothSeed + 5, 0.05);
      if (y === 20 || y === 21) c = mixc(c, '#4a3020', 0.8); // belt
      if (side === 'front' && y >= 20 && y <= 21 && x >= 6 && x <= 9) c = mixc(c, '#c8a040', 0.7); // buckle
      return c;
    }
    let c = cloth(shirtStops, s, y, clothSeed, 0.12);
    if (side === 'front' && y < 4 && Math.abs(x - 7.5) < 4.5 - y) c = k(skin(s, y), 0.92); // open collar
    if (side === 'front' && y < 5 && Math.abs(x - 7.5) < 5.5 - y) c = k(c, 0.85);
    if (x === 0 || x === (side === 'front' || side === 'back' ? body.w : body.d) - 1) c = k(c, 0.92);
    if (y === 0) c = k(c, 1.1);
    return c;
  });
  paint(a, body.top, (x, y) => k(cloth(shirtStops, x, y + 60, clothSeed), 1.02));
  paint(a, body.bottom, (x, y) => k(cloth(jeanStops, x, y + 60, clothSeed + 5), 0.7));

  // ---- legs: jeans and boots
  const leg = boxUV(o, 0, 16, 4, 12, 4);
  paintSides(a, leg, (s, y, side, x) => {
    const r = round(x, side === 'front' || side === 'back' ? leg.w : leg.d);
    if (y >= 19) {
      let c = flesh(bootStops, s, y, clothSeed + 9, 0.4);
      if (y === 19) c = k(c, 1.15);
      if (y === 23) c = k(c, 0.6);
      return k(c, r);
    }
    let c = cloth(jeanStops, s, y, clothSeed + 5, 0.07);
    if (y < 2) c = k(c, 0.8);
    if (side === 'front' && y >= 7 && y <= 10 && x >= 1 && x <= 6) c = k(c, 1.08);
    return k(c, r);
  });
  paint(a, leg.top, (x, y) => k(cloth(jeanStops, x, y + 90, clothSeed + 5), 0.7));
  paint(a, leg.bottom, (x, y) => k(C('#1a110a'), grain(x, y, clothSeed + 9, 0.3)));
}

// ------------------------------------------------------------------ spider

const SPIDER = ['#0f0c0b', '#191412', '#231c18', '#2f2620', '#3d322a', '#4e4137'] as const;

/** Lights a face texel: sets colour and full emissive glow. */
export function glowSet(a: Pix, r: Rect, x: number, y: number, c: string | RGB, e = 1): void {
  a.set(r.x + x, r.y + y, c);
  a.E(r.x + x, r.y + y, e);
}

function paintSpider(a: Pix, o: [number, number], seed: number): void {
  const rng = mulberry32(seed);
  const sd = (): number => Math.floor(rng() * 100000);
  const hairSeed = sd();
  const markSeed = sd();
  const legSeed = sd();

  /** Bristly dark fur: blotchy base, short grey hair strokes, dark roots between tufts. */
  const fur = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 3.5, y / 3.5, hairSeed);
    let t = 0.5 + bias + (n - 0.5) * 0.7 + (hash2(x, y, hairSeed + 1) - 0.5) * 0.22;
    const tuft = hash2(x, (y + (x & 1)) >> 1, hairSeed + 2);
    if (tuft > 0.86) t += 0.22;
    else if (tuft < 0.1) t -= 0.18;
    let c = ramp(SPIDER, clamp(t, 0, 1));
    if (tuft > 0.95) c = mixc(c, '#77706a', 0.32); // grey guard hairs
    return c;
  };

  // ---- head (8 x 8 x 8)
  const head = boxUV(o, 0, 0, 8, 8, 8);
  paintSides(a, head, (s, y) => {
    let c = fur(s, y);
    if (y === 15) c = k(c, 0.75);
    if (y === 0) c = k(c, 1.1);
    return c;
  });
  paint(a, head.top, (x, y) => fur(x + 60, y + 20, 0.06));
  paint(a, head.bottom, (x, y) => k(fur(x + 90, y + 40), 0.65));
  for (const r of [head.right, head.left]) on(a, r).mulRect(0, 12, 16, 4, 0.85);

  const hf = head.front;
  const f = on(a, hf);
  // Eye sockets sink into the face.
  const sockets: [number, number, number, number][] = [[3, 6, 5, 5], [8, 6, 5, 5], [3, 3, 4, 4], [9, 3, 4, 4], [0, 6, 4, 4], [12, 6, 4, 4], [1, 10, 4, 4], [11, 10, 4, 4]];
  for (const [x, y, w, h] of sockets) f.mulRect(x, y, w, h, 0.72);
  // Two big eyes (3 x 3) with a hot core, a bright glint and a dark lower rim.
  for (const ex of [4, 9]) {
    for (let y = 7; y <= 9; y += 1) for (let x = ex; x <= ex + 2; x += 1) glowSet(a, hf, x, y, y === 9 ? '#8c0f0c' : '#d81d16');
    glowSet(a, hf, ex + 1, 8, '#f23a26');
    glowSet(a, hf, ex === 4 ? ex : ex + 2, 7, '#ff8a70');
  }
  // Six small eyes (2 x 2).
  for (const [ex, ey] of [[4, 4], [10, 4], [1, 7], [13, 7], [2, 11], [12, 11]] as const) {
    glowSet(a, hf, ex, ey, '#e0281c');
    glowSet(a, hf, ex + 1, ey, '#c41a14');
    glowSet(a, hf, ex, ey + 1, '#a81410');
    glowSet(a, hf, ex + 1, ey + 1, '#7c0d0a');
    if (ex === 4 || ex === 1 || ex === 2) glowSet(a, hf, ex, ey, '#ff7a5e');
  }
  // Chelicerae and fangs.
  f.mulRect(5, 12, 6, 4, 0.7);
  f.mulRect(7, 12, 2, 4, 0.6);
  for (const fx of [5, 9]) {
    f.mulRect(fx, 12, 2, 2, 1.3);
    const tx = fx === 5 ? 6 : 9; // fangs curl inward
    f.set(tx, 13, '#8c7a66');
    f.set(tx, 14, '#75624f');
    f.set(tx + (fx === 5 ? 1 : -1), 15, '#4e4034');
  }
  f.mulRect(2, 2, 12, 1, 1.15); // brow ridge

  // ---- thorax (6 x 6 x 6)
  const thorax = boxUV(o, 32, 0, 6, 6, 6);
  paintSides(a, thorax, (s, y) => {
    let c = fur(s + 200, y);
    if (y === 0) c = k(c, 1.1);
    if (y >= 10) c = k(c, 0.78);
    return c;
  });
  paint(a, thorax.top, (x, y) => {
    let c = fur(x + 240, y, 0.08);
    const d = Math.hypot(x - 5.5, y - 5.5);
    if (d < 2.2) c = k(c, 0.75); // central pit
    if (d > 2.2 && d < 3.2 && (x + y) % 3 === 0) c = k(c, 1.2);
    return c;
  });
  paint(a, thorax.bottom, (x, y) => k(fur(x + 280, y), 0.6));

  // ---- abdomen (10 x 8 x 12)
  const ab = boxUV(o, 0, 16, 10, 8, 12);
  const mark = (c: RGB, x: number, y: number, w: number, h: number): RGB => {
    // A faint hourglass / chevron marking in rust brown, centred on the face.
    const cx = Math.abs(x - (w - 1) / 2);
    const v = y / (h - 1);
    const band = Math.abs(cx - (1 + Math.abs(v - 0.5) * w * 0.55)) < 1.2;
    const chev = Math.abs(((y + cx * 0.8) % 7) - 1) < 0.8 && v > 0.15 && v < 0.9 && cx < w * 0.36;
    const spot = cx < 1.6 && Math.abs(v - 0.5) < 0.12;
    const n = fbm2(x / 3, y / 3, markSeed);
    if (band || chev || spot) return mixc(c, '#6a3424', clamp(0.32 + (n - 0.5) * 0.6, 0.12, 0.5));
    return c;
  };
  paintSides(a, ab, (s, y, side, x) => {
    let c = fur(s + 300, y);
    if (y === 0) c = k(c, 1.08);
    if (y >= 13) c = k(c, 0.8);
    if (y % 5 === 4 && side !== 'front') c = k(c, 0.85); // segment folds
    if (side === 'back') c = mark(c, x, y, ab.w, ab.h);
    if (side === 'front') c = k(c, 0.82); // pressed against the thorax
    return c;
  });
  paint(a, ab.top, (x, y) => mark(k(fur(x + 400, y, 0.06), y % 6 === 5 ? 0.86 : 1), x, y, ab.w, ab.d));
  paint(a, ab.bottom, (x, y) => k(fur(x + 460, y), 0.6));

  // ---- leg (16 x 2 x 2), long axis along x
  const leg = boxUV(o, 0, 40, 16, 2, 2);
  const legShade = (x: number, y: number, bias: number): RGB => {
    let c = fur(x + 600, y + legSeed % 50, bias);
    const joint = Math.min(Math.abs(x - 10.5), Math.abs(x - 21.5));
    if (joint < 1) c = mixc(c, '#5a4a3e', 0.55); // knee joints
    else if (joint < 2) c = k(c, 0.75);
    if (x >= 29) c = k(c, 0.7 - (x - 29) * 0.08); // dark claw tip
    return c;
  };
  paint(a, leg.top, (x, y) => legShade(x, y, 0.08));
  paint(a, leg.front, (x, y) => k(legShade(x, y + 4, 0), y === 3 ? 0.8 : 1));
  paint(a, leg.back, (x, y) => k(legShade(31 - x, y + 8, 0), y === 3 ? 0.8 : 1));
  paint(a, leg.bottom, (x, y) => k(legShade(x, y + 12, -0.05), 0.75));
  paint(a, leg.right, (x, y) => k(fur(x + 700, y), 0.7));
  paint(a, leg.left, (x, y) => k(fur(x + 720, y), 0.5));
}

// ------------------------------------------------------------------ phantom

const PHANTOM_SKIN = ['#141b29', '#1d2738', '#28354a', '#35455d', '#475a75', '#5f7491'] as const;
const PHANTOM_MEMBRANE = ['#3e4d4b', '#53655f', '#687d73', '#80958a', '#9cb0a2'] as const;

function paintPhantom(a: Pix, o: [number, number], seed: number): void {
  const rng = mulberry32(seed);
  const sd = (): number => Math.floor(rng() * 100000);
  const skinSeed = sd();
  const memSeed = sd();

  const skin = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 4, y / 4, skinSeed);
    let t = 0.5 + bias + (n - 0.5) * 0.75 + (hash2(x, y, skinSeed + 1) - 0.5) * 0.12;
    if (hash2(x, y, skinSeed + 2) < 0.03) t -= 0.25; // pores / rot spots
    return ramp(PHANTOM_SKIN, clamp(t, 0, 1));
  };
  const membrane = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 5, y / 3, memSeed);
    const t = 0.5 + bias + (n - 0.5) * 0.7 + (hash2(x, y, memSeed + 1) - 0.5) * 0.1;
    let c = ramp(PHANTOM_MEMBRANE, clamp(t, 0, 1));
    if (Math.abs(fbm2(x / 4, y / 4, memSeed + 5) - 0.5) < 0.02) c = k(c, 0.72); // veins
    return c;
  };
  /** A raised bony ridge: bright crest, dark flank. */
  const ridge = (c: RGB, d: number): RGB => (d < 0.5 ? mixc(c, '#8794a6', 0.45) : d < 1.5 ? k(c, 0.72) : c);

  // ---- body (5 x 3 x 9)
  const body = boxUV(o, 0, 0, 5, 3, 9);
  paint(a, body.top, (x, y) => {
    let c = skin(x, y, 0.08);
    c = ridge(c, Math.abs(x - 4.5) - 0.5); // spine
    if (y % 4 === 1 && Math.abs(x - 4.5) < 2) c = k(c, 1.15); // vertebrae knobs
    if (x === 0 || x === 9) c = k(c, 0.85);
    return c;
  });
  paint(a, body.bottom, (x, y) => k(membrane(x + 40, y), y % 3 === 0 ? 0.8 : 0.92)); // ribbed belly
  paintSides(a, body, (s, y, side, x) => {
    let c = skin(s, y + 30);
    if (y === 0) c = k(c, 1.12);
    if (y === 5) c = k(c, 0.72);
    if ((side === 'right' || side === 'left') && x % 4 === 2 && y > 0 && y < 5) c = k(c, 0.8); // ribs showing
    return c;
  });

  // ---- head (7 x 3 x 5)
  const head = boxUV(o, 0, 12, 7, 3, 5);
  paint(a, head.top, (x, y) => {
    let c = skin(x + 80, y, 0.06);
    if (y < 2) c = k(c, 1.1); // brow crest
    if ((x === 3 || x === 10) && y > 1) c = ridge(c, 0); // twin skull ridges
    if (x === 4 || x === 11) c = k(c, 0.8);
    return c;
  });
  paint(a, head.bottom, (x, y) => k(skin(x + 110, y), 0.65));
  paintSides(a, head, (s, y) => {
    let c = skin(s + 140, y);
    if (y === 0) c = k(c, 1.12);
    if (y === 5) c = k(c, 0.75);
    return c;
  });
  const hf = head.front;
  const f = on(a, hf);
  f.mulRect(0, 1, 5, 3, 0.7); // sockets
  f.mulRect(9, 1, 5, 3, 0.7);
  // Slanted acid-green eyes.
  const eyePix: [number, number][] = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [4, 2]];
  for (const [ex, ey] of eyePix) {
    const c = ey === 1 ? '#c8ff6a' : '#8fe83a';
    glowSet(a, hf, ex, ey, c);
    glowSet(a, hf, 13 - ex, ey, c);
  }
  glowSet(a, hf, 1, 1, '#eaffb0');
  glowSet(a, hf, 12, 1, '#eaffb0');
  f.mulRect(5, 3, 4, 1, 0.75); // snout
  f.mulRect(2, 4, 10, 2, 0.6); // gaping mouth
  f.rect(3, 4, 8, 1, '#0b0d12');
  for (const tx of [3, 5, 8, 10]) f.set(tx, 4, '#a3a596'); // needle teeth
  f.set(4, 5, '#7c7e70');
  f.set(9, 5, '#7c7e70');

  // ---- wings
  const wingTop = (x: number, y: number, len: number, inner: boolean): RGB => {
    let c = skin(x + (inner ? 200 : 260), y);
    if (y < 2) c = ridge(k(c, 1.08), y === 0 ? 0 : 1); // leading-edge bone
    const rays = inner ? [6, 12] : [5, 10, 14];
    for (const r of rays) {
      const ry = r + (x / len) * (inner ? 1.5 : 2.5);
      const d = Math.abs(y - ry);
      if (d < 1.5) c = ridge(c, d);
    }
    if (!inner && x > len - 4) c = k(c, 0.85);
    return c;
  };
  const wingUnder = (x: number, y: number, len: number, inner: boolean): RGB => {
    let c = membrane(x + (inner ? 300 : 360), y);
    if (y < 2) c = mixc(c, PHANTOM_SKIN[3], 0.75); // bone edge on the underside
    const rays = inner ? [6, 12] : [5, 10, 14];
    for (const r of rays) {
      const ry = r + (x / len) * (inner ? 1.5 : 2.5);
      if (Math.abs(y - ry) < 0.6) c = mixc(c, PHANTOM_SKIN[2], 0.6);
    }
    if (y >= 16) c = k(c, 0.82); // trailing edge
    return c;
  };
  const inner = boxUV(o, 0, 24, 6, 2, 9);
  paint(a, inner.top, (x, y) => wingTop(x, y, inner.w, true));
  paint(a, inner.bottom, (x, y) => wingUnder(x, y, inner.w, true));
  paintSides(a, inner, (s, y) => k(skin(s + 420, y), y === 0 ? 1.1 : 0.82));

  const tip = boxUV(o, 0, 36, 13, 1, 9);
  // Tattered trailing edge: ragged notches darken (but keep opaque so the box still reads).
  const torn = (x: number, y: number): boolean => y >= 15 && hash2(x >> 1, 0, memSeed + 9) * 5 + 13 < y + (x > 20 ? 1 : 0);
  paint(a, tip.top, (x, y) => (torn(x, y) ? k(skin(x + 500, y), 0.45) : wingTop(x, y, tip.w, false)));
  paint(a, tip.bottom, (x, y) => (torn(x, y) ? k(membrane(x + 520, y), 0.45) : wingUnder(x, y, tip.w, false)));
  paintSides(a, tip, (s, y) => k(skin(s + 540, y), y === 0 ? 1.05 : 0.8));

  // ---- tail (3 x 2 x 6)
  const tail = boxUV(o, 32, 0, 3, 2, 6);
  paint(a, tail.top, (x, y) => {
    let c = skin(x + 600, y, 0.05);
    if (x === 2 || x === 3) c = ridge(c, 0);
    if (y % 3 === 2) c = k(c, 0.8); // segments
    return c;
  });
  paint(a, tail.bottom, (x, y) => k(membrane(x + 620, y), 0.8));
  paintSides(a, tail, (s, y, side, x) => {
    let c = skin(s + 640, y);
    if (y === 0) c = k(c, 1.1);
    if (y === 3) c = k(c, 0.75);
    if ((side === 'right' || side === 'left') && x % 3 === 2) c = k(c, 0.82);
    return c;
  });
}

// ------------------------------------------------------------------ raider

function paintRaider(a: Pix, o: [number, number], seed: number): void {
  const rng = mulberry32(seed);
  const sd = (): number => Math.floor(rng() * 100000);
  const skinSeed = sd();
  const hairSeed = sd();
  const clothSeed = sd();
  const leatherSeed = sd();

  const skinStops = ['#4c5650', '#616c64', '#77837a', '#8c978d', '#a3ada3'];
  const hairStops = ['#141315', '#1f1d21', '#2b292e', '#38353b'];
  const shirtStops = ['#28323f', '#364354', '#465568', '#59697f', '#6f8098'];
  const jerkinStops = ['#1b140f', '#271d15', '#35281d', '#443426', '#564231'];
  const trouserStops = ['#15161b', '#1e2027', '#282b33', '#343842', '#434855'];
  const bootStops = ['#33200f', '#4a2f19', '#614023', '#79522f', '#90653c'];

  const skin = (x: number, y: number, bias = 0): RGB => flesh(skinStops, x, y, skinSeed, 0.4, bias);
  const hair = (x: number, y: number): RGB => {
    const n = fbm2(x / 1.6, y / 5, hairSeed);
    return k(ramp(hairStops, clamp(0.5 + (n - 0.5) * 1.6, 0, 1)), grain(x, y, hairSeed, 0.12));
  };

  // ---- head
  const head = boxUV(o, 0, 0, 8, 8, 8);
  paintSides(a, head, (s, y, side, x) => {
    const toBack = side === 'right' ? 1 - x / (head.d - 1) : side === 'left' ? x / (head.d - 1) : side === 'back' ? 1 : 0;
    const jag = hash2(s, 1, hairSeed) < 0.35 ? 1 : 0;
    const depth = side === 'front' ? 2 + jag : side === 'back' ? 9 + Math.floor(hash2(s >> 1, 2, hairSeed) * 2) : 3 + Math.round(toBack * 5) + jag;
    if (y < depth) return hair(s, y);
    let c = skin(s, y + 40);
    if (y === depth) c = k(c, 0.8);
    if (y >= 14) c = k(c, 0.88);
    // Stubble along the jaw.
    if (y >= 12 && side !== 'back' && hash2(s, y, hairSeed + 4) < 0.35) c = mixc(c, '#2f3431', 0.35);
    return c;
  });
  paint(a, head.top, (x, y) => hair(x + 3, y + 90));
  paint(a, head.bottom, (x, y) => k(skin(x, y + 200), 0.7));
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(6, 8, 4, 5, 0.86);
    e.mulRect(7, 9, 2, 3, 0.8);
    e.mulRect(6, 8, 4, 1, 1.1);
  }

  const f = on(a, head.front);
  f.mulRect(1, 3, 14, 2, 0.92); // furrowed forehead
  f.mulRect(6, 4, 4, 1, 0.82);
  // Heavy unibrow, lowered toward the nose for a scowl.
  for (let x = 1; x <= 14; x += 1) {
    const inner = 7.5 - Math.abs(x - 7.5); // 0 at the edges, 6.5 at the centre
    const y0 = 5 + (inner > 4 ? 1 : 0);
    for (let y = y0; y <= 7; y += 1) f.set(x, y, k(C(hairStops[1]!), grain(x, y, hairSeed + 6, 0.3)));
    if (x === 1 || x === 14) f.mix(x, y0, skinStops[2]!, 0.5);
  }
  f.mulRect(2, 8, 12, 1, 0.8); // shadow under the brow
  // Eyes: pale whites, dark grey-blue irises looking ahead.
  for (const ex of [2, 10]) {
    f.rect(ex, 8, 4, 2, '#cfd0c6');
    f.set(ex, 9, '#a9aaa1');
    f.set(ex + 3, 9, '#a9aaa1');
  }
  f.rect(4, 8, 2, 2, '#2c3a48');
  f.rect(10, 8, 2, 2, '#2c3a48');
  f.set(4, 8, '#16202a');
  f.set(11, 8, '#16202a');
  f.mulRect(2, 8, 4, 1, 0.85); // heavy upper lids
  f.mulRect(10, 8, 4, 1, 0.85);
  f.mulRect(2, 10, 4, 1, 0.84);
  f.mulRect(10, 10, 4, 1, 0.84);
  // Long nose.
  f.mulRect(7, 8, 2, 4, 1.1);
  f.mulRect(6, 9, 1, 3, 0.86);
  f.mulRect(9, 9, 1, 3, 0.92);
  f.mulRect(6, 12, 4, 1, 0.72);
  f.set(6, 12, k(f.rgb(6, 12), 0.6));
  f.set(9, 12, k(f.rgb(9, 12), 0.6));
  // Scowling mouth with downturned corners.
  f.mulRect(4, 13, 8, 1, 0.92);
  f.rect(5, 14, 6, 1, '#1d2220');
  f.set(4, 15, '#262c29');
  f.set(11, 15, '#262c29');
  f.mulRect(5, 15, 6, 1, 0.82);
  f.mulRect(1, 11, 2, 3, 0.88); // gaunt cheeks
  f.mulRect(13, 11, 2, 3, 0.88);
  f.mix(12, 12, '#6e5d58', 0.45); // old scar
  f.mix(13, 13, '#6e5d58', 0.4);

  // ---- body: jerkin over a shirt, belted
  const body = boxUV(o, 16, 16, 8, 12, 4);
  const jerkin = (x: number, y: number): RGB => leather(jerkinStops, x, y, leatherSeed);
  paintSides(a, body, (s, y, side, x) => {
    const fw = side === 'front' || side === 'back' ? body.w : body.d;
    if (y >= 21) {
      const c = cloth(trouserStops, s, y, clothSeed + 5, 0.05);
      return y === 21 ? k(c, 0.75) : c;
    }
    if (y >= 16 && y <= 18) {
      let c = leather(['#120c08', '#1e140d', '#2a1c12', '#3a281a'], s, y, leatherSeed + 3);
      if (y === 16) c = k(c, 1.15);
      if (y === 18) c = k(c, 0.75);
      if (side === 'front' && x >= 6 && x <= 9) {
        c = x === 6 || x === 9 || y !== 17 ? C('#8d8f93') : C('#2a2b2e'); // iron buckle
        if (x === 6 && y === 16) c = C('#c9cbcf');
      }
      return c;
    }
    // Open V-neck on the front showing the shirt.
    const open = side === 'front' && Math.abs(x - 7.5) < 3.5 - y * 0.32;
    if (open) {
      let c = cloth(shirtStops, s, y, clothSeed, 0.08);
      if (Math.abs(x - 7.5) > 2.6 - y * 0.32) c = k(c, 0.75);
      if (y < 2) c = k(c, 1.08);
      return c;
    }
    let c = jerkin(s, y);
    if (y === 0) c = k(c, 1.15);
    if (y >= 19) c = k(c, 0.9); // skirt below the belt
    if (y === 20) c = k(c, 0.8);
    if (side === 'front' && Math.abs(Math.abs(x - 7.5) - (3.5 - y * 0.32)) < 0.6 && y < 11) c = mixc(c, '#6b5038', 0.5); // lapel edge
    if (side === 'front' && (x === 4 || x === 11) && y >= 11 && y < 16 && y % 2 === 0) c = k(c, 1.35); // laces
    if (x === 0 || x === fw - 1) c = k(c, 0.85);
    if ((side === 'right' || side === 'left') && y < 14 && x % 4 === 1) c = k(c, 1.08); // stitched panels
    return c;
  });
  paint(a, body.top, (x, y) => {
    const neck = x >= 5 && x <= 10 && y >= 2 && y <= 5;
    return neck ? cloth(shirtStops, x, y + 60, clothSeed, 0.05) : k(jerkin(x + 60, y), 1.05);
  });
  paint(a, body.bottom, (x, y) => k(cloth(trouserStops, x, y + 60, clothSeed + 5), 0.7));

  // ---- arms: leather pauldron, shirt sleeve, bracer, hand
  const arm = boxUV(o, 40, 16, 4, 12, 4);
  paintSides(a, arm, (s, y, side, x) => {
    const r = round(x, side === 'front' || side === 'back' ? arm.w : arm.d);
    let c: RGB;
    if (y < 6) {
      c = jerkin(s + 100, y);
      if (y === 0) c = k(c, 1.15);
      if (y === 5) c = k(c, 0.72);
      if (y === 2 && (s & 3) === 1) c = k(c, 1.35); // rivets
    } else if (y < 16) {
      c = cloth(shirtStops, s, y + 30, clothSeed, 0.1);
      if (y === 6) c = k(c, 0.78);
      if (y === 11 || y === 12) c = k(c, y === 11 ? 0.88 : 1.05); // elbow crease
    } else if (y < 20) {
      c = leather(jerkinStops, s + 140, y, leatherSeed + 5);
      if (y === 16) c = k(c, 1.15);
      if (y === 19) c = k(c, 0.75);
      if (y === 17 && (s & 1) === 0) c = mixc(c, '#8a7a62', 0.4); // cord wrap
    } else {
      c = skin(s, y + 70);
      if (y === 20) c = k(c, 0.8);
      if (side === 'front' && y === 21 && (x === 1 || x === 3 || x === 5)) c = k(c, 1.1);
      if (y === 23) c = k(c, 0.85);
    }
    return k(c, r);
  });
  paint(a, arm.top, (x, y) => k(jerkin(x + 180, y), 1.05));
  paint(a, arm.bottom, (x, y) => {
    let c = k(skin(x, y + 120), 0.88);
    if (x === 2 || x === 4 || x === 6) c = k(c, 0.82);
    return c;
  });

  // ---- legs: dark trousers, brown boots
  const leg = boxUV(o, 0, 16, 4, 12, 4);
  paintSides(a, leg, (s, y, side, x) => {
    const r = round(x, side === 'front' || side === 'back' ? leg.w : leg.d);
    if (y >= 14) {
      let c = leather(bootStops, s, y, leatherSeed + 7);
      if (y <= 15) c = k(c, y === 14 ? 1.2 : 1.08); // folded cuff
      if (y === 16) c = k(c, 0.78);
      if (y === 22) c = k(c, 0.75);
      if (y === 23) c = k(C('#1a110a'), grain(s, y, leatherSeed, 0.3)); // sole
      if (side === 'front' && y >= 17 && y <= 21 && (x === 3 || x === 4)) c = k(c, (y & 1) === 0 ? 1.25 : 0.85); // laces
      return k(c, r);
    }
    let c = cloth(trouserStops, s, y, clothSeed + 5, 0.07);
    if (y < 2) c = k(c, 0.8);
    if (y === 13) c = k(c, 0.72);
    if (side === 'front' && (x === 3 || x === 4)) c = k(c, x === 3 ? 0.9 : 1.06);
    if (side === 'front' && y >= 7 && y <= 10 && x >= 1 && x <= 6) c = k(c, 1.07); // worn knee
    return k(c, r);
  });
  paint(a, leg.top, (x, y) => k(cloth(trouserStops, x, y + 90, clothSeed + 5), 0.7));
  paint(a, leg.bottom, (x, y) => k(C('#1a110a'), grain(x, y, leatherSeed + 9, 0.3)));
}

// ------------------------------------------------------------------ wolf

const FUR = ['#8c877e', '#aba59a', '#c6c1b6', '#dcd8cf', '#ece9e2', '#f7f5f0'] as const;
const COLLAR = ['#7a1410', '#a31d16', '#c92a1f', '#e0453a'] as const;

/** Pip: soft grey-white fur, a darker saddle along the back, a red collar, bright eyes. */
function paintWolf(a: Pix, o: [number, number], seed: number): void {
  const fur = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 3.2, y / 2.2, seed);
    const streak = Math.sin(x * 1.7 + y * 0.35 + n * 3) * 0.08;
    const t = 0.6 + bias + (n - 0.5) * 0.6 + streak + (hash2(x, y, seed + 1) - 0.5) * 0.12;
    return ramp(FUR, clamp(t, 0, 1));
  };
  // Head: lighter muzzle side, dark eyes with a glint.
  const head = boxUV(o, 0, 0, 6, 6, 5);
  paintSides(a, head, (s, y) => k(fur(s, y, 0.05), y >= 10 ? 0.9 : 1));
  paint(a, head.top, (x, y) => k(fur(x + 40, y, -0.1), 0.95));
  paint(a, head.bottom, (x, y) => k(fur(x + 60, y, 0.1), 0.85));
  const f = on(a, head.front);
  for (const ex of [2, 7]) {
    f.rect(ex, 4, 3, 2, '#1a1a1e');
    f.set(ex + 1, 4, '#ffffff');
    f.rect(ex, 3, 3, 1, k(fur(ex, 3), 0.7));
  }
  // Snout: a pale muzzle with a black nose on its front.
  const snout = boxUV(o, 0, 12, 3, 3, 3);
  paintSides(a, snout, (s, y) => k(fur(s + 80, y, 0.2), y >= 4 ? 0.92 : 1));
  paint(a, snout.top, (x, y) => fur(x + 90, y, 0.15));
  paint(a, snout.bottom, (x, y) => k(fur(x + 95, y, 0.2), 0.85));
  const sn = on(a, snout.front);
  sn.rect(1, 0, 4, 2, '#18161a');
  sn.set(2, 0, '#4a464c');
  sn.rect(2, 4, 2, 1, '#6a2a2a');
  // Ears: grey outside, pink inside (the front face).
  const ear = boxUV(o, 14, 12, 2, 2, 1);
  paintSides(a, ear, (s, y) => k(fur(s + 110, y, -0.15), 0.85));
  paint(a, ear.front, (x, y) => (x > 0 && x < 3 && y > 0 ? C('#d8a0a0') : k(fur(x, y), 0.8)));
  paint(a, ear.top, (x, y) => k(fur(x + 120, y), 0.8));
  paint(a, ear.bottom, (x, y) => k(fur(x + 125, y), 0.7));
  // Body: a darker saddle along the top; a lighter belly.
  const body = boxUV(o, 24, 0, 6, 6, 10);
  paintSides(a, body, (s, y) => k(fur(s + 200, y, y < 4 ? -0.18 : y > 9 ? 0.12 : 0), y < 1 ? 0.85 : 1));
  paint(a, body.top, (x, y) => k(fur(x + 260, y, -0.25), 0.88));
  paint(a, body.bottom, (x, y) => fur(x + 280, y, 0.2));
  // Mane: thick ruff, with the red collar around its front.
  const mane = boxUV(o, 24, 18, 8, 7, 6);
  paintSides(a, mane, (s, y, side) => {
    if (y >= 1 && y <= 3) {
      const c = ramp(COLLAR, clamp(0.55 + (hash2(s, y, seed + 7) - 0.5) * 0.4 + (y === 1 ? 0.25 : y === 3 ? -0.3 : 0), 0, 1));
      // A little gold tag at the front.
      if (side === 'front' && y === 3 && (s % 16 === 7 || s % 16 === 8)) return C('#f0c84a');
      return c;
    }
    return k(fur(s + 300, y, 0.08), y > 11 ? 0.9 : 1);
  });
  paint(a, mane.top, (x, y) => k(fur(x + 340, y, -0.1), 0.92));
  paint(a, mane.bottom, (x, y) => k(fur(x + 360, y, 0.1), 0.85));
  // Legs and tail.
  const leg = boxUV(o, 0, 20, 2, 7, 2);
  paintSides(a, leg, (s, y) => k(fur(s + 400, y, 0.05), y >= 12 ? 0.82 : 1));
  paint(a, leg.top, (x, y) => fur(x + 420, y));
  paint(a, leg.bottom, (x, y) => k(fur(x + 430, y), 0.6));
  const tail = boxUV(o, 10, 20, 2, 8, 2);
  paintSides(a, tail, (s, y) => k(fur(s + 500, y, y > 11 ? 0.2 : -0.05), 1));
  paint(a, tail.top, (x, y) => fur(x + 520, y));
  paint(a, tail.bottom, (x, y) => k(fur(x + 530, y, 0.25), 0.95));
}

// ------------------------------------------------------------------ farm animals

const FEATHER = ['#a8a49a', '#c9c5bb', '#dedad0', '#ece9e1', '#f7f5ef', '#ffffff'] as const;
const BEAK = ['#a8620c', '#cf8414', '#e8a424', '#f6c444', '#ffe07a'] as const;
const COMB = ['#7a0e0a', '#a8160e', '#cf2418', '#e8453a'] as const;

/** A hen: white feathers in soft scallops, a red comb and wattle, a yellow beak and legs. */
function paintChicken(a: Pix, o: [number, number], seed: number): void {
  const feather = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 3, y / 2.4, seed);
    // Rows of overlapping feather tips: a darker edge under each scallop.
    const row = y % 4;
    const tip = row === 3 && ((x + (Math.floor(y / 4) & 1) * 2) % 4 !== 0) ? -0.16 : row === 0 ? 0.05 : 0;
    const t = 0.66 + bias + (n - 0.5) * 0.42 + tip + (hash2(x, y, seed + 1) - 0.5) * 0.08;
    return ramp(FEATHER, clamp(t, 0, 1));
  };
  const head = boxUV(o, 0, 0, 4, 6, 3);
  paintSides(a, head, (s, y) => k(feather(s, y + 20, 0.1), y >= 10 ? 0.92 : 1));
  paint(a, head.top, (x, y) => feather(x + 30, y, 0.12));
  paint(a, head.bottom, (x, y) => k(feather(x + 40, y), 0.82));
  const f = on(a, head.front);
  for (const ex of [1, 5]) {
    f.rect(ex, 4, 2, 2, '#16120f');
    f.set(ex, 4, '#ffffff');
    f.rect(ex, 3, 2, 1, k(feather(ex, 3), 0.86));
  }
  // The eyes show from the sides too.
  for (const side of [head.right, head.left]) {
    const sd = on(a, side);
    sd.rect(2, 4, 2, 2, '#16120f');
    sd.set(2, 4, '#ffffff');
  }
  const beak = boxUV(o, 14, 0, 4, 2, 2);
  paintSides(a, beak, (s, y) => ramp(BEAK, clamp(0.62 - (y >= 2 ? 0.28 : 0) + (hash2(s, y, seed + 3) - 0.5) * 0.15, 0, 1)));
  paint(a, beak.top, (x, y) => ramp(BEAK, clamp(0.78 + (hash2(x, y, seed + 4) - 0.5) * 0.12, 0, 1)));
  paint(a, beak.bottom, (x, y) => ramp(BEAK, clamp(0.3 + (hash2(x, y, seed + 5) - 0.5) * 0.12, 0, 1)));
  const red = (x: number, y: number, bias = 0): RGB => ramp(COMB, clamp(0.6 + bias + (fbm2(x / 2, y / 2, seed + 6) - 0.5) * 0.5, 0, 1));
  const wattle = boxUV(o, 14, 4, 2, 2, 2);
  paintSides(a, wattle, (s, y) => red(s, y, y >= 2 ? -0.2 : 0.05));
  paint(a, wattle.top, (x, y) => red(x + 10, y));
  paint(a, wattle.bottom, (x, y) => red(x + 20, y, -0.3));
  const comb = boxUV(o, 0, 23, 2, 2, 3);
  paintSides(a, comb, (s, y) => red(s + 30, y, y < 1 ? 0.2 : 0));
  paint(a, comb.top, (x, y) => red(x + 40, y, 0.25));
  paint(a, comb.bottom, (x, y) => red(x + 50, y, -0.2));
  const body = boxUV(o, 0, 9, 6, 6, 8);
  paintSides(a, body, (s, y) => k(feather(s + 60, y, y > 8 ? -0.12 : 0.04), y >= 11 ? 0.88 : 1));
  paint(a, body.top, (x, y) => feather(x + 100, y, 0.1));
  paint(a, body.bottom, (x, y) => k(feather(x + 120, y, -0.1), 0.8));
  const wing = boxUV(o, 28, 9, 1, 4, 6);
  paintSides(a, wing, (s, y) => {
    // Primary feathers: long strokes with dark tips at the trailing edge.
    let c = feather(s * 3 + 200, y, 0.02);
    if (y >= 6) c = k(c, 0.84);
    if ((s & 3) === 0) c = k(c, 0.9);
    return c;
  });
  paint(a, wing.top, (x, y) => feather(x + 230, y, 0.08));
  paint(a, wing.bottom, (x, y) => k(feather(x + 240, y), 0.8));
  const tail = boxUV(o, 10, 23, 4, 4, 1);
  paintSides(a, tail, (s, y) => k(feather(s + 260, y * 2, 0.05), y < 2 ? 1.02 : 0.9));
  paint(a, tail.top, (x, y) => feather(x + 280, y, 0.1));
  paint(a, tail.bottom, (x, y) => k(feather(x + 290, y), 0.8));
  const leg = boxUV(o, 42, 9, 1, 5, 1);
  paintSides(a, leg, (s, y) => ramp(BEAK, clamp(0.5 - (y >= 8 ? 0.15 : 0) + (hash2(s, y, seed + 7) - 0.5) * 0.12, 0, 1)));
  paint(a, leg.top, () => ramp(BEAK, 0.5));
  paint(a, leg.bottom, () => ramp(BEAK, 0.3));
  const foot = boxUV(o, 46, 9, 3, 1, 3);
  paintSides(a, foot, (s, y) => ramp(BEAK, clamp(0.42 + (hash2(s, y, seed + 8) - 0.5) * 0.12, 0, 1)));
  paint(a, foot.top, (x, y) => ramp(BEAK, (x === 2 || x === 3 || y === 2 || y === 3) ? 0.62 : 0.4));
  paint(a, foot.bottom, () => ramp(BEAK, 0.2));
}

const SHEEP_SKIN = ['#9e7a68', '#bc9482', '#d4ae9a', '#e6c6b2', '#f2dccb'] as const;
const FLEECE = ['#9c9a94', '#bdbab2', '#d6d3cb', '#e8e6df', '#f5f3ee', '#ffffff'] as const;

/**
 * A sheep: a pale face and legs, a shorn pink-beige body under a thick curly fleece. The fleece is
 * painted in neutral whites so each sheep can tint its own wool (grey, brown, black, rare pink).
 */
function paintSheep(a: Pix, o: [number, number], seed: number): void {
  const skin = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 4, y / 4, seed);
    return k(ramp(SHEEP_SKIN, clamp(0.62 + bias + (n - 0.5) * 0.35 + (hash2(x, y, seed + 1) - 0.5) * 0.08, 0, 1)), 1);
  };
  const fleece = (x: number, y: number, bias = 0): RGB => {
    // Little curls: bright tops and shadowed undersides on a soft lumpy base.
    const n = fbm2(x / 3.4, y / 3.4, seed + 2);
    const cx = (x + (Math.floor(y / 3) & 1) * 2) % 4;
    const cy = y % 3;
    const curl = cy === 0 && cx >= 1 ? 0.12 : cy === 2 && cx >= 1 ? -0.16 : 0;
    const t = 0.66 + bias + (n - 0.5) * 0.5 + curl + (hash2(x, y, seed + 3) - 0.5) * 0.1;
    return ramp(FLEECE, clamp(t, 0, 1));
  };
  const head = boxUV(o, 0, 0, 6, 6, 8);
  paintSides(a, head, (s, y) => k(skin(s, y + 30), y >= 10 ? 0.9 : 1));
  paint(a, head.top, (x, y) => skin(x + 40, y, 0.05));
  paint(a, head.bottom, (x, y) => k(skin(x + 50, y), 0.8));
  const f = on(a, head.front);
  for (const ex of [1, 8]) {
    f.rect(ex, 4, 3, 2, '#f4f0ea');
    f.rect(ex + (ex === 1 ? 1 : 0), 4, 2, 2, '#1a1412');
    f.set(ex + (ex === 1 ? 1 : 0), 4, '#ffffff');
  }
  // A pink nose and a little mouth.
  f.rect(4, 8, 4, 2, '#e89a98');
  f.rect(5, 8, 2, 1, '#c86e70');
  f.rect(5, 10, 2, 1, '#8a5a50');
  const body = boxUV(o, 0, 14, 8, 6, 16);
  paintSides(a, body, (s, y) => {
    let c = skin(s + 70, y, -0.02);
    // Stubble left by the shears.
    if (hash2(s, y, seed + 5) < 0.12) c = k(c, 1.08);
    return k(c, y >= 10 ? 0.9 : 1);
  });
  paint(a, body.top, (x, y) => skin(x + 120, y, 0.04));
  paint(a, body.bottom, (x, y) => k(skin(x + 150, y), 0.8));
  const leg = boxUV(o, 48, 14, 4, 12, 4);
  paintSides(a, leg, (s, y, side, x) => {
    if (y >= 20) return k(C('#3c302a'), grain(s, y, seed + 6, 0.2) * (y === 23 ? 0.8 : 1)); // hooves
    return k(skin(s + 200, y), round(x, side === 'front' || side === 'back' ? leg.w : leg.d));
  });
  paint(a, leg.top, (x, y) => skin(x + 220, y));
  paint(a, leg.bottom, () => C('#2a201c'));
  const furBody = boxUV(o, 0, 36, 8, 6, 16);
  paintSides(a, furBody, (s, y) => k(fleece(s, y, 0.02), y >= 10 ? 0.86 : 1));
  paint(a, furBody.top, (x, y) => fleece(x + 100, y, 0.08));
  paint(a, furBody.bottom, (x, y) => k(fleece(x + 140, y), 0.78));
  const furHead = boxUV(o, 28, 0, 6, 6, 6);
  paintSides(a, furHead, (s, y) => k(fleece(s + 200, y, 0.04), y >= 10 ? 0.9 : 1));
  paint(a, furHead.top, (x, y) => fleece(x + 240, y, 0.1));
  paint(a, furHead.bottom, (x, y) => k(fleece(x + 260, y), 0.8));
  const furLeg = boxUV(o, 48, 30, 4, 6, 4);
  paintSides(a, furLeg, (s, y) => k(fleece(s + 300, y), y >= 9 ? 0.86 : 1));
  paint(a, furLeg.top, (x, y) => fleece(x + 320, y));
  paint(a, furLeg.bottom, (x, y) => k(fleece(x + 330, y), 0.8));
}

// ------------------------------------------------------------------ install

export function installSkins(): void {
  registerSkins((atlas, origin) => {
    paintUndead(atlas, origin('zombie'), ZOMBIE, 1101, false);
    paintUndead(atlas, origin('husk'), HUSK, 2207, true);
    paintCreeper(atlas, origin('creeper'), 3313);
    paintVillager(atlas, origin('villager'), 'villager', 4421);
    paintVillager(atlas, origin('smith'), 'smith', 5527);
    paintVillager(atlas, origin('farmer'), 'farmer', 6637);
    paintSkeleton(atlas, origin('skeleton'), 7741);
    // The captain wears the player's own skin (see player-skin.ts).
    paintPlayerSkin(atlas, origin('builder'));
    // The co-op mate: an ember-red shirt and sandy hair.
    paintBuilder(atlas, origin('builder2'), 8853, EMBER_SHIRT);
    paintBuilderBody(atlas, origin('builder2'), 8857, EMBER_SHIRT, ['#5a3a12', '#7a5220', '#9a6c2e', '#b8883e']);
    paintSpider(atlas, origin('spider'), 9901);
    paintPhantom(atlas, origin('phantom'), 9907);
    paintVillager(atlas, origin('trader'), 'trader', 9923);
    paintRaider(atlas, origin('raider'), 9931);
    paintCreeper(atlas, origin('goldcreeper'), 3313, GOLD_CREEPER);
    paintWolf(atlas, origin('wolf'), 9941);
    paintChicken(atlas, origin('chicken'), 9953);
    paintSheep(atlas, origin('sheep'), 9967);
  });
}
