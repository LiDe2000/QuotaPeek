import { useProviderReorder } from "../../hooks/useProviderReorder";
import { useStripScroll } from "../../hooks/useStripScroll";
import type { Provider, ProviderGroup } from "../../lib/providers/providerGroups";
import { providerName } from "../../lib/providers/providerGroups";
import { providerIcon } from "../../lib/providers/providerIcons";

export default function ProviderSwitcher({ groups, selected, onSelect, onReorder }: {
  groups: readonly ProviderGroup[];
  selected?: Provider;
  onSelect: (accountId: string) => void;
  onReorder: (source: Provider, target: Provider) => void;
}) {
  const reorder = useProviderReorder("x", onReorder);
  const strip = reorder.container;
  useStripScroll(strip, '[aria-pressed="true"]', `${selected ?? ""}:${groups.length}`);

  return <nav ref={strip} className="provider-switcher" aria-label="Select provider">
    {groups.map(group => <button type="button" key={group.providerId}
      {...reorder.itemProps(group.providerId)}
      title="Hold and drag to reorder"
      aria-description="Hold and drag to reorder, or use Alt+Left/Right."
      className={`provider-choice provider-${group.providerId}`}
      aria-pressed={selected === group.providerId} onClick={() => onSelect(group.selected.id)}>
      <img src={providerIcon(group.providerId) ?? undefined} alt="" draggable={false} />
      <span>{providerName[group.providerId]}</span>
    </button>)}
  </nav>;
}
