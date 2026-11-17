import { B, I, blockDef, itemDef, HOTBAR_PRIORITY, type Recipe } from './blocks';
import { BlockBody, key3, kx, ky, kz } from './body';
import { Actor, carryActor, moveActor, JUMP_V, WALL_DIRS, type FallingBlock, type ItemDrop, type LadderHold, type Projectile, type VillagerRole } from './entities';
import type { Giant } from './giants';
import { forward, rightOf, type Vec3 } from './math3d';
import { hexRgb, Particles } from './particles';
import { bodyGrid, MAX_FALL, overlaps, sweepHorizontal, worldGrid, type Grid } from './physics';
import { clamp } from './rng';
import { chunkLighting, bodyLightAt } from './light';
import type { HoldPlan } from './hold';
import { expeditionHere, mainQuestOn, marchHolds, newMainQuest, questStop, sealAnswers, updateMainQuest, type MainQuest } from './mainquest';
import { updateWardens, type WardenState } from './wardens';
import { beginFinalBoss, updateFinalBoss, type FinalBoss } from './finalboss';
import { hasOfficer, officerDawn, restoreOfficers, updateOfficers, type OfficerState } from './company';
import { setDone } from './curios';
import type { OfficerId } from './officers';
import type { StoryKind, TalkMood } from './ui';
import { beginPound, buildStarterFortress, cargoPower, clearLadderLandings, coreDestroyed, crewCapacity, damageFortressCell, groundPound, integrity, loadHold, makeAutopilot, migrateHold, releasePound, restHeight, routeLength, turnSpeed, updateFortress, type Autopilot, type BlockReason, type CargoInfo, type Pound } from './fortress';
import { animateCrane, buyPart, cancelCraneDrop, CRANE_PARTS, craneBeat, craneCamera, finishHoistNow, newCraneFx, newRig, steerCrane, type CraneCam, type CraneDrop, type CraneFx, type CranePart, type CraneRig, type Hoist } from './crane';
import { board, damageMob, damagePlayer, drainPlayer, meleeMob, nightBeat, populateVillages, resolveBodyPushes, updateCastleGuards, updateCrew, updateCrewPosts, updateMobs, updateNightSpawns, updateVillagers } from './mobs';
import { doLeap, explode, fireCannon, killGiant, leapTarget, nearestCannon, projectileTrail, spawnColossus, updateGiants, updateLeap, updateProjectiles } from './combat';
import { addEffect, clearBadEffects, EFFECTS, speedFactor, updateEffects, type Effect, type EffectId } from './effects';
import { bossDarkness, bossDawn, bossHoldsNight, bossMusic, planBossNight, raidersLeft, updateBosses, type RaidState, type WitherState } from './bosses';
import { swatFireball, updateFangs, type Fang } from './monsters';
import { contextAction, craft, meleeTarget, recipeStatus, stationsNearby, tapAction, updateDrops, updateFalling, updateMining, type ContextAction, type Stations } from './build';
import { dayClock, nightClock, type RegionAir } from './sky';
import { buy, readTreasureMap, turnIn, updateQuests, updateWilds, upgradeCargo, type QuestState } from './quests';
import { controlHint, currentGoal, dayPlan, lessonSeen, nextLesson, nextTip, nightPlan, nightReport, training, TRAINING, updateTraining, type Goal, type Lesson } from './guide';
import { makeIntro, markIntroSeen, updateIntro, wantsIntro, type Intro } from './intro';
import { catchStar, newBounty, settleBounty, starDir, tutorialCrate, updateEvents, type Airdrop, type Bounty, type ShootingStar } from './events';
import { makePet, planHowl, updatePet, type Pet } from './pet';
import { fluff, HEN_GLIDE, restoreDeckHens, setDownHen, startle, updateAnimals } from './animals';
import { cheer, crewSay, updateChatter, villagerReact, type BubbleKind, type CrewEvent } from './chatter';
import { feat, type Feat } from './feats';
import { buildStructures } from './structures';
import { CloudSaves, type CloudInfo } from './cloud';
import { CHUTE_ACCEL, CHUTE_STEER, chuteCap, FOLD_TIME, goOverSide, notePush, offeredExit, packChute, updateChute, updateOverSide, type OverSide } from './chute';
import { CTX_FIELDS, PlayerCtx, type ChuteFold, type EdgePush, type Leap } from './player-ctx';
import { frameShoulder, fromShoulder, shoulderEye } from './perspective';
import type { CoopHost } from './coop/host';
import type { CoopGuest } from './coop/guest';
import type { MateShown } from './coop/avatar';
import { blowHorn, coreMaxHp, fireCrossbow, fireGrapple, releaseGrapple, relicItems, rodTarget, updateGrapple, type Grapple } from './relics';
import { page, RELICS, type RelicId } from './story';
import { CINDER, Terrain, WORLD_VERSION, type Site } from './terrain';
import { firstSealed, GUARDIANS, sealAhead, updateLands, updateSeals, type GuardianState } from './seals';
import { restoreGolems, updateGolems, updateWanderer, type Wanderer } from './folk';
import { FORTRESS_LEGS, Walker } from './walker';
import { finishChunk, generateChunk } from './worldgen';
import { cellKeyV1, DIRS, World, WY } from './world';
import type { AudioManager, Material, MusicName, SfxName } from './audio';
import type { InputMode } from './input';
import type { Renderer } from './render';
import type { CombosGameplayTestApi, GameplayEventType } from '../../template-contracts';

export type Phase = 'loading' | 'title' | 'day' | 'night' | 'won' | 'lost';
export interface Light {
  x: number;
  y: number;
  z: number;
  r: number;
  color: [number, number, number];
  life: number;
  max: number;
}
export type BannerTone = 'day' | 'night' | 'danger' | 'gold';
export type Outcome = 'victory' | 'defeat';

export interface GameUI {
  toast(text: string, icon?: string): void;
  banner(title: string, sub: string, tone: BannerTone): void;
  setHint(text: string | null): void;
  onPhaseChanged(): void;
  onInventoryChanged(): void;
  showResult(outcome: Outcome): void;
  openWorkshop(): void;
  openMap(): void;
  openVillage(index: number): void;
  /** The wandering trader's wares. */
  openWanderer(): void;
  /** A briefing card (dawn, dusk, a new game): a title, a line under it and a few short points. */
  briefing(title: string, sub: string, lines: string[], tone: BannerTone): void;
  /** Flashes the whole screen (gold: the Citadel falls; red: your fortress does). */
  flash(kind: 'gold' | 'red' | 'white' | 'impact'): void;
  /** A one-time tip. */
  tip(text: string): void;
  /** Takes down the tip on screen (the moment has passed). */
  clearTip(): void;
  /** A story card: a relic handed to you, or a page of the Builders' Journal (queued, one at a time). */
  story(kind: StoryKind, id: string): void;
  /** An officer speaks (one card to a line): `mood` says how the talk stands. */
  talk(id: string, lines: string[], mood: TalkMood): void;
  /** A number (or word) popping off a creature you struck: a hit, a critical, a streak, a ram. */
  damage(n: number, x: number, y: number, z: number, kind: 'hit' | 'crit' | 'streak' | 'big', text?: string): void;
  /** Flashes the screen edge on the side a blow came from (radians from straight ahead, + right). */
  hurtFrom(angle: number): void;
  /** A picked-up item flies from where it lay into the hotbar. */
  flyItem(id: number, x: number, y: number, z: number): void;
  /** A training step is done (the last one: the whole training). */
  coachDone(final: boolean): void;
  /** Your level went up: the number over the experience bar pops (no toast). */
  levelUp(level: number): void;
  /** A lesson card: the first time a danger (or a duty) turns up. */
  lesson(l: Lesson): void;
  /** A speech bubble over someone's head (the point is asked for each frame: speakers move). */
  say(at: () => Vec3 | null, text: string, kind: BubbleKind): void;
  /** A feat earned: its gold card. */
  feat(f: Feat): void;
  /** The status effects on you changed (their icons, and the colour of your hearts). */
  effectsChanged(): void;
  /** A totem of undying pops: it rises spinning before your eyes. */
  totem(): void;
  /** Whether guidance (tips, briefings, the goal line) is switched on. */
  readonly hintsOn: boolean;
  readonly briefOpen: boolean;
  /** A lesson card is up (tips wait for it); one that an urgent lesson may now replace. */
  readonly lessonOpen: boolean;
  readonly lessonUrgentOnly: boolean;
  /** A big announcement is on screen (tips wait for it). */
  readonly bannerOpen: boolean;
}

export interface Ray {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface Target {
  kind: 'world' | 'fortress' | 'giant';
  body: BlockBody | null;
  giant: Giant | null;
  /** Cell in the grid's own coordinates (world, or body-local). */
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  id: number;
  dist: number;
  sig: string;
}

export interface SaveData {
  v: 3;
  seed: number;
  day: number;
  site: number;
  fx: number;
  fz: number;
  /** Fortress heading. */
  fyaw?: number;
  crew: number;
  roles: VillagerRole[];
  inv: Array<[number, number]>;
  cells: Array<[number, number, number, number, number, number]>;
  self: number[];
  ammo: Array<[number, number]>;
  cargo: CargoInfo[];
  hoisted: string[];
  looted: number[];
  stats: Game['stats'];
  hunger: number;
  xp: number;
  quests?: QuestState[];
  bunks?: number;
  /** Parts fitted to the crane (crane.ts CRANE_PARTS). */
  craneParts?: string[];
  tutorial?: number;
  lairs?: number[];
  maps?: number[];
  found?: number[];
  relics?: RelicId[];
  journal?: string[];
  hearts?: number;
  horn?: number;
  /** 0: no wolf (older saves get Pip too). */
  pet?: number;
  /** Hens riding on the deck. */
  hens?: number;
  /** The Engine Core wears a beacon (a Nether Star was socketed). */
  beacon?: boolean;
  /** The world's layout (missing: the classic valley, before the Long March). */
  wv?: number;
  /** Heart Seals broken (by index). */
  seals?: number[];
  /** Lands of the valley entered (their chapter cards shown). */
  regions?: number[];
  /** Villages whose iron golem serves aboard. */
  golems?: number[];
  /** The main quest (missing: a game from before it). */
  mq?: MainQuest;
  /** Expedition places whose gates are open (the outlaws' cages). */
  opened?: string[];
  /** The officers, the curios found, the gear forged and the monsters slain by kind. */
  company?: Game['company'];
  curios?: string[];
  gear?: Game['gear'];
  bestiary?: Record<string, number>;
}

export const REACH = 5.5;

/** Where a climber's hands and feet reach for rungs (climbing up, also just under the feet). */
const LADDER_REACH = [0.1, 1.0];
const LADDER_REACH_UP = [0.1, 1.0, -0.2];
const LADDER_SAMPLES: ReadonlyArray<readonly [number, number]> = [[0, 0], [0.32, 0], [-0.32, 0], [0, 0.32], [0, -0.32]];
/** Longest rope a hanging ladder lets down to the ground (blocks under its last rung). */
const ROPE_MAX = 24;

/** Whether a point (in the ladder's grid frame) is on the climbing side of the ladder's wall. */
function inFrontOfLadder(h: LadderHold, x: number, z: number): boolean {
  switch (h.dir) {
    case 0:
      return x <= h.x + 1.02;
    case 1:
      return x >= h.x - 0.02;
    case 2:
      return z <= h.z + 1.02;
    case 3:
      return z >= h.z - 0.02;
    default:
      return true;
  }
}
export const EYE = 1.62;
const SAVE_KEY = 'block-fortress-rampage-save-v3';
const BEST_KEY = 'block-fortress-rampage-best-v3';
const HAPTICS_KEY = 'block-fortress-haptics-v1';
const LOOK_KEY = 'block-fortress-look-v1';
const VIEW_KEY = 'block-fortress-view-v1';
/** How fast a swipe turns the view, by the pause menu's setting (slow, normal, fast). */
export const LOOK_SPEEDS = [0.7, 1, 1.4] as const;

/** Items held in the hand in "mine" mode (tools, weapons, throwables) rather than built with. */
const HAND_ITEMS = new Set<number>([I.SWORD, I.TNT, I.BREAD, I.STEW, I.CACTUS_FRUIT, I.GRAPPLE, I.CROSSBOW, I.BREAKER, I.HEARTSTONE, I.PEARL, I.WIND_CHARGE, I.POTION, I.POTION_SWIFT, I.POTION_STRENGTH, I.POTION_FIRE, I.POTION_FROST, I.TOTEM, I.NETHER_STAR]);
/** What an action button does, without its counts and prices ("HOIST SMITHY", "TAKE GOLEM ABOARD"). */
function actionKind(label: string): string {
  return label.split(/[·:]/)[0]!.replace(/\d+/g, '').trim();
}

/** Moss's brews (drunk from the hotbar). */
const BREWS = new Set<number>([I.POTION_SWIFT, I.POTION_STRENGTH, I.POTION_FIRE, I.POTION_FROST]);

export function materialOf(id: number): Material {
  switch (id) {
    case B.PLANKS:
    case B.SPRUCE_PLANKS:
    case B.LOG:
    case B.BIRCH_LOG:
    case B.SPRUCE_LOG:
    case B.CRAFTING_TABLE:
    case B.CHEST:
    case B.BARREL:
    case B.BOOKSHELF:
    case B.LADDER:
    case B.FENCE:
    case B.OAK_STAIRS:
    case B.SPRUCE_STAIRS:
    case B.HAY:
    case B.THRUSTER:
    case B.WINDMILL_HUB:
    case B.TORCH:
    case B.HELM:
      return 'wood';
    case B.GLASS:
    case B.GLOWSTONE:
    case B.REDSTONE_LAMP:
      return 'glass';
    case B.WOOL:
    case B.RED_WOOL:
    case B.SNOW:
      return 'wool';
    case B.DIRT:
    case B.GRASS:
    case B.SAND:
    case B.LEAVES:
    case B.BIRCH_LEAVES:
    case B.SPRUCE_LEAVES:
    case B.WIRE:
    case B.PATH:
    case B.GRAVEL:
    case B.FARMLAND:
    case B.TALL_GRASS:
    case B.FERN:
    case B.WHEAT:
    case B.VINE:
    case B.POPPY:
    case B.DANDELION:
    case B.CORNFLOWER:
    case B.OXEYE:
      return 'dirt';
    case B.GIANT_EYE:
    case B.GIANT_HEART:
    case B.CITADEL_HEART:
      return 'flesh';
    case B.IRON_BLOCK:
    case B.CANNON:
    case B.LANTERN:
    case B.CHAIN:
    case B.GEARBOX:
    case B.PISTON:
      return 'metal';
    default:
      return 'stone';
  }
}

/** A site as it travels in co-op messages: a letter for its kind, and its index. */
const SITE_LETTER: Record<Site['kind'], string> = { village: 'v', castle: 'k', citadel: 'C', camp: 'm', expedition: 'x' };

export function siteRef(s: Site): [string, number] {
  return [SITE_LETTER[s.kind], s.index];
}

export function siteFrom(T: Terrain, ref: unknown): Site | null {
  if (!Array.isArray(ref)) return null;
  const k = ref[0];
  const n = Number(ref[1]);
  if (k === 'v') return T.villages[n] ?? null;
  if (k === 'k') return T.castles[n] ?? null;
  if (k === 'm') return T.camps[n] ?? null;
  if (k === 'x') return T.expeditions[n]?.site ?? null;
  if (k === 'C') return T.citadel;
  return null;
}

export function dist3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

/** Where the fortress stands when it has arrived at a site. */
export function parkSpot(T: Terrain, s: Site): [number, number] {
  if (s.kind === 'village') return [s.x, s.z];
  if (s.kind === 'citadel') return [s.x - 44, s.z];
  if (s.kind === 'expedition') return T.expeditions[s.index]?.park ?? [s.x, s.z];
  const c = T.centerZ(s.x);
  const dir = Math.sign(c - s.z) || 1;
  return [s.x, s.z + dir * (s.radius + 18)];
}

export class Game {
  /** This device's own player, and the player acting right now (see PlayerCtx). */
  readonly me = new PlayerCtx('local');
  cx: PlayerCtx = this.me;
  /** Manning the guns (co-op): the commander's view, every turret fires where you tap. */
  declare gunner: boolean;
  /** Co-op: this game hosts a partner (the world is this game's), or mirrors a host's world. */
  coopHost: CoopHost | null = null;
  coopGuest: CoopGuest | null = null;
  /** The co-op partner as the host runs it (null: nobody has joined). */
  partner: PlayerCtx | null = null;
  /** Inside the world's own step: news from it reaches both players. */
  worldTick = false;
  /** Inside `fxMute`: particles that are not passed on to a co-op partner (it draws its own). */
  fxMute = 0;
  readonly audio: AudioManager;
  readonly test: CombosGameplayTestApi | null;
  private screen!: Renderer;
  private view: Renderer | null = null;
  /** The screen (in co-op its camera shakes are routed: a partner's go to the partner's screen). */
  get renderer(): Renderer {
    return this.view ?? this.screen;
  }
  set renderer(r: Renderer) {
    this.screen = r;
    this.view = null;
  }

  /** Co-op: every camera shake goes through `route` first (true: it was handled elsewhere). */
  routeShakes(route: ((amount: number) => boolean) | null): void {
    const screen = this.screen;
    if (!route) {
      this.view = null;
      return;
    }
    this.view = new Proxy(screen, {
      get: (target, key) => {
        if (key === 'shake') return (amount: number) => {
          if (!route(amount)) target.shake(amount);
        };
        const v: unknown = Reflect.get(target, key, target);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }
  declare ui: GameUI;
  world!: World;
  fortress!: BlockBody;
  walker = new Walker(FORTRESS_LEGS);
  giants: Giant[] = [];
  declare player: Actor;
  mobs: Actor[] = [];
  villagers: Actor[] = [];
  drops: ItemDrop[] = [];
  projectiles: Projectile[] = [];
  falling: FallingBlock[] = [];
  readonly particles = new Particles();
  lights: Light[] = [];

  /** A flash of light in the world (a blast, a muzzle, a beacon lighting). */
  light(l: Light): void {
    this.lights.push(l);
    this.coopHost?.lit(l);
  }
  inventory = new Map<number, number>();
  declare mode: 'mine' | 'build';
  declare selected: number | null;
  phase: Phase = 'loading';
  paused = false;
  modal: 'none' | 'craft' | 'pause' | 'map' | 'village' | 'story' = 'none';
  day = 1;
  dayTime = 0;
  dayLength = 300;
  /** Fraction of daylight already gone when this day began. */
  dayStart = 0;
  /** Walking speed along the heading (blocks/s, negative backing up) and turn rate (rad/s). */
  speed = 0;
  turnRate = 0;
  /** You stand at the helm: the stick (WASD) walks and turns the fortress. */
  declare helm: boolean;
  /** Full steam: held, burning (boost), the boiler's pressure 0..1 and how long it has rested. */
  declare boostHeld: boolean;
  boosting = false;
  steam = 1;
  steamIdle = 0;
  ramTimer = 0;
  /** Why the fortress cannot go on (shown on the helm board). */
  blockReason: BlockReason | null = null;
  /** When you last turned the view yourself (the helm camera swings back behind the hull after). */
  declare lookTime: number;
  /** The crew walks the fortress to a point (null: parked, or hand-steered). */
  autopilot: Autopilot | null = null;
  /** Direction the fortress last walked (spawns and giants come from ahead). */
  marchDir: [number, number] = [1, 0];
  /** Night clock: seconds gone, its length, the site it began at, the distance to cover. */
  nightTime = 0;
  nightLength = 210;
  nightFrom: Site | null = null;
  nightDist = 1;
  /** Where the march is headed and the site the fortress last stopped at. */
  destination: Site | null = null;
  site: Site | null = null;
  siteIndex = 0;
  progress = 0;
  blocked = false;
  /** The Long March: Heart Seals broken (by index), the lands already entered, the guardian awake. */
  readonly sealsBroken = new Set<number>();
  readonly regionsSeen = new Set<number>();
  guardian: GuardianState | null = null;
  /** A guardian that drew back from a night-long stand-off rests behind its seal through this day. */
  guardianRest = 0;
  /** The officers, the cabinet of curios, the gear forged, the monsters slain by kind. */
  company: Partial<Record<OfficerId, OfficerState>> = {};
  errandTimer = 0;
  readonly curios = new Set<string>();
  gear = { sword: 0, coat: 0 };
  bestiary: Record<string, number> = {};
  /** Blows struck (the cutlass's every fourth is a critical). */
  blows = 0;
  /** The main quest, the warden of a wreck awake, the last fight; when a seal last said it would not answer. */
  mq: MainQuest = newMainQuest();
  warden: WardenState | null = null;
  finalBoss: FinalBoss | null = null;
  sealNote = -99;
  /** Expedition places whose gates stand open (the outlaws' cages, once their guards are down). */
  readonly opened = new Set<string>();
  /** Seconds the fortress stays frozen in its tracks (the Frost Titan's breath). */
  chill = 0;
  /** Villages whose iron golem serves aboard; today's wandering trader (and the last day one was decided). */
  readonly golemsTaken = new Set<number>();
  wanderer: Wanderer | null = null;
  wandererDay = 0;
  spawnTimer = 0;
  /** Which stretch of tonight's rhythm has been announced (see nightBeat). */
  beatIndex = 0;
  giantsSpawned = 0;
  crew = 0;
  crewRoles: VillagerRole[] = [];
  readonly crewTimers = new Map<number, number>();
  crewPosts: Array<{ x: number; y: number; z: number; cannon: number | null }> = [];
  crewPostsVersion = -1;
  cargo: CargoInfo[] = [];
  /** Full-size buildings of an older save that packed down into modules as it loaded. */
  /** Buildings of an older game rebuilt into the hold on loading. */
  rebuiltOld = 0;
  hoist: Hoist | null = null;
  /** The bow crane's pose, and what flies off it (clods, an unloading's blocks). */
  crane: CraneRig = newRig();
  craneFx: CraneFx = newCraneFx();
  /** This device's view of a lift its player is working (null: none). */
  craneCam: CraneCam | null = null;
  /** A TNT crate on the crane's hook, being swung out over the monsters (null: none). */
  craneDrop: CraneDrop | null = null;
  /** Seconds until the crew has the next crate ready. */
  craneDropCool = 0;
  /** The hold as planned for the buildings aboard (null: none yet). */
  hold: HoldPlan | null = null;
  /** How tall the hold stands over the deck, eased (the commander's view rises and draws back with it). */
  camTall = 0;
  hoistHub: number | null = null;
  farmTimer = 50;
  readonly populated = new Set<number>();
  readonly guarded = new Set<string>();
  /** The Citadel siege: heart blocks left. */
  heartLeft = 0;
  heartTotal = 0;
  siege = false;
  /** Siege stages: shatter the four pylons, fell the Colossus, then blast the bare Heart. */
  siegeStage: 'pylons' | 'colossus' | 'heart' = 'pylons';
  pylons: Array<{ cells: Vec3[]; x: number; y: number; z: number; alive: boolean }> = [];
  colossus: Giant | null = null;
  /** Tonight's sky: a clear night, a thunderstorm, a blood moon, the illager raid or the Wither's night. */
  nightTheme: 'clear' | 'storm' | 'blood' | 'raid' | 'wither' = 'clear';
  /** Weather now (0..1): rain and overcast, the red moon, a lightning flash, a boss's darkened sky. */
  readonly weather = { storm: 0, blood: 0, flash: 0, dark: 0 };
  /** A lightning bolt being drawn: where it struck and how long it shows. */
  bolt: { x: number; y: number; z: number; t: number; seed: number } | null = null;
  private lightningTimer = 9;
  private alarmTimer = 0;
  /** Last hit marker (game time) and whether it was a kill. */
  declare hitAt: number;
  declare hitKill: boolean;
  /** Seconds of hit-stop left: a landed blow holds the world for a beat (camera and HUD run on). */
  hitStop = 0;
  /** Camera roll (radians) from the last blow you took; it springs back (Minecraft's hurt cam). */
  declare hurtTilt: number;
  /** Pitch kick (radians) from a blow landed or a turret fired; it settles at once. */
  declare viewKick: number;
  /** Field-of-view scale: full steam widens the view. */
  declare fov: number;
  /** How far the helm's wheel has been turned (radians; it spins with the rudder). */
  helmSpin = 0;
  declare lastStride: number;
  /** Creatures falling dead (tipping over, flashing red, then puffing away). */
  corpses: Actor[] = [];
  /** Sword sweeps drawn in front of you for a moment. */
  slashes: Array<{ x: number; y: number; z: number; yaw: number; t: number; crit: boolean }> = [];
  /** Kills of your own in quick succession. */
  declare streak: { n: number; t: number };
  /** Phone vibration on hits, blasts and rams (touch devices; switchable in the pause menu). */
  hapticsOn = true;
  /** Index into LOOK_SPEEDS: how far a swipe turns the view on a touch screen. */
  lookSpeed = 1;
  /** The view from behind your shoulder instead of your own eyes (this device's choice; see perspective.ts). */
  thirdPerson = false;
  private lastBuzz = 0;
  private beatTimer = 0;
  /** The relics the villages have entrusted to you, and the Builders' Journal pages found. */
  readonly relics = new Set<RelicId>();
  readonly journal = new Set<string>();
  /** Heartstones socketed into the Engine Core (each adds to its health). */
  heartstones = 0;
  /** War horn blasts left tonight, and seconds of the crew's rally it set off. */
  hornCharges = 0;
  rally = 0;
  /** The grapple's hook, when it is out; reload timers of the grapple and the crossbow. */
  declare grapple: Grapple | null;
  declare grappleCooldown: number;
  declare bowCooldown: number;
  /** Village quests (by village index), captives held at the raiders' camps, nest timer. */
  questState: QuestState[] = ['active', 'active', 'active', 'active', 'active'];
  readonly captives = new Map<number, Actor>();
  nestTimer = 0;
  /** Crew bunks bought from traders. */
  extraBunks = 0;
  /** Parts the village traders have fitted to the crane. */
  craneParts: CranePart[] = [];
  /** What you did today (for today's plan), and the day's events already sent (a crate, a golden creeper). */
  today = { hoisted: 0, traded: false, crate: false, golden: false };
  /** Supply crates coming down (or landed, until looted). */
  airdrops: Airdrop[] = [];
  /** Pip, the smith's wolf. */
  pet: Pet | null = null;
  /** Farm animals in the villages (and the hens riding on your deck); the hen in your arms. */
  animals: Actor[] = [];
  declare carried: Actor | null;
  /** Tonight's shooting star while it crosses the sky; the lulls that have had one, a caught one. */
  star: ShootingStar | null = null;
  starNight = { lulls: [] as number[], caught: false, wait: -1 };
  /** Holding a hen in mid-air: the height the glide began at (null: not gliding). */
  declare glideFrom: number | null;
  declare glideCluck: number;
  /** Under the parachute: the height it opened at (null: packed). */
  declare chuteFrom: number | null;
  /** A landed canopy settling where you came down (for a moment), and the view's sway under one. */
  declare chuteFold: ChuteFold | null;
  declare chuteRoll: number;
  /** Going over the deck's side (JUMP DOWN): the hop across the rail. */
  declare overSide: OverSide | null;
  /** Pushing against the deck's rail or edge: for how long, and when, which way and where it was last. */
  declare edgePush: number;
  declare readonly edge: EdgePush;
  /** Seconds the crew keeps hopping for joy after a cheer. */
  crewJoy = 0;
  /** The fortress's stomp: winding up (held), the slam, the settle; its reload (and how long that is). */
  pound: Pound | null = null;
  poundCooldown = 0;
  poundCooldownMax = 1;
  /** Shock rings rolling out over the ground from a stomp. */
  shocks: Array<{ x: number; y: number; z: number; r0: number; r1: number; t: number; life: number; width: number; power: number }> = [];
  /** Tonight's bounty. */
  bounty: Bounty | null = null;
  /** What tonight brought (for the dawn report): counts at dusk, and parts salvaged since. */
  nightLog = { slain: 0, giants: 0, salvage: 0, cells: 0 };
  /** Day-one training: the next step to do. */
  tutorialStep = 0;
  /** The wilds: lairs cleared, treasure maps read and hoards found, the dens' breeding timer. */
  readonly lairsDone = new Set<number>();
  readonly treasuresShown = new Set<number>();
  readonly treasuresFound = new Set<number>();
  denTimer = 0;
  private lavaTimer = 0;
  /** How much of each region's air surrounds you (smoothed) and the music it wants. */
  readonly region: RegionAir = { desert: 0, snow: 0, blight: 0, swamp: 0, badlands: 0, ember: 0 };
  private musicTimer = 0;
  seed = 1;
  time = 0;
  // ---- view & input
  input: InputMode = 'touch';
  mouseFree = false;
  declare yaw: number;
  declare pitch: number;
  declare readonly move: { x: number; z: number };
  declare readonly keys: { forward: boolean; back: boolean; left: boolean; right: boolean };
  declare jumpHeld: boolean;
  declare holdRay: Ray | null;
  declare mining: { target: Target | null; progress: number; blocked: boolean; swing: number };
  declare focus: Target | null;
  /** A monster is within a blow of the crosshair (it turns red). */
  declare focusFoe: boolean;
  declare context: ContextAction | null;
  declare attackCooldown: number;
  declare jumpBuffer: number;
  declare digFx: number;
  declare respawnTimer: number;
  declare leap: Leap | null;
  fortressBaseY = 0;
  /** A height the hull is rising to before it steps on up a slope (held for climbTime seconds). */
  climbY = 0;
  climbTime = 0;
  /** Seconds it has waited on the legs to lift it (in a row), and when the rams last hissed. */
  climbWait = 0;
  climbSfx = -10;
  private hintTimer = 0;
  private ambientTimer = 0;
  private contextTimer = 0;
  private lastPrimaryReport = -10;
  private lastVisualReport = -10;
  private lastAudioReport = -10;
  chainQueue: Array<{ x: number; y: number; z: number; t: number }> = [];
  private toastBuffer = new Map<number, number>();
  private toastFlush = 0;
  declare bob: number;
  hasSave = false;
  /** The save's copy in the cloud (it goes up every time the game saves). */
  readonly cloud = new CloudSaves();
  private pristine = false;
  best = 0;
  declare hunger: number;
  declare hungerTimer: number;
  declare regenTimer: number;
  xpPoints = 0;
  stats = { mined: 0, placed: 0, slain: 0, giants: 0, crafted: 0, nights: 0, peak: 0, hoisted: 0, days: 1, perfectLifts: 0, craneStreak: 0, craneDrops: 0 };
  flags = { moved: false, mined: 0, cannonGot: false, cannonPlaced: false, thrusterGot: false, thrusterPlaced: false, recruited: 0, fired: 0, leapt: false, loaded: false, descended: false, looted: 0, steered: false, threw: 0, traded: false, drove: 0, boosted: false, rammed: false, grappled: 0 };
  outcome: Outcome | null = null;
  /** The opening flyover around the fortress (the camera is its own until it ends). */
  intro: Intro | null = null;
  /** Fireworks: rockets climbing on their fuses, and launches still to come (seconds). */
  rockets: Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; colors: string[] }> = [];
  private launches: number[] = [];
  /** Status effects on you (poison, wither, slowness... regeneration, the beacon's blessing). */
  declare readonly effects: Map<EffectId, Effect>;
  /** Tonight's boss fights: the illager raid, the Wither. */
  raid: RaidState | null = null;
  witherFight: WitherState | null = null;
  /** An evoker's fangs, bursting from the ground. */
  fangs: Fang[] = [];
  /** Arrows and bolts stuck where they landed (in the ground, or in your hull, which carries them). */
  stuckArrows: Array<{ x: number; y: number; z: number; dx: number; dy: number; dz: number; t: number; local: Vec3 | null; ldir: Vec3 | null; big: boolean }> = [];
  /** The Engine Core wears a beacon (lit with the Wither's Nether Star). */
  beacon = false;

  constructor(audio: AudioManager, test: CombosGameplayTestApi | null) {
    this.audio = audio;
    this.test = test;
    this.audio.onAudible = () => this.report('audio_feedback');
    try {
      this.hasSave = Boolean(this.loadSave());
      this.best = Number(window.localStorage.getItem(BEST_KEY) || 0) || 0;
      this.hapticsOn = window.localStorage.getItem(HAPTICS_KEY) !== 'off';
      const look = Number(window.localStorage.getItem(LOOK_KEY) ?? 1);
      if (look === 0 || look === 1 || look === 2) this.lookSpeed = look;
      this.thirdPerson = window.localStorage.getItem(VIEW_KEY) === 'third';
    } catch {
      this.hasSave = false;
    }
  }

  // ------------------------------------------------------------------ setup

  /** Builds a fresh world (or a saved one) behind the title screen. */
  prepare(seed: number, save: SaveData | null = null): void {
    this.seed = seed;
    this.pristine = save === null;
    // Saved games keep the valley they began in; new ones march the long way.
    const version = save ? (save.wv ?? 1) : WORLD_VERSION;
    const terrain = new Terrain(seed, version);
    const structures = buildStructures(terrain);
    this.world = new World(terrain, structures, generateChunk, chunkLighting);
    const world = this.world;
    world.finisher = (c) => finishChunk(world, c);
    this.startWorker(seed, version);
    if (save) {
      for (const id of save.hoisted) this.world.hoisted.add(id);
      // (Chest keys saved before the Long March were packed narrower.)
      for (const k of save.looted) this.world.lootedChests.add(save.wv ? k : cellKeyV1(k));
    }
    this.day = save ? Math.max(1, save.day) : 1;
    this.fortress = new BlockBody('fortress');
    this.walker = new Walker(FORTRESS_LEGS);
    this.giants = [];
    this.mobs = [];
    this.villagers = [];
    this.animals = [];
    this.carried = null;
    this.star = null;
    this.starNight = { lulls: [], caught: false, wait: -1 };
    this.glideFrom = null;
    this.drops = [];
    this.pings = [];
    this.projectiles = [];
    this.falling = [];
    this.corpses = [];
    this.slashes = [];
    this.streak = { n: 0, t: 0 };
    this.hitStop = 0;
    this.hurtTilt = 0;
    this.viewKick = 0;
    this.fov = 1;
    this.finale = null;
    this.intro = null;
    this.rockets = [];
    this.launches = [];
    this.particles.list.length = 0;
    this.lights = [];
    this.chainQueue = [];
    this.inventory.clear();
    this.crewTimers.clear();
    this.crewPostsVersion = -1;
    this.populated.clear();
    this.guarded.clear();
    this.leap = null;
    this.hoist = null;
    this.craneDrop = null;
    this.craneDropCool = 0;
    this.craneCam = null;
    this.crane = newRig();
    this.craneFx = newCraneFx();
    this.holdRay = null;
    this.mining = { target: null, progress: 0, blocked: false, swing: 0 };
    this.mode = 'mine';
    this.selected = null;
    this.outcome = null;
    this.speed = 0;
    this.turnRate = 0;
    this.helm = false;
    this.autopilot = null;
    this.destination = null;
    this.nightTime = 0;
    this.siege = false;
    this.siegeStage = 'pylons';
    this.pylons = [];
    this.colossus = null;
    this.nightTheme = 'clear';
    this.weather.storm = this.weather.blood = this.weather.flash = this.weather.dark = 0;
    this.bolt = null;
    this.effects.clear();
    this.raid = null;
    this.witherFight = null;
    this.fangs = [];
    this.stuckArrows = [];
    this.beacon = save?.beacon ?? false;
    this.sealsBroken.clear();
    for (const i of save?.seals ?? []) this.sealsBroken.add(i);
    for (const i of this.sealsBroken) this.world.hoisted.add(`seal${i}`);
    this.regionsSeen.clear();
    for (const i of save?.regions ?? []) this.regionsSeen.add(i);
    this.guardian = null;
    this.guardianRest = 0;
    this.warden = null;
    this.finalBoss = null;
    this.mq = save?.mq ? { ...newMainQuest(), ...save.mq } : newMainQuest();
    this.opened.clear();
    for (const k of save?.opened ?? []) this.opened.add(k);
    this.company = save?.company ?? {};
    this.curios.clear();
    for (const k of save?.curios ?? []) this.curios.add(k);
    this.gear = { sword: 0, coat: 0, ...save?.gear };
    this.bestiary = save?.bestiary ?? {};
    this.chill = 0;
    this.golemsTaken.clear();
    for (const i of save?.golems ?? []) this.golemsTaken.add(i);
    this.wanderer = null;
    this.wandererDay = 0;
    if (this.beacon) this.effects.set('beacon', { t: Infinity, level: 1, tick: 3 });
    const villages = terrain.villages.length;
    this.questState = save?.quests?.slice(0, villages) ?? [];
    while (this.questState.length < villages) this.questState.push('active');
    this.captives.clear();
    this.extraBunks = save?.bunks ?? 0;
    this.craneParts = (save?.craneParts ?? []).filter((id): id is CranePart => CRANE_PARTS.some((p) => p.id === id));
    this.today = { hoisted: 0, traded: false, crate: false, golden: false };
    this.airdrops = [];
    this.bounty = null;
    this.tutorialStep = save ? (save.tutorial ?? 99) : 0;
    this.lairsDone.clear();
    this.treasuresShown.clear();
    this.treasuresFound.clear();
    for (const i of save?.lairs ?? []) this.lairsDone.add(i);
    for (const i of save?.maps ?? []) this.treasuresShown.add(i);
    for (const i of save?.found ?? []) this.treasuresFound.add(i);
    this.relics.clear();
    this.journal.clear();
    for (const r of save?.relics ?? []) if (RELICS[r]) this.relics.add(r);
    for (const id of save?.journal ?? []) this.journal.add(id);
    this.heartstones = save?.hearts ?? 0;
    this.hornCharges = save?.horn ?? 0;
    this.rally = 0;
    this.grapple = null;
    this.grappleCooldown = 0;
    this.bowCooldown = 0;
    this.deferredPages = [];
    this.deferredSagas = [];
    this.stats = { mined: 0, placed: 0, slain: 0, giants: 0, crafted: 0, nights: 0, peak: 0, hoisted: 0, days: 1, perfectLifts: 0, craneStreak: 0, craneDrops: 0 };
    this.flags = { moved: false, mined: 0, cannonGot: false, cannonPlaced: false, thrusterGot: false, thrusterPlaced: false, recruited: 0, fired: 0, leapt: false, loaded: false, descended: false, looted: 0, steered: false, threw: 0, traded: false, drove: 0, boosted: false, rammed: false, grappled: 0 };
    this.hunger = 20;
    this.xpPoints = 0;
    this.cargo = [];
    this.hold = null;
    this.crew = 0;
    this.crewRoles = [];
    const T = terrain;
    this.siteIndex = save ? Math.min(save.site, T.villages.length - 1) : 0;
    this.site = T.villages[this.siteIndex]!;
    if (save) {
      this.fortress.setMany(save.cells.map(([x, y, z, id, , dir]) => [x, y, z, id, dir] as [number, number, number, number, number]));
      // The Core carries the Heartstones socketed into it.
      const core = this.fortress.findBlock(B.CORE);
      if (core !== null) this.fortress.cells.get(core)!.maxHp = coreMaxHp(this);
      for (const [x, y, z, , hp] of save.cells) {
        const c = this.fortress.get(x, y, z);
        if (c) c.hp = Math.min(c.maxHp, hp);
      }
      for (const k of save.self) this.fortress.selfPowered.add(k);
      this.fortress.changed();
      for (const [k, ammo] of save.ammo) {
        const s = this.fortress.cannons.get(k);
        if (s) s.ammo = ammo;
      }
      for (const [id, count] of save.inv) if (count > 0) this.inventory.set(id, count);
      // Saves from before the sword: the smith forged one.
      if (!this.inventory.has(I.SWORD)) this.inventory.set(I.SWORD, 1);
      // Saves from before the relics: the smith hands over the grapple (and the story so far).
      if (!save.relics) {
        this.relics.add('grapple');
        this.journal.add('strider');
        this.journal.add('grapple');
      }
      if (this.relics.has('grapple') && !this.inventory.has(I.GRAPPLE)) this.inventory.set(I.GRAPPLE, 1);
      if (this.relics.has('crossbow') && !this.inventory.has(I.CROSSBOW)) this.inventory.set(I.CROSSBOW, 1);
      this.crew = save.crew;
      this.crewRoles = save.roles ?? [];
      this.cargo = save.cargo ?? [];
      // (Buildings hoisted before the hold move into it now.)
      this.rebuiltOld = migrateHold(this);
      loadHold(this);
      this.stats = { ...this.stats, ...save.stats };
      this.hunger = save.hunger ?? 20;
      this.xpPoints = save.xp ?? 0;
      this.flags = { moved: true, mined: 9, cannonGot: true, cannonPlaced: true, thrusterGot: true, thrusterPlaced: true, recruited: Math.max(1, save.crew), fired: 3, leapt: true, loaded: true, descended: true, looted: 3, steered: true, threw: 1, traded: true, drove: 99, boosted: true, rammed: true, grappled: 1 };
    } else {
      buildStarterFortress(this.fortress);
      // The first night is fought with what you set out with (and the crates sent after you): a
      // good stock in the hold (the training has you top up the half-loaded cannon from it).
      const cannon = this.fortress.findBlock(B.CANNON);
      if (cannon !== null) this.fortress.cannons.get(cannon)!.ammo = 4;
      this.inventory.set(I.SWORD, 1);
      this.inventory.set(I.TNT, 20);
      this.inventory.set(B.PLANKS, 24);
      this.inventory.set(B.COBBLE, 16);
      this.inventory.set(B.WIRE, 8);
      this.inventory.set(B.LADDER, 6);
      this.inventory.set(B.LANTERN, 2);
      this.inventory.set(I.BREAD, 3);
      // An old smith came along with the house: the first of the crew.
      this.crew = 1;
      this.crewRoles = ['smith'];
    }
    if (this.fortress.findBlock(B.CORE) === null) this.fortress.setBlock(8, 1, 2, B.CORE);
    {
      const core = this.fortress.cells.get(this.fortress.findBlock(B.CORE)!)!;
      core.maxHp = coreMaxHp(this);
      core.hp = Math.min(core.hp, core.maxHp);
    }
    clearLadderLandings(this.fortress);
    const [px, pz] = save ? [save.fx, save.fz] : parkSpot(T, this.site);
    const fyaw = save?.fyaw ?? 0;
    this.placeFortressAt(px, pz, fyaw);
    this.world.ensure(Math.floor(px / 16), Math.floor(pz / 16));
    this.placeFortressAt(px, pz, fyaw);
    // Start at the stern, looking down the deck and out over the valley towards the sunset.
    const F = this.fortress;
    const [sx, sy, sz] = this.startSpot();
    this.player = new Actor('player', sx, sy, sz);
    this.player.standingOn = F;
    this.player.onGround = true;
    // Pip sits beside you on the deck.
    if (save?.pet !== 0) {
      const [wx, wy, wz] = F.toWorld(4.9, 1.002, 3.4);
      this.pet = makePet(wx, wy, wz);
      this.pet.a.standingOn = F;
      this.pet.a.onGround = true;
      this.pet.a.yaw = fyaw + Math.PI * 0.8;
    } else this.pet = null;
    // Hens that rode along on the deck come back aboard with a saved game, and the golems.
    if (save?.hens) restoreDeckHens(this, Math.min(8, save.hens));
    restoreGolems(this);
    restoreOfficers(this);
    this.applyPerks();
    this.pound = null;
    this.poundCooldown = 0;
    this.shocks = [];
    this.overSide = null;
    this.edgePush = 0;
    this.chuteFrom = null;
    this.chuteFold = null;
    this.yaw = 0.16 + fyaw;
    this.pitch = -0.16;
    this.phase = 'title';
    this.dayStart = this.day === 1 && !save ? 0.74 : 0;
    this.dayLength = this.day === 1 && !save ? 330 : 300;
    this.dayTime = this.dayLength;
    this.progress = 0;
    this.respawnTimer = 0;
  }

  /** Where you stand when a game begins: the stern, by the helm. */
  startSpot(): Vec3 {
    return this.fortress.toWorld(3.6, 1.002, 4.0);
  }

  /** Puts the fortress (deck centre) over a ground position with a heading, legs planted. */
  placeFortressAt(x: number, z: number, yaw = this.fortress.yaw): void {
    const F = this.fortress;
    F.setYaw(yaw);
    F.setCentre(x, z);
    if (yaw === 0) {
      F.x = Math.round(F.x);
      F.z = Math.round(F.z);
    }
    this.walker.legs = [];
    this.walker.layout(F, this.world);
    for (const l of this.walker.legs) {
      const [hx, hz] = this.walker.footHome(F, l);
      l.foot = [hx, this.world.groundAt(hx, hz), hz];
      l.from = [...l.foot];
      l.to = [...l.foot];
      l.t = -1;
    }
    F.y = restHeight(this);
    F.savePose();
    this.fortressBaseY = F.y;
  }

  start(save: SaveData | null): void {
    this.audio.unlock();
    if (save) this.prepare(save.seed, save);
    else if (this.phase !== 'title') this.prepare(this.seed);
    this.phase = 'day';
    this.paused = false;
    this.modal = 'none';
    this.audio.playMusic('day');
    this.audio.ambience('day');
    this.pristine = false;
    this.ui.onPhaseChanged();
    this.ui.onInventoryChanged();
    const name = this.site?.name ?? 'the valley';
    // The first page of the journal: how the Strider came to you.
    if (!save) this.addPage('strider', false, true);
    if (!save && this.world.terrain.version >= 2) this.addPage('seals', false, true);
    if (this.day === 1 && !save && wantsIntro()) {
      // A first captain sees the fortress from outside before taking over (the coach follows).
      this.intro = makeIntro(this);
      markIntroSeen();
    } else if (this.day !== 1 || save || !this.ui.hintsOn) {
      this.ui.banner(`DAY ${this.day}`, this.day === 1 ? `Your walking fortress stands over ${name}` : `${name}: salvage it for parts!`, 'day');
    }
    if (save && this.rebuiltOld > 0) this.toast('Your crew rebuilt the hoisted buildings into the hold', 'ui_hoist');
    if (save) this.report('state_restored');
    this.report('game_started');
    this.audio.play('dawn');
  }

  /** Ends the opening flyover (a tap, a key, or its last shot). */
  skipIntro(): void {
    const it = this.intro;
    if (!it) return;
    this.yaw = it.yaw;
    this.pitch = it.pitch;
    this.intro = null;
    this.ui.onPhaseChanged();
  }

  newGame(): void {
    // (A co-op guest starting a game of its own leaves its mate's.)
    this.coopGuest?.quit();
    this.clearSave();
    if (!(this.phase === 'title' && this.pristine)) {
      this.prepare((Math.random() * 1e9) | 0);
      this.streamAll(2);
      this.renderer.prebuild(this, 400);
    }
    this.start(null);
  }

  continueGame(): void {
    this.coopGuest?.quit();
    const save = this.loadSave();
    if (save) {
      this.start(save);
      this.streamAll(2);
      this.renderer.prebuild(this, 400);
    } else this.newGame();
  }

  retry(): void {
    this.report('retry');
    this.newGame();
  }

  /** Back to this device's own title after playing in a co-op mate's world (a fresh valley behind it). */
  resetToTitle(): void {
    this.coopGuest = null;
    this.paused = false;
    this.modal = 'none';
    this.prepare((Math.random() * 1e9) | 0);
    this.streamAll(2);
    this.renderer.prebuild(this, 400);
    this.audio.ambience('none');
  }

  // ------------------------------------------------------------------ save

  loadSave(): SaveData | null {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      if (data?.v !== 3 || !Array.isArray(data.cells) || !Array.isArray(data.inv)) return null;
      return data;
    } catch {
      return null;
    }
  }

  save(): void {
    // (A co-op guest plays in its mate's world: there is nothing of its own to save.)
    if (this.coopGuest) return;
    // A building on the crane lands now (the save has it aboard, not half gone).
    if (this.hoist) finishHoistNow(this);
    if (this.craneDrop && !this.coopGuest) cancelCraneDrop(this);
    try {
      const json = JSON.stringify(this.saveData());
      window.localStorage.setItem(SAVE_KEY, json);
      this.hasSave = true;
      this.cloud.push(json, this.cloudInfo());
    } catch {
      // Storage may be unavailable in private modes; the run continues.
    }
  }

  /** The game as it stands, in the save's form (also what a co-op guest is sent to rebuild it). */
  saveData(): SaveData {
    const F = this.fortress;
    const c = this.fortressCentre();
    const data: SaveData = {
      v: 3,
      seed: this.seed,
      day: this.day,
      site: this.siteIndex,
      fx: c[0],
      fz: c[2],
      fyaw: F.yaw,
      crew: this.crew,
      roles: this.crewRoles,
      inv: [...this.inventory.entries()],
      cells: [...F.cells.entries()].map(([key, cell]) => [kx(key), ky(key), kz(key), cell.id, Math.round(cell.hp), cell.dir]),
      self: [...F.selfPowered],
      ammo: [...F.cannons.entries()].map(([k, s]) => [k, s.ammo]),
      cargo: this.cargo,
      hoisted: [...this.world.hoisted],
      looted: [...this.world.lootedChests],
      stats: this.stats,
      hunger: this.hunger,
      xp: this.xpPoints,
      quests: this.questState,
      bunks: this.extraBunks,
      craneParts: this.craneParts,
      tutorial: this.tutorialStep,
      lairs: [...this.lairsDone],
      maps: [...this.treasuresShown],
      found: [...this.treasuresFound],
      relics: [...this.relics],
      journal: [...this.journal],
      hearts: this.heartstones,
      horn: this.hornCharges,
      pet: this.pet ? 1 : 0,
      wv: this.world.terrain.version,
      seals: [...this.sealsBroken],
      golems: [...this.golemsTaken],
      regions: [...this.regionsSeen],
      hens: this.animals.filter((a) => a.boarded).length + (this.carried && this.player.standingOn === F ? 1 : 0),
      beacon: this.beacon,
      mq: this.mq,
      opened: [...this.opened],
      company: this.company,
      curios: [...this.curios],
      gear: this.gear,
      bestiary: this.bestiary,
    };
    return data;
  }

  clearSave(): void {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
    this.hasSave = false;
    this.cloud.forget();
  }

  savedDay(): number {
    return this.loadSave()?.day ?? 0;
  }

  /** The layout of the saved game's world (1: the classic valley, before the Long March; 0: none). */
  savedWorldVersion(): number {
    const save = this.loadSave();
    return save ? (save.wv ?? 1) : 0;
  }

  /** What the cloud panel shows about the game being saved. */
  cloudInfo(): CloudInfo {
    return { day: this.day, nights: this.stats.nights, blocks: this.fortress.cells.size, level: this.level(), at: Date.now() };
  }

  /**
   * Start-up: when another device has carried this game further (same cloud code), its copy
   * becomes the local save; a local save the cloud has not seen goes up.
   */
  async syncCloud(): Promise<string> {
    let local: { json: string; info: CloudInfo } | null = null;
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      const save = this.loadSave();
      if (raw && save) local = { json: raw, info: { day: save.day, nights: save.stats?.nights ?? 0, blocks: save.cells.length, level: Math.floor(Math.sqrt((save.xp ?? 0) / 7)), at: 0 } };
    } catch {
      local = null;
    }
    return this.cloud.sync(local, (json) => this.adoptSave(json));
  }

  /** Takes a save from the cloud as the local one (not while a game is under way, unless `force`). */
  adoptSave(json: string, force = false): boolean {
    if (!force && this.phase !== 'title' && this.phase !== 'loading') return false;
    try {
      const data = JSON.parse(json) as SaveData;
      if (data?.v !== 3 || !Array.isArray(data.cells) || !Array.isArray(data.inv)) return false;
      window.localStorage.setItem(SAVE_KEY, json);
      this.hasSave = true;
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ streaming

  private worker: Worker | null = null;

  /** Background chunk generation; the game works without it (main-thread fallback). */
  private startWorker(seed: number, version: number): void {
    try {
      this.worker?.terminate();
      this.worker = new Worker(new URL('./gen-worker.ts', import.meta.url), { type: 'module' });
      this.world.useWorker(this.worker, seed, version);
    } catch {
      this.worker = null;
    }
  }

  /** Chunk streaming around the player, the fortress and anything marching at it. */
  private streamCentres(): Array<{ x: number; z: number; r: number }> {
    const c = this.fortressCentre();
    const view = this.screen?.viewRadius ?? 6;
    const me = this.me.player;
    const centres = [{ x: me.x, z: me.z, r: view + 1 }];
    // The world around a co-op partner is kept loaded too (its monsters, its ground).
    const p = this.partner;
    if (p && !p.away && Math.hypot(p.player.x - me.x, p.player.z - me.z) > 20) centres.push({ x: p.player.x, z: p.player.z, r: 4 });
    if (Math.hypot(c[0] - this.player.x, c[2] - this.player.z) > 24) centres.push({ x: c[0], z: c[2], r: 3 });
    if (Math.abs(this.speed) > 0.1) centres.push({ x: c[0] + this.marchDir[0] * 40, z: c[2] + this.marchDir[1] * 40, r: 3 });
    return centres;
  }

  /** Blocking load of the area around the player (loading screens). */
  streamAll(extra = 0): void {
    const centres = this.streamCentres().map((c) => ({ ...c, r: c.r + extra }));
    let guard = 0;
    while (this.world.stream(centres, 1e9, 4, 900) > 0 && guard < 50) guard += 1;
  }

  // ------------------------------------------------------------------ helpers

  report(type: GameplayEventType): void {
    if (!this.test || this.cx !== this.me) return;
    const now = this.time;
    if (type === 'primary_input') {
      if (now - this.lastPrimaryReport < 0.5) return;
      this.lastPrimaryReport = now;
    } else if (type === 'visual_feedback') {
      if (now - this.lastVisualReport < 1) return;
      this.lastVisualReport = now;
    } else if (type === 'audio_feedback') {
      if (now - this.lastAudioReport < 1.5) return;
      this.lastAudioReport = now;
    }
    try {
      this.test.reportEvent(type);
    } catch {
      // contract reporting is best effort
    }
  }

  // ------------------------------------------------------------------ players (co-op)

  /** Runs `fn` as another player (their body, view, hands, feedback). */
  withCtx<T>(ctx: PlayerCtx, fn: () => T): T {
    if (ctx === this.cx) return fn();
    const prev = this.cx;
    this.cx = ctx;
    try {
      return fn();
    } finally {
      this.cx = prev;
      this.coopHost?.flushDeferred();
    }
  }

  /** The players in the world right now (the partner while connected). */
  players(): PlayerCtx[] {
    const p = this.partner;
    return p && !p.away ? [this.me, p] : [this.me];
  }

  /** Runs `fn` once as each player (blasts, splashes and fists that can catch either of them). */
  eachPlayer(fn: (p: Actor) => void): void {
    for (const ctx of this.players()) this.withCtx(ctx, () => fn(ctx.player));
  }

  /** The player a monster (or giant) at (x, z) goes after: the nearer living one. */
  hunted(x: number, z: number): PlayerCtx {
    const p = this.partner;
    const me = this.me.player;
    if (!p || p.away || p.player.dead) return this.me;
    if (me.dead) return p;
    const dMe = Math.hypot(me.x - x, me.z - z) + (this.me.leap ? 999 : 0);
    const dP = Math.hypot(p.player.x - x, p.player.z - z) + (p.leap ? 999 : 0);
    return dP < dMe ? p : this.me;
  }

  /** Distance (on the ground plan) from a point to the nearest player. */
  nearestDist(x: number, z: number): number {
    let d = Infinity;
    for (const ctx of this.players()) d = Math.min(d, Math.hypot(ctx.player.x - x, ctx.player.z - z));
    return d;
  }

  /** The player whose body is at a point (padded), if any: what a shot or a splash hits. */
  playerAt(x: number, y: number, z: number, pad: number): PlayerCtx | null {
    for (const ctx of this.players()) {
      const p = ctx.player;
      if (!p.dead && Math.abs(p.x - x) < p.hw + pad && Math.abs(p.z - z) < p.hw + pad && y > p.y - pad * 0.5 && y < p.y + p.h + pad * 0.5) return ctx;
    }
    return null;
  }

  /** A target the helmsman marked for the gunner (co-op): it follows a monster or a giant's heart. */
  mark: { x: number; y: number; z: number; mob: Actor | null; giant: Giant | null; until: number } | null = null;

  /** Who stands at the helm (null: nobody; the crew walks the fortress). */
  helmsman(): PlayerCtx | null {
    for (const ctx of this.players()) if (ctx.helm && !ctx.player.dead) return ctx;
    return null;
  }

  /** The other player (co-op) is manning the guns. */
  otherGunner(): boolean {
    for (const ctx of this.players()) if (ctx !== this.cx && ctx.gunner && !ctx.player.dead) return true;
    return false;
  }

  /** The co-op mate is on the guns (as either seat sees it). */
  mateOnGuns(): boolean {
    return this.otherGunner() || this.coopGuest?.hostRole === 'guns';
  }

  /** The other player (co-op), if there is one in the world right now. */
  other(): PlayerCtx | null {
    for (const ctx of this.players()) if (ctx !== this.cx) return ctx;
    return null;
  }

  /** A sound for the acting player's ears only (nobody else hears this one). */
  ear(name: SfxName, material: Material = 'stone', volume = 1, rate = 1): void {
    if (this.cx.sink) {
      this.cx.sink.sfx(name, material, volume, rate);
      return;
    }
    this.audio.play(name, material, volume, rate);
  }

  /** Throws the acting player through the air (a co-op partner's own device is told). */
  fling(vx: number, vy: number, vz: number): void {
    const p = this.player;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.onGround = false;
    p.standingOn = null;
    this.cx.sink?.fling(vx, vy, vz);
  }

  /** A player is in co-op right now (the world keeps going behind menus). */
  get coopLive(): boolean {
    return this.coopGuest !== null || (this.partner !== null && !this.partner.away);
  }

  get isGuest(): boolean {
    return this.coopGuest !== null;
  }

  /** Sounds only the player who made them hears (the rest carry to anyone close by). */
  private static readonly PRIVATE_SFX = new Set<string>(['click', 'deny', 'pickup', 'heartbeat', 'levelup', 'feat', 'craft', 'teleport', 'drink']);

  sfx(name: SfxName, material: Material = 'stone', volume = 1, rate = 1): void {
    const sink = this.cx.sink;
    if (sink) {
      // The partner's own sound: theirs to hear, and it carries to you from where they stand.
      sink.sfx(name, material, volume, rate);
      if (!Game.PRIVATE_SFX.has(name)) {
        const p = this.cx.player;
        this.sfxHere(name, p.x, p.y, p.z, volume * 0.8, rate, 42, material);
      }
      return;
    }
    this.audio.play(name, material, volume, rate);
    this.coopHost?.heard(name, material, volume, rate);
  }

  /** A sound from somewhere in the world: quieter the further it is from you (silent past `range`). */
  sfxAt(name: SfxName, x: number, y: number, z: number, volume = 1, rate = 1, range = 42): void {
    this.sfxHere(name, x, y, z, volume, rate, range, 'stone');
    this.coopHost?.heardAt(name, x, y, z, volume, rate, range);
  }

  sfxHere(name: SfxName, x: number, y: number, z: number, volume: number, rate: number, range: number, material: Material): void {
    const p = this.me.player;
    const d = Math.hypot(x - p.x, (y - p.y) * 0.7, z - p.z);
    const k = clamp(1.1 - d / range, 0, 1);
    if (k <= 0.03) return;
    this.audio.play(name, material, volume * k, rate);
  }

  /** A raid captain's banner falls: Bad Omen (the illagers will raid you). */
  omen(): void {
    addEffect(this, 'omen', Infinity);
    this.sfx('raidhorn', 'stone', 0.45, 1.2);
    this.ui.banner('BAD OMEN', 'You struck down an illager captain: the raiders will come for you', 'danger');
  }

  // ------------------------------------------------------------------ feel

  /** Holds the world still for a beat (a blow landing, a ram): only the strongest request counts. */
  freeze(seconds: number): void {
    // (With a partner playing, the world never holds still for one of you.)
    if (this.coopLive) return;
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  /** Jolts the view up a touch (recoil, a heavy blow landing). */
  punch(amount: number): void {
    if (this.cx.sink) {
      this.cx.sink.punch(amount);
      return;
    }
    this.viewKick = Math.min(0.09, this.viewKick + amount);
  }

  /** A short phone vibration (touch devices that support it). Light taps are rate-limited. */
  buzz(ms: number): void {
    if (this.cx.sink) {
      this.cx.sink.buzz(ms);
      return;
    }
    if (!this.hapticsOn || this.input !== 'touch') return;
    const now = performance.now();
    if (ms < 40 && now - this.lastBuzz < 70) return;
    this.lastBuzz = now;
    try {
      navigator.vibrate?.(ms);
    } catch {
      // vibration is best effort
    }
  }

  setHaptics(on: boolean): void {
    this.hapticsOn = on;
    try {
      window.localStorage.setItem(HAPTICS_KEY, on ? 'on' : 'off');
    } catch {
      // storage may be unavailable
    }
    if (on) this.buzz(40);
  }

  setLookSpeed(level: number): void {
    this.lookSpeed = ((level % LOOK_SPEEDS.length) + LOOK_SPEEDS.length) % LOOK_SPEEDS.length;
    try {
      window.localStorage.setItem(LOOK_KEY, String(this.lookSpeed));
    } catch {
      // storage may be unavailable
    }
  }

  /** First person or third (F5, the view button, the pause menu): the choice is kept on this device. */
  setThirdPerson(on: boolean): void {
    this.thirdPerson = on;
    try {
      window.localStorage.setItem(VIEW_KEY, on ? 'third' : 'first');
    } catch {
      // storage may be unavailable
    }
  }

  /** You were struck: the view rolls away from the blow and the HUD shows where it came from. */
  tookHit(amount: number, knockX: number, knockZ: number): void {
    if (this.cx.sink) {
      this.cx.sink.hurt(amount, knockX, knockZ);
      return;
    }
    const l = Math.hypot(knockX, knockZ);
    let side = Math.random() < 0.5 ? -1 : 1;
    if (l > 0.01) {
      // The blow came from the opposite way to the shove.
      const sx = -knockX / l;
      const sz = -knockZ / l;
      const r = rightOf(this.yaw);
      const f = forward(this.yaw, 0);
      const across = sx * r[0] + sz * r[2];
      side = across >= 0 ? 1 : -1;
      this.ui.hurtFrom(Math.atan2(across, sx * f[0] + sz * f[2]));
    }
    this.hurtTilt = -side * Math.min(0.2, 0.08 + amount * 0.015);
    this.buzz(amount >= 4 ? 70 : 40);
    if (amount >= 5) this.freeze(0.05);
  }

  /** Your own kills in quick succession build a streak: a rising chime, a counter, bonus XP. */
  killStreak(mob: Actor): void {
    const s = this.streak;
    s.n = s.t > 0 ? s.n + 1 : 1;
    s.t = 2.6;
    this.sfx('kill', 'metal', 0.8, 1 + Math.min(8, s.n - 1) * 0.0595 * 2);
    if (s.n >= 2) {
      const word = s.n === 2 ? 'DOUBLE' : s.n === 3 ? 'TRIPLE' : s.n < 6 ? `×${s.n} STREAK` : `×${s.n} RAMPAGE!`;
      this.ui.damage(0, mob.x, mob.y + mob.h + 0.4, mob.z, 'streak', word);
      if (s.n >= 3) this.xp(s.n - 2);
      if (s.n >= 6) feat(this, 'rampage');
    }
  }

  // ------------------------------------------------------------------ voices

  /** One of the crew shouts about what is happening (if you can see one of them). */
  crewSay(event: CrewEvent): void {
    crewSay(this, event);
  }

  /** A villager near (x, z) reacts to something you did. */
  villagerReact(kind: 'hen' | 'shear' | 'hoist' | 'recruit' | 'quest' | 'farewell', x: number, z: number, who: Actor | null = null): void {
    villagerReact(this, kind, x, z, who);
  }

  /** The crew (and any villagers about) cheer. */
  cheer(loud = true): void {
    cheer(this, loud);
  }

  /** A village (or the story) entrusts you with a relic: its items, its card, its story. */
  grantRelic(id: RelicId): void {
    if (this.relics.has(id)) return;
    this.relics.add(id);
    for (const [item, n] of relicItems(id)) this.addItem(item, n, true);
    if (id === 'horn') this.hornCharges = 1;
    this.sfx('relic', 'metal', 0.9);
    this.buzz(60);
    this.ui.story('relic', id);
    this.report('visual_feedback');
  }

  /**
   * A page of the Builders' Journal turns up (each one once). At night its card waits for dawn
   * (the battle comes first) unless `now`; `silent` files it without a card.
   */
  addPage(id: string, now = false, silent = false): void {
    if (this.journal.has(id) || !page(id)) return;
    this.journal.add(id);
    if (silent) return;
    if (this.phase === 'night' && !now) this.deferredPages.push(id);
    else this.ui.story('page', id);
  }

  /** Journal pages found during the night, shown at dawn. */
  private deferredPages: string[] = [];
  /** Lands entered during the night: their chapter cards wait for dawn. */
  private deferredChapters: number[] = [];

  deferChapter(i: number): void {
    if (!this.deferredChapters.includes(i)) this.deferredChapters.push(i);
  }

  /** Main-quest cards met during the night (an expedition reached), shown at dawn. */
  private deferredSagas: Array<[StoryKind, string]> = [];

  deferSaga(kind: StoryKind, id: string): void {
    this.deferredSagas.push([kind, id]);
  }

  // ------------------------------------------------------------------ fireworks

  /** Fireworks off the deck: a training finished, a quest done, a night survived, a victory. */
  celebrate(n = 5): void {
    for (let i = 0; i < n; i += 1) this.launches.push(i * 0.36 + Math.random() * 0.22);
    this.coopHost?.celebrated(n);
  }

  private updateFireworks(dt: number): void {
    for (let i = this.launches.length - 1; i >= 0; i -= 1) {
      const t = this.launches[i]! - dt;
      this.launches[i] = t;
      if (t > 0) continue;
      this.launches.splice(i, 1);
      this.launchRocket();
    }
    if (this.rockets.length === 0) return;
    for (const r of this.rockets) {
      r.vy -= 7 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      r.fuse -= dt;
      // A spitting trail of sparks behind the climbing rocket.
      this.particles.add({ x: r.x, y: r.y, z: r.z, vx: (Math.random() - 0.5) * 0.8, vy: -1.2, vz: (Math.random() - 0.5) * 0.8, life: 0.5, size: 0.16, grow: -0.12, r: 1, g: 0.86, b: 0.55, a: 1, emit: 1.2, gravity: 1.5, drag: 1.5, tile: 'spark', soft: true, spin: Math.random() * 6 });
      if (r.fuse <= 0) this.burst(r);
    }
    this.rockets = this.rockets.filter((r) => r.fuse > 0);
  }

  private launchRocket(): void {
    const F = this.fortress;
    const [cx, cz] = F.centre();
    const a = Math.random() * Math.PI * 2;
    const rr = this.fortressRadius() * (0.35 + Math.random() * 0.4);
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const y = F.y + F.floorY + 1.6;
    const palettes = [['#ff2a2a', '#ffb000'], ['#1aa8ff', '#7ae8ff'], ['#3ed820', '#d8ff40'], ['#ff2ab0', '#9a5aff'], ['#ff8a00', '#ff2a2a'], ['#ffd000', '#ff6a00']];
    const colors = palettes[Math.floor(Math.random() * palettes.length)]!;
    this.rockets.push({ x, y, z, vx: Math.cos(a) * 1.4, vy: 17 + Math.random() * 5, vz: Math.sin(a) * 1.4, fuse: 1.05 + Math.random() * 0.45, colors });
    const p = this.player;
    this.sfx('firework', 'stone', clamp(1.1 - Math.hypot(x - p.x, z - p.z) / 90, 0.3, 0.85), 0.92 + Math.random() * 0.16);
  }

  private burst(r: Game['rockets'][number]): void {
    const n = 70;
    for (let i = 0; i < n; i += 1) {
      // Directions spread over a sphere; two colours per shell.
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = 8 + Math.random() * 2.5;
      const [cr, cg, cb] = hexRgb(r.colors[i % r.colors.length]!);
      this.particles.add({ x: r.x, y: r.y, z: r.z, vx: s * Math.cos(th) * sp, vy: u * sp + 1, vz: s * Math.sin(th) * sp, life: 1.2 + Math.random() * 0.7, size: 0.3, grow: -0.1, r: cr, g: cg, b: cb, a: 1, emit: 0.85, gravity: 3.2, drag: 1.7, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 3 });
    }
    this.particles.add({ x: r.x, y: r.y, z: r.z, life: 0.28, size: 1.2, grow: 10, r: 1, g: 1, b: 1, a: 0.85, emit: 1, gravity: 0, drag: 0, tile: 'smoke', soft: true });
    const [lr, lg, lb] = hexRgb(r.colors[0]!);
    this.light({ x: r.x, y: r.y, z: r.z, r: 36, color: [lr * 1.3, lg * 1.3, lb * 1.3], life: 0.8, max: 0.8 });
  }

  /** Fallen creatures: they topple (carried by whatever they lay on), flash red and puff away. */
  private updateCorpses(dt: number): void {
    if (this.corpses.length === 0) return;
    const grids = this.grids(true, false);
    const worldOnly = [grids[0]!];
    const p = this.player;
    // (A squashed one lies flat where the foot left it, a moment longer.)
    const life = (c: Actor): number => (c.squash > 0 ? 1.6 : 0.78);
    for (const c of this.corpses) {
      c.deathT += dt;
      c.hurt = Math.max(0, c.hurt - dt);
      if (c.squash > 0) continue;
      if (c.onGround) {
        const k = Math.max(0, 1 - dt * 8);
        c.vx *= k;
        c.vz *= k;
      }
      c.wantJump = false;
      moveActor(c, dt, grids, worldOnly, () => null);
      if (c.y < -8) c.deathT = 99;
    }
    const gone = this.corpses.filter((c) => c.deathT >= life(c));
    if (gone.length === 0 && this.corpses.length <= 24) return;
    for (const c of gone) {
      this.particles.poof(c.x, c.y + (c.squash > 0 ? 0.15 : 0.45), c.z, c.kind === 'spider' || c.kind === 'phantom' ? 8 : 11);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < 30) this.sfx('poof', 'flesh', clamp(0.55 - d / 60, 0.08, 0.5));
    }
    this.corpses = this.corpses.filter((c) => c.deathT < life(c)).slice(-24);
  }

  count(id: number): number {
    return this.inventory.get(id) ?? 0;
  }

  addItem(id: number, n: number, quiet = false): void {
    if (n <= 0) return;
    this.inventory.set(id, this.count(id) + n);
    if (!quiet) {
      this.toastBuffer.set(id, (this.toastBuffer.get(id) ?? 0) + n);
      this.toastFlush = 0.25;
    }
    if (id === B.CANNON) this.flags.cannonGot = true;
    if (id === B.THRUSTER) this.flags.thrusterGot = true;
    this.ui.onInventoryChanged();
  }

  useItem(id: number, n = 1): boolean {
    const have = this.count(id);
    if (have < n) return false;
    if (have - n <= 0) this.inventory.delete(id);
    else this.inventory.set(id, have - n);
    if (this.selected === id && this.count(id) === 0) {
      this.selected = null;
      this.mode = 'mine';
    }
    this.ui.onInventoryChanged();
    return true;
  }

  hotbarItems(): number[] {
    return HOTBAR_PRIORITY.filter((id) => this.count(id) > 0);
  }

  /** What the builder holds (null: the pickaxe). */
  heldItem(): number | null {
    return this.mode === 'build' || (this.selected !== null && HAND_ITEMS.has(this.selected)) ? this.selected : null;
  }

  /** Holding the sword (melee hits harder and sweeps; it digs poorly). */
  wieldsSword(): boolean {
    return this.selected === I.SWORD && this.mode === 'mine';
  }

  grids(includeFortress = true, includeGiants = true): Grid[] {
    const grids: Grid[] = [worldGrid(this.world)];
    if (includeFortress) grids.push(bodyGrid(this.fortress));
    if (includeGiants) for (const g of this.giants) if (!g.dead) grids.push(bodyGrid(g.body));
    return grids;
  }

  /** Feet or chest in a water cell: the actor swims. */
  inWater(actor: Actor): boolean {
    const x = Math.floor(actor.x);
    const z = Math.floor(actor.z);
    return this.world.liquid(x, Math.floor(actor.y + 0.3), z) || this.world.liquid(x, Math.floor(actor.y + 1.1), z);
  }

  /** The region around you colours the air and picks the music; caves echo underground. */
  private updateRegion(dt: number): void {
    const p = this.player;
    const zone = this.world.terrain.zone(p.x, p.z);
    const r = this.region;
    r.desert = approach(r.desert, zone === 'desert' ? 1 : 0, dt * 0.25);
    r.snow = approach(r.snow, zone === 'snow' ? 1 : 0, dt * 0.25);
    r.blight = approach(r.blight, zone === 'blight' ? 1 : 0, dt * 0.25);
    r.swamp = approach(r.swamp, zone === 'swamp' ? 1 : 0, dt * 0.25);
    r.badlands = approach(r.badlands, zone === 'badlands' ? 1 : 0, dt * 0.25);
    r.ember = approach(r.ember, zone === 'ember' ? 1 : 0, dt * 0.25);
    const eye = this.eye();
    const under = p.y < this.world.naturalGround(p.x, p.z) - 4 && this.world.skyAt(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2])) < 5;
    this.audio.loop('cave', under ? 0.65 : 0);
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 1.5;
    if (this.phase !== 'day' && this.phase !== 'night') return;
    // The final assault of a night gets the battle music; a boss fight its own.
    const final = this.phase === 'night' && !this.siege && nightBeat(this.progress).name === 'final';
    const boss = this.phase === 'night' || this.guardian || this.warden || this.finalBoss ? bossMusic(this) : null;
    const land: MusicName = expeditionHere(this) >= 0 ? 'expedition' : zone === 'desert' ? 'desert' : zone === 'snow' ? 'snow' : zone === 'swamp' ? 'swamp' : zone === 'badlands' ? 'badlands' : zone === 'ember' ? 'ember' : 'day';
    this.audio.playMusic(boss ?? (this.siege || final ? 'siege' : this.phase === 'night' ? 'night' : land));
  }

  /** Lava burns whoever wades into it (monsters do not climb back out). */
  private updateLava(dt: number): void {
    const inLava = (a: Actor): boolean => this.world.get(Math.floor(a.x), Math.floor(a.y + 0.3), Math.floor(a.z)) === B.LAVA;
    this.lavaTimer -= dt;
    const burn = this.lavaTimer <= 0;
    if (burn) this.lavaTimer = 0.5;
    this.eachPlayer((p) => {
      if (p.dead || !inLava(p) || this.effects.has('fireward')) return;
      p.vy = Math.max(p.vy, 3);
      if (!burn) return;
      damagePlayer(this, setDone(this, 5) ? 1.5 : 3, 0, 0);
      this.particles.sparks(p.x, p.y + 0.5, p.z, ['#ff8020', '#ffd040'], 6, 3, 0.1, 0.4);
    });
    // (Blazes and magma cubes are at home in it.)
    for (const m of this.mobs) if (!m.dead && !m.flying && m.kind !== 'magmacube' && inLava(m)) damageMob(this, m, 40 * dt, 0, 0);
  }

  /** Tangled in a cobweb (everything but spiders crawls through them). */
  inWeb(actor: Actor): boolean {
    if (actor.kind === 'spider') return false;
    const x = Math.floor(actor.x);
    const z = Math.floor(actor.z);
    return this.world.get(x, Math.floor(actor.y + 0.2), z) === B.COBWEB || this.world.get(x, Math.floor(actor.y + 1.2), z) === B.COBWEB;
  }

  /**
   * The ladder an actor can hold: one at its feet or chest (climbing up, also one just below its
   * feet, so it rises past the top rung and can step off onto the deck). A ladder whose wall the
   * actor is already behind does not count: you cannot climb it from the back.
   */
  ladderAt(actor: Actor): LadderHold | null {
    // Plummeting (or under the canopy) you sail past ladders, unless you push into one.
    if (!actor.climbing && actor.climbIntent <= 0 && (actor.chute > 0 || actor.vy < -9)) return null;
    const bodies = [this.fortress, ...this.giants.filter((g) => !g.dead).map((g) => g.body)];
    const offsets = actor.climbIntent > 0 ? LADDER_REACH_UP : LADDER_REACH;
    for (const yOff of offsets) {
      const y = actor.y + yOff;
      for (const [ox, oz] of LADDER_SAMPLES) {
        const x = actor.x + ox;
        const z = actor.z + oz;
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const iz = Math.floor(z);
        // High above the ground the climber grips the rungs instead of stepping off backwards.
        const grip = actor.y - this.world.groundAt(actor.x, actor.z) > 2.5;
        if (this.world.climbable(ix, iy, iz)) {
          const hold: LadderHold = { body: null, x: ix, y: iy, z: iz, dir: this.world.getMeta(ix, iy, iz), grip };
          if (inFrontOfLadder(hold, actor.x, actor.z)) return hold;
        }
        for (const b of bodies) {
          const [lx, ly, lz] = b.cellAt(x, y, z);
          const cell = b.get(lx, ly, lz);
          let dir = cell && blockDef(cell.id).climbable ? cell.dir : -1;
          // Under a ladder hanging off the fortress: its rope end, down to the ground.
          if (dir < 0 && !cell && b === this.fortress) {
            const rope = this.ropeEnds().find((r) => r.x === lx && r.z === lz && ly < r.y);
            if (rope && y >= this.ropeFloor(rope) - 0.2) dir = rope.dir;
          }
          if (dir < 0) continue;
          const [ax, , az] = b.toLocal(actor.x, actor.y, actor.z);
          const hold: LadderHold = { body: b, x: lx, y: ly, z: lz, dir, grip };
          if (inFrontOfLadder(hold, ax, az)) return hold;
        }
      }
    }
    return null;
  }

  private ropes = { version: -1, list: [] as Array<{ x: number; y: number; z: number; dir: number }> };

  /**
   * The lowest rungs of ladders hanging off the fortress (its frame): each one's rope end reaches
   * the ground wherever the fortress stands, so you can always climb aboard from below.
   */
  ropeEnds(): ReadonlyArray<{ x: number; y: number; z: number; dir: number }> {
    const F = this.fortress;
    if (this.ropes.version !== F.version) {
      const list: Array<{ x: number; y: number; z: number; dir: number }> = [];
      for (const [k, c] of F.cells) {
        if (c.id !== B.LADDER || F.hasBlock(kx(k), ky(k) - 1, kz(k))) continue;
        list.push({ x: kx(k), y: ky(k), z: kz(k), dir: c.dir });
      }
      this.ropes = { version: F.version, list };
    }
    return this.ropes.list;
  }

  /** World height of the ground a rope end hangs down to (no lower than ROPE_MAX under its rung). */
  ropeFloor(r: { x: number; y: number; z: number }): number {
    const [wx, wy, wz] = this.fortress.toWorld(r.x + 0.5, r.y, r.z + 0.5);
    const ix = Math.floor(wx);
    const iz = Math.floor(wz);
    const top = Math.floor(wy);
    for (let y = top; y > top - ROPE_MAX; y -= 1) if (this.world.solid(ix, y - 1, iz)) return y;
    return top - ROPE_MAX;
  }

  /**
   * Whether walking to (x, z) keeps you over something within a short drop. Only the deck of the
   * walking fortress is guarded (a slip off it is a long fall); ladders count as footing.
   */
  deckSupport(a: Actor, x: number, z: number): boolean {
    const F = this.fortress;
    if (a.standingOn !== F) return true;
    const box = { x, y: a.y - 2.6, z, hw: a.hw - 0.05, h: 2.55 };
    if (overlaps(box, worldGrid(this.world), 0.01) || overlaps(box, bodyGrid(F), 0.01)) return true;
    for (const [ox, oz] of LADDER_SAMPLES) {
      const [cx, cy, cz] = F.cellAt(x + ox, a.y - 0.6, z + oz);
      if (F.climbAt(cx, cy, cz)) return true;
    }
    return false;
  }

  /** True when an actor's grid has a climbable cell at a cell position. */
  private climbableIn(body: BlockBody | null, x: number, y: number, z: number): boolean {
    if (!body) return this.world.climbable(x, y, z);
    return body.climbAt(x, y, z);
  }

  private solidIn(body: BlockBody | null, x: number, y: number, z: number): boolean {
    if (!body) return this.world.solid(x, y, z);
    return body.solidAt(x, y, z);
  }

  /**
   * At the top rung, climbing up: step off onto the block the ladder hangs on (the deck), as you
   * would in Minecraft, instead of bobbing under its edge.
   */
  private mantle(p: Actor, grids: Grid[]): boolean {
    const h = p.ladder;
    if (!h || p.climbIntent <= 0) return false;
    const d = WALL_DIRS[h.dir];
    if (!d) return false;
    // Only when pushing towards the wall, or climbing on by itself (not when stepping out onto
    // the ladder to go down).
    const [wx, wz] = h.body ? h.body.dirToWorld(d[0], d[1]) : [d[0], d[1]];
    if (p.vx * wx + p.vz * wz < 0.4 && !this.jumpHeld && p.climbAuto <= 0) return false;
    if (this.climbableIn(h.body, h.x, h.y + 1, h.z)) return false;
    const [lx, ly, lz] = h.body ? h.body.toLocal(p.x, p.y, p.z) : [p.x, p.y, p.z];
    if (ly < h.y + 1 - 0.8) return false;
    const sx = h.x + d[0]!;
    const sz = h.z + d[1]!;
    if (!this.solidIn(h.body, sx, h.y, sz) || this.solidIn(h.body, sx, h.y + 1, sz) || this.solidIn(h.body, sx, h.y + 2, sz)) return false;
    const m = p.hw + 0.08;
    // Just past the wall line, on top of the block; centred on the rung if the edges are tight.
    const along = (lat: number): [number, number] => d[0] !== 0
      ? [d[0]! > 0 ? h.x + 1 + m : h.x - m, lat]
      : [lat, d[1]! > 0 ? h.z + 1 + m : h.z - m];
    const lateral = d[0] !== 0 ? lz : lx;
    const centre = (d[0] !== 0 ? h.z : h.x) + 0.5;
    for (const lat of [lateral, centre]) {
      const [tx, tz] = along(lat);
      const [wx, wy, wz] = h.body ? h.body.toWorld(tx, h.y + 1.002, tz) : [tx, h.y + 1.002, tz];
      const box = { x: wx, y: wy, z: wz, hw: p.hw, h: p.h };
      if (grids.some((gr) => overlaps(box, gr, 0.02))) continue;
      p.x = wx;
      p.y = wy;
      p.z = wz;
      p.vy = 0;
      p.onGround = true;
      p.standingOn = h.body;
      p.ladder = null;
      p.climbing = false;
      return true;
    }
    return false;
  }

  /** Off the bottom of a ladder: a step back from its wall onto the ground (clear of its rungs). */
  private stepOffLadder(p: Actor, grids: Grid[]): void {
    const h = p.ladder!;
    const d = WALL_DIRS[h.dir];
    if (!d) return;
    // Far enough back that no hand or foot reaches its column (the grab samples reach 0.32).
    const [lx, , lz] = h.body ? h.body.toLocal(p.x, p.y, p.z) : [p.x, p.y, p.z];
    const along = d[0] !== 0 ? lx * d[0] : lz * d[1];
    const face = d[0] !== 0 ? (d[0] > 0 ? h.x : -(h.x + 1)) : d[1] > 0 ? h.z : -(h.z + 1);
    const step = clamp(along - face + 0.45, 0.3, 1.5);
    const [wx, wz] = h.body ? h.body.dirToWorld(d[0], d[1]) : [d[0], d[1]];
    const m = sweepHorizontal(p, -wx * step, -wz * step, grids);
    p.x += m.dx;
    p.z += m.dz;
    p.ladder = null;
    p.climbing = false;
    p.climbAuto = 0;
  }

  /** 0..1: how far the view has pulled out from your eyes to the commander's view at the helm. */
  declare camPull: number;
  /** The third-person view's framing (see perspective.ts). */
  declare shoulderPull: number;
  declare shoulderSide: number;
  declare shoulderDist: number;
  /** Commander view framing: the height (above the deck) it orbits, how far ahead of the hull it looks, its extra distance and resting pitch. */
  helmCam = { pivot: 0, lead: 12, dist: 18, pitch: -0.42 };

  eye(): Vec3 {
    if (this.intro && this.cx === this.me) return this.intro.eye;
    const p = this.player;
    // (Third person: drawn back over your shoulder.)
    const fp = shoulderEye(this, [p.x, p.y + EYE + this.bob, p.z]);
    const k = this.camPull;
    if (k <= 0.001) return fp;
    // Orbit behind and above the walking fortress, looking where you look.
    const e = k * k * (3 - 2 * k);
    // (Working the crane: the crane's own view, out to the side of the lift.)
    const cc = this.craneCam;
    if (cc) return [fp[0] + (cc.eye[0] - fp[0]) * e, fp[1] + (cc.eye[1] - fp[1]) * e, fp[2] + (cc.eye[2] - fp[2]) * e];
    const F = this.fortress;
    const C = this.helmCam;
    const [cx0, cz0] = F.centre();
    const f = forward(this.yaw, this.pitch);
    const flat = Math.hypot(f[0], f[2]) || 1;
    const cx = cx0 + (f[0] / flat) * C.lead;
    const cz = cz0 + (f[2] / flat) * C.lead;
    // A taller hold: the view rises with it and draws back to keep the way ahead in sight.
    const tall = this.camTall;
    const dist = this.fortressRadius() + C.dist + tall * 0.45;
    const ox = cx - f[0] * dist;
    const oz = cz - f[2] * dist;
    const oy = Math.max(F.y + C.pivot + tall * 0.55 - f[1] * dist, F.y + 2.5, this.world.groundAt(ox, oz) + 2);
    return [fp[0] + (ox - fp[0]) * e, fp[1] + (oy - fp[1]) * e, fp[2] + (oz - fp[2]) * e];
  }

  viewRay(): Ray {
    if (this.cx.aim) return this.cx.aim;
    const [ox, oy, oz] = this.eye();
    const [dx, dy, dz] = forward(this.yaw, this.pitch);
    return fromShoulder(this, { ox, oy, oz, dx, dy, dz });
  }

  /** Sky and block light (0..1) at a world point, shaded by the fortress when inside it. */
  lightAt(x: number, y: number, z: number): [number, number] {
    const w = this.world;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    let sky = iy >= WY ? 15 : w.skyAt(ix, iy, iz);
    let blk = w.blockLightAt(ix, iy, iz);
    for (const body of [this.fortress, ...this.giants.map((g) => g.body)]) {
      const L = this.renderer.bodyLight(body);
      if (!L) continue;
      const [lx, ly, lz] = body.cellAt(x, y, z);
      const [s, b] = bodyLightAt(L, lx, ly, lz);
      sky = Math.min(sky, s);
      blk = Math.max(blk, b);
    }
    return [sky / 15, blk / 15];
  }

  /** Tooling override of the day-cycle clock (screenshots, tuning). */
  debugClock: number | null = null;

  /** The day-cycle clock (0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight). */
  clock(): number {
    if (this.debugClock !== null) return this.debugClock;
    if (this.phase === 'title' || this.phase === 'loading') return 0.462;
    if (this.siege) return 0.7;
    if (this.phase === 'night') return nightClock(this.progress);
    if (this.phase === 'won') return 0.03;
    if (this.phase === 'lost') return 0.62;
    const f = this.dayStart + (1 - this.dayStart) * (1 - this.dayTime / Math.max(1, this.dayLength));
    return dayClock(f);
  }

  /** Deck centre (world): x, floor y, z. */
  fortressCentre(): Vec3 {
    const F = this.fortress;
    const [x, z] = F.centre();
    return [x, F.y + F.floorY, z];
  }

  /**
   * How hard the world hits back, as a day-equivalent (1 on the first night, about 8 at the
   * Citadel's doorstep). The classic valley counts the days; the Long March measures how far
   * east the fortress has come (so its twice-as-many nights climb the same curve).
   */
  get danger(): number {
    const T = this.world.terrain;
    if (T.version < 2) return this.day;
    const [x] = this.fortress.centre();
    return 1 + 7 * clamp((x - 235) / (T.citadel.x - 350), 0, 1);
  }

  fortressRadius(): number {
    const F = this.fortress;
    return Math.hypot(F.maxX - F.minX + 1, F.maxZ - F.minZ + 1) / 2;
  }

  /** Foot of the boarding ladder (world), where recruits climb aboard. */
  ladderFoot(): Vec3 {
    const F = this.fortress;
    for (const [k, c] of F.cells) {
      if (c.id !== B.LADDER || ky(k) > -6) continue;
      const [x, , z] = F.toWorld(kx(k) + 0.5, 0, kz(k) + 0.5);
      return [x, this.world.groundAt(x, z), z];
    }
    const c = this.fortressCentre();
    return [c[0], this.world.groundAt(c[0], c[2]), c[2]];
  }

  fortressStats(): { blocks: number; height: number } {
    const F = this.fortress;
    return { blocks: F.cells.size, height: F.maxY - F.floorY + 1 + Math.round(this.walker.rideHeight()) };
  }

  poweredThrusters(): number {
    let n = 0;
    for (const key of this.fortress.poweredMachines) {
      const id = this.fortress.cells.get(key)?.id;
      if (id === B.THRUSTER || id === B.WINDMILL_HUB) n += 1;
    }
    return n;
  }

  machineCounts(): { powered: number; total: number } {
    let total = 0;
    for (const c of this.fortress.cells.values()) if (c.id === B.CANNON || c.id === B.THRUSTER || c.id === B.WINDMILL_HUB) total += 1;
    let powered = 0;
    for (const key of this.fortress.poweredMachines) {
      const id = this.fortress.cells.get(key)?.id;
      if (id === B.CANNON || id === B.THRUSTER || id === B.WINDMILL_HUB) powered += 1;
    }
    return { powered, total };
  }

  /** Power for the HUD: the share of machines on the grid, scaled by the Core's health. */
  power(): number {
    const m = this.machineCounts();
    const core = this.coreHp();
    const grid = m.total > 0 ? m.powered / m.total : 1;
    return clamp(grid * (0.4 + 0.6 * (core.hp / Math.max(1, core.max))), 0, 1);
  }

  integrity(): number {
    return integrity(this.fortress);
  }

  fortressSpeed(): number {
    const { blocks } = this.fortressStats();
    const thrusters = Math.min(8, this.poweredThrusters());
    // Hoisted windmills turn into sails for the march; sheer mass slows it a little.
    const mills = cargoPower(this, 'windmill');
    const frozen = this.chill > 0 ? 0.35 : 1;
    // (The hold is built light: its timber and lath weigh a fifth of solid blocks.)
    const mass = blocks - 0.8 * this.holdSize();
    const bosun = hasOfficer(this, 'gil') ? 1.15 : 1;
    return ((2.3 + thrusters * 0.4 + mills * 0.35) / (1 + Math.max(0, mass - 1400) / 2600)) * frozen * bosun;
  }

  /** Cells the hold's plan lays (its buildings, wings, stairs and galleries). */
  holdSize(): number {
    return this.hold?.cells.size ?? 0;
  }

  /** Plans the hold again for the buildings aboard (a co-op guest, as the host's change). */
  refreshHold(): void {
    loadHold(this);
  }

  turnSpeed(): number {
    return turnSpeed(this);
  }

  coreHp(): { hp: number; max: number } {
    const key = this.coreKey();
    const c = key === null ? null : this.fortress.cells.get(key)!;
    return { hp: c ? Math.max(0, c.hp) : 0, max: c ? c.maxHp : 80 };
  }

  level(): number {
    return Math.floor(Math.sqrt(this.xpPoints / 7));
  }

  levelProgress(): number {
    const l = this.level();
    const a = l * l * 7;
    const b = (l + 1) * (l + 1) * 7;
    return clamp((this.xpPoints - a) / (b - a), 0, 1);
  }

  xp(n: number): void {
    const before = this.level();
    this.xpPoints += n;
    if (this.level() > before) {
      // The level is the crew's: everyone aboard gets it.
      for (const ctx of this.players()) {
        this.withCtx(ctx, () => {
          this.sfx('levelup', 'metal', 0.8);
          this.ui.levelUp(this.level());
        });
        ctx.player.maxHp = this.maxHearts();
      }
    }
  }

  /** Your hearts (half-hearts): the level's, and Greenvale's keepsakes. */
  maxHearts(): number {
    return 20 + Math.min(10, this.level()) + (setDone(this, 0) ? 4 : 0);
  }

  /** What the crew and the cabinet add up to (after a load, an officer aboard, a set finished). */
  applyPerks(): void {
    for (const ctx of this.players()) ctx.player.maxHp = this.maxHearts();
    const k = this.coreKey();
    const c = k !== null ? this.fortress.cells.get(k) : null;
    if (c) {
      const hurt = c.maxHp - c.hp;
      c.maxHp = coreMaxHp(this);
      c.hp = Math.max(1, c.maxHp - hurt);
    }
  }

  /** A survey stone lit: its lamp comes on, and Wren's map grows a little. */
  lightSurvey(id: string): void {
    const s = this.world.structures.byId.get(`n:${id}`);
    if (!s) return;
    for (let i = 0; i < s.count; i += 1) {
      if (s.ids[i] !== B.REDSTONE_LAMP) continue;
      this.world.set(s.xs[i]!, s.ys[i]!, s.zs[i]!, B.GLOWSTONE);
      this.particles.sparks(s.xs[i]! + 0.5, s.ys[i]! + 1, s.zs[i]! + 0.5, ['#ffe070', '#ffffff'], 24, 5, 0.1, 0.8);
      this.light({ x: s.xs[i]! + 0.5, y: s.ys[i]! + 1, z: s.zs[i]! + 0.5, r: 14, color: [1.3, 1, 0.5], life: 1.2, max: 1.2 });
    }
  }

  eat(): void {
    if (this.hunger >= 20) {
      this.deny('You are not hungry');
      return;
    }
    if (!this.useItem(I.BREAD, 1)) return;
    this.hunger = Math.min(20, this.hunger + 6);
    this.sfx('pickup', 'dirt', 0.8);
    this.toast('Ate some bread', 'bread');
  }

  /** Bo's stew: a full belly and a little healing. */
  eatStew(): void {
    if (this.hunger >= 20 && this.player.hp >= this.player.maxHp) {
      this.deny('You are not hungry');
      return;
    }
    if (!this.useItem(I.STEW, 1)) return;
    this.hunger = Math.min(20, this.hunger + 12);
    addEffect(this, 'regen', 8);
    this.sfx('pickup', 'dirt', 0.9);
    this.toast('Hearty stew', 'stew_item');
  }

  /** The cactus fruit's sharp little meal. */
  eatFruit(): void {
    if (this.hunger >= 20) {
      this.deny('You are not hungry');
      return;
    }
    if (!this.useItem(I.CACTUS_FRUIT, 1)) return;
    this.hunger = Math.min(20, this.hunger + 2);
    this.sfx('pickup', 'dirt', 0.7);
  }

  /** One of Moss's brews. */
  drinkBrew(id: number): void {
    const brew = id === I.POTION_SWIFT ? (['swift', 'Swiftness'] as const) : id === I.POTION_STRENGTH ? (['strength', 'Strength'] as const) : id === I.POTION_FIRE ? (['fireward', 'Fire Ward'] as const) : (['frostward', 'Frost Ward'] as const);
    if (!this.useItem(id, 1)) return;
    addEffect(this, brew[0], 60);
    if (brew[0] === 'frostward') this.effects.delete('slowness');
    this.ui.effectsChanged();
    this.sfx('drink', 'glass', 0.9);
    const p = this.player;
    this.particles.sparks(p.x, p.y + 1.2, p.z, [EFFECTS[brew[0]].color, '#ffffff'], 14, 2, 0.08, 0.7);
    this.toast(`${brew[1]} for a minute`, itemDef(id).icon);
  }

  /** A potion of healing (a witch's): hearts back at once, and a little regeneration. */
  drinkPotion(): void {
    const p = this.player;
    if (p.hp >= p.maxHp && !this.effects.has('poison') && !this.effects.has('wither')) {
      this.deny('You are already at full health');
      return;
    }
    if (!this.useItem(I.POTION, 1)) return;
    p.hp = Math.min(p.maxHp, p.hp + 8);
    this.effects.delete('poison');
    addEffect(this, 'regen', 6);
    this.ui.effectsChanged();
    this.sfx('drink', 'glass', 0.9);
    this.particles.sparks(p.x, p.y + 1.2, p.z, ['#f82424', '#ff8a8a', '#ffffff'], 14, 2, 0.08, 0.7);
    this.toast('Potion of Healing: +4 hearts', 'potion_item');
  }

  // ------------------------------------------------------------------ input API

  look(dYaw: number, dPitch: number): void {
    this.yaw = (this.yaw + dYaw) % (Math.PI * 2);
    this.pitch = clamp(this.pitch + dPitch, -1.5, 1.5);
    if (Math.abs(dYaw) + Math.abs(dPitch) > 1e-4) this.lookTime = this.time;
  }

  setMove(x: number, z: number): void {
    const l = Math.hypot(x, z);
    this.move.x = l > 1 ? x / l : x;
    this.move.z = l > 1 ? z / l : z;
    if (l > 0.3) this.report('primary_input');
  }

  setJump(down: boolean): void {
    // Swinging a crate out on the crane: JUMP calls it off (the crate goes back on the deck).
    if (down && this.craneDrop?.by === this.me && this.craneDrop.stage !== 'fall') {
      if (!this.remote('dropoff')) cancelCraneDrop(this);
      return;
    }
    // At the helm the jump button is the steam valve: hold for full steam.
    this.boostHeld = down && this.helm;
    if (down && !this.jumpHeld) {
      // Reeling on the grapple: jump lets go, flung. Holding a hen in mid-air: she gives one hard
      // flap. Pushing against the deck's rail: over the side you go.
      const way = this.helm || this.gunner || this.leap || this.overSide || !this.isPlaying() ? null : offeredExit(this, 0.25, 0.12);
      if (this.grapple?.stage === 'pull') releaseGrapple(this, true);
      else if (this.carried && this.henFlap()) this.jumpBuffer = 0;
      else if (way) goOverSide(this, way);
      else if (!this.helm && !this.gunner) this.jumpBuffer = 0.2;
      this.report('primary_input');
    }
    this.jumpHeld = down;
  }

  /** JUMP DOWN: over the deck's side where you push against it (the parachute does the rest). */
  jumpDown(): void {
    if (!this.isPlaying() || this.player.dead || this.leap || this.overSide) return;
    const way = offeredExit(this);
    if (way) goOverSide(this, way);
  }

  /** Co-op guest: an action on the shared world goes to the host (true: sent, nothing more to do here). */
  remote(name: string, ...args: unknown[]): boolean {
    const guest = this.coopGuest;
    if (!guest) return false;
    guest.send(name, args);
    return true;
  }

  /** Whether the hen's flap is ready (once per hop: it comes back when you land). */
  declare flapReady: boolean;

  /** Mid-air with a hen in your arms: one hard flap lifts you again (a chicken double jump). */
  private henFlap(): boolean {
    const p = this.player;
    if (p.onGround || p.climbing || p.dead || this.inWater(p) || !this.flapReady) return false;
    this.flapReady = false;
    p.vy = Math.max(p.vy, 7);
    this.sfx('cluck', 'flesh', 0.95, 1.35);
    this.sfx('whoosh', 'wool', 0.5, 1.3);
    fluff(this, p.x, p.y + 1.1, p.z, 7);
    return true;
  }

  /** Full steam from a keyboard key (Shift) while at the helm. */
  setBoost(down: boolean): void {
    this.boostHeld = down && this.helm;
  }

  beginHold(ray: Ray): void {
    if (!this.isPlaying() || this.overSide) return;
    // The crane waits on its operator: a press anywhere heaves (or drops) it.
    if (craneBeat(this)) {
      this.use(false);
      return;
    }
    // (Between its beats the view is the crane's: a press that comes late digs nothing.)
    if (this.craneCam) return;
    if (this.coopGuest) {
      // The press goes to the host (it digs, strikes or fires there); the ray follows the finger.
      if (this.carried) return;
      this.holdRay = ray;
      this.remote('hold', ray);
      return;
    }
    // A click on the shooting star makes a wish.
    if (catchStar(this, ray)) return;
    // At the helm (or on the guns) a press fires the turrets where you point; held, they keep firing.
    if (this.helm || this.gunner) {
      fireCannon(this, ray);
      this.holdRay = this.helm && this.otherGunner() ? null : ray;
      return;
    }
    // Your hands are full of hen.
    if (this.carried) return;
    this.holdRay = ray;
    this.mining.target = null;
    this.mining.progress = 0;
    this.report('primary_input');
  }

  moveHold(ray: Ray): void {
    if (!this.holdRay) return;
    this.holdRay = ray;
    // (A co-op guest's press digs on the host: it follows the finger there too.)
    this.coopGuest?.aim(ray);
  }

  /** The co-op mate as this screen shows it (null: playing alone). */
  mate(): MateShown | null {
    return this.coopHost?.mateShown() ?? this.coopGuest?.hostShown() ?? null;
  }

  endHold(): void {
    if (this.coopGuest && this.holdRay) this.remote('unhold');
    this.holdRay = null;
    this.mining.target = null;
    this.mining.progress = 0;
  }

  tap(ray: Ray): void {
    if (!this.isPlaying() || this.player.dead || this.leap || this.overSide) return;
    this.report('primary_input');
    if (craneBeat(this)) {
      this.use(false);
      return;
    }
    // Working the crane, a tap that misses its beat (the needle already past the gold, the load
    // already let down) is not a throw or a grapple shot from wherever you happen to stand.
    if (this.craneCam) return;
    if (this.coopGuest) {
      // The grapple is the guest's own (it moves only the guest); everything else is the host's.
      if (this.selected === I.GRAPPLE && this.mode === 'mine' && !this.helm && !this.gunner && !this.carried) {
        fireGrapple(this, ray);
        return;
      }
      if (!this.helm && !this.gunner) this.mining.swing = Math.max(this.mining.swing, 0.2);
      this.remote('tap', ray);
      return;
    }
    if (catchStar(this, ray)) return;
    if (this.helm || this.gunner) {
      fireCannon(this, ray);
      return;
    }
    // Holding a hen, a tap sets her down in front of you.
    if (this.carried) {
      setDownHen(this);
      return;
    }
    tapAction(this, ray);
  }

  /**
   * A press that lands on (or right beside) a monster strikes the moment the finger touches,
   * not when it lifts. Returns true when it struck (the release then does nothing more).
   */
  strike(ray: Ray): boolean {
    if (!this.isPlaying() || this.player.dead || this.leap || this.overSide || this.helm || this.gunner || this.mode === 'build' || this.carried || this.craneCam) return false;
    if (this.coopGuest) {
      // Struck at once if there is something to strike (the host lands the blow).
      if (this.selected === I.CROSSBOW || this.selected === I.GRAPPLE || this.selected === I.BREAKER || this.selected === I.PEARL || this.selected === I.WIND_CHARGE) return false;
      const fireball = this.projectiles.some((pr) => pr.kind === 'fireball' && !pr.deflected && Math.hypot(pr.x - ray.ox, pr.y - ray.oy, pr.z - ray.oz) < 4.6);
      if (!fireball && !meleeTarget(this, ray)) return false;
      this.mining.swing = 0.25;
      this.remote('strike', ray);
      return true;
    }
    // A ghast's fireball right in front of you: bat it back (any hand will do).
    if (swatFireball(this, ray)) {
      this.report('primary_input');
      return true;
    }
    // Ranged relics act on the tap (or, held, keep shooting), not on the press.
    if (this.selected === I.CROSSBOW || this.selected === I.GRAPPLE || this.selected === I.BREAKER || this.selected === I.PEARL || this.selected === I.WIND_CHARGE) return false;
    const foe = meleeTarget(this, ray);
    if (!foe) return false;
    meleeMob(this, foe);
    this.report('primary_input');
    return true;
  }

  /** Stonewater's war horn (the HORN button, G). */
  blowHorn(): void {
    if (this.remote('horn')) return;
    blowHorn(this);
  }

  /** Aboard: every leg slams down at once (the STOMP button, X). A tap stomps at once... */
  stomp(): void {
    if (this.remote('stomp', 2)) return;
    groundPound(this);
  }

  /** ...held, the hull heaves higher and comes down harder (it lets go on release, or at full power). */
  stompPress(): void {
    if (this.remote('stomp', 1)) return;
    beginPound(this);
  }

  stompRelease(): void {
    if (this.remote('stomp', 0)) return;
    releasePound(this);
  }

  /** Seconds until you can throw another TNT. */
  declare throwCooldown: number;

  /**
   * The context action (E key / action button; `seen`: the label the button showed when pressed).
   * Falls back to the workshop on PC.
   */
  use(fallback = true, seen?: string): void {
    if (!this.isPlaying() || this.player.dead) return;
    const action = contextAction(this);
    // The button does what it says: a target that changed under the thumb (the view swung onto the
    // rail as TAKE HELM was pressed: JUMP DOWN) shows its own label first instead of acting at once.
    // (The crane's beats are timed: they always go.)
    const shown = seen ?? this.context?.label;
    if (action && shown && !craneBeat(this) && actionKind(action.label) !== actionKind(shown)) {
      this.context = action;
      this.contextTimer = 0.12;
      return;
    }
    if (action && this.coopGuest && !action.local) {
      // The host works the same action out along this view and does it.
      this.remote('use', this.viewRay());
      this.context = null;
      this.contextTimer = 0.25;
      return;
    }
    if (action) {
      action.run();
      this.context = null;
      this.contextTimer = 0;
      return;
    }
    if (fallback) this.ui.openWorkshop();
  }

  releaseInputs(): void {
    if (this.coopGuest) {
      if (this.pound?.held) this.remote('stomp', 0);
    } else releasePound(this);
    this.endHold();
    this.setMove(0, 0);
    this.keys.forward = this.keys.back = this.keys.left = this.keys.right = false;
    this.jumpHeld = false;
    this.boostHeld = false;
  }

  selectItem(id: number): void {
    if (this.count(id) <= 0) return;
    if (this.coopGuest) {
      // In hand at once (the host takes care of eating, drinking and reading maps).
      this.remote('sel', id);
      if (id === I.TREASURE_MAP || id === I.BREAD || id === I.POTION || id === I.STEW || id === I.CACTUS_FRUIT || BREWS.has(id)) return;
      if (HAND_ITEMS.has(id)) {
        this.selected = id;
        this.mode = 'mine';
      } else if (itemDef(id).place !== null) {
        this.selected = id;
        this.mode = 'build';
      }
      this.sfx('click');
      this.ui.onInventoryChanged();
      return;
    }
    // Something else in hand: the hen is set down first.
    if (this.carried) setDownHen(this);
    if (id === I.TREASURE_MAP) {
      readTreasureMap(this);
      return;
    }
    if (HAND_ITEMS.has(id)) {
      this.selected = id;
      this.mode = 'mine';
      if (id === I.BREAD) this.eat();
      if (id === I.STEW) this.eatStew();
      if (id === I.CACTUS_FRUIT) this.eatFruit();
      if (id === I.POTION) this.drinkPotion();
      if (BREWS.has(id)) this.drinkBrew(id);
      if (id === I.HEARTSTONE) this.toast('Take the Heartstone to the Engine Core and SOCKET it', 'heartstone_item');
      if (id === I.NETHER_STAR) this.toast(this.beacon ? 'Your beacon already burns: keep the star as a trophy' : 'Take the Nether Star to the Engine Core: LIGHT THE BEACON', 'netherstar_item');
      if (id === I.TOTEM) this.toast('The Totem of Undying works from your pack: if a blow would knock you out, it saves you', 'totem_item');
      if (id === I.PEARL) this.toast(this.input === 'desktop' ? 'Ender Pearl: right click to throw it; you teleport where it lands' : 'Ender Pearl: tap to throw it; you teleport where it lands', 'pearl_item');
      this.sfx('click');
      this.ui.onInventoryChanged();
      return;
    }
    if (itemDef(id).place === null) return;
    this.selected = id;
    this.mode = 'build';
    this.sfx('click');
    this.ui.onInventoryChanged();
  }

  selectPickaxe(): void {
    if (this.remote('sel', -1)) {
      this.mode = 'mine';
      this.selected = null;
      this.sfx('click');
      this.ui.onInventoryChanged();
      return;
    }
    if (this.carried) setDownHen(this);
    this.mode = 'mine';
    this.selected = null;
    this.sfx('click');
    this.ui.onInventoryChanged();
  }

  isPlaying(): boolean {
    const live = (this.phase === 'day' || this.phase === 'night') && !this.finale;
    // A co-op partner as the host runs it: in play whenever its device is connected.
    if (this.cx.kind === 'remote') return live && !this.cx.away;
    return live && !this.paused && this.modal === 'none' && !this.intro;
  }

  /** The last seconds before the result: the Citadel (or your fortress) goes up in slow motion. */
  finale: { kind: Outcome; t: number; x: number; y: number; z: number; next: number } | null = null;

  /** Starts the closing sequence over a point (the Heart's crown, or your Engine Core). */
  startFinale(kind: Outcome, x: number, y: number, z: number): void {
    if (this.finale || this.phase === 'won' || this.phase === 'lost') return;
    this.finale = { kind, t: 0, x, y, z, next: 0 };
    this.releaseInputs();
    this.audio.playMusic('none');
    this.sfx(kind === 'victory' ? 'ram' : 'explode', 'stone', 1);
    this.renderer.shake(1.2);
    this.buzz(kind === 'victory' ? 250 : 400);
    this.ui.flash(kind === 'victory' ? 'gold' : 'red');
    this.ui.clearTip();
    if (kind === 'victory') {
      this.ui.banner('THE HEART IS DUST!', 'The Creeper Citadel falls!', 'gold');
      this.celebrate(10);
    }
    else this.ui.banner('THE CORE IS BROKEN!', 'Your walking fortress falls...', 'danger');
  }

  /** Blast after blast round the target while the world hangs still, then the result. */
  private updateFinale(dt: number): void {
    const f = this.finale!;
    f.t += dt;
    f.next -= dt;
    const spread = f.kind === 'victory' ? 9 : 6;
    if (f.next <= 0 && f.t < 2.3) {
      f.next = 0.22 + Math.random() * 0.2;
      const x = f.x + (Math.random() - 0.5) * spread * 2;
      const y = f.y + (Math.random() - 0.4) * spread;
      const z = f.z + (Math.random() - 0.5) * spread * 2;
      this.particles.flash(x, y, z, 3.5);
      this.particles.sparks(x, y, z, f.kind === 'victory' ? ['#a4f04a', '#ffffff', '#ffd060'] : ['#ff5a3a', '#ffd040', '#ffffff'], 26, 12, 0.16, 0.9);
      this.particles.smoke(x, y, z, 10, 3, true);
      this.particles.ring(x, y, z, 5, f.kind === 'victory' ? 0.6 : 1, f.kind === 'victory' ? 1 : 0.5, 0.4);
      this.light({ x, y, z, r: 18, color: f.kind === 'victory' ? [0.6, 1.2, 0.5] : [1.3, 0.5, 0.25], life: 0.5, max: 0.5 });
      this.sfx('explode', 'stone', 0.9);
      this.renderer.shake(0.7);
      this.buzz(60);
    }
    // Only the fire moves: blasts, smoke and falling stones play out in slow motion.
    const slow = dt * 0.45;
    this.updateFireworks(slow);
    this.particles.update(slow);
    updateFalling(this, slow);
    for (const light of this.lights) light.life -= slow;
    this.lights = this.lights.filter((light) => light.life > 0);
    if (f.t >= 2.7) {
      this.finale = null;
      this.finish(f.kind);
    }
  }

  toast(text: string, icon?: string): void {
    this.ui.toast(text, icon);
  }

  deny(text: string): void {
    this.own(() => {
      this.sfx('deny');
      if (this.time - this.cx.denyAt > 1.2 || this.cx.denyAt > this.time) {
        this.cx.denyAt = this.time;
        this.toast(text);
      }
    });
  }

  /** Runs `fn` as something that concerns the acting player alone (its news is not shared in co-op). */
  own<T>(fn: () => T): T {
    this.privacy += 1;
    try {
      return fn();
    } finally {
      this.privacy -= 1;
    }
  }

  /** Inside `own`: the acting player's own business. */
  privacy = 0;

  /** The nearest dangers for the HUD's edge arrows: giants, phantoms, monsters on the legs (and a shooting star to wish on). */
  threats(): Array<{ x: number; y: number; z: number; kind: 'giant' | 'phantom' | 'climber' | 'quest' | 'star' }> {
    const out: Array<{ x: number; y: number; z: number; kind: 'giant' | 'phantom' | 'climber' | 'quest' | 'star'; d: number }> = [];
    const p = this.player;
    // (The way to your next goal is the coach's marker.)
    if (this.phase === 'day') return out;
    if (this.star) {
      const d = starDir(this.star);
      const e = this.eye();
      out.push({ x: e[0] + d[0] * 90, y: e[1] + d[1] * 90, z: e[2] + d[2] * 90, kind: 'star', d: -999 });
    }
    for (const gi of this.giants) {
      if (gi.dead) continue;
      const [x, z] = gi.body.hullCentre();
      // Aim marks go on its glowing Heart (the weak spot) when it still has one.
      const heart = gi.body.findBlock(B.GIANT_HEART);
      const h = heart !== null ? gi.body.cellCenter(kx(heart), ky(heart), kz(heart)) : null;
      out.push({ x: h ? h.x : x, y: h ? h.y : (gi.body.bottom + gi.body.top) / 2, z: h ? h.z : z, kind: 'giant', d: Math.hypot(x - p.x, z - p.z) - 30 });
    }
    for (const m of this.mobs) {
      if (m.dead) continue;
      if (m.kind === 'wither') out.push({ x: m.x, y: m.y + m.h * 0.75, z: m.z, kind: 'giant', d: Math.hypot(m.x - p.x, m.z - p.z) - 40 });
      else if (m.kind === 'phantom' || m.kind === 'ghast') out.push({ x: m.x, y: m.cy, z: m.z, kind: 'phantom', d: Math.hypot(m.x - p.x, m.z - p.z) - 10 });
      else if (m.climb) out.push({ x: m.x, y: m.cy, z: m.z, kind: 'climber', d: Math.hypot(m.x - p.x, m.z - p.z) });
    }
    // The last raiders of a wave show at the screen's edge (so the raid never stalls on one lost in the woods).
    for (const m of raidersLeft(this)) out.push({ x: m.x, y: m.cy, z: m.z, kind: 'climber', d: Math.hypot(m.x - p.x, m.z - p.z) - 20 });
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, 6);
  }

  /** Gold markers over deck cells worth a look (a turret the crew just bolted on). */
  pings: Array<{ local: Vec3; until: number }> = [];

  ping(local: Vec3, seconds = 15): void {
    this.pings.push({ local, until: this.time + seconds });
  }

  /** The next step (refreshed a few times a second) for the goal line, the beacon and the arrow. */
  goal: Goal | null = null;
  /** The goal's spot in the fortress's frame, when it is on (or hangs from) the fortress. */
  goalLocal: Vec3 | null = null;
  /** The spot a lesson card points at while it is up (the chevron goes there instead). */
  lessonMark: Vec3 | null = null;

  /** Where the next step is right now (a spot on the walking fortress moves with it). */
  goalTarget(): Vec3 | null {
    const t = this.goal?.target ?? null;
    const l = this.goalLocal;
    return t && l ? this.fortress.toWorld(l[0], l[1], l[2]) : t;
  }
  private duskWarned = false;

  /** Thirty seconds before dusk: a bell, and a call to get back aboard if you are away. */
  private duskWarning(dt: number): void {
    if (this.phase !== 'day' || training(this)) {
      this.duskWarned = false;
      return;
    }
    if (this.dayTime > 31) {
      this.duskWarned = false;
      return;
    }
    if (this.duskWarned) return;
    this.duskWarned = true;
    void dt;
    this.sfx('bell', 'metal', 0.6);
    const away = this.player.standingOn !== this.fortress && !this.helm;
    this.toast(away ? 'Dusk in 30 seconds: get back aboard!' : 'Dusk in 30 seconds: the march begins');
  }

  /** One of your shots connected (the HUD flashes a marker, with a ping). */
  hitMarker(kill: boolean): void {
    this.hitKill = kill || (this.time - this.hitAt < 0.15 && this.hitKill);
    this.hitAt = this.time;
    this.sfx('click', 'metal', kill ? 0.9 : 0.5);
    this.cx.sink?.hitmark(kill);
  }

  fireCannon(): boolean {
    if (this.remote('fire', this.viewRay())) return true;
    return fireCannon(this);
  }

  doLeap(): void {
    doLeap(this);
  }

  mannedCannon(): { key: number } | null {
    return nearestCannon(this);
  }

  leapTarget(): { back: boolean } | null {
    return leapTarget(this);
  }

  stationsNearby(): Stations {
    return stationsNearby(this);
  }

  recipeStatus(recipe: Recipe, stations = this.stationsNearby()): { ok: boolean; station: boolean; missing: boolean } {
    return recipeStatus(this, recipe, stations);
  }

  craft(recipeId: string): boolean {
    if (this.remote('craft', recipeId)) return true;
    return craft(this, recipeId);
  }

  /** At a village trader: buy, turn a quest in, upgrade a hoisted building (the host's hold pays). */
  trade(kind: 'buy' | 'turnin' | 'upgrade' | 'crane', arg: string | number): { ok: boolean; note: string } {
    if (this.remote('trade', kind, arg)) return { ok: true, note: '' };
    if (kind === 'buy') return buy(this, String(arg));
    if (kind === 'crane') return buyPart(this, String(arg));
    if (kind === 'turnin') {
      turnIn(this, Number(arg));
      return { ok: true, note: '' };
    }
    return { ok: upgradeCargo(this, Number(arg)), note: '' };
  }

  // ------------------------------------------------------------------ main loop

  /** Inside update(): the world's own goings-on (anything else is somebody's input). */
  inUpdate = false;

  update(dt: number): void {
    this.inUpdate = true;
    try {
      this.updateWorld(dt);
    } finally {
      this.inUpdate = false;
    }
  }

  private updateWorld(dt: number): void {
    if (this.phase === 'loading') return;
    if (this.phase !== 'title') this.world.stream(this.streamCentres(), this.isPlaying() ? 4 : 8, 3, 520);
    // A co-op guest mirrors the host's world and moves only its own avatar.
    if (this.coopGuest) {
      this.coopGuest.update(dt);
      if (this.phase === 'day' || this.phase === 'night') this.present(dt);
      else this.audio.loop('walk', 0);
      return;
    }
    if (this.finale && !this.paused) {
      this.updateFinale(dt);
      this.audio.loop('walk', 0);
      this.coopHost?.tick(dt);
      return;
    }
    // (In co-op the world is shared: it goes on while you are in a menu.)
    if (this.phase === 'title' || ((this.paused || this.modal !== 'none') && !this.coopLive)) {
      this.audio.loop('walk', 0);
      this.coopHost?.tick(dt);
      return;
    }
    // The opening flyover: the world lives on while the camera tours it.
    if (this.intro) {
      if (!updateIntro(this, this.intro, dt)) this.skipIntro();
      const n = Math.max(1, Math.ceil(dt / (1 / 60)));
      for (let i = 0; i < n; i += 1) this.step(dt / n);
      this.audio.loop('walk', 0);
      this.coopHost?.tick(dt);
      return;
    }
    // Hit-stop: a landed blow holds the world for a beat while the camera and HUD run on.
    const sim = this.hitStop > 0 ? dt * 0.12 : dt;
    this.hitStop = Math.max(0, this.hitStop - dt);
    const steps = Math.max(1, Math.ceil(sim / (1 / 60)));
    const h = sim / steps;
    for (let i = 0; i < steps; i += 1) this.step(h);
    this.coopHost?.tick(dt);
    this.present(dt);
  }

  /** This device's view of the world: the camera, the music and machinery, the guidance. */
  private present(dt: number): void {
    animateCrane(this, dt);
    this.hurtTilt *= Math.exp(-dt * 7);
    this.viewKick *= Math.exp(-dt * 11);
    // Under the canopy the view banks into your steering and sways a little; a landed one settles.
    const p = this.player;
    const [rx, , rz] = rightOf(this.yaw);
    const lean = p.chute > 0 ? clamp((p.vx * rx + p.vz * rz) / CHUTE_STEER, -1, 1) * 0.07 + Math.sin(this.time * 1.7) * 0.012 * p.chute : 0;
    this.chuteRoll = approach(this.chuteRoll, lean, dt * 0.35);
    if (this.chuteFold) {
      this.chuteFold.t += dt;
      if (this.chuteFold.t >= FOLD_TIME) this.chuteFold = null;
    }
    // At the helm the view widens with speed, and more at full steam.
    const pace = clamp(Math.abs(this.speed) / Math.max(0.5, this.fortressSpeed()), 0, 1.8);
    const fovWant = this.helm ? 1 + 0.03 * Math.min(1, pace) + (this.boosting ? 0.07 : 0) : this.gunner ? 1.04 : 1;
    this.fov = approach(this.fov, fovWant, dt * (fovWant > this.fov ? 0.4 : 0.25));
    this.helmSpin += this.turnRate * dt * 7;
    this.heartbeat(dt);
    // (The view draws out to watch the crane work a building you lifted, from the hook going down
    // to the last block landing, and to swing a TNT crate out over the monsters.)
    const settling = ((this.hoist !== null && this.hoist.by === this.me) || (this.craneDrop !== null && this.craneDrop.by === this.me)) && !this.player.dead && !this.helm && !this.gunner;
    this.camTall = approach(this.camTall, Math.max(0, this.fortress.maxY - 6), dt * 2.5);
    this.camPull = approach(this.camPull, (this.helm || this.gunner || settling) && !this.player.dead ? 1 : 0, dt * 1.6);
    if (settling || this.craneCam) craneCamera(this, dt, settling, this.camPull);
    // Third person: over your shoulder (the helm, the guns and the crane have views of their own).
    frameShoulder(this, dt, this.thirdPerson && !this.helm && !this.gunner && !settling && !this.craneCam);
    // Driving with the view left alone: the camera swings back in behind the walking hull.
    if (this.helm && this.time - this.lookTime > 1.8 && (Math.abs(this.speed) > 0.3 || Math.abs(this.turnRate) > 0.05)) {
      let d = this.fortress.yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const k = Math.min(1, dt * 1.4);
      this.yaw += d * k;
      this.pitch += (this.helmCam.pitch - this.pitch) * k;
    }
    this.updateRegion(dt);
    // The fortress's machinery: gears and pistons while it walks, loudest on its deck.
    const c = this.fortressCentre();
    const near = this.player.standingOn === this.fortress ? 1 : clamp(1.3 - Math.hypot(this.player.x - c[0], this.player.z - c[2]) / 50, 0, 1);
    const motion = clamp(Math.abs(this.speed) / 2 + Math.abs(this.turnRate) * 3, 0, 1);
    // The machinery labours faster at speed and races at full steam.
    this.audio.loop('walk', this.phase === 'day' || this.phase === 'night' ? motion * near * 0.75 : 0, 0.85 + motion * 0.3 + (this.boosting ? 0.2 : 0));
    this.hintTimer -= dt;
    if (this.hintTimer <= 0) {
      this.hintTimer = 0.25;
      this.ui.setHint(controlHint(this));
      this.goal = this.ui.hintsOn || this.phase === 'night' ? currentGoal(this) : null;
      // A spot on (or hanging from) the fortress walks with it between refreshes.
      const t = this.goal?.target;
      const F = this.fortress;
      const l = t ? F.toLocal(t[0], t[1], t[2]) : null;
      this.goalLocal = l && l[0] > F.minX - 3 && l[0] < F.maxX + 4 && l[2] > F.minZ - 3 && l[2] < F.maxZ + 4 && l[1] > F.minY - 16 && l[1] < F.maxY + 4 ? l : null;
    }
    const tip = nextTip(this, dt, this.ui.hintsOn && !this.ui.briefOpen && !this.ui.bannerOpen);
    if (this.pings.length && this.pings[0]!.until <= this.time) this.pings = this.pings.filter((p) => p.until > this.time);
    if (tip) this.ui.tip(tip);
    // The first time a danger (or a duty) turns up, a lesson card says what beats it.
    const lesson = nextLesson(this, dt, this.ui.hintsOn && !this.ui.briefOpen && !this.ui.lessonOpen, this.ui.lessonUrgentOnly);
    if (lesson) this.ui.lesson(lesson);
    this.duskWarning(dt);
    // The valley talks: villagers you pass, the trader, your crew on the deck (the host's world).
    if (!this.coopGuest) updateChatter(this, dt);
    this.contextTimer -= dt;
    if (this.contextTimer <= 0) {
      this.contextTimer = 0.12;
      this.context = contextAction(this);
      // The crosshair reddens over a monster you could strike from here.
      this.focusFoe = !this.helm && !this.gunner && !this.player.dead && this.mode === 'mine' && meleeTarget(this, this.viewRay()) !== null;
    }
    if (this.toastFlush > 0) {
      this.toastFlush -= dt;
      if (this.toastFlush <= 0) this.flushToasts();
    }
    this.fxMute += 1;
    this.ambient(dt);
    this.fxMute -= 1;
  }

  private flushToasts(): void {
    const entries = [...this.toastBuffer.entries()];
    this.toastBuffer.clear();
    for (const [id, n] of entries.slice(0, 3)) {
      const def = itemDef(id);
      this.toast(`+${n} ${def.name}`, def.icon);
    }
  }

  private step(dt: number): void {
    this.time += dt;
    const active = this.phase === 'day' || this.phase === 'night';
    if (active) {
      if (this.phase === 'day') {
        // Walking the fortress takes time: the sun moves faster while it walks.
        this.dayTime -= dt * (1 + 1.6 * Math.min(1, Math.abs(this.speed) / Math.max(0.5, this.fortressSpeed())));
        // On the first day the sun waits for the training (dusk comes once you are ready).
        if (training(this) && this.tutorialStep < TRAINING.length - 1 && this.dayTime < 45) this.dayTime = 45;
        // In an expedition's basin the crew waits for your return (and a warden's fight holds the sun up).
        if (this.dayTime < 45 && (marchHolds(this) || this.warden !== null)) this.dayTime = 45;
        if (this.dayTime <= 0) this.startNight();
      } else if (!this.siege) {
        updateNightSpawns(this, dt);
      } else {
        this.updateSiege(dt);
      }
      updateFortress(this, dt);
      this.updateVoyage(dt);
      this.updateWeather(dt);
      this.updateCore(dt);
      updateQuests(this, dt);
      updateWilds(this, dt);
      updateEvents(this, dt);
      updateTraining(this);
      this.updateLava(dt);
      updateGiants(this, dt);
      resolveBodyPushes(this);
      this.own(() => {
        this.updatePlayer(dt);
        updateMining(this, dt);
      });
      this.coopHost?.upkeep(dt);
      updateMobs(this, dt);
      updatePet(this, dt);
      updateVillagers(this, dt);
      updateAnimals(this, dt);
      updateCrew(this, dt);
      populateVillages(this);
      if (this.phase === 'day') updateCastleGuards(this);
      this.own(() => {
        this.updateHunger(dt);
        updateEffects(this, dt, (n) => drainPlayer(this, n));
      });
      updateBosses(this, dt);
      updateSeals(this, dt);
      updateLands(this);
      updateMainQuest(this);
      updateWardens(this, dt);
      updateFinalBoss(this, dt);
      updateGolems(this, dt);
      updateOfficers(this, dt);
      updateWanderer(this);
      this.chill = Math.max(0, this.chill - dt);
      updateFangs(this, dt);
    } else {
      this.fortress.savePose();
    }
    updateProjectiles(this, dt);
    updateDrops(this, dt);
    updateFalling(this, dt);
    this.updateCorpses(dt);
    if (this.slashes.length) {
      for (const s of this.slashes) s.t += dt;
      this.slashes = this.slashes.filter((s) => s.t < 0.24);
    }
    this.streak.t = Math.max(0, this.streak.t - dt);
    this.rally = Math.max(0, this.rally - dt);
    this.crewJoy = Math.max(0, this.crewJoy - dt);
    // (A co-op mate launches its own fireworks: their sparks and bangs are not passed on.)
    this.fxMute += 1;
    this.updateFireworks(dt);
    this.fxMute -= 1;
    this.particles.update(dt);
    for (const light of this.lights) light.life -= dt;
    this.lights = this.lights.filter((light) => light.life > 0);
    for (const state of this.fortress.cannons.values()) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.recoil = Math.max(0, state.recoil - dt * 4);
    }
    this.fortress.shake = Math.max(0, this.fortress.shake - dt);
    for (let i = this.chainQueue.length - 1; i >= 0; i -= 1) {
      const chain = this.chainQueue[i]!;
      chain.t -= dt;
      if (chain.t <= 0) {
        this.chainQueue.splice(i, 1);
        explode(this, chain.x, chain.y, chain.z, { radius: 3, fortress: 10, giant: 10, mob: 14, player: 8, terrain: 2.4 });
      }
    }
    const height = this.fortressStats().height;
    if (height > this.stats.peak) this.stats.peak = height;
  }

  /**
   * Co-op guest: the parts of a step that only show things (the host runs the world itself):
   * fireworks, particles and flashes, sword sweeps, stomp rings, stuck arrows, trails behind
   * shots, the guns' recoil, where the crew stands.
   */
  mirrorStep(dt: number): void {
    this.updateFireworks(dt);
    this.particles.update(dt);
    for (const light of this.lights) light.life -= dt;
    this.lights = this.lights.filter((light) => light.life > 0);
    if (this.slashes.length) {
      for (const s of this.slashes) s.t += dt;
      this.slashes = this.slashes.filter((s) => s.t < 0.24);
    }
    if (this.shocks.length) {
      for (const s of this.shocks) s.t += dt;
      this.shocks = this.shocks.filter((s) => s.t < s.life);
    }
    if (this.stuckArrows.length) {
      for (const a of this.stuckArrows) a.t -= dt;
      this.stuckArrows = this.stuckArrows.filter((a) => a.t > 0).slice(-40);
    }
    this.streak.t = Math.max(0, this.streak.t - dt);
    for (const state of this.fortress.cannons.values()) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.recoil = Math.max(0, state.recoil - dt * 4);
    }
    for (const pr of this.projectiles) projectileTrail(this, pr);
    updateCrewPosts(this);
  }

  /** Low on hearts: a heartbeat thumps (faster when nearly out) under a pulsing red edge. */
  private heartbeat(dt: number): void {
    const p = this.player;
    if (p.dead || p.hp > 6) {
      this.beatTimer = 0;
      return;
    }
    this.beatTimer -= dt;
    if (this.beatTimer > 0) return;
    this.beatTimer = p.hp <= 3 ? 0.72 : 1.05;
    this.sfx('heartbeat', 'flesh', p.hp <= 3 ? 0.95 : 0.65);
  }

  updateHunger(dt: number): void {
    const p = this.player;
    if (p.dead) return;
    this.hungerTimer += dt * (Math.hypot(p.vx, p.vz) > 2 ? 1.4 : 1);
    if (this.hungerTimer > (setDone(this, 4) ? 42 : 28)) {
      this.hungerTimer = 0;
      this.hunger = Math.max(0, this.hunger - 1);
      if (this.hunger === 6) this.toast('You are getting hungry: eat some bread', 'bread');
    }
    this.regenTimer += dt;
    if (this.regenTimer > (hasOfficer(this, 'amina') ? 1.5 : 3)) {
      this.regenTimer = 0;
      if (this.hunger >= 14 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        if (Math.random() < 0.3) this.hunger = Math.max(0, this.hunger - 1);
      } else if (this.hunger === 0) {
        damagePlayer(this, 1, 0, 0);
      }
    }
  }

  updatePlayer(dt: number): void {
    const p = this.player;
    const guest = this.coopGuest;
    p.hurt = Math.max(0, p.hurt - dt);
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);
    this.bowCooldown = Math.max(0, this.bowCooldown - dt);
    this.mining.swing = Math.max(0, this.mining.swing - dt);
    if (p.dead) {
      this.grapple = null;
      this.overSide = null;
      packChute(this, p, false);
      // (A co-op guest waits for the host to put it back on the deck.)
      if (guest) return;
      // Knocked out: the hen flutters off in a fluster.
      if (this.carried) setDownHen(this, true);
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawnPlayer(true);
      return;
    }
    // Over the side: the hop across the rail (the parachute opens once you drop).
    if (this.overSide) {
      updateOverSide(this, p, dt);
      return;
    }
    // Leaping, at the helm or reeled in on the grapple: the canopy is packed.
    if (p.chute > 0 && (this.leap || this.helm || (this.grapple && this.grapple.stage !== 'fly'))) packChute(this, p, false);
    if (this.leap) {
      updateLeap(this, dt);
      return;
    }
    if (this.helm) {
      this.holdHelm(p);
      return;
    }
    if (this.gunner) {
      this.holdGuns(p, dt);
      return;
    }
    // On the grapple's rope: it reels you in (the stick does nothing until you let go).
    if (this.grapple && updateGrapple(this, p, dt)) {
      this.bob *= 0.8;
      if (!this.flags.descended && p.standingOn === null && p.onGround && p.y < this.fortress.y - 4) this.landed();
      this.behind = 0;
      return;
    }
    let mx = this.move.x + (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    let mz = this.move.z + (this.keys.forward ? 1 : 0) - (this.keys.back ? 1 : 0);
    // Working the crane, you stand at its controls (the view is the crane's, not yours): the stick
    // trims its jib across the swing instead.
    if (this.cx === this.me && this.craneCam) {
      steerCrane(this, mx, mz);
      mx = 0;
      mz = 0;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    const [fx, , fz] = forward(this.yaw, 0);
    const [rx, , rz] = rightOf(this.yaw);
    const swim = this.inWater(p);
    const web = this.inWeb(p);
    // Under the canopy you steer at a glide, briskly but softly.
    const chute = p.chute > 0;
    const speed = chute ? CHUTE_STEER : p.speed * (p.climbing ? 0.6 : 1) * (swim ? 0.55 : 1) * (this.hunger <= 4 ? 0.75 : 1) * (web ? 0.25 : 1) * speedFactor(this);
    if (web && p.vy < -1) p.vy = -1;
    const tvx = (fx * mz + rx * mx) * speed;
    const tvz = (fz * mz + rz * mx) * speed;
    const accel = chute ? CHUTE_ACCEL : p.onGround || p.climbing || swim ? 40 : 14;
    p.vx = approach(p.vx, tvx, accel * dt);
    p.vz = approach(p.vz, tvz, accel * dt);
    p.climbIntent = this.climbIntent(p, tvx, tvz, mz, ml);
    p.wantJump = this.jumpHeld || this.jumpBuffer > 0;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    // Holding a hen she flaps like mad and you float down (no fall can hurt you); the parachute
    // brakes you to a gentle descent as it fills.
    p.fallCap = this.carried ? HEN_GLIDE + 0.2 : chuteCap(p, dt, MAX_FALL);
    const fallBefore = p.vy;
    const grids = this.grids();
    const result = moveActor(p, dt, grids, [grids[0]!], (a) => this.ladderAt(a), (a) => this.inWater(a), (a, x, z) => this.deckSupport(a, x, z));
    // The view turns with the deck you stand on (or the ladder you hold).
    if (result.carrier) this.yaw += result.carrier.turned();
    if (p.climbing) this.mantle(p, grids);
    // Down at the foot of a walking body's ladder: step off it (it would drag you along).
    if (p.climbing && p.onGround && p.climbIntent < 0 && p.ladder?.body && p.standingOn !== p.ladder.body) this.stepOffLadder(p, grids);
    // Auto-jump onto 1-block steps while walking (touch friendly).
    if (result.hitWall && (p.onGround || swim) && ml > 0.3 && this.canStepUp(p, tvx, tvz, grids)) {
      p.vy = JUMP_V;
      p.onGround = false;
      p.standingOn = null;
    }
    // Pushing against the deck's rail (or its open edge) over a long drop: JUMP DOWN is offered.
    if ((result.edge || result.hitWall) && p.onGround && ml > 0.5 && p.standingOn === this.fortress) notePush(this, p, tvx, tvz, dt);
    updateChute(this, p, dt, swim);
    this.updateGlide(p, dt, result.landed || swim);
    // Wool and hay break a fall (you bounce a little); otherwise a fall hurts, though a slip off
    // the deck never takes more than a few hearts.
    const under = result.landed ? this.underfoot(p) : B.AIR;
    const soft = under === B.WOOL || under === B.RED_WOOL || under === B.HAY;
    if (result.landed && result.fallSpeed > 11 && !swim) this.sfx('land', soft ? 'wool' : 'dirt', 0.6);
    if (result.landed && result.fallSpeed > 15 && !swim) {
      if (soft) {
        fluff(this, p.x, p.y + 0.15, p.z, 12, under === B.HAY ? [0.95, 0.78, 0.32] : under === B.RED_WOOL ? [0.8, 0.18, 0.16] : [1, 1, 1]);
        p.vy = Math.min(6.5, result.fallSpeed * 0.28);
        p.onGround = false;
        p.standingOn = null;
        if (result.fallSpeed > 21) feat(this, 'soft');
      } else this.hurtSelf(Math.min(8, Math.floor((result.fallSpeed - 14) / 2)));
    }
    // A dive into deep water: a big splash.
    if (!swim && fallBefore < -12 && this.inWater(p)) {
      const top = Math.floor(p.y + 1.2);
      this.particles.dust(p.x, top, p.z, fallBefore < -20 ? 22 : 12, 2.6, true);
      this.sfx('land', 'wool', 0.9, 0.7);
      this.sfx('poof', 'wool', 0.7, 0.6);
      if (fallBefore < -21) feat(this, 'splash');
    }
    // Riding a giant's back.
    if (p.standingOn && p.standingOn !== this.fortress && this.giants.some((gi) => !gi.dead && gi.body === p.standingOn)) feat(this, 'hitchhiker');
    // Back aboard after a good while away: the crew says hello.
    if (p.standingOn === this.fortress) {
      if (this.ashore > 30 && !guest) this.crewSay('welcome');
      this.ashore = 0;
    } else if (p.onGround) this.ashore += dt;
    const horizontal = Math.hypot(p.vx, p.vz);
    p.walkPhase += horizontal * dt * 1.6;
    this.bob = p.onGround && horizontal > 0.5 ? Math.abs(Math.sin(p.walkPhase * Math.PI)) * 0.06 : this.bob * 0.85;
    // Footsteps: soft, by what is underfoot (planks creak, stone taps, grass hushes).
    const stride = Math.floor(p.walkPhase / 2.4);
    if (stride !== this.lastStride) {
      this.lastStride = stride;
      if (p.onGround && horizontal > 1.2 && !swim) this.sfx('step', materialOf(this.underfoot(p)), p.climbing ? 0.3 : 0.4, 0.9 + Math.random() * 0.2);
    }
    if (!this.flags.moved && horizontal > 1) this.flags.moved = true;
    if (guest) {
      // Out of the world: the host puts the guest back aboard (asked once a second).
      if ((p.y < -8 || p.y > WY + 40) && this.time > this.rescueAsked + 1) {
        this.rescueAsked = this.time;
        guest.send('rescue', []);
      }
      return;
    }
    if (!this.flags.descended && p.standingOn === null && p.onGround && p.y < this.fortress.y - 4) this.landed();
    if (p.y < -8 || p.y > WY + 40) this.respawnPlayer(false);
    this.hauledBack(dt);
  }

  /** Left behind on the night march (knocked off, or wandered off): the crew throws down a rope. */
  hauledBack(dt: number): void {
    const p = this.player;
    this.behind = this.leftBehind(p) ? this.behind + dt : 0;
    if (this.behind > 6) {
      this.behind = 0;
      this.respawnPlayer(false);
      this.toast('The crew hauls you back aboard!');
    }
  }

  /** When a co-op guest last asked to be put back aboard (from out of the world). */
  private rescueAsked = -9;

  /** Hurt by your own doing (a fall): a co-op guest's hearts are the host's to take. */
  private hurtSelf(amount: number): void {
    if (this.coopGuest) {
      this.coopGuest.send('fall', [amount]);
      return;
    }
    damagePlayer(this, amount, 0, 0);
  }

  /** Seconds spent left behind by the marching fortress tonight. */
  declare behind: number;
  /** Seconds spent down off the fortress (the crew greets you when you are back). */
  declare ashore: number;

  /** Floating down with a hen in your arms: down drifts off her, she clucks, a long glide is a feat. */
  private updateGlide(p: Actor, dt: number, down: boolean): void {
    if (p.onGround || p.climbing || down) this.flapReady = true;
    if (!this.carried || p.onGround || p.climbing || down) {
      if (this.carried && this.glideFrom !== null && this.glideFrom - p.y >= 10) feat(this, 'glide');
      this.glideFrom = null;
      return;
    }
    // (Still rising from a jump, or only just tipping over the edge.)
    if (p.vy > -HEN_GLIDE + 0.25) return;
    if (this.glideFrom === null) {
      this.glideFrom = p.y;
      this.glideCluck = 0.8;
      this.sfx('cluck', 'flesh', 0.85, 1.25);
    }
    this.glideCluck -= dt;
    if (this.glideCluck <= 0) {
      this.glideCluck = 0.9 + Math.random() * 0.9;
      this.sfx('cluck', 'flesh', 0.55, 1.08 + Math.random() * 0.25);
    }
    if (Math.random() < dt * 7) {
      const f = forward(this.yaw, 0);
      fluff(this, p.x + f[0] * 0.55, p.y + 1.15, p.z + f[2] * 0.55, 1);
    }
  }

  /** Down on the ground for the first time: the grapple is tossed down, and (in training) a crate. */
  private landed(): void {
    this.flags.descended = true;
    // (In training the crate comes first; the grapple follows with its own lesson.)
    if (training(this)) {
      tutorialCrate(this);
      return;
    }
    if (!this.relics.has('grapple')) {
      this.grantRelic('grapple');
      this.addPage('grapple', false, true);
    }
  }

  /** The block under an actor's feet (on the fortress, its deck). */
  private underfoot(a: Actor): number {
    const b = a.standingOn;
    if (b) {
      const [x, y, z] = b.cellAt(a.x, a.y - 0.2, a.z);
      return b.blockAt(x, y, z);
    }
    return this.world.get(Math.floor(a.x), Math.floor(a.y - 0.2), Math.floor(a.z));
  }

  leftBehind(p: Actor): boolean {
    if (this.phase !== 'night' || this.siege || p.standingOn === this.fortress || p.ladder) return false;
    if (this.giants.some((gi) => !gi.dead && p.standingOn === gi.body)) return false;
    const c = this.fortressCentre();
    return Math.hypot(p.x - c[0], p.z - c[2]) > this.fortressRadius() + 14;
  }

  /**
   * Up or down a ladder: moving towards its wall climbs, moving away climbs down (so you can face
   * outwards and walk down), jump always climbs. One push is enough: let the stick go and you
   * keep climbing the way you went to the end of the ladder (with no push yet you slide slowly).
   */
  private climbIntent(p: Actor, tvx: number, tvz: number, mz: number, ml: number): number {
    if (!p.climbing) p.climbAuto = 0;
    const want = this.climbPush(p, tvx, tvz, mz, ml);
    if (want === 0) return p.climbAuto;
    if (p.climbing) p.climbAuto = want;
    return want;
  }

  private climbPush(p: Actor, tvx: number, tvz: number, mz: number, ml: number): number {
    if (this.jumpHeld) return 1;
    // The ladder held, or the one about to be grabbed (stepping out onto it from the deck).
    let h = p.ladder;
    if (!h && ml > 0.3) {
      const saved = p.climbIntent;
      p.climbIntent = 0;
      h = this.ladderAt(p);
      p.climbIntent = saved;
      if (!h) {
        // Not on a ladder yet: look one step ahead, where the feet are going.
        const l = Math.hypot(tvx, tvz) || 1;
        const ox = p.x;
        const oz = p.z;
        p.x += (tvx / l) * 0.4;
        p.z += (tvz / l) * 0.4;
        p.y -= 0.3;
        p.climbIntent = 0;
        h = this.ladderAt(p);
        p.climbIntent = saved;
        p.x = ox;
        p.z = oz;
        p.y += 0.3;
      }
    }
    const d = h ? WALL_DIRS[h.dir] : undefined;
    if (h && d && ml > 0.3) {
      const [wx, wz] = h.body ? h.body.dirToWorld(d[0], d[1]) : [d[0], d[1]];
      const l = Math.hypot(tvx, tvz) || 1;
      const dot = (tvx * wx + tvz * wz) / l;
      if (dot > 0.25) return 1;
      if (dot < -0.25) return -1;
    }
    return mz > 0.3 ? 1 : mz < -0.3 ? -1 : 0;
  }

  private canStepUp(p: Actor, vx: number, vz: number, grids: Grid[]): boolean {
    const l = Math.hypot(vx, vz) || 1;
    // Never hop a railing (fences keep you on the deck, as in Minecraft where they stand taller).
    const fx = p.x + (vx / l) * 0.5;
    const fy = p.y + 0.5;
    const fz = p.z + (vz / l) * 0.5;
    if (this.world.get(Math.floor(fx), Math.floor(fy), Math.floor(fz)) === B.FENCE) return false;
    for (const b of [this.fortress, ...this.giants.map((gi) => gi.body)]) {
      const [cx, cy, cz] = b.cellAt(fx, fy, fz);
      const id = b.blockAt(cx, cy, cz);
      // Railing posts carry a lantern: no hopping onto them either.
      if (id === B.FENCE || (id !== B.AIR && b.blockAt(cx, cy + 1, cz) === B.LANTERN)) return false;
    }
    const box = { x: p.x + (vx / l) * 0.35, y: p.y + 1.05, z: p.z + (vz / l) * 0.35, hw: p.hw, h: p.h };
    for (const grid of grids) if (overlaps(box, grid, 0.02)) return false;
    return true;
  }

  /** Back on the deck: a free spot near the Engine Core. */
  respawnPlayer(fromDeath: boolean): void {
    const p = this.player;
    const F = this.fortress;
    let spot: { x: number; y: number; z: number } | null = null;
    const core = F.findBlock(B.CORE);
    const cx = core === null ? 7 : kx(core);
    const cz = core === null ? 5 : kz(core);
    for (let r = 1; r <= 10 && !spot; r += 1) {
      for (let dz = -r; dz <= r && !spot; dz += 1) {
        for (let dx = -r; dx <= r && !spot; dx += 1) {
          const lx = cx + dx;
          const lz = cz + dz;
          if (!F.solidAt(lx, 0, lz) || F.hasBlock(lx, 1, lz) || F.hasBlock(lx, 2, lz)) continue;
          const [x, y, z] = F.toWorld(lx + 0.5, 1, lz + 0.5);
          spot = { x, y, z };
        }
      }
    }
    if (!spot) {
      const c = this.fortressCentre();
      spot = { x: c[0], y: this.world.groundAt(c[0], c[2]) + 0.01, z: c[2] };
    }
    p.x = spot.x;
    p.y = spot.y + 0.002;
    p.z = spot.z;
    p.vx = p.vy = p.vz = 0;
    p.dead = false;
    p.hp = fromDeath ? p.maxHp : Math.max(1, p.hp);
    p.invulnerable = 2;
    p.standingOn = F;
    p.onGround = true;
    p.chute = 0;
    p.climbAuto = 0;
    this.chuteFrom = null;
    this.overSide = null;
    this.edgePush = 0;
    this.leap = null;
    this.helm = false;
    this.gunner = false;
    // A co-op partner's device is told where it now stands.
    this.cx.sink?.moved();
    if (fromDeath) {
      this.toast('Back on your fortress!');
      this.hunger = Math.max(this.hunger, 10);
      clearBadEffects(this);
    }
  }

  // ------------------------------------------------------------------ phases

  /** Next stop on the way to the Citadel. */
  nextDestination(): Site {
    const T = this.world.terrain;
    const c = this.fortressCentre();
    // The main quest's expedition comes first while its crest is out there.
    const quest = questStop(this);
    if (quest) return quest;
    for (const v of T.villages) if (v.x > c[0] + 40) return v;
    return T.citadel;
  }

  /** Sites the helm can march to: the next village, ruins on the way, the Citadel (once no seal bars it). */
  destinations(): Site[] {
    const T = this.world.terrain;
    const c = this.fortressCentre();
    const next = this.nextDestination();
    const list: Site[] = [next];
    // (The march can always go on to the next village instead of the quest's expedition.)
    if (next.kind === 'expedition') for (const v of T.villages) if (v.x > c[0] + 40) {
      list.push(v);
      break;
    }
    for (const s of T.castles) if (s.x > c[0] + 20 && s.x < next.x + 40 && !list.includes(s)) list.push(s);
    if (next !== T.citadel && !firstSealed(this)) list.push(T.citadel);
    return list;
  }

  /**
   * The Long March's nights: a gentle first one, the guardian's own night at each seal, a storm
   * in the desert, the illagers' raid in the canyons, the Wither where the blight begins, and
   * otherwise whatever the sky brings.
   */
  private marchTheme(target: Site, roll: number): Game['nightTheme'] {
    const T = this.world.terrain;
    const [fx] = this.fortress.centre();
    const gate = T.seals.some((s) => !this.sealsBroken.has(s.index) && s.x > fx && s.x < target.x && sealAnswers(this, s.index));
    if (gate || target.kind === 'citadel') return 'clear';
    if (target.kind === 'expedition') return roll < 0.35 ? 'storm' : roll < 0.5 ? 'blood' : 'clear';
    const i = target.kind === 'village' ? target.index : T.villages.findIndex((v) => v.x > target.x);
    if (i <= 1) return 'clear';
    if (i === 3) return 'storm';
    if (i === 7) return 'raid';
    if (i === 13) return 'wither';
    return roll < 0.32 ? 'storm' : roll < 0.58 ? 'blood' : 'clear';
  }

  /** A village the fortress stands at (its centre near the village square). */
  villageAt(x: number, z: number): Site | null {
    for (const v of this.world.terrain.villages) if (Math.hypot(v.x - x, v.z - z) < 24) return v;
    return null;
  }

  /** Sends the crew walking the fortress to a point (a site, or a spot picked on the map). */
  setCourse(x: number, z: number, site: Site | null): void {
    this.autopilot = makeAutopilot(this, x, z, site);
  }

  /** A spot tapped on the map: walk there. */
  setWaypoint(x: number, z: number): void {
    if (!this.isPlaying() && this.modal !== 'map') return;
    if (this.remote('course', Math.round(x), Math.round(z))) return;
    this.setCourse(x, z, null);
    this.sfx('click', 'wood');
    this.toast(this.phase === 'day' ? 'The crew walks the fortress to the marked spot' : 'Course changed!');
    this.report('primary_input');
  }

  stopCourse(): void {
    if (this.remote('stop')) return;
    this.autopilot = null;
    this.toast('The fortress halts');
  }

  /** Dusk: the fortress sets off (to a chosen site, or the next village). */
  startNight(dest: Site | null = null): void {
    if (this.phase !== 'day' || this.siege) return;
    if (this.remote('march', dest ? siteRef(dest) : null)) return;
    const target = dest ?? this.nextDestination();
    this.destination = target;
    this.phase = 'night';
    const [tx, tz] = parkSpot(this.world.terrain, target);
    this.setCourse(tx, tz, target);
    const c = this.fortressCentre();
    this.nightFrom = this.villageAt(c[0], c[2]) ?? this.site;
    this.nightDist = Math.max(40, routeLength(this.autopilot!.route));
    this.nightTime = 0;
    // Dawn comes on its own in time, even if the fortress never gets there.
    this.nightLength = clamp((this.nightDist / Math.max(1, this.fortressSpeed())) * 1.5 + 45, 150, 330);
    this.progress = 0;
    this.spawnTimer = 4;
    this.beatIndex = 0;
    this.giantsSpawned = target.kind === 'castle' ? 99 : 0;
    // The war horn is ready again for the night; tonight's bounty is posted.
    if (this.relics.has('horn')) this.hornCharges = 1;
    this.bounty = newBounty(this);
    this.starNight = { lulls: [], caught: false, wait: -1 };
    this.star = null;
    // Pip sits back and howls at the rising moon.
    planHowl(this, 3.2);
    this.nightLog = { slain: this.stats.slain, giants: this.stats.giants, salvage: 0, cells: this.fortress.cells.size };
    for (const v of [...this.villagers]) if (v.recruited) board(this, v, true);
    // Left behind? The crew hauls you aboard.
    if (Math.hypot(this.player.x - c[0], this.player.z - c[2]) > 50 && !this.player.dead) {
      this.respawnPlayer(false);
      this.toast('The crew hauls you aboard!');
    }
    // Some nights are worse than others: a storm on the second, the illagers' raid on the third,
    // the Wither on the fourth (where the blight begins), then any of them.
    const roll = ((this.seed * 31 + this.day * 977) % 1000) / 1000;
    if (this.world.terrain.version >= 2) this.nightTheme = this.marchTheme(target, roll);
    else this.nightTheme = this.day === 2 ? 'storm' : this.day === 3 ? 'raid' : this.day === 4 ? 'wither' : this.day >= 5 ? (roll < 0.4 ? 'storm' : roll < 0.75 ? 'blood' : 'clear') : 'clear';
    planBossNight(this);
    // (A Heart Seal on the way: its guardian is tonight's fight.)
    const ahead = sealAhead(this);
    const gate = ahead && ahead.x < target.x ? ahead : null;
    const theme = gate ? ' · HEART SEAL' : this.nightTheme === 'storm' ? ' · THUNDERSTORM' : this.nightTheme === 'blood' ? ' · BLOOD MOON' : this.nightTheme === 'raid' ? ' · ILLAGER RAID' : this.nightTheme === 'wither' ? ' · THE WITHER' : '';
    const warn = gate ? `${GUARDIANS[gate.guardian].name} guards the ${gate.name}!` : this.nightTheme === 'storm' ? 'Lightning strikes the tallest towers!' : this.nightTheme === 'blood' ? 'The horde runs faster and thicker tonight!' : this.nightTheme === 'raid' ? (this.raid?.omen ? 'Your Bad Omen calls the illagers: a bigger raid!' : 'The illagers are coming: hold every wave!') : this.nightTheme === 'wither' ? 'Something stirs in the blight ahead...' : 'Defend the Engine Core';
    const tone = gate || this.nightTheme === 'blood' || this.nightTheme === 'raid' || this.nightTheme === 'wither' ? 'danger' : 'night';
    // The first night's lesson card explains it all; later nights get the short briefing.
    if (this.ui.hintsOn && lessonSeen('night1')) this.ui.briefing(`NIGHT ${this.day}${theme}`, `The march to ${target.name} begins`, nightPlan(this), tone);
    else this.ui.banner(`NIGHT ${this.day}${theme}`, `MARCH to ${target.name}! ${warn}`, tone);
    this.sfx('horn');
    this.audio.playMusic('night');
    this.audio.ambience('night');
    this.ui.onPhaseChanged();
    this.crewSay(this.nightTheme === 'blood' ? 'blood' : this.nightTheme === 'storm' ? 'storm' : this.nightTheme === 'wither' ? 'blight' : 'march');
    // The village waves you off.
    this.villagerReact('farewell', this.player.x, this.player.z);
  }

  /** A new destination for tonight's march (progress carries on from where it is). */
  changeDestination(site: Site): void {
    if (this.phase !== 'night' || this.siege) return;
    if (this.remote('dest', siteRef(site))) return;
    this.destination = site;
    const [tx, tz] = parkSpot(this.world.terrain, site);
    this.setCourse(tx, tz, site);
    const c = this.fortressCentre();
    const d = Math.hypot(tx - c[0], tz - c[2]);
    this.nightDist = Math.max(40, d / Math.max(0.05, 1 - this.progress));
    this.ui.banner('NEW COURSE', `March to ${site.name}!`, 'night');
    this.sfx('horn', 'stone', 0.6);
  }

  /** The crew brought the fortress where it was sent. */
  reached(a: Autopilot): void {
    if (a.site && this.phase === 'night' && !this.siege && a.site === this.destination) {
      // The village is reached, but the fight is not over: the night goes on there.
      if (bossHoldsNight(this)) {
        this.toast(this.raid ? 'The raid follows you in! Beat it before dawn can come' : 'The Wither will not let the sun rise: bring it down!');
        return;
      }
      this.arriveAt(a.site);
      return;
    }
    if (!a.site && this.phase === 'day') this.toast('The fortress stands where you marked the map');
  }

  /** Back on the march to the night's destination. */
  private resumeMarch(): void {
    const d = this.destination;
    if (!d) return;
    const [tx, tz] = parkSpot(this.world.terrain, d);
    this.setCourse(tx, tz, d);
  }

  /** Dawn breaks at a village (its bells drive the monsters off) or at the chosen site. */
  arriveAt(site: Site): void {
    this.destination = null;
    if (site.kind === 'village') this.sfx('bell', 'metal', 0.9);
    // Walking into a village: the crew finishes the last steps to the square.
    if (this.autopilot?.site !== site) this.autopilot = null;
    // (An expedition is no village: the last one stays the fortress's home stop.)
    if (site.kind !== 'expedition') this.site = site;
    if (site.kind === 'village') this.siteIndex = site.index;
    this.dawn();
  }

  /** The night's progress (distance covered or time gone), arrivals and the Citadel. */
  private updateVoyage(dt: number): void {
    const T = this.world.terrain;
    const c = this.fortressCentre();
    if (!this.siege && Math.hypot(T.citadel.x - c[0], T.citadel.z - c[2]) < 72) {
      this.beginSiege();
      return;
    }
    if (this.phase === 'day') {
      const v = this.villageAt(c[0], c[2]);
      if (v && v !== this.site) {
        this.site = v;
        this.siteIndex = v.index;
        this.ui.banner(v.name.toUpperCase(), 'A new village: hoist what you need', 'day');
      }
      return;
    }
    if (this.phase !== 'night' || this.siege) return;
    this.nightTime += dt;
    let p = this.nightTime / this.nightLength;
    const dest = this.destination;
    if (dest) {
      const [tx, tz] = parkSpot(T, dest);
      p = Math.max(p, 1 - Math.hypot(tx - c[0], tz - c[2]) / this.nightDist);
    }
    this.progress = clamp(Math.max(this.progress, p), 0, 1);
    // A boss fight holds back the dawn (the night is not over until it is won).
    if (bossHoldsNight(this)) this.progress = Math.min(this.progress, 0.92);
    // Nobody steering at night: the crew marches on.
    if (!this.helm && !this.autopilot && dest) {
      this.resumeMarch();
      this.toast('The crew takes the helm');
    }
    const v = this.villageAt(c[0], c[2]);
    if (v && v !== this.nightFrom && !bossHoldsNight(this)) {
      this.arriveAt(v);
      return;
    }
    if (this.progress >= 1) {
      this.destination = null;
      this.autopilot = null;
      this.dawn();
    }
  }

  dawn(): void {
    this.stats.nights += 1;
    if (this.nightTheme === 'blood') feat(this, 'blood');
    this.star = null;
    bossDawn(this);
    this.fangs = [];
    // The sun burns them away (husks crumble to sand, wither skeletons to ash).
    for (const mob of this.mobs) if (!mob.dead) mob.burn = 1.5 + Math.random();
    // The night's giants crumble at sunrise (lair giants keep their ground).
    for (const giant of this.giants) if (!giant.dead && giant.lair === undefined && !giant.guardian) killGiant(this, giant, true);
    this.day += 1;
    this.stats.days = this.day;
    this.phase = 'day';
    this.dayStart = 0;
    this.dayLength = 300;
    this.dayTime = this.dayLength;
    this.blocked = false;
    this.progress = 0;
    this.nightTime = 0;
    const c = this.fortressCentre();
    const here = this.villageAt(c[0], c[2]);
    const sub = here ? `Night ${this.day - 1} survived! ${here.name} awaits` : `Night ${this.day - 1} survived out in the wilds`;
    this.today = { hoisted: 0, traded: false, crate: false, golden: false };
    const bounty = settleBounty(this);
    const eggs = this.layEggs();
    if (this.ui.hintsOn) {
      const plan = dayPlan(this).slice(0, (bounty ? 3 : 4) - (eggs ? 1 : 0)).map((p) => `◆ ${p.text}`);
      if (eggs) plan.unshift(`◆ ${eggs}`);
      if (bounty) plan.unshift(`★ ${bounty}`);
      this.ui.briefing(`DAWN · DAY ${this.day}${here ? ` · ${here.name.toUpperCase()}` : ''}`, nightReport(this), plan, 'gold');
    } else {
      this.ui.banner(`DAWN · DAY ${this.day}`, sub, 'gold');
      if (eggs) this.toast(eggs, 'ui_hen');
    }
    officerDawn(this);
    // Watchtower armouries restock some TNT.
    const towers = cargoPower(this, 'watchtower');
    if (towers > 0) this.addItem(I.TNT, towers * 2);
    // Pages found in the dark are read at first light; a captain without a grapple gets one.
    for (const id of this.deferredPages.splice(0)) this.ui.story('page', id);
    for (const i of this.deferredChapters.splice(0)) this.ui.story('chapter', String(i));
    for (const [kind, id] of this.deferredSagas.splice(0)) this.ui.story(kind, id);
    if (!this.relics.has('grapple')) {
      this.grantRelic('grapple');
      this.addPage('grapple', false, true);
    }
    this.sfx('dawn');
    // The crew lets off a few rockets for a night survived, and cheers.
    this.celebrate(3);
    this.cheer();
    this.audio.playMusic('day');
    this.audio.ambience('day');
    this.save();
    this.ui.onPhaseChanged();
  }

  /** At sunrise the hens riding on the deck lay: breakfast for the crew, now and then a golden egg. */
  private layEggs(): string | null {
    const hens = this.animals.filter((a) => a.boarded);
    if (hens.length === 0) return null;
    let golden = 0;
    for (let i = 0; i < hens.length; i += 1) if (Math.random() < 0.15) golden += 1;
    if (hens.length > golden) this.addItem(I.BREAD, hens.length - golden, true);
    if (golden > 0) this.addItem(I.EMERALD, golden * 3, true);
    for (const a of hens) a.flap = 1.2;
    const n = hens.length;
    if (golden > 0) return `A GOLDEN EGG on the deck! +${golden * 3} emeralds${n > golden ? `, +${n - golden} bread` : ''}`;
    return `Your ${n === 1 ? 'hen' : `${n} hens`} laid eggs: +${n} bread`;
  }

  /** At the Citadel: blow up its heart while the horde and a Creeper Titan pour out. */
  private beginSiege(): void {
    const wasDay = this.phase === 'day';
    this.siege = true;
    this.phase = 'night';
    this.nightTheme = 'blood';
    let n = 0;
    const s = this.world.structures.byId.get('citadel');
    if (s) for (let i = 0; i < s.count; i += 1) if (s.ids[i] === B.CITADEL_HEART) n += 1;
    this.heartTotal = n;
    this.heartLeft = n;
    // The glowstone crowns of the four corner towers are the pylons shielding the Heart.
    this.siegeStage = 'pylons';
    this.colossus = null;
    this.pylons = [];
    this.pylonsDown = 0;
    if (s) {
      const cx = (s.minX + s.maxX + 1) / 2;
      const cz = (s.minZ + s.maxZ + 1) / 2;
      const groups = new Map<number, Vec3[]>();
      for (let i = 0; i < s.count; i += 1) {
        if (s.ids[i] !== B.GLOWSTONE || s.ys[i]! < s.floorY + 15) continue;
        const q = (s.xs[i]! < cx ? 0 : 1) + (s.zs[i]! < cz ? 0 : 2);
        if (!groups.has(q)) groups.set(q, []);
        groups.get(q)!.push([s.xs[i]!, s.ys[i]!, s.zs[i]!]);
      }
      for (const cells of groups.values()) {
        let x = 0;
        let y = 0;
        let z = 0;
        for (const c of cells) {
          x += c[0] + 0.5;
          y += c[1] + 0.5;
          z += c[2] + 0.5;
        }
        this.pylons.push({ cells, x: x / cells.length, y: y / cells.length, z: z / cells.length, alive: true });
      }
    }
    if (this.pylons.length === 0) this.siegeStage = 'heart';
    this.giantsSpawned = 0;
    this.spawnTimer = 2;
    const T = this.world.terrain;
    const c = this.fortressCentre();
    const d = Math.hypot(T.citadel.x - c[0], T.citadel.z - c[2]) || 1;
    this.marchDir = [(T.citadel.x - c[0]) / d, (T.citadel.z - c[2]) / d];
    // The crew walks up to cannon range and holds there.
    const [tx, tz] = parkSpot(T, T.citadel);
    if (!this.helm && Math.hypot(tx - c[0], tz - c[2]) > 4) this.setCourse(tx, tz, T.citadel);
    this.destination = null;
    this.progress = 0.6;
    this.ui.banner('THE CREEPER CITADEL', this.siegeStage === 'pylons' ? 'Shatter the 4 glowing pylons that shield its Heart!' : 'Blast its glowing Heart with TNT!', 'danger');
    this.sfx('horn');
    this.sfx('bell', 'metal', 1);
    this.audio.playMusic('siege');
    if (wasDay) this.audio.ambience('night');
    this.ui.onPhaseChanged();
  }

  // ------------------------------------------------------------------ helm

  private helmCache: { version: number; spot: Vec3 | null } = { version: -1, spot: null };

  /** Where the pilot stands (fortress-local): the deck cell behind the helm wheel. */
  helmSpot(): Vec3 | null {
    const F = this.fortress;
    if (this.helmCache.version === F.version) return this.helmCache.spot;
    let spot: Vec3 | null = null;
    const key = F.findBlock(B.HELM);
    if (key !== null) {
      const x = kx(key);
      const y = ky(key);
      const z = kz(key);
      const [dx, , dz] = DIRS[F.cells.get(key)!.dir] ?? [1, 0, 0];
      for (const [ox, oz] of [[-dx, -dz], [0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const sx = x + ox;
        const sz = z + oz;
        if (F.solidAt(sx, y, sz) || F.solidAt(sx, y + 1, sz) || !F.solidAt(sx, y - 1, sz)) continue;
        spot = [sx + 0.5, y + 0.002, sz + 0.5];
        break;
      }
    }
    this.helmCache = { version: F.version, spot };
    return spot;
  }

  /** Close enough to grab the wheel. */
  nearHelm(): boolean {
    const spot = this.helmSpot();
    if (!spot || this.player.dead) return false;
    const [x, y, z] = this.fortress.toWorld(spot[0], spot[1], spot[2]);
    const p = this.player;
    return Math.hypot(p.x - x, p.z - z) < 1.9 && Math.abs(p.y - y) < 1.5;
  }

  takeHelm(): void {
    if (this.remote('helm', 1)) return;
    const spot = this.helmSpot();
    if (!spot) {
      this.deny('Clear the deck behind the helm to stand at it');
      return;
    }
    const other = this.other();
    if (other?.helm) {
      this.deny(`${other.name || 'Your mate'} is at the helm: swap places from the co-op bar`);
      return;
    }
    this.gunner = false;
    // Both hands on the wheel: the hen hops down onto the deck.
    if (this.carried) setDownHen(this);
    this.helm = true;
    this.endHold();
    const p = this.player;
    const [x, y, z] = this.fortress.toWorld(spot[0], spot[1], spot[2]);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.standingOn = this.fortress;
    p.onGround = true;
    this.yaw = this.fortress.yaw;
    this.pitch = this.helmCam.pitch;
    this.flags.steered = true;
    this.sfx('click', 'wood');
    this.report('primary_input');
  }

  leaveHelm(): void {
    if (!this.helm) return;
    if (this.remote('helm', 0)) return;
    this.helm = false;
    this.boostHeld = false;
    this.sfx('click', 'wood');
    if (this.phase === 'night' && !this.siege && this.destination) this.toast('The crew takes the helm');
  }

  // ------------------------------------------------------------------ the guns (co-op)

  private gunCache: { version: number; spot: Vec3 | null } = { version: -1, spot: null };

  /** Where the gunner stands (fortress-local): beside the turret nearest the middle of the deck. */
  gunnerSpot(): Vec3 | null {
    const F = this.fortress;
    if (this.gunCache.version === F.version) return this.gunCache.spot;
    const mx = (F.minX + F.maxX + 1) / 2;
    const mz = (F.minZ + F.maxZ + 1) / 2;
    const turrets = [...F.cannons.keys()].sort((a, b) => Math.hypot(kx(a) + 0.5 - mx, kz(a) + 0.5 - mz) - Math.hypot(kx(b) + 0.5 - mx, kz(b) + 0.5 - mz));
    const helm = this.helmSpot();
    let spot: Vec3 | null = null;
    search: for (const key of turrets) {
      const x = kx(key);
      const y = ky(key);
      const z = kz(key);
      for (const [ox, oz] of [[-1, 0], [0, -1], [0, 1], [1, 0], [-1, -1], [-1, 1]] as const) {
        const sx = x + ox;
        const sz = z + oz;
        if (F.solidAt(sx, y, sz) || F.solidAt(sx, y + 1, sz) || !F.solidAt(sx, y - 1, sz)) continue;
        if (helm && Math.floor(helm[0]) === sx && Math.floor(helm[2]) === sz) continue;
        spot = [sx + 0.5, y + 0.002, sz + 0.5];
        break search;
      }
    }
    this.gunCache = { version: F.version, spot };
    return spot;
  }

  /** Takes the guns: a commander's view, and every turret fires where you tap (co-op). */
  takeGuns(): void {
    if (this.remote('guns', 1)) return;
    const p = this.player;
    if (p.dead || this.leap) return;
    const other = this.other();
    if (other?.gunner) {
      this.deny(`${other.name || 'Your mate'} is on the guns: swap places from the co-op bar`);
      return;
    }
    if (this.fortress.cannons.size === 0) {
      this.deny('No turret on the fortress: craft a cannon or a ballista');
      return;
    }
    const spot = this.gunnerSpot();
    if (!spot) {
      this.deny('No room to stand by a turret: clear a spot beside one');
      return;
    }
    if (this.carried) setDownHen(this);
    this.helm = false;
    this.gunner = true;
    this.endHold();
    const [x, y, z] = this.fortress.toWorld(spot[0], spot[1], spot[2]);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.standingOn = this.fortress;
    p.onGround = true;
    this.pitch = this.helmCam.pitch;
    this.sfx('click', 'metal');
    this.sfx('cannon', 'metal', 0.25, 1.6);
    this.toast('ON THE GUNS: tap to fire every turret, hold to keep firing', 'ui_gunner');
    this.cx.sink?.moved();
    this.report('primary_input');
  }

  leaveGuns(): void {
    if (!this.gunner) return;
    if (this.remote('guns', 0)) return;
    this.gunner = false;
    this.endHold();
    this.sfx('click', 'wood');
  }

  /** At the guns you stay by the turret as the deck walks and turns; the stick turns your view. */
  private holdGuns(p: Actor, dt: number): void {
    const spot = this.gunnerSpot();
    if (!spot) {
      this.gunner = false;
      return;
    }
    const [x, y, z] = this.fortress.toWorld(spot[0], spot[1], spot[2]);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.standingOn = this.fortress;
    p.onGround = true;
    p.climbing = false;
    this.yaw += this.fortress.turned();
    const mx = this.move.x + (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const mz = this.move.z + (this.keys.forward ? 1 : 0) - (this.keys.back ? 1 : 0);
    if (Math.abs(mx) + Math.abs(mz) > 0.05) this.look(mx * 1.7 * dt, mz * 0.9 * dt);
    this.bob *= 0.85;
    this.jumpBuffer = 0;
  }

  /** At the helm you stay at the wheel as the deck walks and turns. */
  private holdHelm(p: Actor): void {
    const spot = this.helmSpot();
    if (!spot) {
      this.helm = false;
      return;
    }
    const [x, y, z] = this.fortress.toWorld(spot[0], spot[1], spot[2]);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.standingOn = this.fortress;
    p.onGround = true;
    p.climbing = false;
    this.yaw += this.fortress.turned();
    this.bob *= 0.85;
    this.jumpBuffer = 0;
  }

  private updateSiege(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.4;
      if (this.mobs.length < 26) updateNightSpawns(this, 10);
    }
    if (this.giantsSpawned === 0 && this.time > 0) {
      this.giantsSpawned = 1;
      this.progress = 0.6;
      updateNightSpawns(this, 0);
    }
    if (this.siegeStage === 'pylons') {
      let left = 0;
      for (const py of this.pylons) {
        if (!py.alive) continue;
        if (py.cells.some(([x, y, z]) => this.world.get(x, y, z) === B.GLOWSTONE)) {
          left += 1;
          continue;
        }
        py.alive = false;
        this.particles.sparks(py.x, py.y, py.z, ['#40ff60', '#ffffff', '#ffe070'], 30, 9, 0.15, 0.9);
        this.renderer.shake(0.5);
        this.sfx('explode', 'glass', 1);
      }
      const down = this.pylons.length - left;
      if (left > 0 && down !== this.pylonsDown) {
        this.pylonsDown = down;
        this.ui.banner('PYLON SHATTERED!', `${left} left shielding the Heart`, 'gold');
        this.xp(20);
      }
      if (left === 0) {
        this.siegeStage = 'colossus';
        this.colossus = spawnColossus(this);
        this.ui.banner('THE COLOSSUS AWAKENS!', 'Fell the Creeper Colossus to bare the Heart', 'danger');
        this.sfx('giant', 'stone', 1.3);
        this.sfx('bell', 'metal', 1);
        this.addPage('colossus', true);
      }
    } else if (this.siegeStage === 'colossus') {
      if (!this.colossus || this.colossus.dead) {
        this.siegeStage = 'heart';
        this.ui.banner('THE HEART IS BARE!', 'Blast the Citadel Heart with TNT!', 'gold');
        this.sfx('horn');
        this.xp(40);
      }
    }
  }

  private pylonsDown = 0;
  private shieldNote = -10;

  /** Rain, the red moon and lightning; strikes favour tall things (your towers included). */
  private updateWeather(dt: number): void {
    const w = this.weather;
    const night = this.phase === 'night';
    w.storm = approach(w.storm, night && this.nightTheme === 'storm' ? 1 : 0, dt * 0.12);
    w.blood = approach(w.blood, night && this.nightTheme === 'blood' ? 1 : 0, dt * 0.15);
    w.dark = approach(w.dark, night ? bossDarkness(this) : 0, dt * 0.35);
    w.flash = Math.max(0, w.flash - dt * 5);
    if (this.bolt) {
      this.bolt.t -= dt;
      if (this.bolt.t <= 0) this.bolt = null;
    }
    this.audio.loop('rain', w.storm * 0.7);
    if (w.storm < 0.6) return;
    this.lightningTimer -= dt;
    if (this.lightningTimer > 0) return;
    // With Ashvale's rod on the mast the storm strikes more often, and at your enemies.
    this.lightningTimer = this.relics.has('rod') ? 3 + Math.random() * 5 : 6 + Math.random() * 9;
    this.strikeLightning();
  }

  private strikeLightning(): void {
    const F = this.fortress;
    const p = this.player;
    let x: number;
    let y: number;
    let z: number;
    let cell: number | null = null;
    let struck: Actor | null = null;
    let rod = false;
    if (this.relics.has('rod')) {
      const t = rodTarget(this);
      x = t.x;
      y = t.y;
      z = t.z;
      struck = t.mob;
      rod = !t.mob;
    } else if (Math.random() < 0.3 && F.cells.size > 0) {
      // The tallest block of the fortress takes it.
      let best = -Infinity;
      for (const k of F.cells.keys()) {
        if (ky(k) > best) {
          best = ky(k);
          cell = k;
        }
      }
      const q = F.cellCenter(kx(cell!), ky(cell!), kz(cell!));
      x = q.x;
      y = q.y + 0.5;
      z = q.z;
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 45;
      x = p.x + Math.cos(a) * r;
      z = p.z + Math.sin(a) * r;
      y = this.world.groundAt(x, z);
    }
    this.bolt = { x, y, z, t: 0.32, seed: Math.random() * 1000 };
    this.weather.flash = 1;
    startle(this, x, y, z, 10, 4);
    this.light({ x, y: y + 4, z, r: 34, color: [0.75, 0.85, 1.25], life: 0.35, max: 0.35 });
    this.particles.sparks(x, y, z, ['#ffffff', '#c8d8ff'], 18, 8, 0.12, 0.5);
    this.particles.smoke(x, y, z, 8, 1.2);
    if (cell !== null) {
      damageFortressCell(this, cell, 8);
      this.toast('Lightning struck the fortress!');
    }
    if (struck) {
      // The rod calls it down on a monster, and it jumps to the ones around it.
      damageMob(this, struck, 60, 0, 0, 'player');
      for (const mob of this.mobs) if (!mob.dead && mob !== struck && Math.hypot(mob.x - x, mob.z - z) < 4.5 && Math.abs(mob.y - y) < 5) damageMob(this, mob, 24, (mob.x - x) * 2, (mob.z - z) * 2, 'player');
      this.particles.ring(x, y + 0.5, z, 3, 0.7, 0.85, 1);
    } else if (rod) {
      this.particles.sparks(x, y, z, ['#9ad8ff', '#ffffff'], 24, 6, 0.1, 0.6);
    } else {
      for (const mob of this.mobs) if (!mob.dead && Math.hypot(mob.x - x, mob.z - z) < 3.5 && Math.abs(mob.y - y) < 4) damageMob(this, mob, 30, 0, 0);
    }
    const d = Math.hypot(x - p.x, z - p.z);
    window.setTimeout(() => this.sfx('thunder', 'stone', clamp(1.3 - d / 90, 0.35, 1)), Math.min(1600, (d / 340) * 1000));
    this.renderer.shake(clamp(0.5 - d / 120, 0.05, 0.4));
  }

  /** The Engine Core in trouble: sparks when damaged, smoke, a red glow and the alarm when failing. */
  private updateCore(dt: number): void {
    // Worn legs spit sparks and smoke from their knees.
    const W = this.walker;
    for (const l of W.legs) {
      if (l.damage < 0.4 || Math.random() > dt * l.damage * 6) continue;
      const knee = W.knee(this.fortress, l, W.hipWorld(this.fortress, l));
      if (Math.random() < 0.6) this.particles.sparks(knee[0], knee[1], knee[2], ['#ffd040', '#ff8020'], 2, 3, 0.07, 0.35);
      else this.particles.smoke(knee[0], knee[1], knee[2], 1, 0.4);
    }
    const F = this.fortress;
    const key = this.coreKey();
    if (key === null) return;
    const c = F.cells.get(key)!;
    const r = c.hp / c.maxHp;
    if (r > 0.7) return;
    const q = F.cellCenter(kx(key), ky(key), kz(key));
    if (Math.random() < dt * (r < 0.35 ? 8 : 3)) this.particles.sparks(q.x, q.y + 0.4, q.z, ['#ffd040', '#ff6a20'], 2, 3, 0.08, 0.35);
    if (r >= 0.35) return;
    if (Math.random() < dt * 4) this.particles.smoke(q.x, q.y + 0.6, q.z, 1, 0.4);
    this.alarmTimer -= dt;
    if (this.alarmTimer <= 0 && this.phase === 'night') {
      this.alarmTimer = 7;
      this.sfx('bell', 'metal', 0.8);
      this.light({ x: q.x, y: q.y + 1, z: q.z, r: 9, color: [1.2, 0.15, 0.1], life: 1.2, max: 1.2 });
      this.toast('The Engine Core is failing! REPAIR it with iron');
    }
  }

  private coreCache: { version: number; key: number | null } = { version: -1, key: null };

  /** The Engine Core's cell key (cached per fortress version). */
  coreKey(): number | null {
    const F = this.fortress;
    if (this.coreCache.version !== F.version) this.coreCache = { version: F.version, key: F.findBlock(B.CORE) };
    return this.coreCache.key;
  }

  /** A block of the Citadel's heart is destroyed (by a blast or a pickaxe). */
  heartHit(x: number, y: number, z: number): void {
    if (this.world.get(x, y, z) !== B.CITADEL_HEART) return;
    // The Heart's last shell opens to the Builders' Key alone.
    if (mainQuestOn(this) && !this.mq.key) {
      this.particles.sparks(x + 0.5, y + 0.5, z + 0.5, ['#40ff60', '#d0ffd0'], 10, 5, 0.1, 0.5);
      if (this.time - this.shieldNote > 2.5) {
        this.shieldNote = this.time;
        this.toast('The Heart\'s last shell holds: it opens to the Builders\' Key alone', 'builders_key');
      }
      return;
    }
    // Shielded until the pylons and the Colossus are gone.
    if (this.siege && this.siegeStage !== 'heart') {
      this.particles.sparks(x + 0.5, y + 0.5, z + 0.5, ['#40ff60', '#d0ffd0'], 10, 5, 0.1, 0.5);
      if (this.time - this.shieldNote > 2.5) {
        this.shieldNote = this.time;
        this.toast(this.siegeStage === 'pylons' ? 'The pylons shield the Heart! Shatter them first' : 'The Colossus guards the Heart! Fell it first');
      }
      return;
    }
    this.world.set(x, y, z, B.AIR);
    this.heartLeft = Math.max(0, this.heartLeft - 1);
    this.particles.sparks(x + 0.5, y + 0.5, z + 0.5, ['#40ff60', '#d0ffd0', '#ffffff'], 24, 7, 0.14, 0.8);
    this.renderer.shake(0.4);
    this.sfx('explode', 'flesh', 0.8);
    if (this.heartTotal === 0) this.heartTotal = 1;
    if (this.heartLeft > 0 || !this.siege) this.toast(`Citadel Heart cracked! ${this.heartLeft} left`);
    if (this.siege && this.heartLeft <= 0) {
      this.stats.nights += 1;
      feat(this, 'victory');
      // The Citadel's blood moon counts as one survived.
      if (this.nightTheme === 'blood') feat(this, 'blood');
      // The last of the Heart: the Citadel goes up before the tally (or what the Heart kept rises).
      if (mainQuestOn(this)) beginFinalBoss(this, x + 0.5, y + 0.5, z + 0.5);
      else this.startFinale('victory', x + 0.5, y + 0.5, z + 0.5);
    }
  }

  finish(outcome: Outcome): void {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.outcome = outcome;
    this.phase = outcome === 'victory' ? 'won' : 'lost';
    this.autopilot = null;
    this.helm = false;
    this.speed = 0;
    this.turnRate = 0;
    this.releaseInputs();
    const score = this.score();
    if (score > this.best) {
      this.best = score;
      try {
        window.localStorage.setItem(BEST_KEY, String(score));
      } catch {
        // ignore
      }
    }
    if (outcome === 'victory') {
      this.journal.add('last');
      this.clearSave();
    }
    this.sfx(outcome === 'victory' ? 'victory' : 'defeat');
    this.audio.playMusic(outcome === 'victory' && this.mq.won ? 'epilogue' : 'none');
    this.ui.onPhaseChanged();
    this.ui.showResult(outcome);
    this.report(outcome);
  }

  score(): number {
    const { blocks } = this.fortressStats();
    return this.stats.nights * 1000 + this.stats.giants * 400 + this.stats.slain * 25 + this.stats.hoisted * 300 + blocks * 2 + this.level() * 50 + (this.outcome === 'victory' ? 5000 : 0);
  }

  // ------------------------------------------------------------------ ambience

  /** Waterfall spray, fireflies, chimney smoke and the odd falling leaf around you. */
  private ambient(dt: number): void {
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 0.08;
    const p = this.player;
    for (const f of this.world.terrain.falls) {
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d > 70) continue;
      const px = f.x + 0.5 + f.fx * 1.5;
      const pz = f.z + 0.5 + f.fz * 1.5;
      this.particles.mist(px, f.bottom + 0.2, pz, f.width + 1);
      if (d < 30 && Math.random() < 0.5) this.particles.mist(f.x + 0.5, f.bottom + 1 + Math.random() * 3, f.z + 0.5, f.width);
    }
    this.landmarkAir();
    const env = this.renderer.env;
    if (env.night > 0.5 && Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 14;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      const g = this.world.groundAt(x, z);
      if (this.world.get(Math.floor(x), g - 1, Math.floor(z)) === B.GRASS) this.particles.firefly(x, g + 0.5 + Math.random() * 2, z);
    }
  }

  /** Mount Cinder's plume over its crater, cinders in the air; spindrift blowing off Frostpeak. */
  private landmarkAir(): void {
    const p = this.player;
    for (const e of this.world.terrain.expeditions) {
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > 240) continue;
      if (e.id === 'cinder') {
        const top = e.y + CINDER.rim;
        for (let k = 0; k < 2; k += 1) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 16;
          this.particles.add({ x: e.x + Math.cos(a) * r, y: top - 8, z: e.z + Math.sin(a) * r, vx: 0.8 + Math.random(), vy: 6 + Math.random() * 3, vz: Math.random() - 0.5, life: 8, size: 5, grow: 3, r: 0.17, g: 0.14, b: 0.14, a: 0.6, gravity: 0, drag: 0.1, tile: 'smoke', soft: true });
        }
        if (Math.random() < 0.5) this.particles.add({ x: e.x + (Math.random() - 0.5) * 30, y: top - 2, z: e.z + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 3, vy: 7 + Math.random() * 6, vz: (Math.random() - 0.5) * 3, life: 2.4, size: 0.35, r: 1, g: 0.5, b: 0.12, a: 1, emit: 1, gravity: 5, drag: 0.1, tile: 'spark', soft: true });
      } else if (e.id === 'frostpeak' && e.summit && Math.random() < 0.6) {
        this.particles.add({ x: e.summit[0] + (Math.random() - 0.5) * 24, y: e.y + 46 + Math.random() * 14, z: e.summit[2] + 27 * e.side + (Math.random() - 0.5) * 24, vx: 6 + Math.random() * 4, vy: 0.6, vz: Math.random() - 0.5, life: 3.4, size: 1.6, grow: 1.6, r: 1, g: 1, b: 1, a: 0.32, gravity: 0, drag: 0.1, tile: 'smoke', soft: true });
      }
    }
  }

  // ------------------------------------------------------------------ test seams

  forceOutcome(outcome: Outcome): void {
    if (this.phase === 'title' || this.phase === 'loading') this.start(null);
    if (outcome === 'defeat') {
      coreDestroyed(this);
      // The test seam shows the result at once (no closing sequence).
      if (this.finale) {
        this.finale = null;
        this.finish('defeat');
      }
    } else {
      this.stats.nights = Math.max(this.stats.nights, this.day);
      this.finish('victory');
    }
  }

  // ------------------------------------------------------------------ misc

  blockName(id: number): string {
    return blockDef(id).name;
  }

  cellKey(x: number, y: number, z: number): number {
    return key3(x, y, z);
  }

  crewCapacity(): number {
    return crewCapacity(this);
  }
}

// The acting player's fields, as if they were the game's own (g.player, g.yaw, g.mining...).
for (const key of CTX_FIELDS) {
  Object.defineProperty(Game.prototype, key, {
    get(this: Game) {
      return this.cx[key];
    },
    set(this: Game, value: unknown) {
      (this.cx as unknown as Record<string, unknown>)[key] = value;
    },
    configurable: true,
  });
}
