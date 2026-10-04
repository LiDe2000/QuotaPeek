import { useProviderReorder } from "../../hooks/useProviderReorder";
import CenteredCarousel from "../shared/CenteredCarousel";
import type { Provider, ProviderGroup } from "../../lib/providers/providerGroups";
import { providerName } from "../../lib/providers/providerGroups";
import { providerIcon } from "../../lib/providers/providerIcons";
import ProviderOpenButton from "./ProviderOpenButton";

export default function ProviderSwitcher({ groups, selected, onSelect, onReorder, launchDisabled = false }: {
  groups: readonly ProviderGroup[];
  selected?: Provider;
  onSelect: (accountId: string) => void;
  onReorder: (source: Provider, target: Provider) => void;
  launchDisabled?: boolean;
}) {
  const reorder = useProviderReorder("x", onReorder);
  const strip = reorder.container;
  return <CenteredCarousel items={groups} selected={selected} itemKey={group => group.providerId}
    onSelect={group => onSelect(group.selected.id)} label="Select provider" className="provider-switcher"
    containerRef={strip} isInteracting={reorder.isPressed} renderItem={(group, slot) => {
      const { style, "data-provider": provider, "data-reordering": dragging, "data-drop-target": target, "data-sort-preview": sorting, ...handlers } = reorder.itemProps(group.providerId);
      return <div {...slot} key={group.providerId} className={`${slot.className} provider-segment provider-${group.providerId}`} data-provider={provider}
        data-selected={selected === group.providerId} data-reordering={dragging} data-drop-target={target} data-sort-preview={sorting} style={{ ...slot.style, ...style }}>
      <button type="button" {...handlers}
      title="Hold and drag to reorder"
      aria-description="Hold and drag to reorder, or use Alt+Left/Right."
      className="provider-choice"
      tabIndex={selected === group.providerId ? 0 : -1}
      aria-pressed={selected === group.providerId} onClick={() => onSelect(group.selected.id)}>
      <img src={providerIcon(group.providerId) ?? undefined} alt="" draggable={false} />
      <span>{providerName[group.providerId]}</span>
      </button>
      <ProviderOpenButton provider={group.providerId} disabled={launchDisabled} tabIndex={selected === group.providerId ? 0 : -1} />
    </div>;
    }} />;
}
