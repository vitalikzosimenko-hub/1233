// The coach: readable guidance that keeps out of the view. One mission card of glass (a thumbnail
// of its picture, what to do, the distance to the spot; a tap opens the picture, the why and the
// skip), a hand that points at the very control to press (or shows the gesture), a gold marker over
// the spot in the world (or an arrow at the screen edge when it is out of view), a stamp when a
// step is done, name tags over the fortress's parts while you learn them, and the letterboxed
// captions of the opening flyover.
import { artURL, type ArtKey, type GoalTone } from './guide';
import { flushText, setHTML, setText, tr } from './i18n';
import { iconURL } from './textures';

export interface CardView {
  /** Identity: a new key slides a new card in. */
  key: string;
  mode: 'step' | 'lesson' | 'goal';
  tone: GoalTone;
  icon: string;
  title: string;
  /** Small caps over the title: "STEP 3 OF 10", a village's name, "NIGHT 2". */
  tag: string;
  why: string;
  text: string;
  art: ArtKey | null;
  dist: number;
  /** Training progress: steps done and the total. */
  pips: [number, number] | null;
  skip: boolean;
  /** The goal line opens today's plan when tapped. */
  more: boolean;
}

export type Gesture = 'tap' | 'drag' | 'swipe';

export interface Pointer {
  x: number;
  y: number;
  gesture: Gesture | null;
  /** Desktop: the key (or mouse button) to press, shown as a key cap. */
  key: string | null;
}

export interface Marker {
  x: number;
  y: number;
  /** Off screen: the arrow at the edge points this way (radians, 0 = up, clockwise). */
  edge: number | null;
  label: string;
  dist: number;
  danger: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) setHTML(node, html);
  return node;
}

function region(node: HTMLElement, role: string, id: string): void {
  node.setAttribute('data-combos-ui-region', role);
  node.setAttribute('data-combos-ui-id', id);
  node.setAttribute('data-combos-ui-critical', 'false');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** A chunky pointing hand (fingertip at 10,1 in its 24x30 box). */
const HAND_PATH = 'M8 3.2a2 2 0 0 1 4 0V12h1.2V10.4a1.9 1.9 0 0 1 3.8 0V13h.6v-1.1a1.9 1.9 0 0 1 3.8 0v9.3c0 2.2-.8 4-2.2 5.6l-.9 1.2H8.6L3.4 19.6a2 2 0 0 1 .3-2.8 2 2 0 0 1 2.7.2L8 18.6z';
/** (Its shadow is drawn with it, not a filter redone every frame of its animation.) */
const HAND_SVG = `<svg viewBox="0 0 24 30" overflow="visible" aria-hidden="true"><path d="${HAND_PATH}" transform="translate(1.6 2.4)" fill="#000" opacity=".4"/><path d="${HAND_PATH}" fill="#ffffff" stroke="#14110c" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 12v5M16.8 13v4" stroke="#14110c" stroke-width="1.1" stroke-linecap="round" opacity=".55"/></svg>`;

const CHEERS = ['NICE!', 'GREAT!', 'WELL DONE!', 'AWESOME!', 'PERFECT!'];

export class Coach {
  readonly card: HTMLElement;
  readonly hand: HTMLElement;
  readonly keycap: HTMLElement;
  readonly mark: HTMLElement;
  readonly stamp: HTMLElement;
  readonly labels: HTMLElement;
  readonly cine: HTMLElement;
  private readonly artImg: HTMLImageElement;
  private readonly thumbImg: HTMLImageElement;
  private readonly foldEl: HTMLElement;
  private readonly iconImg: HTMLImageElement;
  private readonly tagEl: HTMLElement;
  private readonly pipsEl: HTMLElement;
  private readonly distEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly whyEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly moreEl: HTMLElement;
  private readonly handIn: HTMLElement;
  private readonly labelEls: HTMLElement[] = [];
  private view: CardView | null = null;
  private lastText = '';
  private lastPips = '';
  private lastArt = '';
  /** Played with a mouse: the card says "click" where a phone's says "tap". */
  pc = false;
  /** Seconds the picture stays open (the card then folds to its words), and how long it has been. */
  private openFor = 0;
  private openAge = 0;
  /** Seconds the card's words have stood: once read, a step or a lesson folds to its instruction. */
  private readAge = 0;
  private brief = false;
  private cheer = 0;
  private stampTimer = 0;
  expanded = false;
  /** Called when the card changed size (the HUD below it moves). */
  onResize: (() => void) | null = null;
  onSkip: (() => void) | null = null;
  onMore: (() => void) | null = null;
  /** Sound for a new card sliding in. */
  onEnter: (() => void) | null = null;

  constructor() {
    this.card = el('div', 'abs coach-card hidden');
    this.card.id = 'coach';
    region(this.card, 'hud', 'coach');
    setHTML(this.card, `
      <div class="c-art"><img alt="" data-combos-asset-role="tutorial_art"></div>
      <div class="c-main">
        <img class="c-thumb" alt="">
        <div class="c-body">
          <div class="c-head"><img class="c-icon" alt=""><span class="c-tag"></span><span class="c-pips"></span><span class="c-dist"></span><span class="c-more">▾</span></div>
          <div class="c-title"></div>
          <div class="c-why"></div>
          <div class="c-text"><b class="c-go">▶</b><span></span></div>
          <div class="c-foot"><button class="c-skip" data-combos-action="skip-training">SKIP TUTORIAL</button><span class="c-fold">tap the card to fold it</span></div>
        </div>
      </div>`);
    this.artImg = this.card.querySelector('.c-art img')!;
    this.thumbImg = this.card.querySelector('.c-thumb')!;
    this.foldEl = this.card.querySelector('.c-fold')!;
    this.iconImg = this.card.querySelector('.c-icon')!;
    this.tagEl = this.card.querySelector('.c-tag')!;
    this.pipsEl = this.card.querySelector('.c-pips')!;
    this.distEl = this.card.querySelector('.c-dist')!;
    this.moreEl = this.card.querySelector('.c-more')!;
    this.titleEl = this.card.querySelector('.c-title')!;
    this.whyEl = this.card.querySelector('.c-why')!;
    this.textEl = this.card.querySelector('.c-text span')!;
    this.skipBtn = this.card.querySelector('.c-skip')!;
    this.artImg.addEventListener('error', () => this.card.classList.add('no-art'));
    this.artImg.addEventListener('load', () => {
      this.card.classList.remove('no-art');
      this.onResize?.();
    });
    this.skipBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onSkip?.();
    });
    this.card.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const v = this.view;
      if (!v) return;
      if (v.mode === 'goal') {
        this.onMore?.();
        return;
      }
      this.setExpanded(!this.expanded, 9);
    });

    this.hand = el('div', 'abs hidden');
    this.hand.id = 'coach-hand';
    region(this.hand, 'decorative', 'coach-hand');
    this.handIn = el('div', 'h-in', `<i class="ripple"></i>${HAND_SVG}`);
    this.hand.appendChild(this.handIn);
    this.keycap = el('div', 'abs hidden');
    this.keycap.id = 'coach-key';
    this.keycap.setAttribute('translate', 'no');
    region(this.keycap, 'decorative', 'coach-key');

    this.mark = el('div', 'abs hidden', '<div class="m-label"><span class="m-name"></span><span class="m-dist"></span></div><svg class="m-arrow" viewBox="0 0 20 14"><polygon points="0,0 20,0 10,13"/></svg>');
    this.mark.id = 'coach-mark';
    region(this.mark, 'decorative', 'coach-mark');

    this.stamp = el('div', 'abs hidden');
    this.stamp.id = 'coach-stamp';
    region(this.stamp, 'decorative', 'coach-stamp');

    this.labels = el('div', 'abs');
    this.labels.id = 'part-labels';
    region(this.labels, 'decorative', 'part-labels');
    for (let i = 0; i < 5; i += 1) {
      const l = el('div', 'plabel hidden');
      this.labels.appendChild(l);
      this.labelEls.push(l);
    }

    this.cine = el('div', 'overlay hidden', '<div class="bar top"></div><div class="bar bot"></div><div class="cap"><div class="t"></div><div class="s"></div></div><div class="skip">TAP TO SKIP ▸▸</div>');
    this.cine.id = 'cine';
    region(this.cine, 'modal', 'intro');
  }

  /** In-world layers (under the HUD), the card (in it), and the overlays (over the controls). */
  get under(): HTMLElement[] {
    return [this.labels, this.mark];
  }

  get over(): HTMLElement[] {
    return [this.stamp, this.keycap, this.hand];
  }

  get shown(): boolean {
    return this.view !== null;
  }

  /** A lesson or a training step is on the card (tips wait). */
  get busy(): boolean {
    return this.view !== null && this.view.mode !== 'goal';
  }

  /** Whether the card has more to show when opened: its picture, its why, the skip. */
  private get opens(): boolean {
    const v = this.view;
    return v !== null && v.mode !== 'goal' && (v.art !== null || v.why !== '' || v.skip);
  }

  private setExpanded(open: boolean, seconds: number): void {
    const want = open && this.opens;
    this.openFor = want ? seconds : 0;
    this.openAge = 0;
    if (want === this.expanded) return;
    this.expanded = want;
    this.card.classList.toggle('expanded', want);
    this.onResize?.();
  }

  /** Puts a card up (or takes it down with null). Called a few times a second. */
  show(v: CardView | null): void {
    const prev = this.view;
    this.view = v;
    if (!v) {
      if (prev) {
        this.card.classList.add('hidden');
        this.expanded = false;
        this.openFor = 0;
        this.card.classList.remove('expanded');
        this.lastText = '';
        this.onResize?.();
      }
      return;
    }
    const fresh = !prev || prev.key !== v.key;
    let resized = fresh;
    const c = this.card.classList;
    c.remove('hidden');
    for (const m of ['step', 'lesson', 'goal'] as const) c.toggle(m, m === v.mode);
    for (const t of ['train', 'quest', 'day', 'night', 'danger'] as const) c.toggle(t, t === v.tone);
    if (this.iconKey !== v.icon) {
      this.iconKey = v.icon;
      this.iconImg.src = iconURL(v.icon);
    }
    if (setText(this.titleEl, v.title)) resized = true;
    setText(this.tagEl, v.tag);
    if (setText(this.whyEl, v.why)) this.whyEl.style.display = v.why ? '' : 'none';
    this.skipBtn.style.display = v.skip ? '' : 'none';
    // (The chevron: a goal opens today's plan, a step or a lesson its picture and its why.)
    this.moreEl.style.display = v.more || this.opens ? '' : 'none';
    if (fresh) {
      // A new card slides in folded, its picture a thumbnail beside the words (a tap opens it).
      const art = v.art ? artURL(v.art) : '';
      if (art && art !== this.lastArt) {
        this.lastArt = art;
        this.artImg.src = art;
        this.thumbImg.src = art;
      }
      c.toggle('no-art', !art);
      this.expanded = false;
      this.openFor = 0;
      c.remove('expanded');
      this.setBrief(false);
      setText(this.foldEl, this.pc ? 'click the card to fold it' : 'tap the card to fold it');
      c.remove('enter');
      void this.card.offsetWidth;
      c.add('enter');
      if (v.mode !== 'goal') this.onEnter?.();
    }
    const pips = v.pips ? `${v.pips[0]}/${v.pips[1]}` : '';
    if (pips !== this.lastPips) {
      this.lastPips = pips;
      // (The same progress as a thin bar along the card's foot, for the folded card.)
      this.card.style.setProperty('--prog', v.pips ? (v.pips[0] / Math.max(1, v.pips[1])).toFixed(3) : '0');
      setHTML(this.pipsEl, v.pips ? Array.from({ length: v.pips[1] }, (_, i) => `<i class="${i < v.pips![0] ? 'on' : i === v.pips![0] ? 'now' : ''}"></i>`).join('') : '');
    }
    c.toggle('has-text', v.text !== '');
    if (v.text !== this.lastText) {
      const was = this.lastText;
      this.lastText = v.text;
      setText(this.textEl, v.text);
      // A new instruction on the same card: the line flashes so the eye goes to it (on a desktop
      // the title comes back with it a while; a phone's card stays one line).
      if (was && !fresh) {
        const line = this.textEl.parentElement!;
        line.classList.remove('flash');
        void line.offsetWidth;
        line.classList.add('flash');
        if (this.pc) this.setBrief(false);
      }
      resized = true;
    }
    const dist = v.dist >= 4 ? `${v.dist}m` : '';
    setText(this.distEl, dist);
    if (resized) this.onResize?.();
  }

  private iconKey = '';

  /** SKIP TUTORIAL asks "sure?" before it skips. */
  armSkip(on: boolean): void {
    setText(this.skipBtn, on ? 'TAP AGAIN TO SKIP' : 'SKIP TUTORIAL');
    this.skipBtn.classList.toggle('armed', on);
  }

  /** The hand (touch) or key cap (desktop) over the control to press; null hides them. */
  point(p: Pointer | null, touch: boolean): void {
    const handOn = p !== null && touch && p.gesture !== null;
    this.hand.classList.toggle('hidden', !handOn);
    if (handOn) {
      const cls = `h-in ${p.gesture}`;
      if (this.handIn.className !== cls) this.handIn.className = cls;
      // The fingertip sits on the point (the hand is 54px wide).
      this.hand.style.transform = `translate(${Math.round(p.x - 22)}px, ${Math.round(p.y - 3)}px)`;
    }
    const keyOn = p !== null && !touch && p.key !== null;
    this.keycap.classList.toggle('hidden', !keyOn);
    if (keyOn) {
      // (Keys are named in the player's language: "RIGHT CLICK", "SPACE"; the letters stay.)
      const html = tr(p.key!).split(' ').map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('');
      if (this.keycap.innerHTML !== html) setHTML(this.keycap, html);
      this.keycap.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
  }

  /** The marker over the spot (or an edge arrow when it is out of view); null hides it. */
  /** The marker's half width (measured only when its text changes) and the view width. */
  private markHalf = 40;
  vw = 393;

  marker(m: Marker | null): void {
    const hide = m === null;
    if (this.mark.classList.contains('hidden') !== hide) this.mark.classList.toggle('hidden', hide);
    if (!m) return;
    const name = this.mark.querySelector('.m-name')!;
    const dist = this.mark.querySelector('.m-dist')!;
    const d = m.dist >= 3 ? `${m.dist}m` : '';
    let changed = false;
    if (setText(name, m.label)) changed = true;
    const was = dist.textContent?.length;
    // Only a change of digits' count can change its width.
    if (setText(dist, d)) changed ||= was !== d.length;
    const edge = m.edge !== null;
    if (this.mark.classList.contains('edge') !== edge) {
      this.mark.classList.toggle('edge', edge);
      changed = true;
    }
    this.mark.classList.toggle('danger', m.danger);
    this.mark.classList.toggle('nolabel', !m.label && !d);
    if (changed) {
      flushText();
      this.markHalf = this.mark.offsetWidth / 2;
    }
    // Kept whole on screen (a long label by the edge slides inwards).
    const vw = this.vw;
    const half = this.markHalf;
    const x = Math.max(half + 6, Math.min(vw - half - 6, m.x));
    if (m.edge === null) {
      this.mark.style.transform = `translate(${Math.round(x)}px, ${Math.round(m.y)}px) translate(-50%, -100%)`;
      this.mark.style.setProperty('--rot', '0rad');
    } else {
      this.mark.style.transform = `translate(${Math.round(x)}px, ${Math.round(m.y)}px) translate(-50%, -50%)`;
      this.mark.style.setProperty('--rot', `${(m.edge + Math.PI).toFixed(3)}rad`);
    }
  }

  /** Name tags over nearby parts of the fortress (screen points with a fade). */
  partLabels(list: Array<{ x: number; y: number; text: string; alpha: number }>): void {
    this.labelEls.forEach((node, i) => {
      const l = list[i];
      if (!l) {
        if (!node.classList.contains('hidden')) node.classList.add('hidden');
        return;
      }
      if (node.classList.contains('hidden')) node.classList.remove('hidden');
      setText(node, l.text);
      // (Written only when they change: a tag over a part standing still costs nothing.)
      const memo = this.labelMemo[i] ?? (this.labelMemo[i] = { css: '', op: '' });
      const css = `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px) translate(-50%, -100%)`;
      if (memo.css !== css) node.style.transform = memo.css = css;
      const op = l.alpha.toFixed(2);
      if (memo.op !== op) node.style.opacity = memo.op = op;
    });
  }

  /** What each name tag was last moved to. */
  private readonly labelMemo: Array<{ css: string; op: string }> = [];

  /** A step is done: a stamp over the card (the last one cheers louder). */
  done(final: boolean, x: number, y: number): void {
    this.cheer = (this.cheer + 1) % CHEERS.length;
    const word = final ? 'TRAINING COMPLETE!' : CHEERS[this.cheer]!;
    const bits = Array.from({ length: final ? 18 : 10 }, (_, i) => {
      const a = (i / (final ? 18 : 10)) * Math.PI * 2 + Math.random() * 0.4;
      const r = 50 + Math.random() * 50;
      const hue = ['#ffd23a', '#7ee05a', '#5ad0ff', '#ff6a8a', '#ffffff'][i % 5];
      return `<i style="--dx:${Math.round(Math.cos(a) * r)}px;--dy:${Math.round(Math.sin(a) * r * 0.7)}px;background:${hue}"></i>`;
    }).join('');
    setHTML(this.stamp, `<div class="s-in${final ? ' final' : ''}"><b>✓</b><span>${word}</span></div>${bits}`);
    this.stamp.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    this.stamp.classList.remove('hidden', 'go');
    void this.stamp.offsetWidth;
    this.stamp.classList.add('go');
    this.stampTimer = final ? 2.6 : 1.3;
  }

  /** Seconds the step's stamp stays on screen. */
  get stampLeft(): number {
    return Math.max(0, this.stampTimer);
  }

  /** The stamp on screen follows the layout (the card under it changed size). */
  moveStamp(x: number, y: number): void {
    if (this.stampTimer <= 0) return;
    this.stamp.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
  }

  /** The opening flyover's caption (null title hides the overlay). */
  caption(title: string | null, sub: string, skip: string): void {
    this.cine.classList.toggle('hidden', title === null);
    if (title === null) return;
    const t = this.cine.querySelector('.cap .t')!;
    const s = this.cine.querySelector('.cap .s')!;
    if (setText(t, title)) {
      setText(s, sub);
      const cap = this.cine.querySelector('.cap')!;
      cap.classList.remove('in');
      void (cap as HTMLElement).offsetWidth;
      cap.classList.add('in');
    }
    const k = this.cine.querySelector('.skip')!;
    setText(k, skip);
  }

  /** The picture folds away at once (news needs the room under the card). */
  fold(): void {
    if (this.expanded) this.setExpanded(false, 0);
  }

  /** You are getting on with it: the picture folds away (once it has had a moment on screen). */
  busyPlayer(): void {
    if (!this.expanded || !this.view) return;
    if (this.openAge >= (this.view.mode === 'lesson' ? 2.6 : 1.8)) this.setExpanded(false, 0);
  }

  /** Folded to its instruction (the title and the thumbnail go: the card has been read). */
  private setBrief(on: boolean): void {
    this.readAge = 0;
    if (on === this.brief) return;
    this.brief = on;
    this.card.classList.toggle('brief', on);
    this.onResize?.();
  }

  tick(dt: number): void {
    if (this.view && this.view.mode !== 'goal' && !this.expanded && !this.brief) {
      this.readAge += dt;
      // (Sooner on a phone: its view is small.)
      if (this.readAge > (this.pc ? 5.5 : 4)) this.setBrief(true);
    }
    if (this.openFor > 0) {
      this.openFor -= dt;
      this.openAge += dt;
      if (this.openFor <= 0) this.setExpanded(false, 0);
    }
    if (this.stampTimer > 0) {
      this.stampTimer -= dt;
      if (this.stampTimer <= 0) this.stamp.classList.add('hidden');
    }
  }

  /** Everything off (leaving play). */
  clear(): void {
    this.show(null);
    this.setBrief(false);
    this.point(null, true);
    this.marker(null);
    this.partLabels([]);
    this.stamp.classList.add('hidden');
    this.stampTimer = 0;
    this.lastText = '';
    this.lastPips = '';
    setHTML(this.pipsEl, '');
    setText(this.textEl, '');
  }

  /** The card is open with its picture, hiding the view behind it. */
  get open(): boolean {
    return this.expanded;
  }
}
