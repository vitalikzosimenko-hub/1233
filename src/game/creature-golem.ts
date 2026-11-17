// The iron golem: tall and broad-chested, arms hanging to its knees, a small head with a long nose
// under a heavy brow. It plods with its arms swinging, brings both arms up and down for a blow,
// and holds out a poppy when it is at peace. Also the Slime King's golden crown (its texture shares
// the golem sheet).
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import type { Vec3 } from './math3d';
import { add, bodyBasis, flashOf, limb, part, pitchBasis, rollBasis, scale, uvs, yawBasis } from './models';
import type { MobLayers } from './models-mobs';
import { at, clamp01, dirIn, headOn, limbEnd, moving, rod, stride } from './creature-kit';

export function golemModel(b: MeshBuilder, _L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 43;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  const alive = a.deathT < 0;
  b.flash = flashOf(a);
  const swing = stride(a, 0.55, 0.8);
  // The blow: both arms flung up, then brought down together.
  const q = alive && a.attackTimer > 0.6 ? 1 - clamp01((a.attackTimer - 0.6) / 0.4) : -1;
  const blow = q >= 0 ? (q < 0.3 ? -2.1 * (q / 0.3) : -2.1 * (1 - (q - 0.3) / 0.7)) : 0;
  const rose = a.aux > 0 && q < 0 && alive;
  const legUv = uvs('golem2', 20, 0, 6, 16, 5);
  limb(b, o, basis, px, [0.5, 16, -4.5], swing, 6, 16, 5, legUv);
  limb(b, o, basis, px, [0.5, 16, 4.5], -swing, 6, 16, 5, legUv);
  // A heavy sway from side to side with each step.
  const sway = moving(a) ? Math.sin(a.walkPhase * Math.PI * 0.8) * 0.045 : 0;
  const tb = rollBasis(pitchBasis(basis, q >= 0 ? -blow * 0.04 : 0), sway);
  const hip = at(o, basis, px, 0, 16, 0);
  part(b, hip, tb, px, 0, 2.5, 0, 9, 5, 6, uvs('golem', 0, 41, 9, 5, 6));
  part(b, hip, tb, px, 0.5, 11, 0, 18, 12, 11, uvs('golem', 0, 18, 18, 12, 11));
  const armUv = uvs('golem2', 0, 0, 4, 30, 6);
  let left = -swing * 0.9;
  let right = swing * 0.9;
  if (q >= 0) left = right = blow;
  else if (rose) right = -0.55 + Math.sin(time * 1.3 + a.x) * 0.03;
  else {
    const idle = Math.sin(time * 0.9 + a.z) * 0.03;
    left += idle;
    right -= idle;
  }
  limb(b, hip, tb, px, [0, 17.5, -11], left, 4, 30, 6, armUv);
  limb(b, hip, tb, px, [0, 17.5, 11], right, 4, 30, 6, armUv);
  const neck = at(hip, tb, px, 2, 15, 0);
  const hb = headOn(a, tb, 0.9, 0.7);
  part(b, neck, hb, px, 1.5, 7, 0, 8, 10, 8, uvs('golem', 0, 0, 8, 10, 8));
  part(b, neck, hb, px, 6.5, 3, 0, 2, 4, 2, uvs('golem', 32, 0, 2, 4, 2));
  // The poppy, held out in the right hand.
  if (rose) {
    const hand = limbEnd(hip, tb, px, [0, 17.5, 11], right, 28.5);
    const dir = dirIn(tb, 0.9, 0.55, 0);
    const top = add(hand.at, scale(dir, 5 * px));
    rod(b, hand.at, top, 0.7 * px, 0.7 * px, tb.r, uvs('golem2', 42, 6, 1, 5, 1));
    part(b, top, pitchBasis(tb, 0.6), px, 0, 0.6, 0, 3, 2, 3, uvs('golem2', 42, 0, 3, 2, 3));
  }
  b.flash = 0;
}

/**
 * A golden blocky king's crown: a band with four corner points and a red gem on the front.
 * `top` is the middle of its bottom edge, `size` its width in blocks, `yaw` the way it faces.
 */
export function crown(b: MeshBuilder, top: Vec3, yaw: number, size: number): void {
  const basis = yawBasis(yaw);
  const px = size / 8;
  const emit = b.emit;
  b.emit = 0.12;
  part(b, top, basis, px, 0, 1.5, 0, 8, 3, 8, uvs('golem', 30, 41, 8, 3, 8));
  const pt = uvs('golem', 30, 52, 2, 2, 2);
  for (const fx of [-3.1, 3.1]) {
    for (const fz of [-3.1, 3.1]) {
      part(b, top, basis, px, fx, 4, fz, 1.8, 2, 1.8, pt);
      part(b, top, basis, px, fx, 5.5, fz, 1, 1, 1, pt);
    }
  }
  // Smaller points mid-side.
  for (const [fx, fz] of [[4.05, 0], [-4.05, 0], [0, 4.05], [0, -4.05]] as const) part(b, top, basis, px, fx * 0.98, 3.4, fz * 0.98, fz === 0 ? 1.4 : 1, 1, fz === 0 ? 1 : 1.4, pt);
  b.emit = 0.35;
  part(b, top, basis, px, 4.1, 1.5, 0, 1.6, 1.6, 0.6, uvs('golem', 38, 52, 1, 1, 1));
  b.emit = emit;
}
