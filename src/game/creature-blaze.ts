// The blaze: a smoky golden head over twelve burning rods turning in three rings (alternating
// directions), wrapped in a flickering flame aura with smoke curling off the top. Heating up for a
// volley the rods glow brighter; shooting, they whirl.
import type { Actor } from './entities';
import { F_OVERLAY, F_UNLIT, type MeshBuilder, type TexRect } from './gl';
import type { Vec3 } from './math3d';
import { bodyBasis, flashOf, part, pitchBasis, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, headBasis, litLike, PI, prog, reset, sheetRect, turnBasis } from './creature-kit';

const S = 'blaze';

/** Rings of rods: [radius, centre height, direction, speed]. */
const RINGS: ReadonlyArray<readonly [number, number, number, number]> = [
  [9, 15, 1, 1],
  [7, 9.5, -1, 1.3],
  [5, 4, 1, 1.6],
];

/** The four side faces of a flame sheet window sliding up over time (top and bottom open). */
function flameFaces(time: number, speed: number, phase: number): TexRect[] {
  const f = (i: number): TexRect => {
    const off = (((time * speed + phase + i * 4.3) % 16) + 16) % 16;
    return sheetRect(S, 0, 32 - off, 16, 16);
  };
  // part() skips null faces (the column is open at top and bottom).
  return [f(0), f(1), null, null, f(2), f(3)] as unknown as TexRect[];
}

export function blazeModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 28;
  const alive = a.deathT < 0;
  const p = prog(a);
  const shoot = a.act === 'shoot' && alive;
  const charge = a.act === 'charge' && alive;
  // Heat: 0 idle, rising through a charge, full while shooting.
  const heat = charge ? 0.35 + p * 0.65 : shoot ? 1 : 0;
  const bob = alive ? Math.sin(time * 2 + a.z) * 1.3 + 1.2 : 0;
  const o: Vec3 = [a.x, a.y + bob * px, a.z];
  const basis = bodyBasis(a);
  const flicker = Math.sin(time * 13 + a.x) * 0.03 + Math.sin(time * 7.3) * 0.03;
  b.flash = flashOf(a);
  // The head: self-lit, eyes on you.
  b.emit = 0.1 + heat * 0.2 + flicker;
  const neck = at(o, basis, px, 0, 20, 0);
  const hb = pitchBasis(headBasis(a, basis), Math.sin(time * 1.4 + a.x) * 0.05);
  part(b, neck, hb, px, 0, 4, 0, 8, 8, 8, uvs(S, 0, 0, 8, 8, 8));
  // Twelve rods in three rings, each ring spinning its own way; faster and hotter when shooting.
  const spin = shoot ? 7 : charge ? 2 + p * 4 : 1.4;
  b.emit = 0.3 + heat * 0.5 + flicker;
  const rodUv = uvs(S, 32, 0, 2, 8, 2);
  for (let k = 0; k < RINGS.length; k += 1) {
    const [radius, y, dir, speed] = RINGS[k]!;
    const turn = dir * time * spin * speed + k * PI * 0.25 + a.x;
    for (let j = 0; j < 4; j += 1) {
      const ang = turn + j * PI * 0.5;
      const r = radius * (shoot ? 1.12 : 1);
      const c = at(o, basis, px, Math.cos(ang) * r, y + Math.sin(time * 3 + j * 1.7 + k) * 0.8, Math.sin(ang) * r);
      part(b, c, turnBasis(basis, ang), px, 0, 0, 0, 2, 8, 2, rodUv);
    }
  }
  b.emit = 0;
  b.flash = 0;
  const s = L.soft;
  if (!s || !alive) return;
  // A flame aura round the rods and the head (two turned shells make a rounder column).
  litLike(s, b, a);
  s.flash = 0;
  s.flags = F_OVERLAY | F_UNLIT;
  s.emit = 0.05 + heat * 0.15;
  s.alpha = 0.13 + heat * 0.1 + flicker;
  for (const k of [0, PI / 4]) {
    const fb = turnBasis(basis, k + time * 0.6);
    part(s, o, fb, px, 0, 10, 0, 17, 20, 17, flameFaces(time, 11, k * 7));
  }
  s.alpha = 0.08 + heat * 0.08;
  part(s, neck, hb, px, 0, 4.5, 0, 10.5, 10.5, 10.5, flameFaces(time, 9, 3));
  // Smoke curling up off the head, fading as it rises.
  s.flags = F_OVERLAY;
  s.emit = 0;
  s.tint = [0.42, 0.38, 0.36];
  const puff = uvs(S, 40, 0, 4, 4, 4);
  for (let i = 0; i < 3; i += 1) {
    const t = (time * (0.55 + heat * 0.4) + i / 3 + a.x * 0.1) % 1;
    s.alpha = 0.32 * (1 - t) * Math.min(1, t * 6);
    const sz = 2.5 + t * 4;
    const c = at(neck, basis, px, Math.sin(i * 2.4 + time * 0.7) * 2.5, 9 + t * 12, Math.cos(i * 1.9 + time * 0.5) * 2.5);
    part(s, c, turnBasis(basis, t * 2 + i), px, 0, 0, 0, sz, sz, sz, puff);
  }
  reset(s);
}
