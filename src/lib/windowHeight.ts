/**
 * Window height fitting. The arithmetic lives here so the resize hook stays a
 * thin measurement wrapper and the rules stay testable without a window.
 */

/** The window never grows closer than this to the screen edge. */
export const SCREEN_RESERVE = 80;

/** Rounding slack, in pixels, that already counts as "the right height". */
const DEAD_ZONE = 2;

/** Breathing room that absorbs the rounding done by the layout and the OS. */
const FIT_SLACK = 4;

export interface WindowFit {
  /** Natural height of the body content; it must not depend on the window height. */
  content: number;
  /** Span the open panel needs in place of the body; 0 when no panel is open. */
  panel: number;
  /** What the window spends besides the body: padding, header, footer, gaps. */
  chrome: number;
  /** What the shell spends around the window. */
  padding: number;
  /** Inner height the window has right now. */
  current: number;
  /** Usable height of the current screen. */
  screen: number;
}

/**
 * Height that shows the whole card — or the whole panel — without scrolling, or
 * null when the window already has it.
 *
 * The floor is the window's own chrome: with no card and no panel open, the
 * window is nothing but its header and footer. The ceiling stays a screen
 * reserve away from the edge, so taller content falls back to the inner scroll
 * area instead of running off the screen.
 */
export function fittedWindowHeight({ content, panel, chrome, padding, current, screen }: WindowFit): number | null {
  const floor = chrome + padding;
  const ceiling = Math.max(floor, Math.round(screen - SCREEN_RESERVE));
  const wanted = Math.ceil(Math.max(content, panel) + floor + FIT_SLACK);
  const target = Math.min(Math.max(wanted, floor), ceiling);
  return Math.abs(target - current) <= DEAD_ZONE ? null : target;
}
