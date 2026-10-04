/** Change layout once; the compositor animates the visual scale between fits. */
export function transitionScale(from: number, to: number, apply: (value: number) => void,
  reducedMotion: boolean): () => void {
  const node = document.querySelector<HTMLElement>(".window-body");
  apply(to);
  if (reducedMotion || from === to || !node?.animate) return () => {};

  // Cache untransformed target geometry. Native fitting reserves the larger
  // endpoint without following each composited animation frame.
  node.dataset.scaleLayoutWidth = String(node.getBoundingClientRect().width);
  node.dataset.scaleFitRatio = String(Math.max(1, from / to));
  const origin = node.dataset.side === "left" ? "right top" : "left top";
  const animation = node.animate([
    { transform: `scale(${from / to})`, transformOrigin: origin },
    { transform: "scale(1)", transformOrigin: origin },
  ], { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" });
  // Hold the old visual size until native placement has finished. Otherwise
  // the animation and asynchronous HWND movement race each other.
  animation.pause();
  animation.currentTime = 0;
  let waiting = true;
  function start() {
    if (!waiting) return;
    waiting = false;
    clearTimeout(fallback);
    window.removeEventListener("interface-scale-fitted", start);
    const readyOrigin = node!.dataset.side === "left" ? "right top" : "left top";
    (animation.effect as KeyframeEffect | null)?.setKeyframes([
      { transform: `scale(${from / to})`, transformOrigin: readyOrigin },
      { transform: "scale(1)", transformOrigin: readyOrigin },
    ]);
    animation.play();
  }
  window.addEventListener("interface-scale-fitted", start);
  const fallback = setTimeout(start, 200);
  let active = true;
  function clear() {
    if (!active) return;
    active = false;
    delete node!.dataset.scaleLayoutWidth;
    delete node!.dataset.scaleFitRatio;
  }
  animation.onfinish = () => {
    clear();
    animation.cancel();
    window.dispatchEvent(new Event("interface-scale-changed"));
  };
  return () => {
    waiting = false;
    clearTimeout(fallback);
    window.removeEventListener("interface-scale-fitted", start);
    animation.onfinish = null;
    animation.cancel();
    clear();
  };
}
