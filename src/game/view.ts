// The game view's own coordinates. On a phone held upright the surface lies turned a quarter across
// the screen (see surface-template.ts): the browser's client coordinates (pointer events, bounding
// boxes) are the screen's, and these give the view's.

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/** A pointer's client position in the view. */
export function viewPoint(clientX: number, clientY: number): { x: number; y: number } {
  const s = window.__surfaceTemplate;
  return s ? s.toViewportPoint(clientX, clientY) : { x: clientX, y: clientY };
}

/** A client movement (pointer lock's movementX/Y) in the view. */
export function viewDelta(dx: number, dy: number): { x: number; y: number } {
  const s = window.__surfaceTemplate;
  return s ? s.toViewportDelta(dx, dy) : { x: dx, y: dy };
}

/** An element's (or a text range's) box in the view. */
export function viewRect(target: Element | Range): ViewRect {
  const r = target.getBoundingClientRect();
  const s = window.__surfaceTemplate;
  const v = s ? s.toViewportRect(r) : { x: r.left, y: r.top, width: r.width, height: r.height };
  return { x: v.x, y: v.y, width: v.width, height: v.height, right: v.x + v.width, bottom: v.y + v.height };
}
