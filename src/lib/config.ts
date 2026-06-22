import { Store } from "@tauri-apps/plugin-store";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load("config.json");
  }
  return storeInstance;
}

export async function loadConfig(): Promise<{
  theme: string;
  alwaysOnTop: boolean;
}> {
  const store = await getStore();
  const theme = (await store.get<string>("theme")) ?? "dark";
  const alwaysOnTop = (await store.get<boolean>("alwaysOnTop")) ?? false;
  return { theme, alwaysOnTop };
}

export async function saveTheme(theme: string): Promise<void> {
  const store = await getStore();
  await store.set("theme", theme);
  await store.save();
}

export async function saveAlwaysOnTop(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set("alwaysOnTop", value);
  await store.save();
}
