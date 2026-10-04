import { useEffect, useRef } from "react";
import type { Theme } from "../../hooks/useAppearance";
import { useStripScroll } from "../../hooks/useStripScroll";
import "./AppearanceSettings.css";

const themes: { id: Theme; name: string; description: string }[] = [
  { id: "dark", name: "Dark", description: "Pure black · crisp borders" },
  { id: "light", name: "Light", description: "Pure white · minimal and airy" },
  { id: "dimmed", name: "Dimmed", description: "Graphite gray · soft contrast" },
  { id: "warm", name: "Warm", description: "Warm paper · easy on the eyes" },
  { id: "navy", name: "Navy", description: "Deep blue · calm and composed" },
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
