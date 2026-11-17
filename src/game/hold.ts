// The Strider's hold: the village buildings the crane hoists aboard assemble themselves into a walled
// town on the fortress's back. Wings of deck grow out to port, starboard and over the bow; on them stand
// five lots, each a stack of storeys (a house over a forge over a mill...), their back walls the town's
// outer wall. Walkways run along the deck in front of them, galleries along every upper floor, and two
// stair towers at the bow corners climb to every level and out onto their roofs (each building has a
// ladder inside as well). Each kind of building has its own storey (its walls, windows, shutters and
// fittings, in the materials of the land it came from) and, at the top of its stack, its own roof: a
// gable with a chimney or a dormer, a windmill's cap, a gun platform, a forge chimney or a roof garden.
//
// The hold is a pure function of the buildings aboard (their kinds, the slots they were given and their
// lands), so it is never saved: it is planned again and the difference applied to the hull.
import { B } from './blocks';
import { key3 } from './body';
import { DIRECTIONAL_IDS, regionPalette, type StructKind } from './structures';
import type { Zone } from './terrain';

/** A building in the hold: what it is, the slot it fills, and the land its materials come from. */
export interface HoldEntry {
  kind: StructKind;
  slot: number;
  zone: Zone | null;
}

/** A planned hold, in fortress-local cells. */
export interface HoldPlan {
  /** key -> id | meta << 8. */
  cells: Map<number, number>;
  /** The slot a cell belongs to (its storey or roof), or -1 for the shared wings, towers and galleries. */
  owner: Map<number, number>;
  /** Deck cells (its old railing) the wings open up. */
  clear: Set<number>;
  /** Windmill hubs by slot: the hub's key, the way its sails face and how long they are. */
  hubs: Map<number, { key: number; dir: number; sail: number }>;
  /** Cannon turrets (the watchtowers') and the slots they belong to. */
  turrets: Array<{ key: number; slot: number }>;
  /** Chimney tops (they smoke). */
  chimneys: number[];
}

/** A lot: the fortress-local cell of its corner and its frame (u along the front, v away from the deck). */
interface Lot {
  ox: number;
  oz: number;
  u: readonly [number, number];
  v: readonly [number, number];
  W: number;
  D: number;
  wing: number;
}

/** Storey height, floor to floor. */
export const STOREY = 4;

/** Port (bow side, stern side), starboard (bow side, stern side), and the bow. */
const LOTS: readonly Lot[] = [
  { ox: 7, oz: -3, u: [1, 0], v: [0, -1], W: 7, D: 5, wing: 0 },
  { ox: 0, oz: -3, u: [1, 0], v: [0, -1], W: 7, D: 5, wing: 0 },
  { ox: 13, oz: 13, u: [-1, 0], v: [0, 1], W: 7, D: 5, wing: 1 },
  { ox: 6, oz: 13, u: [-1, 0], v: [0, 1], W: 7, D: 5, wing: 1 },
  { ox: 17, oz: 2, u: [0, 1], v: [1, 0], W: 7, D: 5, wing: 2 },
];

/** The stair towers at the bow corners: u 0 the corridor, u 1 the flights, u 2 and v 5 their walls. */
const TOWERS: readonly Lot[] = [
  { ox: 14, oz: -3, u: [1, 0], v: [0, -1], W: 3, D: 6, wing: 0 },
  { ox: 14, oz: 13, u: [1, 0], v: [0, 1], W: 3, D: 6, wing: 1 },
];

/**
 * The order slots fill: the ground floor all round, then up. The halls by the bow towers rise four
 * storeys, those at the stern three, and the bow keep two (the helm looks out over it).
 */
const ORDER: ReadonlyArray<readonly [lot: number, level: number]> = [
  [0, 0], [2, 0], [4, 0], [1, 0], [3, 0],
  [0, 1], [2, 1], [1, 1], [3, 1], [4, 1],
  [0, 2], [2, 2], [1, 2], [3, 2],
  [0, 3], [2, 3],
];

export const HOLD_SLOTS = ORDER.length;

/** The starting deck (its cells are the starter fortress's, never the plan's). */
const DECK = { x0: 0, x1: 14, z0: 0, z1: 10 };

function inDeck(x: number, z: number): boolean {
  return x >= DECK.x0 && x <= DECK.x1 && z >= DECK.z0 && z <= DECK.z1;
}

/** The next free slot for a building (-1: the hold is full). */
export function nextHoldSlot(entries: readonly HoldEntry[]): number {
  const used = new Set(entries.map((e) => e.slot));
  for (let i = 0; i < ORDER.length; i += 1) if (!used.has(i)) return i;
  return -1;
}

/** Middle of a slot's storey at its floor (fortress-local). */
export function holdSlotSpot(slot: number): { x: number; y: number; z: number } | null {
  const o = ORDER[slot];
  if (!o) return null;
  const lot = LOTS[o[0]]!;
  const [cx, cz] = lotXZ(lot, (lot.W - 1) / 2, (lot.D - 1) / 2);
  return { x: cx + 0.5, y: o[1] * STOREY, z: cz + 0.5 };
}

/** The way a slot's door faces (a fortress-local DIRS index): toward the deck. */
export function holdSlotFront(slot: number): number {
  const lot = LOTS[ORDER[slot]?.[0] ?? 0]!;
  return dirOf(-lot.v[0], -lot.v[1]);
}

function lotXZ(lot: Lot, u: number, v: number): [number, number] {
  return [lot.ox + lot.u[0] * u + lot.v[0] * v, lot.oz + lot.u[1] * u + lot.v[1] * v];
}

/** DIRS index of a horizontal unit vector. */
function dirOf(x: number, z: number): number {
  return x > 0 ? 0 : x < 0 ? 1 : z > 0 ? 2 : 3;
}

// ------------------------------------------------------------------ drafting

/** Frame directions: +u, -u, +v (away from the deck), -v (toward it). */
const U = 0;
const NU = 1;
const V = 2;
const NV = 3;
/** A lantern's meta hanging from above, a slab's in the top half of its cell. */
const HANG = 1;
const TOP = 1;
/** Banner colours (meta bits 3-4). */
const RED = 0 << 3;
const BLUE = 1 << 3;
const GREEN = 2 << 3;
const GOLD = 3 << 3;

/** Blocks whose meta is a frame direction (turned into the fortress's). */
const TURNS = new Set<number>([...DIRECTIONAL_IDS, B.SHUTTER, B.BANNER, B.PLANTER]);

class Draft {
  readonly cells = new Map<number, number>();
  readonly owner = new Map<number, number>();
  readonly clear = new Set<number>();
  readonly hubs = new Map<number, { key: number; dir: number; sail: number }>();
  readonly turrets: Array<{ key: number; slot: number }> = [];
  readonly chimneys: number[] = [];

  set(x: number, y: number, z: number, id: number, meta: number, who: number): void {
    const k = key3(x, y, z);
    if (id === B.AIR) {
      this.cells.delete(k);
      this.owner.delete(k);
      return;
    }
    this.cells.set(k, id | (meta << 8));
    this.owner.set(k, who);
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(key3(x, y, z));
  }
}

/** A lot's frame at a floor height: frame cells and directions onto the fortress, in a land's materials. */
class Frame {
  constructor(
    readonly d: Draft,
    readonly lot: Lot,
    readonly y0: number,
    readonly who: number,
    readonly pal: Map<number, number> | null,
  ) {}

  x(u: number, v: number): number {
    return this.lot.ox + this.lot.u[0] * u + this.lot.v[0] * v;
  }

  z(u: number, v: number): number {
    return this.lot.oz + this.lot.u[1] * u + this.lot.v[1] * v;
  }

  /** A frame direction as a fortress DIRS index. */
  dir(f: number): number {
    const L = this.lot;
    const [x, z] = f === U ? L.u : f === NU ? [-L.u[0], -L.u[1]] : f === V ? L.v : [-L.v[0], -L.v[1]];
    return dirOf(x, z);
  }

  set(u: number, y: number, v: number, id: number, meta = 0): void {
    const block = this.pal?.get(id) ?? id;
    const m = TURNS.has(id) ? (meta & ~7) | this.dir(meta & 7) : meta;
    this.d.set(this.x(u, v), this.y0 + y, this.z(u, v), block, m, this.who);
  }

  /** Sets a cell only where nothing is planned yet. */
  fill(u: number, y: number, v: number, id: number, meta = 0): void {
    if (!this.has(u, y, v)) this.set(u, y, v, id, meta);
  }

  del(u: number, y: number, v: number): void {
    this.d.set(this.x(u, v), this.y0 + y, this.z(u, v), B.AIR, 0, this.who);
  }

  has(u: number, y: number, v: number): boolean {
    return this.d.has(this.x(u, v), this.y0 + y, this.z(u, v));
  }

  key(u: number, y: number, v: number): number {
    return key3(this.x(u, v), this.y0 + y, this.z(u, v));
  }
}

// ------------------------------------------------------------------ the plan

interface Hold {
  d: Draft;
  /** The buildings of each lot, bottom up. */
  stacks: HoldEntry[][];
  /** Storeys in the tallest stack. */
  top: number;
  /** The stair towers stand once anything is two storeys high. */
  towers: boolean;
}

/** Plans the whole hold for the buildings aboard. */
export function holdPlan(entries: readonly HoldEntry[]): HoldPlan {
  const d = new Draft();
  const stacks: HoldEntry[][] = LOTS.map(() => []);
  for (const e of [...entries].sort((a, b) => a.slot - b.slot)) {
    const o = ORDER[e.slot];
    // (Slots fill bottom up, so a lot's storeys come in order.)
    if (o && stacks[o[0]]!.length === o[1]) stacks[o[0]]!.push(e);
  }
  const top = Math.max(0, ...stacks.map((s) => s.length));
  const h: Hold = { d, stacks, top, towers: top >= 2 };
  if (top === 0) return { cells: d.cells, owner: d.owner, clear: d.clear, hubs: d.hubs, turrets: d.turrets, chimneys: d.chimneys };
  wings(h);
  stacks.forEach((st, i) => {
    st.forEach((e, level) => {
      const last = level === st.length - 1;
      const f = new Frame(d, LOTS[i]!, level * STOREY, e.slot, e.zone ? regionPalette(e.zone) : null);
      storey(f, e.kind, level, last);
      if (last) roof(f, e.kind, i, h);
    });
  });
  if (h.towers) for (const t of TOWERS) stairTower(h, t);
  for (let level = 1; level < top; level += 1) galleries(h, level);
  tidy(d);
  return { cells: d.cells, owner: d.owner, clear: d.clear, hubs: d.hubs, turrets: d.turrets, chimneys: d.chimneys };
}

// ------------------------------------------------------------------ the wings

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function lotRect(lot: Lot): Rect {
  const [ax, az] = lotXZ(lot, 0, 0);
  const [bx, bz] = lotXZ(lot, lot.W - 1, lot.D - 1);
  return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) };
}

function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * The wings under the lots in use: the buildings' own footprints (their back walls stand on the
 * edge) and a walkway two wide between them and the deck, planked, on a stone hull with a skirt of
 * portholes, iron corners, hanging lanterns and vines, railed where it is open.
 */
function wings(h: Hold): void {
  const { d } = h;
  const floor = new Set<number>();
  const built: Rect[] = [];
  const ck = (x: number, z: number): number => (x + 64) * 256 + (z + 64);
  const add = (r: Rect): void => {
    for (let z = r.z0; z <= r.z1; z += 1) for (let x = r.x0; x <= r.x1; x += 1) if (!inDeck(x, z)) floor.add(ck(x, z));
  };
  for (let w = 0; w < 3; w += 1) {
    const rs = LOTS.filter((lot, i) => lot.wing === w && h.stacks[i]!.length > 0).map(lotRect);
    if (rs.length === 0) continue;
    if (h.towers && w < 2) rs.push(lotRect(TOWERS[w]!));
    for (const r of rs) {
      add(r);
      built.push(r);
    }
    const x0 = Math.min(...rs.map((r) => r.x0));
    const x1 = Math.max(...rs.map((r) => r.x1));
    if (w === 0) add({ x0, x1, z0: -2, z1: -1 });
    else if (w === 1) add({ x0, x1, z0: 11, z1: 12 });
    else add({ x0: 15, x1: 16, z0: 0, z1: 10 });
  }
  const isFloor = (x: number, z: number): boolean => inDeck(x, z) || floor.has(ck(x, z));
  for (const k of floor) {
    const x = Math.floor(k / 256) - 64;
    const z = (k % 256) - 64;
    const open = N4.filter(([dx, dz]) => !isFloor(x + dx, z + dz));
    const rim = open.length > 0;
    const underRoof = built.some((r) => inRect(r, x, z));
    d.set(x, 0, z, rim ? B.COBBLE : (x * 3 + z) % 7 === 0 ? B.PLANKS : B.SPRUCE_PLANKS, 0, -1);
    d.set(x, -1, z, (x + z) % 4 === 0 ? B.STONE_BRICKS : B.SMOOTH_STONE, 0, -1);
    for (const [dx, dz] of N4) if (inDeck(x + dx, z + dz)) {
      d.clear.add(key3(x + dx, 1, z + dz));
      d.clear.add(key3(x + dx, 2, z + dz));
    }
    if (!rim) continue;
    // The stone skirt round the edge, portholes along it, iron and a lantern under each corner.
    const corner = open.length >= 2;
    const h5 = (x * 7 + z * 3) % 5;
    d.set(x, -2, z, corner ? B.IRON_BLOCK : (x + z) % 4 === 2 ? B.GLASS : h5 === 0 ? B.MOSSY_STONE_BRICKS : h5 === 3 ? B.COBBLE : B.STONE_BRICKS, 0, -1);
    if (corner) d.set(x, -3, z, B.LANTERN, HANG, -1);
    else if ((x * 5 + z * 3) % 11 === 0) {
      // Vines trail down the skirt's face.
      const [dx, dz] = open[0]!;
      for (let y = -2; y >= -4; y -= 1) d.set(x + dx, y, z + dz, B.VINE, dirOf(-dx, -dz), -1);
    }
    // A railing where the walkway is open, stone posts with lanterns at its corners and every few blocks.
    if (underRoof) continue;
    const post = corner || (x + z) % 6 === 0;
    d.set(x, 1, z, post ? B.STONE_BRICKS : B.FENCE, 0, -1);
    if (post) d.set(x, 2, z, B.LANTERN, 0, -1);
  }
}

// ------------------------------------------------------------------ storeys

/**
 * One storey of a building in its lot's frame (7 wide, 5 deep; floor at y 0, walls 1..3, the next
 * floor at 4). The front (v 0) faces the deck: its door opens onto the walkway or the gallery.
 */
function storey(f: Frame, kind: StructKind, level: number, last: boolean): void {
  const { W, D } = f.lot;
  const ground = level === 0;
  // Floor: a stone course round the ground floor, oak beams round those above (with the ladder's hatch).
  for (let v = 0; v < D; v += 1) {
    for (let u = 0; u < W; u += 1) {
      if (!ground && u === W - 2 && v === D - 2) continue;
      const rim = u === 0 || v === 0 || u === W - 1 || v === D - 1;
      f.set(u, 0, v, rim ? (ground ? B.STONE_BRICKS : B.LOG) : kind === 'smithy' || kind === 'watchtower' ? B.COBBLE : B.PLANKS);
    }
  }
  switch (kind) {
    case 'watchtower':
      towerStorey(f, last);
      break;
    case 'smithy':
      smithyStorey(f, ground);
      break;
    case 'farm':
      farmStorey(f, ground, last);
      return;
    case 'windmill':
      millStorey(f, ground, last);
      break;
    default:
      houseStorey(f, kind === 'cottage', ground);
  }
  // A ladder up the back corner to the floor above (or out onto a flat roof), a lantern over the door.
  const climb = !last || kind === 'watchtower' || kind === 'smithy';
  for (let y = 1; y <= (climb ? STOREY : 3); y += 1) f.set(W - 2, y, D - 2, B.LADDER, V);
  f.set(3, 3, -1, B.LANTERN, HANG);
}

/** Timber walls: log posts at the corners and the middle of the long walls, a base course on the ground. */
function frameWalls(f: Frame, wall: number, post: number, base: number, ground: boolean): void {
  const { W, D } = f.lot;
  for (let y = 1; y <= 3; y += 1) {
    for (let v = 0; v < D; v += 1) {
      for (let u = 0; u < W; u += 1) {
        const edgeU = u === 0 || u === W - 1;
        const edgeV = v === 0 || v === D - 1;
        if (!edgeU && !edgeV) continue;
        const corner = edgeU && edgeV;
        if (corner || (y === 3 && edgeV)) f.set(u, y, v, post);
        else if (y === 1 && ground) f.set(u, y, v, base);
        else f.set(u, y, v, wall);
      }
    }
  }
}

function houseStorey(f: Frame, cottage: boolean, ground: boolean): void {
  const { W } = f.lot;
  frameWalls(f, cottage ? B.SPRUCE_PLANKS : B.PLANKS, cottage ? B.SPRUCE_LOG : B.LOG, cottage ? B.COBBLE : B.STONE_BRICKS, ground);
  // The door; two front windows with their shutters; two at the back over flower boxes; one each end.
  f.del(3, 1, 0);
  f.del(3, 2, 0);
  for (const u of [1, 5]) {
    f.set(u, 2, 0, B.GLASS_PANE);
    f.set(u - 1, 2, -1, B.SHUTTER, V);
    f.set(u + 1, 2, -1, B.SHUTTER, V);
  }
  for (const u of [2, 4]) {
    f.set(u, 2, 4, B.GLASS_PANE);
    f.set(u, 1, 5, B.PLANTER, NV);
  }
  for (const u of [1, 3, 5]) f.set(u, 2, 5, B.SHUTTER, NV);
  f.set(0, 2, 2, B.GLASS_PANE);
  f.set(W - 1, 2, 2, B.GLASS_PANE);
  // Inside: a workbench, a barrel, the stove and books along the back; a lamp overhead.
  f.set(1, 1, 3, B.CRAFTING_TABLE, NV);
  f.set(2, 1, 3, cottage ? B.CHEST : B.BARREL, NV);
  f.set(3, 1, 3, B.FURNACE, NV);
  f.set(4, 1, 3, B.BOOKSHELF);
  f.set(3, 3, 2, B.LANTERN, HANG);
  if (cottage) {
    f.set(1, 1, 1, B.HAY);
    f.set(5, 1, 1, B.BARREL);
    f.set(5, 2, 1, B.BARREL);
  } else f.set(5, 1, 1, B.BOOKSHELF);
}

function millStorey(f: Frame, ground: boolean, last: boolean): void {
  const { W } = f.lot;
  frameWalls(f, B.PLANKS, B.LOG, B.COBBLE, ground);
  // A band of white wool under the beams, the millstone on its shaft, sacks of grain (hay).
  for (let u = 1; u < W - 1; u += 1) {
    if (u !== 3) f.set(u, 2, 0, B.WOOL);
    f.set(u, 2, 4, B.WOOL);
  }
  f.del(3, 1, 0);
  f.del(3, 2, 0);
  f.set(1, 2, 0, B.GLASS_PANE);
  f.set(5, 2, 0, B.GLASS_PANE);
  f.set(0, 2, 2, B.GLASS_PANE);
  f.set(W - 1, 2, 2, B.GLASS_PANE);
  f.set(3, 1, 2, B.SMOOTH_STONE);
  f.set(3, 2, 2, B.LOG);
  f.set(3, 3, 2, B.LOG);
  f.set(1, 1, 3, B.HAY);
  f.set(2, 1, 3, B.HAY);
  f.set(1, 2, 3, B.HAY);
  f.set(1, 3, 1, B.LANTERN, HANG);
  // The hub on its axle out through the back wall: the sails turn on it, out over the edge.
  f.set(3, 2, 5, B.WINDMILL_HUB, V);
  f.d.hubs.set(f.who, { key: f.key(3, 2, 5), dir: f.dir(V), sail: last ? 4.5 : 3.4 });
  // A blue banner either side of it.
  f.set(1, 3, 5, B.BANNER, NV | BLUE);
  f.set(5, 3, 5, B.BANNER, NV | BLUE);
}

function towerStorey(f: Frame, last: boolean): void {
  const { W, D } = f.lot;
  // Rough stone walls (stone bricks with mossy, cracked and cobble patches), iron at the corners.
  for (let y = 1; y <= 3; y += 1) {
    for (let v = 0; v < D; v += 1) {
      for (let u = 0; u < W; u += 1) {
        const edgeU = u === 0 || u === W - 1;
        const edgeV = v === 0 || v === D - 1;
        if (!edgeU && !edgeV) continue;
        const h = (u * 7 + v * 3 + y * 5 + f.y0) % 9;
        f.set(u, y, v, edgeU && edgeV ? B.STONE_BRICKS : h === 0 ? B.MOSSY_STONE_BRICKS : h === 4 ? B.COBBLE : h === 7 ? B.CRACKED_STONE_BRICKS : B.STONE_BRICKS);
      }
    }
  }
  f.del(3, 1, 0);
  f.del(3, 2, 0);
  for (const u of [1, 5]) f.set(u, 2, 0, B.GLASS_PANE);
  for (const v of [1, 3]) {
    f.set(0, 2, v, B.GLASS_PANE);
    f.set(W - 1, 2, v, B.GLASS_PANE);
  }
  // Red banners down the outer wall.
  f.set(1, 2, 5, B.BANNER, NV | RED);
  f.set(5, 2, 5, B.BANNER, NV | RED);
  f.set(3, 3, 2, B.LANTERN, HANG);
  f.set(1, 1, 3, B.BARREL);
  f.set(2, 1, 3, B.BARREL);
  f.set(1, 1, 1, B.CHEST, U);
  if (!last) {
    // Mid-stack: the cannon stands at a gun port in the outer wall.
    f.del(3, 2, D - 1);
    f.set(3, 1, D - 2, B.CANNON);
    f.d.turrets.push({ key: f.key(3, 1, D - 2), slot: f.who });
  }
}

function smithyStorey(f: Frame, ground: boolean): void {
  const { W, D } = f.lot;
  for (let y = 1; y <= 3; y += 1) {
    for (let v = 0; v < D; v += 1) {
      for (let u = 0; u < W; u += 1) {
        const edgeU = u === 0 || u === W - 1;
        const edgeV = v === 0 || v === D - 1;
        if (!edgeU && !edgeV) continue;
        f.set(u, y, v, edgeU && edgeV ? B.COBBLE : y === 1 && ground ? B.COBBLE : B.STONE_BRICKS);
      }
    }
  }
  // A wide workshop front under a spruce lintel.
  for (let u = 1; u <= 5; u += 1) {
    f.del(u, 1, 0);
    f.del(u, 2, 0);
    f.set(u, 3, 0, B.SPRUCE_LOG);
  }
  f.set(0, 2, 2, B.GLASS_PANE);
  f.set(W - 1, 2, 2, B.GLASS_PANE);
  f.set(2, 2, 4, B.GLASS_PANE);
  // The forge: a glowing hearth in brick, furnaces, the anvil, a barrel of quench water.
  f.set(1, 1, 3, B.GLOWSTONE);
  f.set(1, 2, 3, B.BRICKS);
  f.set(1, 3, 3, B.BRICKS);
  f.set(2, 1, 3, B.FURNACE, NV);
  f.set(3, 1, 3, B.FURNACE, NV);
  f.set(4, 1, 2, B.IRON_BLOCK);
  f.set(4, 1, 3, B.BARREL);
  f.set(3, 3, 2, B.LANTERN, HANG);
  // A gold banner by the door.
  f.set(0, 2, -1, B.BANNER, V | GOLD);
  f.set(6, 2, -1, B.BANNER, V | GOLD);
}

function farmStorey(f: Frame, ground: boolean, last: boolean): void {
  const { W, D } = f.lot;
  const hatch = (u: number, v: number): boolean => !ground && u === W - 2 && v === D - 2;
  // Beds of wheat either side of a path, framed in logs, rails round them (a gate at the front);
  // posts at the corners carry any floor above, and a ladder climbs one of them.
  for (let v = 0; v < D; v += 1) {
    for (let u = 0; u < W; u += 1) {
      const edgeU = u === 0 || u === W - 1;
      const edgeV = v === 0 || v === D - 1;
      if (edgeU || edgeV) {
        f.set(u, 0, v, B.SPRUCE_LOG);
        if (edgeU && edgeV && !last) for (let y = 1; y <= 3; y += 1) f.set(u, y, v, B.SPRUCE_LOG);
        else if (!(v === 0 && u === 3)) f.set(u, 1, v, B.FENCE);
        continue;
      }
      if (hatch(u, v)) continue;
      if (v === 2) f.set(u, 0, v, B.PATH);
      else {
        f.set(u, 0, v, B.FARMLAND);
        f.set(u, 1, v, B.WHEAT);
      }
    }
  }
  if (!last) {
    for (let y = 1; y <= 3; y += 1) f.set(W - 2, y, D - 1, B.SPRUCE_LOG);
    for (let y = 1; y <= STOREY; y += 1) f.set(W - 2, y, D - 2, B.LADDER, V);
    f.set(1, 3, 1, B.LANTERN, HANG);
    f.set(4, 3, 1, B.LANTERN, HANG);
  } else {
    // Out in the sun: lanterns on the corner posts and a scarecrow.
    for (const [u, v] of [[0, 0], [W - 1, 0], [0, D - 1], [W - 1, D - 1]] as const) f.set(u, 2, v, B.LANTERN, 0);
    f.set(3, 1, 3, B.FENCE);
    f.set(3, 2, 3, B.HAY);
    f.set(2, 2, 3, B.FENCE);
    f.set(4, 2, 3, B.FENCE);
  }
  // Lamps on the gateposts.
  f.set(2, 2, 0, B.LANTERN, 0);
  f.set(4, 2, 0, B.LANTERN, 0);
}

// ------------------------------------------------------------------ roofs

function roof(f: Frame, kind: StructKind, lot: number, h: Hold): void {
  switch (kind) {
    case 'watchtower':
      gunPlatform(f);
      break;
    case 'smithy':
      forgeRoof(f);
      break;
    case 'farm':
      break;
    case 'windmill':
      millCap(f);
      break;
    case 'cottage':
      gable(f, B.OAK_STAIRS, B.OAK_SLAB, B.SPRUCE_PLANKS, false, lot, h);
      break;
    default:
      gable(f, B.SPRUCE_STAIRS, B.SPRUCE_SLAB, B.PLANKS, true, lot, h);
  }
}

/** Whether the lot beside a lot's u side stands higher than a height (its gable then has no overhang). */
function besideTall(lot: number, side: -1 | 1, y: number, h: Hold): boolean {
  const L = LOTS[lot]!;
  const [x, z] = lotXZ(L, side < 0 ? -1 : L.W, 2);
  if (h.towers && TOWERS.some((t) => inRect(lotRect(t), x, z))) return true;
  return LOTS.some((o, i) => i !== lot && inRect(lotRect(o), x, z) && h.stacks[i]!.length * STOREY > y);
}

/** A gable roof along the lot (its ridge down the middle) with gable ends in planks and a window. */
function gable(f: Frame, stairs: number, slab: number, gableWall: number, chimney: boolean, lot: number, h: Hold): void {
  const { W, D } = f.lot;
  const lo = besideTall(lot, -1, f.y0 + 4, h) ? 0 : -1;
  const hi = besideTall(lot, 1, f.y0 + 4, h) ? W - 1 : W;
  // The attic floor.
  for (let v = 0; v < D; v += 1) for (let u = 0; u < W; u += 1) f.set(u, 4, v, B.PLANKS);
  for (let k = 0; k <= 3; k += 1) {
    const y = 4 + k;
    const front = -1 + k;
    const back = D - k;
    for (let u = lo; u <= hi; u += 1) {
      if (front < back) {
        f.set(u, y, front, stairs, V);
        f.set(u, y, back, stairs, NV);
      } else if (front === back) f.set(u, y, front, slab, 0);
    }
    // The gable ends under the slopes.
    if (k > 0) {
      for (let v = front + 1; v < back; v += 1) {
        f.set(0, y, v, gableWall);
        f.set(W - 1, y, v, gableWall);
      }
    }
  }
  f.set(0, 5, 2, B.GLASS_PANE);
  f.set(W - 1, 5, 2, B.GLASS_PANE);
  if (chimney) {
    for (let y = 4; y <= 8; y += 1) f.set(W - 2, y, D - 1, B.BRICKS);
    f.d.chimneys.push(f.key(W - 2, 8, D - 1));
  } else {
    // A dormer over the door: a window between plank cheeks under its own little roof.
    f.set(2, 5, 0, gableWall);
    f.set(3, 5, 0, B.GLASS_PANE);
    f.set(4, 5, 0, gableWall);
    for (let u = 2; u <= 4; u += 1) f.set(u, 6, 0, stairs, V);
  }
}

/** The windmill's cap: a drum one in from the walls and a steep hip of spruce on it, a pennant on top. */
function millCap(f: Frame): void {
  const { W, D } = f.lot;
  for (let v = 0; v < D; v += 1) for (let u = 0; u < W; u += 1) f.set(u, 4, v, B.PLANKS);
  for (let v = 1; v < D - 1; v += 1) for (let u = 1; u < W - 1; u += 1) if (u === 1 || u === W - 2 || v === 1 || v === D - 2) f.set(u, 5, v, B.PLANKS);
  f.set(3, 5, 1, B.GLASS_PANE);
  hipRoof(f, 0, W - 1, 0, D - 1, 6, B.SPRUCE_STAIRS, B.SPRUCE_PLANKS);
  const y = 6 + Math.ceil(Math.min(W, D) / 2);
  f.set(3, y, 2, B.SPRUCE_PLANKS);
  f.set(3, y + 1, 2, B.FENCE);
  f.set(3, y + 2, 2, B.FENCE);
  f.set(3, y + 2, 1, B.BANNER, V | BLUE);
}

/** A hipped roof over u0..u1 x v0..v1 from height y: rings of stairs stepping in, each laid on planks. */
function hipRoof(f: Frame, u0: number, u1: number, v0: number, v1: number, y0: number, stairs: number, fill: number): void {
  let [a, b, c, e, y] = [u0, u1, v0, v1, y0];
  while (a <= b && c <= e) {
    for (let v = c; v <= e; v += 1) {
      for (let u = a; u <= b; u += 1) {
        const edge = u === a || u === b || v === c || v === e;
        if (!edge) f.set(u, y, v, fill);
        else if (v === c && c !== e) f.set(u, y, v, stairs, V);
        else if (v === e && c !== e) f.set(u, y, v, stairs, NV);
        else if (u === a && a !== b) f.set(u, y, v, stairs, U);
        else if (u === b && a !== b) f.set(u, y, v, stairs, NU);
        else f.set(u, y, v, B.SPRUCE_SLAB);
      }
    }
    a += 1;
    b -= 1;
    c += 1;
    e -= 1;
    y += 1;
  }
}

/** A watchtower's top: a stone floor, a crenellated parapet, the cannon, banners and corner lamps. */
function gunPlatform(f: Frame): void {
  const { W, D } = f.lot;
  for (let v = 0; v < D; v += 1) for (let u = 0; u < W; u += 1) if (!(u === W - 2 && v === D - 2)) f.set(u, 4, v, B.STONE_BRICKS);
  for (let v = 0; v < D; v += 1) {
    for (let u = 0; u < W; u += 1) {
      const edgeU = u === 0 || u === W - 1;
      const edgeV = v === 0 || v === D - 1;
      if (!edgeU && !edgeV) continue;
      if (edgeU && edgeV) {
        f.set(u, 5, v, B.STONE_BRICKS);
        f.set(u, 6, v, B.STONE_BRICKS);
        f.set(u, 7, v, B.LANTERN, 0);
      } else f.set(u, 5, v, (u + v) % 2 === 0 ? B.STONE_BRICKS : B.COBBLE_WALL);
    }
  }
  f.set(3, 5, 2, B.CANNON);
  f.d.turrets.push({ key: f.key(3, 5, 2), slot: f.who });
  // Banners hang from the parapet down the outer wall and the ends.
  f.set(3, 4, D, B.BANNER, NV | RED);
  f.set(-1, 4, 2, B.BANNER, U | RED);
  f.set(W, 4, 2, B.BANNER, NU | RED);
}

/** The smithy's top: a flat stone roof with a parapet and the forge's tall brick chimney. */
function forgeRoof(f: Frame): void {
  const { W, D } = f.lot;
  for (let v = 0; v < D; v += 1) for (let u = 0; u < W; u += 1) if (!(u === W - 2 && v === D - 2)) f.set(u, 4, v, B.COBBLE);
  for (let v = 0; v < D; v += 1) {
    for (let u = 0; u < W; u += 1) {
      const edge = u === 0 || v === 0 || u === W - 1 || v === D - 1;
      if (edge) f.set(u, 5, v, B.COBBLE_WALL);
    }
  }
  for (let y = 4; y <= 9; y += 1) {
    f.set(1, y, D - 2, B.BRICKS);
    f.set(1, y, D - 1, B.BRICKS);
  }
  f.set(1, 10, D - 2, B.BRICK_SLAB);
  f.d.chimneys.push(f.key(1, 10, D - 2));
}

// ------------------------------------------------------------------ stair towers and galleries

/**
 * A stair tower at a bow corner: flights up its middle column (each rises a storey from the back
 * toward the deck and lands on that floor's gallery), a corridor along its inner column back to the
 * foot of the next flight, stone walls with windows round the rest, and a ladder from the top corridor
 * up onto its crenellated roof.
 */
function stairTower(h: Hold, t: Lot): void {
  const f = new Frame(h.d, t, 0, -1, null);
  const levels = h.top - 1;
  const topY = levels * STOREY;
  for (let n = 1; n <= levels; n += 1) {
    const y0 = (n - 1) * STOREY;
    for (let k = 0; k < 4; k += 1) {
      const v = 4 - k;
      f.set(1, y0 + 1 + k, v, B.COBBLE_STAIRS, NV);
      if (n === 1) for (let y = 1; y < 1 + k; y += 1) f.set(1, y, v, B.STONE_BRICKS);
    }
    f.set(1, y0 + STOREY, 0, B.STONE_BRICKS);
    for (let v = 0; v <= 4; v += 1) f.set(0, y0 + STOREY, v, B.STONE_BRICKS);
  }
  // The floor, the outer walls (a window at every floor), lintels over the doorways in front, and
  // the side by the hall next door wherever that hall does not reach.
  for (let v = 0; v <= 5; v += 1) for (let u = 0; u <= 2; u += 1) f.set(u, 0, v, B.STONE_BRICKS);
  for (let y = 1; y <= topY + 3; y += 1) {
    const win = y % STOREY === 2;
    for (const u of [0, 1, 2]) f.set(u, y, 5, win && u === 1 ? B.GLASS_PANE : (u + y) % 5 === 0 ? B.MOSSY_STONE_BRICKS : B.STONE_BRICKS);
    for (let v = 0; v <= 4; v += 1) f.set(2, y, v, win && v === 2 ? B.GLASS_PANE : (v + y) % 7 === 0 ? B.CRACKED_STONE_BRICKS : B.STONE_BRICKS);
    for (let v = 0; v <= 4; v += 1) f.fill(-1, y, v, B.STONE_BRICKS);
    if (y % STOREY === 3) for (const u of [0, 1]) f.set(u, y, 0, B.STONE_BRICKS);
  }
  // Its roof and battlements (a gap where the ladder comes up), a lamp, banners down its sides.
  for (let v = 0; v <= 5; v += 1) for (let u = 0; u <= 2; u += 1) if (!(u === 0 && v === 4)) f.set(u, topY + 4, v, B.STONE_BRICKS);
  for (let v = 0; v <= 5; v += 1) {
    for (const u of [0, 2]) {
      if (u === 0 && v === 4) continue;
      f.set(u, topY + 5, v, v % 2 === 0 ? B.STONE_BRICKS : B.COBBLE_WALL);
    }
  }
  f.set(1, topY + 5, 0, B.COBBLE_WALL);
  f.set(1, topY + 5, 5, B.COBBLE_WALL);
  for (let y = 1; y <= 4; y += 1) f.set(0, topY + y, 4, B.LADDER, V);
  f.set(1, topY + 3, 2, B.LANTERN, HANG);
  // A lookout on top: spruce posts at the corners carrying a hipped roof, lamps under it, a pennant.
  for (const [u, v] of [[0, 0], [2, 0], [0, 5], [2, 5]] as const) for (let y = 6; y <= 7; y += 1) f.set(u, topY + y, v, B.SPRUCE_LOG);
  hipRoof(f, -1, 3, -1, 6, topY + 8, B.SPRUCE_STAIRS, B.SPRUCE_PLANKS);
  f.set(1, topY + 7, 2, B.LANTERN, HANG);
  f.set(1, topY + 7, 3, B.LANTERN, HANG);
  f.set(1, topY + 11, 2, B.FENCE);
  f.set(1, topY + 12, 2, B.FENCE);
  f.set(1, topY + 12, 1, B.BANNER, V | GOLD);
  for (let n = 0; n <= levels; n += 1) {
    f.set(3, n * STOREY + 2, 2, B.BANNER, NU | GOLD);
    f.set(1, n * STOREY + 2, 6, B.BANNER, NV | GOLD);
  }
}

/**
 * The galleries of one upper floor: a walk of slabs along the front of every hall that stands this
 * high (from the stair tower back along the wing as far as they reach), a rail on the deck side,
 * posts down to the floor below and lanterns hung under the walk; round the bow when the keep
 * stands this high too.
 */
function galleries(h: Hold, level: number): void {
  const { d } = h;
  const y = level * STOREY;
  const reach = (i: number): boolean => h.stacks[i]!.length > level;
  const walk = (x: number, z: number): void => {
    if (!d.has(x, y, z)) d.set(x, y, z, B.OAK_SLAB, TOP, -1);
  };
  const rail = (x: number, z: number): void => {
    walk(x, z);
    if (!d.has(x, y + 1, z)) d.set(x, y + 1, z, B.FENCE, 0, -1);
  };
  const post = (x: number, z: number): void => {
    for (let py = y - STOREY + 1; py < y; py += 1) {
      const k = key3(x, py, z);
      const id = (d.cells.get(k) ?? 0) & 255;
      if (id === B.AIR || id === B.FENCE || id === B.LANTERN) d.set(x, py, z, B.LOG, 0, -1);
    }
  };
  const lamp = (x: number, z: number): void => {
    if (!d.has(x, y - 1, z)) d.set(x, y - 1, z, B.LANTERN, HANG, -1);
  };
  const bow = reach(4);
  for (const s of [{ lots: [0, 1], walkZ: -2, railZ: -1 }, { lots: [2, 3], walkZ: 12, railZ: 11 }]) {
    // From the tower (x 14..16) back along the halls that reach this floor without a gap.
    let x0 = 14;
    for (const i of s.lots) {
      if (!reach(i)) break;
      x0 = lotRect(LOTS[i]!).x0;
    }
    const x1 = 16;
    for (let x = x0; x <= x1; x += 1) {
      walk(x, s.walkZ);
      if (x < x1 || !bow) rail(x, s.railZ);
      if ((x - x0) % 4 === 2) lamp(x, s.walkZ);
    }
    // Rails across the ends (the bow end turns the corner when the keep's gallery is there).
    rail(x0 - 1, s.walkZ);
    rail(x0 - 1, s.railZ);
    if (!bow) {
      rail(x1 + 1, s.walkZ);
      rail(x1 + 1, s.railZ);
    }
    for (let x = x0; x <= 15; x += 4) post(x, s.railZ);
    post(15, s.railZ);
  }
  if (!bow) return;
  // The bow keep's gallery joins them round the front.
  for (let z = -2; z <= 12; z += 1) {
    walk(16, z);
    if (z >= -1 && z <= 11) rail(15, z);
    if (z % 4 === 1) lamp(16, z);
  }
  for (const z of [3, 7]) post(15, z);
}

/** Lanterns hang from something and stand on something; any left with nothing there go. */
function tidy(d: Draft): void {
  for (const [k, v] of [...d.cells]) {
    if ((v & 255) !== B.LANTERN) continue;
    const hang = ((v >> 8) & 1) === 1;
    if (!d.cells.has(k + (hang ? 16384 : -16384))) {
      d.cells.delete(k);
      d.owner.delete(k);
    }
  }
}
