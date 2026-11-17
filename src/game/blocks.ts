// Block, item and recipe tables. Block ids double as item ids for placeable blocks;
// pure materials (coal, ingots, food...) live at 128+.

export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  GLASS: 8,
  SAND: 9,
  COAL_ORE: 10,
  IRON_ORE: 11,
  REDSTONE_ORE: 12,
  BEDROCK: 13,
  CRAFTING_TABLE: 14,
  FURNACE: 15,
  CHEST: 16,
  WOOL: 17,
  IRON_BLOCK: 18,
  LADDER: 19,
  CANNON: 20,
  THRUSTER: 21,
  CORE: 22,
  DISPENSER: 23,
  WINDMILL_HUB: 24,
  MOSSY_COBBLE: 25,
  GIANT_EYE: 26,
  GIANT_HEART: 27,
  STONE_BRICKS: 28,
  TNT_BLOCK: 29,
  HAY: 30,
  WIRE: 31,
  TALL_GRASS: 32,
  POPPY: 33,
  DANDELION: 34,
  CORNFLOWER: 35,
  OXEYE: 36,
  TORCH: 37,
  WATER: 38,
  PATH: 39,
  GRAVEL: 40,
  SNOW: 41,
  LANTERN: 42,
  CHAIN: 43,
  FENCE: 44,
  OAK_STAIRS: 45,
  COBBLE_STAIRS: 46,
  SPRUCE_STAIRS: 47,
  VINE: 48,
  FARMLAND: 49,
  WHEAT: 50,
  BIRCH_LOG: 51,
  BIRCH_LEAVES: 52,
  SPRUCE_LOG: 53,
  SPRUCE_LEAVES: 54,
  SPRUCE_PLANKS: 55,
  GEARBOX: 56,
  PISTON: 57,
  REDSTONE_TORCH: 58,
  REDSTONE_LAMP: 59,
  SMOOTH_STONE: 60,
  FALLING_WATER: 61,
  BRICKS: 62,
  MOSSY_STONE_BRICKS: 63,
  CRACKED_STONE_BRICKS: 64,
  OBSIDIAN: 65,
  ANDESITE: 66,
  GRANITE: 67,
  HELM: 68,
  GLOWSTONE: 69,
  CITADEL_HEART: 70,
  RED_WOOL: 71,
  BOOKSHELF: 72,
  BARREL: 73,
  SUGAR_CANE: 74,
  FERN: 75,
  BALLISTA: 76,
  MORTAR: 77,
  COBWEB: 78,
  SPAWNER: 79,
  SANDSTONE: 80,
  CUT_SANDSTONE: 81,
  TERRACOTTA: 82,
  CACTUS: 83,
  DEAD_BUSH: 84,
  GRASS_SNOW: 85,
  ICE: 86,
  BLIGHT_GRASS: 87,
  BLIGHT_MOSS: 88,
  LAVA: 89,
  EMERALD_ORE: 90,
  RAIL: 91,
  BEACON: 92,
  // The Long March: the swamp, the badlands, the ember wastes, and the Heart's seals.
  MUD: 93,
  MUD_BRICKS: 94,
  LILY_PAD: 95,
  RED_MUSHROOM: 96,
  BROWN_MUSHROOM: 97,
  RED_SAND: 98,
  RED_SANDSTONE: 99,
  ORANGE_TERRACOTTA: 100,
  YELLOW_TERRACOTTA: 101,
  WHITE_TERRACOTTA: 102,
  BROWN_TERRACOTTA: 103,
  BASALT: 104,
  BLACKSTONE: 105,
  MAGMA: 106,
  ASH: 107,
  CHARRED_LOG: 108,
  SEAL_CRYSTAL: 109,
  PACKED_ICE: 110,
  BLUE_ICE: 111,
  NETHER_BRICKS: 112,
  COARSE_DIRT: 113,
  SWAMP_LEAVES: 114,
  REEDS: 115,
  // The finer parts the Strider's hold is built of.
  OAK_SLAB: 116,
  SPRUCE_SLAB: 117,
  BRICK_SLAB: 118,
  GLASS_PANE: 119,
  SHUTTER: 120,
  COBBLE_WALL: 121,
  BANNER: 122,
  PLANTER: 123,
  // The expeditions: the coven's cauldrons, the pyramid's gold, the Builders' anvil at the forge.
  CAULDRON: 124,
  GOLD_BLOCK: 125,
  ANVIL: 126,
} as const;

export const I = {
  COAL: 128,
  IRON_INGOT: 129,
  REDSTONE: 130,
  GUNPOWDER: 131,
  TNT: 132,
  BREAD: 133,
  WHEAT_ITEM: 134,
  EMERALD: 135,
  STRONGBOX: 136,
  TREASURE_MAP: 137,
  SWORD: 138,
  // Relics of the old builders (story items with powers of their own).
  GRAPPLE: 139,
  CROSSBOW: 140,
  HORN: 141,
  BREAKER: 142,
  HEARTSTONE: 143,
  // Spoils of the monsters (Minecraft's own).
  PEARL: 144,
  TOTEM: 145,
  NETHER_STAR: 146,
  POTION: 147,
  // A breeze's spoils: thrown, it bursts in a blast of wind that hurls everything away.
  WIND_CHARGE: 148,
  // What the officers' errands are about.
  CACTUS_FRUIT: 149,
  SUN_TABLET: 150,
  MARSH_ROOT: 151,
  FERRY_LANTERN: 152,
  CANNON_PLANS: 153,
  HAWK_TAG: 154,
  STAR_LENS: 155,
  EMBER_ORE: 156,
  VEYRA_NOTE: 157,
  // Each land's metal or stone: what better swords and armour are forged from.
  SUN_AMBER: 158,
  BOG_IRON: 159,
  RUST_IRON: 160,
  FROST_SHARD: 161,
  EMBER_STEEL: 162,
  // The galley and the still.
  STEW: 163,
  POTION_SWIFT: 164,
  POTION_STRENGTH: 165,
  POTION_FIRE: 166,
  POTION_FROST: 167,
} as const;

/** Ids below this are blocks; ids at or above are pure items. */
export const ITEM_BASE = 128;

export type Station = 'none' | 'table' | 'furnace';
/**
 * cube: full block; stairs: half block plus a back step; fence: post with rails;
 * ladder/vine: one quad against a wall; wire: redstone dust on a floor or wall;
 * cross: X-shaped plant sprite; crop: four planes in a # pattern; torch: stick model;
 * lantern: small hanging or standing lamp; chain: thin vertical links;
 * liquid: translucent water; falls: a curtain of falling water; helm: a ship's wheel;
 * pad: a flat leaf floating on the water surface (a lily pad); slab: half a block (meta 1: the
 * upper half); pane: a thin glass panel joining its neighbours; shutter: a slatted board against
 * a wall (meta: the wall's side); wall: a stone post with low walls to its neighbours; banner: a
 * cloth hanging on a wall (meta: the wall's side | colour << 3); planter: a flower box on a wall.
 */
export type Shape = 'cube' | 'stairs' | 'fence' | 'ladder' | 'vine' | 'wire' | 'cross' | 'crop' | 'torch' | 'lantern' | 'chain' | 'liquid' | 'falls' | 'helm' | 'pad' | 'slab' | 'pane' | 'shutter' | 'wall' | 'banner' | 'planter';
/** Colour map applied per position (Minecraft biome tint), baked into vertex colours. */
export type Tint = 'none' | 'grass' | 'foliage' | 'birch' | 'spruce' | 'water';

export interface BlockDef {
  id: number;
  name: string;
  /** Collides with actors. */
  solid: boolean;
  /** Fully hides the faces of its neighbours. */
  opaque: boolean;
  shape: Shape;
  climbable: boolean;
  /** Seconds to break with the builder's pickaxe. Infinity = unbreakable. */
  hardness: number;
  drops: Array<[item: number, min: number, max: number]>;
  /** Hit points when bolted into the fortress (or a giant). */
  hp: number;
  /** Natural ground material (generated terrain, not built). */
  terrain: boolean;
  /** Approximate colour used for particles and the map. */
  color: string;
  /** Texture names: top, sides, bottom, and an optional front face (facing blocks). */
  tiles: { top: string; side: string; bottom: string; front: string | null };
  /** Block light emitted into the world, 0..15 (Minecraft light levels). */
  light: number;
  /** How much light a cell of this block absorbs: 0 transparent .. 15 opaque. */
  lightOpacity: number;
  /** Rays stop on it (mining and building targets). Water and plants are see-through. */
  pickable: boolean;
  /** Building into this cell simply replaces it (plants, water). */
  replaceable: boolean;
  tint: Tint;
  /** Vertex sway: 1 leaves, 2 plants (top vertices). */
  wave: number;
  /** Ambient occlusion caster (full opaque-ish cubes and leaves). */
  occluder: boolean;
}

interface DefOpts extends Partial<Omit<BlockDef, 'id' | 'name' | 'tiles'>> {
  color: string;
  tex: string | [top: string, side: string, bottom?: string, front?: string];
}

function def(id: number, name: string, opts: DefOpts): BlockDef {
  const tex = typeof opts.tex === 'string' ? [opts.tex, opts.tex, opts.tex] : opts.tex;
  const shape = opts.shape ?? 'cube';
  const opaque = opts.opaque ?? shape === 'cube';
  const solid = opts.solid ?? (shape === 'cube' || shape === 'stairs' || shape === 'fence');
  return {
    id,
    name,
    solid,
    opaque,
    shape,
    climbable: opts.climbable ?? false,
    hardness: opts.hardness ?? 0.8,
    drops: opts.drops ?? [[id, 1, 1]],
    hp: opts.hp ?? 6,
    terrain: opts.terrain ?? false,
    color: opts.color,
    tiles: { top: tex[0]!, side: tex[1]!, bottom: tex[2] ?? tex[0]!, front: tex[3] ?? null },
    light: opts.light ?? 0,
    lightOpacity: opts.lightOpacity ?? (opaque ? 15 : 0),
    pickable: opts.pickable ?? true,
    replaceable: opts.replaceable ?? false,
    tint: opts.tint ?? 'none',
    wave: opts.wave ?? 0,
    occluder: opts.occluder ?? (shape === 'cube' && opaque),
  };
}

function plant(id: number, name: string, texName: string, color: string, tint: Tint = 'none'): BlockDef {
  return def(id, name, {
    shape: 'cross', solid: false, opaque: false, hardness: 0, drops: [], hp: 1, color, tex: texName,
    pickable: false, replaceable: true, tint, wave: 2,
  });
}

function leaves(id: number, name: string, texName: string, color: string, tint: Tint): BlockDef {
  return def(id, name, {
    opaque: false, hardness: 0.15, drops: [], hp: 2, color, tex: texName, lightOpacity: 1, tint, wave: 1, occluder: true,
  });
}

export const BLOCKS: BlockDef[] = [];
const blockList: BlockDef[] = [
  def(B.AIR, 'Air', { solid: false, opaque: false, hardness: 0, drops: [], hp: 0, color: '#000000', tex: 'dirt', pickable: false, replaceable: true }),
  def(B.GRASS, 'Grass Block', { hardness: 0.45, drops: [[B.DIRT, 1, 1]], hp: 4, terrain: true, color: '#6a9f3e', tex: ['grass_top', 'grass_side', 'dirt'], tint: 'grass' }),
  def(B.DIRT, 'Dirt', { hardness: 0.4, hp: 4, terrain: true, color: '#86603e', tex: 'dirt' }),
  def(B.STONE, 'Stone', { hardness: 1.0, drops: [[B.COBBLE, 1, 1]], hp: 10, terrain: true, color: '#808080', tex: 'stone' }),
  def(B.COBBLE, 'Cobblestone', { hardness: 1.0, hp: 12, color: '#7a7a7c', tex: 'cobble' }),
  def(B.LOG, 'Oak Log', { hardness: 0.8, hp: 8, color: '#6b5032', tex: ['log_oak_top', 'log_oak'] }),
  leaves(B.LEAVES, 'Oak Leaves', 'leaves_oak', '#3f7f2a', 'foliage'),
  def(B.PLANKS, 'Oak Planks', { hardness: 0.6, hp: 7, color: '#b48a52', tex: 'planks_oak' }),
  def(B.GLASS, 'Glass', { opaque: false, hardness: 0.25, hp: 3, color: '#cfe8f0', tex: 'glass' }),
  def(B.SAND, 'Sand', { hardness: 0.4, hp: 3, terrain: true, color: '#dccf8e', tex: 'sand' }),
  def(B.COAL_ORE, 'Coal Ore', { hardness: 1.2, drops: [[I.COAL, 1, 2]], hp: 10, terrain: true, color: '#444444', tex: 'coal_ore' }),
  def(B.IRON_ORE, 'Iron Ore', { hardness: 1.4, hp: 10, terrain: true, color: '#c8a487', tex: 'iron_ore' }),
  def(B.REDSTONE_ORE, 'Redstone Ore', { hardness: 1.4, drops: [[I.REDSTONE, 2, 4]], hp: 10, terrain: true, color: '#b02020', tex: 'redstone_ore', light: 4 }),
  def(B.BEDROCK, 'Bedrock', { hardness: Infinity, drops: [], hp: 999, terrain: true, color: '#333333', tex: 'bedrock' }),
  def(B.CRAFTING_TABLE, 'Crafting Table', { hardness: 0.6, hp: 6, color: '#8a5a2b', tex: ['crafting_table_top', 'crafting_table_side', 'planks_oak', 'crafting_table_front'] }),
  def(B.FURNACE, 'Furnace', { hardness: 1.2, hp: 12, color: '#6c6c6c', tex: ['furnace_top', 'furnace_side', 'furnace_top', 'furnace_front'], light: 13 }),
  def(B.CHEST, 'Loot Chest', { hardness: 0.5, drops: [], hp: 5, color: '#9a6a2a', tex: ['chest_top', 'chest_side', 'chest_top', 'chest_front'] }),
  def(B.WOOL, 'White Wool', { hardness: 0.35, hp: 4, color: '#e8e8e8', tex: 'wool_white' }),
  def(B.IRON_BLOCK, 'Iron Block', { hardness: 1.6, hp: 30, color: '#d8d8d8', tex: 'iron_block' }),
  def(B.LADDER, 'Ladder', { shape: 'ladder', solid: false, climbable: true, hardness: 0.25, hp: 3, color: '#8a6a3a', tex: 'ladder' }),
  def(B.CANNON, 'TNT Cannon', { hardness: 1.0, hp: 14, color: '#4a4a52', tex: ['cannon_top', 'cannon_side'] }),
  def(B.THRUSTER, 'Windmill Thruster', { hardness: 1.0, hp: 10, color: '#a07a48', tex: ['planks_oak', 'thruster_side'] }),
  def(B.CORE, 'Engine Core', { hardness: Infinity, drops: [], hp: 80, color: '#d02020', tex: 'core', light: 12 }),
  def(B.DISPENSER, 'Watchtower Dispenser', { hardness: 1.2, drops: [[B.CANNON, 1, 1]], hp: 10, color: '#707070', tex: ['furnace_top', 'cobble', 'furnace_top', 'dispenser_front'] }),
  def(B.WINDMILL_HUB, 'Windmill Hub', { hardness: 1.0, drops: [[B.THRUSTER, 1, 1]], hp: 10, color: '#6b4a2a', tex: ['log_oak_top', 'hub_side'] }),
  def(B.MOSSY_COBBLE, 'Mossy Cobblestone', { hardness: 1.0, hp: 13, color: '#5f7a52', tex: 'mossy_cobble' }),
  def(B.GIANT_EYE, 'Giant Eye', { hardness: 0.8, drops: [[I.REDSTONE, 1, 1]], hp: 6, color: '#5f7a52', tex: ['mossy_cobble', 'giant_eye'], light: 7 }),
  def(B.GIANT_HEART, 'Giant Heart', { hardness: 1.6, drops: [[I.REDSTONE, 3, 4]], hp: 22, color: '#a01030', tex: 'giant_heart', light: 10 }),
  def(B.STONE_BRICKS, 'Stone Bricks', { hardness: 1.0, hp: 15, color: '#7a7a7a', tex: 'stone_bricks' }),
  def(B.TNT_BLOCK, 'TNT', { hardness: 0.2, drops: [[I.TNT, 2, 2]], hp: 2, color: '#d23a26', tex: ['tnt_top', 'tnt_side', 'tnt_bottom'] }),
  def(B.HAY, 'Hay Bale', { hardness: 0.3, drops: [[I.WHEAT_ITEM, 4, 6]], hp: 3, color: '#c9a83a', tex: ['hay_top', 'hay_side'] }),
  def(B.WIRE, 'Redstone Wire', { shape: 'wire', solid: false, hardness: 0.1, hp: 2, color: '#c42020', tex: 'redstone_wire' }),
  plant(B.TALL_GRASS, 'Grass', 'tall_grass', '#5d9c3a', 'grass'),
  plant(B.POPPY, 'Poppy', 'poppy', '#d42a1a'),
  plant(B.DANDELION, 'Dandelion', 'dandelion', '#f2d83a'),
  plant(B.CORNFLOWER, 'Cornflower', 'cornflower', '#4a6ae0'),
  plant(B.OXEYE, 'Oxeye Daisy', 'oxeye', '#f0f0e8'),
  def(B.TORCH, 'Torch', { shape: 'torch', solid: false, opaque: false, hardness: 0.05, hp: 2, color: '#ffc040', tex: 'torch', light: 14 }),
  def(B.WATER, 'Water', {
    shape: 'liquid', solid: false, opaque: false, hardness: Infinity, drops: [], hp: 0, color: '#3f76e4', tex: 'water_still',
    lightOpacity: 2, pickable: false, replaceable: true, tint: 'water',
  }),
  def(B.PATH, 'Dirt Path', { hardness: 0.4, drops: [[B.DIRT, 1, 1]], hp: 4, terrain: true, color: '#94783e', tex: ['path_top', 'path_side', 'dirt'] }),
  def(B.GRAVEL, 'Gravel', { hardness: 0.5, hp: 4, terrain: true, color: '#837f7e', tex: 'gravel' }),
  def(B.SNOW, 'Snow', { hardness: 0.3, hp: 3, terrain: true, color: '#f0f6f6', tex: 'snow' }),
  def(B.LANTERN, 'Lantern', { shape: 'lantern', solid: false, opaque: false, hardness: 0.2, hp: 3, color: '#ffb040', tex: 'lantern', light: 15 }),
  def(B.CHAIN, 'Chain', { shape: 'chain', solid: false, opaque: false, hardness: 0.2, hp: 3, color: '#3a3e48', tex: 'chain' }),
  def(B.FENCE, 'Oak Fence', { shape: 'fence', opaque: false, hardness: 0.5, hp: 5, color: '#a07a48', tex: 'planks_oak' }),
  def(B.OAK_STAIRS, 'Oak Stairs', { shape: 'stairs', opaque: false, hardness: 0.6, hp: 7, color: '#b08850', tex: 'planks_oak', lightOpacity: 15, occluder: true }),
  def(B.COBBLE_STAIRS, 'Cobblestone Stairs', { shape: 'stairs', opaque: false, hardness: 1.0, hp: 12, color: '#77777a', tex: 'cobble', lightOpacity: 15, occluder: true }),
  def(B.SPRUCE_STAIRS, 'Spruce Stairs', { shape: 'stairs', opaque: false, hardness: 0.6, hp: 7, color: '#6b4a2c', tex: 'planks_spruce', lightOpacity: 15, occluder: true }),
  def(B.VINE, 'Vines', { shape: 'vine', solid: false, opaque: false, climbable: true, hardness: 0.1, drops: [], hp: 1, color: '#3d7a2a', tex: 'vine', tint: 'foliage', pickable: true, replaceable: true, wave: 1 }),
  def(B.FARMLAND, 'Farmland', { hardness: 0.4, drops: [[B.DIRT, 1, 1]], hp: 4, terrain: true, color: '#5a3d24', tex: ['farmland', 'dirt'] }),
  def(B.WHEAT, 'Wheat', { shape: 'crop', solid: false, opaque: false, hardness: 0, drops: [[I.WHEAT_ITEM, 1, 2]], hp: 1, color: '#d8b44a', tex: 'wheat', pickable: true, replaceable: true, wave: 2 }),
  def(B.BIRCH_LOG, 'Birch Log', { hardness: 0.8, hp: 8, color: '#d8d4c8', tex: ['log_birch_top', 'log_birch'] }),
  leaves(B.BIRCH_LEAVES, 'Birch Leaves', 'leaves_birch', '#80a755', 'birch'),
  def(B.SPRUCE_LOG, 'Spruce Log', { hardness: 0.8, hp: 8, color: '#4a3420', tex: ['log_spruce_top', 'log_spruce'] }),
  leaves(B.SPRUCE_LEAVES, 'Spruce Leaves', 'leaves_spruce', '#2e5a32', 'spruce'),
  def(B.SPRUCE_PLANKS, 'Spruce Planks', { hardness: 0.6, hp: 7, color: '#73522f', tex: 'planks_spruce' }),
  def(B.GEARBOX, 'Gearbox', { hardness: 1.2, hp: 16, color: '#9a7a3a', tex: ['gearbox_top', 'gearbox'] }),
  def(B.PISTON, 'Piston', { hardness: 1.0, hp: 12, color: '#8a7a5a', tex: ['piston_top', 'piston_side', 'piston_bottom'] }),
  def(B.REDSTONE_TORCH, 'Redstone Torch', { shape: 'torch', solid: false, opaque: false, hardness: 0.05, hp: 2, color: '#ff3020', tex: 'redstone_torch', light: 7 }),
  def(B.REDSTONE_LAMP, 'Redstone Lamp', { hardness: 0.5, hp: 5, color: '#e8a050', tex: 'redstone_lamp', light: 15 }),
  def(B.SMOOTH_STONE, 'Smooth Stone', { hardness: 1.1, hp: 16, color: '#a0a0a0', tex: ['smooth_stone', 'smooth_stone_side'] }),
  def(B.FALLING_WATER, 'Waterfall', {
    shape: 'falls', solid: false, opaque: false, hardness: Infinity, drops: [], hp: 0, color: '#7aa8f0', tex: 'water_flow',
    lightOpacity: 1, pickable: false, replaceable: true, tint: 'water',
  }),
  def(B.BRICKS, 'Bricks', { hardness: 1.0, hp: 14, color: '#94503e', tex: 'bricks' }),
  def(B.MOSSY_STONE_BRICKS, 'Mossy Stone Bricks', { hardness: 1.0, hp: 15, color: '#6a7a5a', tex: 'mossy_stone_bricks' }),
  def(B.CRACKED_STONE_BRICKS, 'Cracked Stone Bricks', { hardness: 1.0, hp: 12, color: '#727272', tex: 'cracked_stone_bricks' }),
  def(B.OBSIDIAN, 'Obsidian', { hardness: 4.0, hp: 60, color: '#1a1028', tex: 'obsidian' }),
  def(B.ANDESITE, 'Andesite', { hardness: 1.0, drops: [[B.COBBLE, 1, 1]], hp: 10, terrain: true, color: '#888a88', tex: 'andesite' }),
  def(B.GRANITE, 'Granite', { hardness: 1.0, drops: [[B.COBBLE, 1, 1]], hp: 10, terrain: true, color: '#9a6a58', tex: 'granite' }),
  def(B.HELM, 'Helm', { shape: 'helm', solid: false, opaque: false, hardness: Infinity, drops: [], hp: 20, color: '#8a5a2b', tex: 'planks_spruce' }),
  def(B.GLOWSTONE, 'Glowstone', { hardness: 0.3, hp: 4, color: '#f0c060', tex: 'glowstone', light: 15 }),
  def(B.CITADEL_HEART, 'Citadel Heart', { hardness: 6, drops: [], hp: 160, color: '#40ff60', tex: 'citadel_heart', light: 15 }),
  def(B.RED_WOOL, 'Red Wool', { hardness: 0.35, hp: 4, color: '#a02020', tex: 'wool_red' }),
  def(B.BOOKSHELF, 'Bookshelf', { hardness: 0.6, drops: [[B.PLANKS, 2, 3]], hp: 6, color: '#7a5a3a', tex: ['planks_oak', 'bookshelf'] }),
  def(B.BARREL, 'Barrel', { hardness: 0.6, hp: 7, color: '#8a6038', tex: ['barrel_top', 'barrel_side', 'barrel_bottom'] }),
  def(B.SUGAR_CANE, 'Sugar Cane', { shape: 'cross', solid: false, opaque: false, hardness: 0, drops: [], hp: 1, color: '#80c060', tex: 'sugar_cane', pickable: false, replaceable: true, tint: 'grass', wave: 2 }),
  plant(B.FERN, 'Fern', 'fern', '#4a8a30', 'grass'),
  def(B.BALLISTA, 'Ballista', { hardness: 0.9, hp: 12, color: '#8a6a40', tex: ['ballista_top', 'ballista_side'] }),
  def(B.MORTAR, 'Mortar', { hardness: 1.2, hp: 18, color: '#4a4c54', tex: ['mortar_top', 'mortar_side'] }),
  def(B.COBWEB, 'Cobweb', { shape: 'cross', solid: false, opaque: false, hardness: 0.35, drops: [], hp: 1, color: '#e8e8e8', tex: 'cobweb', pickable: true, replaceable: false }),
  def(B.SPAWNER, 'Monster Spawner', { opaque: false, hardness: 2.2, drops: [], hp: 20, color: '#2a3440', tex: 'spawner', light: 6, lightOpacity: 2, occluder: false }),
  def(B.SANDSTONE, 'Sandstone', { hardness: 0.9, hp: 9, terrain: true, color: '#d8c890', tex: ['sandstone_top', 'sandstone_side', 'sandstone_bottom'] }),
  def(B.CUT_SANDSTONE, 'Cut Sandstone', { hardness: 0.9, hp: 10, color: '#dccd94', tex: ['sandstone_top', 'cut_sandstone', 'sandstone_bottom'] }),
  def(B.TERRACOTTA, 'Terracotta', { hardness: 1.0, hp: 10, terrain: true, color: '#a0603e', tex: 'terracotta' }),
  def(B.CACTUS, 'Cactus', { hardness: 0.3, drops: [[I.CACTUS_FRUIT, 1, 1]], hp: 3, color: '#4a8a3a', tex: ['cactus_top', 'cactus_side', 'cactus_bottom'] }),
  def(B.DEAD_BUSH, 'Dead Bush', { shape: 'cross', solid: false, opaque: false, hardness: 0, drops: [], hp: 1, color: '#8a6a3a', tex: 'dead_bush', pickable: false, replaceable: true, wave: 2 }),
  def(B.GRASS_SNOW, 'Snowy Grass', { hardness: 0.45, drops: [[B.DIRT, 1, 1]], hp: 4, terrain: true, color: '#e8f0f4', tex: ['snow', 'grass_snow_side', 'dirt'] }),
  def(B.ICE, 'Ice', { hardness: 0.4, drops: [], hp: 3, terrain: true, color: '#a8c8f0', tex: 'ice' }),
  def(B.BLIGHT_GRASS, 'Blighted Grass', { hardness: 0.45, drops: [[B.DIRT, 1, 1]], hp: 4, terrain: true, color: '#5a4a6a', tex: ['blight_grass_top', 'blight_grass_side', 'dirt'] }),
  def(B.BLIGHT_MOSS, 'Blight Moss', { hardness: 0.5, drops: [[B.DIRT, 1, 1]], hp: 4, terrain: true, color: '#4a5a3a', tex: 'blight_moss' }),
  def(B.LAVA, 'Lava', { solid: false, hardness: Infinity, drops: [], hp: 0, color: '#ff7020', tex: 'lava_still', light: 15, pickable: false, replaceable: true, occluder: false }),
  def(B.EMERALD_ORE, 'Emerald Ore', { hardness: 1.6, drops: [[I.EMERALD, 1, 2]], hp: 10, terrain: true, color: '#3a9a5a', tex: 'emerald_ore' }),
  def(B.RAIL, 'Rail', { shape: 'wire', solid: false, hardness: 0.2, drops: [[I.IRON_INGOT, 0, 1]], hp: 2, color: '#8a7a6a', tex: 'rail' }),
  def(B.BEACON, 'Beacon', { opaque: false, hardness: Infinity, drops: [], hp: 60, color: '#bff4ff', tex: ['beacon_top', 'beacon_side'], light: 15, lightOpacity: 1, occluder: false }),
  def(B.MUD, 'Mud', { hardness: 0.45, drops: [[B.DIRT, 1, 1]], hp: 4, terrain: true, color: '#4a3e36', tex: 'mud' }),
  def(B.MUD_BRICKS, 'Mud Bricks', { hardness: 0.9, hp: 11, color: '#8a6a52', tex: 'mud_bricks' }),
  def(B.LILY_PAD, 'Lily Pad', { shape: 'pad', solid: false, opaque: false, hardness: 0, drops: [], hp: 1, color: '#2f7a2a', tex: 'lily_pad', pickable: false, replaceable: true, tint: 'foliage' }),
  plant(B.RED_MUSHROOM, 'Red Mushroom', 'red_mushroom', '#c42a22'),
  plant(B.BROWN_MUSHROOM, 'Brown Mushroom', 'brown_mushroom', '#8a6a4a'),
  def(B.RED_SAND, 'Red Sand', { hardness: 0.4, hp: 3, terrain: true, color: '#b8642e', tex: 'red_sand' }),
  def(B.RED_SANDSTONE, 'Red Sandstone', { hardness: 0.9, hp: 9, terrain: true, color: '#b05a28', tex: ['red_sandstone_top', 'red_sandstone_side', 'red_sandstone_top'] }),
  def(B.ORANGE_TERRACOTTA, 'Orange Terracotta', { hardness: 1.0, hp: 10, terrain: true, color: '#a2531c', tex: 'terracotta_orange' }),
  def(B.YELLOW_TERRACOTTA, 'Yellow Terracotta', { hardness: 1.0, hp: 10, terrain: true, color: '#b88524', tex: 'terracotta_yellow' }),
  def(B.WHITE_TERRACOTTA, 'White Terracotta', { hardness: 1.0, hp: 10, terrain: true, color: '#cfae9e', tex: 'terracotta_white' }),
  def(B.BROWN_TERRACOTTA, 'Brown Terracotta', { hardness: 1.0, hp: 10, terrain: true, color: '#4e3324', tex: 'terracotta_brown' }),
  def(B.BASALT, 'Basalt', { hardness: 1.1, hp: 12, terrain: true, color: '#4a4a50', tex: ['basalt_top', 'basalt_side'] }),
  def(B.BLACKSTONE, 'Blackstone', { hardness: 1.1, hp: 13, terrain: true, color: '#2c2630', tex: 'blackstone' }),
  def(B.MAGMA, 'Magma Block', { hardness: 0.9, hp: 9, terrain: true, color: '#c4501c', tex: 'magma', light: 4 }),
  def(B.ASH, 'Ash', { hardness: 0.4, hp: 3, terrain: true, color: '#6e6a6a', tex: 'ash' }),
  def(B.CHARRED_LOG, 'Charred Log', { hardness: 0.8, drops: [[I.COAL, 1, 1]], hp: 7, color: '#2a2220', tex: ['charred_log_top', 'charred_log'] }),
  def(B.SEAL_CRYSTAL, 'Seal Crystal', { opaque: false, hardness: Infinity, drops: [], hp: 999, color: '#4cff8a', tex: 'seal_crystal', lightOpacity: 0, occluder: false }),
  def(B.PACKED_ICE, 'Packed Ice', { hardness: 0.6, drops: [], hp: 6, terrain: true, color: '#8eb4ee', tex: 'packed_ice' }),
  def(B.BLUE_ICE, 'Blue Ice', { hardness: 0.7, drops: [], hp: 8, terrain: true, color: '#6c9ef0', tex: 'blue_ice' }),
  def(B.NETHER_BRICKS, 'Nether Bricks', { hardness: 1.1, hp: 15, color: '#3c1a20', tex: 'nether_bricks' }),
  def(B.COARSE_DIRT, 'Coarse Dirt', { hardness: 0.45, drops: [[B.DIRT, 1, 1]], hp: 4, terrain: true, color: '#7a5a3c', tex: 'coarse_dirt' }),
  leaves(B.SWAMP_LEAVES, 'Swamp Leaves', 'leaves_swamp', '#3a5a22', 'foliage'),
  def(B.REEDS, 'Reeds', { shape: 'cross', solid: false, opaque: false, hardness: 0, drops: [], hp: 1, color: '#6a8a3a', tex: 'reeds', pickable: false, replaceable: true, wave: 2 }),
  def(B.OAK_SLAB, 'Oak Slab', { shape: 'slab', solid: true, hardness: 0.5, drops: [[B.PLANKS, 1, 1]], hp: 6, color: '#b08850', tex: 'planks_oak', lightOpacity: 15 }),
  def(B.SPRUCE_SLAB, 'Spruce Slab', { shape: 'slab', solid: true, hardness: 0.5, drops: [[B.SPRUCE_PLANKS, 1, 1]], hp: 6, color: '#6b4a2c', tex: 'planks_spruce', lightOpacity: 15 }),
  def(B.BRICK_SLAB, 'Stone Brick Slab', { shape: 'slab', solid: true, hardness: 1.0, drops: [[B.STONE_BRICKS, 1, 1]], hp: 12, color: '#7a7a7a', tex: 'stone_bricks', lightOpacity: 15 }),
  def(B.GLASS_PANE, 'Glass Pane', { shape: 'pane', solid: true, hardness: 0.2, drops: [], hp: 3, color: '#c8dce4', tex: 'glass', lightOpacity: 0 }),
  def(B.SHUTTER, 'Shutter', { shape: 'shutter', solid: false, hardness: 0.3, drops: [[B.SPRUCE_PLANKS, 1, 1]], hp: 4, color: '#5a3e22', tex: 'shutter', lightOpacity: 0 }),
  def(B.COBBLE_WALL, 'Cobblestone Wall', { shape: 'wall', solid: true, hardness: 1.0, drops: [[B.COBBLE, 1, 1]], hp: 12, color: '#77777a', tex: 'cobble', lightOpacity: 0 }),
  def(B.BANNER, 'Banner', { shape: 'banner', solid: false, hardness: 0.2, drops: [], hp: 2, color: '#b02a2a', tex: 'banner_red', lightOpacity: 0 }),
  def(B.PLANTER, 'Flower Box', { shape: 'planter', solid: false, hardness: 0.2, drops: [], hp: 2, color: '#5a8a3a', tex: ['dirt', 'planks_spruce'], lightOpacity: 0 }),
  def(B.CAULDRON, 'Witch\'s Cauldron', { hardness: 1.4, drops: [[I.IRON_INGOT, 1, 2]], hp: 14, color: '#3a3a40', tex: ['cauldron_top', 'cauldron_side', 'cauldron_side'], light: 9 }),
  def(B.GOLD_BLOCK, 'Block of Gold', { hardness: 1.2, drops: [[I.EMERALD, 1, 2]], hp: 16, color: '#f0c83a', tex: 'gold_block' }),
  def(B.ANVIL, 'The Builders\' Anvil', { hardness: Infinity, drops: [], hp: 999, color: '#3c3c44', tex: ['anvil_top', 'anvil_side', 'anvil_side'] }),
];
for (const block of blockList) BLOCKS[block.id] = block;
for (let id = 0; id < ITEM_BASE; id += 1) if (!BLOCKS[id]) BLOCKS[id] = BLOCKS[0]!;

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[0]!;
}

/** Blocks the generator writes as natural ground or vegetation (not part of buildings). */
export function isNatural(id: number): boolean {
  const def = blockDef(id);
  return def.terrain || def.shape === 'cross' || def.shape === 'pad' || id === B.LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES || id === B.SWAMP_LEAVES || id === B.WATER || id === B.FALLING_WATER;
}

export interface ItemDef {
  id: number;
  name: string;
  /** Texture key for the icon. */
  icon: string;
  /** Block placed by this item, or null for materials. */
  place: number | null;
  short: string;
  /** Hunger points restored when eaten (food only). */
  food: number;
}

export const ITEMS = new Map<number, ItemDef>();

function item(id: number, name: string, icon: string, place: number | null, short = name, food = 0): void {
  ITEMS.set(id, { id, name, icon, place, short, food });
}

item(B.DIRT, 'Dirt', 'dirt', B.DIRT);
item(B.COBBLE, 'Cobblestone', 'cobble', B.COBBLE, 'Cobble');
item(B.LOG, 'Oak Log', 'log_oak', B.LOG, 'Log');
item(B.PLANKS, 'Oak Planks', 'planks_oak', B.PLANKS, 'Planks');
item(B.GLASS, 'Glass', 'glass', B.GLASS);
item(B.SAND, 'Sand', 'sand', B.SAND);
item(B.IRON_ORE, 'Iron Ore', 'iron_ore', null);
item(B.CRAFTING_TABLE, 'Crafting Table', 'crafting_table_front', B.CRAFTING_TABLE, 'Table');
item(B.FURNACE, 'Furnace', 'furnace_front', B.FURNACE);
item(B.WOOL, 'White Wool', 'wool_white', B.WOOL, 'Wool');
item(B.IRON_BLOCK, 'Iron Block', 'iron_block', B.IRON_BLOCK, 'Iron Blk');
item(B.LADDER, 'Ladder', 'ladder', B.LADDER);
item(B.CANNON, 'TNT Cannon', 'cannon_item', B.CANNON, 'Cannon');
item(B.THRUSTER, 'Windmill Thruster', 'thruster_item', B.THRUSTER, 'Thruster');
item(B.MOSSY_COBBLE, 'Mossy Cobblestone', 'mossy_cobble', B.MOSSY_COBBLE, 'Mossy');
item(B.STONE_BRICKS, 'Stone Bricks', 'stone_bricks', B.STONE_BRICKS, 'Bricks');
item(B.HAY, 'Hay Bale', 'hay_side', B.HAY, 'Hay');
item(B.WIRE, 'Redstone Wire', 'wire_item', B.WIRE, 'Wire');
item(B.TORCH, 'Torch', 'torch', B.TORCH);
item(B.GRAVEL, 'Gravel', 'gravel', B.GRAVEL);
item(B.SNOW, 'Snow Block', 'snow', B.SNOW, 'Snow');
item(B.LANTERN, 'Lantern', 'lantern_item', B.LANTERN);
item(B.CHAIN, 'Chain', 'chain_item', B.CHAIN);
item(B.FENCE, 'Oak Fence', 'fence_item', B.FENCE, 'Fence');
item(B.OAK_STAIRS, 'Oak Stairs', 'planks_oak', B.OAK_STAIRS, 'Stairs');
item(B.COBBLE_STAIRS, 'Cobblestone Stairs', 'cobble', B.COBBLE_STAIRS, 'C.Stairs');
item(B.SPRUCE_STAIRS, 'Spruce Stairs', 'planks_spruce', B.SPRUCE_STAIRS, 'S.Stairs');
item(B.BIRCH_LOG, 'Birch Log', 'log_birch', B.BIRCH_LOG, 'Birch');
item(B.SPRUCE_LOG, 'Spruce Log', 'log_spruce', B.SPRUCE_LOG, 'Spruce');
item(B.SPRUCE_PLANKS, 'Spruce Planks', 'planks_spruce', B.SPRUCE_PLANKS, 'S.Planks');
item(B.GEARBOX, 'Gearbox', 'gearbox', B.GEARBOX);
item(B.PISTON, 'Piston', 'piston_side', B.PISTON);
item(B.REDSTONE_TORCH, 'Redstone Torch', 'redstone_torch', B.REDSTONE_TORCH, 'R.Torch');
item(B.REDSTONE_LAMP, 'Redstone Lamp', 'redstone_lamp', B.REDSTONE_LAMP, 'Lamp');
item(B.SMOOTH_STONE, 'Smooth Stone', 'smooth_stone', B.SMOOTH_STONE, 'Smooth');
item(B.BRICKS, 'Bricks', 'bricks', B.BRICKS, 'Bricks');
item(B.MOSSY_STONE_BRICKS, 'Mossy Stone Bricks', 'mossy_stone_bricks', B.MOSSY_STONE_BRICKS, 'M.Bricks');
item(B.CRACKED_STONE_BRICKS, 'Cracked Stone Bricks', 'cracked_stone_bricks', B.CRACKED_STONE_BRICKS, 'C.Bricks');
item(B.OBSIDIAN, 'Obsidian', 'obsidian', B.OBSIDIAN);
item(B.GLOWSTONE, 'Glowstone', 'glowstone', B.GLOWSTONE);
item(B.RED_WOOL, 'Red Wool', 'wool_red', B.RED_WOOL, 'R.Wool');
item(B.BARREL, 'Barrel', 'barrel_side', B.BARREL);
item(B.BALLISTA, 'Ballista', 'bolt_item', B.BALLISTA);
item(B.MORTAR, 'Mortar', 'shell_item', B.MORTAR);
item(I.COAL, 'Coal', 'coal', null);
item(I.IRON_INGOT, 'Iron Ingot', 'iron_ingot', null, 'Iron');
item(I.REDSTONE, 'Redstone Dust', 'redstone_dust', null, 'Redstone');
item(I.GUNPOWDER, 'Gunpowder', 'gunpowder', null, 'Powder');
item(I.TNT, 'TNT', 'tnt_side', null);
item(I.BREAD, 'Bread', 'bread', null, 'Bread', 5);
item(I.WHEAT_ITEM, 'Wheat', 'wheat_item', null);
item(I.EMERALD, 'Emerald', 'emerald', null);
item(I.STRONGBOX, 'Village Strongbox', 'chest_front', null, 'Strongbox');
item(I.TREASURE_MAP, 'Treasure Map', 'treasure_map', null, 'Map');
item(I.SWORD, 'Iron Sword', 'ui_sword', null, 'Sword');
item(I.GRAPPLE, 'Builders\' Grapple', 'grapple_item', null, 'Grapple');
item(I.CROSSBOW, 'Millford Crossbow', 'crossbow_item', null, 'Crossbow');
item(I.HORN, 'War Horn', 'horn_item', null, 'Horn');
item(I.BREAKER, 'Heartbreaker', 'breaker_item', null, 'Breaker');
item(I.HEARTSTONE, 'Heartstone', 'heartstone_item', null, 'Heartstone');
item(I.PEARL, 'Ender Pearl', 'pearl_item', null, 'Pearl');
item(I.TOTEM, 'Totem of Undying', 'totem_item', null, 'Totem');
item(I.NETHER_STAR, 'Nether Star', 'netherstar_item', null, 'Star');
item(I.POTION, 'Potion of Healing', 'potion_item', null, 'Potion');
item(B.SANDSTONE, 'Sandstone', 'sandstone_side', B.SANDSTONE);
item(B.CUT_SANDSTONE, 'Cut Sandstone', 'cut_sandstone', B.CUT_SANDSTONE, 'C.Sand');
item(B.TERRACOTTA, 'Terracotta', 'terracotta', B.TERRACOTTA, 'Terra');
item(B.MUD_BRICKS, 'Mud Bricks', 'mud_bricks', B.MUD_BRICKS, 'M.Bricks');
item(B.RED_SAND, 'Red Sand', 'red_sand', B.RED_SAND, 'R.Sand');
item(B.RED_SANDSTONE, 'Red Sandstone', 'red_sandstone_side', B.RED_SANDSTONE, 'R.Sand.');
item(B.ORANGE_TERRACOTTA, 'Orange Terracotta', 'terracotta_orange', B.ORANGE_TERRACOTTA, 'O.Terra');
item(B.YELLOW_TERRACOTTA, 'Yellow Terracotta', 'terracotta_yellow', B.YELLOW_TERRACOTTA, 'Y.Terra');
item(B.WHITE_TERRACOTTA, 'White Terracotta', 'terracotta_white', B.WHITE_TERRACOTTA, 'W.Terra');
item(B.BROWN_TERRACOTTA, 'Brown Terracotta', 'terracotta_brown', B.BROWN_TERRACOTTA, 'B.Terra');
item(B.BASALT, 'Basalt', 'basalt_side', B.BASALT);
item(B.BLACKSTONE, 'Blackstone', 'blackstone', B.BLACKSTONE, 'Blackst.');
item(B.MAGMA, 'Magma Block', 'magma', B.MAGMA, 'Magma');
item(B.CHARRED_LOG, 'Charred Log', 'charred_log', B.CHARRED_LOG, 'Charred');
item(B.PACKED_ICE, 'Packed Ice', 'packed_ice', B.PACKED_ICE, 'P.Ice');
item(B.NETHER_BRICKS, 'Nether Bricks', 'nether_bricks', B.NETHER_BRICKS, 'N.Bricks');
item(I.WIND_CHARGE, 'Wind Charge', 'wind_charge_item', null, 'Wind');
item(I.CACTUS_FRUIT, 'Cactus Fruit', 'cactus_fruit_item', null, 'Fruit', 2);
item(I.SUN_TABLET, 'Sun Tablet', 'sun_tablet_item', null, 'Tablet');
item(I.MARSH_ROOT, 'Marsh Root', 'marsh_root_item', null, 'Root');
item(I.FERRY_LANTERN, 'Gil\'s Ferry Lantern', 'ferry_lantern_item', null, 'Lantern');
item(I.CANNON_PLANS, 'Rustmane\'s Cannon Plans', 'cannon_plans_item', null, 'Plans');
item(I.HAWK_TAG, 'Red Hawk Crew Tag', 'hawk_tag_item', null, 'Tag');
item(I.STAR_LENS, 'Lens of the Great Glass', 'star_lens_item', null, 'Lens');
item(I.EMBER_ORE, 'Ember Ore', 'ember_ore_item', null, 'Ember Ore');
item(I.VEYRA_NOTE, 'Veyra\'s Note', 'veyra_note_item', null, 'Note');
item(I.SUN_AMBER, 'Sun Amber', 'sun_amber_item', null, 'Amber');
item(I.BOG_IRON, 'Bog Iron', 'bog_iron_item', null, 'Bog Iron');
item(I.RUST_IRON, 'Rust Iron', 'rust_iron_item', null, 'Rust Iron');
item(I.FROST_SHARD, 'Frost Shard', 'frost_shard_item', null, 'Shard');
item(I.EMBER_STEEL, 'Ember Steel', 'ember_steel_item', null, 'E.Steel');
item(I.STEW, 'Hearty Stew', 'stew_item', null, 'Stew', 10);
item(I.POTION_SWIFT, 'Potion of Swiftness', 'potion_swift_item', null, 'Swift');
item(I.POTION_STRENGTH, 'Potion of Strength', 'potion_strength_item', null, 'Strength');
item(I.POTION_FIRE, 'Fire Ward Potion', 'potion_fire_item', null, 'Fire Ward');
item(I.POTION_FROST, 'Frost Ward Potion', 'potion_frost_item', null, 'Frost Ward');

export function itemDef(id: number): ItemDef {
  return ITEMS.get(id) ?? { id, name: `Item ${id}`, icon: 'dirt', place: null, short: '?', food: 0 };
}

/** Hotbar ordering: most useful construction parts first. */
export const HOTBAR_PRIORITY: number[] = [
  I.SWORD,
  I.CROSSBOW,
  I.GRAPPLE,
  I.PEARL,
  I.WIND_CHARGE,
  I.TNT,
  I.NETHER_STAR,
  I.HEARTSTONE,
  I.BREAKER,
  I.POTION,
  I.POTION_SWIFT,
  I.POTION_STRENGTH,
  I.POTION_FIRE,
  I.POTION_FROST,
  I.TOTEM,
  I.TREASURE_MAP,
  B.CANNON,
  B.BALLISTA,
  B.MORTAR,
  B.THRUSTER,
  B.WIRE,
  I.STEW,
  I.BREAD,
  B.LANTERN,
  B.TORCH,
  B.PLANKS,
  B.COBBLE,
  B.IRON_BLOCK,
  B.LADDER,
  B.FENCE,
  B.STONE_BRICKS,
  B.SMOOTH_STONE,
  B.GEARBOX,
  B.MOSSY_COBBLE,
  B.GLASS,
  B.LOG,
  B.SPRUCE_PLANKS,
  B.OAK_STAIRS,
  B.WOOL,
  B.RED_WOOL,
  B.DIRT,
  B.SAND,
  B.GRAVEL,
  B.SNOW,
  B.HAY,
  B.CRAFTING_TABLE,
  B.FURNACE,
  B.BARREL,
  B.REDSTONE_LAMP,
  B.REDSTONE_TORCH,
  B.CHAIN,
  B.PISTON,
  B.BRICKS,
  B.BIRCH_LOG,
  B.SPRUCE_LOG,
];

export interface Recipe {
  id: string;
  out: number;
  count: number;
  inputs: Array<[item: number, count: number]>;
  station: Station;
  hint: string;
  /** Known only once this officer is aboard. */
  officer?: string;
}

export const RECIPES: Recipe[] = [
  { id: 'planks', out: B.PLANKS, count: 4, inputs: [[B.LOG, 1]], station: 'none', hint: 'Split logs into planks' },
  { id: 'planks_spruce', out: B.SPRUCE_PLANKS, count: 4, inputs: [[B.SPRUCE_LOG, 1]], station: 'none', hint: 'Dark planks' },
  { id: 'planks_birch', out: B.PLANKS, count: 4, inputs: [[B.BIRCH_LOG, 1]], station: 'none', hint: 'Birch logs make planks too' },
  { id: 'torch', out: B.TORCH, count: 4, inputs: [[I.COAL, 1], [B.PLANKS, 1]], station: 'none', hint: 'Light up your walls at night' },
  { id: 'bread', out: I.BREAD, count: 1, inputs: [[I.WHEAT_ITEM, 3]], station: 'none', hint: 'Food: restores hunger' },
  { id: 'table', out: B.CRAFTING_TABLE, count: 1, inputs: [[B.PLANKS, 4]], station: 'none', hint: 'A workshop for your fortress' },
  { id: 'tnt', out: I.TNT, count: 2, inputs: [[I.GUNPOWDER, 1], [B.SAND, 1]], station: 'table', hint: 'Cannon ammunition' },
  { id: 'wire', out: B.WIRE, count: 4, inputs: [[I.REDSTONE, 1]], station: 'table', hint: 'Carries power from the Core' },
  { id: 'lantern', out: B.LANTERN, count: 2, inputs: [[I.IRON_INGOT, 1], [B.TORCH, 1]], station: 'table', hint: 'Bright light for the deck' },
  { id: 'ladder', out: B.LADDER, count: 3, inputs: [[B.PLANKS, 3]], station: 'table', hint: 'Climb your walls' },
  { id: 'fence', out: B.FENCE, count: 3, inputs: [[B.PLANKS, 2]], station: 'table', hint: 'Deck railings' },
  { id: 'cannon', out: B.CANNON, count: 1, inputs: [[B.COBBLE, 4], [I.IRON_INGOT, 2], [I.REDSTONE, 1]], station: 'table', hint: 'Powered turret: load TNT and fire' },
  { id: 'ballista', out: B.BALLISTA, count: 1, inputs: [[B.PLANKS, 4], [B.FENCE, 2], [I.IRON_INGOT, 1]], station: 'table', hint: 'Fast bolt turret: no ammo, hits fliers and climbers' },
  { id: 'mortar', out: B.MORTAR, count: 1, inputs: [[I.IRON_INGOT, 3], [B.COBBLE, 4], [I.REDSTONE, 1]], station: 'table', hint: 'Powered: lobs TNT shells far over walls' },
  { id: 'thruster', out: B.THRUSTER, count: 1, inputs: [[B.WOOL, 3], [I.IRON_INGOT, 1], [I.REDSTONE, 1]], station: 'table', hint: 'Powered: march faster' },
  { id: 'gearbox', out: B.GEARBOX, count: 1, inputs: [[I.IRON_INGOT, 2], [B.PLANKS, 2]], station: 'table', hint: 'Armoured machinery plating' },
  { id: 'ironblock', out: B.IRON_BLOCK, count: 1, inputs: [[I.IRON_INGOT, 3]], station: 'table', hint: 'Heavy armour plating' },
  { id: 'furnace', out: B.FURNACE, count: 1, inputs: [[B.COBBLE, 8]], station: 'table', hint: 'Smelts ore and sand' },
  { id: 'lamp', out: B.REDSTONE_LAMP, count: 1, inputs: [[I.REDSTONE, 2], [B.GLASS, 1]], station: 'table', hint: 'A glowing deck lamp' },
  { id: 'ingot', out: I.IRON_INGOT, count: 1, inputs: [[B.IRON_ORE, 1], [I.COAL, 1]], station: 'furnace', hint: 'Smelt iron ore' },
  { id: 'glass', out: B.GLASS, count: 2, inputs: [[B.SAND, 2], [I.COAL, 1]], station: 'furnace', hint: 'Smelt sand' },
  { id: 'bricks', out: B.STONE_BRICKS, count: 4, inputs: [[B.COBBLE, 4], [I.COAL, 1]], station: 'furnace', hint: 'Tough masonry' },
  { id: 'smooth', out: B.SMOOTH_STONE, count: 2, inputs: [[B.COBBLE, 2], [I.COAL, 1]], station: 'furnace', hint: 'Polished hull plating' },
  { id: 'cutsand', out: B.CUT_SANDSTONE, count: 4, inputs: [[B.SANDSTONE, 4]], station: 'table', hint: 'Desert masonry' },
  { id: 'mudbricks', out: B.MUD_BRICKS, count: 4, inputs: [[B.DIRT, 4], [I.WHEAT_ITEM, 1]], station: 'table', hint: 'Swamp masonry: dried mud and straw' },
  { id: 'netherbricks', out: B.NETHER_BRICKS, count: 4, inputs: [[B.BLACKSTONE, 4], [I.COAL, 1]], station: 'furnace', hint: 'Fire-proof plating from the ember wastes' },
  { id: 'stew', out: I.STEW, count: 2, inputs: [[I.BREAD, 1], [I.CACTUS_FRUIT, 1]], station: 'none', hint: 'Bo\'s recipe: fills you up and mends a little', officer: 'bo' },
  { id: 'potion', out: I.POTION, count: 1, inputs: [[I.MARSH_ROOT, 1], [I.BREAD, 1]], station: 'table', hint: 'Moss\'s brew: four hearts at once', officer: 'moss' },
  { id: 'swift', out: I.POTION_SWIFT, count: 1, inputs: [[I.MARSH_ROOT, 1], [I.CACTUS_FRUIT, 1]], station: 'table', hint: 'Run faster for a minute', officer: 'moss' },
  { id: 'strength', out: I.POTION_STRENGTH, count: 1, inputs: [[I.MARSH_ROOT, 1], [I.GUNPOWDER, 2]], station: 'table', hint: 'Hit harder for a minute', officer: 'moss' },
  { id: 'fireward', out: I.POTION_FIRE, count: 1, inputs: [[I.MARSH_ROOT, 1], [I.COAL, 2]], station: 'table', hint: 'Fire and lava cannot touch you for a minute', officer: 'moss' },
  { id: 'frostward', out: I.POTION_FROST, count: 1, inputs: [[I.MARSH_ROOT, 1], [I.FROST_SHARD, 1]], station: 'table', hint: 'Frost and slowing arrows cannot touch you for a minute', officer: 'moss' },
];

export const MACHINE_IDS = new Set<number>([B.CANNON, B.THRUSTER, B.WINDMILL_HUB, B.MORTAR]);

/** Blocks that aim and shoot (each keeps a CannonState on its body). */
export const TURRET_IDS = new Set<number>([B.CANNON, B.BALLISTA, B.MORTAR]);

/** Blocks with a front face: meta (0 +x, 1 -x, 2 +z, 3 -z) says which way it looks. */
export function hasFront(id: number): boolean {
  return blockDef(id).tiles.front !== null;
}
