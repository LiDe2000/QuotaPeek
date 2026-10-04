import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Theme } from "../../hooks/useAppearance";
import { useStripScroll } from "../../hooks/useStripScroll";
const INTERFACE_SCALE = { min: 75, max: 150, step: 5, default: 100 };
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
  const [scale, onScaleChange] = useState<number>(INTERFACE_SCALE.default);
  const themeOptions = useRef<HTMLFieldSetElement>(null);
  const position = (scale - INTERFACE_SCALE.min) / (INTERFACE_SCALE.max - INTERFACE_SCALE.min);

  useEffect(() => { themeOptions.current?.querySelector<HTMLInputElement>("input:checked")?.focus(); }, []);
  useStripScroll(themeOptions, "input:checked", theme);

  return (
    <section id="appearance-settings" className="panel settings-panel" aria-labelledby="settings-title" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <div className="settings-heading"><h2 id="settings-title">Appearance</h2></div>
      <fieldset ref={themeOptions} className="theme-options"><legend className="sr-only">Color theme</legend>{themes.map(option => <label key={option.id} title={option.description}>
        <input type="radio" name="theme" value={option.id} checked={theme === option.id} onChange={() => onThemeChange(option.id)} />
        <span className="theme-option"><span className={`theme-swatch swatch-${option.id}`} aria-hidden="true"><span /></span><span>{option.name}</span></span>
      </label>)}</fieldset>
      <div className="scale-setting" style={{ "--scale-fill": `${position * 100}%`, "--scale-position": position } as CSSProperties}>
        <div className="scale-heading">
          <label htmlFor="interface-scale">Interface scale</label>
          <button type="button" className="scale-reset" disabled={scale === INTERFACE_SCALE.default} onClick={() => onScaleChange(INTERFACE_SCALE.default)}>Reset</button>
        </div>
        <div className="scale-slider-control">
          <input id="interface-scale" className="scale-slider" type="range" min={INTERFACE_SCALE.min} max={INTERFACE_SCALE.max} step={INTERFACE_SCALE.step} value={scale}
            aria-valuetext={`${scale}%`}
            onChange={event => onScaleChange(Number(event.target.value))} />
          <output htmlFor="interface-scale" className="scale-value" aria-hidden="true">{scale}%</output>
        </div>
      </div>
    </section>
  );
}
