import { B, blockDef, MACHINE_IDS, TURRET_IDS } from './blocks';
import type { Vec3 } from './math3d';

export interface Cell {
  id: number;
  hp: number;
  maxHp: number;
  /** Attachment direction for ladders (index into DIRS). */
  dir: number;
}

export interface CannonState {
  cooldown: number;
  yaw: number;
  pitch: number;
  recoil: number;
  /** TNT loaded into the cannon's magazine. */
  ammo: number;
}

const OFF = 64;

export function key3(x: number, y: number, z: number): number {
  return ((y + OFF) * 128 + (z + OFF)) * 128 + (x + OFF);
}

export function kx(key: number): number {
  return (key % 128) - OFF;
}

export function kz(key: number): number {
  return (Math.floor(key / 128) % 128) - OFF;
}

export function ky(key: number): number {
  return Math.floor(key / 16384) - OFF;
}

export const N6: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Key of a local hull column. */
export function colKey(x: number, z: number): number {
  return (x + 64) * 256 + (z + 64);
}

/** A body's placement in the world (kept for the previous frame to carry riders along). */
export interface BodyPose {
  x: number;
  y: number;
  z: number;
  px: number;
  pz: number;
  c: number;
  s: number;
  yaw: number;
}

/** Local point -> world under a pose. */
export function poseToWorld(p: BodyPose, lx: number, ly: number, lz: number): Vec3 {
  const dx = lx - p.px;
  const dz = lz - p.pz;
  return [p.x + p.px + p.c * dx - p.s * dz, p.y + ly, p.z + p.pz + p.s * dx + p.c * dz];
}

/** World point -> local under a pose. */
export function poseToLocal(p: BodyPose, wx: number, wy: number, wz: number): Vec3 {
  const dx = wx - p.x - p.px;
  const dz = wz - p.z - p.pz;
  return [p.px + p.c * dx + p.s * dz, wy - p.y, p.pz - p.s * dx + p.c * dz];
}

/** Turns a vector by a drawn lean: the rotation that takes straight up to `up` (unit). */
export function tiltApply(up: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
  const ux = up[0]!;
  const uy = up[1]!;
  const uz = up[2]!;
  // About the level axis (uz, 0, -ux), by the angle between straight up and `up` (Rodrigues).
  const s = Math.hypot(ux, uz);
  if (s < 1e-6) return [v[0]!, v[1]!, v[2]!];
  const kx = uz / s;
  const kz = -ux / s;
  const c = uy;
  const vx = v[0]!;
  const vy = v[1]!;
  const vz = v[2]!;
  const dot = kx * vx + kz * vz;
  // k x v, with k = (kx, 0, kz)
  const cx = -kz * vy;
  const cy = kz * vx - kx * vz;
  const cz = kx * vy;
  return [vx * c + cx * s + kx * dot * (1 - c), vy * c + cy * s, vz * c + cz * s + kz * dot * (1 - c)];
}

/**
 * A moving grid of blocks: the player's fortress, an enemy giant or a hoisted building.
 * Cells use local integer coordinates. The body turns about a vertical axis through its
 * pivot (the hull centre): world = (x, y, z) + pivot + R(yaw) * (local - pivot), so with
 * yaw 0, (x, y, z) is the world position of local (0, 0, 0).
 */
export class BlockBody implements BodyPose {
  readonly kind: 'fortress' | 'giant' | 'cargo';
  readonly cells = new Map<number, Cell>();
  x = 0;
  y = 0;
  z = 0;
  /** Heading: local +x points along world (cos yaw, sin yaw). */
  yaw = 0;
  c = 1;
  s = 0;
  /** Pivot of rotation in local coordinates. */
  px = 0;
  pz = 0;
  /** Pose at the start of the frame (riders are carried from it to the current pose). */
  readonly prev: BodyPose = { x: 0, y: 0, z: 0, px: 0, pz: 0, c: 1, s: 0, yaw: 0 };
  minX = 0;
  maxX = 0;
  minY = 0;
  maxY = 0;
  minZ = 0;
  maxZ = 0;
  version = 0;
  floorY = 0;
  walkPhase = 0;
  moving = false;
  poweredWires = new Set<number>();
  poweredMachines = new Set<number>();
  /** Machines that came with their own power (hoisted towers and windmills). */
  readonly selfPowered = new Set<number>();
  readonly cannons = new Map<number, CannonState>();
  shake = 0;
  /** Drawn-only offset (world): a giant rears back before a punch and lunges into it. */
  readonly nudge: [number, number, number] = [0, 0, 0];
  /** Drawn-only size about the pivot and the base (a hoisted building shrinking as it packs down). */
  drawScale = 1;
  /**
   * Drawn-only lean: where the body's up points (unit; straight up when level), turned about a world
   * point (a load hanging on the crane leans along its rope, about the hook).
   */
  readonly tilt: [number, number, number] = [0, 1, 0];
  readonly tiltAt: [number, number, number] = [0, 0, 0];

  constructor(kind: 'fortress' | 'giant' | 'cargo') {
    this.kind = kind;
  }

  get(x: number, y: number, z: number): Cell | undefined {
    return this.cells.get(key3(x, y, z));
  }

  blockAt(x: number, y: number, z: number): number {
    return this.cells.get(key3(x, y, z))?.id ?? B.AIR;
  }

  solidAt(x: number, y: number, z: number): boolean {
    const cell = this.cells.get(key3(x, y, z));
    return cell !== undefined && blockDef(cell.id).solid;
  }

  climbAt(x: number, y: number, z: number): boolean {
    const cell = this.cells.get(key3(x, y, z));
    return cell !== undefined && blockDef(cell.id).climbable;
  }

  hasBlock(x: number, y: number, z: number): boolean {
    return this.cells.has(key3(x, y, z));
  }

  setBlock(x: number, y: number, z: number, id: number, hp?: number, dir = 0): void {
    const key = key3(x, y, z);
    const maxHp = blockDef(id).hp;
    this.cells.set(key, { id, hp: hp ?? maxHp, maxHp, dir });
    if (TURRET_IDS.has(id) && !this.cannons.has(key)) this.cannons.set(key, { cooldown: 0, yaw: 0, pitch: 0.6, recoil: 0, ammo: 0 });
    this.changed();
  }

  /** Sets many cells with a single recompute: [x, y, z, id, dir]. */
  setMany(cells: ReadonlyArray<readonly [number, number, number, number, number]>): void {
    for (const [x, y, z, id, dir] of cells) {
      const key = key3(x, y, z);
      const maxHp = blockDef(id).hp;
      this.cells.set(key, { id, hp: maxHp, maxHp, dir });
      if (TURRET_IDS.has(id) && !this.cannons.has(key)) this.cannons.set(key, { cooldown: 0, yaw: 0, pitch: 0.6, recoil: 0, ammo: 0 });
    }
    this.changed();
  }

  /** Removes many cells with a single recompute. */
  removeMany(keys: readonly number[]): void {
    for (const key of keys) {
      this.cells.delete(key);
      this.cannons.delete(key);
      this.selfPowered.delete(key);
    }
    this.changed();
  }

  removeBlock(x: number, y: number, z: number): number {
    const key = key3(x, y, z);
    const cell = this.cells.get(key);
    if (!cell) return B.AIR;
    this.cells.delete(key);
    this.cannons.delete(key);
    this.selfPowered.delete(key);
    this.changed();
    return cell.id;
  }

  changed(): void {
    this.version += 1;
    this.recompute();
    if (this.cells.size > this.peakCells) this.peakCells = this.cells.size;
    // The pivot follows the hull centre, without moving anything in the world.
    if (this.cells.size > 0) this.setPivot((this.minX + this.maxX + 1) / 2, (this.minZ + this.maxZ + 1) / 2);
  }

  // ------------------------------------------------------------------ pose

  setYaw(yaw: number): void {
    this.yaw = yaw;
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
  }

  /** Moves the pivot while keeping every cell where it is in the world. */
  setPivot(px: number, pz: number): void {
    if (px === this.px && pz === this.pz) return;
    const dx = this.px - px;
    const dz = this.pz - pz;
    // O' = O + (I - R)(P - P')
    this.x += dx - (this.c * dx - this.s * dz);
    this.z += dz - (this.s * dx + this.c * dz);
    this.px = px;
    this.pz = pz;
  }

  /** Remembers the current pose as the previous one (start of a frame). */
  savePose(): void {
    const p = this.prev;
    p.x = this.x;
    p.y = this.y;
    p.z = this.z;
    p.px = this.px;
    p.pz = this.pz;
    p.c = this.c;
    p.s = this.s;
    p.yaw = this.yaw;
  }

  toWorld(lx: number, ly: number, lz: number): Vec3 {
    return poseToWorld(this, lx, ly, lz);
  }

  toLocal(wx: number, wy: number, wz: number): Vec3 {
    return poseToLocal(this, wx, wy, wz);
  }

  /** Horizontal direction local -> world. */
  dirToWorld(dx: number, dz: number): [number, number] {
    return [this.c * dx - this.s * dz, this.s * dx + this.c * dz];
  }

  /** Horizontal direction world -> local. */
  dirToLocal(dx: number, dz: number): [number, number] {
    return [this.c * dx + this.s * dz, -this.s * dx + this.c * dz];
  }

  /** World position of the pivot (the hull centre). */
  centre(): [number, number] {
    return [this.x + this.px, this.z + this.pz];
  }

  /** World position of the middle of the local bounding box (giants keep their pivot at 0). */
  hullCentre(): [number, number] {
    const [wx, , wz] = this.toWorld((this.minX + this.maxX + 1) / 2, 0, (this.minZ + this.maxZ + 1) / 2);
    return [wx, wz];
  }

  /** How the body's surface at a world point moved since the previous frame. */
  motionAt(wx: number, wy: number, wz: number): Vec3 {
    const [lx, ly, lz] = poseToLocal(this.prev, wx, wy, wz);
    const [nx, ny, nz] = this.toWorld(lx, ly, lz);
    return [nx - wx, ny - wy, nz - wz];
  }

  private columnsVersion = -1;
  private columnCache = new Map<number, [number, number]>();

  /** Solid extent of every hull column: key (x+64)*256+(z+64) -> [lowest y, highest y]. */
  columns(): Map<number, [number, number]> {
    if (this.columnsVersion === this.version) return this.columnCache;
    this.columnsVersion = this.version;
    const cols = new Map<number, [number, number]>();
    for (const [key, cell] of this.cells) {
      if (!blockDef(cell.id).solid) continue;
      const k = colKey(kx(key), kz(key));
      const y = ky(key);
      const c = cols.get(k);
      if (!c) cols.set(k, [y, y]);
      else {
        if (y < c[0]) c[0] = y;
        if (y > c[1]) c[1] = y;
      }
    }
    this.columnCache = cols;
    return cols;
  }

  setCentre(wx: number, wz: number): void {
    this.x = wx - this.px;
    this.z = wz - this.pz;
  }

  /** The local cell containing a world point. */
  cellAt(wx: number, wy: number, wz: number): [number, number, number] {
    const [lx, ly, lz] = this.toLocal(wx, wy, wz);
    return [Math.floor(lx), Math.floor(ly), Math.floor(lz)];
  }

  solidAtWorld(wx: number, wy: number, wz: number): boolean {
    const [x, y, z] = this.cellAt(wx, wy, wz);
    return this.solidAt(x, y, z);
  }

  /** Yaw turned since the previous frame. */
  turned(): number {
    let d = this.yaw - this.prev.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Most cells the body has ever had (lost cells count against its integrity). */
  peakCells = 0;

  findBlock(id: number): number | null {
    for (const [key, cell] of this.cells) if (cell.id === id) return key;
    return null;
  }

  blockCount(): number {
    return this.cells.size;
  }

  recompute(): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const key of this.cells.keys()) {
      const x = kx(key);
      const y = ky(key);
      const z = kz(key);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (minX === Infinity) minX = maxX = minY = maxY = minZ = maxZ = 0;
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
    this.minZ = minZ;
    this.maxZ = maxZ;
    this.computeLegs();
    if (this.kind === 'fortress') this.computePower();
  }

  /** Lowest solid layer (the floor the legs hang under). */
  computeLegs(): void {
    let floor = Infinity;
    for (const [key, cell] of this.cells) if (blockDef(cell.id).solid) floor = Math.min(floor, ky(key));
    this.floorY = floor === Infinity ? 0 : floor;
  }

  /** Power flows from the Engine Core through connected Redstone Wire to adjacent machines. */
  computePower(): void {
    const powered = new Set<number>();
    const machines = new Set<number>();
    const core = this.findBlock(B.CORE);
    if (core !== null) {
      const queue: number[] = [];
      const visit = (key: number): void => {
        if (powered.has(key) || this.cells.get(key)?.id !== B.WIRE) return;
        powered.add(key);
        queue.push(key);
      };
      for (const [dx, dy, dz] of N6) visit(key3(kx(core) + dx, ky(core) + dy, kz(core) + dz));
      while (queue.length > 0) {
        const key = queue.shift()!;
        for (const [dx, dy, dz] of N6) visit(key3(kx(key) + dx, ky(key) + dy, kz(key) + dz));
      }
      for (const [key, cell] of this.cells) {
        if (!MACHINE_IDS.has(cell.id)) continue;
        if (this.selfPowered.has(key)) {
          machines.add(key);
          continue;
        }
        for (const [dx, dy, dz] of N6) {
          const next = key3(kx(key) + dx, ky(key) + dy, kz(key) + dz);
          if (powered.has(next) || next === core) {
            machines.add(key);
            break;
          }
        }
      }
    }
    this.poweredWires = powered;
    this.poweredMachines = machines;
  }

  /** Keys connected to root through neighbouring cells (6-neighbour). */
  connectedTo(root: number): Set<number> {
    const seen = new Set<number>();
    if (!this.cells.has(root)) return seen;
    const stack = [root];
    seen.add(root);
    while (stack.length > 0) {
      const key = stack.pop()!;
      for (const [dx, dy, dz] of N6) {
        const next = key3(kx(key) + dx, ky(key) + dy, kz(key) + dz);
        if (!seen.has(next) && this.cells.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  }

  cellCenter(x: number, y: number, z: number): { x: number; y: number; z: number } {
    const [wx, wy, wz] = this.toWorld(x + 0.5, y + 0.5, z + 0.5);
    return { x: wx, y: wy, z: wz };
  }

  /** World-axis bounding box of the (possibly turned) hull. */
  worldBounds(): { x0: number; x1: number; z0: number; z1: number } {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [lx, lz] of [[this.minX, this.minZ], [this.maxX + 1, this.minZ], [this.minX, this.maxZ + 1], [this.maxX + 1, this.maxZ + 1]] as const) {
      const [wx, , wz] = this.toWorld(lx, 0, lz);
      x0 = Math.min(x0, wx);
      x1 = Math.max(x1, wx);
      z0 = Math.min(z0, wz);
      z1 = Math.max(z1, wz);
    }
    return { x0, x1, z0, z1 };
  }

  get left(): number {
    return this.worldBounds().x0;
  }

  get right(): number {
    return this.worldBounds().x1;
  }

  get bottom(): number {
    return this.y + this.minY;
  }

  get top(): number {
    return this.y + this.maxY + 1;
  }

  /** Highest solid local y in a column, or null. */
  topSolid(x: number, z: number): number | null {
    for (let y = this.maxY; y >= this.minY; y -= 1) if (this.solidAt(x, y, z)) return y;
    return null;
  }
}
