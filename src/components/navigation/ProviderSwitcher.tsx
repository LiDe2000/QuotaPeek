import { useProviderReorder } from "../../hooks/useProviderReorder";
import { useStripScroll } from "../../hooks/useStripScroll";
import type { Provider, ProviderGroup } from "../../lib/providers/providerGroups";
import { providerName } from "../../lib/providers/providerGroups";
import { providerIcon } from "../../lib/providers/providerIcons";
import ProviderOpenButton from "./ProviderOpenButton";

export default function ProviderSwitcher({ groups, selected, onSelect, onReorder }: {
  groups: readonly ProviderGroup[];
  selected?: Provider;
  onSelect: (accountId: string) => void;
  onReorder: (source: Provider, target: Provider) => void;
}) {
  const reorder = useProviderReorder("x", onReorder);
  const strip = reorder.container;
  useStripScroll(strip, '.provider-segment[data-selected="true"]', `${selected ?? ""}:${groups.length}`);

  return <nav ref={strip} className="provider-switcher" aria-label="Select provider">
    {groups.map(group => {
      const { style, "data-provider": provider, "data-reordering": dragging, "data-drop-target": target, ...handlers } = reorder.itemProps(group.providerId);
      return <div key={group.providerId} className={`provider-segment provider-${group.providerId}`} data-provider={provider}
        data-selected={selected === group.providerId} data-reordering={dragging} data-drop-target={target} style={style}>
      <button type="button" {...handlers}
      title="Hold and drag to reorder"
      aria-description="Hold and drag to reorder, or use Alt+Left/Right."
      className="provider-choice"
      aria-pressed={selected === group.providerId} onClick={() => onSelect(group.selected.id)}>
      <img src={providerIcon(group.providerId) ?? undefined} alt="" draggable={false} />
      <span>{providerName[group.providerId]}</span>
      </button>
      <ProviderOpenButton provider={group.providerId} />
    </div>;
    })}
  </nav>;
}
