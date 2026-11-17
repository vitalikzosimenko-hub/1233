// The captain's gear: one sword and one coat, reforged again and again from what each land yields
// (the iron sword in your hand from day one, then sandsteel, bog iron, rust iron, frost and ember).
// Land metals turn up in that land's chests and on its monsters; a better edge bites harder, better
// plate turns blows. The last of each takes Orsa's hand. The gear is the fortress's, like the hold.
import { B, I } from './blocks';
import { feat } from './feats';
import type { Game } from './game';
import { hasOfficer } from './company';
import type { Zone } from './terrain';

export interface GearTier {
  name: string;
  text: string;
  need: Array<[item: number, count: number]>;
  /** Added to the sword's blow, or the share of a blow the armour turns. */
  power: number;
  icon: string;
  /** Knocked into the iron by this officer. */
  officer?: 'orsa';
}

export const SWORDS: readonly GearTier[] = [
  { name: 'Iron Sword', text: 'A plain, honest blade.', need: [], power: 0, icon: 'ui_sword' },
  { name: 'Sandsteel Saber', text: 'Light and quick: hits a third harder.', need: [[I.SUN_AMBER, 3], [I.IRON_INGOT, 2]], power: 3, icon: 'sword_1' },
  { name: 'Bog-Iron Cleaver', text: 'Heavy and foul: poisons what it cuts.', need: [[I.BOG_IRON, 3], [I.IRON_INGOT, 2]], power: 6, icon: 'sword_2' },
  { name: 'Canyon Cutlass', text: 'Fast in the hand: every fourth blow is a critical.', need: [[I.RUST_IRON, 3], [I.IRON_INGOT, 3]], power: 10, icon: 'sword_3' },
  { name: 'Frostbrand', text: 'Cold to the touch: slows what it cuts.', need: [[I.FROST_SHARD, 4], [I.IRON_INGOT, 3]], power: 15, icon: 'sword_4' },
  { name: 'Emberblade', text: 'Holds its own flame: sets what it cuts alight.', need: [[I.EMBER_STEEL, 4], [I.IRON_INGOT, 4]], power: 22, icon: 'sword_5', officer: 'orsa' },
];

export const COATS: readonly GearTier[] = [
  { name: 'Traveller\'s Coat', text: 'Keeps off the rain.', need: [], power: 0, icon: 'coat_0' },
  { name: 'Sandstrider Vest', text: 'Turns a tenth of every blow.', need: [[I.SUN_AMBER, 2], [B.WOOL, 3]], power: 0.1, icon: 'coat_1' },
  { name: 'Bog-Iron Mail', text: 'Turns a fifth of every blow.', need: [[I.BOG_IRON, 3], [I.IRON_INGOT, 3]], power: 0.2, icon: 'coat_2' },
  { name: 'Canyon Plate', text: 'Turns three tenths of every blow.', need: [[I.RUST_IRON, 4], [I.IRON_INGOT, 4]], power: 0.3, icon: 'coat_3' },
  { name: 'Frostguard Plate', text: 'Turns two fifths of every blow.', need: [[I.FROST_SHARD, 4], [I.IRON_INGOT, 4]], power: 0.4, icon: 'coat_4' },
  { name: 'Ember Plate', text: 'Turns half of every blow.', need: [[I.EMBER_STEEL, 5], [I.IRON_INGOT, 5]], power: 0.5, icon: 'coat_5', officer: 'orsa' },
];

/** Each land's metal (what its monsters carry and its chests hold). */
export function landMetal(zone: Zone): number | null {
  switch (zone) {
    case 'desert':
      return I.SUN_AMBER;
    case 'swamp':
      return I.BOG_IRON;
    case 'badlands':
      return I.RUST_IRON;
    case 'snow':
      return I.FROST_SHARD;
    case 'ember':
      return I.EMBER_STEEL;
    default:
      return null;
  }
}

export function swordOf(g: Game): GearTier {
  return SWORDS[g.gear.sword] ?? SWORDS[0]!;
}

export function coatOf(g: Game): GearTier {
  return COATS[g.gear.coat] ?? COATS[0]!;
}

export type GearSlot = 'sword' | 'coat';

/** The next thing that can be forged for a slot (null: the best there is). */
export function nextGear(g: Game, slot: GearSlot): GearTier | null {
  return (slot === 'sword' ? SWORDS[g.gear.sword + 1] : COATS[g.gear.coat + 1]) ?? null;
}

/** Forges the next tier: its metal is spent and the old piece goes into the fire. */
export function forge(g: Game, slot: GearSlot): boolean {
  const t = nextGear(g, slot);
  if (!t) return false;
  if (t.officer && !hasOfficer(g, t.officer)) {
    g.deny('Only Orsa Emberhand can work ember steel');
    return false;
  }
  if (t.need.some(([id, n]) => g.count(id) < n)) {
    g.deny('Not enough materials');
    return false;
  }
  for (const [id, n] of t.need) g.useItem(id, n);
  if (slot === 'sword') g.gear.sword += 1;
  else g.gear.coat += 1;
  g.sfx('craft', 'metal', 1);
  g.sfx('quest', 'metal', 0.7);
  g.ui.banner(t.name.toUpperCase(), t.text, 'gold');
  if (g.gear.sword >= SWORDS.length - 1 && g.gear.coat >= COATS.length - 1) feat(g, 'gear');
  g.report('primary_input');
  g.save();
  return true;
}
