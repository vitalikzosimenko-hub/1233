// Which control scheme is active: on-screen joystick for touch, keyboard + captured mouse on PC.

export type InputMode = 'touch' | 'desktop';

const DESKTOP_PLATFORMS = /^(pc|desktop|windows|win|mac|macos|linux)$/;
const TOUCH_PLATFORMS = /^(mobile|phone|h5|ios|android|ipad|tablet|touch)$/;

function media(query: string): boolean {
  try {
    return window.matchMedia?.(query).matches ?? false;
  } catch {
    return false;
  }
}

/** The host's `?platform`, read word by word (`mobile_landscape` is a phone's): null when it names neither. */
function hostPlatform(): InputMode | null {
  let words: string[] = [];
  try {
    words = (new URLSearchParams(window.location.search).get('platform') ?? '').trim().toLowerCase().split(/[^a-z0-9]+/);
  } catch {
    words = [];
  }
  if (words.some((word) => TOUCH_PLATFORMS.test(word))) return 'touch';
  if (words.some((word) => DESKTOP_PLATFORMS.test(word))) return 'desktop';
  return null;
}

/**
 * A phone lying on its side: low and wide, a view no computer's window has. On a computer it is a
 * preview's phone frame (the creator's landscape phone), which shows the phone's game: the joystick
 * and buttons, worked by the mouse, with the keys still walking.
 */
export function phoneLandscape(width: number, height: number): boolean {
  return width > height && height <= 440 && width <= 1000;
}

/**
 * The host's `?platform=mobile` or a phone on its side (or its preview) gets touch controls; then the
 * host's `?platform` decides; otherwise the device does: a mouse and no touch screen is a computer,
 * played with the keyboard and mouse in a desktop's frame or an upright one; a touch screen without
 * one is a phone or a tablet. When the browser reports no pointing device at all, a phone-sized view
 * is far more likely than a mouse-less desktop.
 */
export function detectInputMode(width: number, height: number): InputMode {
  const host = hostPlatform();
  if (host === 'touch' || phoneLandscape(width, height)) return 'touch';
  if (host === 'desktop') return 'desktop';
  if (media('(pointer: coarse)') && !media('(hover: hover)')) return 'touch';
  if (media('(pointer: fine)')) return 'desktop';
  const anyFine = media('(any-pointer: fine)');
  if (((navigator.maxTouchPoints ?? 0) > 0 || media('(any-pointer: coarse)')) && !anyFine) return 'touch';
  if (anyFine) return 'desktop';
  return Math.min(width, height) <= 600 && Math.max(width, height) <= 1000 ? 'touch' : 'desktop';
}

/** The device's main pointer is a mouse or a trackpad: a computer, whatever scheme is in use. */
export function mousePrimary(): boolean {
  return media('(pointer: fine)') && media('(hover: hover)');
}

/**
 * Tracks the active scheme. A real touch switches to touch controls and WASD/arrow keys switch back,
 * so hybrid laptops and tablets with keyboards both work. Mouse events never switch modes: emulated
 * clicks on phones must not hide the joystick. A phone on its side (or a preview's frame of one)
 * keeps the joystick under the keys too. Elsewhere the player's choice holds and, until there is
 * one, the scheme follows the view as it changes (a preview switched between its frames).
 */
export class InputModeTracker {
  mode: InputMode;
  private readonly listeners = new Set<(mode: InputMode) => void>();
  private width: number;
  private height: number;
  /** The player chose: a real touch, or the movement keys outside a phone's frame. */
  private choice: InputMode | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.mode = detectInputMode(width, height);
  }

  /** The view changed size (the one resize owner calls this). */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.set(phoneLandscape(width, height) ? 'touch' : this.choice ?? detectInputMode(width, height));
  }

  /** A finger (or pen) on the screen. */
  touched(): void {
    this.choice = 'touch';
    this.set('touch');
  }

  /** WASD, Space or the arrows: the keyboard's scheme, unless the view is a phone's on its side. */
  keyed(): void {
    if (phoneLandscape(this.width, this.height)) return;
    this.choice = 'desktop';
    this.set('desktop');
  }

  set(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const listener of this.listeners) listener(mode);
  }

  onChange(listener: (mode: InputMode) => void): void {
    this.listeners.add(listener);
  }
}
