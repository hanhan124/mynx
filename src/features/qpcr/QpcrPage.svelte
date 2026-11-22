<script lang="ts">
  import Switch from "../../components/Switch.svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
  import IconCalculator from "@tabler/icons-svelte/icons/calculator";
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";
  import IconChevronUp from "@tabler/icons-svelte/icons/chevron-up";
  import IconDna from "@tabler/icons-svelte/icons/dna";
  import IconFileSpreadsheet from "@tabler/icons-svelte/icons/file-spreadsheet";
  import IconFlask from "@tabler/icons-svelte/icons/flask";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconGrid4x4 from "@tabler/icons-svelte/icons/grid-4x4";
  import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
  import IconPlayerPlay from "@tabler/icons-svelte/icons/player-play";
  import IconPlayerStop from "@tabler/icons-svelte/icons/player-stop";
  import IconRefresh from "@tabler/icons-svelte/icons/refresh";
  import IconTerminal from "@tabler/icons-svelte/icons/terminal-2";
  import IconTrash from "@tabler/icons-svelte/icons/trash";
  import { t } from "../../app/i18n.svelte";
  import { panelWidths, savePanelWidths, setPanelWidth } from "../../app/panel-widths.svelte";
  import ColumnResizeHandle from "../../components/ColumnResizeHandle.svelte";
  import { app, pushToast } from "../../app/state.svelte";
  import { openPath } from "../../app/tauri.js";
  import CopyableText from "../../components/CopyableText.svelte";
  import QpcrWorksheetPreview from "./QpcrWorksheetPreview.svelte";
  import type { SheetSnapshot } from "../../lib/contracts/generated/qpcr/SheetSnapshot.js";
  import { safeNumber } from "./plot-config.js";
  import { listDir, qpcrAudit, workerExtractSheet, writeFileBytes } from "./client.js";
  import type { QpcrAuditResult } from "../../lib/contracts/generated/qpcr/QpcrAuditResult.js";
  import { qpcrAnalysisTemplate } from "./analysis-template.js";
  import { groupRange, toggleGroup } from "./group-selection.js";
  import {
    activePlotDraft,
    calcValidationFailure,
    cancelPlot,
    clearWorkbook,
    ensurePlotSheet,
    effectiveGroupNames,
    hasPendingGroupRenames,
    hasTransformedData,
    loadChartColor,
    loadWorkbook,
    methodLabelKey,
    plotGeneOptions,
    plotGroupOptions,
    qpcr,
    resetPlotDrafts,
    runCalculate,
    runPlot,
    runTransform,
    selectSheet,
    selectedControlGroup,
    selectedRefGene,
    setGroupRename,
    applyGroupRenameToSelected,
    applyGroupRenamesToWorkbook,
    joinPath,
    updatePlotDraft,
    type PhaseState,
  } from "./state.svelte";

  /* Display-only option catalogs (legacy parity). */
  const CALC_METHODS = ["ref-normalized", "control-relative"] as const;
  const PLOT_KINDS = ["bar", "heatmap"] as const;
  const FORMATS = ["png", "svg", "pdf"];
  const DPIS = [300, 600, 150];
  const BAR_ANGLES = [0, 30, 45, 90];
  const SIG_MODES = ["vs_first", "vs_last", "vs_control", "custom", "all_pairwise", "adjacent"];
  const STAT_TESTS = ["auto", "t.test", "wilcox.test", "anova", "kruskal.test"];
  const P_ADJUST = ["holm", "bonferroni", "BH", "none"];
  const ZLIMS = [1, 2, 3, 4];
  const PREVIEW_ROW_LIMIT = 6;
  const PLOT_PREVIEW_LIMIT = 4;
  const LABEL_STYLES = [
    { value: "p.signif", key: "qpcr.labelStyleSignif" },
    { value: "p", key: "qpcr.labelStyleP" },
    { value: "both", key: "qpcr.labelStyleBoth" },
  ] as const;
  const HEAT_SCALES = [
    { value: "row", key: "qpcr.scaleRow" },
    { value: "column", key: "qpcr.scaleColumn" },
    { value: "none", key: "qpcr.scaleNone" },
  ] as const;
  const PALETTES = [
    { value: "blue-white-red", key: "qpcr.paletteBlueWhiteRed" },
    { value: "viridis", key: "qpcr.paletteViridis" },
    { value: "plasma", key: "qpcr.palettePlasma" },
    { value: "inferno", key: "qpcr.paletteInferno" },
    { value: "cividis", key: "qpcr.paletteCividis" },
    { value: "rdbu", key: "qpcr.paletteRdBu" },
    { value: "spectral", key: "qpcr.paletteSpectral" },
    { value: "green-white-purple", key: "qpcr.paletteGreenWhitePurple" },
  ] as const;
  const LEGEND_POS = [
    { value: "right", key: "qpcr.legendRight" },
    { value: "bottom", key: "qpcr.legendBottom" },
    { value: "none", key: "qpcr.legendHidden" },
  ] as const;

  const PHASE_BADGE: Record<PhaseState, string> = {
    idle: "mynx-badge-queued",
    running: "mynx-badge-running",
    success: "mynx-badge-success",
    error: "mynx-badge-error",
    cancelled: "mynx-badge-cancelled",
  };

  function phaseLabel(phase: PhaseState): string {
    switch (phase) {
      case "success":
        return t("status.succeeded");
      case "error":
        return t("status.failed");
      default:
        return t(`status.${phase}`);
    }
  }

  let step = $state(1);
  let dragOver = $state(false);
  let previewGeneName = $state("");
  let showAllResultGroups = $state(false);
  let showAllPlotPreviews = $state(false);
  let selectedRenameGroups = $state<string[]>([]);
  let batchGroupName = $state("");
  let groupSelectionAnchor = -1;
  let groupSelectionActive = false;
  let groupSelectionBase: string[] = [];
  let groupSelectionAdditive = false;
  let groupSelectionMoved = false;
  let groupSelectionStart: string[] = [];
  let groupSelectButtons: HTMLButtonElement[] = [];
  let previousGroupSignature = "";
  let sourceSheetPreview = $state<SheetSnapshot | null>(null);
  let sourcePreviewStatus = $state<"idle" | "loading" | "ready" | "error">("idle");
  let sourceAudit = $state<QpcrAuditResult | null>(null);
  let sourceAuditFailed = $state(false);
  let transformedAudit = $state<QpcrAuditResult | null>(null);
  let transformedSheetPreview = $state<SheetSnapshot | null>(null);
  let transformedPreviewStatus = $state<"idle" | "loading" | "ready" | "error">("idle");
  let plotPreviewFiles = $state<string[]>([]);
  let plotPreviewStatus = $state<"idle" | "loading" | "ready" | "error">("idle");

  const hasFile = $derived(qpcr.workbookBytes !== null);
  const transformed = $derived(hasTransformedData());
  const calcFailure = $derived(calcValidationFailure());
  const plotDraft = $derived(activePlotDraft());
  const plotGenes = $derived(plotGeneOptions());
  const plotGroups = $derived(plotGroupOptions());
  const effectiveGroups = $derived(effectiveGroupNames());
  const groupRenameBusy = $derived(
    qpcr.groupRenamePhase === "running" ||
      qpcr.transformPhase === "running" ||
      qpcr.calcPhase === "running",
  );
  const plotRunning = $derived(qpcr.plotPhase === "running");
  const resultPreviewSeries = $derived(
    qpcr.chartSeries.find((series) => series.geneName === previewGeneName) ??
      qpcr.chartSeries[0] ??
      null,
  );
  const resultPreviewScale = $derived(
    Math.max(1, ...(resultPreviewSeries?.points.map((point) => point.avg + point.stdev) ?? [])),
  );
  const visibleResultPreviewPoints = $derived(
    resultPreviewSeries
      ? showAllResultGroups
        ? resultPreviewSeries.points
        : resultPreviewSeries.points.slice(0, PREVIEW_ROW_LIMIT)
      : [],
  );
  const visiblePlotPreviewFiles = $derived(
    showAllPlotPreviews ? plotPreviewFiles : plotPreviewFiles.slice(0, PLOT_PREVIEW_LIMIT),
  );
  const canPlot = $derived(
    hasFile && !!qpcr.plotOutputDir && !!qpcr.plotSheetName && !plotRunning,
  );
  const canTransform = $derived(
    hasFile && !!qpcr.selectedSheet && qpcr.transformPhase !== "running" && qpcr.groupRenamePhase !== "running",
  );
  const canCalculate = $derived(
    hasFile && transformed && calcFailure === null && !hasPendingGroupRenames() && !groupRenameBusy,
  );

  function extendGroupSelection(index: number): void {
    if (groupSelectionAnchor < 0) return;
    groupSelectionMoved ||= index !== groupSelectionAnchor;
    selectedRenameGroups = groupRange(
      qpcr.groups,
      groupSelectionAnchor,
      index,
      groupSelectionBase,
    );
  }

  function beginGroupSelection(index: number, event: PointerEvent): void {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const additive = event.ctrlKey || event.metaKey;
    const range = event.shiftKey && groupSelectionAnchor >= 0;
    groupSelectionStart = selectedRenameGroups;
    groupSelectionMoved = false;
    groupSelectionAdditive = additive && !range;
    if (!range) groupSelectionAnchor = index;
    groupSelectionBase = additive && !range ? selectedRenameGroups : [];
    groupSelectionActive = true;
    extendGroupSelection(index);
    if (event.currentTarget instanceof HTMLButtonElement) event.currentTarget.focus();
    event.preventDefault();
  }

  function finishGroupSelection(): void {
    if (!groupSelectionActive) return;
    if (groupSelectionAdditive && !groupSelectionMoved) {
      selectedRenameGroups = toggleGroup(qpcr.groups, groupSelectionStart, qpcr.groups[groupSelectionAnchor]);
    }
    groupSelectionActive = false;
    groupSelectionAdditive = false;
    groupSelectionBase = [];
  }

  function continueGroupSelection(index: number, event: PointerEvent): void {
    if (!groupSelectionActive) return;
    if ((event.buttons & 1) === 0) {
      finishGroupSelection();
      return;
    }
    extendGroupSelection(index);
  }

  function cancelGroupSelection(): void {
    if (!groupSelectionActive) return;
    selectedRenameGroups = groupSelectionStart;
    groupSelectionActive = false;
    groupSelectionAdditive = false;
    groupSelectionBase = [];
  }

  function clearGroupSelection(): void {
    selectedRenameGroups = [];
    groupSelectionAnchor = -1;
    groupSelectionActive = false;
    groupSelectionAdditive = false;
    groupSelectionBase = [];
    groupSelectionMoved = false;
  }

  function applyBatchGroupName(): void {
    if (groupRenameBusy || selectedRenameGroups.length === 0 || !batchGroupName.trim()) return;
    applyGroupRenameToSelected(selectedRenameGroups, batchGroupName);
    clearGroupSelection();
    batchGroupName = "";
  }

  function handleGroupSelectionKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = Math.max(0, Math.min(qpcr.groups.length - 1, index + direction));
      if (event.shiftKey) {
        if (groupSelectionAnchor < 0) groupSelectionAnchor = index;
        groupSelectionBase = [];
        selectedRenameGroups = groupRange(qpcr.groups, groupSelectionAnchor, next);
      } else {
        groupSelectionAnchor = next;
        selectedRenameGroups = [qpcr.groups[next]];
      }
      groupSelectButtons[next]?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      selectedRenameGroups = [];
      groupSelectionAnchor = -1;
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectedRenameGroups = [...qpcr.groups];
      groupSelectionAnchor = 0;
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    groupSelectionAnchor = index;
    selectedRenameGroups = event.ctrlKey || event.metaKey
      ? toggleGroup(qpcr.groups, selectedRenameGroups, qpcr.groups[index])
      : [qpcr.groups[index]];
  }

  /* Restore chart color from the settings doc once. */
  $effect(() => {
    loadChartColor();
  });

  $effect(() => {
    const signature = qpcr.groups.join("\u0000");
    if (signature !== previousGroupSignature) {
      previousGroupSignature = signature;
      selectedRenameGroups = [];
      groupSelectionAnchor = -1;
      groupSelectionActive = false;
      groupSelectionBase = [];
      groupSelectionAdditive = false;
      groupSelectionMoved = false;
      groupSelectionStart = [];
    }
  });

  /* Read compact source/transformed worksheet snapshots in the Excel worker. */
  $effect(() => {
    const bytes = qpcr.workbookBytes;
    const sheetName = qpcr.selectedSheet;
    if (!bytes || !sheetName) {
      sourceSheetPreview = null;
      sourceAudit = null;
      sourceAuditFailed = false;
      sourcePreviewStatus = "idle";
      return;
    }
    let current = true;
    sourcePreviewStatus = "loading";
    void workerExtractSheet(bytes, sheetName)
      .then(async ({ snapshot }) => {
        if (!current) return;
        sourceSheetPreview = snapshot;
        sourceAuditFailed = false;
        sourceAudit = await qpcrAudit(snapshot).catch(() => {
          sourceAuditFailed = true;
          return null;
        });
        sourcePreviewStatus = "ready";
      })
      .catch(() => {
        if (!current) return;
        sourceSheetPreview = null;
        sourceAudit = null;
        sourceAuditFailed = false;
        sourcePreviewStatus = "error";
      });
    return () => {
      current = false;
    };
  });

  /* Match files logged by this run against its output folder to avoid stale previews. */
  $effect(() => {
    const result = qpcr.plotPhase === "success" ? qpcr.plotResult : null;
    const outputDir = result?.outputDir;
    if (!outputDir) {
      plotPreviewFiles = [];
      plotPreviewStatus = "idle";
      showAllPlotPreviews = false;
      return;
    }
    const loggedNames = new Set(
      qpcr.plotLogs.flatMap((line) => {
        const match = line.message.match(/\[save\]\s+([^\r\n]+)$/i);
        const fileName = match?.[1]?.trim();
        return fileName && isPreviewablePlotFile(fileName) ? [fileName] : [];
      }),
    );
    if (loggedNames.size === 0) {
      plotPreviewFiles = [];
      plotPreviewStatus = "ready";
      return;
    }
    let current = true;
    plotPreviewStatus = "loading";
    void listDir(outputDir)
      .then((entries) => {
        if (!current) return;
        plotPreviewFiles = entries
          .filter((entry) => !entry.isDir && loggedNames.has(entry.name))
          .map((entry) => joinPath(outputDir, entry.name));
        plotPreviewStatus = "ready";
      })
      .catch(() => {
        if (!current) return;
        plotPreviewFiles = [];
        plotPreviewStatus = "error";
      });
    return () => {
      current = false;
    };
  });

  $effect(() => {
    const bytes = qpcr.workbookBytes;
    const hasTransformedSheet = transformed;
    if (!bytes || !hasTransformedSheet) {
      transformedSheetPreview = null;
      transformedPreviewStatus = "idle";
      return;
    }
    let current = true;
    transformedPreviewStatus = "loading";
    void workerExtractSheet(bytes, "Transformed Data")
      .then(async ({ snapshot }) => {
        if (!current) return;
        transformedSheetPreview = snapshot;
        transformedAudit = await qpcrAudit(snapshot, true).catch(() => null);
        transformedPreviewStatus = "ready";
      })
      .catch(() => {
        if (!current) return;
        transformedSheetPreview = null;
        transformedPreviewStatus = "error";
      });
    return () => {
      current = false;
    };
  });

  /* Window-level drag-drop scoped to this page. */
  $effect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          dragOver = true;
        } else if (payload.type === "drop") {
          dragOver = false;
          const path = payload.paths.find((item) => /\.(xlsx|xls)$/i.test(item));
          if (path) void loadWorkbook(path);
        } else {
          dragOver = false;
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

  async function pickFile(): Promise<void> {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
    });
    if (typeof selected === "string") await loadWorkbook(selected);
  }

  async function chooseOutputDir(): Promise<void> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: qpcr.plotOutputDir || undefined,
    });
    if (typeof selected === "string") qpcr.plotOutputDir = selected;
  }

  function openResultDir(): void {
    const dir = qpcr.plotResult?.outputDir ?? qpcr.plotOutputDir;
    if (dir) void openPath(dir).catch(() => undefined);
  }

  function num(raw: string, fallback: number): number {
    return safeNumber(raw, fallback);
  }

  function fileLabelOf(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  function formatPreviewNumber(value: number): string {
    return Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : "—";
  }

  function isPreviewablePlotFile(path: string): boolean {
    return /\.(png|svg|jpe?g|webp)$/i.test(path);
  }

  function plotPreviewSrc(path: string): string {
    return convertFileSrc(path);
  }

  async function exportAnalysisRecord(): Promise<void> {
    let record = qpcrAnalysisTemplate(app.language);
    const audit = transformedAudit;
    const zh = app.language === "zh";
    const methodLabel = zh ? "分析方法（2^-ΔCt / 2^-ΔΔCt）" : "Analysis method (2^-ΔCt / 2^-ΔΔCt)";
    const values: Array<[string, string]> = [
      [zh ? "原始数据文件/工作表" : "Raw data file / worksheet", `${qpcr.filePath} / ${qpcr.selectedSheet}`],
      [zh ? "参考基因" : "Reference gene", selectedRefGene()],
      [methodLabel, qpcr.calcMethod === "control-relative" ? "2^-ΔΔCt" : "2^-ΔCt"],
      [zh ? "对照组" : "Control group", selectedControlGroup()],
      [
        zh ? "重复数/最佳重复设置" : "Replicate / best-replicate setting",
        `${qpcr.repeatCount} / ${qpcr.selectNum || (zh ? "关闭" : "off")}`,
      ],
      [zh ? "离群值设置" : "Outlier setting", qpcr.outlierSd ? String(qpcr.outlierSd) : (zh ? "关闭" : "off")],
      [zh ? "转换表中的黄色填补单元格数" : "Yellow imputed cells in transformed data", String(audit?.imputedCells ?? "")],
      [zh ? "运行日期与输出文件" : "Run date and output files", `${new Date().toISOString()} · ${qpcr.calcMessage}`],
    ];
    for (const [label, value] of values) {
      const delimiter = zh ? "：" : ":";
      record = record.replace(`- ${label}${delimiter}`, `- ${label}${delimiter} ${value}`);
    }
    const path = await saveDialog({
      defaultPath: `${qpcr.fileName.replace(/\.[^.]+$/, "")}-qpcr-analysis.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    const encoded = new TextEncoder().encode(record);
    await writeFileBytes(path, encoded.buffer);
    pushToast("success", t("qpcr.recordExported"));
  }
</script>

<svelte:window
  onpointerup={finishGroupSelection}
  onpointercancel={cancelGroupSelection}
  onblur={cancelGroupSelection}
/>

{#snippet phaseBadge(phase: PhaseState)}
  <span class="mynx-badge {PHASE_BADGE[phase]}">{phaseLabel(phase)}</span>
{/snippet}

{#snippet groupRenameEditor()}
  <section class="mynx-card flex flex-col gap-3 p-3" aria-labelledby="qpcr-group-rename-title">
    <div>
      <h3 id="qpcr-group-rename-title" class="text-callout font-semibold">{t("qpcr.renameGroupsTitle")}</h3>
      <p class="mt-1 text-footnote text-text-secondary">{t("qpcr.renameGroupsHint")}</p>
    </div>
    {#if qpcr.groups.length > 0}
      <div class="flex flex-col gap-2 sm:flex-row">
        <input
          class="mynx-input min-w-0 flex-1"
          bind:value={batchGroupName}
          disabled={groupRenameBusy}
          placeholder={t("qpcr.batchGroupPlaceholder")}
          aria-label={t("qpcr.batchGroupPlaceholder")}
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyBatchGroupName();
            }
          }}
        />
        <button
          type="button"
          class="mynx-btn"
          disabled={groupRenameBusy || selectedRenameGroups.length === 0 || !batchGroupName.trim()}
          onclick={applyBatchGroupName}
        >{t("qpcr.applyBatchRename", { count: selectedRenameGroups.length })}</button>
        <button
          type="button"
          class="mynx-btn"
          disabled={groupRenameBusy || selectedRenameGroups.length === 0}
          onclick={clearGroupSelection}
        >{t("qpcr.clearGroupSelection")}</button>
      </div>
      <div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          class="mynx-btn mynx-btn-primary"
          disabled={!hasPendingGroupRenames() || groupRenameBusy}
          onclick={() => void applyGroupRenamesToWorkbook()}
        >{qpcr.groupRenamePhase === "running" ? t("qpcr.applyingGroupNames") : t("qpcr.applyGroupNamesToExcel")}</button>
        {#if qpcr.groupRenamePhase !== "idle"}
          {@render phaseBadge(qpcr.groupRenamePhase)}
        {/if}
        {#if qpcr.groupRenameMessage}
          <p class="text-footnote {qpcr.groupRenamePhase === 'error' ? 'text-danger' : qpcr.groupRenamePhase === 'success' ? 'text-success' : 'text-text-secondary'}" role={qpcr.groupRenamePhase === "error" ? "alert" : "status"}>
            {qpcr.groupRenameMessage}
          </p>
        {/if}
      </div>
      <div class="max-w-full overflow-x-auto rounded-md border border-border">
        <table class="w-full min-w-[520px] border-collapse text-left text-callout">
          <thead>
            <tr class="bg-surface-2 text-caption2 text-text-secondary">
              <th class="w-12 border-b border-r border-border px-2 py-1 text-center">#</th>
              <th class="border-b border-r border-border px-2 py-1">A</th>
              <th class="border-b border-border px-2 py-1">B</th>
            </tr>
            <tr class="bg-surface-2 font-medium">
              <th class="border-b border-r border-border px-2 py-2 text-center">1</th>
              <th class="border-b border-r border-border px-3 py-2">{t("qpcr.originalGroupName")}</th>
              <th class="border-b border-border px-3 py-2">{t("qpcr.appliedGroupName")}</th>
            </tr>
          </thead>
          <tbody>
            {#each qpcr.groups as group, index (group)}
              <tr class={selectedRenameGroups.includes(group) ? "bg-accent/10" : index % 2 ? "bg-surface-2/50" : "bg-surface"}>
                <th scope="row" class="border-b border-r border-border px-2 py-1.5 text-center font-mono text-footnote font-normal text-text-secondary">{index + 2}</th>
                <td class="border-b border-r border-border p-0">
                  <button
                    type="button"
                    disabled={groupRenameBusy}
                    class="w-full select-none px-3 py-2 text-left font-mono focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-accent {selectedRenameGroups.includes(group) ? 'bg-accent/10' : 'hover:bg-accent/5'}"
                    aria-pressed={selectedRenameGroups.includes(group)}
                    aria-label={t("qpcr.selectGroupForBatch", { group })}
                    bind:this={groupSelectButtons[index]}
                    onpointerdown={(event) => beginGroupSelection(index, event)}
                    onpointerenter={(event) => continueGroupSelection(index, event)}
                    onkeydown={(event) => handleGroupSelectionKeydown(index, event)}
                  >{group}</button>
                </td>
                <td class="border-b border-border p-1">
                  <input
                    class="mynx-input w-full border-transparent bg-transparent px-2 py-1 focus-visible:border-accent"
                    disabled={groupRenameBusy}
                    value={qpcr.groupRenames[group] ?? ""}
                    placeholder={group}
                    aria-label={t("qpcr.renameGroupInput", { group })}
                    oninput={(event) => setGroupRename(group, event.currentTarget.value)}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if effectiveGroups.length < qpcr.groups.length}
        <p class="text-footnote text-text-secondary">{t("qpcr.mergedGroupNames", { count: effectiveGroups.length })}</p>
      {/if}
    {:else}
      <p class="text-callout text-text-secondary">{t("qpcr.transformFirst")}</p>
    {/if}
  </section>
{/snippet}

{#snippet toggleSwitch(checked: boolean, set: (next: boolean) => void, label: string)}
  <Switch {checked} {label} onchange={set} />
{/snippet}

<section
  class="flex h-full min-h-0 flex-col gap-3 p-4 {dragOver ? 'ring-2 ring-accent ring-inset' : ''}"
>
  <header class="mynx-page-header flex items-baseline gap-3">
    <h1 class="mynx-page-title">{t("qpcr.title")}</h1>
  </header>

  <div class="mynx-resizable-two min-h-0 flex-1" style={`--mynx-first-column: ${panelWidths.qpcrSidebar}px`}>
    <!-- ── Steps rail ─────────────────────────────────────────────────────── -->
    <aside class="mynx-card mynx-step-rail flex flex-col gap-1 p-2">
      {#each [1, 2, 3, 4] as item (item)}
        <button
          type="button"
          class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left mynx-step-button {step ===
          item
            ? 'border-accent bg-accent/10'
            : 'border-transparent hover:bg-surface-2'}"
          onclick={() => (step = item)}
          aria-current={step === item ? "step" : undefined}
        >
          <span
            class="mynx-step-index flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-footnote {step ===
            item
              ? 'border-accent bg-accent mynx-on-accent'
              : 'border-border bg-surface-2 text-text-secondary'}"
          >
            {item}
          </span>
          <span class="mynx-truncate flex-1 text-callout font-medium">
            {item === 1
              ? t("qpcr.stepFile")
              : item === 2
                ? t("qpcr.stepTransform")
                : item === 3
                  ? t("qpcr.stepCalc")
                  : t("qpcr.stepPlot")}
          </span>
          {#if item === 1 && qpcr.loadPhase !== "idle"}
            {@render phaseBadge(qpcr.loadPhase)}
          {:else if item === 2 && qpcr.transformPhase !== "idle"}
            {@render phaseBadge(qpcr.transformPhase)}
          {:else if item === 3 &&
            (qpcr.calcPhase !== "idle" || qpcr.chartInjectPhase !== "idle")}
            {@render phaseBadge(
              qpcr.calcPhase === "success" && qpcr.chartInjectPhase !== "idle"
                ? qpcr.chartInjectPhase
                : qpcr.calcPhase,
            )}
          {:else if item === 4 && qpcr.plotPhase !== "idle"}
            {@render phaseBadge(qpcr.plotPhase)}
          {/if}
        </button>
      {/each}

      <div class="mt-2 flex flex-col gap-1 border-t border-border pt-2">
        <span class="text-footnote font-semibold text-text-secondary">
          {t("qpcr.fileInfo")}
        </span>
        {#if hasFile}
          <span class="mynx-truncate text-callout font-medium" title={qpcr.filePath}>
            {qpcr.fileName}
          </span>
          <CopyableText text={qpcr.filePath} />
          <span class="mynx-truncate text-footnote text-text-secondary">
            {t("qpcr.sheet")}: {qpcr.selectedSheet || "—"} · {qpcr.sheetNames.length}
          </span>
          <span class="mynx-truncate text-footnote text-text-secondary">
            {t("qpcr.geneList")}: {qpcr.geneNames.length} · {t("qpcr.groupList")}:
            {qpcr.groups.length}
          </span>
        {:else}
          <span class="text-footnote text-text-secondary">{t("qpcr.noFileSelected")}</span>
        {/if}
      </div>
    </aside>

    <ColumnResizeHandle
      label={t("layout.resizeColumn")}
      value={panelWidths.qpcrSidebar}
      min={180}
      max={480}
      onresize={(width) => setPanelWidth("qpcrSidebar", width)}
      oncommit={savePanelWidths}
    />

    <!-- ── Step content ───────────────────────────────────────────────────── -->
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {#if step === 1}
        <!-- Step 1: file -->
        <div class="mynx-card flex flex-col">
          <div class="flex items-center gap-2 border-b border-border px-3 py-2">
            <IconFileSpreadsheet size={15} stroke={1.75} aria-hidden="true" />
            <span class="text-callout font-semibold">{t("qpcr.dataFile")}</span>
            {#if qpcr.loadPhase !== "idle"}
              <span class="ml-auto">{@render phaseBadge(qpcr.loadPhase)}</span>
            {/if}
          </div>
          <div class="flex flex-col gap-3 p-3">
            {#if !hasFile}
              <button
                type="button"
                class="flex min-h-[120px] w-full items-center justify-center rounded-md border border-dashed border-border p-4 text-center text-callout text-text-secondary hover:border-accent/50"
                onclick={() => void pickFile()}
              >
                {t("qpcr.drop")} · {t("qpcr.open")}
              </button>
            {:else}
              <div class="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-2">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success/15 text-success"
                >
                  <IconFileSpreadsheet size={18} stroke={1.6} aria-hidden="true" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="mynx-truncate block text-callout font-medium" title={qpcr.filePath}>
                    {qpcr.fileName}
                  </span>
                  <CopyableText text={qpcr.filePath} />
                </span>
              </div>
            {/if}
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="mynx-btn" onclick={() => void pickFile()}>
                <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
                {t("qpcr.open")}
              </button>
              {#if hasFile}
                <button
                  type="button"
                  class="mynx-btn mynx-btn-danger ml-auto"
                  onclick={clearWorkbook}
                  disabled={qpcr.loadPhase === "running"}
                >
                  <IconTrash size={14} stroke={1.75} aria-hidden="true" />
                  {t("qpcr.clear")}
                </button>
              {/if}
            </div>
            {#if qpcr.sheetNames.length > 0}
              <label class="flex min-w-0 flex-col gap-1">
                <span class="text-callout font-medium">{t("qpcr.sheet")}</span>
                <select
                  class="mynx-input"
                  bind:value={qpcr.selectedSheet}
                  onchange={() => selectSheet(qpcr.selectedSheet)}
                  aria-label={t("qpcr.sheet")}
                >
                  {#each qpcr.sheetNames as name (name)}
                    <option value={name}>{name}</option>
                  {/each}
                </select>
              </label>
            {/if}
            {#if qpcr.loadPhase === "error" && qpcr.loadMessage}
              <p class="flex items-center gap-1.5 text-callout text-danger" role="alert">
                <IconInfoCircle size={14} stroke={1.75} aria-hidden="true" />
                <span class="mynx-truncate">{qpcr.loadMessage}</span>
              </p>
            {/if}
          </div>
        </div>
        {#if sourcePreviewStatus === "loading"}
          <p class="mynx-card text-callout text-text-secondary" role="status">
            {t("qpcr.previewLoading")}
          </p>
        {:else if sourcePreviewStatus === "error"}
          <p class="mynx-card text-callout text-text-secondary" role="status">
            {t("qpcr.previewFailed")}
          </p>
        {:else if sourceSheetPreview}
          <QpcrWorksheetPreview
            snapshot={sourceSheetPreview}
            caption={t("qpcr.previewData")}
            audit={sourceAudit}
            auditFailed={sourceAuditFailed}
          />
        {/if}
      {:else if step === 2}
        <!-- Step 2: transform -->
        <div class="mynx-card flex flex-col">
          <div class="flex items-center gap-2 border-b border-border px-3 py-2">
            <IconFlask size={15} stroke={1.75} aria-hidden="true" />
            <span class="text-callout font-semibold">{t("qpcr.transform")}</span>
            {#if qpcr.transformPhase !== "idle"}
              <span class="ml-auto">{@render phaseBadge(qpcr.transformPhase)}</span>
            {/if}
          </div>
          <div class="flex flex-col gap-3 p-3">
            <p class="text-callout text-text-secondary">{t("qpcr.transformHint")}</p>
            <p class="flex items-center gap-1.5 text-footnote text-text-secondary">
              <IconInfoCircle size={13} stroke={1.75} aria-hidden="true" />
              {t("qpcr.saveHint")}
            </p>
            {#if transformed && qpcr.transformPhase !== "running"}
              <p
                class="flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 p-2 text-callout text-success"
                role="status"
              >
                <IconDna size={14} stroke={1.75} aria-hidden="true" />
                {t("qpcr.transformed", { count: qpcr.geneNames.length })}
              </p>
            {/if}
            <button
              type="button"
              class="mynx-btn mynx-btn-primary"
              onclick={() => void runTransform()}
              disabled={!canTransform}
            >
              {qpcr.transformPhase === "running"
                ? t("qpcr.executing")
                : transformed
                  ? t("qpcr.retransform")
                  : t("qpcr.execute")}
            </button>
            {#if qpcr.transformPhase === "success" && qpcr.transformMessage}
              <p
                class="rounded-md border border-success/40 bg-success/10 p-2 text-callout text-success"
                role="status"
              >
                {qpcr.transformMessage}
              </p>
            {:else if qpcr.transformPhase === "error" && qpcr.transformMessage}
              <p
                class="rounded-md border border-danger/40 bg-danger/10 p-2 text-callout text-danger"
                role="alert"
              >
                {qpcr.transformMessage}
              </p>
            {/if}
            {#if qpcr.geneNames.length > 0}
              <div class="flex flex-col gap-1">
                <span class="text-callout font-medium">
                  {t("qpcr.geneList")} · {qpcr.geneNames.length}
                </span>
                <div class="flex flex-wrap gap-1">
                  {#each qpcr.geneNames as gene (gene)}
                    <span class="mynx-chip max-w-[160px]">
                      <span class="mynx-truncate">{gene}</span>
                    </span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if qpcr.groups.length > 0}
              <div class="flex flex-col gap-1">
                <span class="text-callout font-medium">
                  {t("qpcr.groupList")} · {qpcr.groups.length}
                </span>
                <div class="flex flex-wrap gap-1">
                  {#each qpcr.groups as group (group)}
                    <span class="mynx-chip max-w-[160px]">
                      <span class="mynx-truncate">{group}</span>
                    </span>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
        {#if transformedPreviewStatus === "loading"}
          <p class="mynx-card text-callout text-text-secondary" role="status">
            {t("qpcr.previewLoading")}
          </p>
        {:else if transformedPreviewStatus === "error"}
          <p class="mynx-card text-callout text-text-secondary" role="status">
            {t("qpcr.previewFailed")}
          </p>
        {:else if transformedSheetPreview}
          <QpcrWorksheetPreview
            snapshot={transformedSheetPreview}
            caption={t("qpcr.previewTransformed")}
            audit={transformedAudit}
            auditType="transformed"
          />
        {/if}
        {#if transformed && qpcr.groups.length > 0}
          {@render groupRenameEditor()}
        {/if}
      {:else if step === 3}
        <!-- Step 3: calculate -->
        {#if hasPendingGroupRenames()}
          <p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-callout text-text-secondary" role="status">
            {t("qpcr.applyRenameBeforeCalc")}
            <button type="button" class="mynx-link ml-2" onclick={() => (step = 2)}>{t("qpcr.stepTransform")}</button>
          </p>
        {/if}
        {#if !transformed}
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
            <p class="flex items-center gap-1.5 text-callout text-text-secondary">
              <IconInfoCircle size={14} stroke={1.75} aria-hidden="true" />
              {t("qpcr.existingTransformMissing")}
            </p>
            <button type="button" class="mynx-link text-callout" onclick={() => (step = 2)}>
              {t("qpcr.goTransformStep")}
            </button>
          </div>
        {/if}

        <div class="mynx-card flex flex-col">
          <div class="flex items-center gap-2 border-b border-border px-3 py-2">
            <IconCalculator size={15} stroke={1.75} aria-hidden="true" />
            <span class="text-callout font-semibold">{t("qpcr.calculate")}</span>
            {#if qpcr.calcPhase !== "idle" || qpcr.chartInjectPhase !== "idle"}
              <span class="ml-auto">
                {@render phaseBadge(
                  qpcr.calcPhase === "success" && qpcr.chartInjectPhase !== "idle"
                    ? qpcr.chartInjectPhase
                    : qpcr.calcPhase,
                )}
              </span>
            {/if}
          </div>
          <div class="qpcr-calc-container min-w-0">
            <div class="qpcr-calc-grid min-w-0 gap-3 p-3">
            <div class="flex min-w-0 flex-col gap-3">
            <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("qpcr.method")}>
              {#each CALC_METHODS as method (method)}
                <label
                  class="mynx-card flex cursor-pointer items-center justify-between gap-2 p-2 {qpcr.calcMethod ===
                  method
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface hover:border-text-secondary'}"
                >
                  <span class="mynx-truncate text-callout font-medium">
                    {t(methodLabelKey(method))}
                    {method === "ref-normalized" ? `（${t("qpcr.default")}）` : ""}
                  </span>
                  <input
                    type="radio"
                    name="qpcr-method"
                    class="sr-only"
                    checked={qpcr.calcMethod === method}
                    onchange={() => (qpcr.calcMethod = method)}
                  />
                </label>
              {/each}
            </div>

            {#if qpcr.calcMethod === "control-relative"}
              <label class="flex min-w-0 flex-col gap-1">
                <span class="text-callout font-medium">{t("qpcr.controlGroup")}</span>
                <select
                  class="mynx-input"
                  bind:value={() => selectedControlGroup(), (v) => (qpcr.controlGroup = v)}
                  disabled={effectiveGroups.length === 0}
                  aria-label={t("qpcr.controlGroup")}
                >
                  {#if effectiveGroups.length === 0}
                    <option value="">{t("qpcr.transformFirst")}</option>
                  {:else}
                    {#each effectiveGroups as group (group)}
                      <option value={group}>{group}</option>
                    {/each}
                  {/if}
                </select>
              </label>
            {/if}

            <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <label class="flex min-w-0 flex-col gap-1">
                <span class="text-callout font-medium">{t("qpcr.repeats")}</span>
                <input
                  type="number"
                  class="mynx-input"
                  min="1"
                  max="12"
                  step="1"
                  value={qpcr.repeatCount}
                  oninput={(event) =>
                    (qpcr.repeatCount = num(event.currentTarget.value, qpcr.repeatCount))}
                  aria-label={t("qpcr.repeats")}
                />
              </label>
              <label class="flex min-w-0 flex-col gap-1">
                <span class="text-callout font-medium">{t("qpcr.referenceGene")}</span>
                <select
                  class="mynx-input"
                  bind:value={() => selectedRefGene(), (v) => (qpcr.refGene = v)}
                  disabled={qpcr.geneNames.length === 0}
                  aria-label={t("qpcr.referenceGene")}
                >
                  {#if qpcr.geneNames.length === 0}
                    <option value="">{t("qpcr.transformFirst")}</option>
                  {:else}
                    {#each qpcr.geneNames as gene (gene)}
                      <option value={gene}>{gene}</option>
                    {/each}
                  {/if}
                </select>
              </label>
              <label class="flex min-w-0 flex-col gap-1">
                <span class="text-callout font-medium">{t("qpcr.selectNum")}</span>
                <input
                  type="number"
                  class="mynx-input"
                  min="0"
                  step="1"
                  value={qpcr.selectNum}
                  oninput={(event) =>
                    (qpcr.selectNum = num(event.currentTarget.value, qpcr.selectNum))}
                  aria-label={t("qpcr.selectNum")}
                />
              </label>
              <label class="flex min-w-0 flex-col gap-1">
                <span class="text-callout font-medium">{t("qpcr.outlierSd")}</span>
                <input
                  type="number"
                  class="mynx-input"
                  min="0"
                  step="0.5"
                  value={qpcr.outlierSd}
                  oninput={(event) =>
                    (qpcr.outlierSd = num(event.currentTarget.value, qpcr.outlierSd))}
                  aria-label={t("qpcr.outlierSd")}
                />
              </label>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-callout font-medium">{t("qpcr.chartColor")}</span>
              <span
                class="h-4 w-4 rounded border border-border"
                style={`background: ${qpcr.chartColor}`}
                aria-hidden="true"
              ></span>
              <span class="mynx-mono text-footnote text-text-secondary">
                {qpcr.chartColor.toUpperCase()}
              </span>
            </div>

            {#if calcFailure}
              <p
                class="rounded-md border border-warning/40 bg-warning/10 p-2 text-callout text-warning"
                role="alert"
              >
                {t(calcFailure.key, calcFailure.values)}
              </p>
            {/if}

            <button
              type="button"
              class="mynx-btn mynx-btn-primary"
              onclick={() => void runCalculate()}
              disabled={!canCalculate}
            >
              {qpcr.calcPhase === "running" ? t("qpcr.calculating") : t("qpcr.calculateAction")}
            </button>

            {#if qpcr.calcPhase === "success" && qpcr.calcMessage}
              <p
                class="rounded-md border border-success/40 bg-success/10 p-2 text-callout text-success"
                role="status"
              >
                {qpcr.calcMessage}
              </p>
              <button type="button" class="mynx-btn self-start" onclick={() => void exportAnalysisRecord()}>
                {t("qpcr.exportRecord")}
              </button>
            {:else if qpcr.calcPhase === "error" && qpcr.calcMessage}
              <p
                class="rounded-md border border-danger/40 bg-danger/10 p-2 text-callout text-danger"
                role="alert"
              >
                {qpcr.calcMessage}
              </p>
            {/if}

            {#if qpcr.chartInjectPhase === "running"}
              <p class="flex items-center gap-2 text-callout text-text-secondary" role="status">
                {t("qpcr.generating")}
                {@render phaseBadge(qpcr.chartInjectPhase)}
              </p>
            {:else if qpcr.chartInjectPhase === "error" && qpcr.chartInjectMessage}
              <p class="text-callout text-danger" role="alert">{qpcr.chartInjectMessage}</p>
            {/if}

            {#if qpcr.geneSheetNames.length > 0}
              <div class="flex flex-col gap-1">
                <span class="text-callout font-medium">
                  {t("qpcr.summarySheets")} · {qpcr.geneSheetNames.length}
                </span>
                <div class="flex flex-wrap gap-1">
                  {#each qpcr.geneSheetNames as name (name)}
                    <span class="mynx-chip max-w-[220px]">
                      <span class="mynx-truncate">{name}</span>
                    </span>
                  {/each}
                </div>
              </div>
            {/if}
            </div>
            {#if resultPreviewSeries}
              <section class="qpcr-result-preview mynx-card flex min-w-0 flex-col">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <IconChartBar size={14} stroke={1.75} aria-hidden="true" />
                    <h2 class="text-callout font-semibold">{t("qpcr.previewResult")}</h2>
                  </div>
                  {#if qpcr.chartSeries.length > 1}
                    <label class="flex min-w-0 items-center gap-2">
                      <span class="text-footnote text-text-secondary">{t("qpcr.previewGene")}</span>
                      <select
                        class="mynx-input max-w-48"
                        value={resultPreviewSeries.geneName}
                        onchange={(event) => (previewGeneName = event.currentTarget.value)}
                        aria-label={t("qpcr.previewGene")}
                      >
                        {#each qpcr.chartSeries as series (series.geneName)}
                          <option value={series.geneName}>{series.geneName}</option>
                        {/each}
                      </select>
                    </label>
                  {:else}
                    <span class="mynx-chip max-w-48">
                      <span class="mynx-truncate">{resultPreviewSeries.geneName}</span>
                    </span>
                  {/if}
                  {#if resultPreviewSeries.points.length > PREVIEW_ROW_LIMIT}
                    <button
                      type="button"
                      class="mynx-link inline-flex items-center gap-1 text-footnote"
                      aria-expanded={showAllResultGroups}
                      onclick={() => (showAllResultGroups = !showAllResultGroups)}
                    >
                      {#if showAllResultGroups}
                        <IconChevronUp size={13} stroke={1.75} aria-hidden="true" />
                        {t("qpcr.previewCollapseGroups", { count: PREVIEW_ROW_LIMIT })}
                      {:else}
                        <IconChevronDown size={13} stroke={1.75} aria-hidden="true" />
                        {t("qpcr.previewAllGroups", { count: resultPreviewSeries.points.length })}
                      {/if}
                    </button>
                  {/if}
                </div>
                <div class="flex flex-col gap-3 p-3">
                  <p class="text-footnote text-text-secondary">{t("qpcr.previewResultHint")}</p>
                  <div class="flex flex-col gap-2" role="img" aria-label={t("qpcr.previewResult")}>
                    {#each visibleResultPreviewPoints as point (point.name)}
                      <div class="grid min-w-0 grid-cols-[minmax(4.5rem,0.8fr)_minmax(3rem,2fr)_minmax(5rem,1fr)] items-center gap-2">
                        <span class="mynx-truncate text-footnote" title={point.name}>{point.name}</span>
                        <span class="h-2.5 overflow-hidden rounded-sm bg-surface-2">
                          <span
                            class="block h-full rounded-sm"
                            style={"width: " + Math.max(0, Math.min(100, (point.avg / resultPreviewScale) * 100)) + "%; background-color: " + qpcr.chartColor}
                            aria-hidden="true"
                          ></span>
                        </span>
                        <span class="mynx-mono text-right text-caption2 text-text-secondary">
                          {formatPreviewNumber(point.avg)} ± {formatPreviewNumber(point.stdev)}
                        </span>
                      </div>
                    {/each}
                  </div>
                  <!-- Intentional keyboard target for horizontal result-table scrolling. -->
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                  <div class="max-w-full overflow-auto rounded-md border border-border" tabindex="0" role="region" aria-label={t("qpcr.previewResultTableAria")}>
                    <table class="w-full min-w-[360px] border-separate border-spacing-0 text-left text-footnote">
                      <caption class="sr-only">{t("qpcr.previewResult")}: {resultPreviewSeries.geneName}</caption>
                      <thead class="bg-surface-2 text-text-secondary">
                        <tr>
                          <th scope="col" class="border-b border-r border-border px-2 py-1.5 font-medium">{t("qpcr.previewGroup")}</th>
                          <th scope="col" class="border-b border-r border-border px-2 py-1.5 text-right font-medium">{t("qpcr.previewMean")}</th>
                          <th scope="col" class="border-b border-border px-2 py-1.5 text-right font-medium">{t("qpcr.previewSd")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each visibleResultPreviewPoints as point (point.name)}
                          <tr>
                            <th scope="row" class="max-w-48 border-b border-r border-border px-2 py-1.5 font-normal">
                              <span class="mynx-truncate block" title={point.name}>{point.name}</span>
                            </th>
                            <td class="border-b border-r border-border px-2 py-1.5 text-right mynx-mono">{formatPreviewNumber(point.avg)}</td>
                            <td class="border-b border-border px-2 py-1.5 text-right mynx-mono">{formatPreviewNumber(point.stdev)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            {/if}
            </div>
          </div>
        </div>
      {:else}
        <!-- Step 4: plot -->
        <div class="mynx-card flex flex-col">
          <div class="flex items-center gap-2 border-b border-border px-3 py-2">
            <IconChartBar size={15} stroke={1.75} aria-hidden="true" />
            <span class="text-callout font-semibold">{t("qpcr.plotTitle")}</span>
            {#if qpcr.plotPhase !== "idle"}
              <span class="ml-auto">{@render phaseBadge(qpcr.plotPhase)}</span>
            {/if}
          </div>
          <div class="flex flex-col gap-3 p-3">
            <!-- plot type tabs -->
            <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("qpcr.plotTitle")}>
              {#each PLOT_KINDS as kind (kind)}
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-md border p-2 {qpcr.plotKind === kind
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-surface hover:border-text-secondary'}"
                  aria-pressed={qpcr.plotKind === kind}
                  onclick={() => (qpcr.plotKind = kind)}
                >
                  {#if kind === "bar"}
                    <IconChartBar size={18} stroke={1.6} aria-hidden="true" />
                  {:else}
                    <IconGrid4x4 size={18} stroke={1.6} aria-hidden="true" />
                  {/if}
                  <span class="mynx-truncate text-callout font-medium">
                    {kind === "bar" ? t("qpcr.plotTypeBar") : t("qpcr.plotTypeHeatmap")}
                  </span>
                </button>
              {/each}
            </div>

            <!-- common -->
            <fieldset class="flex flex-col gap-3 rounded-md border border-border p-3">
              <legend class="px-1 text-callout font-medium">{t("qpcr.commonSection")}</legend>
              <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <label class="flex min-w-0 flex-col gap-1">
                  <span class="text-callout font-medium">{t("qpcr.plotSheet")}</span>
                  <select
                    class="mynx-input"
                    bind:value={qpcr.plotSheetName}
                    onchange={() => ensurePlotSheet()}
                    disabled={!hasFile || qpcr.sheetNames.length === 0}
                    aria-label={t("qpcr.plotSheet")}
                  >
                    {#each qpcr.sheetNames as name (name)}
                      <option value={name}>{name}</option>
                    {/each}
                  </select>
                </label>
                <label class="flex min-w-0 flex-col gap-1">
                  <span class="text-callout font-medium">{t("qpcr.outputPrefix")}</span>
                  <input
                    type="text"
                    class="mynx-input"
                    value={plotDraft.outputPrefix}
                    oninput={(event) => updatePlotDraft({ outputPrefix: event.currentTarget.value })}
                    aria-label={t("qpcr.outputPrefix")}
                  />
                </label>
                <label class="flex min-w-0 flex-col gap-1">
                  <span class="text-callout font-medium">{t("qpcr.plotFormat")}</span>
                  <select
                    class="mynx-input"
                    bind:value={() => plotDraft.format, (v) => updatePlotDraft({ format: v })}
                    aria-label={t("qpcr.plotFormat")}
                  >
                    {#each FORMATS as format (format)}
                      <option value={format}>{format}</option>
                    {/each}
                  </select>
                </label>
                <label class="flex min-w-0 flex-col gap-1">
                  <span class="text-callout font-medium">DPI</span>
                  <select
                    class="mynx-input"
                    value={String(plotDraft.dpi)}
                    onchange={(event) => updatePlotDraft({ dpi: num(event.currentTarget.value, plotDraft.dpi) })}
                    aria-label="DPI"
                  >
                    {#each DPIS as dpi (dpi)}
                      <option value={String(dpi)}>{dpi}</option>
                    {/each}
                  </select>
                </label>
                <label class="flex min-w-0 flex-col gap-1">
                  <span class="text-callout font-medium">{t("qpcr.plotWidth")}</span>
                  <input
                    type="number"
                    class="mynx-input"
                    min="2"
                    max="12"
                    step="0.5"
                    value={plotDraft.width}
                    oninput={(event) =>
                      updatePlotDraft({ width: num(event.currentTarget.value, plotDraft.width) })}
                    aria-label={t("qpcr.plotWidth")}
                  />
                </label>
                <label class="flex min-w-0 flex-col gap-1">
                  <span class="text-callout font-medium">{t("qpcr.plotHeight")}</span>
                  <input
                    type="number"
                    class="mynx-input"
                    min="2"
                    max="12"
                    step="0.5"
                    value={plotDraft.height}
                    oninput={(event) =>
                      updatePlotDraft({ height: num(event.currentTarget.value, plotDraft.height) })}
                    aria-label={t("qpcr.plotHeight")}
                  />
                </label>
                {#if qpcr.plotKind === "bar"}
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.plotGene")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.gene, (v) => updatePlotDraft({ gene: v })}
                      aria-label={t("qpcr.plotGene")}
                    >
                      <option value="ALL">{t("qpcr.geneAll")}</option>
                      {#each plotGenes as gene (gene)}
                        <option value={gene}>{gene}</option>
                      {/each}
                    </select>
                  </label>
                {/if}
                <div class="flex flex-col justify-center gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.installMissing")}</span>
                    {@render toggleSwitch(
                      qpcr.installMissing,
                      (next) => (qpcr.installMissing = next),
                      t("qpcr.installMissing"),
                    )}
                  </div>
                  {#if qpcr.plotKind === "bar"}
                    <div class="flex items-center justify-between gap-2">
                      <span class="mynx-truncate text-callout">{t("qpcr.batchMode")}</span>
                      {@render toggleSwitch(
                        plotDraft.batchMode,
                        (next) => updatePlotDraft({ batchMode: next }),
                        t("qpcr.batchMode"),
                      )}
                    </div>
                  {/if}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" class="mynx-btn shrink-0" onclick={() => void chooseOutputDir()}>
                  <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
                  {qpcr.plotOutputDir ? t("qpcr.changeOutputDir") : t("qpcr.chooseOutputDir")}
                </button>
                <span
                  class="mynx-truncate flex-1 text-footnote text-text-secondary"
                  title={qpcr.plotOutputDir}
                >
                  {qpcr.plotOutputDir || t("qpcr.noOutputDir")}
                </span>
              </div>
            </fieldset>

            {#if qpcr.plotKind === "bar"}
              <!-- bar params -->
              <fieldset class="flex flex-col gap-3 rounded-md border border-border p-3">
                <legend class="px-1 text-callout font-medium">{t("qpcr.barSection")}</legend>
                <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.barFill")}</span>
                    <input
                      type="color"
                      class="mynx-input h-[30px] p-0.5"
                      value={plotDraft.barFill}
                      oninput={(event) => updatePlotDraft({ barFill: event.currentTarget.value })}
                      aria-label={t("qpcr.barFill")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.errorColor")}</span>
                    <input
                      type="color"
                      class="mynx-input h-[30px] p-0.5"
                      value={plotDraft.errorColor}
                      oninput={(event) => updatePlotDraft({ errorColor: event.currentTarget.value })}
                      aria-label={t("qpcr.errorColor")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.barBorder")}</span>
                    <input
                      type="color"
                      class="mynx-input h-[30px] p-0.5"
                      value={plotDraft.barBorder}
                      oninput={(event) => updatePlotDraft({ barBorder: event.currentTarget.value })}
                      aria-label={t("qpcr.barBorder")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.barBorderWidth")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="0"
                      max="3"
                      step="0.1"
                      value={plotDraft.barBorderWidth}
                      oninput={(event) =>
                        updatePlotDraft({
                          barBorderWidth: num(event.currentTarget.value, plotDraft.barBorderWidth),
                        })}
                      aria-label={t("qpcr.barBorderWidth")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.barWidth")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="0"
                      max="1"
                      step="0.05"
                      value={plotDraft.barWidth}
                      oninput={(event) =>
                        updatePlotDraft({ barWidth: num(event.currentTarget.value, plotDraft.barWidth) })}
                      aria-label={t("qpcr.barWidth")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.errorWidth")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="0.1"
                      max="3"
                      step="0.1"
                      value={plotDraft.errorWidth}
                      oninput={(event) =>
                        updatePlotDraft({
                          errorWidth: num(event.currentTarget.value, plotDraft.errorWidth),
                        })}
                      aria-label={t("qpcr.errorWidth")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.errorCap")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="0"
                      max="0.5"
                      step="0.05"
                      value={plotDraft.errorCap}
                      oninput={(event) =>
                        updatePlotDraft({ errorCap: num(event.currentTarget.value, plotDraft.errorCap) })}
                      aria-label={t("qpcr.errorCap")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.xAngle")}</span>
                    <select
                      class="mynx-input"
                      value={String(plotDraft.xAngle)}
                      onchange={(event) =>
                        updatePlotDraft({ xAngle: num(event.currentTarget.value, plotDraft.xAngle) })}
                      aria-label={t("qpcr.xAngle")}
                    >
                      {#each BAR_ANGLES as angle (angle)}
                        <option value={String(angle)}>{angle}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.xLabel")}</span>
                    <input
                      type="text"
                      class="mynx-input"
                      value={plotDraft.xLabel}
                      oninput={(event) => updatePlotDraft({ xLabel: event.currentTarget.value })}
                      aria-label={t("qpcr.xLabel")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.yLabel")}</span>
                    <input
                      type="text"
                      class="mynx-input"
                      value={plotDraft.yLabel}
                      oninput={(event) => updatePlotDraft({ yLabel: event.currentTarget.value })}
                      aria-label={t("qpcr.yLabel")}
                    />
                  </label>
                  <div class="flex flex-col justify-center gap-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="mynx-truncate text-callout">{t("qpcr.showRawPoints")}</span>
                      {@render toggleSwitch(
                        plotDraft.showRawPoints,
                        (next) => updatePlotDraft({ showRawPoints: next }),
                        t("qpcr.showRawPoints"),
                      )}
                    </div>
                    <div class="flex items-center justify-between gap-2">
                      <span class="mynx-truncate text-callout">{t("qpcr.showXTick")}</span>
                      {@render toggleSwitch(
                        plotDraft.showXTick,
                        (next) => updatePlotDraft({ showXTick: next }),
                        t("qpcr.showXTick"),
                      )}
                    </div>
                  </div>
                  <div class="flex flex-col justify-center gap-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="mynx-truncate text-callout">{t("qpcr.scientificNotation")}</span>
                      {@render toggleSwitch(
                        plotDraft.scientificNotation,
                        (next) => updatePlotDraft({ scientificNotation: next }),
                        t("qpcr.scientificNotation"),
                      )}
                    </div>
                    <div class="flex items-center justify-between gap-2">
                      <span class="mynx-truncate text-callout">{t("qpcr.autoSize")}</span>
                      {@render toggleSwitch(
                        plotDraft.autoSize,
                        (next) => updatePlotDraft({ autoSize: next }),
                        t("qpcr.autoSize"),
                      )}
                    </div>
                  </div>
                </div>
              </fieldset>

              <!-- stats -->
              <fieldset class="flex flex-col gap-3 rounded-md border border-border p-3">
                <legend class="px-1 text-callout font-medium">{t("qpcr.statsSection")}</legend>
                <div class="flex flex-wrap gap-x-4 gap-y-2">
                  <div class="flex min-w-[150px] flex-1 items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.enableStats")}</span>
                    {@render toggleSwitch(
                      plotDraft.enableStats,
                      (next) => updatePlotDraft({ enableStats: next }),
                      t("qpcr.enableStats"),
                    )}
                  </div>
                  <div class="flex min-w-[150px] flex-1 items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.showStats")}</span>
                    {@render toggleSwitch(
                      plotDraft.showStats,
                      (next) => updatePlotDraft({ showStats: next }),
                      t("qpcr.showStats"),
                    )}
                  </div>
                  <div class="flex min-w-[150px] flex-1 items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.showNs")}</span>
                    {@render toggleSwitch(
                      plotDraft.showNs,
                      (next) => updatePlotDraft({ showNs: next }),
                      t("qpcr.showNs"),
                    )}
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.sigMode")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.sigMode, (v) => updatePlotDraft({ sigMode: v })}
                      aria-label={t("qpcr.sigMode")}
                    >
                      {#each SIG_MODES as mode (mode)}
                        <option value={mode}>{mode}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.controlGroup")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.controlGroup, (v) => updatePlotDraft({ controlGroup: v })}
                      aria-label={t("qpcr.controlGroup")}
                    >
                      <option value="">{t("qpcr.default")}</option>
                      {#each plotGroups as group (group)}
                        <option value={group}>{group}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.statTest")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.statTest, (v) => updatePlotDraft({ statTest: v })}
                      aria-label={t("qpcr.statTest")}
                    >
                      {#each STAT_TESTS as test (test)}
                        <option value={test}>{test}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.pAdjustMethod")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.pAdjustMethod, (v) => updatePlotDraft({ pAdjustMethod: v })}
                      aria-label={t("qpcr.pAdjustMethod")}
                    >
                      {#each P_ADJUST as method (method)}
                        <option value={method}>{method}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.labelStyle")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.labelStyle, (v) => updatePlotDraft({ labelStyle: v })}
                      aria-label={t("qpcr.labelStyle")}
                    >
                      {#each LABEL_STYLES as style (style.value)}
                        <option value={style.value}>{t(style.key)}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.sigFile")}</span>
                    <input
                      type="text"
                      class="mynx-input"
                      value={plotDraft.sigFile}
                      oninput={(event) => updatePlotDraft({ sigFile: event.currentTarget.value })}
                      aria-label={t("qpcr.sigFile")}
                    />
                  </label>
                </div>
              </fieldset>
            {:else}
              <!-- heatmap params -->
              <fieldset class="flex flex-col gap-3 rounded-md border border-border p-3">
                <legend class="px-1 text-callout font-medium">{t("qpcr.heatSection")}</legend>
                <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.heatScale")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.heatmapScale, (v) => updatePlotDraft({ heatmapScale: v })}
                      aria-label={t("qpcr.heatScale")}
                    >
                      {#each HEAT_SCALES as scale (scale.value)}
                        <option value={scale.value}>{t(scale.key)}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.heatPalette")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.heatmapPalette, (v) => updatePlotDraft({ heatmapPalette: v })}
                      aria-label={t("qpcr.heatPalette")}
                    >
                      {#each PALETTES as palette (palette.value)}
                        <option value={palette.value}>{t(palette.key)}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.zlim")}</span>
                    <select
                      class="mynx-input"
                      value={String(plotDraft.zlim)}
                      onchange={(event) =>
                        updatePlotDraft({ zlim: num(event.currentTarget.value, plotDraft.zlim) })}
                      aria-label={t("qpcr.zlim")}
                    >
                      {#each ZLIMS as zlim (zlim)}
                        <option value={String(zlim)}>±{zlim}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.legendPosition")}</span>
                    <select
                      class="mynx-input"
                      bind:value={() => plotDraft.legendPosition, (v) => updatePlotDraft({ legendPosition: v })}
                      aria-label={t("qpcr.legendPosition")}
                    >
                      {#each LEGEND_POS as pos (pos.value)}
                        <option value={pos.value}>{t(pos.key)}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.heatTitle")}</span>
                    <input
                      type="text"
                      class="mynx-input"
                      value={plotDraft.heatmapTitle}
                      oninput={(event) => updatePlotDraft({ heatmapTitle: event.currentTarget.value })}
                      aria-label={t("qpcr.heatTitle")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.legendTitle")}</span>
                    <input
                      type="text"
                      class="mynx-input"
                      value={plotDraft.legendTitle}
                      oninput={(event) => updatePlotDraft({ legendTitle: event.currentTarget.value })}
                      aria-label={t("qpcr.legendTitle")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.cellTextSize")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="1"
                      max="8"
                      step="0.2"
                      value={plotDraft.cellTextSize}
                      oninput={(event) =>
                        updatePlotDraft({
                          cellTextSize: num(event.currentTarget.value, plotDraft.cellTextSize),
                        })}
                      aria-label={t("qpcr.cellTextSize")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.tileBorder")}</span>
                    <input
                      type="color"
                      class="mynx-input h-[30px] p-0.5"
                      value={plotDraft.tileBorder}
                      oninput={(event) => updatePlotDraft({ tileBorder: event.currentTarget.value })}
                      aria-label={t("qpcr.tileBorder")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.tileBorderWidth")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="0"
                      max="3"
                      step="0.05"
                      value={plotDraft.tileBorderWidth}
                      oninput={(event) =>
                        updatePlotDraft({
                          tileBorderWidth: num(event.currentTarget.value, plotDraft.tileBorderWidth),
                        })}
                      aria-label={t("qpcr.tileBorderWidth")}
                    />
                  </label>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 lg:grid-cols-3">
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.clusterRows")}</span>
                    {@render toggleSwitch(
                      plotDraft.heatmapClusterRows,
                      (next) => updatePlotDraft({ heatmapClusterRows: next }),
                      t("qpcr.clusterRows"),
                    )}
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.clusterCols")}</span>
                    {@render toggleSwitch(
                      plotDraft.heatmapClusterCols,
                      (next) => updatePlotDraft({ heatmapClusterCols: next }),
                      t("qpcr.clusterCols"),
                    )}
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.showCellValues")}</span>
                    {@render toggleSwitch(
                      plotDraft.showCellValues,
                      (next) => updatePlotDraft({ showCellValues: next }),
                      t("qpcr.showCellValues"),
                    )}
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.cellTextBold")}</span>
                    {@render toggleSwitch(
                      plotDraft.cellTextBold,
                      (next) => updatePlotDraft({ cellTextBold: next }),
                      t("qpcr.cellTextBold"),
                    )}
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.showRowNames")}</span>
                    {@render toggleSwitch(
                      plotDraft.showRowNames,
                      (next) => updatePlotDraft({ showRowNames: next }),
                      t("qpcr.showRowNames"),
                    )}
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.showColNames")}</span>
                    {@render toggleSwitch(
                      plotDraft.showColNames,
                      (next) => updatePlotDraft({ showColNames: next }),
                      t("qpcr.showColNames"),
                    )}
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.rowLabelItalic")}</span>
                    {@render toggleSwitch(
                      plotDraft.rowLabelItalic,
                      (next) => updatePlotDraft({ rowLabelItalic: next }),
                      t("qpcr.rowLabelItalic"),
                    )}
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.exportPng")}</span>
                    {@render toggleSwitch(
                      plotDraft.exportPng,
                      (next) => updatePlotDraft({ exportPng: next }),
                      t("qpcr.exportPng"),
                    )}
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="mynx-truncate text-callout">{t("qpcr.exportPdf")}</span>
                    {@render toggleSwitch(
                      plotDraft.exportPdf,
                      (next) => updatePlotDraft({ exportPdf: next }),
                      t("qpcr.exportPdf"),
                    )}
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.pngDpi")}</span>
                    <select
                      class="mynx-input"
                      value={String(plotDraft.pngDpi)}
                      onchange={(event) =>
                        updatePlotDraft({ pngDpi: num(event.currentTarget.value, plotDraft.pngDpi) })}
                      aria-label={t("qpcr.pngDpi")}
                    >
                      {#each DPIS as dpi (dpi)}
                        <option value={String(dpi)}>{dpi}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.pngWidth")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="1"
                      max="14"
                      step="0.5"
                      value={plotDraft.pngWidth}
                      oninput={(event) =>
                        updatePlotDraft({ pngWidth: num(event.currentTarget.value, plotDraft.pngWidth) })}
                      aria-label={t("qpcr.pngWidth")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.pngHeight")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="1"
                      max="14"
                      step="0.5"
                      value={plotDraft.pngHeight}
                      oninput={(event) =>
                        updatePlotDraft({ pngHeight: num(event.currentTarget.value, plotDraft.pngHeight) })}
                      aria-label={t("qpcr.pngHeight")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.pdfWidth")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="2"
                      max="14"
                      step="0.5"
                      value={plotDraft.pdfWidth}
                      oninput={(event) =>
                        updatePlotDraft({ pdfWidth: num(event.currentTarget.value, plotDraft.pdfWidth) })}
                      aria-label={t("qpcr.pdfWidth")}
                    />
                  </label>
                  <label class="flex min-w-0 flex-col gap-1">
                    <span class="text-callout font-medium">{t("qpcr.pdfHeight")}</span>
                    <input
                      type="number"
                      class="mynx-input"
                      min="1"
                      max="14"
                      step="0.5"
                      value={plotDraft.pdfHeight}
                      oninput={(event) =>
                        updatePlotDraft({ pdfHeight: num(event.currentTarget.value, plotDraft.pdfHeight) })}
                      aria-label={t("qpcr.pdfHeight")}
                    />
                  </label>
                </div>
              </fieldset>
            {/if}

            <!-- run row -->
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="mynx-btn mynx-btn-primary min-w-[120px]"
                onclick={() => void runPlot()}
                disabled={!canPlot}
              >
                <IconPlayerPlay size={13} stroke={1.75} aria-hidden="true" />
                {plotRunning ? t("qpcr.plotRunning") : t("qpcr.plotRun")}
              </button>
              {#if plotRunning}
                <button
                  type="button"
                  class="mynx-btn mynx-btn-danger"
                  onclick={() => void cancelPlot()}
                >
                  <IconPlayerStop size={13} stroke={1.75} aria-hidden="true" />
                  {t("qpcr.plotCancel")}
                </button>
              {/if}
              <button
                type="button"
                class="mynx-btn ml-auto"
                onclick={resetPlotDrafts}
                disabled={plotRunning}
                aria-label={t("qpcr.resetDefaults")}
              >
                <IconRefresh size={13} stroke={1.75} aria-hidden="true" />
                {t("qpcr.resetDefaults")}
              </button>
            </div>
            {#if qpcr.plotPhase === "error" && qpcr.plotMessage}
              <p
                class="rounded-md border border-danger/40 bg-danger/10 p-2 text-callout text-danger"
                role="alert"
              >
                {qpcr.plotMessage}
              </p>
            {:else if qpcr.plotPhase === "success" && qpcr.plotMessage}
              <p
                class="rounded-md border border-success/40 bg-success/10 p-2 text-callout text-success"
                role="status"
              >
                {qpcr.plotMessage}
              </p>
            {:else if qpcr.plotPhase === "cancelled"}
              <p
                class="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-2 text-callout text-text-secondary"
              >
                {@render phaseBadge(qpcr.plotPhase)}
                {qpcr.plotMessage}
              </p>
            {/if}
            {#if qpcr.plotResult?.outputDir}
              <div class="flex flex-wrap items-center gap-2 text-callout">
                <button type="button" class="mynx-link" onclick={openResultDir}>
                  <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
                  {t("task.openOutput")}
                </button>
                {#if qpcr.plotResult.statisticsFile}
                  <span class="text-text-secondary">{t("qpcr.statisticsFile")}:</span>
                  <CopyableText
                    text={qpcr.plotResult.statisticsFile}
                    label={fileLabelOf(qpcr.plotResult.statisticsFile)}
                  />
                {/if}
              </div>
            {/if}
            {#if plotPreviewStatus === "loading"}
              <p class="mynx-card text-callout text-text-secondary" role="status">
                {t("qpcr.previewLoading")}
              </p>
            {:else if plotPreviewStatus === "error"}
              <p class="mynx-card text-callout text-text-secondary" role="status">
                {t("qpcr.previewFailed")}
              </p>
            {:else if plotPreviewFiles.length > 0}
              <section class="mynx-card flex flex-col">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <IconChartBar size={14} stroke={1.75} aria-hidden="true" />
                    <h2 class="text-callout font-semibold">{t("qpcr.plotPreview")}</h2>
                    <span class="mynx-chip text-caption2">{plotPreviewFiles.length}</span>
                  </div>
                  {#if plotPreviewFiles.length > PLOT_PREVIEW_LIMIT}
                    <button
                      type="button"
                      class="mynx-link text-footnote"
                      onclick={() => (showAllPlotPreviews = !showAllPlotPreviews)}
                      aria-expanded={showAllPlotPreviews}
                    >
                      {showAllPlotPreviews
                        ? t("qpcr.previewLess")
                        : t("qpcr.previewMore", { count: plotPreviewFiles.length - PLOT_PREVIEW_LIMIT })}
                    </button>
                  {/if}
                </div>
                <div class="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                  {#each visiblePlotPreviewFiles as file (file)}
                    <figure class="min-w-0 overflow-hidden rounded-md border border-border bg-surface-2">
                      <div class="flex aspect-[4/3] items-center justify-center p-2">
                        <img
                          src={plotPreviewSrc(file)}
                          alt={t("qpcr.plotPreviewAlt", { file: fileLabelOf(file) })}
                          class="block max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                      <figcaption class="border-t border-border px-2 py-1.5 text-footnote">
                        <span class="mynx-truncate block" title={file}>{fileLabelOf(file)}</span>
                      </figcaption>
                    </figure>
                  {/each}
                </div>
              </section>
            {:else if qpcr.plotPhase === "success" && plotPreviewStatus === "ready"}
              <p class="mynx-card text-callout text-text-secondary" role="status">
                {t("qpcr.previewUnavailable")}
              </p>
            {/if}
            {#if qpcr.plotLogs.length > 0}
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <IconTerminal size={13} stroke={1.75} aria-hidden="true" />
                  <span class="text-callout font-medium">{t("qpcr.runLog")}</span>
                  {#if plotRunning}
                    <span class="mynx-badge mynx-badge-running">{t("status.running")}</span>
                  {/if}
                </div>
                <div
                  class="mynx-mono flex max-h-[220px] flex-col overflow-y-auto rounded-md border border-border bg-surface-2 p-2"
                >
                  {#each qpcr.plotLogs as line, index (index)}
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
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .qpcr-calc-container {
    container: qpcr-calc / inline-size;
  }

  .qpcr-calc-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  @container qpcr-calc (min-width: 900px) {
    .qpcr-calc-grid {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    }

    .qpcr-result-preview {
      align-self: start;
    }
  }
</style>
