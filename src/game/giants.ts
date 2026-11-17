import { B, blockDef } from './blocks';
import { BlockBody, key3 } from './body';
import type { Zone } from './terrain';
import { COLOSSUS_LEGS, GIANT_LEGS, Walker } from './walker';

export type GiantType = 'brute' | 'warden' | 'titan' | 'colossus' | 'dune' | 'frost' | 'magma' | 'hollow' | 'heartcolossus';

export interface Giant {
  body: BlockBody;
  walker: Walker;
  /** Direction the giant walks (unit vector in xz). */
  dirX: number;
  dirZ: number;
  type: GiantType;
  name: string;
  speed: number;
  punch: number;
  attackTimer: number;
  shrugTimer: number;
  contact: boolean;
  dead: boolean;
  /** Local y the punches come from. */
  fistY: number;
  /** Shoved by a ramming fortress (blocks per second, fading). */
  push?: [number, number];
  /** A lair's guardian (its index), asleep until you come near; its size when it lay down. */
  lair?: number;
  dormant?: boolean;
  startCells?: number;
  /** A punch being wound up (seconds left): it rears back, eyes blazing, then lunges. */
  windup: number;
  /** Seconds to its next cannon shot, and the cannon being aimed (its cell) with the aim's countdown. */
  cannonCd: number;
  aimKey: number | null;
  aimT: number;
  /** Seconds to its next thruster charge, and how long the one under way has left. */
  chargeCd: number;
  charge: number;
  /** Both eyes put out: it swings blind. */
  blind: boolean;
  /** The Colossus's fury (0 calm, 1 it has called its creepers, 2 enraged). */
  rage: number;
  /** It has roared its arrival. */
  roared: boolean;
  /** The next punch is a charge's battering blow (harder, once). */
  heavy: boolean;
  /** A Heart Seal's guardian (it does not crumble at dawn; its seal falls with it). */
  guardian?: boolean;
}

const BASE: Record<string, number> = {
  M: B.MOSSY_COBBLE,
  S: B.COBBLE,
  I: B.IRON_BLOCK,
  O: B.OBSIDIAN,
  G: B.GLOWSTONE,
};

// Front silhouettes (columns = width along z, top row first). The giants face -X:
// eyes, cannons and thrusters sit on the front layer, the Heart in the middle one.
const BLUEPRINTS: Record<GiantType, { rows: string[]; depth: number; name: string; speed: number; punch: number; fistRow: number; palette?: Record<string, number> }> = {
  brute: {
    name: 'Moss Brute',
    depth: 3,
    speed: 0.9,
    punch: 5,
    fistRow: 2,
    rows: [
      '.MSM.',
      '.EME.',
      'MSIMT',
      'MMHSM',
      '.MCM.',
      '.SMS.',
      '.M.M.',
    ],
  },
  warden: {
    name: 'Iron Warden',
    depth: 4,
    speed: 0.75,
    punch: 7,
    fistRow: 3,
    rows: [
      '..MSM..',
      '..EME..',
      '..MSM..',
      'MSMIMST',
      'MMIHIMM',
      'MSMCMST',
      '.MSMSM.',
      '.MM.MM.',
      '.SM.MS.',
    ],
  },
  titan: {
    name: 'Creeper Titan',
    depth: 5,
    speed: 0.6,
    punch: 10,
    fistRow: 4,
    rows: [
      '...MSM...',
      '...EME...',
      '...MSM...',
      '..MSMSM..',
      'CMMIIIMMT',
      'SMMIHIMMT',
      '..MCICM..',
      '..MSMSM..',
      '..MM.MM..',
      '..SM.MS..',
      '..II.II..',
      '..MM.MM..',
    ],
  },
  // The Citadel's guardian: obsidian-plated, two cannons and a glowing crown.
  colossus: {
    name: 'Creeper Colossus',
    depth: 6,
    speed: 0.5,
    punch: 14,
    fistRow: 6,
    rows: [
      '....GGG....',
      '....MSM....',
      '....EME....',
      '....MSM....',
      '...MSOSM...',
      '..MOMSMOM..',
      'CMMIIIIIMMC',
      'SOMIIHIIMOS',
      '.TMMIIIMMT.',
      '..MMSOSMM..',
      '...MSOSM...',
      '...OM.MO...',
      '...MM.MM...',
      '...II.II...',
      '...OM.MO...',
      '...OO.OO...',
    ],
  },
  // The seal guardians, built of their lands' stone around the Heart's splinter.
  dune: {
    name: 'Dune Titan',
    depth: 5,
    speed: 0.65,
    punch: 11,
    fistRow: 4,
    palette: { M: B.SANDSTONE, S: B.CUT_SANDSTONE, I: B.TERRACOTTA, O: B.ORANGE_TERRACOTTA },
    rows: [
      '...SMS...',
      '...EME...',
      '...MSM...',
      '..MOMOM..',
      'MMMIIIMMM',
      'SMMIHIMMS',
      'M.MOIOM.M',
      '..MSMSM..',
      '..MM.MM..',
      '..SM.MS..',
      '..OO.OO..',
      '..MM.MM..',
    ],
  },
  frost: {
    name: 'Frost Titan',
    depth: 5,
    speed: 0.6,
    punch: 12,
    fistRow: 5,
    palette: { M: B.PACKED_ICE, S: B.SNOW, I: B.BLUE_ICE, G: B.BLUE_ICE, O: B.PACKED_ICE },
    rows: [
      '..G...G..',
      '..GMSMG..',
      '...EME...',
      '...MSM...',
      '.GMSMSMG.',
      'MMMIIIMMM',
      'SMMIHIMMS',
      '..MIIIM..',
      '..MSMSM..',
      '..MM.MM..',
      '..SM.MS..',
      '..II.II..',
      '..MM.MM..',
    ],
  },
  // The Bramble's wreck walking again: a broken hull on two dead legs, a cabin for a head with the
  // Heart's green in its windows, its cannon still on the bow.
  hollow: {
    name: 'Hollow Strider',
    depth: 6,
    speed: 0.55,
    punch: 12,
    fistRow: 5,
    palette: { M: B.MOSSY_STONE_BRICKS, S: B.SPRUCE_PLANKS, P: B.PLANKS, L: B.SPRUCE_LOG, O: B.MOSSY_COBBLE, G: B.SEAL_CRYSTAL },
    rows: [
      '...G.....G..',
      '..SSSSSS....',
      '..LEPPEL....',
      '..LPPPPL..G.',
      'PPPPPPPPPPPP',
      'MOMMIHIMMOMC',
      'OMMIIIIIMMOM',
      '.MMM....MMM.',
      '..MO....OM..',
      '..MM....MM..',
      '..OM....MO..',
      '..II....II..',
    ],
  },
  // Veyra wearing the Citadel: obsidian and black stone round the Heart, crystal breaking out of it.
  heartcolossus: {
    name: 'Heart Colossus',
    depth: 7,
    speed: 0.5,
    punch: 18,
    fistRow: 7,
    palette: { M: B.BLACKSTONE, S: B.OBSIDIAN, I: B.CRACKED_STONE_BRICKS, O: B.OBSIDIAN, G: B.SEAL_CRYSTAL, K: B.SEAL_CRYSTAL },
    rows: [
      '...G..G..G...',
      '....KSSSK....',
      '....SEMES....',
      '....MSGSM....',
      '...MSOGOSM...',
      '..GMOMKMOMG..',
      'KMMIIIGIIIMMK',
      'SOMIIIHIIIMOS',
      '.KMMIIGIIMMK.',
      '..MMSOGOSMM..',
      '...MSOSOSM...',
      '...OM...MO...',
      '...MM...MM...',
      '...GI...IG...',
      '...OM...MO...',
      '...OO...OO...',
    ],
  },
  magma: {
    name: 'Magma Titan',
    depth: 6,
    speed: 0.5,
    punch: 15,
    fistRow: 6,
    palette: { M: B.BLACKSTONE, S: B.BASALT, I: B.MAGMA, O: B.OBSIDIAN, K: B.MAGMA },
    rows: [
      '....KKK....',
      '....MSM....',
      '....EME....',
      '....MSM....',
      '...MSOSM...',
      '..MOMKMOM..',
      'KMMIIIIIMMK',
      'SOMIIHIIMOS',
      '.KMMIIIMMK.',
      '..MMSOSMM..',
      '...MSOSM...',
      '...OM.MO...',
      '...MM.MM...',
      '...II.II...',
      '...OM.MO...',
      '...OO.OO...',
    ],
  },
};

/**
 * The night's giants are built of the land they stride out of (the Long March): sandstone in the
 * desert, mud brick in the swamp, red rock in the canyons, ice in the snowfields, blackstone in the
 * ember wastes. Their stone is just as hard as the classic mossy giants'.
 */
const LAND_SKIN: Partial<Record<Zone, { name: string; palette: Record<string, number> }>> = {
  desert: { name: 'Sand', palette: { M: B.SANDSTONE, S: B.CUT_SANDSTONE } },
  swamp: { name: 'Mire', palette: { M: B.MUD_BRICKS, S: B.MOSSY_COBBLE } },
  badlands: { name: 'Canyon', palette: { M: B.RED_SANDSTONE, S: B.ORANGE_TERRACOTTA } },
  snow: { name: 'Ice', palette: { M: B.PACKED_ICE, S: B.BLUE_ICE } },
  ember: { name: 'Cinder', palette: { M: B.BLACKSTONE, S: B.BASALT } },
};

function cellFor(ch: string, layer: number, depth: number, palette?: Record<string, number>): number | undefined {
  const front = layer === 0;
  const middle = layer === Math.floor(depth / 2);
  const own = palette?.[ch];
  if (own !== undefined) return own;
  switch (ch) {
    case 'E':
      return front ? B.GIANT_EYE : B.MOSSY_COBBLE;
    case 'H':
      return middle ? B.GIANT_HEART : B.IRON_BLOCK;
    case 'C':
      return front ? B.CANNON : B.COBBLE;
    case 'T':
      return front ? B.THRUSTER : B.COBBLE;
    default:
      return BASE[ch];
  }
}

/** Builds a giant centred on (x, z) facing along (dirX, dirZ), standing on footing (of a land's stone, given one). */
export function createGiant(type: GiantType, x: number, z: number, footing: number, nightScale: number, dirX = -1, dirZ = 0, land?: Zone): Giant {
  const bp = BLUEPRINTS[type];
  const skin = !bp.palette && land ? LAND_SKIN[land] : undefined;
  const body = new BlockBody('giant');
  const height = bp.rows.length;
  const width = bp.rows[0]!.length;
  bp.rows.forEach((row, r) => {
    const ly = height - 1 - r;
    for (let col = 0; col < width; col += 1) {
      for (let layer = 0; layer < bp.depth; layer += 1) {
        const ch = row[col]!;
        const id = cellFor(ch, layer, bp.depth, bp.palette ?? skin?.palette);
        if (id === undefined) continue;
        body.setBlock(layer, ly, col, id);
        // (A land's stone holds as well as the mossy stone it stands in for.)
        const base = skin?.palette[ch] !== undefined ? BASE[ch] : undefined;
        if (base !== undefined) {
          const cell = body.cells.get(key3(layer, ly, col))!;
          cell.maxHp = Math.max(cell.maxHp, blockDef(base).hp);
          cell.hp = cell.maxHp;
        }
      }
    }
  });
  const heart = body.findBlock(B.GIANT_HEART);
  if (heart !== null) {
    const cell = body.cells.get(heart)!;
    cell.maxHp = Math.round(cell.maxHp * nightScale);
    cell.hp = cell.maxHp;
  }
  // Its face (local -x) turned towards where it walks, centred on the spawn point.
  const legs = type === 'colossus' || type === 'magma' || type === 'heartcolossus' ? COLOSSUS_LEGS : GIANT_LEGS;
  body.setYaw(Math.atan2(-dirZ, -dirX));
  body.setCentre(x, z);
  body.y = footing + legs.height + 0.4 - body.floorY;
  body.savePose();
  return {
    body,
    walker: new Walker(legs),
    dirX,
    dirZ,
    type,
    name: skin ? `${skin.name} ${bp.name.split(' ').pop()}` : bp.name,
    speed: bp.speed,
    punch: Math.round(bp.punch * nightScale),
    attackTimer: 1.5,
    shrugTimer: 4,
    contact: false,
    dead: false,
    fistY: height - 1 - bp.fistRow,
    windup: 0,
    cannonCd: 5 + Math.random() * 3,
    aimKey: null,
    aimT: 0,
    chargeCd: 6 + Math.random() * 4,
    charge: 0,
    blind: false,
    rage: 0,
    roared: false,
    heavy: false,
  };
}
