// The player's own skin: a Minecraft skin sheet (64x64, classic arms) painted onto the builder's sheet
// of the skin atlas at its 2x scale. Both layers come across: the base boxes solid (a clear pixel
// takes the colour of its nearest neighbour on the same face, as the box is drawn opaque), the outer
// layer (hat, jacket, sleeves, trousers) cut out wherever the skin is clear. The sides go on as they
// are; a top or a bottom is turned the way the models' boxes read it (Minecraft runs a box's top
// across its width, the boxes here along its depth), which the 2x sheet holds pixel for pixel.
import { PLAYER_SKIN_RGBA } from './player-skin-data';
import { SKIN_SCALE, type Pix } from './textures';

/** A box on the sheet: u, v of its corner, then w (across), h (tall), d (deep), in skin pixels. */
type SheetBox = readonly [number, number, number, number, number];

/** How a face is read off the atlas: a side as painted, a top or a bottom turned. */
type Lay = 'side' | 'top' | 'bottom';

/** Head, body, right and left arm, right and left leg. */
const BASE: readonly SheetBox[] = [[0, 0, 8, 8, 8], [16, 16, 8, 12, 4], [40, 16, 4, 12, 4], [32, 48, 4, 12, 4], [0, 16, 4, 12, 4], [16, 48, 4, 12, 4]];
/** Their outer layers: hat, jacket, sleeves, trouser legs. */
const OUTER: readonly SheetBox[] = [[32, 0, 8, 8, 8], [16, 32, 8, 12, 4], [40, 32, 4, 12, 4], [48, 48, 4, 12, 4], [0, 32, 4, 12, 4], [0, 48, 4, 12, 4]];

/** A box's six faces on the sheet: [x, y, w, h, lay] (top, bottom, right, front, left, back). */
function faces([u, v, w, h, d]: SheetBox): Array<[number, number, number, number, Lay]> {
  return [
    [u + d, v, w, d, 'top'],
    [u + d + w, v, w, d, 'bottom'],
    [u, v + d, d, h, 'side'],
    [u + d, v + d, w, h, 'side'],
    [u + d + w, v + d, d, h, 'side'],
    [u + d + w + d, v + d, w, h, 'side'],
  ];
}

function decode(): Uint8ClampedArray {
  const raw = atob(PLAYER_SKIN_RGBA);
  const out = new Uint8ClampedArray(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Paints the player's skin onto the sheet at `o` (its top-left texel). */
export function paintPlayerSkin(a: Pix, o: [number, number]): void {
  const src = decode();
  const sheet = new Uint8ClampedArray(64 * 64 * 4);
  const at = (x: number, y: number): number => (y * 64 + x) * 4;
  for (const box of BASE) {
    for (const [fx, fy, fw, fh] of faces(box)) {
      for (let y = fy; y < fy + fh; y += 1) {
        for (let x = fx; x < fx + fw; x += 1) {
          // (The nearest solid pixel of this face, should this one be clear.)
          let best = at(x, y);
          if (src[best + 3]! < 128) {
            let bestD = Infinity;
            for (let sy = fy; sy < fy + fh; sy += 1) {
              for (let sx = fx; sx < fx + fw; sx += 1) {
                const d = Math.abs(sx - x) + Math.abs(sy - y);
                if (d < bestD && src[at(sx, sy) + 3]! >= 128) {
                  bestD = d;
                  best = at(sx, sy);
                }
              }
            }
          }
          const i = at(x, y);
          sheet[i] = src[best]!;
          sheet[i + 1] = src[best + 1]!;
          sheet[i + 2] = src[best + 2]!;
          sheet[i + 3] = 255;
        }
      }
    }
  }
  for (const box of OUTER) {
    for (const [fx, fy, fw, fh] of faces(box)) {
      for (let y = fy; y < fy + fh; y += 1) {
        for (let x = fx; x < fx + fw; x += 1) {
          const i = at(x, y);
          if (src[i + 3]! < 128) continue;
          sheet[i] = src[i]!;
          sheet[i + 1] = src[i + 1]!;
          sheet[i + 2] = src[i + 2]!;
          sheet[i + 3] = 255;
        }
      }
    }
  }
  const k = SKIN_SCALE;
  for (const box of [...BASE, ...OUTER]) {
    for (const [fx, fy, fw, fh, lay] of faces(box)) {
      for (let j = 0; j < fh * k; j += 1) {
        for (let i = 0; i < fw * k; i += 1) {
          let sx = Math.floor(i / k);
          let sy = Math.floor(j / k);
          if (lay !== 'side') {
            // The atlas runs this face front-to-back along its width and side-to-side down it (a
            // top from the left side down to the right, a bottom the other way); the skin runs it
            // right-to-left across and back-to-front down.
            const along = (i + 0.5) / (fw * k);
            const down = (j + 0.5) / (fh * k);
            sx = Math.min(fw - 1, Math.floor((lay === 'top' ? 1 - down : down) * fw));
            sy = Math.min(fh - 1, Math.floor(along * fh));
          }
          const s = at(fx + sx, fy + sy);
          a.set(o[0] + fx * k + i, o[1] + fy * k + j, [sheet[s]!, sheet[s + 1]!, sheet[s + 2]!], sheet[s + 3]!);
        }
      }
    }
  }
}
