// The Cabinet of Curios: thirty-five small things left along the march, five in each land, each in a
// lost stash off the trail, and a twelfth cog that turns up when they are all found. Each land's
// five together give the fortress something for good.
import { I } from './blocks';
import { feat } from './feats';
import type { Game } from './game';

export interface Curio {
  id: string;
  name: string;
  /** The land it lies in (-1: the last of all). */
  land: number;
  text: string;
}

export const CURIOS: readonly Curio[] = [
  { id: 'pocket_compass', land: 0, name: 'Rowan\'s Pocket Compass', text: 'The needle does not point north. It points at the Bramble, wherever that is.' },
  { id: 'harvest_medal', land: 0, name: 'Harvest Medal', text: 'First prize, Oakbrook Fair, largest marrow. The Striders were built to carry marrows. Remember that.' },
  { id: 'clover_locket', land: 0, name: 'Clover Locket', text: 'Pressed in the year the Twelve were launched. Someone gave this to someone who was going away.' },
  { id: 'toy_strider', land: 0, name: 'Toy Strider', text: 'A child\'s carving, the legs on pegs. All twelve were built to this shape. Veyra is said to have copied it.' },
  { id: 'millstone_charm', land: 0, name: 'Millstone Charm', text: 'Millford brides wear one so the household will always have bread. The miller\'s wife still looks for hers.' },
  { id: 'sun_scarab', land: 1, name: 'Sun King\'s Scarab', text: 'Warm to the touch at noon, and at midnight, and at the bottom of a well.' },
  { id: 'dune_glass', land: 1, name: 'Dune Glass', text: 'Sand melted where something fell from the sky. Amina says it is older than the desert.' },
  { id: 'cracked_hourglass', land: 1, name: 'Cracked Hourglass', text: 'The sand still runs, but upward, and only while nobody is looking.' },
  { id: 'water_flask', land: 1, name: 'Water-Seller\'s Flask', text: 'It has never been empty, its owner swore. It is empty now.' },
  { id: 'sand_goggles', land: 1, name: 'Saffi\'s Goggles', text: 'Captain Saffi raced the sandstorms. Scratched by a thousand miles of wind, and still the best seat in the desert.' },
  { id: 'wisp_jar', land: 2, name: 'Wisp in a Jar', text: 'It wants out, but only a little. Feed it swamp gas and do not name it.' },
  { id: 'frog_crown', land: 2, name: 'Frog Crown', text: 'Far too small for anyone. It fits Prince perfectly, and he will not discuss it.' },
  { id: 'drowned_bell', land: 2, name: 'Drowned Bell', text: 'From the chapel at Old Fenwick. Fishermen say it still rings under the water on the night of a flood.' },
  { id: 'witch_thimble', land: 2, name: 'Witch\'s Thimble', text: 'Worn when sewing up what should not be sewn. Moss will not touch it.' },
  { id: 'mire_lily', land: 2, name: 'Mire Lily', text: 'The flower the Strider was named for. It only opens over deep water, and only for a day.' },
  { id: 'lucky_coin', land: 3, name: 'Outlaw\'s Lucky Coin', text: 'Heads on both sides, and a bullet hole where the luck ran out.' },
  { id: 'hawk_feather', land: 3, name: 'Red Hawk Feather', text: 'Captain Vesna wore one for every fight she won. There were a great many feathers.' },
  { id: 'fossil_trilobite', land: 3, name: 'Fossil Trilobite', text: 'These canyons were a sea once. This little thing walked its floor long before anything else thought of legs.' },
  { id: 'rusty_spur', land: 3, name: 'Rusty Spur', text: 'One spur, no boot, no rider. The canyon does not give back what it takes.' },
  { id: 'wind_chime', land: 3, name: 'Canyon Wind Chime', text: 'Hung at a crossroads to warn of breezes. It is ringing now, and there is no wind.' },
  { id: 'frozen_rose', land: 4, name: 'Frozen Rose', text: 'Nobody grows roses in Frostfang. Someone carried this one a very long way, and did not get to give it.' },
  { id: 'tooth_whistle', land: 4, name: 'Bear-Tooth Whistle', text: 'Yrsa\'s brother cut it. It has only one note, and every bear in the north knows it.' },
  { id: 'aurora_prism', land: 4, name: 'Aurora Prism', text: 'Hold it to the sky and the northern lights fall through it onto your hand. They do not feel like anything.' },
  { id: 'frozen_inkwell', land: 4, name: 'Ilja\'s Inkwell', text: 'The last poem he wrote is frozen in it. Aurel will not thaw it. Some things are better left unread.' },
  { id: 'snow_globe', land: 4, name: 'Snow Globe of Oakbrook', text: 'Shake it and it snows on a tiny castle. It has never snowed in Oakbrook.' },
  { id: 'phoenix_cinder', land: 5, name: 'Phoenix Cinder', text: 'Blow on it and it glows. Blow harder and it looks back.' },
  { id: 'molten_gear', land: 5, name: 'Molten Gear', text: 'From the Ember Queen\'s drive train. It melted, and then it went on turning.' },
  { id: 'obsidian_mask', land: 5, name: 'Obsidian Mask', text: 'Worn by whoever walked the crater\'s rim to read the lava. It has been worn by a great many people.' },
  { id: 'signet_ring', land: 5, name: 'Orla\'s Signet', text: 'Stamped on every cannon she cast. Orsa has been looking for this for twenty years.' },
  { id: 'ash_rose', land: 5, name: 'Ash Rose', text: 'It grew here, out of nothing but ash, and it will fall apart if you are unkind to it.' },
  { id: 'heart_shard', land: 6, name: 'Cracked Heartshard', text: 'It beats if you hold it long enough. Do not hold it long enough.' },
  { id: 'drafting_compass', land: 6, name: 'Veyra\'s Compass', text: 'She drew the Twelve with this. There are forty years of dust on it, and no rust at all.' },
  { id: 'silent_bell', land: 6, name: 'Silent Bell', text: 'Redcliff\'s alarm bell. The clapper was taken out, the scouts say, so that nobody would hear the end.' },
  { id: 'black_feather', land: 6, name: 'Black Feather', text: 'No bird has lived in the Blight for forty years. This feather is one day old.' },
  { id: 'last_lantern', land: 6, name: 'Last Lantern', text: 'Lastlight is named for it. It was lit the night the Heart woke, and has been lit every night since.' },
  { id: 'twelfth_cog', land: -1, name: 'The Twelfth Cog', text: 'Every Strider had one cog with its number on it. This is yours. Brannoc has carried it in his pocket for forty years, waiting for someone to deserve it.' },
];

/** What each land's five together give the fortress. */
export const CABINET: ReadonlyArray<{ name: string; perk: string }> = [
  { name: 'Greenvale\'s Keepsakes', perk: '+2 max health' },
  { name: 'Treasures of the Sands', perk: 'You walk a little faster' },
  { name: 'Relics of the Fen', perk: 'Poison wears off quicker' },
  { name: 'Canyon Spoils', perk: 'Every chest holds a little more' },
  { name: 'Northern Keepsakes', perk: 'Your hunger lasts longer' },
  { name: 'Ember Relics', perk: 'Lava and fire burn you less' },
  { name: 'Blight Relics', perk: 'Your blows bite deeper into bosses' },
];

export function curioArt(id: string): string {
  return `curio/${id}.webp`;
}

export function curioOf(id: string): Curio | undefined {
  return CURIOS.find((c) => c.id === id);
}

/** The curio in a stash (id "stash<land>_<k>"), if it has not been found. */
export function curioIn(g: Game, nook: string): string | null {
  const m = /^stash(\d+)_(\d+)$/.exec(nook);
  if (!m) return null;
  const c = CURIOS.filter((x) => x.land === Number(m[1]))[Number(m[2])];
  return c && !g.curios.has(c.id) ? c.id : null;
}

/** Whether a land's five are all in the cabinet. */
export function setDone(g: Game, land: number): boolean {
  return CURIOS.every((c) => c.land !== land || g.curios.has(c.id));
}

/** A curio found: its card, a fanfare, the land's set, and at the very end the last cog. */
export function findCurio(g: Game, id: string): void {
  if (g.curios.has(id)) return;
  const c = curioOf(id);
  if (!c) return;
  g.curios.add(id);
  g.ui.story('curio', id);
  g.sfx('relic', 'metal', 0.8);
  g.xp(20);
  feat(g, 'curio');
  if (c.land >= 0 && setDone(g, c.land)) {
    const set = CABINET[c.land]!;
    g.ui.banner(set.name.toUpperCase(), set.perk, 'gold');
    g.celebrate(3);
    feat(g, 'curioset');
    g.applyPerks();
  }
  if (CURIOS.every((x) => x.land < 0 || g.curios.has(x.id)) && !g.curios.has('twelfth_cog')) {
    g.curios.add('twelfth_cog');
    g.ui.story('curio', 'twelfth_cog');
    g.addItem(I.NETHER_STAR, 1, true);
    feat(g, 'cabinet');
  }
  g.save();
}
