// Skin sheets of the Long March's new creatures (2x Minecraft box-UV sheets on the skin atlas).
// Each creature's painter lives beside its model (creature-<kind>-skin.ts).
import { registerSkins, type Pix } from './textures';
import { paintDrowned } from './creature-drowned-skin';
import { paintBogged } from './creature-bogged-skin';
import { paintBlaze } from './creature-blaze-skin';
import { paintMagmaCube } from './creature-magmacube-skin';
import { paintQueen } from './creature-queen-skin';
import { paintBreeze } from './creature-breeze-skin';
import { paintPolarBear } from './creature-polarbear-skin';
import { paintGolem } from './creature-golem-skin';
import { paintLlama, paintTrader } from './creature-folk-skin';
import { paintCamel, paintFrog } from './creature-folk2-skin';
import { paintRavKing } from './creature-ravking-skin';
import { paintVeyra } from './creature-veyra-skin';
import { paintOfficers } from './creature-officers-skin';

function paintAll(atlas: Pix, origin: (name: string) => [number, number]): void {
  paintDrowned(atlas, origin('drowned'), 12011);
  paintBogged(atlas, origin('bogged'), 12023);
  paintBlaze(atlas, origin('blaze'), 12037);
  paintMagmaCube(atlas, origin('magmacube'), 12041);
  paintQueen(atlas, origin('queen'), 12043);
  paintBreeze(atlas, origin('breeze'), 12049);
  paintPolarBear(atlas, origin('polarbear'), 12053);
  paintGolem(atlas, origin('golem'), origin('golem2'), 12059);
  paintTrader(atlas, origin('wtrader'), 12071);
  paintLlama(atlas, origin('llama'), 12073);
  paintCamel(atlas, origin('camel'), 12079);
  paintFrog(atlas, origin('frog'), 12083);
  paintRavKing(atlas, origin('ravking'), 12097);
  paintVeyra(atlas, origin('veyra'), 12101);
  paintOfficers(atlas, origin);
}

export function installCreatureSkins(): void {
  registerSkins(paintAll);
}
