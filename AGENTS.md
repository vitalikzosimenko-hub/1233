# Mobile Portrait Game Starter

## Target Context
- Platform: mobile browser
- Preferred orientation: portrait
- Primary input: touch

These are product hints, not rendering, resolution, aspect-ratio, or
architecture constraints. Follow the user's game requirements when they call
for a different approach.

## Surface Reference
- Centered safe reference rectangle: `393 x 725` logical CSS pixels, scaled
  proportionally from the previous baseline using the iPhone 16's 393 CSS-pixel
  viewport width.
- The framework scales uniformly and expands the logical long edge so `#app`
  always fills the real viewport. Use the full logical surface for backgrounds
  and gameplay; keep critical controls inside `referenceRect` when they must
  work across unusually tall, short, or rotated screens.
- `window.__surfaceTemplate.getMetrics()` reports the reference rectangle,
  expanded logical surface, viewport CSS size, capped device pixel ratio,
  backing-pixel size, fit/render scales, and logical safe-area insets.
- CSS equivalents are exposed on `#app`, including `--surface-width`,
  `--surface-height`, `--surface-reference-offset-x`,
  `--surface-reference-offset-y`, and `--surface-safe-*`.
- The helper is renderer-neutral and works with Canvas 2D, WebGL, DOM, or an
  engine-owned rendering surface.

## Responsive Layout Requirements
- Responsive layout is a delivery requirement. The game must fill the available
  mobile viewport and remain usable across different portrait aspect ratios.
- Do not lock the top-level game surface to exactly `393 x 725`. That size is a
  safe design reference, not the real device viewport.
- Fill the full `surfaceWidth x surfaceHeight` for backgrounds and gameplay.
  Keep important HUD, text, and touch controls inside `referenceRect` and the
  reported safe-area insets so they are not clipped or covered by device UI.
- Use relative layout, anchors, Flexbox/Grid, surface metrics, or equivalent
  responsive constraints for UI. Avoid positioning every element from fixed
  viewport pixel values.
- Canvas/WebGL renderers must update their display size, backing-pixel size, and
  camera or projection when the surface metrics change. Use
  `window.__surfaceTemplate.subscribe()` or an equivalent resize mechanism.
- For a default full-surface renderer, size from `surfaceWidth` and
  `surfaceHeight`; use `renderScale` for backing pixels. Explicit renderer CSS
  or engine-owned sizing may override the starter's low-specificity canvas
  default.

## Runtime Layout and Gameplay Contracts
- Preserve `template-contracts.ts` and the installation in `main.ts`. They expose
  `window.__combosLayoutContract` and `window.__combosGameplayTest` for
  automated PC/mobile verification.
- Preserve the outbound first-interactive-frame report in `main.ts`. Once the
  game is actually playable, it must best-effort emit exactly
  `{ type: 'combos:game-ready-v1' }`
  once through every available host transport: JSON-stringified through
  `window.ReactNativeWebView.postMessage`, and as an object through
  `window.parent.postMessage`. A missing or failing transport must never break
  the game.
- `reportGameReadyAfterFirstInteractivePaint()` belongs at the real playable
  completion point: required assets are loaded, production input handlers are
  installed, and the first usable frame has rendered. This signal is
  game-owned and renderer-neutral; do not introduce or wait for an
  engine-specific ready event. If startup becomes asynchronous, move the call
  with that completion point. DOM readiness, network quiet, canvas existence,
  or an engine bootstrap callback alone is not game readiness.
- Read `window.__combosLayoutContract.getSnapshot()` when placing UI. It
  preserves the template `target_profile` while switching `active_profile`
  between mobile portrait and landscape rules as the viewport rotates, and
  provides the current safe rectangle plus `hud`, `gameplay`, and `controls`
  zones in viewport CSS pixels.
- Mark important DOM UI with `data-combos-ui-region="hud|controls|modal|text"`
  and a stable `data-combos-ui-id`. Mark intentionally non-critical elements
  with `data-combos-ui-critical="false"`. For Canvas/WebGL UI, register the
  corresponding viewport or surface-coordinate rectangles with
  `window.__combosLayoutContract.registerRegion()`.
- Report actual game state through `window.__combosGameplayTest.reportState()`
  or the typed events `loading_complete`, `game_started`, `primary_input`,
  `victory`, `defeat`, `retry`, `visual_feedback`, `audio_feedback`,
  and `state_restored`.
- Register bounded probe bindings with the same production handlers used by the
  game. The third argument describes how Playwright reaches the real control,
  for example `registerAction('start', startGame, { type: 'selector', selector:
  '[data-combos-action="start"]' })` or `registerAction('primary',
  primaryAction, { type: 'touch', selector: 'canvas', x: 0.5, y: 0.5 })`.
  Callback-only `start` or `primary` hooks are self-reported and do not pass.
- Also register deterministic `victory`, `defeat`, and `retry` scenario seams
  when those outcomes exist in the GameContract. They must call the same
  production terminal/reset handlers and visibly render the matching outcome;
  never fabricate an automation-only state. Keep all probes bounded,
  repeatable, and free of paid or external side effects.
- Deployment smoke compares an idle baseline with real interactions on PC,
  mobile portrait, and mobile landscape. It independently checks trusted input,
  visible state changes, canvas DPR backing size, critical-region overlap, and
  resources actually drawn by DOM or Canvas. Game-authored reports cannot
  override those observations.

## Implementation Freedom
- Keep authored runtime and test source in TypeScript. Do not add `.js` or
  `.mjs` source files; JavaScript is allowed only in generated `dist/` output or
  installed dependencies.
- You may reorganize the starter code and configuration, but preserve the
  responsive surface behavior. Replace the helper only when the replacement
  provides equivalent viewport resize, DPR, and safe-area handling.
- The template already provides the platform-managed game libraries `three`
  and `matter-js`. Import only the libraries needed by the game; unused imports
  are excluded from the production bundle.
- You may add files and directories as needed.
- Use the available viewport by default. Do not infer a fixed resolution or
  aspect ratio from the preferred orientation.
- For a non-scrolling action surface, apply `touch-action: none` to the actual
  interactive element. Do not disable browser zoom globally for scrollable or
  accessibility-sensitive DOM experiences.

## Delivery
- The finished project must build successfully with `bash build.sh`.
- Keep runtime asset references compatible with the production build output.
- Never use root-relative project asset URLs such as `/assets/...` or
  `/ui-kit/...`; keep the build base relative and resolve local runtime URLs
  with `new URL("assets/file", document.baseURI).href` for nested previews.
- Put each exact required VisualContract role on the actual visible `img`,
  `video`, CSS-background owner, or canvas with `data-combos-asset-role`; use
  comma-separated `data-combos-asset-roles` for multiple roles on one visible
  consumer. Generic `data-role` and hidden markers do not count. Do not
  downgrade a required role to optional to clear the gate.
- Referencing an asset URL in source or build output is not integration. Draw
  each accepted required asset in the active playable state and remove its
  procedural placeholder except as an exclusive loading/error fallback.
- Before finishing, check the game at more than one portrait viewport size and
  fix any clipping, overlap, black bars, or unintended page scrolling.

## Brand intro

Preserve the `brand-entry.ts` script in `index.html` and its `brand-intro.ts` import. Follow
[BRAND_INTRO.md](BRAND_INTRO.md): absent `window.combos` plays the fixed 2.5 s
brand bumper; an existing marker skips it. The host owns the marker.
Do not couple this bumper to game readiness or resource loading.
