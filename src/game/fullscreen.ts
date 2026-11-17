// Fullscreen, where the page may have it: a computer's whole screen when play begins (and from the
// pause menu), a phone's with its display held on its side where the browser can lock that.

interface PrefixedDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

interface PrefixedElement {
  webkitRequestFullscreen?: () => void;
}

/** The page may go fullscreen (not every embed allows it; an iPhone never does). */
export function canFullscreen(): boolean {
  const d = document as Document & PrefixedDocument;
  return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as Document & PrefixedDocument;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Holds a phone's display on its side (only possible in fullscreen, and not everywhere). */
function lockLandscape(): void {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
    const pending = o?.lock?.('landscape');
    if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
  } catch {
    // not supported here
  }
}

/** Fullscreen (and, on a phone, its display held on its side). Must run inside a tap or a click. */
export function enterFullscreen(phone: boolean): void {
  if (!canFullscreen()) return;
  if (isFullscreen()) {
    if (phone) lockLandscape();
    return;
  }
  const page = document.documentElement as HTMLElement & PrefixedElement;
  try {
    if (typeof page.requestFullscreen === 'function') {
      const pending = page.requestFullscreen({ navigationUI: 'hide' });
      if (pending && typeof pending.then === 'function') {
        pending.then(() => {
          if (phone) lockLandscape();
        }, () => undefined);
      }
    } else page.webkitRequestFullscreen?.();
  } catch {
    // refused (no tap behind it, or the embed does not allow it)
  }
}

export function exitFullscreen(): void {
  const d = document as Document & PrefixedDocument;
  try {
    if (d.fullscreenElement && typeof d.exitFullscreen === 'function') {
      const pending = d.exitFullscreen();
      if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
    } else if (d.webkitFullscreenElement) d.webkitExitFullscreen?.();
  } catch {
    // already out
  }
}

/** Calls back whenever the page goes in or out of fullscreen. */
export function onFullscreenChange(callback: () => void): void {
  document.addEventListener('fullscreenchange', callback);
  document.addEventListener('webkitfullscreenchange', callback);
}
