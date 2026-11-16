<script lang="ts">
  import IconChartDots from "@tabler/icons-svelte/icons/chart-dots";
  import IconFlask from "@tabler/icons-svelte/icons/flask";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconLayersIntersect from "@tabler/icons-svelte/icons/layers-intersect";
  import IconPlus from "@tabler/icons-svelte/icons/plus";
  import IconTrash from "@tabler/icons-svelte/icons/trash";
  import IconX from "@tabler/icons-svelte/icons/x";
  import { t } from "../../app/i18n.svelte";
  import { openPath } from "../../app/tauri.js";
  import type { ComparisonMode } from "../../lib/contracts/generated/rnaseq/ComparisonMode.js";
  import { confirmDialog } from "./client.js";
  import { GROUP_COLORS, validComparisonsOf } from "./model.js";
  import {
    addBatch,
    addComparison,
    addGroup,
    assignSample,
    comparisonsUsingGroup,
    goStep,
    importReady,
    minGroupN,
    missingBatchSamples,
    poolSamples,
    removeBatch,
    removeComparison,
    removeGroup,
    renameBatch,
    renameGroup,
    rnaseq,
    selectSample,
    toggleBatchSample,
    unassignSample,
    updateComparison,
  } from "./state.svelte";

  /**
   * Step 2 — groups, comparisons and DE parameters. Group assignment uses
   * HTML5 drag & drop plus a click-to-select / click-target fallback; the
   * engine (rnaseq_engine.R) owns all methodology.
   */

  const COMPARISON_MODES: ComparisonMode[] = ["auto", "replicate", "noreplicate"];

  const cfg = $derived(rnaseq.config);
  const comps = $derived(validComparisonsOf(cfg));
  const groupNames = $derived(Object.keys(cfg.groups));
  const pool = $derived(poolSamples());
  const dataReady = $derived(importReady());
  const designReady = $derived(groupNames.length >= 2 && comps.length >= 1);
  const minN = $derived(minGroupN());
  const hasSingleton = $derived(Number.isFinite(minN) && minN < 2);
  const assignedCount = $derived(Object.values(cfg.groups).flat().length);
  const batchNames = $derived(Object.keys(cfg.batch));
  const missingBatches = $derived(missingBatchSamples());
  const selected = $derived(rnaseq.selectedSample);
  const running = $derived(rnaseq.status === "running");
  const done = $derived(rnaseq.status === "done");

  let dragOver: string | "pool" | null = $state(null);

  function groupColor(index: number): string {
    return GROUP_COLORS[index % GROUP_COLORS.length];
  }

  function chipDragStart(event: DragEvent, sample: string): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", sample);
      event.dataTransfer.effectAllowed = "move";
    }
    rnaseq.selectedSample = sample;
  }

  function dropOnGroup(event: DragEvent, name: string): void {
    event.preventDefault();
    dragOver = null;
    const sample = event.dataTransfer?.getData("text/plain") || rnaseq.selectedSample;
    if (!sample) return;
    assignSample(sample, name);
    rnaseq.selectedSample = "";
  }

  function dropOnPool(event: DragEvent): void {
    event.preventDefault();
    dragOver = null;
    const sample = event.dataTransfer?.getData("text/plain") || rnaseq.selectedSample;
    if (!sample) return;
    unassignSample(sample);
    rnaseq.selectedSample = "";
  }

  /** Click-to-assign: the group's explicit action moves the selected sample. */
  function pickGroup(name: string): void {
    if (!selected) return;
    assignSample(selected, name);
    rnaseq.selectedSample = "";
  }

  async function deleteGroup(name: string): Promise<void> {
    const related = comparisonsUsingGroup(name);
    const message =
      related > 0
        ? t("rnaseq.deleteGroupConfirmRelated", { name, count: related })
        : t("rnaseq.deleteGroupConfirm", { name });
    const ok = await confirmDialog({
      title: t("rnaseq.deleteGroupTitle"),
      message,
      kind: "warning",
    });
    if (!ok) return;
    removeGroup(name);
  }

  function num(raw: string, fallback: number): number {
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }
</script>

<div class="flex flex-col gap-3">
  <!-- ── Readiness ────────────────────────────────────────────────────── -->
  <div
    class="mynx-card flex flex-col gap-2 p-3 {designReady && dataReady
      ? 'border-success/50'
      : ''}"
  >
    <p class="text-[12px]">
      {#if !dataReady}
        <span class="text-warning">{t("rnaseq.designNotImported")}</span>
      {:else if !designReady}
        <span class="text-warning">{t("rnaseq.designNotReady")}</span>
      {:else}
        <span class="text-success">
          {t("rnaseq.designReady",
            { groups: groupNames.length, samples: assignedCount, comparisons: comps.length })}
        </span>
      {/if}
    </p>
    <div class="flex flex-wrap items-center gap-1">
      <span class="mynx-chip {dataReady ? 'border-success/60 text-success' : ''}">
        {t("rnaseq.checkData")}
      </span>
      <span class="mynx-chip {groupNames.length >= 2 ? 'border-success/60 text-success' : ''}">
        {t("rnaseq.checkGroups")}
      </span>
      <span class="mynx-chip {comps.length >= 1 ? 'border-success/60 text-success' : ''}">
        {t("rnaseq.checkComparisons")}
      </span>
    </div>
    {#if hasSingleton}
      <p
        class="rounded-md border border-warning/40 bg-warning/10 p-2 text-[12px] text-warning"
        role="status"
      >
        {t("rnaseq.singletonWarning")}
      </p>
    {/if}
  </div>

  <!-- ── Groups ───────────────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconLayersIntersect size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-[12px] font-semibold">{t("rnaseq.groups")}</span>
      <span class="mynx-truncate hidden text-[11px] text-text-secondary sm:inline">
        {t("rnaseq.groupsHint")}
      </span>
      <button type="button" class="mynx-btn ml-auto" onclick={() => addGroup()}>
        <IconPlus size={14} stroke={1.75} aria-hidden="true" />
        {t("rnaseq.addGroup")}
      </button>
    </div>
    <div class="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(200px,1fr)_minmax(0,2fr)]">
      <!-- sample pool -->
      <div
        class="flex flex-col gap-2 rounded-md border border-border p-2 {dragOver === 'pool'
          ? 'border-accent bg-accent/10'
          : ''}"
        role="region"
        aria-label={t("rnaseq.unassigned")}
        ondragover={(event) => {
          event.preventDefault();
          dragOver = "pool";
        }}
        ondragleave={() => (dragOver = null)}
        ondrop={dropOnPool}
        data-sample-pool
      >
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-medium">{t("rnaseq.unassigned")}</span>
          <span class="mynx-badge mynx-badge-queued">{pool.length}</span>
        </div>
        {#if selected}
          <p class="text-[11px] text-accent">
            {t("rnaseq.selectedSample", { name: selected })}
          </p>
        {:else}
          <p class="text-[11px] text-text-secondary">{t("rnaseq.clickAssign")}</p>
        {/if}
        <div class="flex flex-wrap gap-1">
          {#if pool.length === 0}
            <p class="text-[11px] text-text-secondary">
              {assignedCount === 0 ? t("rnaseq.poolEmpty") : t("rnaseq.allAssigned")}
            </p>
          {:else}
            {#each pool as sample (sample)}
              <button
                type="button"
                draggable="true"
                aria-pressed={selected === sample}
                class="mynx-chip cursor-grab {selected === sample ? 'border-accent bg-accent/10' : ''}"
                ondragstart={(event) => chipDragStart(event, sample)}
                onclick={() => selectSample(sample)}
              >
                {sample}
              </button>
            {/each}
          {/if}
        </div>
      </div>

      <!-- group cards -->
      <div class="flex flex-col gap-2">
        {#if groupNames.length === 0}
          <div class="flex flex-col items-center gap-1 rounded-md border border-dashed border-border p-4 text-center">
            <IconLayersIntersect size={20} stroke={1.5} aria-hidden="true" />
            <span class="text-[12px] font-medium">{t("rnaseq.noGroups")}</span>
            <span class="text-[11px] text-text-secondary">{t("rnaseq.noGroupsHint")}</span>
          </div>
        {/if}
        {#each groupNames as name, index (name)}
          {@const samples = cfg.groups[name] ?? []}
          <div
            class="rounded-md border p-2 {dragOver === name
              ? 'border-accent bg-accent/10'
              : 'border-border'}"
            style={`border-left: 3px solid ${groupColor(index)}`}
            data-group-name={name}
            role="group"
            aria-label={t("rnaseq.groupNameAria", { name })}
            ondragover={(event) => {
              event.preventDefault();
              dragOver = name;
            }}
            ondragleave={() => (dragOver = null)}
            ondrop={(event) => dropOnGroup(event, name)}
          >
            <div class="flex items-center gap-2">
              <input
                type="text"
                class="mynx-input h-7 min-w-0 flex-1"
                value={name}
                aria-label={t("rnaseq.groupNameAria", { name })}
                oninput={(event) => renameGroup(name, event.currentTarget.value)}
              />
              <span
                class="mynx-badge {samples.length >= 2 ? 'mynx-badge-success' : 'mynx-badge-queued'}"
                title={samples.length >= 2
                  ? t("rnaseq.groupReplicated")
                  : t("rnaseq.groupSingleton")}
              >
                n={samples.length}
              </span>
              <button
                type="button"
                class="mynx-btn !h-7 !w-7 !p-0"
                aria-label={t("rnaseq.assignSelectedToGroup", { name })}
                title={t("rnaseq.assignSelectedToGroup", { name })}
                disabled={!selected || running}
                onclick={() => pickGroup(name)}
              >
                <IconPlus size={13} stroke={1.75} aria-hidden="true" />
              </button>
              <button
                type="button"
                class="mynx-btn mynx-btn-danger !h-7 !w-7 !p-0"
                aria-label={t("rnaseq.deleteGroup")}
                title={t("rnaseq.deleteGroup")}
                onclick={(event) => {
                  event.stopPropagation();
                  void deleteGroup(name);
                }}
              >
                <IconTrash size={13} stroke={1.75} aria-hidden="true" />
              </button>
            </div>
            <div class="mt-2 flex flex-wrap gap-1">
              {#if samples.length === 0}
                <span class="text-[11px] text-text-secondary">{t("rnaseq.groupDropHint")}</span>
              {:else}
                {#each samples as sample (sample)}
                  <span
                    class="mynx-chip {selected === sample ? 'border-accent bg-accent/10' : ''}"
                  >
                    <button
                      type="button"
                      draggable="true"
                      aria-pressed={selected === sample}
                      aria-label={sample}
                      class="cursor-grab"
                      ondragstart={(event) => chipDragStart(event, sample)}
                      onclick={() => selectSample(sample)}
                    >
                      {sample}
                    </button>
                    <button
                      type="button"
                      class="text-danger"
                      aria-label={t("rnaseq.removeSample")}
                      onclick={() => unassignSample(sample)}
                    >
                      <IconX size={10} stroke={2} aria-hidden="true" />
                    </button>
                  </span>
                {/each}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- ── Batch covariate ──────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconFlask size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-[12px] font-semibold">{t("rnaseq.batch")}</span>
      <span class="mynx-badge mynx-badge-queued ml-auto">
        {batchNames.length > 0 ? batchNames.length : t("rnaseq.batchUnset")}
      </span>
      <button type="button" class="mynx-btn" onclick={() => addBatch()}>
        <IconPlus size={14} stroke={1.75} aria-hidden="true" />
        {t("rnaseq.addBatch")}
      </button>
    </div>
    <div class="flex flex-col gap-3 p-3">
      <p class="text-[11px] text-text-secondary">{t("rnaseq.batchNote")}</p>
      {#if batchNames.length === 0}
        <p class="text-[11px] text-text-secondary">{t("rnaseq.noBatchNote")}</p>
      {:else}
        {#each batchNames as name (name)}
          {@const members = cfg.batch[name] ?? []}
          <div class="rounded-md border border-border p-2">
            <div class="flex items-center gap-2">
              <input
                type="text"
                class="mynx-input h-7 min-w-0 flex-1"
                value={name}
                aria-label={t("rnaseq.batchNameAria")}
                oninput={(event) => renameBatch(name, event.currentTarget.value)}
              />
              <span class="mynx-badge {members.length ? 'mynx-badge-success' : 'mynx-badge-queued'}">
                n={members.length}
              </span>
              <button
                type="button"
                class="mynx-btn mynx-btn-danger !h-7 !w-7 !p-0"
                aria-label={t("rnaseq.deleteBatch")}
                onclick={() => removeBatch(name)}
              >
                <IconTrash size={13} stroke={1.75} aria-hidden="true" />
              </button>
            </div>
            <div class="mt-2 flex flex-wrap gap-1">
              {#each Object.values(cfg.groups).flat() as sample (sample)}
                <button
                  type="button"
                  aria-pressed={members.includes(sample)}
                  class="mynx-chip {members.includes(sample) ? 'border-accent bg-accent/10' : ''}"
                  onclick={() => toggleBatchSample(name, sample)}
                >
                  {members.includes(sample) ? "✓ " : ""}{sample}
                </button>
              {/each}
            </div>
          </div>
        {/each}
        {#if missingBatches.length > 0}
          <p
            class="rounded-md border border-warning/40 bg-warning/10 p-2 text-[12px] text-warning"
            role="alert"
          >
            {t("rnaseq.batchMissing", { count: missingBatches.length, list: missingBatches.join(", ") })}
          </p>
        {/if}
      {/if}
    </div>
  </div>

  <!-- ── Comparisons ──────────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconFlask size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-[12px] font-semibold">{t("rnaseq.comparisons")}</span>
      <button
        type="button"
        class="mynx-btn ml-auto"
        onclick={() => addComparison()}
      >
        <IconPlus size={14} stroke={1.75} aria-hidden="true" />
        {t("rnaseq.addComparison")}
      </button>
    </div>
    <div class="flex flex-col gap-2 p-3">
      <p class="text-[11px] text-text-secondary">{t("rnaseq.comparisonsTip")}</p>
      {#if cfg.comparisons.length === 0}
        <p class="text-[11px] text-text-secondary">{t("rnaseq.noComparisons")}</p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each cfg.comparisons as comparison, i (i)}
            {@const invalid = !comparison.case || !comparison.control || comparison.case === comparison.control}
            <div
              class="grid grid-cols-1 items-center gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_auto] {invalid
                ? 'border-danger/60'
                : 'border-border'}"
            >
              <input
                type="text"
                class="mynx-input"
                value={comparison.name}
                placeholder={comparison.case && comparison.control
                  ? `${comparison.case}_vs_${comparison.control}`
                  : ""}
                aria-label={t("rnaseq.compName")}
                oninput={(event) =>
                  updateComparison(i, { name: event.currentTarget.value })}
              />
              <select
                class="mynx-input"
                value={comparison.case}
                aria-label={t("rnaseq.compCase")}
                onchange={(event) =>
                  updateComparison(i, { case: event.currentTarget.value })}
              >
                <option value="">—</option>
                {#each groupNames as name (name)}
                  <option value={name}>{name}</option>
                {/each}
              </select>
              <span class="text-center text-[11px] text-text-secondary">vs</span>
              <select
                class="mynx-input"
                value={comparison.control}
                aria-label={t("rnaseq.compControl")}
                onchange={(event) =>
                  updateComparison(i, { control: event.currentTarget.value })}
              >
                <option value="">—</option>
                {#each groupNames as name (name)}
                  <option value={name}>{name}</option>
                {/each}
              </select>
              <div class="flex items-center gap-1">
                <select
                  class="mynx-input"
                  value={comparison.mode ?? "auto"}
                  aria-label={t("rnaseq.compPathAria")}
                  onchange={(event) =>
                    updateComparison(i, { mode: event.currentTarget.value as ComparisonMode })}
                >
                  {#each COMPARISON_MODES as mode (mode)}
                    <option value={mode}>{mode}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="mynx-btn mynx-btn-danger !h-8 !w-8 !p-0"
                  aria-label={t("rnaseq.removeComparison")}
                  onclick={() => removeComparison(i)}
                >
                  <IconTrash size={13} stroke={1.75} aria-hidden="true" />
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- ── DE parameters ────────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconFlask size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-[12px] font-semibold">{t("rnaseq.deParams")}</span>
      <span class="mynx-truncate hidden text-[11px] text-text-secondary sm:inline">
        {t("rnaseq.deParamsHint")}
      </span>
    </div>
    <div class="flex flex-col gap-3 p-3">
      <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("rnaseq.deMethod")}>
        {#each ["deseq2", "edger"] as method (method)}
          <label
            class="mynx-card flex cursor-pointer items-center justify-between gap-2 p-2 {cfg.de.method ===
            method
              ? 'border-accent bg-accent/10'
              : ''}"
          >
            <span class="mynx-truncate text-[12px] font-medium">
              {method === "deseq2" ? t("rnaseq.deMethodDeseq2") : t("rnaseq.deMethodEdger")}
            </span>
            <input
              type="radio"
              name="rnaseq-de-method"
              class="sr-only"
              checked={cfg.de.method === method}
              onchange={() => (cfg.de.method = method as "deseq2" | "edger")}
            />
          </label>
        {/each}
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-[12px] font-medium">{t("rnaseq.dePadj")}</span>
          <input
            type="number"
            class="mynx-input"
            min="0"
            max="1"
            step="0.01"
            value={cfg.de.padj}
            aria-label={t("rnaseq.dePadj")}
            oninput={(event) => (cfg.de.padj = num(event.currentTarget.value, cfg.de.padj))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-[12px] font-medium">{t("rnaseq.deLog2fc")}</span>
          <input
            type="number"
            class="mynx-input"
            min="0"
            step="0.1"
            value={cfg.de.log2fc}
            aria-label={t("rnaseq.deLog2fc")}
            oninput={(event) => (cfg.de.log2fc = num(event.currentTarget.value, cfg.de.log2fc))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-[12px] font-medium">{t("rnaseq.deBcv")}</span>
          <input
            type="number"
            class="mynx-input"
            min="0"
            step="0.05"
            value={cfg.de.bcv}
            aria-label={t("rnaseq.deBcv")}
            title={t("rnaseq.deBcvHint")}
            oninput={(event) => (cfg.de.bcv = num(event.currentTarget.value, cfg.de.bcv))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-[12px] font-medium">{t("rnaseq.deShrink")}</span>
          <select
            class="mynx-input"
            value={cfg.de.shrink}
            aria-label={t("rnaseq.deShrink")}
            onchange={(event) => (cfg.de.shrink = event.currentTarget.value as typeof cfg.de.shrink)}
          >
            <option value="none">{t("rnaseq.shrinkNone")}</option>
            <option value="apeglm">apeglm</option>
            <option value="ashr">ashr</option>
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-[12px] font-medium">{t("rnaseq.deFilter")}</span>
          <select
            class="mynx-input"
            value={cfg.de.filter.method}
            aria-label={t("rnaseq.deFilter")}
            onchange={(event) =>
              (cfg.de.filter.method = event.currentTarget
                .value as typeof cfg.de.filter.method)}
          >
            <option value="filterByExpr">{t("rnaseq.filterFilterByExpr")}</option>
            <option value="min_count">{t("rnaseq.filterMinCount")}</option>
            <option value="none">{t("rnaseq.filterNone")}</option>
          </select>
        </label>
        {#if cfg.de.filter.method !== "none"}
          <label class="flex min-w-0 flex-col gap-1">
            <span class="text-[12px] font-medium">{t("rnaseq.minCount")}</span>
            <input
              type="number"
              class="mynx-input"
              min="0"
              step="1"
              value={cfg.de.filter.min_count}
              aria-label={t("rnaseq.minCount")}
              oninput={(event) =>
                (cfg.de.filter.min_count = num(event.currentTarget.value, cfg.de.filter.min_count))}
            />
          </label>
          {#if cfg.de.filter.method === "filterByExpr"}
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-[12px] font-medium">{t("rnaseq.minTotalCount")}</span>
              <input
                type="number"
                class="mynx-input"
                min="0"
                step="1"
                value={cfg.de.filter.min_total_count}
                aria-label={t("rnaseq.minTotalCount")}
                oninput={(event) =>
                  (cfg.de.filter.min_total_count = num(
                    event.currentTarget.value,
                    cfg.de.filter.min_total_count,
                  ))}
              />
            </label>
          {/if}
          {#if cfg.de.filter.method === "min_count"}
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-[12px] font-medium">{t("rnaseq.minSamples")}</span>
              <input
                type="number"
                class="mynx-input"
                min="1"
                step="1"
                value={cfg.de.filter.min_samples}
                aria-label={t("rnaseq.minSamples")}
                oninput={(event) =>
                  (cfg.de.filter.min_samples = num(
                    event.currentTarget.value,
                    cfg.de.filter.min_samples,
                  ))}
              />
            </label>
          {/if}
        {/if}
        <div class="flex items-center justify-between gap-2">
          <span class="mynx-truncate text-[12px]" title={t("rnaseq.useBatchHint")}>
            {t("rnaseq.useBatch")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.de.use_batch}
            aria-label={t("rnaseq.useBatch")}
            title={t("rnaseq.useBatchHint")}
            class="relative h-5 w-9 shrink-0 rounded-full border transition-colors {cfg.de.use_batch
              ? 'border-accent bg-accent'
              : 'border-border bg-surface-2'}"
            onclick={() => (cfg.de.use_batch = !cfg.de.use_batch)}
          >
            <span
              class="absolute left-0.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-transform {cfg
                .de.use_batch
                ? 'translate-x-4'
                : ''}"
            ></span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Summary + done ───────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col gap-2 p-3">
    <div class="flex flex-wrap gap-2">
      <span class="mynx-chip">{groupNames.length} {t("rnaseq.summaryGroups")}</span>
      <span class="mynx-chip">{assignedCount} {t("rnaseq.summarySamples")}</span>
      <span class="mynx-chip">{comps.length} {t("rnaseq.summaryComparisons")}</span>
      <span class="mynx-chip">
        {hasSingleton
          ? `${t("rnaseq.pathNoReplicate")} · BCV=${cfg.de.bcv}`
          : cfg.de.method === "deseq2"
            ? "DESeq2 Wald"
            : "edgeR QLF"}
      </span>
    </div>
    {#if done}
      <div class="flex flex-wrap items-center gap-2 rounded-md border border-success/40 bg-success/10 p-2">
        <span class="text-[12px] font-medium text-success">{t("rnaseq.deDone")}</span>
        <button type="button" class="mynx-btn ml-auto" onclick={() => goStep("plots")}>
          <IconChartDots size={14} stroke={1.75} aria-hidden="true" />
          {t("rnaseq.goPlots")}
        </button>
        {#if rnaseq.resultDir}
          <button
            type="button"
            class="mynx-btn"
            onclick={() => void openPath(rnaseq.resultDir)}
          >
            <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
            {t("rnaseq.openResults")}
          </button>
        {/if}
      </div>
    {:else if rnaseq.status === "failed"}
      <div
        class="rounded-md border border-danger/40 bg-danger/10 p-2 text-[12px] text-danger"
        role="alert"
      >
        {t("rnaseq.runFailedTitle")}
      </div>
    {:else if rnaseq.status === "cancelled"}
      <div
        class="rounded-md border border-border bg-surface-2 p-2 text-[12px] text-text-secondary"
        role="status"
      >
        {t("rnaseq.runCancelledTitle")}
      </div>
    {/if}
    {#if running}
      <p class="text-[12px] text-text-secondary" role="status">{t("status.running")}</p>
    {/if}
  </div>
</div>
