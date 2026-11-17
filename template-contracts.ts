import type {
  SurfaceMetrics,
  SurfaceProfile,
  SurfaceRect,
  SurfaceTemplateApi,
} from './surface-template';

const LAYOUT_SCHEMA_VERSION = 'combos.layout-contract.v1' as const;
const GAMEPLAY_SCHEMA_VERSION = 'combos.gameplay-test.v1' as const;
const MAX_REGIONS = 128;
const MAX_EVENTS = 64;

const REGION_ROLE_VALUES = [
  'gameplay',
  'hud',
  'controls',
  'modal',
  'text',
  'decorative',
] as const;

const GAMEPLAY_PHASE_VALUES = [
  'unknown',
  'loading',
  'ready',
  'playing',
  'paused',
  'won',
  'lost',
  'retrying',
  'error',
] as const;

const GAMEPLAY_OUTCOME_VALUES = ['none', 'victory', 'defeat'] as const;
const GAMEPLAY_ACTION_VALUES = ['start', 'primary', 'victory', 'defeat', 'retry'] as const;
const GAMEPLAY_EVENT_VALUES = [
  'loading_complete',
  'game_started',
  'primary_input',
  'victory',
  'defeat',
  'retry',
  'visual_feedback',
  'audio_feedback',
  'state_restored',
] as const;

export type RegionRole = (typeof REGION_ROLE_VALUES)[number];
export type GameplayPhase = (typeof GAMEPLAY_PHASE_VALUES)[number];
export type GameplayOutcome = (typeof GAMEPLAY_OUTCOME_VALUES)[number];
export type GameplayActionName = (typeof GAMEPLAY_ACTION_VALUES)[number];
export type GameplayEventType = (typeof GAMEPLAY_EVENT_VALUES)[number];

const REGION_ROLES = new Set<string>(REGION_ROLE_VALUES);
const GAMEPLAY_PHASES = new Set<string>(GAMEPLAY_PHASE_VALUES);
const GAMEPLAY_OUTCOMES = new Set<string>(GAMEPLAY_OUTCOME_VALUES);
const GAMEPLAY_ACTIONS = new Set<string>(GAMEPLAY_ACTION_VALUES);
const GAMEPLAY_EVENTS = new Set<string>(GAMEPLAY_EVENT_VALUES);

interface ProfileRules {
  minimumGutterCSSPX: number;
  hudBandCSSPX: number;
  controlsBandCSSPX: number;
  minimumInteractiveCSSPX: number;
  minimumTextCSSPX: number;
}

const PROFILE_RULES: Readonly<Record<SurfaceProfile, Readonly<ProfileRules>>> = Object.freeze({
  pc: Object.freeze({
    minimumGutterCSSPX: 16,
    hudBandCSSPX: 72,
    controlsBandCSSPX: 0,
    minimumInteractiveCSSPX: 32,
    minimumTextCSSPX: 12,
  }),
  mobile_portrait: Object.freeze({
    minimumGutterCSSPX: 12,
    hudBandCSSPX: 64,
    controlsBandCSSPX: 120,
    minimumInteractiveCSSPX: 44,
    minimumTextCSSPX: 12,
  }),
  mobile_landscape: Object.freeze({
    minimumGutterCSSPX: 12,
    hudBandCSSPX: 56,
    controlsBandCSSPX: 96,
    minimumInteractiveCSSPX: 44,
    minimumTextCSSPX: 12,
  }),
});

export interface LayoutViewport {
  width: number;
  height: number;
  dpr: number;
}

export interface LayoutZones {
  hud: SurfaceRect;
  gameplay: SurfaceRect;
  controls: SurfaceRect;
}

export interface LayoutRules {
  root_must_fill_viewport: true;
  critical_ui_within_safe_rect: true;
  disallow_critical_ui_overlap: true;
  minimum_gutter_css_px: number;
  minimum_interactive_css_px: number;
  minimum_text_css_px: number;
}

export interface LayoutRegion {
  id: string;
  role: RegionRole;
  critical: boolean;
  interactive: boolean;
  visible: boolean;
  content_overflow: boolean;
  occluded: boolean;
  font_size_css_px: number;
  allows_overlap_with: string[];
  rect: SurfaceRect;
  source: 'dom' | 'registered';
}

export interface LayoutSnapshot {
  schema_version: typeof LAYOUT_SCHEMA_VERSION;
  target_profile: SurfaceProfile;
  active_profile: SurfaceProfile;
  orientation: 'landscape' | 'portrait';
  viewport: LayoutViewport;
  reference_rect: SurfaceRect;
  safe_rect: SurfaceRect;
  zones: LayoutZones;
  rules: LayoutRules;
  regions: LayoutRegion[];
}

export interface RegisteredRegionSpec {
  id: string;
  role: RegionRole;
  getRect(): unknown;
  coordinateSpace?: 'surface' | 'viewport';
  critical?: boolean;
  interactive?: boolean;
  visible?: boolean | (() => boolean);
  contentOverflow?: boolean | (() => boolean);
  occluded?: boolean | (() => boolean);
  fontSizeCSSPX?: number;
  allowsOverlapWith?: string[];
}

interface StoredRegion {
  id: string;
  role: RegionRole;
  getRect(): unknown;
  coordinateSpace: 'surface' | 'viewport';
  critical: boolean;
  interactive: boolean;
  visible(): boolean;
  contentOverflow(): boolean;
  occluded(): boolean;
  fontSizeCSSPX: number;
  allowsOverlapWith: string[];
}

export type GameplayActionBinding =
  | Readonly<{ type: 'callback' }>
  | Readonly<{ type: 'keyboard'; key: string; selector?: string }>
  | Readonly<{ type: 'selector'; selector: string }>
  | Readonly<{ type: 'pointer' | 'touch'; selector: string; x: number; y: number }>;

export type GameplayActionHandler = () => unknown | Promise<unknown>;

export interface GameplayState {
  phase: GameplayPhase;
  loading_complete: boolean;
  input_ready: boolean;
  core_loop_started: boolean;
  outcome: GameplayOutcome;
  retry_available: boolean;
  persisted_state_loaded: boolean;
}

export type GameplayStatePatch = Partial<GameplayState>;

export interface GameplayEventRecord {
  sequence: number;
  type: GameplayEventType;
}

export interface GameplaySnapshot {
  schema_version: typeof GAMEPLAY_SCHEMA_VERSION;
  state: GameplayState;
  registered_actions: GameplayActionName[];
  events: GameplayEventRecord[];
}

export interface GameplayProbePlan {
  bindings: Partial<Record<GameplayActionName, GameplayActionBinding>>;
}

export interface CombosLayoutContractApi {
  readonly schemaVersion: typeof LAYOUT_SCHEMA_VERSION;
  readonly targetProfile: SurfaceProfile;
  getSnapshot(): LayoutSnapshot;
  registerRegion(spec: RegisteredRegionSpec): () => void;
}

export interface CombosGameplayTestApi {
  readonly schemaVersion: typeof GAMEPLAY_SCHEMA_VERSION;
  reportState(patch: GameplayStatePatch): GameplayState;
  reportEvent(type: GameplayEventType): GameplayState;
  registerAction(
    name: GameplayActionName,
    handler: GameplayActionHandler,
    binding?: GameplayActionBinding,
  ): () => void;
  invokeAction(name: GameplayActionName): Promise<unknown>;
  getSnapshot(): GameplaySnapshot;
  getProbePlan(): GameplayProbePlan;
}

export interface InstalledCombosTemplateContracts {
  layout: Readonly<CombosLayoutContractApi>;
  gameplay: Readonly<CombosGameplayTestApi>;
  dispose(): void;
}

export interface InstallCombosTemplateContractsOptions {
  profile: SurfaceProfile;
  surfaceTemplate: Readonly<SurfaceTemplateApi>;
  windowObject?: Window;
  documentObject?: Document;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRegionRole(value: string): value is RegionRole {
  return REGION_ROLES.has(value);
}

function isGameplayPhase(value: string): value is GameplayPhase {
  return GAMEPLAY_PHASES.has(value);
}

function isGameplayOutcome(value: string): value is GameplayOutcome {
  return GAMEPLAY_OUTCOMES.has(value);
}

function isGameplayAction(value: string): value is GameplayActionName {
  return GAMEPLAY_ACTIONS.has(value);
}

function isGameplayEvent(value: string): value is GameplayEventType {
  return GAMEPLAY_EVENTS.has(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedName(value: unknown, fallback: string): string {
  const name = String(value || '').trim().slice(0, 64);
  return /^[A-Za-z0-9_.:-]+$/.test(name) ? name : fallback;
}

function sanitizeActionBinding(
  actionName: string,
  rawBinding: unknown,
): GameplayActionBinding {
  if (!rawBinding || !isRecord(rawBinding)) {
    return Object.freeze({ type: 'callback' });
  }
  const type = boundedName(rawBinding.type, '');
  const selector = String(rawBinding.selector || '').trim().slice(0, 256);
  if (type === 'keyboard') {
    const key = String(rawBinding.key || '').trim().slice(0, 32);
    if (!key) throw new TypeError(`Gameplay action ${actionName} keyboard binding requires key`);
    return Object.freeze({ type, key, ...(selector ? { selector } : {}) });
  }
  if (type === 'selector') {
    if (!selector) throw new TypeError(`Gameplay action ${actionName} selector binding requires selector`);
    return Object.freeze({ type, selector });
  }
  if (type === 'pointer' || type === 'touch') {
    return Object.freeze({
      type,
      selector: selector || 'canvas',
      x: Math.max(0, Math.min(1, finiteNumber(rawBinding.x, 0.5))),
      y: Math.max(0, Math.min(1, finiteNumber(rawBinding.y, 0.5))),
    });
  }
  if (type === 'callback') return Object.freeze({ type });
  throw new TypeError(`Unsupported gameplay action binding for ${actionName}: ${type}`);
}

function rectFrom(value: unknown): SurfaceRect {
  const rect = isRecord(value) ? value : {};
  return {
    x: finiteNumber(rect.x ?? rect.left),
    y: finiteNumber(rect.y ?? rect.top),
    width: Math.max(0, finiteNumber(rect.width)),
    height: Math.max(0, finiteNumber(rect.height)),
  };
}

function scaleRect(rect: SurfaceRect, scale: number): SurfaceRect {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function layoutGeometry(
  profile: SurfaceProfile,
  metrics: SurfaceMetrics,
  coarsePointer: boolean,
): Omit<LayoutSnapshot, 'regions'> {
  const fitScale = Math.max(0.000001, finiteNumber(metrics.fitScale, 1));
  const viewport = {
    width: Math.max(1, finiteNumber(metrics.viewportWidth, metrics.cssWidth)),
    height: Math.max(1, finiteNumber(metrics.viewportHeight, metrics.cssHeight)),
    dpr: Math.max(1, finiteNumber(metrics.dpr, 1)),
  };
  const orientation = viewport.width >= viewport.height ? 'landscape' : 'portrait';
  const mobileViewport = viewport.width <= 900 || viewport.height <= 500;
  const activeProfile: SurfaceProfile = profile !== 'pc' || (coarsePointer && mobileViewport)
    ? (orientation === 'portrait' ? 'mobile_portrait' : 'mobile_landscape')
    : 'pc';
  const rules = PROFILE_RULES[activeProfile];
  const referenceRect = scaleRect(rectFrom(metrics.referenceRect), fitScale);
  const insets = {
    top: Math.max(0, finiteNumber(metrics.viewportSafeAreaInsets?.top)),
    right: Math.max(0, finiteNumber(metrics.viewportSafeAreaInsets?.right)),
    bottom: Math.max(0, finiteNumber(metrics.viewportSafeAreaInsets?.bottom)),
    left: Math.max(0, finiteNumber(metrics.viewportSafeAreaInsets?.left)),
  };
  const gutter = rules.minimumGutterCSSPX;
  const left = Math.min(viewport.width, Math.max(referenceRect.x, insets.left) + gutter);
  const top = Math.min(viewport.height, Math.max(referenceRect.y, insets.top) + gutter);
  const right = Math.max(left, Math.min(
    referenceRect.x + referenceRect.width,
    viewport.width - insets.right,
  ) - gutter);
  const bottom = Math.max(top, Math.min(
    referenceRect.y + referenceRect.height,
    viewport.height - insets.bottom,
  ) - gutter);
  const safeRect = { x: left, y: top, width: right - left, height: bottom - top };
  const hudHeight = Math.min(safeRect.height, rules.hudBandCSSPX);
  const controlsHeight = Math.min(
    Math.max(0, safeRect.height - hudHeight),
    rules.controlsBandCSSPX,
  );
  const gameplayHeight = Math.max(0, safeRect.height - hudHeight - controlsHeight);

  return {
    schema_version: LAYOUT_SCHEMA_VERSION,
    target_profile: profile,
    active_profile: activeProfile,
    orientation,
    viewport,
    reference_rect: referenceRect,
    safe_rect: safeRect,
    zones: {
      hud: { x: left, y: top, width: safeRect.width, height: hudHeight },
      gameplay: {
        x: left,
        y: top + hudHeight,
        width: safeRect.width,
        height: gameplayHeight,
      },
      controls: {
        x: left,
        y: bottom - controlsHeight,
        width: safeRect.width,
        height: controlsHeight,
      },
    },
    rules: {
      root_must_fill_viewport: true,
      critical_ui_within_safe_rect: true,
      disallow_critical_ui_overlap: true,
      minimum_gutter_css_px: gutter,
      minimum_interactive_css_px: rules.minimumInteractiveCSSPX,
      minimum_text_css_px: rules.minimumTextCSSPX,
    },
  };
}

function elementRegion(
  element: Element,
  index: number,
  windowObject: Window,
  documentObject: Document,
  toViewportRect?: SurfaceTemplateApi['toViewportRect'],
): LayoutRegion | null {
  const roleValue = boundedName(element.getAttribute('data-combos-ui-region'), '');
  if (!isRegionRole(roleValue)) {
    return null;
  }
  // (Client rects are the screen's; a turned surface reports its regions in its own coordinates.)
  const bounds = element.getBoundingClientRect();
  const rect = rectFrom(typeof toViewportRect === 'function' ? toViewportRect(bounds) : bounds);
  const style = typeof windowObject.getComputedStyle === 'function'
    ? windowObject.getComputedStyle(element)
    : null;
  const visible = element.isConnected !== false
    && style?.display !== 'none'
    && style?.visibility !== 'hidden'
    && finiteNumber(style?.opacity, 1) !== 0
    && rect.width > 0
    && rect.height > 0;
  const contentOverflow = visible && (
    finiteNumber(element.scrollWidth) > finiteNumber(element.clientWidth) + 1
    || finiteNumber(element.scrollHeight) > finiteNumber(element.clientHeight) + 1
  );
  const topElement = visible
    && style?.pointerEvents !== 'none'
    && typeof documentObject.elementFromPoint === 'function'
    ? documentObject.elementFromPoint(bounds.x + (bounds.width / 2), bounds.y + (bounds.height / 2))
    : null;
  const occluded = Boolean(
    topElement
    && topElement !== element
    && !element.contains(topElement),
  );
  const criticalAttribute = String(
    element.getAttribute('data-combos-ui-critical') || '',
  ).toLowerCase();
  const overlap = String(
    element.getAttribute('data-combos-overlap-allow') || '',
  ).split(',').map((item) => boundedName(item, '')).filter(Boolean).slice(0, 16);

  return {
    id: boundedName(
      element.getAttribute('data-combos-ui-id') || element.id,
      `${roleValue}-${index + 1}`,
    ),
    role: roleValue,
    critical: criticalAttribute
      ? criticalAttribute !== 'false'
      : roleValue !== 'decorative' && roleValue !== 'gameplay',
    interactive: element.matches('button, [role="button"], input, select, textarea, [data-combos-interactive="true"]'),
    visible,
    content_overflow: contentOverflow,
    occluded,
    font_size_css_px: Math.max(0, finiteNumber(style?.fontSize)),
    allows_overlap_with: overlap,
    rect,
    source: 'dom',
  };
}

function stateAfterPhase(state: GameplayState, phase: GameplayPhase): GameplayState {
  const next = { ...state, phase };
  const readyPhases: readonly GameplayPhase[] = [
    'ready',
    'playing',
    'paused',
    'won',
    'lost',
    'retrying',
  ];
  const startedPhases: readonly GameplayPhase[] = [
    'playing',
    'paused',
    'won',
    'lost',
    'retrying',
  ];
  if (readyPhases.includes(phase)) {
    next.loading_complete = true;
    next.input_ready = true;
  }
  if (startedPhases.includes(phase)) {
    next.core_loop_started = true;
  }
  if (phase === 'won') next.outcome = 'victory';
  if (phase === 'lost') next.outcome = 'defeat';
  if (phase === 'retrying') next.outcome = 'none';
  return next;
}

export function installCombosTemplateContracts({
  profile,
  surfaceTemplate,
  windowObject = window,
  documentObject = document,
}: InstallCombosTemplateContractsOptions): InstalledCombosTemplateContracts {
  if (!Object.prototype.hasOwnProperty.call(PROFILE_RULES, profile)) {
    throw new Error(`Unsupported Combos layout profile: ${profile}`);
  }
  if (!surfaceTemplate || typeof surfaceTemplate.getMetrics !== 'function') {
    throw new Error('Surface Template v2 is required before installing Combos contracts');
  }

  const virtualRegions = new Map<string, StoredRegion>();
  const actions = new Map<GameplayActionName, GameplayActionHandler>();
  const actionBindings = new Map<GameplayActionName, GameplayActionBinding>();
  const events: GameplayEventRecord[] = [];
  let eventSequence = 0;
  let gameplayState: GameplayState = {
    phase: 'unknown',
    loading_complete: false,
    input_ready: false,
    core_loop_started: false,
    outcome: 'none',
    retry_available: false,
    persisted_state_loaded: false,
  };

  function layoutSnapshot(): LayoutSnapshot {
    const metrics = surfaceTemplate.getMetrics();
    const coarsePointer = Boolean(
      windowObject.navigator?.maxTouchPoints > 0
      || windowObject.matchMedia?.('(pointer: coarse)')?.matches,
    );
    const geometry = layoutGeometry(profile, metrics, coarsePointer);
    const regions: LayoutRegion[] = [];
    const elements = typeof documentObject.querySelectorAll === 'function'
      ? [...documentObject.querySelectorAll('[data-combos-ui-region]')]
      : [];
    for (const element of elements.slice(0, MAX_REGIONS)) {
      const region = elementRegion(element, regions.length, windowObject, documentObject, surfaceTemplate.toViewportRect);
      if (region) regions.push(region);
    }
    for (const spec of virtualRegions.values()) {
      if (regions.length >= MAX_REGIONS) break;
      try {
        let rect = rectFrom(spec.getRect());
        if (spec.coordinateSpace === 'surface') {
          rect = scaleRect(rect, Math.max(0.000001, finiteNumber(metrics.fitScale, 1)));
        }
        regions.push({
          id: spec.id,
          role: spec.role,
          critical: spec.critical,
          interactive: spec.interactive,
          visible: spec.visible(),
          content_overflow: spec.contentOverflow(),
          occluded: spec.occluded(),
          font_size_css_px: spec.fontSizeCSSPX,
          allows_overlap_with: [...spec.allowsOverlapWith],
          rect,
          source: 'registered',
        });
      } catch {
        regions.push({
          id: spec.id,
          role: spec.role,
          critical: spec.critical,
          interactive: spec.interactive,
          visible: false,
          content_overflow: false,
          occluded: false,
          font_size_css_px: spec.fontSizeCSSPX,
          allows_overlap_with: [...spec.allowsOverlapWith],
          rect: { x: 0, y: 0, width: 0, height: 0 },
          source: 'registered',
        });
      }
    }
    return { ...geometry, regions };
  }

  const layoutAPI: Readonly<CombosLayoutContractApi> = Object.freeze({
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    targetProfile: profile,
    getSnapshot: layoutSnapshot,
    registerRegion(spec: RegisteredRegionSpec): () => void {
      const candidate = spec as Partial<RegisteredRegionSpec> | null | undefined;
      const id = boundedName(candidate?.id, '');
      const roleValue = boundedName(candidate?.role, '');
      const getRect = candidate?.getRect;
      if (!candidate || !id || !isRegionRole(roleValue) || typeof getRect !== 'function') {
        throw new TypeError('registerRegion requires a bounded id, known role, and getRect callback');
      }
      const visible = candidate.visible;
      const contentOverflow = candidate.contentOverflow;
      const occluded = candidate.occluded;
      const entry: StoredRegion = {
        id,
        role: roleValue,
        getRect,
        coordinateSpace: candidate.coordinateSpace === 'surface' ? 'surface' : 'viewport',
        critical: candidate.critical ?? (roleValue !== 'decorative' && roleValue !== 'gameplay'),
        interactive: Boolean(candidate.interactive),
        visible: typeof visible === 'function' ? visible : () => visible !== false,
        contentOverflow: typeof contentOverflow === 'function'
          ? contentOverflow
          : () => Boolean(contentOverflow),
        occluded: typeof occluded === 'function' ? occluded : () => Boolean(occluded),
        fontSizeCSSPX: Math.max(0, finiteNumber(candidate.fontSizeCSSPX)),
        allowsOverlapWith: Array.isArray(candidate.allowsOverlapWith)
          ? candidate.allowsOverlapWith.map((item) => boundedName(item, '')).filter(Boolean).slice(0, 16)
          : [],
      };
      virtualRegions.set(id, entry);
      return () => {
        virtualRegions.delete(id);
      };
    },
  });

  function reportState(patch: GameplayStatePatch): GameplayState {
    if (!patch || !isRecord(patch) || Array.isArray(patch)) {
      throw new TypeError('Gameplay state patch must be an object');
    }
    const rawPatch: Record<string, unknown> = patch;
    let next = { ...gameplayState };
    if (rawPatch.phase !== undefined) {
      const phase = boundedName(rawPatch.phase, '');
      if (!isGameplayPhase(phase)) throw new TypeError(`Unsupported gameplay phase: ${phase}`);
      next = stateAfterPhase(next, phase);
    }
    const booleanKeys = [
      'loading_complete',
      'input_ready',
      'core_loop_started',
      'retry_available',
      'persisted_state_loaded',
    ] as const;
    for (const key of booleanKeys) {
      if (rawPatch[key] !== undefined) next[key] = Boolean(rawPatch[key]);
    }
    if (rawPatch.outcome !== undefined) {
      const outcome = boundedName(rawPatch.outcome, '');
      if (!isGameplayOutcome(outcome)) throw new TypeError(`Unsupported gameplay outcome: ${outcome}`);
      next.outcome = outcome;
    }
    gameplayState = next;
    return { ...gameplayState };
  }

  function reportEvent(rawType: GameplayEventType): GameplayState {
    const type = boundedName(rawType, '');
    if (!isGameplayEvent(type)) {
      throw new TypeError(`Unsupported gameplay event: ${type}`);
    }
    eventSequence += 1;
    events.push({ sequence: eventSequence, type });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    switch (type) {
      case 'loading_complete':
        reportState({ phase: 'ready' });
        break;
      case 'game_started':
      case 'primary_input':
        reportState({ phase: 'playing' });
        break;
      case 'victory':
        reportState({ phase: 'won', retry_available: true });
        break;
      case 'defeat':
        reportState({ phase: 'lost', retry_available: true });
        break;
      case 'retry':
        reportState({ phase: 'retrying', outcome: 'none' });
        break;
      case 'state_restored':
        reportState({ persisted_state_loaded: true });
        break;
      default:
        break;
    }
    return { ...gameplayState };
  }

  const gameplayAPI: Readonly<CombosGameplayTestApi> = Object.freeze({
    schemaVersion: GAMEPLAY_SCHEMA_VERSION,
    reportState,
    reportEvent,
    registerAction(
      rawName: GameplayActionName,
      handler: GameplayActionHandler,
      binding?: GameplayActionBinding,
    ): () => void {
      const name = boundedName(rawName, '');
      if (!isGameplayAction(name) || typeof handler !== 'function') {
        throw new TypeError('registerAction supports start, primary, victory, defeat, or retry with a callback');
      }
      actions.set(name, handler);
      actionBindings.set(name, sanitizeActionBinding(name, binding));
      return () => {
        actions.delete(name);
        actionBindings.delete(name);
      };
    },
    async invokeAction(rawName: GameplayActionName): Promise<unknown> {
      const name = boundedName(rawName, '');
      if (!isGameplayAction(name)) {
        throw new Error(`Gameplay test action is not registered: ${name}`);
      }
      const handler = actions.get(name);
      if (!handler) throw new Error(`Gameplay test action is not registered: ${name}`);
      return handler();
    },
    getSnapshot(): GameplaySnapshot {
      return {
        schema_version: GAMEPLAY_SCHEMA_VERSION,
        state: { ...gameplayState },
        registered_actions: [...actions.keys()].sort(),
        events: events.map((event) => ({ ...event })),
      };
    },
    getProbePlan(): GameplayProbePlan {
      const bindings = Object.fromEntries(
        [...actionBindings.entries()].map(([name, binding]) => [name, { ...binding }]),
      ) as Partial<Record<GameplayActionName, GameplayActionBinding>>;
      return { bindings };
    },
  });

  windowObject.__combosLayoutContract = layoutAPI;
  windowObject.__combosGameplayTest = gameplayAPI;

  return Object.freeze({
    layout: layoutAPI,
    gameplay: gameplayAPI,
    dispose() {
      virtualRegions.clear();
      actions.clear();
      actionBindings.clear();
      events.length = 0;
      if (windowObject.__combosLayoutContract === layoutAPI) {
        delete windowObject.__combosLayoutContract;
      }
      if (windowObject.__combosGameplayTest === gameplayAPI) {
        delete windowObject.__combosGameplayTest;
      }
    },
  });
}
