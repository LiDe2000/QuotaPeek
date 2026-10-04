import { useEffect, useRef } from "react";
import type { Theme } from "../../hooks/useAppearance";
import { useStripScroll } from "../../hooks/useStripScroll";
import "./AppearanceSettings.css";

const themes: { id: Theme; name: string; description: string }[] = [
  { id: "dark", name: "Dark", description: "纯黑底色 · 硬朗边框" },
  { id: "light", name: "Light", description: "纯白底色 · 极简通透" },
  { id: "dimmed", name: "Dimmed", description: "石墨中灰 · 柔和低对比" },
  { id: "warm", name: "Warm", description: "暖米色调 · 纸张护眼" },
  { id: "navy", name: "Navy", description: "深海蓝调 · 沉稳夜航" },
];

interface AppearanceSettingsProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onClose: () => void;
}

export default function AppearanceSettings({ theme, onThemeChange, onClose }: AppearanceSettingsProps) {
  const themeOptions = useRef<HTMLFieldSetElement>(null);

  useEffect(() => { themeOptions.current?.querySelector<HTMLInputElement>("input:checked")?.focus(); }, []);
  useStripScroll(themeOptions, "input:checked", theme);

  return (
    <section id="appearance-settings" className="panel settings-panel" aria-labelledby="settings-title" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <div className="settings-heading"><h2 id="settings-title">Appearance</h2></div>
      <fieldset ref={themeOptions} className="theme-options"><legend className="sr-only">Color theme</legend>{themes.map(option => <label key={option.id} title={option.description}>
        <input type="radio" name="theme" value={option.id} checked={theme === option.id} onChange={() => onThemeChange(option.id)} />
        <span className="theme-option"><span className={`theme-swatch swatch-${option.id}`} aria-hidden="true"><span /></span><span>{option.name}</span></span>
      </label>)}</fieldset>
    </section>
  );
}
