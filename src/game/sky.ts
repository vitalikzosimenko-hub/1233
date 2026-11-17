// Time-of-day atmosphere: sun and moon, sky gradient, light colours, clouds, haze and grading,
// interpolated between hand-tuned keyframes of the sun's elevation (all colours linear HDR).
import type { Vec3 } from './math3d';
import { clamp } from './rng';

export interface Env {
  /** 0..1 day cycle: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight. */
  clock: number;
  sunDir: Vec3;
  /** Direction towards the light that casts shadows (sun by day, moon by night). */
  lightDir: Vec3;
  sunY: number;
  daylight: number;
  sunset: number;
  night: number;
  zenith: Vec3;
  horizon: Vec3;
  glow: Vec3;
  sunCol: Vec3;
  skyAmb: Vec3;
  groundAmb: Vec3;
  sunTint: Vec3;
  moonTint: Vec3;
  stars: number;
  cloudLit: Vec3;
  cloudShade: Vec3;
  cloudCover: number;
  fogDensity: number;
  exposure: number;
  glowStrength: number;
  bloom: number;
  rays: number;
  raysCol: Vec3;
  lift: Vec3;
  gain: Vec3;
  saturation: number;
  shadows: boolean;
  /** Colour the fog leans towards (weather), and how far. */
  fogTint: Vec3;
  fogTintAmt: number;
}

interface Key {
  y: number;
  zenith: Vec3;
  horizon: Vec3;
  glow: Vec3;
  sun: Vec3;
  skyAmb: Vec3;
  groundAmb: Vec3;
  cloudLit: Vec3;
  cloudShade: Vec3;
  fog: number;
  exposure: number;
  glowK: number;
  bloom: number;
  rays: number;
  lift: Vec3;
  gain: Vec3;
}

const KEYS: Key[] = [
  {
    y: -0.4,
    zenith: [0.003, 0.006, 0.018], horizon: [0.012, 0.02, 0.045], glow: [0.02, 0.03, 0.06],
    sun: [0.11, 0.15, 0.26], skyAmb: [0.035, 0.05, 0.095], groundAmb: [0.012, 0.016, 0.026],
    cloudLit: [0.045, 0.055, 0.085], cloudShade: [0.012, 0.016, 0.028],
    fog: 0.0016, exposure: 2.1, glowK: 2.4, bloom: 0.16, rays: 0,
    lift: [0.004, 0.008, 0.022], gain: [0.95, 1.0, 1.08],
  },
  {
    y: -0.1,
    zenith: [0.015, 0.02, 0.08], horizon: [0.16, 0.08, 0.14], glow: [0.4, 0.13, 0.08],
    sun: [0.03, 0.025, 0.04], skyAmb: [0.1, 0.085, 0.16], groundAmb: [0.035, 0.025, 0.035],
    cloudLit: [0.36, 0.13, 0.14], cloudShade: [0.05, 0.04, 0.07],
    fog: 0.0024, exposure: 1.6, glowK: 2.4, bloom: 0.14, rays: 0.1,
    lift: [0.012, 0.006, 0.02], gain: [1.04, 0.98, 1.0],
  },
  {
    y: 0.02,
    zenith: [0.05, 0.06, 0.22], horizon: [0.62, 0.26, 0.24], glow: [1.5, 0.5, 0.16],
    sun: [2.5, 1.05, 0.34], skyAmb: [0.3, 0.22, 0.36], groundAmb: [0.2, 0.11, 0.08],
    cloudLit: [2.4, 0.95, 0.42], cloudShade: [0.2, 0.11, 0.24],
    fog: 0.0024, exposure: 1.12, glowK: 2.2, bloom: 0.12, rays: 0.85,
    lift: [0.016, 0.006, 0.02], gain: [1.08, 1.0, 0.93],
  },
  {
    y: 0.17,
    zenith: [0.07, 0.15, 0.45], horizon: [0.7, 0.46, 0.36], glow: [1.3, 0.7, 0.3],
    sun: [3.3, 2.05, 0.95], skyAmb: [0.34, 0.36, 0.56], groundAmb: [0.24, 0.17, 0.1],
    cloudLit: [2.2, 1.3, 0.72], cloudShade: [0.24, 0.2, 0.34],
    fog: 0.002, exposure: 1.0, glowK: 2.0, bloom: 0.1, rays: 0.65,
    lift: [0.01, 0.006, 0.012], gain: [1.06, 1.0, 0.94],
  },
  {
    y: 0.55,
    zenith: [0.08, 0.22, 0.66], horizon: [0.5, 0.64, 0.86], glow: [0.8, 0.72, 0.56],
    sun: [3.3, 3.05, 2.6], skyAmb: [0.42, 0.54, 0.86], groundAmb: [0.26, 0.23, 0.18],
    cloudLit: [1.9, 1.9, 1.95], cloudShade: [0.6, 0.66, 0.78],
    fog: 0.0013, exposure: 0.86, glowK: 1.6, bloom: 0.07, rays: 0.2,
    lift: [0.004, 0.004, 0.008], gain: [1.02, 1.0, 0.98],
  },
];

function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smooth(e0: number, e1: number, v: number): number {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Direction to the sun for a day-cycle clock: rises in -x, sets along +x down the valley. */
export function sunDirection(clock: number): Vec3 {
  const a = clock * Math.PI * 2;
  const x = -Math.cos(a);
  const y = Math.sin(a) * 0.82;
  const z = 0.34;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

export function environment(clock: number): Env {
  const sunDir = sunDirection(clock);
  const sy = sunDir[1];
  // Keyframe blend on the sun's height.
  let k0 = KEYS[0]!;
  let k1 = KEYS[0]!;
  let t = 0;
  if (sy <= KEYS[0]!.y) {
    t = 0;
  } else if (sy >= KEYS[KEYS.length - 1]!.y) {
    k0 = KEYS[KEYS.length - 1]!;
    k1 = k0;
  } else {
    for (let i = 0; i < KEYS.length - 1; i += 1) {
      if (sy >= KEYS[i]!.y && sy <= KEYS[i + 1]!.y) {
        k0 = KEYS[i]!;
        k1 = KEYS[i + 1]!;
        t = smooth(0, 1, (sy - k0.y) / (k1.y - k0.y));
        break;
      }
    }
  }
  const m = (a: Vec3, b: Vec3): Vec3 => mix3(a, b, t);
  const n = (a: number, b: number): number => a + (b - a) * t;
  const daylight = smooth(-0.1, 0.25, sy);
  const sunset = sy > -0.3 ? 1 - smooth(0.0, 0.32, Math.abs(sy)) : 0;
  const night = 1 - smooth(-0.32, -0.04, sy);
  // The sun lights the world above the horizon, the moon below it; both fade near the swap.
  const sunUp = sy > -0.03;
  const lightDir: Vec3 = sunUp ? sunDir : [-sunDir[0], -sunDir[1], -sunDir[2]];
  const fade = sunUp ? smooth(-0.03, 0.06, sy) : smooth(0.05, 0.22, -sy);
  const sunCol = mix3([0, 0, 0], m(k0.sun, k1.sun), fade);
  return {
    clock,
    sunDir,
    lightDir,
    sunY: sy,
    daylight,
    sunset,
    night,
    zenith: m(k0.zenith, k1.zenith),
    horizon: m(k0.horizon, k1.horizon),
    glow: mix3(m(k0.glow, k1.glow), [0, 0, 0], smooth(-0.15, -0.35, sy)),
    sunCol,
    skyAmb: m(k0.skyAmb, k1.skyAmb),
    groundAmb: m(k0.groundAmb, k1.groundAmb),
    sunTint: mix3([1, 0.55, 0.22], [1, 0.95, 0.86], smooth(0.02, 0.3, sy)),
    moonTint: mix3([0, 0, 0], [0.86, 0.9, 1], smooth(0.0, 0.15, -sy)),
    stars: 1 - smooth(-0.22, -0.02, sy),
    cloudLit: m(k0.cloudLit, k1.cloudLit),
    cloudShade: m(k0.cloudShade, k1.cloudShade),
    cloudCover: 0.44,
    fogDensity: n(k0.fog, k1.fog),
    exposure: n(k0.exposure, k1.exposure),
    glowStrength: n(k0.glowK, k1.glowK),
    bloom: n(k0.bloom, k1.bloom),
    rays: sunUp ? n(k0.rays, k1.rays) * smooth(-0.02, 0.05, sy) : 0,
    raysCol: mix3([1, 0.62, 0.32], [1, 0.92, 0.8], smooth(0.05, 0.4, sy)),
    lift: m(k0.lift, k1.lift),
    gain: m(k0.gain, k1.gain),
    saturation: 1.08 + sunset * 0.06,
    shadows: fade > 0.08,
    fogTint: [0, 0, 0],
    fogTintAmt: 0,
  };
}

/**
 * Weather over the time of day: a storm greys and darkens the sky under heavy cloud and thick
 * haze; a blood moon stains the moon, the night light and the fog red; lightning flashes it all.
 */
export function applyWeather(env: Env, w: { storm: number; blood: number; flash: number; dark?: number }, r: RegionAir = NO_AIR): Env {
  const s = clamp(w.storm, 0, 1);
  const b = clamp(w.blood, 0, 1);
  const f = clamp(w.flash, 0, 1);
  if (r.desert > 0.001 || r.snow > 0.001 || r.blight > 0.001 || r.swamp > 0.001 || r.badlands > 0.001 || r.ember > 0.001) env = regionAir(env, r);
  if ((w.dark ?? 0) > 0.001) env = bossDark(env, clamp(w.dark ?? 0, 0, 1));
  if (s < 0.001 && b < 0.001 && f < 0.001) return env;
  const grey = (c: Vec3, k: number): Vec3 => {
    const l = (c[0] + c[1] + c[2]) / 3;
    return mix3(c, [l * k, l * k, l * k * 1.08], s);
  };
  const add = (c: Vec3, d: Vec3, k: number): Vec3 => [c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k];
  const tint = (c: Vec3, t: Vec3, k: number): Vec3 => mix3(c, [c[0] * t[0], c[1] * t[1], c[2] * t[2]], k);
  let zenith = grey(env.zenith, 0.55);
  let horizon = grey(env.horizon, 0.6);
  let skyAmb = grey(env.skyAmb, 0.75);
  let sunCol: Vec3 = [env.sunCol[0] * (1 - 0.72 * s), env.sunCol[1] * (1 - 0.72 * s), env.sunCol[2] * (1 - 0.72 * s)];
  // Blood moon: red light from a red moon.
  zenith = add(tint(zenith, [1.5, 0.5, 0.45], b), [0.012, 0, 0], b);
  horizon = add(tint(horizon, [1.8, 0.45, 0.4], b), [0.05, 0.004, 0.004], b);
  skyAmb = tint(skyAmb, [1.7, 0.5, 0.45], b);
  sunCol = tint(sunCol, [1.6, 0.42, 0.36], b * env.night);
  // Lightning lights the whole sky for an instant.
  zenith = add(zenith, [0.25, 0.3, 0.45], f);
  horizon = add(horizon, [0.35, 0.4, 0.55], f);
  skyAmb = add(skyAmb, [0.55, 0.62, 0.9], f);
  return {
    ...env,
    zenith,
    horizon,
    skyAmb,
    sunCol,
    glow: [env.glow[0] * (1 - 0.8 * s) + 0.04 * b, env.glow[1] * (1 - 0.8 * s), env.glow[2] * (1 - 0.8 * s)],
    groundAmb: tint(grey(env.groundAmb, 0.8), [1.5, 0.55, 0.5], b),
    moonTint: mix3([env.moonTint[0] * (1 - 0.85 * s), env.moonTint[1] * (1 - 0.85 * s), env.moonTint[2] * (1 - 0.85 * s)], [1.5, 0.2, 0.12], b * (1 - s)),
    stars: env.stars * (1 - s) * (1 - 0.5 * b),
    cloudLit: [env.cloudLit[0] * (1 - 0.6 * s) + 0.02 * f, env.cloudLit[1] * (1 - 0.6 * s) + 0.02 * f, env.cloudLit[2] * (1 - 0.55 * s) + 0.03 * f],
    cloudShade: grey(env.cloudShade, 0.7),
    cloudCover: env.cloudCover + (0.92 - env.cloudCover) * s,
    fogDensity: env.fogDensity * (1 + 1.6 * s + 0.6 * b),
    rays: env.rays * (1 - s),
    shadows: env.shadows && s < 0.55,
    fogTint: env.fogTintAmt > Math.max(0.35 * b, 0.4 * s) ? env.fogTint : b > s ? [0.05, 0.004, 0.004] : [0.018, 0.022, 0.028],
    fogTintAmt: Math.max(env.fogTintAmt, 0.35 * b, 0.4 * s),
  };
}

/**
 * A boss that darkens the sky (the Wither, as in Minecraft): the stars go out, the moon dims and
 * an ashen violet murk closes in.
 */
function bossDark(env: Env, k: number): Env {
  const dim = (c: Vec3, amt: number, t: Vec3): Vec3 => mix3(c, [c[0] * amt * t[0], c[1] * amt * t[1], c[2] * amt * t[2]], k);
  return {
    ...env,
    zenith: dim(env.zenith, 0.35, [0.9, 0.8, 1.05]),
    horizon: dim(env.horizon, 0.45, [0.95, 0.82, 1.1]),
    skyAmb: dim(env.skyAmb, 0.6, [0.95, 0.85, 1.1]),
    groundAmb: dim(env.groundAmb, 0.6, [0.9, 0.85, 1]),
    sunCol: dim(env.sunCol, 0.5, [0.85, 0.8, 1]),
    moonTint: dim(env.moonTint, 0.4, [0.8, 0.8, 1]),
    stars: env.stars * (1 - k),
    cloudCover: env.cloudCover + (0.85 - env.cloudCover) * k,
    cloudLit: dim(env.cloudLit, 0.4, [0.9, 0.85, 1]),
    cloudShade: dim(env.cloudShade, 0.5, [0.9, 0.85, 1]),
    fogDensity: env.fogDensity * (1 + 0.9 * k),
    fogTint: k > env.fogTintAmt ? [0.03, 0.02, 0.04] : env.fogTint,
    fogTintAmt: Math.max(env.fogTintAmt, 0.45 * k),
    rays: env.rays * (1 - k),
  };
}

/** How much of each land's own air surrounds you (0..1 each, smoothed as you cross a border). */
export interface RegionAir {
  desert: number;
  snow: number;
  blight: number;
  swamp: number;
  badlands: number;
  ember: number;
}

const NO_AIR: RegionAir = { desert: 0, snow: 0, blight: 0, swamp: 0, badlands: 0, ember: 0 };

/**
 * The regions' own air: warm dusty haze over the desert, cold thin air over the snowfields,
 * a sickly violet murk over the blighted lands near the Citadel; the swamp's green mist, the
 * badlands' rust-red dust, and the ember wastes' smoke, lit red from below.
 */
function regionAir(env: Env, r: RegionAir): Env {
  const d = clamp(r.desert, 0, 1);
  const n = clamp(r.snow, 0, 1);
  const b = clamp(r.blight, 0, 1);
  const w = clamp(r.swamp, 0, 1);
  const c = clamp(r.badlands, 0, 1);
  const e = clamp(r.ember, 0, 1);
  const tint = (col: Vec3, t: Vec3, k: number): Vec3 => mix3(col, [col[0] * t[0], col[1] * t[1], col[2] * t[2]], k);
  // A haze: the sky's own brightness, in the haze's colour (green mist, red dust, brown smoke).
  const haze = (col: Vec3, t: Vec3, k: number): Vec3 => {
    const l = (col[0] + col[1] + col[2]) / 3;
    return mix3(col, [l * t[0], l * t[1], l * t[2]], k);
  };
  let horizon = tint(env.horizon, [1.12, 1.0, 0.82], d);
  horizon = tint(horizon, [0.92, 1.0, 1.12], n);
  horizon = tint(horizon, [1.0, 0.8, 1.16], b);
  horizon = haze(horizon, [0.9, 1.08, 0.86], w * 0.6);
  horizon = haze(horizon, [1.3, 0.95, 0.68], c * 0.5);
  horizon = haze(horizon, [1.45, 0.82, 0.58], e * 0.75);
  let zenith = tint(env.zenith, [1.05, 1.0, 0.9], d);
  zenith = tint(zenith, [0.95, 1.0, 1.08], n);
  zenith = tint(zenith, [0.84, 0.7, 1.0], b);
  zenith = haze(zenith, [0.92, 1.05, 0.9], w * 0.45);
  zenith = haze(zenith, [1.15, 0.98, 0.82], c * 0.25);
  zenith = haze(zenith, [1.0, 0.7, 0.55], e * 0.7);
  let sunCol = tint(tint(env.sunCol, [1.06, 1.0, 0.9], d), [0.9, 0.86, 1.0], b);
  sunCol = tint(tint(tint(sunCol, [0.92, 1.0, 0.86], w), [1.1, 0.95, 0.82], c), [1.05, 0.72, 0.5], e);
  // The swamp and the blight lie under a lid of cloud: a softer, dimmer sun.
  sunCol = [sunCol[0] * (1 - 0.32 * w - 0.22 * b), sunCol[1] * (1 - 0.3 * w - 0.24 * b), sunCol[2] * (1 - 0.34 * w - 0.18 * b)];
  const sum = d + n + b + w + c + e || 1;
  const fogTint: Vec3 = [
    (0.07 * d + 0.05 * n + 0.035 * b + 0.035 * w + 0.085 * c + 0.09 * e) / sum,
    (0.05 * d + 0.06 * n + 0.025 * b + 0.05 * w + 0.05 * c + 0.035 * e) / sum,
    (0.025 * d + 0.075 * n + 0.045 * b + 0.032 * w + 0.03 * c + 0.025 * e) / sum,
  ];
  // (Night falls darker under the smoke, and the stars are lost behind it.)
  const smoke = e * 0.6;
  return {
    ...env,
    horizon,
    zenith,
    sunCol,
    skyAmb: tint(tint(env.skyAmb, [0.92, 1.0, 0.9], w), [1.05, 0.82, 0.72], e),
    glow: tint(env.glow, [1.2, 0.8, 0.6], e),
    stars: env.stars * (1 - smoke) * (1 - 0.4 * w),
    cloudCover: env.cloudCover + (0.8 - env.cloudCover) * Math.max(smoke, 0.75 * w, 0.6 * b),
    fogDensity: env.fogDensity * (1 + 0.5 * d + 0.6 * n + 1.2 * b + 1.8 * w + 0.6 * c + 1.0 * e),
    fogTint,
    fogTintAmt: Math.max(0.22 * d, 0.28 * n, 0.46 * b, 0.42 * w, 0.26 * c, 0.42 * e),
    saturation: env.saturation * (1 - 0.08 * n - 0.12 * b - 0.14 * w - 0.08 * e),
  };
}

/** Clock for a fraction (0..1) of the daytime, lingering in a long golden afternoon. */
export function dayClock(f: number): number {
  const x = clamp(f, 0, 1);
  if (x < 0.12) return 0.015 + (x / 0.12) * 0.1;
  if (x < 0.45) return 0.115 + ((x - 0.12) / 0.33) * 0.27;
  return 0.385 + ((x - 0.45) / 0.55) * 0.105;
}

/** Clock across a night march (0..1 progress): sunset to the next sunrise. */
export function nightClock(p: number): number {
  return 0.49 + clamp(p, 0, 1) * 0.525;
}

/** Name of the time of day for the HUD ("DAY 3 · DUSK"). */
export function timeLabel(clock: number): string {
  const c = ((clock % 1) + 1) % 1;
  if (c < 0.06 || c > 0.97) return 'DAWN';
  if (c < 0.17) return 'MORNING';
  if (c < 0.31) return 'NOON';
  if (c < 0.455) return 'AFTERNOON';
  if (c < 0.53) return 'DUSK';
  if (c < 0.66) return 'NIGHT';
  if (c < 0.84) return 'MIDNIGHT';
  return 'NIGHT';
}
