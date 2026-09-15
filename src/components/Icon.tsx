import userIcon from "../assets/icons/user.svg?url";
import refreshIcon from "../assets/icons/refresh.svg?url";
import settingsIcon from "../assets/icons/settings.svg?url";
import minimizeIcon from "../assets/icons/minimize.svg?url";
import closeIcon from "../assets/icons/close.svg?url";
import chevronIcon from "../assets/icons/chevron.svg?url";

const icons = {
  user: userIcon,
  refresh: refreshIcon,
  settings: settingsIcon,
  minimize: minimizeIcon,
  close: closeIcon,
  chevron: chevronIcon,
} as const;

type IconName = keyof typeof icons;

export default function Icon({ name }: { name: IconName }) {
  const image = `url("${icons[name]}")`;
  return <span className="ui-icon" style={{ maskImage: image, WebkitMaskImage: image }} aria-hidden="true" />;
}
