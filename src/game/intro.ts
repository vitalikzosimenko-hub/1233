// The opening flyover: before your first command the camera circles the walking fortress, drops
// down to the village it stands over and looks east along the valley, then settles into your eyes
// on its deck. Four captions say what the game is in four lines. A tap skips it.
import type { Game } from './game';
import { forward, type Vec3 } from './math3d';
import { nearestHoistable } from './guide';

interface Shot {
  t: number;
  eye: Vec3;
  look: Vec3;
}

export interface Intro {
  t: number;
  dur: number;
  shots: Shot[];
  /** Your own view, restored when it ends. */
  yaw: number;
  pitch: number;
  eye: Vec3;
}

export const INTRO_CAPTIONS: Array<{ until: number; title: string; sub: string }> = [
  { until: 3.6, title: 'YOUR WALKING FORTRESS', sub: 'A whole village on four giant legs' },
  { until: 6.9, title: 'BY DAY', sub: 'Raid villages · hoist whole houses aboard' },
  { until: 9.7, title: 'BY NIGHT', sub: 'March east · fight off the monster horde' },
  { until: 99, title: 'YOUR COMMAND, CAPTAIN!', sub: '' },
];

const INTRO_KEY = 'block-fortress-intro-v1';

/** The flyover plays before a captain's first game (never under automation, unless asked). */
export function wantsIntro(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('intro')) return true;
    if (navigator.webdriver) return false;
    return window.localStorage.getItem(INTRO_KEY) !== 'seen';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_KEY, 'seen');
  } catch {
    // storage may be unavailable
  }
}

/** Plans the shots around the fortress where it stands now. */
export function makeIntro(g: Game): Intro {
  const F = g.fortress;
  const [cx, cz] = F.centre();
  const deck = F.y + F.floorY;
  const fx = F.c;
  const fz = F.s;
  const r = g.fortressRadius();
  const ground = g.world.groundAt(cx, cz);
  // A point by the hull's frame: f ahead, s to starboard, at height y.
  const at = (f: number, s: number, y: number): Vec3 => [cx + fx * f - fz * s, y, cz + fz * f + fx * s];
  const hull: Vec3 = [cx, (deck + ground) / 2 + 3, cz];
  const house = nearestHoistable(g);
  const village: Vec3 = house ? [house.spot[0], house.spot[1] - 3, house.spot[2]] : at(r + 8, 10, ground + 2);
  const eye = g.eye();
  const f = forward(g.yaw, g.pitch);
  const look: Vec3 = [eye[0] + f[0] * 12, eye[1] + f[1] * 12, eye[2] + f[2] * 12];
  const shots: Shot[] = [
    { t: 0, eye: at(-r - 30, -r - 16, deck + 12), look: hull },
    { t: 3.4, eye: at(r * 0.3, -r - 30, deck + 5), look: hull },
    { t: 5.0, eye: at(r + 16, -r - 14, ground + 6), look: village },
    { t: 6.9, eye: at(r + 6, r + 18, ground + 5), look: village },
    { t: 8.4, eye: at(-r - 16, 0, deck + 15), look: at(110, 0, deck - 4) },
    { t: 9.8, eye: at(-r - 4, 1, deck + 7), look: at(70, 0, deck - 2) },
    { t: 11.2, eye, look },
  ];
  return { t: 0, dur: 11.2, shots, yaw: g.yaw, pitch: g.pitch, eye: [...shots[0]!.eye] };
}

function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

function along(shots: Shot[], t: number, pick: (s: Shot) => Vec3): Vec3 {
  let i = 0;
  while (i < shots.length - 2 && t > shots[i + 1]!.t) i += 1;
  const a = shots[i]!;
  const b = shots[i + 1]!;
  const raw = Math.max(0, Math.min(1, (t - a.t) / Math.max(0.001, b.t - a.t)));
  // Ease the last leg into your eyes.
  const u = i === shots.length - 2 ? raw * raw * (3 - 2 * raw) : raw;
  const p0 = pick(shots[Math.max(0, i - 1)]!);
  const p1 = pick(a);
  const p2 = pick(b);
  const p3 = pick(shots[Math.min(shots.length - 1, i + 2)]!);
  return [catmull(p0[0], p1[0], p2[0], p3[0], u), catmull(p0[1], p1[1], p2[1], p3[1], u), catmull(p0[2], p1[2], p2[2], p3[2], u)];
}

/** Moves the camera along the flyover; true while it runs. */
export function updateIntro(g: Game, it: Intro, dt: number): boolean {
  it.t = Math.min(it.dur, it.t + dt);
  const e = along(it.shots, it.t, (s) => s.eye);
  const l = along(it.shots, it.t, (s) => s.look);
  // Never through a hill (except the last moment, which is your own eye on the deck).
  if (it.t < it.dur - 0.6) e[1] = Math.max(e[1], g.world.groundAt(e[0], e[2]) + 2.5);
  it.eye = e;
  const dx = l[0] - e[0];
  const dy = l[1] - e[1];
  const dz = l[2] - e[2];
  const d = Math.hypot(dx, dy, dz) || 1;
  if (it.t >= it.dur) {
    g.yaw = it.yaw;
    g.pitch = it.pitch;
    return false;
  }
  g.yaw = Math.atan2(dz, dx);
  g.pitch = Math.asin(Math.max(-1, Math.min(1, dy / d)));
  return true;
}

export function introCaption(it: Intro): { title: string; sub: string } {
  return INTRO_CAPTIONS.find((c) => it.t < c.until) ?? INTRO_CAPTIONS[INTRO_CAPTIONS.length - 1]!;
}
