// The Brood Queen's sheet: black-purple carapace plates with a violet sheen and red bristles, eight
// glowing red eyes, a pale swollen egg sac veined with sickly green-yellow and shadowed eggs inside,
// banded legs, bone-tipped spikes and fangs.
import { glowSet, mixc, on, round } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, fw, mulc, solidBox, type O } from './creature-kit';

const SHELL = ['#08050a', '#100a14', '#191020', '#24162e', '#321e40', '#462a58'] as const;
const SAC = ['#6e6656', '#8a806c', '#a69a82', '#c0b498', '#d6cbb0', '#e8e0c8'] as const;
const VEIN = '#b8d860';
const BONE = ['#6a5a6e', '#8e7c90', '#b4a2b4', '#d6c8d4', '#efe6ec'] as const;

export function paintQueen(a: Pix, o: O, seed: number): void {
  /** Carapace: dark plates with a violet sheen, seams and coarse red-brown bristles. */
  const shell = (u: number, v: number, bias = 0): RGB => {
    const n = fbm2(u / 3.5, v / 3.5, seed);
    let c = ramp(SHELL, clamp(0.5 + bias + (n - 0.5) * 0.7 + (hash2(u, v, seed + 1) - 0.5) * 0.12, 0, 1));
    const sheen = fbm2(u / 6, v / 2.5, seed + 2);
    if (sheen > 0.62) c = mixc(c, '#6a3e8a', clamp((sheen - 0.62) * 2.2, 0, 0.45));
    const h = hash2(u, v >> 1, seed + 3);
    if (h > 0.965) c = mixc(c, '#7a2a1e', 0.7); // bristles
    return c;
  };
  /** The sac: pale membrane, veins glowing faintly, eggs shadowed within. */
  const sacTex = (u: number, v: number): [RGB, number] => {
    const n = fbm2(u / 5, v / 5, seed + 4);
    let c = ramp(SAC, clamp(0.55 + (n - 0.5) * 0.7 + (hash2(u, v, seed + 5) - 0.5) * 0.1, 0, 1));
    const cell = fbm2(u / 2.6, v / 2.6, seed + 6);
    if (cell > 0.6) c = mixc(c, '#f4eedc', clamp((cell - 0.6) * 3, 0, 0.6)); // egg domes
    else if (cell < 0.36) c = mixc(c, '#5a4e46', clamp((0.36 - cell) * 2.4, 0, 0.5)); // shadows between
    const vein = Math.abs(fbm2(u / 5, v / 5, seed + 7, 2) - 0.5);
    if (vein < 0.022) return [mixc(c, VEIN, 0.85), 0.5];
    if (vein < 0.04) return [mixc(c, VEIN, 0.35), 0.15];
    return [c, 0];
  };

  // ---- abdomen: pale sac, a dark carapace saddle over the front of its back
  const sac = boxUV(o, 0, 0, 16, 14, 16);
  const put = (r: { x: number; y: number; w: number; h: number }, fn: (x: number, y: number) => [RGB, number]): void => {
    for (let y = 0; y < r.h; y += 1) {
      for (let x = 0; x < r.w; x += 1) {
        const [c, g] = fn(x, y);
        a.set(r.x + x, r.y + y, c);
        if (g > 0) a.E(r.x + x, r.y + y, g);
      }
    }
  };
  // Top: u runs back to front, v left to right. A carapace saddle near the front with a spine ridge.
  put(sac.top, (x, y) => {
    const front = x / (sac.top.w - 1);
    const across = Math.abs(y - (sac.top.h - 1) / 2) / (sac.top.h / 2);
    if (front > 0.72 - across * 0.18 + (hash2(y, 0, seed) - 0.5) * 0.06) return [mulc(shell(x, y, 0.05), across < 0.12 ? 1.35 : 1), 0];
    if (across < 0.1 && x % 6 < 3) return [shell(x + 30, y), 0]; // dark spine plates down the back
    return sacTex(x + 300, y);
  });
  for (const [r, off] of [[sac.right, 0], [sac.left, 100], [sac.back, 400]] as const) {
    put(r, (x, y) => {
      const [c0, g] = sacTex(x + off, y);
      // Darker toward the belly, ringed with faint segment seams and a row of dark chevrons.
      let c = mulc(c0, (1.06 - (y / r.h) * 0.4) * round(x, r.w));
      if ((x + Math.round(Math.sin(y * 0.3) * 1.5)) % 9 === 0) c = mixc(c, '#3a2a3a', 0.45);
      const chev = Math.abs(((x + 4) % 9) - 4);
      if (y > 3 && y < 8 && chev < 2 - (y - 3) * 0.3) c = mixc(c, SHELL[3]!, 0.75);
      return [c, g];
    });
  }
  // The front (against the thorax) is carapace.
  put(sac.front, (x, y) => [shell(x + 500, y, -0.05), 0]);
  put(sac.bottom, (x, y) => [mulc(sacTex(x + 600, y)[0], 0.7), 0]);

  // ---- head: carapace, eight red eyes, a dark maw under them
  const head = boxUV(o, 0, 30, 9, 8, 8);
  box(a, head, (s, y) => mulc(shell(s + 700, y), y === 0 ? 1.15 : y === 15 ? 0.7 : 1), (x, y) => shell(x + 760, y, 0.08), (x, y) => mulc(shell(x + 790, y), 0.6));
  const f = on(a, head.front);
  f.mixRect(0, 10, 18, 6, '#040206', 0.5);
  f.mixRect(2, 1, 14, 1, '#6a3e8a', 0.3);
  const eye = (x: number, y: number, w: number, h: number): void => {
    f.rect(x - 1, y - 1, w + 2, h + 2, '#050206');
    for (let yy = 0; yy < h; yy += 1) {
      for (let xx = 0; xx < w; xx += 1) glowSet(a, head.front, x + xx, y + yy, xx === 0 && yy === 0 ? '#ffd0c0' : yy === h - 1 ? '#a8100a' : '#f02a16', 1);
    }
  };
  eye(5, 5, 3, 3);
  eye(10, 5, 3, 3);
  eye(2, 3, 2, 2);
  eye(14, 3, 2, 2);
  eye(7, 1, 1, 1);
  eye(10, 1, 1, 1);
  eye(1, 7, 1, 1);
  eye(16, 7, 1, 1);
  // Bone-pale mouthparts.
  for (let x = 6; x < 12; x += 1) if (x % 2 === 0) f.set(x, 13, '#b4a2b4');

  // ---- thorax: plated, a pale hourglass mark on top
  const thorax = boxUV(o, 34, 30, 7, 6, 8);
  box(
    a,
    thorax,
    (s, y, side, x) => mulc(shell(s + 900, y), (y === 0 ? 1.15 : 1) * round(x, fw(thorax, side))),
    (x, y) => {
      const c = shell(x + 950, y, 0.1);
      const cx = Math.abs(x - 7.5);
      const cy = Math.abs(y - 6.5);
      return cy < 3.5 && cx < 0.6 + cy * 0.7 ? mixc(c, '#c42a1e', 0.8) : c; // a red hourglass
    },
    (x, y) => mulc(shell(x + 980, y), 0.6),
  );

  // ---- legs: dark banded segments, joints ringed red, pale tips
  solidBox(a, boxUV(o, 0, 46, 3, 14, 3), (u, v) => {
    let c = shell(u + 1100, v, 0.05);
    if (v % 9 === 0) c = mixc(c, '#6a1a14', 0.6);
    return c;
  });
  solidBox(a, boxUV(o, 12, 46, 2, 14, 2), (u, v) => {
    let c = shell(u + 1200, v, 0.02);
    if (v > 22) c = mixc(c, ramp(BONE, clamp((v - 22) / 8, 0, 1)), 0.75); // pale claw tip
    if (v % 8 === 0) c = mixc(c, '#6a1a14', 0.5);
    return c;
  });
  // ---- spikes and fangs: dark roots, bone tips
  for (const u0 of [20, 28]) {
    solidBox(a, boxUV(o, u0, 46, 2, 4, 2), (u, v) => {
      const t = clamp(1 - v / 7, 0, 1);
      return t > 0.45 ? ramp(BONE, clamp(t - 0.2 + hash2(u, v, seed) * 0.15, 0, 1)) : shell(u + 1300, v);
    }, u0 * 10, 1.25, 0.6);
  }
  // ---- eggs: pale, glossy
  solidBox(a, boxUV(o, 36, 46, 3, 3, 3), (u, v) => mixc(ramp(SAC, clamp(0.75 + (fbm2(u / 2, v / 2, seed + 8) - 0.5) * 0.4, 0, 1)), '#fffbe8', v < 2 ? 0.35 : 0));
}
