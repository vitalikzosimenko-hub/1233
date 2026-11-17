// The partner's interface as the host's game sees it: every call is sent to the partner's
// device; the shared news among them (banners, briefings, story cards...) shows on the host too.
import type { BannerTone, GameUI, Outcome } from '../game';
import type { Lesson } from '../guide';
import type { Feat } from '../feats';
import type { BubbleKind } from '../chatter';
import type { Vec3 } from '../math3d';
import type { StoryKind, TalkMood } from '../ui';

/** Shared news: shown to both players whoever's action set it off. */
export function sharedUI(method: string, args: unknown[]): boolean {
  switch (method) {
    case 'banner':
    case 'briefing':
    case 'story':
    case 'showResult':
      return true;
    case 'damage':
      return args[4] === 'big';
    default:
      return false;
  }
}

export class RemoteUI implements GameUI {
  /** Sends one call to the partner's device. */
  private readonly send: (method: string, args: unknown[]) => void;
  /** The host's own interface (for shared news). */
  private readonly local: () => GameUI;

  constructor(send: (method: string, args: unknown[]) => void, local: () => GameUI) {
    this.send = send;
    this.local = local;
  }

  private call(method: keyof GameUI & string, args: unknown[]): void {
    this.send(method, args);
    if (sharedUI(method, args)) {
      const ui = this.local() as unknown as Record<string, (...a: unknown[]) => void>;
      ui[method]?.(...args);
    }
  }

  toast(text: string, icon?: string): void {
    this.call('toast', [text, icon]);
  }

  banner(title: string, sub: string, tone: BannerTone): void {
    this.call('banner', [title, sub, tone]);
  }

  setHint(): void {
    // the partner's device works out its own hints
  }

  onPhaseChanged(): void {
    // follows from the shared state
  }

  onInventoryChanged(): void {
    // follows from the shared state
  }

  showResult(outcome: Outcome): void {
    this.call('showResult', [outcome]);
  }

  openWorkshop(): void {
    this.send('openWorkshop', []);
  }

  openMap(): void {
    this.send('openMap', []);
  }

  openVillage(index: number): void {
    this.send('openVillage', [index]);
  }

  openWanderer(): void {
    this.send('openWanderer', []);
  }

  briefing(title: string, sub: string, lines: string[], tone: BannerTone): void {
    this.call('briefing', [title, sub, lines, tone]);
  }

  flash(kind: 'gold' | 'red' | 'white' | 'impact'): void {
    this.send('flash', [kind]);
  }

  tip(text: string): void {
    this.send('tip', [text]);
  }

  clearTip(): void {
    this.send('clearTip', []);
  }

  story(kind: StoryKind, id: string): void {
    this.call('story', [kind, id]);
  }

  talk(id: string, lines: string[], mood: TalkMood): void {
    this.send('talk', [id, lines, mood]);
  }

  damage(n: number, x: number, y: number, z: number, kind: 'hit' | 'crit' | 'streak' | 'big', text?: string): void {
    this.call('damage', [n, x, y, z, kind, text]);
  }

  hurtFrom(angle: number): void {
    this.send('hurtFrom', [angle]);
  }

  flyItem(id: number, x: number, y: number, z: number): void {
    this.send('flyItem', [id, x, y, z]);
  }

  coachDone(): void {
    // the training is the host's
  }

  levelUp(level: number): void {
    this.send('levelUp', [level]);
  }

  lesson(_l: Lesson): void {
    // lessons are worked out on each device
  }

  say(at: () => Vec3 | null, text: string, kind: BubbleKind): void {
    // A speech bubble: its speaker's spot goes with it (the bubble stays where it was said).
    const p = at();
    if (p) this.send('say', [p[0], p[1], p[2], text, kind]);
  }

  feat(_f: Feat): void {
    // feats are earned on the partner's own device (see PlayerSink.feat)
  }

  effectsChanged(): void {
    // the partner's effects travel with its state
  }

  totem(): void {
    this.send('totem', []);
  }

  get hintsOn(): boolean {
    return true;
  }

  get briefOpen(): boolean {
    return false;
  }

  get lessonOpen(): boolean {
    return false;
  }

  get lessonUrgentOnly(): boolean {
    return false;
  }

  get bannerOpen(): boolean {
    return false;
  }
}
