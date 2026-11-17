// The magma cube's sheet: black-red crust split by glowing orange cracks, a faint seam between
// each slab, glowing eyes, the crust's molten inside and the white-hot core.
import { mixc, on } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, glowRect, mulc, type O } from './creature-kit';

const CRUST = ['#120404', '#1e0806', '#2c0c08', '#3c120a', '#4e1a0e', '#62220e'] as const;
const MAGMA = ['#8a1804', '#c43a08', '#ec6a10', '#ff9a20', '#ffc848', '#fff09a'] as const;

export function paintMagmaCube(a: Pix, o: O, seed: number): void {
  /** Crust with glowing cracks: returns colour and glow. */
  const lava = (u: number, v: number, slabSeams: boolean): [RGB, number] => {
    const n = fbm2(u / 3, v / 3, seed);
    let c = ramp(CRUST, clamp(0.5 + (n - 0.5) * 0.9 + (hash2(u, v, seed + 1) - 0.5) * 0.15, 0, 1));
    const crack = Math.abs(fbm2(u / 4.5, v / 4.5, seed + 2, 2) - 0.5);
    const crack2 = Math.abs(fbm2(u / 3, v / 3, seed + 3, 2) - 0.5);
    let glow = 0;
    if (crack < 0.035) {
      const t = 1 - crack / 0.035;
      c = ramp(MAGMA, clamp(0.35 + t * 0.6, 0, 1));
      glow = 0.55 + t * 0.45;
    } else if (crack < 0.06) {
      c = mixc(c, MAGMA[0]!, 0.6);
      glow = 0.25;
    } else if (crack2 < 0.02) {
      c = mixc(c, MAGMA[1]!, 0.7);
      glow = 0.4;
    }
    // Each slab's bottom edge: a darker seam (they separate along these).
    if (slabSeams && v % 2 === 1 && glow < 0.5) c = mulc(c, 0.72);
    return [c, glow];
  };
  const put = (r: { x: number; y: number }, x: number, y: number, cg: [RGB, number]): void => {
    a.set(r.x + x, r.y + y, cg[0]);
    if (cg[1] > 0) a.E(r.x + x, r.y + y, cg[1]);
  };
  const outer = boxUV(o, 0, 0, 8, 8, 8);
  for (const [r, off, seams] of [[outer.right, 0, true], [outer.front, 16, true], [outer.left, 32, true], [outer.back, 48, true], [outer.top, 200, false], [outer.bottom, 300, false]] as const) {
    for (let y = 0; y < r.h; y += 1) for (let x = 0; x < r.w; x += 1) put(r, x, y, lava(x + off, y, seams));
  }
  // Eyes: glowing yellow-orange, a red slit in each.
  const f = on(a, outer.front);
  for (const ex of [2, 10]) {
    f.rect(ex - 1, 5, 6, 4, '#0c0202');
    glowRect(a, outer.front, ex, 6, 4, 2, '#ffd040', 1);
    glowRect(a, outer.front, ex + (ex === 2 ? 2 : 1), 6, 1, 2, '#d02a08', 0.9);
    glowRect(a, outer.front, ex, 6, 4, 1, '#fff0a0', 1);
  }
  // A ragged mouth line.
  for (let x = 4; x < 12; x += 1) glowRect(a, outer.front, x, 11 + (x % 3 === 0 ? 1 : 0), 1, 1, '#c43a08', 0.6);

  // The inside of a slab: crust rim, molten middle.
  const ix = o[0];
  const iy = o[1] + 32;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) / 8;
      const n = fbm2(x / 3, y / 3, seed + 5);
      if (d > 0.82) put({ x: ix, y: iy }, x, y, lava(x + 400, y, false));
      else put({ x: ix, y: iy }, x, y, [ramp(MAGMA, clamp(0.85 - d * 0.7 + (n - 0.5) * 0.4, 0, 1)), 0.9]);
    }
  }
  // The core: white-hot.
  const core = boxUV(o, 32, 0, 4, 4, 4);
  box(
    a,
    core,
    (s, y) => ramp(MAGMA, clamp(0.7 + (fbm2(s / 2, y / 2, seed + 6) - 0.5) * 0.6, 0, 1)),
    (x, y) => ramp(MAGMA, clamp(0.8 + (hash2(x, y, seed) - 0.5) * 0.3, 0, 1)),
    (x, y) => ramp(MAGMA, clamp(0.6 + (hash2(x, y, seed) - 0.5) * 0.3, 0, 1)),
  );
  for (const r of [core.right, core.front, core.left, core.back, core.top, core.bottom]) {
    for (let y = 0; y < r.h; y += 1) for (let x = 0; x < r.w; x += 1) a.E(r.x + x, r.y + y, 1);
  }
}
