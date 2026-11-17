// One player's own state: the body, the view, what is in hand, cooldowns, health effects and
// hunger, where its interface and feedback go. The Game reads and writes these through accessors
// on whichever player is "acting" (normally this device's own; on a co-op host, the partner's
// while one of the partner's actions or the monsters hunting the partner are being run).
import type { ContextAction } from './build';
import type { Effect, EffectId } from './effects';
import type { BlockBody } from './body';
import type { OverSide } from './chute';
import { Actor } from './entities';
import type { GameUI, Ray, Target } from './game';
import type { Grapple } from './relics';
import type { Renderer } from './render';

/** Where a remote player's feedback goes (the co-op host forwards it to the partner's device). */
export interface PlayerSink {
  sfx(name: string, material: string, volume: number, rate: number): void;
  buzz(ms: number): void;
  punch(amount: number): void;
  shake(amount: number): void;
  feat(id: string, n: number): void;
  hurt(amount: number, knockX: number, knockZ: number): void;
  /** Thrown through the air (a giant's shrug). */
  fling(vx: number, vy: number, vz: number): void;
  /** One of this player's shots connected (the crosshair's hit marker). */
  hitmark(kill: boolean): void;
  /** The host moved this player (a respawn, a pearl, being hauled aboard). */
  moved(): void;
}

export interface Leap {
  body: BlockBody;
  lx: number;
  ly: number;
  lz: number;
  sx: number;
  sy: number;
  sz: number;
  t: number;
  dur: number;
  arc: number;
}

/** A landed parachute settling where its jumper came down. */
export interface ChuteFold {
  x: number;
  y: number;
  z: number;
  yaw: number;
  open: number;
  t: number;
}

/** Pushing against the deck's rail or edge: when last, which way (world) and where. */
export interface EdgePush {
  x: number;
  z: number;
  dir: [number, number];
  at: number;
}

export class PlayerCtx {
  /** 'local': this device's player; 'remote': the co-op partner as the host runs it. */
  readonly kind: 'local' | 'remote';
  player = new Actor('player', 0, 0, 0);
  ui!: GameUI;
  sink: PlayerSink | null = null;
  /** A remote player's camera (shakes go to its own screen). */
  renderer: Renderer | null = null;
  name = '';
  /** A remote player whose device has dropped off the line (it waits, untouchable, for a while). */
  away = false;
  /** A remote player's view ray (what its taps and presses aim along). */
  aim: Ray | null = null;
  /** Game time of the last "can't do that" message (they are spaced out). */
  denyAt = -10;
  mode: 'mine' | 'build' = 'mine';
  selected: number | null = null;
  /** At the helm (driving) or manning the guns (co-op: the gunner's station). */
  helm = false;
  gunner = false;
  boostHeld = false;
  lookTime = -10;
  hitAt = -10;
  hitKill = false;
  hurtTilt = 0;
  viewKick = 0;
  fov = 1;
  streak = { n: 0, t: 0 };
  grapple: Grapple | null = null;
  grappleCooldown = 0;
  bowCooldown = 0;
  carried: Actor | null = null;
  glideFrom: number | null = null;
  glideCluck = 0;
  chuteFrom: number | null = null;
  chuteFold: ChuteFold | null = null;
  chuteRoll = 0;
  overSide: OverSide | null = null;
  edgePush = 0;
  readonly edge: EdgePush = { x: 0, z: 0, dir: [0, 0], at: -10 };
  flapReady = true;
  yaw = 0;
  pitch = -0.1;
  readonly move = { x: 0, z: 0 };
  readonly keys = { forward: false, back: false, left: false, right: false };
  jumpHeld = false;
  jumpBuffer = 0;
  holdRay: Ray | null = null;
  mining: { target: Target | null; progress: number; blocked: boolean; swing: number } = { target: null, progress: 0, blocked: false, swing: 0 };
  focus: Target | null = null;
  focusFoe = false;
  context: ContextAction | null = null;
  attackCooldown = 0;
  throwCooldown = 0;
  digFx = 0;
  respawnTimer = 0;
  leap: Leap | null = null;
  bob = 0;
  hunger = 20;
  hungerTimer = 0;
  regenTimer = 0;
  readonly effects = new Map<EffectId, Effect>();
  camPull = 0;
  /**
   * The third-person view (this device's own player only; see perspective.ts): how far it has
   * drawn back over the shoulder (0..1), how much of the step out to the shoulder the walls leave
   * (0..1), and how far behind the shoulder it stands (blocks).
   */
  shoulderPull = 0;
  shoulderSide = 0;
  shoulderDist = 0;
  behind = 0;
  ashore = 0;
  lastStride = 0;

  constructor(kind: 'local' | 'remote') {
    this.kind = kind;
  }
}

/** The fields of PlayerCtx that Game exposes as its own (`g.player`, `g.yaw`, ...). */
export const CTX_FIELDS = [
  'player', 'ui', 'mode', 'selected', 'helm', 'gunner', 'boostHeld', 'lookTime', 'hitAt', 'hitKill', 'hurtTilt', 'viewKick', 'fov', 'streak',
  'grapple', 'grappleCooldown', 'bowCooldown', 'carried', 'glideFrom', 'glideCluck', 'chuteFrom', 'chuteFold', 'chuteRoll', 'overSide', 'edgePush', 'edge',
  'flapReady', 'yaw', 'pitch', 'move', 'keys', 'jumpHeld',
  'jumpBuffer', 'holdRay', 'mining', 'focus', 'focusFoe', 'context', 'attackCooldown', 'throwCooldown', 'digFx', 'respawnTimer', 'leap', 'bob',
  'hunger', 'hungerTimer', 'regenTimer', 'effects', 'camPull', 'shoulderPull', 'shoulderSide', 'shoulderDist', 'behind', 'ashore', 'lastStride',
] as const;
