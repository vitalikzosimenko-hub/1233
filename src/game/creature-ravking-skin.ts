// The Ravager King's armour sheet: dark hammered iron plates with bevelled edges, rivets and
// scratches, trimmed in gold; the forehead plate is notched over the eyes (cut-out).
import { mixc } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { boxA, boxUV, mulc, solidBox, type O } from './creature-kit';

const PLATE = ['#2e3036', '#3e4148', '#50535a', '#62656d', '#777a82', '#9295a0'] as const;
const GOLD = ['#7a560c', '#a87c16', '#d4a426', '#f0c844'] as const;

export function paintRavKing(a: Pix, o: O, seed: number): void {
  const iron = (u: number, v: number): RGB => {
    let c = ramp(PLATE, clamp(0.55 + (fbm2(u / 4, v / 4, seed) - 0.5) * 0.6 + (hash2(u, v, seed + 1) - 0.5) * 0.12, 0, 1));
    if (hash2(u >> 2, v, seed + 2) < 0.03) c = mulc(c, 1.25); // scratches
    return c;
  };
  const gold = (u: number, v: number): RGB => ramp(GOLD, clamp(0.55 + (hash2(u, v, seed + 3) - 0.5) * 0.6, 0, 1));
  /** A plate face: gold rim, bevel, rivets inside the rim; `keep` cuts its outline. */
  const plate = (x: number, y: number, w: number, h: number, u: number, keep: (x: number, y: number) => boolean): [RGB, number] | null => {
    if (!keep(x, y)) return null;
    const e = Math.min(x, y, w - 1 - x, h - 1 - y);
    const edgeOut = !keep(x - 1, y) || !keep(x + 1, y) || !keep(x, y - 1) || !keep(x, y + 1);
    if (e === 0 || edgeOut) return [gold(u + x, y), 1];
    let c = iron(u + x, y);
    if (e === 1) c = mulc(c, x === 1 || y === 1 ? 1.3 : 0.7);
    if (e === 2 && (x + y) % 5 === 0) c = [200, 200, 205]; // rivets
    return [c, 1];
  };
  // Forehead plate: a broad shield, notched up from below over each eye, a gold crest stripe.
  const fore = boxUV(o, 0, 0, 16, 8, 1);
  boxA(a, fore, (u, v, face, x) => {
    if (face !== 'front' && face !== 'back') return [iron(u, v), 1];
    const keep = (px: number, py: number): boolean => px >= 0 && py >= 0 && px < 32 && py < 16 && !(py > 9 && (Math.abs(px - 7) < 3 || Math.abs(px - 24) < 3)) && !(py > 12 && (px < 3 || px > 28));
    const c = plate(x, v, 32, 16, 0, keep);
    if (c && (x === 15 || x === 16) && v > 1 && v < 14) return [gold(x, v), 1];
    return c;
  });
  // Plate over the crown of the head (its top shows).
  solidBox(a, boxUV(o, 0, 9, 16, 1, 16), (u, v) => ((u + v) % 11 === 0 ? [200, 200, 205] : v % 16 === 0 ? gold(u, v) : iron(u + 100, v)));
  // Flank plates: rounded corners, gold rim, rivets, a gold boss in the middle.
  const flank = boxUV(o, 0, 26, 20, 12, 1);
  boxA(a, flank, (u, v, face, x) => {
    if (face !== 'front' && face !== 'back') return [iron(u + 200, v), 1];
    const keep = (px: number, py: number): boolean => px >= 0 && py >= 0 && px < 40 && py < 24 && !(Math.min(px, 39 - px) + Math.min(py, 23 - py) < 3);
    const c = plate(x, v, 40, 24, 200, keep);
    if (c && Math.hypot(x - 19.5, v - 11.5) < 3.2) return [mixc(gold(x, v), '#fff0a0', Math.hypot(x - 19.5, v - 11.5) < 1.5 ? 0.5 : 0), 1];
    return c;
  });
  // Spine plate: segmented, a gold seam every few texels.
  solidBox(a, boxUV(o, 0, 39, 8, 1, 20), (u, v) => (u % 8 === 0 || v % 10 === 0 ? gold(u, v) : (u + v) % 13 === 0 ? [200, 200, 205] : iron(u + 300, v)));
  // Crest spikes: iron with gold tips.
  solidBox(a, boxUV(o, 56, 39, 2, 3, 2), (u, v) => (v < 2 ? gold(u, v) : iron(u + 400, v)), 0, 1.2, 0.6);
}
