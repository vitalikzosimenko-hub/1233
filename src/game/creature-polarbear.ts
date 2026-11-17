// The polar bear: a long white body on short thick legs, a heavy head with a black-nosed snout
// and small round ears. It lumbers along, rears up on its hind legs to roar (front paws raised,
// jaws wide), and swipes with a forepaw as it strikes.
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import type { Vec3 } from './math3d';
import { add, bodyBasis, flashOf, limb, part, pitchBasis, scale, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, clamp01, headOn, moving, prog, stride, sub } from './creature-kit';

const S = 'polarbear';

export function polarBearModel(b: MeshBuilder, _L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 23;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  const alive = a.deathT < 0;
  b.flash = flashOf(a);
  const p = prog(a);
  const roar = a.act === 'roar' && alive ? p : -1;
  // Up onto the hind legs, hold the roar, drop back down.
  const rear = roar >= 0 ? Math.sin(Math.min(1, roar / 0.35) * Math.PI * 0.5) * Math.min(1, (1 - roar) / 0.2) : 0;
  const swipe = alive && a.attackTimer > 0.7 ? Math.sin((1 - clamp01((a.attackTimer - 0.7) / 0.3)) * Math.PI) : 0;
  const swing = stride(a, 0.55) * (1 - rear);
  const legUv = uvs(S, 40, 28, 4, 10, 4);
  // Hind legs stay planted under the hips.
  limb(b, o, basis, px, [-7.5, 10, -4.3], swing + rear * 0.15, 5, 10, 5, legUv);
  limb(b, o, basis, px, [-7.5, 10, 4.3], -swing + rear * 0.15, 5, 10, 5, legUv);
  // Everything else pivots up about the hips as it rears.
  const ub = pitchBasis(basis, -rear * 1.05);
  const hip = at(o, basis, px, -7.5, 10, 0);
  const uo = sub(hip, add(scale(ub.f, -7.5 * px), scale(ub.u, 10 * px)));
  // A heavy roll of the shoulders as it walks.
  const heave = moving(a) ? Math.sin(a.walkPhase * Math.PI * 2) * 0.3 : Math.sin(time * 1.2 + a.x) * 0.15;
  part(b, uo, ub, px, -4, 15.5, 0, 14, 11, 16, uvs(S, 0, 0, 14, 12, 16));
  part(b, uo, ub, px, 6, 16 + heave * 0.5, 0, 13, 12, 10, uvs(S, 0, 28, 12, 13, 8));
  part(b, uo, ub, px, -12.4, 18.5, 0, 3, 3, 2, uvs(S, 50, 49, 2, 2, 1));
  // Front legs: walking, raised and pawing as it rears, or one swiping down.
  let left = -swing;
  let right = swing;
  if (rear > 0) {
    const paw = Math.sin(time * 7) * 0.25 * rear;
    left = -0.9 * rear + paw;
    right = -0.9 * rear - paw;
  }
  if (swipe > 0) right = -1.7 * swipe;
  limb(b, uo, ub, px, [7, 10, -4.3], left, 5, 10, 5, legUv);
  limb(b, uo, ub, px, [7, 10, 4.3], right, 5, 10, 5, legUv);
  // The head: it keeps looking ahead as the body rears, lunges into a swipe.
  const neck = at(uo, ub, px, 10.5, 17 + heave * 0.5, 0);
  const nod = (moving(a) ? Math.sin(a.walkPhase * Math.PI * 2) * 0.05 : Math.sin(time * 1.1 + a.z) * 0.04) + rear * 0.75 + swipe * 0.25;
  const hb = pitchBasis(headOn(a, ub, 0.8, 0.6), nod);
  part(b, neck, hb, px, 3.5, 0.5, 0, 7, 7, 7, uvs(S, 0, 49, 7, 7, 7));
  part(b, neck, hb, px, 8.5, -1, 0, 5, 2.4, 3.2, uvs(S, 28, 49, 5, 3, 3));
  const open = rear > 0 ? rear * 0.65 + Math.sin(time * 20) * 0.04 * rear : swipe * 0.35 + Math.max(0, Math.sin(time * 0.6 + a.x) - 0.9) * 2;
  part(b, at(neck, hb, px, 7, -2.2, 0), pitchBasis(hb, open), px, 1.5, -0.6, 0, 4.6, 1.2, 3, uvs(S, 28, 55, 5, 1, 3));
  for (const side of [-1, 1]) part(b, neck, hb, px, 2.5, 4.6, side * 2.6, 2, 2, 1, uvs(S, 44, 49, 2, 2, 1));
  b.flash = 0;
}
