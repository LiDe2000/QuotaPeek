import { useEffect, useLayoutEffect, useRef } from "react";
import type { Theme } from "../../hooks/useAppearance";
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

  // Keep the active theme inside the strip, which scrolls sideways once the five
  // options outgrow the panel — the same behaviour as the provider and account strips.
  useLayoutEffect(() => {
    const element = themeOptions.current;
    if (!element) return;
    function revealSelected() {
      const option = element!.querySelector<HTMLInputElement>("input:checked")?.closest("label");
      if (!option) return;
      const viewport = element!.getBoundingClientRect();
      const bounds = option.getBoundingClientRect();
      if (bounds.left < viewport.left) element!.scrollLeft += bounds.left - viewport.left;
      else if (bounds.right > viewport.right) element!.scrollLeft += bounds.right - viewport.right;
    }
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(element);
    return () => observer.disconnect();
  }, [theme]);

  useEffect(() => {
    const element = themeOptions.current;
    if (!element) return;
    function scroll(event: WheelEvent) {
      // Touchpad horizontal gestures already scroll natively. Map a mouse wheel
      // only when this strip can consume it, leaving panel scrolling at its edges.
      if (event.ctrlKey || event.shiftKey || event.deltaX || !event.deltaY) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientWidth : 1;
      const delta = event.deltaY * unit;
      const maximum = element!.scrollWidth - element!.clientWidth;
      if ((delta < 0 && element!.scrollLeft <= 0) || (delta > 0 && element!.scrollLeft >= maximum)) return;
      event.preventDefault();
      element!.scrollLeft += delta;
    }
    element.addEventListener("wheel", scroll, { passive: false });
    return () => element.removeEventListener("wheel", scroll);
  }, []);

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
