// The new folk, part one: the wandering trader (a villager in a deep blue robe and hood, arms
// folded) and his pack llamas (long necks, tall ears, fluffy coats, a bright carpet and two chests).
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import type { Vec3 } from './math3d';
import { bodyBasis, flashOf, limb, part, pitchBasis, rollBasis, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, headBasis, headOn, litLike, moving, PI, reset, stride, turnBasis } from './creature-kit';

export function traderModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const S = 'wtrader';
  const px = a.h / 30;
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const bob = moving(a) ? Math.abs(Math.sin(a.walkPhase * PI)) * 0.6 : 0;
  const o: Vec3 = [a.x, a.y + bob * px, a.z];
  const rb = rollBasis(basis, stride(a, 0.05));
  part(b, o, rb, px, 0, 10, 0, 8, 20, 6, uvs(S, 0, 20, 8, 20, 6));
  // Arms folded across the robe (Minecraft's villager pose).
  const ab = pitchBasis(rb, -0.75);
  const ap = at(o, rb, px, 0.5, 17.5, 0);
  for (const side of [-1, 1]) part(b, ap, ab, px, 0, -2, side * 6, 4, 8, 4, uvs(S, 32, 28, 4, 8, 4));
  part(b, ap, ab, px, 0, -4, 0, 8, 4, 4, uvs(S, 32, 20, 8, 4, 4));
  const neck = at(o, rb, px, 0, 20, 0);
  const hb = pitchBasis(headBasis(a, rb), Math.sin(time * 0.9 + a.x) * 0.05);
  part(b, neck, hb, px, 0, 5, 0, 8, 10, 8, uvs(S, 0, 0, 8, 10, 8));
  part(b, neck, hb, px, 5, 2, 0, 2, 4, 2, uvs(S, 24, 0, 2, 4, 2));
  b.flash = 0;
  // The hood over the head (cut-out: open at the face).
  const c = L.cut;
  if (!c) return;
  litLike(c, b, a);
  part(c, neck, hb, px, -0.15, 5.3, 0, 8.9, 10.7, 8.9, uvs(S, 32, 0, 8, 10, 8));
  reset(c);
}

export function llamaModel(b: MeshBuilder, _L: MobLayers, a: Actor, time: number): void {
  const S = 'llama';
  const px = a.h / 34;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  const walk = moving(a, 0.15);
  b.flash = flashOf(a);
  const swing = stride(a, 0.6);
  const legUv = uvs(S, 28, 26, 4, 14, 4);
  for (const [fx, fz, s] of [[6.5, -3.5, 1], [6.5, 3.5, -1], [-6.5, -3.5, -1], [-6.5, 3.5, 1]] as const) limb(b, o, basis, px, [fx, 14, fz], swing * s, 4, 14, 4, legUv);
  part(b, o, basis, px, 0, 19, 0, 12, 10, 18, uvs(S, 0, 0, 12, 10, 16));
  // A chest strapped to each flank, swaying as it walks.
  const jog = walk ? Math.sin(a.walkPhase * PI * 2) * 0.05 : 0;
  for (const side of [-1, 1]) part(b, at(o, basis, px, -3, 19.5, side * 7.6), rollBasis(turnBasis(basis, side * PI * 0.5), jog), px, 0, 0, 0, 8, 8, 3, uvs(S, 0, 50, 8, 8, 3));
  part(b, o, pitchBasis(basis, -0.25 + Math.sin(time * 1.7 + a.x) * 0.06), px, -9.8, 22, 0, 4, 5, 2, uvs(S, 44, 31, 4, 5, 2));
  // The neck and head: bobbing as it walks, nodding and chewing when it stands.
  const nod = walk ? Math.sin(a.walkPhase * PI * 2) * 0.06 : Math.sin(time * 1.1 + a.z) * 0.04;
  const nb = pitchBasis(headOn(a, basis, 0.8, 0.4), nod);
  const root = at(o, basis, px, 7.5, 16, 0);
  part(b, root, nb, px, 0.5, 7.5, 0, 7, 16, 6, uvs(S, 0, 26, 8, 18, 6));
  const chewing = !walk && Math.sin(time * 0.45 + a.x * 3) > 0.2;
  const chew = chewing ? Math.sin(time * 11) * 0.35 : 0;
  part(b, root, nb, px, 7, 13.5 + chew * 0.3, chew * 0.25, 4, 4, 7, uvs(S, 28, 44, 4, 4, 9));
  for (const side of [-1, 1]) {
    const flick = Math.max(0, Math.sin(time * 2.3 + side * 1.3 + a.x) - 0.92) * 4;
    part(b, at(root, nb, px, 1.5, 15.5, side * 2.3), rollBasis(nb, side * (0.12 + flick * 0.3)), px, 0, 1.5, 0, 2.5, 3, 1.5, uvs(S, 44, 26, 3, 3, 2));
  }
  b.flash = 0;
}
