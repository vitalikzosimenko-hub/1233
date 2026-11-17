import { poseToLocal, type BlockBody, type BodyPose } from './body';
import type { World } from './world';

export const GRAVITY = 28;
export const MAX_FALL = 40;
const EPS = 1e-6;
const GAP = 1e-4;

/**
 * A collision grid: the world (identity frame) or a block body (its own turned frame).
 * Actors are treated as upright cylinders, so in any frame their footprint is the same
 * axis-aligned square of half width hw around their local centre.
 */
export interface Grid {
  solid(cx: number, cy: number, cz: number): boolean;
  body: BlockBody | null;
  /** The body's pose, or null for the world (identity). */
  pose: BodyPose | null;
}

/** Actor box: x/z centre, y = feet, hw = half width, h = height. */
export interface Box {
  x: number;
  y: number;
  z: number;
  hw: number;
  h: number;
}

export function worldGrid(world: World): Grid {
  return { solid: (x, y, z) => world.solid(x, y, z), body: null, pose: null };
}

export function bodyGrid(body: BlockBody): Grid {
  return { solid: (x, y, z) => body.solidAt(x, y, z), body, pose: body };
}

/** The actor box expressed in a grid's local frame (always a fresh copy: sweeps move it). */
function localBox(box: Box, grid: Grid): Box {
  if (!grid.pose) return { x: box.x, y: box.y, z: box.z, hw: box.hw, h: box.h };
  const [x, y, z] = poseToLocal(grid.pose, box.x, box.y, box.z);
  return { x, y, z, hw: box.hw, h: box.h };
}

function dirToLocal(grid: Grid, dx: number, dz: number): [number, number] {
  const p = grid.pose;
  if (!p) return [dx, dz];
  return [p.c * dx + p.s * dz, -p.s * dx + p.c * dz];
}

function dirToWorld(grid: Grid, dx: number, dz: number): [number, number] {
  const p = grid.pose;
  if (!p) return [dx, dz];
  return [p.c * dx - p.s * dz, p.s * dx + p.c * dz];
}

function slabSolid(grid: Grid, axis: number, c: number, lo: number[], hi: number[]): boolean {
  const a = axis === 0 ? 1 : 0;
  const b = axis === 2 ? 1 : 2;
  for (let i = lo[a]!; i <= hi[a]!; i += 1) {
    for (let j = lo[b]!; j <= hi[b]!; j += 1) {
      const cell = [0, 0, 0];
      cell[axis] = c;
      cell[a] = i;
      cell[b] = j;
      if (grid.solid(cell[0]!, cell[1]!, cell[2]!)) return true;
    }
  }
  return false;
}

/** Moves a box (already in the grid's frame) along one local axis as far as the grid allows. */
function sweepLocal(box: Box, axis: 0 | 1 | 2, d: number, grid: Grid): number {
  if (d === 0) return 0;
  const min = [box.x - box.hw, box.y, box.z - box.hw];
  const max = [box.x + box.hw, box.y + box.h, box.z + box.hw];
  const lo = [Math.floor(min[0]! + EPS), Math.floor(min[1]! + EPS), Math.floor(min[2]! + EPS)];
  const hi = [Math.floor(max[0]! - EPS), Math.floor(max[1]! - EPS), Math.floor(max[2]! - EPS)];
  if (d > 0) {
    const e0 = max[axis]!;
    for (let c = Math.ceil(e0 - EPS); c <= Math.floor(e0 + d); c += 1) {
      if (slabSolid(grid, axis, c, lo, hi)) return Math.min(d, Math.max(0, c - e0 - GAP));
    }
  } else {
    const e0 = min[axis]!;
    for (let c = Math.floor(e0 + EPS) - 1; c >= Math.floor(e0 + d); c -= 1) {
      if (slabSolid(grid, axis, c, lo, hi)) return Math.max(d, Math.min(0, c + 1 - e0 + GAP));
    }
  }
  return d;
}

/**
 * Moves the box along one world axis as far as all grids allow (vertical moves are the
 * same in every frame; horizontal ones are swept in each grid's own axes).
 */
export function sweep(box: Box, axis: 0 | 1 | 2, d: number, grids: Grid[]): { d: number; hit: Grid | null } {
  if (axis === 1) {
    let allowed = d;
    let hit: Grid | null = null;
    for (const grid of grids) {
      const got = sweepLocal(localBox(box, grid), 1, allowed, grid);
      if (Math.abs(got) < Math.abs(allowed) - 1e-9) {
        allowed = got;
        hit = grid;
      }
    }
    return { d: allowed, hit };
  }
  const r = sweepHorizontal(box, axis === 0 ? d : 0, axis === 2 ? d : 0, grids);
  return { d: axis === 0 ? r.dx : r.dz, hit: r.hit };
}

/** Horizontal move through every grid: each one may stop or deflect it along its own walls. */
export function sweepHorizontal(box: Box, dx: number, dz: number, grids: Grid[]): { dx: number; dz: number; hit: Grid | null } {
  let mx = dx;
  let mz = dz;
  let hit: Grid | null = null;
  for (const grid of grids) {
    if (mx === 0 && mz === 0) break;
    const lb = localBox(box, grid);
    const [ldx, ldz] = dirToLocal(grid, mx, mz);
    const ax = sweepLocal(lb, 0, ldx, grid);
    lb.x += ax;
    const az = sweepLocal(lb, 2, ldz, grid);
    if (Math.abs(ax - ldx) > 1e-7 || Math.abs(az - ldz) > 1e-7) hit = grid;
    if (grid.pose) [mx, mz] = dirToWorld(grid, ax, az);
    else {
      mx = ax;
      mz = az;
    }
  }
  return { dx: mx, dz: mz, hit };
}

/** True if any solid cell of the grid overlaps the box. */
export function overlaps(box: Box, grid: Grid, shrink = 0.01): boolean {
  const b = localBox(box, grid);
  for (let y = Math.floor(b.y + shrink); y <= Math.floor(b.y + b.h - shrink); y += 1) {
    for (let z = Math.floor(b.z - b.hw + shrink); z <= Math.floor(b.z + b.hw - shrink); z += 1) {
      for (let x = Math.floor(b.x - b.hw + shrink); x <= Math.floor(b.x + b.hw - shrink); x += 1) {
        if (grid.solid(x, y, z)) return true;
      }
    }
  }
  return false;
}

/**
 * Smallest push (in world space) that separates the box from a grid, preferring the
 * direction the body is moving (or lifting the box onto it when it rose underneath).
 */
export function depenetrate(box: Box, grid: Grid, dirX: number, dirZ: number): { dx: number; dy: number; dz: number } | null {
  if (!overlaps(box, grid)) return null;
  const b = localBox(box, grid);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let top = -Infinity;
  for (let y = Math.floor(b.y + 0.01); y <= Math.floor(b.y + b.h - 0.01); y += 1) {
    for (let z = Math.floor(b.z - b.hw + 0.01); z <= Math.floor(b.z + b.hw - 0.01); z += 1) {
      for (let x = Math.floor(b.x - b.hw + 0.01); x <= Math.floor(b.x + b.hw - 0.01); x += 1) {
        if (!grid.solid(x, y, z)) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + 1);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z + 1);
        top = Math.max(top, y + 1);
      }
    }
  }
  if (top === -Infinity) return null;
  const [ldx, ldz] = dirToLocal(grid, dirX, dirZ);
  const options = [
    { dx: x1 - (b.x - b.hw) + GAP, dy: 0, dz: 0, w: ldx > 0.3 ? 0.5 : 1.4 },
    { dx: x0 - (b.x + b.hw) - GAP, dy: 0, dz: 0, w: ldx < -0.3 ? 0.5 : 1.4 },
    { dx: 0, dy: 0, dz: z1 - (b.z - b.hw) + GAP, w: ldz > 0.3 ? 0.5 : 1.4 },
    { dx: 0, dy: 0, dz: z0 - (b.z + b.hw) - GAP, w: ldz < -0.3 ? 0.5 : 1.4 },
    { dx: 0, dy: top - b.y + GAP, dz: 0, w: 0.9 },
  ];
  let best = options[0]!;
  let bestCost = Infinity;
  for (const o of options) {
    const cost = (Math.abs(o.dx) + Math.abs(o.dy) + Math.abs(o.dz)) * o.w;
    if (cost < bestCost) {
      bestCost = cost;
      best = o;
    }
  }
  const [wx, wz] = dirToWorld(grid, best.dx, best.dz);
  return { dx: wx, dy: best.dy, dz: wz };
}
