import { useEffect, useState } from "react";

export type Theme = "classic" | "dark" | "light";

const THEME_STORAGE_KEY = "quotapeek-theme";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "classic" || saved === "light" ? saved : "dark";
  } catch {
    return "dark";
  }
}

export function useAppearance() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Keep theme switching available when storage cannot be accessed.
    }
  }, [theme]);

  return { theme, setTheme };
}
