// The breeze: a canyon wind spirit. A pale blocky head with dark eye slits and a fluttering tuft
// floats over three stacked rings of wind (see-through, spinning, narrowing to the bottom) with
// three wind rods orbiting it. It bobs as it hovers; shooting, its head tips back then snaps
// forward and the rods whirl; charging a hop, it squashes down.
import type { Actor } from './entities';
import { F_OVERLAY, type MeshBuilder, type TexRect } from './gl';
import type { Vec3 } from './math3d';
import { bodyBasis, flashOf, part, pitchBasis, rollBasis, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, headBasis, litLike, PI, prog, reset, stretch, turnBasis } from './creature-kit';

const S = 'breeze';

/** Wind rings: [centre height, width, spin speed]. */
const RINGS: ReadonlyArray<readonly [number, number, number]> = [
  [16.5, 12, 6],
  [11, 9, -7.5],
  [5.5, 6, 9],
];

/** Side faces only: the rings are open at top and bottom. */
function ringFaces(): TexRect[] {
  const f = uvs(S, 0, 16, 10, 5, 10);
  return [f[0]!, f[1]!, null, null, f[4]!, f[5]!] as unknown as TexRect[];
}

export function breezeModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 29;
  const alive = a.deathT < 0;
  const p = prog(a);
  const shoot = a.act === 'shoot' && alive ? p : -1;
  const charge = a.act === 'charge' && alive ? p : -1;
  const squash = charge >= 0 ? Math.sin(Math.min(1, charge * 1.4) * PI * 0.5) * 0.3 : 0;
  const bob = alive ? Math.sin(time * 2.4 + a.x) * 1.2 + 1 : 0;
  const o: Vec3 = [a.x, a.y + bob * px * (1 - squash), a.z];
  const base = bodyBasis(a);
  const sb = stretch(base, 1 + squash * 0.35, 1 - squash, 1 + squash * 0.35);
  b.flash = flashOf(a);
  // The head: tips back as it draws breath, then snaps forward to shoot.
  const tilt = shoot >= 0 ? (shoot < 0.6 ? -0.5 * (shoot / 0.6) : -0.5 + ((shoot - 0.6) / 0.4) * 0.8) : 0;
  const neck = at(o, sb, px, 0, 20, 0);
  const hb = pitchBasis(headBasis(a, base), tilt + Math.sin(time * 1.6 + a.z) * 0.05);
  part(b, neck, hb, px, 0, 4, 0, 8, 8, 8, uvs(S, 0, 0, 8, 8, 8));
  // The tuft on top, swept back and fluttering.
  const tuft = pitchBasis(hb, -0.35 + Math.sin(time * 9 + a.x) * 0.08);
  part(b, at(neck, hb, px, -1, 8, 0), tuft, px, -1, 1.2, 0, 4, 3, 4, uvs(S, 32, 0, 4, 3, 4));
  // Three rods orbiting, tilted outward; a blur of speed while it shoots.
  const spin = time * (shoot >= 0 ? 9 : 2.2) + a.x;
  b.emit = 0.12;
  for (let i = 0; i < 3; i += 1) {
    const ang = spin + (i * 2 * PI) / 3;
    const y = 13 + Math.sin(time * 3 + i * 2) * 1.5;
    const rb = rollBasis(turnBasis(base, ang), 0.3);
    part(b, at(o, sb, px, Math.cos(ang) * 8.5, y, Math.sin(ang) * 8.5), rb, px, 0, 0, 0, 2, 8, 2, uvs(S, 48, 0, 2, 8, 2));
  }
  b.emit = 0;
  b.flash = 0;
  // The wind body: three translucent rings, each a pair of turned boxes for a rounder swirl.
  const s = L.soft;
  if (!s) return;
  litLike(s, b, a);
  s.flags = F_OVERLAY;
  s.alpha = alive ? 0.55 : 0.3;
  s.emit = 0.15;
  const faces = ringFaces();
  for (let i = 0; i < RINGS.length; i += 1) {
    const [y, w, speed] = RINGS[i]!;
    for (const k of [0, PI / 4]) {
      const rb = turnBasis(sb, time * speed + k + i);
      part(s, o, rb, px, 0, y, 0, w, 4.2, w, faces);
    }
  }
  // A thin wisp of a core down the middle.
  s.alpha = 0.35;
  part(s, o, turnBasis(sb, -time * 4), px, 0, 10, 0, 3, 16, 3, uvs(S, 40, 16, 4, 12, 4));
  reset(s);
}
