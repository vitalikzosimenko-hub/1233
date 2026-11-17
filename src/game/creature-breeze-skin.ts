// The breeze's sheet: a pale cyan-white head shading to lavender, dark eye slits, wispy tuft,
// banded wind rods, and see-through swirling streaks for the wind rings and core.
import { glowSet, mixc, on } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, boxA, glowBox, mulc, solidBox, type O } from './creature-kit';

const PALE = ['#6a7cb0', '#8aa0cc', '#a8c0e0', '#c4daee', '#dcecf6', '#f2f8fc'] as const;
const WIND = ['#7894cc', '#98b4e2', '#b8d2f0', '#d8eaf8', '#f4faff'] as const;
const ROD = ['#3a3e78', '#4c5292', '#626aae', '#7c86c6', '#9aa6dc', '#c0caf0'] as const;

export function paintBreeze(a: Pix, o: O, seed: number): void {
  const pale = (u: number, v: number, bias = 0): RGB => {
    const n = fbm2(u / 3.5, v / 3.5, seed);
    return ramp(PALE, clamp(0.62 + bias + (n - 0.5) * 0.5 + (hash2(u, v, seed + 1) - 0.5) * 0.08, 0, 1));
  };
  // ---- head: brighter on top, lavender toward the chin
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    head,
    (s, y) => {
      let c = pale(s, y, 0.1 - (y / 16) * 0.35);
      // Wind curls etched into the sides.
      if (Math.abs(Math.sin(s * 0.5 + y * 0.35) * 3 - ((y * 1.3) % 6)) < 0.5 && y > 3) c = mulc(c, 0.86);
      return mulc(c, y === 0 ? 1.06 : y === 15 ? 0.8 : 1);
    },
    (x, y) => pale(x + 60, y, 0.2),
    (x, y) => mulc(pale(x + 90, y, -0.2), 0.75),
  );
  glowBox(a, head, 0.15);
  const f = on(a, head.front);
  // Two narrow dark slits under a pale brow, a faint cyan glint at their inner ends.
  for (const ex of [2, 9]) {
    f.rect(ex, 7, 5, 2, '#1a2040');
    f.set(ex + (ex === 2 ? 4 : 0), 7, '#2a3460');
    glowSet(a, head.front, ex + (ex === 2 ? 4 : 0), 8, '#7adcff', 0.6);
  }
  f.mixRect(1, 6, 14, 1, '#4a5a8a', 0.35);
  f.mixRect(6, 12, 4, 1, '#3a4670', 0.6); // a small mouth

  // ---- tuft: white wisps streaming back
  solidBox(a, boxUV(o, 32, 0, 4, 3, 4), (u, v) => mixc(ramp(WIND, clamp(0.5 + (fbm2(u / 1.2, v / 3, seed + 2) - 0.5) * 1.2, 0, 1)), '#8aa0cc', (v / 6) * 0.4));

  // ---- rods: pale blue-white, darker bands
  const rod = boxUV(o, 48, 0, 2, 8, 2);
  solidBox(a, rod, (u, v) => {
    let c = ramp(ROD, clamp(0.55 + (fbm2(u / 1.5, v / 2, seed + 3) - 0.5) * 0.6 + (v < 2 ? 0.3 : 0), 0, 1));
    if (v % 5 === 0) c = mixc(c, '#ccd8ff', 0.5);
    return c;
  }, 0, 1.15, 0.85);
  glowBox(a, rod, 0.35);

  // ---- wind: diagonal streaks of varied opacity (see-through between)
  const streak = (u: number, v: number, slant: number): [RGB, number] | null => {
    const w = Math.sin((u + v * slant) * 0.55 + fbm2(u / 4, v / 4, seed + 4) * 4);
    const n = fbm2(u / 3, v / 2, seed + 5);
    const t = w * 0.5 + 0.5;
    if (t < 0.45) return hash2(u, v, seed + 6) < 0.12 ? [ramp(WIND, 0.7), 0.3] : null;
    return [ramp(WIND, clamp((t - 0.45) * 1.4 + n * 0.3, 0, 1)), clamp(0.15 + (t - 0.45) * 1.3, 0, 0.85)];
  };
  boxA(a, boxUV(o, 0, 16, 10, 5, 10), (u, v, face) => (face === 'top' || face === 'bottom' ? null : streak(u, v, 1.6)));
  boxA(a, boxUV(o, 40, 16, 4, 12, 4), (u, v, face) => (face === 'top' || face === 'bottom' ? null : streak(u + 40, v, 0.6)));
}
