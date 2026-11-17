import type { WardenKind } from './mainquest';
import { poseToLocal, type BlockBody } from './body';
import type { EffectId } from './effects';
import type { PlayerCtx } from './player-ctx';
import { GRAVITY, MAX_FALL, sweep, sweepHorizontal, type Grid } from './physics';

/**
 * The ladder (or vine) an actor holds: the grid it belongs to (a walking body, or null for the
 * world), its cell in that grid's frame, and the side its wall is on (index into DIRS 0..3).
 */
export interface LadderHold {
  body: BlockBody | null;
  x: number;
  y: number;
  z: number;
  dir: number;
  /** High up: the climber keeps hold rather than stepping off the open side into a fall. */
  grip: boolean;
}

/** Horizontal DIRS (0 +x, 1 -x, 2 +z, 3 -z). */
export const WALL_DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export type ActorKind =
  | 'player' | 'villager' | 'wolf' | 'chicken' | 'sheep'
  | 'zombie' | 'husk' | 'skeleton' | 'stray' | 'creeper' | 'spider' | 'cavespider' | 'phantom'
  | 'enderman' | 'witch' | 'slime' | 'witherskel' | 'ghast'
  | 'pillager' | 'vindicator' | 'evoker' | 'vex' | 'ravager' | 'wither'
  // The Long March: the swamp's drowned and bogged, the canyon's breezes, the snow's polar bears,
  // the ember wastes' blazes and magma cubes; the Brood Queen; and the folk of the new lands.
  | 'drowned' | 'bogged' | 'breeze' | 'polarbear' | 'blaze' | 'magmacube' | 'queen'
  | 'golem' | 'wtrader' | 'llama' | 'camel' | 'frog'
  // The main quest's last foe.
  | 'veyra'
  // The officers.
  | 'npc';
export type VillagerRole = 'villager' | 'smith' | 'farmer' | 'trader';

/** Body height, half width, health and walking speed of each kind (before the night's scaling). */
const STATS: Record<ActorKind, readonly [h: number, hw: number, hp: number, speed: number]> = {
  player: [1.8, 0.3, 20, 4.3],
  villager: [1.9, 0.3, 12, 2.6],
  wolf: [0.85, 0.3, 12, 5.2],
  chicken: [0.7, 0.2, 12, 1.1],
  sheep: [1.25, 0.42, 12, 0.9],
  zombie: [1.9, 0.3, 10, 1.6],
  husk: [1.98, 0.32, 11, 1.75],
  skeleton: [1.9, 0.3, 8, 1.7],
  stray: [1.9, 0.3, 8, 1.7],
  creeper: [1.62, 0.3, 8, 1.8],
  spider: [0.9, 0.55, 12, 3.1],
  cavespider: [0.5, 0.35, 7, 3.4],
  phantom: [0.6, 0.45, 9, 8],
  enderman: [2.9, 0.3, 20, 2.4],
  witch: [1.95, 0.3, 14, 1.35],
  slime: [1.04, 0.52, 8, 1.6],
  witherskel: [2.4, 0.35, 16, 2.1],
  ghast: [4, 2, 16, 2.6],
  pillager: [1.9, 0.3, 10, 2.1],
  vindicator: [1.9, 0.3, 14, 2.7],
  evoker: [1.9, 0.3, 18, 1.8],
  vex: [0.8, 0.2, 4, 6.5],
  ravager: [2.2, 0.95, 60, 2.3],
  wither: [6.6, 1.1, 300, 5],
  drowned: [1.95, 0.3, 14, 1.7],
  bogged: [1.9, 0.3, 10, 1.7],
  breeze: [1.8, 0.35, 16, 2.4],
  polarbear: [1.4, 0.7, 30, 2.7],
  blaze: [1.8, 0.3, 20, 2.0],
  magmacube: [1.04, 0.52, 8, 1.6],
  queen: [2.6, 1.7, 360, 3.0],
  golem: [2.7, 0.7, 100, 2.2],
  wtrader: [1.9, 0.3, 20, 2.0],
  llama: [1.87, 0.45, 22, 1.8],
  camel: [2.4, 0.8, 32, 2.2],
  frog: [0.5, 0.25, 10, 2.0],
  veyra: [7, 1.3, 700, 4.5],
  npc: [1.85, 0.3, 20, 1],
};

/** What a monster is busy doing beyond walking at you (an attack being wound up, a spell, a charge). */
export type ActKind = 'none' | 'draw' | 'pounce' | 'cast' | 'fangs' | 'summon' | 'drink' | 'throw' | 'charge' | 'roar' | 'stunned' | 'shoot' | 'grab' | 'scream';

export class Actor {
  kind: ActorKind;
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  hw = 0.3;
  h: number;
  /** Facing angle (yaw 0 = +X). */
  yaw = 0;
  onGround = false;
  standingOn: BlockBody | null = null;
  climbing = false;
  /** Ladder intent: 1 up, -1 down, 0 hold/slide. */
  climbIntent = 0;
  /** The way the climber keeps going with the stick let go (one push sends you to the end). */
  climbAuto = 0;
  /** The parachute: 0 packed, rising to 1 as the canopy fills (a player falling from high up). */
  chute = 0;
  wantJump = false;
  jumpCooldown = 0;
  hp: number;
  maxHp: number;
  hurt = 0;
  dead = false;
  /** Seconds since it fell (-1 while alive): the body tips over, flashes red, then puffs away. */
  deathT = -1;
  walkPhase = 0;
  attackTimer = 0;
  fuse = 0;
  stuck = 0;
  recruited = false;
  homeX: number;
  homeZ: number;
  idleTimer = 0;
  wanderYaw = 0;
  wandering = false;
  invulnerable = 0;
  /** Seconds reeling from the war horn's blast (no attacks, no chasing). */
  stun = 0;
  /** Seconds left winding up a blow (arms raised): it lands when this runs out, if you are still in reach. */
  windup = 0;
  speed: number;
  region = 0;
  burn = 0;
  /** Villager look (robe colours) and the structure they live in. */
  role: VillagerRole = 'villager';
  home = '';
  /** Skeleton bow cooldown. */
  shootTimer = 0;
  /** A village trader (sells for emeralds, sets the village quest). */
  trader = false;
  /** Held in a raiders' pen until the guards fall (then freed, waiting for you). */
  captive = false;
  freed = false;
  /** The quest camp a monster guards (or breeds at). */
  guardOf = '';
  /** Climbing a fortress leg: which leg and how far up (0..1). */
  climb: { leg: number; t: number; swinging: boolean } | null = null;
  /** The ladder held last step (a walking fortress carries its climbers along). */
  ladder: LadderHold | null = null;
  /** A golden creeper: it never blows up, it runs, and it is full of emeralds (seconds left before it burrows away). */
  golden = 0;
  /** Phantoms: circling high over the fortress, diving at a target, climbing away again. */
  fly: { mode: 'circle' | 'dive' | 'climb'; t: number; angle: number; radius: number; height: number; tx: number; ty: number; tz: number } | null = null;
  /** Flattened under a fortress foot (a pancake for a moment before it puffs away). */
  squash = 0;
  /** Farm animals: a sheep's fleece (1 woolly, 0 shorn, regrowing), seconds of panic, a hen's flapping. */
  wool = 1;
  panic = 0;
  flap = 0;
  /** Seconds left pecking (a hen) or grazing (a sheep), and how far down its head is (0..1). */
  munch = 0;
  head = 0;
  /** Which of the wool colours a sheep wears (see WOOL_TINTS). */
  tint = 0;
  /** Seconds until an animal next clucks or bleats; a hen that rides on your deck. */
  voice = 0;
  boarded = false;
  /** Game time of the last thing it said (speech bubbles keep a polite gap). */
  chat = -99;
  /** Fastest it falls (blocks/s): hens flutter down, and so does anyone holding one. */
  fallCap = MAX_FALL;

  // ---- monster variants and their moves
  /** A baby zombie: half size, twice as quick. */
  baby = false;
  /** A zombie villager (the villager's long face on a zombie). */
  zvillager = false;
  /** Iron armour pieces (0 none, 1 helmet, 2 helmet and chestplate) and what is left of them. */
  armor = 0;
  armorHp = 0;
  /** A creeper struck by lightning: it crackles blue and blows twice as big. */
  charged = false;
  /** Who rides on it (a skeleton on a spider, a vindicator on a ravager), and what it rides. */
  rider: Actor | null = null;
  mount: Actor | null = null;
  /** A slime's size (4 big, 2 medium, 1 small): big ones split when they die. */
  size = 1;
  /** An enderman's stolen block (0: empty hands), its anger and its next teleport. */
  carry = 0;
  anger = 0;
  tpTimer = 0;
  /** The move under way (see ActKind), seconds into it and how long it takes. */
  act: ActKind = 'none';
  actT = 0;
  actDur = 0;
  /** Strafing round its target: -1 / 1 (and seconds until it switches). */
  strafe = 1;
  strafeT = 0;
  /** An illager captain carries the ominous banner (killing him brings a Bad Omen). */
  captain = false;
  /** Seconds a vex has left (they fade away), or a summon's lifetime. */
  life = -1;
  /** Where its head looks, relative to its body (smoothed yaw, pitch). */
  headYaw = 0;
  headPitch = 0;
  /** Seconds until it next makes a noise. */
  voiceT = 0;
  /** A boss's name (bosses have their own bar). */
  boss: string | null = null;
  /** Seconds of a blade's poison or flame still working on it, and which. */
  sear = 0;
  searFire = false;
  /** An officer (see officers.ts): who they are. */
  npc = '';
  /** A main-quest warden (it fights its own way, see wardens.ts). */
  warden: WardenKind | null = null;
  /** The raid wave it came with (raiders count down the raid bar). */
  raid = -1;
  /** Seconds a ghast's mouth has been open (it fires when it has been open a moment). */
  mouth = 0;
  /** How it means to beat the fortress: 0 the usual (climb the legs), 1 a creeper sapping a leg's foot. */
  tactic = 0;
  /** Seconds the captain has looked straight at it (an enderman's patience). */
  stare = 0;
  /** A spare timer each kind uses its own way (a slime's next hop, an evoker's next spell...). */
  aux = 0;
  /** The potion in a witch's hand ('' none). */
  potion: '' | 'heal' | 'swift' | 'poison' | 'slowness' | 'weakness' | 'harm' = '';

  constructor(kind: ActorKind, x: number, y: number, z: number) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.z = z;
    this.homeX = x;
    this.homeZ = z;
    const [h, hw, hp, speed] = STATS[kind];
    this.h = h;
    this.hw = hw;
    this.maxHp = hp;
    this.hp = this.maxHp;
    this.speed = speed;
  }

  get cy(): number {
    return this.y + this.h / 2;
  }

  /** Up in the air on its own wings (phantoms, vexes, ghasts, the Wither): no climbing, no feet. */
  get flying(): boolean {
    return this.fly !== null || this.kind === 'vex' || this.kind === 'ghast' || this.kind === 'wither' || this.kind === 'blaze' || this.kind === 'veyra';
  }

  /** Makes a zombie a baby (smaller, faster) or a slime a given size. */
  resize(scale: number): void {
    const [h, hw] = STATS[this.kind];
    this.h = h * scale;
    this.hw = hw * scale;
  }
}

export interface ItemDrop {
  id: number;
  count: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  /** Resting on the fortress deck: its position in the fortress frame (it rides along). */
  on?: [number, number, number] | null;
}

export interface Projectile {
  /**
   * tnt: cannon shot; shell: mortar round; bolt: ballista or crossbow bolt; thrown: TNT you threw;
   * breaker: a Heartbreaker; arrow: a skeleton's (or a stray's); ibolt: a pillager's crossbow bolt;
   * fireball: a ghast's (bat it back!); skull / blueskull: the Wither's; potion: a witch's splash
   * potion; pearl: an ender pearl you threw; gshell: a shell from a giant's cannon (or a titan's
   * boulder); trident: a drowned's; wind: a breeze's wind charge (or one you threw); ember: a
   * blaze's small fireball; web: the Brood Queen's spit; crate: a TNT crate let go off the crane's hook.
   */
  kind: 'tnt' | 'arrow' | 'bolt' | 'shell' | 'thrown' | 'breaker' | 'ibolt' | 'fireball' | 'skull' | 'blueskull' | 'potion' | 'pearl' | 'gshell'
    | 'trident' | 'wind' | 'ember' | 'web' | 'crate';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  spin: number;
  fromCrew: boolean;
  /** Who loosed it (a deflected fireball goes back at its ghast). */
  owner?: Actor | null;
  /** Hit back by you: it now hurts monsters instead of you. */
  deflected?: boolean;
  /** What it leaves on whoever it hits (a stray's slowness, a witch's brew, the Wither's skulls). */
  effect?: EffectId;
  /** The player who fired or threw it (its hits, kills and pearl jumps are that player's). */
  by?: PlayerCtx | null;
  /** What a hurled lump is made of (a titan's boulders: sandstone, packed ice). */
  block?: number;
}

export interface FallingBlock {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  vr: number;
  age: number;
  drop: boolean;
}

export const JUMP_V = 8.4;
export const CLIMB_V = 4.4;
export const CLIMB_DOWN_V = 5.8;
export const SWIM_V = 3.4;
export const SINK_V = 2.2;

export interface MoveResult {
  hitWall: boolean;
  landed: boolean;
  fallSpeed: number;
  /** The body that carried the actor this step (its turn turns the actor's view too). */
  carrier: BlockBody | null;
  /** Stopped at an edge it would have fallen from. */
  edge?: boolean;
}

/**
 * Keeps a climber on the ladder's side of its wall: a ladder hanging free under the fortress
 * has no wall behind it, and walking "into" it would otherwise carry you straight through.
 */
function holdToLadder(a: Actor, h: LadderHold): void {
  const d = WALL_DIRS[h.dir];
  if (!d) return;
  const [lx, ly, lz] = h.body ? h.body.toLocal(a.x, a.y, a.z) : [a.x, a.y, a.z];
  // Only while the actor is in front of this rung (not beside it).
  if (d[0] !== 0 && (lz < h.z - 0.35 || lz > h.z + 1.35)) return;
  if (d[1] !== 0 && (lx < h.x - 0.35 || lx > h.x + 1.35)) return;
  const m = a.hw + 0.04;
  // The open side: while gripping, the climber's centre stays over the rung's cell.
  const g = h.grip ? 0.05 : -99;
  let nx = lx;
  let nz = lz;
  if (d[0] > 0) nx = Math.max(Math.min(nx, h.x + 1 - m), h.x + g);
  else if (d[0] < 0) nx = Math.min(Math.max(nx, h.x + m), h.x + 1 - g);
  if (d[1] > 0) nz = Math.max(Math.min(nz, h.z + 1 - m), h.z + g);
  else if (d[1] < 0) nz = Math.min(Math.max(nz, h.z + m), h.z + 1 - g);
  if (nx === lx && nz === lz) return;
  if (h.body) {
    const [wx, , wz] = h.body.toWorld(nx, ly, nz);
    a.x = wx;
    a.z = wz;
  } else {
    a.x = nx;
    a.z = nz;
  }
}

/**
 * Carries an actor along with the body it stands on (translation and turning) and turns its
 * facing with it. Returns the yaw the body turned this frame.
 */
export function carryActor(actor: Actor, body: BlockBody, worldOnly: Grid[]): number {
  const [lx, ly, lz] = poseToLocal(body.prev, actor.x, actor.y, actor.z);
  const [wx, wy, wz] = body.toWorld(lx, ly, lz);
  const dx = wx - actor.x;
  const dy = wy - actor.y;
  const dz = wz - actor.z;
  if (dy !== 0) actor.y += sweep(actor, 1, dy, worldOnly).d;
  if (dx !== 0 || dz !== 0) {
    const m = sweepHorizontal(actor, dx, dz, worldOnly);
    actor.x += m.dx;
    actor.z += m.dz;
  }
  const turned = body.turned();
  actor.yaw += turned;
  return turned;
}

/** Integrates one actor against the world and the moving block bodies. */
export function moveActor(actor: Actor, dt: number, grids: Grid[], worldOnly: Grid[], ladderAt: (a: Actor) => LadderHold | null, inFluid?: (a: Actor) => boolean, edgeGuard?: (a: Actor, x: number, z: number) => boolean): MoveResult {
  // Carried by what it stands on, or by the walking body whose ladder it is climbing.
  const carrier = actor.standingOn ?? actor.ladder?.body ?? null;
  const result: MoveResult = { hitWall: false, landed: false, fallSpeed: 0, carrier };
  if (carrier) carryActor(actor, carrier, worldOnly);
  const hold = ladderAt(actor);
  actor.ladder = hold;
  actor.climbing = hold !== null;
  const swimming = inFluid ? inFluid(actor) : false;
  if (actor.climbing) {
    actor.vy = actor.climbIntent > 0 ? CLIMB_V : actor.climbIntent < 0 ? -CLIMB_DOWN_V : -1.0;
  } else if (swimming) {
    // Water: sink slowly, hold jump to swim up (Minecraft-style buoyancy).
    actor.vy = actor.wantJump ? Math.min(actor.vy + 22 * dt, SWIM_V) : Math.max(actor.vy - 9 * dt, -SINK_V);
  } else {
    actor.vy = Math.max(-actor.fallCap, actor.vy - GRAVITY * dt);
  }
  if (actor.wantJump && actor.onGround && actor.jumpCooldown <= 0 && !actor.climbing && !swimming) {
    actor.vy = JUMP_V;
    actor.onGround = false;
    actor.standingOn = null;
    actor.jumpCooldown = 0.25;
  }
  const wantX = actor.vx * dt;
  const wantZ = actor.vz * dt;
  if (wantX !== 0 || wantZ !== 0) {
    const m = sweepHorizontal(actor, wantX, wantZ, grids);
    let mx = m.dx;
    let mz = m.dz;
    // Walking (not jumping) never carries you over a long drop: slide along the edge instead.
    if (edgeGuard && actor.onGround && !actor.wantJump && !actor.climbing && !edgeGuard(actor, actor.x + mx, actor.z + mz)) {
      if (edgeGuard(actor, actor.x + mx, actor.z)) mz = 0;
      else if (edgeGuard(actor, actor.x, actor.z + mz)) mx = 0;
      else {
        mx = 0;
        mz = 0;
      }
      result.edge = true;
    }
    actor.x += mx;
    actor.z += mz;
    if (!result.edge && Math.hypot(m.dx - wantX, m.dz - wantZ) > 1e-5) result.hitWall = true;
  }
  if (hold) holdToLadder(actor, hold);
  const fall = actor.vy;
  const sy = sweep(actor, 1, actor.vy * dt, grids);
  actor.y += sy.d;
  if (sy.hit) {
    if (actor.vy < 0) {
      if (!actor.onGround) result.landed = true;
      result.fallSpeed = -fall;
      actor.onGround = true;
      actor.standingOn = sy.hit.body;
    }
    actor.vy = 0;
  } else if (actor.vy !== 0) {
    actor.onGround = false;
    actor.standingOn = null;
  }
  if (actor.jumpCooldown > 0) actor.jumpCooldown -= dt;
  return result;
}
