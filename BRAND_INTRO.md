# Combos brand intro

This template includes a standalone, renderer-neutral brand bumper in
`brand-intro.ts`. The module script in `index.html` loads `brand-entry.ts`, which
plays the bumper and then dynamically imports this template's original game
entry. Keep that bootstrap when changing engines or reorganizing
gameplay. The file embeds the approved SVG artwork and styles; it needs no CDN,
fonts, package dependency, shared parent directory, or asset loader.

## Behavior

- If the game document's `window.combos != null`, skip without mounting any UI
  or delaying the game. `null` and `undefined` mean outside Combos; other values
  mean the marker exists.
- Otherwise show the black brand bumper: large centered Combos logo and
  `Powered by` with the small Combos logo at the bottom.
- Fade in for 1000 ms, hold for 750 ms, fade out for 750 ms. Total: 2500 ms.
- This is branding, not loading. Never extend it for assets, shorten it on
  `load`/game-ready, show progress, or emit game-ready when the bumper ends.
- Play once per document. Scene changes, retries, duplicate imports, and
  back/forward restoration must not replay it. A full page reload can replay it.
- The overlay uses a Shadow DOM outside the game root, consumes input only
  while visible, then removes itself and all listeners. Heavy game module
  initialization starts after it finishes, so it cannot stall the animation or
  start gameplay behind the bumper. Inside Combos the resolved skip promise
  starts the game without an artificial timer. No engine loop or timer is patched.
- Original game loading/error UI remains game-owned and may still appear
  after the fixed bumper if assets are not ready. Keep it free of a second
  Combos-branded splash.

## Host integration

The host must provide its existing Combos API/marker **inside the game window,
before the brand module executes**. Do not assign `window.combos` in the game
template: an exported game would carry that marker and incorrectly skip outside.

For a host that does not have an API object yet, its document-start injection
can use this minimal marker (do not overwrite an existing API):

```js
window.combos ??= {};
```

In an iframe, `window.combos` on the parent page is a different global. A
cross-origin host needs its own established bridge/bootstrap to install the
marker in the game document before this module runs. This template intentionally
does not infer the host from its URL, cookies, `ReactNativeWebView`, or referrer,
and does not invent a handshake or wait for a late marker.

This is a cooperative environment signal, not authentication or tamper resistance.

## Optional game integration

Most games need no code change. Preserve `brand-entry.ts` and update only its
dynamic import if you rename the original game entry. For a custom integration
that has explicitly separated inexpensive asset preparation from heavy engine
initialization, the completion promise is also available:

```ts
import { brandIntroFinished } from './brand-intro'; // adjust relative path from src/

// Begin asset preparation independently. Neither task controls the other.
const assetsReady = prepareGameAssets();
Promise.all([brandIntroFinished, assetsReady]).then(() => startGame());
```

Results are `played`, `skipped`, `interrupted`, or `unavailable`; all resolve.
Keep the actual game-ready report at the real playable frame. The intro's
completion cannot establish that assets or gameplay are ready.

## Maintaining the templates repository

The authoritative source is `src/game_templates/_shared/brand-intro.ts`.
Run `node src/game_templates/_ci/sync-brand-intro.mjs` after an approved branding
change, and `node src/game_templates/_ci/sync-brand-intro.mjs --check` in review.
Distributed copies are deliberately self-contained so each template can be
cloned, exported, and built independently. Combos-engine guards permit only
exact approved source hashes, including the previously shipped 1.5 s source
for existing projects; arbitrary gameplay overlays remain rejected.
