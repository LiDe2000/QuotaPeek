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
    let unlisten: (() => void) | undefined;
    const observer = new ResizeObserver(schedule);
    const mutations = new MutationObserver(() => { observeTargets(); schedule(); });

    function measure() {
      if (!node || !shell) return null;
      const style = getComputedStyle(shell);
      const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      node.style.setProperty("--window-max-height", `${Math.max(verticalPadding, screenHeight - SCREEN_RESERVE)}px`);
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
          current: window.innerHeight, screen: screenHeight }) ?? window.innerHeight,
        inset: parseFloat(style.paddingLeft),
        railWidth: node.querySelector<HTMLElement>(".orb-rail")?.offsetWidth ?? 62,
      };
    }

    async function fit() {
      frame = 0;
      if (disposed) return;
      if (busy) { pending = true; return; }
      if (!enabled) { measure(); return; }
      busy = true;
      try {
        const appWindow = getCurrentWindow();
        const [monitor, position] = await Promise.all([currentMonitor(), appWindow.outerPosition()]);
        if (disposed) return;
        if (monitor) screenHeight = monitor.workArea.size.height / monitor.scaleFactor;
        const size = measure();
        if (!size || !node) return;
        let nextX: number | null = null;
        if (monitor) {
          const x = position.x / monitor.scaleFactor;
          const placement = horizontalPlacement({ x, currentWidth: window.innerWidth, targetWidth: size.width,
            railWidth: size.railWidth, inset: size.inset, screenLeft: monitor.workArea.position.x / monitor.scaleFactor,
            screenWidth: monitor.workArea.size.width / monitor.scaleFactor, side });
          side = placement.side;
          node.dataset.side = side;
          if (Math.abs(placement.x - x) > 0.5) nextX = placement.x;
        }
        if (size.width !== window.innerWidth || size.height !== window.innerHeight) {
          await appWindow.setSize(new LogicalSize(size.width, size.height));
        }
        if (!disposed && nextX !== null && monitor) {
          await appWindow.setPosition(new LogicalPosition(nextX, position.y / monitor.scaleFactor));
        }
      } catch (error) { console.warn("Window fit was refused", error); }
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
      observer.disconnect();
      observer.observe(shell);
      observer.observe(node);
      for (const child of node.querySelectorAll("*")) observer.observe(child);
    }
    observeTargets();
    mutations.observe(node, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    if (enabled) void getCurrentWindow().onMoved(schedule).then(stop => {
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
