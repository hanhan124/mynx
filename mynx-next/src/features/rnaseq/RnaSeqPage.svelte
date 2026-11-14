<script lang="ts">
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import IconChartDots from "@tabler/icons-svelte/icons/chart-dots";
  import IconCopy from "@tabler/icons-svelte/icons/copy";
  import IconDeviceFloppy from "@tabler/icons-svelte/icons/device-floppy";
  import IconFileImport from "@tabler/icons-svelte/icons/file-import";
  import IconFlask from "@tabler/icons-svelte/icons/flask";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconHelp from "@tabler/icons-svelte/icons/help";
  import IconHistory from "@tabler/icons-svelte/icons/history";
  import IconPalette from "@tabler/icons-svelte/icons/palette";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconPlayerPlay from "@tabler/icons-svelte/icons/player-play";
  import IconPlayerStop from "@tabler/icons-svelte/icons/player-stop";
  import IconRefresh from "@tabler/icons-svelte/icons/refresh";
  import IconTerminal from "@tabler/icons-svelte/icons/terminal-2";
  import { t } from "../../app/i18n.svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { pushToast } from "../../app/state.svelte";
  import { openPath } from "../../app/tauri.js";
  import type { ResultFileItem } from "../../lib/contracts/generated/rnaseq/ResultFileItem.js";
  import CopyableText from "../../components/CopyableText.svelte";
  import Modal from "../../components/Modal.svelte";
  import DesignStep from "./DesignStep.svelte";
  import ImportStep from "./ImportStep.svelte";
  import PlotsStep from "./PlotsStep.svelte";
  import { pickOpenDir, resultFileUrl } from "./client.js";
  import { baseName, formatFileSize, validComparisonsOf } from "./model.js";
  import {
    cancelRun,
    checkRDependencies,
    goStep,
    importCounts,
    initRnaseq,
    installMissingPackages,
    loadConfigFromDialog,
    loadHistory,
    loadResultDir,
    rnaseq,
    saveConfigToDialog,
    startRun,
    type RunPhase,
  } from "./state.svelte";

  /**
   * RNA-seq workbench: left rail (steps + run controls + config IO + R
   * packages), per-step content in the center, plus result gallery and run
   * history panels. The engine owns all methodology.
   */

  const RAIL: Array<{ id: "import" | "design" | "plots"; labelKey: string }> = [
    { id: "import", labelKey: "rnaseq.import" },
    { id: "design", labelKey: "rnaseq.analysis" },
    { id: "plots", labelKey: "rnaseq.plots" },
  ];

  const RUN_BADGE: Record<RunPhase, string> = {
    idle: "mynx-badge-queued",
    running: "mynx-badge-running",
    done: "mynx-badge-success",
    failed: "mynx-badge-error",
    cancelled: "mynx-badge-cancelled",
  };

  const cfg = $derived(rnaseq.config);
  const running = $derived(rnaseq.status === "running");
  const deReady = $derived(
    Object.keys(cfg.groups).length >= 2 && validComparisonsOf(cfg).length >= 1,
  );
  const groupedFiles = $derived.by(() => {
    // SvelteMap keeps the reactivity lint happy; grouping is inert bookkeeping.
    const map = new SvelteMap<string, ResultFileItem[]>();
    for (const file of rnaseq.resultFiles) {
      const list = map.get(file.subdir) ?? [];
      list.push(file);
      map.set(file.subdir, list);
    }
    return [...map.entries()];
  });

  let elapsedSec = $state(0);
  let logEl: HTMLDivElement | null = $state(null);
  let zoom = $state<{ subdir: string; name: string } | null>(null);
  let zoomOpen = $state(false);
  const zoomUrl = $derived(
    zoom && rnaseq.resultDir ? resultFileUrl(rnaseq.resultDir, zoom.subdir, zoom.name) : "",
  );
  const zoomIsImage = $derived(
    !!zoom && (zoom.name.toLowerCase().endsWith(".png") || zoom.name.toLowerCase().endsWith(".svg")),
  );

  $effect(() => {
    void initRnaseq();
  });

  /* Elapsed timer while a run is active. */
  $effect(() => {
    if (rnaseq.status !== "running") return;
    const started = Date.now();
    elapsedSec = 0;
    const timer = setInterval(() => {
      elapsedSec = Math.floor((Date.now() - started) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  });

  /* Keep the log console pinned to the newest line. */
  $effect(() => {
    void rnaseq.logs.length;
    if (!logEl) return;
    requestAnimationFrame(() => logEl?.scrollTo({ top: logEl.scrollHeight }));
  });

  /* Window drag-drop imports counts files while the import step is open. */
  $effect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          rnaseq.dragOver = rnaseq.step === "import";
        } else if (payload.type === "drop") {
          rnaseq.dragOver = false;
          if (rnaseq.step !== "import") return;
          const path = payload.paths.find((item) => /\.(csv|tsv|txt|xlsx)$/i.test(item));
          if (path) {
            void importCounts(path).catch((err: unknown) => {
              pushToast("error", t("rnaseq.importFailed", { detail: detailOf(err) }));
            });
          }
        } else {
          rnaseq.dragOver = false;
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Drag-drop events unavailable (e.g. outside the Tauri webview).
      });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  });

  function detailOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  function runLabel(phase: RunPhase): string {
    switch (phase) {
      case "done":
        return t("rnaseq.runDone");
      case "failed":
        return t("status.failed");
      case "cancelled":
        return t("status.cancelled");
      case "running":
        return t("status.running");
      default:
        return t("rnaseq.runIdle");
    }
  }

  function stepReady(step: "import" | "design" | "plots"): boolean {
    if (step === "import") return !!cfg.data_file;
    if (step === "design") return deReady;
    return rnaseq.hasResult;
  }

  type StepIcon = "import" | "design" | "plots" | "results" | "history";

  async function runAll(): Promise<void> {
    await startRun(["de", "heatmap", "plots"]);
  }

  async function runDe(): Promise<void> {
    await startRun(["de"]);
  }

  async function copyLog(): Promise<void> {
    try {
      await navigator.clipboard.writeText(rnaseq.logs.map((x) => x.message).join("\n"));
      pushToast("success", t("rnaseq.logCopied"));
    } catch {
      pushToast("error", t("copy.failed"));
    }
  }

  async function browseResult(): Promise<void> {
    const dir = await pickOpenDir({ title: t("rnaseq.loadResult") });
    if (!dir) return;
    const ok = await loadResultDir(dir);
    if (ok) rnaseq.step = "results";
  }

  async function loadHistoryRun(path: string): Promise<void> {
    const ok = await loadResultDir(path);
    if (ok) rnaseq.step = "results";
  }

  function historyDate(ms: number): string {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "";
    }
  }

  function fileUrl(file: ResultFileItem): string {
    return rnaseq.resultDir ? resultFileUrl(rnaseq.resultDir, file.subdir, file.name) : "";
  }

  function zoomFilePath(file: { subdir: string; name: string }): string {
    if (!rnaseq.resultDir) return "";
    const sep = rnaseq.resultDir.includes("\\") ? "\\" : "/";
    return `${rnaseq.resultDir.replace(/[\\/]+$/, "")}${sep}${file.subdir}${sep}${file.name}`;
  }

  function openZoom(file: ResultFileItem): void {
    zoom = { subdir: file.subdir, name: file.name };
    zoomOpen = true;
  }
</script>

{#snippet railIcon(id: StepIcon)}
  {#if id === "import"}
    <IconFileImport size={15} stroke={1.75} aria-hidden="true" />
  {:else if id === "design"}
    <IconFlask size={15} stroke={1.75} aria-hidden="true" />
  {:else if id === "plots"}
    <IconPalette size={15} stroke={1.75} aria-hidden="true" />
  {:else if id === "results"}
    <IconPhoto size={15} stroke={1.75} aria-hidden="true" />
  {:else}
    <IconHistory size={15} stroke={1.75} aria-hidden="true" />
  {/if}
{/snippet}

<section class="flex h-full min-h-0 flex-col gap-3 p-4">
  <header class="flex items-baseline gap-3">
    <h1 class="text-[16px] font-semibold">{t("rnaseq.title")}</h1>
    <p class="mynx-truncate text-[12px] text-text-secondary">{t("rnaseq.subtitle")}</p>
    <button
      type="button"
      class="mynx-btn mynx-btn-primary ml-auto shrink-0"
      onclick={() => (rnaseq.tutorialOpen = true)}
    >
      <IconHelp size={14} stroke={1.75} aria-hidden="true" />
      {t("rnaseq.tutorial")}
    </button>
  </header>

  {#if !rnaseq.configReady}
    <div class="mynx-card flex items-center gap-2 p-4 text-[12px] text-text-secondary">
      <IconRefresh size={14} stroke={1.75} aria-hidden="true" />
      {t("common.loading")}
    </div>
  {:else}
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[236px_minmax(0,1fr)]">
      <!-- ── Rail ─────────────────────────────────────────────────────────── -->
      <aside class="mynx-card flex flex-col gap-1 overflow-y-auto p-2">
        {#each RAIL as item (item.id)}
          <button
            type="button"
            class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors {rnaseq.step ===
            item.id
              ? 'border-accent bg-accent/10'
              : 'border-transparent hover:bg-surface-2'}"
            onclick={() => goStep(item.id)}
            aria-current={rnaseq.step === item.id ? "step" : undefined}
          >
            <span class="shrink-0">
              {@render railIcon(item.id)}
            </span>
            <span class="mynx-truncate flex-1 text-[12px] font-medium">
              {t(item.labelKey)}
            </span>
            {#if stepReady(item.id)}
              <span class="mynx-badge mynx-badge-success">{t("rnaseq.stepReady")}</span>
            {:else}
              <span class="mynx-badge mynx-badge-queued">{t("rnaseq.stepPending")}</span>
            {/if}
          </button>
        {/each}

        <div class="my-1 border-t border-border"></div>

        <button
          type="button"
          class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors {rnaseq.step ===
          'results'
            ? 'border-accent bg-accent/10'
            : 'border-transparent hover:bg-surface-2'}"
          onclick={() => goStep("results")}
          aria-current={rnaseq.step === "results" ? "step" : undefined}
        >
          <IconPhoto size={15} stroke={1.75} aria-hidden="true" />
          <span class="mynx-truncate flex-1 text-[12px] font-medium">
            {t("rnaseq.results")}
          </span>
          {#if rnaseq.resultFiles.length > 0}
            <span class="mynx-badge mynx-badge-success">{rnaseq.resultFiles.length}</span>
          {/if}
        </button>
        <button
          type="button"
          class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors {rnaseq.step ===
          'history'
            ? 'border-accent bg-accent/10'
            : 'border-transparent hover:bg-surface-2'}"
          onclick={() => goStep("history")}
          aria-current={rnaseq.step === "history" ? "step" : undefined}
        >
          <IconHistory size={15} stroke={1.75} aria-hidden="true" />
          <span class="mynx-truncate flex-1 text-[12px] font-medium">
            {t("rnaseq.history")}
          </span>
          {#if rnaseq.history.length > 0}
            <span class="mynx-badge mynx-badge-queued">{rnaseq.history.length}</span>
          {/if}
        </button>

        <div class="my-1 border-t border-border"></div>

        <!-- run controls -->
        <button
          type="button"
          class="mynx-btn mynx-btn-primary"
          disabled={running || !cfg.data_file || !deReady}
          onclick={() => void runAll()}
          title={t("rnaseq.runAll")}
        >
          <IconPlayerPlay size={14} stroke={1.75} aria-hidden="true" />
          {t("rnaseq.runAll")}
        </button>
        <button
          type="button"
          class="mynx-btn"
          disabled={running || !cfg.data_file || !deReady}
          onclick={() => void runDe()}
        >
          {t("rnaseq.runDeOnly")}
        </button>
        <div class="flex items-center gap-2 px-1">
          <span class="mynx-badge {RUN_BADGE[rnaseq.status]}">{runLabel(rnaseq.status)}</span>
          {#if running}
            <button type="button" class="mynx-btn mynx-btn-danger" onclick={() => void cancelRun()}>
              <IconPlayerStop size={13} stroke={1.75} aria-hidden="true" />
              {t("common.cancel")}
            </button>
            <span class="mynx-mono text-[11px] text-text-secondary">{elapsedSec}s</span>
          {/if}
        </div>

        <div class="my-1 border-t border-border"></div>

        <!-- config IO -->
        <button type="button" class="mynx-btn" onclick={() => void browseResult()}>
          <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
          {t("rnaseq.loadResult")}
        </button>
        <button type="button" class="mynx-btn" onclick={() => void loadConfigFromDialog()}>
          {t("rnaseq.loadConfig")}
        </button>
        <button type="button" class="mynx-btn" onclick={() => void saveConfigToDialog()}>
          <IconDeviceFloppy size={14} stroke={1.75} aria-hidden="true" />
          {t("rnaseq.saveConfig")}
        </button>

        <div class="my-1 border-t border-border"></div>

        <!-- R packages -->
        <div class="flex flex-col gap-1 rounded-md border border-border p-2">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-semibold">{t("rnaseq.rPackages")}</span>
            <button
              type="button"
              class="mynx-btn ml-auto !h-6 !w-6 !p-0"
              onclick={() => void checkRDependencies()}
              disabled={rnaseq.installPhase === "running"}
              aria-label={t("common.refresh")}
              title={t("common.refresh")}
            >
              <IconRefresh size={12} stroke={1.6} aria-hidden="true" />
            </button>
          </div>
          {#if rnaseq.rDeps === null}
            <span class="text-[11px] text-text-secondary">{t("rnaseq.rCheckUnavailable")}</span>
          {:else if rnaseq.rDeps.missing.length === 0}
            <span class="mynx-badge mynx-badge-success">{t("rnaseq.rAllInstalled")}</span>
          {:else}
            <span class="mynx-truncate text-[11px] text-warning" title={rnaseq.rDeps.missing.join(", ")}>
              {t("rnaseq.rMissing", { list: rnaseq.rDeps.missing.join(", ") })}
            </span>
            <button
              type="button"
              class="mynx-btn"
              disabled={rnaseq.installPhase === "running"}
              onclick={() => void installMissingPackages()}
            >
              {rnaseq.installPhase === "running"
                ? t("status.running")
                : t("rnaseq.rInstall")}
            </button>
          {/if}
        </div>
      </aside>

      <!-- ── Center content ─────────────────────────────────────────────── -->
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {#if rnaseq.step === "import"}
          <ImportStep />
        {:else if rnaseq.step === "design"}
          <DesignStep />
        {:else if rnaseq.step === "plots"}
          <PlotsStep />
        {:else if rnaseq.step === "results"}
          <!-- results panel -->
          <div class="mynx-card flex flex-col">
            <div class="flex items-center gap-2 border-b border-border px-3 py-2">
              <IconPhoto size={15} stroke={1.75} aria-hidden="true" />
              <span class="text-[12px] font-semibold">{t("rnaseq.results")}</span>
              {#if rnaseq.resultDir}
                <span class="ml-auto">
                  <CopyableText text={rnaseq.resultDir} label={baseName(rnaseq.resultDir)} />
                </span>
                <button
                  type="button"
                  class="mynx-btn !h-7 !w-7 !p-0"
                  aria-label={t("rnaseq.openResults")}
                  title={t("rnaseq.openResults")}
                  onclick={() => void openPath(rnaseq.resultDir)}
                >
                  <IconFolderOpen size={13} stroke={1.75} aria-hidden="true" />
                </button>
              {/if}
            </div>
            <div class="flex flex-col gap-3 p-3">
              {#if rnaseq.deSummary.length > 0}
                <div class="flex flex-col gap-1">
                  <span class="text-[12px] font-medium">{t("rnaseq.deSummaryTitle")}</span>
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-[12px]">
                      <thead>
                        <tr class="border-b border-border text-text-secondary">
                          <th class="px-2 py-1 font-medium">{t("rnaseq.deSummaryComparison")}</th>
                          <th class="px-2 py-1 font-medium">{t("rnaseq.deSummaryPath")}</th>
                          <th class="px-2 py-1 font-medium">{t("rnaseq.deSummaryMethod")}</th>
                          <th class="px-2 py-1 font-medium">{t("rnaseq.deSummaryTested")}</th>
                          <th class="px-2 py-1 font-medium text-danger">
                            {t("rnaseq.deSummaryUp")}
                          </th>
                          <th class="px-2 py-1 font-medium text-accent">
                            {t("rnaseq.deSummaryDown")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each rnaseq.deSummary as row (row.comparison)}
                          <tr class="border-b border-border/60 last:border-0">
                            <td class="px-2 py-1">{row.comparison}</td>
                            <td class="px-2 py-1">
                              <span
                                class="mynx-badge {row.path === 'noreplicate'
                                  ? 'mynx-badge-queued'
                                  : 'mynx-badge-success'}"
                              >
                                {row.path === "noreplicate"
                                  ? t("rnaseq.pathNoReplicateShort")
                                  : t("rnaseq.pathReplicateShort")}
                              </span>
                            </td>
                            <td class="px-2 py-1 text-text-secondary">{row.method}</td>
                            <td class="px-2 py-1">{row.genesTested.toLocaleString()}</td>
                            <td class="px-2 py-1 text-danger">{row.up}</td>
                            <td class="px-2 py-1 text-accent">{row.down}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              {/if}
              {#if rnaseq.resultFiles.length > 0}
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] font-medium">{t("rnaseq.outputFigures")}</span>
                    <span class="mynx-badge mynx-badge-queued">
                      {t("rnaseq.filesCount", { count: rnaseq.resultFiles.length })}
                    </span>
                  </div>
                  {#each groupedFiles as [subdir, files] (subdir)}
                    <div class="flex flex-col gap-1">
                      <span class="mynx-truncate text-[11px] font-medium text-text-secondary">
                        {subdir}
                      </span>
                      <div
                        class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                      >
                        {#each files as file (file.name)}
                          <figure class="flex min-w-0 flex-col gap-1">
                            <button
                              type="button"
                              class="group relative flex h-[120px] items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2 p-1"
                              title={file.name}
                              onclick={() => openZoom(file)}
                            >
                              {#if file.name.toLowerCase().endsWith(".png") ||
                                file.name.toLowerCase().endsWith(".svg")}
                                <img
                                  src={fileUrl(file)}
                                  alt={file.name}
                                  loading="lazy"
                                  class="max-h-full max-w-full object-contain"
                                />
                              {:else}
                                <span class="text-[12px] font-medium text-text-secondary">
                                  {file.name.split(".").pop()?.toUpperCase()}
                                </span>
                              {/if}
                            </button>
                            <figcaption class="flex flex-col gap-0.5">
                              <span class="mynx-truncate text-[11px] font-medium" title={file.name}>
                                {file.name}
                              </span>
                              <span class="text-[10px] text-text-secondary">
                                {formatFileSize(file.size)}
                              </span>
                            </figcaption>
                          </figure>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              {:else if !rnaseq.hasResult}
                <p class="text-[12px] text-text-secondary">{t("rnaseq.errNotRunDir")}</p>
              {/if}
            </div>
          </div>
        {:else}
          <!-- history panel -->
          <div class="mynx-card flex flex-col">
            <div class="flex items-center gap-2 border-b border-border px-3 py-2">
              <IconHistory size={15} stroke={1.75} aria-hidden="true" />
              <span class="text-[12px] font-semibold">{t("rnaseq.history")}</span>
              <button
                type="button"
                class="mynx-btn ml-auto"
                disabled={rnaseq.historyPhase === "running"}
                onclick={() => void loadHistory()}
              >
                <IconRefresh size={14} stroke={1.75} aria-hidden="true" />
                {t("common.refresh")}
              </button>
            </div>
            <div class="flex flex-col gap-2 p-3">
              <p class="text-[11px] text-text-secondary">{t("rnaseq.historyHint")}</p>
              {#if rnaseq.history.length === 0}
                <p class="text-[12px] text-text-secondary">{t("rnaseq.historyEmpty")}</p>
              {:else}
                {#each rnaseq.history as entry (entry.path)}
                  <div
                    class="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
                  >
                    <span class="mynx-truncate min-w-0 flex-1 text-[12px] font-medium" title={entry.path}>
                      {entry.name}
                    </span>
                    {#if entry.hasDe}
                      <span class="mynx-badge mynx-badge-success">{t("rnaseq.hasDe")}</span>
                    {:else}
                      <span class="mynx-badge mynx-badge-queued">{t("rnaseq.noDe")}</span>
                    {/if}
                    <span class="text-[11px] text-text-secondary">
                      {historyDate(entry.mtimeMs)}
                    </span>
                    <CopyableText text={entry.path} label={baseName(entry.path)} />
                    <button
                      type="button"
                      class="mynx-btn"
                      onclick={() => void loadHistoryRun(entry.path)}
                    >
                      <IconChartDots size={13} stroke={1.75} aria-hidden="true" />
                      {t("rnaseq.historyLoad")}
                    </button>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}

        <!-- ── Run console ───────────────────────────────────────────────── -->
        {#if rnaseq.logs.length > 0 || running}
          <div class="mynx-card flex flex-col">
            <div class="flex items-center gap-2 border-b border-border px-3 py-2">
              <IconTerminal size={15} stroke={1.75} aria-hidden="true" />
              <span class="text-[12px] font-semibold">
                {t("rnaseq.logTitle", { count: rnaseq.logs.length })}
              </span>
              <span class="mynx-badge {RUN_BADGE[rnaseq.status]} ml-auto">
                {runLabel(rnaseq.status)}
              </span>
              <button
                type="button"
                class="mynx-btn !h-7 !w-7 !p-0"
                aria-label={t("rnaseq.copyLog")}
                title={t("rnaseq.copyLog")}
                onclick={() => void copyLog()}
              >
                <IconCopy size={13} stroke={1.75} aria-hidden="true" />
              </button>
            </div>
            <div class="p-3">
              <div
                bind:this={logEl}
                class="mynx-mono flex max-h-[220px] flex-col overflow-y-auto rounded-md border border-border bg-surface-2 p-2"
                role="log"
              >
                {#each rnaseq.logs as line, index (index)}
                  <div
                    class="whitespace-pre-wrap {line.level === 'error'
                      ? 'text-danger'
                      : line.level === 'warning'
                        ? 'text-warning'
                        : line.level === 'success'
                          ? 'text-success'
                          : 'text-text-secondary'}"
                  >
                    {line.message}
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>

<!-- zoom modal -->
<Modal bind:open={zoomOpen} title={zoom?.name ?? ""} width={920}>
  <div class="flex flex-col items-center gap-2 text-center">
    {#if zoom && zoomIsImage}
      <img src={zoomUrl} alt={zoom.name} class="max-h-[65vh] max-w-full object-contain" />
    {:else if zoom}
      <p class="text-[12px] text-text-secondary">{zoom.name} · PDF</p>
      <button
        type="button"
        class="mynx-btn mynx-btn-primary"
        onclick={() => {
          if (zoom) void openPath(zoomFilePath(zoom));
        }}
      >
        <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
        {t("rnaseq.openResults")}
      </button>
    {/if}
  </div>
</Modal>

<!-- tutorial modal -->
<Modal bind:open={rnaseq.tutorialOpen} title={t("rnaseq.tutorial")} width={560}>
  <div class="flex flex-col gap-2 text-[12px]">
    <p>{t("rnaseq.tutorialIntro")}</p>
    <p>{t("rnaseq.tutorialStep1")}</p>
    <p>{t("rnaseq.tutorialStep2")}</p>
    <p>{t("rnaseq.tutorialStep3")}</p>
    <p>{t("rnaseq.tutorialResults")}</p>
  </div>
</Modal>
