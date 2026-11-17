import { installCombosTemplateContracts } from './template-contracts';
import {
  installSurfaceTemplate,
  reportGameReadyAfterFirstInteractivePaint,
  type SurfaceProfile,
  type SurfaceSize,
} from './surface-template';
import { boot } from './src/game/boot';

const SURFACE: SurfaceProfile = 'mobile_portrait';
const REFERENCE_SIZE: Readonly<SurfaceSize> | null = Object.freeze({ width: 393, height: 725 });

const surfaceTemplate = installSurfaceTemplate({
  surface: SURFACE,
  referenceSize: REFERENCE_SIZE,
});
const templateContracts = installCombosTemplateContracts({
  profile: SURFACE,
  surfaceTemplate: surfaceTemplate.api,
});

// Ready = textures built, world generated, title art settled, input installed
// and the interactive title screen painted.
void boot({ surface: surfaceTemplate.api, contracts: templateContracts })
  .then(() => reportGameReadyAfterFirstInteractivePaint())
  .catch((error: unknown) => {
    console.error('[block-fortress] boot failed', error);
    templateContracts.gameplay.reportState({ phase: 'error' });
  });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    templateContracts.dispose();
    surfaceTemplate.dispose();
  });
}
