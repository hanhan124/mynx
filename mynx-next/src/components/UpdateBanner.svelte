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
  <div
    class="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-center gap-2 border-b border-warning bg-surface px-3 py-2"
    role="status"
  >
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
  <div
    class="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border bg-surface px-3 py-2"
    role="status"
  >
    <span class="mynx-badge mynx-badge-running">{t("status.running")}</span>
    <p class="text-[12px]">{t("update.downloading", { version: app.update.version ?? "" })}</p>
  </div>
{:else if app.update.status === "ready"}
  <div
    class="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-center gap-2 border-b border-success bg-surface px-3 py-2"
    role="status"
  >
    <p class="text-[12px]">{t("update.complete")}</p>
    <button type="button" class="mynx-btn mynx-btn-primary" onclick={restart}>
      {t("update.restartNow")}
    </button>
    <button type="button" class="mynx-btn" onclick={dismissUpdate}>
      {t("update.restartLater")}
    </button>
  </div>
{:else if app.update.status === "failed"}
  <div
    class="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-center gap-2 border-b border-danger bg-surface px-3 py-2"
    role="alert"
  >
    <p class="min-w-0 max-w-full break-words text-center text-[12px] text-danger" title={app.update.error ?? ""}>
      {t("update.failed")}
    </p>
    <button type="button" class="mynx-btn" onclick={retry}>
      <IconRefresh size={14} stroke={1.6} />
      {t("update.retry")}
    </button>
  </div>
{/if}
