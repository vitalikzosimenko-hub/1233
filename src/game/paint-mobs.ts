// Procedural skins for the valley's newer monsters (endermen, witches, slimes, the illagers, the
// Wither and its kin) and the tiles and item icons they bring with them. Same conventions as
// paint-skins.ts (Minecraft box-UV sheets at SKIN_SCALE texels per model pixel) and paint-extra.ts
// (seeded 32x32 tiles with height / specular / glow channels).
import { hex, lerpRGB, ramp, register, registerSkins, type Pix, type RGB } from './textures';
import { clamp, fbm2, hash2, mulberry32, type Rng } from './rng';
import { boxUV, C, cloth, flesh, glowSet, grain, k, leather, mixc, on, paint, paintSides, round, tearDist, type BoxUV, type Side, type Tear } from './paint-skins';
import { clamp01, clearAll, each, HANDLE, ITEM_IRON, outline, shapeFill, stick, TAU, tone } from './paint-extra';

type O = [number, number];
type Shade = (x: number, y: number) => RGB | null;
type SideShade = (s: number, y: number, side: Side, x: number) => RGB | null;

/** Texel width of one side face. */
const fw = (b: BoxUV, side: Side): number => (side === 'front' || side === 'back' ? b.w : b.d);

function seeder(seed: number): () => number {
  const rng = mulberry32(seed);
  return () => Math.floor(rng() * 100000);
}

/** Paints all six faces of a box. */
function box(a: Pix, b: BoxUV, sides: SideShade, top: Shade, bottom: Shade): void {
  paintSides(a, b, sides);
  paint(a, b.top, top);
  paint(a, b.bottom, bottom);
}

/** Streaky hair: long strands along y. */
function hairTone(stops: readonly string[], x: number, y: number, seed: number): RGB {
  const n = fbm2(x / 1.6, y / 5, seed);
  return k(ramp(stops, clamp(0.5 + (n - 0.5) * 1.6, 0, 1)), grain(x, y, seed, 0.12));
}

/** Continuous hairline cracks: a thin contour line of smooth two-octave noise. */
const crackAt = (x: number, y: number, seed: number, width = 0.03): boolean => Math.abs(fbm2(x / 6, y / 6, seed, 2) - 0.5) < width;

/** Distance (in texels) of a face texel from the nearest face edge. */
const edgeOf = (x: number, y: number, w: number, h: number): number => Math.min(x, y, w - 1 - x, h - 1 - y);

/** Raised plate shading: a two-step lit top-left bevel and a shaded bottom-right bevel. */
function bevel(x: number, y: number, w: number, h: number): number {
  if (x === 0 || y === 0) return x === 0 && y === 0 ? 1.3 : 1.22;
  if (x === w - 1 || y === h - 1) return 0.7;
  if (x === 1 || y === 1) return 1.08;
  if (x === w - 2 || y === h - 2) return 0.88;
  return 1;
}

// ------------------------------------------------------------------ enderman

const ENDER = ['#0a0a0a', '#0f0e10', '#141215', '#19171b', '#1f1d21', '#262428'] as const;
const MAW = ['#0c050e', '#150a19', '#1f0f24', '#2a1530', '#361c3d'] as const;

function paintEnderman(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const skinSeed = sd();
  const motSeed = sd();
  const skin = (x: number, y: number, bias = 0): RGB => {
    let c = flesh(ENDER, x, y, skinSeed, 0.45, bias);
    const m = fbm2(x / 5, y / 5, motSeed);
    if (m > 0.58) c = mixc(c, '#2c1839', clamp((m - 0.58) * 2.4, 0, 0.5)); // faint purple mottling
    else if (m < 0.34) c = mixc(c, '#2a2a2e', clamp((0.34 - m) * 2, 0, 0.35));
    return c;
  };
  /** Faint cool highlight along box edges. */
  const rim = (c: RGB, t = 0.35): RGB => mixc(c, '#3c3742', t);

  // ---- skull
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    head,
    (s, y, _side, x) => {
      let c = skin(s, y);
      if (y === 0) c = rim(c, 0.42);
      else if (x === 0 || x === 15) c = rim(c, 0.2);
      if (y === 15) c = k(c, 0.7);
      return c;
    },
    (x, y) => {
      const c = skin(x + 60, y + 30, 0.08);
      return edgeOf(x, y, 16, 16) === 0 ? rim(c, 0.42) : c;
    },
    (x, y) => k(skin(x + 90, y + 30), 0.6),
  );
  const hf = head.front;
  const f = on(a, hf);
  f.mixRect(1, 6, 14, 1, '#000000', 0.5); // brow shadow
  f.mixRect(6, 7, 4, 5, '#2a2730', 0.25); // nose bridge
  // Magenta slit eyes with a pale pink core, and a dim violet halo around them.
  for (const ex of [0, 10]) {
    for (let i = 0; i < 6; i += 1) {
      const end = i === 0 || i === 5;
      const core = i === 2 || i === 3;
      glowSet(a, hf, ex + i, 8, end ? '#cc00fa' : core ? '#f8d6ff' : '#e079fa');
      glowSet(a, hf, ex + i, 9, end ? '#9800c4' : core ? '#e8a2fc' : '#cc00fa');
      if (!end) {
        glowSet(a, hf, ex + i, 7, '#2a0636', 0.3);
        glowSet(a, hf, ex + i, 10, '#3a0848', 0.4);
      }
    }
  }
  f.mixRect(4, 13, 8, 1, '#000000', 0.45); // mouth seam above the jaw

  // ---- jaw: top is the open mouth seen when the skull lifts, front is the lower lip
  const jaw = boxUV(o, 0, 16, 8, 3, 8);
  box(
    a,
    jaw,
    (s, y, side) => {
      let c = skin(s + 200, y + 40);
      if (y === 0) c = rim(c, side === 'front' ? 0.5 : 0.3);
      if (y === 5) c = k(c, 0.7);
      return c;
    },
    (x, y) => {
      if (x === 0 || x === 15 || y === 0 || y === 15) return rim(skin(x + 240, y), 0.3); // jaw walls and lip
      if (y >= 13) return y === 13 ? C('#5c3664') : C('#45284c'); // gum line behind the lip
      const t = 0.42 + (fbm2(x / 3, y / 3, motSeed + 5) - 0.5) * 0.5 + (y / 16) * 0.35 - Math.abs(x - 7.5) * 0.02;
      return ramp(MAW, clamp(t, 0, 1));
    },
    (x, y) => k(skin(x + 280, y), 0.55),
  );

  // ---- body
  const body = boxUV(o, 32, 16, 8, 12, 4);
  box(
    a,
    body,
    (s, y, side, x) => {
      let c = skin(s + 300, y);
      const w = fw(body, side);
      if (y === 0) c = rim(c, 0.4);
      else if (x === 0 || x === w - 1) c = rim(c, 0.18);
      if (side === 'front' && y === 2 && x > 1 && x < 14 && x !== 7 && x !== 8) c = rim(c, 0.2); // collarbones
      if (side === 'front' && (x === 7 || x === 8) && y > 3 && y < 14) c = mixc(c, '#000000', 0.35); // sternum groove
      if (side === 'back' && (x === 7 || x === 8) && y % 3 === 1) c = rim(c, 0.2); // spine knobs
      if (y === 23) c = k(c, 0.7);
      return c;
    },
    (x, y) => {
      const c = skin(x + 360, y, 0.06);
      return edgeOf(x, y, 16, 8) === 0 ? rim(c, 0.35) : c;
    },
    (x, y) => k(skin(x + 380, y), 0.55),
  );

  // ---- limb (shared by arms and legs)
  const limb = boxUV(o, 56, 0, 2, 30, 2);
  box(
    a,
    limb,
    (s, y, _side, x) => {
      let c = skin(s + 400, y * 0.7);
      const j = Math.abs(y - 29.5);
      if (j < 2.5) c = mixc(c, '#302c36', 0.45 - j * 0.12); // elbow / knee
      if (y < 2) c = rim(c, 0.3);
      if (y >= 57) c = k(c, 0.75);
      return k(c, round(x, 4));
    },
    (x, y) => rim(skin(x + 450, y), 0.2),
    (x, y) => k(skin(x + 460, y), 0.6),
  );
}

// ------------------------------------------------------------------ witch

const WITCH_SKIN = ['#4b4d2c', '#63653a', '#7a7b4a', '#91905c', '#a7a470'] as const;
const WITCH_HAIR = ['#120e14', '#1c161f', '#272029', '#332a36'] as const;
const WITCH_ROBE = ['#24132e', '#2c1838', '#3a2149', '#4a2a5c', '#5a3570'] as const;
const HAT = ['#0f0a13', '#17101d', '#201727', '#2a1f33', '#352840'] as const;
const HAT_BAND = ['#1c3a1a', '#2a5224', '#386a2e', '#4a823a'] as const;
const APRON = ['#323f24', '#40512e', '#506238', '#617444'] as const;
const BELT = ['#2a1a0e', '#3c2614', '#50331c', '#644226'] as const;

function paintWitch(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const skinSeed = sd();
  const hairSeed = sd();
  const robeSeed = sd();
  const hatSeed = sd();
  const skin = (x: number, y: number, bias = 0): RGB => flesh(WITCH_SKIN, x, y, skinSeed, 0.42, bias);
  const hair = (x: number, y: number): RGB => hairTone(WITCH_HAIR, x, y, hairSeed);
  const robe = (s: number, y: number, fold = 0.12, bias = 0): RGB => cloth(WITCH_ROBE, s, y, robeSeed, fold, bias);
  const hat = (x: number, y: number, bias = 0): RGB => cloth(HAT, x, y, hatSeed, 0.08, bias);

  // ---- head (8 x 10 x 8): long dark hair down the back and sides
  const head = boxUV(o, 0, 0, 8, 10, 8);
  box(
    a,
    head,
    (s, y, side, x) => {
      const toBack = side === 'right' ? 1 - x / (head.d - 1) : side === 'left' ? x / (head.d - 1) : side === 'back' ? 1 : 0;
      const jag = hash2(s, 1, hairSeed) < 0.4 ? 1 : 0;
      const depth = side === 'front' ? 1 + jag : side === 'back' ? 20 : 3 + Math.round(toBack * toBack * 15) + jag;
      if (y < depth) {
        const c = hair(s, y);
        return y === depth - 1 && side !== 'back' ? k(c, 0.8) : c;
      }
      let c = skin(s, y + 40);
      if (y === depth) c = k(c, 0.82);
      if (y >= 18) c = k(c, 0.88);
      return c;
    },
    (x, y) => hair(x + 3, y + 90),
    (x, y) => k(skin(x, y + 200), 0.7),
  );
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(6, 9, 3, 5, 0.86); // ear peeking through the hair
    e.mulRect(6, 9, 3, 1, 1.12);
  }
  const f = on(a, head.front);
  f.mulRect(3, 3, 10, 1, 0.92); // wrinkled forehead
  f.mulRect(5, 4, 6, 1, 0.94);
  for (let x = 2; x <= 13; x += 1) {
    const arch = x === 2 || x === 13 ? 7 : x <= 4 || x >= 11 ? 6 : 7; // arched brows that dip at the nose
    f.set(x, arch, k(C(WITCH_HAIR[1]!), grain(x, 6, hairSeed + 5, 0.25)));
    if (x > 4 && x < 11) f.mix(x, 6, WITCH_HAIR[1]!, 0.45);
  }
  f.mulRect(2, 8, 12, 1, 0.94);
  // Eyes: whites outside, green irises inside, a dark pupil.
  f.rect(2, 8, 2, 2, '#e2dfcf');
  f.rect(12, 8, 2, 2, '#e2dfcf');
  f.set(2, 9, '#c4c0ac');
  f.set(13, 9, '#c4c0ac');
  for (const ix of [4, 10]) {
    f.rect(ix, 8, 2, 2, '#3c9a3a');
    f.set(ix, 8, '#6cc85e');
  }
  f.set(5, 9, '#123c14');
  f.set(10, 9, '#123c14');
  f.mulRect(2, 10, 4, 1, 0.84); // baggy lower lids
  f.mulRect(10, 10, 4, 1, 0.84);
  f.mulRect(6, 8, 4, 4, 1.04);
  f.mulRect(6, 11, 4, 8, 0.86); // shadow of the hooked nose
  f.mixRect(1, 12, 4, 3, '#8a5a3a', 0.18);
  f.mixRect(11, 12, 4, 3, '#8a5a3a', 0.18);
  // A thin, crooked grin.
  f.rect(5, 17, 6, 1, '#2a2416');
  f.set(4, 16, '#3a3420');
  f.set(11, 16, '#3a3420');
  f.mix(7, 17, '#c8c09a', 0.5); // one snaggle tooth
  f.mulRect(5, 18, 6, 1, 0.9);
  f.mulRect(0, 19, 16, 1, 0.84);

  // ---- hooked nose (2 x 4 x 2): darker, curling down at the tip
  const nose = boxUV(o, 24, 0, 2, 4, 2);
  box(
    a,
    nose,
    (s, y, side, x) => {
      let c = k(skin(s + 120, y + 30), 0.9);
      if (side === 'front' && (x === 1 || x === 2) && y < 5) c = k(c, 1.08);
      if (y >= 5) c = k(c, 0.92);
      if (side === 'front' && y >= 6 && (x === 0 || x === 3)) c = k(c, 0.68); // nostrils under the hook
      if (y === 7) c = k(c, 0.8);
      if (side === 'back') c = k(c, 0.8);
      return c;
    },
    (x, y) => skin(x + 140, y, 0.05),
    (x, y) => k(skin(x + 150, y), (x === 0 || x === 3) && y > 0 ? 0.5 : 0.72),
  );
  // ---- wart (1 x 1 x 1)
  const wart = boxUV(o, 0, 58, 1, 1, 1);
  const wartC = (x: number, y: number, lift: number): RGB => k(mixc(C('#3e6e2a'), '#6a9a40', (x + y) % 2 === 0 ? 0.3 : 0), lift);
  box(a, wart, (_s, y, _side, x) => wartC(x, y, y === 0 ? 1.08 : 0.9), (x, y) => wartC(x, y, 1.15), (x, y) => wartC(x, y, 0.7));

  // ---- robe (8 x 20 x 6): dark purple, brown belt, a muted green apron patch on the front
  const robeBox = boxUV(o, 0, 20, 8, 20, 6);
  const inApron = (x: number, y: number): boolean => y >= 23 && y <= 35 && x >= 3 + (y > 32 ? 1 : 0) && x <= 12 - (y > 32 ? 1 : 0);
  box(
    a,
    robeBox,
    (s, y, side, x) => {
      let c = robe(s, y, y > 22 ? 0.2 : 0.09);
      if (y < 2) c = k(c, y === 0 ? 1.18 : 1.08);
      if (y === 2) c = k(c, 0.85);
      if (y >= 36) {
        c = k(c, 0.74); // frayed hem
        if (y === 36) c = k(c, 1.3);
        if (y === 39 && hash2(s, y, robeSeed) < 0.5) c = k(c, 0.75);
      }
      if (y >= 19 && y <= 21) {
        c = leather(BELT, s, y, robeSeed + 4);
        if (y === 19) c = k(c, 1.15);
        if (y === 21) c = k(c, 0.75);
        if (side === 'front' && x >= 6 && x <= 9) c = x === 6 || x === 9 || y !== 20 ? C('#8c8c86') : C('#2a2622'); // iron buckle
        if (side === 'right' && x >= 4 && x <= 7 && y >= 20) c = k(C('#5a4022'), 1); // pouch flap
      }
      if (side === 'right' && x >= 4 && x <= 7 && y >= 22 && y <= 26) {
        c = leather(BELT, x, y, robeSeed + 6); // little pouch
        if (x === 4 || x === 7 || y === 26) c = k(c, 0.75);
      }
      if (side === 'front' && inApron(x, y)) {
        c = cloth(APRON, x, y, robeSeed + 8, 0.08);
        const edge = !inApron(x - 1, y) || !inApron(x + 1, y) || !inApron(x, y + 1) || !inApron(x, y - 1);
        if (edge) c = k(c, 0.75);
        else if ((x + y) % 3 === 0 && (!inApron(x - 2, y) || !inApron(x + 2, y))) c = k(c, 1.2); // stitches
        if (Math.hypot(x - 9, y - 29) < 1.4) c = mixc(c, '#6a2a5a', 0.5); // potion stain
      }
      if (side === 'front' && y >= 2 && y < 19 && (x === 7 || x === 8)) c = k(c, x === 7 ? 0.82 : 0.9); // front seam
      return c;
    },
    (x, y) => k(robe(x, y + 90), 0.92),
    (x, y) => (x < 2 || x > 13 || y < 2 || y > 9 ? k(robe(x, y + 120), 0.6) : k(C('#0e0812'), grain(x, y, robeSeed, 0.3))),
  );

  // ---- crossed arms (8 x 4 x 4)
  const arms = boxUV(o, 32, 20, 8, 4, 4);
  const sleeve = (x: number, y: number, bias = 0): RGB => robe(x, y + 160, 0.06, bias);
  paint(a, arms.front, (x, y) => {
    if (x < 4 || x >= 12) {
      let c = sleeve(x, y);
      if (x === 3 || x === 12) c = k(c, 0.68); // cuff opening
      if (x === 2 || x === 13) c = k(c, 1.18);
      return c;
    }
    let c = skin(x + 200, y + 200);
    if (y === 0) c = k(c, 1.08);
    if (y === 7) c = k(c, 0.82);
    if (x === 7) c = k(c, 0.78);
    if (x === 8) c = k(c, 0.9);
    if ((y === 2 || y === 4 || y === 6) && x !== 4 && x !== 11) c = k(c, 0.88); // knobbly fingers
    return c;
  });
  paint(a, arms.top, (x, y) => (x >= 4 && x < 12 && y >= 4 ? k(skin(x + 220, y), y === 4 ? 0.85 : 1.02) : k(sleeve(x + 30, y), 1.04)));
  paint(a, arms.bottom, (x, y) => k(sleeve(x + 50, y), 0.66));
  paint(a, arms.back, (x, y) => k(sleeve(x + 70, y), 0.8));
  for (const r of [arms.right, arms.left]) {
    paint(a, r, (x, y) => k(sleeve(x + 90, y + r.x), Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5)) > 2.6 ? 1.04 : 0.84));
  }

  // ---- single arm (4 x 10 x 4): sleeve with a cuff, the hand below
  const arm = boxUV(o, 40, 46, 4, 10, 4);
  box(
    a,
    arm,
    (s, y, side, x) => {
      const r = round(x, fw(arm, side));
      if (y < 13) {
        let c = sleeve(s, y);
        if (y === 11) c = k(c, 1.2);
        if (y === 12) c = k(c, 0.7);
        if (y === 0) c = k(c, 1.06);
        return k(c, r);
      }
      let c = skin(s, y + 70);
      if (y === 13) c = k(c, 0.78);
      if (side === 'front' && y === 16 && (x === 1 || x === 3 || x === 5)) c = k(c, 1.1);
      if (y === 19) c = k(c, 0.84);
      return k(c, r);
    },
    (x, y) => k(sleeve(x + 40, y + 50), 1.02),
    (x, y) => k(skin(x, y + 120), x === 2 || x === 4 || x === 6 ? 0.76 : 0.88),
  );

  // ---- hat: a wide brim, two stacked cones and a crumpled tip
  const brim = boxUV(o, 0, 46, 10, 2, 10);
  paint(a, brim.top, (x, y) => {
    const e = edgeOf(x, y, 20, 20);
    let c = hat(x, y + 300, 0.05);
    if (e === 0) c = k(c, 0.8);
    else if (e === 1) c = k(c, 1.15);
    if (e === 2) c = k(c, 0.72); // shadow ring under the crown
    return c;
  });
  paint(a, brim.bottom, (x, y) => k(hat(x + 40, y + 340), edgeOf(x, y, 20, 20) === 0 ? 0.8 : 0.62));
  paintSides(a, brim, (s, y) => k(hat(s, y + 380), y === 0 ? 1.15 : y === 3 ? 0.7 : 0.92));

  const coneA = boxUV(o, 32, 28, 7, 4, 7);
  paintSides(a, coneA, (s, y, side, x) => {
    if (y >= 4) {
      // Green band with a gold buckle on the front.
      let c = cloth(HAT_BAND, s, y, hatSeed + 3, 0.04);
      if (y === 4) c = k(c, 1.15);
      if (y === 7) c = k(c, 0.75);
      if (side === 'front' && x >= 5 && x <= 8) {
        const ring = x === 5 || x === 8 || y === 4 || y === 7;
        c = ring ? C(y === 4 || x === 5 ? '#f2d468' : '#b88a22') : k(cloth(HAT_BAND, x, y, hatSeed + 3), 0.8);
      }
      return c;
    }
    let c = hat(s + 20, y);
    if (y === 3) c = k(c, 0.8);
    if (y === 0) c = k(c, 1.1);
    if (side === 'left' && x > 3 && x < 9 && y === 1) c = k(c, 0.78); // crease
    return c;
  });
  paint(a, coneA.top, (x, y) => {
    const c = hat(x + 60, y + 420, 0.06);
    const e = edgeOf(x, y, 14, 14);
    return e === 0 ? k(c, 1.1) : e <= 2 ? c : k(c, 0.8); // cone B sits in the middle
  });
  paint(a, coneA.bottom, (x, y) => k(hat(x + 80, y + 440), 0.6));

  const coneB = boxUV(o, 44, 0, 4, 4, 4);
  box(
    a,
    coneB,
    (s, y, side, x) => {
      let c = hat(s + 120, y + 20, 0.03);
      if (y === 0) c = k(c, 1.12);
      if (y === 7) c = k(c, 0.78);
      if (side === 'front' && x + y === 8) c = k(c, 0.8); // bent fold
      return c;
    },
    (x, y) => k(hat(x + 140, y + 460, 0.08), edgeOf(x, y, 8, 8) === 0 ? 1.08 : x > 2 && x < 5 && y > 2 && y < 5 ? 0.8 : 1),
    (x, y) => k(hat(x + 150, y + 470), 0.6),
  );
  const tip = boxUV(o, 36, 0, 1, 2, 1);
  box(
    a,
    tip,
    (s, y) => k(hat(s + 170, y + 30, 0.06), y === 0 ? 1.15 : y === 3 ? 0.8 : 1),
    (x, y) => k(hat(x + 180, y), 1.2),
    (x, y) => k(hat(x + 190, y), 0.6),
  );
}

// ------------------------------------------------------------------ slime

const JELLY = ['#4e9a40', '#62b04f', '#6fc35b', '#86d26c', '#9be27f', '#c8f4b2'] as const;
const CORE = ['#356e2a', '#418236', '#4c9a3e', '#57a647', '#62b04f', '#78c262'] as const;

function paintSlime(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const jSeed = sd();
  const cSeed = sd();
  /** Jelly face: lighter toward the top-left, a bright rim, soft highlights and sunk speckles. */
  const jelly = (x: number, y: number, w: number, h: number, sx: number, bias: number): RGB => {
    const n = fbm2((x + sx) / 5, y / 5, jSeed);
    let t = 0.5 + bias + (n - 0.5) * 0.3 + (0.5 - (x / w + y / h) / 2) * 0.35;
    const e = edgeOf(x, y, w, h);
    if (e === 0) t += x === 0 || y === 0 ? 0.22 : -0.14;
    else if (e === 1 && (x === 1 || y === 1)) t += 0.08;
    let c = ramp(JELLY, clamp(t, 0, 1));
    const hx = x - w * 0.26;
    const hy = y - h * 0.24;
    const hl = Math.hypot(hx * 0.8, hy * 1.4);
    if (hl < 2.2) c = mixc(c, '#effde6', 0.55 - hl * 0.2); // soft glossy highlight
    if (hash2(x + sx, y, jSeed + 2) < 0.05 && e > 1) c = mixc(c, '#3c7e30', 0.45); // inner speckles
    else if (hash2(x + sx, y, jSeed + 3) < 0.03 && e > 1) c = mixc(c, '#d8f8c8', 0.4); // tiny bubbles
    return c;
  };
  const outer = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    outer,
    (s, y, side, x) => jelly(x, y, 16, 16, s * 7, side === 'back' ? -0.08 : 0),
    (x, y) => jelly(x, y, 16, 16, 300, 0.12),
    (x, y) => k(jelly(x, y, 16, 16, 400, -0.2), 0.85),
  );

  const core = (x: number, y: number, w: number, h: number, sx: number, bias: number): RGB => {
    const n = fbm2((x + sx) / 3.5, y / 3.5, cSeed);
    let t = 0.5 + bias + (n - 0.5) * 0.45 + (0.5 - (x / w + y / h) / 2) * 0.25;
    if (edgeOf(x, y, w, h) === 0) t -= 0.2;
    return k(ramp(CORE, clamp(t, 0, 1)), grain(x + sx, y, cSeed + 1, 0.08));
  };
  const inner = boxUV(o, 0, 16, 6, 6, 6);
  box(
    a,
    inner,
    (s, y, _side, x) => core(x, y, 12, 12, s * 5, 0),
    (x, y) => core(x, y, 12, 12, 200, 0.12),
    (x, y) => core(x, y, 12, 12, 260, -0.2),
  );

  // Eyes and mouth: dark green-black with a faint wet glint.
  const eye = boxUV(o, 32, 0, 2, 2, 2);
  box(
    a,
    eye,
    (s, y, side, x) => {
      let c = k(C('#14240f'), grain(s, y, cSeed + 4, 0.25));
      if (side === 'front' && x === 1 && y === 1) c = C('#3c5a32');
      if (y === 3) c = k(c, 0.8);
      return c;
    },
    (x, y) => k(C('#1c3016'), grain(x, y, cSeed + 5, 0.2)),
    () => C('#0e1a0b'),
  );
  const mouth = boxUV(o, 32, 8, 1, 1, 1);
  box(a, mouth, (s, y) => k(C('#16280f'), grain(s, y, cSeed + 6, 0.25)), () => C('#1e3216'), () => C('#0e1a0b'));
}

// ------------------------------------------------------------------ illagers

const ILL_SKIN = ['#737a75', '#8e9590', '#a2a9a3', '#b5bcb5', '#c3c9c2'] as const;

interface IllagerLook {
  hair: readonly string[];
  brow: string;
  iris: string;
  /** Fringe depth multiplier: evokers are balding. */
  hairline: number;
  scar: boolean;
  stubble: boolean;
  old: boolean;
}

/** The illager head (8 x 10 x 8) and long nose (2 x 4 x 2): grey skin, a heavy scowl. */
function illagerHead(a: Pix, o: O, look: IllagerLook, seed: number): void {
  const sd = seeder(seed);
  const skinSeed = sd();
  const hairSeed = sd();
  const skin = (x: number, y: number, bias = 0): RGB => flesh(ILL_SKIN, x, y, skinSeed, 0.38, bias);
  const hair = (x: number, y: number): RGB => hairTone(look.hair, x, y, hairSeed);

  const head = boxUV(o, 0, 0, 8, 10, 8);
  box(
    a,
    head,
    (s, y, side, x) => {
      const toBack = side === 'right' ? 1 - x / (head.d - 1) : side === 'left' ? x / (head.d - 1) : side === 'back' ? 1 : 0;
      const jag = hash2(s, 1, hairSeed) < 0.35 ? 1 : 0;
      const depth = Math.round((side === 'front' ? 1 + jag : side === 'back' ? 10 + Math.floor(hash2(s >> 1, 2, hairSeed) * 2) : 2 + Math.round(toBack * 7) + jag) * look.hairline);
      if (y < depth) return hair(s, y);
      let c = skin(s, y + 40);
      if (y === depth) c = k(c, 0.82);
      if (y >= 18) c = k(c, 0.88);
      if (look.stubble && y >= 15 && side !== 'back' && hash2(s, y, hairSeed + 4) < 0.35) c = mixc(c, '#3c423e', 0.35);
      return c;
    },
    (x, y) => {
      if (look.hairline < 1) {
        // Balding crown: grey wisps round a bare scalp.
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        return d > 5 || hash2(x, y, hairSeed + 9) < 0.15 ? hair(x + 3, y + 90) : k(skin(x + 50, y + 50), 1.04 - d * 0.015);
      }
      return hair(x + 3, y + 90);
    },
    (x, y) => k(skin(x, y + 200), 0.7),
  );
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(6, 9, 4, 5, 0.86);
    e.mulRect(7, 10, 2, 3, 0.82);
    e.mulRect(6, 9, 4, 1, 1.1);
  }
  const f = on(a, head.front);
  f.mulRect(2, 3, 12, 1, 0.92); // furrowed forehead
  f.mulRect(5, 5, 6, 1, 0.9);
  if (look.old) {
    f.mulRect(3, 4, 10, 1, 0.94);
    f.mulRect(1, 12, 1, 4, 0.9); // deep lines down the cheeks
    f.mulRect(14, 12, 1, 4, 0.9);
  }
  // Heavy unibrow, dipping toward the nose for a scowl.
  for (let x = 1; x <= 14; x += 1) {
    const inner = 7.5 - Math.abs(x - 7.5);
    const y0 = 6 + (inner > 4.5 ? 1 : 0);
    const y1 = inner > 4.5 ? 8 : 7;
    for (let y = y0; y <= y1; y += 1) f.set(x, y, k(C(look.brow), grain(x, y, hairSeed + 6, look.old ? 0.35 : 0.25)));
    if (x === 1 || x === 14) f.mix(x, y0, ILL_SKIN[2]!, 0.5);
  }
  f.mulRect(6, 5, 4, 1, 0.86); // pinched crease between the brows
  // Eyes: pale whites outside, grey-blue irises inside under heavy lids.
  for (const ex of [2, 10]) {
    f.rect(ex, 8, 4, 2, '#d4d6cc');
    f.set(ex + (ex === 2 ? 0 : 3), 9, '#aeb0a6');
  }
  f.rect(4, 8, 2, 2, look.iris);
  f.rect(10, 8, 2, 2, look.iris);
  f.set(5, 9, '#141c24');
  f.set(10, 9, '#141c24');
  f.set(4, 9, mixc(C(look.iris), '#ffffff', 0.25));
  f.set(11, 9, mixc(C(look.iris), '#ffffff', 0.25));
  f.mulRect(2, 8, 4, 1, 0.8); // lids pressed down by the brow
  f.mulRect(10, 8, 4, 1, 0.8);
  f.mulRect(2, 10, 4, 1, 0.84);
  f.mulRect(10, 10, 4, 1, 0.84);
  f.mulRect(6, 9, 4, 3, 1.05); // nose bridge
  f.mulRect(6, 11, 4, 8, 0.84); // shadow of the long nose
  f.mulRect(1, 12, 3, 3, 0.9); // gaunt cheeks
  f.mulRect(12, 12, 3, 3, 0.9);
  // Grim mouth with downturned corners.
  f.mulRect(4, 16, 8, 1, 0.9);
  f.rect(5, 17, 6, 1, '#252b28');
  f.set(4, 18, '#2c322f');
  f.set(11, 18, '#2c322f');
  f.mulRect(5, 18, 6, 1, 0.84);
  f.mulRect(0, 19, 16, 1, 0.84);
  if (look.scar) {
    // An old pale scar across the left brow and cheek.
    for (const [x, y] of [[11, 5], [12, 6], [12, 7], [13, 10], [13, 11], [14, 12], [14, 13]] as const) f.mix(x, y, '#d6c8c0', 0.55);
    for (const [x, y] of [[12, 5], [13, 12]] as const) f.mul(x, y, 0.8);
  }

  const nose = boxUV(o, 24, 0, 2, 4, 2);
  box(
    a,
    nose,
    (s, y, side, x) => {
      let c = k(skin(s + 120, y + 30), 0.92);
      if (side === 'front' && (x === 1 || x === 2) && y < 6) c = k(c, 1.07);
      if (side === 'front' && y === 7 && (x === 0 || x === 3)) c = k(c, 0.6);
      if (y === 7) c = k(c, 0.84);
      if (side === 'back') c = k(c, 0.8);
      return c;
    },
    (x, y) => skin(x + 140, y, 0.04),
    (x, y) => k(skin(x + 150, y), (x === 0 || x === 3) && (y === 1 || y === 2) ? 0.5 : 0.74),
  );
}

const PIL_JACKET = ['#231d19', '#2f2722', '#3c332c', '#4a4038', '#5a4f45'] as const;
const PIL_SHIRT = ['#323c48', '#3e4a58', '#4b5866', '#5d6b7a', '#707f8e'] as const;
const PIL_BELT = ['#4a3018', '#624022', '#7a522e', '#94683c', '#a87a48'] as const;
const DARK_TROUSERS = ['#141518', '#1c1d22', '#25272d', '#2f3239', '#3a3e46'] as const;
const BROWN_BOOT = ['#2e1c0e', '#432a16', '#5a3920', '#71492a', '#865834'] as const;
const VIN_SUIT = ['#1e282d', '#28343a', '#303e45', '#38474f', '#3f5059', '#4c5f69'] as const;
const VIN_VEST = ['#12181b', '#182024', '#1f292e', '#263237'] as const;
const BLACK_BOOT = ['#0c0c0d', '#141416', '#1c1c1f', '#26262a', '#303035'] as const;

/** Pillager and vindicator: body (8 x 12 x 6), legs and arms (4 x 12 x 4). */
function paintIllager(a: Pix, o: O, kind: 'pillager' | 'vindicator', seed: number): void {
  const sd = seeder(seed);
  const pil = kind === 'pillager';
  illagerHead(
    a,
    o,
    pil
      ? { hair: ['#141315', '#1f1d21', '#2b292e', '#38353b'], brow: '#1c1a1d', iris: '#4a6478', hairline: 1, scar: false, stubble: true, old: false }
      : { hair: ['#0a0a0b', '#121214', '#1a1a1d', '#232327'], brow: '#0e0e10', iris: '#3e5a6c', hairline: 1, scar: true, stubble: false, old: false },
    sd(),
  );
  const clothSeed = sd();
  const leatherSeed = sd();
  const skinSeed = sd();
  const outer = (s: number, y: number, fold = 0.1): RGB => (pil ? leather(PIL_JACKET, s, y, clothSeed) : cloth(VIN_SUIT, s, y, clothSeed, fold));
  const hand = (x: number, y: number): RGB => flesh(ILL_SKIN, x, y, skinSeed, 0.38);

  // ---- body
  const body = boxUV(o, 16, 20, 8, 12, 6);
  box(
    a,
    body,
    (s, y, side, x) => {
      const w = fw(body, side);
      // Belt.
      if (y >= 16 && y <= 18) {
        let c = pil ? leather(PIL_BELT, s, y, leatherSeed) : leather(['#08090a', '#101214', '#181b1e', '#22262a'], s, y, leatherSeed);
        if (y === 16) c = k(c, 1.15);
        if (y === 18) c = k(c, 0.72);
        if (side === 'front' && x >= 6 && x <= 9) {
          c = x === 6 || x === 9 || y !== 17 ? C('#9a9da2') : C('#2a2b2e'); // iron buckle
          if (x === 6 && y === 16) c = C('#d4d6da');
        }
        if (pil && side === 'left' && x >= 3 && x <= 8 && y === 17) c = k(c, 1.2); // quiver strap ring
        return c;
      }
      if (side === 'front') {
        if (pil) {
          // Open jacket over the blue-grey undershirt.
          const half = 3.2 - y * 0.12;
          if (Math.abs(x - 7.5) < half && y < 16) {
            let c = cloth(PIL_SHIRT, s, y, clothSeed + 3, 0.08);
            if (Math.abs(x - 7.5) > half - 1) c = k(c, 0.72);
            if (y < 2) c = k(c, 1.1);
            if ((x === 7 || x === 8) && y % 4 === 2 && y > 3) c = mixc(c, '#c8ccd0', 0.5); // shirt buttons
            return c;
          }
        } else {
          // Dark vest with a V of black shirt and a row of buttons.
          const half = 2.6 - y * 0.32;
          if (Math.abs(x - 7.5) < half && y < 8) return k(cloth(['#0c0e10', '#14171a', '#1c2024'], s, y, clothSeed + 4, 0.03), y === 0 ? 1.1 : 1);
          if (x >= 3 && x <= 12 && y < 16) {
            let c = leather(VIN_VEST, s, y, clothSeed + 5);
            if (Math.abs(Math.abs(x - 7.5) - Math.max(0, half)) < 0.7 && y < 8) c = k(c, 1.35); // lapel edge
            if (x === 3 || x === 12) c = k(c, 0.75);
            if ((x === 7 || x === 8) && y >= 9 && y % 3 === 0) c = C(x === 7 ? '#8c9498' : '#5a6266'); // buttons
            if (y >= 12 && (x === 4 || x === 11) && y === 12) c = k(c, 1.3); // pocket welts
            return c;
          }
        }
      }
      let c = outer(s, y);
      if (y === 0) c = k(c, 1.15);
      if (y === 1) c = k(c, 1.05);
      if (y >= 19) c = k(c, 0.9); // coat skirt below the belt
      if (y === 19) c = k(c, 0.75);
      if (y === 23) c = k(c, 0.78);
      if (x === 0 || x === w - 1) c = k(c, 0.86);
      if (pil && side === 'front' && Math.abs(Math.abs(x - 7.5) - (3.2 - y * 0.12)) < 0.6 && y < 16) c = mixc(c, '#6a5848', 0.5); // lapels
      if (pil && side === 'back' && Math.abs(x - 7.5 - (y - 8) * 0.55) < 0.8 && y < 16) c = mixc(c, '#5a3e24', 0.6); // crossbow strap
      if (!pil && side === 'back' && (x === 7 || x === 8) && y > 2 && y < 16) c = k(c, x === 7 ? 0.82 : 0.92); // back seam
      return c;
    },
    (x, y) => {
      const neck = x >= 5 && x <= 10 && y >= 3 && y <= 8;
      return neck ? (pil ? cloth(PIL_SHIRT, x, y + 60, clothSeed + 3) : C('#14171a')) : k(outer(x + 60, y + 60), 1.06);
    },
    (x, y) => k(cloth(DARK_TROUSERS, x, y + 60, clothSeed + 7), 0.7),
  );

  // ---- legs: dark trousers and boots
  const leg = boxUV(o, 0, 20, 4, 12, 4);
  const bootTop = pil ? 14 : 16;
  box(
    a,
    leg,
    (s, y, side, x) => {
      const r = round(x, fw(leg, side));
      if (y >= bootTop) {
        let c = leather(pil ? BROWN_BOOT : BLACK_BOOT, s, y, leatherSeed + 7);
        if (pil && y <= 15) c = k(c, y === 14 ? 1.2 : 1.08); // folded cuff
        if (!pil && y === bootTop) c = k(c, 1.3);
        if (y === 22) c = k(c, 0.78);
        if (y === 23) c = k(C('#0e0a08'), grain(s, y, leatherSeed, 0.3)); // sole
        if (pil && side === 'front' && y >= 17 && y <= 21 && (x === 3 || x === 4)) c = k(c, (y & 1) === 0 ? 1.25 : 0.85);
        if (!pil && side === 'front' && y >= 18 && y <= 21 && x >= 2 && x <= 5) c = k(c, 1.12); // polished toe
        return k(c, r);
      }
      let c = cloth(DARK_TROUSERS, s, y, clothSeed + 7, 0.07);
      if (!pil) c = mixc(c, VIN_SUIT[1]!, 0.35);
      if (y < 2) c = k(c, 0.8);
      if (y === bootTop - 1) c = k(c, 0.72);
      if (side === 'front' && (x === 3 || x === 4)) c = k(c, x === 3 ? 0.88 : 1.06); // crease
      if (side === 'front' && y >= 7 && y <= 10 && x >= 1 && x <= 6) c = k(c, 1.07);
      return k(c, r);
    },
    (x, y) => k(cloth(DARK_TROUSERS, x, y + 90, clothSeed + 7), 0.7),
    (x, y) => k(C('#0e0a08'), grain(x, y, leatherSeed + 9, 0.3)),
  );

  // ---- arms: sleeves of the jacket / suit, grey hands
  const arm = boxUV(o, 44, 20, 4, 12, 4);
  box(
    a,
    arm,
    (s, y, side, x) => {
      const r = round(x, fw(arm, side));
      if (y < 19) {
        let c = outer(s + 100, y + 30, 0.06);
        if (y === 0) c = k(c, 1.15);
        if (y === 6 && pil) c = k(c, 0.8); // shoulder seam
        if (y === 11 || y === 12) c = k(c, y === 11 ? 0.88 : 1.05); // elbow crease
        if (y >= 16) {
          c = pil ? k(leather(PIL_JACKET, s, y, clothSeed + 2), 1.15) : cloth(VIN_VEST, s, y, clothSeed + 2, 0.02); // cuff
          if (y === 18) c = k(c, 0.75);
        }
        return k(c, r);
      }
      let c = hand(s, y + 70);
      if (y === 19) c = k(c, 0.78);
      if (side === 'front' && y === 21 && (x === 1 || x === 3 || x === 5)) c = k(c, 1.1);
      if (y === 23) c = k(c, 0.86);
      return k(c, r);
    },
    (x, y) => k(outer(x + 180, y), 1.06),
    (x, y) => k(hand(x, y + 120), x === 2 || x === 4 || x === 6 ? 0.76 : 0.88),
  );
}

const EVO_ROBE = ['#0c0c0c', '#141414', '#1b1b1b', '#222222', '#2a2a2a', '#343434'] as const;
const EVO_GOLD = ['#5e4210', '#86621a', '#a88224', '#c9a227', '#e4c454', '#f6e08c'] as const;

/** The evoker: an older illager in a black robe trimmed with gold. */
function paintEvoker(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  illagerHead(a, o, { hair: ['#5e625e', '#7a7e7a', '#959993', '#b0b3ad'], brow: '#dcded8', iris: '#4e6a7e', hairline: 0.6, scar: false, stubble: false, old: true }, sd());
  const robeSeed = sd();
  const goldSeed = sd();
  const skinSeed = sd();
  const robe = (s: number, y: number, fold = 0.12): RGB => cloth(EVO_ROBE, s, y, robeSeed, fold);
  const gold = (x: number, y: number, lift = 1): RGB => {
    const t = 0.55 + (fbm2(x / 3, y / 3, goldSeed) - 0.5) * 0.45 + ((x + y) & 1 ? 0.08 : -0.06);
    return k(ramp(EVO_GOLD, clamp(t, 0, 1)), lift);
  };

  // ---- robe (8 x 20 x 6)
  const robeBox = boxUV(o, 0, 20, 8, 20, 6);
  // A gold sun motif on the chest: a diamond ring with a bright centre.
  const motif = (x: number, y: number): number => Math.abs(x - 7.5) + Math.abs(y - 8.5);
  box(
    a,
    robeBox,
    (s, y, side, x) => {
      let c = robe(s, y, y > 20 ? 0.2 : 0.08);
      if (y >= 36 && y <= 37) return gold(s, y, y === 36 ? 1.08 : 0.88); // hem trim
      if (y >= 38) c = k(c, y === 39 ? 0.7 : 0.85);
      if (y < 2) return gold(s, y, y === 0 ? 1.1 : 0.9); // collar
      if (y === 2) c = k(c, 0.75);
      if (side === 'front') {
        if (x === 7 || x === 8) {
          let g = gold(x, y, x === 7 ? 1.06 : 0.9); // centre trim
          if (y % 4 === 1) g = k(g, 1.15);
          return g;
        }
        if (x === 6 || x === 9) c = k(c, 0.72);
        const m = motif(x, y);
        if (y >= 4 && y <= 13 && m > 3.2 && m < 4.6) return gold(x, y, 0.95);
        if (y >= 4 && y <= 13 && m < 2.2 && x !== 7 && x !== 8) return gold(x, y, 1.15);
        if (y >= 28 && y < 36 && (x === 3 || x === 12) && y % 2 === 0) c = mixc(c, EVO_GOLD[2]!, 0.5); // embroidered dots
      }
      if (side === 'back' && y >= 6 && y <= 16) {
        const m = Math.abs(x - 7.5) + Math.abs(y - 11);
        if (m > 3.5 && m < 4.5) return gold(x, y, 0.85);
      }
      if (y === 35) c = k(c, 0.7);
      return c;
    },
    (x, y) => (edgeOf(x, y, 16, 12) === 0 ? gold(x, y + 40, 1) : k(robe(x, y + 90), 1.05)),
    (x, y) => (x < 2 || x > 13 || y < 2 || y > 9 ? k(robe(x, y + 120), 0.6) : k(C('#060606'), grain(x, y, robeSeed, 0.3))),
  );

  // ---- arm: black sleeve with a gold cuff, grey hand
  const arm = boxUV(o, 44, 20, 4, 12, 4);
  box(
    a,
    arm,
    (s, y, side, x) => {
      const r = round(x, fw(arm, side));
      if (y < 19) {
        let c = robe(s + 100, y + 30, 0.07);
        if (y === 0) c = k(c, 1.2);
        if (y >= 15 && y <= 17) c = gold(s, y, y === 15 ? 1.1 : y === 17 ? 0.8 : 1);
        if (y === 18) c = k(robe(s, y), 0.7);
        return k(c, r);
      }
      let c = flesh(ILL_SKIN, s, y + 70, skinSeed, 0.38);
      if (y === 19) c = k(c, 0.78);
      if (side === 'front' && y === 21 && (x === 1 || x === 3 || x === 5)) c = k(c, 1.1);
      if (y === 23) c = k(c, 0.86);
      return k(c, r);
    },
    (x, y) => k(robe(x + 180, y), 1.08),
    (x, y) => k(flesh(ILL_SKIN, x, y + 120, skinSeed, 0.38), x === 2 || x === 4 || x === 6 ? 0.76 : 0.88),
  );
}

// ------------------------------------------------------------------ vex

const VEX = ['#5e7586', '#748c9e', '#8ea6b8', '#a6bccb', '#b8cbd7', '#c6d6e0', '#dce8ef'] as const;
const VEX_WING = ['#7e94a6', '#98aec0', '#b2c6d4', '#c8d8e4', '#dce8f0', '#eef5fa'] as const;

function paintVex(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const skinSeed = sd();
  const wingSeed = sd();
  const skin = (x: number, y: number, bias = 0): RGB => flesh(VEX, x, y, skinSeed, 0.35, bias);
  /** Fades into a darker wisp toward the bottom of the body. */
  const wisp = (c: RGB, s: number, y: number, len: number): RGB => {
    const f = clamp((y - len * 0.45) / (len * 0.55), 0, 1);
    const streak = hash2(s >> 1, 0, skinSeed + 4) * 0.35;
    return mixc(c, '#2c3e4e', clamp(f * (0.75 + streak), 0, 0.85));
  };

  // ---- head
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    head,
    (s, y, side) => {
      let c = skin(s, y, 0.05);
      if (y < 3 && side !== 'front') c = mixc(c, '#e4eef4', 0.25 - y * 0.07); // pale wisps of hair
      if (y === 15) c = k(c, 0.82);
      return c;
    },
    (x, y) => mixc(skin(x + 60, y, 0.12), '#e4eef4', 0.25),
    (x, y) => k(skin(x + 90, y), 0.7),
  );
  const f = on(a, head.front);
  // Angry brows slanting down to the nose.
  for (let i = 0; i < 4; i += 1) {
    f.set(2 + i, 5 + (i >> 1), '#3c4c5c');
    f.set(13 - i, 5 + (i >> 1), '#3c4c5c');
  }
  f.mulRect(2, 8, 4, 3, 0.8); // sockets
  f.mulRect(10, 8, 4, 3, 0.8);
  for (const ex of [3, 11]) {
    f.rect(ex, 8, 2, 2, '#121a24');
    f.set(ex + (ex === 3 ? 1 : 0), 8, '#2a3a4c');
  }
  f.mulRect(7, 9, 2, 3, 0.9);
  // Grimace: clenched teeth in a dark mouth.
  f.rect(4, 12, 8, 3, '#1c2430');
  for (let x = 5; x <= 10; x += 1) f.set(x, 13, x % 2 === 0 ? '#e0e8ee' : '#b8c4cc');
  f.set(4, 13, '#3a4654');
  f.set(11, 13, '#3a4654');
  f.mulRect(3, 15, 10, 1, 0.86);

  // ---- body (8 x 10 x 4): a ragged spirit that thins into a tail
  const body = boxUV(o, 0, 16, 8, 10, 4);
  box(
    a,
    body,
    (s, y, side, x) => {
      let c = cloth(VEX, s, y, skinSeed + 9, 0.14, -0.05);
      if (y === 0) c = k(c, 1.1);
      if (side === 'front' && Math.abs(x - 7.5) < 3 - y * 0.6) c = k(skin(s, y), 1.05); // neck
      if (side === 'front' && y > 3 && y < 9 && (x === 5 || x === 10) && y % 2 === 0) c = k(c, 0.85); // ribs showing
      c = wisp(c, s, y, 20);
      if (y >= 18 && hash2(s, y, skinSeed + 6) < 0.35) c = k(c, 0.8); // tattered tail
      return c;
    },
    (x, y) => k(cloth(VEX, x, y + 60, skinSeed + 9, 0.06), 1.06),
    (x, y) => mixc(skin(x, y + 90), '#22323f', 0.8),
  );

  // ---- arm (3 x 10 x 3)
  const arm = boxUV(o, 24, 16, 3, 10, 3);
  box(
    a,
    arm,
    (s, y, side, x) => {
      let c = skin(s + 100, y);
      if (y === 0) c = k(c, 1.08);
      if (y >= 16) c = k(c, 1.04);
      if (y === 15) c = k(c, 0.85); // wrist
      if (side === 'front' && y === 18 && (x === 1 || x === 3)) c = k(c, 0.82); // fingers
      return k(c, round(x, 6));
    },
    (x, y) => skin(x + 150, y, 0.08),
    (x, y) => k(skin(x + 160, y), 0.82),
  );

  // ---- wing (12 x 10 x 1): pale feathery membrane with veins fanning from the root
  const wing = boxUV(o, 36, 16, 12, 10, 1);
  const wingTex = (x: number, y: number): RGB => {
    // Root at the top-left corner (x, y measured in face texels, 24 x 20).
    const ang = Math.atan2(y + 1, x + 1);
    const r = Math.hypot(x + 1, y + 1);
    const vein = Math.abs(((ang / (Math.PI / 2)) * 6) % 1 - 0.5);
    let t = 0.62 + (fbm2(x / 4, y / 4, wingSeed) - 0.5) * 0.25 - r * 0.012;
    if (vein > 0.4 && r > 3) t -= 0.32; // veins
    else if (vein > 0.3) t -= 0.1;
    if ((Math.floor(r) & 3) === 0 && vein < 0.3) t += 0.06; // feather barbs
    // Scalloped trailing edge.
    const edge = r - (20 + Math.sin(ang * 22) * 1.6);
    if (edge > -1.5) t -= 0.22;
    if (x < 2 || y < 2) t += 0.12; // bony leading edge
    return ramp(VEX_WING, clamp(t, 0, 1));
  };
  paint(a, wing.front, (x, y) => wingTex(x, y));
  paint(a, wing.back, (x, y) => k(wingTex(23 - x, y), 0.94));
  paint(a, wing.right, (_x, y) => k(wingTex(0, y), 0.85));
  paint(a, wing.left, (_x, y) => k(wingTex(23, y), 0.85));
  paint(a, wing.top, (x) => k(wingTex(x, 0), 1.05));
  paint(a, wing.bottom, (x) => k(wingTex(x, 19), 0.8));
}

// ------------------------------------------------------------------ cave spider

const CAVE_FUR = ['#06141a', '#0b2129', '#10303a', '#164048', '#1d4a55', '#2a6070'] as const;

/** The spider's layout in dark teal fur, with pale teal chevrons on the abdomen. */
function paintCaveSpider(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const hairSeed = sd();
  const markSeed = sd();
  const fur = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 3.5, y / 3.5, hairSeed);
    let t = 0.5 + bias + (n - 0.5) * 0.7 + (hash2(x, y, hairSeed + 1) - 0.5) * 0.22;
    const tuft = hash2(x, (y + (x & 1)) >> 1, hairSeed + 2);
    if (tuft > 0.86) t += 0.22;
    else if (tuft < 0.1) t -= 0.18;
    let c = ramp(CAVE_FUR, clamp(t, 0, 1));
    if (tuft > 0.95) c = mixc(c, '#5e9aa4', 0.3); // pale guard hairs
    return c;
  };

  // ---- head
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    head,
    (s, y) => k(fur(s, y), y === 15 ? 0.75 : y === 0 ? 1.1 : 1),
    (x, y) => fur(x + 60, y + 20, 0.06),
    (x, y) => k(fur(x + 90, y + 40), 0.65),
  );
  for (const r of [head.right, head.left]) on(a, r).mulRect(0, 12, 16, 4, 0.85);
  const hf = head.front;
  const f = on(a, hf);
  for (const [x, y, w, h] of [[3, 6, 5, 5], [8, 6, 5, 5], [3, 3, 4, 4], [9, 3, 4, 4], [0, 6, 4, 4], [12, 6, 4, 4], [1, 10, 4, 4], [11, 10, 4, 4]] as const) f.mulRect(x, y, w, h, 0.7);
  for (const ex of [4, 9]) {
    for (let y = 7; y <= 9; y += 1) for (let x = ex; x <= ex + 2; x += 1) glowSet(a, hf, x, y, y === 9 ? '#8c0f0c' : '#d81d16');
    glowSet(a, hf, ex + 1, 8, '#f23a26');
    glowSet(a, hf, ex === 4 ? ex : ex + 2, 7, '#ff8a70');
  }
  for (const [ex, ey] of [[4, 4], [10, 4], [1, 7], [13, 7], [2, 11], [12, 11]] as const) {
    glowSet(a, hf, ex, ey, '#e0281c');
    glowSet(a, hf, ex + 1, ey, '#c41a14');
    glowSet(a, hf, ex, ey + 1, '#a81410');
    glowSet(a, hf, ex + 1, ey + 1, '#7c0d0a');
    if (ex === 4 || ex === 1 || ex === 2) glowSet(a, hf, ex, ey, '#ff7a5e');
  }
  f.mulRect(5, 12, 6, 4, 0.7);
  f.mulRect(7, 12, 2, 4, 0.6);
  for (const fx of [5, 9]) {
    f.mulRect(fx, 12, 2, 2, 1.35);
    const tx = fx === 5 ? 6 : 9;
    f.set(tx, 13, '#6e8a86');
    f.set(tx, 14, '#56706c');
    f.set(tx + (fx === 5 ? 1 : -1), 15, '#344846');
  }
  f.mulRect(2, 2, 12, 1, 1.2);

  // ---- thorax
  const thorax = boxUV(o, 32, 0, 6, 6, 6);
  box(
    a,
    thorax,
    (s, y) => k(fur(s + 200, y), y === 0 ? 1.1 : y >= 10 ? 0.78 : 1),
    (x, y) => {
      let c = fur(x + 240, y, 0.08);
      const d = Math.hypot(x - 5.5, y - 5.5);
      if (d < 2.2) c = k(c, 0.72);
      if (d > 2.2 && d < 3.2 && (x + y) % 3 === 0) c = mixc(c, '#4a8a92', 0.4);
      return c;
    },
    (x, y) => k(fur(x + 280, y), 0.6),
  );

  // ---- abdomen: lighter teal chevrons and spots
  const ab = boxUV(o, 0, 16, 10, 8, 12);
  const mark = (c: RGB, x: number, y: number, w: number, h: number): RGB => {
    const cx = Math.abs(x - (w - 1) / 2);
    const v = y / (h - 1);
    const chev = Math.abs(((y + cx * 0.9) % 6) - 1) < 0.85 && v > 0.12 && v < 0.92 && cx < w * 0.4;
    const spine = cx < 1.2 && v > 0.05 && v < 0.95;
    const spot = Math.abs(cx - w * 0.33) < 1.3 && Math.abs(v - 0.3) < 0.08;
    const n = fbm2(x / 3, y / 3, markSeed);
    if (chev || spot) return mixc(c, '#4fa2a8', clamp(0.5 + (n - 0.5) * 0.6, 0.25, 0.7));
    if (spine) return mixc(c, '#2c6a72', 0.4);
    return c;
  };
  box(
    a,
    ab,
    (s, y, side, x) => {
      let c = fur(s + 300, y);
      if (y === 0) c = k(c, 1.08);
      if (y >= 13) c = k(c, 0.8);
      if (y % 5 === 4 && side !== 'front') c = k(c, 0.85);
      if (side === 'back') c = mark(c, x, y, ab.w, ab.h);
      if (side === 'front') c = k(c, 0.82);
      if ((side === 'right' || side === 'left') && y < 6 && (x + 2) % 6 < 2) c = mixc(c, '#3e8a92', 0.35); // flank bars
      return c;
    },
    (x, y) => mark(k(fur(x + 400, y, 0.06), y % 6 === 5 ? 0.86 : 1), x, y, ab.w, ab.d),
    (x, y) => k(fur(x + 460, y), 0.6),
  );

  // ---- leg (16 x 2 x 2)
  const leg = boxUV(o, 0, 40, 16, 2, 2);
  const legShade = (x: number, y: number, bias: number): RGB => {
    let c = fur(x + 600, y, bias);
    const joint = Math.min(Math.abs(x - 10.5), Math.abs(x - 21.5));
    if (joint < 1) c = mixc(c, '#3e7a80', 0.55);
    else if (joint < 2) c = k(c, 0.75);
    if (x >= 29) c = k(c, 0.7 - (x - 29) * 0.08);
    return c;
  };
  paint(a, leg.top, (x, y) => legShade(x, y, 0.08));
  paint(a, leg.front, (x, y) => k(legShade(x, y + 4, 0), y === 3 ? 0.8 : 1));
  paint(a, leg.back, (x, y) => k(legShade(31 - x, y + 8, 0), y === 3 ? 0.8 : 1));
  paint(a, leg.bottom, (x, y) => k(legShade(x, y + 12, -0.05), 0.75));
  paint(a, leg.right, (x, y) => k(fur(x + 700, y), 0.7));
  paint(a, leg.left, (x, y) => k(fur(x + 720, y), 0.5));
}

// ------------------------------------------------------------------ skeleton variants

interface BoneLook {
  bone: readonly string[];
  gap: string;
  /** Crack colour drawn along fine fbm contours (null: plain hairline darkening). */
  crack: string | null;
  frost: boolean;
  socket: string;
  pupil: string;
  pupilGlow: number;
  /** A single glinting texel per eye instead of a 2 x 1 pupil. */
  glint: boolean;
}

/** Skeleton layout (head, ribcage body, 2 x 12 x 2 limbs) in a given bone palette. */
function paintBones(a: Pix, o: O, look: BoneLook, seed: number): void {
  const sd = seeder(seed);
  const boneSeed = sd();
  const crackSeed = sd();
  const frostSeed = sd();
  const bone = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 4, y / 4, boneSeed);
    let t = 0.62 + bias + (n - 0.5) * 0.55 + (hash2(x, y, boneSeed + 1) - 0.5) * 0.1;
    let c: RGB;
    if (look.crack && crackAt(x, y, crackSeed)) c = mixc(ramp(look.bone, clamp(t, 0, 1)), look.crack, 0.7); // ash-grey cracks
    else {
      if (!look.crack && Math.abs(fbm2(x / 3, y / 3, crackSeed) - 0.5) < 0.012) t -= 0.25;
      c = ramp(look.bone, clamp(t, 0, 1));
    }
    if (look.frost) {
      const fr = fbm2(x / 2.5, y / 2.5, frostSeed);
      if (fr > 0.6) c = mixc(c, '#f4fbff', clamp((fr - 0.6) * 2.5, 0, 0.6)); // rime
      if (hash2(x, y, frostSeed + 1) < 0.02) c = mixc(c, '#ffffff', 0.6); // ice glints
    }
    return c;
  };
  const gap = (x: number, y: number): RGB => k(C(look.gap), grain(x, y, boneSeed + 2, 0.3));

  // ---- head
  const head = boxUV(o, 0, 0, 8, 8, 8);
  box(
    a,
    head,
    (s, y) => k(bone(s, y), y === 15 ? 0.82 : y === 0 ? 1.05 : 1),
    (x, y) => {
      let c = bone(x + 60, y, 0.05);
      const suture = Math.round(7.5 + Math.sin(y * 1.7) * 0.9);
      if (x === suture && y > 3) c = k(c, 0.72);
      if (y === 4 && x > 2 && x < 13 && (x & 1) === 0) c = k(c, 0.8);
      return c;
    },
    (x, y) => k(bone(x + 90, y), 0.62),
  );
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(4, 6, 8, 5, 0.92);
    e.mulRect(7, 9, 2, 2, 0.78);
    e.mulRect(2, 12, 12, 1, 0.86);
  }
  on(a, head.back).mulRect(4, 12, 8, 3, 0.9);
  const hf = head.front;
  const f = on(a, hf);
  f.mulRect(1, 5, 14, 1, 0.84);
  for (const ex of [2, 10]) {
    f.rect(ex, 6, 4, 4, mixc(C(look.socket), '#ffffff', 0.08));
    f.rect(ex + 1, 7, 2, 2, look.socket);
    f.set(ex, 6, k(C(look.socket), 0.7));
    f.set(ex + 3, 6, k(C(look.socket), 0.7));
    f.mulRect(ex, 10, 4, 1, 0.86);
    if (look.glint) glowSet(a, hf, ex + (ex === 2 ? 2 : 1), 7, look.pupil, look.pupilGlow);
    else {
      glowSet(a, hf, ex + 1, 8, look.pupil, look.pupilGlow);
      glowSet(a, hf, ex + 2, 8, mixc(C(look.pupil), look.socket, 0.35), look.pupilGlow * 0.7);
    }
  }
  f.mulRect(6, 10, 4, 2, 0.82);
  f.rect(7, 10, 2, 2, look.gap);
  f.mulRect(1, 10, 2, 3, 0.85);
  f.mulRect(13, 10, 2, 3, 0.85);
  for (let x = 3; x <= 12; x += 1) {
    if ((x & 1) === 0) {
      f.mul(x, 12, 0.62);
      f.mul(x, 14, 0.64);
    }
    f.set(x, 13, look.gap);
  }
  f.mulRect(3, 15, 10, 1, 0.85);

  // ---- body: ribcage over a dark hollow
  const body = boxUV(o, 16, 16, 8, 12, 4);
  const ribPart = (side: Side, x: number, y: number): number => {
    const off = Math.abs(x - 7.5);
    for (let i = 0; i < 3; i += 1) {
      const y0 = 3 + i * 4;
      let c: number;
      if (side === 'front') {
        if (i === 2 && off > 5.6) continue;
        c = y0 + Math.round(off * 0.28);
      } else if (side === 'back') c = y0 + 1 + Math.round(off * 0.14);
      else {
        if (i === 2) continue;
        c = y0 + 2;
      }
      if (y === c) return 1;
      if (y === c + 1) return 2;
      if (y === c + 2) return 3;
    }
    return 0;
  };
  box(
    a,
    body,
    (s, y, side, x) => {
      const mid = x === 7 || x === 8;
      if (side === 'front' && mid && y >= 2 && y <= 12) return k(bone(s, y, 0.06), y === 12 ? 0.8 : 1);
      if ((side === 'front' || side === 'back') && mid && y < 19) return k(bone(s, y, side === 'back' ? 0.02 : -0.06), y % 3 === 2 ? 0.68 : 1);
      if (y <= 1) return k(bone(s, y), y === 1 ? 0.82 : 1.04);
      if (y >= 19 && y <= 20 && (side !== 'front' || (x >= 2 && x <= 13))) return k(bone(s, y), y === 20 ? 0.85 : 1.02);
      if (y >= 21 && (side === 'right' || side === 'left' || x <= 5 || x >= 10)) return k(bone(s, y), y === 23 ? 0.72 : 0.94);
      if (y >= 21 && y <= 22) return k(bone(s, y), 0.86);
      const rib = ribPart(side, x, y);
      if (rib === 1) return k(bone(s, y), 1.04);
      if (rib === 2) return k(bone(s, y), 0.8);
      if (side === 'back' && y >= 2 && y <= 9) {
        const half = Math.abs(x - 7.5);
        if (half >= 2.5 && half <= 6.5 - (y - 2) * 0.45) return k(bone(s, y), y === 2 ? 1 : 0.9);
      }
      if (side === 'back' && (x === 6 || x === 9) && y % 3 === 0 && y < 19) return k(bone(s, y), 0.86);
      const c = gap(s, y);
      return rib === 3 || y === 2 || y === 18 ? k(c, 0.6) : c;
    },
    (x, y) => (x < 2 || x > 13 || y < 2 || y > 5 || x === 7 || x === 8 ? bone(x + 70, y + 30, 0.03) : gap(x, y)),
    (x, y) => (x < 2 || x > 13 || y < 2 || y > 5 ? k(bone(x + 90, y + 30), 0.7) : gap(x, y)),
  );

  // ---- limbs (2 x 12 x 2)
  const limb = (b: BoxUV, off: number, isArm: boolean): void => {
    box(
      a,
      b,
      (s, y, _side, x) => {
        let c = bone(s + off, y);
        if (y === 11) c = k(c, 1.06);
        if (y === 12) c = k(c, 0.66);
        if (y === 13) c = k(c, 1.04);
        if (y < 2) c = k(c, isArm ? 1.05 : 0.82);
        if (y >= 22) c = k(c, isArm ? 0.9 : 0.85);
        return k(c, round(x, 4) * (x === 0 || x === 3 ? 0.95 : 1));
      },
      (x, y) => k(bone(x + off, y + 50), (x === 1 || x === 2) && (y === 1 || y === 2) ? 0.7 : 1),
      (x, y) => k(bone(x + off, y + 60), (x === 1 || x === 2) && (y === 1 || y === 2) ? 0.55 : 0.75),
    );
  };
  limb(boxUV(o, 40, 16, 2, 12, 2), 300, true);
  limb(boxUV(o, 0, 16, 2, 12, 2), 400, false);
}

const STRAY_BONE = ['#7c929a', '#a9bcc2', '#bccdd2', '#cddbdf', '#dfe9ec', '#eef5f7'] as const;
const STRAY_RAG = ['#262f35', '#33434b', '#3e5059', '#4b5e68', '#5c6e78'] as const;
const STRAY_TEARS: readonly Tear[] = [[9, 9, 1.8, 2.2], [21, 15, 1.4, 1.8], [33, 7, 2, 1.6], [43, 13, 1.5, 2.4]];

/** The stray: frosted skeleton plus tattered hood, tunic and leg wraps (cut-out overlays). */
function paintStray(a: Pix, o: O, seed: number): void {
  paintBones(a, o, { bone: STRAY_BONE, gap: '#101824', crack: null, frost: true, socket: '#141e33', pupil: '#bfe6ff', pupilGlow: 0.6, glint: false }, seed);
  const sd = seeder(seed + 17);
  const ragSeed = sd();
  const jagSeed = sd();
  const rag = (s: number, y: number, bias = 0): RGB => {
    let c = cloth(STRAY_RAG, s, y, ragSeed, 0.1, bias);
    if (fbm2(s / 3, y / 3, ragSeed + 5) > 0.66) c = mixc(c, '#c8dce4', 0.25); // frost on the cloth
    return c;
  };
  const fray = (c: RGB): RGB => mixc(c, '#8a9ca6', 0.55);
  const jag = (s: number, salt: number): number => Math.floor(hash2(s >> 1, salt, jagSeed) * 3) + (hash2(s, salt + 1, jagSeed) < 0.3 ? 1 : 0);

  // ---- hood (8 x 8 x 8): open over the face, ragged sides and hem
  const hood = boxUV(o, 32, 0, 8, 8, 8);
  paint(a, hood.top, (x, y) => {
    let c = rag(x + 40, y + 200, 0.08);
    if (x === 7 || x === 8) c = k(c, x === 7 ? 0.82 : 0.92); // seam along the crown
    if (y === 15) c = fray(c);
    return c;
  });
  paint(a, hood.front, (x, y) => {
    const top = 3 + jag(x, 3);
    const side = 2 + (hash2(y >> 1, 4, jagSeed) < 0.5 ? 1 : 0);
    if (y < top) return y === top - 1 ? fray(rag(x, y)) : rag(x, y);
    if (x < side - (y > 11 ? 1 : 0) || x > 15 - side + (y > 11 ? 1 : 0)) {
      if (y > 13 && hash2(x, y, jagSeed + 6) < 0.5) return null;
      return x === side - 1 || x === 16 - side ? fray(rag(x, y)) : rag(x, y);
    }
    return null;
  });
  paintSides(a, hood, (s, y, side, x) => {
    if (side === 'front') return null; // already painted
    const hem = 12 + jag(s, 7) - (side === 'back' ? 0 : 1);
    if (y > hem) return null;
    const hole = tearDist(s, y, [[6, 8, 1.3, 1.6], [26, 6, 1.1, 1.4], [44, 9, 1.4, 1.4]], ragSeed + 2);
    if (hole < 1) return null;
    let c = rag(s, y);
    if (hole < 1.4 || y === hem) c = fray(c);
    if (y === 0) c = k(c, 1.1);
    if (side !== 'back' && x === (side === 'right' ? 15 : 0)) c = k(c, 0.8); // the hood's lip
    return c;
  });
  paint(a, hood.bottom, (x, y) => (x < 2 || x > 13 || y < 2 ? (hash2(x, y, jagSeed + 8) < 0.3 ? null : k(rag(x, y + 300), 0.6)) : null));

  // ---- tunic (8 x 12 x 4): tattered, holed, a ragged hem
  const tunic = boxUV(o, 16, 32, 8, 12, 4);
  paintSides(a, tunic, (s, y, side, x) => {
    const hem = 17 + jag(s, 11) + (hash2(s >> 2, 12, jagSeed) < 0.3 ? 3 : 0);
    if (y > hem) return null;
    if (side === 'front' && y < 4 && Math.abs(x - 7.5) < 3.5 - y * 0.6) return null; // neck opening
    const hole = tearDist(s, y, STRAY_TEARS, ragSeed + 3);
    if (hole < 1) return null;
    let c = rag(s, y + 40);
    if (hole < 1.5 || y >= hem - 1) c = fray(c);
    if (y === 0) c = k(c, 1.12);
    if (y === 10 || y === 11) c = k(cloth(['#1e1812', '#2c2218', '#3a2e22'], s, y, ragSeed + 7, 0.02), y === 10 ? 1.1 : 0.85); // rope belt
    if (x === 0 || x === fw(tunic, side) - 1) c = k(c, 0.86);
    return c;
  });
  paint(a, tunic.top, (x, y) => (x >= 5 && x <= 10 && y >= 2 && y <= 5 ? null : k(rag(x + 80, y + 400), 1.06)));
  paint(a, tunic.bottom, (x, y) => (edgeOf(x, y, 16, 8) === 0 && hash2(x, y, jagSeed + 9) < 0.6 ? k(rag(x, y + 420), 0.6) : null));

  // ---- leg rags (2 x 12 x 2): spiralling wraps with gaps
  const legRag = boxUV(o, 0, 32, 2, 12, 2);
  paintSides(a, legRag, (s, y, _side, x) => {
    const band = (((y + s * 0.75) % 7) + 7) % 7;
    if (y < 4 || band >= 4.2) return null;
    if (y > 20 + jag(s, 13)) return null;
    let c = rag(s + 100, y);
    if (band < 1) c = k(c, 1.12);
    if (band > 3.2) c = fray(c);
    return k(c, round(x, 4));
  });
}

const CHAR_BONE = ['#0f0f0f', '#141414', '#1c1c1c', '#262626', '#303030', '#3a3a3a'] as const;

function paintWitherSkeleton(a: Pix, o: O, seed: number): void {
  paintBones(a, o, { bone: CHAR_BONE, gap: '#040404', crack: '#6a6a66', frost: false, socket: '#000000', pupil: '#d8401c', pupilGlow: 0.55, glint: true }, seed);
}

// ------------------------------------------------------------------ iron armour

const ARMOR = ['#4e4e4e', '#6e6e6e', '#8a8a8a', '#a4a4a4', '#bcbcbc', '#d2d2d2', '#e6e6e6', '#f8f8f8'] as const;

function paintArmor(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const mSeed = sd();
  const metal = (x: number, y: number, bias = 0): RGB => {
    const t = 0.42 + bias + (fbm2(x / 6, y / 2, mSeed) - 0.5) * 0.3 + (hash2(x, 0, mSeed + 2) - 0.5) * 0.1 + (hash2(x, y >> 1, mSeed + 1) - 0.5) * 0.08;
    return ramp(ARMOR, clamp(t, 0, 1));
  };
  const rivet = (c: RGB, lit: boolean): RGB => (lit ? mixc(c, '#ffffff', 0.6) : k(c, 0.62));
  const isRivet = (x: number, y: number, pts: readonly (readonly [number, number])[]): number => {
    for (const [rx, ry] of pts) {
      if (x === rx && y === ry) return 1;
      if (x === rx + 1 && y === ry + 1) return 2;
    }
    return 0;
  };

  // ---- helmet (8 x 8 x 8): face opening on the front, open bottom
  const helm = boxUV(o, 0, 0, 8, 8, 8);
  paint(a, helm.top, (x, y) => {
    let c = k(metal(x, y + 50, 0.12), bevel(x, y, 16, 16));
    if (x === 7) c = k(c, 1.18); // crest ridge
    if (x === 8) c = k(c, 0.82);
    const r = isRivet(x, y, [[2, 2], [12, 2], [2, 12], [12, 12]]);
    if (r) c = rivet(c, r === 1);
    return c;
  });
  paintSides(a, helm, (s, y, side, x) => {
    if (side === 'front') {
      const open = y >= 6 && x >= 2 && x <= 13 && !((x === 7 || x === 8) && y <= 11);
      if (open) return null;
      let c = metal(s, y, 0.05);
      if (y === 0) c = k(c, 1.2);
      if (y === 5 && x >= 2 && x <= 13) c = k(c, 0.62); // brow lip
      if (y === 4 && x >= 2 && x <= 13) c = k(c, 1.12);
      if (x === 7) c = k(c, 1.15); // nose guard
      if (x === 8 && y > 5) c = k(c, 0.82);
      if ((x === 1 || x === 14) && y > 5) c = k(c, x === 1 ? 0.78 : 0.7); // cheek edges against the opening
      if (y === 15) c = k(c, 0.7);
      const r = isRivet(x, y, [[3, 2], [11, 2]]);
      if (r) c = rivet(c, r === 1);
      return c;
    }
    const w = fw(helm, side);
    let c = k(metal(s, y), bevel(x, y, w, 16));
    if (y === 0) c = k(c, 1.1);
    if (y >= 13) c = k(c, y === 13 ? 1.15 : y === 15 ? 0.66 : 0.92); // rolled rim
    if (x === 0) c = k(c, 1.1);
    if (x === w - 1) c = k(c, 0.82);
    if (side !== 'back' && y === 7 && x > 1 && x < w - 2) c = k(c, 0.82); // plate seam
    if (side === 'back' && x === 7) c = k(c, 1.12);
    const r = isRivet(x, y, [[3, 10], [11, 10]]);
    if (r) c = rivet(c, r === 1);
    return c;
  });
  // The bottom face stays transparent.

  // ---- chestplate (8 x 12 x 4)
  const chest = boxUV(o, 16, 16, 8, 12, 4);
  box(
    a,
    chest,
    (s, y, side, x) => {
      const w = fw(chest, side);
      let c = metal(s, y + 20);
      if (side === 'front') {
        if (y < 12) {
          // Two pectoral plates either side of a raised keel.
          const px = x < 8 ? x : x - 8;
          c = k(c, bevel(px, y, 8, 12));
          if (x === 7 || x === 8) c = k(metal(x, y), x === 7 ? 1.2 : 0.9);
        } else {
          // Overlapping abdominal lames.
          const ly = (y - 12) % 4;
          c = k(c, ly === 0 ? 1.18 : ly === 3 ? 0.7 : 1);
          if (x === 0 || x === 15) c = k(c, 0.85);
        }
        if (y < 2 && x > 4 && x < 11) c = k(c, 0.75); // neckline
      } else {
        c = k(c, bevel(x, y, w, 24));
        if (side === 'back' && (x === 7 || x === 8)) c = k(c, x === 7 ? 1.12 : 0.9); // spine ridge
        if (side !== 'back' && y >= 12 && (y - 12) % 4 === 3) c = k(c, 0.75);
      }
      const r = isRivet(x, y, side === 'front' ? [[2, 2], [12, 2], [2, 9], [12, 9]] : side === 'back' ? [[2, 2], [12, 2]] : [[3, 3]]);
      if (r) c = rivet(c, r === 1);
      return c;
    },
    (x, y) => {
      let c = k(metal(x + 40, y + 90, 0.12), bevel(x, y, 16, 8));
      if (x > 4 && x < 11 && y > 1 && y < 6) c = k(c, 0.72); // neck hole rim
      return c;
    },
    (x, y) => k(metal(x + 60, y + 100), 0.6),
  );

  // ---- pauldron (4 x 5 x 4): a domed plate over a second lame
  const pauldron = boxUV(o, 40, 16, 4, 5, 4);
  box(
    a,
    pauldron,
    (s, y, side, x) => {
      const w = fw(pauldron, side);
      let c = metal(s + 80, y, 0.04);
      if (y === 0) c = k(c, 1.22);
      if (y === 5) c = k(c, 0.65); // edge of the upper plate
      if (y === 6) c = k(c, 1.15);
      if (y === 9) c = k(c, 0.68);
      if (x === 0) c = k(c, 1.08);
      if (x === w - 1) c = k(c, 0.84);
      if (side === 'front' && y === 2 && (x === 2 || x === 5)) c = rivet(c, true);
      return c;
    },
    (x, y) => {
      const d = Math.hypot(x - 5, y - 5);
      return k(metal(x + 100, y + 120, 0.15), 1.12 - d * 0.04);
    },
    (x, y) => k(metal(x + 110, y + 130), 0.55),
  );
}

// ------------------------------------------------------------------ ravager

const HIDE = ['#36332e', '#4f4b45', '#5e5951', '#6f695f', '#8a847a', '#9c968b'] as const;
const MANE = ['#17140f', '#221e19', '#2e2822', '#3a332b', '#463e34'] as const;
const HORN = ['#5a5040', '#7e7360', '#a39a82', '#bdb49b', '#cfc6ae', '#e6dfca'] as const;
const MUZZLE = '#a39c8e';

function paintRavager(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const hideSeed = sd();
  const maneSeed = sd();
  const hornSeed = sd();
  /** Coarse hide: big blotches, short fur strokes. */
  const hide = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 6, y / 6, hideSeed);
    const stroke = hash2(x, y >> 1, hideSeed + 1) - 0.5;
    return ramp(HIDE, clamp(0.5 + bias + (n - 0.5) * 0.6 + stroke * 0.2, 0, 1));
  };
  /** Shaggy dark mane: long vertical tufts. */
  const mane = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 1.8, y / 5, maneSeed);
    return k(ramp(MANE, clamp(0.5 + bias + (n - 0.5) * 1.4, 0, 1)), grain(x, y, maneSeed + 1, 0.15));
  };
  const horn = (x: number, y: number, bias = 0): RGB => {
    const t = 0.6 + bias + (fbm2(x / 3, y / 3, hornSeed) - 0.5) * 0.3 + ((x % 4) === 0 ? -0.12 : 0); // growth rings
    return ramp(HORN, clamp(t, 0, 1));
  };

  // ---- head (8 x 9 x 8): mane over the brow, pale muzzle, ember eyes
  const head = boxUV(o, 0, 0, 8, 9, 8);
  box(
    a,
    head,
    (s, y, side, x) => {
      const fringe = 3 + (hash2(s, 2, maneSeed) < 0.4 ? 1 : 0);
      if (y < fringe && side !== 'front') return mane(s, y);
      let c = hide(s, y + 30);
      if (y === fringe && side !== 'front') c = k(c, 0.78);
      if (side === 'front' && y < 2) c = mane(s, y);
      if (y >= 16) c = k(c, 0.85);
      if ((side === 'right' || side === 'left') && y >= 9) {
        const toFront = side === 'right' ? x / 15 : 1 - x / 15;
        if (toFront > 0.6) c = mixc(c, MUZZLE, (toFront - 0.6) * 1.2); // muzzle wraps round the sides
      }
      return c;
    },
    (x, y) => {
      const c = mane(x + 40, y + 60, 0.05);
      return y > 11 ? k(c, 0.9) : c;
    },
    (x, y) => k(hide(x + 80, y + 80), 0.65),
  );
  const hf = head.front;
  const f = on(a, hf);
  f.mixRect(1, 2, 14, 3, '#7a7468', 0.3); // heavy brow
  f.mulRect(1, 4, 14, 1, 0.82);
  // Muzzle.
  for (let y = 9; y < 18; y += 1) for (let x = 2; x < 14; x += 1) f.mix(x, y, MUZZLE, y === 9 || x === 2 || x === 13 ? 0.35 : 0.65);
  f.mulRect(2, 9, 12, 1, 0.9);
  // Small sunken eyes with a dark-red glow.
  for (const ex of [2, 12]) {
    f.rect(ex - 1, 5, 4, 3, '#1e1a16');
    glowSet(a, hf, ex, 6, '#c4241a', 0.85);
    glowSet(a, hf, ex + 1, 6, '#8a120c', 0.7);
    f.set(ex, 7, '#3a1410');
  }
  // Nostrils and a heavy lip line.
  for (const nx of [5, 9]) {
    f.rect(nx, 12, 2, 2, '#2a2420');
    f.set(nx + (nx === 5 ? 0 : 1), 12, '#14100e');
  }
  f.mulRect(7, 10, 2, 5, 1.06);
  f.rect(2, 17, 12, 1, '#3a302a');

  // ---- jaw (8 x 2 x 7): ivory teeth on the front, a dark maw on top
  const jaw = boxUV(o, 0, 17, 8, 2, 7);
  box(
    a,
    jaw,
    (s, y, side, x) => {
      if (side === 'front') {
        if (y < 2) {
          const tooth = x % 4;
          if (tooth === 3 || (y === 0 && tooth === 0)) return C('#2a1612');
          return horn(x + 50, y, y === 0 ? 0.2 : 0.05);
        }
        return k(mixc(hide(x, y + 200), MUZZLE, 0.5), y === 3 ? 0.8 : 1);
      }
      let c = mixc(hide(s + 100, y + 200), MUZZLE, side === 'back' ? 0 : 0.25);
      if (y === 0) c = k(c, 1.1);
      if (y === 3) c = k(c, 0.75);
      return c;
    },
    (x, y) => {
      if (x === 0 || x === 15 || y === 0) return k(hide(x + 120, y), 0.8);
      if (y >= 12) return x % 4 === 3 ? C('#3a1a16') : horn(x + 60, y, y === 12 ? 0.15 : 0); // tooth row from above
      const t = Math.abs(x - 7.5) / 8;
      return k(mixc(C('#6a2a28'), '#3a1412', t + (hash2(x, y, hideSeed) - 0.5) * 0.2), 1 - y * 0.015); // tongue
    },
    (x, y) => k(mixc(hide(x + 140, y), MUZZLE, 0.3), 0.75),
  );

  // ---- neck (5 x 5 x 6): mane along the top
  const neck = boxUV(o, 32, 0, 5, 5, 6);
  box(
    a,
    neck,
    (s, y, side) => {
      const fringe = 4 + Math.floor(hash2(s, 3, maneSeed) * 3);
      if (y < fringe && side !== 'back') return mane(s + 30, y);
      const c = hide(s + 160, y);
      return y === fringe ? k(c, 0.75) : y >= 8 ? k(c, 0.85) : c;
    },
    (x, y) => mane(x + 60, y + 30, x > 2 && x < 7 ? 0.08 : -0.05),
    (x, y) => k(hide(x + 180, y), 0.7),
  );

  // ---- body (8 x 9 x 12): a shaggy dark mane stripe along the spine
  const body = boxUV(o, 0, 26, 8, 9, 12);
  box(
    a,
    body,
    (s, y, side, x) => {
      const fringe = 3 + Math.floor(hash2(s, 5, maneSeed) * 3) + (side === 'front' ? 3 : 0);
      if (y < fringe) {
        const c = mane(s + 80, y);
        return y === fringe - 1 ? k(c, 0.8) : c;
      }
      let c = hide(s + 200, y + 40);
      if (y === fringe) c = k(c, 0.8);
      if (y >= 14) c = k(c, 0.86); // belly shadow
      if ((side === 'right' || side === 'left') && y > 6 && y < 14 && (x + (y >> 2)) % 7 === 0) c = k(c, 0.85); // ribs under the hide
      if (side === 'front' && y >= 10 && y <= 13 && x > 3 && x < 12) c = mixc(c, MUZZLE, 0.25); // chest
      return c;
    },
    (x, y) => {
      const ridge = Math.abs(x - 7.5) - (hash2(y, 0, maneSeed + 2) * 2.4);
      if (ridge < 4.5) return mane(x + 120, y + 60, ridge < 1.5 ? 0.12 : 0);
      return k(hide(x + 240, y + 60), ridge < 5.5 ? 0.8 : 1.05);
    },
    (x, y) => k(hide(x + 260, y + 80, 0.1), 0.72),
  );

  // ---- leg (4 x 8 x 4): darker, hooves at the bottom
  const leg = boxUV(o, 40, 26, 4, 8, 4);
  box(
    a,
    leg,
    (s, y, side, x) => {
      const r = round(x, fw(leg, side));
      if (y >= 12) {
        let c = k(C('#2a2520'), grain(s, y, hideSeed + 5, 0.25));
        if (y === 12) c = C('#4a423a');
        if (side === 'front' && (x === 3 || x === 4)) c = k(c, 0.55); // cloven split
        if (y === 15) c = k(c, 0.7);
        return k(c, r);
      }
      let c = k(hide(s + 300, y), 0.82);
      if (y < 4) c = mixc(c, MANE[2]!, 0.4); // shaggy thigh
      if (y === 11) c = mixc(c, MANE[1]!, 0.6); // fetlock tuft
      return k(c, r);
    },
    (x, y) => k(hide(x + 340, y), 0.8),
    (x, y) => k(C(x === 3 || x === 4 ? '#14100e' : '#24201c'), grain(x, y, hideSeed + 6, 0.2)),
  );

  // ---- horn (6 x 2 x 2, long axis along x) and its upturned tip (2 x 4 x 2)
  const hornBox = boxUV(o, 40, 40, 6, 2, 2);
  const hornSide = (x: number, y: number, lift: number): RGB => {
    let c = horn(x, y);
    const end = Math.min(x, 11 - x);
    if (end < 2) c = mixc(c, HORN[1]!, 0.45 - end * 0.15); // darker towards both ends
    return k(c, lift);
  };
  paint(a, hornBox.top, (x, y) => hornSide(x, y, 1.1));
  paint(a, hornBox.front, (x, y) => hornSide(x, y + 4, y === 3 ? 0.85 : 1));
  paint(a, hornBox.back, (x, y) => hornSide(11 - x, y + 8, y === 3 ? 0.82 : 0.95));
  paint(a, hornBox.bottom, (x, y) => hornSide(x, y + 12, 0.78));
  paint(a, hornBox.right, (x, y) => k(horn(x + 30, y, -0.25), 0.85));
  paint(a, hornBox.left, (x, y) => k(horn(x + 40, y, -0.25), 0.8));
  const tipBox = boxUV(o, 56, 26, 2, 4, 2);
  box(
    a,
    tipBox,
    (s, y, _side, x) => k(mixc(horn(s + 70, y), '#4a4034', clamp(1 - y / 7, 0, 1) * 0.75), round(x, 4)),
    () => C('#3e352a'),
    (x, y) => horn(x + 90, y, 0.05),
  );
}

// ------------------------------------------------------------------ ghast

const GHAST = ['#bcbcbc', '#c8c8c8', '#d6d6d6', '#e2e2e2', '#ececec', '#f4f4f4'] as const;
const TEAR = '#8c9cb2';

function paintGhast(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const gSeed = sd();
  const skin = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 6, y / 6, gSeed);
    let c = ramp(GHAST, clamp(0.62 + bias + (n - 0.5) * 0.35 + (hash2(x, y, gSeed + 1) - 0.5) * 0.06, 0, 1));
    if (hash2(x, y, gSeed + 2) < 0.03) c = k(c, 0.86); // grey specks
    if (hash2(x >> 1, y >> 1, gSeed + 3) < 0.02) c = k(c, 0.9);
    return c;
  };

  // ---- body (16 x 16 x 16)
  const bodyB = boxUV(o, 0, 0, 16, 16, 16);
  box(
    a,
    bodyB,
    (s, y) => {
      let c = skin(s, y);
      if (y === 0) c = k(c, 1.03);
      if (y > 24) c = k(c, 1 - (y - 24) * 0.012); // shading toward the underside
      return c;
    },
    (x, y) => skin(x + 200, y + 100, 0.08),
    (x, y) => {
      let c = k(skin(x + 300, y + 100), 0.82);
      // Darker sockets where the nine tentacles hang.
      for (const tx of [5, 15, 25]) for (const ty of [5, 15, 25]) if (Math.abs(x - tx - 0.5) < 2.5 && Math.abs(y - ty - 0.5) < 2.5) c = k(c, 0.9);
      return c;
    },
  );
  // Calm face: closed, sorrowful eyes with grey-blue tear streaks and a small closed mouth.
  const cf = on(a, bodyB.front);
  const tears = (ff: ReturnType<typeof on>, xs: readonly number[], y0: number, y1: number): void => {
    for (const tx of xs) {
      for (let y = y0; y <= y1; y += 1) {
        const fade = (y - y0) / (y1 - y0);
        ff.mix(tx, y, TEAR, 0.75 - fade * 0.35);
        if ((y + tx) % 5 === 0) ff.mix(tx + 1, y, TEAR, 0.35); // drips spreading
      }
    }
  };
  for (const ex of [6, 20]) {
    cf.mulRect(ex - 1, 8, 8, 2, 0.92); // lids
    for (let i = 0; i < 6; i += 1) {
      const droop = ex === 6 ? (i === 0 ? 1 : 0) : i === 5 ? 1 : 0; // outer corners droop
      cf.set(ex + i, 11 + droop, '#3a3a3e');
      cf.set(ex + i, 12 + droop, '#6a6a70');
    }
  }
  tears(cf, [8, 23], 13, 26);
  cf.rect(13, 22, 6, 2, '#4a4a4e');
  cf.set(13, 22, '#6a6a6e');
  cf.set(18, 22, '#6a6a6e');
  cf.mulRect(13, 24, 6, 1, 0.9);

  // ---- tentacle (2 x 9 x 2)
  const tent = boxUV(o, 0, 32, 2, 9, 2);
  box(
    a,
    tent,
    (s, y, _side, x) => {
      let c = skin(s + 400, y, -0.02);
      c = k(c, 1 - (y / 18) * 0.28);
      if (y % 6 === 5) c = k(c, 0.9); // soft ring creases
      return k(c, round(x, 4));
    },
    (x, y) => k(skin(x + 450, y), 0.85),
    (x, y) => k(skin(x + 460, y), 0.62),
  );

  // ---- open face (16 x 16 x 1): only the front is used; the rest gets plain skin
  const open = boxUV(o, 0, 44, 16, 16, 1);
  box(
    a,
    open,
    (s, y) => skin(s + 500, y),
    (x, y) => skin(x + 520, y),
    (x, y) => skin(x + 540, y),
  );
  const of = open.front;
  paint(a, of, (x, y) => skin(x + 600, y));
  const ff = on(a, of);
  // Dark, angry eye sockets with burning red irises.
  for (const ex of [4, 19]) {
    for (let y = 7; y <= 13; y += 1) {
      for (let x = ex; x <= ex + 8; x += 1) {
        const lx = x - ex;
        const ly = y - 7;
        const slant = ex === 4 ? Math.floor(lx / 3) : Math.floor((8 - lx) / 3); // angry inner brows
        if (ly < 2 - slant) continue;
        if ((lx === 0 || lx === 8) && (ly === 0 || ly === 6)) continue;
        ff.set(x, y, ly === 2 - slant ? '#121214' : '#26262a');
      }
      ff.mul(ex - 1, y, 0.85);
      ff.mul(ex + 9, y, 0.85);
    }
    const ix = ex === 4 ? ex + 4 : ex + 2;
    for (let y = 9; y <= 11; y += 1) for (let x = ix; x <= ix + 2; x += 1) glowSet(a, of, x, y, y === 11 ? '#a01810' : '#e83420');
    glowSet(a, of, ix + 1, 10, '#ffd0a8');
    glowSet(a, of, ix + (ex === 4 ? 0 : 2), 9, '#ff7a52');
  }
  tears(ff, [6, 25], 14, 22);
  // Wide-open wailing mouth: dark rim, red throat.
  for (let y = 18; y <= 27; y += 1) {
    for (let x = 9; x <= 22; x += 1) {
      const u = (x - 15.5) / 7;
      const v = (y - 22.5) / 5;
      const d = u * u + v * v;
      if (d > 1.05) continue;
      if (d > 0.7) ff.set(x, y, '#1a1416');
      else {
        const deep = 1 - (y - 18) / 10;
        ff.set(x, y, mixc(C('#b02218'), '#3a0a08', deep * 0.8));
      }
    }
  }
  for (let x = 11; x <= 20; x += 1) ff.mul(x, 17, 0.85);
}

// ------------------------------------------------------------------ wither

const WITHER = ['#101010', '#151515', '#1d1d1d', '#262626', '#303030', '#3b3b3b', '#4c4c4c'] as const;

function paintWither(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const bSeed = sd();
  const cSeed = sd();
  const bone = (x: number, y: number, bias = 0): RGB => {
    const n = fbm2(x / 4, y / 4, bSeed);
    const c = ramp(WITHER, clamp(0.55 + bias + (n - 0.5) * 0.5 + (hash2(x, y, bSeed + 1) - 0.5) * 0.1, 0, 1));
    return crackAt(x, y, cSeed) ? mixc(c, '#76766f', 0.6) : c; // ash cracks
  };
  const edgeLift = (c: RGB, x: number, y: number, w: number, h: number): RGB => {
    if (y === 0) return mixc(c, '#8a8a86', 0.35); // grey edge highlight
    if (x === 0) return mixc(c, '#6a6a66', 0.2);
    if (y === h - 1 || x === w - 1) return k(c, 0.7);
    return c;
  };

  /** A skull: suture across the crown, deep sockets with pale cyan eyes, a grey row of teeth. */
  const skull = (b: BoxUV, n: number, off: number): void => {
    box(
      a,
      b,
      (s, y, side, x) => edgeLift(bone(s + off, y), x, y, fw(b, side), b.h),
      (x, y) => {
        let c = bone(x + off + 100, y, 0.06);
        const suture = Math.round(b.w / 2 - 0.5 + Math.sin(y * 1.6) * 0.8);
        if (x === suture && y > 2) c = mixc(c, '#76766f', 0.5);
        return c;
      },
      (x, y) => k(bone(x + off + 150, y), 0.6),
    );
    const fr = b.front;
    const f = on(a, fr);
    const big = n === 8;
    const sock = big ? 5 : 4;
    const sy = big ? 5 : 3;
    const lx = big ? 2 : 1;
    const rx = b.w - lx - sock;
    f.mixRect(0, sy - 1, b.w, 1, '#8a8a86', 0.25); // brow ridge
    for (const ex of [lx, rx]) {
      f.rect(ex, sy, sock, sock, '#060606');
      f.rect(ex, sy, sock, 1, '#000000');
      f.mulRect(ex - 1, sy + sock, sock + 2, 1, 0.75);
      // Pale cyan-white eyes deep in the socket: a bright 2 x 2 core in a blue rim.
      const cx = ex + (big && ex === lx ? 2 : 1);
      const cy = sy + 1;
      const rimPx: [number, number, string][] = [[cx - 1, cy, '#7ac0ff'], [cx - 1, cy + 1, '#5a9ae0'], [cx + 2, cy, '#7ac0ff'], [cx + 2, cy + 1, '#5a9ae0'], [cx, cy + 2, '#4a86cc'], [cx + 1, cy + 2, '#4a86cc'], [cx, cy - 1, '#3a6aa8'], [cx + 1, cy - 1, '#3a6aa8']];
      for (const [x, y, c] of rimPx) if (x >= ex && x < ex + sock && y > sy && y < sy + sock) glowSet(a, fr, x, y, c, 0.7);
      for (let y = cy; y <= cy + 1; y += 1) for (let x = cx; x <= cx + 1; x += 1) glowSet(a, fr, x, y, '#d8f4ff');
      glowSet(a, fr, cx, cy, '#ffffff');
    }
    // Nose hole.
    const nx = Math.floor(b.w / 2) - 1;
    const ny = sy + sock;
    f.rect(nx, ny, 2, 2, '#080808');
    f.mulRect(nx - 1, ny, 1, 2, 0.8);
    f.mulRect(nx + 2, ny, 1, 2, 0.8);
    // Teeth row.
    const ty = ny + 3;
    for (let x = big ? 2 : 1; x < b.w - (big ? 2 : 1); x += 1) {
      f.set(x, ty, (x & 1) === 0 ? '#8e8e88' : '#6a6a64');
      if (ty + 1 < b.h) f.set(x, ty + 1, (x & 1) === 0 ? '#5a5a56' : '#0a0a0a');
      if (ty - 1 >= 0 && (x & 1) === 1) f.set(x, ty - 1, '#0a0a0a');
    }
  };
  skull(boxUV(o, 0, 0, 8, 8, 8), 8, 0);
  skull(boxUV(o, 32, 0, 6, 6, 6), 6, 400);

  /** Dark bones with vertebra segments every `seg` texels along `along`. */
  const boneBar = (b: BoxUV, off: number, segLen: number, alongX: boolean): void => {
    const shade = (x: number, y: number, w: number, h: number, salt: number): RGB => {
      let c = bone(x + off + salt, y + salt);
      const p = (alongX ? x : y) % segLen;
      if (p === 0) c = k(c, 0.55); // joint gap
      else if (p === 1) c = mixc(c, '#7a7a74', 0.3); // knob highlight
      return edgeLift(c, x, y, w, h);
    };
    paintSides(a, b, (s, y, side, x) => shade(alongX ? x : s, y, fw(b, side), b.h, side === 'back' ? 30 : 0));
    paint(a, b.top, (x, y) => k(shade(x, y, b.w, b.d, 60), 1.08));
    paint(a, b.bottom, (x, y) => k(shade(x, y, b.w, b.d, 90), 0.62));
  };
  boneBar(boxUV(o, 0, 16, 20, 3, 3), 800, 8, true);
  boneBar(boxUV(o, 0, 22, 3, 10, 3), 900, 4, false);
  boneBar(boxUV(o, 12, 22, 11, 2, 2), 1000, 6, true);
  boneBar(boxUV(o, 38, 22, 3, 6, 3), 1100, 4, false);
  // The tail darkens to its tip.
  const tail = boxUV(o, 38, 22, 3, 6, 3);
  paintSides(a, tail, (s, y, side, x) => {
    const c = bone(s + 1200, y);
    const p = y % 4;
    return k(edgeLift(p === 0 ? k(c, 0.55) : p === 1 ? mixc(c, '#7a7a74', 0.3) : c, x, y, fw(tail, side), tail.h), 1 - y * 0.025);
  });
}

// ------------------------------------------------------------------ zombie villager

const ZV_SKIN = ['#2c4f22', '#3f6c30', '#548a3f', '#6ba24f', '#86b965'] as const;
const ZV_ROBE = ['#2e1f15', '#45301f', '#5c4029', '#735134', '#88623f'] as const;
const ZV_TROUSERS = ['#261a12', '#35261a', '#463324', '#57412e', '#684f38'] as const;
const ZV_TEARS: readonly Tear[] = [[11, 8, 2.2, 1.8], [20, 15, 1.6, 2.4], [30, 6, 1.6, 1.8], [40, 12, 2.4, 1.8], [45, 4, 1.2, 1.4], [5, 17, 1.4, 1.2]];

function paintZombieVillager(a: Pix, o: O, seed: number): void {
  const sd = seeder(seed);
  const skinSeed = sd();
  const clothSeed = sd();
  const holeSeed = sd();
  const jagSeed = sd();
  const skin = (x: number, y: number, bias = 0): RGB => {
    let c = flesh(ZV_SKIN, x, y, skinSeed, 0.6, bias);
    const rot = fbm2(x / 3, y / 3, skinSeed + 9);
    if (rot > 0.66) c = mixc(c, '#3c4420', clamp((rot - 0.66) * 5, 0, 0.6));
    return c;
  };
  const robe = (s: number, y: number, fold = 0.12): RGB => cloth(ZV_ROBE, s, y, clothSeed, fold);

  // ---- head (8 x 10 x 8): bald green villager head
  const head = boxUV(o, 0, 0, 8, 10, 8);
  box(
    a,
    head,
    (s, y) => {
      let c = skin(s, y + 40);
      if (y >= 18) c = k(c, 0.86);
      if (y < 2) c = k(c, 0.96);
      return c;
    },
    (x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      return k(skin(x + 50, y + 50), 1.05 - d * 0.012);
    },
    (x, y) => k(skin(x + 80, y + 80), 0.7),
  );
  for (const r of [head.right, head.left]) {
    const e = on(a, r);
    e.mulRect(6, 9, 4, 6, 0.86);
    e.mulRect(7, 10, 2, 4, 0.8);
    e.mulRect(6, 9, 4, 1, 1.08);
  }
  const f = on(a, head.front);
  f.mulRect(4, 3, 8, 1, 0.9);
  for (let x = 2; x <= 13; x += 1) {
    f.mix(x, 6, '#16260f', x === 2 || x === 13 || hash2(x, 6, jagSeed) < 0.3 ? 0.5 : 0.85);
    f.set(x, 7, k(C('#18280f'), grain(x, 7, jagSeed, 0.25)));
  }
  // Sunken dark eyes with dull red-green pupils.
  f.mulRect(1, 8, 6, 4, 0.74);
  f.mulRect(9, 8, 6, 4, 0.74);
  for (const ex of [2, 10]) {
    f.rect(ex, 8, 4, 2, '#141c10');
    f.mulRect(ex, 10, 4, 1, 0.8);
  }
  f.rect(4, 8, 2, 2, '#6a2a1c');
  f.rect(10, 8, 2, 2, '#6a2a1c');
  f.set(4, 8, '#8a3a24');
  f.set(11, 8, '#8a3a24');
  f.set(5, 9, '#3e4a1e');
  f.set(10, 9, '#3e4a1e');
  f.mulRect(6, 8, 4, 4, 1.04);
  f.mulRect(6, 11, 4, 9, 0.84);
  f.mulRect(1, 12, 3, 4, 0.86); // hollow cheeks
  f.mulRect(12, 12, 3, 4, 0.86);
  // A slack, half-open mouth.
  f.rect(5, 17, 6, 2, '#152011');
  f.set(4, 17, '#203018');
  f.set(11, 17, '#203018');
  f.mix(6, 17, '#9a9a78', 0.5);
  f.mix(9, 17, '#9a9a78', 0.4);
  f.mulRect(0, 19, 16, 1, 0.84);
  f.mix(12, 3, '#3c4420', 0.5);
  f.mix(13, 4, '#3c4420', 0.4);

  // ---- nose (2 x 4 x 2)
  const nose = boxUV(o, 24, 0, 2, 4, 2);
  box(
    a,
    nose,
    (s, y, side, x) => {
      let c = skin(s + 120, y + 30, side === 'front' ? 0.02 : -0.06);
      if (side === 'front' && (x === 1 || x === 2) && y < 5) c = k(c, 1.06);
      if (side === 'front' && y === 7 && (x === 0 || x === 3)) c = k(c, 0.6);
      if (y === 7) c = k(c, 0.85);
      if (side === 'back') c = k(c, 0.8);
      return c;
    },
    (x, y) => skin(x + 140, y),
    (x, y) => k(skin(x + 150, y), (x === 0 || x === 3) && (y === 1 || y === 2) ? 0.5 : 0.75),
  );

  // ---- body (8 x 12 x 6): tattered brown robe over green skin
  const body = boxUV(o, 16, 20, 8, 12, 6);
  box(
    a,
    body,
    (s, y, side, x) => {
      if (side === 'front' && y < 4 && Math.abs(x - 7.5) < 4.5 - y) return k(skin(s, y), 0.9 - (3 - y) * 0.04);
      const hole = tearDist(s, y, ZV_TEARS, holeSeed);
      if (hole < 1) return k(skin(s, y + 7), 0.8 - (1 - hole) * 0.1);
      let c = robe(s, y, 0.13);
      if (hole < 1.4) c = k(c, 0.62 + (hole - 1) * 0.5);
      if (x === 0 || x === fw(body, side) - 1) c = k(c, 0.9);
      if (side === 'front' && y < 5 && Math.abs(x - 7.5) < 5.5 - y) c = k(c, 0.82);
      if (y >= 15 && y <= 16) {
        c = leather(['#1e140c', '#2c1e12', '#3a2818'], s, y, clothSeed + 4); // rope belt
        if (y === 16) c = k(c, 0.8);
      }
      if (y === 0) c = k(c, 1.1);
      if (y >= 22) c = k(c, y === 23 ? 0.7 : 0.85); // frayed hem
      if (y === 23 && hash2(s, y, jagSeed) < 0.4) c = k(skin(s, y), 0.7);
      return c;
    },
    (x, y) => k(robe(x, y + 60), 1.02),
    (x, y) => k(robe(x, y + 80), 0.62),
  );

  // ---- legs: torn brown trousers, bare green shins and feet
  const leg = boxUV(o, 0, 22, 4, 12, 4);
  box(
    a,
    leg,
    (s, y, side, x) => {
      const r = round(x, fw(leg, side));
      const hem = 15 + Math.floor(hash2(s >> 1, 2, jagSeed) * 3) + (hash2(s, 3, jagSeed) < 0.3 ? 1 : 0);
      if (y >= hem) {
        let c = skin(s + 60, y);
        if (y === hem) c = k(c, 0.72);
        if (y === 23) c = k(c, 0.8);
        if (side === 'front' && y >= 22 && (x === 1 || x === 3 || x === 5)) c = k(c, 0.85); // toes
        return k(c, r);
      }
      let c = cloth(ZV_TROUSERS, s, y, clothSeed + 5, 0.07);
      if (y < 2) c = k(c, 0.8);
      if (y === hem - 1) c = k(c, 0.82);
      const t = tearDist(s, y, [[12, 9, 1.8, 1.4], [3, 5, 1.2, 1.6]], holeSeed + 3);
      if (t < 1) c = k(skin(s, y), 0.78);
      else if (t < 1.35) c = k(c, 0.65);
      return k(c, r);
    },
    (x, y) => k(cloth(ZV_TROUSERS, x, y + 90, clothSeed + 5), 0.7),
    (x, y) => k(skin(x, y + 300), 0.6),
  );

  // ---- arms: ragged sleeves, green forearms and hands
  const arm = boxUV(o, 44, 22, 4, 12, 4);
  box(
    a,
    arm,
    (s, y, side, x) => {
      const r = round(x, fw(arm, side));
      const end = 8 + Math.floor(hash2(s >> 1, 4, jagSeed) * 3) + (hash2(s, 5, jagSeed) < 0.35 ? 1 : 0);
      if (y < end) {
        let c = robe(s + 30, y, 0.08);
        if (y === end - 1) c = k(c, 0.72);
        if (y < 2) c = k(c, 1.06);
        if (tearDist(s, y, [[5, 4, 1.2, 1.2]], holeSeed + 5) < 1) c = k(skin(s, y), 0.8);
        return k(c, r);
      }
      let c = skin(s, y + 70);
      if (y === end) c = k(c, 0.78);
      if (side === 'front' && y === 21 && (x === 1 || x === 3 || x === 5)) c = k(c, 1.12);
      if (y === 23) c = k(c, 0.85);
      return k(c, r);
    },
    (x, y) => k(robe(x + 80, y), 0.98),
    (x, y) => k(skin(x, y + 120), x === 2 || x === 4 || x === 6 ? 0.76 : 0.88),
  );
}

// ------------------------------------------------------------------ tiles

/** Charged-creeper / Wither armour overlay: electric swirls, periodic every 16 texels. */
function paintCharge(p: Pix): void {
  clearAll(p);
  const lo = hex('#7fd4ff');
  const hi = hex('#e8fbff');
  each((x, y) => {
    const u = ((x + y) / 16) * TAU;
    const w = ((x - y) / 16) * TAU;
    const v = Math.sin(u + 0.9 * Math.sin(w) + 0.35 * Math.sin(2 * w + 1.3));
    if (v < 0.25) return;
    const t = (v - 0.25) / 0.75;
    p.set(x, y, lerpRGB(lo, hi, t * t), Math.round(150 + 105 * t));
    p.E(x, y, 1);
  });
}

const BANNER_FIELD = ['#bdb8ac', '#d2cdc1', '#e2ddd2', '#ece8de', '#f4f1e9'];
const BANNER_GREY = ['#5e625e', '#727772', '#868b86', '#9a9f99', '#aeb2ac'];
const BANNER_CYAN = ['#0e5e66', '#167880', '#1f9098', '#2ea8ae', '#4ac2c4'];

/** The ominous illager banner: cyan lozenge, a black band and a grey illager face on off-white. */
function paintOminousBanner(p: Pix, rng: Rng): void {
  const s0 = Math.floor(rng() * 100000);
  const weave = (x: number, y: number): number => (fbm2(x / 5, y / 5, s0) - 0.5) * 0.25 + (hash2(x, y, s0 + 1) - 0.5) * 0.12 + ((x + y) & 1 ? 0.03 : -0.03);
  each((x, y) => {
    const n = weave(x, y);
    const e = edgeOf(x, y, 32, 32);
    let c: string;
    if (e === 0) c = tone(['#141416', '#1e1e22', '#28282c'], 0.5 + n);
    else if (e === 1) c = tone(BANNER_GREY, 0.75 + n);
    else c = tone(BANNER_FIELD, 0.62 + n - (y > 26 ? 0.1 : 0));
    // Cyan lozenge.
    const dd = Math.abs(x - 15.5) / 11 + Math.abs(y - 19.5) / 9;
    if (e > 1 && dd < 1) c = tone(BANNER_CYAN, (dd > 0.86 ? 0.2 : 0.6 - (y - 19.5) / 30) + n);
    // Light grey stripe near the foot.
    if (e > 1 && y >= 26 && y <= 28) c = tone(BANNER_GREY, 0.85 + n);
    // Black band across the middle.
    if (e > 1 && y >= 17 && y <= 19) c = tone(['#0e0e10', '#18181b', '#222226'], (y === 17 ? 0.85 : 0.4) + n);
    // The illager face above the band.
    const inHead = x >= 10 && x <= 21 && y >= 4 && y <= 16;
    if (inHead) {
      let t = 0.6 + n + (x < 12 ? 0.15 : x > 19 ? -0.15 : 0);
      if (y === 4) t += 0.15;
      c = tone(BANNER_GREY, t);
      if (y === 8 || y === 9) c = tone(['#0e0e10', '#1a1a1d'], 0.5 + n); // unibrow
      if (y === 10 || y === 11) {
        if (x === 11 || x === 12 || x === 19 || x === 20) c = '#d8d8d0'; // whites
        if (x === 13 || x === 18) c = '#1a2630'; // eyes
      }
      if ((x === 15 || x === 16) && y >= 10) c = tone(BANNER_GREY, (x === 15 ? 0.35 : 0.2) + n); // long nose
      if (y === 15 && x >= 12 && x <= 19 && x !== 15 && x !== 16) c = '#2a2c2a'; // grim mouth
    }
    p.set(x, y, c);
    p.H(x, y, 0.5 + n);
  });
}

const SLATE = ['#2b2f36', '#353a42', '#40464f', '#4c535d', '#5a616b', '#6a707a'];
const FANG = ['#8a7e64', '#a89c80', '#c4b99c', '#dcd2b6', '#ece4cc', '#f8f4e6'];

/** Evoker fangs from the side: a slate jaw plate with ivory teeth along the top. */
function paintFangs(p: Pix, rng: Rng): void {
  clearAll(p);
  const s0 = Math.floor(rng() * 100000);
  shapeFill(p, (x, y) => {
    if (y < 15) return null;
    const ex = Math.min(x, 32 - x);
    if (y > 27 && ex < (y - 27) * 1.2) return null; // rounded heel
    let t = 0.55 + (fbm2(x / 4, y / 4, s0) - 0.5) * 0.3 - (y - 15) * 0.012;
    if (y < 16.5) t += 0.3;
    if (Math.floor(y) === 21 || Math.floor(y) === 26) t -= 0.25; // plate ridges
    if (Math.floor(y) === 22) t += 0.12;
    if (ex < 1.5) t -= 0.2;
    return t;
  }, SLATE, 0.3);
  // Five hooked teeth.
  for (const cx of [3.5, 9.5, 15.5, 21.5, 27.5]) {
    shapeFill(p, (x, y) => {
      if (y >= 15.5 || y < 3) return null;
      const h = (15.5 - y) / 12.5; // 0 base .. 1 tip
      const half = 2.7 * (1 - h) + 0.2;
      const lean = h * h * 1.2;
      const dx = x - cx - lean;
      if (Math.abs(dx) > half) return null;
      return 0.55 + (dx < 0 ? 0.3 : -0.2) - (y > 13.5 ? 0.2 : 0);
    }, FANG, 0.4);
  }
}

/** The face of a black Wither skull projectile. */
function paintWitherSkull(p: Pix, rng: Rng): void {
  const s0 = Math.floor(rng() * 100000);
  each((x, y) => {
    let t = 0.55 + (fbm2(x / 4, y / 4, s0) - 0.5) * 0.4 + (hash2(x, y, s0 + 1) - 0.5) * 0.1 - (x + y) * 0.004;
    if (crackAt(x, y, s0 + 2, 0.022)) t = 0.95; // ash cracks
    const e = edgeOf(x, y, 32, 32);
    if (e === 0) t -= 0.2;
    p.set(x, y, tone([...WITHER, '#6a6a66'], t));
    p.H(x, y, 0.55);
  });
  const dark = (x: number, y: number, c = '#040404'): void => {
    p.set(x, y, c);
    p.H(x, y, 0.1);
  };
  // Eye sockets with a faint ember deep inside.
  for (const ex of [6, 18]) {
    for (let y = 9; y <= 16; y += 1) for (let x = ex; x <= ex + 7; x += 1) {
      if ((x === ex || x === ex + 7) && (y === 9 || y === 16)) continue;
      dark(x, y, y === 9 ? '#000000' : '#070707');
    }
    for (let x = ex; x <= ex + 7; x += 1) p.set(x, 17, tone(WITHER, 0.2));
    p.set(ex + 3, 13, '#3a0a06');
    p.set(ex + 4, 13, '#5a120a');
  }
  // Nose hole (an upside-down heart).
  for (const [x, y] of [[15, 19], [16, 19], [14, 20], [15, 20], [16, 20], [17, 20], [15, 21], [16, 21]] as const) dark(x, y);
  // Teeth.
  for (let x = 7; x <= 24; x += 1) {
    const tooth = (x - 7) % 3 !== 2;
    for (let y = 23; y <= 27; y += 1) {
      if (y === 25) dark(x, y);
      else if (tooth) p.set(x, y, tone(['#4a4a46', '#6a6a64', '#8e8e88'], y === 23 || y === 26 ? 0.8 : 0.4));
      else dark(x, y, '#0a0a0a');
    }
  }
}

const OBSIDIAN = ['#0c0814', '#140d20', '#1c132c', '#261b3a', '#32244a', '#43325e'];
const GLASS = ['#7ab6c4', '#98ccd8', '#b4dee6', '#cceef2', '#e2f8fa', '#f6feff'];

/** Beacon: glass shell, obsidian base (side only) and a glowing star core. */
function paintBeacon(p: Pix, rng: Rng, top: boolean): void {
  const s0 = Math.floor(rng() * 100000);
  each((x, y) => {
    const e = edgeOf(x, y, 32, 32);
    let c: RGB;
    let spec = 0.8;
    if (e < 2) {
      c = hex(tone(GLASS, x === 0 || y === 0 || (e === 1 && (x === 1 || y === 1)) ? 0.98 : e === 0 ? 0.35 : 0.65)); // frame edges
    } else if (!top && y >= 22) {
      const n = fbm2(x / 4, y / 3, s0);
      c = hex(tone(OBSIDIAN, 0.4 + (n - 0.5) * 0.8 + (y === 22 ? 0.3 : 0)));
      spec = 0.5;
    } else {
      // Clear glass: pale cyan with diagonal glints.
      const streak = (x + y) % 13;
      c = hex(tone(GLASS, 0.5 + (fbm2(x / 6, y / 6, s0 + 1) - 0.5) * 0.2 + (streak < 1 ? 0.25 : streak < 2 ? 0.12 : 0)));
    }
    p.set(x, y, c);
    p.S(x, y, spec);
    p.H(x, y, e < 2 ? 0.75 : 0.5);
  });
  // The star core.
  const cx = 15.5;
  const cy = top ? 15.5 : 13.5;
  const R = top ? 10 : 8.5;
  each((x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const star = R * (0.3 + 0.7 * Math.pow(Math.abs(Math.cos(2 * ang)), 6));
    const disc = R * 0.42;
    const v = Math.max(1 - r / star, 1 - r / disc);
    if (v <= 0) return;
    const c = v > 0.55 ? '#ffffff' : v > 0.3 ? '#c8fbff' : '#7ae6f5';
    p.set(x, y, c);
    p.E(x, y, v > 0.12 ? 1 : 0.6);
    p.H(x, y, 0.6);
  });
}

// ------------------------------------------------------------------ item icons

const PEARL = ['#03161a', '#062a28', '#0a3e38', '#105448', '#18705e', '#2a9078', '#5ac0a8', '#b8f0e2'];
const CORK = ['#4a2e14', '#6a441e', '#8a5c2c', '#a8763c', '#c4924e'];
const BOTTLE = ['#6e8ea0', '#8eacbc', '#b0c8d4', '#d0e2ea', '#ecf6fa', '#ffffff'];
const HEAL = ['#4a0620', '#7a0e34', '#a8184a', '#d02a5e', '#ee4e7a', '#ff86a6', '#ffc8d6'];
const SPLASH = ['#6a6a72', '#86868e', '#a4a4ac', '#c2c2ca', '#dcdce2', '#f4f4f8'];
const TOTEM = ['#5e3a06', '#8a5a0e', '#b07c18', '#d49e2a', '#ecc040', '#ffe27a', '#fff4c0'];
const STAR = ['#8a7eb0', '#b0a6d4', '#d4ccec', '#ece6f8', '#fff8dc', '#ffffff'];

/** Lit sphere tone: top-left light, darker rim. */
function sphereTone(x: number, y: number, cx: number, cy: number, R: number): number | null {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r > R) return null;
  const nz = Math.sqrt(Math.max(0, 1 - (r / R) ** 2));
  return clamp01((-dx * 0.5 - dy * 0.6) / R + nz * 0.6) * 0.85;
}

function paintPearl(p: Pix): void {
  clearAll(p);
  const cx = 15.5;
  const cy = 16.5;
  const R = 10.5;
  shapeFill(p, (x, y) => {
    const t = sphereTone(x, y, cx, cy, R);
    if (t === null) return null;
    // A lighter cyan swirl winding into the centre.
    const r = Math.hypot(x - cx, y - cy);
    const a = Math.atan2(y - cy, x - cx);
    const sw = Math.sin(a * 1 + r * 0.55);
    return t * 0.75 + (sw > 0.75 ? 0.28 : sw > 0.55 ? 0.12 : 0);
  }, PEARL, 0.7);
  for (const [x, y, c] of [[10, 10, PEARL[7]], [11, 10, '#ffffff'], [10, 11, PEARL[7]], [12, 11, PEARL[6]], [11, 12, PEARL[6]]] as const) {
    p.set(x, y, c!);
    p.S(x, y, 1);
  }
  outline(p, 0.45);
}

/** A glass flask: cork, neck, a round body filled with `liquid`. */
function flask(p: Pix, liquid: readonly string[], splash: boolean): void {
  clearAll(p);
  const cx = 15.5;
  const cy = splash ? 19.5 : 20.5;
  const R = splash ? 9.8 : 8.6;
  const neckTop = splash ? 7 : 5;
  const surface = splash ? 13.5 : 15.5;
  // Body.
  shapeFill(p, (x, y) => {
    const t = sphereTone(x, y, cx, cy, R);
    if (t === null) return null;
    return Math.hypot(x - cx, y - cy) > R - 1.1 ? null : t;
  }, liquid, 0.4);
  // Glass rim and the air above the liquid.
  each((x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    const r = Math.hypot(px - cx, py - cy);
    const inBody = r <= R;
    const inNeck = Math.abs(px - cx) < 2.6 && py >= neckTop && py < cy - R + 2;
    if (!inBody && !inNeck) return;
    const rimGlass = (inBody && r > R - 1.1) || (inNeck && Math.abs(px - cx) > 1.6);
    if (rimGlass) p.set(x, y, tone(BOTTLE, px < cx ? 0.75 : 0.35));
    else if (py < surface) p.set(x, y, tone(BOTTLE, 0.55 + (px < cx ? 0.1 : -0.1)));
    else if (Math.floor(py) === Math.floor(surface)) p.set(x, y, tone(liquid, 0.95)); // meniscus
    p.S(x, y, 0.9);
  });
  // Cork.
  shapeFill(p, (x, y) => (Math.abs(x - cx) < 2.2 && y >= neckTop - 3 && y < neckTop + 1 ? 0.55 + (x < cx ? 0.2 : -0.15) + (y < neckTop - 2 ? 0.15 : 0) : null), CORK);
  // Highlight streak on the glass.
  for (const [x, y] of splash ? [[10, 15], [9, 16], [9, 17], [9, 18], [10, 23]] as const : [[11, 16], [10, 17], [10, 18], [10, 19], [11, 24]] as const) {
    p.set(x, y, '#ffffff');
    p.S(x, y, 1);
  }
  outline(p, 0.4);
}

function paintTotem(p: Pix): void {
  clearAll(p);
  // Wing-arms flaring out from the shoulders.
  shapeFill(p, (x, y) => {
    const dx = Math.abs(x - 15.5);
    if (dx < 3 || dx > 13) return null;
    const top = 12 + (dx - 3) * 0.35;
    const bottom = 16 + (dx - 3) * 0.55 - (dx > 10 ? (dx - 10) * 1.6 : 0);
    if (y < top || y > bottom) return null;
    const feather = Math.floor(dx) % 3 === 0 ? -0.15 : 0;
    return 0.6 + (y < top + 1.2 ? 0.25 : 0) + feather - (x > 15.5 ? 0.1 : 0);
  }, TOTEM, 0.75);
  // Skirt body.
  shapeFill(p, (x, y) => {
    if (y < 12 || y > 28) return null;
    const half = 3.2 + (y - 12) * 0.3;
    const dx = x - 15.5;
    if (Math.abs(dx) > half) return null;
    let t = 0.6 - dx / (half * 3);
    if (Math.floor(y) === 18) t -= 0.25; // belt
    if (Math.floor(y) === 17) t += 0.15;
    if (y > 19 && Math.floor(x + 0.5) % 3 === 0) t -= 0.12; // skirt pleats
    if (y > 27) t -= 0.2;
    return t;
  }, TOTEM, 0.75);
  // Round head.
  shapeFill(p, (x, y) => {
    const t = sphereTone(x, y, 15.5, 7.5, 5.4);
    return t === null ? null : 0.25 + t * 0.85;
  }, TOTEM, 0.8);
  // Emerald eyes and a little mouth.
  for (const ex of [13, 17]) {
    p.set(ex, 7, '#2ad46a');
    p.set(ex + 1, 7, '#14904a');
    p.set(ex, 8, '#0e7a3c');
    p.set(ex + 1, 8, '#0a5a2c');
    for (const dx of [0, 1]) for (const dy of [7, 8]) p.E(ex + dx, dy, 0.35);
  }
  p.set(15, 10, TOTEM[1]!);
  p.set(16, 10, TOTEM[1]!);
  // An emerald on the chest.
  p.set(15, 14, '#3ae07a');
  p.set(16, 14, '#14a04e');
  p.set(15, 15, '#14a04e');
  p.set(16, 15, '#0a6a34');
  outline(p, 0.4);
}

function paintNetherStar(p: Pix): void {
  clearAll(p);
  const cx = 15.5;
  const cy = 15.5;
  each((x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const R = 13.5 * (0.22 + 0.78 * Math.pow(Math.abs(Math.cos(2 * ang)), 10)); // four sharp points
    if (r > Math.max(R, 4.2)) return;
    const v = 1 - r / Math.max(R, 4.2);
    // White core, pale yellow body, pale lavender toward the facets in shadow.
    const shadowSide = (dx > 0 && Math.abs(dx) > Math.abs(dy)) || (dy > 0 && Math.abs(dy) >= Math.abs(dx)) ? (dx + dy > 0 ? 1 : 0) : 0;
    const t = r < 3 ? 1 : 0.45 + v * 0.5 - shadowSide * 0.3;
    p.set(x, y, tone(STAR, t));
    p.E(x, y, r < 3.5 ? 1 : r < 6 ? 0.6 : 0.25);
    p.S(x, y, 0.8);
    p.H(x, y, 0.5 + v * 0.4);
  });
  outline(p, 0.5);
}

function paintAxe(p: Pix): void {
  clearAll(p);
  stick(p, 5, 28, 25, 8, 1.2, HANDLE);
  const hx = 19;
  const hy = 14;
  shapeFill(p, (x, y) => {
    const dx = x - hx;
    const dy = y - hy;
    const v = (dx - dy) / Math.SQRT2; // along the handle (+ toward the top-right)
    const u = (-dx - dy) / Math.SQRT2; // across it (+ toward the top-left, the blade)
    if (u < -3) return null;
    const grow = u < 0 ? 2.3 : 2.3 + u * 0.62;
    const top = Math.min(6, grow); // the blade flares mostly downward into a bearded edge
    const bottom = Math.min(8, grow * 1.15);
    if (v > top || v < -bottom) return null;
    const edgeAt = 10 - ((v + 1) * (v + 1)) / 18; // convex cutting edge
    if (u > edgeAt) return null;
    let t = 0.5 + v / 14 + (u > 1 ? (u - 1) * 0.015 : 0);
    if (v > top - 1) t += 0.18; // lit upper rim
    if (v < -bottom + 1) t -= 0.15;
    if (u > edgeAt - 1.3) t = 0.92 + (v > 0 ? 0.08 : -0.06); // honed edge
    else if (u > edgeAt - 2.3) t -= 0.12; // bevel line
    if (Math.abs(u) < 1 && Math.abs(v) < 1.4) t = 0.12; // the eye round the haft
    if (u < -2) t -= 0.2; // butt
    return t;
  }, ITEM_IRON, 0.75);
  outline(p);
}

// ------------------------------------------------------------------ install

/** Paints the new mob sheets into the skin atlas. */
function paintMobSkins(atlas: Pix, origin: (name: string) => [number, number]): void {
  paintEnderman(atlas, origin('enderman'), 10007);
  paintWitch(atlas, origin('witch'), 10009);
  paintSlime(atlas, origin('slime'), 10037);
  paintIllager(atlas, origin('pillager'), 'pillager', 10039);
  paintIllager(atlas, origin('vindicator'), 'vindicator', 10061);
  paintEvoker(atlas, origin('evoker'), 10067);
  paintVex(atlas, origin('vex'), 10069);
  paintCaveSpider(atlas, origin('cavespider'), 10079);
  paintStray(atlas, origin('stray'), 10091);
  paintWitherSkeleton(atlas, origin('witherskel'), 10093);
  paintArmor(atlas, origin('armor'), 10099);
  paintRavager(atlas, origin('ravager'), 10103);
  paintGhast(atlas, origin('ghast'), 10111);
  paintWither(atlas, origin('wither'), 10133);
  paintZombieVillager(atlas, origin('zvillager'), 10139);
}

function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/** Registers the new mob sheets and the 32x32 tiles and item icons the new monsters use. */
export function installMobPainters(): void {
  registerSkins(paintMobSkins);
  const r = (name: string, painter: (p: Pix, rng: Rng) => void): void => register(name, painter, seedOf(name));
  r('charge', paintCharge);
  r('banner_ominous', paintOminousBanner);
  r('fangs', paintFangs);
  r('wither_skull', paintWitherSkull);
  r('beacon_side', (p, rng) => paintBeacon(p, rng, false));
  r('beacon_top', (p, rng) => paintBeacon(p, rng, true));
  r('pearl_item', paintPearl);
  r('potion_item', (p) => flask(p, HEAL, false));
  r('splash_item', (p) => flask(p, SPLASH, true));
  r('totem_item', paintTotem);
  r('netherstar_item', paintNetherStar);
  r('axe_item', paintAxe);
}
