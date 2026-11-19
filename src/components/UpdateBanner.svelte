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
    downloadPercent,
    formatBytes,
    relaunchApp,
  } from "../app/updater.svelte";

  const progressPercent = $derived(
    downloadPercent(app.update.downloadedBytes, app.update.totalBytes),
  );
  const progressLabel = $derived(
    progressPercent === null
      ? `${formatBytes(app.update.downloadedBytes)} · ${formatBytes(app.update.speedBytesPerSecond)}/s`
      : `${progressPercent}% · ${formatBytes(app.update.speedBytesPerSecond)}/s`,
  );

  onMount(() => {
    if (import.meta.env.DEV && window.location.search.includes("devUpdate=downloading")) {
      app.update.status = "downloading";
      app.update.version = "3.0.1";
      app.update.downloadedBytes = 7.4 * 1024 * 1024;
      app.update.totalBytes = 16 * 1024 * 1024;
      app.update.speedBytesPerSecond = 2.1 * 1024 * 1024;
      return;
    }
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
    class="flex w-full min-w-0 shrink-0 flex-col gap-1.5 border-b border-border bg-surface px-3 py-2"
    role="status"
    aria-live="off"
  >
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p class="min-w-0 text-[12px]">
        <span class="mynx-badge mynx-badge-running mr-2">{t("status.running")}</span>
        {t("update.downloading", { version: app.update.version ?? "" })}
      </p>
      <span class="shrink-0 text-[11px] tabular-nums text-text-secondary">{progressLabel}</span>
    </div>
    <div
      class="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-label={t("update.downloadProgress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progressPercent ?? undefined}
      aria-valuetext={progressLabel}
    >
      <div
        class="h-full rounded-full bg-accent transition-[width] duration-200 {progressPercent === null ? 'motion-safe:animate-pulse' : ''}"
        style:width="{progressPercent ?? 34}%"
      ></div>
    </div>
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
