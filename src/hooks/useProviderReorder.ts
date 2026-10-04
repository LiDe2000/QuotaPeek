import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, MouseEvent, KeyboardEvent } from "react";
import type { Provider } from "../lib/providers/providerGroups";

type Drag = { source: Provider; target: Provider | null; delta: number };
type Gesture = {
  id: number; source: Provider; button: HTMLElement; start: number; point: number; cross: number;
  scroll: number; maxScroll: number; x: number; y: number; active: boolean;
};

/** Both provider surfaces use the same long press, drop and cancellation rules. */
export function useProviderReorder(axis: "x" | "y", onReorder: (source: Provider, target: Provider) => void, onPress?: () => void) {
  const container = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const blockedClick = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef({ onReorder, onPress });
  latest.current = { onReorder, onPress };
  const currentDrag = useRef<Drag | null>(null);

  function update() {
    const g = gesture.current, root = container.current;
    if (!g?.active || !root) return;
    const bounds = root.getBoundingClientRect();
    const zoom = axis === "x" ? (bounds.right - bounds.left) / (root.offsetWidth || root.clientWidth)
      : (bounds.bottom - bounds.top) / (root.offsetHeight || root.clientHeight);
    const low = axis === "x" ? bounds.left : bounds.top;
    const high = axis === "x" ? bounds.right : bounds.bottom;
    const crossLow = axis === "x" ? bounds.top : bounds.left;
    const crossHigh = axis === "x" ? bounds.bottom : bounds.right;
    const inside = g.cross >= crossLow - 24 && g.cross <= crossHigh + 24 && g.point >= low - 24 && g.point <= high + 24;
    if (inside) {
      const step = g.point < low + 20 ? -5 : g.point > high - 20 ? 5 : 0;
      // A transformed dragged item can enlarge browser scroll overflow. Keep
      // scrolling within the list's original extent, not that moving overflow.
      if (axis === "x") root.scrollLeft = Math.max(0, Math.min(g.maxScroll, root.scrollLeft + step));
      else root.scrollTop = Math.max(0, Math.min(g.maxScroll, root.scrollTop + step));
    }
    const scroll = axis === "x" ? root.scrollLeft : root.scrollTop;
    let target: Provider | null = null, distance = Infinity;
    if (inside) for (const button of root.querySelectorAll<HTMLElement>("[data-provider]")) {
      const center = low + ((axis === "x" ? button.offsetLeft + button.offsetWidth / 2 : button.offsetTop + button.offsetHeight / 2) - scroll) * zoom;
      if (Math.abs(center - g.point) < distance) { distance = Math.abs(center - g.point); target = button.dataset.provider as Provider; }
    }
    const next = { source: g.source, target, delta: (g.point - g.start) / zoom + scroll - g.scroll };
    currentDrag.current = next;
    setDrag(previous => previous?.target === next.target && previous.delta === next.delta ? previous : next);
    frame.current = requestAnimationFrame(update);
  }

  function finish(commit: boolean) {
    if (timer.current !== null) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    timer.current = null; frame.current = null;
    const g = gesture.current, result = currentDrag.current;
    if (g && !commit) blockedClick.current = true;
    gesture.current = null; currentDrag.current = null;
    if (g?.button.hasPointerCapture(g.id)) g.button.releasePointerCapture(g.id);
    setDrag(null);
    if (commit && g?.active && result?.target && result.source !== result.target) latest.current.onReorder(result.source, result.target);
  }

  useEffect(() => {
    const cancel = () => finish(false);
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); cancel(); } };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    return () => { cancel(); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape); };
  }, []);

  function pointerDown(event: PointerEvent<HTMLButtonElement>, source: Provider) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    blockedClick.current = false;
    latest.current.onPress?.();
    const root = container.current!;
    gesture.current = { id: event.pointerId, source, button: event.currentTarget, start: axis === "x" ? event.clientX : event.clientY,
      point: axis === "x" ? event.clientX : event.clientY, cross: axis === "x" ? event.clientY : event.clientX,
      scroll: axis === "x" ? root.scrollLeft : root.scrollTop,
      maxScroll: axis === "x" ? root.scrollWidth - root.clientWidth : root.scrollHeight - root.clientHeight,
      x: event.clientX, y: event.clientY, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!gesture.current) return;
      gesture.current.active = true;
      blockedClick.current = true;
      update();
    }, 450);
  }

  return {
    container,
    isPressed: () => gesture.current !== null,
    itemProps: (provider: Provider) => ({
      "data-provider": provider,
      "data-reordering": drag?.source === provider || undefined,
      "data-drop-target": drag?.target === provider && drag.source !== provider || undefined,
      style: drag?.source === provider ? { transform: `translate${axis.toUpperCase()}(${drag.delta}px) scale(1.06)` } as CSSProperties : undefined,
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => pointerDown(event, provider),
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const g = gesture.current;
        if (!g || event.pointerId !== g.id) return;
        if (!g.active && Math.hypot(event.clientX - g.x, event.clientY - g.y) > 8) { blockedClick.current = true; finish(false); return; }
        g.point = axis === "x" ? event.clientX : event.clientY;
        g.cross = axis === "x" ? event.clientY : event.clientX;
        if (g.active) event.preventDefault();
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        const g = gesture.current;
        if (!g || event.pointerId !== g.id) return;
        g.point = axis === "x" ? event.clientX : event.clientY;
        g.cross = axis === "x" ? event.clientY : event.clientX;
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        update();
        finish(true);
      },
      onPointerCancel: () => { blockedClick.current = true; finish(false); },
      onLostPointerCapture: () => { if (gesture.current) { blockedClick.current = true; finish(false); } },
      onClickCapture: (event: MouseEvent<HTMLButtonElement>) => {
        if (blockedClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
      },
      onContextMenu: (event: MouseEvent<HTMLButtonElement>) => { if (gesture.current) event.preventDefault(); },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!event.altKey) return;
        const direction = event.key === (axis === "x" ? "ArrowLeft" : "ArrowUp") ? -1 : event.key === (axis === "x" ? "ArrowRight" : "ArrowDown") ? 1 : 0;
        if (!direction) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = Array.from(container.current!.querySelectorAll<HTMLButtonElement>("[data-provider]"));
        const index = buttons.indexOf((event.currentTarget.closest?.("[data-provider]") ?? event.currentTarget) as HTMLButtonElement);
        const target = buttons[index + direction]?.dataset.provider as Provider | undefined;
        if (target) latest.current.onReorder(provider, target);
      },
    }),
  };
}
