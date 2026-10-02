import { useEffect, useLayoutEffect, useRef } from "react";
import type { Provider, ProviderGroup } from "../lib/providerGroups";
import { providerName } from "../lib/providerGroups";
import { providerIcon } from "../lib/providerIcons";

export default function ProviderSwitcher({ groups, selected, onSelect }: {
  groups: readonly ProviderGroup[];
  selected?: Provider;
  onSelect: (accountId: string) => void;
}) {
  const strip = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    function revealSelected() {
      const button = element!.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!button) return;
      const viewport = element!.getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      if (bounds.left < viewport.left) element!.scrollLeft += bounds.left - viewport.left;
      else if (bounds.right > viewport.right) element!.scrollLeft += bounds.right - viewport.right;
    }
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected, groups.length]);

  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    function scroll(event: WheelEvent) {
      // Touchpad horizontal gestures already scroll natively. Map a mouse wheel
      // only when this strip can consume it, leaving panel scrolling at its edges.
      if (event.ctrlKey || event.shiftKey || event.deltaX || !event.deltaY) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientWidth : 1;
      const delta = event.deltaY * unit;
      const maximum = element!.scrollWidth - element!.clientWidth;
      if ((delta < 0 && element!.scrollLeft <= 0) || (delta > 0 && element!.scrollLeft >= maximum)) return;
      event.preventDefault();
      element!.scrollLeft += delta;
    }
    element.addEventListener("wheel", scroll, { passive: false });
    return () => element.removeEventListener("wheel", scroll);
  }, []);

  return <nav ref={strip} className="provider-switcher" aria-label="Select provider">
    {groups.map(group => <button type="button" key={group.providerId}
      className={`provider-choice provider-${group.providerId}`}
      aria-pressed={selected === group.providerId} onClick={() => onSelect(group.selected.id)}>
      <img src={providerIcon(group.providerId) ?? undefined} alt="" draggable={false} />
      <span>{providerName[group.providerId]}</span>
    </button>)}
  </nav>;
}
