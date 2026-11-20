<script lang="ts">
  import IconSearch from "@tabler/icons-svelte/icons/search";
  import IconHome from "@tabler/icons-svelte/icons/home";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconDna2 from "@tabler/icons-svelte/icons/dna-2";
  import IconChartHistogram from "@tabler/icons-svelte/icons/chart-histogram";
  import IconSettingsCog from "@tabler/icons-svelte/icons/settings-cog";
  import IconExternalLink from "@tabler/icons-svelte/icons/external-link";
  import IconPalette from "@tabler/icons-svelte/icons/palette";
  import IconLanguage from "@tabler/icons-svelte/icons/language";
  import IconPin from "@tabler/icons-svelte/icons/pin";
  import IconListCheck from "@tabler/icons-svelte/icons/list-check";
  import { Dialog } from "bits-ui";
  import { tick } from "svelte";
  import { t } from "../app/i18n.svelte";
  import { app, setTheme, toggleLanguage, toggleAlwaysOnTop } from "../app/state.svelte";
  import { navigate } from "../lib/router.svelte";
  import * as client from "../app/tauri.js";
  import { MYNX_WEBSITE_URL } from "../app/tauri.js";
  import type { IconComponent } from "../lib/icons.js";

  interface PaletteItem {
    id: string;
    label: string;
    group: "navigate" | "action";
    icon: IconComponent;
    keywords: string;
    run: () => void;
  }

  let open = $state(false);
  let query = $state("");
  let activeIndex = $state(0);

  const items = $derived<PaletteItem[]>([
    { id: "nav-home", label: t("nav.home"), group: "navigate", icon: IconHome, keywords: "home 首页", run: () => navigate("/") },
    { id: "nav-image", label: t("nav.image"), group: "navigate", icon: IconPhoto, keywords: "image png tiff 转换 convert", run: () => navigate("/image") },
    { id: "nav-qpcr", label: t("nav.qpcr"), group: "navigate", icon: IconChartBar, keywords: "qpcr 实时荧光定量", run: () => navigate("/qpcr") },
    { id: "nav-rnaseq", label: t("nav.rnaseq"), group: "navigate", icon: IconDna2, keywords: "rnaseq 转录组 de 差异", run: () => navigate("/rnaseq") },
    { id: "nav-charts", label: t("nav.charts"), group: "navigate", icon: IconChartHistogram, keywords: "charts 绘图 figure chart", run: () => navigate("/charts") },
    { id: "nav-settings", label: t("nav.settings"), group: "navigate", icon: IconSettingsCog, keywords: "settings 设置 preferences", run: () => navigate("/settings") },
    { id: "nav-website", label: t("nav.website"), group: "navigate", icon: IconExternalLink, keywords: "website 网站 home homepage", run: () => void client.openExternal(MYNX_WEBSITE_URL).catch(() => {}) },
    { id: "act-theme-graphite", label: `${t("theme.title")}: ${t("theme.graphite.name")}`, group: "action", icon: IconPalette, keywords: "theme dark 深色 graphite", run: () => setTheme("graphite") },
    { id: "act-theme-pearl", label: `${t("theme.title")}: ${t("theme.pearl.name")}`, group: "action", icon: IconPalette, keywords: "theme light 浅色 pearl", run: () => setTheme("pearl") },
    { id: "act-theme-system", label: `${t("theme.title")}: ${t("theme.system.name")}`, group: "action", icon: IconPalette, keywords: "theme system 跟随系统", run: () => setTheme("system") },
    { id: "act-language", label: t("palette.toggleLanguage"), group: "action", icon: IconLanguage, keywords: "language 语言 中文 english zh en", run: () => toggleLanguage() },
    { id: "act-pin", label: t("palette.togglePin"), group: "action", icon: IconPin, keywords: "pin top 置顶 always on top", run: () => toggleAlwaysOnTop() },
    { id: "act-tasks", label: t("palette.toggleTasks"), group: "action", icon: IconListCheck, keywords: "tasks 任务 drawer 抽屉", run: () => (app.taskDrawerOpen = !app.taskDrawerOpen) },
  ]);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q),
    );
  });

  // Keep the highlighted row in bounds as the list narrows.
  $effect(() => {
    if (activeIndex >= filtered.length) activeIndex = 0;
  });

  function openPalette(): void {
    query = "";
    activeIndex = 0;
    open = true;
  }

  function runItem(item: PaletteItem): void {
    open = false;
    item.run();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (open) {
        open = false;
      } else {
        openPalette();
      }
    }
  }

  async function onSearchKeydown(event: KeyboardEvent): Promise<void> {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      activeIndex = Math.max(0, Math.min(activeIndex + direction, filtered.length - 1));
      const active = filtered[activeIndex];
      if (active) {
        await tick();
        document.getElementById(`mynx-command-${active.id}`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[activeIndex];
      if (item) runItem(item);
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<button
  type="button"
  class="mynx-btn flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-secondary"
  onclick={openPalette}
  aria-label={t("palette.open")}
  aria-haspopup="dialog"
  title={t("palette.openHint")}
>
  <IconSearch size={13} stroke={1.6} />
  <span class="hidden sm:inline">{t("palette.open")}</span>
  <kbd class="hidden rounded border border-border bg-surface-2 px-1 text-[10px] min-[521px]:inline">Ctrl K</kbd>
</button>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="mynx-modal-scrim fixed inset-0 z-40 bg-(--mynx-scrim)" />
    <Dialog.Content
      class="mynx-modal-panel fixed left-1/2 top-[12%] z-50 w-[min(520px,92vw)] -translate-x-1/2 rounded-(--mynx-radius-popover) border border-border bg-elevated p-0 outline-none"
    >
      <Dialog.Title class="sr-only">{t("palette.open")}</Dialog.Title>
      <div class="flex items-center gap-2 border-b border-border px-3 py-2 focus-within:border-b-accent">
        <IconSearch size={15} stroke={1.6} class="text-text-secondary" />
        <input
          type="text"
          class="w-full bg-transparent text-[13px] outline-none"
          placeholder={t("palette.placeholder")}
          bind:value={query}
          aria-label={t("palette.placeholder")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="mynx-command-list"
          aria-activedescendant={filtered[activeIndex] ? `mynx-command-${filtered[activeIndex].id}` : undefined}
          onkeydown={onSearchKeydown}
        />
      </div>
      <ul id="mynx-command-list" class="max-h-[320px] overflow-y-auto py-1" role="listbox" aria-label={t("palette.open")}>
        {#if filtered.length === 0}
          <li class="px-3 py-6 text-center text-[12px] text-text-secondary">
            {t("palette.empty")}
          </li>
        {:else}
          {#each filtered as item, index (item.id)}
            {@const ItemIcon = item.icon}
            <li role="presentation">
              <button
                type="button"
                id={`mynx-command-${item.id}`}
                tabindex={-1}
                class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] {index === activeIndex ? 'bg-selected text-accent' : 'hover:bg-hover'}"
                role="option"
                aria-selected={index === activeIndex}
                onmouseenter={() => (activeIndex = index)}
                onclick={() => runItem(item)}
              >
                <ItemIcon size={15} stroke={1.6} class="shrink-0" />
                <span class="mynx-truncate flex-1">{item.label}</span>
                <span class="text-[10px] uppercase text-text-secondary">
                  {item.group === "navigate" ? t("palette.groupGo") : t("palette.groupDo")}
                </span>
              </button>
            </li>
          {/each}
        {/if}
      </ul>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
