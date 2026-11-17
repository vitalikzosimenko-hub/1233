// Veyra's sheet: a robe of black obsidian silk veined with the Heart's green, pale stone skin, a white
// braid, eyes and heart of glowing emerald, and the crystal she is crowned and ringed with.
import { on, round } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxUV, fw, glowBox, mulc, noiseMat, solidBox, type BoxUV, type O } from './creature-kit';

const ROBE = ['#06050a', '#0d0a16', '#151022', '#1e1630', '#2a1f40', '#382a52'] as const;
const VEIN = ['#0a5a2a', '#14a048', '#3cf07a', '#a6ffc8'] as const;
const SKIN = ['#8c8a96', '#a4a2ae', '#bab8c4', '#cfcdd8', '#e2e0ea'] as const;
const HAIR = ['#a8a4b4', '#c4c0d0', '#dcd8e6', '#f2f0f8'] as const;
const CRYSTAL = ['#03301a', '#0a6633', '#1aa751', '#4cff8a', '#9effc4', '#e4fff0'] as const;

/** Veyra's sheet at `o` (model pixels: head 0,0; torso 32,0; arm 0,18; crystal 16,18; heart 28,18; robe 0,36; braid 48,36). */
export function paintVeyra(a: Pix, o: O, seed: number): void {
  // The robe: black silk folds, green veins of the Heart climbing up from the hem.
  const veined = (u: number, v: number, c: RGB, h: number): RGB => {
    const n = fbm2(u / 3, v / 7, seed + 11);
    const climb = Math.abs(((u * 3 + Math.round(Math.sin(v * 0.35 + u) * 2)) % 9) - 4) === 0;
    if (climb && n > 0.48 - (v / h) * 0.25) return ramp(VEIN, clamp(0.3 + n * 0.8, 0, 1));
    return c;
  };
  const robeMat = noiseMat(ROBE, seed, 2.5, 0.5, 0.1, 0, 7);
  const robeBox = (b: BoxUV, off: number): void =>
    box(
      a,
      b,
      (s, y, side, x) => {
        const fold = Math.sin((s + off) * 0.9) * 0.08;
        const c = mulc(robeMat(s + off, y), (1 + fold) * round(x, fw(b, side)));
        return veined(s + off, y, c, b.h);
      },
      (x, y) => mulc(robeMat(x + off + 300, y), 1.1),
      (x, y) => mulc(robeMat(x + off + 500, y), 0.6),
    );
  const robe = boxUV(o, 0, 36, 14, 18, 10);
  robeBox(robe, 0);
  // Its veins glow where they run.
  for (const r of [robe.front, robe.right, robe.left, robe.back]) {
    for (let y = 0; y < r.h; y += 1) {
      for (let x = 0; x < r.w; x += 1) {
        const c = a.rgb(r.x + x, r.y + y);
        if (c[1] > 120 && c[1] > c[0] * 2) a.E(r.x + x, r.y + y, 0.8);
      }
    }
  }
  // Torso: the robe's bodice, a collar of crystal, the Heart showing through a rent in it.
  const torso = boxUV(o, 32, 0, 10, 12, 6);
  robeBox(torso, 700);
  const tf = on(a, torso.front);
  tf.rect(0, 0, torso.w, 2, '#3a2a52');
  // Skin: pale like stone, the Heart's light in the cracks.
  const skinMat = noiseMat(SKIN, seed + 3, 3, 0.4, 0.08);
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    head,
    (s, y, side, x) => {
      let c = skinMat(s, y);
      if (hash2(s, y, seed + 5) > 0.93) c = ramp(VEIN, 0.6);
      // Her hair: a white cap over the top and back.
      if (y < 2 || side === 'back' || ((side === 'right' || side === 'left') && (y < 4 || x > (head.d * 0.6)))) c = ramp(HAIR, 0.3 + hash2(s, y, seed + 6) * 0.6);
      return mulc(c, round(x, fw(head, side)));
    },
    (x, y) => ramp(HAIR, 0.4 + hash2(x, y, seed + 7) * 0.5),
    (x, y) => mulc(skinMat(x + 90, y), 0.7),
  );
  // The face: eyes of glowing green, a thin mouth, cracks of light across one cheek.
  const hf = on(a, head.front);
  const S = 2;
  for (const ex of [1, 5]) {
    hf.rect(ex * S, 3 * S, 2 * S, S, '#06260f');
    for (let y = 3 * S; y < 4 * S; y += 1) {
      for (let x = ex * S; x < (ex + 2) * S; x += 1) {
        a.set(head.front.x + x, head.front.y + y, ramp(CRYSTAL, 0.75 + (x % 2) * 0.1));
        a.E(head.front.x + x, head.front.y + y, 1);
      }
    }
  }
  hf.rect(3 * S, 6 * S, 2 * S, 1, '#4a4656');
  for (let k = 0; k < 6; k += 1) {
    const x = 6 * S + Math.round(Math.sin(k) * 1.5);
    const y = 4 * S + k;
    a.set(head.front.x + x, head.front.y + y, ramp(VEIN, 0.8));
    a.E(head.front.x + x, head.front.y + y, 0.9);
  }
  // Arms: robe sleeves, pale hands.
  const arm = boxUV(o, 0, 18, 4, 14, 4);
  box(
    a,
    arm,
    (s, y, side, x) => {
      if (y >= arm.h - 6) return mulc(skinMat(s + 200, y), round(x, fw(arm, side)));
      return veined(s + 40, y, mulc(robeMat(s + 40, y), round(x, fw(arm, side))), arm.h);
    },
    (x, y) => robeMat(x + 60, y),
    (x, y) => skinMat(x + 260, y),
  );
  // Crystal (the crown's points and the shards round her): bright emerald facets, all aglow.
  const crystal = boxUV(o, 16, 18, 3, 6, 3);
  box(
    a,
    crystal,
    (s, y, side, x) => {
      const facet = (s + y) % 5 === 0 ? 0.25 : 0;
      return mulc(ramp(CRYSTAL, clamp(0.45 + (1 - y / crystal.h) * 0.35 + facet, 0, 1)), 0.9 + 0.2 * round(x, fw(crystal, side)));
    },
    () => ramp(CRYSTAL, 0.95),
    () => ramp(CRYSTAL, 0.4),
  );
  glowBox(a, crystal, 1);
  // The Heart in her chest.
  const heart = boxUV(o, 28, 18, 4, 4, 2);
  solidBox(a, heart, (u, v) => ramp(CRYSTAL, clamp(0.55 + Math.sin(u + v) * 0.2 + hash2(u, v, seed) * 0.2, 0, 1)));
  glowBox(a, heart, 1);
  // The braid down her back.
  const braid = boxUV(o, 48, 36, 2, 16, 2);
  box(
    a,
    braid,
    (s, y) => ramp(HAIR, (y + s) % 4 < 2 ? 0.75 : 0.35),
    () => ramp(HAIR, 0.6),
    () => ramp(HAIR, 0.4),
  );
}
