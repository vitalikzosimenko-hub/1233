import type {
  CombosGameplayTestApi,
  CombosLayoutContractApi,
} from './template-contracts';
import type { SurfaceTemplateApi } from './surface-template';

export {};

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage(message: string): void;
    };
    __surfaceTemplate?: Readonly<SurfaceTemplateApi>;
    __combosLayoutContract?: Readonly<CombosLayoutContractApi>;
    __combosGameplayTest?: Readonly<CombosGameplayTestApi>;
  }
}
