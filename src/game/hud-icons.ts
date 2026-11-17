// Pixel-art HUD icons (DOM only, not GPU layers): hearts, hunger, and the action buttons.
import { registerHudIcon, type Pix } from './textures';

function rows(p: Pix, art: string[], palette: Record<string, string>, ox = 0, oy = 0): void {
  art.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const c = palette[row[x]!];
      if (c) p.set(x + ox, y + oy, c);
    }
  });
}

const HEART = [
  '.KK...KK.',
  'KRRK.KRRK',
  'KRWRKRRRK',
  'KRRRRRRRK',
  'KRRRRRRDK',
  '.KRRRRDK.',
  '..KRRDK..',
  '...KDK...',
  '....K....',
];

const DRUM = [
  '......KK.',
  '.....KWWK',
  '....KWWK.',
  '..KKKWK..',
  '.KMMMKK..',
  'KMMHMMK..',
  'KMMMMMK..',
  'KDMMMDK..',
  '.KDDDK...',
  '..KKK....',
];

/** The six Strider crests' emblems (10 wide) on a shield of their colour. */
const CREST_ART: Array<{ field: string; deep: string; mark: string; art: string[] }> = [
  // The Bramble: a thorned leaf.
  { field: '#3a8a3c', deep: '#1f5a24', mark: '#c8f070', art: ['....##....', '...####...', '..##..##..', '.##.##.##.', '.#..##..#.', '...####...', '....##....', '...####...', '....##....', '....##....'] },
  // The Sunstrider: the sun.
  { field: '#c88a14', deep: '#8a5a0a', mark: '#fff0a0', art: ['#...##...#', '.#......#.', '...####...', '..######..', '#.######.#', '#.######.#', '..######..', '...####...', '.#......#.', '#...##...#'] },
  // The Mire Lily: a water lily.
  { field: '#1f8a7a', deep: '#0f5a50', mark: '#e0fff0', art: ['....##....', '...####...', '.#.####.#.', '.########.', '..######..', '#.######.#', '##########', '.########.', '...####...', '..........'] },
  // The Red Hawk: wings spread.
  { field: '#b83a1c', deep: '#7a1e0c', mark: '#ffe0b0', art: ['#........#', '##......##', '###.##.###', '.########.', '..######..', '...####...', '....##....', '...####...', '..##..##..', '..........'] },
  // The Winter Lark: a snowflake.
  { field: '#3a7ac8', deep: '#1e4a8a', mark: '#f0faff', art: ['....##....', '.#..##..#.', '..#.##.#..', '...####...', '##########', '##########', '...####...', '..#.##.#..', '.#..##..#.', '....##....'] },
  // The Ember Queen: a flame.
  { field: '#c8401a', deep: '#7a1e0a', mark: '#ffd040', art: ['.....#....', '....##....', '...###.#..', '..#####...', '..######..', '.#######..', '.########.', '.###..###.', '..##..##..', '...####...'] },
];

function crest(p: Pix, c: (typeof CREST_ART)[number]): void {
  const S = 20;
  for (let y = 1; y < S - 1; y += 1) {
    const half = y < 11 ? 9 : Math.max(0, 9 - (y - 10) * 1.15);
    for (let x = 0; x < S; x += 1) {
      const d = Math.abs(x + 0.5 - S / 2);
      if (d > half) continue;
      const rim = d > half - 1 || y === 1;
      const gilt = d > half - 2 || y === 2;
      p.set(x, y, rim ? '#2a1a08' : gilt ? (x + y < 16 ? '#ffe58a' : '#c8922a') : y < 10 ? c.field : c.deep);
    }
  }
  rows(p, c.art, { '#': c.mark }, 5, 4);
}

export function buildHudIcons(): void {
  CREST_ART.forEach((c, i) => registerHudIcon(`crest_${i}`, 20, (p) => crest(p, c), 80 + i));
  // The Builders' Key: gold, with the six crests' colours set along its shank.
  registerHudIcon('builders_key', 20, (p) => {
    rows(p, [
      '.......KKKKKK.......',
      '......KGGGGGGK......',
      '.....KGGKKKKGGK.....',
      '.....KGK....KGK.....',
      '.....KGK....KGK.....',
      '.....KGGKKKKGGK.....',
      '......KGGGGGGK......',
      '.......KGGGGK.......',
      '........KGGK........',
      '........KGGK........',
      '........KGGK........',
      '........KGGK........',
      '........KGGK........',
      '........KGGK........',
      '........KGGKKK......',
      '........KGGGGGK.....',
      '........KGGKKK......',
      '........KGGGGK......',
      '........KGGKK.......',
      '.........KK.........',
    ], { K: '#2a1a08', G: '#f0c23a' });
    ['#6ae070', '#ffe070', '#60f0d8', '#ff8a4a', '#a8e0ff', '#ff5a2a'].forEach((c, i) => p.set(9 + (i % 2), 8 + i, c));
  }, 90);
  registerHudIcon('ui_heart', 9, (p) => rows(p, HEART, { K: '#1a0606', R: '#e8241c', W: '#ffd0c8', D: '#9c0e0a' }), 1);
  registerHudIcon('ui_heart_half', 9, (p) => {
    rows(p, HEART, { K: '#1a0606', R: '#3a1612', W: '#3a1612', D: '#2a0e0c' });
    rows(p, HEART.map((r) => r.slice(0, 5)), { K: '#1a0606', R: '#e8241c', W: '#ffd0c8', D: '#9c0e0a' });
  }, 2);
  registerHudIcon('ui_heart_empty', 9, (p) => rows(p, HEART, { K: '#1a0606', R: '#3a1612', W: '#4a1e18', D: '#2a0e0c' }), 3);
  registerHudIcon('ui_food', 10, (p) => rows(p, DRUM, { K: '#1e1006', M: '#b5642a', H: '#e8a060', D: '#7a3c14', W: '#f4ecdc' }), 4);
  registerHudIcon('ui_food_half', 10, (p) => {
    rows(p, DRUM, { K: '#1e1006', M: '#3a2414', H: '#3a2414', D: '#2a180c', W: '#5a5048' });
    rows(p, DRUM.map((r) => r.slice(0, 5)), { K: '#1e1006', M: '#b5642a', H: '#e8a060', D: '#7a3c14', W: '#f4ecdc' });
  }, 5);
  registerHudIcon('ui_food_empty', 10, (p) => rows(p, DRUM, { K: '#1e1006', M: '#3a2414', H: '#42291a', D: '#2a180c', W: '#5a5048' }), 6);
  registerHudIcon('ui_villager', 16, (p) => {
    p.rect(3, 2, 10, 12, '#bd8b72');
    p.rect(3, 2, 10, 3, '#6b4a2e');
    p.rect(4, 6, 8, 1, '#3a2a1a');
    p.set(5, 7, '#ffffff');
    p.set(6, 7, '#3a9a3a');
    p.set(10, 7, '#ffffff');
    p.set(9, 7, '#3a9a3a');
    p.rect(7, 8, 2, 5, '#a8765e');
    p.rect(2, 14, 12, 2, '#6b4a2e');
  }, 7);
  registerHudIcon('ui_leap', 16, (p) => {
    const arrow = ['.......##.......', '......####......', '.....######.....', '....########....', '...##########...', '......####......', '......####......', '......####......', '......####......', '......####......'];
    arrow.forEach((row, y) => {
      for (let x = 0; x < 16; x += 1) if (row[x] === '#') p.set(x, y + 2, y < 5 ? '#ffe070' : '#ffb020');
    });
    p.rect(3, 13, 10, 2, '#6aa34f');
  }, 8);
  registerHudIcon('ui_boom', 16, (p, rng) => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const a = Math.atan2(dy, dx);
        const r = Math.sqrt(dx * dx + dy * dy);
        const spike = 5.5 + Math.sin(a * 6) * 2.2 + rng() * 0.6;
        if (r < spike) p.set(x, y, r < 2.5 ? '#ffffff' : r < 4.2 ? '#ffe040' : '#ff7a1a');
      }
    }
  }, 9);
  registerHudIcon('ui_moon', 16, (p) => {
    p.rect(3, 3, 10, 10, '#e8ecf8');
    p.rect(3, 3, 10, 1, '#ffffff');
    p.rect(5, 6, 2, 2, '#b8c0d8');
    p.rect(9, 9, 2, 2, '#b8c0d8');
    p.rect(9, 4, 1, 1, '#c8d0e8');
  }, 10);
  registerHudIcon('ui_sun', 16, (p) => {
    p.rect(3, 3, 10, 10, '#ffe050');
    p.rect(4, 4, 8, 8, '#fff6a0');
    p.rect(1, 7, 2, 2, '#ffd030');
    p.rect(13, 7, 2, 2, '#ffd030');
    p.rect(7, 1, 2, 2, '#ffd030');
    p.rect(7, 13, 2, 2, '#ffd030');
  }, 11);
  registerHudIcon('ui_map', 16, (p) => {
    p.rect(1, 2, 14, 12, '#e8d8a8');
    p.rect(1, 2, 14, 1, '#b89a5a');
    p.rect(1, 13, 14, 1, '#8a6a3a');
    p.rect(5, 2, 1, 12, '#c8b07a');
    p.rect(10, 2, 1, 12, '#c8b07a');
    p.rect(2, 9, 5, 3, '#6aa34f');
    p.rect(8, 4, 4, 3, '#4a7ac8');
    p.rect(11, 9, 2, 2, '#d03020');
    p.set(4, 5, '#d03020');
    p.set(6, 6, '#7a5a3a');
    p.set(8, 8, '#7a5a3a');
  }, 12);
  registerHudIcon('ui_hoist', 16, (p) => {
    p.rect(2, 1, 2, 14, '#8a6038');
    p.rect(2, 1, 12, 2, '#8a6038');
    p.rect(12, 3, 1, 5, '#3a3a40');
    p.rect(10, 8, 5, 2, '#9a9aa0');
    p.rect(9, 10, 7, 5, '#b48a52');
    p.rect(9, 10, 7, 1, '#7a3a2a');
    p.rect(11, 12, 2, 3, '#4a3020');
  }, 13);
  registerHudIcon('ui_wolf', 16, (p) => {
    // Pip's head: grey-white fur, dark eyes, a black nose and the red collar.
    p.rect(3, 3, 10, 9, '#d8d4cc');
    p.rect(3, 3, 10, 1, '#f2f0ea');
    p.rect(2, 1, 3, 3, '#bcb7ae');
    p.rect(11, 1, 3, 3, '#bcb7ae');
    p.set(3, 2, '#d8a0a0');
    p.set(12, 2, '#d8a0a0');
    p.rect(5, 6, 2, 2, '#18181c');
    p.rect(9, 6, 2, 2, '#18181c');
    p.set(5, 6, '#ffffff');
    p.set(9, 6, '#ffffff');
    p.rect(6, 9, 4, 3, '#f4f2ee');
    p.rect(7, 9, 2, 1, '#18161a');
    p.rect(3, 12, 10, 2, '#c92a1f');
    p.set(8, 13, '#f0c84a');
  }, 15);
  registerHudIcon('ui_stomp', 16, (p) => {
    // A mechanical foot slamming down, with a shock wave.
    p.rect(6, 1, 4, 6, '#9a9aa0');
    p.rect(6, 1, 4, 1, '#c8c8cc');
    p.rect(5, 6, 6, 2, '#c8a040');
    p.rect(4, 8, 8, 3, '#7a7a82');
    p.rect(4, 8, 8, 1, '#a8a8b0');
    p.rect(1, 12, 3, 1, '#ffe070');
    p.rect(12, 12, 3, 1, '#ffe070');
    p.rect(0, 14, 4, 1, '#ffb020');
    p.rect(12, 14, 4, 1, '#ffb020');
    p.rect(4, 12, 8, 1, '#5a4a2a');
  }, 16);
  registerHudIcon('ui_eye', 16, (p) => {
    p.rect(2, 6, 12, 4, '#f0f0f0');
    p.rect(4, 5, 8, 6, '#f0f0f0');
    p.rect(6, 5, 4, 6, '#3a7ac8');
    p.rect(7, 6, 2, 4, '#101010');
  }, 14);
  // The third-person view: you from behind, over your shoulder.
  registerHudIcon('ui_view', 16, (p) => rows(p, [
    '................',
    '.....KKKKKK.....',
    '....KhhHHHHK....',
    '....KhHHHHHK....',
    '....KHHHHHHK....',
    '....KHHHHHHK....',
    '....KHHHHHHK....',
    '.....KSSSSK.....',
    '..KKKKKKKKKKKK..',
    '.KttttTTTTttttK.',
    'KtTTTTTTTTTTTTtK',
    'KTTTTTTTTTTTTTTK',
    'KTTTTTTTTTTTTTTK',
    'KTTTTTTTTTTTTTTK',
    'KKKKKKKKKKKKKKKK',
  ], { K: '#0c0c10', H: '#3d3230', h: '#5e4c44', S: '#e8b59a', T: '#24242c', t: '#40404e' }), 15);
  registerHudIcon('ui_hen', 16, (p) => rows(p, [
    '.....RR.........',
    '....RRRR........',
    '....WWWW........',
    '...WWWKW........',
    '...WWWWWYY......',
    '...WWWWWYY......',
    '....WRWW........',
    '....WRWWW....W..',
    '...WWWWWWWWWWW..',
    '..WWWGWWWWWWWW..',
    '..WWGGGWWWWWWW..',
    '..WWWGGGGWWWW...',
    '...WWWWWWWWW....',
    '.....WWWWW......',
    '......Y..Y......',
    '.....YY.YY......',
  ], { R: '#d8261c', W: '#f6f3ea', K: '#16120f', Y: '#f0b020', G: '#c9c4b8' }), 17);
  registerHudIcon('ui_sheep', 16, (p) => rows(p, [
    '................',
    '....WWWWWWWW....',
    '..WWWWWWWWWWWW..',
    '.WWWWWWWWWWWWWW.',
    'SSWWWWWWWWWWWWWW',
    'SKSWWWWWWWWWWWWW',
    'SSSWWWWWWWWWWWWW',
    'SPSWWWWWWWWWWWW.',
    '.WWWWWWWWWWWWWW.',
    '..WWWWWWWWWWWW..',
    '...SS.SS..SS.SS.',
    '...SS.SS..SS.SS.',
    '...DD.DD..DD.DD.',
  ], { W: '#f2f0ea', S: '#e2c0aa', K: '#1a1412', P: '#e08a8a', D: '#3c302a' }, 0, 2), 18);
  registerHudIcon('ui_star', 16, (p) => rows(p, [
    '.......K........',
    '......KYK.......',
    '......KYK.......',
    '.....KYWYK......',
    'KKKKKKYWYKKKKKK.',
    'KYYYYYWWWYYYYYK.',
    '.KYYYYWWWYYYYK..',
    '..KYYYYWYYYYK...',
    '...KYYYYYYYK....',
    '...KYYYYYYYK....',
    '..KYYYYOYYYYK...',
    '..KYYYOKOYYYK...',
    '.KYYOOK.KOOYYK..',
    '.KYOK.....KOYK..',
    'KOOK.......KOOK.',
    'KKK.........KKK.',
  ], { K: '#2a1a04', Y: '#ffd23a', W: '#fff6c0', O: '#e08a14' }), 19);
  // The parachute: a red-and-white canopy, its lines down to a little builder.
  registerHudIcon('ui_chute', 16, (p) => rows(p, [
    '.....KKKKKK.....',
    '...KKRRWWRRKK...',
    '..KWRRRWWRRRWK..',
    '.KWWRRRWWRRRWWK.',
    'KWWWRRRWWRRRWWWK',
    'KDDDEEEDDEEEDDDK',
    'L..L........L..L',
    '.L..L......L..L.',
    '..L..L....L..L..',
    '...L..L..L..L...',
    '....L.LHHL.L....',
    '......LSSL......',
    '.......TT.......',
    '......TTTT......',
    '.......BB.......',
    '.......B.B......',
  ], { K: '#2a0a06', R: '#e0281c', W: '#f4f0e6', D: '#b8b0a0', E: '#9a1a12', L: '#d8d0b8', H: '#4e331b', S: '#e6b590', T: '#22a29c', B: '#36458c' }), 20);
  buildOnlineIcons();
  buildEffectIcons();
}

/** Cloud saves and co-op: the cloud, two crewmates, the gunner's sights, the helm, a shout. */
function buildOnlineIcons(): void {
  registerHudIcon('ui_cloud', 16, (p) => rows(p, [
    '................',
    '................',
    '......KKKK......',
    '.....KWWWWK.....',
    '..KKKWWWWWWK....',
    '.KWWWWWWWWWWKK..',
    '.KWWWWWWWWWWWWK.',
    'KWWWWWWBWWWWWWWK',
    'KWWWWWBBBWWWWWWK',
    'KWWWWBBBBBWWWWWK',
    'KSWWWWWBWWWWWWSK',
    '.KSSSSSBSSSSSSK.',
    '..KKKKKKKKKKKK..',
  ], { K: '#14202e', W: '#f2f6fa', S: '#b8c8d8', B: '#2a8ae0' }), 60);
  registerHudIcon('ui_coop', 16, (p) => rows(p, [
    '................',
    '..KKKK..........',
    '.KHHHHK...KKKK..',
    '.KSSSSK..KRRRRK.',
    '.KEWEWK..KSSSSK.',
    '.KSSSSK..KEWEWK.',
    '..KSSK...KSSSSK.',
    '.KTTTTK...KSSK..',
    'KTTTTTTK.KCCCCK.',
    'KTTTTTTKKCCCCCCK',
    'KTTTTTTKKCCCCCCK',
    'KTTTTTTKKCCCCCCK',
    'KKKKKKKKKKKKKKKK',
  ], { K: '#14100c', H: '#4e331b', R: '#c8641e', S: '#d69d78', E: '#3a5ab0', W: '#ffffff', T: '#168483', C: '#b8282c' }), 61);
  registerHudIcon('ui_gunner', 16, (p) => rows(p, [
    '.......KK.......',
    '.......RR.......',
    '....KKKRRKKK....',
    '...KR..RR..RK...',
    '..KR...RR...RK..',
    '..K....KK....K..',
    'KRRRRKK.WKKRRRRK',
    'KRRRRKKW.KKRRRRK',
    '..K....KK....K..',
    '..KR...RR...RK..',
    '...KR..RR..RK...',
    '....KKKRRKKK....',
    '.......RR.......',
    '.......KK.......',
  ], { K: '#1a0806', R: '#ff4a32', W: '#ffffff' }), 62);
  registerHudIcon('ui_helm', 16, (p) => rows(p, [
    '.......KK.......',
    '...KK..WW..KK...',
    '...KWK.WW.KWK...',
    '....KWKWWKWK....',
    '.....KWWWWK.....',
    '.KK.KWBBBBWK.KK.',
    'KWWWWWBKKBWWWWWK',
    'KWWWWWBKKBWWWWWK',
    '.KK.KWBBBBWK.KK.',
    '.....KWWWWK.....',
    '....KWKWWKWK....',
    '...KWK.WW.KWK...',
    '...KK..WW..KK...',
    '.......KK.......',
  ], { K: '#2a1606', W: '#b07a3e', B: '#ffd23a' }), 63);
  registerHudIcon('ui_chat', 16, (p) => rows(p, [
    '................',
    '.KKKKKKKKKKKKKK.',
    'KWWWWWWWWWWWWWWK',
    'KWWWWWWWWWWWWWWK',
    'KWWDDWWDDWWDDWWK',
    'KWWDDWWDDWWDDWWK',
    'KWWWWWWWWWWWWWWK',
    'KWWWWWWWWWWWWWWK',
    '.KKKKWWKKKKKKKK.',
    '....KWWK........',
    '....KWK.........',
    '....KK..........',
  ], { K: '#14100c', W: '#fff6dc', D: '#3a3a3a' }), 64);
}

const DROP = [
  '.....KK.....',
  '....KGGK....',
  '...KGGGGK...',
  '...KGHGGK...',
  '..KGHHGGGK..',
  '..KGHGGGGK..',
  '.KGGGGGGGDK.',
  '.KGGGGGGGDK.',
  '.KGGGGGGDDK.',
  '..KGGGGDDK..',
  '...KKDDDK...',
  '....KKKK....',
];

const BLADE = [
  '.........KK.',
  '........KWK.',
  '.......KWRK.',
  '......KWRK..',
  '.....KWRK...',
  '..K.KWRK....',
  '..KKWRK.....',
  '...KRK......',
  '..KYKKK.....',
  '.KYK..K.....',
  'KYK.........',
  'KK..........',
];

/** The status effects' icons (Minecraft's little squares: what is on you, and for how long). */
function buildEffectIcons(): void {
  registerHudIcon('fx_swift', 12, (p) => rows(p, [
    '............',
    '.....WWW....',
    '.......WW...',
    '.WWWWWWWWW..',
    '........WWW.',
    '..WWWWWWWWWW',
    '........WWW.',
    '.WWWWWWWWW..',
    '.......WW...',
    '.....WWW....',
    '............',
    '............',
  ], { W: '#a8e0f0' }), 47);
  registerHudIcon('fx_fireward', 12, (p) => rows(p, [
    '.....R......',
    '....RR......',
    '....RRR.R...',
    '...RROR.R...',
    '..RROORRR...',
    '..ROOOORRR..',
    '.RROOYOORR..',
    '.RROYYYORR..',
    '.RROYYYORR..',
    '..RROYORR...',
    '...RRRRR....',
    '............',
  ], { R: '#d84a1a', O: '#f09030', Y: '#ffe070' }), 48);
  registerHudIcon('fx_frostward', 12, (p) => rows(p, [
    '.....B......',
    '..B..B..B...',
    '...B.B.B....',
    '....BBB.....',
    '.BBBBWBBBB..',
    '....BBB.....',
    '...B.B.B....',
    '..B..B..B...',
    '.....B......',
    '............',
    '............',
    '............',
  ], { B: '#a8e0ff', W: '#ffffff' }), 49);
  registerHudIcon('fx_poison', 12, (p) => rows(p, DROP, { K: '#10200a', G: '#5eb83a', H: '#c8f4a0', D: '#2f6a1c' }), 40);
  registerHudIcon('fx_wither', 9, (p) => rows(p, HEART, { K: '#000000', R: '#2c2626', W: '#7a7070', D: '#141010' }), 41);
  registerHudIcon('fx_regen', 9, (p) => rows(p, HEART, { K: '#2a0620', R: '#e05cb0', W: '#ffd6f2', D: '#9a2a78' }), 42);
  registerHudIcon('fx_strength', 12, (p) => rows(p, BLADE, { K: '#1a0808', W: '#ffb8a8', R: '#c8281c', Y: '#8a5a2a' }), 43);
  registerHudIcon('fx_weakness', 12, (p) => {
    rows(p, BLADE, { K: '#121212', W: '#bdbdbd', R: '#6a6a6a', Y: '#5a4a3a' });
    // Snapped near the hilt.
    p.set(5, 5, '#121212');
    p.set(6, 4, '#121212');
  }, 44);
  registerHudIcon('fx_slowness', 12, (p) => rows(p, [
    '....KKKK....',
    '....KSSK....',
    '....KSSK....',
    '....KSSK....',
    '.KKKKSSKKKK.',
    '.KSSSSSSSSK.',
    '..KSSSSSSK..',
    '...KSSSSK...',
    '....KSSK....',
    '.....KK.....',
    '............',
    'KKKKKKKKKKKK',
  ], { K: '#141c26', S: '#8aa4c8' }), 45);
  registerHudIcon('fx_hunger', 10, (p) => rows(p, DRUM, { K: '#14200a', M: '#6a8a3a', H: '#a8c868', D: '#3a5a20', W: '#e0e8c0' }), 46);
  registerHudIcon('fx_resistance', 12, (p) => rows(p, [
    '.KKKKKKKKKK.',
    'KSSSSSSSSSSK',
    'KSHHSSSSSSDK',
    'KSHSSSSSSSDK',
    'KSSSSRRSSSDK',
    'KSSSRRRRSSDK',
    '.KSSSRRSSDK.',
    '.KSSSSSSSDK.',
    '..KSSSSSDK..',
    '...KSSSDK...',
    '....KSDK....',
    '.....KK.....',
  ], { K: '#1a1010', S: '#a85a48', H: '#e0a890', D: '#6a3024', R: '#e8d070' }), 47);
  registerHudIcon('fx_omen', 12, (p) => rows(p, [
    'KKKKKKKKKKKK',
    '.KWWWWWWWWK.',
    '.KWTTWWTTWK.',
    '.KWWTWWTWWK.',
    '.KWWWWWWWWK.',
    '.KWWKKKKWWK.',
    '.KWKWWWWKWK.',
    '.KWWWWWWWWK.',
    '.KWWWTTWWWK.',
    '.KWWTWWTWWK.',
    '..KKK..KKK..',
    '............',
  ], { W: '#e8e4da', K: '#20201e', T: '#1f8a7a' }), 48);
  registerHudIcon('fx_hero', 12, (p) => rows(p, [
    '....KKKK....',
    '...KHHGGK...',
    '..KHHGGGGK..',
    '.KHGGGGGGGK.',
    'KGGGGGGGGGDK',
    'KGGGGGGGGDDK',
    '.KGGGGGGDDK.',
    '..KGGGGDDK..',
    '...KGGDDK...',
    '....KDDK....',
    '.....KK.....',
    '............',
  ], { K: '#0a2a12', H: '#b8ffc8', G: '#3ad860', D: '#1a8a3a' }), 49);
  registerHudIcon('fx_beacon', 12, (p) => rows(p, [
    '.....CC.....',
    '.....CC.....',
    '....CWWC....',
    '.....CC.....',
    '.....CC.....',
    '.....CC.....',
    '....KCCK....',
    '...KGGGGK...',
    '..KGCWWCGK..',
    '..KGWCCWGK..',
    '..KGGGGGGK..',
    '..KKKKKKKK..',
  ], { C: '#7fe8ff', W: '#ffffff', G: '#3a4a5a', K: '#10161c' }), 50);
}
