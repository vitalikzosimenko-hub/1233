import { OFFICERS } from './officers';
import { AudioManager, MONSTER_SOUNDS, type MonsterSound } from './audio';
import { BLOCKS } from './blocks';
import { Game, LOOK_SPEEDS } from './game';
import { contextAction, pick, spawnDrop } from './build';
import { addToHold, footing, stomp } from './fortress';
import { craneTap, crateSpot, hoistCheck, startCraneDrop, startHoist } from './crane';
import { killGiant, spawnGiant } from './combat';
import { spawnStar } from './events';
import type { GiantType } from './giants';
import type { ActorKind } from './entities';
import type { StructKind } from './structures';
import type { Zone } from './terrain';
import { spawnMob } from './mobs';
import { buy } from './quests';
import { buildHudIcons } from './hud-icons';
import { InputModeTracker, mousePrimary, type InputMode } from './input';
import { currentGoal } from './guide';
import { installItemPainters } from './paint-items';
import { installPainters } from './paint';
import { installExtraPainters } from './paint-extra';
import { installMobPainters } from './paint-mobs';
import { installLandPainters } from './paint-lands';
import { installCreatureSkins } from './creature-skins';
import { installSkins } from './paint-skins';
import { Renderer } from './render';
import { buildTextures } from './textures';
import { detectLang, i18nDebug, setLang, watch } from './i18n';
import { UI } from './ui';
import { viewDelta, viewPoint } from './view';
import type { SurfaceTemplateApi } from '../../surface-template';
import type { InstalledCombosTemplateContracts } from '../../template-contracts';


const MOVE_KEYS: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
};
/** Keys that only a physical keyboard player presses: they switch to the desktop scheme. */
const DESKTOP_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Touch gesture timing: a short still press is a tap, a longer one mines. */
const HOLD_MS = 240;
const TAP_SLOP = 10;
/** A thumb that has settled on a block and then drags this far wants to look, not to dig. */
const HOLD_SLOP = 26;
const TOUCH_LOOK = 0.0062;
/** Uncaptured mouse fallback: drag to look. */
const MOUSE_LOOK = 0.0042;
/** Captured mouse (pointer lock): radians per pixel of movement. */
const MOUSE_SENS = 0.0024;
/** Holding right click keeps building, like Minecraft. */
const PLACE_REPEAT_FIRST = 0.32;
const PLACE_REPEAT = 0.22;

/** A press on the world, in view coordinates (see view.ts). */
interface Gesture {
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  mode: 'pending' | 'look' | 'hold';
  mouse: boolean;
  /** The press already struck a monster (the release must not act again). */
  struck: boolean;
  /** Counted among the touches that dim the HUD (see UI.act). */
  acting?: boolean;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export interface BootOptions {
  surface: Readonly<SurfaceTemplateApi>;
  contracts: InstalledCombosTemplateContracts;
}

/** Resolves once the title screen is interactive (first playable frame). */
export async function boot({ surface, contracts }: BootOptions): Promise<void> {
  const gameplay = contracts.gameplay;
  gameplay.reportState({ phase: 'loading' });
  // Phones and tablets play lying on their side: held upright, the whole view (the loading screen
  // too) is turned a quarter and the player turns the device. A computer plays in whatever window
  // it has (its monitor does not turn): keyboard and mouse, or in a preview's landscape phone frame
  // the phone's joystick and buttons, worked by the mouse.
  const first = surface.getMetrics();
  const input = new InputModeTracker(first.viewportWidth, first.viewportHeight);
  const landscapeFor = (mode: InputMode): boolean => mode === 'touch' && !mousePrimary();
  surface.setLandscape(landscapeFor(input.mode));
  // The player's language (the device's own, or the one picked on the title): its dictionary
  // loads while the textures are painted.
  const langReady = setLang(detectLang());
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('data-combos-ui-region', 'gameplay');
  canvas.setAttribute('data-combos-ui-id', 'world');
  surface.root.appendChild(canvas);

  const audio = new AudioManager();
  const local = (path: string): string => new URL(path, document.baseURI).href;
  audio.setMusicURLs({
    day: local('audio/bgm-day.mp3'),
    night: local('audio/bgm-night.mp3'),
    siege: local('audio/bgm-siege.mp3'),
    desert: local('audio/bgm-desert.mp3'),
    snow: local('audio/bgm-snow.mp3'),
    raid: local('audio/bgm-raid.mp3'),
    wither: local('audio/bgm-wither.mp3'),
    swamp: local('audio/bgm-swamp.mp3'),
    badlands: local('audio/bgm-badlands.mp3'),
    ember: local('audio/bgm-ember.mp3'),
    guardian: local('audio/bgm-guardian.mp3'),
    expedition: local('audio/bgm-expedition.mp3'),
    warden: local('audio/bgm-warden.mp3'),
    final: local('audio/bgm-final.mp3'),
    epilogue: local('audio/bgm-epilogue.mp3'),
  });
  const monsterSamples: Partial<Record<MonsterSound, string>> = {};
  for (const name of MONSTER_SOUNDS) monsterSamples[name] = local(`audio/sfx-${name}.mp3`);
  audio.setSampleURLs({
    ...monsterSamples,
    stomp: local('audio/sfx-stomp.mp3'),
    cannon: local('audio/sfx-cannon.mp3'),
    explode: local('audio/sfx-explode.mp3'),
    hoist: local('audio/sfx-hoist.mp3'),
    winch: local('audio/sfx-winch.mp3'),
    latch: local('audio/sfx-latch.mp3'),
    strain: local('audio/sfx-strain.mp3'),
    rip: local('audio/sfx-rip.mp3'),
    snap: local('audio/sfx-snap.mp3'),
    thud: local('audio/sfx-thud.mp3'),
    amb_day: local('audio/amb-day.mp3'),
    amb_night: local('audio/amb-night.mp3'),
    walk: local('audio/sfx-walk-loop.mp3'),
    rain: local('audio/amb-rain.mp3'),
    cave: local('audio/amb-cave.mp3'),
    bell: local('audio/sfx-bell.mp3'),
    quest: local('audio/sfx-quest.mp3'),
    thunder: local('audio/sfx-thunder.mp3'),
    ballista: local('audio/sfx-ballista.mp3'),
    mortar: local('audio/sfx-mortar.mp3'),
    phantom: local('audio/sfx-phantom.mp3'),
    spider: local('audio/sfx-spider.mp3'),
    legdamage: local('audio/sfx-legdamage.mp3'),
    swing: local('audio/sfx-swing.mp3'),
    slash: local('audio/sfx-slash.mp3'),
    crit: local('audio/sfx-crit.mp3'),
    poof: local('audio/sfx-poof.mp3'),
    oof: local('audio/sfx-oof.mp3'),
    heartbeat: local('audio/sfx-heartbeat.mp3'),
    levelup: local('audio/sfx-levelup.mp3'),
    grapple: local('audio/sfx-grapple.mp3'),
    reel: local('audio/sfx-reel.mp3'),
    warhorn: local('audio/sfx-warhorn.mp3'),
    steam: local('audio/sfx-steam.mp3'),
    ram: local('audio/sfx-ram.mp3'),
    page: local('audio/sfx-page.mp3'),
    wave: local('audio/sfx-wave.mp3'),
    relic: local('audio/sfx-relic.mp3'),
    crossbow: local('audio/sfx-crossbow.mp3'),
    success: local('audio/sfx-success.mp3'),
    whoosh: local('audio/sfx-whoosh.mp3'),
    firework: local('audio/sfx-firework.mp3'),
    bark: local('audio/sfx-bark.mp3'),
    groundpound: local('audio/sfx-groundpound.mp3'),
    jackpot: local('audio/sfx-jackpot.mp3'),
    crate: local('audio/sfx-crate.mp3'),
    baa: local('audio/sfx-baa.mp3'),
    cheer: local('audio/sfx-cheer.mp3'),
    cluck: local('audio/sfx-cluck.mp3'),
    feat: local('audio/sfx-feat.mp3'),
    howl: local('audio/sfx-howl.mp3'),
    shear: local('audio/sfx-shear.mp3'),
    squish: local('audio/sfx-squish.mp3'),
    star: local('audio/sfx-star.mp3'),
    villager: local('audio/sfx-villager.mp3'),
  });
  buildTextures(() => {
    installPainters();
    installExtraPainters();
    installMobPainters();
    installLandPainters();
    installItemPainters();
    installCreatureSkins();
    installSkins();
  });
  buildHudIcons();
  const game = new Game(audio, gameplay);
  const renderer = new Renderer(canvas);
  renderer.mobile = input.mode === 'touch';
  renderer.init();
  game.renderer = renderer;
  await langReady;
  const ui = new UI(surface.viewport, game, renderer, contracts.layout);
  watch(ui.root);
  game.ui = ui;
  game.input = input.mode;
  ui.setInputMode(input.mode);
  input.onChange((mode) => {
    game.input = mode;
    renderer.mobile = mode === 'touch';
    ui.setInputMode(mode);
    surface.setLandscape(landscapeFor(mode));
  });

  const applyMetrics = (): void => {
    const m = surface.getMetrics();
    // (A view turned into a phone's shape, or out of it, may change the controls: that lays out too.)
    input.resize(m.viewportWidth, m.viewportHeight);
    renderer.resize(m.viewportWidth, m.viewportHeight, m.pixelWidth, m.pixelHeight, m.dpr);
    ui.layout();
    if (game.world && game.phase !== 'loading') {
      renderer.updateCamera(0, game);
      renderer.render(game);
    }
  };
  surface.subscribe(() => applyMetrics());

  // ---------------- loading: world, distant terrain, the area around the deck ----------------
  ui.setLoadingProgress(0.05, 'Painting blocks...');
  // A newer copy of the saved game may be waiting in the cloud (saved on another device).
  const cloudSync = game.syncCloud().catch(() => 'offline');
  await nextFrame();
  const artReady = ui.loadTitleArt(9000);
  ui.setLoadingProgress(0.12, 'Shaping the valley...');
  await nextFrame();
  let seed = (Math.random() * 1e9) | 0;
  try {
    const forced = Number(new URLSearchParams(window.location.search).get('seed'));
    if (Number.isFinite(forced) && forced > 0) seed = forced | 0;
  } catch {
    // keep the random seed
  }
  game.prepare(seed);
  game.phase = 'loading';
  applyMetrics();
  ui.setLoadingProgress(0.25, 'Raising the mountains...');
  await nextFrame();
  renderer.setWorld(game.world);
  ui.setLoadingProgress(0.4, 'Planting forests...');
  await nextFrame();
  // Chunks around the fortress, a slice per frame so the bar keeps moving.
  const want = renderer.viewRadius + 1;
  for (let pass = 0; pass < 600; pass += 1) {
    const left = game.world.stream([{ x: game.player.x, z: game.player.z, r: want }], 120, 4, 900);
    const total = Math.PI * want * want;
    ui.setLoadingProgress(0.4 + 0.35 * Math.min(1, game.world.loaded / total), 'Building villages...');
    await nextFrame();
    if (left === 0) break;
  }
  game.placeFortressAt(game.fortressCentre()[0], game.fortressCentre()[2]);
  [game.player.x, game.player.y, game.player.z] = game.startSpot();
  ui.setLoadingProgress(0.8, 'Lighting lanterns...');
  await nextFrame();
  for (let pass = 0; pass < 40 && renderer.meshedFraction() < 0.98; pass += 1) {
    renderer.prebuild(game, 140);
    ui.setLoadingProgress(0.8 + 0.15 * renderer.meshedFraction(), 'Lighting lanterns...');
    await nextFrame();
  }
  game.phase = 'title';
  ui.setLoadingProgress(0.97, 'Almost there...');
  const artOk = await artReady;
  if (!artOk) ui.titleArt.classList.add('hidden');
  // (A slow network does not hold the title back: CONTINUE appears when the cloud answers.)
  await Promise.race([cloudSync, new Promise((resolve) => window.setTimeout(resolve, 2500))]);
  ui.setLoadingProgress(1);
  renderer.updateCamera(0, game);
  renderer.render(game);
  ui.showTitle();
  // A shared invite (?coop=ABCDE): the co-op panel opens with the room code filled in.
  try {
    const invite = new URLSearchParams(window.location.search).get('coop');
    if (invite && /^[A-Za-z0-9]{5}$/.test(invite)) {
      ui.coopCode = invite.toUpperCase();
      ui.openCoop('title');
    }
  } catch {
    // no invite
  }
  (window as unknown as { __combosSmokeReady?: boolean }).__combosSmokeReady = true;

  // ---------------- desktop mouse capture (pointer lock) ----------------
  // Captured: the mouse looks around like Minecraft, left button mines, right button builds.
  // Where capture is refused (some embeds), the uncaptured drag-to-look gestures below still work.
  const gestures = new Map<number, Gesture>();
  const lockSupported = typeof canvas.requestPointerLock === 'function';
  const capture = { locked: false, everLocked: false, failures: 0, quiet: false };
  let heldButtons = 0;
  let placeTimer = 0;
  const captureUnavailable = (): boolean => !lockSupported || (!capture.everLocked && capture.failures >= 2);
  const updateMouseFree = (): void => {
    game.mouseFree = input.mode === 'desktop' && !capture.locked && !captureUnavailable();
  };
  const endMouseButtons = (): void => {
    if (heldButtons & 1) game.endHold();
    heldButtons = 0;
  };
  const requestCapture = (): void => {
    if (input.mode !== 'desktop' || !lockSupported || capture.locked || !game.isPlaying()) return;
    try {
      const pending: unknown = canvas.requestPointerLock();
      // Failures are counted by the pointerlockerror event; the promise form must not go unhandled.
      if (pending instanceof Promise) pending.catch(() => undefined);
    } catch {
      capture.failures += 1;
      updateMouseFree();
    }
  };
  const releaseCapture = (): void => {
    endMouseButtons();
    if (document.pointerLockElement === canvas) {
      capture.quiet = true;
      document.exitPointerLock();
    }
  };
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    capture.locked = locked;
    if (locked) {
      capture.everLocked = true;
      capture.failures = 0;
      // The click that captured the mouse must not also mine or build.
      for (const g of gestures.values()) if (g.mode === 'hold') game.endHold();
      gestures.clear();
      renderer.hover = null;
    } else {
      endMouseButtons();
      // Esc (or losing focus) releases the mouse: pause, as Minecraft does.
      if (!capture.quiet && game.isPlaying() && input.mode === 'desktop') ui.openPause();
      capture.quiet = false;
    }
    updateMouseFree();
  });
  document.addEventListener('pointerlockerror', () => {
    capture.failures += 1;
    updateMouseFree();
  });
  ui.onResumePlay = requestCapture;
  ui.onSuspendPlay = releaseCapture;

  // Captured-mouse buttons use the per-button mouse events: pointer events fold chorded
  // presses into pointermove, whose `buttons` some browsers report inconsistently.
  canvas.addEventListener('mousedown', (event) => {
    if (!capture.locked || !game.isPlaying()) return;
    if (event.button === 0) {
      heldButtons |= 1;
      game.beginHold(game.viewRay());
    } else if (event.button === 2) {
      heldButtons |= 2;
      game.tap(game.viewRay());
      placeTimer = PLACE_REPEAT_FIRST;
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0 && heldButtons & 1) {
      heldButtons &= ~1;
      game.endHold();
    } else if (event.button === 2) {
      heldButtons &= ~2;
    }
  });

  // ---------------- input scheme ----------------
  const primaryJump = (): void => {
    game.setJump(true);
    window.setTimeout(() => game.setJump(false), 150);
  };
  const registerPrimary = (mode: InputMode): void => {
    // Probe the control the player actually has: Space on PC, the on-screen jump button on touch.
    gameplay.registerAction('primary', primaryJump, mode === 'desktop'
      ? { type: 'keyboard', key: 'Space' }
      : { type: 'selector', selector: '[data-combos-action="jump"]' });
  };
  input.onChange((mode) => {
    if (mode === 'touch') releaseCapture();
    registerPrimary(mode);
    updateMouseFree();
  });
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') input.touched();
  }, { capture: true, passive: true });

  // ---------------- touch & mouse on the world ----------------
  const rayAt = (g: Gesture) => renderer.screenRay(g.x, g.y, game);
  canvas.addEventListener('pointerdown', (event) => {
    // Captured: buttons are handled by the mousedown listener, which must not be suppressed.
    if (capture.locked) return;
    event.preventDefault();
    audio.unlock();
    if (!game.isPlaying()) return;
    const mouse = event.pointerType === 'mouse';
    if (mouse && input.mode === 'desktop' && !captureUnavailable()) requestCapture();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // synthetic pointers may not support capture
    }
    const at = viewPoint(event.clientX, event.clientY);
    const g: Gesture = { x0: at.x, y0: at.y, x: at.x, y: at.y, t0: performance.now(), mode: 'pending', mouse, struck: false };
    if (mouse && event.button === 2) {
      // Right click places/uses immediately; a drag then looks around.
      game.tap(rayAt(g));
      g.mode = 'look';
    } else if (!mouse) {
      // A thumb landing on a monster strikes at once (holding on keeps swinging; dragging looks).
      g.struck = game.strike(rayAt(g));
    }
    gestures.set(event.pointerId, g);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (capture.locked) {
      const { x: dx, y: dy } = viewDelta(event.movementX || 0, event.movementY || 0);
      // Drop the occasional warp spike some browsers report while the cursor is captured.
      if (game.isPlaying() && Math.abs(dx) < 400 && Math.abs(dy) < 400) game.look(dx * MOUSE_SENS, -dy * MOUSE_SENS);
      return;
    }
    const at = viewPoint(event.clientX, event.clientY);
    if (event.pointerType === 'mouse' && event.buttons === 0) renderer.hover = at;
    const g = gestures.get(event.pointerId);
    if (!g) return;
    const dx = at.x - g.x;
    const dy = at.y - g.y;
    g.x = at.x;
    g.y = at.y;
    if (g.mode === 'pending' && Math.hypot(g.x - g.x0, g.y - g.y0) > TAP_SLOP) {
      g.mode = 'look';
      // (A thumb sweeping the view round: the HUD steps back while it does.)
      if (!g.mouse && !g.acting) {
        g.acting = true;
        ui.act(true);
      }
    }
    const touchLook = TOUCH_LOOK * (LOOK_SPEEDS[game.lookSpeed] ?? 1);
    if (g.mode === 'look') {
      const k = g.mouse ? MOUSE_LOOK : touchLook;
      game.look(dx * k, -dy * k);
    } else if (g.mode === 'hold') {
      // (At the guns the shots follow the finger; anywhere else a long drag turns the view.)
      if (!g.mouse && !game.helm && !game.gunner && Math.hypot(g.x - g.x0, g.y - g.y0) > HOLD_SLOP) {
        game.endHold();
        g.mode = 'look';
        if (!g.acting) {
          g.acting = true;
          ui.act(true);
        }
        game.look(dx * touchLook, -dy * touchLook);
      } else game.moveHold(rayAt(g));
    }
    if (g.mouse) renderer.hover = at;
  });
  const finish = (event: PointerEvent, cancelled: boolean): void => {
    const g = gestures.get(event.pointerId);
    if (!g) return;
    gestures.delete(event.pointerId);
    if (g.acting) ui.act(false);
    if (g.mode === 'hold') game.endHold();
    else if (g.mode === 'pending' && !cancelled && !g.struck) game.tap(rayAt(g));
  };
  canvas.addEventListener('pointerup', (event) => {
    if (capture.locked) return;
    finish(event, false);
  });
  canvas.addEventListener('pointercancel', (event) => finish(event, true));
  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') renderer.hover = null;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    if (!game.isPlaying()) return;
    event.preventDefault();
    const items = [null, ...game.hotbarItems()];
    const current = game.selected;
    const index = (items.indexOf(current) + (event.deltaY > 0 ? 1 : -1) + items.length) % items.length;
    const next = items[index];
    if (next === null || next === undefined) game.selectPickaxe();
    else game.selectItem(next);
  }, { passive: false });
  const promoteHolds = (): void => {
    const now = performance.now();
    for (const g of gestures.values()) {
      if (g.mode === 'pending' && now - g.t0 >= HOLD_MS) {
        g.mode = 'hold';
        // (Holding on a block to dig it, or on a monster: the HUD steps back too.)
        if (!g.mouse && !g.acting) {
          g.acting = true;
          ui.act(true);
        }
        game.beginHold(rayAt(g));
      }
    }
  };

  // ---------------- keyboard ----------------
  const turn = { left: false, right: false, up: false, down: false };
  window.addEventListener('keydown', (event) => {
    if (DESKTOP_KEYS.has(event.code)) input.keyed();
    const move = MOVE_KEYS[event.code];
    if (!game.isPlaying()) {
      if (ui.prologueKey?.(event.code)) {
        event.preventDefault();
        return;
      }
      // The opening flyover: Space, Enter or Esc skips it.
      if (game.intro && (event.code === 'Space' || event.code === 'Enter' || event.code === 'Escape')) {
        event.preventDefault();
        game.skipIntro();
        return;
      }
      if (game.modal === 'story' && !event.repeat && (event.code === 'Enter' || event.code === 'Space' || event.code === 'KeyE' || event.code === 'Escape')) {
        event.preventDefault();
        ui.dismissStory();
        return;
      }
      if (event.code === 'Escape' && game.modal !== 'none') ui.closeModals();
      // E / C close the workshop again, M the map, like the Minecraft inventory.
      else if ((event.code === 'KeyE' || event.code === 'KeyC') && game.modal === 'craft' && !event.repeat) ui.closeModals();
      else if (event.code === 'KeyM' && game.modal === 'map' && !event.repeat) ui.closeModals();
      else if (event.code === 'KeyH' && ui.guideOpen && !event.repeat) ui.closeModals();
      return;
    }
    if (move) {
      event.preventDefault();
      game.keys[move] = true;
      game.report('primary_input');
      return;
    }
    // (F5 is the view's key while you play, as in Minecraft: not the page's reload, held or not.)
    if (event.code === 'F5') event.preventDefault();
    if (event.repeat) return;
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (digit) {
      const n = Number(digit[1]);
      if (n === 1) game.selectPickaxe();
      else {
        const id = game.hotbarItems()[n - 2];
        if (id !== undefined) game.selectItem(id);
      }
      return;
    }
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        game.setJump(true);
        break;
      case 'ArrowLeft':
        turn.left = true;
        break;
      case 'ArrowRight':
        turn.right = true;
        break;
      case 'ArrowUp':
        turn.up = true;
        break;
      case 'ArrowDown':
        turn.down = true;
        break;
      case 'KeyQ':
        game.selectPickaxe();
        break;
      case 'KeyE':
        game.use(true, ui.promptLabel);
        break;
      case 'KeyC':
        ui.openCraft();
        break;
      case 'KeyM':
        ui.openMap();
        break;
      case 'KeyF':
        game.fireCannon();
        break;
      case 'KeyR':
        game.doLeap();
        break;
      case 'KeyG':
        game.blowHorn();
        break;
      case 'KeyX':
        // Hold X to wind the stomp up; it comes down when you let go.
        if (!event.repeat) game.stompPress();
        break;
      case 'KeyN':
        game.startNight();
        break;
      case 'KeyJ':
        ui.togglePlan();
        break;
      case 'KeyH':
        ui.openGuide();
        break;
      case 'KeyV':
      case 'F5':
        // First person or third.
        ui.toggleView();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        game.setBoost(true);
        break;
      case 'KeyP':
      case 'Escape':
        ui.openPause();
        break;
      default:
        break;
    }
  });
  window.addEventListener('keyup', (event) => {
    const move = MOVE_KEYS[event.code];
    if (move) game.keys[move] = false;
    if (event.code === 'Space') game.setJump(false);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') game.setBoost(false);
    if (event.code === 'KeyX') game.stompRelease();
    if (event.code === 'ArrowLeft') turn.left = false;
    if (event.code === 'ArrowRight') turn.right = false;
    if (event.code === 'ArrowUp') turn.up = false;
    if (event.code === 'ArrowDown') turn.down = false;
  });
  const releaseAll = (): void => {
    turn.left = turn.right = turn.up = turn.down = false;
    for (const g of gestures.values()) {
      if (g.mode === 'hold') game.endHold();
      if (g.acting) ui.act(false);
    }
    gestures.clear();
    endMouseButtons();
    game.releaseInputs();
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseAll();
      if (game.isPlaying()) ui.openPause();
      audio.suspend();
    } else if (game.modal === 'none') {
      audio.resume();
    }
  });
  window.addEventListener('pagehide', () => audio.suspend());

  // Creator host messages (mute / screenshot), parsed defensively.
  window.addEventListener('message', (event) => {
    let data: unknown = event.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== 'object') return;
    const record = data as Record<string, unknown>;
    const type = String(record.type ?? record.event ?? '');
    const action = String(record.action ?? record.cmd ?? record.command ?? record.method ?? '').toLowerCase();
    if (type !== 'toGodot' && !type.toLowerCase().includes('mute') && !type.toLowerCase().includes('screenshot')) return;
    const subject = `${type} ${action}`.toLowerCase();
    if (subject.includes('unmute')) audio.setHostMuted(false);
    else if (subject.includes('mute')) {
      const value = record.value ?? record.muted ?? record.data;
      audio.setHostMuted(value === undefined ? true : Boolean(value));
    } else if (subject.includes('screenshot')) {
      try {
        renderer.render(game);
        const image = canvas.toDataURL('image/jpeg', 0.85);
        event.source?.postMessage({ type: 'fromGodot', action: 'screenshot', data: image }, { targetOrigin: '*' });
      } catch {
        // screenshot is best effort
      }
    }
  });

  // ---------------- contracts ----------------
  gameplay.registerAction('start', () => {
    audio.unlock();
    game.newGame();
  }, { type: 'selector', selector: '[data-combos-action="start"]' });
  registerPrimary(input.mode);
  gameplay.registerAction('victory', () => game.forceOutcome('victory'), { type: 'callback' });
  gameplay.registerAction('defeat', () => game.forceOutcome('defeat'), { type: 'callback' });
  gameplay.registerAction('retry', () => game.retry(), { type: 'selector', selector: '[data-combos-action="retry"]' });

  (window as unknown as { __blockFortress?: Game }).__blockFortress = game;
  (window as unknown as { __bfStats?: () => unknown }).__bfStats = () => renderer.stats();
  (window as unknown as { __bfI18n?: unknown }).__bfI18n = i18nDebug;
  // Tooling: fix the time of day, move the camera, hide the HUD (screenshots and tuning).
  (window as unknown as { __bfDebug?: unknown }).__bfDebug = {
    clock: (c: number | null) => {
      game.debugClock = c;
    },
    tp: (x: number, y: number, z: number, yaw: number, pitch: number) => {
      const p = game.player;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = p.vy = p.vz = 0;
      p.standingOn = null;
      game.yaw = yaw;
      game.pitch = pitch;
      game.streamAll(0);
    },
    hud: (show: boolean) => {
      ui.root.style.display = show ? '' : 'none';
    },
    freeze: (on: boolean) => {
      game.paused = on;
    },
    context: () => contextAction(game),
    goal: () => currentGoal(game),
    officers: () => OFFICERS,
    killGiants: () => {
      for (const g of game.giants) if (!g.dead) killGiant(game, g, false);
    },
    spawnGiant: (type: GiantType) => spawnGiant(game, type),
    spawnMob: (kind: ActorKind, x: number, z: number) => spawnMob(game, kind, x, z),
    spawnDrop: (id: number, count: number, x: number, y: number, z: number) => spawnDrop(game, id, count, x, y, z),
    buy: (id: string) => buy(game, id),
    hoistInfo: () => {
      const p = pick(game, game.viewRay(), 48).block;
      if (!p || p.kind !== 'world') return { p: p && p.kind };
      const s = game.world.structureAt(p.x, p.y, p.z);
      return { p: [p.x, p.y, p.z, p.id], s: s && s.id, check: s ? hoistCheck(game, s) : null };
    },
    pick: (reach = 8) => {
      const p = pick(game, game.viewRay(), reach);
      const b = p.block;
      return b ? { kind: b.kind, id: b.id, x: b.x, y: b.y, z: b.z, dist: b.dist, actor: p.actor?.kind ?? null } : { actor: p.actor?.kind ?? null };
    },
    animals: () => game.animals.map((a) => ({ kind: a.kind, x: a.x, y: a.y, z: a.z, wool: a.wool, tint: a.tint, boarded: a.boarded, panic: a.panic })),
    /** A monster under one of the fortress's feet as it comes down. */
    stompOn: (kind: ActorKind = 'zombie', leg = 0) => {
      const l = game.walker.legs[leg];
      if (!l) return false;
      const mob = spawnMob(game, kind, l.foot[0] + 0.6, l.foot[2] + 0.4);
      if (!mob) return false;
      stomp(game, l.foot, game.walker.spec.size, true);
      return mob.squash > 0;
    },
    star: () => spawnStar(game),
    /** What the ground under the hull asks of its legs (hull heights: stance, contact, reach). */
    footing: () => footing(game),
    /** Collision of every block id: [solid, climbable]. */
    defs: () => BLOCKS.map((d) => (d ? [d.solid, d.climbable] : [false, false])),
    /** A building of a kind straight into the hold (no crane): false when the hold is full. */
    holdAdd: (kind: StructKind, zone: Zone | null = null) => addToHold(game, kind, zone),
    /** Hoists a structure by id (the crane's checks apply): it flies into its place in the hold. */
    hoist: (id: string) => {
      const s = game.world.structures.byId.get(id);
      return s ? startHoist(game, s) : false;
    },
    /** The crane's lift as it stands (stage, seconds into it, strain, swing), and its beat tapped. */
    lift: () => {
      const h = game.hoist;
      return h ? { stage: h.stage, t: h.t, strain: h.strain, swing: Math.hypot(game.crane.o[0], game.crane.o[1]), along: game.crane.o[0] * h.axis[0] + game.crane.o[1] * h.axis[1] + h.trim, vAlong: game.crane.ov[0] * h.axis[0] + game.crane.ov[1] * h.axis[1] + h.trimV, off: Math.abs(game.crane.o[0] * h.axis[0] + game.crane.o[1] * h.axis[1] + h.trim), trim: h.trim, near: h.near.slice(-3), perfect: h.perfect, cells: h.cargo.cells.size } : null;
    },
    craneTap: () => craneTap(game),
    /** Stands the player at the crane's controls (by its mast, on the deck). */
    toCrane: () => {
      const at = crateSpot(game);
      const p = game.player;
      [p.x, p.y, p.z] = [at[0], at[1] - 0.3, at[2]];
      p.vx = p.vy = p.vz = 0;
      return at;
    },
    craneDrop: () => startCraneDrop(game),
    /** The TNT crate on the hook as it stands (stage, aim, monsters in its blast). */
    drop: () => {
      const d = game.craneDrop;
      const r = game.crane;
      return d ? { stage: d.stage, t: d.t, slew: d.slew, out: d.out, steer: d.steer, aim: d.aim, inBlast: d.inBlast, rig: [r.slew, r.luff, r.reach, r.mast, r.rope, r.o[0], r.o[1]], eye: game.eye(), cam: game.craneCam ? [game.craneCam.yaw, game.craneCam.pitch] : null } : null;
    },
    /** The operator's stick across the swing (-1..1 along the swing's own axis), pushed as the stick would be. */
    craneSteer: (v: number) => {
      const h = game.hoist;
      if (!h) return;
      const r = renderer.cam.r;
      game.setMove(v * (h.axis[0] * r[0] + h.axis[1] * r[2] >= 0 ? 1 : -1), 0);
    },
  };

  // ---------------- loop ----------------
  let last = performance.now();
  let stillWait = 0;
  const frame = (now: number): void => {
    // A phone draws no faster than asked: every other frame on a 120 Hz screen, and every second
    // or third at the 30 a tired device settles for (with room for a late vsync either way).
    if (renderer.mobile && now - last < (renderer.fpsCap === 30 ? 28 : 9.6)) {
      requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (game.phase !== 'title' && game.phase !== 'loading') {
      promoteHolds();
      if (game.isPlaying()) {
        const k = 2.2 * dt;
        game.look(((turn.right ? 1 : 0) - (turn.left ? 1 : 0)) * k, ((turn.up ? 1 : 0) - (turn.down ? 1 : 0)) * k * 0.7);
        if (capture.locked) {
          // Mining follows the crosshair as the view turns; right click held keeps building.
          if (heldButtons & 1) game.moveHold(game.viewRay());
          if (heldButtons & 2 && game.mode === 'build') {
            placeTimer -= dt;
            if (placeTimer <= 0) {
              placeTimer = PLACE_REPEAT;
              game.tap(game.viewRay());
            }
          }
        }
      }
      game.update(dt);
      // A menu over a world that waits for you (one player): the picture behind it need not be
      // drawn sixty times a second. A few frames a second keep it current; a phone stays cool.
      const still = (game.phase === 'day' || game.phase === 'night') && (game.paused || game.modal !== 'none') && !game.coopLive && !game.intro && !game.finale;
      stillWait -= dt;
      if (!still || stillWait <= 0) {
        stillWait = still ? 0.25 : 0;
        renderer.updateCamera(dt, game);
        renderer.render(game);
      }
    }
    ui.tick(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  gameplay.reportEvent('loading_complete');
}
