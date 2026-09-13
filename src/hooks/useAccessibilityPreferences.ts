import { useEffect } from "react";

const preferences = [
  ["reduced-motion", "(prefers-reduced-motion: reduce)"],
  ["high-contrast", "(prefers-contrast: more)"],
  ["reduced-transparency", "(prefers-reduced-transparency: reduce)"],
  ["forced-colors", "(forced-colors: active)"],
] as const;

/** Mirrors operating-system accessibility choices into CSS without assuming
 * every embedded WebView supports every media query. */
export function useAccessibilityPreferences() {
  useEffect(() => {
    const root = document.documentElement;
    const media = preferences.map(([name, query]) => ({ name, list: window.matchMedia(query) }));
    const update = () => {
      for (const { name, list } of media) {
        root.toggleAttribute(`data-${name}`, list.matches);
      }
    };
    update();
    for (const { list } of media) list.addEventListener("change", update);
    return () => {
      for (const { list } of media) list.removeEventListener("change", update);
    };
  }, []);
}
