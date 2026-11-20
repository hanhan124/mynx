<script lang="ts">
  import { tick, untrack } from "svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconChartAreaLine from "@tabler/icons-svelte/icons/chart-area-line";
  import IconChartBubble from "@tabler/icons-svelte/icons/chart-bubble";
  import IconChartDots3 from "@tabler/icons-svelte/icons/chart-dots-3";
  import IconChartPie from "@tabler/icons-svelte/icons/chart-pie";
  import IconChartScatter from "@tabler/icons-svelte/icons/chart-scatter";
  import IconCircleCheckFilled from "@tabler/icons-svelte/icons/circle-check-filled";
  import IconCopy from "@tabler/icons-svelte/icons/copy";
  import IconDeviceFloppy from "@tabler/icons-svelte/icons/device-floppy";
  import IconDownload from "@tabler/icons-svelte/icons/download";
  import IconExternalLink from "@tabler/icons-svelte/icons/external-link";
  import IconFileImport from "@tabler/icons-svelte/icons/file-import";
  import IconFileSpreadsheet from "@tabler/icons-svelte/icons/file-spreadsheet";
  import IconFolder from "@tabler/icons-svelte/icons/folder";
  import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
  import IconMapPin from "@tabler/icons-svelte/icons/map-pin";
  import IconPlayerPlayFilled from "@tabler/icons-svelte/icons/player-play-filled";
  import IconPlayerStopFilled from "@tabler/icons-svelte/icons/player-stop-filled";
  import IconRadar from "@tabler/icons-svelte/icons/radar";
  import IconSearch from "@tabler/icons-svelte/icons/search";
  import IconSparkles from "@tabler/icons-svelte/icons/sparkles";
  import IconTopologyStar3 from "@tabler/icons-svelte/icons/topology-star-3";
  import IconTrash from "@tabler/icons-svelte/icons/trash";
  import IconUpload from "@tabler/icons-svelte/icons/upload";
  import IconX from "@tabler/icons-svelte/icons/x";
  import Modal from "../../components/Modal.svelte";
  import CopyableText from "../../components/CopyableText.svelte";
  import StateBadge from "../../components/StateBadge.svelte";
  import { openPath } from "../../app/tauri.js";
  import { app, pushToast } from "../../app/state.svelte";
  import { t } from "../../app/i18n.svelte";
  import { panelWidths, savePanelWidths, setPanelWidth } from "../../app/panel-widths.svelte";
  import ColumnResizeHandle from "../../components/ColumnResizeHandle.svelte";
  import {
    currentChartNavigationId,
    formatChartNavigationDiagnostics,
    recordChartNavigationStage,
  } from "../../lib/chart-navigation-timings.js";
  import {
    chartTemplates,
    localizedFamily,
    localizedTemplate,
    type ChartTemplate,
  } from "./catalog.js";
  import {
    HEATMAP_KINDS,
    INSPECTOR_SECTIONS,
    clampInspectorNumber,
    applyLegendToggle,
    type ChartConfigDraft,
    type LegendPosition,
    type PublicationPreset,
  } from "./inspector-fields.js";
  import {
    chartState,
    applyPublicationPreset,
    clearData,
    confirmInstallR,
    copySvgSource,
    deletePreset,
    dismissInstallRPrompt,
    exportPresetsFile,
    exportResultPackage,
    exportTemplatePackage,
    importDataFile,
    importPresetsFile,
    importTemplatePackage,
    loadChartStudioSettings,
    loadPreset,
    refreshRStatus,
    requestCancel,
    resolveReferenceUrl,
    roleFieldMapFor,
    runGeneration,
    savePreset,
    selectTemplate,
    setRoleColumn,
    updateConfig,
    useSampleData,
    validateRunInputs,
    type RunValidation,
    type RunPhase,
    type RunTone,
  } from "./state.svelte";
  import type { TaskStatus } from "../../lib/contracts/generated/task/TaskStatus.js";
  import { samples } from "./samples.js";

  /* ── Display catalogs ─────────────────────────────────────────────────── */

  const FAMILIES: string[] = [
    "全部",
    ...Array.from(new Set(chartTemplates.map((item) => item.family))),
  ];

  const STAGE_KEYS: Record<string, string> = {
    environment: "charts.stageEnvironment",
    data: "charts.stageData",
    dependencies: "charts.stageDependencies",
    render: "charts.stageRender",
    save: "charts.stageSave",
    cancel: "charts.stageCancel",
    error: "charts.stageError",
    log: "charts.stageLog",
  };

  const TONE_BADGE: Record<RunTone, string> = {
    info: "mynx-badge-queued",
    success: "mynx-badge-success",
    error: "mynx-badge-error",
    cancelled: "mynx-badge-cancelled",
  };

  const PHASE_BADGE: Record<Exclude<RunPhase, "idle">, TaskStatus> = {
    running: "running",
    success: "succeeded",
    error: "failed",
    cancelled: "cancelled",
  };

  const PHASE_KEY: Record<RunPhase, string> = {
    idle: "idle",
    running: "running",
    success: "succeeded",
    error: "failed",
    cancelled: "cancelled",
  };

  function templateIcon(template: ChartTemplate) {
    switch (template.icon) {
      case "bar":
        return IconChartBar;
      case "line":
        return IconChartAreaLine;
      case "scatter":
        return IconChartScatter;
      case "distribution":
        return IconChartDots3;
      case "pie":
        return IconChartPie;
      case "matrix":
        return IconChartBubble;
      case "network":
        return IconTopologyStar3;
      case "radar":
        return IconRadar;
      default:
        return IconMapPin;
    }
  }

  function baseName(path: string): string {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || path;
  }

  /* ── Derived state ────────────────────────────────────────────────────── */

  let dragOver = $state(false);
  let presetDialogOpen = $state(false);
  let presetName = $state("");
  let deleteTarget = $state<{ id: string; name: string } | null>(null);
  let rDialogOpen = $state(false);
  let runValidation = $state<RunValidation | null>(null);
  // Keep collapsed sections light on each page mount; restore their controls on first open.
  let mountedInspectorSections = $state(["layout"]);

  const cfg = $derived(chartState.cfg);
  const template = $derived(
    chartTemplates.find((item) => item.id === chartState.selectedTemplateId) ??
      chartTemplates[0],
  );
  const templateCopy = $derived(localizedTemplate(template, app.language));
  const running = $derived(chartState.runPhase === "running" || chartState.installingR);
  const families = $derived(FAMILIES);
  const visibleTemplates = $derived.by(() => {
    const query = chartState.search.trim().toLowerCase();
    return chartTemplates.filter((item) => {
      if (chartState.family !== "全部" && item.family !== chartState.family) return false;
      if (!query) return true;
      const copy = localizedTemplate(item, app.language);
      return `${copy.name} ${copy.description} ${item.kind}`.toLowerCase().includes(query);
    });
  });
  const imported = $derived(chartState.imported);
  const previewRows = $derived((imported?.rows ?? []).slice(0, 8));
  const roleField = $derived(roleFieldMapFor(chartState.selectedTemplateId));
  const mappedRoles = $derived(
    (chartState.manifest?.dataRoles ?? []).filter((role) => roleField[role.key] !== undefined),
  );
  const unmappedRoles = $derived(
    (chartState.manifest?.dataRoles ?? []).filter((role) => roleField[role.key] === undefined),
  );
  const runStatus = $derived(
    chartState.installingR
      ? "running"
      : chartState.runPhase === "idle"
        ? "queued" // idle renders no badge; this keeps the derived total
        : PHASE_BADGE[chartState.runPhase],
  );
  const runStatusText = $derived(
    chartState.cancelling
      ? t("charts.cancelling")
      : chartState.installingR
        ? t("charts.installingR")
        : t(`status.${PHASE_KEY[chartState.runPhase]}`),
  );
  const latestProgress = $derived.by(() => {
    for (let i = chartState.events.length - 1; i >= 0; i -= 1) {
      const progress = chartState.events[i]?.progress;
      if (typeof progress === "number") return progress;
    }
    return null;
  });
  const resultUrl = $derived.by(() => {
    const result = chartState.lastResult;
    if (!result?.outputPath) return "";
    const lower = result.outputPath.toLowerCase();
    if (!lower.endsWith(".png") && !lower.endsWith(".svg")) return "";
    return convertFileSrc(result.outputPath);
  });
  const isSvgResult = $derived(
    (chartState.lastResult?.outputPath ?? "").toLowerCase().endsWith(".svg"),
  );
  const savePresetDisabled = $derived(running);

  function fieldOfRole(roleKey: string): "x" | "y" | "group" | "size" | null {
    return roleField[roleKey] ?? null;
  }

  /* ── Lifecycle effects ────────────────────────────────────────────────── */

  /* Restore presets / output dir, check R, and load the initial manifest. */
  $effect(() => {
    if (app.route !== "/charts") return;
    untrack(() => {
      const sampleId = currentChartNavigationId();
      const selectedTemplateId = chartState.selectedTemplateId;
      void loadChartStudioSettings(sampleId);
      void refreshRStatus(false, sampleId);
      if (chartState.manifest?.id === selectedTemplateId) {
        recordChartNavigationStage(sampleId, "manifestReady", "cached");
        if (chartState.referenceUrl || chartState.referenceError) {
          recordChartNavigationStage(
            sampleId,
            "referenceReady",
            chartState.referenceError ? "cached-error" : "cached",
          );
        }
      } else {
        void selectTemplate(selectedTemplateId).then(() => {
          recordChartNavigationStage(
            sampleId,
            "manifestReady",
            chartState.manifest?.id === selectedTemplateId ? "loaded" : "unavailable",
          );
        });
      }
    });
  });

  /* Surface a run-time "install R?" prompt through the shared dialog. */
  $effect(() => {
    if (app.route !== "/charts") return;
    if (chartState.rInstallPrompt) {
      chartState.rInstallPrompt = false;
      rDialogOpen = true;
    }
  });

  /* Do not leave a page-local dialog open after the cached page is hidden. */
  $effect(() => {
    if (app.route === "/charts") return;
    presetDialogOpen = false;
    deleteTarget = null;
    rDialogOpen = false;
  });

  /* Reference image follows the selected template + its manifest. */
  $effect(() => {
    void chartState.selectedTemplateId;
    void chartState.manifest;
    void resolveReferenceUrl(chartState.selectedTemplateId, currentChartNavigationId());
  });

  /* Window-level drag-drop for data files, scoped to this page. */
  $effect(() => {
    if (app.route !== "/charts") return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          dragOver = true;
        } else if (payload.type === "drop") {
          dragOver = false;
          const dataPath = payload.paths.find((path) =>
            /\.(csv|tsv|txt|xlsx|xls)$/i.test(path),
          );
          if (dataPath) {
            runValidation = null;
            void importDataFile(dataPath);
          }
          else pushToast("info", t("charts.dropHint"));
        } else {
          dragOver = false;
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Drag-drop events unavailable outside the Tauri webview.
      });
    return () => {
      disposed = true;
      dragOver = false;
      if (unlisten) unlisten();
    };
  });

  /* ── Page actions ─────────────────────────────────────────────────────── */

  async function pickData(): Promise<void> {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "数据文件", extensions: ["csv", "tsv", "txt", "xlsx", "xls"] }],
    });
    if (typeof picked === "string") {
      runValidation = null;
      await importDataFile(picked);
    }
  }

  async function pickOutputDir(): Promise<void> {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") updateConfig({ outputDir: picked });
  }

  async function downloadSample(): Promise<void> {
    const text = samples[cfg.template];
    if (!text) {
      pushToast("info", t("charts.noSample"));
      return;
    }
    const path = await saveDialog({
      defaultPath: `${cfg.template}-sample.csv`,
      filters: [{ name: "CSV 数据", extensions: ["csv"] }],
    });
    if (!path) return;
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, new TextEncoder().encode(text));
    pushToast("success", t("charts.sampleLoaded"));
  }

  async function downloadTemplateZip(): Promise<void> {
    const path = await saveDialog({
      defaultPath: `${cfg.template}-template.zip`,
      filters: [{ name: "模板压缩包", extensions: ["zip"] }],
    });
    if (path) await exportTemplatePackage(template, path);
  }

  function openPresetDialog(): void {
    presetName = templateCopy.name;
    presetDialogOpen = true;
  }

  async function confirmSavePreset(): Promise<void> {
    presetDialogOpen = false;
    await savePreset(presetName);
  }

  async function pickPresetsImport(): Promise<void> {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "参数文件", extensions: ["json"] }],
    });
    if (typeof picked === "string") await importPresetsFile(picked);
  }

  async function pickPresetsExport(): Promise<void> {
    const path = await saveDialog({
      defaultPath: "mynx-chart-presets.json",
      filters: [{ name: "参数文件", extensions: ["json"] }],
    });
    if (path) await exportPresetsFile(path);
  }

  async function pickZipPackage(): Promise<void> {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "模板压缩包", extensions: ["zip"] }],
    });
    if (typeof picked === "string") await importTemplatePackage(picked);
  }

  async function pickZipExport(): Promise<void> {
    const path = await saveDialog({
      defaultPath: "mynx-figure-package.zip",
      filters: [{ name: "ZIP 结果包", extensions: ["zip"] }],
    });
    if (path) await exportResultPackage(path);
  }

  async function openResult(): Promise<void> {
    const path = chartState.lastResult?.outputPath;
    if (!path) return;
    try {
      await openPath(path);
    } catch {
      pushToast("error", t("task.openDirFailed", { detail: path }));
    }
  }

  async function openOutputDir(): Promise<void> {
    if (cfg.outputDir) await openPath(cfg.outputDir).catch(() => {});
  }

  async function copyLog(): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      const timingDiagnostics = formatChartNavigationDiagnostics();
      const diagnosticText = timingDiagnostics
        ? `${chartState.logText}\n\n--- chart navigation performance ---\n${timingDiagnostics}`
        : chartState.logText;
      await navigator.clipboard.writeText(diagnosticText);
      pushToast("success", t("copy.copied"));
    } catch {
      pushToast("error", t("copy.failed"));
    }
  }

  function askInstallR(): void {
    if (chartState.installingR) return;
    rDialogOpen = true;
  }

  async function confirmInstall(): Promise<void> {
    rDialogOpen = false;
    await confirmInstallR();
  }

  /* ── Inspector field rendering ────────────────────────────────────────── */

  function sectionVisible(sectionId: string): boolean {
    if (sectionId === "heatmap") return (HEATMAP_KINDS as readonly string[]).includes(template.kind);
    return true;
  }

  function mountInspectorSection(sectionId: string): void {
    if (mountedInspectorSections.includes(sectionId)) return;
    mountedInspectorSections = [...mountedInspectorSections, sectionId];
  }

  function onInspectorToggle(sectionId: string, event: Event): void {
    if ((event.currentTarget as HTMLDetailsElement).open) mountInspectorSection(sectionId);
  }

  function optionLabel(option: { value: string; labelKey?: string; label?: string }): string {
    return option.labelKey ? t(option.labelKey) : (option.label ?? option.value);
  }

  function numberValue(key: keyof ChartConfigDraft): number {
    const value = cfg[key];
    return typeof value === "number" ? value : 0;
  }

  function onNumberInput(field: keyof ChartConfigDraft, raw: string, min: number, max: number): void {
    const next = clampInspectorNumber(raw, min, max);
    if (next !== null) updateConfig({ [field]: next } as Partial<ChartConfigDraft>);
  }

  function onTextInput(field: keyof ChartConfigDraft, raw: string): void {
    updateConfig({ [field]: raw } as Partial<ChartConfigDraft>);
  }

  function onSwitch(field: keyof ChartConfigDraft, checked: boolean): void {
    if (field === "showLegend") {
      const next = applyLegendToggle(
        {
          showLegend: cfg.showLegend ?? true,
          legendPosition: (cfg.legendPosition ?? "right") as LegendPosition,
        },
        checked,
      );
      updateConfig({ showLegend: next.showLegend, legendPosition: next.legendPosition });
      return;
    }
    updateConfig({ [field]: checked } as Partial<ChartConfigDraft>);
  }

  function onPresetSelect(value: string): void {
    applyPublicationPreset(value as PublicationPreset);
  }

  function roleOptions(column: string | null): string[] {
    const columns = imported?.columns ?? [];
    const current = column ?? "";
    if (current && !columns.includes(current)) return [current, ...columns];
    return columns;
  }

  function roleInputId(roleKey: string): string {
    return `charts-role-${encodeURIComponent(roleKey)}`;
  }

  async function submitGeneration(): Promise<void> {
    runValidation = validateRunInputs(chartState.cfg, chartState.manifest, chartState.imported);
    if (runValidation?.roleKey) {
      await tick();
      document.getElementById(roleInputId(runValidation.roleKey))?.focus();
    }
    await runGeneration();
  }
</script>

{#snippet fieldLabel(label: string, required?: boolean)}
  <span class="flex items-center gap-1 text-[12px] font-medium">
    <span class="mynx-truncate">{label}</span>
    {#if required}
      <span class="shrink-0 text-[10px] text-danger">{t("charts.roleRequired")}</span>
    {/if}
  </span>
{/snippet}

<section
  class="flex min-h-full flex-col gap-3 p-4 {dragOver ? 'ring-2 ring-accent ring-inset' : ''}"
>
  <header class="flex shrink-0 flex-wrap items-baseline gap-3">
    <h1 class="mynx-page-title">{t("nav.charts")}</h1>
    <div class="flex w-full min-w-0 flex-wrap items-center gap-2 xl:ml-auto xl:w-auto">
      {#if chartState.rFound === false}
        <button type="button" class="mynx-btn mynx-btn-danger" onclick={askInstallR}>
          <IconDownload size={14} stroke={1.75} aria-hidden="true" />
          {t("charts.installRButton")}
        </button>
      {/if}
      <span
        class="mynx-chip {chartState.rFound === false ? 'text-danger' : ''}"
        role="status"
        title={chartState.rFound === false ? t("charts.rMissing") : t("charts.rReady")}
      >
        {chartState.rFound === null
          ? t("charts.rChecking")
          : chartState.rFound
            ? t("charts.rReady")
            : t("charts.rMissing")}
      </span>
      <button type="button" class="mynx-btn" onclick={openPresetDialog} disabled={savePresetDisabled}>
        <IconDeviceFloppy size={14} stroke={1.75} aria-hidden="true" />
        {t("charts.savePreset")}
      </button>
      <button type="button" class="mynx-btn" onclick={() => void pickPresetsImport()} disabled={running}>
        <IconUpload size={14} stroke={1.75} aria-hidden="true" />
        {t("charts.importPresets")}
      </button>
      <button type="button" class="mynx-btn" onclick={() => void pickPresetsExport()} disabled={running}>
        <IconDownload size={14} stroke={1.75} aria-hidden="true" />
        {t("charts.exportPresets")}
      </button>
      <button type="button" class="mynx-btn" onclick={() => void pickZipPackage()} disabled={running}>
        <IconFileImport size={14} stroke={1.75} aria-hidden="true" />
        {t("charts.templatePackage")}
      </button>
    </div>
  </header>

  <!-- Stacked rows need their content height; flex-1/min-h-0 squeezed them into
       the remaining viewport and let their contents overlap the following rows. -->
  <div
    class="mynx-resizable-three shrink-0 items-start"
    style={`--mynx-first-column: ${panelWidths.chartsCatalog}px; --mynx-third-column: ${panelWidths.chartsInspector}px`}
  >
    <!-- ── Left: template catalog ─────────────────────────────────────── -->
    <div class="mynx-card flex min-w-0 flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <span class="text-[12px] font-semibold">{t("charts.templates")}</span>
        <span class="mynx-chip">{visibleTemplates.length}/{chartTemplates.length}</span>
      </div>
      <div class="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <IconSearch size={14} stroke={1.75} class="shrink-0 text-text-secondary" aria-hidden="true" />
        <input
          type="search"
          class="mynx-input min-w-0 flex-1"
          value={chartState.search}
          placeholder={t("charts.searchPlaceholder")}
          aria-label={t("charts.searchAria")}
          disabled={running}
          oninput={(event) => {
            chartState.search = event.currentTarget.value;
          }}
        />
        {#if chartState.search}
          <button
            type="button"
            class="mynx-btn shrink-0 px-2"
            onclick={() => {
              chartState.search = "";
            }}
            aria-label={t("charts.clearSearch")}
            title={t("charts.clearSearch")}
            disabled={running}
          >
            <IconX size={12} stroke={1.75} aria-hidden="true" />
          </button>
        {/if}
      </div>
      <div class="flex flex-wrap gap-1 border-b border-border px-3 py-2" role="group" aria-label={t("charts.templates")}>
        {#each families as family (family)}
          <button
            type="button"
            aria-pressed={chartState.family === family}
            class="mynx-btn px-2 py-1 text-[11px] {chartState.family === family
              ? 'border-accent bg-accent/10 text-accent'
              : ''}"
            onclick={() => {
              chartState.family = family;
            }}
            disabled={running}
          >
            {family === "全部" ? t("charts.selectAll") : localizedFamily(family, app.language)}
          </button>
        {/each}
      </div>
      <div class="max-h-80 overflow-y-auto p-2 xl:max-h-[36rem]">
        {#if visibleTemplates.length === 0}
          <p class="p-3 text-center text-[12px] text-text-secondary">{t("charts.noMatch")}</p>
        {:else}
          <ul class="flex flex-col gap-1">
            {#each visibleTemplates as item (item.id)}
              {@const Icon = templateIcon(item)}
              {@const copy = localizedTemplate(item, app.language)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-md p-1.5 text-left {item.id ===
                  chartState.selectedTemplateId
                    ? 'border border-accent bg-accent/10'
                    : 'border border-transparent hover:bg-surface-2'}"
                  aria-pressed={item.id === chartState.selectedTemplateId}
                  disabled={running}
                  onclick={() => {
                    runValidation = null;
                    void selectTemplate(item.id);
                  }}
                >
                  <span
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-text-secondary"
                    aria-hidden="true"
                  >
                    <Icon size={15} stroke={1.75} />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="mynx-truncate block text-[12px] font-medium">{copy.name}</span>
                    <span class="mynx-truncate block text-[11px] text-text-secondary">
                      {copy.description}
                    </span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <ColumnResizeHandle
      label={t("layout.resizeColumn")}
      value={panelWidths.chartsCatalog}
      min={220}
      max={520}
      onresize={(width) => setPanelWidth("chartsCatalog", width)}
      oncommit={savePanelWidths}
    />

    <!-- ── Center: data + mapping + run ───────────────────────────────── -->
    <div class="flex min-w-0 flex-col gap-3">
      <div class="mynx-card flex shrink-0 flex-col">
        <div class="flex items-center gap-2 border-b border-border px-3 py-2">
          <IconFileSpreadsheet size={15} stroke={1.75} aria-hidden="true" />
          <span class="text-[12px] font-semibold">{t("charts.dataPanel")}</span>
        </div>
        <div class="flex flex-col gap-3 p-3">
          <div
            class="flex items-center gap-2 rounded-md border border-dashed p-2 {dragOver
              ? 'border-accent bg-accent/10'
              : 'border-border'}"
          >
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent mynx-on-accent"
              aria-hidden="true"
            >
              <IconFileSpreadsheet size={17} stroke={1.75} />
            </span>
            <span class="min-w-0 flex-1">
              <span class="mynx-truncate block text-[12px] font-medium">
                {cfg.filePath ? baseName(cfg.filePath) : t("charts.noFile")}
              </span>
              <span class="mynx-truncate block text-[11px] text-text-secondary">
                {cfg.filePath || t("charts.dropHint")}
              </span>
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="mynx-btn" onclick={() => void pickData()} disabled={running}>
              <IconUpload size={14} stroke={1.75} aria-hidden="true" />
              {t("charts.importData")}
            </button>
            <button
              type="button"
              class="mynx-btn"
              onclick={() => {
                runValidation = null;
                void useSampleData();
              }}
              disabled={running}
            >
              <IconSparkles size={14} stroke={1.75} aria-hidden="true" />
              {t("charts.useSample")}
            </button>
            <button type="button" class="mynx-btn" onclick={() => void downloadSample()} disabled={running}>
              <IconDownload size={14} stroke={1.75} aria-hidden="true" />
              {t("charts.downloadSample")}
            </button>
            {#if imported}
              <button
                type="button"
                class="mynx-btn mynx-btn-danger"
                onclick={() => {
                  runValidation = null;
                  clearData();
                }}
                disabled={running}
              >
                {t("charts.clearData")}
              </button>
              <span class="mynx-chip">{t("charts.totalRows", { count: imported.totalRows })}</span>
            {/if}
          </div>

          {#if imported}
            <div class="flex flex-col gap-1">
              <span class="text-[12px] font-medium">{t("charts.preview")}</span>
              <div class="max-h-44 overflow-auto rounded-md border border-border">
                <table class="w-full border-collapse text-[11px]">
                  <thead>
                    <tr class="sticky top-0 bg-surface-2 text-left text-text-secondary">
                      {#each imported.columns as column (column)}
                        <th class="max-w-[160px] truncate px-2 py-1.5 font-medium" title={column}>
                          {column}
                        </th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each previewRows as row, rowIndex (rowIndex)}
                      <tr class="border-t border-border">
                        {#each row as cell, cellIndex (cellIndex)}
                          <td class="max-w-[160px] truncate px-2 py-1" title={String(cell ?? "")}>
                            {cell === null || cell === undefined ? "—" : String(cell)}
                          </td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {:else}
            <p class="rounded-md border border-dashed border-border p-3 text-center text-[12px] text-text-secondary">
              {t("charts.previewEmpty")}
            </p>
          {/if}

          <!-- Field mapping -->
          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] font-medium">{t("charts.mapping")}</span>
            <p class="text-[11px] text-text-secondary">{t("charts.mappingHint")}</p>
            {#if mappedRoles.length > 0}
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {#each mappedRoles as role (role.key)}
                  {@const field = fieldOfRole(role.key)}
                  {@const value = field ? cfg[field] : ""}
                  {@const roleError = runValidation?.roleKey === role.key ? runValidation : null}
                  <label class="flex min-w-0 flex-col gap-1">
                    {@render fieldLabel(
                      `${role.label}${field === "x" ? " (X)" : field === "y" ? " (Y)" : field === "group" ? " (Group)" : " (Size)"}`,
                      role.required,
                    )}
                    <select
                      id={roleInputId(role.key)}
                      class="mynx-input {roleError ? 'border-danger' : ''}"
                      value={value}
                      disabled={running}
                      aria-invalid={roleError ? "true" : undefined}
                      aria-describedby={roleError ? `${roleInputId(role.key)}-error` : undefined}
                      onchange={(event) => {
                        runValidation = null;
                        if (field) setRoleColumn(field, event.currentTarget.value);
                      }}
                    >
                      <option value="">{t("charts.roleColumn")}…</option>
                      {#each roleOptions(value) as column (column)}
                        <option value={column}>{column}</option>
                      {/each}
                    </select>
                    {#if roleError}
                      <span
                        id={`${roleInputId(role.key)}-error`}
                        class="text-[11px] text-danger"
                      >
                        {t(roleError.key, roleError.values)}
                      </span>
                    {/if}
                    {#if role.description}
                      <span class="mynx-truncate text-[11px] text-text-secondary" title={role.description}>
                        {role.description}
                      </span>
                    {/if}
                  </label>
                {/each}
              </div>
            {:else if chartState.manifest}
              <p class="text-[11px] text-text-secondary">{t("charts.autoColumns")}</p>
            {/if}
            {#if unmappedRoles.some((role) => role.key === "value")}
              <p class="text-[11px] text-text-secondary">
                {t("charts.fixedValueColumn")}
              </p>
            {/if}
          </div>

          <!-- Output folder -->
          <div class="flex items-center gap-2 rounded-md border border-border p-2">
            <IconFolder size={15} stroke={1.75} class="shrink-0 text-text-secondary" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block text-[12px] font-medium">{t("charts.outputFolder")}</span>
              <span class="mynx-truncate block text-[11px] text-text-secondary" title={cfg.outputDir}>
                {cfg.outputDir || "—"}
              </span>
            </span>
            <button
              type="button"
              class="mynx-btn shrink-0"
              onclick={() => void downloadTemplateZip()}
              disabled={running}
              title={t("charts.templateZip")}
            >
              <IconDownload size={14} stroke={1.75} aria-hidden="true" />
              {t("charts.templateZip")}
            </button>
            <button type="button" class="mynx-btn shrink-0" onclick={() => void pickOutputDir()} disabled={running}>
              {t("charts.chooseFolder")}
            </button>
          </div>
        </div>
      </div>

      <!-- Run card -->
      <div class="mynx-card flex flex-col">
        <div class="flex items-center gap-2 border-b border-border px-3 py-2">
          <span class="text-[12px] font-semibold">{t("charts.runTitle")}</span>
          <span class="mynx-chip mynx-truncate">{templateCopy.name}</span>
          <span class="ml-auto">
            {#if chartState.runPhase !== "idle" || chartState.installingR}
              <StateBadge status={runStatus} />
            {/if}
          </span>
        </div>
        <div class="flex flex-col gap-2 p-3">
          {#if (chartState.runPhase === "running" || chartState.installingR) && latestProgress !== null}
            <progress
              class="mynx-progress"
              value={Math.round(latestProgress)}
              max={100}
              aria-label={t("charts.progress")}
            ></progress>
          {/if}
          <p class="text-[12px] text-text-secondary">
            {chartState.runPhase === "idle" && !chartState.lastResult ? t("charts.runReady") : runStatusText}
          </p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="mynx-btn mynx-btn-primary min-w-0 flex-1"
              onclick={submitGeneration}
              disabled={running || chartState.importing}
            >
              <IconPlayerPlayFilled size={15} stroke={1.75} aria-hidden="true" />
              <span class="mynx-truncate">{t("charts.generate")} · {templateCopy.name}</span>
            </button>
            {#if chartState.runPhase === "running" || chartState.cancelling}
              <button
                type="button"
                class="mynx-btn mynx-btn-danger shrink-0"
                onclick={() => void requestCancel()}
                disabled={chartState.cancelling}
              >
                <IconPlayerStopFilled size={14} stroke={1.75} aria-hidden="true" />
                {t("charts.cancelRun")}
              </button>
            {/if}
          </div>
          <label class="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              class="accent-accent"
              checked={cfg.installMissing}
              disabled={running}
              onchange={(event) => onSwitch("installMissing", event.currentTarget.checked)}
            />
            {t("charts.installMissing")}
          </label>

          {#if chartState.lastResult?.outputPath}
            <div class="flex flex-col gap-2 rounded-md border border-border p-2">
              <div class="flex items-center gap-2">
                <IconCircleCheckFilled size={15} stroke={1.75} class="shrink-0 text-success" aria-hidden="true" />
                <span class="text-[12px] font-medium">
                  {chartState.runPhase === "success" ? t("charts.result") : t("charts.resultPrev")}
                </span>
              </div>
              {#if chartState.runPhase !== "success"}
                <p class="text-[11px] text-text-secondary">{t("charts.resultPrevNote")}</p>
              {/if}
              {#if resultUrl}
                <img
                  src={resultUrl}
                  alt="{templateCopy.name} {t('charts.result')}"
                  class="max-h-64 w-full rounded-md border border-border object-contain"
                  loading="lazy"
                  decoding="async"
                />
              {/if}
              <CopyableText text={chartState.lastResult.outputPath} />
              <p class="text-[11px] text-text-secondary">{t("charts.sidecarNote")}</p>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="mynx-btn" onclick={() => void openResult()}>
                  <IconFolder size={14} stroke={1.75} aria-hidden="true" />
                  {t("charts.openOutput")}
                </button>
                <button type="button" class="mynx-btn" onclick={() => void openOutputDir()}>
                  {t("charts.openOutputDir")}
                </button>
                <button type="button" class="mynx-btn" onclick={() => void pickZipExport()}>
                  <IconDownload size={14} stroke={1.75} aria-hidden="true" />
                  {t("charts.exportZip")}
                </button>
                {#if isSvgResult}
                  <button type="button" class="mynx-btn" onclick={() => void copySvgSource()}>
                    <IconCopy size={14} stroke={1.75} aria-hidden="true" />
                    {t("charts.copySvg")}
                  </button>
                {/if}
              </div>
              {#if chartState.lastResult.files.length > 0}
                <div class="flex flex-col gap-1">
                  <span class="text-[11px] font-medium">{t("charts.outputFiles")}</span>
                  <ul class="flex flex-col gap-0.5">
                    {#each chartState.lastResult.files.slice(0, 8) as file (file)}
                      <li class="mynx-truncate text-[11px] text-text-secondary" title={file}>
                        {baseName(file)}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <ColumnResizeHandle
      label={t("layout.resizeColumn")}
      value={panelWidths.chartsInspector}
      min={240}
      max={600}
      invert
      onresize={(width) => setPanelWidth("chartsInspector", width)}
      oncommit={savePanelWidths}
    />

    <!-- ── Right: inspector ───────────────────────────────────────────── -->
    <div class="mynx-card flex min-w-0 flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <span class="text-[12px] font-semibold">{templateCopy.name}</span>
        <span class="mynx-chip mynx-truncate">{localizedFamily(template.family, app.language)}</span>
      </div>
      <div class="min-w-0 p-3">
        {#if chartState.referenceUrl || chartState.referenceError}
          <div class="mb-3 flex flex-col gap-1">
            <span class="text-[12px] font-medium">{t("charts.reference")}</span>
            {#if chartState.referenceUrl}
              <img
                src={chartState.referenceUrl}
                alt="{templateCopy.name} {t('charts.reference')}"
                class="w-full rounded-md border border-border object-contain"
                loading="lazy"
                decoding="async"
                onerror={() => {
                  chartState.referenceUrl = "";
                  chartState.referenceError = true;
                }}
              />
            {:else}
              <a
                class="mynx-link inline-flex items-center gap-1 text-[11px]"
                href={template.galleryUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("charts.referenceFallback")}
                <IconExternalLink size={12} stroke={1.75} aria-hidden="true" />
              </a>
            {/if}
          </div>
        {/if}

        {#each INSPECTOR_SECTIONS.filter((section) => sectionVisible(section.id)) as section (section.id)}
          <details
            open={section.id === "layout"}
            class="mb-2 rounded-md border border-border"
            ontoggle={(event) => onInspectorToggle(section.id, event)}
          >
            <summary
              class="cursor-pointer select-none px-2.5 py-1.5 text-[12px] font-semibold"
              onclick={() => mountInspectorSection(section.id)}
            >
              {t(section.titleKey)}
            </summary>
            {#if mountedInspectorSections.includes(section.id)}
              <div class="flex flex-col gap-2 border-t border-border p-2.5">
                {#each section.fields as field (field.key)}
                  {@const label = t(field.labelKey)}
                  {#if field.kind === "text"}
                    <label class="flex flex-col gap-1">
                      <span class="text-[12px] font-medium">{label}</span>
                      <input
                        type="text"
                        class="mynx-input"
                        value={String(cfg[field.key] ?? "")}
                        maxlength={field.maxLength}
                        disabled={running}
                        oninput={(event) => onTextInput(field.key, event.currentTarget.value)}
                      />
                    </label>
                  {:else if field.kind === "number"}
                    <label class="flex flex-col gap-1">
                      <span class="text-[12px] font-medium">{label}</span>
                      <input
                        type="number"
                        class="mynx-input"
                        value={numberValue(field.key)}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        disabled={running}
                        onchange={(event) =>
                          onNumberInput(field.key, event.currentTarget.value, field.min ?? 0, field.max ?? 100)}
                      />
                    </label>
                  {:else if field.kind === "select"}
                    <label class="flex flex-col gap-1">
                      <span class="text-[12px] font-medium">{label}</span>
                      <select
                        class="mynx-input"
                        value={String(cfg[field.key] ?? "")}
                        disabled={running || (field.key === "legendPosition" && !cfg.showLegend)}
                        onchange={(event) => {
                          const value = event.currentTarget.value;
                          if (field.key === "publicationPreset") {
                            onPresetSelect(value);
                          } else if (field.key === "legendPosition") {
                            updateConfig({ legendPosition: value as ChartConfigDraft["legendPosition"] });
                          } else {
                            onTextInput(field.key, value);
                          }
                        }}
                      >
                        {#each field.options ?? [] as option (option.value)}
                          <option value={option.value}>{optionLabel(option)}</option>
                        {/each}
                      </select>
                    </label>
                  {:else if field.kind === "switch"}
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-[12px] font-medium">{label}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={cfg[field.key] === true}
                        aria-label={label}
                        disabled={running}
                        class="relative h-5 w-9 shrink-0 rounded-full border transition-colors {cfg[field.key] === true
                          ? 'border-accent bg-accent'
                          : 'border-border bg-surface-2'} {running ? 'opacity-50' : ''}"
                        onclick={() => onSwitch(field.key, !cfg[field.key])}
                      >
                        <span
                          class="absolute left-0.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-transform {cfg[field.key] === true
                            ? 'translate-x-4'
                            : ''}"
                        ></span>
                      </button>
                    </div>
                  {:else if field.kind === "color"}
                    <label class="flex flex-col gap-1">
                      <span class="text-[12px] font-medium">{label}</span>
                      <input
                        type="color"
                        class="mynx-input h-9 p-1"
                        value={String(cfg[field.key] ?? "#0A84FF")}
                        disabled={running}
                        oninput={(event) => onTextInput(field.key, event.currentTarget.value)}
                      />
                    </label>
                  {/if}
                {/each}
              </div>
            {/if}
          </details>
        {/each}

        <a
          class="mynx-link mt-1 inline-flex items-center gap-1 text-[11px]"
          href={template.galleryUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t("charts.sourceNote")}
          <IconExternalLink size={12} stroke={1.75} aria-hidden="true" />
        </a>
      </div>
    </div>
  </div>

  <!-- ── Bottom: run event log ────────────────────────────────────────── -->
  <div class="mynx-card flex min-h-[120px] shrink-0 flex-col">
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <IconInfoCircle size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-[12px] font-semibold">{t("charts.logTitle")}</span>
      <span class="mynx-chip">{runStatusText}</span>
      <button
        type="button"
        class="mynx-link ml-auto inline-flex items-center gap-1"
        onclick={() => void copyLog()}
        aria-label={t("charts.copyLog")}
        title={t("charts.copyLog")}
      >
        <IconCopy size={14} stroke={1.6} aria-hidden="true" />
        {t("charts.copyLog")}
      </button>
    </div>
    <div class="max-h-64 overflow-y-auto p-3" role="log" aria-live="polite">
      {#if chartState.events.length === 0}
        <p class="text-[12px] text-text-secondary">{t("charts.logInitial")}</p>
      {:else}
        <ul class="flex flex-col gap-1.5">
          {#each [...chartState.events].reverse() as entry, index (entry.tsMs + "-" + index)}
            <li class="flex items-start gap-2">
              <span class="mynx-badge shrink-0 {TONE_BADGE[entry.tone]}">
                {t(STAGE_KEYS[entry.stage] ?? "charts.stageLog")}
              </span>
              <span class="mynx-truncate text-[12px]" title={entry.message}>
                {entry.message}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      <details class="mt-2">
        <summary class="cursor-pointer text-[11px] text-text-secondary">{t("charts.logTitle")}</summary>
        <pre class="mynx-mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[11px]">{chartState.logText}</pre>
      </details>
    </div>
  </div>

  <!-- ── Saved presets ───────────────────────────────────────────────── -->
  {#if chartState.presets.length > 0}
    <div class="mynx-card shrink-0">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <span class="text-[12px] font-semibold">{t("charts.presetsTitle")}</span>
        <span class="mynx-chip">{chartState.presets.length}</span>
      </div>
      <ul class="flex flex-wrap gap-2 p-3">
        {#each chartState.presets as preset (preset.id)}
          <li class="flex items-center gap-1 rounded-md border border-border p-1">
            <button
              type="button"
              class="mynx-btn border-0 bg-transparent px-2"
              onclick={() => {
                runValidation = null;
                void loadPreset(preset);
              }}
              disabled={running}
            >
              <IconUpload size={13} stroke={1.75} aria-hidden="true" />
              <span class="mynx-truncate max-w-[180px]">{preset.name}</span>
              <span class="text-[11px] text-text-secondary">{t("charts.loadPreset")}</span>
            </button>
            <button
              type="button"
              class="mynx-btn shrink-0 px-2"
              onclick={() => {
                deleteTarget = { id: preset.id, name: preset.name };
              }}
              aria-label="{t('charts.deletePreset')} {preset.name}"
              title={t("charts.deletePreset")}
              disabled={running}
            >
              <IconTrash size={14} stroke={1.75} aria-hidden="true" />
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <p class="shrink-0 text-[11px] text-text-secondary">
    {t("charts.onDemandHint")}
  </p>
</section>

<!-- ── Modals ─────────────────────────────────────────────────────────── -->
<Modal bind:open={presetDialogOpen} title={t("charts.savePreset")}>
  <div class="flex flex-col gap-3">
    <label class="flex flex-col gap-1">
      <span class="text-[12px] font-medium">{t("charts.presetNameLabel")}</span>
      <input
        type="text"
        class="mynx-input"
        value={presetName}
        placeholder={t("charts.presetNamePlaceholder")}
        oninput={(event) => {
          presetName = event.currentTarget.value;
        }}
      />
    </label>
    <div class="flex items-center justify-end gap-2">
      <button type="button" class="mynx-btn" onclick={() => (presetDialogOpen = false)}>
        {t("common.cancel")}
      </button>
      <button type="button" class="mynx-btn mynx-btn-primary" onclick={() => void confirmSavePreset()}>
        {t("charts.presetSaveConfirm")}
      </button>
    </div>
  </div>
</Modal>

<Modal open={deleteTarget !== null} title={t("charts.deletePreset")}>
  <div class="flex flex-col gap-3">
    <p class="text-[12px]">
      {t("charts.deletePresetConfirm", { name: deleteTarget?.name ?? "" })}
    </p>
    <div class="flex items-center justify-end gap-2">
      <button
        type="button"
        class="mynx-btn"
        onclick={() => {
          deleteTarget = null;
        }}
      >
        {t("common.cancel")}
      </button>
      <button
        type="button"
        class="mynx-btn mynx-btn-danger"
        onclick={() => {
          const target = deleteTarget;
          deleteTarget = null;
          const preset = chartState.presets.find((item) => item.id === target?.id);
          if (preset) void deletePreset(preset);
        }}
      >
        {t("common.confirm")}
      </button>
    </div>
  </div>
</Modal>

<Modal bind:open={rDialogOpen} title={t("charts.installRTitle")}>
  <div class="flex flex-col gap-3">
    <p class="text-[12px]">{t("charts.installRBody")}</p>
    <div class="flex items-center justify-end gap-2">
      <button
        type="button"
        class="mynx-btn"
        onclick={() => {
          rDialogOpen = false;
          dismissInstallRPrompt();
        }}
      >
        {t("common.cancel")}
      </button>
      <button type="button" class="mynx-btn mynx-btn-primary" onclick={() => void confirmInstall()}>
        {t("charts.installRConfirm")}
      </button>
    </div>
  </div>
</Modal>
