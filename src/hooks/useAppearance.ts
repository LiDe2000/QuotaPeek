import { useEffect, useLayoutEffect, useState } from "react";
import { storage, saveSetting } from "../services/storage";
import { INTERFACE_SCALE_KEY, normalizeInterfaceScale } from "../lib/appearance/interfaceScale";

export type Theme = "dark" | "light" | "dimmed" | "warm" | "navy";

const THEME_STORAGE_KEY = "quotapeek-theme";

function readTheme(): Theme {
  try {
    const saved = storage.getSetting(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dimmed" || saved === "warm" || saved === "navy" ? saved : "dark";
  } catch {
    return "dark";
  }
}

export function useAppearance() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [scale, updateScale] = useState(() => normalizeInterfaceScale(storage.getSetting(INTERFACE_SCALE_KEY)));

  function setScale(value: number) { updateScale(normalizeInterfaceScale(value)); }

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--interface-scale", String(scale / 100));
    window.dispatchEvent(new Event("interface-scale-changed"));
  }, [scale]);

  useEffect(() => {
    // Avoid a database write for every slider movement; the latest value wins.
    const timer = setTimeout(() => saveSetting(INTERFACE_SCALE_KEY, String(scale)), 200);
    return () => clearTimeout(timer);
  }, [scale]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveSetting(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme, scale, setScale };
}
