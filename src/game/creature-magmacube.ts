// The magma cube: eight stacked slabs of black-red crust veined with glowing magma round a molten
// core. It squashes down for a hop, springs apart into separate layers as it rises (the core
// showing between them), and splats flat on landing. Sizes 1, 2, 4 and 8 share the model.
import type { Actor } from './entities';
import { F_OVERLAY, F_UNLIT, type MeshBuilder, type TexRect } from './gl';
import type { Vec3 } from './math3d';
import { bodyBasis, flashOf, part, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { at, clamp01, litLike, reset, sheetRect, stretch, turnBasis } from './creature-kit';

const S = 'magmacube';

/** Faces of slab i (0 bottom .. 7 top): its row of the cube's sides, the crust's inside between slabs. */
const SLABS: TexRect[][] = [];
function slab(i: number): TexRect[] {
  let f = SLABS[i];
  if (!f) {
    // Each slab wears one model-pixel row of the cube's sides (row 0 is the top).
    const side = (u: number): TexRect => sheetRect(S, u, 8 + 7 - i, 8, 1);
    const inner = sheetRect(S, 0, 16, 8, 8);
    f = [side(8), side(24), i === 7 ? sheetRect(S, 8, 0, 8, 8) : inner, i === 0 ? sheetRect(S, 16, 0, 8, 8) : inner, side(0), side(16)];
    SLABS[i] = f;
  }
  return f;
}

export function magmaCubeModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 8;
  const o: Vec3 = [a.x, a.y, a.z];
  const alive = a.deathT < 0;
  // Squash (+) and stretch (-), as a slime; airborne it also springs apart into layers.
  let sq = alive ? Math.sin(time * 3 + a.x) * 0.03 : 0;
  let gap = 0;
  if (alive) {
    if (a.act === 'pounce') sq = 0.1 + clamp01(1 + a.aux / 0.22) * 0.3;
    else if (!a.onGround) {
      gap = clamp01(0.3 + a.vy / 6) * 0.8;
      sq = -0.1 * clamp01(Math.abs(a.vy) / 5);
    } else if (a.actT > 0) sq = (a.actT / 0.3) * 0.42 * (0.75 + 0.25 * Math.cos(a.actT * 40));
  }
  const ky = 1 - sq;
  const kw = 1 + sq * 0.55 - gap * 0.06;
  const base = bodyBasis(a);
  const sb = stretch(base, kw, 1, kw);
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + a.x);
  b.flash = flashOf(a);
  b.emit = 0.03 + pulse * 0.04;
  for (let i = 0; i < 8; i += 1) {
    const y = (i + 0.5) * ky + i * gap;
    const f = slab(i);
    const faces = gap < 0.02 ? f.map((t, j) => (j === 2 && i < 7) || (j === 3 && i > 0) ? (null as unknown as TexRect) : t) : f;
    // The slabs twist a touch against each other as they spring apart.
    const tb = gap > 0 ? turnBasis(sb, Math.sin(i * 1.7) * gap * 0.06) : sb;
    part(b, o, tb, px, 0, y, 0, 8, ky, 8, faces);
  }
  // The molten core, glimpsed between the layers.
  const mid = (8 * ky + 7 * gap) / 2;
  b.emit = 0.55 + pulse * 0.25;
  part(b, o, turnBasis(base, time * 0.8), px, 0, mid, 0, 4 + gap, 4 + gap * 2, 4 + gap, uvs(S, 32, 0, 4, 4, 4));
  b.emit = 0;
  b.flash = 0;
  // A heat shimmer round it while it is sprung apart in the air.
  const s = L.soft;
  if (!s || !alive || gap < 0.1) return;
  litLike(s, b, a);
  s.flash = 0;
  s.flags = F_OVERLAY | F_UNLIT;
  s.emit = 0.6;
  s.tint = [1, 0.45, 0.15];
  s.alpha = gap * 0.07;
  part(s, at(o, base, px, 0, 0, 0), stretch(base, kw * 1.08, 1, kw * 1.08), px, 0, mid, 0, 8, 8 * ky + 7 * gap + 0.6, 8, uvs(S, 32, 0, 4, 4, 4));
  reset(s);
}
