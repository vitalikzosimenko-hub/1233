// The polar bear's sheet: thick white fur shading to cream and grey underneath, black nose and
// eyes, a pink-dark mouth, dark claws.
import { mixc, on } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, fw, furMat, mulc, type BoxUV, type O } from './creature-kit';
import { round } from './paint-skins';

const FUR = ['#a8a496', '#c4c0b2', '#d8d5ca', '#e8e6de', '#f2f1ec', '#fbfaf7'] as const;
const CREAM = '#d8ccae';

export function paintPolarBear(a: Pix, o: O, seed: number): void {
  const fur = furMat(FUR, seed, 0.05);
  /** A fur box: creamier and darker toward its underside. */
  const furBox = (b: BoxUV, off: number, belly = 0.25): void =>
    box(
      a,
      b,
      (s, y, side, x) => {
        let c = fur(s + off, y);
        const t = y / b.h;
        if (t > 0.6) c = mixc(c, CREAM, (t - 0.6) * belly * 2.5);
        if (y === 0) c = mulc(c, 1.04);
        if (y === b.h - 1) c = mulc(c, 0.82);
        return mulc(c, round(x, fw(b, side)) * (side === 'back' ? 0.95 : 1));
      },
      (x, y) => mulc(fur(x + off + 400, y), 1.06),
      (x, y) => mulc(mixc(fur(x + off + 500, y), CREAM, 0.5), 0.72),
    );
  furBox(boxUV(o, 0, 0, 14, 12, 16), 0);
  furBox(boxUV(o, 0, 28, 12, 13, 8), 1000);
  furBox(boxUV(o, 50, 49, 2, 2, 1), 3000);
  // Legs: fur, paws darker with black claws peeking at the front.
  const leg = boxUV(o, 40, 28, 4, 10, 4);
  furBox(leg, 1500, 0.5);
  const lf = on(a, leg.front);
  for (let x = 0; x < 8; x += 2) lf.set(x + 1, 19, '#2a2826');
  on(a, leg.bottom).rect(0, 0, 8, 8, '#6a645a');
  // Head.
  const head = boxUV(o, 0, 49, 7, 7, 7);
  furBox(head, 2000, 0.15);
  const f = on(a, head.front);
  for (const ex of [2, 10]) {
    f.rect(ex, 5, 2, 2, '#121214');
    f.set(ex + (ex === 2 ? 1 : 0), 5, '#5a5a62');
  }
  f.mixRect(1, 4, 12, 1, '#b0aa9a', 0.4);
  // Ears: a darker inner ear.
  const ear = boxUV(o, 44, 49, 2, 2, 1);
  furBox(ear, 2500);
  on(a, ear.front).rect(1, 1, 2, 2, '#8a8070');
  // Snout: cream muzzle, a big black nose on the front top.
  const snout = boxUV(o, 28, 49, 5, 3, 3);
  furBox(snout, 2600, 0.6);
  const sn = on(a, snout.front);
  sn.rect(3, 0, 4, 2, '#141416');
  sn.rect(4, 2, 2, 1, '#1e1e22');
  sn.set(3, 0, '#3a3a40');
  sn.mixRect(0, 4, 10, 2, '#3a2a26', 0.55); // the lip line
  on(a, snout.top).mixRect(6, 0, 4, 6, '#141416', 0.85); // the nose seen from above (front end of the top)
  on(a, snout.bottom).rect(0, 0, 10, 6, '#5a2a2a'); // roof of the mouth
  // Jaw: furred outside, a pink tongue inside (its top shows when the mouth opens).
  const jaw = boxUV(o, 28, 55, 5, 1, 3);
  furBox(jaw, 2700, 0.8);
  const tongue = (x: number, y: number): RGB => mixc(ramp(['#6a2228', '#94343a', '#b8505a'], clamp(0.5 + (fbm2(x / 2, y / 2, seed + 4) - 0.5), 0, 1)), '#2a1012', x > 7 ? 0.5 : 0);
  for (let y = 0; y < jaw.top.h; y += 1) for (let x = 0; x < jaw.top.w; x += 1) a.set(jaw.top.x + x, jaw.top.y + y, hash2(x, y, seed) < 0.1 && x > 6 ? [230, 226, 214] : tongue(x, y));
  on(a, jaw.front).rect(0, 0, 10, 1, '#efece2'); // a row of teeth
}
