import { useEffect, useState } from "react";
import { storage, saveSetting } from "../services/storage";

export type Theme = "classic" | "dark" | "light";

const THEME_STORAGE_KEY = "quotapeek-theme";

function readTheme(): Theme {
  try {
    const saved = storage.getSetting(THEME_STORAGE_KEY);
    return saved === "classic" || saved === "light" ? saved : "dark";
  } catch {
    return "dark";
  }
}

export function useAppearance() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveSetting(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme };
}
