import './ui.css';
import { B, HOTBAR_PRIORITY, I, RECIPES, itemDef } from './blocks';
import { MAGAZINE, markPoint, turretCooldown, turretKind, turretReady, usesTnt } from './combat';
import { layoutText, textWidth } from './font';
import type { BannerTone, Game, GameUI, Outcome } from './game';
import { parkSpot } from './game';
import { mousePrimary, type InputMode } from './input';
import { drawMap, MAP_SPANS, mapView, type MapLook } from './minimap';
import { type Quality, type Renderer } from './render';
import { timeLabel } from './sky';
import { iconURL, tex } from './textures';
import { formatCode } from './cloud';
import { CoopHost } from './coop/host';
import { CoopGuest } from './coop/guest';
import { priceOf, questInfo, TRADES, trusts, upgradeCost, UPGRADE_PERK } from './quests';
import { ART_KEYS, artURL, dayPlan, handbook, nightPlan, partLabels, resetGuidance, training, trainingStep, TRAINING, type Lesson, type PointAt } from './guide';
import { Coach, type CardView, type Marker, type Pointer } from './coach';
import { introCaption } from './intro';
import { bountyProgress, bountyText } from './events';
import { bossBars, type BossBar } from './bosses';
import { effectList } from './effects';
import type { Vec3 } from './math3d';
import { HOIST_INFO } from './structures';
import { canStomp, POUND_STEAM } from './fortress';
import { CRANE_PARTS, craneGauge } from './crane';
import { CHAPTERS, DEFEAT_ART, elderLine, journalOf, page, PROLOGUE, PROLOGUE_SEALS, questRelic, RELICS, VICTORY_ART, type RelicId } from './story';
import { GUARDIANS, TROPHIES } from './seals';
import { chapterNow, EXPEDITIONS, logPage, mainObjective, SAGA_EPILOGUE, SAGA_FORGE, SAGA_OPENING, SAGA_VEYRA } from './mainquest';
import { CABINET, curioArt, curioOf, CURIOS, setDone } from './curios';
import { officer, OFFICERS } from './officers';
import { errands, hasOfficer, officerCall, stateOf } from './company';
import { BESTIARY } from './bestiary';
import { coatOf, forge, nextGear, swordOf, type GearSlot, type GearTier } from './gear';
import { itemMakes, itemName, itemUse } from './iteminfo';
import { wandererStock } from './folk';
import { FEATS, featCount, featDone, featProgress, type Feat } from './feats';
import type { BubbleKind } from './chatter';
import { clamp } from './rng';
import { viewPoint, viewRect } from './view';
import { canFullscreen, enterFullscreen, exitFullscreen, isFullscreen, onFullscreenChange } from './fullscreen';
import type { CombosLayoutContractApi } from '../../template-contracts';
import { compass, currentLang, deviceLang, flushText, LANGS, langName, makeText, onLangChange, prefetchLang, setData, setHTML, setLang, setText, tr, type Lang } from './i18n';

/** Where the dotted road runs on the painted atlas (percent across, percent down). */
const ATLAS_ROAD: ReadonlyArray<readonly [number, number]> = [
  [4, 46], [10, 48], [12, 72], [20, 78], [24, 60], [30, 42], [36, 70], [44, 78], [50, 60], [52, 50], [58, 70], [64, 55], [66, 62], [72, 60], [78, 75], [86, 75], [90, 55], [96, 35],
];

function atlasRoad(px: number): number {
  for (let i = 1; i < ATLAS_ROAD.length; i += 1) {
    const [x0, y0] = ATLAS_ROAD[i - 1]!;
    const [x1, y1] = ATLAS_ROAD[i]!;
    if (px <= x1) return y0 + ((y1 - y0) * (px - x0)) / (x1 - x0);
  }
  return ATLAS_ROAD[ATLAS_ROAD.length - 1]![1];
}

/** The fortress board's pieces (see UI.fortParts). */
interface FortParts {
  name: HTMLElement;
  meter: HTMLElement;
  bar: HTMLElement;
  val: HTMLElement;
  power: HTMLElement;
  powerLab: HTMLElement;
  gems: HTMLElement;
  legsWord: HTMLElement;
  legs: HTMLElement[];
}

/** A phone's board says it in glyphs: the fortress (battlements) and its power (a bolt). */
const FORT_GLYPH = '<svg class="glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 2h2v1.5h1V2h2v1.5h1V2h2v8H1z" fill="#e8eedd"/><path d="M4 7h2v3H4z" fill="#3a3a32"/></svg>';
const POWER_GLYPH = '<svg class="glyph" viewBox="0 0 8 10" aria-hidden="true"><path d="M5 0L0 6h3l-1 4 6-7H5z" fill="#ffd23a"/></svg>';

/** What the touch attack button uses at the crosshair when it is in hand (the rest it strikes and digs with). */
const ATTACK_USES = new Set<number>([I.TNT, I.GRAPPLE, I.CROSSBOW, I.BREAKER, I.PEARL, I.WIND_CHARGE, I.BREAD]);

/** The touch controls' painted parts (public/ui). */
const TOUCH_ART = {
  stick: 'joystick_base', knob: 'joystick_knob', jump: 'btn_jump', attack: 'btn_attack', use: 'btn_use',
  blue: 'btn_blank_blue', red: 'btn_blank_red', gold: 'btn_blank_gold', stone: 'btn_blank_stone', bag: 'btn_bag',
} as const;

/** A story card: a relic, a journal page, a land's chapter, the saga's art, an expedition, a crest, a curio; a word with an officer. */
export type StoryKind = 'relic' | 'page' | 'chapter' | 'saga' | 'expedition' | 'crest' | 'curio' | 'talk';

/** How a word with an officer stands (the last card says what follows). */
export type TalkMood = 'hello' | 'busy' | 'joined' | 'aboard';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) setHTML(node, html);
  return node;
}

function place(node: HTMLElement, x: number, y: number, w: number, h: number | null): void {
  // (The far edges are rounded where they fall, not the sizes: a box flush with the safe area's
  // edge keeps inside it, and boxes side by side never overlap by a pixel.)
  const left = Math.round(x);
  const top = Math.round(y);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.style.width = `${Math.round(x + w) - left}px`;
  if (h === null) node.style.removeProperty('height');
  else node.style.height = `${Math.round(y + h) - top}px`;
}

function region(node: HTMLElement, role: string, id: string, critical = true): void {
  node.setAttribute('data-combos-ui-region', role);
  node.setAttribute('data-combos-ui-id', id);
  if (!critical) node.setAttribute('data-combos-ui-critical', 'false');
}

/** The device's safe-area insets (a notch, the home bar), in CSS pixels. */
function surfaceInsets(): { top: number; right: number; bottom: number; left: number } {
  const surface = (window as unknown as { __surfaceTemplate?: { getMetrics(): { viewportSafeAreaInsets?: { top: number; right: number; bottom: number; left: number } } } }).__surfaceTemplate;
  return surface?.getMetrics().viewportSafeAreaInsets ?? { top: 0, right: 0, bottom: 0, left: 0 };
}

const HINTS_KEY = 'block-fortress-hints-v1';

/** What the jump button shows: jump, turn the building being placed, or the helm's steam valve. */
const JUMP_ICONS = {
  jump: '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" fill="#f4f4f4"><polygon points="1,6 7,6 4,2"/></svg>',
  steam: '<svg viewBox="0 0 10 10" fill="none" stroke="#f4f4f4" stroke-width="1.1" stroke-linecap="round"><path d="M3 7.5c-1-1 1-1.8 0-2.9S3 3 3 2M5 7.5c-1-1 1-1.8 0-2.9S5 3 5 2M7 7.5c-1-1 1-1.8 0-2.9S7 3 7 2"/><path d="M1.5 8.6h7" stroke-width="1.3"/></svg><span>STEAM</span>',
};

/** The title's key art, painted for each shape of screen (asset tasks, from the creator's mock-up). */
const TITLE_ART = {
  portrait: 'https://cdn.combos.fun/sealed-images/1000005196/301db7b6-e3b8-5a96-a1aa-363fdac00186.png',
  landscape: 'https://cdn.combos.fun/sealed-images/1000005196/f138128d-143d-598a-afa7-d4326298e698.png',
};
/** The logo, lifted from the same mock-up (public/title). */
const TITLE_LOGO = 'title/logo.webp';

/** Wide screens keep this much of the top-right corner clear for the host's own buttons. */
const HOST_CORNER = 76;

/** The language switch's globe. */
const GLOBE_SVG = '<svg class="globe" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><ellipse cx="8" cy="8" rx="2.7" ry="6.2"/><path d="M1.8 8h12.4M3 4.7h10M3 11.3h10"/></svg>';

/** The helm board's word for what holds the fortress up. */
const BLOCK_SHORT: Record<string, string> = { edge: 'VALLEY EDGE', walls: 'CITADEL WALLS', steep: 'TOO STEEP', giant: 'GIANT AHEAD', seal: 'HEART SEAL' };

function loadHintsSetting(): boolean {
  try {
    return window.localStorage.getItem(HINTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

const PROLOGUE_KEY = 'block-fortress-prologue-v2';

/** The prologue plays before a captain's first march (never under automation, unless asked). */
function wantsPrologue(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('prologue')) return true;
    if (navigator.webdriver) return false;
    return window.localStorage.getItem(PROLOGUE_KEY) !== 'seen';
  } catch {
    return false;
  }
}

function markPrologueSeen(): void {
  try {
    window.localStorage.setItem(PROLOGUE_KEY, 'seen');
  } catch {
    // storage may be unavailable
  }
}

function saveHintsSetting(on: boolean): void {
  try {
    window.localStorage.setItem(HINTS_KEY, on ? 'on' : 'off');
  } catch {
    // storage may be unavailable
  }
}

const COOP_NAME_KEY = 'block-fortress-coop-name';

/** The name this player goes by in co-op (blank: the default for the seat). */
function coopName(): string {
  try {
    return (window.localStorage.getItem(COOP_NAME_KEY) ?? '').slice(0, 16);
  } catch {
    return '';
  }
}

function saveCoopName(name: string): void {
  try {
    window.localStorage.setItem(COOP_NAME_KEY, name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16));
  } catch {
    // storage may be unavailable
  }
}

/** Long words in some languages: a label's type shrinks until it fits its button (never under 8px). */
function fitLabel(node: HTMLElement, room?: number): void {
  node.style.removeProperty('font-size');
  if (!node.firstChild) return;
  if (room === undefined) {
    const cs = getComputedStyle(node);
    room = node.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight) - 2;
  }
  if (room <= 0) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const w = viewRect(range).width;
  if (w <= room) return;
  const size = Number.parseFloat(getComputedStyle(node).fontSize) || 13;
  node.style.fontSize = `${Math.max(8, Math.floor((size * room) / w))}px`;
}

/** A faint pixel speckle for the title's riveted buttons (a 16x16 tile, as a CSS image). */
function speckle(): string {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d');
  if (!g) return 'none';
  let seed = 11;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? `rgba(0,0,0,${((0.5 - v) * 0.24).toFixed(3)})` : `rgba(255,255,255,${((v - 0.5) * 0.2).toFixed(3)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return `url(${c.toDataURL()})`;
}

/** A label's width in Latin letters (a Chinese character is about two; Hindi's vowel signs sit on their letters). */
function letters(text: string): number {
  let n = 0;
  for (const ch of text) n += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : /\p{M}/u.test(ch) ? 0 : 1;
  return n;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Title logo drawn with miniature block textures. */
export function drawBlockLogo(canvas: HTMLCanvasElement, cssWidth: number, dpr: number): number {
  const lines = [
    { text: 'WALKING', tex: 'grass_side' },
    { text: 'FORTRESS', tex: 'cobble' },
  ];
  const widest = Math.max(...lines.map((l) => textWidth(l.text)));
  const cell = Math.max(4, Math.floor((cssWidth / (widest + 1.5)) * dpr));
  const rowGap = Math.round(cell * 1.6);
  const height = lines.length * 7 * cell + (lines.length - 1) * rowGap + cell * 2;
  const width = (widest + 2) * cell;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width / dpr}px`;
  canvas.style.height = `${height / dpr}px`;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, width, height);
  lines.forEach((line, index) => {
    const lw = textWidth(line.text);
    const ox = Math.round((width - lw * cell) / 2);
    const oy = index * (7 * cell + rowGap) + cell / 2;
    const source = tex(line.tex);
    const cells: Array<[number, number]> = [];
    layoutText(line.text, (x, y) => cells.push([x, y]));
    c.fillStyle = 'rgba(10,8,20,0.85)';
    for (const [x, y] of cells) c.fillRect(ox + x * cell + cell * 0.28, oy + y * cell + cell * 0.32, cell, cell);
    for (const [x, y] of cells) {
      const above = cells.some(([ax, ay]) => ax === x && ay === y - 1);
      let sx = ((x * 5 + y * 3) % 3) * 8;
      let sy = 8 + ((x + y) % 3) * 8;
      if (line.tex === 'grass_side') {
        sy = above ? 12 + ((x + y) % 2) * 8 : 0;
      } else if (line.tex === 'tnt_side') {
        sy = above ? 22 : 2;
        sx = (x % 3) * 8 + 2;
      }
      c.drawImage(source, sx, sy, 8, 8, ox + x * cell, oy + y * cell, cell, cell);
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(ox + x * cell, oy + y * cell, cell, Math.max(1, Math.round(cell / 8)));
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(ox + x * cell, oy + (y + 1) * cell - Math.max(1, Math.round(cell / 8)), cell, Math.max(1, Math.round(cell / 8)));
    }
  });
  return height / dpr;
}

export class UI implements GameUI {
  private readonly game: Game;
  private readonly renderer: Renderer;
  private readonly contract: CombosLayoutContractApi | null;
  readonly root: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  /** First person or third: beside the pause button (V on a keyboard). */
  private readonly viewBtn: HTMLButtonElement;
  private readonly fortPanel: HTMLElement;
  private readonly dayPill: HTMLElement;
  private readonly helmPanel: HTMLElement;
  private readonly bossBar: HTMLElement;
  private bossShown = false;
  private lastBoss = '';
  /** The coach: mission cards, the pointing hand, the marker over the spot, cheers, captions. */
  readonly coach: Coach;
  private readonly planPanel: HTMLElement;
  private readonly tipEl: HTMLElement;
  private readonly briefEl: HTMLElement;
  private readonly guideModal: HTMLElement;
  private readonly villageModal: HTMLElement;
  private villageIndex = -1;
  private readonly hint: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly vitals: HTMLElement;
  /** The status effects on you (icons with the seconds left), over the hearts. */
  private readonly effectsEl: HTMLElement;
  private lastEffects = '';
  private readonly hotbar: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly jumpBtn: HTMLButtonElement;
  private readonly crosshair: HTMLElement;
  private readonly hitmark: HTMLElement;
  private readonly craneEl: HTMLElement;
  private readonly threatLayer: HTMLElement;
  private readonly threatEls: HTMLElement[] = [];
  /** Damage numbers and pop words floating off struck creatures. */
  private readonly floatLayer: HTMLElement;
  private floaters: Array<{ el: HTMLElement; x: number; y: number; z: number; t: number; life: number; rise: number }> = [];
  /** Speech bubbles over heads (they follow their speakers), at most a few at once. */
  private readonly bubbleLayer: HTMLElement;
  /** Speech bubbles on screen (with what was last written to each: a style is set only when it changes). */
  private bubbles: Array<{ el: HTMLElement; at: () => Vec3 | null; t: number; life: number; w: number; h: number; css: string; op: string; tail: string }> = [];
  /** The gold card of a feat just earned (more wait their turn), and the list of them all. */
  private readonly featEl: HTMLElement;
  private featQueue: Feat[] = [];
  private featNow: Feat | null = null;
  private featTimer = 0;
  private readonly featsModal: HTMLElement;
  /** Red arcs at the screen edge pointing to where a blow came from. */
  private readonly hurtEls: HTMLElement[] = [];
  private hurtNext = 0;
  private flying = 0;
  /** Items flying into the hotbar right now (their slots bump on arrival instead). */
  private readonly inbound = new Set<number>();
  private lastCounts = new Map<number, number>();
  private lastHit = -10;
  private readonly prompt: HTMLButtonElement;
  private stickPointer: number | null = null;
  /** Where the stick rests, and the zone a thumb can bring it to anywhere (as in Minecraft on a phone). */
  private stickHome = { x: 0, y: 0, size: 120 };
  private readonly stickZone: HTMLElement;
  /** The attack button, held: mines or strikes at the crosshair while the other thumb looks round. */
  private readonly attackBtn: HTMLButtonElement;
  private attackHeld = false;
  /**
   * Touches in the thick of it (a thumb sweeping the view round, holding on a block, the attack
   * button held), and how long they have gone on or how long it has been quiet since: while they
   * last, the boards, the card and the news step back so the view is clear.
   */
  private acting = 0;
  private actingFor = 0;
  private calmFor = 0;
  private readonly fireBtn: HTMLButtonElement;
  private readonly leapBtn: HTMLButtonElement;
  private readonly hornBtn: HTMLButtonElement;
  private readonly stompBtn: HTMLButtonElement;
  private readonly marchBtn: HTMLButtonElement;
  private readonly mapBtn: HTMLButtonElement;
  /** Story cards (relics handed over, journal pages found), the journal itself and the prologue. */
  private readonly storyModal: HTMLElement;
  private readonly journalModal: HTMLElement;
  private readonly prologue: HTMLElement;
  private storyQueue: Array<{ kind: StoryKind; id: string }> = [];
  private storyOpen = false;
  private storyPrev: Game['modal'] = 'none';
  /** Keyboard handler while the prologue plays (true: the key was used). */
  prologueKey: ((code: string) => boolean) | null = null;
  private readonly loading: HTMLElement;
  private readonly loadingBar: HTMLElement;
  private readonly loadingText: HTMLElement;
  readonly title: HTMLElement;
  readonly titleArt: HTMLImageElement;
  private readonly titlePanel: HTMLElement;
  private readonly logo: HTMLCanvasElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly cloudBtn: HTMLButtonElement;
  private readonly coopBtn: HTMLButtonElement;
  private readonly titleNote: HTMLElement;
  private readonly titleTop: HTMLElement;
  /** The painted logo (the block-letter canvas stands in if it cannot load), and its width / height. */
  private readonly titleLogo: HTMLImageElement;
  private logoAspect = 2;
  /** The key art shown (portrait or landscape) and whether the title is laid out for a wide screen. */
  private titleArtSrc = '';
  private titleWide = false;
  /** The language: a switch in the title's corner (and the pause menu), and the list of languages. */
  private readonly langPill: HTMLElement;
  private readonly langModal: HTMLElement;
  private langFrom: 'title' | 'pause' | null = null;
  private langNote = '';
  private readonly backdrop: HTMLElement;
  /** The cloud save panel (from the title screen or the pause menu). */
  private readonly cloudModal: HTMLElement;
  private cloudFrom: 'title' | 'pause' | null = null;
  private cloudFound: Exclude<Awaited<ReturnType<Game['cloud']['peek']>>, string> | null = null;
  private cloudNote = '';
  /** Playing together (co-op): the panel, where it was opened from, its last word; the HUD strip. */
  private readonly coopModal: HTMLElement;
  private readonly coopStrip: HTMLElement;
  /** Co-op: the mate's name over its head. */
  private readonly mateTag: HTMLElement;
  private mateTagText = '';
  private coopFrom: 'title' | 'pause' | null = null;
  private coopNote = '';
  private coopBusy = false;
  private coopShown = false;
  private lastCoop = '';
  /** A room code to fill in (from a ?coop= link). */
  coopCode = '';
  private readonly craftModal: HTMLElement;
  private readonly pauseModal: HTMLElement;
  private readonly resultModal: HTMLElement;
  private readonly mapModal: HTMLElement;
  private mapCanvas: HTMLCanvasElement | null = null;
  private hintText = '';
  private hintTop = 0;
  /** Where announcements sit when nothing else is in the way. */
  private bannerY0 = 0;
  /** Lowest point damage numbers may sit (above the hearts and the hotbar). */
  private floatBottom = 600;
  /** Where the hotbar sits (the crane's gauge takes its place while you work the crane). */
  private hotbarBox = { x: 0, y: 0, w: 300, h: 48 };
  /** Bottom of the cards stacked under the HUD (briefing, tip, feat): bubbles keep below it. */
  private stackBottom = 0;
  private hudTimer = 0;
  private slotCount = 7;
  private ctx = { right: 0, bottom: 0, w: 64, h: 64 };
  private hintRoom = 999;
  private bannerTimer = 0;
  /** The announcement's lower edge (-1: not measured since it was last placed). */
  private bannerFoot = -1;
  private lastFort = '';
  private lastDay = '';
  private lastVitals = '';
  private lastPrompt = '';
  private safe = { x: 0, y: 0, width: 393, height: 725 };
  private short = false;
  mode: 'loading' | 'title' | 'play' | 'modal' = 'loading';
  inputMode: InputMode = 'touch';
  onResumePlay: (() => void) | null = null;
  onSuspendPlay: (() => void) | null = null;

  constructor(viewport: HTMLElement, game: Game, renderer: Renderer, contract: CombosLayoutContractApi | null) {
    this.game = game;
    this.renderer = renderer;
    this.contract = contract;
    const root = el('div');
    root.id = 'ui';
    viewport.appendChild(root);
    this.root = root;
    root.style.setProperty('--mc-noise', speckle());

    this.pauseBtn = el('button', 'abs stone', '<div class="bars"><span></span><span></span></div>');
    this.pauseBtn.id = 'hud-pause';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    region(this.pauseBtn, 'controls', 'pause');
    // (It shows the view you have: your eyes, or you from behind.)
    this.viewBtn = el('button', 'abs stone', '<img alt=""><em class="key">V</em>');
    this.viewBtn.id = 'hud-view';
    this.viewBtn.setAttribute('data-combos-action', 'view');
    region(this.viewBtn, 'controls', 'view');
    this.viewBtn.addEventListener('click', () => this.toggleView());
    this.refreshViewBtn();
    this.fortPanel = el('div', 'abs hudpanel');
    this.fortPanel.id = 'hud-fort';
    region(this.fortPanel, 'hud', 'fortress');
    this.dayPill = el('div', 'abs hudpanel');
    this.dayPill.id = 'hud-day';
    region(this.dayPill, 'hud', 'day');
    this.helmPanel = el('div', 'abs hudpanel hidden');
    this.helmPanel.id = 'hud-helm';
    region(this.helmPanel, 'hud', 'helm', false);
    // Playing together: who is aboard with you and how the line is (tap: the co-op panel).
    this.coopStrip = el('button', 'abs hudpanel hidden');
    this.coopStrip.id = 'hud-coop';
    region(this.coopStrip, 'hud', 'coop', false);
    this.coopStrip.addEventListener('click', () => {
      this.game.audio.play('click');
      this.openPause();
      if (this.game.modal === 'pause') this.openCoop('pause');
    });
    // Co-op: your mate's name over its head, so you can find each other.
    this.mateTag = el('div', 'abs hidden');
    this.mateTag.id = 'mate-tag';
    region(this.mateTag, 'decorative', 'mate-tag', false);
    // A giant in the fight: its name and the health of its Heart (the block that kills it).
    this.bossBar = el('div', 'abs hudpanel hidden');
    this.bossBar.id = 'hud-boss';
    region(this.bossBar, 'hud', 'boss', false);
    // The coach's card (training steps, lessons, the next goal: tap a goal for today's plan),
    // the plan itself, one-time tips and briefing cards.
    this.coach = new Coach();
    this.ringEl = el('div', 'abs hidden', '<i></i>');
    this.ringEl.id = 'coach-ring';
    region(this.ringEl, 'decorative', 'coach-ring', false);
    this.coach.onResize = () => this.placeStack();
    this.coach.onMore = () => this.togglePlan();
    this.coach.onEnter = () => this.game.audio.play('whoosh');
    this.coach.onSkip = () => this.skipTraining();
    this.coach.cine.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.game.audio.unlock();
      this.game.skipIntro();
    });
    this.planPanel = el('div', 'abs hudpanel hidden');
    this.planPanel.id = 'hud-plan';
    region(this.planPanel, 'hud', 'plan', false);
    this.tipEl = el('div', 'abs hidden');
    this.tipEl.id = 'tip';
    region(this.tipEl, 'text', 'tip', false);
    this.tipEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.tipEl.classList.add('hidden');
      this.tipTimer = 0;
      this.placeToasts();
    });
    this.briefEl = el('div', 'abs hidden');
    this.briefEl.id = 'brief';
    region(this.briefEl, 'text', 'briefing', false);
    this.briefEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hideBrief();
    });
    this.guideModal = el('div', 'abs modal hidden');
    this.guideModal.id = 'guide-modal';
    region(this.guideModal, 'modal', 'guide');
    this.villageModal = el('div', 'abs modal hidden');
    this.villageModal.id = 'village-modal';
    region(this.villageModal, 'modal', 'village');
    this.hint = el('div', 'abs hudpanel');
    this.hint.id = 'hint';
    this.hint.style.visibility = 'hidden';
    region(this.hint, 'text', 'hint');
    this.toasts = el('div', 'abs');
    this.toasts.id = 'toasts';
    region(this.toasts, 'text', 'toasts', false);
    this.bannerEl = el('div', 'abs');
    this.bannerEl.id = 'banner';
    region(this.bannerEl, 'text', 'banner', false);
    this.vitals = el('div', 'abs');
    this.vitals.id = 'vitals';
    region(this.vitals, 'hud', 'vitals');
    this.effectsEl = el('div', 'abs');
    this.effectsEl.id = 'effects';
    region(this.effectsEl, 'hud', 'effects', false);

    this.hotbar = el('div', 'abs');
    this.hotbar.id = 'hotbar';
    region(this.hotbar, 'controls', 'hotbar');

    this.stick = el('div', 'abs stick', '<div class="knob"></div>');
    this.stick.setAttribute('aria-label', 'Move');
    this.stick.setAttribute('data-combos-interactive', 'true');
    region(this.stick, 'controls', 'move-stick');
    this.knob = this.stick.querySelector('.knob') as HTMLElement;
    this.stickZone = el('div', 'abs stick-zone');
    region(this.stickZone, 'decorative', 'stick-zone', false);
    this.bindStick();
    // (With a throwable, a relic or bread in hand, its picture on gold: the button uses it.)
    this.attackBtn = el('button', 'abs ctl attack', '<img class="held" alt="">');
    this.attackBtn.setAttribute('aria-label', 'Attack / mine');
    this.attackBtn.setAttribute('data-combos-action', 'attack');
    region(this.attackBtn, 'controls', 'attack');
    this.bindAttack();
    // The touch controls' art (the stylesheet reads it through these).
    for (const [name, file] of Object.entries(TOUCH_ART)) {
      const url = new URL(`ui/${file}.webp`, document.baseURI).href;
      root.style.setProperty(`--ui-${name}`, `url("${url}")`);
      // (Fetched now, so the thumbs have their buttons the moment play starts.)
      new Image().src = url;
    }
    this.jumpBtn = el('button', 'abs stone ctl jump', '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" fill="#f4f4f4"><polygon points="1,6 7,6 4,2"/></svg>');
    this.jumpBtn.setAttribute('aria-label', 'Jump / climb');
    this.jumpBtn.setAttribute('data-combos-action', 'jump');
    region(this.jumpBtn, 'controls', 'jump');
    this.bindJump();
    this.crosshair = el('div', 'abs');
    this.crosshair.id = 'crosshair';
    region(this.crosshair, 'decorative', 'crosshair', false);
    this.hitmark = el('div', 'abs', '<i></i><i></i><i></i><i></i>');
    this.hitmark.id = 'hitmark';
    region(this.hitmark, 'decorative', 'hitmark', false);
    // The crane's gauge: HEAVE as the strain comes on, DROP as the load swings over its mark.
    this.craneEl = el('button', 'abs hidden', '<b></b><div class="cg-bar"><i class="cg-gold"></i><i class="cg-tip"></i><i class="cg-mark"></i></div><em class="cg-count"></em><small></small>');
    this.craneEl.id = 'crane-gauge';
    this.craneEl.setAttribute('data-combos-action', 'crane');
    this.craneEl.setAttribute('aria-label', 'Work the crane');
    region(this.craneEl, 'controls', 'crane-gauge');
    this.craneEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.game.audio.unlock();
      this.game.use(false);
    });
    this.threatLayer = el('div', 'abs');
    this.threatLayer.id = 'threats';
    region(this.threatLayer, 'decorative', 'threats', false);
    for (let i = 0; i < 6; i += 1) {
      const t = el('div', 'threat hidden', '<svg viewBox="0 0 10 10"><polygon points="5,0 10,9 5,6.5 0,9"/></svg><span></span>');
      this.threatLayer.appendChild(t);
      this.threatEls.push(t);
    }
    this.floatLayer = el('div', 'abs');
    this.floatLayer.id = 'floaters';
    region(this.floatLayer, 'decorative', 'floaters', false);
    this.bubbleLayer = el('div', 'abs');
    this.bubbleLayer.id = 'bubbles';
    region(this.bubbleLayer, 'decorative', 'speech', false);
    this.featEl = el('div', 'abs');
    this.featEl.id = 'feat-pop';
    region(this.featEl, 'text', 'feat', false);
    this.featEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.featTimer = Math.min(this.featTimer, 0.01);
    });
    this.featsModal = el('div', 'abs modal hidden');
    this.featsModal.id = 'feats-modal';
    region(this.featsModal, 'modal', 'feats');
    for (let i = 0; i < 3; i += 1) {
      const h = el('div', 'hurtdir');
      this.threatLayer.appendChild(h);
      this.hurtEls.push(h);
    }
    this.prompt = el('button', 'abs hidden', '<em class="pk">E</em><span></span>');
    this.prompt.id = 'prompt';
    this.prompt.setAttribute('data-combos-action', 'use');
    region(this.prompt, 'controls', 'use');
    this.prompt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.game.use(false, this.lastPrompt);
    });

    this.fireBtn = el('button', 'abs stone ctx-btn fire', `<img alt="" src="${iconURL('ui_boom')}"><span>FIRE</span><em class="key">F</em>`);
    this.fireBtn.setAttribute('data-combos-action', 'fire');
    region(this.fireBtn, 'controls', 'fire');
    this.leapBtn = el('button', 'abs stone ctx-btn leap', `<img alt="" src="${iconURL('ui_leap')}"><span>LEAP</span><em class="key">R</em>`);
    this.leapBtn.setAttribute('data-combos-action', 'leap');
    region(this.leapBtn, 'controls', 'leap');
    this.hornBtn = el('button', 'abs stone ctx-btn horn hidden', `<img alt="" src="${iconURL('horn_item')}"><span>HORN</span><em class="key">G</em>`);
    this.hornBtn.setAttribute('data-combos-action', 'horn');
    region(this.hornBtn, 'controls', 'horn');
    this.hornBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.game.blowHorn();
    });
    // STOMP: a tap stomps; held, the hull heaves higher and slams down harder when let go.
    this.stompBtn = el('button', 'abs stone ctx-btn stomp hidden', `<i class="charge"></i><img alt="" src="${iconURL('ui_stomp')}"><span>STOMP</span><em class="key">X</em><b class="badge"></b>`);
    this.stompBtn.setAttribute('data-combos-action', 'stomp');
    region(this.stompBtn, 'controls', 'stomp');
    this.stompBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        this.stompBtn.setPointerCapture(e.pointerId);
      } catch {
        // synthetic pointers may not support capture
      }
      this.game.audio.unlock();
      this.game.stompPress();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.stompBtn.addEventListener(name, () => this.game.stompRelease());
    this.marchBtn = el('button', 'abs stone ctx-btn march', `<img alt="" src="${iconURL('ui_moon')}"><span>MARCH</span><em class="key">N</em>`);
    this.marchBtn.setAttribute('data-combos-action', 'march');
    region(this.marchBtn, 'controls', 'march');
    this.mapBtn = el('button', 'abs stone ctx-btn map', `<img alt="" src="${iconURL('ui_map')}"><span>MAP</span><em class="key">M</em>`);
    this.mapBtn.setAttribute('data-combos-action', 'map');
    region(this.mapBtn, 'controls', 'map');
    this.fireBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.game.fireCannon();
    });
    this.leapBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.game.doLeap();
    });
    this.marchBtn.addEventListener('click', () => {
      this.game.audio.play('click');
      this.openMap();
    });
    this.mapBtn.addEventListener('click', () => {
      this.game.audio.play('click');
      this.openMap();
    });

    this.loading = el('div', 'overlay', `<img class="loading-logo" alt="" src="${new URL(TITLE_LOGO, document.baseURI).href}"><div class="loading-title">WALKING FORTRESS</div><div class="loading-text">Loading the valley...</div><div class="meter"><i></i></div>`);
    this.loading.id = 'loading';
    region(this.loading, 'modal', 'loading');
    this.loadingBar = this.loading.querySelector('.meter > i') as HTMLElement;
    this.loadingText = this.loading.querySelector('.loading-text') as HTMLElement;
    // The painted logo in place of the plain words once it has loaded.
    const loadingLogo = this.loading.querySelector<HTMLImageElement>('.loading-logo')!;
    const logoIn = (): void => this.loading.classList.add('logo-in');
    if (loadingLogo.complete && loadingLogo.naturalWidth > 0) logoIn();
    else loadingLogo.addEventListener('load', logoIn, { once: true });

    // The title: the painted valley with the fortress striding through it, the logo, and riveted
    // buttons (portrait: logo over the fortress, buttons under it; wide screens: both down the left).
    this.title = el('div', 'overlay hidden');
    this.title.id = 'title';
    this.titleArt = el('img', 'art');
    this.titleArt.alt = '';
    this.titleArt.setAttribute('data-combos-asset-role', 'title_key_art');
    region(this.titleArt, 'decorative', 'title-art', false);
    this.titleArt.addEventListener('load', () => {
      this.titleArt.classList.add('in');
      // (The loading screen shows the same valley, dimmed, as soon as it is in.)
      this.loading.style.setProperty('--art', `url("${this.titleArt.currentSrc || this.titleArt.src}")`);
      this.loading.classList.add('art-in');
    });
    this.titleArt.addEventListener('error', () => this.titleArt.classList.remove('in'));
    const shade = el('div', 'shade');
    this.titlePanel = el('div', 'abs');
    this.titlePanel.id = 'title-panel';
    region(this.titlePanel, 'modal', 'title');
    this.titleLogo = el('img', 't-logo');
    this.titleLogo.alt = 'Minecraft: Walking Fortress';
    this.titleLogo.setAttribute('data-combos-asset-role', 'title_logo');
    this.titleLogo.decoding = 'async';
    this.titleLogo.addEventListener('load', () => {
      this.logoAspect = this.titleLogo.naturalWidth / Math.max(1, this.titleLogo.naturalHeight) || 2;
      if (this.mode === 'title') this.layout();
    });
    this.titleLogo.addEventListener('error', () => {
      this.titleLogo.classList.add('hidden');
      this.logo.classList.remove('hidden');
      if (this.mode === 'title') this.layout();
    });
    this.logo = el('canvas', 'logo hidden');
    const top = el('div', 't-top');
    this.titleTop = top;
    top.append(this.titleLogo, this.logo);
    const bottom = el('div', 'bottom');
    this.playBtn = el('button', 'mc-btn mc-green t-main', 'PLAY');
    this.playBtn.setAttribute('data-combos-action', 'start');
    this.continueBtn = el('button', 'mc-btn mc-green t-main hidden', 'CONTINUE');
    this.continueBtn.setAttribute('data-combos-action', 'continue');
    this.cloudBtn = el('button', 'mc-btn mc-blue', `<img alt="" src="${iconURL('ui_cloud')}"><span>CLOUD SAVE</span>`);
    this.cloudBtn.setAttribute('data-combos-action', 'cloud');
    this.coopBtn = el('button', 'mc-btn mc-blue', `<img alt="" src="${iconURL('ui_coop')}"><span>PLAY TOGETHER</span>`);
    this.coopBtn.setAttribute('data-combos-action', 'coop');
    const row = el('div', 'title-row');
    row.append(this.cloudBtn, this.coopBtn);
    this.titleNote = el('div', 'note', '');
    // (With a game saved, CONTINUE is the big button and NEW GAME the small one under it.)
    bottom.append(this.continueBtn, this.playBtn, row, this.titleNote);
    this.titlePanel.append(top, bottom);
    // The language switch in the corner: every language a tap away by its short name, the globe for
    // the full list (each language by its own name).
    this.langPill = el('div', 'abs lang-pill');
    this.langPill.setAttribute('translate', 'no');
    region(this.langPill, 'controls', 'language');
    // (It sits in the panel's top corner on purpose: the logo moves down out of its way.)
    this.langPill.setAttribute('data-combos-overlap-allow', 'title');
    this.titlePanel.setAttribute('data-combos-overlap-allow', 'language');
    this.title.append(this.titleArt, shade, this.titlePanel, this.langPill);

    this.backdrop = el('div', 'modal-backdrop hidden');
    this.craftModal = el('div', 'abs modal hidden');
    this.craftModal.id = 'craft-modal';
    region(this.craftModal, 'modal', 'workshop');
    this.pauseModal = el('div', 'abs modal hidden');
    this.pauseModal.id = 'pause-modal';
    region(this.pauseModal, 'modal', 'pause-menu');
    this.resultModal = el('div', 'abs modal hidden');
    this.resultModal.id = 'result-modal';
    region(this.resultModal, 'modal', 'result');
    this.mapModal = el('div', 'abs modal hidden');
    this.mapModal.id = 'map-modal';
    region(this.mapModal, 'modal', 'map');
    this.storyModal = el('div', 'abs hidden');
    this.storyModal.id = 'story-modal';
    region(this.storyModal, 'modal', 'story');
    this.journalModal = el('div', 'abs modal hidden');
    this.journalModal.id = 'journal-modal';
    region(this.journalModal, 'modal', 'journal');
    this.prologue = el('div', 'overlay hidden');
    this.prologue.id = 'prologue';
    region(this.prologue, 'modal', 'prologue');
    this.cloudModal = el('div', 'abs modal hidden');
    this.cloudModal.id = 'cloud-modal';
    region(this.cloudModal, 'modal', 'cloud');
    this.coopModal = el('div', 'abs modal hidden');
    this.coopModal.id = 'coop-modal';
    region(this.coopModal, 'modal', 'coop');
    this.langModal = el('div', 'abs modal hidden');
    this.langModal.id = 'lang-modal';
    region(this.langModal, 'modal', 'language');

    root.append(
      this.threatLayer, this.floatLayer, this.bubbleLayer, this.mateTag, ...this.coach.under, this.crosshair, this.hitmark, this.pauseBtn, this.viewBtn, this.fortPanel, this.dayPill, this.helmPanel, this.coopStrip, this.coach.card, this.bossBar, this.hint, this.tipEl, this.featEl, this.toasts, this.bannerEl, this.briefEl, this.vitals, this.effectsEl, this.hotbar,
      this.stickZone, this.stick, this.jumpBtn, this.attackBtn, this.fireBtn, this.stompBtn, this.leapBtn, this.hornBtn, this.marchBtn, this.mapBtn, this.prompt, this.craneEl,
      this.planPanel, this.ringEl, ...this.coach.over, this.title, this.backdrop, this.craftModal, this.pauseModal, this.resultModal, this.mapModal, this.villageModal, this.guideModal, this.journalModal, this.featsModal, this.cloudModal, this.coopModal, this.langModal, this.storyModal, this.coach.cine, this.prologue, this.loading,
    );

    this.pauseBtn.addEventListener('click', () => this.openPause());
    // Play takes the whole screen where the page may: a computer's, or a phone's on its side. A
    // computer's preview of the phone game stays in its phone frame (the whole monitor is no phone's).
    const fillScreen = (): void => {
      const phone = this.inputMode === 'touch';
      if (!phone || !mousePrimary()) enterFullscreen(phone);
    };
    // The press only unlocks audio; the world starts on the next tick so the click returns at once.
    let starting = false;
    const begin = (run: () => void): void => {
      this.game.audio.unlock();
      fillScreen();
      if (starting) return;
      starting = true;
      window.setTimeout(() => {
        starting = false;
        if (this.mode !== 'title') return;
        run();
        this.onResumePlay?.();
      }, 0);
    };
    this.playBtn.addEventListener('click', () => {
      // The first new game opens on the prologue (three illustrated pages, skippable).
      if (wantsPrologue()) {
        this.game.audio.unlock();
        fillScreen();
        this.showPrologue(() => begin(() => this.game.newGame()));
      } else begin(() => this.game.newGame());
    });
    this.continueBtn.addEventListener('click', () => begin(() => this.game.continueGame()));
    this.cloudBtn.addEventListener('click', () => {
      this.game.audio.unlock();
      this.game.audio.play('click');
      this.openCloud('title');
    });
    this.coopBtn.addEventListener('click', () => {
      this.game.audio.unlock();
      this.game.audio.play('click');
      this.openCoop('title');
    });
    this.langPill.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]');
      if (!button) return;
      this.game.audio.unlock();
      this.game.audio.play('click');
      const code = button.dataset.lang;
      if (code === 'list' || !LANGS.some((l) => l.code === code)) {
        this.openLang('title');
        return;
      }
      // (The language already in use: nothing to switch.)
      if (code === currentLang()) return;
      // (It lights at once, beside the words; once the switch settles the pill is redrawn from the
      // language actually in use, so a dictionary that failed to load never leaves it claiming one.)
      button.classList.add('on');
      void setLang(code as Lang, true).then(() => this.renderLangPill());
    });
    // Everything written re-translates itself; what is drawn or remembered is redone.
    onLangChange(() => this.relabel());
    this.game.cloud.onChange = () => {
      if (this.cloudFrom) this.renderCloud();
      if (this.mode === 'title') this.refreshTitleCloud();
    };
    this.backdrop.addEventListener('pointerdown', (e) => e.preventDefault());
    // (The pause menu's fullscreen tile follows the page in and out, Esc included.)
    onFullscreenChange(() => {
      if (this.game.modal === 'pause') this.openPauseRefresh();
    });
    this.setMode('loading');
    document.getElementById('boot-loading')?.remove();
  }

  /**
   * Virtual joystick: drag from the centre to walk (up = forward). A small dead centre; full speed a
   * little short of the rim (a thumb need not stretch to run); within a few degrees of straight
   * ahead (or back, or sideways) it walks dead straight, for narrow decks and ladders. A thumb run
   * on past the rim drags the stick after it, so it never has to come back to find it.
   */
  private bindStick(): void {
    // Where the stick sits, measured once per press (measuring on every move would make the page lay
    // itself out a hundred times a second); it moves only when the thumb drags it along.
    let cx = 0;
    let cy = 0;
    let radius = 1;
    let rootX = 0;
    let rootY = 0;
    const DEAD = 0.14;
    const FULL = 0.86;
    const SNAP = 0.16;
    const measure = (): void => {
      const rect = viewRect(this.stick);
      const root = viewRect(this.root);
      radius = Math.max(1, rect.width / 2);
      cx = rect.x + radius;
      cy = rect.y + radius;
      rootX = root.x;
      rootY = root.y;
    };
    const update = (event: PointerEvent): void => {
      const reach = radius * 0.8;
      const at = viewPoint(event.clientX, event.clientY);
      let dx = (at.x - cx) / reach;
      let dy = (at.y - cy) / reach;
      let l = Math.hypot(dx, dy);
      if (l > 1.2) {
        // Dragged along (kept to the left part of the view, where the thumb works it).
        const pull = (l - 1.2) * reach;
        cx = clamp(cx + (dx / l) * pull, rootX + radius, rootX + Math.max(radius, this.vw * 0.62 - radius));
        cy = clamp(cy + (dy / l) * pull, rootY + Math.min(this.vh * 0.3, this.vh - radius), rootY + this.vh - radius);
        this.stick.style.left = `${Math.round(cx - radius - rootX)}px`;
        this.stick.style.top = `${Math.round(cy - radius - rootY)}px`;
        dx = (at.x - cx) / reach;
        dy = (at.y - cy) / reach;
        l = Math.hypot(dx, dy);
      }
      if (l > 1) {
        dx /= l;
        dy /= l;
        l = 1;
      }
      let mx = 0;
      let my = 0;
      if (l > DEAD) {
        let a = Math.atan2(dy, dx);
        const axis = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(a - axis) < SNAP) a = axis;
        const m = Math.min(1, (l - DEAD) / (FULL - DEAD));
        mx = Math.cos(a) * m;
        my = Math.sin(a) * m;
      }
      this.game.setMove(mx, -my);
      this.knob.style.transform = `translate(${Math.round(dx * radius * 0.55)}px, ${Math.round(dy * radius * 0.55)}px)`;
    };
    const release = (): void => {
      this.stickPointer = null;
      this.stick.classList.remove('pressed');
      this.knob.style.transform = '';
      this.game.setMove(0, 0);
      this.restStick();
    };
    const press = (node: HTMLElement, event: PointerEvent): void => {
      event.preventDefault();
      this.stickPointer = event.pointerId;
      this.stick.classList.add('pressed');
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // synthetic pointers may not support capture
      }
      this.game.audio.unlock();
      measure();
      update(event);
    };
    this.stick.addEventListener('pointerdown', (event) => {
      if (this.stickPointer === null) press(this.stick, event);
    });
    // A thumb landing anywhere in the zone: the stick comes to it.
    this.stickZone.addEventListener('pointerdown', (event) => {
      if (this.stickPointer !== null) return;
      const root = viewRect(this.root);
      const at = viewPoint(event.clientX, event.clientY);
      const s = this.stickHome.size;
      this.stick.style.left = `${Math.round(at.x - root.x - s / 2)}px`;
      this.stick.style.top = `${Math.round(at.y - root.y - s / 2)}px`;
      press(this.stickZone, event);
    });
    for (const node of [this.stick, this.stickZone]) {
      node.addEventListener('pointermove', (event) => {
        if (event.pointerId === this.stickPointer) update(event);
      });
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        node.addEventListener(name, (event) => {
          if (event.pointerId === this.stickPointer) release();
        });
      }
    }
  }

  /** The stick goes back to where it rests. */
  private restStick(): void {
    const h = this.stickHome;
    place(this.stick, h.x, h.y, h.size, h.size);
  }

  /**
   * Held, the attack button mines or strikes at the crosshair (the fingers are free to look round;
   * the crossbow keeps shooting). With a throwable, a relic or bread in hand, a press uses it at the
   * crosshair instead: TNT and charges fly, the hook shoots, the bread is eaten.
   */
  private bindAttack(): void {
    const button = this.attackBtn;
    const release = (): void => {
      button.classList.remove('pressed');
      if (!this.attackHeld) return;
      this.attackHeld = false;
      this.act(false);
      this.game.endHold();
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.classList.add('pressed');
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // synthetic pointers may not support capture
      }
      this.game.audio.unlock();
      const use = this.attackUse();
      if (use !== null && use !== I.CROSSBOW) {
        this.game.tap(this.game.viewRay());
        return;
      }
      this.attackHeld = true;
      this.act(true);
      this.game.beginHold(this.game.viewRay());
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(name, release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** A touch in the thick of it began (true) or ended (false): see `acting`. */
  act(on: boolean): void {
    this.acting = Math.max(0, this.acting + (on ? 1 : -1));
  }

  /** The boards, the card and the news step back while the view is being worked (phones only). */
  private tickActing(dt: number): void {
    const busy = this.acting > 0 && this.mode === 'play' && this.inputMode === 'touch' && !this.coach.open;
    if (busy) {
      this.actingFor += dt;
      this.calmFor = 0;
    } else {
      this.actingFor = 0;
      this.calmFor += dt;
    }
    // (A quick flick does not dim it; it comes back a moment after the thumb lifts.)
    const on = busy ? this.actingFor > 0.22 : this.root.classList.contains('acting') && this.calmFor < 0.7;
    if (this.root.classList.contains('acting') !== on) this.root.classList.toggle('acting', on);
  }

  /** The item the attack button uses rather than striking with (null: it strikes and digs). */
  private attackUse(): number | null {
    const g = this.game;
    if (g.mode !== 'mine' || g.helm || g.gunner || g.carried) return null;
    const id = g.selected;
    return id !== null && ATTACK_USES.has(id) && g.count(id) > 0 ? id : null;
  }

  private bindJump(): void {
    const button = this.jumpBtn;
    const release = (): void => {
      button.classList.remove('pressed');
      this.game.setJump(false);
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.classList.add('pressed');
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // synthetic pointers may not support capture
      }
      this.game.setJump(true);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  // ------------------------------------------------------------------ modes

  setInputMode(mode: InputMode): void {
    this.inputMode = mode;
    this.coach.pc = mode === 'desktop';
    this.root.classList.toggle('desktop', mode === 'desktop');
    this.releaseInputs();
    if (this.mode === 'play') this.setMode('play');
    if (this.mode === 'title') this.showTitle();
    this.layout();
  }

  setMode(mode: UI['mode']): void {
    this.mode = mode;
    const play = mode === 'play';
    const hudNodes = [this.pauseBtn, this.viewBtn, this.fortPanel, this.dayPill, this.hint, this.toasts, this.vitals, this.effectsEl, this.hotbar, this.crosshair, this.threatLayer, this.hitmark, this.floatLayer, this.bubbleLayer, this.featEl];
    for (const node of hudNodes) node.classList.toggle('hidden', !play);
    const touchControls = play && this.inputMode === 'touch';
    this.stick.classList.toggle('hidden', !touchControls);
    this.stickZone.classList.toggle('hidden', !touchControls);
    this.jumpBtn.classList.toggle('hidden', !touchControls);
    this.attackBtn.classList.toggle('hidden', !touchControls);
    if (!play) {
      for (const node of [this.fireBtn, this.stompBtn, this.leapBtn, this.marchBtn, this.mapBtn, this.prompt, this.helmPanel, this.coopStrip, this.planPanel, this.tipEl, this.briefEl, this.craneEl, this.ringEl]) node.classList.add('hidden');
      this.ringAt = '';
      this.ringed?.classList.remove('coach');
      this.ringed = null;
      this.root.classList.remove('acting');
      this.coopShown = false;
      for (const f of this.floaters) f.el.remove();
      this.floaters = [];
      for (const b of this.bubbles) b.el.remove();
      this.bubbles = [];
      this.planOpen = false;
      this.briefTimer = 0;
      this.tipTimer = 0;
      // Shown again (by the next refresh) when play resumes.
      this.coach.clear();
      this.coachTarget = null;
      this.coachPoint = null;
      this.lastHelm = '';
    }
    this.loading.classList.toggle('hidden', mode !== 'loading');
    this.title.classList.toggle('hidden', mode !== 'title');
    if (play) {
      this.backdrop.classList.add('hidden');
      for (const m of [this.craftModal, this.pauseModal, this.resultModal, this.mapModal, this.villageModal, this.guideModal, this.journalModal, this.featsModal, this.storyModal, this.cloudModal, this.coopModal, this.langModal]) m.classList.add('hidden');
      this.cloudFrom = null;
      this.coopFrom = null;
      this.langFrom = null;
      this.refreshContext(true);
    }
  }

  private loadingStep = 'Loading the valley...';

  setLoadingProgress(fraction: number, text?: string): void {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    this.loadingBar.style.width = `${pct}%`;
    if (text) this.loadingStep = text;
    setText(this.loadingText, `Loading ${pct}% · ${this.loadingStep}`);
  }

  showTitle(): void {
    const day = this.game.savedDay();
    this.continueBtn.classList.toggle('hidden', day <= 0);
    setText(this.continueBtn, day > 0 ? `CONTINUE  ·  DAY ${day}` : 'CONTINUE');
    // (Only what is news to the player: a best score, feats, the desktop keys.)
    const lines: string[] = [];
    if (this.game.savedWorldVersion() === 1) lines.push('<span class="news">NEW: THE LONG MARCH · start a NEW GAME to march it</span>');
    if (this.game.best > 0) lines.push(`<span>Best score: ${this.game.best}</span>`);
    const feats = featCount();
    if (feats.done > 0) lines.push(`<span class="keys">★ Feats earned: ${feats.done}/${feats.total}</span>`);
    if (this.inputMode === 'desktop') lines.push('<span class="keys">WASD move · Mouse look · Left click mine · Right click build · E use</span>');
    setHTML(this.titleNote, lines.join('<br>'));
    this.titleNote.classList.toggle('hidden', lines.length === 0);
    this.setMode('title');
    this.refreshTitleCloud();
    this.renderLangPill();
    this.layout();
  }

  /** The title's language switch: every language a tap away by its short name (the one in use lit), the globe for the full list. */
  private renderLangPill(): void {
    const now = currentLang();
    const seg = (l: (typeof LANGS)[number]): string =>
      `<button class="lp-seg${l.code === now ? ' on' : ''}" data-lang="${l.code}" lang="${l.html}" aria-label="${escapeHtml(l.name)}">${escapeHtml(l.short)}</button>`;
    setHTML(this.langPill, `<button class="lp-globe" data-lang="list" aria-label="${escapeHtml(tr('Language'))}">${GLOBE_SVG}</button>${LANGS.map(seg).join('')}`);
    // The device's own language is the likeliest tap: its words are fetched while the player looks at the title.
    const device = deviceLang();
    if (device !== now) window.setTimeout(() => prefetchLang(device), 1500);
  }

  /** The title's cloud button says how the saved game stands (and CONTINUE follows a game brought down from the cloud). */
  private refreshTitleCloud(): void {
    const c = this.game.cloud;
    const day = this.game.savedDay();
    this.continueBtn.classList.toggle('hidden', day <= 0);
    setText(this.continueBtn, day > 0 ? `CONTINUE  ·  DAY ${day}` : 'CONTINUE');
    // (With a game saved, PLAY starts afresh: it says so, and CONTINUE takes the big button.)
    setText(this.playBtn, day > 0 ? 'NEW GAME' : 'PLAY');
    this.title.classList.toggle('has-save', day > 0);
    const label = !c.code || day <= 0 ? 'CLOUD SAVE' : c.state === 'syncing' ? 'CLOUD · SYNCING' : c.state === 'offline' || c.state === 'error' ? 'CLOUD · OFFLINE' : c.dirty ? 'CLOUD · WAITING' : 'CLOUD · SAVED';
    const span = this.cloudBtn.querySelector('span')!;
    setText(span, label);
    this.cloudBtn.classList.toggle('ok', Boolean(c.code) && day > 0 && c.state === 'saved' && !c.dirty);
    if (this.mode === 'title') this.fitTitleButtons();
  }

  // ------------------------------------------------------------------ language

  /** The languages, each by its own name (the one in use ticked): a tap switches the whole game at once. */
  openLang(from: 'title' | 'pause'): void {
    if (from === 'pause') this.pauseModal.classList.add('hidden');
    this.langFrom = from;
    this.langNote = '';
    this.renderLang();
    this.backdrop.classList.remove('hidden');
    this.langModal.classList.remove('hidden');
    this.layout();
  }

  private closeLang(): void {
    const from = this.langFrom;
    this.langFrom = null;
    this.langModal.classList.add('hidden');
    if (from === 'pause' && this.game.modal === 'pause') {
      this.openPauseRefresh();
      return;
    }
    this.backdrop.classList.add('hidden');
  }

  private renderLang(): void {
    const now = currentLang();
    const rows = LANGS.map((l) => `<button class="stone big-btn small${l.code === now ? ' green' : ''}" data-lang="${l.code}" lang="${l.html}">${l.code === now ? '✓ ' : ''}${escapeHtml(l.name)}</button>`).join('');
    setHTML(this.langModal, `
      <h2><span>${GLOBE_SVG}<b>LANGUAGE</b></span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="menu-list" translate="no">${rows}</div>
      ${this.langNote ? `<div class="cloud-note">${escapeHtml(this.langNote)}</div>` : ''}`);
    this.langModal.querySelector('.close')?.addEventListener('click', () => this.closeLang());
    this.langModal.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => button.addEventListener('click', () => {
      const code = button.dataset.lang as Lang;
      this.game.audio.play('click');
      if (code === currentLang()) {
        this.closeLang();
        return;
      }
      button.disabled = true;
      void setLang(code, true).then((ok) => {
        if (ok) {
          this.closeLang();
          return;
        }
        if (!this.langFrom || code === currentLang()) return;
        this.langNote = 'Could not load that language: check your connection and try again';
        this.renderLang();
      });
    }));
  }

  /** A new language: the words on screen have re-translated themselves; what is drawn or remembered is redone. */
  private relabel(): void {
    this.lastFort = '';
    this.lastDay = '';
    this.lastVitals = '';
    this.lastHelm = '';
    this.lastCoop = '';
    this.lastBoss = '';
    this.lastPlan = '';
    this.lastEffects = '';
    this.mateTagText = '';
    if (this.mode === 'title') this.showTitle();
    else this.layout();
  }

  // ------------------------------------------------------------------ cloud saves

  private cloudReachable: boolean | null = null;

  /** The cloud save panel: how the save stands, this device's code, and loading another device's game. */
  openCloud(from: 'title' | 'pause'): void {
    if (from === 'pause') {
      this.pauseModal.classList.add('hidden');
    }
    this.cloudFrom = from;
    this.cloudFound = null;
    this.cloudNote = '';
    this.renderCloud();
    this.backdrop.classList.remove('hidden');
    this.cloudModal.classList.remove('hidden');
    this.layout();
    void this.game.cloud.available().then((ok) => {
      this.cloudReachable = ok;
      if (this.cloudFrom) this.renderCloud();
    });
  }

  private closeCloud(): void {
    const from = this.cloudFrom;
    this.cloudFrom = null;
    this.cloudModal.classList.add('hidden');
    if (from === 'pause' && this.game.modal === 'pause') {
      this.openPauseRefresh();
      return;
    }
    this.backdrop.classList.add('hidden');
    if (this.mode === 'title') this.refreshTitleCloud();
  }

  private renderCloud(): void {
    const g = this.game;
    const c = g.cloud;
    const day = g.savedDay();
    const ago = (t: number): string => {
      const s = Math.max(0, (Date.now() - t) / 1000);
      if (s < 50) return 'just now';
      if (s < 3600) return `${Math.round(s / 60)} min ago`;
      if (s < 86400) return `${Math.round(s / 3600)} h ago`;
      return new Date(t).toLocaleDateString();
    };
    let tone = 'off';
    let status = 'Not in the cloud yet';
    let sub = 'Your fortress goes up to the cloud at the next dawn';
    if (this.cloudReachable === false) {
      status = 'Cloud unavailable here';
      sub = 'Your progress stays saved on this device';
    } else if (c.code && day > 0) {
      if (c.state === 'syncing') {
        tone = 'busy';
        status = 'Saving to the cloud…';
        sub = `Day ${c.day}`;
      } else if (c.state === 'offline' || c.state === 'error') {
        tone = 'warn';
        status = 'Offline: it will try again';
        sub = `Day ${c.day} is saved on this device`;
      } else if (c.dirty) {
        tone = 'busy';
        status = 'Waiting to upload';
        sub = `Day ${c.day}`;
      } else {
        tone = 'ok';
        status = 'Saved to the cloud';
        sub = `Day ${c.day} · ${ago(c.savedAt)}`;
      }
    } else if (c.code) {
      sub = 'Your next game goes up at its first dawn';
    }
    const code = c.code ? formatCode(c.code) : '';
    const inGame = this.cloudFrom === 'pause';
    const canSave = inGame && g.phase === 'day' && !g.siege;
    const found = this.cloudFound;
    const foundHtml = found
      ? `<div class="cloud-found"><b>Day ${Number(found.info.day) || '?'}</b><span>${Number(found.info.blocks) || 0} blocks · level ${Number(found.info.level) || 0}${found.info.at ? ` · ${escapeHtml(ago(Number(found.info.at)))}` : ''}</span>
          <button class="stone big-btn small green" data-act="adopt">${inGame ? 'LOAD IT (LEAVES THIS GAME)' : 'LOAD THIS GAME'}</button></div>`
      : '';
    setHTML(this.cloudModal, `
      <h2><span>CLOUD SAVE</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="scroll cloud">
        <div class="cloud-status ${tone}"><img alt="" src="${iconURL('ui_cloud')}"><div><b>${escapeHtml(status)}</b><small>${escapeHtml(sub)}</small></div></div>
        ${canSave ? '<button class="stone big-btn small green" data-act="save">SAVE NOW</button>' : ''}
        <div class="section-label">YOUR CLOUD CODE</div>
        ${code ? `<div class="cloud-code" data-act="copy" translate="no">${code}</div><button class="stone big-btn small" data-act="copy">COPY CODE</button>` : '<div class="help">You get a code with your first cloud save.</div>'}
        <div class="help">Every dawn your fortress saves itself to the cloud. Keep this code: type it in on another phone or computer to carry on there.</div>
        <div class="section-label">CONTINUE FROM ANOTHER DEVICE</div>
        <div class="cloud-find"><input type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="XXXX-XXXX-XXXX-XXXX" translate="no"><button class="stone big-btn small" data-act="find">FIND</button></div>
        ${this.cloudNote ? `<div class="cloud-note">${escapeHtml(this.cloudNote)}</div>` : ''}
        ${foundHtml}
      </div>`);
    const input = this.cloudModal.querySelector('input')!;
    // Typing here must not reach the game's keys.
    for (const type of ['keydown', 'keyup'] as const) input.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') find();
    });
    const bind = (act: string, fn: () => void): void => this.cloudModal.querySelectorAll(`[data-act="${act}"]`).forEach((n) => n.addEventListener('click', fn));
    this.cloudModal.querySelector('.close')?.addEventListener('click', () => this.closeCloud());
    bind('copy', () => {
      if (!c.code) return;
      const text = formatCode(c.code);
      const done = (): void => this.toast('Cloud code copied');
      try {
        void navigator.clipboard.writeText(text).then(done, () => this.toast(`Your code: ${text}`));
      } catch {
        this.toast(`Your code: ${text}`);
      }
    });
    bind('save', () => {
      g.save();
      g.audio.play('click');
      this.renderCloud();
    });
    const find = (): void => {
      const value = input.value;
      this.cloudFound = null;
      this.cloudNote = 'Looking…';
      this.renderCloud();
      void g.cloud.peek(value).then((r) => {
        if (!this.cloudFrom) return;
        if (r === 'bad') this.cloudNote = 'That is not a cloud code (16 letters and numbers)';
        else if (r === 'empty') this.cloudNote = 'No saved game under that code';
        else if (r === 'offline') this.cloudNote = 'Could not reach the cloud: try again';
        else if (c.code === r.code && r.rev === c.rev && !c.dirty) this.cloudNote = 'That is this device\'s own game';
        else {
          this.cloudNote = '';
          this.cloudFound = r;
        }
        this.renderCloud();
      });
    };
    bind('find', find);
    bind('adopt', () => {
      const f = this.cloudFound;
      if (!f) return;
      g.cloud.adopt(f, (json) => g.adoptSave(json, true));
      this.cloudFound = null;
      const day = Number(f.info.day) || g.savedDay();
      if (inGame) {
        this.cloudFrom = null;
        this.cloudModal.classList.add('hidden');
        g.paused = false;
        g.modal = 'none';
        g.continueGame();
        this.onResumePlay?.();
        this.toast(`Carrying on from day ${day}`);
      } else {
        this.cloudNote = `Day ${day} is ready: tap CONTINUE`;
        this.renderCloud();
        this.refreshTitleCloud();
      }
    });
  }

  // ------------------------------------------------------------------ playing together (co-op)

  /** The co-op panel: invite a friend (a room code) or join one; then who is aboard, and the roles. */
  openCoop(from: 'title' | 'pause'): void {
    if (from === 'pause') this.pauseModal.classList.add('hidden');
    this.coopFrom = from;
    this.watchCoop();
    this.renderCoop();
    this.backdrop.classList.remove('hidden');
    this.coopModal.classList.remove('hidden');
    this.layout();
  }

  private closeCoop(): void {
    const from = this.coopFrom;
    this.coopFrom = null;
    this.coopModal.classList.add('hidden');
    if (from === 'pause' && this.game.modal === 'pause') {
      this.openPauseRefresh();
      return;
    }
    this.backdrop.classList.add('hidden');
  }

  /** The co-op sessions tell the panel (and the HUD strip) whenever anything changes. */
  private watchCoop(): void {
    const g = this.game;
    const host = g.coopHost;
    const guest = g.coopGuest;
    if (host) {
      host.onChange = () => {
        this.lastCoop = '';
        if (this.coopFrom) this.renderCoop();
      };
    }
    if (guest) {
      guest.onChange = () => {
        this.lastCoop = '';
        // The world has arrived: into play (the panel closes with the switch).
        if (guest.status === 'playing' && this.mode === 'play') this.onResumePlay?.();
        if (this.coopFrom) this.renderCoop();
      };
      guest.onEnded = (why) => this.coopEnded(why);
    }
  }

  /** A guest's co-op game is over: back to this device's own title, saying why. */
  private coopEnded(why: string): void {
    const g = this.game;
    g.resetToTitle();
    this.showTitle();
    this.coopNote = why;
    this.openCoop('title');
  }

  private renderCoop(): void {
    const g = this.game;
    const host = g.coopHost && !g.coopHost.ended ? g.coopHost : null;
    const guest = g.coopGuest && !g.coopGuest.ended ? g.coopGuest : null;
    const card = (tone: string, title: string, sub: string): string => `<div class="cloud-status ${tone}"><img alt="" src="${iconURL('ui_coop')}"><div><b>${escapeHtml(title)}</b><small>${escapeHtml(sub)}</small></div></div>`;
    const roles = `<div class="help">At night one of you steers at the <b>HELM</b>, the other mans the <b>GUNS</b>: stand by a turret and tap MAN THE GUNS. Every turret then fires where the gunner taps, and the helmsman's taps mark targets for them.</div>`;
    const swap = (me: boolean | undefined, mate: boolean | undefined): string => (me || mate ? '<button class="stone big-btn small gold" data-act="swap">SWAP HELM &amp; GUNS</button>' : '');
    const note = this.coopNote ? `<div class="cloud-note">${escapeHtml(this.coopNote)}</div>` : '';
    let body = '';
    if (host) {
      const st = host.status;
      const mate = host.mateName || 'Your mate';
      const p = g.partner;
      if (st === 'playing') body += card('ok', `${mate} is aboard`, `${host.ping} ms · room ${host.code}${p?.helm ? ' · at the helm' : p?.gunner ? ' · on the guns' : ''}`);
      else if (st === 'joining') body += card('busy', `${mate} is coming aboard…`, 'Sending them your world');
      else if (st === 'away') body += card('warn', `${mate} lost the connection`, 'They come back by joining with the same code');
      else if (st === 'waiting') body += card('busy', 'Waiting for your mate', 'Give them the code below');
      else body += card('busy', 'Opening a room…', '');
      if (st !== 'playing') {
        body += `<div class="section-label">ROOM CODE</div><div class="cloud-code coop-code" data-act="copy" translate="no">${escapeHtml(host.code)}</div><button class="stone big-btn small" data-act="copy">COPY CODE</button>`;
        body += '<div class="help">On their phone or computer: open the game, tap <b>PLAY TOGETHER</b> and type in this code. They join your world; your progress stays saved on this device.</div>';
      }
      body += note;
      if (st === 'playing') body += roles + swap(g.me.helm || g.me.gunner, p?.helm || p?.gunner);
      if (p) body += '<button class="stone big-btn small" data-act="kick">SEND YOUR MATE OFF</button>';
      body += '<button class="stone big-btn small red" data-act="close">CLOSE THE ROOM</button>';
    } else if (guest) {
      const st = guest.status;
      const who = guest.hostName || 'your mate';
      if (st === 'playing') body += card('ok', `Aboard ${who}'s fortress`, `${guest.ping} ms · room ${guest.code}`);
      else if (st === 'reconnecting') body += card('warn', 'Connection lost: reconnecting…', 'Hold on, your place is kept');
      else if (st === 'loading') body += card('busy', `Loading ${who}'s world… ${Math.round(guest.progress * 100)}%`, `Room ${guest.code}`);
      else if (st === 'waiting') body += card('busy', 'Waiting for the host', `Room ${guest.code}: they need to have the game open`);
      else body += card('busy', 'Connecting…', `Room ${guest.code}`);
      body += note;
      if (st === 'playing') body += roles + swap(g.helm || g.gunner, true);
      body += '<button class="stone big-btn small red" data-act="leave">LEAVE</button>';
    } else {
      const inGame = this.coopFrom === 'pause';
      body += '<div class="help coop-intro">Two players, one fortress. One of you steers, the other mans the guns. Your friend plays on their own phone or computer.</div>';
      body += `<div class="section-label">YOUR NAME</div><div class="cloud-find"><input type="text" class="coop-name" autocomplete="off" spellcheck="false" maxlength="16" placeholder="Captain" value="${escapeHtml(coopName())}"></div>`;
      body += `<button class="stone big-btn green" data-act="host"${this.coopBusy ? ' disabled' : ''}>INVITE A FRIEND</button>`;
      body += `<div class="help">${inGame ? 'Opens a room for this game: your friend joins with its code.' : 'Starts (or continues) your game and opens a room for it.'}</div>`;
      body += `<div class="section-label">JOIN A FRIEND</div><div class="cloud-find"><input type="text" class="coop-join" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" placeholder="CODE" value="${escapeHtml(this.coopCode)}"><button class="stone big-btn small" data-act="join"${this.coopBusy ? ' disabled' : ''}>JOIN</button></div>`;
      if (inGame) body += '<div class="help">Joining leaves this game (it stays saved as of the last dawn).</div>';
      body += note;
    }
    setHTML(this.coopModal, `
      <h2><span>PLAY TOGETHER</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="scroll cloud">${body}</div>`);
    for (const input of this.coopModal.querySelectorAll('input')) {
      // Typing here must not reach the game's keys.
      for (const type of ['keydown', 'keyup'] as const) input.addEventListener(type, (e) => e.stopPropagation());
    }
    const bind = (act: string, fn: () => void): void => this.coopModal.querySelectorAll(`[data-act="${act}"]`).forEach((n) => n.addEventListener('click', fn));
    this.coopModal.querySelector('.close')?.addEventListener('click', () => this.closeCoop());
    const nameInput = this.coopModal.querySelector<HTMLInputElement>('.coop-name');
    nameInput?.addEventListener('change', () => saveCoopName(nameInput.value));
    const joinInput = this.coopModal.querySelector<HTMLInputElement>('.coop-join');
    joinInput?.addEventListener('input', () => {
      this.coopCode = joinInput.value.toUpperCase();
    });
    joinInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.joinCoop();
    });
    bind('host', () => void this.hostCoop(nameInput?.value ?? ''));
    bind('join', () => void this.joinCoop(nameInput?.value));
    bind('copy', () => {
      if (!host) return;
      const done = (): void => this.toast('Room code copied');
      try {
        void navigator.clipboard.writeText(host.code).then(done, () => this.toast(`Room code: ${host.code}`));
      } catch {
        this.toast(`Room code: ${host.code}`);
      }
    });
    bind('swap', () => {
      if (host) host.swapRoles();
      else guest?.send('swap', []);
      this.closeCoop();
      if (this.game.modal === 'pause') this.closeModals();
    });
    bind('kick', () => {
      host?.kick();
      this.renderCoop();
    });
    bind('close', () => {
      host?.close();
      this.coopNote = 'The room is closed';
      this.renderCoop();
    });
    bind('leave', () => {
      this.coopNote = '';
      guest?.leave();
    });
  }

  /** Opens a room for this game (from the title: the game starts or continues first). */
  private async hostCoop(name: string): Promise<void> {
    const g = this.game;
    if (this.coopBusy) return;
    if (name) saveCoopName(name);
    this.coopBusy = true;
    this.coopNote = 'Opening a room…';
    this.renderCoop();
    try {
      if (this.coopFrom === 'title') {
        if (g.savedDay() > 0) g.continueGame();
        else g.newGame();
      }
      const host = await CoopHost.open(g, coopName() || 'Captain');
      g.coopHost?.close();
      g.coopHost = host;
      this.coopNote = '';
      this.coopBusy = false;
      this.lastCoop = '';
      // Show the code over the game (it keeps going while the room waits).
      if (g.modal !== 'pause') this.openPause();
      this.openCoop('pause');
    } catch {
      this.coopBusy = false;
      this.coopNote = 'Could not open a room: check your connection and try again';
      if (this.coopFrom) this.renderCoop();
      else {
        this.openPause();
        this.openCoop('pause');
      }
    }
  }

  /** Joins a friend's room by its code. */
  private async joinCoop(name?: string): Promise<void> {
    const g = this.game;
    if (this.coopBusy) return;
    if (name) saveCoopName(name);
    const code = this.coopCode.trim();
    this.coopBusy = true;
    this.coopNote = 'Looking for the room…';
    this.renderCoop();
    // Leaving a game of one's own here: it is saved first (as the dawn would).
    if (g.phase === 'day' && !g.siege && !g.coopGuest && !g.coopHost) g.save();
    g.coopHost?.close();
    const r = await CoopGuest.join(g, code, coopName() || 'Gunner');
    this.coopBusy = false;
    if (typeof r === 'string') {
      this.coopNote = r;
      if (this.coopFrom) this.renderCoop();
      return;
    }
    this.coopNote = '';
    this.watchCoop();
    if (this.coopFrom) this.renderCoop();
  }

  /** The HUD strip under the day line: who is aboard with you and how the line holds up. */
  private refreshCoop(): void {
    const g = this.game;
    const host = g.coopHost && !g.coopHost.ended ? g.coopHost : null;
    const guest = g.coopGuest && !g.coopGuest.ended ? g.coopGuest : null;
    const show = this.mode === 'play' && (host !== null || guest !== null);
    this.coopStrip.classList.toggle('hidden', !show);
    if (show !== this.coopShown) {
      this.coopShown = show;
      this.layout();
    }
    if (!show) return;
    let html = `<img alt="" src="${iconURL('ui_coop')}">`;
    let tone = '';
    // The mate's hearts as a little bar (red when low).
    const hearts = (hp: number, max: number): string => {
      const f = Math.max(0, Math.min(1, hp / Math.max(1, max)));
      return `<span class="mhp${f <= 0.3 ? ' low' : ''}"><i style="width:${Math.round(f * 100)}%"></i></span>`;
    };
    if (host) {
      const p = g.partner;
      const st = host.status;
      if (st === 'playing' && p && host.mateStalled) {
        html += `<b>${escapeHtml(p.name)}</b><span>not responding…</span>`;
        tone = 'warn';
      } else if (st === 'playing' && p) html += `<b>${escapeHtml(p.name)}</b>${hearts(Math.ceil(p.player.hp), p.player.maxHp)}<span>${p.player.dead ? 'KNOCKED OUT' : p.helm ? 'HELM' : p.gunner ? 'GUNS' : 'ABOARD'}</span><span class="ping">${host.ping} ms</span>`;
      else if (st === 'waiting') html += `<b>ROOM ${escapeHtml(host.code)}</b><span>waiting for your mate</span>`;
      else if (st === 'joining') html += `<b>${escapeHtml(host.mateName || 'Mate')}</b><span>coming aboard…</span>`;
      else if (st === 'away') {
        html += `<b>${escapeHtml(host.mateName || 'Mate')}</b><span>connection lost</span>`;
        tone = 'warn';
      } else html += '<b>CO-OP</b><span>opening a room…</span>';
    } else if (guest) {
      const st = guest.status;
      const role = { helm: 'HELM', guns: 'GUNS', down: 'KNOCKED OUT', aboard: 'ABOARD' }[guest.hostRole];
      if (st === 'playing' && guest.stalled) {
        // (Its world holds still meanwhile: the host's device runs it.)
        html += `<b>${escapeHtml(guest.hostName || 'Captain')}</b><span>paused · waiting…</span>`;
        tone = 'warn';
      } else if (st === 'playing') html += `<b>${escapeHtml(guest.hostName || 'Captain')}</b>${hearts(guest.hostHp[0], guest.hostHp[1])}<span>${role}</span><span class="ping">${guest.ping} ms</span>`;
      else {
        html += '<b>CO-OP</b><span>reconnecting…</span>';
        tone = 'warn';
      }
    }
    const key = `${tone}|${html}`;
    if (key === this.lastCoop) return;
    this.lastCoop = key;
    this.coopStrip.className = `abs hudpanel${tone ? ` ${tone}` : ''}`;
    setHTML(this.coopStrip, html);
  }

  // ------------------------------------------------------------------ GameUI

  toast(text: string, icon?: string): void {
    // A run of pickups of the same thing adds up on one line ("+3 Dirt") instead of piling up.
    const pickup = /^\+(\d+) (.+)$/.exec(text);
    if (pickup) {
      for (const child of this.toasts.children) {
        const node = child as HTMLElement;
        if (node.dataset.item !== pickup[2]) continue;
        const n = Number(node.dataset.n ?? 0) + Number(pickup[1]);
        node.dataset.n = String(n);
        if (node.lastChild) setData(node.lastChild as Text, `+${n} ${pickup[2]}`);
        node.style.animation = 'none';
        void node.offsetWidth;
        node.style.animation = '';
        window.clearTimeout(this.toastTimers.get(node));
        this.toastTimers.set(node, window.setTimeout(() => node.remove(), 2400));
        // The freshest news goes to the bottom of the list.
        this.toasts.appendChild(node);
        return;
      }
    }
    const node = el('div', 'toast');
    if (icon) setHTML(node, `<img alt="" src="${iconURL(icon)}">`);
    node.appendChild(makeText(text));
    if (pickup) {
      node.dataset.item = pickup[2];
      node.dataset.n = pickup[1];
      node.classList.add('pickup');
    }
    this.toasts.appendChild(node);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    this.placeToasts();
    this.toastTimers.set(node, window.setTimeout(() => node.remove(), pickup ? 2400 : 2600));
  }

  private readonly toastTimers = new WeakMap<HTMLElement, number>();

  /** What is in hand, as last named (undefined: nothing seen yet, so the first look names nothing). */
  private heldNamed: number | null | undefined = undefined;
  private heldCard: HTMLElement | null = null;
  private heldTimer = 0;

  /**
   * The thing just taken in hand, by name and what it is for: one card at the foot of the news,
   * renewed in place as the player flicks through the hotbar.
   */
  private nameHeld(): void {
    const g = this.game;
    const id = g.selected;
    const icon = id === null ? 'ui_pickaxe' : id === I.SWORD ? swordOf(g).icon : itemDef(id).icon;
    const node = this.heldCard ?? el('div', 'toast held');
    this.heldCard = node;
    setHTML(node, `<img alt="" src="${iconURL(icon)}"><span><b>${escapeHtml(itemName(g, id))}</b><small>${escapeHtml(itemUse(g, id, this.inputMode === 'desktop'))}</small></span>`);
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
    this.toasts.appendChild(node);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    this.placeToasts();
    window.clearTimeout(this.heldTimer);
    this.heldTimer = window.setTimeout(() => node.remove(), 3400);
  }

  /** Names what is in hand when the player changes it (not when the last of something runs out). */
  private watchHeld(): void {
    const g = this.game;
    const held = g.selected;
    if (held === this.heldNamed) return;
    const before = this.heldNamed;
    this.heldNamed = held;
    if (before === undefined || (before !== null && g.count(before) <= 0)) return;
    this.nameHeld();
  }

  banner(title: string, sub: string, tone: BannerTone): void {
    // News beats the briefing card (its plan stays a tap away on the goal line).
    if (this.briefTimer > 0) this.hideBrief();
    this.bannerEl.className = `abs ${tone}`;
    setHTML(this.bannerEl, `<div class="title">${escapeHtml(title)}</div><div class="sub">${escapeHtml(sub)}</div>`);
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this.bannerTimer = 2.8;
    this.bannerFoot = -1;
    this.placeToasts();
  }

  /** An announcement is on screen (one-time tips hold back until it has gone). */
  get bannerOpen(): boolean {
    return this.bannerTimer > 0;
  }

  setHint(text: string | null): void {
    const value = text ?? '';
    if (value === this.hintText) return;
    this.hintText = value;
    setText(this.hint, value);
    this.hint.style.visibility = value ? 'visible' : 'hidden';
    if (value) this.fitHint();
    // Tips, briefings and toasts stack under the hint: move them whenever it changes.
    this.placeToasts();
  }

  flash(kind: 'gold' | 'red' | 'white' | 'impact'): void {
    const node = el('div', `screen-flash ${kind}`);
    this.root.appendChild(node);
    window.setTimeout(() => node.remove(), 1400);
  }

  damage(n: number, x: number, y: number, z: number, kind: 'hit' | 'crit' | 'streak' | 'big', text?: string): void {
    if (this.mode !== 'play') return;
    // Keep the newest dozen; the oldest make way.
    while (this.floaters.length >= 12) this.floaters.shift()!.el.remove();
    const node = el('div', `dmg ${kind}`);
    setText(node, text ?? (kind === 'crit' ? `${n}!` : String(n)));
    this.floatLayer.appendChild(node);
    const jitter = (): number => (Math.random() - 0.5) * 0.5;
    this.floaters.push({ el: node, x: x + jitter(), y, z: z + jitter(), t: 0, life: kind === 'streak' || kind === 'big' ? 1.15 : 0.8, rise: kind === 'streak' ? 0.45 : 0.6 });
  }

  /** A speech bubble over a speaker's head (the oldest gives way when there are too many). */
  say(at: () => Vec3 | null, text: string, kind: BubbleKind): void {
    if (this.mode !== 'play') return;
    // A new line from the same speaker replaces what it was saying.
    const p = at();
    this.bubbles = this.bubbles.filter((b) => {
      const q = b.at();
      if (!p || !q || Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.9) return true;
      b.el.remove();
      return false;
    });
    // (Fewer at once on a phone lying sideways: its view is low.)
    const most = this.inputMode === 'touch' && this.short ? 2 : 3;
    while (this.bubbles.length >= most) this.bubbles.shift()!.el.remove();
    const node = el('div', `bubble ${kind}`);
    setText(node, text);
    node.style.opacity = '0';
    this.bubbleLayer.appendChild(node);
    this.bubbles.push({ el: node, at, t: 0, life: (kind === 'cheer' ? 1.7 : 2.3) + text.length * 0.045, w: 0, h: 0, css: '', op: '', tail: '' });
  }

  /** Bubbles follow their speakers (pinned inside the open view, stacked clear of each other), pop in and fade out. */
  private tickBubbles(dt: number): void {
    if (this.bubbles.length === 0) return;
    const keep: typeof this.bubbles = [];
    let top = Math.max(this.hintTop, this.stackBottom) + 6;
    // An announcement across the view: the bubbles keep below it while it shows.
    if (this.bannerTimer > 0) {
      // (Measured once per placing of the announcement, not every frame.)
      if (this.bannerFoot < 0) this.bannerFoot = (Number.parseFloat(this.bannerEl.style.top) || 0) + this.bannerEl.offsetHeight;
      top = Math.max(top, this.bannerFoot + 8);
    }
    const bottom = Math.max(top + 60, this.floatBottom - 8);
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const b of this.bubbles) {
      b.t += dt;
      const pos = b.t < b.life ? b.at() : null;
      if (!pos) {
        b.el.remove();
        continue;
      }
      keep.push(b);
      const s = this.renderer.project(pos);
      if (!s || s.x < -30 || s.x > this.vw + 30 || s.y < top - 40 || s.y > bottom + 120) {
        if (b.op !== '0') b.el.style.opacity = b.op = '0';
        continue;
      }
      if (b.w === 0) {
        flushText();
        b.w = b.el.offsetWidth;
        b.h = b.el.offsetHeight;
      }
      const half = b.w / 2;
      // (Wide screens: clear of the cards down the left edge.)
      const left = this.wide && this.coach.shown ? this.frame.x + this.cardW + 8 : 6;
      let x = clamp(s.x, left + half, this.vw - half - 6);
      let y = clamp(s.y, top + b.h, bottom);
      // Never over a control: above it where there is room, else beside it.
      for (const k of this.keepOut) {
        if (k.el.classList.contains('hidden') || k.w <= 0) continue;
        if (x + half < k.x - 4 || x - half > k.x + k.w + 4 || y < k.y - 4 || y - b.h > k.y + k.h + 4) continue;
        if (k.y - 6 - b.h >= top) y = k.y - 6;
        else x = Math.max(left + half, k.x - half - 6);
      }
      // Keep clear of the bubbles already placed (the later one goes above).
      for (const o of placed) {
        if (Math.abs(o.x - x) < (o.w + b.w) / 2 + 4 && Math.abs(o.y - y) < Math.max(o.h, b.h) + 4) y = Math.max(top + b.h, o.y - o.h - 8);
      }
      placed.push({ x, y, w: b.w, h: b.h });
      const pop = b.t < 0.08 ? 0.6 + (b.t / 0.08) * 0.5 : b.t < 0.16 ? 1.1 - ((b.t - 0.08) / 0.08) * 0.1 : 1;
      // The tail keeps pointing at the speaker when the bubble is pushed in from an edge. (Each style
      // is written only when it changes: a speaker standing still costs nothing.)
      const tail = `${Math.round(clamp(s.x - x, -half + 12, half - 12))}px`;
      if (tail !== b.tail) b.el.style.setProperty('--tail', (b.tail = tail));
      const css = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%) scale(${pop.toFixed(2)})`;
      if (css !== b.css) b.el.style.transform = b.css = css;
      const op = Math.min(1, b.t / 0.1, (b.life - b.t) / 0.35).toFixed(2);
      if (op !== b.op) b.el.style.opacity = b.op = op;
    }
    this.bubbles = keep;
  }

  /** A feat earned: its gold card slides in under the HUD stack (one at a time, after any briefing; a tap dismisses it). */
  feat(f: Feat): void {
    this.featQueue.push(f);
    if (this.featTimer <= 0) this.nextFeat();
  }

  effectsChanged(): void {
    this.lastVitals = '';
    this.lastEffects = '';
    this.refreshHud();
  }

  /** A totem of undying pops: it rises spinning before your eyes in a burst of gold. */
  totem(): void {
    if (this.mode !== 'play') return;
    const node = el('div', 'abs totem-pop', `<img alt="" src="${iconURL('totem_item')}">`);
    region(node, 'decorative', 'totem', false);
    place(node, 0, 0, this.vw, this.vh);
    this.root.insertBefore(node, this.bannerEl);
    window.setTimeout(() => node.remove(), 1700);
    this.flash('gold');
  }

  private nextFeat(): void {
    const f = this.briefTimer > 0 ? undefined : this.featQueue.shift();
    if (!f) {
      this.featTimer = 0;
      this.featEl.classList.remove('on');
      this.placeToasts();
      return;
    }
    const { done, total } = featCount();
    this.featNow = f;
    setHTML(this.featEl, `<img alt="" src="${iconURL(f.icon)}"><div><small>★ FEAT UNLOCKED · ${done}/${total}</small><b>${escapeHtml(f.title)}</b><span>${escapeHtml(f.text)}</span></div>`);
    this.featEl.classList.remove('on');
    void this.featEl.offsetWidth;
    this.featEl.classList.add('on');
    this.featTimer = 3.8;
    this.placeToasts();
  }

  hurtFrom(angle: number): void {
    if (this.mode !== 'play') return;
    const node = this.hurtEls[this.hurtNext % this.hurtEls.length]!;
    this.hurtNext += 1;
    const vw = this.root.clientWidth || window.innerWidth;
    const vh = this.root.clientHeight || window.innerHeight;
    const r = Math.min(vw, vh) * 0.36;
    const w = Math.min(190, vw * 0.45);
    node.style.width = `${Math.round(w)}px`;
    node.style.transform = `translate(${Math.round(vw / 2 + Math.sin(angle) * r - w / 2)}px, ${Math.round(vh / 2 - Math.cos(angle) * r - 26)}px) rotate(${angle.toFixed(2)}rad)`;
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
  }

  flyItem(id: number, x: number, y: number, z: number): void {
    if (this.mode !== 'play' || this.flying >= 6) return;
    const vw = this.root.clientWidth || window.innerWidth;
    const vh = this.root.clientHeight || window.innerHeight;
    let from = this.renderer.project([x, y, z]);
    if (!from || from.x < 0 || from.x > vw || from.y < 0 || from.y > vh) from = { x: vw / 2, y: vh * 0.6 };
    const target = (): HTMLElement | null => this.hotbar.querySelector<HTMLElement>(`[data-slot="${id}"]`) ?? this.hotbar.querySelector<HTMLElement>('[data-slot="craft"]');
    const img = el('img', 'fly');
    img.alt = '';
    img.src = iconURL(itemDef(id).icon);
    img.style.transform = `translate(${Math.round(from.x - 13)}px, ${Math.round(from.y - 13)}px) scale(1.2)`;
    this.root.appendChild(img);
    this.flying += 1;
    this.inbound.add(id);
    // Aim once the hotbar has been rebuilt with the new item in it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const slot = target();
      if (!slot) return;
      const root = viewRect(this.root);
      const r = viewRect(slot);
      img.style.transform = `translate(${Math.round(r.x - root.x + r.width / 2 - 13)}px, ${Math.round(r.y - root.y + r.height / 2 - 13)}px) scale(0.7)`;
      img.style.opacity = '0.75';
    }));
    window.setTimeout(() => {
      img.remove();
      this.flying -= 1;
      this.inbound.delete(id);
      const s = target();
      if (!s) return;
      s.classList.remove('bump');
      void s.offsetWidth;
      s.classList.add('bump');
    }, 400);
  }

  /** Damage numbers drift up from where they struck and fade (kept between the HUD and the hotbar). */
  private tickFloaters(dt: number): void {
    if (this.floaters.length === 0) return;
    const keep: typeof this.floaters = [];
    const top = this.hintTop + 14;
    const bottom = Math.max(top + 40, this.floatBottom - 14);
    for (const f of this.floaters) {
      f.t += dt;
      const u = f.t / f.life;
      const p = u < 1 ? this.renderer.project([f.x, f.y + f.rise * Math.sqrt(f.t), f.z]) : null;
      if (!p) {
        f.el.remove();
        continue;
      }
      const pop = f.t < 0.09 ? 1.6 - (f.t / 0.09) * 0.6 : 1;
      const y = Math.max(top, Math.min(bottom, p.y));
      f.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      f.el.style.opacity = String(u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45));
      keep.push(f);
    }
    this.floaters = keep;
  }

  /** The FIRE button greys round like a clock while the turret it fires reloads. */
  private tickFireCooldown(): void {
    if (this.fireBtn.classList.contains('hidden')) return;
    const g = this.game;
    const F = g.fortress;
    let frac = 0;
    if (g.helm) {
      let best = Infinity;
      for (const [k, s] of F.cannons) {
        const kind = turretKind(F, k);
        if (!kind || !turretReady(F, k)) continue;
        best = Math.min(best, s.cooldown / turretCooldown(kind));
      }
      frac = best === Infinity ? 0 : best;
    } else {
      const m = g.mannedCannon();
      const s = m ? F.cannons.get(m.key) : undefined;
      const kind = m ? turretKind(F, m.key) : null;
      if (s && kind) frac = s.cooldown / turretCooldown(kind);
    }
    const v = Math.max(0, Math.min(1, frac)).toFixed(2);
    if (this.fireBtn.style.getPropertyValue('--cd') !== v) this.fireBtn.style.setProperty('--cd', v);
  }

  /** The STOMP button fills as a stomp winds up and greys round like a clock while the legs recoil. */
  private tickStomp(): void {
    if (this.stompBtn.classList.contains('hidden')) return;
    const g = this.game;
    const p = g.pound;
    const charge = p ? (p.held ? p.charge : 0) : 0;
    const cd = g.poundCooldown > 0 ? Math.min(1, g.poundCooldown / Math.max(1, g.poundCooldownMax)) : 0;
    const c = charge.toFixed(2);
    const d = cd.toFixed(2);
    if (this.stompBtn.style.getPropertyValue('--charge') !== c) this.stompBtn.style.setProperty('--charge', c);
    if (this.stompBtn.style.getPropertyValue('--cd') !== d) this.stompBtn.style.setProperty('--cd', d);
    const label = p?.held ? (p.charge >= 1 ? 'MAX!' : 'HOLD…') : 'STOMP';
    const span = this.stompBtn.querySelector('span')!;
    if (setText(span, label)) fitLabel(span, this.stompBtn.clientWidth - 6);
    this.stompBtn.classList.toggle('charging', Boolean(p?.held));
    this.stompBtn.classList.toggle('full', Boolean(p?.held && p.charge >= 1));
  }

  /** The crane's gauge follows the lift that waits on you (its marker moves every frame). */
  private tickCrane(): void {
    const gauge = craneGauge(this.game);
    const el = this.craneEl;
    // (The hotbar and the rest stay out of the way for as long as the view is the crane's.)
    const working = this.game.craneCam !== null;
    if (this.root.classList.contains('craning') !== working) this.root.classList.toggle('craning', working);
    if (!gauge) {
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      return;
    }
    if (el.classList.contains('hidden')) {
      el.classList.remove('hidden');
      this.layoutCrane();
    }
    const kind = `${gauge.kind}:${this.inputMode}`;
    if (this.craneKind !== kind) {
      this.craneKind = kind;
      this.craneCount = -1;
      el.classList.toggle('drop', gauge.kind === 'drop');
      el.classList.toggle('bomb', gauge.kind === 'bomb');
      const touch = this.inputMode === 'touch';
      setText(el.querySelector('b')!, gauge.kind === 'heave' ? 'HEAVE!' : gauge.kind === 'bomb' ? 'DROP TNT!' : 'DROP!');
      setText(el.querySelector('small')!, gauge.kind === 'heave'
        ? (touch ? 'Tap as the needle hits the gold' : 'Click as the needle hits the gold')
        : gauge.kind === 'bomb'
          ? (touch ? 'Stick: swing the jib · tap: let go · JUMP: put it back' : 'W A S D: swing the jib · click: let go · Space: put it back')
          : (touch ? 'Stick against the swing to steady it · tap on the gold' : 'A/D against the swing to steady it · click on the gold'));
      el.style.setProperty('--lo', gauge.lo.toFixed(3));
      el.style.setProperty('--hi', gauge.hi.toFixed(3));
      // (Reworded: its height may have changed.)
      this.layoutCrane();
    }
    if (gauge.kind === 'bomb') {
      // How many monsters the ring holds.
      if (this.craneCount !== gauge.value) {
        this.craneCount = gauge.value;
        setText(el.querySelector('em')!, gauge.value > 0 ? `${gauge.value} IN THE BLAST` : 'SWING IT OVER THE MONSTERS');
      }
      if (el.classList.contains('hot') !== gauge.hot) el.classList.toggle('hot', gauge.hot);
      return;
    }
    el.style.setProperty('--v', gauge.value.toFixed(3));
    if (gauge.kind === 'drop') {
      el.style.setProperty('--t', gauge.tip.toFixed(3));
      el.style.setProperty('--left', gauge.left.toFixed(3));
    }
    if (el.classList.contains('hot') !== gauge.hot) el.classList.toggle('hot', gauge.hot);
  }

  /** The gauge's kind and the input it was worded for (it is reworded when either changes). */
  private craneKind = '';
  /** The monsters in a dropped crate's blast, as last shown. */
  private craneCount = -1;

  /**
   * Over the hotbar and the hearts (no use for them at the crane's controls): the load and its place
   * stay clear in the middle of the view. Big enough for a thumb.
   */
  private layoutCrane(): void {
    const box = this.hotbarBox;
    const w = Math.min(this.vw - 40, clamp(box.w, 300, 360));
    const h = this.craneEl.offsetHeight || 96;
    const x = clamp(box.x + box.w / 2 - w / 2, 20, this.vw - 20 - w);
    place(this.craneEl, x, Math.max(this.vh / 2 + 24, box.y + box.h - h), w, null);
  }

  private artLoaded = false;

  onPhaseChanged(): void {
    const phase = this.game.phase;
    // A new day (or night): yesterday's lesson is done with.
    this.lessonNow = null;
    // (Back at the title: the next game's first look at the hand names nothing.)
    if (phase === 'title' || phase === 'loading') this.heldNamed = undefined;
    // The mission cards' pictures load in the background once play has begun.
    if (!this.artLoaded && (phase === 'day' || phase === 'night')) {
      this.artLoaded = true;
      window.setTimeout(() => {
        for (const k of ART_KEYS) new Image().src = artURL(k);
        // (So a lost fortress shows its picture at once.)
        new Image().src = new URL(DEFEAT_ART, document.baseURI).href;
      }, 400);
    }
    if (phase === 'day' || phase === 'night') {
      if (this.game.modal === 'none' && !this.game.paused) this.setMode('play');
    }
    this.lastFort = '';
    this.lastDay = '';
    this.refreshHud();
  }

  onInventoryChanged(): void {
    this.buildHotbar();
    if (!this.craftModal.classList.contains('hidden')) this.renderCraft();
    this.lastVitals = '';
  }

  showResult(outcome: Outcome): void {
    const g = this.game;
    // The tally comes first: any story card still waiting is put away.
    this.storyQueue = [];
    this.storyOpen = false;
    this.storyPrev = 'none';
    this.storyModal.classList.add('hidden');
    this.lessonNow = null;
    const { blocks } = g.fortressStats();
    const save = g.savedDay();
    const victory = outcome === 'victory';
    const last = page('last');
    // (The saga told to its end: the way home, and what Veyra left you with.)
    const saga = victory && g.mq.won;
    const art = victory
      ? `<img class="result-art" alt="" data-combos-asset-role="victory_art" src="${new URL(saga ? SAGA_EPILOGUE.art : VICTORY_ART, document.baseURI).href}">`
      : `<img class="result-art" alt="" data-combos-asset-role="defeat_art" src="${new URL(DEFEAT_ART, document.baseURI).href}" onerror="this.remove()">`;
    const epilogue = saga ? `<div class="result-epilogue">${escapeHtml(SAGA_EPILOGUE.text)}</div>` : victory && last ? `<div class="result-epilogue"><b>${escapeHtml(last.title)}</b>“${escapeHtml(last.text)}”</div>` : '';
    this.resultModal.classList.toggle('won', victory);
    setHTML(this.resultModal, `
      ${art}
      <div class="result-title ${outcome}">${victory ? 'VICTORY!' : 'FORTRESS FALLEN'}</div>
      <div class="result-sub">${victory ? 'The Creeper Citadel crumbles before your walking village!' : `The Engine Core was destroyed on day ${g.day}.`}</div>
      ${epilogue}
      <div class="stats-grid">
        <span>Nights marched</span><b>${g.stats.nights}</b>
        <span>Buildings hoisted</span><b>${g.stats.hoisted}</b>
        <span>Giants felled</span><b>${g.stats.giants}</b>
        <span class="minor">Monsters slain</span><b class="minor">${g.stats.slain}</b>
        <span class="minor">Fortress blocks</span><b class="minor">${blocks}</b>
        <span class="minor">Level</span><b class="minor">${g.level()}</b>
        <span class="minor">Journal pages</span><b class="minor">${g.journal.size}/${journalOf(g.world.terrain.version).length}</b>
        <span>Score</span><b>${g.score()}${g.score() >= g.best ? ' ★' : ''}</b>
      </div>
      <div class="menu-list">
        <button class="stone big-btn green" data-combos-action="retry">PLAY AGAIN</button>
        ${!victory && save > 0 ? `<button class="stone big-btn small" data-combos-action="continue">RETRY FROM DAY ${save}</button>` : ''}
      </div>`);
    this.resultModal.querySelector('[data-combos-action="retry"]')?.addEventListener('click', () => {
      this.game.retry();
      this.onResumePlay?.();
    });
    this.resultModal.querySelector('[data-combos-action="continue"]')?.addEventListener('click', () => {
      this.game.report('retry');
      this.game.continueGame();
      this.onResumePlay?.();
    });
    this.onSuspendPlay?.();
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.resultModal.classList.remove('hidden');
    this.layout();
  }

  // ------------------------------------------------------------------ modals

  openWorkshop(): void {
    this.openCraft();
  }

  openCraft(): void {
    if (!this.game.isPlaying()) return;
    this.game.modal = 'craft';
    this.releaseInputs();
    this.onSuspendPlay?.();
    this.game.audio.play('click');
    this.renderCraft();
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.craftModal.classList.remove('hidden');
    this.layout();
  }

  closeModals(): void {
    this.game.modal = 'none';
    this.game.paused = false;
    this.game.audio.resume();
    this.setMode('play');
    this.buildHotbar();
    this.layout();
    this.onResumePlay?.();
  }

  private releaseInputs(): void {
    this.game.releaseInputs();
    this.stickPointer = null;
    this.attackHeld = false;
    this.acting = 0;
    this.knob.style.transform = '';
    this.stick.classList.remove('pressed');
    this.jumpBtn.classList.remove('pressed');
    this.attackBtn.classList.remove('pressed');
    this.restStick();
  }

  /** Switches between first person and third (the view button, V or F5 on a keyboard). */
  toggleView(): void {
    const g = this.game;
    if (!g.isPlaying()) return;
    g.audio.play('click');
    g.setThirdPerson(!g.thirdPerson);
    this.refreshViewBtn();
    // (From the keyboard with the pause menu open: its CAMERA tile follows.)
    if (g.modal === 'pause') this.openPauseRefresh();
    this.toast(g.thirdPerson ? 'Third-person view' : 'First-person view', g.thirdPerson ? 'ui_view' : 'ui_eye');
  }

  private refreshViewBtn(): void {
    const third = this.game.thirdPerson;
    const img = this.viewBtn.querySelector('img');
    if (img) img.src = iconURL(third ? 'ui_view' : 'ui_eye');
    this.viewBtn.setAttribute('aria-label', third ? 'Third-person view' : 'First-person view');
  }

  openPause(): void {
    if (!this.game.isPlaying()) return;
    this.game.paused = true;
    this.game.modal = 'pause';
    this.releaseInputs();
    this.onSuspendPlay?.();
    const muted = this.game.audio.muted;
    const q = this.renderer.quality;
    const feats = featCount();
    const guest = this.game.coopGuest;
    const host = this.game.coopHost;
    const coop = host && !host.ended ? (host.live ? ` · ${host.mateName.toUpperCase()} ✓` : ` · ROOM ${host.code}`) : guest ? ' · ABOARD ✓' : '';
    // Settings as a two-column grid of tiles (name over value): the menu fits a phone's screen.
    const setting = (act: string, name: string, value: string, raw = false): string =>
      `<button class="stone big-btn small setting" data-act="${act}"><small>${name}</small>${raw ? '<b translate="no">' : '<b>'}${value}</b></button>`;
    setHTML(this.pauseModal, `
      <h2><span>PAUSED</span><button class="stone close" aria-label="Resume">&#x2715;</button></h2>
      <div class="menu-list">
        <button class="stone big-btn green" data-act="resume">RESUME</button>
        <div class="menu-pair">
          <button class="stone big-btn small gold" data-act="guide">HOW TO PLAY</button>
          <button class="stone big-btn small gold" data-act="feats">★ FEATS · ${feats.done}/${feats.total}</button>
        </div>
        <button class="stone big-btn small gold" data-act="journal">JOURNAL · QUESTS &amp; CREW</button>
        <button class="stone big-btn small sky" data-act="coop">PLAY TOGETHER${coop}</button>
        ${guest ? '' : `<button class="stone big-btn small sky" data-act="cloud">CLOUD SAVE${this.game.cloud.code && !this.game.cloud.dirty && this.game.cloud.state === 'saved' ? ` · DAY ${this.game.cloud.day} ✓` : ''}</button>`}
        <div class="section-label">SETTINGS</div>
        <div class="menu-grid">
          ${setting('quality', 'GRAPHICS', q.toUpperCase())}
          ${setting('zoom', 'VIEW', `${['NEAR', 'MID', 'FAR'][this.renderer.zoom]} · ${this.renderer.viewRadius * 16}`)}
          ${setting('camera', 'CAMERA', this.game.thirdPerson ? 'THIRD PERSON' : 'FIRST PERSON')}
          ${this.renderer.mobile ? setting('fps', 'FRAME RATE', this.renderer.fpsCap === 30 ? '30 · BATTERY' : '60 · SMOOTH') : ''}
          ${setting('sound', 'SOUND', muted ? 'OFF' : 'ON')}
          ${canFullscreen() ? setting('fullscreen', 'FULLSCREEN', isFullscreen() ? 'ON' : 'OFF') : ''}
          ${this.inputMode === 'touch' ? setting('haptics', 'VIBRATION', this.game.hapticsOn ? 'ON' : 'OFF') : ''}
          ${this.inputMode === 'touch' ? setting('look', 'LOOK SPEED', ['SLOW', 'NORMAL', 'QUICK'][this.game.lookSpeed] ?? 'NORMAL') : ''}
          ${setting('lang', 'LANGUAGE', escapeHtml(langName()), true)}
          ${setting('hints', 'GUIDE &amp; TIPS', this.hintsEnabled ? 'ON' : 'OFF')}
          ${setting('relearn', 'LESSONS', 'SHOW AGAIN')}
        </div>
        ${guest ? '<button class="stone big-btn small red" data-act="leave">LEAVE CO-OP GAME</button>' : '<button class="stone big-btn small" data-act="restart">NEW GAME</button>'}
      </div>`);
    const bind = (act: string, fn: () => void): void => this.pauseModal.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);
    this.pauseModal.querySelector('.close')?.addEventListener('click', () => this.closeModals());
    bind('resume', () => this.closeModals());
    bind('sound', () => {
      this.game.audio.setUserMuted(!this.game.audio.muted);
      this.openPauseRefresh();
    });
    bind('fullscreen', () => {
      if (isFullscreen()) exitFullscreen();
      else enterFullscreen(this.inputMode === 'touch');
    });
    bind('haptics', () => {
      this.game.setHaptics(!this.game.hapticsOn);
      this.openPauseRefresh();
    });
    bind('look', () => {
      this.game.setLookSpeed(this.game.lookSpeed + 1);
      this.openPauseRefresh();
    });
    bind('guide', () => this.openGuide());
    bind('journal', () => this.openJournal());
    bind('feats', () => this.openFeats());
    bind('cloud', () => this.openCloud('pause'));
    bind('coop', () => this.openCoop('pause'));
    bind('lang', () => this.openLang('pause'));
    bind('leave', () => guest?.leave());
    bind('hints', () => {
      this.hintsEnabled = !this.hintsEnabled;
      saveHintsSetting(this.hintsEnabled);
      if (!this.hintsEnabled) {
        this.tipEl.classList.add('hidden');
        this.hideBrief();
      }
      this.openPauseRefresh();
    });
    bind('relearn', () => {
      resetGuidance();
      this.hintsEnabled = true;
      saveHintsSetting(true);
      this.game.toast('Lessons and tips will show again as things turn up');
      this.openPauseRefresh();
    });
    bind('zoom', () => {
      this.renderer.setZoom(this.renderer.zoom + 1);
      this.openPauseRefresh();
    });
    bind('camera', () => {
      this.game.setThirdPerson(!this.game.thirdPerson);
      this.refreshViewBtn();
      this.openPauseRefresh();
    });
    bind('fps', () => {
      this.renderer.setFpsCap(this.renderer.fpsCap === 30 ? 60 : 30);
      this.openPauseRefresh();
    });
    bind('quality', () => {
      const order: Quality[] = ['ultra', 'high', 'fast'];
      this.renderer.setQuality(order[(order.indexOf(this.renderer.quality) + 1) % order.length]!);
      this.openPauseRefresh();
    });
    bind('restart', () => {
      this.game.paused = false;
      this.game.modal = 'none';
      this.game.newGame();
      this.onResumePlay?.();
    });
    this.game.audio.suspend();
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.pauseModal.classList.remove('hidden');
    this.layout();
    // (Longer words in other languages shrink to fit their tile.)
    for (const n of this.pauseModal.querySelectorAll<HTMLElement>('.setting small, .setting b, .menu-pair button')) fitLabel(n);
  }

  private openPauseRefresh(): void {
    this.game.paused = false;
    this.game.modal = 'none';
    this.openPause();
  }

  /** The helm's map: where the fortress is, what lies ahead, and where to march next. */
  openMap(): void {
    const g = this.game;
    if (!g.isPlaying()) return;
    g.modal = 'map';
    this.releaseInputs();
    this.onSuspendPlay?.();
    const night = g.phase === 'night' && !g.siege;
    const dests = g.destinations();
    const fc = g.fortressCentre();
    // Training's last step: the MARCH by the next village pulses.
    const coachMarch = this.hintsEnabled && trainingStep(g)?.id === 'march';
    const rows = dests.map((s, i) => {
      const [px, pz] = parkSpot(g.world.terrain, s);
      const d = Math.round(Math.hypot(px - fc[0], pz - fc[2]));
      const kind = s.kind === 'village' ? 'Village' : s.kind === 'castle' ? 'Castle ruins · loot' : s.kind === 'expedition' ? 'Expedition · main quest' : 'Final battle';
      const current = night && g.destination === s;
      const label = current ? 'EN ROUTE' : g.siege ? '—' : night ? 'GO' : i === 0 ? 'MARCH' : 'GO';
      return `<div class="dest ${s.kind}">
        <div class="info"><b>${escapeHtml(s.name)}</b><small>${kind} · ${d} blocks</small></div>
        <button class="stone dest-btn${current || g.siege ? ' off' : ''}${coachMarch && i === 0 ? ' coach' : ''}" data-dest="${i}">${label}</button>
      </div>`;
    }).join('');
    const status = g.siege
      ? 'Blast the Citadel\'s glowing Heart!'
      : night
        ? `Marching to <b>${escapeHtml(g.destination?.name ?? '?')}</b> · ${Math.round(g.progress * 100)}% · tap the map to steer elsewhere`
        : coachMarch
          ? '<b>Tap MARCH</b> by the next village: night falls and the fortress sets off.'
          : 'MARCH starts the night. Or tap the map: the crew walks the fortress there now.';
    const stop = g.phase === 'day' && g.autopilot ? '<button class="stone big-btn small" data-act="stop">STOP WALKING</button>' : '';
    this.mapLook = null;
    this.mapAtlas = false;
    setHTML(this.mapModal, `
      <h2><span>VALLEY MAP</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="map-body">
        <div class="map-wrap">
          <canvas class="map" data-combos-interactive="true"></canvas>
          <div class="atlas hidden">${this.atlasHtml()}</div>
          <div class="map-tools">
            <button class="stone" data-map="in" aria-label="Zoom in">+</button>
            <button class="stone" data-map="out" aria-label="Zoom out">&#x2212;</button>
            <button class="stone" data-map="home" aria-label="Back to the fortress">&#x25CE;</button>
            <button class="stone" data-map="atlas" aria-label="Atlas"><img alt="" src="${iconURL('ui_map')}"></button>
          </div>
        </div>
        <div class="map-side">
          ${this.marchStrip()}
          <div class="map-status">${status}</div>
          <div class="scroll">${stop}${rows}</div>
        </div>
      </div>`);
    this.mapCanvas = this.mapModal.querySelector('canvas.map');
    this.mapModal.querySelector('.close')?.addEventListener('click', () => this.closeModals());
    this.mapModal.querySelector('[data-act="stop"]')?.addEventListener('click', () => {
      g.stopCourse();
      this.closeModals();
    });
    this.bindMapTools();
    this.bindMapGestures();
    this.mapModal.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((button) => {
      button.addEventListener('click', () => {
        const s = dests[Number(button.dataset.dest)];
        if (!s || g.siege || (night && g.destination === s)) return;
        this.closeModals();
        if (night) g.changeDestination(s);
        else g.startNight(s);
      });
    });
    this.game.audio.play('click');
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.mapModal.classList.remove('hidden');
    this.layout();
  }

  /** Where the map's window has been dragged and zoomed to (null: on the fortress), and the atlas page. */
  private mapLook: MapLook | null = null;
  private mapAtlas = false;

  private redrawMap(): void {
    if (this.mapCanvas) drawMap(this.mapCanvas, this.game, this.game.destination?.name ?? null, this.mapLook);
  }

  /** The look now: the fortress's, made ours to move. */
  private ownLook(): MapLook {
    const c = this.mapCanvas!;
    if (!this.mapLook) {
      const v = mapView(this.game, c.width, c.height);
      this.mapLook = { x: v.x0 + c.width / v.k / 2, z: v.z0 + c.height / v.k / 2, span: c.width / v.k };
    }
    return this.mapLook;
  }

  private zoomMap(k: number): void {
    const look = this.ownLook();
    look.span = clamp(look.span * k, MAP_SPANS.min, MAP_SPANS.max);
    this.redrawMap();
  }

  private bindMapTools(): void {
    const atlas = this.mapModal.querySelector<HTMLElement>('.atlas');
    this.mapModal.querySelectorAll<HTMLElement>('[data-map]').forEach((button) => button.addEventListener('click', () => {
      this.game.audio.play('click');
      const act = button.dataset.map;
      if (act === 'in') this.zoomMap(0.7);
      else if (act === 'out') this.zoomMap(1.42);
      else if (act === 'home') {
        this.mapLook = null;
        this.redrawMap();
      } else {
        this.mapAtlas = !this.mapAtlas;
        atlas?.classList.toggle('hidden', !this.mapAtlas);
        this.mapCanvas?.classList.toggle('hidden', this.mapAtlas);
        // (Too wide for a phone held upright: it opens on the land you are in.)
        const you = atlas?.querySelector<HTMLElement>('.at-you');
        if (atlas && you && this.mapAtlas) atlas.scrollLeft = you.offsetLeft - atlas.clientWidth / 2;
        for (const b of this.mapModal.querySelectorAll<HTMLElement>('[data-map="in"], [data-map="out"], [data-map="home"]')) b.classList.toggle('hidden', this.mapAtlas);
      }
    }));
  }

  /** One finger drags the map (a tap sends the crew there), two pinch it, the wheel zooms. */
  private bindMapGestures(): void {
    const canvas = this.mapCanvas;
    if (!canvas) return;
    const g = this.game;
    const touches = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // synthetic pointers may not support capture
      }
      touches.set(event.pointerId, viewPoint(event.clientX, event.clientY));
      if (touches.size === 1) moved = 0;
      else {
        moved = 99;
        const [a, b] = [...touches.values()];
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      const t = touches.get(event.pointerId);
      if (!t) return;
      const at = viewPoint(event.clientX, event.clientY);
      const dx = at.x - t.x;
      const dy = at.y - t.y;
      t.x = at.x;
      t.y = at.y;
      if (touches.size >= 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch > 0 && d > 0) this.zoomMap(pinch / d);
        pinch = d;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 7) return;
      const look = this.ownLook();
      const k = look.span / Math.max(1, canvas.clientWidth);
      look.x -= dx * k;
      look.z -= dy * k;
      this.redrawMap();
    });
    const up = (event: PointerEvent): void => {
      if (!touches.delete(event.pointerId)) return;
      if (touches.size > 0 || moved >= 7 || g.siege) return;
      // A tap: the crew walks the fortress there.
      const rect = viewRect(canvas);
      const at = viewPoint(event.clientX, event.clientY);
      const view = mapView(g, canvas.width, canvas.height, this.mapLook);
      const px = ((at.x - rect.x) / Math.max(1, rect.width)) * canvas.width;
      const pz = ((at.y - rect.y) / Math.max(1, rect.height)) * canvas.height;
      g.setWaypoint(view.x0 + px / view.k, view.z0 + pz / view.k);
      this.closeModals();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (event) => {
      touches.delete(event.pointerId);
      moved = 99;
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoomMap(event.deltaY > 0 ? 1.15 : 0.87);
    }, { passive: false });
  }

  /** The painted atlas: the seven lands, the wrecks, the Citadel, and where the fortress has got to. */
  private atlasHtml(): string {
    const g = this.game;
    const T = g.world.terrain;
    if (T.version < 2) return '';
    const spots: ReadonlyArray<readonly [number, number]> = [[15, 30], [26, 33], [39, 30], [52, 32], [61, 17], [78, 35]];
    const marks = EXPEDITIONS.map((e, i) => {
      const [x, y] = spots[i]!;
      const known = i <= chapterNow(g);
      return `<div class="at-mark${g.mq.crests.includes(i) ? ' won' : ''}" style="left:${x}%;top:${y}%"><img alt="" src="${iconURL(known ? e.icon : 'seal_crystal')}"></div>`;
    }).join('');
    const lands = T.regions.map((r, i) => `<span style="left:${4 + (i + 0.5) * (92 / T.regions.length)}%">${g.regionsSeen.has(i) || i === 0 ? escapeHtml(r.name) : '???'}</span>`).join('');
    const [fx] = g.fortress.centre();
    const t = clamp((fx - T.startX) / (T.citadel.x - T.startX), 0, 1);
    const px = 4 + t * 92;
    return `<div class="at-inner"><img class="at-map" alt="" data-combos-asset-role="world_atlas" src="${new URL('story/atlas.webp', document.baseURI).href}">
      <div class="at-lands">${lands}</div>${marks}
      <div class="at-mark citadel" style="left:93%;top:21%"><img alt="" src="${iconURL('ui_boom')}"></div>
      <div class="at-you" style="left:${px.toFixed(1)}%;top:${atlasRoad(px).toFixed(1)}%"></div></div>`;
  }

  /** The Long March at a glance: the seven lands west to east, their seals, and where you are. */
  private marchStrip(): string {
    const g = this.game;
    const T = g.world.terrain;
    if (T.version < 2) return '';
    const x0 = T.startX;
    const x1 = T.citadel.x;
    const pct = (x: number): number => clamp((x - x0) / (x1 - x0), 0, 1) * 100;
    const [fx] = g.fortress.centre();
    const lands = T.regions.map((r, i) => {
      const a = pct(Math.max(x0, r.x0));
      const b = pct(T.regions[i + 1]?.x0 ?? x1);
      const seen = i === 0 || g.regionsSeen.has(i);
      return `<i class="ms-land ${r.zone}${seen ? '' : ' fog'}" style="left:${a.toFixed(2)}%;width:${(b - a).toFixed(2)}%"><span>${i + 1}</span></i>`;
    }).join('');
    const seals = T.seals.map((s) => `<b class="ms-seal${g.sealsBroken.has(s.index) ? ' broken' : ''}" style="left:${pct(s.x).toFixed(2)}%"></b>`).join('');
    const here = T.regionIndex(fx);
    const land = T.regions[here]!;
    return `<div class="march-strip">
      <div class="ms-bar">${lands}${seals}<b class="ms-citadel"></b><b class="ms-you" style="left:${pct(fx).toFixed(2)}%"></b></div>
      <div class="ms-note">LAND ${here + 1}/${T.regions.length} · ${escapeHtml(land.name.toUpperCase())} · SEALS BROKEN ${g.sealsBroken.size}/${T.seals.length}</div>
    </div>`;
  }

  private renderCraft(): void {
    const g = this.game;
    const stations = g.stationsNearby();
    const inv = [...g.inventory.entries()].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
    const invHtml = inv.map(([id, n]) => {
      const def = itemDef(id);
      const usable = def.place !== null || HOTBAR_PRIORITY.includes(id);
      return `<button class="slot${g.selected === id ? ' active' : ''}${usable ? '' : ' empty'}" data-item="${id}" aria-label="${escapeHtml(def.name)}"><img alt="" src="${iconURL(id === I.SWORD ? swordOf(g).icon : def.icon)}"><span class="count">${n}</span></button>`;
    }).join('');
    // The forge: the next sword and coat, and what they take.
    const forgeRow = (slot: GearSlot, now: GearTier): string => {
      const t = nextGear(g, slot);
      const left = `<div class="out"><img alt="" src="${iconURL(now.icon)}"></div>`;
      if (!t) return `<div class="recipe">${left}<div class="info">${escapeHtml(now.name)}<small>The finest there is. ${escapeHtml(now.text)}</small></div></div>`;
      const needs = t.need.map(([id, n]) => `<span class="${g.count(id) < n ? 'lack' : ''}"><img alt="" src="${iconURL(itemDef(id).icon)}">${g.count(id)}/${n}</span>`).join('');
      const locked = Boolean(t.officer) && !hasOfficer(g, t.officer!);
      const ok = !locked && t.need.every(([id, n]) => g.count(id) >= n);
      return `<div class="recipe">
        <div class="out"><img alt="" src="${iconURL(t.icon)}"></div>
        <div class="info">${escapeHtml(t.name)}<small>${escapeHtml(t.text)}${locked ? ' · Orsa Emberhand must be aboard' : ''} · now: ${escapeHtml(now.name)}</small><div class="needs">${needs}</div></div>
        <button class="stone craft-btn${ok ? '' : ' off'}" data-forge="${slot}">FORGE</button>
      </div>`;
    };
    const known = RECIPES.filter((r) => !r.officer || hasOfficer(g, r.officer as Parameters<typeof hasOfficer>[1]));
    const recipes = known.map((r) => {
      const status = g.recipeStatus(r, stations);
      const out = itemDef(r.out);
      const needs = r.inputs.map(([id, n]) => {
        const have = g.count(id);
        return `<span class="${have < n ? 'lack' : ''}"><img alt="" src="${iconURL(itemDef(id).icon)}">${have}/${n}</span>`;
      }).join('');
      const station = r.station === 'none' ? 'Hand' : r.station === 'table' ? 'Crafting Table' : 'Furnace';
      return `<div class="recipe">
        <div class="out"><img alt="" src="${iconURL(out.icon)}"><b>${r.count}</b></div>
        <div class="info">${escapeHtml(out.name)}<small>${escapeHtml(r.hint)} · ${station}${status.station ? '' : ' (not near)'}</small><div class="needs">${needs}</div></div>
        <button class="stone craft-btn${status.ok ? '' : ' off'}" data-recipe="${r.id}">CRAFT</button>
      </div>`;
    }).join('');
    setHTML(this.craftModal, `
      <h2><span>WORKSHOP</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="stations"><span class="${stations.table ? 'on' : ''}">Crafting Table ${stations.table ? '✓' : '✗'}</span><span class="${stations.furnace ? 'on' : ''}">Furnace ${stations.furnace ? '✓' : '✗'}</span><span class="on">Crew ${g.crew}/${g.crewCapacity()}</span></div>
      <div class="scroll">
        <div class="section-label">INVENTORY (tap to hold it, or to read what it is for)</div>
        <div class="inv-grid">${invHtml || '<span class="help">Empty: go mine something!</span>'}</div>
        <div class="inv-info hidden"></div>
        <div class="section-label">THE FORGE (each land's metal makes better gear)</div>
        ${forgeRow('sword', swordOf(g))}
        ${forgeRow('coat', coatOf(g))}
        <div class="section-label">RECIPES</div>
        ${recipes}
      </div>`);
    this.craftModal.querySelector('.close')?.addEventListener('click', () => this.closeModals());
    this.craftModal.querySelectorAll<HTMLButtonElement>('[data-forge]').forEach((button) => {
      button.addEventListener('click', () => {
        const scroll = this.craftModal.querySelector('.scroll')!.scrollTop;
        if (this.game.coopGuest) this.game.remote('forge', button.dataset.forge);
        else forge(this.game, button.dataset.forge as GearSlot);
        this.renderCraft();
        this.fitButtons();
        this.craftModal.querySelector('.scroll')!.scrollTop = scroll;
      });
    });
    this.craftModal.querySelectorAll<HTMLButtonElement>('[data-recipe]').forEach((button) => {
      button.addEventListener('click', () => {
        const scroll = this.craftModal.querySelector('.scroll')!.scrollTop;
        this.game.craft(button.dataset.recipe!);
        this.renderCraft();
        this.fitButtons();
        this.craftModal.querySelector('.scroll')!.scrollTop = scroll;
      });
    });
    // A material cannot be held: tapping it says what it is, what it is for and what it goes into.
    const info = this.craftModal.querySelector<HTMLElement>('.inv-info')!;
    this.craftModal.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.dataset.item);
        if (itemDef(id).place === null && !HOTBAR_PRIORITY.includes(id)) {
          this.game.audio.play('click');
          const makes = itemMakes(id);
          setHTML(info, `<img alt="" src="${iconURL(itemDef(id).icon)}"><div><b>${escapeHtml(itemName(g, id))} <i>× ${g.count(id)}</i></b><small>${escapeHtml(itemUse(g, id, this.inputMode === 'desktop'))}</small>${makes.length ? `<small class="makes"><em>MAKES</em> ${escapeHtml(makes.join(' · '))}</small>` : ''}</div>`);
          info.classList.remove('hidden');
          for (const other of this.craftModal.querySelectorAll('.inv-grid .slot.picked')) other.classList.remove('picked');
          button.classList.add('picked');
          return;
        }
        this.game.selectItem(id);
        this.closeModals();
      });
    });
  }

  // ------------------------------------------------------------------ hotbar

  buildHotbar(): void {
    const g = this.game;
    const items = g.hotbarItems();
    const itemSlots = Math.max(1, this.slotCount - 2);
    let shown = items.slice(0, itemSlots);
    if (g.selected !== null && items.includes(g.selected) && !shown.includes(g.selected)) shown = [g.selected, ...shown.slice(0, itemSlots - 1)];
    const size = Number.parseFloat(this.hotbar.dataset.slot || '46');
    // The same slots as last time (only counts changed: a pickup, a shot, a throw): the numbers are
    // rewritten in place, not the whole bar with its pictures and its handlers.
    const shape = `${size}|${itemSlots}|${this.inputMode}|${g.selected}|${shown.join(',')}|${items.slice(0, 8).join(',')}|${shown.includes(I.SWORD) ? swordOf(g).icon : ''}`;
    if (shape === this.hotbarShape && this.hotbar.firstChild) {
      for (const id of shown) {
        const slot = this.hotbar.querySelector<HTMLElement>(`[data-slot="${id}"]`);
        const count = slot?.querySelector('.count');
        if (!slot || !count) continue;
        const n = g.count(id);
        const was = this.lastCounts.get(id) ?? n;
        if (n !== was) count.textContent = String(n);
        if (n > was && !this.inbound.has(id)) {
          slot.classList.remove('bump');
          void slot.offsetWidth;
          slot.classList.add('bump');
        }
      }
      this.lastCounts = new Map(items.map((id) => [id, g.count(id)]));
      return;
    }
    this.hotbarShape = shape;
    const parts: string[] = [];
    const key = (label: string | number): string => `<em class="key">${label}</em>`;
    parts.push(`<button class="slot${g.selected === null ? ' active' : ''}" data-slot="pick" aria-label="Pickaxe" style="width:${size}px;height:${size}px"><img alt="" src="${iconURL('ui_pickaxe')}">${key(1)}</button>`);
    for (let i = 0; i < itemSlots; i += 1) {
      const id = shown[i];
      if (id === undefined) {
        parts.push(`<div class="slot empty" style="width:${size}px;height:${size}px"></div>`);
        continue;
      }
      const def = itemDef(id);
      const active = g.selected === id;
      const digit = items.indexOf(id) + 2;
      // A count that just went up gives its slot a little bump (picked-up items bump on arrival).
      const n = g.count(id);
      const more = n > (this.lastCounts.get(id) ?? n) && !this.inbound.has(id);
      parts.push(`<button class="slot${active ? ' active' : ''}${more ? ' bump' : ''}" data-slot="${id}" aria-label="${escapeHtml(def.name)}" style="width:${size}px;height:${size}px"><img alt="" src="${iconURL(id === I.SWORD ? swordOf(g).icon : def.icon)}"><span class="count">${n}</span>${digit <= 9 ? key(digit) : ''}</button>`);
    }
    this.lastCounts = new Map(items.map((id) => [id, g.count(id)]));
    // (On a phone: the backpack, as the "..." beside Minecraft's hotbar.)
    parts.push(`<button class="slot craft" data-slot="craft" aria-label="Workshop" style="width:${size}px;height:${size}px">${this.inputMode === 'touch' ? '' : `<img alt="" src="${iconURL('crafting_table_front')}">`}${key('C')}</button>`);
    setHTML(this.hotbar, parts.join(''));
    this.hotbar.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const slot = button.dataset.slot!;
        if (slot === 'pick') this.game.selectPickaxe();
        else if (slot === 'craft') this.openCraft();
        else {
          const id = Number(slot);
          if (this.game.selected === id) {
            const all = this.game.hotbarItems();
            if (all.length > itemSlots) {
              this.game.selectItem(all[(all.indexOf(id) + 1) % all.length]!);
              return;
            }
          }
          this.game.selectItem(id);
        }
      });
    });
  }

  /** What the hotbar was last built of (see buildHotbar). */
  private hotbarShape = '';

  // ------------------------------------------------------------------ per-frame

  tick(dt: number): void {
    // The attack button held: the blow follows the crosshair as the view turns.
    if (this.attackHeld && this.game.isPlaying()) this.game.moveHold(this.game.viewRay());
    this.tickActing(dt);
    // Hit marker over the crosshair when one of your shots connects.
    if (this.game.hitAt !== this.lastHit) {
      this.lastHit = this.game.hitAt;
      this.hitmark.classList.remove('show');
      void this.hitmark.offsetWidth;
      this.hitmark.classList.toggle('kill', this.game.hitKill);
      this.hitmark.classList.add('show');
    }
    if (this.mode === 'play') {
      this.tickFloaters(dt);
      this.tickBubbles(dt);
      this.tickFireCooldown();
      this.tickStomp();
      this.tickCrane();
      this.watchHeld();
      if (this.crosshair.classList.contains('foe') !== this.game.focusFoe) this.crosshair.classList.toggle('foe', this.game.focusFoe);
      if (this.featTimer > 0) {
        this.featTimer -= dt;
        if (this.featTimer <= 0) this.nextFeat();
      } else if (this.featQueue.length > 0 && this.briefTimer <= 0) this.nextFeat();
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerEl.classList.remove('show');
        this.placeToasts();
      }
    }
    if (this.briefTimer > 0) {
      this.briefTimer -= dt;
      if (this.briefTimer <= 0) this.hideBrief();
    }
    if (this.tipTimer > 0) {
      this.tipTimer -= dt;
      if (this.tipTimer <= 0) {
        this.tipEl.classList.add('hidden');
        this.placeToasts();
      }
    }
    if (this.planOpen) {
      this.planTimer -= dt;
      if (this.planTimer <= 0) this.togglePlan(false);
    }
    const L = this.lessonNow;
    if (L && this.mode === 'play' && this.game.isPlaying()) {
      L.t -= dt;
      L.age += dt;
      // Its moment has passed (the giant is down, the climbers gone): it goes after a short while.
      L.gone = L.l.when(this.game) ? 0 : L.gone + dt;
      if (L.t <= 0 || (L.age > 3 && L.gone > 1.2)) this.lessonNow = null;
    }
    if (this.skipArmed > 0) {
      this.skipArmed -= dt;
      if (this.skipArmed <= 0) this.coach.armSkip(false);
    }
    this.coach.tick(dt);
    this.tickCine();
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.refreshHud();
      this.refreshHelm();
      this.refreshCoop();
      this.refreshContext(false);
      this.refreshThreats();
      this.refreshCoach();
      this.refreshBoss();
      if (this.mapCanvas && !this.mapModal.classList.contains('hidden')) this.redrawMap();
    }
    if (this.mode === 'play') this.trackCoach();
    this.trackMate();
  }

  /** Co-op: the mate's name tag over its head (with how far, or that it is knocked out). */
  private trackMate(): void {
    const g = this.game;
    const m = this.mode === 'play' && g.isPlaying() ? g.mate() : null;
    const p = g.player;
    const d = m ? Math.hypot(m.v.x - p.x, m.v.y - p.y, m.v.z - p.z) : 0;
    const down = m?.v.pose === 'down';
    const s = m && d > 2.2 && d < 96 ? this.renderer.project([m.v.x, m.v.y + (down ? 1 : 2.3) + (m.chute > 0.3 ? 2.4 : 0), m.v.z]) : null;
    const on = s !== null && s.x > -30 && s.x < this.vw + 30 && s.y > this.hintTop && s.y < this.floatBottom;
    if (this.mateTag.classList.contains('hidden') === on) this.mateTag.classList.toggle('hidden', !on);
    if (!on || !m || !s) return;
    const text = `${m.name}${down ? ' · KNOCKED OUT' : d >= 12 ? ` · ${Math.round(d)}m` : ''}`;
    if (text !== this.mateTagText) {
      this.mateTagText = text;
      setText(this.mateTag, text);
      this.mateTag.classList.toggle('down', down);
    }
    this.mateTag.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -100%)`;
  }

  /** The fights on screen (Minecraft-style bars): the Wither, the raid, the giant you are fighting. */
  private refreshBoss(): void {
    const g = this.game;
    const bars: BossBar[] = [];
    if (this.mode === 'play' && g.isPlaying()) {
      bars.push(...bossBars(g));
      let giant: (typeof g.giants)[number] | null = null;
      let best = 75;
      for (const gi of g.giants) {
        // (A seal's guardian has its own bar.)
        if (gi.dead || gi.dormant || gi.guardian) continue;
        const [x, z] = gi.body.hullCentre();
        const d = Math.hypot(x - g.player.x, z - g.player.z);
        if (d < best) {
          best = d;
          giant = gi;
        }
      }
      if (giant && bars.length < 2) {
        const heart = giant.body.findBlock(B.GIANT_HEART);
        const c = heart !== null ? giant.body.cells.get(heart) : undefined;
        const pct = c ? Math.max(0, Math.min(1, c.hp / c.maxHp)) : 0;
        const sub = giant.blind ? 'BLIND' : giant.rage >= 2 ? 'ENRAGED' : giant.charge > 0 ? 'CHARGING' : 'HEART';
        bars.push({ key: giant.name, title: giant.name.toUpperCase(), sub, pct, tone: 'red', marks: giant.type === 'colossus' ? [0.33, 0.66] : [] });
      }
    }
    const shown = bars.slice(0, 2);
    const key = shown.map((b) => `${b.key}|${b.title}|${b.sub}|${Math.round(b.pct * 100)}|${b.tone}`).join('#');
    if (key !== this.lastBoss) {
      const was = new Map(this.lastBoss.split('#').filter(Boolean).map((s) => {
        const [k, , , pct] = s.split('|');
        return [k ?? '', Number(pct)] as const;
      }));
      this.lastBoss = key;
      setHTML(this.bossBar, shown.map((b) => {
        const pct = Math.round(b.pct * 100);
        const struck = (was.get(b.key) ?? -1) > pct;
        const marks = b.marks.map((m) => `<s style="left:${Math.round(m * 100)}%"></s>`).join('');
        return `<div class="bb ${b.tone}${struck ? ' hit' : ''}"><b>${escapeHtml(b.title)}</b><span class="meter"><i style="width:${pct}%"></i>${marks}</span><em>${escapeHtml(b.sub)}</em></div>`;
      }).join(''));
    }
    const rows = shown.length;
    if (rows !== this.bossRows) {
      this.bossRows = rows;
      this.bossShown = rows > 0;
      this.bossBar.classList.toggle('hidden', rows === 0);
      this.placeStack();
    }
  }

  /** Bars on screen right now (each a row of the boss board). */
  private bossRows = 0;

  private refreshHud(): void {
    const g = this.game;
    if (g.phase !== 'day' && g.phase !== 'night') return;
    // Fortress integrity and power (top left, like a ship's status board).
    const fort = Math.round(g.integrity() * 100);
    const power = Math.round(g.power() * 100);
    const core = g.coreHp();
    const coreLow = core.hp < core.max * 0.35;
    const legs = g.walker.legs.map((l) => (l.damage >= 0.85 ? 'bad' : l.damage >= 0.4 ? 'warn' : 'ok'));
    const gems = g.count(I.EMERALD);
    // (Narrow boards drop the long words; the width is the one it was placed at, never measured.)
    const compact = this.boardW < 230;
    const fortKey = `${fort}|${power}|${coreLow}|${legs.join(',')}|${gems}|${compact}|${this.inputMode}`;
    if (fortKey !== this.lastFort) {
      this.lastFort = fortKey;
      // (Its pieces are written in place: the hull's health changes all night long. A phone's board
      // is one line: glyphs for the fortress and its power, no words.)
      const phone = this.inputMode === 'touch';
      const d = this.fortParts(legs.length);
      setText(d.name, compact ? 'FORT' : 'FORTRESS');
      d.meter.classList.toggle('low', fort < 40);
      d.bar.style.width = `${fort}%`;
      setText(d.val, `${fort}%`);
      setText(d.power, phone ? `${power}%` : `POWER ${power}%`);
      d.powerLab.classList.toggle('warn', coreLow);
      setText(d.gems, String(gems));
      setText(d.legsWord, compact || phone ? '' : 'LEGS ');
      legs.forEach((c, i) => {
        const pip = d.legs[i]!;
        if (pip.className !== c) pip.className = c;
      });
    }
    // Day and time of day under the board ("DAY 3 · DUSK 0:42"), and, while the crew walks the
    // fortress, where to and how far (the helm strip takes over when you steer yourself).
    const label = timeLabel(g.clock());
    const theme = g.phase === 'night' && !g.siege ? (g.nightTheme === 'storm' ? 'STORM' : g.nightTheme === 'blood' ? 'BLOOD MOON' : g.nightTheme === 'raid' ? 'RAID' : g.nightTheme === 'wither' ? 'WITHER' : '') : '';
    const stage = g.siegeStage === 'pylons' ? ` · PYLONS ${g.pylons.filter((p) => p.alive).length}/${g.pylons.length}` : g.siegeStage === 'colossus' ? ' · COLOSSUS' : ` · HEART ${g.heartLeft}/${g.heartTotal}`;
    // A stormy or red night names itself, with how far the march has come.
    const when = g.siege ? `SIEGE${stage}` : g.phase === 'night' ? `NIGHT ${g.day}${theme ? ` · ${theme}` : ''} · ${Math.round(g.progress * 100)}%` : `DAY ${g.day} · ${label}`;
    // By day: the daylight left before the march (training holds the sun up).
    const left = g.phase === 'day' && !g.siege && !(training(g) && g.dayTime <= 45.5) ? Math.max(0, Math.ceil(g.dayTime)) : -1;
    const clock = left >= 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    const course = !g.helm && g.autopilot ? this.course() : null;
    const dayKey = `${when}|${clock}|${course ? `${course.deg}|${course.text}` : ''}`;
    if (dayKey !== this.lastDay) {
      this.lastDay = dayKey;
      // (Its pieces are written in place: the clock and the distance change every second.)
      const d = this.dayParts();
      setText(d.when, when);
      d.clock.classList.toggle('hidden', !clock);
      if (clock) {
        setText(d.clock, clock);
        d.clock.classList.toggle('late', left <= 30);
      }
      d.course.classList.toggle('hidden', !course);
      if (course) {
        d.arrow.style.transform = `rotate(${course.deg}deg)`;
        setText(d.place, course.text);
      }
      this.dayPill.classList.toggle('night', g.phase === 'night');
      this.dayPill.classList.toggle('blood', g.phase === 'night' && (g.nightTheme === 'blood' || g.nightTheme === 'raid' || g.nightTheme === 'wither'));
    }
    // Hearts, hunger and experience over the hotbar.
    const p = g.player;
    const hp = Math.max(0, Math.ceil(p.hp));
    const food = g.hunger;
    const xp = Math.round(g.levelProgress() * 100);
    // Poison turns the hearts green, wither black (as in Minecraft).
    const tint = g.effects.has('wither') ? ' withered' : g.effects.has('poison') ? ' poisoned' : '';
    const vKey = `${hp}|${p.maxHp}|${food}|${xp}|${g.level()}|${tint}`;
    if (vKey !== this.lastVitals) {
      this.lastVitals = vKey;
      // (Built once; a blow or a bite changes a picture or two, not the whole row.)
      const d = this.vitalParts();
      for (let i = 0; i < 10; i += 1) {
        const v = hp - i * 2;
        const icon = v >= 2 ? 'ui_heart' : v === 1 ? 'ui_heart_half' : 'ui_heart_empty';
        if (d.icons[i] !== icon) {
          d.icons[i] = icon;
          d.imgs[i]!.src = iconURL(icon);
        }
      }
      for (let i = 0; i < 10; i += 1) {
        const v = food - (9 - i) * 2;
        const icon = v >= 2 ? 'ui_food' : v === 1 ? 'ui_food_half' : 'ui_food_empty';
        if (d.icons[10 + i] !== icon) {
          d.icons[10 + i] = icon;
          d.imgs[10 + i]!.src = iconURL(icon);
        }
      }
      const hearts = `hearts${hp <= 6 ? ' low' : ''}${tint}`;
      if (d.hearts.className !== hearts) d.hearts.className = hearts;
      const foods = `food${food <= 6 ? ' low' : ''}`;
      if (d.food.className !== foods) d.food.className = foods;
      d.bar.style.width = `${xp}%`;
      setText(d.level, String(g.level()));
    }
    this.refreshEffects();
  }

  /** The effects on you, over the hearts: harmful ones first, each with its seconds left (or ∞). */
  private refreshEffects(): void {
    const list = effectList(this.game).slice(0, 6);
    const secs = (t: number): string => (t === Infinity ? '∞' : t >= 60 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : `${Math.ceil(t)}`);
    const key = list.map((e) => `${e.id}${e.level}:${secs(e.t)}`).join('|');
    if (key === this.lastEffects) return;
    this.lastEffects = key;
    setHTML(this.effectsEl, list.map((e) => {
      const lvl = e.level > 1 ? `<b>${e.level === 2 ? 'II' : e.level === 3 ? 'III' : e.level}</b>` : '';
      const ending = e.t !== Infinity && e.t < 4 ? ' ending' : '';
      return `<div class="fx ${e.def.bad ? 'bad' : 'good'}${ending}" title="${escapeHtml(`${e.def.name}: ${e.def.text}`)}"><img alt="" src="${iconURL(e.def.icon)}">${lvl}<span>${secs(e.t)}</span></div>`;
    }).join(''));
  }

  /** Edge arrows pointing at giants, phantoms and leg climbers you cannot see. */
  private refreshThreats(): void {
    const g = this.game;
    const show = this.mode === 'play' && g.isPlaying() && (g.phase === 'night' || g.phase === 'day');
    const threats = show ? g.threats() : [];
    // (The size from the last layout: measuring the page every frame would force a reflow.)
    const vw = this.vw;
    const vh = this.vh;
    const r = this.renderer;
    const eye = r.eye;
    this.threatEls.forEach((node, i) => {
      const t = threats[i];
      if (!t) {
        if (!node.classList.contains('hidden')) node.classList.add('hidden');
        return;
      }
      const p = r.project([t.x, t.y, t.z]);
      const margin = 24;
      if (p && p.x > margin && p.x < vw - margin && p.y > (t.kind === 'giant' ? 0 : this.hintTop) && p.y < vh - margin) {
        // In view: giants get a lock-on bracket with their range (they often hide below the bow);
        // one that sits up behind the HUD is pinned just under it.
        if (t.kind !== 'giant') {
          node.classList.add('hidden');
          return;
        }
        if (node.className !== 'threat lock giant') node.className = 'threat lock giant';
        node.style.transform = `translate(${Math.round(p.x - 17)}px, ${Math.round(Math.max(this.hintTop + 4, p.y) - 17)}px)`;
        const label = `${Math.round(Math.hypot(t.x - eye[0], t.z - eye[2]))}m`;
        const span = node.querySelector('span')!;
        setText(span, label);
        return;
      }
      const dx = t.x - eye[0];
      const dz = t.z - eye[2];
      const right = dx * r.cam.r[0] + dz * r.cam.r[2];
      const ahead = dx * r.cam.f[0] + dz * r.cam.f[2];
      const a = Math.atan2(right, ahead);
      const rx = vw / 2 - 30;
      const ry = Math.max(80, vh / 2 - 110);
      const x = vw / 2 + Math.sin(a) * rx - 11;
      const y = vh / 2 - Math.cos(a) * ry - 11;
      const cls = `threat ${t.kind}`;
      if (node.className !== cls) node.className = cls;
      node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) rotate(${a.toFixed(2)}rad)`;
    });
  }

  /** The label the action prompt shows right now (the E key does what it says). */
  get promptLabel(): string {
    return this.lastPrompt;
  }

  private jumpIcon: keyof typeof JUMP_ICONS = 'jump';
  /** The item pictured on the attack button (null: the sword). */
  private attackShows: number | null = null;
  private planOpen = false;
  private planTimer = 0;
  private tipTimer = 0;
  private briefTimer = 0;
  private hintsEnabled = loadHintsSetting();

  get hintsOn(): boolean {
    return this.hintsEnabled;
  }

  // ------------------------------------------------------------------ the coach

  /** The lesson on the card: the seconds it has left, has been up, and has been out of date. */
  private lessonNow: { l: Lesson; t: number; age: number; gone: number } | null = null;
  /** What the hand points at, and the spot the marker sits over (tracked every frame). */
  private coachPoint: PointAt | null = null;
  private coachTarget: Vec3 | null = null;
  private coachLabel = '';
  private coachDanger = false;
  /** The control ringed in gold for the hand's lesson, and the ring pulsing over it. */
  private ringed: HTMLElement | null = null;
  private readonly ringEl: HTMLElement;
  private ringAt = '';
  /** Names of the fortress's parts (refreshed with the card, projected every frame). */
  private parts: Array<{ at: Vec3; text: string }> = [];
  /** SKIP TUTORIAL asks once more before it skips (seconds the question stands). */
  private skipArmed = 0;

  lesson(l: Lesson): void {
    if (this.mode !== 'play') return;
    this.lessonNow = { l, t: l.hold, age: 0, gone: 0 };
    this.clearTip();
  }

  get lessonOpen(): boolean {
    return this.lessonNow !== null;
  }

  /** A calm lesson that has been up a few seconds gives way to an urgent one. */
  get lessonUrgentOnly(): boolean {
    const l = this.lessonNow;
    return this.hintsEnabled && l !== null && l.l.tone !== 'danger' && l.l.hold - l.t > 3.5;
  }

  /** A level up: "LEVEL 3!" rises off the experience bar and its number glows a moment. */
  levelUp(level: number): void {
    if (this.mode !== 'play') return;
    // (A step's stamp on screen has its moment first: the level rises when it has gone.)
    const wait = this.coach.stampLeft;
    if (wait > 0) {
      window.setTimeout(() => this.levelUp(level), wait * 1000 + 150);
      return;
    }
    // (What a level gives: see Game.xp, the mining speed in build.ts and the sword in mobs.ts.)
    const perks = [...(level <= 10 ? ['+1 max health'] : []), level % 3 === 0 ? 'sword hits harder' : 'faster mining'];
    const node = el('div', 'abs lvl-pop', `<b>LEVEL ${level}!</b><span>${perks.join(' · ')}</span>`);
    region(node, 'decorative', 'level-up', false);
    const r = viewRect(this.vitals);
    const root = viewRect(this.root);
    node.style.left = `${Math.round(r.x - root.x + r.width / 2)}px`;
    node.style.top = `${Math.round(r.bottom - root.y - 8)}px`;
    this.root.insertBefore(node, this.hotbar);
    window.setTimeout(() => node.remove(), 2100);
    this.vitals.classList.remove('lvl');
    void this.vitals.offsetWidth;
    this.vitals.classList.add('lvl');
  }

  /** A training step done: a stamp over the card and a chime (the last one: a fanfare). */
  coachDone(final: boolean): void {
    if (this.mode !== 'play') return;
    // In the middle of the view, between the card and the hearts (under an announcement on screen,
    // not on top of it).
    const vw = this.root.clientWidth || window.innerWidth;
    let y = (this.hintTop + this.floatBottom) / 2;
    if (this.bannerTimer > 0) y = Math.min(this.floatBottom - 40, Math.max(y, this.bannerEl.offsetTop + this.bannerEl.offsetHeight + 36));
    this.coach.done(final, vw / 2, y);
    this.game.audio.play('success');
    if (final) this.game.audio.play('levelup');
    this.game.buzz(final ? 70 : 25);
  }

  private skipTraining(): void {
    if (this.skipArmed <= 0) {
      this.skipArmed = 3;
      this.coach.armSkip(true);
      this.game.audio.play('click');
      return;
    }
    this.skipArmed = 0;
    this.coach.armSkip(false);
    this.game.tutorialStep = TRAINING.length;
    // (Already down in the village: the grapple the training was saving for its lesson.)
    if (this.game.flags.descended && !this.game.relics.has('grapple')) {
      this.game.grantRelic('grapple');
      this.game.addPage('grapple', false, true);
    }
    this.game.toast('Tutorial skipped: HOW TO PLAY is in the pause menu');
    this.togglePlan(false);
  }

  /** What the card says (training step, lesson or the next goal), refreshed ten times a second. */
  private refreshCoach(): void {
    const g = this.game;
    const playing = this.mode === 'play' && g.isPlaying();
    const pc = this.inputMode === 'desktop';
    const distTo = (t: Vec3 | null): number => (t ? Math.round(Math.hypot(t[0] - g.player.x, t[2] - g.player.z)) : -1);
    let view: CardView | null = null;
    let point: PointAt | null = null;
    let target: Vec3 | null = null;
    let label = '';
    let danger = false;
    const step = playing && this.hintsEnabled ? trainingStep(g) : null;
    if (step) {
      const c = step.how(g, pc);
      const i = g.tutorialStep;
      target = g.goalTarget();
      view = { key: `step:${step.id}`, mode: 'step', tone: 'train', icon: step.icon, title: step.title, tag: `STEP ${i + 1} OF ${TRAINING.length}`, why: step.why, text: c.text, art: step.art, dist: distTo(target), pips: [i, TRAINING.length], skip: true, more: false };
      point = c.point;
      label = step.label;
    } else if (playing && this.lessonNow) {
      const l = this.lessonNow.l;
      const c = l.how(g, pc);
      target = l.target?.(g) ?? null;
      view = { key: `lesson:${l.id}`, mode: 'lesson', tone: l.tone, icon: l.icon, title: l.title, tag: 'NEW!', why: '', text: c.text, art: l.art, dist: distTo(target), pips: null, skip: false, more: false };
      point = c.point;
      label = l.label ?? '';
      danger = l.tone === 'danger';
    } else if (playing && g.goal) {
      const goal = g.goal;
      target = g.goalTarget();
      // At night the bounty rides along under the goal (by day, a reminder of what comes next).
      const b = g.phase === 'night' ? g.bounty : null;
      const bounty = b && !b.paid ? `★ BOUNTY · ${bountyText(b)} · ${bountyProgress(b)} · +${b.reward}◆` : goal.note ?? '';
      view = { key: 'goal', mode: 'goal', tone: goal.tone, icon: goal.icon ?? 'ui_sun', title: goal.text, tag: goal.tag, why: '', text: bounty, art: null, dist: distTo(target), pips: null, skip: false, more: true };
      label = goal.label ?? '';
      danger = goal.tone === 'danger';
    }
    this.coach.show(view);
    this.coachPoint = point;
    this.coachTarget = target;
    g.lessonMark = view?.mode === 'lesson' ? target : null;
    this.coachLabel = label;
    this.coachDanger = danger;
    const tags = playing && this.hintsEnabled && training(g) && !g.helm && !g.hoist;
    this.parts = tags ? partLabels(g) : [];
    if (tags && g.pet) this.parts.push({ at: [g.pet.a.x, g.pet.a.y + 1.35, g.pet.a.z], text: `${g.pet.name.toUpperCase()} · YOUR WOLF` });
    if (!view && this.planOpen) this.togglePlan(false);
    if (this.planOpen) this.renderPlan();
  }

  /** Every frame: the hand on its control, the marker over its spot, the part names. */
  private trackCoach(): void {
    const g = this.game;
    const touch = this.inputMode === 'touch';
    const live = this.mode === 'play' && g.isPlaying() && !g.player.dead;
    // Walking, looking round or steering folds the card's picture out of the way.
    const p = g.player;
    if (live && (Math.hypot(p.vx, p.vz) > 0.8 || g.time - g.lookTime < 0.15 || Math.abs(g.speed) > 0.3 || g.mining.swing > 0 || p.climbing)) this.coach.busyPlayer();
    const pointer = live ? this.pointerFor(this.coachPoint) : null;
    this.coach.point(pointer, touch);
    // (Over the crane's gauge, which sits above the rest of the controls.)
    const lifted = this.coachPoint?.kind === 'crane';
    if (this.coach.hand.classList.contains('lifted') !== lifted) {
      this.coach.hand.classList.toggle('lifted', lifted);
      this.coach.keycap.classList.toggle('lifted', lifted);
    }
    // The control itself wears a gold ring too (re-applied: the hotbar is rebuilt often), with the
    // coach's ring pulsing out from it.
    const ring = live ? this.ringFor(this.coachPoint) : null;
    if (ring !== this.ringed) {
      this.ringed?.classList.remove('coach');
      this.ringed = ring;
    }
    if (ring && !ring.classList.contains('coach')) ring.classList.add('coach');
    this.placeRing(ring);
    // Co-op: the helmsman's mark beats the coach's spot (both players see what to shoot).
    const marked = live && (g.coopHost?.live || g.coopGuest?.playing) ? markPoint(g) : null;
    if (marked) this.coach.marker(this.markerFor([marked.x, marked.y + (marked.mob ? marked.mob.h * 0.6 : 0.4), marked.z], 'TARGET', true));
    else this.coach.marker(live ? this.markerFor(this.coachTarget, this.coachLabel, this.coachDanger) : null);
    // (Name tags give way to an announcement across the view.)
    this.coach.partLabels(live && this.bannerTimer <= 0 ? this.partTags() : []);
  }

  /** The pulsing ring over the ringed control (moved only when the control has moved). */
  private placeRing(node: HTMLElement | null): void {
    const el = this.ringEl;
    const r = node ? this.spotOf(node) : null;
    if (!r) {
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      this.ringAt = '';
      return;
    }
    const pad = 4;
    const at = `${Math.round(r.x - r.w / 2 - pad)},${Math.round(r.y - r.h / 2 - pad)},${Math.round(r.w + pad * 2)},${Math.round(r.h + pad * 2)}`;
    if (at !== this.ringAt) {
      this.ringAt = at;
      const [x, y, w, h] = at.split(',').map(Number) as [number, number, number, number];
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      const round = node === this.stick || ((node === this.jumpBtn || node === this.attackBtn || node!.classList.contains('ctx-btn')) && this.inputMode === 'touch');
      el.classList.toggle('round', round);
    }
    if (el.classList.contains('hidden')) el.classList.remove('hidden');
  }

  /** A control's centre and size, from the same short-lived measurements the hand uses. */
  private spotOf(node: Element): { x: number; y: number; w: number; h: number } | null {
    if ((node as HTMLElement).classList.contains('hidden')) return null;
    const now = performance.now();
    const cached = this.spots.get(node);
    if (cached && now - cached.at < 120) return cached;
    const root = viewRect(this.root);
    const r = viewRect(node);
    const v = r.width === 0 ? null : { x: r.x - root.x + r.width / 2, y: r.y - root.y + r.height / 2, w: r.width, h: r.height, at: now };
    this.spots.set(node, v);
    return v;
  }

  private ringFor(at: PointAt | null): HTMLElement | null {
    if (!at) return null;
    switch (at.kind) {
      case 'stick':
        return this.inputMode === 'touch' ? this.stick : null;
      case 'action':
        return this.prompt.classList.contains('hidden') ? null : this.prompt;
      case 'slot':
        return this.hotbar.querySelector<HTMLElement>(`[data-slot="${at.item}"]`);
      case 'march':
        return this.marchBtn;
      case 'jump':
        return this.jumpBtn;
      case 'stomp':
        return this.stompBtn.classList.contains('hidden') ? null : this.stompBtn;
      case 'crane':
        return this.craneEl.classList.contains('hidden') ? null : this.craneEl;
      case 'steady':
        return this.inputMode === 'touch' ? this.stick : null;
      default:
        return null;
    }
  }

  /** Where the hand goes (and which key a desktop player presses) for a control. */
  /** Centres of HUD controls (measured at the HUD's refresh rate, not every frame). */
  private spots = new Map<Element, { x: number; y: number; w: number; h: number; at: number } | null>();

  private pointerFor(at: PointAt | null): Pointer | null {
    if (!at) return null;
    const g = this.game;
    const touch = this.inputMode === 'touch';
    const vw = this.vw;
    const vh = this.vh;
    const now = performance.now();
    const spot = (node: Element | null, fy = 0.5): { x: number; y: number; w: number; h: number } | null => {
      if (!node || (node as HTMLElement).classList.contains('hidden')) return null;
      const cached = this.spots.get(node);
      if (cached && now - cached.at < 120) return cached;
      const root = viewRect(this.root);
      const r = viewRect(node);
      const v = r.width === 0 ? null : { x: r.x - root.x + r.width / 2, y: r.y - root.y + r.height * fy, w: r.width, h: r.height, at: now };
      this.spots.set(node, v);
      return v;
    };
    const swipe: Pointer = { x: vw * 0.66, y: vh * 0.52, gesture: 'swipe', key: null };
    switch (at.kind) {
      case 'stick': {
        if (!touch) return { x: vw / 2, y: this.floatBottom - 6, gesture: null, key: 'W A S D' };
        // The first lesson takes turns: the pad to walk, a swipe to look.
        if (trainingStep(g)?.id === 'walk' && Math.floor(g.time / 2.8) % 2 === 1) return swipe;
        const c = spot(this.stick);
        return c ? { ...c, gesture: 'drag', key: null } : null;
      }
      case 'look':
        return touch ? swipe : { x: vw / 2, y: vh / 2 + 80, gesture: null, key: 'MOUSE' };
      case 'action': {
        // Desktop: the prompt already shows its E key (and pulses).
        const c = spot(this.prompt);
        return c && touch ? { ...c, gesture: 'tap', key: null } : null;
      }
      case 'slot': {
        const c = spot(this.hotbar.querySelector(`[data-slot="${at.item}"]`));
        if (!c) return null;
        const digit = g.hotbarItems().indexOf(at.item ?? -1) + 2;
        return touch ? { ...c, gesture: 'tap', key: null } : { x: c.x, y: c.y - 30, gesture: null, key: digit >= 2 && digit <= 9 ? String(digit) : 'WHEEL' };
      }
      case 'march': {
        const c = spot(this.marchBtn);
        return c ? (touch ? { ...c, gesture: 'tap', key: null } : { x: c.x, y: c.y - 34, gesture: null, key: 'N' }) : null;
      }
      case 'jump': {
        const c = spot(this.jumpBtn);
        return c ? (touch ? { ...c, gesture: 'tap', key: null } : { x: vw / 2, y: this.floatBottom - 6, gesture: null, key: 'SPACE' }) : null;
      }
      case 'stomp': {
        const c = spot(this.stompBtn);
        return c ? (touch ? { ...c, gesture: 'tap', key: null } : { x: c.x, y: c.y - 34, gesture: null, key: 'X' }) : null;
      }
      case 'crane': {
        // A thumb on the gauge's bar, left of the gold (the hand hangs below it, clear of the needle's
        // way to the gold); a key cap over its top edge (any click will do).
        const c = spot(this.craneEl, 0.5);
        if (!c) return null;
        return touch ? { x: c.x - c.w * 0.28, y: c.y + c.h * 0.08, gesture: 'tap', key: null } : { x: c.x, y: c.y - c.h / 2 - 4, gesture: null, key: 'CLICK' };
      }
      case 'steady': {
        // The load's swing runs across the screen: the stick (or A and D) leans against it.
        if (!touch) {
          const c = spot(this.craneEl, 0.5);
          return { x: vw / 2, y: (c ? c.y - c.h / 2 : this.floatBottom) - 4, gesture: null, key: 'A D' };
        }
        const c = spot(this.stick);
        return c ? { x: c.x, y: c.y, gesture: 'drag', key: null } : null;
      }
      case 'world':
      case 'mob': {
        let t: Vec3 | null = at.kind === 'world' ? this.coachTarget : null;
        if (at.kind === 'mob') {
          // The nearest monster in front of you.
          let best = Infinity;
          const e = this.renderer.eye;
          for (const m of g.mobs) {
            if (m.dead) continue;
            const d = Math.hypot(m.x - e[0], m.cy - e[1], m.z - e[2]);
            if (d < best && d < 40) {
              const s = this.renderer.project([m.x, m.cy, m.z]);
              if (!s || s.x < 20 || s.x > vw - 20 || s.y < this.hintTop || s.y > this.floatBottom) continue;
              best = d;
              t = [m.x, m.cy, m.z];
            }
          }
        }
        if (!t) return null;
        const s = this.renderer.project(t);
        if (!s || s.x < 24 || s.x > vw - 24 || s.y < this.hintTop + 10 || s.y > this.floatBottom - 10) return null;
        return touch ? { x: s.x, y: s.y, gesture: 'tap', key: null } : { x: s.x, y: s.y - 26, gesture: null, key: at.kind === 'world' ? 'RIGHT CLICK' : 'CLICK' };
      }
      default:
        return null;
    }
  }

  /** The marker over the spot, or an arrow on the screen's edge turned towards it. */
  private markerFor(t: Vec3 | null, label: string, danger: boolean): Marker | null {
    const g = this.game;
    if (!t) return null;
    const p = g.player;
    const dist = Math.round(Math.hypot(t[0] - p.x, t[2] - p.z));
    if (dist < 3 && Math.abs(t[1] - p.y) < 3.5) return null;
    const vw = this.vw;
    // The open view between the HUD stack and the hearts (and left of the buttons on the right).
    const top = this.hintTop + 8;
    const bottom = Math.max(top + 70, Math.min(this.floatBottom - 16, this.ctxStackTop - 14));
    const s = this.renderer.project(t);
    if (s && s.x > 40 && s.x < vw - 40 && s.y > top + 30 && s.y < bottom) return { x: s.x, y: s.y - 4, edge: null, label, dist, danger };
    // Off the open view: which way is it, as you look?
    const r = this.renderer;
    const e = r.eye;
    const dx = t[0] - e[0];
    const dy = t[1] - e[1];
    const dz = t[2] - e[2];
    const right = dx * r.cam.r[0] + dy * r.cam.r[1] + dz * r.cam.r[2];
    const ahead = dx * r.cam.f[0] + dy * r.cam.f[1] + dz * r.cam.f[2];
    const turn = Math.atan2(right, ahead);
    if (ahead > 0 && Math.abs(turn) < 0.6) {
      // In front, but above the view (behind the HUD) or below it: an arrow up or down.
      const above = s ? s.y <= top + 30 : dy > 0;
      // Hidden behind the open card: it folds away so you can see.
      if (above && s && s.y > this.cardTop && this.coach.open) this.coach.busyPlayer();
      const x = Math.max(70, Math.min(vw - 70, s ? s.x : vw / 2));
      return { x, y: above ? top + 30 : bottom - 26, edge: above ? 0 : Math.PI, label, dist, danger };
    }
    // To the side or behind: an arrow on the side to turn to.
    const side = turn >= 0 ? 1 : -1;
    return { x: side > 0 ? vw - 50 : 50, y: (top + bottom) / 2, edge: (side * Math.PI) / 2, label, dist, danger };
  }

  private partTags(): Array<{ x: number; y: number; text: string; alpha: number }> {
    if (this.parts.length === 0) return [];
    const g = this.game;
    const p = g.player;
    // (Landscape: the card stands left of the column, so tags keep right of it.)
    const left = this.wide && this.coach.shown ? this.coach.card.offsetLeft + this.coach.card.offsetWidth + 60 : 30;
    const out: Array<{ x: number; y: number; text: string; alpha: number; d: number }> = [];
    for (const l of this.parts) {
      if (this.coachTarget && l.text === this.coachLabel) continue;
      const d = Math.hypot(l.at[0] - p.x, l.at[1] - (p.y + 1.6), l.at[2] - p.z);
      if (d > 13 || d < 1.4) continue;
      const s = this.renderer.project(l.at);
      if (!s || s.y < this.hintTop + 16 || s.y > this.floatBottom - 4 || s.x < left || s.x > this.vw - 30) continue;
      out.push({ x: s.x, y: s.y, text: l.text, alpha: Math.min(0.95, (13 - d) / 5), d });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 4);
  }

  /** The opening flyover: letterbox, captions, the HUD out of the way. */
  private tickCine(): void {
    const it = this.game.intro;
    const on = it !== null && this.mode === 'play';
    if (this.root.classList.contains('cine') !== on) this.root.classList.toggle('cine', on);
    if (!on) {
      this.coach.caption(null, '', '');
      return;
    }
    const c = introCaption(it);
    this.coach.caption(c.title, c.sub, this.inputMode === 'desktop' ? 'CLICK OR SPACE TO SKIP ▸▸' : 'TAP TO SKIP ▸▸');
  }

  /** Today's plan (or tonight's), dropped down from the goal line for a few seconds. */
  togglePlan(open = !this.planOpen): void {
    if (open && (this.mode !== 'play' || !this.coach.shown)) return;
    this.planOpen = open;
    this.planTimer = 12;
    this.planPanel.classList.toggle('hidden', !open);
    if (open) {
      this.game.audio.play('click');
      this.renderPlan();
      this.layoutPlan();
    }
  }

  private lastPlan = '';

  private renderPlan(): void {
    const g = this.game;
    const night = g.phase === 'night';
    const title = night ? `TONIGHT · NIGHT ${g.day}` : training(g) ? `TRAINING · ${g.tutorialStep}/${TRAINING.length} DONE` : `TODAY · DAY ${g.day}`;
    const items = night ? nightPlan(g).map((text) => ({ text, done: false })) : dayPlan(g);
    const rows = items.map((it) => `<li class="${it.done ? 'done' : ''}"><i>${it.done ? '✓' : '◆'}</i>${escapeHtml(it.text)}</li>`).join('');
    const skip = training(g) ? '<button class="stone mini" data-act="skip">SKIP TRAINING</button>' : '';
    const html = `<div class="ptitle">${escapeHtml(title)}</div><ul>${rows}</ul><div class="pbtns"><button class="stone mini" data-act="guide">FULL GUIDE</button>${skip}</div>`;
    if (html === this.lastPlan) return;
    this.lastPlan = html;
    setHTML(this.planPanel, html);
    if (this.planOpen) this.fitButtons();
    this.planPanel.querySelector('[data-act="guide"]')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openGuide();
    });
    this.planPanel.querySelector('[data-act="skip"]')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.game.tutorialStep = TRAINING.length;
      this.game.toast('Training skipped: the full guide is in the pause menu');
      this.togglePlan(false);
    });
  }

  private layoutPlan(): void {
    const r = viewRect(this.coach.card);
    const root = viewRect(this.root);
    const w = Math.max(r.width, Math.min(this.safe.width, 320));
    place(this.planPanel, r.x - root.x + (r.width - w) / 2, r.bottom - root.y + 4, w, null);
    this.fitButtons();
  }

  /** A one-time tip: shown under the goal line for a few seconds (tap to dismiss). */
  tip(text: string): void {
    if (this.mode !== 'play') return;
    setHTML(this.tipEl, `<b>TIP</b><span>${escapeHtml(text)}</span>`);
    this.tipEl.classList.remove('hidden');
    this.tipTimer = 6 + Math.min(5, text.length / 25);
    this.placeToasts();
  }

  clearTip(): void {
    if (this.tipTimer <= 0) return;
    this.tipTimer = 0;
    this.tipEl.classList.add('hidden');
    this.placeToasts();
  }

  /** A briefing card is up (tips wait until it is gone). */
  get briefOpen(): boolean {
    return this.briefTimer > 0;
  }

  /** The dawn / dusk / welcome card: a few short points, gone after a few seconds or a tap. */
  briefing(title: string, sub: string, lines: string[], tone: BannerTone): void {
    this.bannerEl.classList.remove('show');
    this.bannerTimer = 0;
    // A feat card on screen steps aside until the briefing is read (it comes back after).
    if (this.featTimer > 0 && this.featNow) {
      this.featQueue.unshift(this.featNow);
      this.featTimer = 0;
      this.featEl.classList.remove('on');
    }
    this.briefEl.className = `abs ${tone}`;
    setHTML(this.briefEl, `<div class="btitle">${escapeHtml(title)}</div>${sub ? `<div class="bsub">${escapeHtml(sub)}</div>` : ''}<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul><div class="bfoot">tap to close</div>`);
    this.briefTimer = 4 + Math.min(4, lines.length) * 1.3;
    this.tipEl.classList.add('hidden');
    this.tipTimer = 0;
    this.placeToasts();
  }

  private hideBrief(): void {
    this.briefTimer = 0;
    this.briefEl.classList.add('hidden');
    this.placeToasts();
  }

  get guideOpen(): boolean {
    return !this.guideModal.classList.contains('hidden');
  }

  /** The handbook: what to do each day and night, the fortress, weapons, the valley, controls. */
  openGuide(): void {
    const g = this.game;
    if (!g.isPlaying() && g.modal !== 'pause') return;
    g.modal = 'pause';
    g.paused = true;
    this.releaseInputs();
    this.onSuspendPlay?.();
    this.togglePlan(false);
    const sections = handbook(this.inputMode === 'desktop', this.game.world.terrain.version >= 2).map((sec) => `
      <div class="gsec">${sec.art ? `<img class="gart" alt="" data-combos-asset-role="tutorial_art" src="${artURL(sec.art)}" onerror="this.remove()">` : ''}<div class="ghead"><img alt="" src="${iconURL(sec.icon)}"><span>${escapeHtml(sec.title)}</span></div>
      <ul>${sec.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul></div>`).join('');
    setHTML(this.guideModal, `
      <h2><span>HOW TO PLAY</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="scroll">${sections}</div>`);
    this.guideModal.querySelector('.close')?.addEventListener('click', () => this.closeModals());
    for (const m of [this.pauseModal, this.craftModal, this.mapModal, this.villageModal]) m.classList.add('hidden');
    this.game.audio.play('click');
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.guideModal.classList.remove('hidden');
    this.layout();
  }

  // ------------------------------------------------------------------ story

  /** The prologue: three illustrated pages that type themselves out (tap to go on, SKIP to start). */
  showPrologue(done: () => void): void {
    let index = -1;
    let typing = 0;
    let finished = false;
    /** The page on screen and how far its line has typed (a language switch re-types it). */
    let typed: { page: { art: string; text: string }; n: number } | null = null;
    /** Unhooks the language listener when the prologue is over. */
    let dropLang = (): void => {};
    // (The Long March adds the seals barring the valley.)
    const pages = this.game.world.terrain.version >= 2 ? [...PROLOGUE, PROLOGUE_SEALS] : PROLOGUE;
    // Fetch all three pictures at once so the pages turn without a blank.
    for (const p of pages) new Image().src = new URL(p.art, document.baseURI).href;
    setHTML(this.prologue, `
      <img class="pro-art" alt="" data-combos-asset-role="story_art">
      <div class="pro-shade"></div>
      <div class="pro-text"><p translate="no"></p><div class="pro-foot"><span class="pro-dots"></span><span class="pro-next">${this.inputMode === 'desktop' ? 'CLICK OR SPACE' : 'TAP'} TO CONTINUE ▸</span></div></div>
      <button class="stone pro-skip" data-act="skip">SKIP ▸▸</button>`);
    const art = this.prologue.querySelector<HTMLImageElement>('.pro-art')!;
    const text = this.prologue.querySelector<HTMLElement>('.pro-text p')!;
    const dots = this.prologue.querySelector<HTMLElement>('.pro-dots')!;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      typed = null;
      dropLang();
      this.prologueKey = null;
      window.clearInterval(typing);
      markPrologueSeen();
      this.prologue.classList.add('hidden');
      setHTML(this.prologue, '');
      done();
    };
    const show = (i: number): void => {
      index = i;
      if (index >= pages.length) {
        finish();
        return;
      }
      const page = pages[index]!;
      art.classList.remove('in');
      art.src = new URL(page.art, document.baseURI).href;
      void art.offsetWidth;
      art.classList.add('in');
      setHTML(dots, pages.map((_, k) => `<i class="${k === index ? 'on' : ''}"></i>`).join(''));
      // The words type out; a tap finishes the line first, the next tap turns the page.
      // (The paragraph is translate="no": each slice is written as it stands. A language switch
      // mid-page re-types the line from its English source rather than keeping these words.)
      const line = { page, n: 0 };
      typed = line;
      const words = tr(page.text);
      window.clearInterval(typing);
      typing = window.setInterval(() => {
        line.n += 2;
        text.textContent = words.slice(0, line.n);
        if (line.n >= words.length) window.clearInterval(typing);
      }, 28);
      this.game.audio.play('page', 'wood', 0.6);
    };
    this.prologue.onpointerdown = (e) => {
      e.preventDefault();
      if ((e.target as HTMLElement).closest('[data-act="skip"]')) {
        finish();
        return;
      }
      advance();
    };
    const advance = (): void => {
      const page = pages[index];
      // (A tap while the line is still typing finishes it first. The paragraph is translate="no",
      // so the finished line goes straight into it — `typed` keeps its English for a switch.)
      const line = typed;
      if (page && line && line.n < tr(page.text).length) {
        window.clearInterval(typing);
        const words = tr(page.text);
        line.n = words.length;
        text.textContent = words;
        return;
      }
      show(index + 1);
    };
    // Keyboard: Space / Enter turn the page, Esc skips.
    this.prologueKey = (code) => {
      if (finished) return false;
      if (code === 'Escape') finish();
      else if (code === 'Space' || code === 'Enter') advance();
      else return false;
      return true;
    };
    this.game.audio.playMusic('night');
    this.prologue.classList.remove('hidden');
    show(0);
    // A language switch while a page is up re-types that page in the new language (from its
    // English source), keeping the page and how far it had got.
    dropLang = onLangChange(() => {
      const line = typed;
      if (finished || !line) return;
      const words = tr(line.page.text);
      const at = Math.min(line.n, words.length);
      window.clearInterval(typing);
      text.textContent = words.slice(0, at);
      line.n = at;
      if (at >= words.length) return;
      typing = window.setInterval(() => {
        line.n += 2;
        const w = tr(line.page.text);
        text.textContent = w.slice(0, line.n);
        if (line.n >= w.length) window.clearInterval(typing);
      }, 28);
    });
  }

  story(kind: StoryKind, id: string): void {
    this.storyQueue.push({ kind, id });
    if (!this.storyOpen) this.nextStory();
  }

  /** An officer's words: a card a line (the first ones in front of any story cards still to come). */
  talk(id: string, lines: string[], mood: TalkMood): void {
    this.storyQueue.unshift(...lines.map((text, i) => ({ kind: 'talk' as const, id: JSON.stringify({ id, text, mood, last: i === lines.length - 1 }) })));
    if (!this.storyOpen) this.nextStory();
  }

  /** Shows the next story card over play (or over the trader's window it came from). */
  private nextStory(): void {
    const next = this.storyQueue.shift();
    if (!next) return;
    const g = this.game;
    if (!this.storyOpen) {
      this.storyPrev = g.modal;
      if (g.modal === 'none') {
        this.releaseInputs();
        this.onSuspendPlay?.();
        this.setMode('modal');
        this.backdrop.classList.remove('hidden');
      }
      g.modal = 'story';
      this.storyOpen = true;
    }
    const pc = this.inputMode === 'desktop';
    if (next.kind === 'relic') {
      const r = RELICS[next.id as RelicId];
      if (!r) {
        this.closeStory();
        return;
      }
      this.storyModal.className = 'abs story-card relic';
      setHTML(this.storyModal, `
        <div class="sc-head">RELIC ENTRUSTED</div>
        <div class="sc-icon"><img alt="" src="${iconURL(r.icon)}"></div>
        <div class="sc-name">${escapeHtml(r.name)}</div>
        <div class="sc-from">from ${escapeHtml(r.from)}</div>
        <div class="sc-story">“${escapeHtml(r.story)}”</div>
        <div class="sc-use"><b>RELIC POWER</b>${escapeHtml(r.use(pc))}</div>
        <button class="stone big-btn green" data-act="ok">TAKE IT</button>`);
    } else if (next.kind === 'chapter') {
      // A new land: its picture, what it is like, who lives there, and the seal at its far end.
      const T = g.world.terrain;
      const i = Number(next.id);
      const land = T.regions[i];
      const ch = land ? CHAPTERS[land.zone] : undefined;
      if (!land || !ch) {
        this.closeStory();
        return;
      }
      const seal = T.seals[i];
      this.storyModal.className = 'abs story-card chapter';
      setHTML(this.storyModal, `
        <div class="sc-head">CHAPTER ${i + 1} OF ${T.regions.length}</div>
        <img class="sc-art" alt="" data-combos-asset-role="chapter_art" src="${new URL(ch.art, document.baseURI).href}">
        <div class="sc-name">${escapeHtml(land.name.toUpperCase())}</div>
        <div class="sc-story">${escapeHtml(ch.text)}</div>
        <div class="sc-use"><b>HERE</b>${escapeHtml(ch.foes)}</div>
        ${seal ? `<div class="sc-note">At its far end: the ${escapeHtml(seal.name)}, held by ${escapeHtml(GUARDIANS[seal.guardian].name)}. Its trophy: ${escapeHtml(TROPHIES[seal.guardian].name)}</div>` : land.zone === 'blight' ? '<div class="sc-note">At its far end: the Creeper Citadel</div>' : ''}
        <button class="stone big-btn green" data-act="ok">MARCH ON</button>`);
      this.game.audio.play('chapter', 'wood', 0.9);
    } else if (next.kind === 'saga') {
      // The saga's great moments: a tall picture and a line under it.
      const open = /^open(\d)$/.exec(next.id);
      const s = open ? SAGA_OPENING[Number(open[1])] : next.id === 'forge' ? SAGA_FORGE : next.id === 'veyra' ? SAGA_VEYRA : next.id === 'epilogue' ? SAGA_EPILOGUE : undefined;
      if (!s) {
        this.closeStory();
        return;
      }
      this.storyModal.className = 'abs story-card saga';
      setHTML(this.storyModal, `
        <img class="sc-tall" alt="" data-combos-asset-role="saga_art" src="${new URL(s.art, document.baseURI).href}">
        <div class="sc-story">${escapeHtml(s.text)}</div>
        <button class="stone big-btn green" data-act="ok">GO ON</button>`);
      this.game.audio.play('page', 'wood', 0.9);
    } else if (next.kind === 'expedition') {
      // An expedition reached: the place, the Strider that lies there, and what to do.
      const i = Number(next.id);
      const info = EXPEDITIONS[i];
      const e = g.world.terrain.expeditions[i];
      if (!info || !e) {
        this.closeStory();
        return;
      }
      this.storyModal.className = 'abs story-card chapter';
      setHTML(this.storyModal, `
        <div class="sc-head">EXPEDITION ${i + 1} OF ${EXPEDITIONS.length}</div>
        <img class="sc-art" alt="" data-combos-asset-role="chapter_art" src="${new URL(info.art, document.baseURI).href}">
        <div class="sc-name">${escapeHtml(e.name.toUpperCase())}</div>
        <div class="sc-story">${escapeHtml(info.text)}</div>
        <div class="sc-use"><b>FIND</b>${escapeHtml(info.search)}</div>
        <button class="stone big-btn green" data-act="ok">GO ON</button>`);
      this.game.audio.play('chapter', 'wood', 0.9);
    } else if (next.kind === 'talk') {
      // An officer speaks: their portrait, their name, a line.
      const t = JSON.parse(next.id) as { id: string; text: string; mood: TalkMood; last: boolean };
      const d = officer(t.id);
      if (!d) {
        this.closeStory();
        return;
      }
      const note = !t.last ? '' : t.mood === 'hello' ? d.errand ? `<div class="sc-use"><b>ERRAND</b>${escapeHtml(d.errand)}: ${escapeHtml(d.steps[0]?.text ?? '')}</div>` : '' : t.mood === 'joined' ? `<div class="sc-use"><b>${escapeHtml(d.perk.toUpperCase())}</b>${escapeHtml(d.perkText)}</div>` : '';
      this.storyModal.className = 'abs story-card talk';
      setHTML(this.storyModal, `
        <img class="sc-face" alt="" data-combos-asset-role="npc_portrait" src="${new URL(`npc/${d.id}.webp`, document.baseURI).href}">
        <div class="sc-name">${escapeHtml(d.name)}</div>
        <div class="sc-from">${escapeHtml(d.title)}</div>
        <div class="sc-story">${t.text.startsWith('"') ? escapeHtml(t.text) : `“${escapeHtml(t.text)}”`}</div>
        ${note}
        <button class="stone big-btn green" data-act="ok">${t.last ? 'FAREWELL' : 'GO ON'}</button>`);
      this.game.audio.play('page', 'wood', 0.6);
    } else if (next.kind === 'curio') {
      // A curio for the cabinet.
      const c = curioOf(next.id);
      if (!c) {
        this.closeStory();
        return;
      }
      const set = c.land >= 0 ? CURIOS.filter((x) => x.land === c.land) : [];
      const have = set.filter((x) => g.curios.has(x.id)).length;
      this.storyModal.className = 'abs story-card relic';
      setHTML(this.storyModal, `
        <div class="sc-head">CURIO FOUND · ${g.curios.size}/${CURIOS.length}</div>
        <img class="sc-curio" alt="" data-combos-asset-role="curio_art" src="${new URL(curioArt(c.id), document.baseURI).href}">
        <div class="sc-name">${escapeHtml(c.name)}</div>
        <div class="sc-story">${escapeHtml(c.text)}</div>
        ${c.land >= 0 ? `<div class="sc-note">${escapeHtml(CABINET[c.land]!.name)} · ${have}/${set.length} · ${escapeHtml(CABINET[c.land]!.perk)}</div>` : ''}
        <button class="stone big-btn green" data-act="ok">INTO THE CABINET</button>`);
    } else if (next.kind === 'crest') {
      // A crest won: the crest, and the log its captain left with it.
      const i = Number(next.id);
      const info = EXPEDITIONS[i];
      const log = logPage(i);
      if (!info) {
        this.closeStory();
        return;
      }
      const seal = g.world.terrain.seals[i];
      this.storyModal.className = 'abs story-card relic';
      setHTML(this.storyModal, `
        <div class="sc-head">STRIDER CREST RECOVERED · ${g.mq.crests.length}/${EXPEDITIONS.length}</div>
        <div class="sc-icon"><img alt="" src="${iconURL(info.icon)}"></div>
        <div class="sc-name">${escapeHtml(info.crest)}</div>
        <div class="sc-from">${escapeHtml(info.captain)}</div>
        ${log ? `<div class="sc-story">“${escapeHtml(log.text)}”</div>` : ''}
        ${seal ? `<div class="sc-use"><b>KEY</b>The ${escapeHtml(seal.name)} will answer to it now</div>` : ''}
        <button class="stone big-btn green" data-act="ok">TAKE IT</button>`);
    } else {
      const p = page(next.id);
      if (!p) {
        this.closeStory();
        return;
      }
      const n = this.game.journal.size;
      this.storyModal.className = 'abs story-card page';
      setHTML(this.storyModal, `
        <div class="sc-head"><img alt="" src="${iconURL('journal_item')}">BUILDERS' JOURNAL · ${n}/${journalOf(g.world.terrain.version).length}</div>
        <div class="sc-title">${escapeHtml(p.title)}</div>
        <div class="sc-text">${escapeHtml(p.text)}</div>
        <div class="sc-note">Kept in your journal (pause menu)</div>
        <button class="stone big-btn" data-act="ok">CLOSE</button>`);
      this.game.audio.play('page', 'wood', 0.9);
    }
    this.storyModal.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      this.game.audio.play('click');
      this.closeStory();
    });
    this.storyModal.classList.remove('hidden');
    // (A picture still on its way changes the card's height: it re-centres when it lands.)
    for (const img of this.storyModal.querySelectorAll('img')) if (!img.complete) img.addEventListener('load', () => this.layout(), { once: true });
    this.layout();
  }

  /** Keyboard: Enter / Space / E / Esc put the story card away. */
  dismissStory(): void {
    if (!this.storyOpen) return;
    this.game.audio.play('click');
    this.closeStory();
  }

  private closeStory(): void {
    if (this.storyQueue.length > 0) {
      this.nextStory();
      return;
    }
    this.storyOpen = false;
    this.storyModal.classList.add('hidden');
    const prev = this.storyPrev;
    this.storyPrev = 'none';
    if (prev === 'none' || prev === 'story') {
      this.closeModals();
      return;
    }
    this.game.modal = prev;
    if (prev === 'village') this.renderVillage();
  }

  /** The journal, a tab at a time: the quests, the company, the cabinet, the bestiary, the Builders' pages. */
  private journalTab: 'quests' | 'crew' | 'curios' | 'beasts' | 'pages' = 'quests';

  openJournal(tab = this.journalTab): void {
    const g = this.game;
    if (!g.isPlaying() && g.modal !== 'pause') return;
    g.modal = 'pause';
    g.paused = true;
    this.releaseInputs();
    this.onSuspendPlay?.();
    this.journalTab = tab;
    const T = g.world.terrain;
    const body = tab === 'quests' ? this.journalQuests() : tab === 'crew' ? this.journalCrew() : tab === 'curios' ? this.journalCurios() : tab === 'beasts' ? this.journalBeasts() : this.journalPages();
    const tabs: Array<[typeof tab, string]> = T.version >= 2
      ? [['quests', 'QUESTS'], ['crew', 'CREW'], ['curios', 'CURIOS'], ['beasts', 'BEASTS'], ['pages', 'PAGES']]
      : [['pages', 'PAGES']];
    setHTML(this.journalModal, `
      <h2><span>JOURNAL</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      ${tabs.length > 1 ? `<div class="jr-tabs">${tabs.map(([id, label]) => `<button class="stone jr-tab${id === tab ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>` : ''}
      <div class="scroll">${body}</div>`);
    this.journalModal.querySelectorAll<HTMLElement>('[data-tab]').forEach((n) => n.addEventListener('click', () => {
      this.game.audio.play('page', 'wood', 0.6);
      this.openJournal(n.dataset.tab as typeof tab);
    }));
    this.journalModal.querySelectorAll<HTMLElement>('[data-land]').forEach((n) => n.addEventListener('click', () => {
      this.game.audio.play('click');
      this.closeModals();
      this.story('chapter', n.dataset.land ?? '0');
    }));
    this.journalModal.querySelector('.close')?.addEventListener('click', () => this.closeModals());
    for (const m of [this.pauseModal, this.craftModal, this.mapModal, this.villageModal, this.guideModal]) m.classList.add('hidden');
    this.game.audio.play('page', 'wood', 0.7);
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.journalModal.classList.remove('hidden');
    this.layout();
    for (const b of this.journalModal.querySelectorAll<HTMLElement>('.jr-tab')) fitLabel(b);
  }

  /** The main quest chapter by chapter, and the errands under way. */
  private journalQuests(): string {
    const g = this.game;
    const T = g.world.terrain;
    const goal = mainObjective(g);
    const rows = EXPEDITIONS.map((e, i) => {
      const seal = T.seals[i];
      const won = g.sealsBroken.has(i);
      const crest = g.mq.crests.includes(i);
      const now = chapterNow(g) === i;
      if (!now && !won && !crest) return `<div class="jr-relic missing"><img alt="" src="${iconURL('seal_crystal')}"><div><b>${i + 1}. ???</b><small>Further down the road</small></div></div>`;
      return `<div class="jr-relic${now ? ' now' : ''}"><img alt="" src="${iconURL(crest ? e.icon : 'seal_crystal')}"><div><b>${i + 1}. ${escapeHtml(e.chapter)}</b><small>${crest ? `${escapeHtml(e.crest)} ✓` : escapeHtml(e.find)}${seal ? ` · ${escapeHtml(seal.name)}${won ? ' ✓' : ''}` : ''}</small></div></div>`;
    }).join('');
    const last = `<div class="jr-relic${chapterNow(g) >= EXPEDITIONS.length ? ' now' : ' missing'}"><img alt="" src="${iconURL('builders_key')}"><div><b>7. The Heart</b><small>${g.mq.key ? 'The Builders\' Key is forged ✓' : 'The six crests must be reforged at the Builders\' Forge'}</small></div></div>`;
    const list = errands(g).map((e) => `<div class="jr-relic"><img class="jr-face" alt="" src="${new URL(`npc/${e.d.id}.webp`, document.baseURI).href}"><div><b>${escapeHtml(e.d.errand)}</b><small>${escapeHtml(e.d.name)}: ${escapeHtml(e.text)}</small></div></div>`).join('');
    return `${goal ? `<div class="jr-goal"><b>${escapeHtml(goal.tag)}</b>${escapeHtml(goal.text)}</div>` : ''}
      <div class="section-label">THE ELEVEN · CRESTS ${g.mq.crests.length}/${EXPEDITIONS.length}</div>${rows}${last}
      <div class="section-label">ERRANDS</div>${list || '<div class="help">Nobody needs anything from you right now. Talk to the folk with a gold mark over their heads.</div>'}`;
  }

  /** The twelve officers: who is aboard, who is still out there. */
  private journalCrew(): string {
    const g = this.game;
    const T = g.world.terrain;
    return OFFICERS.map((d) => {
      const s = g.company[d.id];
      if (!s?.met) {
        const where = d.village >= 0 ? T.villages[d.village]?.name : d.village === -2 ? 'the Outlaw Fort' : 'your deck';
        return `<div class="jr-relic missing"><img class="jr-face dark" alt="" src="${new URL(`npc/${d.id}.webp`, document.baseURI).href}"><div><b>???</b><small>Somewhere near ${escapeHtml(where ?? '?')}</small></div></div>`;
      }
      return `<div class="jr-relic"><img class="jr-face" alt="" src="${new URL(`npc/${d.id}.webp`, document.baseURI).href}"><div><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.title)}${s.done ? ` · ${escapeHtml(d.perk)}: ${escapeHtml(d.perkText)}` : ` · ${escapeHtml(d.errand)}`}</small></div></div>`;
    }).join('') + `<div class="help">Officers aboard: ${OFFICERS.filter((d) => hasOfficer(g, d.id)).length}/${OFFICERS.length}. Each brings a skill the fortress did not have.</div>`;
  }

  /** The cabinet: each land's curios, and what the set gives. */
  private journalCurios(): string {
    const g = this.game;
    const groups = CABINET.map((set, land) => {
      const list = CURIOS.filter((c) => c.land === land);
      const cells = list.map((c) => (g.curios.has(c.id)
        ? `<div class="cu-cell" title="${escapeHtml(c.name)}"><img alt="" src="${new URL(curioArt(c.id), document.baseURI).href}"><small>${escapeHtml(c.name)}</small></div>`
        : '<div class="cu-cell missing"><i>?</i></div>')).join('');
      return `<div class="section-label">${escapeHtml(set.name.toUpperCase())} · ${list.filter((c) => g.curios.has(c.id)).length}/${list.length}</div>
        <div class="help">${setDone(g, land) ? '✓ ' : ''}${escapeHtml(set.perk)}</div>
        <div class="cu-grid">${cells}</div>`;
    }).join('');
    const cog = g.curios.has('twelfth_cog') ? `<div class="section-label">THE LAST OF ALL</div><div class="cu-grid"><div class="cu-cell"><img alt="" src="${new URL(curioArt('twelfth_cog'), document.baseURI).href}"><small>${escapeHtml(curioOf('twelfth_cog')?.name ?? '')}</small></div></div>` : '';
    return `<div class="help">Thirty-five curios lie in lost stashes off the trail, five to a land.${hasOfficer(g, 'wren') ? ' Wren marks the stashes on your map.' : ' Wren Tallow of Millford could mark them on your map.'}</div>${groups}${cog}`;
  }

  /** What has fallen, how many, and what the crew knows of it. */
  private journalBeasts(): string {
    const g = this.game;
    const seen = BESTIARY.filter((b) => (g.bestiary[b.kind] ?? 0) > 0).length;
    const rows = BESTIARY.map((b) => {
      const n = g.bestiary[b.kind] ?? 0;
      if (n === 0) return '<div class="jr-relic missing"><div><b>???</b><small>Not yet met</small></div></div>';
      return `<div class="jr-relic"><div><b>${escapeHtml(b.name)} · ${n}</b><small>${escapeHtml(b.text)}</small></div></div>`;
    }).join('');
    return `<div class="section-label">BESTIARY · ${seen}/${BESTIARY.length}</div>${rows}`;
  }

  /** The Builders' pages, the lands, the guardians' trophies, the relics. */
  private journalPages(): string {
    const g = this.game;
    const pc = this.inputMode === 'desktop';
    const relics = (Object.keys(RELICS) as RelicId[]).filter((id) => g.relics.has(id)).map((id) => {
      const r = RELICS[id];
      return `<div class="jr-relic"><img alt="" src="${iconURL(r.icon)}"><div><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.use(pc))}</small></div></div>`;
    }).join('') || '<div class="help">None yet: help the villages and they will entrust you with their relics.</div>';
    const all = journalOf(g.world.terrain.version);
    const pages = all.map((p, i) => g.journal.has(p.id)
      ? `<div class="jr-page"><b>${i + 1}. ${escapeHtml(p.title)}</b><p>${escapeHtml(p.text)}</p></div>`
      : `<div class="jr-page missing"><b>${i + 1}. — a missing page —</b></div>`).join('');
    const stones = g.heartstones > 0 ? `<div class="help">Heartstones in your Engine Core: ${g.heartstones} (health ${g.coreHp().max})</div>` : '';
    // The Long March's lands: each one entered, with its picture (tap to read its card again).
    const T = g.world.terrain;
    const lands = T.version >= 2 ? T.regions.map((r, i) => {
      const seen = g.regionsSeen.has(i) || i === 0;
      const ch = CHAPTERS[r.zone];
      if (!seen || !ch) return `<div class="jr-land missing"><b>${i + 1}. ???</b><small>Beyond a Heart Seal</small></div>`;
      const sealed = T.seals[i] && !g.sealsBroken.has(i) ? ' · seal standing' : T.seals[i] ? ' · seal broken' : '';
      return `<button class="jr-land" data-land="${i}"><img alt="" data-combos-asset-role="chapter_art" src="${new URL(ch.art, document.baseURI).href}"><b>${i + 1}. ${escapeHtml(r.name)}</b><small>${escapeHtml(ch.foes)}${sealed}</small></button>`;
    }).join('') : '';
    // The guardians' trophies: the powers the fortress carries for each seal broken.
    const trophies = T.seals.map((s) => {
      const t = TROPHIES[s.guardian];
      if (!g.sealsBroken.has(s.index)) return `<div class="jr-relic missing"><img alt="" src="${iconURL('seal_crystal')}"><div><b>???</b><small>Held by ${escapeHtml(GUARDIANS[s.guardian].name)} at the ${escapeHtml(s.name)}</small></div></div>`;
      return `<div class="jr-relic"><img alt="" src="${iconURL(t.icon)}"><div><b>${escapeHtml(t.name)}</b><small>${escapeHtml(t.perk)}</small></div></div>`;
    }).join('');
    return `${lands ? `<div class="section-label">THE SEVEN LANDS</div><div class="jr-lands">${lands}</div>` : ''}
      ${trophies ? `<div class="section-label">GUARDIANS' TROPHIES · ${g.sealsBroken.size}/${T.seals.length}</div>${trophies}` : ''}
      <div class="section-label">RELICS</div>
      ${relics}
      ${stones}
      <div class="section-label">THE BUILDERS' PAGES · ${g.journal.size}/${all.length}</div>
      ${pages}`;
  }

  /** Feats: every playful thing worth trying, the ones earned ticked off (counted ones show progress). */
  openFeats(): void {
    const g = this.game;
    if (!g.isPlaying() && g.modal !== 'pause') return;
    g.modal = 'pause';
    g.paused = true;
    this.releaseInputs();
    this.onSuspendPlay?.();
    const { done, total } = featCount();
    const rows = FEATS.map((f) => {
      const ok = featDone(f.id);
      const n = featProgress(f.id);
      const progress = !ok && f.goal && f.goal > 1 ? `<em>${n}/${f.goal}</em>` : '';
      return `<div class="ft-row${ok ? ' done' : ''}"><img alt="" src="${iconURL(f.icon)}"><div><b>${escapeHtml(f.title)}</b><small>${escapeHtml(f.text)}</small></div>${ok ? '<i>★</i>' : progress}</div>`;
    }).join('');
    setHTML(this.featsModal, `
      <h2><span>FEATS · ${done}/${total}</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="scroll">
        <div class="help">Little things worth trying out in the valley. Earned for good, across every game.</div>
        ${rows}
      </div>`);
    this.featsModal.querySelector('.close')?.addEventListener('click', () => this.closeModals());
    for (const m of [this.pauseModal, this.craftModal, this.mapModal, this.villageModal, this.guideModal, this.journalModal]) m.classList.add('hidden');
    this.game.audio.play('click');
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.featsModal.classList.remove('hidden');
    this.layout();
  }

  /** A village's trader: its quest, its trust, and supplies for emeralds. */
  openVillage(index: number): void {
    const g = this.game;
    if (!g.isPlaying()) return;
    const q = questInfo(g, index);
    if (!q) return;
    g.modal = 'village';
    this.villageIndex = index;
    this.tradeNote = null;
    this.releaseInputs();
    this.onSuspendPlay?.();
    this.renderVillage();
    this.game.audio.play('click');
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.villageModal.classList.remove('hidden');
    this.layout();
  }

  /** The wandering trader's window (in the village window's place; villageIndex -1). */
  openWanderer(): void {
    const g = this.game;
    if (!g.isPlaying()) return;
    g.modal = 'village';
    this.villageIndex = -1;
    this.tradeNote = null;
    this.releaseInputs();
    this.onSuspendPlay?.();
    this.renderVillage();
    this.game.audio.play('click');
    this.setMode('modal');
    this.backdrop.classList.remove('hidden');
    this.villageModal.classList.remove('hidden');
    this.layout();
  }

  private renderWanderer(): void {
    const g = this.game;
    const gems = g.count(I.EMERALD);
    const rows = wandererStock(g).map((t) => {
      const price = priceOf(g, t.price);
      const can = gems >= price;
      return `<div class="trade">
        <img alt="" src="${iconURL(t.icon)}"><div class="info">${escapeHtml(t.label)}</div>
        <button class="stone trade-btn${can ? '' : ' off'}" data-trade="${t.id}"><img alt="" src="${iconURL('emerald')}">${price}</button>
      </div>`;
    }).join('');
    setHTML(this.villageModal, `
      <h2><span>WANDERING TRADER</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="scroll">
        <img class="wander-art" alt="" data-combos-asset-role="trader_art" src="${artURL('trader')}">
        <div class="elder"><img alt="" src="${iconURL('ui_villager')}"><p>“Rare things from far down the valley, Captain. I move on at dusk: see what you like.”</p></div>
        <div class="section-label">TODAY'S WARES · YOU HAVE <img class="gem" alt="" src="${iconURL('emerald')}"> ${gems}</div>
        ${this.tradeNote ? `<div class="trade-note${this.tradeNote.ok ? '' : ' bad'}">${this.tradeNote.ok ? '✓' : '✗'} ${escapeHtml(this.tradeNote.note)}</div>` : ''}
        ${rows}
      </div>`);
    this.villageModal.querySelector('.close')?.addEventListener('click', () => this.closeModals());
    this.villageModal.querySelectorAll<HTMLButtonElement>('[data-trade]').forEach((button) => {
      button.addEventListener('click', () => {
        const r = g.trade('buy', button.dataset.trade!);
        if (r.note) this.tradeNote = r;
        this.renderVillage();
      });
    });
  }

  private renderVillage(): void {
    const g = this.game;
    if (this.villageIndex < 0) {
      this.renderWanderer();
      return;
    }
    const q = questInfo(g, this.villageIndex);
    if (!q) return;
    const state = g.questState[q.index];
    const relic = questRelic(g.world.terrain.version, q.index);
    const gems = g.count(I.EMERALD);
    const status = state === 'claimed' ? '<span class="ok">✓ Done</span>' : state === 'done' ? '<span class="gold">Reward waiting</span>' : '<span>Under way</span>';
    const give = state === 'done' && q.kind === 'fetch' && g.count(I.STRONGBOX) > 0 ? '<button class="stone big-btn small green" data-act="give">GIVE THE STRONGBOX</button>' : '';
    const trust = trusts(g, q.village)
      ? `<div class="trust ok">${escapeHtml(q.village.name)} trusts you: its buildings may be hoisted.</div>`
      : `<div class="trust">Help ${escapeHtml(q.village.name)} and its people will let your crane take their buildings.</div>`;
    const rows = TRADES.map((t) => {
      const price = priceOf(g, t.price);
      const can = gems >= price && !(t.id === 'bunk' && g.extraBunks >= 3);
      return `<div class="trade">
        <img alt="" src="${iconURL(t.icon)}"><div class="info">${escapeHtml(t.label)}</div>
        <button class="stone trade-btn${can ? '' : ' off'}" data-trade="${t.id}"><img alt="" src="${iconURL('emerald')}">${price}</button>
      </div>`;
    }).join('');
    // Parts for the crane, fitted once and kept.
    const parts = CRANE_PARTS.map((p) => {
      const fitted = g.craneParts.includes(p.id);
      const can = !fitted && gems >= p.gems && g.count(I.IRON_INGOT) >= p.iron;
      const price = fitted ? '✓' : `<img alt="" src="${iconURL('emerald')}">${p.gems}${p.iron ? `+${p.iron}<img alt="" src="${iconURL('iron_ingot')}">` : ''}`;
      return `<div class="trade">
        <img alt="" src="${iconURL(p.icon)}"><div class="info">${escapeHtml(p.label)}<small>${escapeHtml(p.perk)}</small></div>
        <button class="stone trade-btn${can ? '' : ' off'}" data-part="${p.id}">${price}</button>
      </div>`;
    }).join('');
    const upgrades = g.cargo.map((c, i) => {
      const perk = UPGRADE_PERK[c.kind];
      if (!perk) return '';
      const level = c.level ?? 1;
      const cost = upgradeCost(level);
      const max = level >= 3;
      const can = !max && gems >= cost.gems && g.count(I.IRON_INGOT) >= cost.iron;
      return `<div class="trade">
        <img alt="" src="${iconURL('ui_hammer')}"><div class="info">${escapeHtml(HOIST_INFO[c.kind]?.label ?? c.kind)} · Lv ${level}<small>${escapeHtml(perk)}</small></div>
        <button class="stone trade-btn${can ? '' : ' off'}" data-up="${i}">${max ? 'MAX' : `<img alt="" src="${iconURL('emerald')}">${cost.gems}+${cost.iron}<img alt="" src="${iconURL('iron_ingot')}">`}</button>
      </div>`;
    }).join('');
    setHTML(this.villageModal, `
      <h2><span>${escapeHtml(q.village.name.toUpperCase())}</span><button class="stone close" aria-label="Close">&#x2715;</button></h2>
      <div class="scroll">
        <div class="elder"><img alt="" src="${iconURL('ui_villager')}"><p>“${escapeHtml(elderLine(q.index, state ?? 'active', g.world.terrain.version))}”</p></div>
        <div class="section-label">QUEST · ${escapeHtml(q.title.toUpperCase())}</div>
        <div class="quest-box"><div>${escapeHtml(q.task)}.</div><small>Reward: ${q.reward} emeralds${relic ? `, ${escapeHtml(RELICS[relic].name)}` : ''} and the village's trust · ${status}</small></div>
        ${give}
        ${trust}
        <div class="section-label">TRADER · YOU HAVE <img class="gem" alt="" src="${iconURL('emerald')}"> ${gems}</div>
        ${this.tradeNote ? `<div class="trade-note${this.tradeNote.ok ? '' : ' bad'}">${this.tradeNote.ok ? '✓' : '✗'} ${escapeHtml(this.tradeNote.note)}</div>` : ''}
        ${rows}
        <div class="section-label">CRANE WORKS</div>
        ${parts}
        ${upgrades ? `<div class="section-label">UPGRADE YOUR BUILDINGS · IRON ${g.count(I.IRON_INGOT)}</div>${upgrades}` : ''}
      </div>`);
    this.villageModal.querySelector('.close')?.addEventListener('click', () => this.closeModals());
    this.villageModal.querySelector('[data-act="give"]')?.addEventListener('click', () => {
      g.trade('turnin', q.index);
      this.renderVillage();
    });
    this.villageModal.querySelectorAll<HTMLButtonElement>('[data-part]').forEach((button) => {
      button.addEventListener('click', () => {
        const scroll = this.villageModal.querySelector('.scroll')!.scrollTop;
        const r = g.trade('crane', button.dataset.part!);
        if (r.note) this.tradeNote = r;
        this.renderVillage();
        this.villageModal.querySelector('.scroll')!.scrollTop = scroll;
      });
    });
    this.villageModal.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((button) => {
      button.addEventListener('click', () => {
        const scroll = this.villageModal.querySelector('.scroll')!.scrollTop;
        g.trade('upgrade', Number(button.dataset.up));
        this.renderVillage();
        this.villageModal.querySelector('.scroll')!.scrollTop = scroll;
      });
    });
    this.villageModal.querySelectorAll<HTMLButtonElement>('[data-trade]').forEach((button) => {
      button.addEventListener('click', () => {
        const scroll = this.villageModal.querySelector('.scroll')!.scrollTop;
        const r = g.trade('buy', button.dataset.trade!);
        // (In co-op the host answers a moment later: see tradeResult.)
        if (r.note) this.tradeNote = r;
        this.renderVillage();
        this.villageModal.querySelector('.scroll')!.scrollTop = scroll;
      });
    });
  }

  /** Co-op guest: what a purchase made on the host came to. */
  tradeResult(ok: boolean, note: string): void {
    if (this.villageModal.classList.contains('hidden')) return;
    this.tradeNote = { ok, note };
    const scroll = this.villageModal.querySelector('.scroll')?.scrollTop ?? 0;
    this.renderVillage();
    const sc = this.villageModal.querySelector('.scroll');
    if (sc) sc.scrollTop = scroll;
  }

  /** What the last purchase did (shown in the trader's window, where toasts cannot be seen). */
  private tradeNote: { ok: boolean; note: string } | null = null;
  private lastHelm = '';
  private helmShown = false;
  private promptSpots = { normal: 0, x: 0, w: 0 };
  private promptAtHelm = false;

  /** Where the fortress is walking to: an arrow turned towards it (relative to the bow), its name and distance. */
  /** Where the crew walks the fortress: which way off its bow (in 15° steps), the place and how far. */
  private course(): { deg: number; text: string; name: string; dist: string } | null {
    const g = this.game;
    const a = g.autopilot;
    if (!a) return null;
    const F = g.fortress;
    const c = g.fortressCentre();
    const d = Math.round(Math.hypot(a.x - c[0], a.z - c[2]));
    let rel = Math.atan2(a.z - c[2], a.x - c[0]) - F.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const deg = Math.round((rel * 180) / Math.PI / 15) * 15;
    const name = a.site?.name ?? 'MARK';
    return { deg, text: `${name} ${d}m`, name, dist: `${d}m` };
  }

  /** The fortress board's pieces (built once; again if the fortress grows or loses a leg). */
  private fortParts(legCount: number): FortParts {
    let d = this.fortDom;
    if (!d || d.legs.length !== legCount || !this.fortPanel.contains(d.bar)) {
      setHTML(this.fortPanel, `<div class="row"><span class="lab name">${FORT_GLYPH}<b></b></span><div class="meter fort"><i></i></div><span class="val"></span></div><div class="row"><span class="lab pw">${POWER_GLYPH}<b></b></span><span class="gems"><img alt="" src="${iconURL('emerald')}"><span></span></span><span class="legs"><span></span>${'<i></i>'.repeat(legCount)}</span></div>`);
      const rows = this.fortPanel.querySelectorAll('.row');
      d = {
        name: rows[0]!.querySelector('.name > b')!,
        meter: rows[0]!.querySelector('.meter')!,
        bar: rows[0]!.querySelector('.meter > i')!,
        val: rows[0]!.querySelector('.val')!,
        power: rows[1]!.querySelector('.pw > b')!,
        powerLab: rows[1]!.querySelector('.pw')!,
        gems: rows[1]!.querySelector('.gems > span')!,
        legsWord: rows[1]!.querySelector('.legs > span')!,
        legs: [...rows[1]!.querySelectorAll<HTMLElement>('.legs > i')],
      };
      this.fortDom = d;
    }
    return d;
  }

  private fortDom: FortParts | null = null;
  /** The width the fortress board was placed at. */
  private boardW = 262;

  /** The day strip's pieces (built once). */
  private dayParts(): { when: HTMLElement; clock: HTMLElement; course: HTMLElement; arrow: SVGElement; place: HTMLElement } {
    let d = this.dayDom;
    if (!d || !this.dayPill.contains(d.when)) {
      setHTML(this.dayPill, '<span class="when"></span><em class="hidden"></em><span class="course hidden"><svg viewBox="0 0 10 10"><polygon points="5,0 9,9 5,7 1,9" fill="#ffd23a"/></svg><span></span></span>');
      d = {
        when: this.dayPill.querySelector('.when')!,
        clock: this.dayPill.querySelector('em')!,
        course: this.dayPill.querySelector('.course')!,
        arrow: this.dayPill.querySelector('svg')!,
        place: this.dayPill.querySelector('.course > span')!,
      };
      this.dayDom = d;
    }
    return d;
  }

  private dayDom: { when: HTMLElement; clock: HTMLElement; course: HTMLElement; arrow: SVGElement; place: HTMLElement } | null = null;

  /** The hearts, the hunger and the experience bar (built once). */
  private vitalParts(): { hearts: HTMLElement; food: HTMLElement; imgs: HTMLImageElement[]; icons: string[]; bar: HTMLElement; level: HTMLElement } {
    let d = this.vitalDom;
    if (!d || !this.vitals.contains(d.bar)) {
      setHTML(this.vitals, `<div class="bars"><div class="hearts">${'<img alt="">'.repeat(10)}</div><div class="food">${'<img alt="">'.repeat(10)}</div></div><div class="xp"><div class="xpbar"><i></i></div><b></b></div>`);
      d = {
        hearts: this.vitals.querySelector('.hearts')!,
        food: this.vitals.querySelector('.food')!,
        imgs: [...this.vitals.querySelectorAll<HTMLImageElement>('.hearts img'), ...this.vitals.querySelectorAll<HTMLImageElement>('.food img')],
        icons: [],
        bar: this.vitals.querySelector('.xpbar > i')!,
        level: this.vitals.querySelector('.xp b')!,
      };
      this.vitalDom = d;
    }
    return d;
  }

  private vitalDom: { hearts: HTMLElement; food: HTMLElement; imgs: HTMLImageElement[]; icons: string[]; bar: HTMLElement; level: HTMLElement } | null = null;

  /** At the helm: heading, speed, the boiler and the course (the crew's walking shows on the day strip). */
  private refreshHelm(): void {
    const g = this.game;
    const show = this.mode === 'play' && g.isPlaying() && g.helm;
    this.helmPanel.classList.toggle('hidden', !show);
    if (show !== this.helmShown) {
      this.helmShown = show;
      this.layout();
    }
    this.stick.classList.toggle('drive', this.mode === 'play' && g.helm);
    if (!show) return;
    const F = g.fortress;
    const names = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
    const heading = names[((Math.round(F.yaw / (Math.PI / 4)) % 8) + 8) % 8]!;
    const c = this.course();
    // (Short of room, the place's name gives way, never its distance.)
    const course = c ? `<span class="course"><svg viewBox="0 0 10 10" style="transform:rotate(${c.deg}deg)"><polygon points="5,0 9,9 5,7 1,9" fill="#ffd23a"/></svg><span class="cn">${escapeHtml(c.name)}</span><span class="cd" translate="no">${c.dist}</span></span>` : '';
    // The boiler: full steam burns it down, a rest refills it.
    const steam = Math.round(g.steam * 20) * 5;
    const gauge = `<span class="steam${g.boosting ? ' on' : steam < 15 ? ' low' : ''}"><em>♨</em><span class="meter"><i style="width:${steam}%"></i></span></span>`;
    const why = g.blockReason ? BLOCK_SHORT[g.blockReason] : '';
    const key = `${heading}|${Math.abs(g.speed).toFixed(1)}|${course}|${why}|${gauge}`;
    if (key === this.lastHelm) return;
    this.lastHelm = key;
    setHTML(this.helmPanel, `<b>HELM</b><span translate="no">${compass(heading)} ${Math.abs(g.speed).toFixed(1)}m/s</span>${gauge}${why ? `<span class="warn">${why}</span>` : course}`);
  }

  private refreshContext(force: boolean): void {
    const g = this.game;
    const playing = this.mode === 'play' && g.isPlaying();
    const manned = playing ? g.mannedCannon() : null;
    const showFire = Boolean(manned) && (g.phase === 'night' || g.helm);
    const leap = playing ? g.leapTarget() : null;
    const showLeap = Boolean(leap);
    const showMarch = playing && g.phase === 'day';
    const showMap = playing && !showMarch;
    let changed = force;
    const toggle = (node: HTMLElement, show: boolean): void => {
      if (node.classList.contains('hidden') === show) {
        node.classList.toggle('hidden', !show);
        changed = true;
      }
    };
    toggle(this.fireBtn, showFire || (Boolean(manned) && g.mobs.length > 0));
    // (At the helm and on the guns a press of the view fires: the attack button gives way.)
    this.attackBtn.classList.toggle('hidden', !playing || this.inputMode !== 'touch' || g.helm || g.gunner);
    const use = playing ? this.attackUse() : null;
    if (use !== this.attackShows) {
      this.attackShows = use;
      this.attackBtn.classList.toggle('use', use !== null);
      const img = this.attackBtn.querySelector<HTMLImageElement>('img.held')!;
      if (use !== null) img.src = iconURL(itemDef(use).icon);
      this.attackBtn.setAttribute('aria-label', use === null ? 'Attack / mine' : itemName(g, use));
    }
    // At the helm the jump button is the steam valve.
    const jumpIcon: keyof typeof JUMP_ICONS = playing && g.helm ? 'steam' : 'jump';
    if (jumpIcon !== this.jumpIcon) {
      this.jumpIcon = jumpIcon;
      setHTML(this.jumpBtn, JUMP_ICONS[jumpIcon]);
      this.jumpBtn.classList.toggle('steam', jumpIcon === 'steam');
      this.jumpBtn.setAttribute('aria-label', jumpIcon === 'steam' ? 'Full steam' : 'Jump / climb');
    }
    this.jumpBtn.classList.toggle('burning', jumpIcon === 'steam' && g.boosting);
    this.jumpBtn.classList.toggle('empty', jumpIcon === 'steam' && g.steam < 0.05);
    toggle(this.leapBtn, showLeap);
    // STOMP: at the helm, and anywhere aboard once monsters are about (it pulses, with a count,
    // while they are climbing the legs).
    const climbers = playing ? g.mobs.reduce((n, m) => n + (!m.dead && (m.climb || m.standingOn === g.fortress) ? 1 : 0), 0) : 0;
    const showStomp = playing && canStomp(g) && (g.helm || g.phase === 'night' || climbers > 0 || g.pound !== null);
    toggle(this.stompBtn, showStomp);
    if (showStomp) {
      const badge = climbers > 0 ? String(climbers) : '';
      const b = this.stompBtn.querySelector('.badge')!;
      setText(b, badge);
      this.stompBtn.classList.toggle('alert', climbers > 0 && g.poundCooldown <= 0 && !g.pound);
      this.stompBtn.classList.toggle('disabled', !g.pound && (g.steam < POUND_STEAM || g.poundCooldown > 0));
    }
    toggle(this.hornBtn, playing && g.relics.has('horn') && g.phase === 'night' && g.hornCharges > 0);
    toggle(this.marchBtn, showMarch);
    toggle(this.mapBtn, showMap);
    if (manned) {
      const s = g.fortress.cannons.get(manned.key);
      const kind = turretKind(g.fortress, manned.key);
      const tnt = usesTnt(kind);
      const ready = g.helm || ((kind === 'ballista' || g.fortress.poweredMachines.has(manned.key)) && (!tnt || (s?.ammo ?? 0) > 0 || g.count(I.TNT) > 0));
      this.fireBtn.classList.toggle('disabled', !ready);
      const span = this.fireBtn.querySelector('span')!;
      // (At the helm with a mate on the guns, it marks a target for them.)
      const label = g.helm && g.mateOnGuns() ? 'MARK' : g.helm || !tnt ? 'FIRE' : `FIRE ${s?.ammo ?? 0}/${MAGAZINE}`;
      if (setText(span, label)) this.fitOnce(this.fireBtn, (Number.parseFloat(this.fireBtn.style.width) || this.ctx.w) - 6);
    }
    if (leap) {
      const label = leap.back ? 'BACK' : 'LEAP';
      const span = this.leapBtn.querySelector('span')!;
      if (setText(span, label)) this.fitOnce(this.leapBtn, (Number.parseFloat(this.leapBtn.style.width) || this.ctx.w) - 6);
    }
    // The context prompt by the crosshair ("E  LOAD TNT"); at the helm it moves out of the view.
    if (g.helm !== this.promptAtHelm) changed = true;
    const action = playing ? g.context : null;
    const label = action?.label ?? '';
    if (label !== this.lastPrompt) {
      if (Boolean(label) !== Boolean(this.lastPrompt)) changed = true;
      // (Long in the player's language: "DEMASIADO LEJOS".)
      const long = letters(tr(label)) > 12;
      if (long !== this.prompt.classList.contains('long')) changed = true;
      this.lastPrompt = label;
      this.prompt.classList.toggle('hidden', !label);
      this.prompt.classList.toggle('long', long);
      setText((this.prompt.querySelector('span') as HTMLElement), label);
      // (On a phone the button is as wide as its words; on a desktop it moves with the helm.)
      changed = true;
    }
    if (changed) this.layoutContext();
  }

  // ------------------------------------------------------------------ layout

  /** The view's size (at the last layout). */
  private vw = 393;
  private vh = 852;

  layout(): void {
    // (Anything written since the last pass is translated before it is measured.)
    flushText();
    const snapshot = this.contract?.getSnapshot();
    const vw = this.root.clientWidth || window.innerWidth;
    const vh = this.root.clientHeight || window.innerHeight;
    this.vw = vw;
    this.vh = vh;
    this.coach.vw = vw;
    this.spots.clear();
    const safe = snapshot?.safe_rect ?? { x: 12, y: 12, width: vw - 24, height: vh - 24 };
    this.safe = safe;
    const W = safe.width;
    const H = safe.height;
    const right = safe.x + W;
    const bottom = safe.y + H;
    const narrow = W < 300;
    const short = H < 520;
    this.short = short;
    this.root.classList.toggle('narrow', narrow);
    this.root.classList.toggle('short', short);
    const gap = 6;
    const desktop = this.inputMode === 'desktop';

    // Top left, one compact cluster: the fortress board (pause beside it), the day strip under it
    // (with where the crew is walking you), the helm strip under that while you steer. Portrait
    // screens keep it in the corner of the safe column; wide ones (landscape phones, desktop
    // windows) put it in the corner of the whole view, with the cards down the left edge and the
    // boss bars top centre, so the middle of the view stays clear.
    const ins = surfaceInsets();
    const fx = Math.max(12, ins.left + 10);
    const fy = Math.max(10, ins.top + 8);
    const frame = { x: fx, y: fy, w: vw - fx - Math.max(12, ins.right + 10), h: vh - fy - Math.max(10, ins.bottom + 8) };
    this.frame = frame;
    const wide = vw > vh && frame.w - W >= 240;
    this.wide = wide;
    this.root.classList.toggle('wide', wide);
    // (A thumb's 44px; the same under a mouse.)
    const pause = 44;
    const phone = !desktop;
    const reserve = vw - right < 64 ? Math.min(64, Math.round(W * 0.17)) : 0;
    const top = wide ? Math.min(frame.y, safe.y) : safe.y;
    // On a phone the board is one slim line and the day strip a second under it, the two beside the
    // pause button and no taller than it; on a desktop the board is as tall as the button, the strip
    // under both.
    // (Lying sideways a phone's board takes what there is up to the safe column, within reason.)
    const boardMax = phone ? (wide ? clamp(safe.x - 6 - frame.x, 214, 250) : 214) : 262;
    let boardX = wide ? frame.x : safe.x + pause + 6;
    // The view button stands beside the pause button (wide, after it; upright, at the end of the
    // boards' row).
    let boardW = wide ? boardMax : Math.min(right - reserve - boardX - pause - 6, boardMax);
    // (The pause and view buttons, controls, always keep inside the safe column.)
    let pauseX = wide ? Math.max(safe.x, boardX + boardW + 6) : safe.x;
    const buttonsW = wide ? pause * 2 + 6 : pause;
    if (pauseX + buttonsW > right) {
      pauseX = right - buttonsW;
      if (wide && boardX + boardW + 6 > pauseX) boardW = Math.max(150, pauseX - 6 - boardX);
    }
    const viewX = wide ? pauseX + pause + 6 : boardX + boardW + 6;
    place(this.pauseBtn, pauseX, top, pause, pause);
    place(this.viewBtn, viewX, top, pause, pause);
    const boardH = phone ? 22 : pause;
    place(this.fortPanel, boardX, top, boardW, boardH);
    this.boardW = boardW;
    const lineX = wide ? boardX : safe.x;
    const lineW = wide ? boardW : boardW + pause + 6;
    const dayY = phone ? top + boardH + 2 : top + pause + 4;
    const lineH = phone ? 20 : 24;
    place(this.dayPill, phone ? boardX : lineX, dayY, phone ? boardW : lineW, lineH);
    let stackY = Math.max(top + pause, dayY + lineH) + 4;
    // (At the helm its strip says more: lying sideways it may reach in under the pause button,
    // upright across the column.)
    const helmW = phone ? (wide ? clamp(pauseX + pause - boardX, boardW, 300) : Math.max(lineW, right - reserve - lineX)) : lineW;
    place(this.helmPanel, lineX, stackY, helmW, lineH);
    if (this.helmShown) stackY += lineH + 4;
    place(this.coopStrip, lineX, stackY, helmW, lineH);
    if (this.coopShown) stackY += lineH + 4;
    this.clusterBottom = stackY;
    this.clusterRight = Math.max(lineX + helmW, viewX + pause);
    // Off the safe column the boards are information only (the column keeps every control).
    for (const node of [this.fortPanel, this.dayPill]) {
      if (wide) node.setAttribute('data-combos-ui-critical', 'false');
      else node.removeAttribute('data-combos-ui-critical');
    }
    this.cardTop = stackY + 2;
    // (A card as wide as its words want, never a wall across the view: a third of a phone lying
    // sideways, a quarter of a desktop window, the column of a phone held upright.)
    this.cardW = wide ? (desktop ? clamp(Math.round(frame.w * 0.25), 290, 330) : clamp(Math.round(frame.w * 0.36), 236, 290)) : Math.min(W, desktop ? 400 : 360);
    this.lastFort = '';
    this.lastDay = '';
    this.lastVitals = '';
    this.refreshHud();

    // Bottom: touch sticks, the hotbar above, vitals above that. On a phone the thumbs get the real
    // corners of the view, inside the device's insets: the stick left, jump and attack right, and
    // lying sideways the hotbar sits between them along the bottom edge.
    const touch = !desktop;
    const lying = touch && vw > vh;
    const padL = lying ? frame.x : safe.x;
    const padR = lying ? frame.x + frame.w : right;
    const padB = touch ? frame.y + frame.h : bottom;
    // (Sized for a thumb, not for the screen: a bigger phone gets a little more, never a wall of
    // buttons over the view.)
    const jump = touch ? clamp(Math.round(lying ? vh * 0.165 : W * 0.17), 54, 68) : short ? 52 : Math.max(56, Math.min(72, Math.round(W * 0.18)));
    const blow = Math.round(jump * 0.86);
    // (The stick is smaller than the thumb's reach: the whole lower left brings it under the thumb.)
    const stickSize = touch ? clamp(Math.round(lying ? vh * 0.29 : W * 0.31), 96, 120) : Math.max(80, Math.min(short ? 104 : 128, W - jump - 10, Math.round(W * (short ? 0.5 : 0.34))));
    this.stickHome = { x: padL, y: padB - stickSize, size: stickSize };
    if (this.stickPointer === null) this.restStick();
    place(this.jumpBtn, padR - jump, padB - jump, jump, jump);
    place(this.attackBtn, padR - jump - blow - 6, padB - blow - Math.round(jump * 0.22), blow, blow);
    const hotGap = narrow ? 3 : touch ? 4 : 5;
    // Lying sideways: what is left between the thumbs.
    const barL = padL + stickSize + 8;
    const barR = padR - jump - blow - 14;
    const barW = lying ? barR - barL : W;
    const wanted = desktop ? 9 : lying ? 8 : 7;
    let slot = Math.min(lying ? 44 : touch ? 46 : 48, Math.floor((barW - (wanted - 1) * hotGap) / wanted));
    let count = wanted;
    if (slot < 44) {
      slot = 44;
      count = Math.max(3, Math.floor((barW + hotGap) / (slot + hotGap)));
    }
    this.slotCount = count;
    const hotbarY = desktop ? bottom - slot : lying ? padB - slot : padB - Math.max(stickSize, jump + 8) - gap - slot;
    this.hotbar.dataset.slot = String(slot);
    this.hotbar.style.gap = `${hotGap}px`;
    const hotbarW = count * slot + (count - 1) * hotGap;
    const hotbarX = lying ? barL + (barW - hotbarW) / 2 : safe.x + (W - hotbarW) / 2;
    place(this.hotbar, hotbarX, hotbarY, hotbarW, slot);
    this.hotbarBox = { x: hotbarX, y: hotbarY, w: hotbarW, h: slot };
    this.buildHotbar();
    // Twenty icons (hearts and hunger) share the hotbar's width (a phone's a size down, with a
    // thinner experience bar).
    const icon = Math.max(8, Math.min(touch ? (lying ? 11 : 12) : 15, Math.floor((hotbarW - 12) / 20) - 1));
    this.vitals.style.setProperty('--icon', `${icon}px`);
    const vitalsH = icon + (touch ? 12 : 17);
    const vitalsY = hotbarY - vitalsH - 4;
    this.floatBottom = vitalsY;
    place(this.vitals, hotbarX, vitalsY, hotbarW, vitalsH);
    place(this.effectsEl, hotbarX, vitalsY - 26, hotbarW, 22);
    // The zone where a thumb brings the stick to it: the lower left of the view, under the hotbar.
    const zoneTop = lying ? Math.max(vh * 0.42, frame.y + 100) : hotbarY + slot + 2;
    place(this.stickZone, 0, zoneTop, lying ? barL + 30 : vw * 0.52, vh - zoneTop);
    // Action buttons stack up the right edge (over the vitals; lying sideways, over the thumbs; on
    // a desktop's wide window, up the window's own edge, clear of the middle of the view: the keys
    // are what a desktop player presses, so there they are only a shortcut).
    const ctxH = desktop ? (short ? 48 : 54) : lying ? clamp(Math.round(vh * 0.12), 44, 50) : 46;
    const ctxW = desktop ? 64 : ctxH;
    const edge = desktop && wide;
    this.ctx = { right: edge ? frame.x + frame.w : padR, bottom: edge ? frame.y + frame.h - 2 : lying ? padB - jump - 12 : vitalsY - 8, w: ctxW, h: ctxH };
    for (const node of [this.marchBtn, this.mapBtn, this.fireBtn, this.stompBtn, this.leapBtn, this.hornBtn]) {
      if (edge) node.setAttribute('data-combos-ui-critical', 'false');
      else node.removeAttribute('data-combos-ui-critical');
    }
    this.layoutContext();
    const ctxTop = this.ctx.bottom - 3 * (this.ctx.h + 8) - (desktop ? 0 : 60);
    this.stackFloor = Math.min(vitalsY, ctxTop);
    this.placeStack();
    place(this.crosshair, vw / 2 - 11, vh / 2 - 11, 22, 22);
    place(this.hitmark, vw / 2 - 14, vh / 2 - 14, 28, 28);
    this.layoutCrane();
    place(this.threatLayer, 0, 0, vw, vh);
    // Prompt just below the crosshair, centred (at the helm it moves over the action buttons).
    const pw = Math.min(W - 24, 220);
    this.promptSpots = { normal: vh / 2 + 22, x: vw / 2 - pw / 2, w: pw };
    this.promptAtHelm = !this.game.helm;
    this.layoutContext();

    if (wide) {
      // Wide screens: right of the cards down the left edge (centred in the view when there is room).
      const railRight = frame.x + this.cardW;
      const bw = Math.min(560, frame.w);
      const centred = (vw - bw) / 2 >= railRight + 12;
      const bx = centred ? (vw - bw) / 2 : railRight + 12;
      place(this.bannerEl, bx, Math.max(this.hintTop + 6, frame.y + frame.h * 0.22), centred ? bw : Math.max(220, frame.x + frame.w - bx), null);
    } else if (short) place(this.bannerEl, 12, (this.hintTop + 40 + vitalsY) / 2 - 40, vw - 24, null);
    else place(this.bannerEl, safe.x, safe.y + H * 0.28, W, null);
    this.bannerY0 = Number.parseFloat(this.bannerEl.style.top) || 0;
    this.placeToasts();

    // Overlays.
    this.layoutTitle(safe, frame, vw, vh);
    // A phone lying sideways: the safe column is a sliver, so the cards take the view instead.
    const boxX = lying ? frame.x : safe.x;
    const boxY = lying ? frame.y : safe.y;
    const boxW = lying ? frame.w : W;
    const boxH = lying ? frame.h : H;
    const modalW = Math.min(boxW, lying ? 640 : 440);
    place(this.craftModal, boxX + (boxW - modalW) / 2, boxY, modalW, boxH);
    // The map takes the whole view (sideways: the map on the left, the road on the right).
    const lyingMap = vw > vh;
    this.mapModal.classList.toggle('lying', lyingMap);
    if (lyingMap) place(this.mapModal, frame.x, frame.y, frame.w, frame.h);
    else place(this.mapModal, safe.x, frame.y, W, frame.h);
    place(this.villageModal, boxX + (boxW - modalW) / 2, boxY, modalW, boxH);
    place(this.guideModal, boxX + (boxW - modalW) / 2, boxY, modalW, boxH);
    place(this.journalModal, boxX + (boxW - modalW) / 2, boxY, modalW, boxH);
    place(this.featsModal, boxX + (boxW - modalW) / 2, boxY, modalW, boxH);
    // The story card sits centred, as tall as it needs (scrolling on short screens); sideways, the
    // picture stands beside the words.
    const cardW = Math.min(boxW - 8, lying ? 640 : 360);
    place(this.storyModal, boxX + (boxW - cardW) / 2, boxY, cardW, null);
    this.storyModal.classList.toggle('lying', lying);
    this.storyModal.style.maxHeight = `${boxH}px`;
    if (!this.storyModal.classList.contains('hidden')) this.storyModal.style.top = `${Math.round(boxY + Math.max(0, (boxH - this.storyModal.offsetHeight) / 2))}px`;
    if (this.mapCanvas) {
      const mw = lyingMap ? frame.w : W;
      const mh = frame.h;
      const cw = Math.round(lyingMap ? mw * 0.62 - 16 : mw - 20);
      // (Upright: whatever the destinations under it leave.)
      const rows = this.mapModal.querySelectorAll('.dest').length;
      const ch = Math.round(lyingMap ? mh - 58 : clamp(mh - 58 - 136 - rows * 66, cw * 0.8, mh * 0.66));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.mapCanvas.width = Math.round(cw * dpr);
      this.mapCanvas.height = Math.round(ch * dpr);
      this.mapCanvas.style.width = `${cw}px`;
      this.mapCanvas.style.height = `${ch}px`;
      const atlas = this.mapModal.querySelector<HTMLElement>('.atlas');
      if (atlas) {
        atlas.style.width = `${cw}px`;
        atlas.style.height = `${ch}px`;
      }
      this.redrawMap();
    }
    const smallW = Math.min(boxW, lying ? 420 : 340);
    place(this.pauseModal, boxX + (boxW - smallW) / 2, boxY + 8, smallW, null);
    this.pauseModal.style.maxHeight = `${boxH - 16}px`;
    this.pauseModal.style.overflowY = 'auto';
    place(this.resultModal, boxX + (boxW - smallW) / 2, boxY + 8, smallW, null);
    const cloudW = Math.min(boxW, lying ? 440 : 360);
    place(this.cloudModal, boxX + (boxW - cloudW) / 2, boxY + 8, cloudW, null);
    this.cloudModal.style.maxHeight = `${boxH - 16}px`;
    place(this.coopModal, boxX + (boxW - cloudW) / 2, boxY + 8, cloudW, null);
    this.coopModal.style.maxHeight = `${boxH - 16}px`;
    place(this.langModal, boxX + (boxW - smallW) / 2, boxY + 8, smallW, null);
    this.langModal.style.maxHeight = `${boxH - 16}px`;
    this.resultModal.style.maxHeight = `${boxH - 16}px`;
    this.resultModal.style.overflowY = 'auto';
    for (const modal of [this.pauseModal, this.resultModal, this.cloudModal, this.coopModal, this.langModal]) {
      if (modal.classList.contains('hidden')) continue;
      const h = modal.offsetHeight;
      modal.style.top = `${Math.round(boxY + Math.max(8, (boxH - h) / 2))}px`;
    }
    this.fitButtons();
  }

  /**
   * The title. Portrait: the language switch top right, the logo over the fortress, the buttons at
   * the foot, all in the safe column. Wide screens (as the key art is painted): the logo and the
   * buttons down the left, the fortress striding through the right, the switch in the top corner.
   */
  private layoutTitle(safe: { x: number; y: number; width: number; height: number }, frame: { x: number; y: number; w: number; h: number }, vw: number, vh: number): void {
    const wide = vw >= vh * 1.15 && frame.w >= 560;
    this.titleWide = wide;
    this.title.classList.toggle('wide', wide);
    this.setTitleArt(wide);
    // (The switch is as wide as its words: measured, then set by its left edge.)
    const pill = this.langPill;
    pill.style.width = '';
    pill.classList.remove('tight');
    let pillW = pill.offsetWidth || 160;
    const pillH = pill.offsetHeight || 56;
    const putPill = (right: number, top: number): void => {
      pill.style.left = `${Math.round(right - pillW)}px`;
      pill.style.top = `${Math.round(top)}px`;
    };
    // (Too long for its place: the segments close up.)
    const tighten = (): void => {
      pill.classList.add('tight');
      pillW = pill.offsetWidth || pillW;
    };
    // The buttons' sizes, and the height the button block needs (rings and gaps included).
    const saved = this.title.classList.contains('has-save');
    const noteH = this.titleNote.classList.contains('hidden') ? 0 : this.titleNote.offsetHeight;
    const stackH = (mainH: number, rowH: number): number => {
      const items = [mainH, rowH, ...(saved ? [Math.max(44, mainH * 0.72)] : []), ...(noteH ? [noteH] : [])];
      return items.reduce((a, b) => a + b, 0) + (items.length - 1) * 24 + 16;
    };
    let panel: { x: number; y: number; w: number; h: number };
    let logoW: number;
    let logoTop = 0;
    if (wide) {
      // Down the left, like the key art: never wider than the open sky before the fortress.
      const w = clamp(frame.w * 0.4, 250, 600);
      panel = { x: frame.x + Math.min(24, frame.w * 0.02), y: frame.y, w, h: frame.h };
      const mainH = clamp(Math.round(frame.h * 0.11), 46, 86);
      const rowH = clamp(Math.round(frame.h * 0.085), 44, 70);
      this.titlePanel.style.setProperty('--t-main-h', `${mainH}px`);
      this.titlePanel.style.setProperty('--t-row-h', `${rowH}px`);
      this.titlePanel.style.setProperty('--t-w', `${Math.round(w)}px`);
      // The logo takes what the buttons leave (at most half the height).
      const room = frame.h - stackH(mainH, rowH) - clamp(frame.h * 0.05, 12, 44) - 8;
      logoW = Math.min(w, Math.max(110, room * this.logoAspect), frame.h * 0.5 * this.logoAspect);
      // The switch sits beside the host's corner; where it would reach over the logo's column (a
      // phone lying sideways) it drops below that corner to the very edge, closing up if it must.
      const column = panel.x + w + 8;
      const corner = frame.x + frame.w - HOST_CORNER;
      const edge = frame.x + frame.w - 5;
      if (corner - pillW >= column) putPill(corner, frame.y + 5);
      else {
        if (edge - pillW < column) tighten();
        putPill(edge, Math.max(frame.y + 5, 60));
      }
    } else {
      panel = { x: safe.x, y: safe.y, w: safe.width, h: safe.height };
      // (Tablets get bigger buttons and logo.)
      const k = clamp(safe.width / 369, 1, 1.3);
      const mainH = Math.round((this.short ? 52 : 64) * k);
      const rowH = Math.round((this.short ? 44 : 54) * k);
      this.titlePanel.style.setProperty('--t-main-h', `${mainH}px`);
      this.titlePanel.style.setProperty('--t-row-h', `${rowH}px`);
      this.titlePanel.style.setProperty('--t-w', `${Math.round(340 * k)}px`);
      // The switch keeps clear of the host's corner when the column reaches the top of the screen
      // (on a narrow phone, where all the languages will not fit beside that corner, it drops below it).
      let right = safe.y < 56 ? Math.min(safe.x + safe.width - 5, vw - HOST_CORNER) : safe.x + safe.width - 5;
      let pillTop = safe.y + 5;
      if (right - pillW < safe.x + 4) {
        right = safe.x + safe.width - 5;
        pillTop = Math.max(pillTop, 60);
        if (right - pillW < safe.x + 2) tighten();
      }
      putPill(right, pillTop);
      const pillFoot = pillTop - safe.y + pillH;
      const room = safe.height - stackH(mainH, rowH) - 24;
      logoW = Math.min(safe.width - 12, 390 * k, safe.height * 0.3 * this.logoAspect, Math.max(140, (room - pillFoot - 14) * this.logoAspect));
      // (A logo reaching under the switch in the corner moves down below it.)
      if ((safe.x + safe.width / 2 + logoW / 2) > right - pillW - 10) logoTop = pillFoot + 14;
    }
    place(this.titlePanel, panel.x, panel.y, panel.w, panel.h);
    this.titleTop.style.paddingTop = logoTop ? `${logoTop}px` : '';
    this.titleLogo.style.width = `${Math.round(logoW)}px`;
    this.fitTitleButtons();
    if (!this.logo.classList.contains('hidden')) {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const h = drawBlockLogo(this.logo, logoW, dpr);
      const room = wide ? panel.h * 0.42 : panel.h * 0.3;
      if (h > room) drawBlockLogo(this.logo, logoW * (room / h), dpr);
    }
  }

  /** The big buttons keep their words on one line (CONTINUAR · DÍA 12 runs long), the small ones to two. */
  private fitTitleButtons(): void {
    for (const b of [this.continueBtn, this.playBtn]) if (!b.classList.contains('hidden')) fitLabel(b);
    for (const b of [this.cloudBtn, this.coopBtn]) {
      const span = b.querySelector<HTMLElement>('span');
      if (!span) continue;
      span.style.removeProperty('font-size');
      const room = b.clientHeight - 8;
      let size = Number.parseFloat(getComputedStyle(span).fontSize) || 14;
      for (let i = 0; i < 5 && span.offsetHeight > room && size > 9; i += 1) {
        size *= 0.88;
        span.style.fontSize = `${size.toFixed(1)}px`;
      }
    }
  }

  /** The key art for the screen's shape (portrait or landscape), swapped when the screen turns. */
  private setTitleArt(wide: boolean): void {
    const src = new URL(wide ? TITLE_ART.landscape : TITLE_ART.portrait, document.baseURI).href;
    if (src === this.titleArtSrc) return;
    this.titleArtSrc = src;
    this.titleArt.classList.remove('in');
    this.titleArt.src = src;
  }

  /** Loads the title's key art and logo for the screen as it is (resolves false if the art failed). */
  loadTitleArt(timeoutMs: number): Promise<boolean> {
    this.titleLogo.src = new URL(TITLE_LOGO, document.baseURI).href;
    const vw = this.root.clientWidth || window.innerWidth;
    const vh = this.root.clientHeight || window.innerHeight;
    this.setTitleArt(vw >= vh * 1.15 && vw >= 584);
    const img = this.titleArt;
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      if (img.complete && img.naturalWidth > 0) done(true);
      img.addEventListener('load', () => done(true), { once: true });
      img.addEventListener('error', () => done(false), { once: true });
      window.setTimeout(() => done(img.complete && img.naturalWidth > 0), timeoutMs);
    });
  }

  /** Fixed-width buttons in the open windows keep their words inside (some languages run long). */
  private fitButtons(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('.modal:not(.hidden) .craft-btn, .modal:not(.hidden) .dest-btn, #hud-plan .mini')) fitLabel(b);
  }

  private layoutContext(): void {
    this.placeContext();
    // (Read back from where they were just put: no layout pass.)
    this.keepOut = [this.prompt, this.marchBtn, this.mapBtn, this.fireBtn, this.stompBtn, this.leapBtn, this.hornBtn].map((el) => ({
      el,
      x: Number.parseFloat(el.style.left) || 0,
      y: Number.parseFloat(el.style.top) || 0,
      w: Number.parseFloat(el.style.width) || 0,
      h: Number.parseFloat(el.style.height) || 44,
    }));
  }

  /** The controls the speech bubbles keep clear of: the action prompt and the round buttons. */
  private keepOut: Array<{ el: HTMLElement; x: number; y: number; w: number; h: number }> = [];

  private placeContext(): void {
    const c = this.ctx;
    let bottom = c.bottom;
    this.promptAtHelm = this.game.helm;
    const sp = this.promptSpots;
    // On touch screens the action prompt is the thumb's button: the foot of the right-hand stack.
    const touch = this.inputMode === 'touch';
    if (touch) {
      // A thumb's 44px tall and as wide as its words (measured as they change); only words longer
      // than the most it may take ("WINDMILL: CRANE BUSY") wrap onto two lines.
      const ph = 44;
      const most = Math.max(c.w, Math.min(this.vw - 24, 210));
      const w = this.prompt.classList.contains('hidden') ? most : clamp(this.promptWords() + 26, Math.max(c.w, 96), most);
      place(this.prompt, c.right - w, bottom - ph, w, ph);
      this.prompt.removeAttribute('data-combos-ui-critical');
      if (!this.prompt.classList.contains('hidden')) bottom -= ph + 8;
    }
    const shown = [this.marchBtn, this.mapBtn, this.fireBtn, this.stompBtn, this.leapBtn, this.hornBtn].filter((n) => !n.classList.contains('hidden'));
    // Touch: round buttons up the right edge, a second column beside the first if the first runs
    // into the top of the view.
    if (touch) {
      const top = this.frame.y + (this.wide ? 44 : 150);
      const foot = bottom;
      let x = c.right;
      for (const node of shown) {
        if (bottom - c.h < top) {
          x -= c.w + 8;
          bottom = foot;
        }
        place(node, x - c.w, bottom - c.h, c.w, c.h);
        bottom -= c.h + 8;
      }
      // (Its words, with the pill's padding, keep inside the round button.)
      for (const node of shown) this.fitOnce(node, c.w - 6);
      const was = this.ctxStackTop;
      this.ctxStackTop = bottom;
      if (Math.abs(was - bottom) > 1) this.placeStack();
      return;
    }
    // Short (landscape) screens have no height for a column: the buttons share one row instead
    // (narrowed to fit, never under the 44px touch minimum; a second row only if they must).
    const rows = this.short && shown.length > 1;
    const gapX = 6;
    const perRow = rows ? Math.max(1, Math.min(shown.length, Math.floor((this.safe.width + gapX) / (44 + gapX)))) : 1;
    const bw = rows ? Math.min(c.w, Math.floor((this.safe.width - (perRow - 1) * gapX) / perRow)) : c.w;
    shown.forEach((node, i) => {
      const h = node === this.marchBtn || node === this.mapBtn ? Math.max(44, c.h - 8) : c.h;
      if (rows) {
        const col = i % perRow;
        if (col === 0 && i > 0) bottom -= c.h + 8;
        place(node, c.right - bw - col * (bw + gapX), bottom - c.h, bw, c.h);
        if (i === shown.length - 1) bottom -= c.h + 8;
        return;
      }
      place(node, c.right - c.w, bottom - h, c.w, h);
      bottom -= h + 8;
    });
    for (const node of shown) this.fitOnce(node, (Number.parseFloat(node.style.width) || c.w) - 6);
    // The top of the button stack: the open coach card keeps above it.
    const was = this.ctxStackTop;
    this.ctxStackTop = bottom;
    if (Math.abs(was - bottom) > 1) this.placeStack();
    if (touch) return;
    // As wide as its key and its words.
    const w = clamp(this.promptWords() + 64, 120, Math.max(sp.w, Math.min(this.vw - 24, 320)));
    // At the helm the prompt (LEAVE HELM) tops the button stack instead of covering the view.
    if (this.game.helm) {
      // No room above the stack (short screens): beside its lowest button instead.
      if (bottom - 48 < this.hintTop) place(this.prompt, c.right - c.w - 8 - w, c.bottom - 44, w, 44);
      else place(this.prompt, c.right - w, bottom - 48, w, 44);
    } else {
      // Under the crosshair.
      place(this.prompt, this.vw / 2 - w / 2, sp.normal, w, 44);
    }
    // (Up a desktop window's edge it shows the key to press: the mouse is the view's, held captured.)
    const s = this.safe;
    const x = Number.parseFloat(this.prompt.style.left) || 0;
    const inside = x >= s.x && x + w <= s.x + s.width;
    if (inside) this.prompt.removeAttribute('data-combos-ui-critical');
    else this.prompt.setAttribute('data-combos-ui-critical', 'false');
  }

  /**
   * The prompt's words' width, measured once per label and language (the prompt flips between a
   * few labels as the view sweeps over things: measuring each time would lay the page out each time).
   */
  private promptWords(): number {
    const words = this.prompt.querySelector('span') as HTMLElement;
    const key = `${currentLang()}|${this.inputMode}|${this.lastPrompt}|${this.prompt.classList.contains('long')}`;
    let w = this.wordWidths.get(key);
    if (w === undefined) {
      flushText();
      // (On one line: the width the words want, not the width they were last wrapped to.)
      words.style.whiteSpace = 'nowrap';
      w = words.offsetWidth;
      words.style.removeProperty('white-space');
      if (this.wordWidths.size > 200) this.wordWidths.clear();
      this.wordWidths.set(key, w);
    }
    return w;
  }

  private readonly wordWidths = new Map<string, number>();

  /** A button's label fitted to its width, again only when its words or its width changed. */
  private fitOnce(node: HTMLElement, room: number): void {
    const span = node.querySelector('span');
    if (!span) return;
    const key = `${span.textContent}|${Math.round(room)}`;
    if (this.fitted.get(node) === key) return;
    this.fitted.set(node, key);
    fitLabel(span, room);
  }

  private readonly fitted = new WeakMap<HTMLElement, string>();

  /** Where the coach's card hangs, its width, and the lowest point the stack under it may reach. */
  private cardTop = 120;
  private cardW = 390;
  private stackFloor = 600;
  /** The top of the action buttons stacked on the right. */
  private ctxStackTop = 600;
  /** The view inside the device's insets, and whether the HUD spreads across it (wide screens). */
  private frame = { x: 12, y: 10, w: 369, h: 700 };
  private wide = false;
  /** The top-left cluster's lower edge and right edge. */
  private clusterBottom = 80;
  private clusterRight = 300;
  /** Wide screens: how far down the left-hand cards may reach. */
  private railFloor = 600;

  /** The boss board's height: a row per bar. */
  private bossHeight(): number {
    return Math.max(1, this.bossRows) * 26 - 3;
  }

  /**
   * The HUD under the top-left cluster. Portrait, top down in the safe column: the boss bars, the
   * coach's card (as tall as it is right now), the control hint, then briefings, tips, feats and
   * toasts. Wide screens: the boss bars and the hint top centre, the card and the news down the
   * left edge. Rerun whenever the card changes size.
   */
  private placeStack(): void {
    flushText();
    const safe = this.safe;
    const W = safe.width;
    const card = this.coach.card;
    if (this.wide) {
      const f = this.frame;
      // Top centre, between the cluster and the corner the host keeps for its own buttons.
      const x0 = this.clusterRight + 12;
      const x1 = f.x + f.w - 70;
      const cw = Math.max(180, Math.min(420, x1 - x0));
      const cx = Math.min(Math.max(x0, (this.vw - cw) / 2), Math.max(x0, x1 - cw));
      let y = f.y;
      place(this.bossBar, cx, y, cw, this.bossHeight());
      if (this.bossShown) y += this.bossHeight() + 4;
      place(this.hint, cx, y, cw, null);
      this.hintRoom = this.floatBottom - 6 - y;
      this.fitHint();
      const hintH = this.hintText && this.hint.style.display !== 'none' ? this.hint.offsetHeight + 4 : 0;
      this.hintTop = Math.max(y + hintH, f.y + 46);
      // Down the left edge: the card, then the news under it (kept above the controls it would cover).
      const touch = this.inputMode === 'touch';
      const overlapsColumn = touch || f.x + this.cardW > safe.x - 6;
      const stickTop = touch ? this.stickHome.y : this.floatBottom;
      this.railFloor = overlapsColumn ? Math.min(this.floatBottom, stickTop) - 8 : f.y + f.h;
      place(card, f.x, this.cardTop, this.cardW, null);
      // (A phone lying sideways: a size down, to keep to its corner.)
      card.classList.toggle('narrowed', touch || this.cardW < 280);
      this.fitCardArt();
      this.placeToasts();
      if (this.planOpen) this.layoutPlan();
      this.coach.moveStamp(this.vw / 2, (this.hintTop + this.floatBottom) / 2);
      return;
    }
    let y = this.cardTop;
    const bossW = Math.min(W, 360);
    place(this.bossBar, safe.x + (W - bossW) / 2, y, bossW, this.bossHeight());
    if (this.bossShown) y += this.bossHeight() + 4;
    this.cardY = y;
    place(card, safe.x, y, this.cardW, null);
    card.classList.toggle('narrowed', this.cardW < 340);
    this.fitCardArt();
    // A card reaching down past the buttons on the right keeps to the left of them.
    const lane = this.ctx.right - this.ctx.w - 8 - safe.x;
    if (this.coach.shown && y + card.offsetHeight > this.ctxStackTop - 6 && lane < this.cardW && lane > 200) {
      place(card, safe.x, y, lane, null);
      card.classList.toggle('narrowed', lane < 340);
      this.fitCardArt();
    }
    if (this.coach.shown) y += card.offsetHeight + 6;
    this.hintTop = y;
    place(this.hint, safe.x, this.hintTop, W, null);
    this.hintRoom = this.stackFloor - 6 - this.hintTop;
    this.fitHint();
    this.placeToasts();
    if (this.planOpen) this.layoutPlan();
    // A step's stamp keeps under the card as the next card slides in.
    this.coach.moveStamp(this.vw / 2, (this.hintTop + this.floatBottom) / 2);
  }

  /** Top of the card in the portrait stack (under the boss bars). */
  private cardY = 120;

  /** The open card's picture shrinks (or goes) so the card never reaches the controls below it. */
  private fitCardArt(): void {
    const card = this.coach.card;
    if (!this.coach.expanded) {
      card.classList.remove('tight');
      return;
    }
    card.classList.remove('tight');
    const main = card.querySelector<HTMLElement>('.c-main');
    if (!main) return;
    const room = (this.wide ? this.railFloor - this.cardTop : this.ctxStackTop - this.cardY) - 10;
    const art = Math.max(0, Math.min(this.wide ? 120 : 96, room - main.offsetHeight));
    card.style.setProperty('--art-h', `${Math.round(art)}px`);
    card.classList.toggle('tight', art < 58);
  }

  /** Shows the hint only when it fits between the HUD and the controls. */
  private fitHint(): void {
    if (!this.hintText) return;
    this.hint.style.display = '';
    const fits = this.hint.scrollHeight <= this.hintRoom;
    this.hint.style.display = fits ? '' : 'none';
  }

  /**
   * The news, top down: the briefing card, a tip, a feat, then toasts. Portrait: under the hint in
   * the safe column; wide screens: under the card down the left edge.
   */
  private placeToasts(): void {
    flushText();
    const safe = this.safe;
    if (this.wide) {
      const f = this.frame;
      const w = this.cardW;
      // (On a phone lying sideways the news may be a little wider than the card: fewer lines, a
      // lower stack.)
      const newsW = this.inputMode === 'touch' ? clamp(Math.round(f.w * 0.42), w, 300) : w;
      let y = this.cardTop + (this.coach.shown ? this.coach.card.offsetHeight + 6 : 0);
      for (const node of [this.briefEl, this.tipEl, this.featEl]) {
        if (node.classList.contains('hidden') || (node === this.briefEl && this.briefTimer <= 0) || (node === this.featEl && !node.classList.contains('on'))) continue;
        place(node, f.x, y, newsW, null);
        y += node.offsetHeight + 6;
      }
      this.stackBottom = this.hintTop;
      place(this.toasts, f.x, y, Math.min(w, 300), null);
      // News piling down onto the controls: the card's picture folds to make room.
      if (this.coach.open && y + this.toasts.offsetHeight > this.railFloor) this.coach.fold();
      return;
    }
    let y = this.hintTop + (this.hintText && this.hint.style.display !== 'none' ? this.hint.offsetHeight + 6 : 0);
    const w = Math.min(safe.width, 360);
    const x = safe.x;
    // Anything reaching down past the top of the buttons on the right keeps left of them.
    const lane = Math.max(160, this.ctx.right - this.ctx.w - 10 - safe.x);
    const fit = (node: HTMLElement): void => {
      place(node, x, y, w, null);
      if (y + node.offsetHeight > this.ctxStackTop - 6 && x + w > safe.x + lane) place(node, safe.x, y, Math.min(w, lane), null);
      y += node.offsetHeight + 6;
    };
    if (this.briefTimer > 0) fit(this.briefEl);
    if (!this.tipEl.classList.contains('hidden')) fit(this.tipEl);
    if (this.featEl.classList.contains('on') && !this.featEl.classList.contains('hidden')) fit(this.featEl);
    // Speech bubbles keep below the cards.
    this.stackBottom = y;
    // Announcements never land on top of a card: below the stack when one is showing (and keep
    // left of the buttons if they reach that far down).
    this.bannerFoot = -1;
    if (!this.short) {
      const by = Math.max(this.bannerY0, y + 4);
      this.bannerEl.style.top = `${Math.round(by)}px`;
      const clear = by + this.bannerEl.offsetHeight < this.ctxStackTop - 4;
      this.bannerEl.style.left = `${Math.round(safe.x)}px`;
      this.bannerEl.style.width = `${Math.round(clear ? safe.width : Math.min(safe.width, lane))}px`;
    }
    if (this.bannerTimer > 0 && !this.short) y = Math.max(y, Math.max(this.bannerY0, y + 4) + this.bannerEl.offsetHeight + 6);
    place(this.toasts, safe.x, y, Math.min(lane, 300), null);
    // News piling down onto the hearts: the card's picture folds to make room (it re-lays out).
    if (this.coach.open && y + this.toasts.offsetHeight > this.floatBottom - 4) this.coach.fold();
  }
}
