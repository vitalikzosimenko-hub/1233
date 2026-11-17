// Shared helpers for the Long March's creature models and skins (see creatures.ts and
// creature-skins.ts): frames, limb ends, rods between points, two-bone legs, sheet rectangles, and
// the painting toolkit (noise materials, shaded boxes, translucent texels).
import type { Actor } from './entities';
import type { MeshBuilder, TexRect } from './gl';
import { normalize, type Vec3 } from './math3d';
import { add, pitchBasis, rollBasis, scale, yawBasis, type Basis } from './models';
import { boxUV, paint, paintSides, round, type BoxUV, type Side } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { flashOf } from './models';
import { ramp, SKIN_H, SKIN_SCALE, SKIN_W, skinPx, type Pix, type RGB } from './textures';

export const PI = Math.PI;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** How far through its move (0..1). */
export function prog(a: Actor): number {
  return a.actDur > 0 ? Math.min(1, a.actT / a.actDur) : 0;
}

export function moving(a: Actor, min = 0.2): boolean {
  return Math.hypot(a.vx, a.vz) > min && a.deathT < 0;
}

/** Leg swing of a walker from its stride (none when still or falling dead). */
export function stride(a: Actor, k: number, rate = 1): number {
  return moving(a) ? Math.sin(a.walkPhase * Math.PI * rate) * k : 0;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function len(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/** A point in a frame, offsets in pixels along forward / up / right. */
export function at(o: Vec3, basis: Basis, px: number, x: number, y: number, z: number): Vec3 {
  return add(o, add(scale(basis.f, x * px), add(scale(basis.u, y * px), scale(basis.r, z * px))));
}

/** A direction given in a frame's forward / up / right parts. */
export function dirIn(basis: Basis, x: number, y: number, z: number): Vec3 {
  return normalize(add(scale(basis.f, x), add(scale(basis.u, y), scale(basis.r, z))));
}

/** Turns a frame about its up axis (positive swings forward toward the right, like yaw). */
export function turnBasis(b: Basis, angle: number): Basis {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { f: add(scale(b.f, c), scale(b.r, s)), u: b.u, r: add(scale(b.r, c), scale(b.f, -s)) };
}

/** A frame stretched along its axes (squash and stretch). */
export function stretch(b: Basis, kf: number, ku: number, kr: number): Basis {
  return { f: scale(b.f, kf), u: scale(b.u, ku), r: scale(b.r, kr) };
}

/** The head's frame: the body's facing turned by where its eyes track (the falling keep the body's). */
export function headBasis(a: Actor, base: Basis): Basis {
  if (a.deathT >= 0) return base;
  return pitchBasis(yawBasis(a.yaw + a.headYaw), -a.headPitch);
}

/** A head on a body that leans: turned and pitched relative to that body's frame. */
export function headOn(a: Actor, base: Basis, yawK = 1, pitchK = 1): Basis {
  if (a.deathT >= 0) return base;
  return pitchBasis(turnBasis(base, a.headYaw * yawK), -a.headPitch * pitchK);
}

/** Point at the far end of a limb (its hand or foot), and the limb's own frame. */
export function limbEnd(o: Vec3, basis: Basis, px: number, pivot: Vec3, angle: number, length: number, roll = 0): { at: Vec3; frame: Basis } {
  const lb = rollBasis(pitchBasis(basis, angle), roll);
  const p = at(o, basis, px, pivot[0], pivot[1], pivot[2]);
  return { at: add(p, scale(lb.u, -length * px)), frame: lb };
}

/** A box from p0 to p1 (its skin "h" runs along it), w across `side`, d across both (world units). */
export function rod(b: MeshBuilder, p0: Vec3, p1: Vec3, w: number, d: number, side: Vec3, uv: ReadonlyArray<TexRect | null>): void {
  const v = sub(p1, p0);
  const l = len(v) || 1e-6;
  const u = scale(v, 1 / l);
  let r = sub(side, scale(u, dot(side, u)));
  if (len(r) < 1e-4) r = Math.abs(u[1]) < 0.9 ? cross(u, [0, 1, 0]) : cross(u, [1, 0, 0]);
  r = normalize(r);
  const f = cross(u, r);
  b.box(add(p0, scale(v, 0.5)), scale(f, d / 2), scale(u, l / 2), scale(r, w / 2), uv);
}

/** The knee of a two-bone leg from hip to foot, bending toward `up`. */
export function knee(h: Vec3, f: Vec3, l1: number, l2: number, up: Vec3): Vec3 {
  const d = sub(f, h);
  const dl = Math.max(1e-4, len(d));
  const w = scale(d, 1 / dl);
  const D = Math.min(dl, (l1 + l2) * 0.999);
  const ca = clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1);
  const sa = Math.sqrt(1 - ca * ca);
  let v = sub(up, scale(w, dot(up, w)));
  if (len(v) < 1e-4) v = [0, 1, 0];
  v = normalize(v);
  return add(h, add(scale(w, ca * l1), scale(v, sa * l1)));
}

/** A rectangle of a skin sheet in model pixels, as a texture rect. */
export function sheetRect(skin: string, x: number, y: number, w: number, h: number): TexRect {
  const [ox, oy] = skinPx(skin);
  const k = SKIN_SCALE;
  return [(ox + x * k) / SKIN_W, (oy + y * k) / SKIN_H, (ox + (x + w) * k) / SKIN_W, (oy + (y + h) * k) / SKIN_H, -1];
}

/** Gives an overlay builder the creature's light and hit flash. */
export function litLike(m: MeshBuilder, b: MeshBuilder, a: Actor): void {
  m.sky = b.sky;
  m.blk = b.blk;
  m.flash = flashOf(a);
}

/** Puts an overlay builder back to its defaults. */
export function reset(m: MeshBuilder): void {
  m.flags = 0;
  m.alpha = 1;
  m.emit = 0;
  m.flash = 0;
  m.tint = [1, 1, 1];
}

// ================================================================== painting

export type O = [number, number];
export type Shade = (x: number, y: number) => RGB | null;
export type SideShade = (s: number, y: number, side: Side, x: number) => RGB | null;
export type Mat = (u: number, v: number) => RGB;

export { boxUV, type BoxUV, type Side };

/** Texel width of one side face. */
export const fw = (b: BoxUV, side: Side): number => (side === 'front' || side === 'back' ? b.w : b.d);

/** Paints all six faces of a box. */
export function box(a: Pix, b: BoxUV, sides: SideShade, top: Shade, bottom: Shade): void {
  paintSides(a, b, sides);
  paint(a, b.top, top);
  paint(a, b.bottom, bottom);
}

/** Noise material on a ramp: blotches of scale `sc`, contrast `amt`, fine grain. */
export function noiseMat(stops: readonly string[], seed: number, sc = 4, amt = 0.6, grainAmt = 0.12, bias = 0, sy = sc): Mat {
  return (u, v) => {
    const n = fbm2(u / sc, v / sy, seed);
    const t = 0.55 + bias + (n - 0.5) * amt * 1.6 + (hash2(u, v, seed + 3) - 0.5) * grainAmt;
    return ramp(stops, clamp(t, 0, 1));
  };
}

/** Fur: streaks along y plus tufts. */
export function furMat(stops: readonly string[], seed: number, bias = 0): Mat {
  return (u, v) => {
    const n = fbm2(u / 1.8, v / 4.5, seed);
    const m = fbm2(u / 6, v / 6, seed + 9);
    const tuft = hash2(u, (v + (u & 1)) >> 1, seed + 2);
    const t = 0.55 + bias + (n - 0.5) * 0.9 + (m - 0.5) * 0.5 + (tuft > 0.9 ? 0.12 : tuft < 0.08 ? -0.12 : 0);
    return ramp(stops, clamp(t, 0, 1));
  };
}

/** A box in one material, lit from above: bright top row, dark bottom row, rounded sides. */
export function solidBox(a: Pix, b: BoxUV, mat: Mat, off = 0, topK = 1.1, botK = 0.66): void {
  box(
    a,
    b,
    (s, y, side, x) => {
      let c = mat(s + off, y);
      if (y === 0) c = mulc(c, 1.08);
      else if (y === b.h - 1) c = mulc(c, 0.8);
      return mulc(c, round(x, fw(b, side)) * (side === 'back' ? 0.95 : 1));
    },
    (x, y) => mulc(mat(x + off + 500, y + 300), topK),
    (x, y) => mulc(mat(x + off + 700, y + 300), botK),
  );
}

export function mulc(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

/** Sets a texel of a sheet with some opacity (soft overlays read it as see-through). */
export function setA(a: Pix, x: number, y: number, c: RGB, alpha: number): void {
  a.set(x, y, c, Math.round(clamp(alpha, 0, 1) * 255));
}

/** Paints a rectangle (texels relative to a face) with colour and opacity. */
export function paintA(a: Pix, r: { x: number; y: number; w: number; h: number }, fn: (x: number, y: number) => [RGB, number] | null): void {
  for (let y = 0; y < r.h; y += 1) {
    for (let x = 0; x < r.w; x += 1) {
      const c = fn(x, y);
      if (c) setA(a, r.x + x, r.y + y, c[0], c[1]);
    }
  }
}

/** Paints a whole box with colour and opacity per texel (u, v unique per face). */
export function boxA(a: Pix, b: BoxUV, fn: (u: number, v: number, face: Side | 'top' | 'bottom', x: number) => [RGB, number] | null): void {
  const faces: [Side | 'top' | 'bottom', { x: number; y: number; w: number; h: number }, number][] = [
    ['right', b.right, 0],
    ['front', b.front, b.d],
    ['left', b.left, b.d + b.w],
    ['back', b.back, b.d * 2 + b.w],
    ['top', b.top, 400],
    ['bottom', b.bottom, 600],
  ];
  for (const [face, r, off] of faces) paintA(a, r, (x, y) => fn(off + x, y, face, x));
}

/** Sets texels' self-light over a face rectangle. */
export function glowRect(a: Pix, r: { x: number; y: number }, x: number, y: number, w: number, h: number, c: string | RGB, e = 1): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      a.set(r.x + xx, r.y + yy, c);
      a.E(r.x + xx, r.y + yy, e);
    }
  }
}

/** Glows every texel of a box a little (self-lit creatures). */
export function glowBox(a: Pix, b: BoxUV, e: number): void {
  for (const r of [b.top, b.bottom, b.right, b.front, b.left, b.back]) {
    for (let y = 0; y < r.h; y += 1) for (let x = 0; x < r.w; x += 1) if (a.alpha(r.x + x, r.y + y) === 255) a.E(r.x + x, r.y + y, e);
  }
}
