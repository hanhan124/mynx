<script lang="ts">
  import type { ThemeId } from "../../lib/contracts/generated/settings/ThemeId.js";
  import type { SettingsDoc } from "../../lib/contracts/generated/settings/SettingsDoc.js";
  import IconCheck from "@tabler/icons-svelte/icons/check";
  import { t } from "../../app/i18n.svelte";
  import {
    app,
    applyTheme,
    pushToast,
    setLanguage,
    type Language,
  } from "../../app/state.svelte";
  import * as client from "../../app/tauri.js";
  import RStatusCard from "../../components/RStatusCard.svelte";

  const THEME_OPTIONS: Array<{ id: ThemeId; nameKey: string; descKey: string }> = [
    { id: "system", nameKey: "theme.system.name", descKey: "theme.system.description" },
    { id: "graphite", nameKey: "theme.graphite.name", descKey: "theme.graphite.description" },
    { id: "pearl", nameKey: "theme.pearl.name", descKey: "theme.pearl.description" },
  ];

  const LANGUAGE_OPTIONS: Array<{ id: Language; labelKey: string }> = [
    { id: "zh", labelKey: "settings.language.zh" },
    { id: "en", labelKey: "settings.language.en" },
  ];

  let doc = $state<SettingsDoc | null>(null);
  let saving = $state(false);

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

  function cardClass(selected: boolean): string {
    return selected
      ? "border-accent bg-accent/10"
      : "border-border bg-surface hover:border-text-secondary";
  }
</script>

<section class="mx-auto flex w-full max-w-[720px] flex-col gap-5 p-6">
  <header class="flex flex-col gap-1">
    <h1 class="text-[16px] font-semibold">{t("settings.title")}</h1>
    <p class="text-[12px] text-text-secondary">{t("settings.subtitle")}</p>
  </header>

  <fieldset class="mynx-card flex flex-col gap-3 p-4" disabled={saving}>
    <legend class="px-1 text-[13px] font-semibold">{t("settings.appearance")}</legend>
    <p class="text-[12px] text-text-secondary">{t("settings.appearance.description")}</p>

    <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("theme.title")}>
      {#each THEME_OPTIONS as option (option.id)}
        {@const selected = app.theme === option.id}
        <label class="mynx-card flex cursor-pointer flex-col gap-0.5 p-3 {cardClass(selected)}">
          <input
            type="radio"
            name="mynx-theme"
            class="sr-only"
            checked={selected}
            onchange={() => pickTheme(option.id)}
          />
          <span class="text-[12px] font-medium">{t(option.nameKey)}</span>
          <span class="text-[11px] text-text-secondary">{t(option.descKey)}</span>
        </label>
      {/each}
    </div>

    <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("settings.language")}>
      {#each LANGUAGE_OPTIONS as option (option.id)}
        {@const selected = app.language === option.id}
        <label class="mynx-card flex cursor-pointer items-center justify-between p-3 {cardClass(selected)}">
          <span class="text-[12px] font-medium">{t(option.labelKey)}</span>
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
        <span class="block text-[12px] font-medium">{t("settings.chartColor")}</span>
        <span class="block text-[11px] text-text-secondary">
          {t("settings.chartColor.description")}
        </span>
      </span>
      <input
        type="color"
        class="mynx-input !h-8 !w-14 cursor-pointer !p-1"
        value={doc?.chartColor ?? "#2f6fed"}
        onchange={(event) => pickChartColor(event.currentTarget.value)}
        aria-label={t("settings.chartColor")}
      />
    </div>
  </fieldset>

  <fieldset class="mynx-card flex flex-col gap-3 p-4" disabled={saving}>
    <legend class="px-1 text-[13px] font-semibold">{t("settings.window")}</legend>
    <div class="flex items-center gap-2">
      <span class="flex-1">
        <span class="block text-[12px] font-medium">{t("settings.alwaysOnTop")}</span>
        <span class="block text-[11px] text-text-secondary">
          {t("settings.alwaysOnTop.description")}
        </span>
      </span>
      <button
        type="button"
        class="relative h-5 w-9 rounded-full border transition-colors {app.alwaysOnTop
          ? 'border-accent bg-accent'
          : 'border-border bg-surface-2'}"
        onclick={togglePin}
        role="switch"
        aria-checked={app.alwaysOnTop}
        aria-label={t("settings.alwaysOnTop")}
      >
        <span
          class="absolute left-0.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-transform {app.alwaysOnTop
            ? 'translate-x-4'
            : ''}"
        ></span>
      </button>
    </div>
  </fieldset>

  <RStatusCard />
</section>
