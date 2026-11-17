// The officers: twelve named people along the Long March. Each has a story, an errand that sends you
// off the trail (survey stones on the hills, shrines in the dunes, a drowned chapel, a hideout, lenses
// in the snow, a vein in the ember wastes), and, the errand done, a bunk aboard: they stand their post
// on the deck, have something new to say in every land, and bring a skill the fortress did not have.
import { I } from './blocks';
import type { ActorKind } from './entities';
import type { NookKind } from './terrain';

export type OfficerId = 'brannoc' | 'wren' | 'bo' | 'amina' | 'moss' | 'gil' | 'kel' | 'tova' | 'aurel' | 'yrsa' | 'orsa' | 'lumen';

/** One step of an errand (a last "go back and tell them" is implied). */
export type Step =
  | { kind: 'go'; nook: string; text: string }
  | { kind: 'wreck'; exp: number; text: string }
  | { kind: 'fetch'; item: number; n: number; text: string; drop?: { from: ActorKind[]; chance: number }; at?: NookKind }
  | { kind: 'slay'; mobs: ActorKind[]; n: number; text: string }
  | { kind: 'crest'; exp: number; text: string };

export interface OfficerDef {
  id: OfficerId;
  name: string;
  title: string;
  /** Their village by index (-1: aboard from the start; -2: in the outlaws' cages). */
  village: number;
  /** Their land (the journal's order), and portrait. */
  land: number;
  /** The skill they bring aboard. */
  perk: string;
  perkText: string;
  errand: string;
  steps: Step[];
  /** Said on first meeting, while the errand is under way, and when it is done. */
  hello: string[];
  busy: string;
  thanks: string[];
  /** Aboard: something new in each land (by chapter, 0 Greenvale .. 6 the Blight). */
  talk: Partial<Record<number, string>>;
  /** What they press into your hands. */
  gift: Array<[item: number, count: number]>;
  /** A word in passing. */
  idle: string[];
}

export const OFFICERS: readonly OfficerDef[] = [
  {
    id: 'brannoc', name: 'Elder Brannoc', title: 'Keeper of the Strider', village: -1, land: 0,
    perk: 'Old Hands', perkText: 'The crew mends the legs a little every dawn',
    errand: 'A Word from Tam',
    steps: [{ kind: 'crest', exp: 2, text: 'Learn what became of Tam Brannoc at the Black Lagoon' }],
    hello: [
      'So the Strider answered you. She has not answered anyone in forty years.',
      'I am Brannoc. I helped hang her legs, and I mean to see her walk once more before I am done. There is a bunk for me aboard, if you will have an old man.',
      'My son Tam took the Mire Lily east with the others. If you ever learn what became of him, Captain, tell me. Whatever the word is.',
    ],
    busy: 'The fen keeps its dead, they say. I would rather know.',
    thanks: [
      'You found him. Give it here, Captain. Let me read it.',
      'He wrote that he was sorry. The boy never had a thing to be sorry for.',
      'Take this. It was his mother\'s, and then it was his. It ought to go east with someone who is coming back.',
    ],
    talk: {
      0: 'Rowan took the Bramble out with my blessing. Find her, Captain. Find what she carried.',
      1: 'The Sunstrider was the fastest of the Twelve. Saffi used to race the wind for coin.',
      2: 'My Tam was twenty-two when he took the Mire Lily. Twenty-two, and he thought he could fix anything.',
      3: 'Vesna never lost a fight she picked. I would not care to meet whoever took the Red Hawk.',
      4: 'Ilja wrote poems. Bad ones. I kept them all.',
      5: 'Orla cast half the cannons we ever fired. If anyone reached the Forge, it was Orla.',
      6: 'Veyra taught me to hold a plumb line. Whatever you find in there, Captain, she was my friend first.',
    },
    gift: [[I.TOTEM, 1]],
    idle: ['Mind the third leg. She favours it.', 'Forty years, and the deck still smells of tar.', 'I hung these legs. They will hold.'],
  },
  {
    id: 'wren', name: 'Wren Tallow', title: 'Cartographer', village: 1, land: 0,
    perk: 'Cartographer', perkText: 'Lost stashes show on your map',
    errand: 'The Survey',
    steps: [
      { kind: 'go', nook: 'survey0', text: 'Light the survey stone on Oak Hill' },
      { kind: 'go', nook: 'survey1', text: 'Light the Millrace survey stone' },
      { kind: 'go', nook: 'survey2', text: 'Light the Eastwatch survey stone' },
    ],
    hello: [
      'Is that her? Is that really the last Strider? Oh, she is MUCH bigger than the drawings!',
      'I am Wren Tallow, the valley\'s cartographer. Well. Its only one. My mother sailed with the Bramble as her navigator, and the map she left me stops at the first seal.',
      'The old survey stones on the hills still work, if someone lights them. Light all three and I can draw you every hollow in Greenvale.',
    ],
    busy: 'Three stones, Captain: look for the gold marks. Mind the spiders.',
    thanks: [
      'There! Look at it. All of Greenvale, down to the last rabbit hole. Mother would have cried.',
      'You are going east, aren\'t you? All the way? Then you need a navigator, and I have a bag packed. I packed it when I was nine.',
    ],
    talk: {
      0: 'Mother\'s last bearing points straight into the Whispering Meadows. Straight at the Bramble.',
      1: 'I have drawn the dunes four times. They keep moving. It is very rude of them.',
      2: 'The fen swallows compasses. Walk by the lily pads: they grow thick where the water is shallow.',
      3: 'Canyons are just rivers that gave up. That is my best line. I have not told anyone.',
      4: 'From up here the snow goes on forever. I ran out of white ink on the second day.',
      5: 'Mount Cinder is on no map, because everyone who saw it kept walking very fast.',
      6: 'This is the last of the paper, Captain. I want to draw the way home on it.',
    },
    gift: [[I.TREASURE_MAP, 2]],
    idle: ['Hold still, Captain, I am drawing you.', 'Has anyone seen my good pencil?', 'That hill is not on any map yet. It will be.'],
  },
  {
    id: 'bo', name: 'Bo Hearthkettle', title: 'Ship\'s Cook', village: 2, land: 1,
    perk: 'The Galley', perkText: 'A hot meal at every dawn: full hunger and a little healing',
    errand: 'The Great Stew',
    steps: [{ kind: 'fetch', item: I.CACTUS_FRUIT, n: 6, text: 'Cut six cactus fruit in the dunes' }],
    hello: [
      'Captain! You look like you have been living on bread.',
      'Bo Hearthkettle. I cooked for the Sunstrider for thirty years, until she marched east and left me here with a broken leg and a full larder. Best cook in the valley, and nobody to feed.',
      'Bring me six cactus fruit from the dunes (take your pick to a cactus) and I will show you what breakfast is.',
    ],
    busy: 'Six cactus fruit, Captain. Mind the spines. A cook can tell a hungry crew from here.',
    thanks: [
      'Ha! NOW that is a fruit. Stand back.',
      'Try that. Go on. That is what a crew marches on. You have a galley on that thing? You do now. Where do I put my pots?',
    ],
    talk: {
      1: 'Saffi took her tea with salt. I never said a word. Thirty years.',
      2: 'Everything in this fen tastes of fen. I have stopped fighting it.',
      3: 'Red dust in the stew. Call it paprika and nobody complains.',
      4: 'Cold makes a crew eat double. I have seen a gunner cry over a dumpling.',
      5: 'You can fry an egg on the deck plates out here. I have. It was not good.',
      6: 'Last stew I made for a crew going into the Blight, none came back to say if it was any good. Eat up, Captain.',
    },
    gift: [[I.STEW, 3]],
    idle: ['Who wants seconds?', 'Mind the pot. It bites.', 'You are too thin, Captain.'],
  },
  {
    id: 'amina', name: 'Sister Amina', title: 'Sand-Reader', village: 3, land: 1,
    perk: 'Field Medic', perkText: 'Your hearts come back twice as fast',
    errand: 'The Sun Tablets',
    steps: [{ kind: 'fetch', item: I.SUN_TABLET, n: 3, text: 'Recover the three Sun Tablets from the desert shrines', at: 'shrine' }],
    hello: [
      'The sand told me you would come. It also told me you would be taller.',
      'I am Amina. My order keeps what the Sun King\'s people left. Three tablets lay in three shrines, and the Heart\'s husks have walked over them for forty years.',
      'They tell where the Hearthstone came from, Captain. Veyra did not make it out of nothing. Bring them to me, and I will read them to you.',
    ],
    busy: 'Morning, Noon and Evening: three shrines, three tablets. The sand will not keep them forever.',
    thanks: [
      'Sit. Listen. Before the Builders, before the Sun King, a star fell here and did not go out. That is your Hearthstone.',
      'Veyra found it in these dunes. It was asleep. She taught it to walk, and it woke. No one has ever told that to a Captain.',
      'You will need a healer where you are going. I have read that too.',
    ],
    talk: {
      1: 'The Pyramid was old when the Builders were children. Tread softly in there.',
      2: 'Rot is only the land breathing out. Keep your wounds clean all the same.',
      3: 'Outlaws bleed like anyone. I have stitched more of them than I have buried.',
      4: 'The cold will slow your heart. It will also keep it. Do not fight it, walk through it.',
      5: 'Ash in the lungs is a slow knife. Tie a wet cloth. Yes, you. Now.',
      6: 'A star that cannot go out, Captain. Do not hate it. It only ever wanted what Veyra taught it to want.',
    },
    gift: [[I.POTION, 3]],
    idle: ['Breathe slower. There.', 'The sand says hello.', 'Show me that cut.'],
  },
  {
    id: 'moss', name: 'Moss', title: 'Runaway Witch', village: 4, land: 2,
    perk: 'Alchemist', perkText: 'Brew potions in the workshop',
    errand: 'Out of the Coven',
    steps: [{ kind: 'fetch', item: I.MARSH_ROOT, n: 5, text: 'Take five marsh roots from the fen\'s drowned and bogged', drop: { from: ['drowned', 'bogged', 'witch', 'slime'], chance: 0.45 } }],
    hello: [
      'You did not see me. There is nobody here. This frog is the only one here.',
      'Fine. I am Moss. I was the Bog Hag\'s apprentice until I asked what the cauldrons were for. They sink Striders, Captain. That is what they are for.',
      'I can teach your crew to brew anything, but I need marsh root, and the things that carry it would drown me for asking. Five will do.',
    ],
    busy: 'Marsh root. The drowned carry it, and the bogged, and the slimes when they feel like it. Do not lick it.',
    thanks: [
      'Oh, these are good. These are horribly good.',
      'She will know I helped you. I would like to be somewhere that walks away very fast when that happens. Is that bunk still free? Prince comes too.',
      'Prince is the frog. Do not ask.',
    ],
    talk: {
      2: 'Three cauldrons. Break all three or she will not stay dead. I have seen her try.',
      3: 'Rust makes a lovely brew. Terrible for you, but what a colour.',
      4: 'Prince has stopped croaking. He is either sulking or frozen. I am checking.',
      5: 'Everything is on fire and I have never felt more at home.',
      6: 'The Heart sang to the coven, Captain. I used to hum along. If you hear it, sing something else. Loudly.',
    },
    gift: [[I.POTION_SWIFT, 2]],
    idle: ['Prince says hello. He does not.', 'Do not drink that one.', 'Something smells wonderful. That is a warning.'],
  },
  {
    id: 'gil', name: 'Gil Ferrow', title: 'Ferryman of the Fen', village: 5, land: 2,
    perk: 'Bosun', perkText: 'The fortress walks faster',
    errand: 'A Light for Tam',
    steps: [
      { kind: 'go', nook: 'chapel', text: 'Open the chest in the Drowned Chapel: Gil\'s old ferry lantern' },
      { kind: 'wreck', exp: 2, text: 'Carry the lantern to the Black Lagoon' },
    ],
    hello: [
      'Mind your boots. The path is wherever I say it is today.',
      'Gil Ferrow. I poled the Mire Lily\'s crew out to the lagoon the night before she sank. Young Brannoc paid me double and told me to go home to bed. I did.',
      'I left my old lantern in the chapel when the water rose. Nobody should lie out there in the dark. Take it to him, would you? My knees have stopped speaking to me.',
    ],
    busy: 'Chapel first, Captain, then the lagoon. A lantern does no good in a chest.',
    thanks: [
      'You hung it? You saw it lit?',
      'Forty years I have watched that water. It looks different tonight.',
      'A man ought to walk on something that does not sink, for a change. I know a bit about getting heavy things across soft ground. I will show your crew.',
    ],
    talk: {
      2: 'See the water by the reeds? Dark means deep. Never take the dark way.',
      3: 'All this dry makes my teeth itch.',
      4: 'Ice is just water holding its breath. Do not trust it either.',
      5: 'I have ferried every kind of cargo there is, Captain, but I never thought I would carry hope. It is heavier than it looks.',
      6: 'Nearly there. I have told the legs to mind the last step. It is always the last step.',
    },
    gift: [[I.EMERALD, 12]],
    idle: ['My knees say rain.', 'Mind your boots.', 'Steady as she walks.'],
  },
  {
    id: 'kel', name: 'Kel Rustmane', title: 'Gunsmith', village: 6, land: 3,
    perk: 'Master Gunner', perkText: 'Turrets reload a third faster',
    errand: 'Old Debts',
    steps: [
      { kind: 'slay', mobs: ['pillager', 'vindicator'], n: 8, text: 'Thin out the outlaws' },
      { kind: 'go', nook: 'hideout', text: 'Open the chest at Rustmane\'s old hideout: the cannon plans' },
    ],
    hello: [
      'Before you ask: yes, it is that Kel Rustmane. No, I do not do that any more.',
      'I built the guns that brought down the Red Hawk. Sold them to the Warlord for a bag of silver and a laugh. I have had a long time to think about that laugh.',
      'The plans are still in my old hideout, and his boys still walk these canyons. Clear them off, fetch the plans, and I will build you something that shoots straight for once.',
    ],
    busy: 'Eight of his and then the hideout. They will not miss the plans until they try to use them.',
    thanks: [
      'That is them. Look at that. Nice work, that. I was very good. It is a terrible thing to be very good.',
      'I owe the Red Hawk a debt I cannot pay. I can pay a little of it with your cannons, though. Show me your guns.',
    ],
    talk: {
      3: 'The Warlord\'s fangs come up where you stand. Keep moving and let him waste them.',
      4: 'Cold iron cracks. Keep the barrels warm, keep your hands off them.',
      5: 'Fire and powder on one deck. I have never been so happy or so nervous.',
      6: 'If I do not come back, Captain, do not let anyone say I was sorry. Tell them I was useful.',
    },
    gift: [[I.TNT, 16]],
    idle: ['Do not touch that. Or that.', 'A cannon is an opinion, loudly held.', 'Who aligned this barrel? Me. Good.'],
  },
  {
    id: 'tova', name: 'Tova Hawkwing', title: 'Bosun of the Red Hawk', village: -2, land: 3,
    perk: 'Quartermaster', perkText: 'Traders charge you a quarter less',
    errand: 'The Hawk\'s Crew',
    steps: [{ kind: 'fetch', item: I.HAWK_TAG, n: 3, text: 'Take back three of the Red Hawk\'s crew tags from the vindicators', drop: { from: ['vindicator'], chance: 0.5 } }],
    hello: [
      'You opened the cage. Why? Nobody opens a cage for free.',
      'Tova Hawkwing. Bosun of the Red Hawk, what is left of her. The rest of her is that gate you walked under.',
      'The vindicators wear my crew\'s tags on their belts, for a joke. There are three still out there. I want them back. Then we will talk about what I owe you.',
    ],
    busy: 'Three tags. They wear them on their belts. I will know if you stop at two.',
    thanks: [
      'Halloran. Besk. Little Ansa.',
      'That is all of them now. That is everyone.',
      'You run a loose hold, Captain. Your traders see you coming. I will see to that. Where do you keep your ledgers?',
    ],
    talk: {
      3: 'Vesna went down with the Hawk\'s colours nailed to her wrist. Remember that, if you meet the Warlord.',
      4: 'Ilja had the Lark\'s crew singing in the snow. Idiots, all of them. Best crew on the march.',
      5: 'You are paying too much for iron. I have spoken to them. They will not do it again.',
      6: 'Twelve Striders. Eleven gone. This one comes home, Captain, if I have to carry her.',
    },
    gift: [[I.EMERALD, 16]],
    idle: ['Count your emeralds, Captain. I already have.', 'Stand straight. You are on a Strider.', 'Loose rope on the port side. Not for long.'],
  },
  {
    id: 'aurel', name: 'Aurel Starglass', title: 'Star-Watcher', village: 8, land: 4,
    perk: 'Lookout', perkText: 'Turrets reach a quarter further',
    errand: 'Three Lenses',
    steps: [{ kind: 'fetch', item: I.STAR_LENS, n: 3, text: 'Dig the three lenses of the Great Glass out of the snowfield cairns', at: 'lens' }],
    hello: [
      'Ah. You will be the one the lights have been pointing at.',
      'Aurel Starglass, at your service, and the sky\'s. I built the Great Glass here with Veyra herself, when we were both young and thought the world could be measured.',
      'When she went east I took out its lenses and hid them, so that nobody could watch what became of her. I was a coward. I would like to look now. Would you fetch them?',
    ],
    busy: 'Three lenses, three cairns. They will be cold. So is the truth, I expect.',
    thanks: [
      'Hold it steady. There. The Citadel. Do you see that glow, in the highest room? That is not the Heart.',
      'That is Veyra. She is still holding it back. Forty years, Captain, with her own two hands. It did not take her. She went in after it.',
      'I should have looked. Take me with you. I can at least tell your gunners where to point.',
    ],
    talk: {
      4: 'The lights over the snow are the Heart\'s breath on the sky. On a good night you can count it.',
      5: 'There is no sky here. I have started naming the smoke.',
      6: 'I measured the distance between two stars once and thought it was the greatest thing a person could do. Then she walked into that tower.',
    },
    gift: [[I.WIND_CHARGE, 6]],
    idle: ['Clear skies tonight, I think.', 'Do you ever look up, Captain?', 'Seven leagues to the next star.'],
  },
  {
    id: 'yrsa', name: 'Yrsa Snowfoot', title: 'Hunter', village: 9, land: 4,
    perk: 'Scout', perkText: 'Your crossbow bites harder, and frost cannot slow you',
    errand: 'The White Hunt',
    steps: [
      { kind: 'slay', mobs: ['polarbear'], n: 3, text: 'Bring down three polar bears' },
      { kind: 'crest', exp: 4, text: 'Hunt the Yeti on Frostpeak' },
    ],
    hello: [
      'Do not walk there. Now you have frightened the hare.',
      'I am Yrsa. My brother went up Frostpeak with the Winter Lark\'s crew. He was the best tracker in the north. What came down was his left boot.',
      'The bears are bold this year, and I cannot take the mountain alone. Show me you can hunt. Then we will go up together, you and I, and I will look it in the eye.',
    ],
    busy: 'Keep the wind in your face and your bolts dry.',
    thanks: [
      'It is done, then. You did not see it fall the way I saw it fall. I will tell it to the fire tonight.',
      'There is nothing left up here that I want. You walk east, Captain, into something bigger than a bear. I have never hunted anything like that. I would like to.',
    ],
    talk: {
      4: 'Do not run from a bear. Do not stand still either. It is complicated.',
      5: 'No tracks in ash. Everything here has already burned up its own footprints.',
      6: 'The Heart is only the last big animal, Captain. It breathes. It can be tired. Watch for that.',
    },
    gift: [[I.PEARL, 3]],
    idle: ['You walk too loud.', 'The wind has changed.', 'There are tracks by the third leg.'],
  },
  {
    id: 'orsa', name: 'Orsa Emberhand', title: 'Forge-Mistress', village: 10, land: 5,
    perk: 'Armourer', perkText: 'Forge the last and greatest gear',
    errand: 'Ember Steel',
    steps: [{ kind: 'fetch', item: I.EMBER_ORE, n: 6, text: 'Gather six ember ore from the Ember Vein and the wastes\' fire-things', drop: { from: ['magmacube', 'blaze'], chance: 0.4 }, at: 'vein' }],
    hello: [
      'That arm? Iron. Lost the real one to the same fire that made me. Do not stare, it is rude. Stare at the work.',
      'I am Orsa. Orla of the Ember Queen was my mother\'s sister. She taught me that a thing is only worth making if it can be made better.',
      'There is steel that holds a flame, Captain, and I have not had the ore to make it since the Heart woke. Bring me some and I will make you something the Citadel has not seen.',
    ],
    busy: 'Ember ore: it glows. In the Vein, and in the bellies of the fire-things. You will know it when your gloves start smoking.',
    thanks: [
      'Look at the colour of that. Forty years, and it still remembers how to burn.',
      'You will not get this working from a crate of stuff on a deck. I am coming. I will need the whole of your forge and all of your coal.',
    ],
    talk: {
      5: 'A blade should sing when you draw it. If yours does not, bring it here and I will have a word with it.',
      6: 'What I make is not for winning, Captain. It is for coming back. Remember the difference.',
    },
    gift: [[I.EMBER_STEEL, 4]],
    idle: ['Good steel does not hurry.', 'That edge is a disgrace. Give it here.', 'More coal.'],
  },
  {
    id: 'lumen', name: 'Lumen', title: 'The Last Apprentice', village: 11, land: 5,
    perk: 'Engineer', perkText: 'The Engine Core takes twice the punishment',
    errand: 'The Architect\'s Notes',
    steps: [{ kind: 'fetch', item: I.VEYRA_NOTE, n: 6, text: 'Find Veyra\'s six notes (one lies in each captain\'s chest)' }],
    hello: [
      'Do not be alarmed. It only looks like an eye.',
      'I am Lumen. I swept the floors of Veyra\'s workshop and held her lantern. She put this splinter in my head when I was dying, ninety years ago, to see if it could be done. It could.',
      'Before she went into the Citadel she gave each captain one page of her notes, sealed. Six are out there, in six chests. They say how it ends, Captain. I would like to read them while I can.',
    ],
    busy: 'Six pages. Each captain carried one. She always did write too much.',
    thanks: [
      'Her hand. Oh, her terrible handwriting.',
      '"It cannot be killed. It can only be let go. When it is time, someone must break what holds me to it, and I will carry it out." She knew, Captain. She knew from the start.',
      'She meant to be freed. That is what the Key is for. Take me to her. I still have her lantern.',
    ],
    talk: {
      5: 'Your Core is a splinter of her work. May I? It only hurts a little. It, not me.',
      6: 'I have swept her floor for ninety years, Captain. Let me sweep it one last time.',
    },
    gift: [[I.HEARTSTONE, 2]],
    idle: ['It only looks like an eye.', 'I remember this floor.', 'The splinter hums when you are near.'],
  },
];

export function officer(id: string): OfficerDef | undefined {
  return OFFICERS.find((o) => o.id === id);
}

/** The officer whose village this is. */
export function officerOf(village: number): OfficerDef | undefined {
  return OFFICERS.find((o) => o.village === village);
}
