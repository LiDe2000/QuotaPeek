import { providerIcon } from "../lib/providerIcons";
import { providerName } from "../lib/providerGroups";
import type { Provider } from "../lib/providerGroups";

/** Connection screens share the product logos used by provider navigation. */
export default function PlatformMark({ provider }: { provider: Provider }) {
  const icon = providerIcon(provider);
  return <span className="platform-mark" aria-hidden="true">
    {icon ? <img src={icon} alt="" draggable={false} /> : providerName[provider].charAt(0)}
  </span>;
}
