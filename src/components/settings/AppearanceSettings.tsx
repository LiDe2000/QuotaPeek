import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Theme } from "../../hooks/useAppearance";
import CenteredCarousel from "../shared/CenteredCarousel";
import { INTERFACE_SCALE } from "../../lib/appearance/interfaceScale";
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
  scale: number;
  onScaleChange: (scale: number) => void;
  onClose: () => void;
}

export default function AppearanceSettings({ theme, onThemeChange, scale, onScaleChange, onClose }: AppearanceSettingsProps) {
  const themeOptions = useRef<HTMLElement>(null);
  const [draftScale, setDraftScale] = useState(scale);
  const draft = useRef(scale);
  const pointer = useRef<number | null>(null);
  const position = (draftScale - INTERFACE_SCALE.min) / (INTERFACE_SCALE.max - INTERFACE_SCALE.min);

  function preview(value: number) {
    draft.current = value;
    setDraftScale(value);
  }
  function commit() {
    if (draft.current !== scale) onScaleChange(draft.current);
  }
  function cancel() {
    if (pointer.current === null) return;
    pointer.current = null;
    preview(scale);
  }

  useEffect(() => { preview(scale); }, [scale]);

  useEffect(() => { themeOptions.current?.querySelector<HTMLInputElement>("input:checked")?.focus(); }, []);

  return (
    <section id="appearance-settings" className="panel settings-panel" aria-labelledby="settings-title" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <div className="settings-heading"><h2 id="settings-title">Appearance</h2></div>
      <CenteredCarousel items={themes} selected={theme} itemKey={option => option.id} onSelect={option => onThemeChange(option.id)}
        containerRef={themeOptions} className="theme-options" label="Color theme" renderItem={(option, slot) => <label {...slot} key={option.id} title={option.description}>
        <input type="radio" name="theme" value={option.id} tabIndex={theme === option.id ? 0 : -1} checked={theme === option.id} onChange={() => onThemeChange(option.id)} />
        <span className="theme-option"><span className={`theme-swatch swatch-${option.id}`} aria-hidden="true"><span /></span><span>{option.name}</span></span>
      </label>} />
      <div className="scale-setting" style={{ "--scale-fill": `${position * 100}%`, "--scale-position": position } as CSSProperties}>
        <div className="scale-heading">
          <label htmlFor="interface-scale">Interface scale</label>
          <button type="button" className="scale-reset" disabled={scale === INTERFACE_SCALE.default && draftScale === INTERFACE_SCALE.default}
            onClick={() => { preview(INTERFACE_SCALE.default); if (scale !== INTERFACE_SCALE.default) onScaleChange(INTERFACE_SCALE.default); }}>Reset</button>
        </div>
        <div className="scale-slider-control">
          <input id="interface-scale" className="scale-slider" type="range" min={INTERFACE_SCALE.min} max={INTERFACE_SCALE.max} step={INTERFACE_SCALE.step} value={draftScale}
            aria-valuetext={`${draftScale}%`}
            onChange={event => preview(Number(event.currentTarget.value))}
            onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return;
              pointer.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={event => { if (pointer.current === event.pointerId) { pointer.current = null; commit(); } }}
            onPointerCancel={cancel} onLostPointerCapture={cancel}
            onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit(); }}
            onBlur={() => { if (pointer.current === null) commit(); }} />
          <output htmlFor="interface-scale" className="scale-value" aria-hidden="true">{draftScale}%</output>
        </div>
      </div>
    </section>
  );
}
