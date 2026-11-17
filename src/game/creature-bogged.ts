// The bogged: a swamp skeleton of mossy green-grey bone, red and brown mushrooms sprouting from
// its skull, vines tangled in its ribs; it draws its bow like a skeleton.
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import { normalize, type Vec3 } from './math3d';
import { add, beam, bodyBasis, flashOf, limb, part, scale, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { tileRect } from './mesher';
import { at, headBasis, limbEnd, litLike, PI, prog, reset, stride } from './creature-kit';

const S = 'bogged';

/** Mushrooms on the skull: [forward, right, stem height, cap width, cap height, red]. */
const SHROOMS: ReadonlyArray<readonly [number, number, number, number, number, boolean]> = [
  [-0.8, 2.2, 2.2, 4, 2, true],
  [2.4, -2.6, 1.4, 2.6, 1.4, true],
  [-2.6, -1.6, 1.8, 4.4, 1, false],
  [1, 0.6, 0.9, 2.6, 0.9, false],
];

export function boggedModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 32;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  const alive = a.deathT < 0;
  b.flash = flashOf(a);
  const swing = stride(a, 0.6);
  const legUv = uvs(S, 0, 16, 2, 12, 2);
  limb(b, o, basis, px, [0, 12, -2], swing, 2, 12, 2, legUv);
  limb(b, o, basis, px, [0, 12, 2], -swing, 2, 12, 2, legUv);
  part(b, o, basis, px, 0, 18, 0, 8, 12, 4, uvs(S, 16, 16, 8, 12, 4));
  // The bow arm points at you; the draw arm pulls the string back to the cheek.
  const draw = a.act === 'draw' && alive ? prog(a) : 0;
  const aim = -PI / 2 + Math.sin(time * 2 + a.x) * 0.04 - a.headPitch * 0.8;
  const armUv = uvs(S, 40, 16, 2, 12, 2);
  limb(b, o, basis, px, [0, 22, -5], aim, 2, 12, 2, armUv, -0.25);
  limb(b, o, basis, px, [0, 22, 5], aim + 0.2 + draw * 0.35, 2, 12, 2, armUv, 0.35 + draw * 0.4);
  const neck = at(o, basis, px, 0, 24, 0);
  const hb = headBasis(a, basis);
  part(b, neck, hb, px, 0, 4, 0, 8, 8, 8, uvs(S, 0, 0, 8, 8, 8));
  // Mushrooms sprouting from the crown, nodding a little as it walks.
  const nod = Math.sin(time * 2.3 + a.x) * 0.5 + swing * 0.8;
  for (const [fx, fz, stem, cw, ch, red] of SHROOMS) {
    const top = at(neck, hb, px, fx, 8, fz);
    part(b, top, hb, px, 0, stem / 2, 0, 1, stem, 1, uvs(S, 32, 32, 1, 2, 1));
    const cap = at(top, hb, px, nod * 0.15, stem + ch / 2, 0);
    part(b, cap, hb, px, 0, 0, 0, cw, ch, cw, red ? uvs(S, 0, 32, 3, 2, 3) : uvs(S, 16, 32, 4, 1, 4));
  }
  // The bow: three bent staves in the left hand (bending further at full draw), its string and an arrow.
  const bowHand = limbEnd(o, basis, px, [0, 22, -5], aim, 11, -0.25).at;
  const bf = normalize(add(basis.f, scale(basis.u, -Math.sin(a.headPitch) * 0.8)));
  const bu = normalize(add(basis.u, scale(basis.f, Math.sin(a.headPitch) * 0.8)));
  const wood = [tileRect('planks_spruce')];
  const bend = 0.25 + draw * 0.25;
  const tips: Vec3[] = [];
  for (const [dy, kk] of [[-5, -bend], [0, 0], [5, bend]] as const) {
    const c = add(bowHand, add(scale(bu, dy * px), scale(bf, -Math.abs(dy) * (0.3 + draw * 0.3) * px)));
    b.box(c, scale(bf, 0.6 * px), scale(normalize(add(bu, scale(bf, kk))), 3 * px), scale(basis.r, 0.6 * px), wood);
    if (dy !== 0) tips.push(add(c, add(scale(bu, Math.sign(dy) * 2.8 * px), scale(bf, -Math.abs(dy) * 0.25 * px))));
  }
  const nock = add(bowHand, scale(bf, -(1.4 + draw * 5) * px));
  const silk = [tileRect('wool_white')];
  for (const t of tips) beam(b, t, nock, 0.012, silk, 0.012);
  if (draw > 0.15) {
    beam(b, nock, add(nock, scale(bf, 9 * px)), 0.02, [tileRect('planks_oak')], 0.02);
    b.box(add(nock, scale(bf, 9.4 * px)), scale(bf, 0.5 * px), scale(bu, 0.6 * px), scale(basis.r, 0.6 * px), [tileRect('iron_block')]);
  }
  b.flash = 0;
  // Moss over the skull, vines through the ribs, a strand or two hanging loose.
  const c = L.cut;
  if (!c) return;
  litLike(c, b, a);
  part(c, neck, hb, px, 0, 4, 0, 8.8, 8.8, 8.8, uvs(S, 32, 0, 8, 8, 8));
  part(c, o, basis, px, 0, 18, 0, 8.7, 12.5, 4.7, uvs(S, 16, 40, 8, 12, 4));
  const vine = uvs(S, 44, 32, 2, 8, 1);
  const drift = (i: number): number => Math.sin(time * 1.6 + i * 2.1 + a.z) * 0.12 + (Math.hypot(a.vx, a.vz) > 0.2 ? 0.2 : 0);
  limb(c, o, basis, px, [-2.4, 23, -2.5], drift(0), 2, 8, 0.4, vine, -0.1);
  limb(c, o, basis, px, [2.4, 15, 3], drift(1) - 0.1, 2, 7, 0.4, vine, 0.05);
  limb(c, neck, hb, px, [-3, 8.2, 4.4], drift(2) * 0.5, 2, 6, 0.4, vine, 0.1);
  reset(c);
}
