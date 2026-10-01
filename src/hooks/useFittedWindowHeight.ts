import { useEffect } from "react";
import type { RefObject } from "react";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { fittedWindowHeight, SCREEN_RESERVE } from "../lib/windowHeight";
import { horizontalPlacement } from "../lib/windowPlacement";
import type { ExpandSide } from "../lib/windowPlacement";

/** One serialized resize path owns dimensions and keeps the rail anchored at screen edges. */
export function useFittedWindowHeight(body: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const node = body.current;
    const shell = node?.closest<HTMLElement>(".app-shell");
    if (!node || !shell) return;
    let frame = 0;
    let busy = false;
    let pending = false;
    let disposed = false;
    let side: ExpandSide = "right";
    let screenHeight = window.screen.availHeight;
    let lastSize = { width: window.innerWidth, height: window.innerHeight };
    let placementDirty = true;
    let expectedPosition: { x: number; y: number } | null = null;
    const observed = new Set<Element>();
    let unlisten: (() => void) | undefined;
    const observer = new ResizeObserver(schedule);
    const mutations = new MutationObserver(() => { observeTargets(); schedule(); });

    function measure() {
      if (!node || !shell) return null;
      const style = getComputedStyle(shell);
      const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const ceiling = `${Math.max(verticalPadding, screenHeight - SCREEN_RESERVE)}px`;
      if (node.style.getPropertyValue("--window-max-height") !== ceiling) node.style.setProperty("--window-max-height", ceiling);
      let content = 0;
      let width = 0;
      for (const child of Array.from(node.children) as HTMLElement[]) {
        if (getComputedStyle(child).display === "none") continue;
        const border = child.offsetHeight - child.clientHeight;
        content = Math.max(content, child.offsetTop + child.scrollHeight + border);
        width = Math.max(width, child.offsetLeft + child.offsetWidth);
      }
      return {
        width: Math.ceil(width + horizontalPadding),
        height: fittedWindowHeight({ content, panel: 0, chrome: 0, padding: verticalPadding,
          current: lastSize.height, screen: screenHeight }) ?? lastSize.height,
        inset: parseFloat(style.paddingLeft),
        railWidth: node.querySelector<HTMLElement>(".orb-rail")?.offsetWidth ?? 62,
      };
    }

    async function fit() {
      frame = 0;
      if (disposed) return;
      if (busy) { pending = true; return; }
      if (!enabled) { measure(); return; }
      const measured = measure();
      if (!measured || (!placementDirty && measured.width === lastSize.width && measured.height === lastSize.height)) return;
      busy = true;
      try {
        const appWindow = getCurrentWindow();
        placementDirty = false;
        const [monitor, position] = await Promise.all([currentMonitor(), appWindow.outerPosition()]);
        if (disposed) return;
        if (monitor) screenHeight = monitor.workArea.size.height / monitor.scaleFactor;
        const size = measure();
        if (!size || !node) return;
        const previousSize = lastSize;
        expectedPosition = position;
        let nextX: number | null = null;
        if (monitor) {
          const x = position.x / monitor.scaleFactor;
          const placement = horizontalPlacement({ x, currentWidth: previousSize.width, targetWidth: size.width,
            railWidth: size.railWidth, inset: size.inset, screenLeft: monitor.workArea.position.x / monitor.scaleFactor,
            screenWidth: monitor.workArea.size.width / monitor.scaleFactor, side });
          side = placement.side;
          if (node.dataset.side !== side) node.dataset.side = side;
          if (Math.abs(placement.x - x) > 0.5) nextX = placement.x;
        }
        if (size.width !== previousSize.width || size.height !== previousSize.height) {
          // The native command can finish before WebView reports its new viewport.
          // Compare subsequent fits against the requested size, not that old viewport.
          lastSize = { width: size.width, height: size.height };
          try { await appWindow.setSize(new LogicalSize(size.width, size.height)); }
          catch (error) { lastSize = previousSize; throw error; }
        }
        if (!disposed && nextX !== null && monitor) {
          expectedPosition = { x: nextX * monitor.scaleFactor, y: position.y };
          await appWindow.setPosition(new LogicalPosition(nextX, position.y / monitor.scaleFactor));
        }
      } catch (error) { placementDirty = true; console.warn("Window fit was refused", error); }
      finally {
        busy = false;
        if (pending && !disposed) { pending = false; schedule(); }
      }
    }
    function schedule() {
      if (!disposed && !frame) frame = requestAnimationFrame(() => { void fit(); });
    }
    function observeTargets() {
      if (!node || !shell) return;
      // Retain existing registrations: re-observing every node emits fresh resize
      // notifications even when a text update has not changed the layout.
      const targets = new Set<Element>([shell, node, ...node.querySelectorAll("*")]);
      for (const target of observed) if (!targets.has(target)) {
        observer.unobserve(target);
        observed.delete(target);
      }
      for (const target of targets) if (!observed.has(target)) {
        observer.observe(target);
        observed.add(target);
      }
    }
    observeTargets();
    mutations.observe(node, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("resize", schedule);
    if (enabled) void getCurrentWindow().onMoved(event => {
      // Our own reposition notification does not require another geometry query.
      if (expectedPosition && Math.abs(event.payload.x - expectedPosition.x) < 1
        && Math.abs(event.payload.y - expectedPosition.y) < 1) return;
      placementDirty = true;
      schedule();
    }).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(error => console.warn("Window movement listener was refused", error));
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      mutations.disconnect();
      unlisten?.();
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [body, enabled]);
}
