// Guidance for new captains. Day one is a coached training run: one big mission card at a time
// (a picture, what to do, and the very control to press, pointed at by a hand), a gold marker on
// the spot, and a cheer when it is done. After that: the next thing worth doing on one line
// (tap it for today's plan), a lesson card the first time each danger turns up, a briefing at
// dawn and dusk, one-time tips, and the full handbook on demand.
import { B, I } from './blocks';
import { kx, ky, kz } from './body';
import { markPoint, usesTnt, turretKind } from './combat';
import { BLOCK_TEXT, canStomp } from './fortress';
import { atCraneControls, craneBase, craneGauge, hoistCheck } from './crane';
import type { Game } from './game';
import type { Vec3 } from './math3d';
import { nightBeat } from './mobs';
import { questInfo, treasureTarget, trusts, type QuestInfo } from './quests';
import { questRelic, RELICS } from './story';
import { bountyProgress, bountyText, crateFalling, crateTarget } from './events';
import { featCount, featDone, featProgress } from './feats';
import { isHoistable, type Structure } from './structures';
import type { Site } from './terrain';
import { GUARDIANS, sealAhead } from './seals';
import { mainObjective } from './mainquest';
import { errands, nearErrand, officerCall } from './company';

export type GoalTone = 'train' | 'quest' | 'day' | 'night' | 'danger';

/** The single next step shown under the day pill, with where it is (for the beacon and arrow). */
export interface Goal {
  tag: string;
  text: string;
  target: Vec3 | null;
  tone: GoalTone;
  /** What the marker over the spot calls it ("CANNON", "TRADER"). */
  label?: string;
  icon?: string;
  /** A second line under it (a reminder of what comes after). */
  note?: string;
}

export interface PlanItem {
  text: string;
  done: boolean;
}

/**
 * The control a coaching hand points at: the move pad, a swipe of the view, the gold action
 * button, a hotbar slot, the MARCH button, the jump/steam button, the spot (or monster) itself,
 * the crane's gauge (tap it on the gold), or the stick held against the load's swing.
 */
export type PointKind = 'stick' | 'look' | 'action' | 'slot' | 'march' | 'jump' | 'stomp' | 'world' | 'mob' | 'crane' | 'steady';

export interface PointAt {
  kind: PointKind;
  item?: number;
}

/** What to do right now, in one line, and the control that does it. */
export interface Coaching {
  text: string;
  point: PointAt | null;
}

/** Pictures for the mission cards (public/tut/*.webp). */
export type ArtKey =
  | 'welcome' | 'cannon' | 'ladder' | 'chest' | 'grapple' | 'hoist' | 'recruit' | 'trade' | 'helm' | 'night' | 'giant' | 'core'
  | 'enderman' | 'witch' | 'ghast' | 'raid' | 'wither'
  // The Long March: the seal guardians, the new lands' monsters, the new folk.
  | 'boss_queen' | 'boss_dune' | 'boss_slime' | 'boss_ravager' | 'boss_frost' | 'boss_magma'
  | 'swampmobs' | 'breeze' | 'bear' | 'blaze' | 'trader' | 'golem'
  // The main quest's last foe.
  | 'boss_veyra';

export const ART_KEYS: ArtKey[] = [
  'welcome', 'cannon', 'ladder', 'chest', 'grapple', 'hoist', 'recruit', 'trade', 'helm', 'night', 'giant', 'core', 'enderman', 'witch', 'ghast', 'raid', 'wither',
  'boss_queen', 'boss_dune', 'boss_slime', 'boss_ravager', 'boss_frost', 'boss_magma', 'swampmobs', 'breeze', 'bear', 'blaze', 'trader', 'golem', 'boss_veyra',
];

export function artURL(key: ArtKey): string {
  return new URL(`tut/${key}.webp`, document.baseURI).href;
}

// ------------------------------------------------------------------ training (day one)

export interface Step {
  /** What it teaches. */
  id: 'walk' | 'load' | 'ladder' | 'loot' | 'recruit' | 'trade' | 'grapple' | 'hoist' | 'helm' | 'march';
  title: string;
  /** Why it matters, in one short line (shown while the card is open). */
  why: string;
  art: ArtKey;
  icon: string;
  /** The marker's name for the spot. */
  label: string;
  /** What to do now (it changes as you get there: walk over, then press the button). */
  how: (g: Game, pc: boolean) => Coaching;
  target: (g: Game) => Vec3 | null;
  done: (g: Game) => boolean;
}

const ctx = (g: Game): string => g.context?.label ?? '';

/** Down off the fortress (not at the helm, not on a ladder). */
function ashore(g: Game): boolean {
  const p = g.player;
  return p.standingOn !== g.fortress && !g.helm && !p.climbing && p.y < g.fortress.y - 3;
}

const near = (g: Game, t: Vec3 | null, r: number): boolean => t !== null && Math.hypot(t[0] - g.player.x, t[2] - g.player.z) < r;

/**
 * The first lift, beat by beat: what the crane is doing and, when it is the captain's turn, the
 * very thing to press (the gauge on the gold; the stick against the swing until the load is over
 * its mark).
 */
function craneCoaching(g: Game, pc: boolean): Coaching {
  const h = g.hoist!;
  if (h.by !== g.me) return { text: 'Your mate is working the crane...', point: null };
  switch (h.stage) {
    case 'reach':
      return { text: 'The chains are going on: get ready to HEAVE!', point: null };
    case 'heave':
      return { text: pc ? 'Click as the needle hits the GOLD: a perfect heave pays emeralds' : 'Tap as the needle hits the GOLD: a perfect heave pays emeralds', point: { kind: 'crane' } };
    case 'lift':
    case 'swing':
      return { text: 'Up it comes! The crane swings it over your hold...', point: null };
    case 'drop':
      if (craneGauge(g)?.hot) return { text: pc ? 'Over the mark: click now to set it down!' : 'Over the mark: tap now to set it down!', point: { kind: 'crane' } };
      return { text: pc ? 'Push A / D against the swing to steady it over the mark' : 'Push the stick against the swing to steady it over the mark', point: { kind: 'steady' } };
    default:
      return { text: 'Block by block, it builds itself into your hold!', point: null };
  }
}

export const TRAINING: Step[] = [
  {
    id: 'walk', title: 'WALK YOUR DECK', why: 'This walking fortress is yours, Captain!', art: 'welcome', icon: 'ui_eye', label: '',
    how: (_g, pc) => ({ text: pc ? 'Walk with W A S D · move the mouse to look around' : 'Drag the left pad to walk · swipe the screen to look around', point: { kind: 'stick' } }),
    target: () => null,
    done: (g) => g.flags.moved,
  },
  {
    id: 'load', title: 'LOAD THE CANNON', why: 'Cannons blast the monsters with TNT at night.', art: 'cannon', icon: 'tnt_side', label: 'CANNON',
    how: (g, pc) => ctx(g).startsWith('LOAD')
      ? { text: pc ? 'Press E to load the TNT' : 'Tap the gold LOAD TNT button', point: { kind: 'action' } }
      : { text: 'Walk to the cannon at the front of the deck: follow the gold arrow', point: null },
    target: (g) => cannonSpot(g),
    done: (g) => g.flags.loaded,
  },
  {
    id: 'ladder', title: 'JUMP DOWN', why: 'The village below hides loot and new crew.', art: 'ladder', icon: 'ui_chute', label: 'JUMP DOWN',
    how: (g, pc) => {
      if (g.player.chute > 0) return { text: pc ? 'Your parachute opened! Steer with W A S D: land anywhere' : 'Your parachute opened! Steer with the pad: land anywhere', point: { kind: 'stick' } };
      if (g.player.climbing) return { text: 'The ladder takes you all the way down by itself', point: null };
      if (ctx(g) === 'JUMP DOWN') return { text: pc ? 'Press E (or Space): over the side, your parachute opens by itself' : 'Tap the gold JUMP DOWN button: your parachute opens by itself', point: { kind: 'action' } };
      if (near(g, ladderTop(g), 3.2)) return { text: pc ? 'Walk out against the edge (W) until JUMP DOWN appears' : 'Push the pad out against the edge until JUMP DOWN appears', point: { kind: 'stick' } };
      return { text: 'Go to the back of the deck: follow the gold arrow', point: null };
    },
    target: (g) => ladderTop(g),
    done: (g) => g.flags.descended,
  },
  {
    id: 'loot', title: 'OPEN THE SUPPLY CRATE', why: 'Crates and chests hold TNT, iron, bread and emeralds.', art: 'chest', icon: 'chest_front', label: 'CRATE',
    how: (g, pc) => {
      if (ctx(g) === 'LOOT') return { text: pc ? 'Press E (or right click) to open it' : 'Tap the gold LOOT button', point: { kind: 'action' } };
      if (crateFalling(g)) return { text: 'A crate is parachuting down beside you: look up and watch it land!', point: null };
      if (crateTarget(g)) return { text: 'Walk up to the crate and look at it', point: null };
      return { text: 'Village houses keep chests inside: go in through a door', point: null };
    },
    target: (g) => crateTarget(g) ?? nearestChest(g),
    done: (g) => g.flags.looted > 0,
  },
  {
    id: 'recruit', title: 'RECRUIT CREW', why: 'Your crew fire the cannons and patch up the hull.', art: 'recruit', icon: 'ui_villager', label: 'VILLAGER',
    how: (g, pc) => ctx(g) === 'RECRUIT'
      ? { text: pc ? 'Press E to recruit them' : 'Tap the gold RECRUIT button', point: { kind: 'action' } }
      : { text: 'Walk up to a villager with a green ! and look at them', point: null },
    target: (g) => nearestRecruit(g),
    done: (g) => g.flags.recruited > 0,
  },
  {
    id: 'trade', title: 'MEET THE TRADER', why: 'Emeralds buy TNT, turrets and crew bunks.', art: 'trade', icon: 'emerald', label: 'TRADER',
    how: (g, pc) => ctx(g) === 'TRADE'
      ? { text: pc ? 'Press E to trade' : 'Tap the gold TRADE button', point: { kind: 'action' } }
      : { text: 'The trader keeps a stall by the village well: follow the gold arrow', point: null },
    target: (g) => traderSpot(g, g.siteIndex),
    done: (g) => g.flags.traded,
  },
  {
    id: 'grapple', title: 'GRAPPLE BACK UP', why: 'The builders\' grapple zips you to any block.', art: 'grapple', icon: 'grapple_item', label: 'YOUR DECK',
    how: (g, pc) => {
      if (g.count(I.GRAPPLE) <= 0) return { text: 'Climb back up the ladder to your deck', point: null };
      if (g.selected !== I.GRAPPLE) return { text: 'Pick the GRAPPLE in your hotbar', point: { kind: 'slot', item: I.GRAPPLE } };
      return { text: pc ? 'Aim at your deck high above and right click: you zip up!' : 'Tap your deck high above: you zip up to it!', point: { kind: 'world' } };
    },
    target: (g) => grappleSpot(g),
    done: (g) => g.flags.grappled > 0,
  },
  {
    id: 'hoist', title: 'HOIST A BUILDING', why: 'Your crane lifts whole houses aboard: each one powers you up.', art: 'hoist', icon: 'ui_hoist', label: 'HOIST ME',
    how: (g, pc) => {
      if (g.hoist) return craneCoaching(g, pc);
      const label = ctx(g);
      if (label.startsWith('HOIST')) return { text: pc ? 'Press E: the crane lifts the whole building!' : 'Tap HOIST: the crane lifts the whole building!', point: { kind: 'action' } };
      if (label.endsWith('TOO FAR')) return { text: 'Too far from the fortress: pick a house right beside it', point: null };
      // (Pushing on at the rail offers the way down instead: the crane reaches from the deck.)
      if (label === 'JUMP DOWN') return { text: 'No need to jump: stay at the rail and look at the house until HOIST appears', point: null };
      return { text: 'Look at the house with the gold arrow until HOIST appears', point: null };
    },
    target: (g) => (g.hoist ? null : nearestHoistable(g)?.spot ?? null),
    done: (g) => g.stats.hoisted > 0,
  },
  {
    id: 'helm', title: 'TAKE THE HELM', why: 'Steer the fortress yourself, or let the crew walk it.', art: 'helm', icon: 'ui_map', label: 'HELM',
    how: (g, pc) => {
      if (g.helm) return { text: pc ? 'Hold W to walk the fortress · A / D to turn' : 'Push the pad up to walk the fortress · left / right turns', point: { kind: 'stick' } };
      if (ctx(g) === 'TAKE HELM') return { text: pc ? 'Press E to take the helm' : 'Tap the gold TAKE HELM button', point: { kind: 'action' } };
      if (ashore(g)) return { text: 'Get back aboard first: grapple up, or climb the ladder', point: g.count(I.GRAPPLE) > 0 && g.selected !== I.GRAPPLE ? { kind: 'slot', item: I.GRAPPLE } : null };
      return { text: 'Go to the ship\'s wheel at the back of the deck: follow the gold arrow', point: null };
    },
    target: (g) => helmTarget(g),
    done: (g) => g.flags.drove > 8,
  },
  {
    id: 'march', title: 'MARCH AT NIGHTFALL', why: 'Reach the next village by dawn. Guard the Engine Core!', art: 'night', icon: 'ui_moon', label: '',
    how: (_g, pc) => ({ text: pc ? 'Press N (or the MARCH button) and pick the next village' : 'Tap MARCH, then MARCH again by the next village', point: { kind: 'march' } }),
    target: () => null,
    done: (g) => g.stats.nights > 0 || g.phase === 'night',
  },
];

/** The training step being taught right now (null once training is over). */
export function trainingStep(g: Game): Step | null {
  return training(g) ? TRAINING[g.tutorialStep] ?? null : null;
}

/** Ticks training steps off (in any order) and returns the next one to do, or -1 when done. */
export function updateTraining(g: Game): number {
  if (g.tutorialStep >= TRAINING.length) return -1;
  const before = g.tutorialStep;
  while (g.tutorialStep < TRAINING.length && TRAINING[g.tutorialStep]!.done(g)) {
    g.tutorialStep += 1;
    g.xp(5);
  }
  // In training the old smith tosses the grapple down when its lesson comes up (its card then has
  // the moment to itself, not the supply crate's), once nothing else is open.
  if (TRAINING[g.tutorialStep]?.id === 'grapple' && !g.relics.has('grapple') && g.modal === 'none') {
    g.grantRelic('grapple');
    g.addPage('grapple', false, true);
  }
  if (g.tutorialStep === before) return g.tutorialStep;
  // A cheer for the step (or steps) just done; the last one ends the training.
  const finished = g.tutorialStep >= TRAINING.length;
  g.ui.coachDone(finished);
  if (finished) {
    g.addItem(I.EMERALD, 3, true);
    g.celebrate();
    g.toast('Training complete! +3 emeralds for the traders', 'emerald');
    return -1;
  }
  return g.tutorialStep;
}

export function training(g: Game): boolean {
  return g.day === 1 && g.tutorialStep < TRAINING.length;
}

// ------------------------------------------------------------------ places worth pointing at

function cannonSpot(g: Game): Vec3 | null {
  const F = g.fortress;
  for (const [k] of F.cannons) {
    if (!usesTnt(turretKind(F, k))) continue;
    const q = F.cellCenter(kx(k), ky(k), kz(k));
    return [q.x, q.y + 0.5, q.z];
  }
  return null;
}

/** The top of the boarding ladder (where you step on to go down): a ladder hanging off the deck. */
export function ladderTop(g: Game): Vec3 | null {
  const F = g.fortress;
  for (const [k, c] of F.cells) {
    if (c.id !== B.LADDER || ky(k) > 0 || F.blockAt(kx(k), ky(k) + 1, kz(k)) === B.LADDER) continue;
    return F.toWorld(kx(k) + 0.5, ky(k) + 1, kz(k) + 0.5);
  }
  return null;
}

/** Where to aim the grapple to get back aboard: the deck's edge nearest you. */
function grappleSpot(g: Game): Vec3 | null {
  const F = g.fortress;
  const p = g.player;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (const k of F.cells.keys()) {
    if (ky(k) !== 0) continue;
    const x = kx(k);
    const z = kz(k);
    if (!F.solidAt(x, 0, z) || F.hasBlock(x, 1, z) || F.hasBlock(x, 2, z)) continue;
    const [wx, wy, wz] = F.toWorld(x + 0.5, 1, z + 0.5);
    const d = Math.hypot(wx - p.x, wz - p.z);
    if (d < bestD) {
      bestD = d;
      best = [wx, wy, wz];
    }
  }
  return best;
}

function helmTarget(g: Game): Vec3 | null {
  const p = g.player;
  // Still on the ground: first the ladder's foot.
  if (p.standingOn !== g.fortress && !g.helm && p.y < g.fortress.y - 3) {
    const f = g.ladderFoot();
    return [f[0], f[1] + 1, f[2]];
  }
  const spot = g.helmSpot();
  return spot ? g.fortress.toWorld(spot[0], spot[1] + 1, spot[2]) : null;
}

function villageStructures(g: Game, site: Site | null): Structure[] {
  if (!site) return [];
  return g.world.structures.all.filter((s) => s.site === site && !g.world.hoisted.has(s.id));
}

function nearestChest(g: Game): Vec3 | null {
  const p = g.player;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (const s of villageStructures(g, g.site)) {
    for (const c of s.chests) {
      if (g.world.lootedChests.has(g.world.chestKey(c.x, c.y, c.z))) continue;
      if (g.world.get(c.x, c.y, c.z) !== B.CHEST) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = [c.x + 0.5, c.y + 1, c.z + 0.5];
      }
    }
  }
  return best;
}

/** The nearest building the crane could lift right now (and where to aim). */
export function nearestHoistable(g: Game): { s: Structure; spot: Vec3 } | null {
  const c = g.fortressCentre();
  let best: { s: Structure; spot: Vec3 } | null = null;
  let bestD = Infinity;
  for (const s of g.world.structures.all) {
    if (!isHoistable(s) || g.world.hoisted.has(s.id)) continue;
    const sx = (s.minX + s.maxX + 1) / 2;
    const sz = (s.minZ + s.maxZ + 1) / 2;
    const d = Math.hypot(sx - c[0], sz - c[2]);
    if (d > 64 || d > bestD) continue;
    if (!hoistCheck(g, s).ok) continue;
    bestD = d;
    best = { s, spot: [sx, s.maxY + 1, sz] };
  }
  return best;
}

function nearestRecruit(g: Game): Vec3 | null {
  const p = g.player;
  let best: Vec3 | null = null;
  let bestD = 60;
  for (const v of g.villagers) {
    if (v.recruited || v.trader || v.captive || v.freed) continue;
    const d = Math.hypot(v.x - p.x, v.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = [v.x, v.y + 2.2, v.z];
    }
  }
  return best;
}

function traderSpot(g: Game, index: number): Vec3 | null {
  const t = g.villagers.find((v) => v.trader && v.region === index);
  if (t) return [t.x, t.y + 2.2, t.z];
  const well = g.world.structures.byId.get(`v${index}:well`);
  return well ? [well.maxX + 2.5, well.floorY + 2, (well.minZ + well.maxZ + 1) / 2] : null;
}

/** The village the fortress stands at by day, if any. */
function villageHere(g: Game): Site | null {
  const c = g.fortressCentre();
  return g.villageAt(c[0], c[2]);
}

function shortTask(q: QuestInfo): string {
  if (q.kind === 'fetch') return 'find the lost strongbox';
  if (q.kind === 'nest') return 'smash the spider nest';
  return 'free the raiders’ captive';
}

function questSpot(g: Game, q: QuestInfo): Vec3 | null {
  const state = g.questState[q.index];
  if (state === 'claimed') return null;
  if (state === 'done') return traderSpot(g, q.index);
  return [q.camp.x + 0.5, q.camp.y + 1, q.camp.z + 0.5];
}

function worstLeg(g: Game, min: number): Vec3 | null {
  const W = g.walker;
  let worst = min;
  let at: Vec3 | null = null;
  for (const l of W.legs) {
    if (l.damage < worst) continue;
    worst = l.damage;
    const p = g.player;
    // From the deck: the hip; from the ground: the knee.
    const hip = W.hipWorld(g.fortress, l);
    at = p.y > hip[1] - 2 ? [hip[0], hip[1] + 2, hip[2]] : W.knee(g.fortress, l, hip);
  }
  return at;
}

function coreSpot(g: Game): Vec3 | null {
  const k = g.coreKey();
  if (k === null) return null;
  const q = g.fortress.cellCenter(kx(k), ky(k), kz(k));
  return [q.x, q.y + 0.5, q.z];
}

function unpoweredMachine(g: Game): Vec3 | null {
  const F = g.fortress;
  for (const [k, c] of F.cells) {
    if (c.id !== B.CANNON && c.id !== B.MORTAR && c.id !== B.THRUSTER) continue;
    if (F.poweredMachines.has(k)) continue;
    const q = F.cellCenter(kx(k), ky(k), kz(k));
    return [q.x, q.y + 0.5, q.z];
  }
  return null;
}

function nextStop(g: Game): string {
  return g.nextDestination().name;
}

// ------------------------------------------------------------------ the next step

export function currentGoal(g: Game): Goal | null {
  // A warden awake is the whole of the moment, day or night.
  if (g.warden && g.warden.stage !== 'dying') return mainObjective(g);
  if (g.phase === 'night') return nightGoal(g);
  if (g.phase !== 'day') return null;
  const core = g.coreHp();
  if (core.hp < core.max * 0.5) return { tag: 'REPAIR', text: 'Fix the Engine Core: aim + REPAIR (iron)', target: coreSpot(g), tone: 'danger', label: 'ENGINE CORE', icon: 'ui_hammer' };
  const leg = worstLeg(g, 0.5);
  if (leg) return { tag: 'REPAIR', text: 'Fix the damaged leg: REPAIR (iron)', target: leg, tone: 'danger', label: 'BROKEN LEG', icon: 'ui_hammer' };
  // (The golden creeper first: it burrows away soon, the Heartstone keeps.)
  const gold = g.mobs.find((m) => !m.dead && m.golden > 0);
  if (gold) return { tag: 'GOLDEN CREEPER', text: `Catch it before it burrows away! (${Math.ceil(gold.golden)}s)`, target: [gold.x, gold.y + 2.2, gold.z], tone: 'quest', label: 'CATCH ME', icon: 'emerald' };
  if (g.count(I.HEARTSTONE) > 0) return { tag: 'HEARTSTONE', text: 'SOCKET the Heartstone in the Engine Core', target: coreSpot(g), tone: 'quest', label: 'ENGINE CORE', icon: 'heartstone_item' };
  const step = updateTraining(g);
  if (step >= 0 && g.day === 1) {
    const s = TRAINING[step]!;
    return { tag: `STEP ${step + 1}/${TRAINING.length}`, text: s.title, target: s.target(g), tone: 'train', label: s.label, icon: s.icon };
  }
  const v = villageHere(g);
  const q = v ? questInfo(g, v.index) : null;
  if (v && q && v.index > 0) {
    const state = g.questState[v.index];
    if (state === 'active') return { tag: v.name.toUpperCase(), text: `Quest: ${shortTask(q)}`, target: questSpot(g, q), tone: 'quest', label: 'QUEST', icon: 'emerald' };
    if (state === 'done') return { tag: v.name.toUpperCase(), text: 'Claim your reward from the trader', target: questSpot(g, q), tone: 'quest', label: 'TRADER', icon: 'emerald' };
  }
  const crate = crateTarget(g);
  if (crate) return { tag: 'SUPPLY DROP', text: crateFalling(g) ? 'A crate is coming down: be there when it lands' : 'Open the supply crate', target: crate, tone: 'quest', label: 'CRATE', icon: 'chest_front' };
  if (v && trusts(g, v)) {
    const h = nearestHoistable(g);
    if (h && g.today.hoisted < 2) return { tag: v.name.toUpperCase(), text: `Hoist the ${h.s.name.toLowerCase()} onto your deck`, target: h.spot, tone: 'quest', label: 'HOIST ME', icon: 'ui_hoist' };
  }
  const gems = g.count(I.EMERALD);
  if (v && gems >= 5 && !g.today.traded) return { tag: 'TRADER', text: `Spend your ${gems} emeralds at the trader`, target: traderSpot(g, v.index), tone: 'quest', label: 'TRADER', icon: 'emerald' };
  // An officer's errand close by, then the main quest's next step.
  const errand = nearErrand(g);
  if (errand) return errand;
  const main = mainObjective(g);
  if (main) return main;
  const machine = unpoweredMachine(g);
  if (machine) return { tag: 'POWER', text: 'Lay Redstone Wire from the Core to it', target: machine, tone: 'day', label: 'NO POWER', icon: 'wire_item' };
  const hoard = treasureTarget(g);
  if (hoard) return { tag: 'TREASURE', text: 'Dig under the gravel cross', target: [hoard.x, hoard.y + 1, hoard.z], tone: 'quest', label: 'TREASURE', icon: 'treasure_map' };
  const wornLeg = worstLeg(g, 0.25);
  if (wornLeg && g.count(I.IRON_INGOT) > 0) return { tag: 'REPAIR', text: 'Patch the worn leg: REPAIR (iron)', target: wornLeg, tone: 'day', label: 'WORN LEG', icon: 'ui_hammer' };
  // Nothing pressing: something fun you have not tried yet (dusk still marches you on).
  const idea = funIdea(g);
  if (idea) return { ...idea, note: `At dusk the fortress marches to ${nextStop(g)}` };
  return { tag: `DAY ${g.day}`, text: `Explore, then MARCH to ${nextStop(g)}`, target: null, tone: 'day', icon: 'ui_sun' };
}

/** The nearest farm animal of a kind (that passes a test) within reach of a short walk. */
function nearestAnimal(g: Game, kind: 'chicken' | 'sheep', ok: (a: { wool: number; tint: number; boarded: boolean }) => boolean, range: number): Vec3 | null {
  const p = g.player;
  let best: Vec3 | null = null;
  let bestD = range;
  for (const a of g.animals) {
    if (a.kind !== kind || !ok(a)) continue;
    const d = Math.hypot(a.x - p.x, a.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = [a.x, a.y + a.h + 0.4, a.z];
    }
  }
  return best;
}

/** A playful suggestion for a quiet moment, picked from the feats not yet earned. */
function funIdea(g: Game): Goal | null {
  if (g.carried) {
    if (!featDone('glide')) return { tag: 'IDEA', text: 'Jump off your deck holding her: she flaps you down!', target: null, tone: 'quest', icon: 'ui_hen' };
    if (!featDone('stowaway')) {
      const spot = g.helmSpot();
      return { tag: 'IDEA', text: 'Take her up and set her down on your deck', target: spot ? g.fortress.toWorld(spot[0], spot[1] + 1, spot[2]) : null, tone: 'quest', label: 'YOUR DECK', icon: 'ui_hen' };
    }
    return null;
  }
  if (!featDone('pink')) {
    const pink = nearestAnimal(g, 'sheep', (a) => a.tint === 4 && a.wool >= 1, 70);
    if (pink) return { tag: 'IDEA', text: 'A rare PINK sheep! Shear it', target: pink, tone: 'quest', label: 'PINK SHEEP', icon: 'ui_sheep' };
  }
  if (!featDone('haircut')) {
    const sheep = nearestAnimal(g, 'sheep', (a) => a.wool >= 1, 55);
    if (sheep) return { tag: 'IDEA', text: 'Shear a sheep: thrusters are sewn from wool', target: sheep, tone: 'quest', label: 'SHEEP', icon: 'ui_sheep' };
  }
  if (!featDone('glide') || !featDone('stowaway')) {
    const hen = nearestAnimal(g, 'chicken', (a) => !a.boarded, 55);
    if (hen) return { tag: 'IDEA', text: 'Pick up a hen (she makes you float!)', target: hen, tone: 'quest', label: 'HEN', icon: 'ui_hen' };
  }
  if (!featDone('goodboy') && g.pet && featProgress('goodboy') < 3) return { tag: 'IDEA', text: `Pet ${g.pet.name}: good wolves love a pat`, target: [g.pet.a.x, g.pet.a.y + 1.3, g.pet.a.z], tone: 'quest', label: g.pet.name.toUpperCase(), icon: 'ui_wolf' };
  return null;
}

function nightGoal(g: Game): Goal {
  // The last fight: she, or the colossus she wears.
  const fb = g.finalBoss;
  if (fb) {
    const body = fb.stage === 'colossus' ? fb.giant : null;
    const at = body && !body.dead ? body.body.hullCentre() : null;
    if (body) return { tag: 'SIEGE', text: 'Fell the Heart Colossus', target: at ? [at[0], body.body.top + 1, at[1]] : null, tone: 'danger', label: 'COLOSSUS', icon: 'ui_boom' };
    return { tag: 'SIEGE', text: 'Free Veyra from the Heart', target: [fb.mob.x, fb.mob.y + fb.mob.h + 0.6, fb.mob.z], tone: 'danger', label: 'VEYRA', icon: 'builders_key' };
  }
  if (g.siege) {
    if (g.siegeStage === 'pylons') {
      const py = g.pylons.find((p) => p.alive);
      return { tag: 'SIEGE', text: `Shatter the glowing pylons (${g.pylons.filter((p) => p.alive).length} left)`, target: py ? [py.x, py.y + 1, py.z] : null, tone: 'danger', label: 'PYLON', icon: 'glowstone' };
    }
    if (g.siegeStage === 'colossus') {
      const c = g.colossus;
      const at = c && !c.dead ? c.body.hullCentre() : null;
      return { tag: 'SIEGE', text: 'Fell the Creeper Colossus', target: at ? [at[0], c!.body.top + 1, at[1]] : null, tone: 'danger', label: 'COLOSSUS', icon: 'ui_boom' };
    }
    return { tag: 'SIEGE', text: `Blast the bare Heart (${g.heartLeft} left)`, target: [g.world.terrain.citadel.x, g.world.terrain.citadel.y + 30, g.world.terrain.citadel.z], tone: 'danger', label: 'THE HEART', icon: 'ui_boom' };
  }
  const core = g.coreHp();
  if (core.hp < core.max * 0.4) {
    if (g.count(I.HEARTSTONE) > 0) return { tag: 'DANGER', text: 'The Core is failing: SOCKET a Heartstone (full repair)', target: coreSpot(g), tone: 'danger', label: 'ENGINE CORE', icon: 'heartstone_item' };
    return { tag: 'DANGER', text: 'The Core is failing: REPAIR it (iron)', target: coreSpot(g), tone: 'danger', label: 'ENGINE CORE', icon: 'ui_hammer' };
  }
  const leg = worstLeg(g, 0.6);
  if (leg) return { tag: 'DANGER', text: 'A leg is buckling: REPAIR it (iron)', target: leg, tone: 'danger', label: 'BROKEN LEG', icon: 'ui_hammer' };
  const aboard = g.mobs.filter((m) => !m.dead && (m.standingOn === g.fortress || m.climb !== null)).length;
  if (g.relics.has('horn') && g.hornCharges > 0 && aboard >= 3) return { tag: 'HORN', text: `${aboard} monsters aboard: blow the WAR HORN`, target: null, tone: 'danger', icon: 'horn_item' };
  const giant = g.giants.find((gi) => !gi.dead && !gi.dormant);
  if (giant && g.blocked) {
    const [x, z] = giant.body.hullCentre();
    return { tag: 'GIANT', text: 'Fire at it, ram it (FULL STEAM) or LEAP on', target: [x, giant.body.top + 1, z], tone: 'danger', label: 'GIANT', icon: 'ui_boom' };
  }
  const climber = g.mobs.find((m) => !m.dead && m.climb);
  if (climber) return { tag: 'LEGS', text: canStomp(g) ? 'Monsters on the legs: STOMP them off (hold for a big one)' : 'Monsters climbing the legs: shoot them off', target: [climber.x, climber.y + 2, climber.z], tone: 'danger', label: 'CLIMBER', icon: canStomp(g) ? 'ui_stomp' : 'ui_boom' };
  const dest = g.destination?.name ?? 'dawn';
  const beat = nightBeat(g.progress);
  if (beat.name === 'lull') {
    // A breather: the most useful job before they come back.
    if (g.count(I.IRON_INGOT) > 0) {
      const worn = worstLeg(g, 0.25);
      if (worn) return { tag: 'LULL', text: 'Patch the worn leg while it is quiet: REPAIR', target: worn, tone: 'night', label: 'WORN LEG', icon: 'ui_hammer' };
      if (core.hp < core.max * 0.8) return { tag: 'LULL', text: 'Patch up the Engine Core: REPAIR', target: coreSpot(g), tone: 'night', label: 'ENGINE CORE', icon: 'ui_hammer' };
    }
    const low = lowTurret(g);
    if (low && g.count(I.TNT) > 0) return { tag: 'LULL', text: 'Reload the turret: LOAD TNT', target: low, tone: 'night', label: 'RELOAD', icon: 'tnt_side' };
    return { tag: 'LULL', text: 'Catch your breath: they will be back', target: null, tone: 'night', icon: 'bread' };
  }
  if (beat.name === 'wave') return { tag: beat.label, text: `Hold the legs and the deck · ${dest} ahead`, target: null, tone: 'danger', icon: 'ui_sword' };
  if (beat.name === 'final') return { tag: 'FINAL ASSAULT', text: 'Hold on until dawn!', target: null, tone: 'danger', icon: 'ui_sword' };
  if (beat.name === 'dawn') return { tag: 'DAWN', text: `The horde falters: ${dest} is close`, target: null, tone: 'night', icon: 'ui_sun' };
  return { tag: `NIGHT ${g.day}`, text: `March to ${dest}: guard the Engine Core`, target: null, tone: 'night', icon: 'ui_moon' };
}

/** A cannon or mortar running low on TNT (its spot, for the reload hint). */
function lowTurret(g: Game): Vec3 | null {
  const F = g.fortress;
  for (const [k, s] of F.cannons) {
    if (!usesTnt(turretKind(F, k)) || s.ammo >= 3) continue;
    const q = F.cellCenter(kx(k), ky(k), kz(k));
    return [q.x, q.y + 0.5, q.z];
  }
  return null;
}

// ------------------------------------------------------------------ today's plan

export function dayPlan(g: Game): PlanItem[] {
  if (training(g)) return TRAINING.map((s, i) => ({ text: s.title.charAt(0) + s.title.slice(1).toLowerCase(), done: i < g.tutorialStep }));
  const items: PlanItem[] = [];
  const v = villageHere(g);
  const q = v ? questInfo(g, v.index) : null;
  if (v && q && v.index > 0) {
    // What they will entrust you with is the hook: name it.
    const relic = questRelic(g.world.terrain.version, v.index);
    const prize = relic && !g.relics.has(relic) ? RELICS[relic].name : `${q.reward} emeralds`;
    items.push({ text: `Help ${v.name}: ${shortTask(q)} (reward: ${prize})`, done: g.questState[v.index] === 'claimed' });
  }
  if (v) items.push({ text: trusts(g, v) ? `Hoist ${v.name}'s buildings onto your deck` : `Once ${v.name} trusts you, hoist its buildings`, done: g.today.hoisted > 0 });
  if (v) items.push({ text: 'Trade emeralds: turrets, TNT, crew bunks', done: g.today.traded });
  if (g.walker.legs.some((l) => l.damage > 0.2) || g.coreHp().hp < g.coreHp().max * 0.8) items.push({ text: 'Repair worn legs and the Core with iron', done: false });
  if (!v) items.push({ text: 'Loot ruins, mines and chests nearby', done: false });
  for (const e of errands(g).slice(0, 2)) items.push({ text: `${e.d.name}: ${e.text}`, done: false });
  items.push({ text: `At dusk the fortress marches to ${nextStop(g)}`, done: false });
  return items;
}

export function nightPlan(g: Game): string[] {
  const lines = [
    'Monsters climb the legs: STOMP flings them off (hold it for a bigger one)',
    'TNT crates parachute onto the deck in every lull',
  ];
  if (g.bounty) lines.unshift(`★ Bounty: ${bountyText(g.bounty)} (${bountyProgress(g.bounty)}) · +${g.bounty.reward} emeralds`);
  // The march runs into a Heart Seal: its guardian is the night's fight.
  const seal = sealAhead(g);
  if (seal && g.destination && seal.x < g.destination.x) lines.unshift(`${seal.name} bars the way: ${GUARDIANS[seal.guardian].name} wakes as you near it, and the night lasts until it falls`);
  if (g.nightTheme === 'storm') lines.push('Thunderstorm: lightning strikes the tallest blocks');
  else if (g.nightTheme === 'blood') lines.push('Blood moon: more monsters, and faster');
  else if (g.nightTheme === 'raid') lines.push('Illager raid: beat every wave before dawn can come');
  else if (g.nightTheme === 'wither') lines.push('The Wither wakes ahead: the night lasts until it falls');
  lines.push(g.helm ? 'You hold the HELM: hands off and the crew steers' : 'The crew marches on: take the HELM to steer');
  lines.push('Reaching a village ends the night');
  return lines;
}

/** The dawn report: what the night cost and brought. */
export function nightReport(g: Game): string {
  const slain = g.stats.slain - g.nightLog.slain;
  const giants = g.stats.giants - g.nightLog.giants;
  const parts = [`${slain} monster${slain === 1 ? '' : 's'} slain`];
  if (giants > 0) parts.push(`${giants} giant${giants > 1 ? 's' : ''} felled`);
  if (g.nightLog.salvage > 0) parts.push(`${g.nightLog.salvage} parts salvaged`);
  const lost = g.nightLog.cells - g.fortress.cells.size;
  if (lost > 0) parts.push(`${lost} blocks lost`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ tips (each shown once)

const TIP_KEY = 'block-fortress-tips-v1';
let seen: Set<string> | null = null;

function seenTips(): Set<string> {
  if (seen) return seen;
  try {
    seen = new Set(JSON.parse(window.localStorage.getItem(TIP_KEY) ?? '[]') as string[]);
  } catch {
    seen = new Set();
  }
  return seen;
}

function markSeen(id: string): void {
  seenTips().add(id);
  try {
    window.localStorage.setItem(TIP_KEY, JSON.stringify([...seenTips()]));
  } catch {
    // storage may be unavailable
  }
}

interface Tip {
  id: string;
  when: (g: Game) => boolean;
  text: (pc: boolean) => string;
}

const TIPS: Tip[] = [
  {
    id: 'ladder',
    when: (g) => g.player.climbing,
    text: (pc) => (pc ? 'Ladders: walk towards one to climb up, away from it to climb down. One push and you keep going to the end. The boarding ladder\'s rope always reaches the ground.' : 'Ladders: push the stick towards one to climb up, away from it to climb down. One push and you keep going to the end. The boarding ladder\'s rope always reaches the ground.'),
  },
  {
    id: 'chute',
    when: (g) => g.player.chute > 0,
    text: (pc) => `Parachute! It opens by itself whenever you fall from high up, and you always land softly. Steer with ${pc ? 'W A S D' : 'the stick'}. To go ashore fast, push against the deck's rail and JUMP DOWN.`,
  },
  {
    id: 'helm',
    when: (g) => g.helm,
    text: (pc) => `FULL STEAM rams giants out of your way; STOMP${pc ? ' (X)' : ''} slams every leg down and flings monsters off (hold it for a bigger one). Both use steam (the ♨ gauge).`,
  },
  {
    id: 'sword',
    when: (g) => g.wieldsSword(),
    text: () => 'The sword hits twice as hard as the pick and sweeps everything in front of you.',
  },
  {
    id: 'crit',
    when: (g) => g.stats.slain >= 3 && !g.helm,
    text: (pc) => (pc ? 'Jump, then strike on the way down: a CRITICAL hit deals half again the damage.' : 'Tap JUMP, then strike on the way down: a CRITICAL hit deals half again the damage.'),
  },
  {
    id: 'tnt',
    when: (g) => g.selected === I.TNT,
    text: (pc) => (pc ? 'TNT in hand: right click throws it along the arc. Aimed at a cannon or mortar, it loads it instead.' : 'TNT in hand: tap the view to throw it along the arc. Tap a cannon or mortar to load it instead.'),
  },
  {
    id: 'build',
    when: (g) => g.mode === 'build' && g.selected !== null && g.selected !== B.CANNON && g.selected !== B.BALLISTA && g.selected !== B.MORTAR,
    text: (pc) => (pc ? 'Building: right click a surface to place. Blocks touching the deck become part of the fortress.' : 'Building: tap a surface to place. Blocks touching the deck become part of the fortress.'),
  },
  {
    id: 'turret',
    when: (g) => g.mode === 'build' && (g.selected === B.CANNON || g.selected === B.BALLISTA || g.selected === B.MORTAR),
    text: () => 'Bolt turrets onto the deck\'s edge. Cannons and mortars need TNT and Redstone Wire from the Engine Core; ballistas need nothing.',
  },
  {
    id: 'hoist',
    when: (g) => g.context?.label.startsWith('HOIST') ?? false,
    text: () => 'The crane lifts whole buildings onto your deck: houses add crew bunks, windmills speed, watchtowers cannons, smithies repairs, farms bread.',
  },
  {
    id: 'cranedrop',
    when: (g) => atCraneControls(g) && !g.hoist && !g.craneDrop,
    text: (pc) => `Old Hob, the crane hand, keeps the crane's controls: ${pc ? 'press E' : 'tap the action button'} and he hooks a crate of TNT on (2 TNT). Swing it out over the monsters, watch the red ring on the ground, and let go. It swings on its rope: lead it!`,
  },
  {
    id: 'cranenight',
    when: (g) => g.phase === 'night' && (g.stats.craneDrops ?? 0) === 0 && g.player.standingOn === g.fortress && g.count(I.TNT) >= 2 && g.mobs.filter((m) => !m.dead && m.climb).length >= 2,
    text: () => 'Monsters on the legs? Run to the crane\'s mast: it drops a crate of TNT right on their heads.',
  },
  {
    id: 'trust',
    when: (g) => g.context?.label.endsWith(': NOT YET') ?? false,
    text: () => 'This village does not trust you yet. Finish its quest (follow the gold ◆) and it will let the crane take its buildings.',
  },
  {
    id: 'trader',
    when: (g) => g.count(I.EMERALD) > 0,
    text: () => 'Emeralds buy turrets, TNT, iron and crew bunks from any village trader (by the well). Bought turrets come bolted on.',
  },
  {
    id: 'phantom',
    when: (g) => g.mobs.some((m) => !m.dead && m.kind === 'phantom'),
    text: () => 'Phantoms dive from the sky. Ballistas track them; your sword swats them when they swoop in.',
  },
  {
    id: 'leg',
    when: (g) => g.walker.legs.some((l) => l.damage >= 0.35),
    text: () => 'A leg is damaged and the fortress limps. Stand over its hip on the deck (or at its foot) and REPAIR it with an iron ingot.',
  },
  {
    id: 'power',
    when: (g) => unpoweredMachine(g) !== null,
    text: () => 'An unpowered machine: lay Redstone Wire in a line from the Engine Core to it. POWER % shows how much is wired.',
  },
  {
    id: 'hungry',
    when: (g) => g.hunger <= 8,
    text: () => 'You are hungry: pick Bread in your hotbar to eat. Farms hoisted onto the deck bake more.',
  },
  {
    id: 'officer',
    when: (g) => g.phase === 'day' && g.villagers.some((v) => v.kind === 'npc' && !v.captive && Math.hypot(v.x - g.player.x, v.z - g.player.z) < 16 && officerCall(g, v) !== null),
    text: () => 'A glowing ! over someone\'s head means they have something to say. Walk up to them and TALK.',
  },
  {
    id: 'metal',
    when: (g) => [I.SUN_AMBER, I.BOG_IRON, I.RUST_IRON, I.FROST_SHARD, I.EMBER_STEEL].some((id) => g.count(id) > 0),
    text: () => 'Land metal! The FORGE in your workshop turns it into a better sword and coat.',
  },
  {
    id: 'curio',
    when: (g) => g.curios.size > 0,
    text: () => 'A curio for the cabinet. Every land hides five, well off the trail: find them all and that land gives you something for good. See JOURNAL.',
  },
  {
    id: 'storm',
    when: (g) => g.phase === 'night' && g.nightTheme === 'storm',
    text: () => 'Thunderstorm: lightning strikes the tallest point of the fortress now and then. Repairs keep up with it.',
  },
  {
    id: 'map',
    when: (g) => g.count(I.TREASURE_MAP) > 0,
    text: () => 'A treasure map! Pick it in the hotbar to read it: a gold beacon marks the buried hoard.',
  },
  {
    id: 'grapple',
    when: (g) => g.selected === I.GRAPPLE && g.mode === 'mine',
    text: (pc) => (pc ? 'Grapple: right click any block up to 34 away to zip to it: up a cliff, onto your deck, or safely down to the ground. Space mid-flight lets go.' : 'Grapple: tap any block up to 34 away to zip to it: up a cliff, onto your deck, or safely down to the ground. JUMP mid-flight lets go.'),
  },
  {
    id: 'crossbow',
    when: (g) => g.selected === I.CROSSBOW && g.mode === 'mine',
    text: (pc) => (pc ? 'Crossbow: click to shoot, hold to keep shooting. It needs no ammo: pick climbers off the legs.' : 'Crossbow: tap to shoot, hold to keep shooting. It needs no ammo: pick climbers off the legs.'),
  },
  {
    id: 'horn',
    when: (g) => g.relics.has('horn') && g.hornCharges > 0 && g.phase === 'night' && g.mobs.some((m) => !m.dead && (m.standingOn === g.fortress || m.climb !== null)),
    text: (pc) => `Monsters on the fortress: press HORN${pc ? ' (G)' : ''} to hurl them all off and rally your gunners.`,
  },
  {
    id: 'heartstone',
    when: (g) => g.count(I.HEARTSTONE) > 0,
    text: () => 'A Heartstone! Carry it to the Engine Core and SOCKET it: the Core gains health and is fully repaired.',
  },
  {
    id: 'breaker',
    when: (g) => g.count(I.BREAKER) > 0 && g.selected === I.BREAKER,
    text: () => 'Heartbreakers are precious: save them for giants and the Citadel\'s pylons. Throw one, or keep it in hand while you fire a cannon to load it.',
  },
  {
    id: 'hen',
    when: (g) => !g.carried && g.phase === 'day' && g.animals.some((a) => a.kind === 'chicken' && Math.hypot(a.x - g.player.x, a.z - g.player.z) < 7 && Math.abs(a.y - g.player.y) < 3),
    text: (pc) => `A hen! ${pc ? 'Right click' : 'Tap'} her to pick her up. Holding a hen you float down gently from any height: try jumping off your deck!`,
  },
  {
    id: 'carry',
    when: (g) => g.carried !== null,
    text: (pc) => `Holding a hen: jump off a ledge and she flaps you down; ${pc ? 'Space' : 'JUMP'} in mid-air gives an extra flap. ${pc ? 'Right click (or E)' : 'Tap (or SET DOWN)'} puts her down: on your deck she rides along and lays eggs at sunrise!`,
  },
  {
    id: 'sheep',
    when: (g) => g.phase === 'day' && g.animals.some((a) => a.kind === 'sheep' && a.wool >= 1 && Math.hypot(a.x - g.player.x, a.z - g.player.z) < 7 && Math.abs(a.y - g.player.y) < 3),
    text: (pc) => `A sheep! ${pc ? 'Right click' : 'Tap'} it to shear its wool: Windmill Thrusters are sewn from wool, and wool or hay breaks a fall. The fleece grows back.`,
  },
  {
    id: 'feats',
    when: () => featCount().done > 0,
    text: () => 'Your first FEAT! The pause menu lists them all under ★ FEATS: little things worth trying in the valley.',
  },
];

let tipTimer = 4;

/** The next tip to show (once ever), at most one every few seconds. Training has its own coach. */
export function nextTip(g: Game, dt: number, enabled: boolean): string | null {
  tipTimer -= dt;
  if (!enabled || tipTimer > 0) return null;
  tipTimer = 1;
  if (training(g) || g.ui.lessonOpen) return null;
  const pc = g.input === 'desktop';
  for (const t of TIPS) {
    if (seenTips().has(t.id)) continue;
    if (!t.when(g)) continue;
    markSeen(t.id);
    tipTimer = 14;
    return t.text(pc);
  }
  return null;
}

// ------------------------------------------------------------------ lessons (each shown once)

/**
 * The first time each danger turns up (the first night, monsters on the legs, a giant, the Core
 * under attack, a lull to repair in), a lesson card says what it is and what beats it.
 */
export interface Lesson {
  id: string;
  title: string;
  art: ArtKey | null;
  icon: string;
  tone: GoalTone;
  how: (g: Game, pc: boolean) => Coaching;
  when: (g: Game) => boolean;
  /** Seconds it stays up (the picture folds away after the first few). */
  hold: number;
  /** Where its marker goes, if anywhere. */
  target?: (g: Game) => Vec3 | null;
  label?: string;
}

const GUARDIAN_TITLES: Record<string, string> = {
  queen: 'THE BROOD QUEEN', dune: 'THE DUNE TITAN', slime: 'THE SLIME KING', ravager: 'THE RAVAGER KING', frost: 'THE FROST TITAN', magma: 'THE MAGMA TITAN',
};

const GUARDIAN_HOW: Record<string, string> = {
  queen: 'She guards the first Heart Seal. She climbs a leg and gnaws it, spitting webs at the deck: shoot her off it (crossbow, ballista, cannon). When she drops she lays spiderlings: STOMP them.',
  dune: 'Its glowing Heart is the weak spot: fire every turret at it, or LEAP onto it and dig the Heart out. It hurls sandstone boulders at your deck and slams the ground when close.',
  slime: 'It leaps onto your deck, crushing what it lands on, and sheds big slimes as it breaks. Fight it with the sword on the deck, or blast it with TNT while it sits down below.',
  ravager: 'The beast rams your legs while its warlord casts fangs and calls pillagers. Bring the Ravager King down: hit it with criticals while it charges to stun it.',
  frost: 'When it draws breath, its freezing blast stops the fortress dead and slows anyone it hits. Fire at its glowing Heart between breaths, or LEAP onto it and dig the Heart out.',
  magma: 'Bat its fireballs back (a sword swing or a bolt), shoot its glowing Heart or LEAP onto it and dig it out. It calls blazes as it cracks: ballistas swat them out of the air.',
};

/** Where the seal's guardian is (for its card's marker). */
function guardianSpot(g: Game): Vec3 | null {
  const gs = g.guardian;
  if (!gs) return null;
  if (gs.mob && !gs.mob.dead) return [gs.mob.x, gs.mob.y + gs.mob.h + 0.8, gs.mob.z];
  if (gs.giant && !gs.giant.dead) {
    const [x, z] = gs.giant.body.hullCentre();
    return [x, gs.giant.body.top + 1.5, z];
  }
  return null;
}

/** The nearest monster close enough to fight on foot (same level, a few blocks off). */
export function nearFoe(g: Game): { x: number; y: number; z: number } | null {
  const p = g.player;
  let best: { x: number; y: number; z: number } | null = null;
  let bestD = 8;
  for (const m of g.mobs) {
    if (m.dead || m.fly || m.climb || Math.abs(m.y - p.y) > 2.5) continue;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = { x: m.x, y: m.cy, z: m.z };
    }
  }
  return best;
}

/** The nearest living monster of a kind within range of you (for the lessons that introduce them). */
function nearestOf(g: Game, kind: string, range: number): { x: number; y: number; z: number; h: number } | null {
  const p = g.player;
  let best: { x: number; y: number; z: number; h: number } | null = null;
  let bestD = range;
  for (const m of g.mobs) {
    if (m.dead || m.kind !== kind) continue;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = { x: m.x, y: m.y, z: m.z, h: m.h };
    }
  }
  return best;
}

/** The wandering trader, if he is within range of you (a co-op mate sees the host's). */
function wanderingTrader(g: Game, range: number): { x: number; y: number; z: number } | null {
  const p = g.player;
  const t = g.villagers.find((v) => v.kind === 'wtrader' && !v.dead);
  return t && Math.hypot(t.x - p.x, t.z - p.z) < range ? t : null;
}

function giantHeart(g: Game): Vec3 | null {
  const gi = g.giants.find((x) => !x.dead && !x.dormant);
  if (!gi) return null;
  const heart = gi.body.findBlock(B.GIANT_HEART);
  if (heart === null) return null;
  const q = gi.body.cellCenter(kx(heart), ky(heart), kz(heart));
  return [q.x, q.y, q.z];
}

const LESSONS: Lesson[] = [
  {
    id: 'night1', title: 'DEFEND THE FORTRESS', art: 'night', icon: 'ui_moon', tone: 'night', hold: 13,
    when: (g) => g.phase === 'night' && !g.siege,
    how: () => ({ text: 'The crew walks you to the next village. Monsters climb the legs and go for the Engine Core: hold them off until dawn!', point: null }),
  },
  {
    id: 'fight', title: 'FIGHT!', art: null, icon: 'ui_sword', tone: 'danger', hold: 9,
    when: (g) => g.phase === 'night' && !g.helm && nearFoe(g) !== null,
    how: (g, pc) => (g.selected !== I.SWORD && g.count(I.SWORD) > 0
      ? { text: 'Pick your SWORD: it hits twice as hard', point: { kind: 'slot', item: I.SWORD } }
      : { text: pc ? 'Click a monster to strike · jump and hit on the way down: CRITICAL!' : 'Tap a monster to strike · jump, then hit while falling: CRITICAL!', point: { kind: 'mob' } }),
    target: (g) => {
      const f = nearFoe(g);
      return f ? [f.x, f.y + 1, f.z] : null;
    },
  },
  {
    id: 'climbers', title: 'MONSTERS ON THE LEGS!', art: 'night', icon: 'ui_stomp', tone: 'danger', hold: 12,
    when: (g) => g.mobs.some((m) => !m.dead && m.climb),
    how: (g, pc) => (canStomp(g)
      ? { text: pc ? 'STOMP! Tap X, or HOLD it to heave the hull up: let go and every leg slams down, flinging them off' : 'STOMP! Tap it, or HOLD it to heave the hull up: let go and every leg slams down, flinging them off', point: { kind: 'stomp' } }
      : { text: 'Get back aboard your fortress: from its deck, STOMP flings them off the legs', point: null }),
  },
  {
    id: 'giant', title: 'A GIANT!', art: 'giant', icon: 'ui_boom', tone: 'danger', hold: 14,
    when: (g) => g.giants.some((gi) => !gi.dead && !gi.dormant && gi.lair === undefined),
    how: (g, pc) => (g.helm
      ? { text: pc ? 'Click its glowing red heart to fire · hold SPACE to RAM it at full steam' : 'Tap its glowing red heart to fire · hold STEAM to RAM it', point: { kind: 'world' } }
      : { text: pc ? 'Shoot its glowing red heart from the HELM, or press R to LEAP on and dig it out' : 'Shoot its glowing red heart from the HELM, or LEAP on and dig it out', point: null }),
    target: (g) => giantHeart(g),
    label: 'HEART',
  },
  {
    id: 'raid', title: 'ILLAGER RAID!', art: 'raid', icon: 'banner_ominous', tone: 'danger', hold: 14,
    when: (g) => g.raid !== null && (g.raid.state === 'gather' || g.raid.state === 'wave'),
    how: () => ({ text: 'Wave after wave: the RAID bar counts who is left. Pillagers shoot from afar, vindicators charge with axes, a ravager rams your legs. Beat every wave: dawn waits for the raid!', point: null }),
  },
  {
    id: 'wither', title: 'THE WITHER!', art: 'wither', icon: 'wither_skull', tone: 'danger', hold: 14,
    when: (g) => g.witherFight !== null && (g.witherFight.stage === 'summon' || g.witherFight.stage === 'fight'),
    how: () => ({ text: 'Its bar must empty before the sun can rise. Shoot it from the turrets and dodge the skulls. At half health it puts on ARMOR: bolts bounce off, so hit it with the SWORD and TNT when it comes down!', point: null }),
  },
  {
    id: 'ghast', title: 'GHAST!', art: 'ghast', icon: 'ui_boom', tone: 'danger', hold: 12,
    when: (g) => nearestOf(g, 'ghast', 60) !== null,
    how: (_g, pc) => ({ text: pc ? 'Its fireballs can be hit back: click the fireball just as it reaches you. A returned fireball knocks the ghast out of the sky!' : 'Its fireballs can be hit back: tap the fireball just as it reaches you. A returned fireball knocks the ghast out of the sky!', point: null }),
    target: (g) => {
      const m = nearestOf(g, 'ghast', 60);
      return m ? [m.x, m.y + m.h + 0.6, m.z] : null;
    },
    label: 'GHAST',
  },
  {
    id: 'witch', title: 'A WITCH!', art: 'witch', icon: 'splash_item', tone: 'danger', hold: 11,
    when: (g) => nearestOf(g, 'witch', 40) !== null,
    how: () => ({ text: 'She throws splash potions (poison, slowness, weakness) and drinks healing when hurt. Rush her, or let the turrets finish her before she drinks!', point: null }),
    target: (g) => {
      const m = nearestOf(g, 'witch', 40);
      return m ? [m.x, m.y + m.h + 0.8, m.z] : null;
    },
    label: 'WITCH',
  },
  {
    // No marker on this one: looking it in the eye is exactly what not to do.
    id: 'enderman', title: 'ENDERMAN!', art: 'enderman', icon: 'ui_eye', tone: 'danger', hold: 12,
    when: (g) => nearestOf(g, 'enderman', 40) !== null,
    how: () => ({ text: 'Do not look it in the eye: a stare makes it scream and teleport to you. Left alone it steals blocks off your deck: kill it to get them back. Rain burns it.', point: null }),
  },
  // ---- the Long March: the seal guardians (one card each, the first time each rises)
  ...(['queen', 'dune', 'slime', 'ravager', 'frost', 'magma'] as const).map((kind): Lesson => ({
    id: `boss_${kind}`, title: GUARDIAN_TITLES[kind], art: `boss_${kind}`, icon: 'seal_crystal', tone: 'danger', hold: 14,
    when: (g) => g.guardian !== null && g.guardian.kind === kind,
    how: () => ({ text: GUARDIAN_HOW[kind], point: null }),
    target: (g) => guardianSpot(g),
    label: 'GUARDIAN',
  })),
  {
    id: 'swampmobs', title: 'THE DROWNED!', art: 'swampmobs', icon: 'ui_sword', tone: 'danger', hold: 11,
    when: (g) => nearestOf(g, 'drowned', 30) !== null || nearestOf(g, 'bogged', 30) !== null,
    how: () => ({ text: 'Drowned rise from the swamp\'s pools and throw tridents (watch for the raised arm); bogged skeletons shoot poison arrows. Keep moving, and eat to heal.', point: null }),
  },
  {
    id: 'breeze', title: 'A BREEZE!', art: 'breeze', icon: 'wind_charge_item', tone: 'danger', hold: 11,
    when: (g) => nearestOf(g, 'breeze', 34) !== null,
    how: () => ({ text: 'Its wind charges hurl you off your feet: off the deck, even (your parachute opens). Shoot it from the turrets, or close in fast. It drops wind charges: throw one for a huge jump!', point: null }),
    target: (g) => {
      const m = nearestOf(g, 'breeze', 34);
      return m ? [m.x, m.y + m.h + 0.6, m.z] : null;
    },
    label: 'BREEZE',
  },
  {
    id: 'bear', title: 'POLAR BEAR!', art: 'bear', icon: 'ui_sword', tone: 'danger', hold: 10,
    when: (g) => nearestOf(g, 'polarbear', 26) !== null,
    how: () => ({ text: 'It rears up and roars before it charges: that is your moment to get clear. Left alone it claws at the fortress\'s feet. It hits hard: fight it from the deck.', point: null }),
  },
  {
    id: 'blaze', title: 'BLAZES!', art: 'blaze', icon: 'ui_boom', tone: 'danger', hold: 11,
    when: (g) => nearestOf(g, 'blaze', 40) !== null || nearestOf(g, 'magmacube', 30) !== null,
    how: () => ({ text: 'Blazes glow brighter before each volley of three fireballs: duck behind something. Magma cubes bounce in and split when hit. Ballistas are quick enough for blazes.', point: null }),
    target: (g) => {
      const m = nearestOf(g, 'blaze', 40);
      return m ? [m.x, m.y + m.h + 0.6, m.z] : null;
    },
    label: 'BLAZE',
  },
  {
    id: 'trader', title: 'A WANDERING TRADER', art: 'trader', icon: 'emerald', tone: 'quest', hold: 10,
    when: (g) => g.phase === 'day' && wanderingTrader(g, 40) !== null,
    how: () => ({ text: 'He sells rare things for emeralds: totems, pearls, potions, wind charges, even Heartstones. Four wares a day, and he moves on at dusk.', point: null }),
    target: (g) => {
      const t = wanderingTrader(g, 40);
      return t ? [t.x, t.y + 2.4, t.z] : null;
    },
    label: 'TRADER',
  },
  {
    id: 'golem', title: 'AN IRON GOLEM', art: 'golem', icon: 'iron_block', tone: 'quest', hold: 11,
    when: (g) => g.phase === 'day' && g.villagers.some((v) => v.kind === 'golem' && !v.boarded && Math.hypot(v.x - g.player.x, v.z - g.player.z) < 20),
    how: () => ({ text: 'This village\'s golem will join your fortress once you have helped the village (its quest): it guards the deck and punches climbers clean off it.', point: null }),
  },
  {
    id: 'core', title: 'THE CORE IS HIT!', art: 'core', icon: 'ui_hammer', tone: 'danger', hold: 12,
    when: (g) => g.coreHp().hp < g.coreHp().max * 0.75,
    how: () => ({ text: 'If the Engine Core breaks, the fortress falls! Clear the deck, then REPAIR it at the Core (iron ingot)', point: null }),
    target: (g) => coreSpot(g),
    label: 'ENGINE CORE',
  },
  {
    id: 'lull', title: 'A LULL', art: null, icon: 'tnt_side', tone: 'night', hold: 10,
    when: (g) => g.phase === 'night' && !g.siege && nightBeat(g.progress).name === 'lull',
    how: () => ({ text: 'Catch your breath: a crate of TNT is parachuting onto the deck. Reload the cannon (LOAD TNT), eat, repair: the next wave is coming!', point: null }),
    target: (g) => lowTurret(g),
    label: 'RELOAD',
  },
  {
    id: 'quest', title: 'HELP THE VILLAGE', art: 'trade', icon: 'emerald', tone: 'quest', hold: 12,
    when: (g) => {
      if (g.phase !== 'day') return false;
      const v = villageHere(g);
      return v !== null && v.index > 0 && g.questState[v.index] === 'active';
    },
    how: () => ({ text: 'Every village has a quest (follow the gold arrow). Finish it for emeralds and a relic, and the village lets you hoist its houses.', point: null }),
  },
];

const LESSON_KEY = 'block-fortress-lessons-v1';
let lessonsSeen: Set<string> | null = null;

function seenLessons(): Set<string> {
  if (lessonsSeen) return lessonsSeen;
  try {
    lessonsSeen = new Set(JSON.parse(window.localStorage.getItem(LESSON_KEY) ?? '[]') as string[]);
  } catch {
    lessonsSeen = new Set();
  }
  return lessonsSeen;
}

let lessonTimer = 2;

export function lessonSeen(id: string): boolean {
  return seenLessons().has(id);
}

/**
 * The next lesson to show (each once ever), never during the training run. While a calm lesson
 * has had its moment (`urgentOnly`), a danger lesson may take its place.
 */
export function nextLesson(g: Game, dt: number, enabled: boolean, urgentOnly = false): Lesson | null {
  lessonTimer -= dt;
  if ((!enabled && !urgentOnly) || lessonTimer > 0 || training(g)) return null;
  lessonTimer = 0.5;
  for (const l of LESSONS) {
    if (seenLessons().has(l.id) || !l.when(g)) continue;
    if (urgentOnly && l.tone !== 'danger') continue;
    seenLessons().add(l.id);
    try {
      window.localStorage.setItem(LESSON_KEY, JSON.stringify([...seenLessons()]));
    } catch {
      // storage may be unavailable
    }
    lessonTimer = 4;
    return l;
  }
  return null;
}

/** Forgets the lessons and tips seen (a fresh captain). */
export function resetGuidance(): void {
  seenLessons().clear();
  seenTips().clear();
  try {
    window.localStorage.removeItem(LESSON_KEY);
    window.localStorage.removeItem(TIP_KEY);
  } catch {
    // storage may be unavailable
  }
}

// ------------------------------------------------------------------ part labels (day one)

/** Names floating over the fortress's important parts while you learn your way round. */
export function partLabels(g: Game): Array<{ at: Vec3; text: string }> {
  const F = g.fortress;
  const out: Array<{ at: Vec3; text: string }> = [];
  const core = coreSpot(g);
  if (core) out.push({ at: [core[0], core[1] + 0.9, core[2]], text: 'ENGINE CORE' });
  const helm = g.helmSpot();
  if (helm) {
    const [x, y, z] = F.toWorld(helm[0] + 1, helm[1] + 1.9, helm[2]);
    out.push({ at: [x, y, z], text: 'HELM' });
  }
  const cannon = cannonSpot(g);
  if (cannon) out.push({ at: [cannon[0], cannon[1] + 1.2, cannon[2]], text: 'CANNON' });
  const top = ladderTop(g);
  if (top) out.push({ at: [top[0], top[1] + 1.2, top[2]], text: 'LADDER' });
  const mast = craneBase(F);
  if (mast.real) out.push({ at: F.toWorld(mast.at[0], mast.at[1] + 0.8, mast.at[2]), text: 'CRANE' });
  for (const [k, c] of F.cells) {
    if (c.id !== B.CRAFTING_TABLE) continue;
    const q = F.cellCenter(kx(k), ky(k), kz(k));
    out.push({ at: [q.x, q.y + 1, q.z], text: 'WORKSHOP' });
    break;
  }
  return out;
}

// ------------------------------------------------------------------ control hints (while in a mode)

/** A standing reminder of the controls while you are doing something special, else null. */
export function controlHint(g: Game): string | null {
  const pc = g.input === 'desktop';
  // The training card already spells out the step being taught.
  const coached = trainingStep(g)?.id;
  if (g.player.dead) return 'Knocked out! Back on your fortress in a moment...';
  if (pc && g.mouseFree) return 'Click the game to capture the mouse and look around.';
  if (g.hoist) return coached === 'hoist' ? null : 'The crane swings the building into its place in your hold...';
  if (g.behind > 1) return 'Left behind! Hang on: the crew is throwing you a rope...';
  if (g.helm) {
    if (g.blockReason) return BLOCK_TEXT[g.blockReason];
    // Co-op, a mate on the guns: taps mark its targets (said at night until one is marked).
    if (g.mateOnGuns()) {
      if ((g.phase !== 'night' && !g.siege) || markPoint(g)) return null;
      return pc ? 'Your mate is on the GUNS · click a monster: mark it for them' : 'Your mate is on the GUNS · tap a monster: mark it for them';
    }
    // The controls are spelled out until you have walked the fortress a while.
    if (g.flags.drove > 40 || coached === 'helm') return null;
    return pc ? 'W/S walk · A/D turn · hold Space/Shift: FULL STEAM · click: fire · E: let go' : 'Stick: walk & turn · hold STEAM: full speed · tap the view: fire';
  }
  const onGiant = g.giants.some((gi) => !gi.dead && g.player.standingOn === gi.body);
  if (onGiant) return pc ? 'Dig out the glowing Heart (hold left click), then press R to leap back!' : 'Dig out the glowing Heart (hold on it), then tap BACK!';
  return null;
}

// ------------------------------------------------------------------ the handbook

export function handbook(pc: boolean, march = false): Array<{ icon: string; title: string; art?: ArtKey; lines: string[] }> {
  return [
    {
      icon: 'ui_sun',
      title: 'EACH DAY',
      art: 'hoist',
      lines: [
        'Follow the ◆ line under the clock: it is always your next step, and a beacon marks the spot. Tap it for today’s plan.',
        'Help the village you stand in (its quest): you earn emeralds and its trust.',
        'A village that trusts you lets your crane HOIST its buildings onto your deck.',
        'Trade emeralds with the trader by the well. Loot chests, mine iron and coal, craft at the workshop.',
        'Recruit villagers: they man the turrets and patch up the fortress. Pip, your wolf, bites monsters and digs up finds (tap to pet).',
        'Supply crates parachute in by day, and a golden creeper full of emeralds may turn up: chase it down!',
        'At dusk (or when you press MARCH) the fortress sets off for the next village.',
      ],
    },
    {
      icon: 'ui_moon',
      title: 'EACH NIGHT',
      art: 'night',
      lines: [
        'The crew walks the fortress on through the dark. Reach the village and the night ends.',
        'Monsters climb the legs and swarm the deck; giants block the way; phantoms dive from above.',
        'Take the HELM to steer and fire every turret, or fight on deck with your sword and TNT.',
        'If the Engine Core breaks, the fortress falls: REPAIR it (and damaged legs) with iron.',
        'Some nights are worse: thunderstorms throw lightning, blood moons bring more monsters.',
        'Each night posts a ★ BOUNTY (see tonight\'s plan): earn it and emeralds are paid at dawn.',
      ],
    },
    {
      icon: 'ui_hoist',
      title: 'THE FORTRESS',
      art: 'helm',
      lines: [
        pc ? 'TAKE HELM at the stern (E). W/S walk, A/D turn, hold Space/Shift for FULL STEAM.' : 'TAKE HELM at the stern. The stick walks and turns; hold the steam button for FULL STEAM.',
        `FULL STEAM rams giants out of the way. STOMP${pc ? ' (X, from anywhere aboard)' : ' (from anywhere aboard)'} slams every leg down: hold it to heave higher and hit harder. Let go of the helm and the crew steers.`,
        'MAP: tap anywhere and the crew walks the fortress there. Walking makes the day pass faster.',
        'Hoisted buildings: houses = crew bunks, windmills = speed, watchtowers = cannons, smithies = repairs, farms = bread.',
        pc
          ? 'Working the crane: click HEAVE as the needle hits the gold, push A/D against the swing to steady the load, and click DROP over the gold. Perfect lifts in a row pay more and more emeralds.'
          : 'Working the crane: tap HEAVE as the needle hits the gold, push the stick against the swing to steady the load, and tap DROP over the gold. Perfect lifts in a row pay more and more emeralds.',
        'By the crane\'s mast Old Hob hooks on a crate of TNT (2 TNT): swing it out over the monsters, watch the red ring, and let it go. Village traders fit parts to the crane.',
        'Redstone Wire from the Engine Core powers cannons, mortars and thrusters.',
      ],
    },
    {
      icon: 'ui_sword',
      title: 'WEAPONS',
      art: 'cannon',
      lines: [
        'Sword: hits hard and sweeps. Pickaxe: digs, and hits a little.',
        pc ? 'TNT in hand: right click to throw it. Or LOAD TNT into cannons and mortars.' : 'TNT in hand: tap to throw it. Or LOAD TNT into cannons and mortars.',
        'Cannon: lobs TNT. Mortar: long range shells. Ballista: fast bolts, no ammo, best against phantoms and climbers.',
        pc ? 'Giants: shoot the glowing Heart, or press R to LEAP aboard and dig it out. Their parts are yours.' : 'Giants: shoot the glowing Heart, or LEAP aboard and dig it out. Their parts are yours.',
      ],
    },
    {
      icon: 'grapple_item',
      title: 'RELICS & THE JOURNAL',
      art: 'grapple',
      lines: [
        'Help a village and it entrusts you with a relic of the old builders, each a new power.',
        `Grapple (Oakbrook): zip to any block up to 34 away. Crossbow (Millford): bolts, no ammo. War Horn (Stonewater): once a night, hurl monsters off the fortress${pc ? ' (G)' : ''}.`,
        'Storm Rod (Ashvale): lightning strikes your enemies. Heartbreakers (Redcliff): three huge charges for giants and pylons.',
        'Felled giants leave Heartstones: SOCKET them in the Engine Core for more health and a full repair.',
        'Pages of the Builders\' Journal hide in ruins, mines and giants. Read them under JOURNAL in the pause menu.',
      ],
    },
    march
      ? {
        icon: 'seal_crystal',
        title: 'THE LONG MARCH',
        art: 'boss_queen',
        lines: [
          'Seven lands west to east: Greenvale, the Sunscorch Desert, the Mirefen Swamp, the Rustcanyon Badlands, the Frostfang Snowfields, the Ember Wastes and the Blight. Each has its own monsters, villages and weather.',
          'Six Heart Seals (walls of green crystal) bar the way between them. March up to one and its GUARDIAN wakes: the night lasts until it falls.',
          'Fell the guardian and its seal shatters: the next land opens, and the guardian leaves a TROPHY that powers up your fortress for good (see JOURNAL).',
          'Villages past the first two keep an iron golem: help the village, and it joins your deck for emeralds. Some mornings a wandering trader comes by with rare wares.',
          'The MAP shows the seals and your march across the lands; old mines, lairs, ruins and buried treasure hold the best loot.',
          'At the Citadel: shatter its four glowing pylons, fell the Colossus, then blast the Heart: it takes the Builders\' Key to open it, and Veyra waits behind it.',
        ],
      }
      : {
        icon: 'ui_map',
        title: 'THE VALLEY',
        art: 'giant',
        lines: [
          'West to east: green meadows, the desert, the snowfields, then the blighted lands of the Creeper Citadel.',
          'Old mines, giants’ lairs, castle ruins and buried treasure (find maps!) hold the best loot.',
          'Caves hide iron, coal and emeralds, and lava. Ladders are your way up and down; your parachute opens by itself on any long drop.',
          'At the Citadel: shatter its four glowing pylons, fell the Colossus, then blast the Heart to win.',
        ],
      },
    ...(march ? [
      {
        icon: 'builders_key',
        title: 'THE ELEVEN STRIDERS',
        art: 'boss_veyra' as const,
        lines: [
          'Eleven Striders marched east against the Heart and never came back. The ◆ line follows the main quest: each land hides one wreck, off the road, marked with a crest on the MAP.',
          'Set course for the expedition by day. Your fortress climbs the pass and waits there; the land round the wreck is yours to explore on foot.',
          'Something guards every wreck: a WARDEN. Beat it, open the captain\'s chest, and you hold that Strider\'s CREST. A Heart Seal\'s guardian only answers to the crest of its own land.',
          'Six crests, carried to the Builders\' Forge in the crater of Mount Cinder and reforged at the anvil, make the BUILDERS\' KEY: the only thing that opens the Heart.',
          'Behind the Heart waits what it kept of Veyra, in three shapes. Read the captains\' logs in your JOURNAL: they know what she was.',
        ],
      },
      {
        icon: 'ui_villager',
        title: 'YOUR OFFICERS',
        art: 'recruit' as const,
        lines: [
          'Twelve people along the march have a story and a job to offer. Look for the officers by the wells, TALK to them, and hear them out.',
          'Each one has an errand, marked on the MAP with a star. See it through and they come aboard for good, each with a perk of their own, and a gift.',
          'They stand on your deck and have something new to say in every land. The CREW tab of the JOURNAL shows who you have, who is waiting and what each one is asking for.',
          'One of them is locked in the outlaws\' fort. Open the cages before you leave.',
        ],
      },
      {
        icon: 'ui_hammer',
        title: 'FORGE, FOOD & CURIOS',
        art: 'chest' as const,
        lines: [
          'Each land has its own metal, in its chests and from its bosses. At the workshop, the FORGE turns them into better swords and coats. Every blade has a trick of its own.',
          'New food, stews and brews are in the workshop too: some ward off fire or frost, some make you swift. Your officers teach you the best of them.',
          'Thirty-five CURIOS lie in lost stashes well off the trail, five in each land, and each land\'s five together give a lasting bonus. Find every one, and there is one more.',
          'The JOURNAL keeps it all: quests, crew, curios, a bestiary of everything you have beaten, and the pages you have read.',
        ],
      },
    ] : []),
    {
      icon: 'ui_star',
      title: 'LITTLE JOYS',
      lines: [
        pc ? 'Hens peck round the farms: right click one to pick her up. Holding a hen you float down from any height (Space in mid-air: an extra flap); set her down on your deck and she rides along, laying eggs at sunrise.' : 'Hens peck round the farms: tap one to pick her up. Holding a hen you float down from any height (JUMP in mid-air: an extra flap); set her down on your deck and she rides along, laying eggs at sunrise.',
        'Sheep graze the meadows: shear them for wool (Windmill Thrusters are sewn from it). The fleece grows back. Landing on wool or hay never hurts.',
        'Your fortress\'s feet squash flat any monster they come down on. Splat!',
        'In the lulls of the night a shooting star may cross the sky: tap it to make a wish.',
        'Pip howls at the moon, chases hens for fun and digs up finds. Pet it often.',
        '★ FEATS in the pause menu list fun things to try. Each one is yours to keep.',
      ],
    },
    {
      icon: 'ui_coop',
      title: 'PLAY TOGETHER',
      lines: [
        'Two players, one fortress. PLAY TOGETHER (on the title or in the pause menu), then INVITE A FRIEND: your friend types the 5-letter room code into their own phone or computer.',
        pc ? 'At night one of you takes the HELM; the other stands by a turret and presses E: MAN THE GUNS. Every turret then fires where the gunner clicks.' : 'At night one of you takes the HELM; the other stands by a turret and taps MAN THE GUNS. Every turret then fires where the gunner taps.',
        pc ? 'The helmsman\'s clicks put a red TARGET on a monster for the gunner. Swap places under PLAY TOGETHER in the pause menu (Esc).' : 'The helmsman\'s taps (or MARK) put a red TARGET on a monster for the gunner. Tap the co-op bar under the clock to swap places.',
        'The fortress, the hold and the journey are shared; the game is saved on the host\'s device. A dropped line reconnects by itself.',
      ],
    },
    {
      icon: 'ui_eye',
      title: 'CONTROLS',
      lines: pc
        ? [
          'WASD walk · Mouse look · Space jump/climb (against the rail: jump down) · Left click mine/hit · Right click place/throw.',
          'E use (load, hoist, helm, trade, repair) · F fire · R leap · G war horn · M map · N march · C workshop · J today’s plan.',
          '1-9 or the mouse wheel pick items · V (or F5) first/third-person view · Esc pause.',
        ]
        : [
          'The stick walks: touch anywhere on the left of the screen and it comes to your thumb (run your thumb on and it follows). Drag the rest of the view to look.',
          'The sword button hits and mines at the centre mark: hold it to keep going. With TNT, a relic or bread in hand it turns gold and throws, fires or eats it instead. You can also hold on a block, and tap to place or throw.',
          'The gold ACTION button does what you aim at: LOAD, HOIST, TAKE HELM, TALK, TRADE, REPAIR. Pushed against the deck\'s rail it says JUMP DOWN.',
          'The bag at the end of the hotbar opens all your items. On the MAP, pinch and drag; tap to set a course.',
          'The button beside pause switches the view: your own eyes, or third person from behind your shoulder.',
          'Tap the ◆ line under the clock for today’s plan; this guide is in the pause menu.',
        ],
    },
  ];
}
