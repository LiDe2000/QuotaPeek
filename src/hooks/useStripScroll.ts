import { useEffect, useLayoutEffect } from "react";
import type { RefObject } from "react";

function revealActive(element: HTMLElement, activeSelector: string) {
  const active = element.querySelector<HTMLElement>(activeSelector);
  if (!active) return;
  const viewport = element.getBoundingClientRect();
  const bounds = active.getBoundingClientRect();
  if (bounds.left < viewport.left) element.scrollLeft += bounds.left - viewport.left;
  else if (bounds.right > viewport.right) element.scrollLeft += bounds.right - viewport.right;
}

/** Keeps the active item of a horizontal strip in view, and maps a mouse wheel
 *  onto the strip while it can still scroll — the panel takes over at the edges. */
export function useStripScroll<T extends HTMLElement>(strip: RefObject<T | null>, activeSelector: string, activeKey?: unknown) {
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    revealActive(element, activeSelector);
    const observer = new ResizeObserver(() => revealActive(element, activeSelector));
    observer.observe(element);
    return () => observer.disconnect();
  }, [strip, activeSelector, activeKey]);

  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const scroll = (event: WheelEvent) => {
      // Touchpad horizontal gestures already scroll natively. Map a mouse wheel
      // only when this strip can consume it, leaving panel scrolling at its edges.
      if (event.ctrlKey || event.shiftKey || event.deltaX || !event.deltaY) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      const delta = event.deltaY * unit;
      const maximum = element.scrollWidth - element.clientWidth;
      if ((delta < 0 && element.scrollLeft <= 0) || (delta > 0 && element.scrollLeft >= maximum)) return;
      event.preventDefault();
      element.scrollLeft += delta;
    };
    element.addEventListener("wheel", scroll, { passive: false });
    return () => element.removeEventListener("wheel", scroll);
  }, [strip]);
}
