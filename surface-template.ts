export type SurfaceProfile = 'pc' | 'mobile_portrait' | 'mobile_landscape';

export interface SurfaceSize {
  width: number;
  height: number;
}

export interface SurfaceRect extends SurfaceSize {
  x: number;
  y: number;
}

export interface SurfaceInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SurfaceMetrics {
  viewportWidth: number;
  viewportHeight: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  pixelWidth: number;
  pixelHeight: number;
  referenceWidth: number;
  referenceHeight: number;
  surfaceWidth: number;
  surfaceHeight: number;
  fitScale: number;
  renderScale: number;
  fitWidth: number;
  fitHeight: number;
  offsetX: number;
  offsetY: number;
  referenceOffsetX: number;
  referenceOffsetY: number;
  referenceRect: SurfaceRect;
  safeAreaInsets: SurfaceInsets;
  viewportSafeAreaInsets: SurfaceInsets;
  /**
   * The surface lies turned a quarter clockwise across an upright screen (a landscape surface asked
   * for with setLandscape): viewport sizes and insets are then the surface's own, not the screen's.
   */
  turned: boolean;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export type SurfaceMetricsSubscriber = (metrics: SurfaceMetrics) => void;

export interface SurfaceTemplateApi {
  readonly version: 2;
  readonly surface: SurfaceProfile;
  readonly viewport: HTMLElement;
  readonly root: HTMLElement;
  readonly referenceSize: Readonly<SurfaceSize> | null;
  readonly maxDpr: number;
  getMetrics(): SurfaceMetrics;
  refresh(): SurfaceMetrics;
  subscribe(callback: SurfaceMetricsSubscriber): () => void;
  /** Asks for a landscape surface: on an upright screen it is turned a quarter (see `turned`). */
  setLandscape(on: boolean): void;
  /** A client (screen) point in viewport coordinates: the surface's own, turned or not. */
  toViewportPoint(clientX: number, clientY: number): ViewportPoint;
  /** A client (screen) movement in viewport coordinates. */
  toViewportDelta(dx: number, dy: number): ViewportPoint;
  /** A client (screen) rectangle, such as a bounding client rect, in viewport coordinates. */
  toViewportRect(rect: { left: number; top: number; width: number; height: number }): SurfaceRect;
}

export interface InstallSurfaceTemplateOptions {
  surface: SurfaceProfile;
  referenceSize: Readonly<SurfaceSize> | null;
  maxDpr?: number;
}

export interface InstalledSurfaceTemplate {
  api: Readonly<SurfaceTemplateApi>;
  dispose(): void;
}

const DEFAULT_MAX_DPR = 3;
const GAME_READY_MESSAGE = Object.freeze({ type: 'combos:game-ready-v1' } as const);

function cloneMetrics(metrics: SurfaceMetrics): SurfaceMetrics {
  return {
    ...metrics,
    referenceRect: { ...metrics.referenceRect },
    safeAreaInsets: { ...metrics.safeAreaInsets },
    viewportSafeAreaInsets: { ...metrics.viewportSafeAreaInsets },
  };
}

/** Screen insets as seen from a surface turned a quarter clockwise. */
function turnInsets(insets: SurfaceInsets): SurfaceInsets {
  return { top: insets.right, right: insets.bottom, bottom: insets.left, left: insets.top };
}

function readViewportSafeAreaInsets(viewport: HTMLElement): SurfaceInsets {
  const style = typeof window.getComputedStyle === 'function'
    ? window.getComputedStyle(viewport)
    : null;
  const readInset = (name: string): number => {
    const value = Number.parseFloat(style?.getPropertyValue(name) || '0');
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };

  return {
    top: readInset('--surface-viewport-safe-top'),
    right: readInset('--surface-viewport-safe-right'),
    bottom: readInset('--surface-viewport-safe-bottom'),
    left: readInset('--surface-viewport-safe-left'),
  };
}

export function installSurfaceTemplate({
  surface,
  referenceSize,
  maxDpr = DEFAULT_MAX_DPR,
}: InstallSurfaceTemplateOptions): InstalledSurfaceTemplate {
  const viewportElement = document.querySelector('#viewport');
  const rootElement = document.querySelector('#app');

  if (!(viewportElement instanceof HTMLElement)) {
    throw new Error('Game viewport #viewport is required');
  }
  if (!(rootElement instanceof HTMLElement)) {
    throw new Error('Game root #app is required');
  }

  const viewport = viewportElement;
  const root = rootElement;

  // A landscape surface on an upright screen lies turned a quarter clockwise across it (index.html's
  // #viewport.surface-turned): the player turns the device on its side. Turned or not, the
  // viewport's bounding box is the screen's.
  let landscape = false;
  let turned = false;
  let screenBox = { left: 0, top: 0, right: 1, bottom: 1 };

  /** Turns the surface (or not) for the screen as it is now; true when that changed. */
  function syncTurn(): boolean {
    const page = document.documentElement;
    const want = landscape && page.clientHeight > page.clientWidth;
    if (want === turned) return false;
    turned = want;
    viewport.classList.toggle('surface-turned', want);
    return true;
  }

  function readMetrics(): SurfaceMetrics {
    const rect = viewport.getBoundingClientRect();
    screenBox = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    // (Turned, the surface's width runs down the screen.)
    const viewportWidth = Math.max(1, turned ? rect.height : rect.width);
    const viewportHeight = Math.max(1, turned ? rect.width : rect.height);
    const rawDpr = Number(window.devicePixelRatio);
    const dpr = Math.min(
      Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1,
      maxDpr,
    );
    const referenceWidth = referenceSize?.width ?? viewportWidth;
    const referenceHeight = referenceSize?.height ?? viewportHeight;
    const fitScale = Math.min(
      viewportWidth / referenceWidth,
      viewportHeight / referenceHeight,
    );
    const surfaceWidth = viewportWidth / fitScale;
    const surfaceHeight = viewportHeight / fitScale;
    const fitWidth = referenceWidth * fitScale;
    const fitHeight = referenceHeight * fitScale;
    const referenceOffsetX = (surfaceWidth - referenceWidth) / 2;
    const referenceOffsetY = (surfaceHeight - referenceHeight) / 2;
    const screenInsets = readViewportSafeAreaInsets(viewport);
    const viewportSafeAreaInsets = turned ? turnInsets(screenInsets) : screenInsets;
    const safeAreaInsets: SurfaceInsets = {
      top: viewportSafeAreaInsets.top / fitScale,
      right: viewportSafeAreaInsets.right / fitScale,
      bottom: viewportSafeAreaInsets.bottom / fitScale,
      left: viewportSafeAreaInsets.left / fitScale,
    };

    return {
      viewportWidth,
      viewportHeight,
      cssWidth: viewportWidth,
      cssHeight: viewportHeight,
      dpr,
      pixelWidth: Math.round(viewportWidth * dpr),
      pixelHeight: Math.round(viewportHeight * dpr),
      referenceWidth,
      referenceHeight,
      surfaceWidth,
      surfaceHeight,
      fitScale,
      renderScale: fitScale * dpr,
      fitWidth,
      fitHeight,
      offsetX: referenceOffsetX * fitScale,
      offsetY: referenceOffsetY * fitScale,
      referenceOffsetX,
      referenceOffsetY,
      referenceRect: {
        x: referenceOffsetX,
        y: referenceOffsetY,
        width: referenceWidth,
        height: referenceHeight,
      },
      safeAreaInsets,
      viewportSafeAreaInsets,
      turned,
    };
  }

  function applyMetrics(metrics: SurfaceMetrics): void {
    root.style.width = `${metrics.surfaceWidth}px`;
    root.style.height = `${metrics.surfaceHeight}px`;
    root.style.left = '0px';
    root.style.top = '0px';
    root.style.transform = `scale(${metrics.fitScale})`;
    root.style.setProperty('--surface-dpr', String(metrics.dpr));
    root.style.setProperty('--surface-fit-scale', String(metrics.fitScale));
    root.style.setProperty('--surface-render-scale', String(metrics.renderScale));
    root.style.setProperty('--surface-css-width', `${metrics.cssWidth}px`);
    root.style.setProperty('--surface-css-height', `${metrics.cssHeight}px`);
    root.style.setProperty('--surface-width', `${metrics.surfaceWidth}px`);
    root.style.setProperty('--surface-height', `${metrics.surfaceHeight}px`);
    root.style.setProperty('--surface-reference-width', `${metrics.referenceWidth}px`);
    root.style.setProperty('--surface-reference-height', `${metrics.referenceHeight}px`);
    root.style.setProperty('--surface-reference-offset-x', `${metrics.referenceOffsetX}px`);
    root.style.setProperty('--surface-reference-offset-y', `${metrics.referenceOffsetY}px`);
    root.style.setProperty('--surface-safe-top', `${metrics.safeAreaInsets.top}px`);
    root.style.setProperty('--surface-safe-right', `${metrics.safeAreaInsets.right}px`);
    root.style.setProperty('--surface-safe-bottom', `${metrics.safeAreaInsets.bottom}px`);
    root.style.setProperty('--surface-safe-left', `${metrics.safeAreaInsets.left}px`);
  }

  const subscribers = new Set<SurfaceMetricsSubscriber>();
  let currentMetrics = readMetrics();

  function refresh(): SurfaceMetrics {
    syncTurn();
    currentMetrics = readMetrics();
    applyMetrics(currentMetrics);
    for (const callback of [...subscribers]) {
      try {
        callback(cloneMetrics(currentMetrics));
      } catch (error) {
        console.error('[surface-template] subscriber failed', error);
      }
    }
    return cloneMetrics(currentMetrics);
  }

  function subscribe(callback: SurfaceMetricsSubscriber): () => void {
    if (typeof callback !== 'function') {
      throw new TypeError('Surface subscriber must be a function');
    }

    callback(cloneMetrics(currentMetrics));
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }

  function setLandscape(on: boolean): void {
    if (on === landscape) return;
    landscape = on;
    refresh();
  }

  function toViewportPoint(clientX: number, clientY: number): ViewportPoint {
    const b = screenBox;
    return turned ? { x: clientY - b.top, y: b.right - clientX } : { x: clientX - b.left, y: clientY - b.top };
  }

  function toViewportDelta(dx: number, dy: number): ViewportPoint {
    return turned ? { x: dy, y: -dx } : { x: dx, y: dy };
  }

  function toViewportRect(rect: { left: number; top: number; width: number; height: number }): SurfaceRect {
    const b = screenBox;
    if (!turned) return { x: rect.left - b.left, y: rect.top - b.top, width: rect.width, height: rect.height };
    return { x: rect.top - b.top, y: b.right - (rect.left + rect.width), width: rect.height, height: rect.width };
  }

  const resizeObserver = new ResizeObserver(refresh);
  resizeObserver.observe(viewport);
  // The page itself: a screen turned upright or on its side turns the surface with it. (Refreshed
  // here: turned one way on an upright screen and level on the same screen on its side, the surface
  // keeps its size, and its own observer would not see the change.)
  const pageObserver = new ResizeObserver(() => {
    if (syncTurn()) refresh();
  });
  pageObserver.observe(document.documentElement);
  applyMetrics(currentMetrics);

  const api: Readonly<SurfaceTemplateApi> = Object.freeze({
    version: 2,
    surface,
    viewport,
    root,
    referenceSize,
    maxDpr,
    getMetrics: () => cloneMetrics(currentMetrics),
    refresh,
    subscribe,
    setLandscape,
    toViewportPoint,
    toViewportDelta,
    toViewportRect,
  });

  window.__surfaceTemplate = api;

  return {
    api,
    dispose() {
      resizeObserver.disconnect();
      pageObserver.disconnect();
      subscribers.clear();
      if (window.__surfaceTemplate === api) {
        delete window.__surfaceTemplate;
      }
    },
  };
}

export function reportGameReadyAfterFirstInteractivePaint(): void {
  let reported = false;
  const report = (): void => {
    if (reported) return;
    reported = true;

    try {
      if (typeof window.ReactNativeWebView?.postMessage === 'function') {
        window.ReactNativeWebView.postMessage(JSON.stringify(GAME_READY_MESSAGE));
      }
    } catch {
      // Ready reporting is best-effort and must never break the game.
    }

    try {
      if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
        window.parent.postMessage(GAME_READY_MESSAGE, '*');
      }
    } catch {
      // Ready reporting is best-effort and must never break the game.
    }
  };

  const scheduleFrame = (callback: () => void): number => (
    typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(() => callback())
      : window.setTimeout(callback, 16)
  );

  // Let the game paint its first interactive state, then notify the host after
  // the browser has had another frame to commit it.
  scheduleFrame(() => scheduleFrame(report));
}
