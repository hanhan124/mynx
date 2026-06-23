import { Store } from "@tauri-apps/plugin-store";
import { normalizeTheme, type ThemeId } from "./theme";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load("config.json");
  }
  return storeInstance;
}

export async function loadConfig(): Promise<{
  theme: ThemeId;
  alwaysOnTop: boolean;
}> {
  const store = await getStore();
  const theme = normalizeTheme(await store.get<string>("theme"));
  const alwaysOnTop = (await store.get<boolean>("alwaysOnTop")) ?? false;
  return { theme, alwaysOnTop };
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
