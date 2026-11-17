// The new folk, part two: the desert camel (tall two-jointed legs, a saddled hump, a long curved
// neck, pacing gait) and the swamp frog (flat wide head, eyes on top, long hind legs that fold
// under it and stretch out as it hops, a throat that puffs).
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import type { Vec3 } from './math3d';
import { bodyBasis, flashOf, limb, part, pitchBasis, rollBasis, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, clamp01, headOn, lerp, limbEnd, moving, PI, stretch } from './creature-kit';

export function camelModel(b: MeshBuilder, _L: MobLayers, a: Actor, time: number): void {
  const S = 'camel';
  const px = a.h / 41.5;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  const walk = moving(a, 0.15);
  b.flash = flashOf(a);
  // Pacing: both legs of a side move together; the knee folds as a leg swings forward.
  const ph = a.walkPhase * PI;
  const upUv = uvs(S, 48, 26, 4, 16, 4);
  for (const [fx, fz] of [[9, -4.5], [9, 4.5], [-9, -4.5], [-9, 4.5]] as const) {
    const side = fz < 0 ? 0 : PI;
    const sw = walk ? Math.sin(ph + side) * 0.45 : 0;
    const bend = walk ? Math.max(0, Math.cos(ph + side)) * 0.8 : 0;
    limb(b, o, basis, px, [fx, 20, fz], sw, 5, 10, 5, upUv);
    const kn = limbEnd(o, basis, px, [fx, 20, fz], sw, 10).at;
    limb(b, kn, basis, px, [0, 0.3, 0], sw + bend * (fx > 0 ? 1 : -0.6), 4, 10.3, 4, upUv);
  }
  const sway = walk ? Math.sin(ph) * 0.03 : 0;
  const tb = rollBasis(basis, sway);
  part(b, o, tb, px, 0, 25.5, 0, 15, 11, 27, uvs(S, 0, 0, 10, 8, 18));
  part(b, o, tb, px, -1.5, 33, 0, 9, 5, 11, uvs(S, 0, 26, 6, 4, 8));
  // The saddle over the hump: a seat, flaps down the sides, a horn at the front.
  part(b, o, tb, px, -1.5, 35.9, 0, 10, 1.6, 9, uvs(S, 0, 52, 8, 2, 10));
  for (const side of [-1, 1]) part(b, o, tb, px, -1.5, 31.5, side * 5.1, 0.8, 7.5, 8, uvs(S, 0, 52, 8, 2, 10));
  part(b, o, tb, px, 3.5, 37.2, 0, 1.6, 2, 1.6, uvs(S, 56, 0, 2, 1, 2));
  limb(b, o, tb, px, [-13.6, 28, 0], 0.15 + Math.sin(time * 1.5 + a.x) * 0.15, 1.5, 9, 1.5, uvs(S, 56, 4, 1, 8, 1));
  // The neck rises from the chest, curving forward; the head stays level.
  const nod = walk ? Math.sin(ph * 2) * 0.05 : Math.sin(time * 0.8 + a.z) * 0.04;
  const nb = pitchBasis(headOn(a, tb, 0.5, 0.2), 0.32 + nod);
  const base = at(o, tb, px, 12, 26, 0);
  part(b, base, nb, px, 0, 5.5, 0, 6, 13, 6, uvs(S, 28, 26, 5, 14, 5));
  const top = at(base, nb, px, 0, 11.5, 0);
  const chew = !walk && Math.sin(time * 0.5 + a.x) > 0.3 ? Math.sin(time * 8) * 0.05 : 0;
  const hb = pitchBasis(headOn(a, tb, 1, 0.5), -0.08 + chew);
  part(b, top, hb, px, 3, 0.5, 0, 7, 6, 11, uvs(S, 0, 38, 5, 5, 9));
  for (const side of [-1, 1]) part(b, at(top, hb, px, -1, 3.5, side * 3.6), rollBasis(hb, side * 0.5), px, 0, 0.5, 0, 2, 1, 2, uvs(S, 56, 0, 2, 1, 2));
  b.flash = 0;
}

export function frogModel(b: MeshBuilder, _L: MobLayers, a: Actor, time: number): void {
  const S = 'frog';
  const px = a.h / 9.5;
  const alive = a.deathT < 0;
  const air = !a.onGround && alive;
  const ext = air ? clamp01(0.35 + a.vy / 5) : 0;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = pitchBasis(bodyBasis(a), air ? -0.4 * clamp01(a.vy / 4) + 0.2 * clamp01(-a.vy / 6) : 0);
  b.flash = flashOf(a);
  part(b, o, basis, px, -0.5, 3, 0, 7, 4, 8, uvs(S, 0, 0, 7, 4, 8));
  const hb = headOn(a, basis, 0.5, 0.3);
  const neck = at(o, basis, px, 1, 4.5, 0);
  part(b, neck, hb, px, 1, 1.5, 0, 8, 3, 7, uvs(S, 0, 12, 8, 3, 7));
  // Eyes on top, blinking now and then.
  const blink = Math.sin(time * 0.7 + a.x * 5) > 0.985 ? 0.4 : 1;
  for (const side of [-1, 1]) part(b, neck, hb, px, 2.5, 4 + blink * 0.5 - 0.5, side * 2.5, 3, 2 * blink, 3, uvs(S, 32, 0, 3, 2, 3));
  // The throat puffs as it croaks.
  const croak = alive && !air && Math.sin(time * 0.9 + a.z * 3) > 0.55 ? Math.max(0, Math.sin(time * 13)) : 0;
  part(b, neck, stretch(hb, 1 + croak * 0.3, 1 + croak * 0.8, 1 + croak * 0.25), px, 3 / (1 + croak * 0.3), -0.4, 0, 4, 1.4, 3, uvs(S, 40, 17, 4, 2, 3));
  // Front legs.
  for (const side of [-1, 1]) {
    limb(b, o, basis, px, [2.5, 2.4, side * 3.2], air ? -0.6 : -0.15, 1.5, 2.4, 1.5, uvs(S, 32, 5, 2, 3, 2), side * 0.2);
    part(b, o, basis, px, 3.4, 0.3, side * 3.6, 2.6, 0.6, 2.6, uvs(S, 44, 8, 4, 1, 4));
  }
  // Hind legs: folded forward along the sides, stretched back in the air.
  for (const side of [-1, 1]) {
    const thigh = lerp(-1.35, 1.0, ext);
    const shin = lerp(1.25, 0.7, ext);
    const hip: Vec3 = [-2.8, 2.6, side * 3.7];
    limb(b, o, basis, px, hip, thigh, 2.6, 5, 2.6, uvs(S, 44, 0, 3, 5, 3));
    const kn = limbEnd(o, basis, px, hip, thigh, 4.6).at;
    limb(b, kn, basis, px, [0, 0, 0], shin, 1.7, 4, 1.7, uvs(S, 32, 17, 2, 4, 2));
    const ft = limbEnd(kn, basis, px, [0, 0, 0], shin, 3.8).at;
    part(b, ft, pitchBasis(basis, ext * 0.9), px, -1.4, 0, side * 0.3, 3.2, 0.6, 3.6, uvs(S, 44, 8, 4, 1, 4));
  }
  b.flash = 0;
}
