import { useEffect, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { fittedWindowHeight } from "../lib/windowHeight";

/**
 * Keeps the window exactly as tall as what it is showing: a card, an open
 * panel, or — with neither — just its own header and footer.
 *
 * The content is measured from the body's children rather than from the body:
 * flex stretches the body to the window, so its own height would echo the
 * window size back and the effect would chase its own tail.
 */
export function useFittedWindowHeight(body: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const target = body.current;
    const quotaWindow = target?.closest<HTMLElement>(".quota-window");
    if (!target || !quotaWindow) return;
    const appWindow = getCurrentWindow();
    let frame = 0;
    let busy = false;
    const observer = new ResizeObserver(schedule);
    const rebind = new MutationObserver(() => { observeTargets(); schedule(); });

    function measure(): number | null {
      const node = body.current;
      const shell = node?.closest<HTMLElement>(".quota-window");
      if (!node || !shell) return null;
      const content = Array.from(node.children).reduce((total, child) => total + child.getBoundingClientRect().height, 0);
      return fittedWindowHeight({
        content,
        panel: panelSpan(node, shell),
        chrome: shell.offsetHeight - node.clientHeight,
        padding: window.innerHeight - shell.offsetHeight,
        current: window.innerHeight,
        screen: window.screen.availHeight,
      });
    }

    /**
     * Room the open panel needs where the body sits. The panel is absolutely
     * positioned above the body, so its own offset is subtracted rather than
     * added; the scroll height keeps the reading stable while the window clamps
     * the panel to its max-height.
     */
    function panelSpan(node: HTMLElement, shell: HTMLElement): number {
      const panel = shell.querySelector<HTMLElement>(".panel");
      if (!panel) return 0;
      return Math.max(panel.scrollHeight, panel.offsetHeight) + panel.offsetTop - node.offsetTop;
    }

    function fit() {
      frame = 0;
      if (busy) return;
      const height = measure();
      if (height === null) return;
      busy = true;
      // A refused resize is not fatal: the inner scroll area still covers the card.
      // It is not silent either — a missing window permission surfaces here.
      void appWindow.setSize(new LogicalSize(window.innerWidth, height))
        .catch(error => console.warn("Window height fit was refused", error))
        .finally(() => { busy = false; });
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(fit);
    }

    // Cards mount and unmount with the account list and panels open over the
    // body, so the observed set follows both.
    function observeTargets() {
      const node = body.current;
      const shell = node?.closest<HTMLElement>(".quota-window");
      if (!node || !shell) return;
      observer.disconnect();
      const targets = [...Array.from(node.children), ...Array.from(shell.querySelectorAll<HTMLElement>(".panel"))];
      for (const child of targets) observer.observe(child);
    }

    observeTargets();
    rebind.observe(target, { childList: true });
    rebind.observe(quotaWindow, { childList: true });
    schedule();
    return () => {
      observer.disconnect();
      rebind.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [body, enabled]);
}
