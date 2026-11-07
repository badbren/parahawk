/**
 * Where windows open by default (owner, 2026-11-06): "nice and large, but I can
 * see the left icons". The window fills the desktop area to the right of the
 * icon columns, with a small margin all round. The window manager asks this
 * each time a window opens without a saved place (wm/types.ts `largeArea`).
 */
import type { Rect } from "../wm/types";

/** Space between the icons and the window, and around the other edges (px). */
const GAP = 12;
const EDGE = 8;
/** Narrower than this and the window may cover icons rather than get cramped. */
const MIN_W = 560;

/**
 * `icons` and `windows` both fill the same desktop area (shell.css), so an
 * icon's offset from the icon grid is also its offset in window coordinates.
 */
export function largeAreaBeside(icons: HTMLElement, windows: HTMLElement): Rect | null {
  const rw = windows.clientWidth;
  const rh = windows.clientHeight;
  if (rw <= 0 || rh <= 0) return null;

  const base = icons.getBoundingClientRect();
  let right = 0;
  for (const el of icons.querySelectorAll<HTMLElement>(".ph-icon")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0) right = Math.max(right, r.right - base.left);
  }

  let x = right > 0 ? Math.round(right + GAP) : EDGE;
  let w = rw - x - EDGE;
  if (w < MIN_W) {
    w = Math.max(1, Math.min(rw - 2 * EDGE, MIN_W));
    x = Math.max(EDGE, rw - EDGE - w);
  }
  return { x, y: EDGE, w, h: Math.max(1, rh - 2 * EDGE) };
}
