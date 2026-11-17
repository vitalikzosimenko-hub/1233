// The officers on their feet: people, not villagers (a head, a body, arms and legs in Minecraft's own
// proportions), each on a sheet of their own, with a hat where they wear one and the tool of their
// trade in hand. They stand and shift their weight, turn their heads to you, and walk when they must.
import type { Actor } from './entities';
import type { MeshBuilder } from './gl';
import type { Vec3 } from './math3d';
import { bodyBasis, flashOf, limb, part, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, headBasis, litLike, reset, stride } from './creature-kit';

/** What each carries: which hand (1 right), and the prop's size in pixels along and across. */
const PROPS: Partial<Record<string, { long: number; thick: number; lamp?: boolean }>> = {
  brannoc: { long: 16, thick: 1.4 },
  bo: { long: 9, thick: 1.2 },
  gil: { long: 34, thick: 1.3, lamp: true },
  aurel: { long: 9, thick: 2 },
  orsa: { long: 10, thick: 1.4 },
  lumen: { long: 2, thick: 3, lamp: true },
};

export function officerModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const S = `npc_${a.npc}`;
  const px = a.h / 32;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const swing = stride(a, 0.7);
  const idle = Math.sin(time * 1.1 + a.x) * 0.05;
  const legUv = uvs(S, 0, 32, 4, 12, 4);
  limb(b, o, basis, px, [0, 12, -2], swing, 4, 12, 4, legUv);
  limb(b, o, basis, px, [0, 12, 2], -swing, 4, 12, 4, legUv);
  part(b, o, basis, px, 0, 18, 0, 8, 12, 4, uvs(S, 0, 16, 8, 12, 4));
  const armUv = uvs(S, 48, 16, 4, 12, 4);
  limb(b, o, basis, px, [0, 24, -6], -swing + idle, 4, 12, 4, armUv);
  const prop = PROPS[a.npc];
  // (A hand with something in it stays out in front.)
  const hold = prop ? -0.45 : swing - idle;
  limb(b, o, basis, px, [0, 24, 6], hold, 4, 12, 4, armUv);
  const neck = at(o, basis, px, 0, 24, 0);
  const hb = headBasis(a, basis);
  part(b, neck, hb, px, 0, 4, 0, 8, 8, 8, uvs(S, 0, 0, 8, 8, 8));
  if (prop) {
    // The prop stands up from the right hand.
    const hand = at(o, basis, px, 5, 14.5, 6);
    const uv = uvs(S, 20, 44, 2, 2, 2);
    part(b, hand, basis, px, 0, prop.long / 2 - 4, 0, prop.thick, prop.long, prop.thick, uv);
    if (prop.lamp) {
      const emit = b.emit;
      b.emit = 0.9;
      part(b, hand, basis, px, 1.5, prop.long - 5, 0, 3, 3.6, 3, uvs(S, 28, 44, 2, 2, 2));
      b.emit = emit;
    }
  }
  b.flash = 0;
  const c = L.cut;
  if (!c) return;
  litLike(c, b, a);
  // Hair, hoods and veils over the head; what is worn over the body.
  part(c, neck, hb, px, 0, 4.1, 0, 8.8, 8.8, 8.8, uvs(S, 32, 0, 8, 8, 8));
  part(c, o, basis, px, 0, 18, 0, 8.7, 12.4, 4.7, uvs(S, 24, 16, 8, 12, 4));
  if (a.npc === 'gil' || a.npc === 'moss') {
    // A wide brim, and the crown over it.
    part(c, neck, hb, px, 0, 8.6, 0, 14, 1, 14, uvs(S, 0, 48, 14, 1, 14));
    part(c, neck, hb, px, 0, 10.4, 0, 6.5, 4, 6.5, uvs(S, 16, 32, 6, 4, 6));
    if (a.npc === 'moss') part(c, neck, hb, px, -0.8, 14, 0, 3.6, 4, 3.6, uvs(S, 40, 32, 4, 4, 4));
  }
  reset(c);
}
