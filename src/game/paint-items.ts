// The officers' errand goods, the lands' metals, the galley's stew, Moss's brews, and the forged swords
// and coats: pixel art at sixteen to the tile, doubled up to the game's thirty-two, with highlights
// that catch the light. Letters are palette entries; '.' is empty.
import { clearAll } from './paint-extra';
import { hex, register, type Pix } from './textures';

type Palette = Record<string, string>;

/** Paints sixteen rows at two texels a pixel; the palette's bright end shines a little. */
function sprite(p: Pix, rows: readonly string[], pal: Palette, shine = ''): void {
  clearAll(p);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x]!;
      const c = pal[ch];
      if (!c) continue;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          p.set(x * 2 + dx, y * 2 + dy, hex(c));
          p.H(x * 2 + dx, y * 2 + dy, 0.6);
          if (shine.includes(ch)) p.S(x * 2 + dx, y * 2 + dy, 0.8);
        }
      }
    }
  });
  p.bump = 0.5;
}

const GEM = [
  '................',
  '.....KKKKKK.....',
  '....KHHLLMMK....',
  '...KHLLMMMMDK...',
  '..KHLLMMMMMMDK..',
  '..KLLMMMMMMMDK..',
  '..KKKKKKKKKKKK..',
  '..KLMMMMMMMMDK..',
  '...KMMMMMMMDK...',
  '....KMMMMMDK....',
  '.....KMMMDK.....',
  '......KMDK......',
  '.......KK.......',
  '................',
  '................',
  '................',
];

const INGOT = [
  '................',
  '................',
  '................',
  '.....KKKKKKKK...',
  '....KHHLLLLLMK..',
  '...KHLLLLLLMDK..',
  '..KKKKKKKKKKDK..',
  '..KLLLLLLLLMKDK.',
  '..KLLLLLMMMMKDK.',
  '..KMMMMMMMMDKK..',
  '..KKKKKKKKKKK...',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const BOTTLE = [
  '................',
  '......KKKK......',
  '......KCCK......',
  '.....KKKKKK.....',
  '......KGGK......',
  '......KGGK......',
  '.....KGGGGK.....',
  '....KGHGGGGK....',
  '...KLLLLLLLLK...',
  '...KLHMMMMMDK...',
  '...KLMMMMMMDK...',
  '...KMMMMMMDDK...',
  '....KMMMDDDK....',
  '.....KKKKKK.....',
  '................',
  '................',
];

const SWORD = [
  '.............KK.',
  '............KHLK',
  '...........KHLK.',
  '..........KHLK..',
  '.........KHLK...',
  '........KHLK....',
  '.......KHLK.....',
  '..KK..KHLK......',
  '..KGKKHLK.......',
  '...KGKLK........',
  '....KGK.........',
  '...KWKGK........',
  '..KWK.KGK.......',
  '.KWK...KK.......',
  '.KK.............',
  '................',
];

const COAT = [
  '................',
  '...KKK....KKK...',
  '..KLLLKKKKLLLK..',
  '.KLLLLHHHHLLLLK.',
  '.KLLLLLKKLLLLLK.',
  '.KLMKLLLLLLKMLK.',
  '..KK.KLLLLK.KK..',
  '.....KLLLLK.....',
  '.....KLLMLK.....',
  '.....KLLMLK.....',
  '.....KLMMLK.....',
  '.....KMMMMK.....',
  '.....KKKKKK.....',
  '................',
  '................',
  '................',
];

const ITEMS: Record<string, { rows: readonly string[]; pal: Palette; shine?: string }> = {
  sun_amber_item: { rows: GEM, pal: { K: '#5a3208', H: '#fff0a0', L: '#ffc840', M: '#e89a1c', D: '#a8600c' }, shine: 'HL' },
  frost_shard_item: { rows: GEM, pal: { K: '#1a4a7a', H: '#ffffff', L: '#c8f0ff', M: '#7ec8f0', D: '#3a84c8' }, shine: 'HL' },
  bog_iron_item: { rows: INGOT, pal: { K: '#1e2414', H: '#a8b078', L: '#7a8450', M: '#566036', D: '#343c20' }, shine: 'H' },
  rust_iron_item: { rows: INGOT, pal: { K: '#3a1408', H: '#f0a060', L: '#c86a30', M: '#9c4a1c', D: '#62280c' }, shine: 'H' },
  ember_steel_item: { rows: INGOT, pal: { K: '#1a0c08', H: '#ffe080', L: '#ff9030', M: '#c84a14', D: '#5a1c0a' }, shine: 'HL' },
  potion_swift_item: { rows: BOTTLE, pal: { K: '#14202a', C: '#8a6a3a', G: '#d8ecf4', H: '#ffffff', L: '#c0f0ff', M: '#5cb8e0', D: '#2a78b0' }, shine: 'GH' },
  potion_strength_item: { rows: BOTTLE, pal: { K: '#2a1010', C: '#8a6a3a', G: '#d8ecf4', H: '#ffffff', L: '#ff9a8a', M: '#d83a2a', D: '#8a1c14' }, shine: 'GH' },
  potion_fire_item: { rows: BOTTLE, pal: { K: '#2a1a08', C: '#8a6a3a', G: '#d8ecf4', H: '#ffffff', L: '#ffd080', M: '#f08a20', D: '#b04e10' }, shine: 'GH' },
  potion_frost_item: { rows: BOTTLE, pal: { K: '#142a30', C: '#8a6a3a', G: '#d8ecf4', H: '#ffffff', L: '#e0ffff', M: '#a0e4f0', D: '#60a8c8' }, shine: 'GH' },
  cactus_fruit_item: {
    rows: [
      '................',
      '.......KK.......',
      '......KRRK......',
      '.....KRRRRK.....',
      '....KGGGGGGK....',
      '...KGHGGGGGGK...',
      '...KGGGGPGGDK...',
      '...KGGPGGGGDK...',
      '...KGGGGGPGDK...',
      '...KGGPGGGDDK...',
      '...KGGGGGGDDK...',
      '....KGGDDDDK....',
      '.....KKKKKK.....',
      '................',
      '................',
      '................',
    ],
    pal: { K: '#14300e', G: '#4a9a3a', H: '#a8e070', D: '#2a6a24', R: '#e03a6a', P: '#e8e0a0' },
  },
  sun_tablet_item: {
    rows: [
      '................',
      '...KKKKKKKKKK...',
      '...KLLLLLLLLK...',
      '...KLMMYYMMLK...',
      '...KLMYYYYMLK...',
      '...KLYYHHYYLK...',
      '...KLYYHHYYLK...',
      '...KLMYYYYMLK...',
      '...KLMMYYMMLK...',
      '...KLLLLLLLLK...',
      '...KLDLDDLDLK...',
      '...KLLLLLLLLK...',
      '...KKKKKKKKKK...',
      '................',
      '................',
      '................',
    ],
    pal: { K: '#4a3414', L: '#d8c080', M: '#bca060', D: '#8a7040', Y: '#f0a020', H: '#fff0a0' },
    shine: 'YH',
  },
  marsh_root_item: {
    rows: [
      '........GG......',
      '.......GHG......',
      '......GGG.......',
      '......KK........',
      '.....KLLK.......',
      '....KLLLMK......',
      '....KLLMMK......',
      '...KLLMMDK......',
      '...KLMMDK.KK....',
      '..KLMMDK.KLK....',
      '..KMMDKKKLK.....',
      '.KMDKKLLLK......',
      '.KDK.KMMK.......',
      '.KK...KK........',
      '................',
      '................',
    ],
    pal: { K: '#2a1c10', L: '#b89a6a', M: '#8a6e44', D: '#5a4428', G: '#4a8a30', H: '#8ac850' },
  },
  ferry_lantern_item: {
    rows: [
      '......KKKK......',
      '.....K....K.....',
      '.....K....K.....',
      '....KKKKKKKK....',
      '...KMMMMMMMMK...',
      '....KFYYYYFK....',
      '....KFYHHYFK....',
      '....KFYHHYFK....',
      '....KFYYYYFK....',
      '....KFFFFFFK....',
      '...KMMMMMMMMK...',
      '....KKKKKKKK....',
      '................',
      '................',
      '................',
      '................',
    ],
    pal: { K: '#1e1a14', M: '#5a4a30', F: '#c87a20', Y: '#ffc040', H: '#fff0b0' },
    shine: 'YH',
  },
  cannon_plans_item: {
    rows: [
      '................',
      '..KKKKKKKKKKKK..',
      '.KPPPPPPPPPPPPK.',
      '.KKKKKKKKKKKKKK.',
      '..KBBBBBBBBBBK..',
      '..KBWBBWWWBBBK..',
      '..KBBWWWWWWBBK..',
      '..KBBBWBBBWBBK..',
      '..KBWBBBBBBWBK..',
      '..KBBBBBWBBBBK..',
      '.KKKKKKKKKKKKKK.',
      '.KPPPPPPPPPPPPK.',
      '..KKKKKKKKKKKK..',
      '................',
      '................',
      '................',
    ],
    pal: { K: '#14243e', P: '#a07a48', B: '#2a5a9a', W: '#c8e0f8' },
  },
  hawk_tag_item: {
    rows: [
      '.......KK.......',
      '......K..K......',
      '......K..K......',
      '.......KK.......',
      '.....KKKKKK.....',
      '....KHLLLLMK....',
      '...KHLRRRRLMK...',
      '...KLRRLLRRMK...',
      '...KLLRRRRLMK...',
      '...KLLLRRLLMK...',
      '....KLLLLMMK....',
      '.....KLLMMK.....',
      '......KKKK......',
      '................',
      '................',
      '................',
    ],
    pal: { K: '#2a2a30', H: '#f0f0f4', L: '#b8b8c0', M: '#7a7a84', R: '#c02a20' },
    shine: 'HL',
  },
  star_lens_item: {
    rows: [
      '................',
      '.....KKKKKK.....',
      '...KKGGGGGGKK...',
      '..KGGHHLLLLGGK..',
      '..KGHHLLLLLLGK..',
      '.KGHLLLLLLLLMGK.',
      '.KGLLLLLLLLMMGK.',
      '.KGLLLLLLLMMMGK.',
      '.KGLLLLLLMMMMGK.',
      '.KGLLLLLMMMMMGK.',
      '..KGLLMMMMMMGK..',
      '..KGGMMMMMMGGK..',
      '...KKGGGGGGKK...',
      '.....KKKKKK.....',
      '................',
      '................',
    ],
    pal: { K: '#4a3a14', G: '#d8ae40', H: '#ffffff', L: '#c0e8f8', M: '#7ab0d8' },
    shine: 'HL',
  },
  ember_ore_item: {
    rows: [
      '................',
      '................',
      '.....KKKKK......',
      '....KBBBBBKK....',
      '...KBOOBBBBBK...',
      '..KBBOYOBBOBBK..',
      '..KBBBOBBOYOBK..',
      '..KBOBBBBBOBBK..',
      '..KOYOBBBBBBBK..',
      '..KBOBBOOBBBBK..',
      '...KBBOYYOBBK...',
      '....KBBOOBKK....',
      '.....KKKKK......',
      '................',
      '................',
      '................',
    ],
    pal: { K: '#0e0a0a', B: '#2c2426', O: '#f07a1c', Y: '#ffe060' },
    shine: 'Y',
  },
  veyra_note_item: {
    rows: [
      '................',
      '...KKKKKKKKK....',
      '..KPPPPPPPPPK...',
      '..KPDDDDDDPPK...',
      '..KPPPPPPPPPK...',
      '..KPDDDDPPPPK...',
      '..KPPPPPPPPPK...',
      '..KPDDDDDDPPK...',
      '..KPPPPPPPPPK...',
      '..KPDDDPPGGPK...',
      '..KPPPPPGHGPK...',
      '..KPPPPPPGGPK...',
      '...KKKKKKKKK....',
      '................',
      '................',
      '................',
    ],
    pal: { K: '#3a2c14', P: '#e8d8a8', D: '#5a4a30', G: '#3a9a5a', H: '#8affb0' },
  },
  stew_item: {
    rows: [
      '................',
      '.....S..S.......',
      '......S..S......',
      '.....S..S.......',
      '................',
      '..KKKKKKKKKKKK..',
      '.KRRORRRGRRORRK.',
      '.KKRRGRRORRGRKK.',
      '.KWKKKKKKKKKKDK.',
      '.KWWWWWWWWWWDDK.',
      '..KWWWWWWWWDDK..',
      '...KWWWWWDDDK...',
      '....KKKKKKKK....',
      '................',
      '................',
      '................',
    ],
    pal: { K: '#3a2410', R: '#a8501c', O: '#f0a040', G: '#6aa83a', W: '#b48a52', D: '#7a5a30', S: '#ffffff' },
  },
};

const BLADES: Array<[string, string, string]> = [
  ['#fff2c0', '#e0b050', '#5a3a10'], // sandsteel
  ['#b8c490', '#7a8a50', '#2a3414'], // bog iron
  ['#ffc090', '#d8703a', '#4a1c0a'], // canyon
  ['#ffffff', '#a8e0ff', '#1e4a7a'], // frost
  ['#fff0a0', '#ff8a20', '#4a120a'], // ember
];

const COATS: Array<[string, string, string, string]> = [
  ['#c8c0a8', '#9c9478', '#6e6650', '#2e2a20'], // traveller
  ['#ecd8a0', '#c8aa64', '#94783e', '#3e2e12'], // sandstrider
  ['#a8b088', '#7a8458', '#525a38', '#1e2414'], // bog iron
  ['#f0a878', '#c8703e', '#8a4620', '#3a1608'], // canyon
  ['#e0f4ff', '#a0d0f0', '#6498c8', '#1a3a5a'], // frostguard
  ['#ffd880', '#f08a30', '#a84a18', '#1a0c08'], // ember
];

export function installItemPainters(): void {
  for (const [name, a] of Object.entries(ITEMS)) register(name, (p) => sprite(p, a.rows, a.pal, a.shine ?? ''), 9000 + name.length);
  BLADES.forEach(([h, l, k], i) => register(`sword_${i + 1}`, (p) => sprite(p, SWORD, { K: k, H: h, L: l, G: '#c8a040', W: '#6a4a2a' }, 'HL'), 9100 + i));
  COATS.forEach(([h, l, m, k], i) => register(`coat_${i}`, (p) => sprite(p, COAT, { K: k, H: h, L: l, M: m }), 9200 + i));
}
