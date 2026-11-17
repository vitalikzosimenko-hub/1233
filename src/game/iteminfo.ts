// What each thing in your pack is for, in a line: the hotbar names what you have just taken in hand,
// and the workshop tells you about a material (and what it goes into) when you tap it.
import { B, I, RECIPES, itemDef } from './blocks';
import { COATS, SWORDS, swordOf } from './gear';
import type { Game } from './game';
import { RELICS } from './story';

/** Errands' keepsakes: somebody on the march is looking for each of them. */
const KEEPSAKES = new Set<number>([I.SUN_TABLET, I.FERRY_LANTERN, I.CANNON_PLANS, I.HAWK_TAG, I.STAR_LENS, I.EMBER_ORE, I.VEYRA_NOTE]);

/** Each land's metal (the forge's). */
const METALS = new Set<number>([I.SUN_AMBER, I.BOG_IRON, I.RUST_IRON, I.FROST_SHARD, I.EMBER_STEEL]);

/** Recipe lines that say how a thing is made rather than what it is for. */
const MAKING = new Set(['planks', 'planks_spruce', 'planks_birch', 'ingot', 'glass']);

/** A line of its own for the things whose use is not their recipe's. */
function own(id: number, pc: boolean): string | null {
  switch (id) {
    case I.COAL:
      return 'Fuel: torches are made with it, and the furnace burns it to smelt';
    case I.IRON_INGOT:
      return 'Metal for turrets, lanterns, armour plating and better gear';
    case I.REDSTONE:
      return 'The Core\'s power runs through it: craft it into Redstone Wire';
    case I.GUNPOWDER:
      return 'The bang in every TNT';
    case I.TNT:
      return pc ? 'Load it into cannons and mortars, or right click to throw it' : 'Load it into cannons and mortars, or tap to throw it';
    case I.WHEAT_ITEM:
      return 'Three of them bake a loaf of bread';
    case I.EMERALD:
      return 'The traders\' coin: TNT, turrets, bunks and crane parts';
    case I.STRONGBOX:
      return 'Bring it to the village trader for your reward';
    case I.TREASURE_MAP:
      return 'Pick it to read it: the buried hoard shows on your map';
    case I.HEARTSTONE:
      return 'Take the Heartstone to the Engine Core and SOCKET it';
    case I.PEARL:
      return pc ? 'Right click to throw it: you teleport where it lands' : 'Tap to throw it: you teleport where it lands';
    case I.TOTEM:
      return 'The Totem of Undying works from your pack: if a blow would knock you out, it saves you';
    case I.NETHER_STAR:
      return 'Take the Nether Star to the Engine Core: LIGHT THE BEACON';
    case I.WIND_CHARGE:
      return pc
        ? 'Right click to throw it: its burst hurls monsters away. Throw it at your feet to leap up'
        : 'Tap to throw it: its burst hurls monsters away. Throw it at your feet to leap up';
    case I.CACTUS_FRUIT:
      return 'Bo\'s errand and the galley\'s stew both want it';
    case I.MARSH_ROOT:
      return 'Moss brews her potions from it';
    case B.IRON_ORE:
      return 'Smelt it into an iron ingot at a furnace (with coal)';
    case B.WOOL:
    case B.RED_WOOL:
    case B.HAY:
      return 'Soft: a fall onto it never hurts';
    case B.OBSIDIAN:
      return 'The toughest block there is: the best armour for your hull';
    case B.GLOWSTONE:
      return 'A block that glows: light for your hold and deck';
    default:
      return null;
  }
}

/** What an item is for, in a line (the pickaxe when `id` is null). */
export function itemUse(g: Game, id: number | null, pc: boolean): string {
  if (id === null) return pc ? 'Digs blocks: hold left click on one' : 'Digs blocks: aim at one and hold the red button';
  if (id === I.SWORD) return swordOf(g).text;
  if (id === I.GRAPPLE) return RELICS.grapple.use(pc);
  if (id === I.CROSSBOW) return RELICS.crossbow.use(pc);
  if (id === I.BREAKER) return RELICS.breaker.use(pc);
  if (id === I.HORN) return RELICS.horn.use(pc);
  const line = own(id, pc);
  if (line) return line;
  if (KEEPSAKES.has(id)) return 'Someone on the march is looking for this: see the JOURNAL';
  if (METALS.has(id)) return 'This land\'s metal: the forge makes better gear from it';
  const recipe = RECIPES.find((r) => r.out === id && !MAKING.has(r.id));
  if (recipe) return recipe.hint;
  if (itemDef(id).food > 0) return 'Food: restores hunger';
  return pc ? 'A building block: pick it, then right click where it goes' : 'A building block: pick it, then tap where it goes';
}

/** The name an item goes by in hand (the sword is whichever one the forge last made). */
export function itemName(g: Game, id: number | null): string {
  if (id === null) return 'Pickaxe';
  if (id === I.SWORD) return swordOf(g).name;
  return itemDef(id).name;
}

/** What it goes into: the recipes that take it, then the gear the forge makes from it (a few). */
export function itemMakes(id: number, most = 5): string[] {
  const out: string[] = [];
  for (const r of RECIPES) {
    if (!r.inputs.some(([input]) => input === id)) continue;
    const name = itemDef(r.out).name;
    if (!out.includes(name)) out.push(name);
  }
  for (const t of [...SWORDS, ...COATS]) if (t.need.some(([input]) => input === id) && !out.includes(t.name)) out.push(t.name);
  return out.length > most ? [...out.slice(0, most), '...'] : out;
}
