// The drowned: a swamp zombie, waterlogged teal skin under torn cyan-and-brown rags hung with
// seaweed, faint cyan eyes, and a three-pronged trident carried low or raised overhead to throw.
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import { normalize, type Vec3 } from './math3d';
import { add, bodyBasis, flashOf, limb, part, pitchBasis, scale, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, dirIn, headBasis, limbEnd, litLike, PI, prog, reset, rod, stride, sub, dot } from './creature-kit';

const S = 'drowned';

/** A trident gripped at `grip`, its points along `along`, its prongs spread across `side`. */
export function trident(b: MeshBuilder, grip: Vec3, along: Vec3, side: Vec3, px: number): void {
  const t = normalize(along);
  const shaft = uvs(S, 56, 16, 1, 12, 1);
  const prong = uvs(S, 60, 16, 1, 4, 1);
  const bar = uvs(S, 0, 48, 5, 1, 1);
  const head = add(grip, scale(t, 13 * px));
  rod(b, add(grip, scale(t, -9 * px)), head, 0.9 * px, 0.9 * px, side, shaft);
  const r = normalize(sub(side, scale(t, dot(side, t))));
  rod(b, add(head, scale(r, -2.7 * px)), add(head, scale(r, 2.7 * px)), 1.1 * px, 1.1 * px, t, bar);
  for (const k of [-2.2, 0, 2.2]) {
    const base = add(head, scale(r, k * px));
    rod(b, base, add(base, scale(t, (k === 0 ? 6.5 : 4.5) * px)), 0.8 * px, 0.8 * px, r, prong);
    // Barbs on the outer prongs, flaring out.
    if (k !== 0) {
      const tip = add(base, scale(t, 3.6 * px));
      rod(b, tip, add(tip, add(scale(r, Math.sign(k) * 0.9 * px), scale(t, -0.8 * px))), 0.6 * px, 0.6 * px, t, prong);
    }
  }
  // The pommel at the butt.
  const butt = add(grip, scale(t, -9 * px));
  rod(b, butt, add(butt, scale(t, -1.2 * px)), 1.4 * px, 1.4 * px, side, bar);
}

export function drownedModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 32;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  const alive = a.deathT < 0;
  b.flash = flashOf(a);
  const swing = stride(a, 0.7);
  const tp = a.act === 'throw' && alive ? prog(a) : -1;
  // Melee exactly as a zombie: arms rise as the blow winds up, drop after it lands.
  const windup = a.windup > 0 && a.actDur > 0 && alive ? (1 - a.windup / a.actDur) * 0.75 : 0;
  const struck = a.attackTimer > 0.7 && alive;
  const melee = windup > 0 || struck;
  const reach = -PI / 2 + Math.sin(time * 3 + a.x) * 0.08 + (struck ? -0.35 : 0) - windup;
  const sway = Math.sin(time * 2.1 + a.z) * 0.05;
  // Throwing it leans back to wind up, then lunges into the cast.
  const lean = tp >= 0 ? (tp < 0.7 ? -0.14 * (tp / 0.7) : -0.14 + ((tp - 0.7) / 0.3) * 0.34) : 0;
  const legUv = uvs(S, 0, 16, 4, 12, 4);
  limb(b, o, basis, px, [0, 12, -2], swing, 4, 12, 4, legUv);
  limb(b, o, basis, px, [0, 12, 2], -swing, 4, 12, 4, legUv);
  const hip = at(o, basis, px, 0, 12, 0);
  const tb = pitchBasis(basis, lean);
  part(b, hip, tb, px, 0, 6, 0, 8, 12, 4, uvs(S, 16, 16, 8, 12, 4));
  let right: number;
  if (tp >= 0) right = tp < 0.7 ? -0.3 - (tp / 0.7) * 2.75 : -3.05 + ((tp - 0.7) / 0.3) * 1.95;
  else if (melee) right = reach - sway;
  else right = -0.42 + Math.sin(time * 1.7 + a.x) * 0.05 - swing * 0.3;
  const left = tp >= 0 ? -0.8 - Math.sin(tp * PI) * 0.35 : reach + sway;
  const armUv = uvs(S, 40, 16, 4, 12, 4);
  limb(b, hip, tb, px, [0, 10, -6], left, 4, 12, 4, armUv);
  limb(b, hip, tb, px, [0, 10, 6], right, 4, 12, 4, armUv);
  const neck = at(hip, tb, px, 0, 12, 0);
  const hb = pitchBasis(headBasis(a, tb), Math.sin(time * 1.3 + a.z) * 0.08 + lean * 0.5);
  part(b, neck, hb, px, 0, 4, 0, 8, 8, 8, uvs(S, 0, 0, 8, 8, 8));
  // The trident: low in the hand, levelled for a jab, or overhead for the throw (gone once loosed).
  if (tp < 0.86) {
    const hand = limbEnd(hip, tb, px, [0, 10, 6], right, 11);
    let along: Vec3;
    if (tp >= 0) {
      const e = (tp < 0.7 ? 0.3 + (tp / 0.7) * 0.5 : 0.8 - ((tp - 0.7) / 0.3) * 0.85) + a.headPitch * 0.7;
      along = dirIn(tb, Math.cos(e), Math.sin(e), 0);
    } else if (melee) along = scale(hand.frame.u, -1);
    else along = hand.frame.f;
    trident(b, hand.at, along, tb.r, px);
  }
  b.flash = 0;
  // Rags over the body and limbs, wet hair hung with weed, and strands of kelp trailing.
  const c = L.cut;
  if (!c) return;
  litLike(c, b, a);
  const legO = uvs(S, 0, 32, 4, 12, 4);
  limb(c, o, basis, px, [0, 12.2, -2], swing, 4.6, 12.3, 4.6, legO);
  limb(c, o, basis, px, [0, 12.2, 2], -swing, 4.6, 12.3, 4.6, legO);
  part(c, hip, tb, px, 0, 6, 0, 8.6, 12.5, 4.6, uvs(S, 16, 32, 8, 12, 4));
  const armO = uvs(S, 40, 32, 4, 12, 4);
  limb(c, hip, tb, px, [0, 10.25, -6], left, 4.6, 12.4, 4.6, armO);
  limb(c, hip, tb, px, [0, 10.25, 6], right, 4.6, 12.4, 4.6, armO);
  part(c, neck, hb, px, 0, 4, 0, 8.9, 8.9, 8.9, uvs(S, 32, 0, 8, 8, 8));
  const kelp = uvs(S, 16, 48, 2, 12, 2);
  const drift = (i: number): number => Math.sin(time * 1.8 + i * 1.7 + a.x) * 0.14 + (Math.hypot(a.vx, a.vz) > 0.2 ? 0.25 : 0);
  limb(c, hip, tb, px, [-2.3, 1.5, 2.6], drift(0), 1.6, 9, 1.6, kelp, 0.08);
  limb(c, hip, tb, px, [2.4, 0.8, -1.8], drift(1) - 0.1, 1.6, 7, 1.6, kelp, -0.06);
  limb(c, hip, tb, px, [-2.4, 11.5, -3.2], drift(2), 1.6, 8, 1.6, kelp, -0.12);
  limb(c, neck, hb, px, [-2.5, 8, 4.2], drift(3) * 0.6, 1.6, 10, 1.6, kelp, 0.1);
  reset(c);
}
