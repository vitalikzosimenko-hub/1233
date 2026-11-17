// Sheets for the camel (sandy coat, darker knees and belly, a leather saddle over a red blanket)
// and the temperate frog (orange-brown back with dark spots, cream belly, dark eyes, pale throat).
import { mixc, on, round } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, furMat, fw, mulc, noiseMat, solidBox, type BoxUV, type O } from './creature-kit';

const CAMEL = ['#7a5430', '#9a6e40', '#b48652', '#c89a64', '#d8ac76', '#e6c08e'] as const;
const LEATHER = ['#3a2010', '#522e18', '#6a3e22', '#82502c', '#9a6236'] as const;
const FROG = ['#5e3016', '#80441e', '#a05a28', '#bc7034', '#d48a44', '#e6a45a'] as const;
const BELLY = ['#c8aa78', '#dcc290', '#ead4a6', '#f4e4bc'] as const;

export function paintCamel(a: Pix, o: O, seed: number): void {
  const fur = furMat(CAMEL, seed, 0);
  const furBox = (b: BoxUV, off: number, belly = true): void =>
    box(
      a,
      b,
      (s, y, side, x) => {
        let c = fur(s + off, y);
        if (belly && y > b.h * 0.7) c = mulc(c, 0.86);
        return mulc(c, (y === b.h - 1 ? 0.82 : 1) * round(x, fw(b, side)));
      },
      (x, y) => mulc(fur(x + off + 300, y), 1.07),
      (x, y) => mulc(fur(x + off + 400, y), 0.7),
    );
  const body = boxUV(o, 0, 0, 10, 8, 18);
  furBox(body, 0);
  // A red-and-gold blanket on the back under the saddle.
  const blanket = (u: number, v: number): RGB => (u % 6 === 0 ? [220, 176, 60] : mulc([150, 30, 34], 0.9 + hash2(u, v, seed) * 0.2));
  for (let y = 0; y < body.top.h; y += 1) for (let x = 4; x < 15; x += 1) a.set(body.top.x + x, body.top.y + y, blanket(x, y));
  for (const r of [body.right, body.left]) for (let y = 0; y < 6; y += 1) for (let x = 9; x < 25; x += 1) a.set(r.x + x, r.y + y, y === 5 ? [220, 176, 60] : blanket(x, y + 3));
  furBox(boxUV(o, 0, 26, 6, 4, 8), 1000, false);
  furBox(boxUV(o, 28, 26, 5, 14, 5), 1500);
  const leg = boxUV(o, 48, 26, 4, 16, 4);
  furBox(leg, 2000, false);
  // Each leg segment wears the whole strip: darker at its foot end (a knee callus, the foot pad).
  for (const r of [leg.front, leg.back, leg.right, leg.left]) on(a, r).mixRect(0, 28, r.w, 4, '#4a3220', 0.5);
  furBox(boxUV(o, 56, 0, 2, 1, 2), 2500, false);
  furBox(boxUV(o, 56, 4, 1, 8, 1), 2600, false);
  // Head: darker muzzle at the front, heavy-lidded eyes on the sides.
  const head = boxUV(o, 0, 38, 5, 5, 9);
  furBox(head, 3000, false);
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    const ex = r === head.right ? 4 : r.w - 7;
    e.rect(ex, 3, 3, 2, '#141010');
    e.rect(ex - 1, 2, 5, 1, '#6a4a2a');
    const mz = r === head.right ? r.w - 5 : 0;
    e.mixRect(mz, 4, 5, 6, '#5a3c22', 0.4);
  }
  const hf = on(a, head.front);
  hf.mixRect(0, 3, 10, 7, '#6a4628', 0.35);
  hf.rect(2, 4, 2, 1, '#1e140c');
  hf.rect(6, 4, 2, 1, '#1e140c');
  hf.rect(2, 8, 6, 1, '#3a2614');
  // Saddle: worn leather with stitching and brass studs.
  const lea = noiseMat(LEATHER, seed + 4, 3, 0.7);
  solidBox(a, boxUV(o, 0, 52, 8, 2, 10), (u, v) => {
    if ((u + v) % 7 === 0) return [200, 160, 70];
    return v === 1 || v === 2 ? mulc(lea(u, v), 0.75) : lea(u, v);
  });
}

export function paintFrog(a: Pix, o: O, seed: number): void {
  const back = noiseMat(FROG, seed, 3, 0.55);
  const skin = (u: number, v: number, t: number): RGB => {
    let c = back(u, v);
    if (fbm2(u / 2.2, v / 2.2, seed + 1) > 0.66) c = mixc(c, '#3e1e0c', 0.7); // dark spots
    if (t > 0) c = mixc(c, ramp(BELLY, clamp(0.5 + (hash2(u, v, seed + 2) - 0.5) * 0.6, 0, 1)), t);
    return c;
  };
  const frogBox = (b: BoxUV, off: number, bellyFrom: number): void =>
    box(
      a,
      b,
      (s, y, side, x) => mulc(skin(s + off, y, y >= b.h * bellyFrom ? 0.85 : 0), (y === 0 ? 1.06 : 1) * round(x, fw(b, side))),
      (x, y) => mulc(skin(x + off + 300, y, 0), 1.05),
      (x, y) => mulc(skin(x + off + 400, y, 0.9), 0.9),
    );
  frogBox(boxUV(o, 0, 0, 7, 4, 8), 0, 0.6);
  const head = boxUV(o, 0, 12, 8, 3, 7);
  frogBox(head, 1000, 0.7);
  const hf = on(a, head.front);
  hf.rect(0, 3, 16, 1, '#2a1408'); // the wide mouth line
  hf.set(5, 1, '#2a1408');
  hf.set(10, 1, '#2a1408');
  // Eyes: dark glossy domes with a light glint, a brown rim below.
  const eye = boxUV(o, 32, 0, 3, 2, 3);
  box(
    a,
    eye,
    (s, y) => (y >= 3 ? skin(s + 2000, y, 0) : y === 0 && s % 6 === 1 ? [210, 200, 170] : mulc([30, 22, 14], 1 + hash2(s, y, seed) * 0.3)),
    (x, y) => (x === 1 && y === 1 ? [220, 210, 180] : [36, 26, 16]),
    (x, y) => skin(x + 2100, y, 0),
  );
  frogBox(boxUV(o, 32, 5, 2, 3, 2), 2200, 2);
  frogBox(boxUV(o, 44, 0, 3, 5, 3), 2300, 0.8);
  frogBox(boxUV(o, 32, 17, 2, 4, 2), 2400, 2);
  // Webbed feet: paler, toes darker.
  solidBox(a, boxUV(o, 44, 8, 4, 1, 4), (u, v) => (u % 3 === 0 ? skin(u + 2500, v, 0.2) : skin(u + 2500, v, 0.55)));
  // Throat sac: pale cream, a little pink.
  solidBox(a, boxUV(o, 40, 17, 4, 2, 3), (u, v) => mixc(ramp(BELLY, clamp(0.7 + (hash2(u, v, seed + 3) - 0.5) * 0.4, 0, 1)), '#e8b0a0', 0.25));
}
