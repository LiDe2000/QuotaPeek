import { useEffect } from "react";
import type { RefObject } from "react";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fittedWindowHeight, SCREEN_RESERVE } from "../lib/window/windowHeight";
import { physicalHorizontalPlacement } from "../lib/window/windowPlacement";
import type { ExpandSide } from "../lib/window/windowPlacement";

/** One serialized resize path owns dimensions and keeps the rail anchored at screen edges. */
export function useFittedWindowHeight(body: RefObject<HTMLElement | null>, enabled: boolean, fixedViewport = false, stableHeight = true): void {
  useEffect(() => {
    const node = body.current;
    const shell = node?.closest<HTMLElement>(".app-shell");
    if (!node || !shell) return;
    // Diagnostic control: keep React/CSS active, but remove native bounds and
    // region updates from the presentation path. App enables this only in dev.
    const nativeFitEnabled = enabled && !fixedViewport;
    let frame = 0;
    let busy = false;
    let pending = false;
    let disposed = false;
    let dragging = false;
    let geometryRevision = 0;
    let side: ExpandSide = node.dataset.side === "left" ? "left" : "right";
    let screenHeight = window.screen.availHeight;
    let lastSize = { width: window.innerWidth, height: window.innerHeight };
    let lastClip = "";
    let lastContentWidth = window.innerWidth;
    let lastContentHeight = window.innerHeight;
    const stableViewport = navigator.userAgent.includes("Windows");
    let placementDirty = true;
    let expectedPosition: { x: number; y: number } | null = null;
    const observed = new Set<Element>();
    let unlisten: (() => void) | undefined;
    let unlistenScale: (() => void) | undefined;
    let unlistenDrag: (() => void) | undefined;
    const observer = new ResizeObserver(schedule);
    const mutations = new MutationObserver(() => { observeTargets(); schedule(); });

    function measure() {
      if (!node || !shell) return null;
      const style = getComputedStyle(shell);
      const zoom = parseFloat(style.zoom) || 1;
      const fitRatio = Number(node.dataset.scaleFitRatio) || 1;
      const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const availableHeight = fixedViewport ? Math.min(window.innerHeight, screenHeight - SCREEN_RESERVE)
        : screenHeight - SCREEN_RESERVE;
      const ceiling = `${Math.max(verticalPadding, availableHeight / zoom)}px`;
      if (node.style.getPropertyValue("--window-max-height") !== ceiling) node.style.setProperty("--window-max-height", ceiling);
      let content = 0;
      let width = 0;
      const origin = node.getBoundingClientRect().left;
      for (const child of Array.from(node.children) as HTMLElement[]) {
        if (getComputedStyle(child).display === "none") continue;
        const border = child.offsetHeight - child.clientHeight;
        content = Math.max(content, child.offsetTop + child.scrollHeight + border);
        // Rendered bounds include CSS zoom and fractional layout widths.
        width = Math.max(width, child.getBoundingClientRect().right - origin);
      }
      return {
        width: Math.ceil(((Number(node.dataset.scaleLayoutWidth) || width) + horizontalPadding * zoom) * fitRatio),
        height: fittedWindowHeight({ content: content * zoom * fitRatio, panel: 0, chrome: 0, padding: verticalPadding * zoom * fitRatio,
          current: lastContentHeight, screen: screenHeight }) ?? lastContentHeight,
        // Reserved clipping space must not change the rail's layout anchor.
        inset: parseFloat(style.paddingLeft) * zoom,
        railWidth: (node.querySelector<HTMLElement>(".orb-rail")?.offsetWidth ?? 62) * zoom,
        panelWidth: (parseFloat(getComputedStyle(node).getPropertyValue("--main-panel-width")) || 384) * zoom,
        gap: (parseFloat(getComputedStyle(node).columnGap) || 12) * zoom,
      };
    }

    function fitted() {
      window.dispatchEvent?.(new Event("interface-scale-fitted"));
    }

    async function fit() {
      frame = 0;
      if (disposed) return;
      if (dragging) { placementDirty = true; return; }
      if (busy) { pending = true; return; }
      if (!nativeFitEnabled) { measure(); fitted(); return; }
      const measured = measure();
      if (!measured) return;
      if (!placementDirty && measured.width === lastContentWidth && measured.height === lastContentHeight) { fitted(); return; }
      busy = true;
      try {
        const appWindow = getCurrentWindow();
        const revision = geometryRevision;
        placementDirty = false;
        const [monitor, position, scaleFactor] = await Promise.all([currentMonitor(), appWindow.outerPosition(), appWindow.scaleFactor()]);
        if (disposed) return;
        if (dragging || revision !== geometryRevision) { placementDirty = true; pending = true; return; }
        if (monitor) screenHeight = monitor.workArea.size.height / scaleFactor;
        const size = measure();
        if (!size || !node) return;
        // WebView2 can present its old surface after a leftward native resize.
        // Retain the largest surface used on this monitor. Shrinking the native
        // surface after an animation can present stale WebView2 frames; only
        // the visible region should shrink. The region still clips input.
        const viewportWidth = stableViewport
          ? Math.max(size.width, size.panelWidth + size.railWidth + size.gap + size.inset * 2,
            Math.min(lastSize.width, monitor ? monitor.workArea.size.width / scaleFactor : lastSize.width)) : size.width;
        // Keep WebView2's surface height stable when cards change. Only the native
        // visible region follows content; monitor/DPI changes can resize the surface.
        const viewportHeight = stableViewport && stableHeight
          ? Math.max(size.height, 120, Math.round(screenHeight - SCREEN_RESERVE)) : size.height;
        const previousSize = lastSize;
        expectedPosition = position;
        let nextX: number | null = null;
        let nextY = position.y;
        if (monitor) {
          const placement = physicalHorizontalPlacement({ x: position.x, currentWidth: previousSize.width, targetWidth: viewportWidth,
            railWidth: size.railWidth, inset: size.inset, screenLeft: monitor.workArea.position.x,
            screenWidth: monitor.workArea.size.width, side, scaleFactor });
          side = placement.side;
          if (node.dataset.side !== side) node.dataset.side = side;
          if (placement.x !== position.x) nextX = placement.x;
          const top = monitor.workArea.position.y;
          const bottom = top + monitor.workArea.size.height;
          nextY = Math.round(Math.max(top, Math.min(position.y, bottom - Math.round(size.height * scaleFactor))));
        }
        const clip = `${side}:${size.width}:${size.height}:${scaleFactor}`;
        if (nextX !== null || nextY !== position.y || viewportWidth !== previousSize.width || viewportHeight !== previousSize.height || clip !== lastClip) {
          expectedPosition = { x: nextX ?? position.x, y: nextY };
          // Commit position and size together: separate calls expose a narrow,
          // displaced window for one frame when expanding to the left.
          lastSize = { width: viewportWidth, height: viewportHeight };
          const physicalWidth = Math.round(viewportWidth * scaleFactor);
          const visibleWidth = Math.min(physicalWidth, Math.round(size.width * scaleFactor));
          try { const applied = await invoke<boolean>("fit_window_bounds", { bounds: { x: expectedPosition.x, y: expectedPosition.y,
            width: physicalWidth, height: Math.round(viewportHeight * scaleFactor),
            visibleHeight: Math.round(size.height * scaleFactor),
            clipLeft: side === "left" ? physicalWidth - visibleWidth : 0,
            visibleWidth, sourceX: position.x, sourceY: position.y } });
            if (!applied) { lastSize = previousSize; placementDirty = true; pending = true; }
            else { lastClip = clip; lastContentWidth = size.width; lastContentHeight = size.height;
              if (revision === geometryRevision) fitted(); } }
          catch (error) { lastSize = previousSize; throw error; }
        } else fitted();
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
    function scaleChanged() {
      geometryRevision++;
      placementDirty = true;
      schedule();
    }
    window.addEventListener("interface-scale-changed", scaleChanged);
    if (nativeFitEnabled) void getCurrentWindow().onMoved(event => {
      // Our own reposition notification does not require another geometry query.
      if (expectedPosition && Math.abs(event.payload.x - expectedPosition.x) < 1
        && Math.abs(event.payload.y - expectedPosition.y) < 1) return;
      placementDirty = true;
      geometryRevision++;
      if (!dragging) schedule();
    }).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(error => console.warn("Window movement listener was refused", error));
    if (nativeFitEnabled) void getCurrentWindow().onScaleChanged(() => {
      placementDirty = true;
      geometryRevision++;
      if (!dragging) schedule();
    }).then(stop => {
      if (disposed) stop(); else unlistenScale = stop;
    }).catch(error => console.warn("Window scale listener was refused", error));
    if (nativeFitEnabled && stableViewport) void listen<boolean>("desktop-window-dragging", event => {
      dragging = event.payload;
      geometryRevision++;
      placementDirty = true;
      expectedPosition = null;
      // Keep the OS pointer-to-window grab offset unchanged until release.
      if (!dragging) schedule();
    }).then(stop => {
      if (disposed) stop(); else unlistenDrag = stop;
    }).catch(error => console.warn("Window drag listener was refused", error));
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      mutations.disconnect();
      unlisten?.();
      unlistenScale?.();
      unlistenDrag?.();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("interface-scale-changed", scaleChanged);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [body, enabled, fixedViewport, stableHeight]);
}
