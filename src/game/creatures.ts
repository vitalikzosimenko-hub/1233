// The Long March's new creatures as the renderer draws them: the swamp's drowned and bogged, the
// canyon's breezes, the snowfields' polar bears, the ember wastes' blazes and magma cubes, the
// Brood Queen, and the new folk (iron golems, the wandering trader and his llamas, camels, frogs).
// Each is a Minecraft-style box model on its sheet of the skin atlas (see creature-skins.ts); the
// models live in creature-<kind>.ts files.
import type { Actor } from './entities';
import type { Game } from './game';
import type { MeshBuilder } from './gl';
import type { Vec3 } from './math3d';
import { bodyBasis, flashOf, part, uvs } from './models';
import type { MobLayers } from './models-mobs';
import { drownedModel } from './creature-drowned';
import { boggedModel } from './creature-bogged';
import { blazeModel } from './creature-blaze';
import { magmaCubeModel } from './creature-magmacube';
import { queenModel } from './creature-queen';
import { breezeModel } from './creature-breeze';
import { polarBearModel } from './creature-polarbear';
import { crown, golemModel } from './creature-golem';
import { llamaModel, traderModel } from './creature-folk';
import { camelModel, frogModel } from './creature-folk2';
import { ravagerArmor } from './creature-ravking';
import { veyraModel } from './creature-veyra';
import { officerModel } from './creature-officers';

/** The Slime King's crown and the Ravager King's armour (drawn by the bosses' models). */
export { crown, ravagerArmor };

/** The kinds this module draws. */
export const CREATURE_KINDS = new Set<string>(['drowned', 'bogged', 'breeze', 'polarbear', 'blaze', 'magmacube', 'queen', 'golem', 'wtrader', 'llama', 'camel', 'frog', 'veyra', 'npc']);

type Model = (b: MeshBuilder, L: MobLayers, a: Actor, time: number) => void;

const MODELS: Record<string, Model> = {
  drowned: drownedModel,
  bogged: boggedModel,
  blaze: blazeModel,
  magmacube: magmaCubeModel,
  queen: queenModel,
  breeze: breezeModel,
  polarbear: polarBearModel,
  golem: golemModel,
  wtrader: traderModel,
  llama: llamaModel,
  camel: camelModel,
  frog: frogModel,
  veyra: veyraModel,
  npc: officerModel,
};

/** Stand-in model: one box the size of the creature, on its own skin sheet. */
function block(b: MeshBuilder, a: Actor, skin: string): void {
  const px = a.h / 16;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const w = Math.max(2, (a.hw * 2) / px);
  part(b, o, basis, px, 0, 8, 0, w, 16, w, uvs(skin, 0, 0, 8, 8, 8));
  b.flash = 0;
}

/** Draws a new creature (false: not one of ours). */
export function drawCreature(_game: Game, b: MeshBuilder, L: MobLayers, a: Actor, time: number): boolean {
  if (!CREATURE_KINDS.has(a.kind)) return false;
  const model = MODELS[a.kind];
  if (model) model(b, L, a, time);
  else block(b, a, a.kind);
  b.flash = 0;
  b.emit = 0;
  return true;
}

/** Radius of the soft shadow under a new creature (null: not one of ours; 0: none). */
export function creatureShadow(a: Actor): number | null {
  switch (a.kind) {
    case 'breeze':
    case 'blaze':
    case 'veyra':
      return 0;
    case 'polarbear':
      return 0.85;
    case 'queen':
      return 1.9;
    case 'golem':
      return 0.8;
    case 'llama':
      return 0.55;
    case 'camel':
      return 0.9;
    case 'frog':
      return 0.25;
    case 'magmacube':
      return 0.18 + a.size * 0.24;
    case 'drowned':
    case 'bogged':
    case 'wtrader':
      return 0.42;
    default:
      return null;
  }
}
