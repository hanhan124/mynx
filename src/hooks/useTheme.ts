import { useState, useEffect, useCallback } from "react";
import { loadConfig, saveTheme } from "../lib/config";

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    loadConfig().then((config) => {
      setTheme(config.theme as "dark" | "light");
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      saveTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
