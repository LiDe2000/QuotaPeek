import type { Provider } from "../../lib/providers/providerGroups";
import { providerName } from "../../lib/providers/providerGroups";
import Icon from "../shared/Icon";

export default function ProviderOpenButton({ provider }: { provider: Provider }) {
  const name = provider === "deepseek" ? "DeepSeek Harness" : providerName[provider];
  return <span className="provider-open-control" title={`Open ${name} · Coming soon`}>
    <button type="button" className="provider-open-trigger" aria-label={`Open ${name}`} disabled>
      <Icon name="open-app" />
    </button>
  </span>;
}
