<script lang="ts">
  import Switch from "../../components/Switch.svelte";
  import type { ThemeId } from "../../lib/contracts/generated/settings/ThemeId.js";
  import type { SettingsDoc } from "../../lib/contracts/generated/settings/SettingsDoc.js";
  import IconCheck from "@tabler/icons-svelte/icons/check";
  import IconAppWindow from "@tabler/icons-svelte/icons/app-window";
  import IconBrandGithub from "@tabler/icons-svelte/icons/brand-github";
  import IconCpu from "@tabler/icons-svelte/icons/cpu";
  import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
  import IconPalette from "@tabler/icons-svelte/icons/palette";
  import IconExternalLink from "@tabler/icons-svelte/icons/external-link";
  import { t } from "../../app/i18n.svelte";
  import {
    app,
    applyTheme,
    pushToast,
    setLanguage,
    setUiStyle,
    type Language,
  } from "../../app/state.svelte";
  import { type UiStyle } from "../../app/ui-style.svelte";
  import * as client from "../../app/tauri.js";
  import { MYNX_GITHUB_URL, MYNX_WEBSITE_URL } from "../../app/tauri.js";
  import RStatusCard from "../../components/RStatusCard.svelte";
  import { checkForUpdates } from "../../app/updater.svelte";
  import { requestChatSettings } from "../chat-next/handoff.js";
  import { navigate } from "../../lib/router.svelte";

  const version = $derived(app.appInfo?.version ?? t("common.loading"));

  const updateLine = $derived.by(() => {
    switch (app.update.status) {
      case "checking":
        return t("about.checking");
      case "uptodate":
        return t("about.latest");
      case "available":
        return t("update.available", { version: app.update.version ?? "" });
      case "downloading":
        return t("update.downloading", { version: app.update.version ?? "" });
      case "ready":
        return t("update.complete");
      case "failed":
        return t("about.checkFailed", { detail: app.update.error ?? t("common.error") });
      default:
        return "";
    }
  });

  const THEME_OPTIONS: Array<{ id: ThemeId; nameKey: string; descKey: string }> = [
    { id: "system", nameKey: "theme.system.name", descKey: "theme.system.description" },
    { id: "graphite", nameKey: "theme.graphite.name", descKey: "theme.graphite.description" },
    { id: "pearl", nameKey: "theme.pearl.name", descKey: "theme.pearl.description" },
  ];

  /** Preview swatches (page / card / accent) per visual style. */
  const UI_STYLE_OPTIONS: Array<{
    id: UiStyle;
    nameKey: string;
    descKey: string;
    swatches: [string, string, string];
  }> = [
    {
      id: "macos",
      nameKey: "uiStyle.macos.name",
      descKey: "uiStyle.macos.description",
      swatches: ["#f2f2f4", "#ffffff", "#0071e3"],
    },
    {
      id: "liquid-glass",
      nameKey: "uiStyle.liquid-glass.name",
      descKey: "uiStyle.liquid-glass.description",
      swatches: ["#f3f5f6", "#ffffff", "#1c62ad"],
    },
    {
      id: "minimal-linear",
      nameKey: "uiStyle.minimal-linear.name",
      descKey: "uiStyle.minimal-linear.description",
      swatches: ["#f5f6f8", "#ffffff", "#3478d4"],
    },
    {
      id: "swiss-editorial",
      nameKey: "uiStyle.swiss-editorial.name",
      descKey: "uiStyle.swiss-editorial.description",
      swatches: ["#ffffff", "#f1f0ea", "#c2452d"],
    },
    {
      id: "memphis-pop",
      nameKey: "uiStyle.memphis-pop.name",
      descKey: "uiStyle.memphis-pop.description",
      swatches: ["#f4ecdb", "#ffffff", "#e9a13b"],
    },
  ];

  const LANGUAGE_OPTIONS: Array<{ id: Language; labelKey: string }> = [
    { id: "zh", labelKey: "settings.language.zh" },
    { id: "en", labelKey: "settings.language.en" },
  ];

  let doc = $state<SettingsDoc | null>(null);
  let saving = $state(false);

  /** Sidebar navigation for the settings sections (ZCode-style). */
  type SettingsSection = "appearance" | "models" | "window" | "about";
  let settingsSection = $state<SettingsSection>("appearance");
  const SETTINGS_SECTIONS: Array<{
    id: SettingsSection;
    labelKey: string;
    icon: typeof IconPalette;
  }> = [
    { id: "appearance", labelKey: "settings.appearance", icon: IconPalette },
    { id: "models", labelKey: "chatNext.title", icon: IconCpu },
    { id: "window", labelKey: "settings.window", icon: IconAppWindow },
    { id: "about", labelKey: "settings.about", icon: IconInfoCircle },
  ];

  function detailOf(err: unknown): string {
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return String(err);
  }

  function load(): void {
    client
      .settingsLoad()
      .then((loaded) => {
        doc = loaded;
      })
      .catch((err: unknown) => {
        pushToast("error", t("settings.loadFailed", { detail: detailOf(err) }));
      });
  }

  load();

  async function persist(next: SettingsDoc): Promise<void> {
    doc = next;
    saving = true;
    try {
      await client.settingsSave(next);
      pushToast("success", t("settings.saved"));
    } catch (err) {
      pushToast("error", t("settings.saveFailed", { detail: detailOf(err) }));
    } finally {
      saving = false;
    }
  }

  function pickTheme(theme: ThemeId): void {
    applyTheme(theme);
    if (doc) void persist({ ...doc, theme });
  }

  function pickUiStyle(style: UiStyle): void {
    setUiStyle(style);
  }

  function pickLanguage(language: Language): void {
    setLanguage(language);
    if (doc) void persist({ ...doc, language });
  }

  function togglePin(): void {
    const next = !app.alwaysOnTop;
    app.alwaysOnTop = next;
    void client
      .setAlwaysOnTop(next)
      .catch(() => (app.alwaysOnTop = !next));
    if (doc) void persist({ ...doc, alwaysOnTop: next });
  }

  function pickChartColor(color: string): void {
    if (doc) void persist({ ...doc, chartColor: color });
  }

  function openExternal(url: string): void {
    void client.openExternal(url).catch(() => {});
  }

  function cardClass(selected: boolean): string {
    return selected
      ? "border-accent bg-selected"
      : "border-border bg-surface hover:border-text-secondary";
  }
  /** Fallback chart colour when the settings doc has none (data default, unchanged). */
  const DEFAULT_CHART_COLOR = "#2f6fed";
</script>

<section class="mynx-settings mx-auto flex w-full max-w-[980px] flex-col gap-5 p-6">
  <header class="mynx-page-header flex flex-col gap-1">
    <h1 class="mynx-page-title">{t("settings.title")}</h1>
  </header>

  <div class="flex flex-col gap-5 min-[720px]:flex-row min-[720px]:items-start">
  <nav
    class="mynx-settings-nav flex shrink-0 flex-row gap-1 overflow-x-auto min-[720px]:w-48 min-[720px]:flex-col"
    aria-label={t("settings.title")}
  >
    {#each SETTINGS_SECTIONS as section (section.id)}
      {@const SectionIcon = section.icon}
      <button
        type="button"
        class="mynx-settings-nav-item flex shrink-0 items-center gap-2 rounded-(--mynx-radius-control) px-3 py-2 text-left text-callout {settingsSection === section.id
          ? 'bg-selected font-semibold text-text'
          : 'text-text-secondary hover:bg-hover hover:text-text'}"
        aria-current={settingsSection === section.id ? "true" : undefined}
        onclick={() => (settingsSection = section.id)}
      >
        <span class="mynx-settings-icon mynx-settings-icon--{section.id}" aria-hidden="true">
          <SectionIcon size={15} stroke={1.7} />
        </span>
        <span class="min-w-0 truncate">{t(section.labelKey)}</span>
      </button>
    {/each}
  </nav>

  <div class="flex min-w-0 flex-1 flex-col gap-5">
  {#if settingsSection === "appearance"}
  <fieldset class="mynx-card mynx-form flex flex-col gap-3 p-4" disabled={saving}>
    <legend class="px-1 text-body font-semibold">{t("settings.appearance")}</legend>

    <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("theme.title")}>
      {#each THEME_OPTIONS as option (option.id)}
        {@const selected = app.theme === option.id}
        <label class="mynx-card flex cursor-pointer flex-col gap-0.5 p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent {cardClass(selected)}">
          <input
            type="radio"
            name="mynx-theme"
            class="sr-only"
            checked={selected}
            onchange={() => pickTheme(option.id)}
          />
          <span class="text-callout font-medium">{t(option.nameKey)}</span>
          <span class="text-footnote text-text-secondary">{t(option.descKey)}</span>
        </label>
      {/each}
    </div>

    <div class="flex flex-col gap-2">
      <span class="text-callout font-medium">{t("uiStyle.title")}</span>
      <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("uiStyle.title")}>
        {#each UI_STYLE_OPTIONS as option (option.id)}
          {@const selected = app.uiStyle === option.id}
          <label class="mynx-card flex cursor-pointer flex-col gap-1.5 p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent {cardClass(selected)}">
            <input
              type="radio"
              name="mynx-ui-style"
              class="sr-only"
              checked={selected}
              onchange={() => pickUiStyle(option.id)}
            />
            <span class="flex items-center gap-1" aria-hidden="true">
              {#each option.swatches as swatch (swatch)}
                <span
                  class="h-4 w-4 rounded-full border border-border"
                  style="background: {swatch}"
                ></span>
              {/each}
              {#if selected}
                <IconCheck size={15} stroke={2} class="ml-auto shrink-0 text-accent" aria-hidden="true" />
              {/if}
            </span>
            <span class="text-callout font-medium">{t(option.nameKey)}</span>
            <span class="text-footnote text-text-secondary">{t(option.descKey)}</span>
          </label>
        {/each}
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("settings.language")}>
      {#each LANGUAGE_OPTIONS as option (option.id)}
        {@const selected = app.language === option.id}
        <label class="mynx-card flex cursor-pointer items-center justify-between p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent {cardClass(selected)}">
          <span class="text-callout font-medium">{t(option.labelKey)}</span>
          <input
            type="radio"
            name="mynx-language"
            class="sr-only"
            checked={selected}
            onchange={() => pickLanguage(option.id)}
          />
          {#if selected}
            <IconCheck size={15} stroke={2} class="shrink-0 text-accent" aria-hidden="true" />
          {/if}
        </label>
      {/each}
    </div>

    <div class="flex items-center gap-2">
      <span class="flex-1">
        <span class="block text-callout font-medium">{t("settings.chartColor")}</span>
      </span>
      <input
        type="color"
        class="mynx-input h-8 w-14 cursor-pointer p-1"
        value={doc?.chartColor ?? DEFAULT_CHART_COLOR}
        onchange={(event) => pickChartColor(event.currentTarget.value)}
        aria-label={t("settings.chartColor")}
      />
    </div>
  </fieldset>
  {/if}

  {#if settingsSection === "models"}
  <fieldset class="mynx-card mynx-form flex flex-col gap-3 p-4">
    <legend class="px-1 text-body font-semibold">{t("chatNext.title")}</legend>
    <div class="flex flex-col items-start gap-2">
      <p class="text-callout text-text-secondary">{t("chatNext.settingsMoved")}</p>
      <button
        type="button"
        class="mynx-btn mynx-btn-primary"
        onclick={() => {
          requestChatSettings();
          navigate("/chat");
        }}
      >
        {t("chatNext.openChatSettings")}
      </button>
    </div>
  </fieldset>
  {/if}

  {#if settingsSection === "window"}
  <fieldset class="mynx-card mynx-form flex flex-col gap-3 p-4" disabled={saving}>
    <legend class="px-1 text-body font-semibold">{t("settings.window")}</legend>
    <div class="flex items-center gap-2">
      <span class="flex-1">
        <span class="block text-callout font-medium">{t("settings.alwaysOnTop")}</span>
      </span>
      <Switch
        checked={app.alwaysOnTop}
        label={t("settings.alwaysOnTop")}
        onchange={() => togglePin()}
      />
    </div>
  </fieldset>
  {/if}

  {#if settingsSection === "about"}
  <RStatusCard />

  <section class="mynx-card mynx-form-card flex flex-col gap-3 p-4" aria-labelledby="settings-about-heading">
    <header class="flex items-center gap-3">
      <img src="/mynx.svg" alt="" class="h-9 w-9 shrink-0" />
      <div class="min-w-0">
        <h2 id="settings-about-heading" class="text-body font-semibold">{t("settings.about")}</h2>
        <p class="text-footnote text-text-secondary">{t("settings.about.description")}</p>
      </div>
    </header>

    <div class="flex flex-col gap-2 border-y border-border py-3 sm:flex-row sm:items-center">
      <span class="text-callout text-text-secondary">{t("about.version")}</span>
      <span class="mynx-truncate min-w-0 font-mono text-callout" title={version}>{version}</span>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        class="mynx-btn min-h-9 min-w-0 flex-1 justify-start gap-2"
        onclick={() => openExternal(MYNX_GITHUB_URL)}
        title={MYNX_GITHUB_URL}
        aria-label={`${t("about.github")}: ${MYNX_GITHUB_URL}`}
      >
        <IconBrandGithub size={16} stroke={1.7} aria-hidden="true" />
        <span class="shrink-0">{t("about.github")}</span>
        <span class="mynx-truncate min-w-0 flex-1 text-left font-mono text-caption2 text-text-secondary">{MYNX_GITHUB_URL.replace("https://", "")}</span>
        <IconExternalLink size={14} stroke={1.7} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="mynx-btn min-h-9 shrink-0 gap-2"
        onclick={() => openExternal(MYNX_WEBSITE_URL)}
        aria-label={`${t("about.website")}: ${MYNX_WEBSITE_URL}`}
      >
        {t("about.website")}
        <IconExternalLink size={14} stroke={1.7} aria-hidden="true" />
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="mynx-btn min-h-8 px-2.5 text-footnote"
        onclick={() => void checkForUpdates()}
        disabled={app.update.status === "checking" || app.update.status === "downloading"}
      >
        {t("about.checkUpdate")}
      </button>
      {#if updateLine}
        <p class="mynx-truncate min-w-0 flex-1 text-footnote text-text-secondary" title={updateLine}>
          {updateLine}
        </p>
      {/if}
    </div>
  </section>
  {/if}
  </div>
  </div>
</section>
