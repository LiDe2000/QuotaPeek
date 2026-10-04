import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode, RefObject } from "react";
import { carouselNext, carouselOffset } from "../../lib/navigation/centeredCarousel";
import "./CenteredCarousel.css";

type ItemProps = HTMLAttributes<HTMLElement> & { "data-offset": number; "data-wrap": boolean };

/** One live instance per option: launch buttons, radio inputs and drag state are
 * never duplicated. Only the positions wrap around the selected center. */
export default function CenteredCarousel<T>({ items, selected, itemKey, onSelect, renderItem, label, className = "", containerRef, isInteracting }: {
  items: readonly T[];
  selected?: string;
  itemKey: (item: T) => string;
  onSelect: (item: T) => void;
  renderItem: (item: T, props: ItemProps) => ReactNode;
  label: string;
  className?: string;
  containerRef?: RefObject<HTMLElement | null>;
  isInteracting?: () => boolean;
}) {
  const ownRef = useRef<HTMLElement>(null);
  const root = containerRef ?? ownRef;
  const looping = items.length > 3;
  const active = Math.max(0, items.findIndex(item => itemKey(item) === selected));
  const previous = useRef(new Map<string, number>());
  const offsets = items.map((_, index) => looping ? carouselOffset(index, active, items.length) : index);
  const latest = useRef({ items, active, onSelect, isInteracting, looping });
  latest.current = { items, active, onSelect, isInteracting, looping };

  useLayoutEffect(() => {
    previous.current = new Map(items.map((item, index) => [itemKey(item), offsets[index]]));
  });

  function selectIndex(index: number, focus = false) {
    const item = items[index];
    if (!item) return;
    onSelect(item);
    if (focus) root.current?.children[index]?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  }

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let total = 0, last = 0, lastEvent = 0;
    function wheel(event: WheelEvent) {
      const current = latest.current;
      if (!current.looping || event.ctrlKey || event.altKey || event.metaKey || current.isInteracting?.()) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      const now = Date.now();
      if (now - last < 240) return;
      if (now - lastEvent > 500 || Math.sign(total) !== Math.sign(delta)) total = 0;
      lastEvent = now;
      total += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
      if (Math.abs(total) < 24) return;
      last = now;
      current.onSelect(current.items[carouselNext(current.active, Math.sign(total), current.items.length)]);
      total = 0;
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [root]);

  return <div ref={root as RefObject<HTMLDivElement | null>} className={`centered-carousel ${className}`} role="group" aria-label={label} data-looping={looping}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || isInteracting?.()) return;
      const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!direction && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      selectIndex(event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : carouselNext(active, direction, items.length), true);
    }}>
    {items.map((item, index) => {
      const offset = offsets[index];
      const old = previous.current.get(itemKey(item));
      return renderItem(item, {
        className: "centered-carousel-item",
        "data-offset": offset,
        "data-wrap": looping && old !== undefined && Math.abs(old - offset) > items.length / 2,
        style: { "--carousel-offset": offset } as CSSProperties,
      });
    })}
  </div>;
}
