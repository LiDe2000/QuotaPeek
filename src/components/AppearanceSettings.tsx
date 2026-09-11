import { useEffect, useRef } from "react";
import Icon from "./Icon";
import "./AppearanceSettings.css";

export type Theme = "classic" | "dark" | "light";

const themes: { id: Theme; name: string; description: string }[] = [
  { id: "classic", name: "Original", description: "原稿深色 · 清晰边框" },
  { id: "dark", name: "Midnight", description: "精致深色 · 柔和层次" },
  { id: "light", name: "Pearl", description: "精致浅色 · 干净通透" },
];

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("quotapeek-theme");
    return saved === "classic" || saved === "light" ? saved : "dark";
  } catch { return "dark"; }
}

interface AppearanceSettingsProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onClose: () => void;
}

export default function AppearanceSettings({ theme, onThemeChange, onClose }: AppearanceSettingsProps) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeButton.current?.focus(); }, []);

  return (
    <section id="appearance-settings" className="settings-panel" aria-labelledby="settings-title" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <div className="settings-heading"><h2 id="settings-title">Appearance</h2><button ref={closeButton} className="icon-button" aria-label="Close settings" onClick={onClose}><Icon name="close" /></button></div>
      <fieldset className="theme-options"><legend className="sr-only">Color theme</legend>{themes.map(option => <label key={option.id} title={option.description}>
        <input type="radio" name="theme" value={option.id} checked={theme === option.id} onChange={() => onThemeChange(option.id)} />
        <span className="theme-option"><span className={`theme-swatch swatch-${option.id}`} aria-hidden="true"><span /></span><span>{option.name}</span></span>
      </label>)}</fieldset>
    </section>
  );
}
