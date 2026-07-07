import { Store } from "@tauri-apps/plugin-store";
import { normalizeTheme, type ThemeId } from "./theme";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load("config.json");
  }
  return storeInstance;
}

/** Validate "#RRGGBB" / "#RRGGBBAA"; falls back to the default if invalid. */
function normalizeChartColor(value: unknown): string {
  if (typeof value !== "string") return "#3C9FDF";
  return /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.trim())
    ? (value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`)
    : "#3C9FDF";
}

export async function loadConfig(): Promise<{
  theme: ThemeId;
  alwaysOnTop: boolean;
  chartColor: string;
}> {
  const store = await getStore();
  const theme = normalizeTheme(await store.get<string>("theme"));
  const alwaysOnTop = (await store.get<boolean>("alwaysOnTop")) ?? false;
  const chartColor = normalizeChartColor(await store.get<string>("chartColor"));
  return { theme, alwaysOnTop, chartColor };
}

export async function saveTheme(theme: ThemeId): Promise<void> {
  const store = await getStore();
  await store.set("theme", theme);
  await store.save();
}

export async function saveAlwaysOnTop(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set("alwaysOnTop", value);
  await store.save();
}

export async function saveChartColor(color: string): Promise<void> {
  const store = await getStore();
  await store.set("chartColor", normalizeChartColor(color));
  await store.save();
}

export async function loadChartColor(): Promise<string> {
  const store = await getStore();
  return normalizeChartColor(await store.get<string>("chartColor"));
}
