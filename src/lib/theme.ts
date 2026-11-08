export const THEMES = [
  {
    id: "system",
  },
  {
    id: "graphite",
  },
  {
    id: "pearl",
  },
] as const;

export type ThemeId = typeof THEMES[number]["id"];

/** 实际生效的主题（不含 system） */
export type ResolvedTheme = "graphite" | "pearl";

export const DEFAULT_THEME: ThemeId = "pearl";

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));

export function normalizeTheme(value: string | null | undefined): ThemeId {
  if (!value) return DEFAULT_THEME;
  const lower = value.toLowerCase();
  if (lower === "dark") return "graphite";
  if (lower === "light") return "pearl";
  if (THEME_IDS.has(lower)) return lower as ThemeId;
  return DEFAULT_THEME;
}

/** 获取当前系统偏好的主题 */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "pearl";
  }
  return "graphite";
}

/** 将用户选择解析为实际生效的主题 */
export function resolveTheme(theme: ThemeId): ResolvedTheme {
  if (theme === "system") return getSystemTheme();
  return theme;
}
