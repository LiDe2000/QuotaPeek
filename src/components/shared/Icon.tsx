import accountLoginIcon from "../../assets/icons/account-login.svg?url";
import giftIcon from "../../assets/icons/gift.svg?url";
import refreshIcon from "../../assets/icons/refresh.svg?url";
import themeIcon from "../../assets/icons/theme.svg?url";

const icons = {
  "account-login": accountLoginIcon,
  gift: giftIcon,
  refresh: refreshIcon,
  theme: themeIcon,
} as const;

type IconName = keyof typeof icons;

export default function Icon({ name }: { name: IconName }) {
  return <img className="ui-icon" src={icons[name]} alt="" aria-hidden="true" draggable={false} />;
}
