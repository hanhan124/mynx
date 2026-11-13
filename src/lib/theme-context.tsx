import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMantineColorScheme } from "@mantine/core";
import { loadConfig, saveTheme } from "./config";
import {
  DEFAULT_THEME,
  getSystemTheme,
  normalizeTheme,
  resolveTheme,
  type ResolvedTheme,
  type ThemeId,
} from "./theme";

interface ThemeContextValue {
  theme: ThemeId;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): ThemeId {
  try {
    return normalizeTheme(localStorage.getItem("mynx-theme"));
  } catch {
    return DEFAULT_THEME;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initialTheme = getInitialTheme();
  const [preference, setPreference] = useState<ThemeId>(initialTheme);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(initialTheme));
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    let active = true;
    void loadConfig()
      .then((config) => {
        if (!active) return;
        setPreference(config.theme);
        setResolved(resolveTheme(config.theme));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setResolved(getSystemTheme());
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preference]);

  useEffect(() => {
    const mantineScheme = resolved === "graphite" ? "dark" : "light";
    setColorScheme(mantineScheme);
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved, setColorScheme]);

  const setTheme = useCallback((next: ThemeId) => {
    setPreference(next);
    setResolved(resolveTheme(next));
    void saveTheme(next).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ theme: preference, resolvedTheme: resolved, setTheme }),
    [preference, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}
