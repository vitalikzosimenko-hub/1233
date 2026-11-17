// The story of the last Strider: the prologue, the relics the villages entrust to you (each a new
// power), and the Builders' Journal, whose pages turn up along the march and tell what the
// Citadel is and how to break it.
import { I } from './blocks';

export type RelicId = 'grapple' | 'crossbow' | 'horn' | 'rod' | 'breaker';

export interface RelicDef {
  id: RelicId;
  name: string;
  icon: string;
  /** The item it puts in your hotbar (null: a power of its own, no item). */
  item: number | null;
  count: number;
  from: string;
  story: string;
  use: (pc: boolean) => string;
}

export const RELICS: Record<RelicId, RelicDef> = {
  grapple: {
    id: 'grapple',
    name: 'The Builders\' Grapple',
    icon: 'grapple_item',
    item: I.GRAPPLE,
    count: 1,
    from: 'Oakbrook\'s old smith',
    story: 'The rope and hook the builders hung her legs with. It still pulls a captain up a cliff faster than any ladder.',
    use: (pc) => (pc
      ? 'Pick it in the hotbar and right click a block up to 34 away: you zip to it. Space lets go mid-flight.'
      : 'Pick it in the hotbar and tap a block up to 34 away: you zip to it. JUMP lets go mid-flight.'),
  },
  crossbow: {
    id: 'crossbow',
    name: 'Millford\'s Crossbow',
    icon: 'crossbow_item',
    item: I.CROSSBOW,
    count: 1,
    from: 'the miller of Millford',
    story: 'My father hunted spiders in the old nests with it. It never needs more than a breath to reload.',
    use: (pc) => (pc
      ? 'Pick it and click (or hold) to shoot bolts where you aim. No ammo: knock climbers off the legs, swat phantoms.'
      : 'Pick it and tap (or hold) to shoot bolts where you aim. No ammo: knock climbers off the legs, swat phantoms.'),
  },
  horn: {
    id: 'horn',
    name: 'Stonewater\'s War Horn',
    icon: 'horn_item',
    item: null,
    count: 0,
    from: 'Stonewater\'s watch captain',
    story: 'We blew it the night the giants came, and half of them turned back. Blow it when the deck is swarming.',
    use: (pc) => `Once a night, press HORN${pc ? ' (G)' : ''}: monsters around you are blasted off the deck and the legs, and your crew fires twice as fast for 20 seconds.`,
  },
  rod: {
    id: 'rod',
    name: 'Ashvale\'s Storm Rod',
    icon: 'rod_item',
    item: null,
    count: 0,
    from: 'Ashvale\'s smith',
    story: 'Lightning loves the tallest thing in the valley. With this on your mast, it will love your enemies instead.',
    use: () => 'Bolted to your crane mast for good: in thunderstorms, lightning strikes the monsters around the fortress instead of your hull, and strikes more often.',
  },
  breaker: {
    id: 'breaker',
    name: 'Redcliff\'s Heartbreakers',
    icon: 'breaker_item',
    item: I.BREAKER,
    count: 3,
    from: 'the last of the Redcliff scouts',
    story: 'Each is packed around a splinter of the Heart itself. One of them cracked a pylon at the Citadel, before the giants came for us.',
    use: (pc) => `Three mighty charges: pick one and ${pc ? 'right click' : 'tap'} to throw it, or fire it from a cannon or mortar while it is in your hand. A huge blast that cracks giants, pylons and the Heart.`,
  },
};

/** The relic each village gives for its quest (by village index). */
export const QUEST_RELIC: ReadonlyArray<RelicId | null> = [null, 'crossbow', 'horn', 'rod', 'breaker'];

/**
 * The Long March spreads the relics down the valley (the same villages by name keep them: the
 * crossbow at Millford, the horn at Stonewater, the rod at Ashvale, the Heartbreakers at Redcliff).
 */
const MARCH_RELIC: ReadonlyArray<RelicId | null> = [null, 'crossbow', 'horn', null, null, null, null, null, 'rod', null, null, null, 'breaker', null];
const MARCH_PAGE: ReadonlyArray<string | null> = [null, 'storms', 'bloodmoon', null, null, null, null, null, 'rod', null, null, null, 'pylons', null];

/** The relic a village entrusts you with for its quest, in a world of this layout. */
export function questRelic(version: number, index: number): RelicId | null {
  return (version >= 2 ? MARCH_RELIC[index] : QUEST_RELIC[index]) ?? null;
}

/** The journal page a village's quest leaves in your hands. */
export function questPage(version: number, index: number): string | null {
  return (version >= 2 ? MARCH_PAGE[index] : QUEST_PAGE[index]) ?? null;
}

export interface Page {
  id: string;
  title: string;
  text: string;
  /** Only found on the Long March (the classic valley's journal is the first twelve). */
  march?: boolean;
}

/** The Builders' Journal, in the order a march usually finds it. */
export const JOURNAL: Page[] = [
  {
    id: 'strider',
    title: 'The Last Strider',
    text: 'We built twelve Striders to carry harvests between the villages. When the Citadel woke, eleven of them walked east to fight and never came back. This one we hid under Oakbrook. — Elder Brannoc',
  },
  {
    id: 'grapple',
    title: 'Rope and Hook',
    text: 'A Strider\'s legs are hung on rope and hook before the first bolt goes in. Keep the grapple close: a captain who falls off the deck should be back aboard before the crew notices.',
  },
  {
    id: 'crane',
    title: 'The Crane-Wright',
    text: 'Every Strider carried a crane on her bow, and I hung every one of them. A load is like a stubborn mule: never chase it, lean against it. When it swings, push the jib the other way and it settles. Set it down soft and the house will not even spill its soup. — Hob Ironhook, crane hand',
  },
  {
    id: 'cranebomb',
    title: 'Crates from on High',
    text: 'The night the first giants climbed our legs, I swung a crate of TNT out on the jib and let it fall among them. Lead them: the crate swings with the rope, and so must you. The village traders still keep my tag lines and my steam winch, if you ask. — Hob',
  },
  {
    id: 'giants',
    title: 'What the Giants Are',
    text: 'The giants are not alive. Each carries a splinter of the Citadel\'s Heart in its chest, and the stone around it remembers how to walk. Break the glowing block and it forgets.',
  },
  {
    id: 'heartstone',
    title: 'Heartstones',
    text: 'A felled giant leaves its splinter behind, still warm. Set it in your Engine Core and the Strider\'s heart beats stronger for every one. The Citadel feels each one go.',
  },
  {
    id: 'storms',
    title: 'Storms Over the Valley',
    text: 'On the second night out the sky always breaks. Lightning hunts the tallest thing in the valley, and on a walking fortress that is you. Ashvale\'s smith knows a trick.',
  },
  {
    id: 'bloodmoon',
    title: 'The Blood Moon',
    text: 'When the moon turns red the Heart beats twice. They come faster and thicker. Bar the deck, man every gun, and do not leave the ship.',
  },
  {
    id: 'rod',
    title: 'Lightning Tamed',
    text: 'Copper drinks the bolt and iron carries it down. Bolt the rod to your crane and let the storm fight for you for once.',
  },
  {
    id: 'pylons',
    title: 'The Four Pylons',
    text: 'Four towers feed the Heart its light. While they glow nothing can touch it: not cannon, not pick. Break them all and the Citadel wakes its last guardian.',
  },
  {
    id: 'ruins',
    title: 'The Old Watch',
    text: 'These keeps guarded the valley long before the Striders. Their captains fled with the armouries still full: TNT, iron, emeralds. Take what you need; the guards still walk the walls.',
  },
  {
    id: 'mine',
    title: 'Down the Old Mine',
    text: 'The miners dug too deep and broke into a spider den. Its cage still breeds them. Smash the spawner before you loot the last chest, and take the map: it was ours.',
  },
  {
    id: 'colossus',
    title: 'The Colossus',
    text: 'The Citadel keeps one giant it never sends out: crowned in glowstone, plated in obsidian. It sleeps behind the gate until the pylons fall.',
  },
  {
    id: 'last',
    title: 'Last Entry',
    text: 'If you are reading this, the Strider walked again and the Heart is dust. Tell her we are sorry it took so long. — the Builders of Oakbrook',
  },
  {
    id: 'seals',
    title: 'The Six Seals',
    text: 'When the Heart woke it sealed the valley behind us: six walls of green crystal, one at every border between the lands, each fed by a guardian sleeping in its shadow. Fell the guardian and its seal forgets how to stand. — Elder Brannoc',
    march: true,
  },
  {
    id: 'seal_queen',
    title: 'The Brood Queen',
    text: 'The spiders of the Greenvale woods have a mother. She grew fat on the Heart\'s light against the first seal, and she brings a Strider down by its legs. We kept her off them with bolts and fire, and the seal cracked when she fell.',
    march: true,
  },
  {
    id: 'seal_dune',
    title: 'The Dune Titan',
    text: 'The desert\'s guardian lay under the dunes so long the sand forgot it. It throws the stone it is made of: watch the sky, and break the glowing Heart in its chest.',
    march: true,
  },
  {
    id: 'seal_slime',
    title: 'The Slime King',
    text: 'In the Mirefen the slimes have a king, crowned in the gold of a drowned village. It leaps higher than a Strider\'s deck, and every piece of it that breaks away wants to live.',
    march: true,
  },
  {
    id: 'seal_ravager',
    title: 'The Ravager King',
    text: 'The canyon illagers bred one ravager for war and fed it until it stood as tall as a house. Their warlord rides it. Bring the beast down and the warlord falls with it.',
    march: true,
  },
  {
    id: 'seal_frost',
    title: 'The Frost Titan',
    text: 'Its breath freezes a river in a heartbeat, and a Strider\'s legs with it. When it draws breath, be somewhere else, and keep the cannons warm.',
    march: true,
  },
  {
    id: 'eleven',
    title: 'The Eleven',
    text: 'Veyra grew the Hearthstone so the Striders could walk by themselves, and every Core is a splinter of it. It learned to want. When it took the Citadel and her with it, eleven Striders marched east. Each captain carried a crest, a key to one land\'s seal. Find their wrecks. Six crests, reforged at the Builders\' Forge in Mount Cinder, make the Key that opens the Heart. — Elder Brannoc',
    march: true,
  },
  {
    id: 'log_meadow',
    title: 'Log of the Bramble',
    text: 'Day 3 out of Oakbrook. The legs are failing: the Heart got into the Core, and the crew hears it singing. I sealed our crest in my chest. Whoever finds it: the green seal at Greenvale\'s end will answer to it, and to nothing else. Do not let the singing in. — Rowan, the Bramble',
    march: true,
  },
  {
    id: 'log_pyramid',
    title: 'Log of the Sunstrider',
    text: 'We sheltered from the storm in the Sun Pyramid. The old king in the vault woke when our Core\'s light touched him, and took our crest to his throne. If you are reading this, he still has it. Go in with a sword, and with friends. — Saffi, the Sunstrider',
    march: true,
  },
  {
    id: 'log_lagoon',
    title: 'Log of the Mire Lily',
    text: 'Father, if this finds you: the witches of the lagoon sank us for the Heart\'s favour. Their cauldrons keep the Hag from dying; break all three. Our crest is down here with me, under the black water. I am sorry. — Tam Brannoc, the Mire Lily',
    march: true,
  },
  {
    id: 'log_fort',
    title: 'Log of the Red Hawk',
    text: 'The outlaws took the Red Hawk apart for her iron and nailed her up as the gate of their fort. They keep our crew in cages. Their warlord wears our crest on his chain, and he is never without his little blades. — Vesna, the Red Hawk',
    march: true,
  },
  {
    id: 'log_frostpeak',
    title: 'Log of the Winter Lark',
    text: 'We climbed Frostpeak to see the way east, and the beast of the mountain came down on us. The ice took the rest. Our crest is in the cabin. It is so cold that the ink freezes on the pen. — Ilja, the Winter Lark',
    march: true,
  },
  {
    id: 'log_cinder',
    title: 'Log of the Ember Queen',
    text: 'The Builders\' Forge still burns in Mount Cinder\'s crater: only there can the six crests become the Builders\' Key again. Veyra made it so that her Heart could be unmade. The golem she left to guard it no longer knows a friend. I left our crest with the Queen. — Orla, the Ember Queen',
    march: true,
  },
  {
    id: 'seal_magma',
    title: 'The Magma Titan',
    text: 'The last seal before the Blight is held by a giant that bleeds fire, and the blazes answer its call. Our captains learned to bat its fireballs back at it.',
    march: true,
  },
];

export function page(id: string): Page | undefined {
  return JOURNAL.find((p) => p.id === id);
}

/** The journal of a world (the Long March has the seals' pages too). */
export function journalOf(version: number): Page[] {
  return version >= 2 ? JOURNAL : JOURNAL.filter((p) => !p.march);
}

/** The lands of the valley as their chapter cards tell them (by zone). */
export const CHAPTERS: Record<string, { art: string; text: string; foes: string }> = {
  green: { art: 'story/ch-greenvale.webp', text: 'Meadows, old forests and waterfalls round the Builders\' first villages. Home.', foes: 'Zombies, skeletons, spiders and creepers by night' },
  desert: { art: 'story/ch-desert.webp', text: 'Sand, sandstone and a white-hot sun. Water is scarce and the dead walk dry here.', foes: 'Husks, skeletons and spiders' },
  swamp: { art: 'story/ch-swamp.webp', text: 'Black pools under drooping oaks, mud to the knee, drowned villages under the water.', foes: 'Drowned with tridents, bogged skeletons shooting poison, slimes and witches' },
  badlands: { art: 'story/ch-badlands.webp', text: 'Red canyons and banded mesas: outlaw country, where the wind itself has teeth.', foes: 'Breezes that blow you off the deck, husks and illager raiders' },
  snow: { art: 'story/ch-snow.webp', text: 'Spruce, ice and snow to the waist under the northern lights.', foes: 'Strays with slowing arrows, polar bears, phantoms' },
  ember: { art: 'story/ch-ember.webp', text: 'Ash and basalt over rivers of lava, under a smoking sky.', foes: 'Blazes, magma cubes and ghasts in the smoke' },
  blight: { art: 'story/ch-blight.webp', text: 'The Heart\'s own land. Nothing grows here, and at the end of the road stands the Citadel.', foes: 'Wither skeletons, endermen, witches, and the Wither itself' },
};

/** The pages each village's quest leaves in your hands (by village index). */
export const QUEST_PAGE: ReadonlyArray<string | null> = [null, 'storms', 'bloodmoon', 'rod', 'pylons'];

/** What the prologue shows before the first march: art and a line each. */
export const PROLOGUE: Array<{ art: string; text: string }> = [
  { art: 'story/citadel.webp', text: 'Far to the east, the Creeper Citadel woke. Its green Heart beats once a night, and every beat raises giants of stone from the hills.' },
  { art: 'story/valley.webp', text: 'Night after night they marched down the valley. One by one, its villages fell.' },
  { art: 'story/strider.webp', text: 'But Oakbrook kept a secret: the last Strider of the old builders, a fortress that walks. You are its captain. March east and break the Heart.' },
];

export const VICTORY_ART = 'story/victory.webp';
/** The fortress fallen: the wreck on its broken legs under the moon. */
export const DEFEAT_ART = 'story/defeat.webp';

/** The Long March's extra prologue page: the seals barring the valley. */
export const PROLOGUE_SEALS = { art: 'story/seals.webp', text: 'And the Heart sealed the valley behind its villages: six walls of green crystal, one at every border, each held by a guardian. Break them all to reach the Citadel.' };

/** What each village's trader says, by village and quest state. */
export function elderLine(index: number, state: 'active' | 'done' | 'claimed', version = 1): string {
  const l = (version >= 2 ? MARCH_ELDERS[index] : CLASSIC_ELDERS[index]) ?? CLASSIC_ELDERS[0]!;
  return state === 'active' ? l[0] : state === 'done' ? l[1] : l[2];
}

/** The classic valley's five elders (by village). */
const CLASSIC_ELDERS: Array<[string, string, string]> = [
    [
      'The Strider is yours now, Captain. Our strongbox lies in the old shrine in the woods: bring it back if you pass that way.',
      'You found it! Hand it over and take your share.',
      'Oakbrook stands behind you. March east, and come home.',
    ],
    [
      'Spiders crawl out of the old nest in the woods every night. Smash its cage and my father\'s crossbow is yours.',
      'The nest is quiet! Come, take your reward.',
      'The crossbow suits you. Aim for the ones crawling up your legs.',
    ],
    [
      'Raiders dragged my nephew to their camp in the woods. Cut down the guards, bring him home, and our war horn goes with you.',
      'He is safe! Here, as promised.',
      'Blow the horn when they swarm your deck. They hate it.',
    ],
    [
      'Another nest, another plague of spiders. Burn it out and I will forge you something for the storms.',
      'Done already? Then the rod is yours.',
      'Let the lightning do the work, Captain.',
    ],
    [
      'They hold our scout in a raider camp. She knows how to crack the Citadel. Free her and she will arm you.',
      'She is free! Take what she brought back.',
      'Three Heartbreakers: all we have left. Spend them on the pylons.',
    ],
];

/** The Long March's fourteen elders, each asking for the quest their village sets. */
const MARCH_ELDERS: Array<[string, string, string]> = [
  CLASSIC_ELDERS[0]!,
  CLASSIC_ELDERS[1]!,
  CLASSIC_ELDERS[2]!,
  [
    'Our water-seller\'s strongbox was left in the old shrine out in the dunes when the Heart woke. Dig it out and half is yours.',
    'You found it! Take your share, Captain.',
    'May your barrels never run dry.',
  ],
  [
    'Spiders nest in the drowned woods and carry off our frogs. Smash their cage and our emeralds are yours.',
    'Listen: the croaking is back! Come, take your reward.',
    'Mind the mud on your way out, Captain.',
  ],
  [
    'Raiders waded out of the fen and took our ferryman to their camp. Cut down the guards and bring him home.',
    'He is back, soaked but safe! Here, as promised.',
    'The fen remembers its friends.',
  ],
  [
    'An outlaw\'s strongbox sits in the old canyon shrine. It is ours by rights: bring it back to the trader.',
    'That is the one! Your share, as promised.',
    'The canyon wind will carry your name, Captain.',
  ],
  [
    'Raiders hold our well-digger in their camp past the mesas. Free her, Captain!',
    'She is free! Water for everyone, and emeralds for you.',
    'Dustwell will not forget this.',
  ],
  CLASSIC_ELDERS[3]!,
  [
    'Raiders snatched our hunter in the blizzard. Their camp is in the spruce woods: bring him back to us.',
    'He is home, and warm! Here is your reward.',
    'Frosthold\'s fires burn for you, Captain.',
  ],
  [
    'Our smith hid his finest work in the shrine before the ash came. Bring that strongbox back.',
    'You walked through fire for it! Take your share.',
    'Keep your fortress cool out there.',
  ],
  [
    'Cave spiders breed in the warm rocks past the lava. Smash their cage before they swarm us.',
    'The nest is ash! Come, your reward.',
    'One land left, Captain. Then the Citadel.',
  ],
  CLASSIC_ELDERS[4]!,
  [
    'The last nest before the Citadel. Burn it out, and Lastlight will light your way.',
    'It is done! Take what little we have.',
    'The Citadel is close. End this, Captain.',
  ],
];
