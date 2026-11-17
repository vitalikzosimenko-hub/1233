import { B, I, blockDef, itemDef } from './blocks';
import type { Actor } from './entities';
import { F_FLAT, F_OVERLAY, F_UNLIT, type MeshBuilder, type TexRect } from './gl';
import { normalize, type Vec3 } from './math3d';
import { DIR_FACE, lanternModel, subRect, tileRect, torchModel } from './mesher';
import { alphaMask, SKIN_H, SKIN_SCALE, SKIN_W, skinPx, TEX } from './textures';

export interface Basis {
  f: Vec3;
  u: Vec3;
  r: Vec3;
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossV(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export const WHITE: Vec3 = [1, 1, 1];

/** How strongly a creature flashes red: just struck (fading), or falling dead. */
export function flashOf(a: Actor): number {
  if (a.deathT >= 0) return 1;
  return a.hurt > 0 ? Math.min(1, a.hurt / 0.2) : 0;
}

/** A creature's frame: its facing, tipped over onto its side as it dies (Minecraft's death fall). */
export function bodyBasis(a: Actor): Basis {
  const basis = yawBasis(a.yaw);
  if (a.deathT < 0) return basis;
  const k = Math.min(1, a.deathT / 0.45);
  return rollBasis(basis, (Math.PI / 2) * Math.sqrt(k));
}

/** Minecraft box unwrap at (u, v) in model pixels for a w x h x d box, in box() face order. */
export function skinBox(skin: string, u: number, v: number, w: number, h: number, d: number): TexRect[] {
  const [ox, oy] = skinPx(skin);
  const k = SKIN_SCALE;
  const r = (x: number, y: number, rw: number, rh: number): TexRect => [(ox + x * k) / SKIN_W, (oy + y * k) / SKIN_H, (ox + (x + rw) * k) / SKIN_W, (oy + (y + rh) * k) / SKIN_H, -1];
  return [
    r(u + d, v + d, w, h), // front (+x)
    r(u + d + w + d, v + d, w, h), // back (-x)
    r(u + d, v, w, d), // top
    r(u + d + w, v, w, d), // bottom
    r(u, v + d, d, h), // right (+z)
    r(u + d + w, v + d, d, h), // left (-z)
  ];
}

export function yawBasis(yaw: number): Basis {
  return { f: [Math.cos(yaw), 0, Math.sin(yaw)], u: [0, 1, 0], r: [-Math.sin(yaw), 0, Math.cos(yaw)] };
}

/** Rotates a basis about its right axis (positive swings the up axis forward). */
export function pitchBasis(b: Basis, angle: number): Basis {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { f: add(scale(b.f, c), scale(b.u, -s)), u: add(scale(b.u, c), scale(b.f, s)), r: b.r };
}

/** Rotates a basis about its forward axis (positive tilts the up axis to the right). */
export function rollBasis(b: Basis, angle: number): Basis {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { f: b.f, u: add(scale(b.u, c), scale(b.r, s)), r: add(scale(b.r, c), scale(b.u, -s)) };
}

/**
 * Model-space box: (cx, cy, cz) offsets in pixels along forward/up/right from
 * the origin, sizes in pixels (w along right, h along up, d along forward).
 */
export function part(b: MeshBuilder, o: Vec3, basis: Basis, px: number, cx: number, cy: number, cz: number, w: number, h: number, d: number, uv: TexRect[]): void {
  const c = add(o, add(scale(basis.f, cx * px), add(scale(basis.u, cy * px), scale(basis.r, cz * px))));
  b.box(c, scale(basis.f, (d / 2) * px), scale(basis.u, (h / 2) * px), scale(basis.r, (w / 2) * px), uv);
}

/**
 * A limb hanging from a pivot (pixels), swung about the right axis and optionally rolled. `above`:
 * how far it reaches up past the pivot (an arm's top stands above its shoulder joint).
 */
export function limb(b: MeshBuilder, o: Vec3, basis: Basis, px: number, pivot: Vec3, angle: number, w: number, h: number, d: number, uv: TexRect[], roll = 0, above = 0): void {
  const lb = rollBasis(pitchBasis(basis, angle), roll);
  const p = add(o, add(scale(basis.f, pivot[0] * px), add(scale(basis.u, pivot[1] * px), scale(basis.r, pivot[2] * px))));
  const c = add(p, scale(lb.u, (above - h / 2) * px));
  b.box(c, scale(lb.f, (d / 2) * px), scale(lb.u, (h / 2) * px), scale(lb.r, (w / 2) * px), uv);
}

const uvCache = new Map<string, TexRect[]>();
export function uvs(skin: string, u: number, v: number, w: number, h: number, d: number): TexRect[] {
  const key = `${skin}:${u}:${v}:${w}:${h}:${d}`;
  let r = uvCache.get(key);
  if (!r) {
    r = skinBox(skin, u, v, w, h, d);
    uvCache.set(key, r);
  }
  return r;
}

/** Zombies and husks: arms held out, shambling legs. */
export function zombie(b: MeshBuilder, a: Actor, time: number, skin: 'zombie' | 'husk' = 'zombie'): void {
  const px = a.h / 32;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const moving = Math.hypot(a.vx, a.vz) > 0.2 && a.deathT < 0;
  const swing = moving ? Math.sin(a.walkPhase * Math.PI) * 0.7 : 0;
  limb(b, o, basis, px, [0, 12, -2], swing, 4, 12, 4, uvs(skin, 0, 16, 4, 12, 4));
  limb(b, o, basis, px, [0, 12, 2], -swing, 4, 12, 4, uvs(skin, 0, 16, 4, 12, 4));
  part(b, o, basis, px, 0, 18, 0, 8, 12, 4, uvs(skin, 16, 16, 8, 12, 4));
  // Arms reach forward; they rise as a blow winds up, and drop after it lands.
  const windup = a.windup > 0 ? (1 - a.windup / 0.32) * 0.75 : 0;
  const reach = -Math.PI / 2 + Math.sin(time * 3 + a.x) * 0.08 + (a.attackTimer > 0.7 ? -0.35 : 0) - windup;
  limb(b, o, basis, px, [0, 22, -6], reach, 4, 12, 4, uvs(skin, 40, 16, 4, 12, 4));
  limb(b, o, basis, px, [0, 22, 6], reach, 4, 12, 4, uvs(skin, 40, 16, 4, 12, 4));
  const head = pitchBasis(basis, Math.sin(time * 1.3 + a.z) * 0.08);
  part(b, o, head, px, 0, 28, 0, 8, 8, 8, uvs(skin, 0, 0, 8, 8, 8));
  b.flash = 0;
}

/** The skin of this device's own builder (the first-person arm): the captain's own, a co-op mate's ember red. */
let skinNow: 'builder' | 'builder2' = 'builder';

export function setMySkin(skin: 'builder' | 'builder2'): void {
  skinNow = skin;
}

/** This device's own builder's skin. */
export function mySkin(): 'builder' | 'builder2' {
  return skinNow;
}

/** Skins painted from a whole Minecraft sheet: left limbs of their own, and an outer layer (hat, jacket, sleeves, trousers). */
const FULL_SHEETS = new Set(['builder']);

/** A player's model pixel: 32 of them tall, 1.8 blocks. */
const PLAYER_PX = 1.8 / 32;

/**
 * A player's figure in Minecraft's proportions: legs swung from the hips, arms from the shoulders
 * (their tops level with the shoulders), the head on a frame of its own. A whole-sheet skin also
 * puts on its outer layer, a size up all round, on `cut` (where its clear pixels are cut away).
 */
function figure(b: MeshBuilder, cut: MeshBuilder | null, skin: string, o: Vec3, basis: Basis, head: Basis, legR: number, legL: number, armR: number, armL: number, rollR = 0, rollL = 0): void {
  const px = PLAYER_PX;
  const full = FULL_SHEETS.has(skin);
  limb(b, o, basis, px, [0, 12, 2], legR, 4, 12, 4, uvs(skin, 0, 16, 4, 12, 4));
  limb(b, o, basis, px, [0, 12, -2], legL, 4, 12, 4, full ? uvs(skin, 16, 48, 4, 12, 4) : uvs(skin, 0, 16, 4, 12, 4));
  part(b, o, basis, px, 0, 18, 0, 8, 12, 4, uvs(skin, 16, 16, 8, 12, 4));
  limb(b, o, basis, px, [0, 22, 6], armR, 4, 12, 4, uvs(skin, 40, 16, 4, 12, 4), rollR, 2);
  limb(b, o, basis, px, [0, 22, -6], armL, 4, 12, 4, full ? uvs(skin, 32, 48, 4, 12, 4) : uvs(skin, 40, 16, 4, 12, 4), rollL, 2);
  // (The head turns about the neck.)
  const neck = add(o, scale(basis.u, 24 * px));
  part(b, neck, head, px, 0, 4, 0, 8, 8, 8, uvs(skin, 0, 0, 8, 8, 8));
  if (!full || !cut) return;
  cut.sky = b.sky;
  cut.blk = b.blk;
  cut.flash = b.flash;
  limb(cut, o, basis, px, [0, 12.25, 2], legR, 4.5, 12.5, 4.5, uvs(skin, 0, 32, 4, 12, 4));
  limb(cut, o, basis, px, [0, 12.25, -2], legL, 4.5, 12.5, 4.5, uvs(skin, 0, 48, 4, 12, 4));
  part(cut, o, basis, px, 0, 18, 0, 8.5, 12.5, 4.5, uvs(skin, 16, 32, 8, 12, 4));
  limb(cut, o, basis, px, [0, 22, 6], armR, 4.5, 12.5, 4.5, uvs(skin, 40, 32, 4, 12, 4), rollR, 2.25);
  limb(cut, o, basis, px, [0, 22, -6], armL, 4.5, 12.5, 4.5, uvs(skin, 48, 48, 4, 12, 4), rollL, 2.25);
  part(cut, neck, head, px, 0, 4, 0, 9, 9, 9, uvs(skin, 32, 0, 8, 8, 8));
  cut.flash = 0;
}

/** You, seen from the commander's view at the helm: both hands on the wheel. */
export function pilot(b: MeshBuilder, x: number, y: number, z: number, yaw: number, time: number, turn: number, skin: string = skinNow, cut: MeshBuilder | null = null): void {
  const basis = yawBasis(yaw);
  // Hands on the spokes: one arm rises as the wheel turns.
  const reach = -Math.PI / 2 + 0.55;
  figure(b, cut, skin, [x, y, z], basis, basis, 0, 0, reach - turn * 0.5 + Math.sin(time * 2 + 1) * 0.03, reach + turn * 0.5 + Math.sin(time * 2) * 0.03);
}

/** How a crewmate's avatar is posed. */
export interface MateView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  walkPhase: number;
  /** Moving along the ground (blocks/s). */
  speed: number;
  /** 0..1 through an arm swing (a blow, a dig). */
  swing: number;
  skin: string;
  pose: 'stand' | 'helm' | 'guns' | 'climb' | 'down' | 'swim';
  turn: number;
  hen: boolean;
  hurt: number;
  item: number | null;
  /** Your own figure: the arms held out along the aim (a crossbow, the grapple) or up on a parachute's toggles. */
  arms?: 'aim' | 'chute';
  /** Your own figure: the picture in hand when it is not the item's own (the pickaxe with nothing else in hand, the sword's tier). */
  icon?: string;
}

/** A tool in the fist: its rise above the arm's line, and how far it turns its face from the side toward behind (where your own view sees it from). */
const TOOL_RISE = 0.5;
const TOOL_TURN = 0.95;

/**
 * Your co-op crewmate as you see them (and you, in the third-person view): walking with swinging
 * arms, a blow chopping down, hands on the wheel at the helm, sighting along an arm on the guns,
 * hand over hand on a ladder, a hen hugged to the chest, or knocked flat. Outer layers and what is
 * in hand go on `cut`.
 */
export function mate(b: MeshBuilder, m: MateView, time: number, cut: MeshBuilder | null = null): void {
  if (m.pose === 'helm') {
    pilot(b, m.x, m.y, m.z, m.yaw, time, m.turn, m.skin, cut);
    return;
  }
  const px = PLAYER_PX;
  const o: Vec3 = [m.x, m.y, m.z];
  let basis = yawBasis(m.yaw);
  if (m.pose === 'down') basis = rollBasis(basis, Math.PI / 2);
  if (m.pose === 'swim') basis = pitchBasis(basis, 1.1);
  b.flash = m.hurt > 0 ? Math.min(1, m.hurt / 0.2) : 0;
  const moving = m.speed > 0.4 && m.pose !== 'down';
  const stride = moving ? Math.sin(m.walkPhase * Math.PI) * Math.min(0.75, 0.25 + m.speed * 0.1) : 0;
  const climb = m.pose === 'climb' ? Math.sin(time * 9) * 0.5 : 0;
  const chop = m.swing > 0 ? Math.sin(Math.min(1, m.swing) * Math.PI) : 0;
  // (Each arm swings against the leg on its side.)
  let right = stride * 0.8;
  let left = -stride * 0.8;
  const aim = m.pose === 'guns' || m.arms === 'aim';
  if (m.pose === 'climb') {
    right = -Math.PI + 0.3 + climb;
    left = -Math.PI + 0.3 - climb;
  } else if (aim) {
    // Sighting along the right arm, the left steadying the gun.
    right = -Math.PI / 2 - m.pitch;
    left = -Math.PI / 2 + 0.4 - m.pitch * 0.5;
  } else if (m.hen) {
    right = -1.05;
    left = -1.05;
  } else if (m.arms === 'chute') {
    // Both hands up on the toggles.
    right = -Math.PI + 0.45;
    left = -Math.PI + 0.45;
  } else if (chop > 0) right = -1.9 * chop - 0.4;
  const rollR = aim ? -0.1 : 0;
  // The head looks where they look.
  const hb = pitchBasis(basis, m.pose === 'down' || m.pose === 'swim' ? 0 : Math.max(-0.7, Math.min(0.7, -m.pitch)));
  figure(b, cut, m.skin, o, basis, hb, -stride - climb * 0.5, stride + climb * 0.5, right, left, rollR, m.hen ? 0.35 : 0);
  b.flash = 0;
  // A hen hugged to the chest.
  if (m.hen && m.pose !== 'down') {
    const c = add(o, add(scale(basis.f, 0.38), scale(basis.u, 1.12)));
    henModel(b, c, yawBasis(m.yaw), 0.026, time, 0, Math.sin(time * 9) > 0.6 ? 1 : 0, 0, 0.9);
  }
  // What is in the right hand: a block as a small cube, anything else as its picture.
  if ((m.item !== null || m.icon) && !m.hen && m.arms !== 'chute' && m.pose !== 'climb' && m.pose !== 'down') {
    const def = m.item === null ? null : itemDef(m.item);
    const ab = rollBasis(pitchBasis(basis, right), rollR);
    const hand = add(o, add(add(scale(basis.u, 22 * px), scale(basis.r, 6 * px)), scale(ab.u, -9 * px)));
    if (def && def.place !== null && blockDef(def.place).shape === 'cube') {
      const k = 0.13;
      b.box(add(hand, scale(ab.f, 0.12)), scale(ab.f, k), scale(ab.u, k), scale(ab.r, k), blockFaces(def.place));
    } else if (cut) {
      // Handle in the fist, the head out ahead and a little up; its face turned from the side
      // toward behind, so a view from over the shoulder sees its shape.
      const along = normalize(add(scale(ab.f, Math.cos(TOOL_RISE)), scale(ab.u, Math.sin(TOOL_RISE))));
      const across = normalize(sub(ab.u, scale(along, ab.u[0] * along[0] + ab.u[1] * along[1] + ab.u[2] * along[2])));
      const flat = crossV(along, across);
      const w = sub(scale(across, Math.cos(TOOL_TURN)), scale(flat, Math.sin(TOOL_TURN)));
      const size = (m.item === null || TOOLS.has(m.item) ? 12 : 9) * px;
      const x = scale(normalize(sub(along, w)), size);
      const y = scale(normalize(add(along, w)), size);
      cut.sky = b.sky;
      cut.blk = b.blk;
      sprite(cut, m.icon ?? def!.icon, { x, y, z: scale(normalize(crossV(x, y)), size), t: add(hand, scale(add(x, y), 0.32)) });
    } else {
      b.tint = [0.55, 0.42, 0.3];
      b.box(add(hand, add(scale(ab.f, 0.2), scale(ab.u, -0.05))), scale(ab.f, 0.2), scale(ab.u, 0.03), scale(ab.r, 0.03), [tileRect('white')]);
      b.tint = WHITE;
    }
  }
}

/** A box whose long (skin "w") axis runs along dir from a pivot: spider legs, wing spars. */
export function spar(b: MeshBuilder, pivot: Vec3, dir: Vec3, up: Vec3, px: number, w: number, h: number, d: number, uv: TexRect[]): void {
  const r = normalize(dir);
  // Square up the given up vector against the spar, then complete a right-handed frame.
  const dot = up[0] * r[0] + up[1] * r[1] + up[2] * r[2];
  const u = normalize([up[0] - r[0] * dot, up[1] - r[1] * dot, up[2] - r[2] * dot]);
  const f = crossV(u, r);
  const c = add(pivot, scale(r, (w / 2) * px));
  b.box(c, scale(f, (d / 2) * px), scale(u, (h / 2) * px), scale(r, (w / 2) * px), uv);
}

/** Spiders: a low furry body on eight splayed legs that step in alternation. */
export function spider(b: MeshBuilder, a: Actor, time: number): void {
  const px = 0.95 / 16;
  const o: Vec3 = [a.x, a.y, a.z];
  let basis = bodyBasis(a);
  // Clinging to a leg: nose up the strut.
  if (a.climb) basis = pitchBasis(basis, -1.1);
  b.flash = flashOf(a);
  const moving = (Math.hypot(a.vx, a.vz) > 0.2 || a.climb !== null) && a.deathT < 0;
  const ph = a.walkPhase * Math.PI * 1.6 + time * (moving ? 0 : 0.5);
  part(b, o, basis, px, -9, 9, 0, 10, 8, 12, uvs('spider', 0, 16, 10, 8, 12));
  part(b, o, basis, px, 0, 9, 0, 6, 6, 6, uvs('spider', 32, 0, 6, 6, 6));
  part(b, o, basis, px, 7, 9, 0, 8, 8, 8, uvs('spider', 0, 0, 8, 8, 8));
  const legUv = uvs('spider', 0, 40, 16, 2, 2);
  for (let i = 0; i < 4; i += 1) {
    for (const side of [-1, 1]) {
      const step = moving ? Math.sin(ph + i * 1.7 + (side > 0 ? Math.PI : 0)) : 0;
      const theta = Math.PI / 2 - (i - 1.5) * 0.5 + step * 0.22;
      const dip = 0.42 - Math.max(0, step) * 0.3;
      const hx = Math.cos(theta);
      const hz = Math.sin(theta) * side;
      const dir = add(add(scale(basis.f, hx * Math.cos(dip)), scale(basis.r, hz * Math.cos(dip))), scale(basis.u, -Math.sin(dip)));
      const pivot = add(o, add(add(scale(basis.f, (1.5 - i) * 1.4 * px), scale(basis.u, 9 * px)), scale(basis.r, side * 3 * px)));
      spar(b, pivot, dir, basis.u, px, 16, 2, 2, legUv);
    }
  }
  b.flash = 0;
}

/** Phantoms: a skeletal flier on two-jointed wings, diving nose-first. */
export function phantom(b: MeshBuilder, a: Actor, time: number): void {
  const px = 1.5 / 16;
  const o: Vec3 = [a.x, a.y + 0.3, a.z];
  let basis = bodyBasis(a);
  const climb = Math.atan2(a.vy, Math.hypot(a.vx, a.vz) || 1);
  basis = pitchBasis(basis, -clampN(climb, -0.9, 0.6));
  b.flash = flashOf(a);
  part(b, o, basis, px, 0, 0, 0, 5, 3, 9, uvs('phantom', 0, 0, 5, 3, 9));
  part(b, o, basis, px, 7, 0.5, 0, 7, 3, 5, uvs('phantom', 0, 12, 7, 3, 5));
  const tail = pitchBasis(basis, Math.sin(time * 3 + a.x) * 0.2);
  part(b, o, tail, px, -7.5, 0, 0, 3, 2, 6, uvs('phantom', 32, 0, 3, 2, 6));
  const flap = Math.sin(a.walkPhase) * 0.55;
  for (const side of [-1, 1]) {
    // Inner wing from the shoulder, then the tip folding a little further on each beat.
    const out = add(scale(basis.r, side * Math.cos(flap)), scale(basis.u, Math.sin(flap)));
    const shoulder = add(o, scale(basis.r, side * 2.5 * px));
    spar(b, shoulder, out, basis.u, px, 6, 2, 9, uvs('phantom', 0, 24, 6, 2, 9));
    const tipFlap = flap * 1.6;
    const outTip = add(scale(basis.r, side * Math.cos(tipFlap)), scale(basis.u, Math.sin(tipFlap)));
    spar(b, add(shoulder, scale(out, 6 * px)), outTip, basis.u, px, 13, 1, 9, uvs('phantom', 0, 36, 13, 1, 9));
  }
  b.flash = 0;
}

function clampN(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Skeleton archers: thin bone limbs, a bow held out. */
export function skeleton(b: MeshBuilder, a: Actor, time: number): void {
  const px = a.h / 32;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const moving = Math.hypot(a.vx, a.vz) > 0.2 && a.deathT < 0;
  const swing = moving ? Math.sin(a.walkPhase * Math.PI) * 0.6 : 0;
  limb(b, o, basis, px, [0, 12, -2], swing, 2, 12, 2, uvs('skeleton', 0, 16, 2, 12, 2));
  limb(b, o, basis, px, [0, 12, 2], -swing, 2, 12, 2, uvs('skeleton', 0, 16, 2, 12, 2));
  part(b, o, basis, px, 0, 18, 0, 8, 12, 4, uvs('skeleton', 16, 16, 8, 12, 4));
  const aim = -Math.PI / 2 + Math.sin(time * 2 + a.x) * 0.04;
  limb(b, o, basis, px, [0, 22, -5], aim, 2, 12, 2, uvs('skeleton', 40, 16, 2, 12, 2), -0.25);
  limb(b, o, basis, px, [0, 22, 5], aim + 0.2, 2, 12, 2, uvs('skeleton', 40, 16, 2, 12, 2), 0.35);
  part(b, o, basis, px, 0, 28, 0, 8, 8, 8, uvs('skeleton', 0, 0, 8, 8, 8));
  // Bow: a bent stick in the left hand.
  const wood = [tileRect('planks_spruce')];
  const hand = add(o, add(scale(basis.f, 12 * px), add(scale(basis.u, 22 * px), scale(basis.r, -5 * px))));
  for (const [dy, k] of [[-5, -0.25], [0, 0], [5, 0.25]] as const) {
    const c = add(hand, add(scale(basis.u, dy * px), scale(basis.f, -Math.abs(dy) * 0.3 * px)));
    b.box(c, scale(basis.f, 0.6 * px), scale(normalize(add(basis.u, scale(basis.f, k))), 3 * px), scale(basis.r, 0.6 * px), wood);
  }
  b.flash = 0;
}

export function creeper(b: MeshBuilder, a: Actor, time: number): void {
  const flashing = a.fuse > 0 && Math.floor(time * 9) % 2 === 0;
  const swell = 1 + (a.fuse > 0 ? (a.fuse / 1.5) * 0.22 : 0);
  const px = (a.h / 26) * swell;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  // A golden creeper glints as it runs.
  const skin = a.golden > 0 ? 'goldcreeper' : 'creeper';
  b.flash = flashOf(a);
  if (flashing) b.emit = 0.6;
  else if (a.golden > 0) b.emit = 0.18 + Math.max(0, Math.sin(time * 5 + a.x)) * 0.25;
  const moving = Math.hypot(a.vx, a.vz) > 0.2 && a.deathT < 0;
  const step = moving ? Math.sin(a.walkPhase * Math.PI) * (a.golden > 0 ? 0.8 : 0.5) : 0;
  const leg = uvs(skin, 0, 16, 4, 6, 4);
  for (const [fx, fz, s] of [[2, -2, 1], [2, 2, -1], [-2, -2, -1], [-2, 2, 1]] as const) limb(b, o, basis, px, [fx, 6, fz], step * s, 4, 6, 4, leg);
  part(b, o, basis, px, 0, 12, 0, 8, 12, 4, uvs(skin, 16, 16, 8, 12, 4));
  part(b, o, basis, px, 0, 22, 0, 8, 8, 8, uvs(skin, 0, 0, 8, 8, 8));
  b.flash = 0;
  b.emit = 0;
}

/** Pip, the smith's wolf: a fluffy body, a collar, a wagging tail; it sits when told to rest. */
export function wolf(b: MeshBuilder, a: Actor, time: number, sitting: boolean, wag: number, happy: number, howl = 0): void {
  const px = 0.9 / 16;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = yawBasis(a.yaw);
  b.flash = flashOf(a);
  const moving = Math.hypot(a.vx, a.vz) > 0.3 && !sitting;
  const run = Math.min(1, Math.hypot(a.vx, a.vz) / 4);
  const swing = moving ? Math.sin(a.walkPhase * Math.PI * 1.4) * (0.5 + run * 0.4) : 0;
  const leg = uvs('wolf', 0, 20, 2, 7, 2);
  // Body pitched up when sitting (haunches down, chest up).
  const body = sitting ? pitchBasis(basis, -0.55) : basis;
  const lift = sitting ? -2 : 0;
  if (sitting) {
    limb(b, o, basis, px, [3.2, 7, -1.6], 0.15, 2, 7, 2, leg);
    limb(b, o, basis, px, [3.2, 7, 1.6], 0.15, 2, 7, 2, leg);
    limb(b, o, basis, px, [-2.6, 3, -1.8], -1.45, 2, 7, 2, leg);
    limb(b, o, basis, px, [-2.6, 3, 1.8], -1.45, 2, 7, 2, leg);
  } else {
    limb(b, o, basis, px, [3.5, 7, -1.6], swing, 2, 7, 2, leg);
    limb(b, o, basis, px, [3.5, 7, 1.6], -swing, 2, 7, 2, leg);
    limb(b, o, basis, px, [-3.5, 7, -1.6], -swing, 2, 7, 2, leg);
    limb(b, o, basis, px, [-3.5, 7, 1.6], swing, 2, 7, 2, leg);
  }
  const bo: Vec3 = add(o, scale(basis.u, lift * px));
  part(b, bo, body, px, -1, 9.5, 0, 6, 6, 10, uvs('wolf', 24, 0, 6, 6, 10));
  part(b, bo, body, px, 3.2, 10, 0, 8, 7, 6, uvs('wolf', 24, 18, 8, 7, 6));
  // Head: tilts with curiosity, bobs as it trots; snout and ears. Howling, it points at the moon.
  const tilt = Math.sin(time * 1.7 + a.x) * 0.12 * (1 - howl) + happy * 0.2 * (1 - howl);
  const nod = moving ? Math.sin(a.walkPhase * Math.PI * 1.4) * 0.06 : -0.05;
  const head = rollBasis(pitchBasis(basis, nod - howl * (1.05 + Math.sin(time * 9) * 0.04)), tilt);
  const ho: Vec3 = add(o, scale(basis.u, (sitting ? 2.5 : 0) * px));
  part(b, ho, head, px, 7.5, 11, 0, 6, 6, 5, uvs('wolf', 0, 0, 6, 6, 5));
  part(b, ho, head, px, 11, 9.8, 0, 3, 3, 3, uvs('wolf', 0, 12, 3, 3, 3));
  part(b, ho, head, px, 7.5, 15, -2, 2, 2, 1, uvs('wolf', 14, 12, 2, 2, 1));
  part(b, ho, head, px, 7.5, 15, 2, 2, 2, 1, uvs('wolf', 14, 12, 2, 2, 1));
  // Tail: up and wagging (fast when happy).
  const tail = rollBasis(pitchBasis(basis, -0.9 - (sitting ? 0.6 : 0)), Math.sin(time * (8 + happy * 10)) * wag);
  limb(b, bo, tail, px, [-6, 11, 0], Math.PI, 2, 8, 2, uvs('wolf', 10, 20, 2, 8, 2));
  b.flash = 0;
}

/**
 * A hen in any frame: o is the point between its feet, the basis its facing. `peck` (0..1) dips
 * the head to the ground, `flap` (0..1) beats the wings, `walk` swings the legs.
 */
function henModel(b: MeshBuilder, o: Vec3, basis: Basis, px: number, time: number, peck: number, flap: number, walk: number, tuck = 0): void {
  const leg = uvs('chicken', 42, 9, 1, 5, 1);
  const foot = uvs('chicken', 46, 9, 3, 1, 3);
  for (const side of [-1, 1]) {
    const swing = Math.sin(walk * Math.PI) * 0.7 * side + tuck * 0.8;
    limb(b, o, basis, px, [0, 5, side * 1.5], swing, 1, 5, 1, leg);
    // The foot follows the leg's swing.
    const fb = pitchBasis(basis, swing);
    const ankle = add(o, add(scale(basis.u, 5 * px), add(scale(fb.u, -4.6 * px), scale(basis.r, side * 1.5 * px))));
    part(b, ankle, fb, px, 0.8, 0, 0, 3, 1, 3, foot);
  }
  part(b, o, basis, px, 0, 8, 0, 6, 6, 8, uvs('chicken', 0, 9, 6, 6, 8));
  const tail = pitchBasis(basis, -0.45);
  part(b, add(o, add(scale(basis.f, -4 * px), scale(basis.u, 10 * px))), tail, px, -0.3, 1.4, 0, 4, 4, 1, uvs('chicken', 10, 23, 4, 4, 1));
  // Wings at the sides: folded, or beating out and up.
  const beat = flap > 0 ? (0.25 + 0.75 * Math.abs(Math.sin(time * 26))) * flap : 0;
  for (const side of [-1, 1]) limb(b, o, basis, px, [0, 10.6, side * 3.5], 0, 1, 4, 6, uvs('chicken', 28, 9, 1, 4, 6), -side * (0.08 + beat * 1.25));
  // Head on its neck: bobbing as it walks, dipping to peck.
  const neck = add(o, add(scale(basis.f, 3 * px), scale(basis.u, 10 * px)));
  const nod = Math.sin(walk * Math.PI * 2) * 0.12 + peck * 1.05 + Math.sin(time * 1.9 + o[0]) * 0.05 * (1 - peck);
  const hb = pitchBasis(basis, nod);
  part(b, neck, hb, px, 0.5, 3, 0, 4, 6, 3, uvs('chicken', 0, 0, 4, 6, 3));
  part(b, neck, hb, px, 3, 2.6, 0, 4, 2, 2, uvs('chicken', 14, 0, 4, 2, 2));
  part(b, neck, hb, px, 2.5, 0.9, 0, 2, 2, 2, uvs('chicken', 14, 4, 2, 2, 2));
  part(b, neck, hb, px, 0.9, 6.8, 0, 2, 2, 3, uvs('chicken', 0, 23, 2, 2, 3));
}

const HEN_PX = 0.045;

/** A village hen: pecking about, flapping when it falls or panics. */
export function chicken(b: MeshBuilder, a: Actor, time: number): void {
  b.flash = flashOf(a);
  const moving = Math.hypot(a.vx, a.vz) > 0.15;
  const flap = !a.onGround ? 1 : a.panic > 0 ? 0.55 : Math.max(0, Math.min(1, a.flap));
  // A peck is a quick dip and back up.
  const peck = a.munch > 0 && !moving ? Math.max(0, Math.sin(Math.min(1, a.munch / 0.35) * Math.PI)) : 0;
  henModel(b, [a.x, a.y, a.z], yawBasis(a.yaw), HEN_PX, time, peck, flap, moving ? a.walkPhase * 2.2 : 0, a.onGround ? 0 : 0.6);
  b.flash = 0;
}

/** Wool colours: white, light grey, brown, black and the rare pink. */
export const WOOL_TINTS: ReadonlyArray<Vec3> = [[1, 1, 1], [0.64, 0.64, 0.68], [0.6, 0.42, 0.28], [0.24, 0.22, 0.24], [1, 0.55, 0.74]];

/** A sheep: grazing, wandering, its fleece (tinted to its colour) gone when shorn. */
export function sheep(b: MeshBuilder, a: Actor, time: number, tint: Vec3): void {
  const px = 1 / 16;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = yawBasis(a.yaw);
  b.flash = flashOf(a);
  const moving = Math.hypot(a.vx, a.vz) > 0.15;
  const swing = moving ? Math.sin(a.walkPhase * Math.PI) * (a.panic > 0 ? 0.9 : 0.55) : 0;
  const woolly = a.wool >= 1;
  const leg = uvs('sheep', 48, 14, 4, 12, 4);
  const furLeg = uvs('sheep', 48, 30, 4, 6, 4);
  for (const [fx, fz, s] of [[5, -3, 1], [5, 3, -1], [-5, -3, -1], [-5, 3, 1]] as const) {
    limb(b, o, basis, px, [fx, 12, fz], swing * s, 4, 12, 4, leg);
    if (woolly) {
      b.tint = tint;
      limb(b, o, basis, px, [fx, 12.5, fz], swing * s, 5, 7, 5, furLeg);
      b.tint = WHITE;
    }
  }
  part(b, o, basis, px, 0, 15, 0, 8, 6, 16, uvs('sheep', 0, 14, 8, 6, 16));
  if (woolly) {
    b.tint = tint;
    part(b, o, basis, px, 0, 15.4, 0, 11.5, 9.5, 19.5, uvs('sheep', 0, 36, 8, 6, 16));
    b.tint = WHITE;
  }
  // Grazing: the head goes down to the grass and the jaw works.
  const graze = a.panic > 0 ? 0 : a.head;
  const neck = add(o, add(scale(basis.f, 7 * px), scale(basis.u, 17 * px)));
  const hb = pitchBasis(basis, graze * (0.95 + Math.sin(time * 9) * 0.06) + Math.sin(time * 1.3 + a.x) * 0.05);
  part(b, neck, hb, px, 3, 1, 0, 6, 6, 8, uvs('sheep', 0, 0, 6, 6, 8));
  if (woolly) {
    b.tint = tint;
    part(b, neck, hb, px, 1.6, 1.2, 0, 7.2, 7.2, 7.2, uvs('sheep', 28, 0, 6, 6, 6));
    b.tint = WHITE;
  }
  b.flash = 0;
}

/** A forearm in view space (first person), the box's own axes given: on a whole-sheet skin, its sleeve over it. */
function forearm(b: MeshBuilder, c: Vec3, face: Vec3, along: Vec3, side: Vec3): void {
  b.box(c, face, along, side, skinBox(skinNow, 40, 16, 4, 12, 4));
  if (FULL_SHEETS.has(skinNow)) b.box(c, scale(face, 4.5 / 4), scale(along, 12.5 / 12), scale(side, 4.5 / 4), skinBox(skinNow, 40, 32, 4, 12, 4));
}

/**
 * The hen in your arms, in view space (camera looks down -z): held up in front of you in both
 * hands, flapping hard while you glide. `lift` raises her (portrait screens hide more below).
 */
export function heldHen(b: MeshBuilder, flap: number, time: number, equip: number, bobX: number, bobY: number, lift = 0): void {
  const drop = equip * 0.45;
  const o: Vec3 = [-0.06 + bobX, -0.37 + lift + bobY - drop + (flap > 0 ? Math.sin(time * 26) * 0.006 : 0), -0.62];
  // Facing left and a little away, so you see its side and its face.
  const basis = yawBasis(-2.35);
  henModel(b, o, basis, 0.0152, time, 0, flap, 0, 0.9);
  // Both forearms reach up from below to hold it.
  for (const side of [-1, 1]) {
    const elbow: Vec3 = [o[0] + side * 0.36, -0.84 + bobY - drop, -0.44];
    const hand: Vec3 = [o[0] + side * 0.1, o[1] + 0.02, o[2] + 0.03];
    const v: Vec3 = [hand[0] - elbow[0], hand[1] - elbow[1], hand[2] - elbow[2]];
    const len = Math.hypot(v[0], v[1], v[2]);
    const dir = normalize(v);
    const s = normalize(crossV(dir, [0, 1, 0]));
    const face = normalize(crossV(s, dir));
    forearm(b, add(elbow, scale(v, 0.5)), scale(face, 0.07), scale(dir, -len / 2), scale(s, 0.07));
  }
}

/** A supply crate coming down under a red-and-white canopy (strings to its corners). */
export function parachuteCrate(b: MeshBuilder, x: number, y: number, z: number, sway: number, fold: number, landed: boolean): void {
  const tilt = Math.sin(sway * 1.3) * 0.12;
  const c: Vec3 = [x, y + 0.45, z];
  if (fold < 1) {
    const top: Vec3 = [x + Math.sin(sway * 1.3) * 0.5, y + 3.4 - fold * 2.6, z + Math.cos(sway * 1.1) * 0.3];
    const ring = (r: number, h: number, i: number): Vec3 => {
      const a = (i / 8) * Math.PI * 2;
      return [top[0] + Math.cos(a) * r, top[1] - h + Math.sin(a) * tilt * r, top[2] + Math.sin(a) * r];
    };
    const r0 = 1.9 * (1 - fold * 0.5);
    b.flags = F_FLAT;
    for (let i = 0; i < 8; i += 1) {
      b.tint = i % 2 === 0 ? [0.86, 0.16, 0.12] : [0.95, 0.93, 0.88];
      const a0 = ring(r0, 0.9, i);
      const a1 = ring(r0, 0.9, i + 1);
      const m0 = ring(r0 * 0.62, 0.25, i);
      const m1 = ring(r0 * 0.62, 0.25, i + 1);
      const quadOf = (p: Vec3, q: Vec3, s2: Vec3, t: Vec3): void => {
        // Both faces (the canopy is seen from below and above).
        const n = normalize(crossV(sub(q, p), sub(t, p)));
        b.quad([...p, ...q, ...s2, ...t], tileRect('white'), n[0], n[1], n[2]);
        b.quad([...t, ...s2, ...q, ...p], tileRect('white'), -n[0], -n[1], -n[2]);
      };
      quadOf(a0, m0, m1, a1);
      quadOf(m0, top, top, m1);
    }
    // Strings.
    b.tint = [0.85, 0.82, 0.75];
    for (let i = 0; i < 8; i += 2) {
      const rim = ring(r0, 0.9, i);
      const corner: Vec3 = [c[0] + (i < 4 ? 0.42 : -0.42), c[1] + 0.42, c[2] + (i % 4 === 0 ? 0.42 : -0.42)];
      beam(b, rim, corner, 0.018, [tileRect('white')]);
    }
    b.flags = 0;
    b.tint = WHITE;
  }
  // Once down, the chest in the world is the crate.
  if (!landed) blockCube(b, B.CHEST, c, 0.45, tilt * 2, tilt);
}

const GORES = 10;

/** A quad seen from both sides (canopy cloth). */
function cloth(b: MeshBuilder, p: Vec3, q: Vec3, s: Vec3, t: Vec3): void {
  const n = normalize(crossV(sub(q, p), sub(t, p)));
  b.quad([...p, ...q, ...s, ...t], tileRect('white'), n[0], n[1], n[2]);
  b.quad([...t, ...s, ...q, ...p], tileRect('white'), -n[0], -n[1], -n[2]);
}

/**
 * A parachute: a red-and-white canopy flying over its jumper (filling out as it opens, banking
 * into the steering), its lines running down to the shoulders (seen from your own eyes they
 * gather above your head, where your risers take over). `fold` lays a landed one down behind
 * the spot (out of its jumper's view), collapsing, before it is packed away.
 */
export function chuteCanopy(b: MeshBuilder, x: number, y: number, z: number, yaw: number, open: number, fold: number, lean: number, time: number, own = false): void {
  const e = open * open * (3 - 2 * open);
  const k = fold * fold * (3 - 2 * fold);
  const basis = yawBasis(yaw);
  const sway = Math.sin(time * 1.7) * 0.16 * e * (1 - k);
  // Close over your head (its leading edge shows at the top of the view), a little ahead; once
  // down it swings back faster than it sinks, so it never drapes across your eyes.
  const height = (1.45 + 0.9 + 1.6 * e) * (1 - k) + 0.4 * k;
  const ahead = 0.9 * e - 3 * (1 - (1 - fold) * (1 - fold));
  const side = lean * 6 + sway;
  const top: Vec3 = [x + basis.f[0] * ahead + basis.r[0] * side, y + height, z + basis.f[2] * ahead + basis.r[2] * side];
  const R = (0.5 + 1.8 * e) * (1 - 0.45 * k);
  const drop = (0.35 + 0.6 * e) * (1 - 0.6 * k);
  const bank = lean * 3;
  const ring = (r: number, h: number, i: number): Vec3 => {
    const a = (i / GORES) * Math.PI * 2;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    return [top[0] + basis.f[0] * c + basis.r[0] * s, top[1] - h - s * bank, top[2] + basis.f[2] * c + basis.r[2] * s];
  };
  b.flags = F_FLAT;
  for (let i = 0; i < GORES; i += 1) {
    b.tint = i % 2 === 0 ? [0.74, 0.07, 0.05] : [0.92, 0.9, 0.84];
    const a0 = ring(R, drop, i);
    const a1 = ring(R, drop, i + 1);
    const m0 = ring(R * 0.62, drop * 0.3, i);
    const m1 = ring(R * 0.62, drop * 0.3, i + 1);
    cloth(b, a0, m0, m1, a1);
    cloth(b, m0, top, top, m1);
  }
  // Lines to the shoulders (slack and gone once it folds).
  if (k < 0.55) {
    b.tint = [0.85, 0.82, 0.75];
    const gather = own ? y + 2.75 : y + 1.42;
    for (let i = 0; i < GORES; i += 2) {
      const rim = ring(R, drop, i);
      const s = Math.sin((i / GORES) * Math.PI * 2) >= 0 ? 0.22 : -0.22;
      beam(b, rim, [x + basis.r[0] * s, gather, z + basis.r[2] * s], 0.014, [tileRect('white')]);
    }
  }
  b.flags = 0;
  b.tint = WHITE;
}

/**
 * First person under the canopy: both hands up on the steering toggles at the sides of the view
 * (the one on the side you steer to pulled down), the risers running up out of sight. `equip`
 * lowers them as they come up; on wide screens they sit lower and further out (`aspect`).
 */
export function heldChute(b: MeshBuilder, steer: number, time: number, equip: number, aspect: number): void {
  const drop = equip * 0.7;
  const wide = Math.min(1, Math.max(0, (aspect - 0.5) / 0.8));
  for (const side of [-1, 1]) {
    const pull = Math.max(0, steer * side) * 0.14;
    const hand: Vec3 = [side * (0.32 + 0.1 * wide), 0.1 - 0.28 * wide - pull - drop + Math.sin(time * 1.7 + side) * 0.01, -0.6];
    const elbow: Vec3 = [side * (0.64 + 0.04 * wide), -0.82 - 0.12 * wide - drop, -0.36];
    const v = sub(hand, elbow);
    const len = Math.hypot(v[0], v[1], v[2]);
    const dir = normalize(v);
    const s = normalize(crossV(dir, [0, 1, 0]));
    const face = normalize(crossV(s, dir));
    forearm(b, add(elbow, scale(v, 0.5)), scale(face, 0.068), scale(dir, -len / 2), scale(s, 0.068));
    b.flags = F_FLAT;
    // The toggle in your fist, and its riser strap up to the canopy.
    b.tint = [0.72, 0.14, 0.1];
    b.box(add(hand, [0, 0.055, -0.01]), [0.045, 0, 0], [0, 0.02, 0], [0, 0, 0.02], [tileRect('white')]);
    b.tint = [0.2, 0.2, 0.17];
    beam(b, add(hand, [0, 0.07, -0.01]), [side * 0.6, 2.7, -1.35], 0.0065, [tileRect('white')], 0.004);
    b.flags = 0;
    b.tint = WHITE;
  }
}

/**
 * A rope ladder hanging from `top` down to `bottom`: two ropes `across` either side of the
 * middle, wooden rungs every half block (`out` points away from the hull).
 */
export function ropeLadder(b: MeshBuilder, top: Vec3, bottom: Vec3, across: Vec3, out: Vec3): void {
  const flat = [tileRect('white')];
  b.flags = F_FLAT;
  b.tint = [0.36, 0.28, 0.15];
  for (const s of [-1, 1]) beam(b, add(top, scale(across, s)), add(bottom, scale(across, s)), 0.024, flat);
  b.tint = [0.3, 0.18, 0.08];
  const len = top[1] - bottom[1];
  for (let d = 0.25; d < len; d += 0.5) {
    const c = add(top, scale(sub(bottom, top), d / len));
    b.box(c, scale(across, 1.05), [0, 0.032, 0], scale(out, 0.045), flat);
  }
  b.flags = 0;
  b.tint = WHITE;
}

export type VillagerSkin = 'villager' | 'smith' | 'farmer' | 'trader';

export function villager(b: MeshBuilder, x: number, y: number, z: number, yaw: number, phase: number, hurt: boolean, alert: boolean, time: number, skin: VillagerSkin = 'villager'): void {
  const px = 1.9 / 30;
  const bob = Math.abs(Math.sin(phase * Math.PI)) > 0.5 ? px : 0;
  const o: Vec3 = [x, y + bob, z];
  const basis = yawBasis(yaw);
  b.flash = hurt ? 0.8 : 0;
  part(b, o, basis, px, 0, 10, 0, 8, 20, 6, uvs(skin, 0, 20, 8, 20, 6));
  part(b, o, basis, px, 4, 15, 0, 8, 4, 4, uvs(skin, 32, 20, 8, 4, 4));
  const head = pitchBasis(basis, Math.sin(time * 0.9 + x) * 0.06);
  part(b, o, head, px, 0, 25, 0, 8, 10, 8, uvs(skin, 0, 0, 8, 10, 8));
  part(b, o, head, px, 5, 22, 0, 2, 4, 2, uvs(skin, 24, 0, 2, 4, 2));
  if (skin === 'farmer') part(b, o, head, px, 0, 30.5, 0, 12, 1, 12, uvs(skin, 0, 48, 12, 1, 12));
  b.flash = 0;
  if (alert) {
    // A bobbing emerald "!" over villagers who can be recruited.
    const h = y + 2.4 + Math.sin(time * 4) * 0.06;
    const ex = [tileRect('white')];
    b.flags = F_UNLIT;
    b.tint = [0.35, 1, 0.45];
    b.emit = 0.4;
    b.box([x, h + 0.16, z], [0.055, 0, 0], [0, 0.15, 0], [0, 0, 0.055], ex);
    b.box([x, h - 0.09, z], [0.055, 0, 0], [0, 0.055, 0], [0, 0, 0.055], ex);
    b.flags = 0;
    b.emit = 0;
    b.tint = WHITE;
  }
}

/** A bobbing "!" over someone with something to say. */
export function calloutOver(b: MeshBuilder, x: number, y: number, z: number, time: number, color: Vec3): void {
  const h = y + Math.sin(time * 4) * 0.06;
  const ex = [tileRect('white')];
  b.flags = F_UNLIT;
  b.tint = color;
  b.emit = 0.5;
  b.box([x, h + 0.16, z], [0.06, 0, 0], [0, 0.16, 0], [0, 0, 0.06], ex);
  b.box([x, h - 0.1, z], [0.06, 0, 0], [0, 0.06, 0], [0, 0, 0.06], ex);
  b.flags = 0;
  b.emit = 0;
  b.tint = WHITE;
}

function blockFaces(id: number): TexRect[] {
  const def = blockDef(id);
  const side = tileRect(def.tiles.side);
  const faces: TexRect[] = [side, side, tileRect(def.tiles.top), tileRect(def.tiles.bottom), side, side];
  if (def.tiles.front) faces[DIR_FACE[0]!] = tileRect(def.tiles.front);
  return faces;
}

/** A textured cube using a block's own faces. */
export function blockCube(b: MeshBuilder, id: number, c: Vec3, half: number, yaw: number, roll = 0, tint = 1, emit = 0): void {
  const basis = pitchBasis(yawBasis(yaw), roll);
  b.tint = [tint, tint, tint];
  b.emit = emit;
  b.box(c, scale(basis.f, half), scale(basis.u, half), scale(basis.r, half), blockFaces(id));
  b.tint = WHITE;
  b.emit = 0;
}

/** billboard()'s corners and tint, reused (quad() reads them at once). */
const billCorners = new Float64Array(12);
const billTint: Vec3 = [1, 1, 1];

/** A camera-facing sprite for particles. */
export function billboard(b: MeshBuilder, cam: Basis, c: Vec3, half: number, t: TexRect, r: number, g: number, bl: number, emit: number, spin = 0): void {
  // (In numbers rather than vectors: a busy fight is hundreds of these a frame.)
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const nsn = -sn;
  const R = cam.r;
  const U = cam.u;
  const rx0 = (R[0] * cs + U[0] * sn) * half;
  const rx1 = (R[1] * cs + U[1] * sn) * half;
  const rx2 = (R[2] * cs + U[2] * sn) * half;
  const uy0 = (U[0] * cs + R[0] * nsn) * half;
  const uy1 = (U[1] * cs + R[1] * nsn) * half;
  const uy2 = (U[2] * cs + R[2] * nsn) * half;
  const p = billCorners;
  p[0] = c[0] - rx0 - uy0;
  p[1] = c[1] - rx1 - uy1;
  p[2] = c[2] - rx2 - uy2;
  p[3] = c[0] - rx0 + uy0;
  p[4] = c[1] - rx1 + uy1;
  p[5] = c[2] - rx2 + uy2;
  p[6] = c[0] + rx0 + uy0;
  p[7] = c[1] + rx1 + uy1;
  p[8] = c[2] + rx2 + uy2;
  p[9] = c[0] + rx0 - uy0;
  p[10] = c[1] + rx1 - uy1;
  p[11] = c[2] + rx2 - uy2;
  billTint[0] = r;
  billTint[1] = g;
  billTint[2] = bl;
  b.tint = billTint;
  b.emit = emit;
  b.quad(p, t, -cam.f[0], -cam.f[1], -cam.f[2]);
  b.tint = WHITE;
  b.emit = 0;
}

// ------------------------------------------------------------------ extruded item sprites

/** A tiny affine transform: columns x, y, z and translation t. */
export interface Xform {
  x: Vec3;
  y: Vec3;
  z: Vec3;
  t: Vec3;
}

function xform(t: Vec3): Xform {
  return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], t };
}

function apply(m: Xform, p: Vec3): Vec3 {
  return [
    m.t[0] + m.x[0] * p[0] + m.y[0] * p[1] + m.z[0] * p[2],
    m.t[1] + m.x[1] * p[0] + m.y[1] * p[1] + m.z[1] * p[2],
    m.t[2] + m.x[2] * p[0] + m.y[2] * p[1] + m.z[2] * p[2],
  ];
}

function applyDir(m: Xform, v: Vec3): Vec3 {
  return [m.x[0] * v[0] + m.y[0] * v[1] + m.z[0] * v[2], m.x[1] * v[0] + m.y[1] * v[1] + m.z[1] * v[2], m.x[2] * v[0] + m.y[2] * v[1] + m.z[2] * v[2]];
}

/** Post-multiplies a rotation about a local axis (0 x, 1 y, 2 z). */
function rotate(m: Xform, axis: 0 | 1 | 2, a: number): Xform {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const [u, v] = axis === 0 ? [m.y, m.z] : axis === 1 ? [m.z, m.x] : [m.x, m.y];
  const nu: Vec3 = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
  const nv: Vec3 = [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s];
  if (axis === 0) return { ...m, y: nu, z: nv };
  if (axis === 1) return { ...m, z: nu, x: nv };
  return { ...m, x: nu, y: nv };
}

function scaled(m: Xform, s: number): Xform {
  return { x: scale(m.x, s), y: scale(m.y, s), z: scale(m.z, s), t: m.t };
}

interface SpriteQuad {
  p: number[];
  t: TexRect;
  n: Vec3;
}

const spriteCache = new Map<string, SpriteQuad[]>();

/**
 * Minecraft's generated item model: the icon on both faces of a thin slab plus a side wall
 * along every opaque pixel's edge, in a unit square centred on the origin.
 */
function spriteQuads(icon: string): SpriteQuad[] {
  const cached = spriteCache.get(icon);
  if (cached) return cached;
  const mask = alphaMask(icon);
  const quads: SpriteQuad[] = [];
  const h = 1 / 40;
  const full = tileRect(icon);
  quads.push({ p: [-0.5, -0.5, h, -0.5, 0.5, h, 0.5, 0.5, h, 0.5, -0.5, h], t: full, n: [0, 0, 1] });
  quads.push({ p: [0.5, -0.5, -h, 0.5, 0.5, -h, -0.5, 0.5, -h, -0.5, -0.5, -h], t: [full[2], full[1], full[0], full[3], full[4]], n: [0, 0, -1] });
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < TEX && y < TEX && mask[y * TEX + x] === 1;
  const px = 1 / TEX;
  for (let y = 0; y < TEX; y += 1) {
    for (let x = 0; x < TEX; x += 1) {
      if (!solid(x, y)) continue;
      const t = subRect(icon, x + 0.25, y + 0.25, x + 0.75, y + 0.75);
      const x0 = -0.5 + x * px;
      const x1 = x0 + px;
      const y1 = 0.5 - y * px;
      const y0 = y1 - px;
      if (!solid(x, y - 1)) quads.push({ p: [x0, y1, h, x0, y1, -h, x1, y1, -h, x1, y1, h], t, n: [0, 1, 0] });
      if (!solid(x, y + 1)) quads.push({ p: [x0, y0, -h, x0, y0, h, x1, y0, h, x1, y0, -h], t, n: [0, -1, 0] });
      if (!solid(x - 1, y)) quads.push({ p: [x0, y0, -h, x0, y1, -h, x0, y1, h, x0, y0, h], t, n: [-1, 0, 0] });
      if (!solid(x + 1, y)) quads.push({ p: [x1, y0, h, x1, y1, h, x1, y1, -h, x1, y0, -h], t, n: [1, 0, 0] });
    }
  }
  spriteCache.set(icon, quads);
  return quads;
}

/** sprite()'s corners, reused. */
const spriteCorners = new Float64Array(12);

export function sprite(b: MeshBuilder, icon: string, m: Xform): void {
  // (apply() and applyDir() written out: a held tool or a dropped item is a hundred-odd quads,
  // every frame.)
  const p = spriteCorners;
  const [x0, x1, x2] = m.x;
  const [y0, y1, y2] = m.y;
  const [z0, z1, z2] = m.z;
  const [t0, t1, t2] = m.t;
  const quads = spriteQuads(icon);
  for (let k = 0; k < quads.length; k += 1) {
    const q = quads[k]!;
    const qp = q.p;
    for (let i = 0; i < 12; i += 3) {
      const a = qp[i]!;
      const c = qp[i + 1]!;
      const d = qp[i + 2]!;
      p[i] = t0 + x0 * a + y0 * c + z0 * d;
      p[i + 1] = t1 + x1 * a + y1 * c + z1 * d;
      p[i + 2] = t2 + x2 * a + y2 * c + z2 * d;
    }
    const n = q.n;
    const nx = x0 * n[0] + y0 * n[1] + z0 * n[2];
    const ny = x1 * n[0] + y1 * n[1] + z1 * n[2];
    const nz = x2 * n[0] + y2 * n[1] + z2 * n[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    b.quad(p, q.t, nx / l, ny / l, nz / l);
  }
}

/** Dropped loot: spinning mini blocks, or extruded item sprites. */
export function itemDrop(b: MeshBuilder, id: number, c: Vec3, age: number): void {
  const def = itemDef(id);
  if (def.place !== null && blockDef(def.place).shape === 'cube') {
    blockCube(b, def.place, c, 0.14, age * 2);
    return;
  }
  const m = scaled(rotate(xform([c[0], c[1] + 0.08, c[2]]), 1, age * 2), 0.45);
  sprite(b, def.icon, m);
}

/** Arrow in flight (skeletons). */
export function arrow(b: MeshBuilder, p: Vec3, v: Vec3, k = 1): void {
  const d = normalize(v);
  const side = normalize(crossV(d, [0, 1, 0]));
  const up = crossV(side, d);
  const wood = [tileRect('planks_oak')];
  b.box(p, scale(d, 0.32 * k), scale(up, 0.025 * k), scale(side, 0.025 * k), wood);
  b.box(add(p, scale(d, 0.33 * k)), scale(d, 0.05 * k), scale(up, 0.04 * k), scale(side, 0.04 * k), [tileRect('iron_block')]);
  b.box(add(p, scale(d, -0.3 * k)), scale(d, 0.06 * k), scale(up, 0.07 * k), scale(side, 0.01 * k), [tileRect('wool_white')]);
}

// ------------------------------------------------------------------ overlays

/** Axes of a cell turned by a body's yaw (cos rc, sin rs): local x, y and z in the world. */
function cellAxes(rc: number, rs: number): [Vec3, Vec3, Vec3] {
  return [[rc, 0, rs], [0, 1, 0], [-rs, 0, rc]];
}

/** Thin dark edges around a cell centred at c (Minecraft's block selection box). */
export function outline(b: MeshBuilder, cx: number, cy: number, cz: number, rc = 1, rs = 0): void {
  const uv = [tileRect('white')];
  const e = 0.006;
  const A = cellAxes(rc, rs);
  b.flags = F_OVERLAY | F_UNLIT;
  b.tint = [0.02, 0.02, 0.02];
  b.alpha = 0.85;
  for (const [ax, ay] of [[0, 1], [0, 2], [1, 2]] as const) {
    const along = 3 - ax - ay;
    for (const s0 of [-0.502, 0.502]) {
      for (const s1 of [-0.502, 0.502]) {
        const c = add(add([cx, cy, cz], scale(A[ax], s0)), scale(A[ay], s1));
        const half = [e, e, e];
        half[along] = 0.5 + e;
        b.box(c, scale(A[0], half[0]!), scale(A[1], half[1]!), scale(A[2], half[2]!), uv);
      }
    }
  }
  b.flags = 0;
  b.alpha = 1;
  b.tint = WHITE;
}

/** Crack decal hugging a cell centred at c. */
export function crack(b: MeshBuilder, cx: number, cy: number, cz: number, stage: number, rc = 1, rs = 0): void {
  const uv = tileRect(`crack${Math.max(0, Math.min(9, stage))}`);
  const h = 0.503;
  const A = cellAxes(rc, rs);
  b.flags = F_OVERLAY;
  b.alpha = 1;
  b.box([cx, cy, cz], scale(A[0], h), scale(A[1], h), scale(A[2], h), [uv]);
  b.flags = 0;
}

/** Soft round shadow on the ground under a creature (Minecraft's entity shadow). */
export function blobShadow(b: MeshBuilder, x: number, groundY: number, z: number, radius: number, strength: number): void {
  if (strength <= 0.02) return;
  const y = groundY + 0.015;
  const p = [x - radius, y, z + radius, x - radius, y, z - radius, x + radius, y, z - radius, x + radius, y, z + radius];
  b.flags = F_OVERLAY | F_UNLIT;
  b.tint = [0, 0, 0];
  b.alpha = Math.min(1, strength);
  b.quad(p, tileRect('shadow'), 0, 1, 0);
  b.flags = 0;
  b.alpha = 1;
  b.tint = WHITE;
}

// ------------------------------------------------------------------ machines

const UP_Z: Vec3 = [0, 0, 1];
/** beam()'s box (centre and half axes) and segmentedBeam()'s ends, reused (read at once). */
const beamC: Vec3 = [0, 0, 0];
const beamX: Vec3 = [0, 0, 0];
const beamY: Vec3 = [0, 0, 0];
const beamZ: Vec3 = [0, 0, 0];
const segA: Vec3 = [0, 0, 0];
const segB: Vec3 = [0, 0, 0];

/** Oriented beam between two points (square section, half-width hw). */
export function beam(b: MeshBuilder, a: Vec3, c: Vec3, hw: number, faces: TexRect[], hd = hw, upHint: Vec3 = UP_Z): void {
  // (In numbers rather than vectors: the fortress's legs and the crane are made of these, every
  // frame.) dir = (c - a) / len; side = dir x upHint (or x +x when they run together); up = side x dir.
  const d0 = c[0] - a[0];
  const d1 = c[1] - a[1];
  const d2 = c[2] - a[2];
  const len = Math.hypot(d0, d1, d2);
  if (len < 1e-4) return;
  const k = 1 / len;
  const f0 = d0 * k;
  const f1 = d1 * k;
  const f2 = d2 * k;
  let s0 = f1 * upHint[2] - f2 * upHint[1];
  let s1 = f2 * upHint[0] - f0 * upHint[2];
  let s2 = f0 * upHint[1] - f1 * upHint[0];
  if (Math.hypot(s0, s1, s2) < 1e-3) {
    s0 = f1 * 0 - f2 * 0;
    s1 = f2 * 1 - f0 * 0;
    s2 = f0 * 0 - f1 * 1;
  }
  const sl = Math.hypot(s0, s1, s2) || 1;
  s0 /= sl;
  s1 /= sl;
  s2 /= sl;
  let u0 = s1 * f2 - s2 * f1;
  let u1 = s2 * f0 - s0 * f2;
  let u2 = s0 * f1 - s1 * f0;
  const ul = Math.hypot(u0, u1, u2) || 1;
  u0 /= ul;
  u1 /= ul;
  u2 /= ul;
  beamC[0] = (a[0] + c[0]) * 0.5;
  beamC[1] = (a[1] + c[1]) * 0.5;
  beamC[2] = (a[2] + c[2]) * 0.5;
  beamX[0] = s0 * hw;
  beamX[1] = s1 * hw;
  beamX[2] = s2 * hw;
  const h = len / 2;
  beamY[0] = f0 * h;
  beamY[1] = f1 * h;
  beamY[2] = f2 * h;
  beamZ[0] = u0 * hd;
  beamZ[1] = u1 * hd;
  beamZ[2] = u2 * hd;
  b.box(beamC, beamX, beamY, beamZ, faces);
}

/** A beam built from cube-ish segments so textures keep their pixel size along its length. */
export function segmentedBeam(b: MeshBuilder, a: Vec3, c: Vec3, hw: number, hd: number, faces: TexRect[], seg = 1.2): void {
  const d0 = c[0] - a[0];
  const d1 = c[1] - a[1];
  const d2 = c[2] - a[2];
  const len = Math.hypot(d0, d1, d2);
  if (len < 1e-4) return;
  const n = Math.max(1, Math.round(len / seg));
  const a0 = a[0];
  const a1 = a[1];
  const a2 = a[2];
  for (let i = 0; i < n; i += 1) {
    const k0 = i / n;
    const k1 = (i + 1) / n;
    segA[0] = a0 + d0 * k0;
    segA[1] = a1 + d1 * k0;
    segA[2] = a2 + d2 * k0;
    segB[0] = a0 + d0 * k1;
    segB[1] = a1 + d1 * k1;
    segB[2] = a2 + d2 * k1;
    beam(b, segA, segB, hw, faces, hd);
  }
}

/**
 * One mechanical leg of a walker (the fortress or a giant), in the spirit of the fortress art:
 * a gearbox hip, an iron-plated thigh with a brass piston, a geared knee, a stone-brick shin
 * and a broad stone foot shod in iron.
 */
export function walkerLeg(b: MeshBuilder, hip: Vec3, knee: Vec3, foot: Vec3, size: number, giant: boolean, phase: number, damage = 0, shin = Infinity): void {
  const plate = tileRect(giant ? 'mossy_cobble' : 'leg_plate');
  const stone = tileRect(giant ? 'mossy_stone_bricks' : 'stone_bricks');
  const smooth = tileRect('smooth_stone_side');
  const rod = [tileRect('piston_rod')];
  const brass = tileRect(giant ? 'mossy_cobble' : 'brass');
  const gearbox = tileRect(giant ? 'mossy_cobble' : 'gearbox');
  const gearTop = tileRect(giant ? 'mossy_cobble' : 'gearbox_top');
  const cob = tileRect('cobble');
  const gear = tileRect('gear_face');
  // Wear darkens and rusts the leg.
  b.tint = damage > 0 ? [1 - damage * 0.42, 1 - damage * 0.55, 1 - damage * 0.6] : WHITE;
  const k = size;
  // Hip housing.
  b.box(hip, [0.95 * k, 0, 0], [0, 0.75 * k, 0], [0, 0, 0.95 * k], [gearbox, gearbox, gearTop, gearTop, gearbox, gearbox]);
  // Thigh: iron plates over a stone core.
  segmentedBeam(b, hip, knee, 0.62 * k, 0.62 * k, [plate, plate, smooth, smooth, plate, plate], 1.3 * k);
  const out = normalize([knee[0] - hip[0], 0, knee[2] - hip[2]]);
  const side: Vec3 = Math.hypot(out[0], out[2]) > 0.1 ? [-out[2], 0, out[0]] : [1, 0, 0];
  // Hydraulic piston along the thigh's outer face.
  const pa = add(add(hip, scale(out, 0.75 * k)), [0, -0.4 * k, 0]);
  const pb = add(add(knee, scale(out, 0.75 * k)), [0, 0.55 * k, 0]);
  const mid = add(scale(pa, 0.5), scale(pb, 0.5));
  segmentedBeam(b, pa, mid, 0.26 * k, 0.26 * k, [brass], 1.1 * k);
  segmentedBeam(b, mid, pb, 0.15 * k, 0.15 * k, rod, 1.1 * k);
  // Knee: a geared joint with brass hub plates and spinning gears on both sides.
  b.box(knee, [0.8 * k, 0, 0], [0, 0.8 * k, 0], [0, 0, 0.8 * k], [brass, brass, gearTop, gearTop, brass, brass]);
  const spin = phase * 1.4;
  for (const s of [-1, 1]) {
    const c = add(knee, scale(side, s * 0.84 * k));
    const r = 0.95 * k;
    const ca = Math.cos(spin) * r;
    const sa = Math.sin(spin) * r;
    const u: Vec3 = [out[0] * ca, sa, out[2] * ca];
    const v: Vec3 = [-out[0] * sa, ca, -out[2] * sa];
    const p = [c[0] - u[0] - v[0], c[1] - u[1] - v[1], c[2] - u[2] - v[2], c[0] - u[0] + v[0], c[1] - u[1] + v[1], c[2] - u[2] + v[2], c[0] + u[0] + v[0], c[1] + u[1] + v[1], c[2] + u[2] + v[2], c[0] + u[0] - v[0], c[1] + u[1] - v[1], c[2] + u[2] - v[2]];
    b.quad(p, gear, side[0] * s, 0, side[2] * s);
    const q = [p[9]!, p[10]!, p[11]!, p[6]!, p[7]!, p[8]!, p[3]!, p[4]!, p[5]!, p[0]!, p[1]!, p[2]!];
    b.quad(q, gear, -side[0] * s, 0, -side[2] * s);
  }
  // Shin: a stone-brick column widening towards the ankle, with a second piston behind. Stretched
  // past its length (holding the hull up a slope, reaching down a cliff), a steel ram slides out of
  // it through a brass collar.
  const ankle: Vec3 = [foot[0], foot[1] + 1.25 * k, foot[2]];
  const span = Math.hypot(ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]);
  const ram = span > shin + 0.25 ? span - shin : 0;
  const end: Vec3 = ram > 0 ? add(knee, scale([ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]], shin / span)) : ankle;
  segmentedBeam(b, knee, end, 0.7 * k, 0.7 * k, [stone, stone, smooth, smooth, stone, stone], 1.3 * k);
  if (ram > 0) {
    b.box(end, [0.78 * k, 0, 0], [0, 0.22 * k, 0], [0, 0, 0.78 * k], [brass, brass, gearTop, gearTop, brass, brass]);
    segmentedBeam(b, end, ankle, 0.4 * k, 0.4 * k, rod, 1.1 * k);
  }
  segmentedBeam(b, add(knee, scale(out, -0.85 * k)), add(ankle, scale(out, -0.8 * k)), 0.14 * k, 0.14 * k, rod, 1.1 * k);
  b.box([ankle[0], ankle[1] - 0.05 * k, ankle[2]], [0.85 * k, 0, 0], [0, 0.35 * k, 0], [0, 0, 0.85 * k], [plate]);
  // Foot: a broad stone block shod in iron.
  b.box([foot[0], foot[1] + 0.48 * k, foot[2]], [1.35 * k, 0, 0], [0, 0.48 * k, 0], [0, 0, 1.35 * k], [cob, cob, plate, cob, cob, cob]);
  b.box([foot[0], foot[1] + 0.98 * k, foot[2]], [1.0 * k, 0, 0], [0, 0.12 * k, 0], [0, 0, 1.0 * k], [plate]);
  b.flags = 0;
  b.tint = WHITE;
}

/** A cannon barrel on its carriage, aimed by yaw and pitch, kicking back on recoil. */
export function cannonBarrel(b: MeshBuilder, c: Vec3, yaw: number, pitch: number, recoil: number, powered: boolean, rc = 1, rs = 0): void {
  const d: Vec3 = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
  const side = normalize([-Math.sin(yaw), 0, Math.cos(yaw)]);
  const up = normalize(crossV(side, d));
  const metal = [tileRect('cannon_barrel')];
  const pivot: Vec3 = [c[0], c[1] + 0.68, c[2]];
  const center = add(pivot, scale(d, 0.36 - recoil * 0.25));
  b.tint = powered ? WHITE : [0.75, 0.75, 0.78];
  b.box(center, scale(d, 0.62), scale(up, 0.19), scale(side, 0.19), metal);
  const muzzle = add(pivot, scale(d, 0.98 - recoil * 0.25));
  b.box(muzzle, scale(d, 0.07), scale(up, 0.25), scale(side, 0.25), metal);
  const breech = add(pivot, scale(d, -0.28 - recoil * 0.25));
  b.box(breech, scale(d, 0.08), scale(up, 0.23), scale(side, 0.23), [tileRect('brass')]);
  b.tint = WHITE;
  b.box([c[0], c[1] + 0.55, c[2]], [0.34 * rc, 0, 0.34 * rs], [0, 0.07, 0], [-0.34 * rs, 0, 0.34 * rc], [tileRect('planks_spruce')]);
  for (const s of [-1, 1]) b.box(add([c[0], c[1] + 0.68, c[2]], scale(side, s * 0.3)), scale(d, 0.16), [0, 0.16, 0], scale(side, 0.04), [tileRect('brass')]);
}

/** A ballista: a heavy crossbow on a swivel post, loaded with an iron-tipped bolt. */
export function ballistaModel(b: MeshBuilder, c: Vec3, yaw: number, pitch: number, recoil: number, rc = 1, rs = 0): void {
  const d: Vec3 = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
  const side = normalize([-Math.sin(yaw), 0, Math.cos(yaw)]);
  const up = normalize(crossV(side, d));
  const wood = [tileRect('planks_spruce')];
  const log = [tileRect('log_oak')];
  const iron = [tileRect('iron_block')];
  b.tint = WHITE;
  b.box([c[0], c[1] + 0.55, c[2]], [0.36 * rc, 0, 0.36 * rs], [0, 0.07, 0], [-0.36 * rs, 0, 0.36 * rc], wood);
  b.box([c[0], c[1] + 0.72, c[2]], [0.09, 0, 0], [0, 0.12, 0], [0, 0, 0.09], log);
  const pivot: Vec3 = [c[0], c[1] + 0.9, c[2]];
  // Stock along the aim, the bow across its front, the string drawn back.
  b.box(add(pivot, scale(d, 0.05)), scale(d, 0.62), scale(up, 0.07), scale(side, 0.09), wood);
  const front = add(pivot, scale(d, 0.5));
  const pull = 0.3 - recoil * 0.28;
  for (const s of [-1, 1]) {
    const tip = add(add(front, scale(side, s * 0.62)), scale(d, -0.14));
    beam(b, front, tip, 0.045, log, 0.045, up);
    beam(b, tip, add(pivot, scale(d, 0.5 - pull)), 0.012, [tileRect('wool_white')], 0.012, up);
  }
  if (recoil < 0.5) {
    b.box(add(pivot, scale(d, 0.45)), scale(d, 0.5), scale(up, 0.025), scale(side, 0.025), [tileRect('planks_oak')]);
    b.box(add(pivot, scale(d, 0.98)), scale(d, 0.06), scale(up, 0.05), scale(side, 0.05), iron);
  }
}

/** A mortar: a squat iron tube cocked steeply skyward on a stone ring. */
export function mortarModel(b: MeshBuilder, c: Vec3, yaw: number, pitch: number, recoil: number, powered: boolean, rc = 1, rs = 0): void {
  const p = Math.max(0.75, pitch);
  const d: Vec3 = [Math.cos(p) * Math.cos(yaw), Math.sin(p), Math.cos(p) * Math.sin(yaw)];
  const side = normalize([-Math.sin(yaw), 0, Math.cos(yaw)]);
  const up = normalize(crossV(side, d));
  const metal = [tileRect('cannon_barrel')];
  b.tint = WHITE;
  b.box([c[0], c[1] + 0.58, c[2]], [0.4 * rc, 0, 0.4 * rs], [0, 0.09, 0], [-0.4 * rs, 0, 0.4 * rc], [tileRect('smooth_stone')]);
  const pivot: Vec3 = [c[0], c[1] + 0.8 - recoil * 0.12, c[2]];
  b.tint = powered ? WHITE : [0.75, 0.75, 0.78];
  b.box(add(pivot, scale(d, 0.22)), scale(d, 0.42), scale(up, 0.27), scale(side, 0.27), metal);
  b.box(add(pivot, scale(d, 0.62)), scale(d, 0.06), scale(up, 0.31), scale(side, 0.31), [tileRect('brass')]);
  b.tint = WHITE;
  for (const s of [-1, 1]) b.box(add(pivot, scale(side, s * 0.33)), scale(d, 0.12), [0, 0.14, 0], scale(side, 0.05), [tileRect('brass')]);
}

/** Lightning: a jagged white-hot bolt from the clouds to the ground. */
export function lightningBolt(b: MeshBuilder, x: number, y: number, z: number, seed: number, life: number): void {
  const faces = [tileRect('white')];
  b.flags = F_OVERLAY | F_UNLIT;
  b.tint = [0.75, 0.85, 1];
  b.emit = 3;
  b.alpha = Math.min(1, life * 4);
  let px = x;
  let py = y + 80;
  let pz = z;
  let r = seed;
  const rnd = (): number => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280 - 0.5;
  };
  const n = 14;
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const nx = i === n ? x : x + rnd() * 9 * (1 - t * 0.6);
    const nz = i === n ? z : z + rnd() * 9 * (1 - t * 0.6);
    const ny = y + 80 * (1 - t);
    beam(b, [px, py, pz], [nx, ny, nz], 0.16 + (1 - t) * 0.1, faces);
    if (i % 4 === 2) beam(b, [nx, ny, nz], [nx + rnd() * 8, ny - 5, nz + rnd() * 8], 0.07, faces);
    px = nx;
    py = ny;
    pz = nz;
  }
  b.flags = 0;
  b.emit = 0;
  b.alpha = 1;
  b.tint = WHITE;
}

/** Thruster propeller spinning on the -x face of its block (x: the block's local x in the world). */
export function propeller(b: MeshBuilder, c: Vec3, angle: number, rc = 1, rs = 0): void {
  const cloth = [tileRect('wool_white')];
  const spar = [tileRect('log_spruce')];
  const ax: Vec3 = [rc, 0, rs];
  const side: Vec3 = [-rs, 0, rc];
  const hub: Vec3 = [c[0] - rc * 0.62, c[1], c[2] - rs * 0.62];
  b.box(hub, scale(ax, 0.08), [0, 0.1, 0], scale(side, 0.1), [tileRect('brass')]);
  for (let k = 0; k < 4; k += 1) {
    const a = angle + (k * Math.PI) / 2;
    const radial = add([0, Math.cos(a), 0], scale(side, Math.sin(a)));
    const tangent = add([0, -Math.sin(a), 0], scale(side, Math.cos(a)));
    const center = add(hub, scale(radial, 0.55));
    b.box(center, scale(ax, 0.03), scale(radial, 0.45), scale(tangent, 0.14), cloth);
    b.box(add(hub, scale(radial, 0.3)), scale(ax, 0.04), scale(radial, 0.3), scale(tangent, 0.03), spar);
  }
}

/** Windmill sails turning about the axis `axis` at hub centre c (hoisted windmills). */
export function sails(b: MeshBuilder, c: Vec3, axis: Vec3, angle: number, length: number): void {
  const a = normalize(axis);
  const ref: Vec3 = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(crossV(a, ref));
  const v = crossV(a, u);
  const spar = [tileRect('log_oak')];
  const cloth = [tileRect('wool_white')];
  for (let k = 0; k < 4; k += 1) {
    const t = angle + (k * Math.PI) / 2;
    const radial = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
    const tangent = add(scale(u, -Math.sin(t)), scale(v, Math.cos(t)));
    b.box(add(c, scale(radial, length / 2)), scale(a, 0.08), scale(radial, length / 2), scale(tangent, 0.08), spar);
    b.box(add(add(c, scale(radial, length * 0.6)), scale(tangent, 0.55)), scale(a, 0.03), scale(radial, length * 0.38), scale(tangent, 0.48), cloth);
  }
}

/** The fortress's ship wheel, turning as it is steered: eight spokes with brass grips round a hub. */
export function helmWheel(b: MeshBuilder, c: Vec3, axis: Vec3, side: Vec3, spin: number): void {
  const wood = [tileRect('planks_spruce')];
  const brass = [tileRect('brass')];
  for (let k = 0; k < 8; k += 1) {
    const a = (k * Math.PI) / 4 + spin;
    const d: Vec3 = [side[0] * Math.cos(a), Math.sin(a), side[2] * Math.cos(a)];
    const perp: Vec3 = [-side[0] * Math.sin(a), Math.cos(a), -side[2] * Math.sin(a)];
    b.box(add(c, scale(d, 0.28)), scale(d, 0.28), scale(axis, 0.035), scale(perp, 0.035), wood);
    b.box(add(c, scale(d, 0.6)), scale(d, 0.06), scale(axis, 0.045), scale(perp, 0.045), brass);
  }
  b.box(c, scale(side, 0.09), [0, 0.09, 0], scale(axis, 0.07), brass);
}


// ------------------------------------------------------------------ first person

function rotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function rotY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** What is held like a tool, handle in the fist (everything else sits smaller in the palm). */
const TOOLS = new Set<number>([I.SWORD, I.CROSSBOW, I.GRAPPLE, I.BREAKER]);

/**
 * First-person arm plus the held item, in view space (camera looks down -z). The forearm
 * reaches in from the bottom-right corner; swinging chops it down and inwards about the
 * elbow like Minecraft's hand. `swing` and `equip` run 0..1; `k` scales the held thing (an
 * upright phone's is smaller).
 */
export function heldItem(b: MeshBuilder, item: number | null, swing: number, equip: number, bobX: number, bobY: number, icon?: string, k = 1): void {
  const s = Math.sin(swing * Math.PI);
  const sq = Math.sin(Math.sqrt(swing) * Math.PI);
  const elbow: Vec3 = [0.66 + bobX, -0.8 + bobY - equip * 0.5, -0.42];
  let v: Vec3 = [-0.28, 0.4, -0.42];
  v = rotY(rotX(v, -0.9 * s), 0.5 * sq);
  const hand = add(elbow, add(v, [0, Math.sin(Math.sqrt(swing) * Math.PI * 2) * 0.04, 0]));
  const dir = normalize(v);
  const side = normalize(crossV(dir, [0, 1, 0]));
  const face = normalize(crossV(side, dir));
  const half = 0.1;
  forearm(b, add(elbow, scale(v, 0.5)), scale(face, half), scale(dir, -Math.hypot(v[0], v[1], v[2]) / 2), scale(side, half));
  const toolDir = normalize(add(dir, [0, 0.45, 0]));
  let normal = normalize(scale(hand, -1));
  normal = normalize(add(normal, scale(toolDir, -(normal[0] * toolDir[0] + normal[1] * toolDir[1] + normal[2] * toolDir[2]))));
  const across = normalize(crossV(normal, toolDir));
  const def = item === null ? null : itemDef(item);
  if (def && def.place !== null && blockDef(def.place).shape === 'cube') {
    const c = add(hand, add(scale(toolDir, 0.1), [-0.03, 0.02, -0.06]));
    const r = 0.085 * k;
    const f = normalize(rotY(toolDir, 0.78));
    const u = normalize(crossV(crossV(f, [0, 1, 0]), f));
    const rr = normalize(crossV(f, u));
    b.box(c, scale(f, r), scale(u, r), scale(rr, r), blockFaces(def.place));
    return;
  }
  if (def && (def.place === B.TORCH || def.place === B.LANTERN)) {
    const before = b.verts;
    if (def.place === B.TORCH) torchModel(b, -0.5, 0, -0.5, -1, b.sky, 1);
    else lanternModel(b, -0.5, 0, -0.5, false, b.sky, 1);
    relocate(b, before, { x: across, y: toolDir, z: normal, t: add(hand, scale(toolDir, -0.04)) }, 0.42 * k);
    return;
  }
  // Tools and items: the extruded sprite gripped at its bottom-left (handle) corner (a charge, a loaf
  // or a stick of TNT smaller than a pick).
  const size = 0.42 * k * (item === null || TOOLS.has(item) ? 1 : 0.78);
  const x: Vec3 = scale(normalize(add(toolDir, scale(across, -1))), size);
  const y: Vec3 = scale(normalize(add(toolDir, across)), size);
  const z: Vec3 = scale(normal, size);
  const grip: Vec3 = [-0.32, -0.32, 0];
  const t = add(hand, scale(add(scale(x, grip[0]), scale(y, grip[1])), -1));
  sprite(b, icon ?? (def ? def.icon : 'ui_pickaxe'), { x, y, z, t });
}

/** Re-places the vertices written since `from` through a transform (scaled about the origin). */
function relocate(b: MeshBuilder, from: number, m: Xform, s: number): void {
  b.transformSince(from, (p) => apply(m, [p[0] * s, p[1] * s, p[2] * s]), (n) => normalize(applyDir(m, n)));
}

/** Flat-coloured box (vertex colour only), used for distant crowns and crane rigging. */
export function colorBox(b: MeshBuilder, c: Vec3, half: Vec3, color: Vec3): void {
  b.flags = F_FLAT;
  b.tint = color;
  b.box(c, [half[0], 0, 0], [0, half[1], 0], [0, 0, half[2]], [tileRect('white')]);
  b.flags = 0;
  b.tint = WHITE;
}
