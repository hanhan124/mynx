<script lang="ts">
  import { onMount } from "svelte";
  import IconDownload from "@tabler/icons-svelte/icons/download";
  import IconRefresh from "@tabler/icons-svelte/icons/refresh";
  import { app } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import {
    checkForUpdates,
    downloadAndInstallUpdate,
    dismissUpdate,
    relaunchApp,
  } from "../app/updater.svelte";

  onMount(() => {
    // Defer the first update check so startup stays snappy.
    const timer = setTimeout(() => void checkForUpdates(), 5000);
    return () => clearTimeout(timer);
  });

  function retry(): void {
    void checkForUpdates();
  }

  function install(): void {
    void downloadAndInstallUpdate();
  }

  function restart(): void {
    void relaunchApp();
  }
</script>

{#if app.update.status === "available"}
  <div class="mynx-card fixed left-1/2 top-12 z-40 flex -translate-x-1/2 items-center gap-2 border-warning px-3 py-2">
    <p class="text-[12px]">{t("update.available", { version: app.update.version ?? "" })}</p>
    <button type="button" class="mynx-btn mynx-btn-primary" onclick={install}>
      <IconDownload size={14} stroke={1.6} />
      {t("update.now")}
    </button>
    <button type="button" class="mynx-btn" onclick={dismissUpdate}>
      {t("update.later")}
    </button>
  </div>
{:else if app.update.status === "downloading"}
  <div class="mynx-card fixed left-1/2 top-12 z-40 flex -translate-x-1/2 items-center gap-2 px-3 py-2">
    <span class="mynx-badge mynx-badge-running">{t("status.running")}</span>
    <p class="text-[12px]">{t("update.downloading", { version: app.update.version ?? "" })}</p>
  </div>
{:else if app.update.status === "ready"}
  <div class="mynx-card fixed left-1/2 top-12 z-40 flex -translate-x-1/2 items-center gap-2 border-success px-3 py-2">
    <p class="text-[12px]">{t("update.complete")}</p>
    <button type="button" class="mynx-btn mynx-btn-primary" onclick={restart}>
      {t("update.restartNow")}
    </button>
    <button type="button" class="mynx-btn" onclick={dismissUpdate}>
      {t("update.restartLater")}
    </button>
  </div>
{:else if app.update.status === "failed"}
  <div class="mynx-card fixed left-1/2 top-12 z-40 flex -translate-x-1/2 items-center gap-2 border-danger px-3 py-2">
    <p class="mynx-truncate max-w-[420px] text-[12px] text-danger" title={app.update.error ?? ""}>
      {t("update.failed")}
    </p>
    <button type="button" class="mynx-btn" onclick={retry}>
      <IconRefresh size={14} stroke={1.6} />
      {t("update.retry")}
    </button>
  </div>
{/if}
