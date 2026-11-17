// The iron golem's two sheets (body and head on 'golem', arms, legs and the poppy on 'golem2'):
// pale weathered iron with dark rivets, hairline cracks and rust stains, green vines climbing it,
// a heavy dark brow. The Slime King's gold crown is painted on the golem sheet's spare corner.
import { glowSet, mixc, on, round } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, fw, glowBox, mulc, solidBox, type BoxUV, type O } from './creature-kit';

const IRON = ['#6a675e', '#858177', '#9d998e', '#b4b0a5', '#c8c4b8', '#dad7cd'] as const;
const VINE = ['#1e4a12', '#2a6218', '#387a20', '#4a922a', '#62aa3a'] as const;
const GOLD = ['#6a4806', '#9a6c0e', '#c8961c', '#e8b82c', '#f8d850', '#fff4a0'] as const;

export function paintGolem(a: Pix, o: O, o2: O, seed: number): void {
  const iron = (u: number, v: number, bias = 0): RGB => {
    const n = fbm2(u / 4, v / 4, seed);
    let c = ramp(IRON, clamp(0.6 + bias + (n - 0.5) * 0.6 + (hash2(u, v, seed + 1) - 0.5) * 0.1, 0, 1));
    if (Math.abs(fbm2(u / 5, v / 5, seed + 2, 2) - 0.5) < 0.016) c = mulc(c, 0.6); // cracks
    const rust = fbm2(u / 3, v / 6, seed + 3);
    if (rust > 0.68) c = mixc(c, '#7a5a3e', clamp((rust - 0.68) * 3, 0, 0.5));
    return c;
  };
  /** Vines climbing up from below: a wavy stem with leaves, where the vine map says so. */
  const vined = (u: number, v: number, c: RGB, density: number): RGB => {
    const stem = Math.abs(((u + Math.round(Math.sin(v * 0.4 + u * 0.1) * 2)) % 11) - 5);
    const here = fbm2(u / 7, 0, seed + 4) < density;
    if (!here) return c;
    if (stem === 0) return ramp(VINE, 0.3 + hash2(u, v, seed) * 0.3);
    if (stem <= 2 && (v + u) % 4 === 0) return ramp(VINE, 0.5 + hash2(u, v, seed + 5) * 0.5);
    return c;
  };
  const ironBox = (b: BoxUV, off: number, vines: number): void =>
    box(
      a,
      b,
      (s, y, side, x) => {
        let c = iron(s + off, y);
        if (y === 0) c = mulc(c, 1.07);
        if (y === b.h - 1) c = mulc(c, 0.78);
        c = vined(s + off, y, c, vines);
        return mulc(c, round(x, fw(b, side)));
      },
      (x, y) => mulc(iron(x + off + 500, y), 1.08),
      (x, y) => mulc(iron(x + off + 700, y), 0.65),
    );

  // ---- head: dark brow band, small deep red eyes
  const head = boxUV(o, 0, 0, 8, 10, 8);
  ironBox(head, 0, 0.2);
  const f = on(a, head.front);
  f.mixRect(1, 6, 14, 2, '#3a3630', 0.75); // the brow
  f.mixRect(1, 8, 14, 1, '#4a463e', 0.4);
  for (const ex of [3, 10]) {
    f.rect(ex, 9, 3, 2, '#2a1a16');
    glowSet(a, head.front, ex + 1, 9, '#a8241a', 0.35);
  }
  f.mixRect(5, 16, 6, 1, '#4a463e', 0.6); // mouth
  ironBox(boxUV(o, 32, 0, 2, 4, 2), 900, 0);

  // ---- chest: rivets along the shoulders, a vine draped across
  const body = boxUV(o, 0, 18, 18, 12, 11);
  ironBox(body, 1000, 0.45);
  const bf = on(a, body.front);
  for (let x = 2; x < 36; x += 6) bf.set(x, 2, '#5a564e');
  bf.mixRect(16, 4, 4, 16, '#5a564e', 0.3); // the breastbone seam
  ironBox(boxUV(o, 0, 41, 9, 5, 6), 1200, 0.6);

  // ---- arms and legs (second sheet): vines up the legs, dark knuckles
  const arm = boxUV(o2, 0, 0, 4, 30, 6);
  ironBox(arm, 2000, 0.35);
  for (const r of [arm.front, arm.back, arm.right, arm.left]) on(a, r).mixRect(0, 50, r.w, 10, '#4a463e', 0.45);
  const leg = boxUV(o2, 20, 0, 6, 16, 5);
  ironBox(leg, 2500, 0.65);

  // ---- the poppy
  solidBox(a, boxUV(o2, 42, 0, 3, 2, 3), (u, v) => mixc(ramp(['#7a0a0a', '#b01414', '#d82a1e', '#f04a30'], clamp(0.6 + (hash2(u, v, seed) - 0.5) * 0.5, 0, 1)), '#1a0a06', (u % 6 === 3 && v < 2) ? 0.7 : 0));
  solidBox(a, boxUV(o2, 42, 6, 1, 5, 1), (u, v) => ramp(VINE, 0.4 + hash2(u, v, seed + 6) * 0.3));

  // ---- the crown: gold band with a dark trim line, points, a ruby
  const gold = (u: number, v: number): RGB => ramp(GOLD, clamp(0.6 + (fbm2(u / 2.5, v / 2.5, seed + 7) - 0.5) * 0.5 + (hash2(u, v, seed + 8) - 0.5) * 0.12, 0, 1));
  const band = boxUV(o, 30, 41, 8, 3, 8);
  solidBox(a, band, (u, v) => (v === 1 || v === 4 ? mulc(gold(u, v), 0.7) : (v === 2 || v === 3) && u % 4 === 1 ? mixc(gold(u, v), '#c82a8a', 0.6) : gold(u, v)), 0, 1.15, 0.6);
  glowBox(a, band, 0.12);
  solidBox(a, boxUV(o, 30, 52, 2, 2, 2), (u, v) => mulc(gold(u + 30, v), v < 1 ? 1.25 : 1));
  const gem = boxUV(o, 38, 52, 1, 1, 1);
  box(a, gem, (_s, y, _side, x) => (x === 0 && y === 0 ? [255, 190, 190] : [200, 20, 40]), () => [230, 60, 80], () => [120, 10, 20]);
  glowBox(a, gem, 0.6);
}
