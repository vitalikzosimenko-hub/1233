// The Brood Queen: a giant spider boss. A black-purple carapace with a crown of spikes on the head
// and eight glowing red eyes, a huge pale egg-sac abdomen that pulses with a sickly glow, and eight
// long two-jointed legs. She crouches then lunges to pounce, contracts the sac to lay eggs, and
// rears her head back to spit web.
import type { Actor } from './entities';
import { F_OVERLAY, F_UNLIT, type MeshBuilder } from './gl';
import { normalize, type Vec3 } from './math3d';
import { add, bodyBasis, flashOf, part, pitchBasis, rollBasis, scale, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, clamp01, cross, knee, litLike, moving, PI, prog, reset, rod, stretch, sub, turnBasis } from './creature-kit';

const S = 'queen';

/** Leg i (front to back): angle out from straight ahead, and how far out the foot rests (px). */
const LEGS: ReadonlyArray<readonly [number, number]> = [
  [0.55, 27],
  [1.15, 26],
  [1.85, 26],
  [2.45, 27],
];
/** Crown spikes along the head's top: [across, back, height, splay]. */
const CROWN: ReadonlyArray<readonly [number, number, number, number]> = [
  [-4.4, 0, 4, -0.35],
  [-2.2, 0.5, 5.5, -0.18],
  [0, 1, 7, 0],
  [2.2, 0.5, 5.5, 0.18],
  [4.4, 0, 4, 0.35],
  [-3.3, -3, 3, -0.3],
  [3.3, -3, 3, 0.3],
];

export function queenModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 26;
  const alive = a.deathT < 0;
  const p = prog(a);
  const pounce = a.act === 'pounce' && alive ? p : -1;
  const summon = a.act === 'summon' && alive ? p : -1;
  const spit = a.act === 'shoot' && alive ? p : -1;
  // Pounce: crouch low, then spring forward with the front legs reaching.
  let crouch = 0;
  let lunge = 0;
  if (pounce >= 0) {
    crouch = pounce < 0.6 ? Math.sin((pounce / 0.6) * PI * 0.5) : 1 - (pounce - 0.6) / 0.4;
    lunge = pounce > 0.6 ? Math.sin(((pounce - 0.6) / 0.4) * PI) : 0;
  }
  if (!a.onGround && alive) lunge = Math.max(lunge, 0.8);
  const bite = alive && a.attackTimer > 0.7 ? clamp01((a.attackTimer - 0.7) / 0.3) : 0;
  // Spit: the head rears back, then snaps forward.
  const rear = spit >= 0 ? (spit < 0.55 ? Math.sin((spit / 0.55) * PI * 0.5) : 1 - ((spit - 0.55) / 0.45) * 1.5) : 0;
  const basis = bodyBasis(a);
  const walk = moving(a);
  const ph = a.walkPhase * PI * 1.25 + (walk ? 0 : time * 0.35);
  const breathe = Math.sin(time * 1.6 + a.x);
  const o: Vec3 = [a.x, a.y, a.z];
  const bb = pitchBasis(basis, lunge * 0.3 - Math.max(0, rear) * 0.12 + crouch * 0.08);
  const tc = at(o, basis, px, lunge * 4, 9.5 - crouch * 4.5 + breathe * 0.25 + (walk ? Math.abs(Math.sin(ph)) * 0.4 : 0), 0);
  const fl = flashOf(a);
  b.flash = fl;
  part(b, tc, bb, px, 0, 0, 0, 13, 9, 13, uvs(S, 34, 30, 7, 6, 8));
  // The egg sac: swollen, pulsing; contracting hard while she lays.
  const lay = summon >= 0 ? Math.sin(summon * PI) : 0;
  const throb = summon >= 0 ? Math.sin(time * 12) * 0.06 * lay - lay * 0.1 : Math.sin(time * 2.2 + a.z) * 0.035;
  const ab = pitchBasis(bb, -0.3 + lay * 0.3 + breathe * 0.02);
  const sac = stretch(ab, 1 + throb * 0.4, 1 + throb, 1 + throb);
  const root = at(tc, bb, px, -5.5, 1.5, 0);
  b.emit = 0.015 + Math.max(0, throb) * 0.5 + lay * 0.1;
  // Three crossing boxes round the swollen sac out.
  const sacUv = uvs(S, 0, 0, 16, 14, 16);
  part(b, root, sac, px, -14, 5, 0, 27, 19, 27, sacUv);
  part(b, root, sac, px, -14, 5, 0, 22, 24, 22, sacUv);
  part(b, root, sac, px, -14, 5, 0, 22, 16, 32, sacUv);
  // Eggs bulging through the membrane.
  const eggUv = uvs(S, 36, 46, 3, 3, 3);
  for (const [ex, ey, ez, sz] of [[-17, 16.5, -5, 4.5], [-10, 16, 5, 4], [-21, 13, 9, 4], [-8, 12, -11, 3.5], [-22, 9, -10, 3.5], [-26, 12, 2, 3.5]] as const) part(b, root, sac, px, ex, ey, ez, sz, sz, sz, eggUv);
  // The spinnerets at the tip.
  part(b, root, sac, px, -30.5, 3, 0, 5, 4, 2, uvs(S, 28, 46, 2, 4, 2));
  b.emit = 0;
  // The head, crowned with spikes; the fangs flare as she bites or spits.
  const neck = at(tc, bb, px, 6, 0.5, 0);
  const look = alive ? turnBasis(bb, a.headYaw * 0.6) : bb;
  const hb = pitchBasis(look, -a.headPitch * 0.5 - rear * 0.7 + bite * 0.25);
  part(b, neck, hb, px, 5, 0.5, 0, 13, 10, 10, uvs(S, 0, 30, 9, 8, 8));
  const spikeUv = uvs(S, 20, 46, 2, 4, 2);
  for (const [z, x, h, splay] of CROWN) {
    const sb = rollBasis(pitchBasis(hb, -0.25), splay);
    part(b, at(neck, hb, px, 3.5 + x, 5, z * 1.15), sb, px, 0, h / 2, 0, 2, h * 1.15, 2, spikeUv);
  }
  const open = spit >= 0 ? (rear > 0 ? 0.15 + rear * 0.35 : 0.6) : bite > 0 ? 0.55 * bite : 0.08 + Math.sin(time * 2.7 + a.x) * 0.05;
  for (const side of [-1, 1]) {
    const fb = rollBasis(pitchBasis(hb, 0.2 - open * 0.3), side * open);
    part(b, at(neck, hb, px, 10.2, -3.5, side * 2.8), fb, px, 0, -2.6, 0, 2.4, 6, 2.4, uvs(S, 28, 46, 2, 4, 2));
  }
  // Eight legs, two bones each: the knees ride high over the body.
  const upUv = uvs(S, 0, 46, 3, 14, 3);
  const loUv = uvs(S, 12, 46, 2, 14, 2);
  const L1 = 15 * px;
  const L2 = 19 * px;
  const up = basis.u;
  for (let i = 0; i < 4; i += 1) {
    const [theta, reach] = LEGS[i]!;
    for (const side of [-1, 1]) {
      const step = walk ? Math.sin(ph + i * 1.6 + (side > 0 ? PI : 0)) : Math.sin(time * 0.9 + i + side) * 0.08;
      const lift = walk ? Math.max(0, Math.cos(ph + i * 1.6 + (side > 0 ? PI : 0))) * 4 : 0;
      const R = reach * (1 + crouch * 0.12);
      let fx = Math.cos(theta) * R + step * 3.5 + lunge * 6;
      let fy = lift;
      if (i < 2 && lunge > 0) {
        fx += lunge * (i === 0 ? 8 : 4);
        fy += lunge * (i === 0 ? 12 : 6);
      }
      if (summon >= 0 && i === 3) fy += lay * 3;
      const hip = at(tc, bb, px, 4 - i * 2.8, 0, side * 6);
      const foot = at(o, basis, px, fx, fy, side * Math.sin(theta) * R);
      const k = knee(hip, foot, L1, L2, up);
      const plane = normalize(cross(sub(foot, hip), up));
      rod(b, hip, k, 4 * px, 4 * px, plane, upUv);
      rod(b, k, foot, 3 * px, 3 * px, plane, loUv);
      // A spur on each knee.
      part(b, k, pitchBasis(bb, -0.1), px, 0, 2, 0, 1.8, 4, 1.8, spikeUv);
    }
  }
  b.flash = 0;
  // A sickly glow through the egg sac (strong while she lays).
  const s = L.soft;
  if (!s || !alive) return;
  litLike(s, b, a);
  s.flash = 0;
  s.flags = F_OVERLAY | F_UNLIT;
  s.tint = [0.7, 1, 0.35];
  s.emit = 0.3;
  s.alpha = 0.05 + Math.max(0, throb) * 0.6 + lay * 0.12;
  part(s, root, stretch(sac, 1.05, 1.05, 1.05), px, -14 / 1.05, 5 / 1.05, 0, 27, 21, 29, sacUv);
  // Spit: a gob of web flung from the fangs as her head snaps forward.
  if (spit > 0.55 && spit < 0.9) {
    s.tint = [0.95, 0.95, 0.9];
    s.flags = F_OVERLAY;
    s.alpha = 0.8;
    s.emit = 0.1;
    const d = (spit - 0.55) / 0.35;
    const g = add(at(neck, hb, px, 12, -2, 0), scale(hb.f, d * 2.5));
    part(s, g, hb, px, 0, 0, 0, 3 - d, 3 - d, 3 - d, uvs(S, 36, 46, 3, 3, 3));
  }
  reset(s);
}
