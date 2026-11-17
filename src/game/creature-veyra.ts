// Veyra, the Heart-Architect: a tall robed figure of black silk and pale stone, floating, her robe's hem
// breaking into shards, a crown of crystal points, the Heart glowing in her chest, a ring of great
// crystal shards turning round her. She raises her arms to cast; in her last stand the ring breaks
// apart and the crystal climbs over her.
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import type { Vec3 } from './math3d';
import { add, bodyBasis, flashOf, limb, part, pitchBasis, scale, uvs, yawBasis } from './models';
import type { MobLayers } from './models-mobs';
import { at, clamp01 } from './creature-kit';

export function veyraModel(b: MeshBuilder, _L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 48;
  const bob = Math.sin(time * 1.3) * 0.25;
  const o: Vec3 = [a.x, a.y + bob, a.z];
  const basis = bodyBasis(a);
  const alive = a.deathT < 0;
  b.flash = flashOf(a);
  const casting = alive && (a.act === 'cast' || a.act === 'summon');
  const lift = casting ? clamp01(a.actT / Math.max(0.01, a.actDur)) : 0;
  const robe = uvs('veyra', 0, 36, 14, 18, 10);
  // The robe in three tiers, narrowing to the waist, swaying a little.
  const sway = Math.sin(time * 0.9) * 0.04;
  const rb = pitchBasis(basis, sway);
  part(b, o, rb, px, 0, 4, 0, 14, 8, 10, robe);
  part(b, o, rb, px, 0, 11, 0, 12, 8, 8, robe);
  part(b, o, rb, px, 0, 18, 0, 10, 7, 7, robe);
  // Torso, the Heart in it.
  const chest = at(o, basis, px, 0, 26, 0);
  part(b, chest, basis, px, 0, 0, 0, 10, 12, 6, uvs('veyra', 32, 0, 10, 12, 6));
  const emit = b.emit;
  b.emit = 0.8 + Math.sin(time * 4) * 0.2;
  part(b, chest, basis, px, 3.4, 1, 0, 4, 4, 2, uvs('veyra', 28, 18, 4, 4, 2));
  b.emit = emit;
  // Arms: hanging, or raised wide to cast.
  const armUv = uvs('veyra', 0, 18, 4, 14, 4);
  const raise = -0.3 - lift * 2.2;
  limb(b, chest, basis, px, [0, 5, -7], casting ? raise : -0.15 + Math.sin(time * 1.1) * 0.08, 4, 14, 4, armUv, casting ? -0.5 * lift : 0);
  limb(b, chest, basis, px, [0, 5, 7], casting ? raise : -0.15 - Math.sin(time * 1.1) * 0.08, 4, 14, 4, armUv, casting ? 0.5 * lift : 0);
  // Head, braid, crown.
  const neck = at(chest, basis, px, 0, 6, 0);
  const hb = yawBasis(a.yaw + a.headYaw);
  part(b, neck, hb, px, 0, 4, 0, 8, 8, 8, uvs('veyra', 0, 0, 8, 8, 8));
  part(b, neck, basis, px, -4.6, -2, 0, 2, 16, 2, uvs('veyra', 48, 36, 2, 16, 2));
  const crystal = uvs('veyra', 16, 18, 3, 6, 3);
  b.emit = 0.9;
  for (let k = 0; k < 5; k += 1) {
    const ang = (k / 5) * Math.PI * 2 + 0.3;
    part(b, neck, hb, px, Math.cos(ang) * 3.2, 9 + (k === 0 ? 2 : 0), Math.sin(ang) * 3.2, 1.6, k === 0 ? 5 : 3.5, 1.6, crystal);
  }
  // The ring of shards round her (fewer and wilder in her last stand).
  const last = a.aux > 1;
  const n = last ? 4 : 7;
  for (let k = 0; k < n; k += 1) {
    const ang = time * (last ? 1.6 : 0.7) + (k / n) * Math.PI * 2;
    const r = (last ? 15 : 19) + Math.sin(time * 2 + k) * (last ? 4 : 1.5);
    const y = 22 + Math.sin(time * 1.5 + k * 1.7) * (last ? 8 : 4);
    const c = add(o, add(scale([Math.cos(ang), 0, Math.sin(ang)], r * px), [0, y * px, 0]));
    const tumble = yawBasis(ang * 2 + k);
    part(b, c, pitchBasis(tumble, Math.sin(time + k) * 0.6), px, 0, 0, 0, 3, 6, 3, crystal);
  }
  b.emit = emit;
  b.flash = 0;
}
