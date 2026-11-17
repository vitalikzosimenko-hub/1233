// Procedural legs for walking block bodies (the fortress and the giants). Each foot stays
// planted on the terrain until its hip has moved too far, then swings in an arc to a spot
// ahead of the hip; legs step in alternating diagonal groups like a trotting animal. The
// knee of a two-segment leg is solved analytically and bends outwards and up.
import type { BlockBody } from './body';
import type { Vec3 } from './math3d';
import type { World } from './world';

export interface Leg {
  /** Hip in body-local coordinates (centre of the housing under the floor). */
  hx: number;
  hy: number;
  hz: number;
  /** Planted (or swinging) foot: world position of the sole. */
  foot: Vec3;
  from: Vec3;
  to: Vec3;
  /** Swing progress 0..1, or -1 when planted. */
  t: number;
  group: number;
  /** Set when the foot comes down; the game consumes it (stomp effects). */
  landed: boolean;
  /** Hip world position last frame (its velocity steers the step, also when turning). */
  lastHip: Vec3;
  /** Damage 0..1 (1 = wrecked: the leg drags and the fortress limps). */
  damage: number;
}

export interface WalkerSpec {
  thigh: number;
  shin: number;
  /** Height of the hips above the ground when standing. */
  height: number;
  stride: number;
  swing: number;
  lift: number;
  /** Visual thickness scale of the leg model. */
  size: number;
  /** How far outside the hips the feet stand (a wider, steadier stance). */
  spread: number;
  /** How much further a leg reaches down with the steel ram run out of its shin (climbing). */
  telescope?: number;
}

export const FORTRESS_LEGS: WalkerSpec = { thigh: 6.2, shin: 6.4, height: 10.5, stride: 5.5, swing: 0.62, lift: 2.2, size: 1.3, spread: 1.6, telescope: 11 };
export const GIANT_LEGS: WalkerSpec = { thigh: 1.9, shin: 1.9, height: 3.2, stride: 2.2, swing: 0.42, lift: 0.9, size: 0.62, spread: 0.2 };
export const COLOSSUS_LEGS: WalkerSpec = { thigh: 3.1, shin: 3.1, height: 5.4, stride: 3.2, swing: 0.55, lift: 1.4, size: 0.95, spread: 0.4 };

export class Walker {
  readonly spec: WalkerSpec;
  legs: Leg[] = [];
  /** Movement of the body this frame (world units / s). */
  vx = 0;
  vz = 0;
  group = 0;
  private layoutVersion = -1;

  constructor(spec: WalkerSpec) {
    this.spec = spec;
  }

  /**
   * Hip positions from the hull footprint (every cell in the lowest few layers): the four
   * corners, a middle pair on long hulls, each snapped under real hull cells.
   */
  layout(body: BlockBody, world: World | null): void {
    if (this.layoutVersion === body.version && this.legs.length > 0) return;
    this.layoutVersion = body.version;
    const giant = body.kind === 'giant';
    const cols: Array<[number, number]> = [];
    const seen = new Set<number>();
    for (const k of body.cells.keys()) {
      const y = Math.floor(k / 16384) - 64;
      if (y > body.floorY + (giant ? 0 : 2)) continue;
      const x = (k % 128) - 64;
      const z = (Math.floor(k / 128) % 128) - 64;
      const key = (x + 64) * 256 + z + 64;
      if (seen.has(key)) continue;
      seen.add(key);
      cols.push([x, z]);
    }
    if (cols.length === 0) {
      this.legs = [];
      return;
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of cols) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const old = this.legs;
    const legs: Leg[] = [];
    const hy = body.floorY - 0.4;
    if (giant) {
      // Two legs side by side under the hips.
      const hx = (x0 + x1 + 1) / 2;
      [z0 + (z1 - z0 + 1) * 0.3, z0 + (z1 - z0 + 1) * 0.7].forEach((hz, i) => legs.push(this.makeLeg(body, world, hx, hy, hz, i, old)));
      this.legs = legs;
      return;
    }
    const inset = 1.5;
    const lenX = x1 - x0 + 1;
    const xs = lenX > 26 ? [x0 + inset, (x0 + x1 + 1) / 2, x1 + 1 - inset] : [x0 + inset, x1 + 1 - inset];
    const zs = [z0 + inset, z1 + 1 - inset];
    // Bigger hulls stand on proportionally heavier legs.
    const area = cols.length;
    this.scale = Math.max(1, Math.min(1.2, Math.sqrt(area / 165)));
    xs.forEach((tx, i) => {
      zs.forEach((tz, j) => {
        // Snap the hip under the nearest real hull column.
        let best = cols[0]!;
        let bestD = Infinity;
        for (const c of cols) {
          const d = Math.abs(c[0] + 0.5 - tx) + Math.abs(c[1] + 0.5 - tz);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        const hx = bestD > 0.6 ? best[0] + 0.5 : tx;
        const hz = bestD > 0.6 ? best[1] + 0.5 : tz;
        if (legs.some((l) => Math.abs(l.hx - hx) < 3 && Math.abs(l.hz - hz) < 3)) return;
        legs.push(this.makeLeg(body, world, hx, hy, hz, (i + j) % 2, old));
      });
    });
    this.legs = legs;
  }

  /** Leg thickness multiplier for big hulls. */
  scale = 1;

  /** Hip height above the ground: bigger hulls stand a little taller. */
  rideHeight(): number {
    return this.spec.height + (this.scale - 1) * 6;
  }

  /** Longest a leg stretches (hip above its foot), its shin's ram run out when it has one. */
  maxDrop(): number {
    return this.rideHeight() + 2.5 + (this.spec.telescope ?? 0);
  }

  /** Length of the stone shin (a ram slides out of it below that). */
  shinLength(): number {
    return this.spec.shin * this.lengthK();
  }

  /**
   * The ground a leg can stand on about a spot: the middle of a few samples around it, so a lone
   * pit or spike under the hip does not count.
   */
  groundNear(world: World, x: number, z: number): number {
    const r = 2.5;
    const v = [world.naturalGround(x, z), world.naturalGround(x + r, z), world.naturalGround(x - r, z), world.naturalGround(x, z + r), world.naturalGround(x, z - r)];
    v.sort((a, b) => a - b);
    return v[2]!;
  }

  private lengthK(): number {
    return 1 + (this.scale - 1) * 0.55;
  }

  private makeLeg(body: BlockBody, world: World | null, hx: number, hy: number, hz: number, group: number, old: Leg[]): Leg {
    const [wx, , wz] = body.toWorld(hx, hy, hz);
    // Reuse the nearest old foot so re-layouts do not teleport the feet.
    let foot: Vec3 | null = null;
    let best = 3;
    for (const l of old) {
      const d = Math.hypot(l.foot[0] - wx, l.foot[2] - wz);
      if (d < best) {
        best = d;
        foot = [l.foot[0], l.foot[1], l.foot[2]];
      }
    }
    const prevLeg = old.find((l) => Math.abs(l.hx - hx) < 2 && Math.abs(l.hz - hz) < 2);
    const leg: Leg = { hx, hy, hz, foot: [wx, 0, wz], from: [wx, 0, wz], to: [wx, 0, wz], t: -1, group, landed: false, lastHip: body.toWorld(hx, hy, hz), damage: prevLeg?.damage ?? 0 };
    if (!foot) {
      const [fx, fz] = this.footHome(body, leg);
      foot = [fx, world ? world.groundAt(fx, fz) : body.y + hy - this.spec.height, fz];
    }
    leg.foot = foot;
    leg.from = [...foot];
    leg.to = [...foot];
    return leg;
  }

  hipWorld(body: BlockBody, l: Leg): Vec3 {
    return body.toWorld(l.hx, l.hy, l.hz);
  }

  /** Outward direction (world) from the body's centre line through a hip. */
  outward(body: BlockBody, l: Leg): [number, number] {
    const cx = (body.minX + body.maxX + 1) / 2;
    const cz = (body.minZ + body.maxZ + 1) / 2;
    let ox = l.hx - cx;
    let oz = l.hz - cz;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol;
    oz /= ol;
    return body.dirToWorld(ox, oz);
  }

  /** Where a foot rests when standing: under the hip, pushed outwards by the stance spread. */
  footHome(body: BlockBody, l: Leg): [number, number] {
    const [wx, , wz] = this.hipWorld(body, l);
    const [ox, oz] = this.outward(body, l);
    return [wx + ox * this.spec.spread, wz + oz * this.spec.spread];
  }

  /** Average natural ground under the hips (for the body's ride height; trees and huts get crushed). */
  groundUnder(world: World, body: BlockBody): number {
    if (this.legs.length === 0) {
      const [cx, cz] = body.centre();
      return world.naturalGround(cx, cz);
    }
    let sum = 0;
    for (const l of this.legs) {
      const hip = this.hipWorld(body, l);
      sum += world.naturalGround(hip[0], hip[2]);
    }
    return sum / this.legs.length;
  }

  /** Plans and animates steps. Returns how many feet landed this frame. */
  update(body: BlockBody, world: World, dt: number, moving: boolean): number {
    const s = this.spec;
    let swinging = 0;
    for (const l of this.legs) if (l.t >= 0) swinging += 1;
    let landed = 0;
    // Each hip's own velocity (straight walking and turning both move hips).
    const lead = (l: Leg): [number, number] => {
      const hip = this.hipWorld(body, l);
      const vx = dt > 0 ? (hip[0] - l.lastHip[0]) / dt : 0;
      const vz = dt > 0 ? (hip[2] - l.lastHip[2]) / dt : 0;
      const sp = Math.hypot(vx, vz);
      if (!moving || sp < 0.05) return [0, 0];
      const k = Math.min(s.stride * 0.55, sp * s.swing * 1.4 + s.stride * 0.3) / sp;
      return [vx * k, vz * k];
    };
    // Where a foot steps next: ahead of its resting spot by the hip's pace.
    const target = (l: Leg): Vec3 => {
      const home = this.footHome(body, l);
      const [ax, az] = lead(l);
      return this.foothold(body, world, l, home[0] + ax, home[1] + az);
    };
    // Swing in progress.
    for (const l of this.legs) {
      if (l.t < 0) continue;
      // A wrecked leg swings slowly and drags.
      l.t += dt / (s.swing * (1 + l.damage * 1.4));
      l.to = target(l);
      const u = Math.min(1, l.t);
      const e = u * u * (3 - 2 * u);
      // Up onto higher ground the foot rises first and then reaches over the edge; down off it, it
      // reaches out first and then drops.
      const rise = l.to[1] - l.from[1];
      const ey = rise > 1 ? 1 - (1 - u) ** 3 : rise < -1 ? u ** 3 : e;
      l.foot = [
        l.from[0] + (l.to[0] - l.from[0]) * e,
        l.from[1] + rise * ey + Math.sin(u * Math.PI) * s.lift * (1 - l.damage * 0.7),
        l.from[2] + (l.to[2] - l.from[2]) * e,
      ];
      if (l.t >= 1) {
        l.t = -1;
        l.foot = [l.to[0], l.to[1], l.to[2]];
        l.landed = true;
        landed += 1;
      }
    }
    // Start the next group's steps once the current group is down.
    if (swinging === 0) {
      let need = false;
      for (const l of this.legs) {
        if (l.group !== this.group) continue;
        const t = target(l);
        const d = Math.hypot(l.foot[0] - t[0], l.foot[2] - t[2]);
        // Where it would step lies well above or below the foot (the body walked up or down a slope,
        // or rose out of the leg's reach), or the ground went from under (or heaped over) the foot.
        const rise = Math.abs(t[1] - l.foot[1]);
        const footing = Math.abs(world.groundAt(l.foot[0], l.foot[2]) - l.foot[1]) > 0.6;
        if (d > (moving ? s.stride * 0.5 : 0.7) || rise > 1.5 || footing) need = true;
      }
      if (need) {
        for (const l of this.legs) {
          if (l.group !== this.group) continue;
          l.from = [l.foot[0], l.foot[1], l.foot[2]];
          l.t = 0;
        }
      }
      this.group = this.group === 0 ? 1 : 0;
    }
    for (const l of this.legs) l.lastHip = this.hipWorld(body, l);
    return landed;
  }

  /**
   * Where a foot sets down near a spot: there, unless the ground lies beyond the leg's reach (a pit,
   * the foot of a cliff) or rises nearly to the hip (a pillar, a wall), then on the nearest ground
   * around it that suits it better.
   */
  private foothold(body: BlockBody, world: World, l: Leg, x: number, z: number): Vec3 {
    const y = world.groundAt(x, z);
    const hip = body.y + l.hy;
    const max = this.maxDrop();
    const min = this.rideHeight() * 0.3;
    if (hip - y <= max && hip - y >= min) return [x, y, z];
    let best: Vec3 | null = null;
    let bestScore = Infinity;
    for (const r of [2.5, 5]) {
      for (let k = 0; k < 8; k += 1) {
        const a = (k / 8) * Math.PI * 2;
        const cx = x + Math.cos(a) * r;
        const cz = z + Math.sin(a) * r;
        const cy = world.groundAt(cx, cz);
        const drop = hip - cy;
        if (drop > max || drop < min) continue;
        const score = Math.abs(drop - this.rideHeight()) + r;
        if (score < bestScore) {
          bestScore = score;
          best = [cx, cy, cz];
        }
      }
      if (best) return best;
    }
    return [x, y, z];
  }

  /** Worst leg damage, and the share of legs that are wrecked. */
  limp(): number {
    let sum = 0;
    for (const l of this.legs) sum += l.damage;
    return this.legs.length ? sum / this.legs.length : 0;
  }

  /** Knee position for a hip and foot (bends outwards from the body centre and up). */
  knee(body: BlockBody, l: Leg, hip: Vec3): Vec3 {
    const s = this.spec;
    const ankle: Vec3 = [l.foot[0], l.foot[1] + 1.25 * s.size * this.scale, l.foot[2]];
    const thigh = s.thigh * this.lengthK();
    const shin = s.shin * this.lengthK();
    let dx = ankle[0] - hip[0];
    let dy = ankle[1] - hip[1];
    let dz = ankle[2] - hip[2];
    let d = Math.hypot(dx, dy, dz);
    const reach = thigh + shin - 0.05;
    if (d > reach) {
      const k = reach / d;
      dx *= k;
      dy *= k;
      dz *= k;
      d = reach;
    }
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    const a = (thigh * thigh - shin * shin + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, thigh * thigh - a * a));
    // Outward from the body's centre line.
    const [ox, oz] = this.outward(body, l);
    let bx = ox * 0.9;
    let by = 0.45;
    let bz = oz * 0.9;
    // Remove the component along the leg axis.
    const dot = bx * ux + by * uy + bz * uz;
    bx -= ux * dot;
    by -= uy * dot;
    bz -= uz * dot;
    const bl = Math.hypot(bx, by, bz) || 1;
    return [hip[0] + ux * a + (bx / bl) * h, hip[1] + uy * a + (by / bl) * h, hip[2] + uz * a + (bz / bl) * h];
  }
}
