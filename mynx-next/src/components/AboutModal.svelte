<script lang="ts">
  import { app } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import * as client from "../app/tauri.js";
  import { MYNX_WEBSITE_URL } from "../app/tauri.js";
  import { checkForUpdates } from "../app/updater.svelte";
  import Modal from "./Modal.svelte";

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

  function checkUpdate(): void {
    void checkForUpdates();
  }

  function openGithub(): void {
    void client.openExternal("https://github.com/hanhan124/mynx").catch(() => {});
  }

  function openWebsite(): void {
    void client.openExternal(MYNX_WEBSITE_URL).catch(() => {});
  }
</script>

<Modal bind:open={app.aboutOpen} title={t("about.title")} width={440}>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <img src="/mynx.svg" alt="" class="h-10 w-10" />
      <div class="min-w-0">
        <p class="text-[14px] font-semibold">Mynx</p>
        <p class="text-[12px] text-text-secondary">{t("about.tagline")}</p>
      </div>
    </div>

    <dl class="flex flex-col gap-1.5 text-[12px]">
      <div class="flex items-center gap-2">
        <dt class="w-16 shrink-0 text-text-secondary">{t("about.version")}</dt>
        <dd class="mynx-truncate mynx-mono" title={version}>{version}</dd>
      </div>
      <div class="flex items-center gap-2">
        <dt class="w-16 shrink-0 text-text-secondary">{t("about.stack")}</dt>
        <dd>{t("about.stackValue")}</dd>
      </div>
    </dl>

    <div class="flex items-center gap-2">
      <button type="button" class="mynx-btn" onclick={openGithub}>
        {t("about.github")}
      </button>
      <button type="button" class="mynx-btn" onclick={openWebsite}>
        {t("about.website")}
      </button>
    </div>

    <hr class="mynx-divider" />

    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="mynx-btn"
          onclick={checkUpdate}
          disabled={app.update.status === "checking" || app.update.status === "downloading"}
        >
          {t("about.checkUpdate")}
        </button>
        {#if updateLine}
          <p class="mynx-truncate flex-1 text-[12px] text-text-secondary" title={updateLine}>
            {updateLine}
          </p>
        {/if}
      </div>
    </div>
  </div>
</Modal>
