// The blaze's sheet: a smoky golden head with dark eyes, burning golden rods, a sheet of rising
// flame tongues (tiles vertically for the aura) and a soft smoke puff.
import { k, mixc, on } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, boxA, glowBox, mulc, paintA, solidBox, type O } from './creature-kit';

const HEAD = ['#6a2c06', '#9a4a0c', '#c66e12', '#e4961e', '#f6be32', '#ffe068'] as const;
const SMOKE = ['#2a2018', '#3a2e22', '#4e3e2c', '#665038'] as const;
const ROD = ['#8a4a06', '#b8780e', '#e0a41c', '#f6cc38', '#ffe872', '#fff8c0'] as const;
const FLAME = ['#a8200a', '#d44a10', '#f07a18', '#fca82a', '#ffd04a', '#fff09a'] as const;

export function paintBlaze(a: Pix, o: O, seed: number): void {
  /** Gold with sooty smoke blotches drifting over it. */
  const gold = (u: number, v: number, bias = 0): RGB => {
    const n = fbm2(u / 3.5, v / 3.5, seed);
    let c = ramp(HEAD, clamp(0.58 + bias + (n - 0.5) * 0.8 + (hash2(u, v, seed + 1) - 0.5) * 0.12, 0, 1));
    const sm = fbm2(u / 5, v / 4, seed + 2);
    if (sm > 0.6) c = mixc(c, ramp(SMOKE, hash2(u, v, seed + 3)), clamp((sm - 0.6) * 3.2, 0, 0.8));
    return c;
  };
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    head,
    (s, y) => k(gold(s, y), y === 15 ? 0.78 : y === 0 ? 1.08 : 1),
    (x, y) => gold(x + 60, y, 0.08),
    (x, y) => k(gold(x + 90, y), 0.62),
  );
  glowBox(a, head, 0.45);
  const f = on(a, head.front);
  // Brow shadow, deep-set dark eyes with a hot rim, a grim mouth line.
  f.mixRect(1, 4, 14, 2, '#3a1a06', 0.5);
  for (const ex of [2, 10]) {
    f.rect(ex, 6, 4, 2, '#1a0c04');
    f.rect(ex, 8, 4, 1, '#2e1608');
    f.set(ex + (ex === 2 ? 3 : 0), 6, '#4a2208');
  }
  f.mixRect(4, 12, 8, 1, '#2a1206', 0.85);
  f.mixRect(5, 13, 6, 1, '#2a1206', 0.4);
  for (const [x, y] of [[0, 6], [15, 6], [7, 9], [8, 9]] as const) f.mix(x, y, '#ffe8a0', 0.5);

  // Rods: molten gold, hottest at the ends.
  const rod = boxUV(o, 32, 0, 2, 8, 2);
  solidBox(a, rod, (u, v) => {
    const t = 0.55 + (fbm2(u / 1.5, v / 3, seed + 4) - 0.5) * 0.7 + (v < 2 || v > 13 ? 0.25 : 0);
    return ramp(ROD, clamp(t, 0, 1));
  }, 0, 1.15, 0.9);
  glowBox(a, rod, 0.85);

  // Smoke puff: a soft grey blob, thinner at the edges.
  boxA(a, boxUV(o, 40, 0, 4, 4, 4), (u, v, _face, x) => {
    const e = Math.min(x, v, 7 - x, 7 - v);
    const n = fbm2(u / 2, v / 2, seed + 5);
    const alpha = clamp(0.35 + e * 0.18 + (n - 0.5) * 0.5, 0.1, 0.95);
    return [mulc([120, 112, 104], 0.8 + n * 0.4), alpha];
  });

  // Flame sheet (16 x 32 model px): tongues licking upward, repeating every 16 px so it scrolls.
  paintA(a, { x: o[0], y: o[1] + 32, w: 32, h: 64 }, (x, y) => {
    const yy = y % 32;
    const col = fbm2(x / 3, 0, seed + 6);
    const th = (yy / 32) * Math.PI * 2;
    const lick = fbm2(x / 2.2 + Math.cos(th) * 0.9, Math.sin(th) * 0.9 + x * 0.01, seed + 7) * 0.8 + (Math.sin((x / 32) * Math.PI * 6 + th) * 0.5 + 0.5) * 0.4;
    const t = clamp(lick + col * 0.3 - 0.25 + (hash2(x, yy, seed + 8) - 0.5) * 0.12, 0, 1);
    if (t < 0.36) return null;
    return [ramp(FLAME, clamp((t - 0.36) * 1.6, 0, 1)), clamp(0.2 + (t - 0.36) * 1.3, 0, 1)];
  });
}
