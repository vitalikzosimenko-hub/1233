// Feats: little badges for the playful things the valley lets a captain do (squash a monster
// under your own feet, glide off the deck holding a hen, wish on a shooting star...). Each is
// earned once per captain, kept across games, and listed in the pause menu so there is always
// something fun to try next.
import type { Game } from './game';

export interface Feat {
  id: string;
  title: string;
  /** What to do, in a line. */
  text: string;
  icon: string;
  /** Times it has to happen (counted across games). */
  goal?: number;
}

export const FEATS: Feat[] = [
  { id: 'pancake', title: 'Pancake Day', text: 'Squash a monster under one of your fortress\'s feet', icon: 'ui_stomp' },
  { id: 'stack', title: 'Short Stack', text: 'Squash 10 monsters underfoot', icon: 'ui_stomp', goal: 10 },
  { id: 'glide', title: 'Chicken Pilot', text: 'Hold a hen and glide 10 blocks down (jump off your deck!)', icon: 'ui_hen' },
  { id: 'stowaway', title: 'Stowaway', text: 'Carry a hen up and set her down on your deck', icon: 'ui_hen' },
  { id: 'flock', title: 'Mother Hen', text: 'Keep 3 hens aboard (they lay eggs at sunrise)', icon: 'ui_hen' },
  { id: 'haircut', title: 'Haircut', text: 'Shear a sheep (wool makes thrusters)', icon: 'ui_sheep' },
  { id: 'pink', title: 'Pretty in Pink', text: 'Find and shear the rare pink sheep', icon: 'ui_sheep' },
  { id: 'goodboy', title: 'Good Boy', text: 'Pet Pip 10 times', icon: 'ui_wolf', goal: 10 },
  { id: 'wish', title: 'Make a Wish', text: 'Tap a shooting star as it crosses the night sky', icon: 'ui_star' },
  { id: 'gold', title: 'Gold Rush', text: 'Catch a golden creeper', icon: 'emerald' },
  { id: 'hitchhiker', title: 'Hitchhiker', text: 'Ride on the back of a giant', icon: 'ui_leap' },
  { id: 'ram', title: 'Battering Ram', text: 'Ram a giant at full steam', icon: 'ui_boom' },
  { id: 'strike', title: 'Strike!', text: 'Fling 5 monsters with a single STOMP', icon: 'ui_stomp' },
  { id: 'rampage', title: 'Rampage', text: 'Slay 6 monsters in one streak', icon: 'ui_sword' },
  { id: 'village', title: 'Pocket Village', text: 'Have 5 hoisted buildings on your fortress', icon: 'ui_hoist' },
  { id: 'crane', title: 'Crane Master', text: 'Make 3 perfect lifts: heave on the gold, drop on the mark', icon: 'ui_hoist', goal: 3 },
  { id: 'cranebomb', title: 'Look Out Below', text: 'Blow up 4 monsters with one TNT crate dropped from the crane', icon: 'ui_boom' },
  { id: 'cranekit', title: 'Rigged and Ready', text: 'Fit every part the traders sell to your crane', icon: 'gearbox' },
  { id: 'soft', title: 'Soft Landing', text: 'Fall 8 blocks onto wool or hay, unhurt', icon: 'wool_white' },
  { id: 'skydive', title: 'Sky Diver', text: 'Ride your parachute 16 blocks down (a cliff, or your cabin roof)', icon: 'ui_chute' },
  { id: 'splash', title: 'Cannonball!', text: 'Dive 8 blocks down into water', icon: 'water_still' },
  { id: 'blood', title: 'Red Sky at Morning', text: 'Survive a blood moon', icon: 'ui_moon' },
  { id: 'hoard', title: 'X Marks the Spot', text: 'Read a treasure map and dig up the buried hoard', icon: 'treasure_map' },
  { id: 'heartstone', title: 'Heart of Stone', text: 'Socket a giant\'s Heartstone in your Engine Core', icon: 'heartstone_item' },
  { id: 'victory', title: 'Citadel Breaker', text: 'Blast the Creeper Citadel\'s Heart to dust', icon: 'ui_boom' },
  { id: 'seal', title: 'Sealbreaker', text: 'Bring down a seal\'s guardian and shatter its Heart Seal', icon: 'seal_crystal' },
  { id: 'allseals', title: 'The Long March', text: 'Shatter all six Heart Seals on the way to the Citadel', icon: 'seal_crystal' },
  { id: 'wanderer', title: 'Seven Lands', text: 'March the fortress into every land of the valley', icon: 'ui_map', goal: 7 },
  { id: 'trader', title: 'A Fair Deal', text: 'Trade with the wandering trader', icon: 'emerald' },
  { id: 'golem', title: 'Iron Friend', text: 'Take an iron golem aboard your fortress', icon: 'iron_block' },
  { id: 'windrider', title: 'Wind Rider', text: 'Get blown off the deck by a breeze and float down safely', icon: 'wind_charge_item' },
  { id: 'rocketjump', title: 'Rocket Jump', text: 'Throw a wind charge at your own feet and ride the blast', icon: 'wind_charge_item' },
  { id: 'warden', title: 'Wreck Diver', text: 'Beat what guards a lost Strider\'s wreck', icon: 'crest_0' },
  { id: 'crests', title: 'The Six Crests', text: 'Recover all six Strider Crests', icon: 'builders_key' },
  { id: 'veyra', title: 'Hearthstone', text: 'Free Veyra from the Heart', icon: 'builders_key' },
  { id: 'officer', title: 'Officer of the Watch', text: 'Finish an officer\'s errand and bring them aboard', icon: 'ui_villager' },
  { id: 'company', title: 'A Full Company', text: 'Bring all twelve officers aboard', icon: 'ui_villager' },
  { id: 'curio', title: 'Collector', text: 'Find 5 curios in the lost stashes', icon: 'treasure_map', goal: 5 },
  { id: 'curioset', title: 'Set Piece', text: 'Find all five curios of a land', icon: 'treasure_map' },
  { id: 'cabinet', title: 'The Twelfth Cog', text: 'Fill the Cabinet of Curios', icon: 'treasure_map' },
  { id: 'gear', title: 'Well Armed', text: 'Forge the Emberblade and the Ember Plate', icon: 'sword_5' },
];

const FEAT_KEY = 'block-fortress-feats-v1';

interface FeatSave {
  done: string[];
  n: Record<string, number>;
}

let state: FeatSave | null = null;

function load(): FeatSave {
  if (state) return state;
  try {
    const raw = JSON.parse(window.localStorage.getItem(FEAT_KEY) ?? 'null') as FeatSave | null;
    state = raw && Array.isArray(raw.done) ? { done: raw.done, n: raw.n ?? {} } : { done: [], n: {} };
  } catch {
    state = { done: [], n: {} };
  }
  return state;
}

function store(): void {
  try {
    window.localStorage.setItem(FEAT_KEY, JSON.stringify(load()));
  } catch {
    // storage may be unavailable
  }
}

export function featDone(id: string): boolean {
  return load().done.includes(id);
}

/** Progress of a counted feat (0 for the rest). */
export function featProgress(id: string): number {
  return load().n[id] ?? 0;
}

export function featCount(): { done: number; total: number } {
  return { done: load().done.filter((id) => FEATS.some((f) => f.id === id)).length, total: FEATS.length };
}

/**
 * Counts towards a feat (`n` more times); the moment its goal is reached it is earned: a jingle,
 * a gold card and a little experience.
 */
export function feat(g: Game, id: string, n = 1): void {
  // A co-op partner's feats are earned on the partner's own device.
  if (g.cx.sink) {
    g.cx.sink.feat(id, n);
    return;
  }
  const f = FEATS.find((x) => x.id === id);
  if (!f || featDone(id)) return;
  const s = load();
  const goal = f.goal ?? 1;
  const have = (s.n[id] ?? 0) + n;
  if (goal > 1) s.n[id] = have;
  if (have < goal) {
    store();
    return;
  }
  s.done.push(id);
  delete s.n[id];
  store();
  g.sfx('feat', 'metal', 0.85);
  g.xp(10);
  g.buzz(40);
  g.ui.feat(f);
  g.report('visual_feedback');
}
