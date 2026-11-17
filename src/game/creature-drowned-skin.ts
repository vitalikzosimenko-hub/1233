// The drowned's sheet: waterlogged teal skin, faded cyan shirt and brown trousers in tatters, wet
// weed-hair, kelp strands and the trident's sea-green metal.
import { glowSet, k, mixc, on, round, tearDist, type Tear } from './paint-skins';
import { fbm2, hash2, clamp } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, boxA, fw, mulc, noiseMat, solidBox, type O } from './creature-kit';

const SKIN = ['#1c423c', '#265650', '#2f6a60', '#3b7e70', '#4f9482', '#68aa96'] as const;
const SHIRT = ['#173c46', '#1f5260', '#2a6878', '#3a8090', '#5098a6', '#6cb0ba'] as const;
const PANTS = ['#241a12', '#33261a', '#443324', '#56412e', '#685138'] as const;
const KELP = ['#0f2a14', '#17401c', '#215626', '#2c6c30', '#3c843c', '#58a050'] as const;
const HAIR = ['#0c1c14', '#12291c', '#1a3826', '#234830', '#2e5a3a'] as const;
const METAL = ['#1c3c42', '#27565e', '#357480', '#4c95a0', '#74bcc2', '#b4e6e6'] as const;

const SHIRT_TEARS: readonly Tear[] = [[10, 8, 2.4, 1.8], [19, 15, 1.7, 2.4], [30, 6, 1.5, 2], [39, 12, 2.6, 1.8], [45, 4, 1.4, 1.5]];

export function paintDrowned(a: Pix, o: O, seed: number): void {
  const skinM = noiseMat(SKIN, seed, 4.5, 0.6);
  const algae = (u: number, v: number, c: RGB): RGB => {
    const m = fbm2(u / 5, v / 5, seed + 11);
    if (m > 0.62) return mixc(c, '#5e9a4a', clamp((m - 0.62) * 3, 0, 0.55));
    if (m < 0.3) return mixc(c, '#14302c', clamp((0.3 - m) * 2.5, 0, 0.5));
    return c;
  };
  const skin = (u: number, v: number): RGB => algae(u, v, skinM(u, v));
  const shirt = noiseMat(SHIRT, seed + 1, 5, 0.55, 0.1, 0, 7);
  const pants = noiseMat(PANTS, seed + 2, 4, 0.6);
  const hair = (u: number, v: number): RGB => mulc(ramp(HAIR, clamp(0.5 + (fbm2(u / 1.5, v / 5, seed + 3) - 0.5) * 1.6, 0, 1)), 1);
  const kelp = (u: number, v: number): RGB => ramp(KELP, clamp(0.5 + (fbm2(u / 1.3, v / 4, seed + 4) - 0.5) * 1.5 + (hash2(u, v, seed) - 0.5) * 0.15, 0, 1));

  // ---- head: teal face, dark weed-hair over the crown, faint cyan eyes
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    head,
    (s, y, side) => {
      const fringe = side === 'front' ? 2 + (hash2(s, 0, seed) < 0.35 ? 1 : 0) : side === 'back' ? 11 + Math.floor(hash2(s, 1, seed) * 4) : 4 + Math.floor(hash2(s, 2, seed) * 4);
      if (y < fringe) return mulc(hair(s, y), y === fringe - 1 ? 0.8 : 1);
      let c = skin(s, y);
      if (y === fringe) c = mulc(c, 0.82);
      if (y === 15) c = mulc(c, 0.8);
      return c;
    },
    (x, y) => hair(x + 40, y + 40),
    (x, y) => mulc(skin(x + 80, y), 0.65),
  );
  const f = on(a, head.front);
  f.mixRect(1, 5, 14, 1, '#0a1a18', 0.45);
  for (const ex of [2, 10]) {
    f.rect(ex, 6, 4, 3, '#0d201e');
    glowSet(a, head.front, ex + 1, 7, '#8ff4ff', 0.75);
    glowSet(a, head.front, ex + 2, 7, '#3ec8d8', 0.6);
    f.set(ex + (ex === 2 ? 0 : 3), 8, '#1a3a36');
  }
  f.mixRect(7, 9, 2, 2, '#163a34', 0.6);
  // A slack, torn mouth.
  for (let x = 4; x < 12; x += 1) f.set(x, 12 + (x === 5 || x === 9 ? 1 : 0), x % 3 === 0 ? '#5a6e5c' : '#0c1a16');
  f.mixRect(4, 13, 8, 1, '#0c1a16', 0.4);

  // ---- body: shirt torn to show the skin beneath
  const body = boxUV(o, 16, 16, 8, 12, 4);
  box(
    a,
    body,
    (s, y, side, x) => {
      const t = tearDist(s, y, SHIRT_TEARS, seed + 5);
      const hem = 19 + Math.floor(hash2(s, 3, seed) * 4);
      let c: RGB;
      if (y >= hem) c = mulc(pants(s, y), y === hem ? 0.75 : 1);
      else if (t < 1) c = mulc(skin(s + 100, y), 0.85 + t * 0.1);
      else {
        c = shirt(s, y);
        if (t < 1.35) c = mulc(c, 0.72);
        if (side === 'front' && (x === 7 || x === 8) && y < 6) c = mulc(skin(s + 100, y), 0.9); // open collar
      }
      return mulc(c, y === 0 ? 1.06 : 1);
    },
    (x, y) => (x < 3 || x > 12 ? shirt(x + 300, y) : skin(x + 300, y)),
    (x, y) => mulc(pants(x + 320, y), 0.7),
  );

  // ---- arms: ragged sleeves to the elbow, then bare waterlogged forearms
  const arm = boxUV(o, 40, 16, 4, 12, 4);
  box(
    a,
    arm,
    (s, y, side, x) => {
      const cuff = 9 + Math.floor(hash2(s, 4, seed) * 4);
      const c = y < cuff ? mulc(shirt(s + 200, y), y === cuff - 1 ? 0.75 : 1) : skin(s + 200, y);
      return mulc(c, round(x, fw(arm, side)) * (y >= 22 ? 0.85 : 1));
    },
    (x, y) => shirt(x + 220, y),
    (x, y) => mulc(skin(x + 240, y), 0.7),
  );

  // ---- legs: brown trousers torn at the knee, bare feet
  const leg = boxUV(o, 0, 16, 4, 12, 4);
  box(
    a,
    leg,
    (s, y, side, x) => {
      let c: RGB = y >= 20 ? skin(s + 400, y) : pants(s + 400, y);
      if (y < 20 && Math.hypot((s - 12) / 2, (y - 11) / 1.6) + (hash2(s, y, seed + 6) - 0.5) * 0.5 < 1) c = mulc(skin(s + 400, y), 0.85);
      if (y === 19) c = mulc(c, 0.75);
      return mulc(c, round(x, fw(leg, side)));
    },
    (x, y) => pants(x + 420, y),
    (x, y) => mulc(skin(x + 440, y), 0.6),
  );

  // ---- overlays (cut-out): weed-hair, rag flaps and kelp
  const weed = (u: number, v: number, start: number, depth: number): [RGB, number] | null => {
    const dangle = start + Math.floor(hash2(u, 9, seed + 7) * depth);
    if (v > dangle) return null;
    return [mulc(kelp(u, v), v === dangle ? 0.75 : 1), 1];
  };
  boxA(a, boxUV(o, 32, 0, 8, 8, 8), (u, v, face) => {
    if (face === 'top') return hash2(u, v, seed + 8) < 0.82 ? [kelp(u, v), 1] : null;
    if (face === 'bottom') return null;
    if (face === 'front') return (u % 7 === 2 || u % 7 === 3) ? weed(u, v, 1, 4) : v < 1 ? [kelp(u, v), 1] : null;
    return weed(u, v, face === 'back' ? 8 : 4, face === 'back' ? 8 : 9);
  });
  boxA(a, boxUV(o, 16, 32, 8, 12, 4), (u, v, face, x) => {
    if (face === 'top' || face === 'bottom') return null;
    // A kelp sash over one shoulder, and the shirt's ragged hem flapping below the belt.
    if (face === 'front' && Math.abs(x - (2 + v * 0.55)) < 1.6) return [kelp(u, v), 1];
    if (v >= 17 && v <= 21 + Math.floor(hash2(u, 5, seed) * 5) && hash2(u, 6, seed) < 0.7) return [mulc(shirt(u, v), 0.85), 1];
    return null;
  });
  boxA(a, boxUV(o, 40, 32, 4, 12, 4), (u, v, face) => {
    if (face === 'top' || face === 'bottom') return null;
    const end = 10 + Math.floor(hash2(u, 7, seed) * 6);
    if (v >= 8 && v <= end && hash2(u, 8, seed) < 0.65) return [mulc(shirt(u + 50, v), 0.8), 1];
    if (v >= 14 && v <= 16 && (u + v) % 5 !== 0) return [kelp(u, v), 1]; // weed wound round the wrist
    return null;
  });
  boxA(a, boxUV(o, 0, 32, 4, 12, 4), (u, v, face) => {
    if (face === 'top' || face === 'bottom') return null;
    const end = 19 + Math.floor(hash2(u, 9, seed) * 4);
    if (v >= 17 && v <= end && hash2(u, 10, seed) < 0.75) return [mulc(pants(u, v), 0.85), 1];
    if (v >= 6 && v <= 8 && hash2(u, 11, seed) < 0.8) return [kelp(u, v), 1];
    return null;
  });
  boxA(a, boxUV(o, 16, 48, 2, 12, 2), (u, v, face) => {
    if (face === 'bottom') return null;
    if (v > 18 + Math.floor(hash2(u, 12, seed) * 6)) return null;
    let c = kelp(u * 3, v);
    if (v % 6 === 0) c = mulc(c, 0.7); // the frond's joints
    if (hash2(u, v, seed + 13) < 0.05) c = mixc(c, '#b8e8d8', 0.5); // a bubble
    return [c, 1];
  });

  // ---- the trident: sea-green metal, darker bands on the shaft
  const metal = (u: number, v: number, band: boolean): RGB => {
    let c = ramp(METAL, clamp(0.55 + (fbm2(u / 2, v / 3, seed + 14) - 0.5) * 0.5, 0, 1));
    if (band && v % 7 === 0) c = k(c, 0.65);
    return c;
  };
  solidBox(a, boxUV(o, 56, 16, 1, 12, 1), (u, v) => metal(u, v, true));
  solidBox(a, boxUV(o, 60, 16, 1, 4, 1), (u, v) => mulc(metal(u + 9, v, false), v < 2 ? 1.2 : 1.05));
  solidBox(a, boxUV(o, 0, 48, 5, 1, 1), (u, v) => metal(u + 20, v, false));
}
