// The officers' sheets, painted from a short description of each (their faces, hair and clothes, as in
// their portraits), so twelve people share one painter.
import { mixc, on, round } from './paint-skins';
import { clamp, hash2 } from './rng';
import { hex, ramp, type Pix, type RGB } from './textures';
import { box, boxA, boxUV, fw, glowRect, mulc, noiseMat, solidBox, type O } from './creature-kit';

type Stops = readonly string[];

interface Look {
  skin: Stops;
  hair: Stops;
  coat: Stops;
  /** Trousers or skirts, boots. */
  legs: Stops;
  boots: string;
  eye: string;
  /** How the hair lies (over the head's overlay). */
  style: 'short' | 'bald' | 'long' | 'bob' | 'braids' | 'hood' | 'veil' | 'hat';
  beard?: Stops;
  moustache?: string;
  /** Worn over the body: an apron, a sash, a bandolier, a scarf at the neck. */
  over?: { kind: 'apron' | 'sash' | 'bandolier' | 'scarf' | 'stars' | 'gears'; stops: Stops };
  /** The face's marks. */
  marks?: Array<'patch' | 'scar' | 'crystal' | 'goggles' | 'specs' | 'bandana' | 'freckles'>;
  /** The hat's colours (a brim and crown), the prop and its lamp. */
  hat?: Stops;
  prop: string;
  lamp?: string;
}

const LIGHT = ['#8c5a42', '#ad7a5c', '#c8957a', '#dcae94', '#ecc8b0'] as const;
const FAIR = ['#b08468', '#cca080', '#e0b89a', '#efcdb4', '#f8e2d0'] as const;
const BROWN = ['#3a2218', '#54321f', '#6e452c', '#865a3c', '#9c6e4c'] as const;
const OLD = ['#8a6a56', '#a8866e', '#c2a088', '#d6b6a0', '#e6ccb8'] as const;
const WHITE_HAIR = ['#8a8a8a', '#a8a8a8', '#c8c8c8', '#e0e0e0', '#f4f4f4'] as const;
const AUBURN = ['#4a200c', '#6a3012', '#8a4418', '#a85a22', '#c4742e'] as const;
const GINGER = ['#7a2e0c', '#9c4012', '#bc561a', '#d87024', '#ea8c34'] as const;
const BLACK_HAIR = ['#0e0c0c', '#1a1616', '#262020', '#342c2c', '#443a3a'] as const;
const COPPER = ['#6a2c10', '#8a3e16', '#aa541e', '#c86c28', '#e08a38'] as const;
const FAIR_HAIR = ['#8a7240', '#aa8e54', '#c8ac6c', '#e0c888', '#f0dea4'] as const;
const MOSSY = ['#1e3a14', '#2c5018', '#3e6a20', '#54862c', '#6ca03a'] as const;

const LOOKS: Record<string, Look> = {
  brannoc: { skin: OLD, hair: WHITE_HAIR, coat: ['#3a3024', '#4e4232', '#625642', '#766a54', '#8a7e66'], legs: ['#2a2218', '#3a3024', '#4a3e2e', '#5a4e3c', '#6a5e4a'], boots: '#2a1a10', eye: '#4a6a8a', style: 'short', beard: WHITE_HAIR, over: { kind: 'apron', stops: ['#4a2c14', '#5e3a1a', '#744a24', '#8a5a2e', '#a06c3a'] }, marks: ['specs'], prop: '#6a4a2a' },
  wren: { skin: LIGHT, hair: AUBURN, coat: ['#4a2e1a', '#5e3c22', '#74502e', '#8a623a', '#a07646'], legs: ['#3a2a1c', '#4a3626', '#5a4432', '#6a523e', '#7a604a'], boots: '#3a2414', eye: '#3a7ab0', style: 'bob', over: { kind: 'scarf', stops: ['#1e5a24', '#2c7a30', '#3a9a3c', '#50b04e', '#6ac664'] }, marks: ['goggles', 'freckles'], prop: '#000000' },
  bo: { skin: LIGHT, hair: GINGER, coat: ['#b8b4a8', '#ccc8bc', '#dedacc', '#ece8dc', '#f8f4ea'], legs: ['#2a2a34', '#3a3a46', '#4a4a58', '#5a5a6a', '#6a6a7c'], boots: '#2a1a10', eye: '#4a5a3a', style: 'bald', moustache: '#c4601c', over: { kind: 'apron', stops: ['#1e2c4a', '#2a3c62', '#384e7c', '#4a6496', '#5e7ab0'] }, prop: '#8a8a92' },
  amina: { skin: BROWN, hair: ['#0e3a44', '#14505c', '#1c6a78', '#268694', '#34a0ae'], coat: ['#8a6a3a', '#a4824a', '#be9c5e', '#d4b474', '#e6cc90'], legs: ['#7a5c30', '#94723e', '#ae8a50', '#c6a264', '#dabc7c'], boots: '#5a3e20', eye: '#2a1a10', style: 'veil', over: { kind: 'sash', stops: ['#8a6410', '#b8881c', '#dcac30', '#f2cc52', '#ffe48a'] }, prop: '#000000' },
  moss: { skin: LIGHT, hair: MOSSY, coat: ['#1e1230', '#2c1c44', '#3c285a', '#4e3670', '#624686'], legs: ['#1a1028', '#261838', '#342248', '#442e5a', '#543a6c'], boots: '#1a1210', eye: '#5ad060', style: 'hat', hat: ['#0e0e14', '#18181e', '#242428', '#303034', '#3e3e42'], prop: '#000000' },
  gil: { skin: OLD, hair: ['#5a5a5a', '#747474', '#8e8e8e', '#a8a8a8', '#c0c0c0'], coat: ['#2e3a24', '#3e4c30', '#4e5e3c', '#607248', '#748658'], legs: ['#2a2a20', '#3a3a2c', '#4a4a38', '#5a5a46', '#6a6a54'], boots: '#22180e', eye: '#5a6a5a', style: 'hat', beard: ['#6a6a6a', '#848484', '#9e9e9e', '#b4b4b4', '#c8c8c8'], hat: ['#7a5a1c', '#a17c2e', '#c49d42', '#dcbb5e', '#ecd585'], prop: '#5a3e22', lamp: '#ffb040' },
  kel: { skin: LIGHT, hair: GINGER, coat: ['#4a3420', '#5e442c', '#745638', '#8a6a46', '#a07e56'], legs: ['#2e2418', '#3e3224', '#4e4030', '#5e4e3c', '#6e5c4a'], boots: '#2a1a10', eye: '#3a5a2a', style: 'long', beard: GINGER, over: { kind: 'bandolier', stops: ['#7a1a10', '#a02418', '#c43020', '#de4a34', '#f06a50'] }, marks: ['patch'], prop: '#000000' },
  tova: { skin: ['#7a4e34', '#96654a', '#b07e60', '#c69678', '#d8ae92'], hair: BLACK_HAIR, coat: ['#3a2a1e', '#4c3828', '#5e4834', '#705a42', '#846c52'], legs: ['#26201a', '#342c24', '#443a30', '#54483c', '#645648'], boots: '#1e140c', eye: '#2a1a10', style: 'braids', over: { kind: 'sash', stops: ['#6a1a12', '#8a2418', '#ac3020', '#c84432', '#de6048'] }, marks: ['scar', 'bandana'], prop: '#000000' },
  aurel: { skin: OLD, hair: WHITE_HAIR, coat: ['#0e1430', '#162048', '#1e2c62', '#2a3c7c', '#3a4e96'], legs: ['#0e1228', '#141a38', '#1c2448', '#26305a', '#32406c'], boots: '#1a1420', eye: '#4a7ab0', style: 'short', beard: WHITE_HAIR, over: { kind: 'stars', stops: ['#8a6a14', '#b48c20', '#d8ae30', '#f0cc50', '#ffe680'] }, prop: '#b8862a' },
  yrsa: { skin: FAIR, hair: FAIR_HAIR, coat: ['#2a3a4e', '#3a4e66', '#4e6480', '#667e9a', '#8098b4'], legs: ['#26303e', '#344050', '#445264', '#566478', '#6a788c'], boots: '#3a3030', eye: '#7ac4e8', style: 'hood', over: { kind: 'scarf', stops: ['#9a9a9a', '#b8b8b8', '#d4d4d4', '#e8e8e8', '#f8f8f8'] }, prop: '#000000' },
  orsa: { skin: LIGHT, hair: COPPER, coat: ['#2a1a10', '#3a2618', '#4c3422', '#5e442e', '#72563c'], legs: ['#1e1612', '#2a201a', '#382c24', '#463a30', '#54483c'], boots: '#160e0a', eye: '#3a2a1a', style: 'braids', over: { kind: 'apron', stops: ['#3a2010', '#4e2e18', '#623e22', '#78502e', '#8e623a'] }, prop: '#5a5a62', lamp: '#ff8a20' },
  lumen: { skin: ['#5a5a48', '#74745e', '#8e8e76', '#a6a68e', '#bcbca6'], hair: ['#3a3a36', '#4c4c48', '#5e5e58', '#72726c', '#868680'], coat: ['#3a3a36', '#4a4a44', '#5a5a54', '#6c6c64', '#7e7e76'], legs: ['#2a2a26', '#383832', '#46463e', '#54544c', '#62625a'], boots: '#1e1c18', eye: '#404038', style: 'hood', over: { kind: 'gears', stops: ['#7a5a1c', '#9c7826', '#bc9632', '#d6b24a', '#ecce70'] }, marks: ['crystal'], prop: '#4a4a44', lamp: '#40ff80' },
};

function paintOne(a: Pix, o: O, l: Look, seed: number): void {
  const skin = noiseMat(l.skin, seed, 4, 0.4, 0.06);
  const hair = noiseMat(l.hair, seed + 1, 2, 0.8, 0.14, 0, 5);
  const coat = noiseMat(l.coat, seed + 2, 3, 0.5, 0.1, 0, 6);
  const legs = noiseMat(l.legs, seed + 3, 3, 0.5, 0.08, 0, 6);
  // ---- the head
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(a, head, (s, y) => mulc(skin(s, y), y === 15 ? 0.85 : 1), (x, y) => skin(x + 40, y), (x, y) => mulc(skin(x + 60, y), 0.7));
  const f = on(a, head.front);
  const eye = (x: number): void => {
    f.rect(x, 7, 4, 2, '#f2eee6');
    f.rect(x + 1, 7, 2, 2, l.eye);
  };
  f.rect(2, 5, 4, 1, mixc([40, 30, 24], l.hair[1]!, 0.5));
  f.rect(10, 5, 4, 1, mixc([40, 30, 24], l.hair[1]!, 0.5));
  eye(2);
  eye(10);
  f.mixRect(7, 9, 2, 2, '#5a3020', 0.25);
  f.mulRect(7, 10, 2, 1, 0.82);
  f.rect(6, 12, 4, 1, '#6a3a2c');
  if (l.beard) {
    const beard = noiseMat(l.beard, seed + 4, 2, 0.7, 0.12, 0, 4);
    for (let y = 10; y < 16; y += 1) for (let x = 1; x < 15; x += 1) if (y > 11 || x < 5 || x > 10) f.set(x, y, beard(x, y));
    f.rect(6, 12, 4, 1, '#3a2418');
    for (const r of [head.right, head.left]) for (let y = 11; y < 16; y += 1) for (let x = 0; x < 16; x += 1) on(a, r).set(x, y, beard(x + 30, y));
  }
  if (l.moustache) f.rect(4, 11, 8, 2, l.moustache);
  for (const m of l.marks ?? []) {
    if (m === 'patch') {
      f.rect(10, 6, 4, 3, '#1a120c');
      f.rect(0, 5, 16, 1, '#2a1c12');
    } else if (m === 'scar') {
      for (let k = 0; k < 6; k += 1) f.set(10 + (k >> 1), 8 + k, '#8a4a3c');
    } else if (m === 'crystal') glowRect(a, head.front, 10, 7, 4, 2, '#40ff80', 1);
    else if (m === 'specs') {
      f.rect(1, 6, 6, 4, '#a07a30');
      f.rect(9, 6, 6, 4, '#a07a30');
      f.rect(7, 7, 2, 1, '#a07a30');
      eye(2);
      eye(10);
    } else if (m === 'freckles') {
      for (const [x, y] of [[3, 10], [5, 11], [11, 10], [12, 11], [10, 11]] as const) f.mix(x, y, '#8a4a2c', 0.6);
    }
  }
  // ---- what lies over it: hair, a hood, a veil (cut out round the face)
  const face = (x: number, y: number): boolean => {
    if (l.style === 'hood' || l.style === 'veil') return x > 2 && x < 13 && y > 3 && y < 13;
    if (l.style === 'long' || l.style === 'braids' || l.style === 'bob') return y > 3;
    return y > 2;
  };
  const brow = (face2: string, x: number, y: number, v: number): boolean => face2 === 'front' && face(x, y) && v >= 0;
  const hooded = l.style === 'hood' || l.style === 'veil';
  const cloth = hooded ? (l.style === 'veil' ? hair : coat) : hair;
  boxA(a, boxUV(o, 32, 0, 8, 8, 8), (u, v, side, x) => {
    if (side === 'bottom') return null;
    if (l.style === 'bald') return null;
    if (l.style === 'hat') {
      // Only a fringe under the hat.
      if (side === 'top' || v > 10 || (side === 'front' && v > 4)) return null;
      return [hair(u, v), 1];
    }
    if (brow(side, x, v, 1)) return null;
    if (side === 'top') return [cloth(u, v), 1];
    const reach = l.style === 'short' ? 6 : l.style === 'bob' ? 12 : 16;
    if (!hooded && side !== 'back' && v >= reach) return null;
    if (!hooded && side === 'back' && l.style === 'short' && v >= 10) return null;
    let c = cloth(u, v);
    // A fur edge round a hood, a jewelled band on a veil.
    if (l.style === 'hood' && side === 'front') c = mulc(c, 1.25);
    if (l.style === 'veil' && v === 3) c = [220, 170, 60];
    return [c, 1];
  });
  // Goggles and a bandana sit over the hair.
  for (const m of l.marks ?? []) {
    const top = boxUV(o, 32, 0, 8, 8, 8);
    const ft = on(a, top.front);
    if (m === 'goggles') {
      ft.rect(1, 1, 6, 3, '#8a6a2a');
      ft.rect(9, 1, 6, 3, '#8a6a2a');
      ft.rect(2, 2, 4, 1, '#c8e0f0');
      ft.rect(10, 2, 4, 1, '#c8e0f0');
    } else if (m === 'bandana') {
      ft.rect(0, 2, 16, 3, '#b02a20');
      ft.rect(0, 2, 16, 1, '#d84a3a');
    }
  }
  // ---- the body, arms and legs
  const body = boxUV(o, 0, 16, 8, 12, 4);
  box(a, body, (s, y, side, x) => mulc(coat(s, y), round(x, fw(body, side)) * (y === 0 ? 1.08 : 1)), (x, y) => coat(x + 80, y), (x, y) => mulc(coat(x + 90, y), 0.7));
  const arm = boxUV(o, 48, 16, 4, 12, 4);
  box(
    a,
    arm,
    (s, y, side, x) => (y >= 20 ? mulc(skin(s + 100, y), round(x, fw(arm, side))) : mulc(coat(s + 120, y), round(x, fw(arm, side)))),
    (x, y) => coat(x + 140, y),
    (x, y) => skin(x + 150, y),
  );
  const leg = boxUV(o, 0, 32, 4, 12, 4);
  box(
    a,
    leg,
    (s, y, side, x) => (y >= 18 ? mulc(hex(l.boots), (0.9 + hash2(s, y, seed + 5) * 0.2) * round(x, fw(leg, side))) : mulc(legs(s + 170, y), round(x, fw(leg, side)))),
    (x, y) => legs(x + 190, y),
    () => [20, 16, 14],
  );
  // ---- worn over the body (cut-out)
  const w = l.over;
  const stops = w?.stops ?? [];
  const over = (u: number, v: number): RGB => ramp(stops, clamp(0.55 + (hash2(u, v, seed + 6) - 0.5) * 0.6, 0, 1));
  boxA(a, boxUV(o, 24, 16, 8, 12, 4), (u, v, side, x) => {
    if (!w || side === 'top' || side === 'bottom') return null;
    switch (w.kind) {
      case 'apron':
        if (side === 'front' && x >= 2 && x <= 13 && v >= 3) return [over(u, v), 1];
        if ((side === 'front' || side === 'back') && (x === 3 || x === 12) && v < 3) return [over(u, v), 1];
        return v === 10 || v === 11 ? [mulc(over(u, v), 0.75), 1] : null;
      case 'sash':
        return Math.abs(v - 12 - (side === 'front' ? 0 : 0)) < 2 ? [over(u, v), 1] : null;
      case 'bandolier':
        return side === 'front' && Math.abs(v - x * 1.4 - 2) < 2.4 ? [(u + v) % 4 === 0 ? [240, 220, 160] : over(u, v), 1] : side === 'back' && Math.abs(v - (15 - x) * 1.4 - 2) < 2.4 ? [over(u, v), 1] : null;
      case 'scarf':
        return v < 5 ? [over(u, v), 1] : side === 'front' && x >= 3 && x <= 6 && v < 14 ? [over(u, v), 1] : null;
      case 'stars':
        return hash2(u, v, seed + 7) > 0.93 || v >= 22 ? [over(u, v), 1] : null;
      case 'gears':
        return hash2(u >> 1, v >> 1, seed + 8) > 0.86 ? [over(u, v), 1] : null;
      default:
        return null;
    }
  });
  // ---- hat, prop
  if (l.hat) {
    const hat = noiseMat(l.hat, seed + 9, 3, 0.6, 0.12);
    solidBox(a, boxUV(o, 0, 48, 14, 1, 14), hat);
    solidBox(a, boxUV(o, 16, 32, 6, 4, 6), hat, 100);
    solidBox(a, boxUV(o, 40, 32, 4, 4, 4), hat, 200);
  }
  solidBox(a, boxUV(o, 20, 44, 2, 2, 2), (u, v) => mulc(hex(l.prop), 0.9 + hash2(u, v, seed) * 0.2));
  if (l.lamp) {
    const lamp = boxUV(o, 28, 44, 2, 2, 2);
    for (const r of [lamp.front, lamp.back, lamp.right, lamp.left, lamp.top, lamp.bottom]) glowRect(a, r, 0, 0, r.w, r.h, l.lamp, 1);
  }
}

export function paintOfficers(atlas: Pix, origin: (name: string) => [number, number]): void {
  Object.entries(LOOKS).forEach(([id, look], i) => paintOne(atlas, origin(`npc_${id}`), look, 12200 + i * 13));
}
