// The Ravager King's iron armour: a forehead plate with a gold-trimmed crest, a plate over the
// crown of the head, two flank plates a side and a spine plate, drawn on the cut-out layer over
// ravagerModel (whose frame is in blocks; the king is that model scaled by a.h / 2.2 about its
// feet). The head pose follows ravagerModel's exactly.
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import type { Vec3 } from './math3d';
import { bodyBasis, part, pitchBasis, rollBasis, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, litLike, PI, prog, reset, turnBasis } from './creature-kit';

const S = 'ravking';

/**
 * Draws the plates; pass the body's builder as `body` to light them like it (otherwise L.cut keeps
 * whatever light it was last given).
 */
export function ravagerArmor(L: MobLayers, a: Actor, time: number, body?: MeshBuilder): void {
  const c: MeshBuilder | null = L.cut;
  if (!c) return;
  const s = a.h / 2.2;
  const alive = a.deathT < 0;
  const p = prog(a);
  const stunned = a.act === 'stunned' && alive;
  const roar = a.act === 'roar' && alive ? Math.sin(Math.min(1, p) * PI) : 0;
  const charge = a.act === 'charge' && alive;
  const paw = charge && a.actT < 0.8;
  const gore = a.windup > 0 && a.actDur > 0 && alive ? 1 - a.windup / a.actDur : 0;
  const thrust = alive && a.windup <= 0 && a.attackTimer > 1.1 ? (a.attackTimer - 1.1) / 0.3 : 0;
  const o: Vec3 = [a.x, a.y, a.z];
  let basis = bodyBasis(a);
  if (stunned) basis = rollBasis(basis, Math.sin(time * 11) * 0.07);
  // The same head pose as ravagerModel.
  let pitch = 0.1 + Math.sin(time * 1.5 + a.x) * 0.04;
  if (charge) pitch = paw ? 0.5 : 0.36;
  if (gore > 0) pitch = -0.45 * gore;
  else if (thrust > 0) pitch = 0.4 * thrust;
  if (roar > 0) pitch = -0.6 * roar;
  const yaw = stunned ? Math.sin(time * 7) * 0.45 : alive ? a.headYaw * 0.4 : 0;
  const hb = pitchBasis(alive ? turnBasis(basis, yaw) : basis, pitch);
  if (body) litLike(c, body, a);
  else c.flash = a.deathT >= 0 ? 1 : a.hurt > 0 ? Math.min(1, a.hurt / 0.2) : 0;
  const neck = at(o, basis, s, 1.05, 1.62, 0);
  // Forehead plate over the brow, the crown plate behind it, and a crest of three spikes.
  part(c, neck, hb, s, 1.0, 0.2, 0, 0.96, 0.52, 0.05, uvs(S, 0, 0, 16, 8, 1));
  part(c, neck, hb, s, 0.52, 0.475, 0, 0.94, 0.05, 0.84, uvs(S, 0, 9, 16, 1, 16));
  const spike = uvs(S, 56, 39, 2, 3, 2);
  for (const [fx, h] of [[0.78, 0.2], [0.55, 0.26], [0.32, 0.2]] as const) part(c, neck, pitchBasis(hb, -0.3), s, fx, 0.5 + h / 2, 0, 0.09, h, 0.09, spike);
  // Cheek guards down the sides of the head.
  for (const side of [-1, 1]) part(c, neck, turnBasis(hb, side * PI * 0.5), s, 0.455, 0.05, -side * 0.62, 0.5, 0.55, 0.04, uvs(S, 0, 26, 20, 12, 1));
  // Flank plates, two a side, and the spine plate along the back.
  const flank = uvs(S, 0, 26, 20, 12, 1);
  for (const side of [-1, 1]) {
    const tb = turnBasis(basis, side * PI * 0.5);
    for (const fc of [0.42, -0.6]) part(c, o, tb, s, 0.785, 1.52, -side * fc, 0.96, 0.78, 0.05, flank);
  }
  part(c, o, basis, s, -0.1, 2.075, 0, 0.92, 0.05, 2.05, uvs(S, 0, 39, 8, 1, 20));
  reset(c);
}
