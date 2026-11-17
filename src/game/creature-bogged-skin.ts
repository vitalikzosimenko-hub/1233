// The bogged's sheet: green-grey bone furred with moss, deep sockets with a dim green glint, vines
// through the ribs, and its mushrooms.
import { glowSet, k, mixc, on, round, type Side } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, boxA, mulc, solidBox, type O } from './creature-kit';

const BONE = ['#465838', '#5a6c4a', '#6e805c', '#83946c', '#98a77e', '#adb992'] as const;
const MOSS = ['#2a4416', '#36561c', '#456c24', '#55822c', '#6a9a38', '#84b04a'] as const;
const GAP = '#141a10';
const RED = ['#6a0e0c', '#8e1812', '#b4241a', '#d03a26'] as const;
const BROWN = ['#5a3c26', '#704c30', '#86603e', '#9c744e'] as const;

export function paintBogged(a: Pix, o: O, seed: number): void {
  const moss = (u: number, v: number): RGB => ramp(MOSS, clamp(0.5 + (fbm2(u / 1.8, v / 1.8, seed + 2) - 0.5) * 1.3 + (hash2(u, v, seed) - 0.5) * 0.2, 0, 1));
  const bone = (u: number, v: number, bias = 0): RGB => {
    const n = fbm2(u / 4, v / 4, seed);
    let c = ramp(BONE, clamp(0.6 + bias + (n - 0.5) * 0.55 + (hash2(u, v, seed + 1) - 0.5) * 0.1, 0, 1));
    if (Math.abs(fbm2(u / 3, v / 3, seed + 5) - 0.5) < 0.014) c = k(c, 0.72); // hairline cracks
    const m = fbm2(u / 4.5, v / 4.5, seed + 7);
    if (m > 0.6) c = mixc(c, moss(u, v), clamp((m - 0.6) * 4, 0, 0.85)); // moss in the hollows
    return c;
  };
  const gap = (u: number, v: number): RGB => {
    const c = k(mixc([20, 26, 16], '#26361a', hash2(u, v, seed + 3)), 1);
    return hash2(u, v, seed + 4) < 0.18 ? mixc(c, moss(u, v), 0.5) : c;
  };

  // ---- skull
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(a, head, (s, y) => k(bone(s, y), y === 15 ? 0.82 : y === 0 ? 1.05 : 1), (x, y) => bone(x + 60, y, 0.05), (x, y) => k(bone(x + 90, y), 0.6));
  const f = on(a, head.front);
  f.mulRect(1, 5, 14, 1, 0.82);
  for (const ex of [2, 10]) {
    f.rect(ex, 6, 4, 4, '#1a2214');
    f.rect(ex + 1, 7, 2, 2, '#0c100a');
    glowSet(a, head.front, ex + (ex === 2 ? 2 : 1), 8, '#9adf6a', 0.55);
    f.mulRect(ex, 10, 4, 1, 0.86);
  }
  f.rect(7, 10, 2, 2, GAP);
  for (let x = 3; x <= 12; x += 1) {
    if ((x & 1) === 0) {
      f.mul(x, 12, 0.62);
      f.mul(x, 14, 0.64);
    }
    f.set(x, 13, GAP);
  }
  f.mulRect(3, 15, 10, 1, 0.85);

  // ---- ribcage over a dark hollow, vines already threading it
  const body = boxUV(o, 16, 16, 8, 12, 4);
  const rib = (side: Side, x: number, y: number): number => {
    const off = Math.abs(x - 7.5);
    for (let i = 0; i < 3; i += 1) {
      const y0 = 3 + i * 4;
      const c = side === 'front' ? y0 + Math.round(off * 0.28) : y0 + 1;
      if (y === c) return 1;
      if (y === c + 1) return 2;
    }
    return 0;
  };
  box(
    a,
    body,
    (s, y, side, x) => {
      const mid = x === 7 || x === 8;
      if ((side === 'front' || side === 'back') && mid && y < 19) return k(bone(s, y), y % 3 === 2 ? 0.7 : 1);
      if (y <= 1) return k(bone(s, y), y === 1 ? 0.82 : 1.04);
      if (y >= 19 && y <= 20) return k(bone(s, y), y === 20 ? 0.85 : 1.02);
      if (y >= 21 && (side === 'right' || side === 'left' || x <= 5 || x >= 10)) return k(bone(s, y), y === 23 ? 0.72 : 0.94);
      const r = rib(side, x, y);
      if (r === 1) return k(bone(s, y), 1.04);
      if (r === 2) return k(bone(s, y), 0.78);
      return gap(s, y);
    },
    (x, y) => (x < 2 || x > 13 || y < 2 || y > 5 ? bone(x + 70, y + 30) : gap(x, y)),
    (x, y) => (x < 2 || x > 13 || y < 2 || y > 5 ? k(bone(x + 90, y + 30), 0.7) : gap(x, y)),
  );

  // ---- limbs
  const limb = (b: ReturnType<typeof boxUV>, off: number): void =>
    box(
      a,
      b,
      (s, y, _side, x) => {
        let c = bone(s + off, y);
        if (y === 11 || y === 13) c = k(c, 1.05);
        if (y === 12) c = k(c, 0.66);
        if (y >= 22) c = k(c, 0.86);
        return k(c, round(x, 4));
      },
      (x, y) => bone(x + off, y + 50),
      (x, y) => k(bone(x + off, y + 60), 0.7),
    );
  limb(boxUV(o, 40, 16, 2, 12, 2), 300);
  limb(boxUV(o, 0, 16, 2, 12, 2), 400);

  // ---- mushrooms
  solidBox(a, boxUV(o, 0, 32, 3, 2, 3), (u, v) => {
    const c = ramp(RED, clamp(0.6 + (fbm2(u / 2, v / 2, seed + 8) - 0.5) * 0.6, 0, 1));
    return hash2(u >> 1, v >> 1, seed + 9) < 0.18 ? mixc(c, '#f4ecd8', 0.9) : c; // white spots
  });
  solidBox(a, boxUV(o, 16, 32, 4, 1, 4), (u, v) => ramp(BROWN, clamp(0.55 + (fbm2(u / 2, v / 2, seed + 10) - 0.5) * 0.7, 0, 1)));
  solidBox(a, boxUV(o, 32, 32, 1, 2, 1), (u, v) => mulc(mixc([228, 218, 196], '#c8b898', hash2(u, v, seed)), 1));

  // ---- overlays (cut-out): moss cap, rib vines, hanging strands
  boxA(a, boxUV(o, 32, 0, 8, 8, 8), (u, v, face) => {
    if (face === 'bottom') return null;
    const m = fbm2(u / 3, v / 3, seed + 11);
    if (face === 'top') return m > 0.36 ? [moss(u, v), 1] : null;
    const drip = 2 + Math.floor(hash2(u, 1, seed + 12) * (face === 'front' ? 2 : 6));
    return v < drip && m > 0.3 ? [mulc(moss(u, v), v === drip - 1 ? 0.75 : 1), 1] : null;
  });
  boxA(a, boxUV(o, 16, 40, 8, 12, 4), (u, v, face, x) => {
    if (face === 'top' || face === 'bottom') return null;
    const vineX = face === 'front' ? [3 + Math.round(Math.sin(v * 0.45) * 1.6), 12 + Math.round(Math.sin(v * 0.35 + 2) * 1.4)] : [6 + Math.round(Math.sin(v * 0.4) * 2)];
    for (const vx of vineX) {
      if (x === vx && v < 21) return [mixc([40, 70, 24], '#4c7a2a', hash2(u, v, seed)), 1];
      if (Math.abs(x - vx) === 1 && v % 5 === 2 && v < 21) return [moss(u, v), 1]; // leaves off the vine
    }
    return null;
  });
  boxA(a, boxUV(o, 44, 32, 2, 8, 1), (u, v, face, x) => {
    if (face !== 'front' && face !== 'back') return null;
    if (v > 12 + Math.floor(hash2(u, 2, seed) * 4)) return null;
    if (x === 1 || x === 2) return [mixc([36, 64, 22], '#4a7a2a', hash2(u, v, seed + 14)), 1];
    return v % 4 === 1 ? [moss(u, v), 1] : null;
  });
}
