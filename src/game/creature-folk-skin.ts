// Sheets for the wandering trader (deep blue robe and hood, darker cuffs, gold trim) and his
// llamas (fluffy cream coat, a bright woven carpet, wooden chests).
import { mixc, on, round } from './paint-skins';
import { clamp, fbm2, hash2 } from './rng';
import { ramp, type Pix, type RGB } from './textures';
import { box, boxA, boxUV, furMat, fw, mulc, noiseMat, solidBox, type BoxUV, type O } from './creature-kit';

const SKIN = ['#6a4630', '#845a3e', '#9c6e4e', '#b0805c', '#c4946c'] as const;
const ROBE = ['#0c1634', '#132048', '#1a2c5e', '#243a76', '#30498c', '#3e5aa2'] as const;
const GOLD = ['#8a6210', '#b8881c', '#dcac30', '#f2cc52'] as const;
const LLAMA = ['#8a6c48', '#a6885e', '#bea076', '#d2b68e', '#e2cca8', '#f0e0c4'] as const;
const WOOD = ['#4a2e14', '#62401e', '#7a5228', '#946634', '#a87a40'] as const;

export function paintTrader(a: Pix, o: O, seed: number): void {
  const skin = noiseMat(SKIN, seed, 4, 0.5);
  const robe = noiseMat(ROBE, seed + 1, 3, 0.5, 0.08, 0, 7);
  const gold = (u: number, v: number): RGB => ramp(GOLD, clamp(0.55 + (hash2(u, v, seed + 2) - 0.5) * 0.6, 0, 1));
  const head = boxUV(o, 0, 0, 8, 10, 8);
  box(a, head, (s, y) => mulc(skin(s, y), y === 19 ? 0.8 : 1), (x, y) => skin(x + 50, y), (x, y) => mulc(skin(x + 80, y), 0.7));
  const f = on(a, head.front);
  f.rect(2, 7, 12, 1, '#2a1a10'); // the brow
  for (const ex of [2, 10]) {
    f.rect(ex, 9, 4, 2, '#f0ece4');
    f.rect(ex + (ex === 2 ? 2 : 0), 9, 2, 2, '#2a7a3a');
  }
  f.rect(5, 16, 6, 1, '#4a2a1c');
  solidBox(a, boxUV(o, 24, 0, 2, 4, 2), (u, v) => mulc(skin(u + 120, v), 0.95));
  // Hood (cut-out): blue all round with a gold hem, open at the face.
  boxA(a, boxUV(o, 32, 0, 8, 10, 8), (u, v, face, x) => {
    if (face === 'bottom') return null;
    if (face === 'front' && x > 1 && x < 14 && v > 3) return null;
    let c = robe(u, v);
    if ((face === 'front' && (v === 3 || x === 1 || x === 14)) || (face !== 'front' && face !== 'top' && v === 19)) c = gold(u, v);
    return [c, 1];
  });
  // Robe: a gold hem and a gold-edged opening down the front, a dark sash.
  const body = boxUV(o, 0, 20, 8, 20, 6);
  box(
    a,
    body,
    (s, y, side, x) => {
      let c = robe(s + 200, y);
      if (y >= 36) c = y === 36 || y === 39 ? gold(s, y) : mulc(c, 0.75);
      if (side === 'front' && (x === 6 || x === 9) && y > 4 && y < 36) c = gold(s, y);
      if (side === 'front' && (x === 7 || x === 8) && y < 36) c = mulc(c, 0.7);
      if (y >= 15 && y <= 17) c = y === 16 ? mulc(gold(s, y), 0.8) : mixc(c, '#0a1024', 0.6);
      return mulc(c, round(x, fw(body, side)) * (y === 0 ? 1.08 : 1));
    },
    (x, y) => robe(x + 300, y),
    (x, y) => mulc(robe(x + 320, y), 0.6),
  );
  // Folded arms: sleeves with darker cuffs, hands showing in the middle.
  const bar = boxUV(o, 32, 20, 8, 4, 4);
  box(a, bar, (s, y, side, x) => {
    if (side === 'front' && x >= 5 && x <= 10) return skin(s + 400, y);
    return mulc(x <= 1 || x >= 14 ? robe(s, y) : mixc(robe(s, y), '#060a1a', 0.5), 1);
  }, (x, y) => (x >= 5 && x <= 10 ? skin(x, y) : robe(x + 450, y)), (x, y) => mulc(robe(x + 470, y), 0.6));
  const up = boxUV(o, 32, 28, 4, 8, 4);
  box(a, up, (s, y, side, x) => mulc(y >= 12 ? mixc(robe(s, y), '#060a1a', 0.55) : robe(s + 500, y), round(x, fw(up, side))), (x, y) => robe(x + 520, y), (x, y) => mulc(robe(x, y), 0.6));
}

export function paintLlama(a: Pix, o: O, seed: number): void {
  const fur = furMat(LLAMA, seed, 0.02);
  const furBox = (b: BoxUV, off: number): void =>
    box(
      a,
      b,
      (s, y, side, x) => mulc(fur(s + off, y), (y === b.h - 1 ? 0.8 : 1) * round(x, fw(b, side))),
      (x, y) => mulc(fur(x + off + 300, y), 1.06),
      (x, y) => mulc(fur(x + off + 400, y), 0.7),
    );
  // Carpet colours: red field, yellow and blue bands, a green diamond.
  const carpet = (u: number, v: number): RGB => {
    const band = Math.floor(v / 3) % 4;
    let c: RGB = band === 1 ? [232, 190, 50] : band === 3 ? [40, 90, 170] : [176, 32, 30];
    if (Math.abs((u % 12) - 6) + Math.abs((v % 12) - 6) < 3) c = [50, 140, 60];
    return mulc(c, 0.9 + hash2(u, v, seed + 3) * 0.2);
  };
  const body = boxUV(o, 0, 0, 12, 10, 16);
  furBox(body, 0);
  // The carpet over the back and down the flanks, with a fringe.
  for (let y = 0; y < body.top.h; y += 1) for (let x = 0; x < body.top.w; x += 1) if (x > 3 && x < body.top.w - 6) a.set(body.top.x + x, body.top.y + y, carpet(x, y));
  for (const r of [body.right, body.left]) {
    for (let y = 0; y < 10; y += 1) {
      for (let x = 6; x < r.w - 10; x += 1) {
        const fringe = y === 9 ? (x % 2 === 0 ? [240, 220, 160] as RGB : null) : carpet(x, y + 4);
        if (fringe) a.set(r.x + x, r.y + y, fringe);
      }
    }
  }
  const neck = boxUV(o, 0, 26, 8, 18, 6);
  furBox(neck, 1000);
  furBox(boxUV(o, 28, 26, 4, 14, 4), 1500);
  for (const r of [boxUV(o, 28, 26, 4, 14, 4)].flatMap((b) => [b.front, b.back, b.right, b.left])) on(a, r).rect(0, 25, r.w, 3, '#3a2c20');
  const ear = boxUV(o, 44, 26, 3, 3, 2);
  furBox(ear, 1700);
  on(a, ear.front).rect(1, 1, 4, 4, '#9a6a58');
  furBox(boxUV(o, 44, 31, 4, 5, 2), 1800);
  // Snout: paler muzzle, dark eyes on its sides near the back, nostrils and mouth on the front.
  const snout = boxUV(o, 28, 44, 4, 4, 9);
  furBox(snout, 2000);
  for (const r of [snout.right, snout.left]) {
    const e = on(a, r);
    const back = r === snout.right ? 2 : r.w - 5;
    e.rect(back, 2, 3, 2, '#141010');
    e.set(back + 1, 2, '#6a6060');
  }
  const sf = on(a, snout.front);
  sf.mixRect(0, 3, 8, 5, '#f4ead4', 0.5);
  sf.rect(1, 2, 2, 1, '#2a1c14');
  sf.rect(5, 2, 2, 1, '#2a1c14');
  sf.rect(2, 6, 4, 1, '#3a2a1e');
  // Chests: planks, iron corner bands and a latch.
  const wood = noiseMat(WOOD, seed + 5, 6, 0.6, 0.1, 0, 1.5);
  const chest = boxUV(o, 0, 50, 8, 8, 3);
  solidBox(a, chest, (u, v) => (v % 5 === 4 ? mulc(wood(u, v), 0.65) : wood(u, v)));
  const cf = on(a, chest.front);
  for (const [x, y] of [[0, 0], [14, 0], [0, 14], [14, 14]] as const) cf.rect(x, y, 2, 2, '#5a5a5e');
  cf.rect(6, 5, 4, 4, '#8a8a90');
  cf.rect(7, 6, 2, 2, '#3a3a3e');
}
