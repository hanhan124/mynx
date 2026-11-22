<script lang="ts">
  import SwitchCard from "../../components/SwitchCard.svelte";
  import Switch from "../../components/Switch.svelte";
  import IconChartDots from "@tabler/icons-svelte/icons/chart-dots";
  import IconChartHistogram from "@tabler/icons-svelte/icons/chart-histogram";
  import IconFlame from "@tabler/icons-svelte/icons/flame";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconLayersIntersect from "@tabler/icons-svelte/icons/layers-intersect";
  import IconPalette from "@tabler/icons-svelte/icons/palette";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconPlus from "@tabler/icons-svelte/icons/plus";
  import IconTrash from "@tabler/icons-svelte/icons/trash";
  import { t } from "../../app/i18n.svelte";
  import { pushToast } from "../../app/state.svelte";
  import { openPath } from "../../app/tauri.js";
  import type { LegendPos } from "../../lib/contracts/generated/rnaseq/LegendPos.js";
  import type { PcaJob } from "../../lib/contracts/generated/rnaseq/PcaJob.js";
  import type { SelectedHeatmapJob } from "../../lib/contracts/generated/rnaseq/SelectedHeatmapJob.js";
  import { pickOpenDir } from "./client.js";
  import {
    ADDITIONAL_BOOLEAN_KEYS,
    ADDITIONAL_BOOLEAN_LABEL_KEYS,
    DISCRETE_PALETTES,
    EXPORT_FORMATS,
    HEAT_PALETTES,
    parseGeneList,
  } from "./model.js";
  import { goStep, loadResultDir, rnaseq, startRun, updateConfig } from "./state.svelte";

  /**
   * Step 3 — figure selection and plotting configuration. All rendering is
   * engine work (rnaseq_engine.R); this page only collects the params.json
   * contract fields.
   */

  const LEGEND_POSITIONS: LegendPos[] = ["right", "bottom", "top", "left", "none"];
  const CLUSTER_METHODS = ["ward.D2", "ward.D", "complete", "average", "single"];
  const ROW_DISTANCES = ["pearson", "spearman", "euclidean", "maximum", "manhattan"];
  const COLUMN_DISTANCES = ["euclidean", "pearson", "spearman", "maximum", "manhattan"];

  const cfg = $derived(rnaseq.config);
  const overallEnabled = $derived(cfg.overall_heatmap.enabled);
  const selectedHmEnabled = $derived(
    cfg.selected_heatmaps.some((job) => job.enabled !== false),
  );
  const pcaEnabled = $derived(cfg.plots.pca.some((job) => job.enabled !== false));
  const volcanoEnabled = $derived(cfg.plots.volcano.enabled);
  const qcEnabled = $derived(cfg.plots.additional.enabled);
  const figureCount = $derived(
    Number(overallEnabled) +
      Number(selectedHmEnabled) +
      Number(pcaEnabled) +
      Number(volcanoEnabled) +
      Number(qcEnabled),
  );
  const anyHeatmapEnabled = $derived(overallEnabled || selectedHmEnabled);
  const groupNames = $derived(Object.keys(cfg.groups));
  const comparisonNames = $derived(
    cfg.comparisons.map((c) => c.name).filter(Boolean),
  );
  const clusterCount = $derived(Object.keys(cfg.gene_clusters).length);
  const clusterGeneCount = $derived(
    Object.values(cfg.gene_clusters).flat().length,
  );
  const running = $derived(rnaseq.status === "running");

  function num(raw: string, fallback: number): number {
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function toggleSelectedHeatmaps(next: boolean): void {
    updateConfig((draft) => {
      if (next && draft.selected_heatmaps.length === 0) {
        draft.selected_heatmaps.push(makeSelectedJob(1));
      }
      for (const job of draft.selected_heatmaps) job.enabled = next;
    });
  }

  function makeSelectedJob(index: number): SelectedHeatmapJob {
    return {
      name: index === 1 ? "gene_clusters" : `gene_set_${index}`,
      title: index === 1 ? t("rnaseq.selectedJobDefaultTitle") : `Gene set ${index}`,
      enabled: null,
      gene_groups: null,
      samples: null,
      n_clusters: null,
      options: {
        cluster_rows: false,
        cluster_columns: false,
        show_row_dend: true,
        show_column_dend: true,
        border: false,
        show_row_title: false,
        width: 4.5,
      },
    };
  }

  function togglePca(next: boolean): void {
    updateConfig((draft) => {
      if (next && draft.plots.pca.length === 0) {
        draft.plots.pca.push(makePcaJob(1));
      }
      for (const job of draft.plots.pca) job.enabled = next;
    });
  }

  function makePcaJob(index: number): PcaJob {
    return {
      name: index === 1 ? "PCA_selected" : `PCA_${index}`,
      title: null,
      enabled: null,
      samples: null,
      ntop: 500,
      pcs: [1, 2],
      label_samples: true,
      ellipse: false,
      legend_pos: "right",
      square_panel: true,
      width_mm: 76,
      height_mm: 62,
    };
  }

  function addSelectedJob(): void {
    updateConfig((draft) => {
      draft.selected_heatmaps.push(makeSelectedJob(draft.selected_heatmaps.length + 1));
    });
  }

  function addPcaJob(): void {
    updateConfig((draft) => {
      draft.plots.pca.push(makePcaJob(draft.plots.pca.length + 1));
    });
  }

  function toggleFormat(format: string): void {
    updateConfig((draft) => {
      const current = draft.plots.formats ?? ["png"];
      const next = current.includes(format)
        ? current.filter((item) => item !== format)
        : [...current, format];
      draft.plots.formats = next.length > 0 ? next : ["png"];
      draft.heatmap.formats = [...draft.plots.formats];
    });
  }

  function setTopN(raw: string): void {
    updateConfig((draft) => {
      const text = raw.trim();
      draft.overall_heatmap.top_n =
        !text || text.toLowerCase() === "all"
          ? "all"
          : Math.max(1, Number(text) || 1);
    });
  }

  function toggleComparisonFilter(name: string): void {
    updateConfig((draft) => {
      const current = draft.overall_heatmap.comparisons ?? [];
      const next = current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name];
      draft.overall_heatmap.comparisons = next.length > 0 ? next : null;
    });
  }

  function setNClusters(raw: string): void {
    updateConfig((draft) => {
      const value = Math.round(num(raw, 0));
      draft.overall_heatmap.n_clusters = value < 2 ? null : value;
    });
  }

  function setClusterGenes(name: string, raw: string): void {
    updateConfig((draft) => {
      draft.gene_clusters[name] = parseGeneList(raw);
    });
  }

  function addCluster(): void {
    updateConfig((draft) => {
      let i = Object.keys(draft.gene_clusters).length + 1;
      while (draft.gene_clusters[`Cluster${i}`]) i += 1;
      draft.gene_clusters[`Cluster${i}`] = [];
    });
  }

  function deleteCluster(name: string): void {
    updateConfig((draft) => {
      delete draft.gene_clusters[name];
    });
  }

  function renameCluster(name: string, raw: string): void {
    const next = raw.trim();
    if (!next || next === name || cfg.gene_clusters[next]) return;
    updateConfig((draft) => {
      const entries = Object.entries(draft.gene_clusters);
      const reordered: Record<string, string[]> = {};
      for (const [key, genes] of entries) {
        reordered[key === name ? next : key] = genes;
      }
      draft.gene_clusters = reordered;
    });
  }

  function toggleJobSample(jobIndex: number, group: string): void {
    updateConfig((draft) => {
      const job = draft.selected_heatmaps[jobIndex];
      if (!job) return;
      const current = job.samples ?? [];
      const next = current.includes(group)
        ? current.filter((item) => item !== group)
        : [...current, group];
      job.samples = next.length > 0 ? next : null;
    });
  }

  async function browseResult(): Promise<void> {
    const picked = await pickOpenDir({ title: t("rnaseq.loadResult") });
    if (!picked) return;
    const ok = await loadResultDir(picked);
    if (ok) rnaseq.step = "results";
  }

  async function runSelected(): Promise<void> {
    const wantHeatmaps = overallEnabled || selectedHmEnabled;
    const wantPlots = pcaEnabled || volcanoEnabled || qcEnabled;
    if (!wantHeatmaps && !wantPlots) {
      pushToast("info", t("rnaseq.selectFigureFirst"));
      return;
    }
    if (!rnaseq.hasResult && !cfg.data_file) {
      goStep("design");
      return;
    }
    if (!rnaseq.hasResult && volcanoEnabled) {
      pushToast("info", t("rnaseq.volcanoNoResult"));
    }
    const steps: string[] = [];
    if (wantHeatmaps) steps.push("heatmap");
    if (wantPlots) steps.push("plots");
    await startRun(steps);
  }

  async function runHeatmaps(): Promise<void> {
    if (!rnaseq.hasResult && !cfg.data_file) {
      goStep("design");
      return;
    }
    await startRun(["heatmap"]);
  }

  async function runPlots(): Promise<void> {
    if (!rnaseq.hasResult && !cfg.data_file) {
      goStep("design");
      return;
    }
    if (!rnaseq.hasResult && volcanoEnabled) {
      pushToast("info", t("rnaseq.volcanoNoResult"));
    }
    await startRun(["plots"]);
  }
</script>

{#snippet figureSwitch(checked: boolean, set: (next: boolean) => void, label: string, hint: string)}
  <SwitchCard {checked} {label} {hint} onchange={set} />
{/snippet}

{#snippet toggleRow(checked: boolean, set: (next: boolean) => void, label: string)}
  <div class="flex items-center justify-between gap-2">
    <span class="mynx-truncate text-callout">{label}</span>
    <Switch {checked} {label} onchange={set} />
  </div>
{/snippet}

<div class="flex flex-col gap-3">
  <!-- ── Figure picker ────────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconChartDots size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-callout font-semibold">{t("rnaseq.chooseFigures")}</span>
      <span class="mynx-badge mynx-badge-queued ml-auto">
        {t("rnaseq.figuresSelected", { count: figureCount })}
      </span>
    </div>
    <div class="flex flex-col gap-3 p-3">
      <p class="text-footnote text-text-secondary">{t("rnaseq.chooseFiguresHint")}</p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {@render figureSwitch(
          overallEnabled,
          (next) => (cfg.overall_heatmap.enabled = next),
          t("rnaseq.figOverall"),
          t("rnaseq.figOverallHint"),
        )}
        {@render figureSwitch(
          selectedHmEnabled,
          (next) => toggleSelectedHeatmaps(next),
          t("rnaseq.figSelected"),
          t("rnaseq.figSelectedHint"),
        )}
        {@render figureSwitch(
          pcaEnabled,
          (next) => togglePca(next),
          t("rnaseq.figPca"),
          t("rnaseq.figPcaHint"),
        )}
        {@render figureSwitch(
          volcanoEnabled,
          (next) => (cfg.plots.volcano.enabled = next),
          t("rnaseq.figVolcano"),
          t("rnaseq.figVolcanoHint"),
        )}
        {@render figureSwitch(
          qcEnabled,
          (next) => (cfg.plots.additional.enabled = next),
          t("rnaseq.figQc"),
          t("rnaseq.figQcHint"),
        )}
      </div>
    </div>
  </div>

  <!-- ── Result source ────────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconFlame size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-callout font-semibold">{t("rnaseq.resultSource")}</span>
      <span
        class="mynx-badge ml-auto {rnaseq.hasResult
          ? 'mynx-badge-success'
          : 'mynx-badge-error'}"
      >
        {rnaseq.hasResult ? t("rnaseq.sourceReady") : t("rnaseq.sourceNone")}
      </span>
    </div>
    <div class="flex flex-col gap-2 p-3">
      <p class="text-footnote text-text-secondary">{t("rnaseq.sourceHint")}</p>
      <div class="flex items-center gap-2">
        <input
          type="text"
          class="mynx-input min-w-0 flex-1"
          value={rnaseq.resultDir}
          readonly
          placeholder={t("rnaseq.resultDirPlaceholder")}
          aria-label={t("rnaseq.resultSource")}
        />
        <button type="button" class="mynx-btn" onclick={() => void browseResult()}>
          {t("rnaseq.browse")}
        </button>
        {#if rnaseq.hasResult && rnaseq.resultDir}
          <button
            type="button"
            class="mynx-btn h-8 w-8 p-0"
            aria-label={t("rnaseq.openResults")}
            title={t("rnaseq.openResults")}
            onclick={() => void openPath(rnaseq.resultDir)}
          >
            <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
          </button>
        {/if}
      </div>
      {#if !rnaseq.hasResult}
        <button type="button" class="mynx-btn self-start" onclick={() => goStep("design")}>
          {t("rnaseq.goAnalysis")}
        </button>
      {/if}
    </div>
  </div>

  <!-- ── Overall heatmap ──────────────────────────────────────────────── -->
  {#if overallEnabled}
    <div class="mynx-card flex flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconPhoto size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-callout font-semibold">{t("rnaseq.overallTitle")}</span>
      </div>
      <div class="mynx-param-grid grid grid-cols-2 gap-3 p-3 lg:grid-cols-4">
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.geneSource")}</span>
          <select
            class="mynx-input"
            value={cfg.overall_heatmap.gene_source}
            aria-label={t("rnaseq.geneSource")}
            onchange={(event) =>
              (cfg.overall_heatmap.gene_source = event.currentTarget
                .value as typeof cfg.overall_heatmap.gene_source)}
          >
            <option value="variable">{t("rnaseq.geneSourceVariable")}</option>
            <option value="deg">{t("rnaseq.geneSourceDeg")}</option>
          </select>
        </label>
        {#if cfg.overall_heatmap.gene_source === "variable"}
          <label class="flex min-w-0 flex-col gap-1">
            <span class="text-callout font-medium">{t("rnaseq.topN")}</span>
            <input
              type="text"
              class="mynx-input"
              value={String(cfg.overall_heatmap.top_n)}
              placeholder="all"
              aria-label={t("rnaseq.topN")}
              oninput={(event) => setTopN(event.currentTarget.value)}
            />
          </label>
          {@render toggleRow(
            cfg.overall_heatmap.expressed_only,
            (next) => (cfg.overall_heatmap.expressed_only = next),
            t("rnaseq.expressedOnly"),
          )}
        {:else}
          <label class="flex min-w-0 flex-col gap-1">
            <span class="text-callout font-medium">{t("rnaseq.maxGenes")}</span>
            <input
              type="number"
              class="mynx-input"
              min="1"
              step="100"
              value={cfg.overall_heatmap.max_genes}
              aria-label={t("rnaseq.maxGenes")}
              oninput={(event) =>
                (cfg.overall_heatmap.max_genes = num(
                  event.currentTarget.value,
                  cfg.overall_heatmap.max_genes,
                ))}
            />
          </label>
          <div class="col-span-2 flex flex-col gap-1 lg:col-span-4">
            <span class="text-callout font-medium">{t("rnaseq.includeComparisons")}</span>
            {#if comparisonNames.length === 0}
              <p class="text-footnote text-text-secondary">{t("rnaseq.comparisonsEmptyHint")}</p>
            {:else}
              <div class="flex flex-wrap gap-1">
                {#each comparisonNames as name (name)}
                  <button
                    type="button"
                    aria-pressed={(cfg.overall_heatmap.comparisons ?? []).includes(name)}
                    class="mynx-chip {(cfg.overall_heatmap.comparisons ?? []).includes(name)
                      ? 'border-accent bg-accent/10'
                      : ''}"
                    onclick={() => toggleComparisonFilter(name)}
                  >
                    {name}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.nClusters")}</span>
          <input
            type="number"
            class="mynx-input"
            min="0"
            step="1"
            value={cfg.overall_heatmap.n_clusters ?? 0}
            aria-label={t("rnaseq.nClusters")}
            oninput={(event) => setNClusters(event.currentTarget.value)}
          />
        </label>
        {@render toggleRow(
          cfg.overall_heatmap.sample_correlation,
          (next) => (cfg.overall_heatmap.sample_correlation = next),
          t("rnaseq.sampleCorrelation"),
        )}
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.corrPalette")}</span>
          <select
            class="mynx-input"
            value={cfg.overall_heatmap.correlation_palette}
            aria-label={t("rnaseq.corrPalette")}
            onchange={(event) =>
              (cfg.overall_heatmap.correlation_palette = event.currentTarget.value)}
          >
            {#each HEAT_PALETTES as palette (palette)}
              <option value={palette}>{palette}</option>
            {/each}
          </select>
        </label>
        <label class="col-span-2 flex min-w-0 flex-col gap-1 lg:col-span-4">
          <span class="text-callout font-medium">{t("rnaseq.markerGenes")}</span>
          <textarea
            class="mynx-input min-h-[80px]"
            rows={5}
            aria-label={t("rnaseq.markerGenes")}
            value={cfg.overall_heatmap.marker_genes.join("\n")}
            oninput={(event) =>
              (cfg.overall_heatmap.marker_genes = parseGeneList(event.currentTarget.value))}
          ></textarea>
          <span class="text-footnote text-text-secondary">{t("rnaseq.markerGenesHint")}</span>
        </label>
      </div>
    </div>
  {/if}

  <!-- ── Selected-gene heatmaps ───────────────────────────────────────── -->
  {#if selectedHmEnabled}
    <div class="mynx-card flex flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconLayersIntersect size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-callout font-semibold">{t("rnaseq.selectedTitle")}</span>
        <span class="mynx-badge mynx-badge-queued ml-auto">
          {t("rnaseq.clustersStat", { clusters: clusterCount, genes: clusterGeneCount })}
        </span>
        <button type="button" class="mynx-btn" onclick={addSelectedJob}>
          <IconPlus size={14} stroke={1.75} aria-hidden="true" />
          {t("rnaseq.addFigure")}
        </button>
      </div>
      <div class="flex flex-col gap-3 p-3">
        <!-- gene clusters editor -->
        <div class="flex flex-col gap-2">
          <span class="text-callout font-medium">{t("rnaseq.geneClusters")}</span>
          {#each Object.entries(cfg.gene_clusters) as [name, genes] (name)}
            <div class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[160px_minmax(0,1fr)_auto_auto]">
              <input
                type="text"
                class="mynx-input"
                value={name}
                aria-label={t("rnaseq.clusterNameAria", { name })}
                oninput={(event) => renameCluster(name, event.currentTarget.value)}
              />
              <textarea
                class="mynx-input min-h-[36px]"
                rows={Math.min(4, Math.max(1, Math.ceil(genes.length / 6)))}
                placeholder="RPE65, MITF, …"
                aria-label={t("rnaseq.clusterNameAria", { name })}
                value={genes.join(", ")}
                oninput={(event) => setClusterGenes(name, event.currentTarget.value)}
              ></textarea>
              <span class="mynx-badge mynx-badge-queued">{genes.length}</span>
              <button
                type="button"
                class="mynx-btn mynx-btn-danger h-8 w-8 p-0"
                aria-label={t("rnaseq.deleteCluster", { name })}
                onclick={() => deleteCluster(name)}
              >
                <IconTrash size={13} stroke={1.75} aria-hidden="true" />
              </button>
            </div>
          {/each}
          <button type="button" class="mynx-btn self-start" onclick={addCluster}>
            <IconPlus size={14} stroke={1.75} aria-hidden="true" />
            {t("rnaseq.addCluster")}
          </button>
        </div>

        {#each cfg.selected_heatmaps as job, ji (ji)}
          <fieldset class="grid grid-cols-2 gap-3 rounded-md border border-border p-3 lg:grid-cols-4">
            <legend class="px-1 text-callout font-medium">{job.name}</legend>
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.outputName")}</span>
              <input
                type="text"
                class="mynx-input"
                value={job.name}
                title={t("rnaseq.outputNameHint")}
                aria-label={t("rnaseq.outputName")}
                oninput={(event) =>
                  (cfg.selected_heatmaps[ji].name =
                    event.currentTarget.value.replace(/[^A-Za-z0-9_.-]+/g, "_") ||
                    `gene_set_${ji + 1}`)}
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.figureTitle")}</span>
              <input
                type="text"
                class="mynx-input"
                value={job.title}
                aria-label={t("rnaseq.figureTitle")}
                oninput={(event) => (cfg.selected_heatmaps[ji].title = event.currentTarget.value)}
              />
            </label>
            {@render toggleRow(
              job.enabled !== false,
              (next) => (cfg.selected_heatmaps[ji].enabled = next),
              t("rnaseq.jobEnabled"),
            )}
            {#if cfg.selected_heatmaps.length > 1}
              <button
                type="button"
                class="mynx-btn mynx-btn-danger self-end"
                onclick={() => updateConfig((draft) => draft.selected_heatmaps.splice(ji, 1))}
              >
                <IconTrash size={13} stroke={1.75} aria-hidden="true" />
                {t("rnaseq.removeFigure")}
              </button>
            {/if}
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.widthIn")}</span>
              <input
                type="number"
                class="mynx-input"
                min="2"
                step="0.5"
                value={job.options.width ?? 4.5}
                aria-label={t("rnaseq.widthIn")}
                oninput={(event) =>
                  (cfg.selected_heatmaps[ji].options.width = num(
                    event.currentTarget.value,
                    job.options.width ?? 4.5,
                  ))}
              />
            </label>
            {@render toggleRow(
              job.options.cluster_rows ?? false,
              (next) => (cfg.selected_heatmaps[ji].options.cluster_rows = next),
              t("rnaseq.clusterRows"),
            )}
            {@render toggleRow(
              job.options.cluster_columns ?? false,
              (next) => (cfg.selected_heatmaps[ji].options.cluster_columns = next),
              t("rnaseq.clusterColumns"),
            )}
            {@render toggleRow(
              job.options.show_row_dend ?? true,
              (next) => {
                cfg.selected_heatmaps[ji].options.show_row_dend = next;
                cfg.selected_heatmaps[ji].options.show_column_dend = next;
              },
              t("rnaseq.showDendrograms"),
            )}
            {@render toggleRow(
              job.options.show_row_title ?? true,
              (next) => (cfg.selected_heatmaps[ji].options.show_row_title = next),
              t("rnaseq.showClusterNames"),
            )}
            <div class="col-span-2 flex flex-col gap-1 lg:col-span-4">
              <span class="text-callout font-medium">{t("rnaseq.plotGroups")}</span>
              {#if groupNames.length === 0}
                <p class="text-footnote text-text-secondary">{t("rnaseq.noGroupsHint")}</p>
              {:else}
                <div class="flex flex-wrap gap-1">
                  {#each groupNames as group (group)}
                    <button
                      type="button"
                      aria-pressed={(job.samples ?? []).includes(group)}
                      class="mynx-chip {(job.samples ?? []).includes(group)
                        ? 'border-accent bg-accent/10'
                        : ''}"
                      onclick={() => toggleJobSample(ji, group)}
                    >
                      {group}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </fieldset>
        {/each}
      </div>
    </div>
  {/if}

  <!-- ── Heatmap style ────────────────────────────────────────────────── -->
  {#if anyHeatmapEnabled}
    <div class="mynx-card flex flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconPalette size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-callout font-semibold">{t("rnaseq.heatmapStyle")}</span>
      </div>
      <div class="mynx-param-grid grid grid-cols-2 gap-3 p-3 lg:grid-cols-4">
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.transform")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.transform}
            aria-label={t("rnaseq.transform")}
            onchange={(event) =>
              (cfg.heatmap.transform = event.currentTarget
                .value as typeof cfg.heatmap.transform)}
          >
            <option value="vst">VST (DESeq2)</option>
            <option value="logcpm">log-CPM (edgeR)</option>
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.scale")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.scale}
            aria-label={t("rnaseq.scale")}
            onchange={(event) => (cfg.heatmap.scale = event.currentTarget.value as typeof cfg.heatmap.scale)}
          >
            <option value="row">{t("rnaseq.scaleRow")}</option>
            <option value="none">{t("rnaseq.scaleNone")}</option>
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.palette")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.palette}
            aria-label={t("rnaseq.palette")}
            onchange={(event) => (cfg.heatmap.palette = event.currentTarget.value)}
          >
            {#each HEAT_PALETTES as palette (palette)}
              <option value={palette}>{palette}</option>
            {/each}
          </select>
        </label>
        {@render toggleRow(
          cfg.heatmap.reverse_palette,
          (next) => (cfg.heatmap.reverse_palette = next),
          t("rnaseq.reversePalette"),
        )}
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.zlim")}</span>
          <input
            type="number"
            class="mynx-input"
            min="0.5"
            step="0.5"
            value={cfg.heatmap.zlim}
            aria-label={t("rnaseq.zlim")}
            oninput={(event) => (cfg.heatmap.zlim = num(event.currentTarget.value, cfg.heatmap.zlim))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.groupPalette")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.group_palette}
            aria-label={t("rnaseq.groupPalette")}
            onchange={(event) => (cfg.heatmap.group_palette = event.currentTarget.value)}
          >
            {#each DISCRETE_PALETTES as palette (palette)}
              <option value={palette}>{palette}</option>
            {/each}
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.clusterPalette")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.gene_group_palette}
            aria-label={t("rnaseq.clusterPalette")}
            onchange={(event) => (cfg.heatmap.gene_group_palette = event.currentTarget.value)}
          >
            {#each DISCRETE_PALETTES as palette (palette)}
              <option value={palette}>{palette}</option>
            {/each}
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.clusterMethod")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.cluster_method}
            aria-label={t("rnaseq.clusterMethod")}
            onchange={(event) => (cfg.heatmap.cluster_method = event.currentTarget.value)}
          >
            {#each CLUSTER_METHODS as method (method)}
              <option value={method}>{method}</option>
            {/each}
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.rowDistance")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.row_distance}
            aria-label={t("rnaseq.rowDistance")}
            onchange={(event) => (cfg.heatmap.row_distance = event.currentTarget.value)}
          >
            {#each ROW_DISTANCES as distance (distance)}
              <option value={distance}>{distance}</option>
            {/each}
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.columnDistance")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.column_distance}
            aria-label={t("rnaseq.columnDistance")}
            onchange={(event) => (cfg.heatmap.column_distance = event.currentTarget.value)}
          >
            {#each COLUMN_DISTANCES as distance (distance)}
              <option value={distance}>{distance}</option>
            {/each}
          </select>
        </label>
        {@render toggleRow(
          cfg.heatmap.cluster_rows,
          (next) => (cfg.heatmap.cluster_rows = next),
          t("rnaseq.clusterGeneRows"),
        )}
        {@render toggleRow(
          cfg.heatmap.cluster_columns,
          (next) => (cfg.heatmap.cluster_columns = next),
          t("rnaseq.clusterSampleCols"),
        )}
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.columnNamesRot")}</span>
          <input
            type="number"
            class="mynx-input"
            min="0"
            max="90"
            step="45"
            value={cfg.heatmap.column_names_rot}
            aria-label={t("rnaseq.columnNamesRot")}
            oninput={(event) =>
              (cfg.heatmap.column_names_rot = num(
                event.currentTarget.value,
                cfg.heatmap.column_names_rot,
              ))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.columnNamesSide")}</span>
          <select
            class="mynx-input"
            value={cfg.heatmap.column_names_side}
            aria-label={t("rnaseq.columnNamesSide")}
            onchange={(event) =>
              (cfg.heatmap.column_names_side = event.currentTarget
                .value as typeof cfg.heatmap.column_names_side)}
          >
            <option value="top">{t("rnaseq.sideTop")}</option>
            <option value="bottom">{t("rnaseq.sideBottom")}</option>
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.fontSize")}</span>
          <input
            type="number"
            class="mynx-input"
            min="4"
            step="1"
            value={cfg.heatmap.font_size}
            aria-label={t("rnaseq.fontSize")}
            oninput={(event) =>
              (cfg.heatmap.font_size = num(event.currentTarget.value, cfg.heatmap.font_size))}
          />
        </label>
        {@render toggleRow(
          cfg.heatmap.row_names_italic,
          (next) => (cfg.heatmap.row_names_italic = next),
          t("rnaseq.italicGenes"),
        )}
        {@render toggleRow(
          cfg.heatmap.show_row_names !== false,
          (next) => (cfg.heatmap.show_row_names = next),
          t("rnaseq.showGeneNames"),
        )}
        {@render toggleRow(
          cfg.heatmap.show_column_names,
          (next) => (cfg.heatmap.show_column_names = next),
          t("rnaseq.showSampleNames"),
        )}
        {@render toggleRow(
          cfg.heatmap.show_annotation_name,
          (next) => (cfg.heatmap.show_annotation_name = next),
          t("rnaseq.showAnnotationNames"),
        )}
        {@render toggleRow(
          cfg.heatmap.show_batch,
          (next) => (cfg.heatmap.show_batch = next),
          t("rnaseq.showBatchAnnotation"),
        )}
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.heatmapDpi")}</span>
          <input
            type="number"
            class="mynx-input"
            min="72"
            step="50"
            value={cfg.heatmap.dpi}
            aria-label={t("rnaseq.heatmapDpi")}
            oninput={(event) => (cfg.heatmap.dpi = num(event.currentTarget.value, cfg.heatmap.dpi))}
          />
        </label>
      </div>
    </div>
  {/if}

  <!-- ── PCA ──────────────────────────────────────────────────────────── -->
  {#if pcaEnabled}
    <div class="mynx-card flex flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconChartDots size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-callout font-semibold">{t("rnaseq.pcaTitle")}</span>
        <button type="button" class="mynx-btn ml-auto" onclick={addPcaJob}>
          <IconPlus size={14} stroke={1.75} aria-hidden="true" />
          {t("rnaseq.addFigure")}
        </button>
      </div>
      <div class="flex flex-col gap-3 p-3">
        {#each cfg.plots.pca as job, pi (pi)}
          <fieldset class="grid grid-cols-2 gap-3 rounded-md border border-border p-3 lg:grid-cols-4">
            <legend class="px-1 text-callout font-medium">{job.name}</legend>
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.outputName")}</span>
              <input
                type="text"
                class="mynx-input"
                value={job.name}
                aria-label={t("rnaseq.outputName")}
                oninput={(event) =>
                  (cfg.plots.pca[pi].name =
                    event.currentTarget.value.replace(/[^A-Za-z0-9_.-]+/g, "_") ||
                    `PCA_${pi + 1}`)}
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.pcaNtop")}</span>
              <input
                type="number"
                class="mynx-input"
                min="10"
                step="50"
                value={job.ntop}
                aria-label={t("rnaseq.pcaNtop")}
                oninput={(event) => (cfg.plots.pca[pi].ntop = Math.round(num(event.currentTarget.value, job.ntop)))}
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.pcaX")}</span>
              <input
                type="number"
                class="mynx-input"
                min="1"
                step="1"
                value={job.pcs[0]}
                aria-label={t("rnaseq.pcaX")}
                oninput={(event) =>
                  (cfg.plots.pca[pi].pcs = [
                    Math.round(num(event.currentTarget.value, job.pcs[0])),
                    job.pcs[1],
                  ])}
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.pcaY")}</span>
              <input
                type="number"
                class="mynx-input"
                min="1"
                step="1"
                value={job.pcs[1]}
                aria-label={t("rnaseq.pcaY")}
                oninput={(event) =>
                  (cfg.plots.pca[pi].pcs = [
                    job.pcs[0],
                    Math.round(num(event.currentTarget.value, job.pcs[1])),
                  ])}
              />
            </label>
            {@render toggleRow(
              job.label_samples,
              (next) => (cfg.plots.pca[pi].label_samples = next),
              t("rnaseq.labelSamples"),
            )}
            {@render toggleRow(
              job.ellipse,
              (next) => (cfg.plots.pca[pi].ellipse = next),
              t("rnaseq.ellipse"),
            )}
            {@render toggleRow(
              job.square_panel,
              (next) => (cfg.plots.pca[pi].square_panel = next),
              t("rnaseq.pcaSquare"),
            )}
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.legendPos")}</span>
              <select
                class="mynx-input"
                value={job.legend_pos}
                aria-label={t("rnaseq.legendPos")}
                onchange={(event) =>
                  (cfg.plots.pca[pi].legend_pos = event.currentTarget.value as LegendPos)}
              >
                {#each LEGEND_POSITIONS as pos (pos)}
                  <option value={pos}>{t(`rnaseq.legend${pos.charAt(0).toUpperCase()}${pos.slice(1)}`)}</option>
                {/each}
              </select>
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.widthMm")}</span>
              <input
                type="number"
                class="mynx-input"
                min="40"
                step="5"
                value={job.width_mm}
                aria-label={t("rnaseq.widthMm")}
                oninput={(event) =>
                  (cfg.plots.pca[pi].width_mm = num(event.currentTarget.value, job.width_mm))}
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              <span class="text-callout font-medium">{t("rnaseq.heightMm")}</span>
              <input
                type="number"
                class="mynx-input"
                min="40"
                step="5"
                value={job.height_mm}
                aria-label={t("rnaseq.heightMm")}
                oninput={(event) =>
                  (cfg.plots.pca[pi].height_mm = num(event.currentTarget.value, job.height_mm))}
              />
            </label>
            {@render toggleRow(
              job.enabled !== false,
              (next) => (cfg.plots.pca[pi].enabled = next),
              t("rnaseq.jobEnabled"),
            )}
            {#if cfg.plots.pca.length > 1}
              <button
                type="button"
                class="mynx-btn mynx-btn-danger self-end"
                onclick={() => updateConfig((draft) => draft.plots.pca.splice(pi, 1))}
              >
                <IconTrash size={13} stroke={1.75} aria-hidden="true" />
                {t("rnaseq.removeFigure")}
              </button>
            {/if}
          </fieldset>
        {/each}
      </div>
    </div>
  {/if}

  <!-- ── Volcano ──────────────────────────────────────────────────────── -->
  {#if volcanoEnabled}
    <div class="mynx-card flex flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconChartHistogram size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-callout font-semibold">{t("rnaseq.volcanoTitle")}</span>
      </div>
      <div class="mynx-param-grid grid grid-cols-2 gap-3 p-3 lg:grid-cols-4">
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.volcanoLabelTop")}</span>
          <input
            type="number"
            class="mynx-input"
            min="0"
            step="1"
            value={cfg.plots.volcano.label_top}
            aria-label={t("rnaseq.volcanoLabelTop")}
            oninput={(event) =>
              (cfg.plots.volcano.label_top = Math.round(
                num(event.currentTarget.value, cfg.plots.volcano.label_top),
              ))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.pointSize")}</span>
          <input
            type="number"
            class="mynx-input"
            min="0.1"
            step="0.1"
            value={cfg.plots.volcano.point_size}
            aria-label={t("rnaseq.pointSize")}
            oninput={(event) =>
              (cfg.plots.volcano.point_size = num(
                event.currentTarget.value,
                cfg.plots.volcano.point_size,
              ))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.widthMm")}</span>
          <input
            type="number"
            class="mynx-input"
            min="40"
            step="5"
            value={cfg.plots.volcano.width_mm}
            aria-label={t("rnaseq.widthMm")}
            oninput={(event) =>
              (cfg.plots.volcano.width_mm = num(
                event.currentTarget.value,
                cfg.plots.volcano.width_mm,
              ))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.heightMm")}</span>
          <input
            type="number"
            class="mynx-input"
            min="40"
            step="5"
            value={cfg.plots.volcano.height_mm}
            aria-label={t("rnaseq.heightMm")}
            oninput={(event) =>
              (cfg.plots.volcano.height_mm = num(
                event.currentTarget.value,
                cfg.plots.volcano.height_mm,
              ))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.legendPos")}</span>
          <select
            class="mynx-input"
            value={cfg.plots.volcano.legend_pos}
            aria-label={t("rnaseq.legendPos")}
            onchange={(event) =>
              (cfg.plots.volcano.legend_pos = event.currentTarget.value as LegendPos)}
          >
            {#each LEGEND_POSITIONS as pos (pos)}
              <option value={pos}>{t(`rnaseq.legend${pos.charAt(0).toUpperCase()}${pos.slice(1)}`)}</option>
            {/each}
          </select>
        </label>
        {@render toggleRow(
          cfg.plots.volcano.show_subtitle,
          (next) => (cfg.plots.volcano.show_subtitle = next),
          t("rnaseq.showSubtitle"),
        )}
        <p class="col-span-2 self-end text-footnote text-text-secondary lg:col-span-4">
          {t("rnaseq.volcanoColorsHint")}
        </p>
      </div>
    </div>
  {/if}

  <!-- ── Export & QC ──────────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconChartHistogram size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-callout font-semibold">{t("rnaseq.exportQc")}</span>
    </div>
    <div class="mynx-param-grid grid grid-cols-2 gap-3 p-3 lg:grid-cols-4">
      <div class="col-span-2 flex flex-col gap-1 lg:col-span-4">
        <span class="text-callout font-medium">{t("rnaseq.exportFormats")}</span>
        <div class="flex flex-wrap gap-1">
          {#each EXPORT_FORMATS as format (format)}
            <button
              type="button"
              aria-pressed={cfg.plots.formats.includes(format)}
              class="mynx-chip {cfg.plots.formats.includes(format)
                ? 'border-accent bg-accent/10'
                : ''}"
              onclick={() => toggleFormat(format)}
            >
              {format.toUpperCase()}
            </button>
          {/each}
        </div>
        <span class="text-footnote text-text-secondary">{t("rnaseq.exportFormatsHint")}</span>
      </div>
      <label class="flex min-w-0 flex-col gap-1">
        <span class="text-callout font-medium">{t("rnaseq.dpi")}</span>
        <input
          type="number"
          class="mynx-input"
          min="150"
          max="1200"
          step="50"
          value={cfg.plots.dpi}
          aria-label={t("rnaseq.dpi")}
          oninput={(event) => (cfg.plots.dpi = Math.round(num(event.currentTarget.value, cfg.plots.dpi)))}
        />
      </label>
      <label class="flex min-w-0 flex-col gap-1">
        <span class="text-callout font-medium">{t("rnaseq.fontFamily")}</span>
        <input
          type="text"
          class="mynx-input"
          value={cfg.plots.font_family}
          placeholder="Arial"
          title={t("rnaseq.fontFamilyHint")}
          aria-label={t("rnaseq.fontFamily")}
          oninput={(event) =>
            (cfg.plots.font_family = event.currentTarget.value || "Arial")}
        />
      </label>
      <label class="flex min-w-0 flex-col gap-1">
        <span class="text-callout font-medium">{t("rnaseq.baseSize")}</span>
        <input
          type="number"
          class="mynx-input"
          min="5"
          max="18"
          step="0.5"
          value={cfg.plots.base_size}
          aria-label={t("rnaseq.baseSize")}
          oninput={(event) =>
            (cfg.plots.base_size = num(event.currentTarget.value, cfg.plots.base_size))}
        />
      </label>
      <label class="flex min-w-0 flex-col gap-1">
        <span class="text-callout font-medium">{t("rnaseq.plotsGroupPalette")}</span>
        <select
          class="mynx-input"
          value={cfg.plots.group_palette}
          aria-label={t("rnaseq.plotsGroupPalette")}
          onchange={(event) => (cfg.plots.group_palette = event.currentTarget.value)}
        >
          {#each DISCRETE_PALETTES as palette (palette)}
            <option value={palette}>{palette}</option>
          {/each}
        </select>
      </label>
      {#if qcEnabled}
        {#each ADDITIONAL_BOOLEAN_KEYS as key (key)}
          {@render toggleRow(
            Boolean(cfg.plots.additional[key]),
            (next) => (cfg.plots.additional[key] = next),
            t(ADDITIONAL_BOOLEAN_LABEL_KEYS[key]),
          )}
        {/each}
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.addTopN")}</span>
          <input
            type="number"
            class="mynx-input"
            min="1"
            step="1"
            value={cfg.plots.additional.top_n}
            aria-label={t("rnaseq.addTopN")}
            oninput={(event) =>
              (cfg.plots.additional.top_n = Math.round(
                num(event.currentTarget.value, cfg.plots.additional.top_n),
              ))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.qcWidth")}</span>
          <input
            type="number"
            class="mynx-input"
            min="50"
            step="5"
            value={cfg.plots.additional.width_mm}
            aria-label={t("rnaseq.qcWidth")}
            oninput={(event) =>
              (cfg.plots.additional.width_mm = num(
                event.currentTarget.value,
                cfg.plots.additional.width_mm,
              ))}
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-callout font-medium">{t("rnaseq.qcHeight")}</span>
          <input
            type="number"
            class="mynx-input"
            min="40"
            step="5"
            value={cfg.plots.additional.height_mm}
            aria-label={t("rnaseq.qcHeight")}
            oninput={(event) =>
              (cfg.plots.additional.height_mm = num(
                event.currentTarget.value,
                cfg.plots.additional.height_mm,
              ))}
          />
        </label>
        <label class="col-span-2 flex min-w-0 flex-col gap-1 lg:col-span-4">
          <span class="text-callout font-medium">{t("rnaseq.targetGenes")}</span>
          <textarea
            class="mynx-input min-h-[60px]"
            rows={3}
            aria-label={t("rnaseq.targetGenes")}
            value={cfg.plots.additional.genes.join("\n")}
            oninput={(event) =>
              (cfg.plots.additional.genes = parseGeneList(event.currentTarget.value))}
          ></textarea>
        </label>
      {/if}
    </div>
  </div>

  <!-- ── Run row ──────────────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-wrap items-center gap-2 p-3">
    <button
      type="button"
      class="mynx-btn mynx-btn-primary"
      disabled={running || figureCount === 0}
      onclick={() => void runSelected()}
    >
      {t("rnaseq.runSelected", { count: figureCount })}
    </button>
    <button
      type="button"
      class="mynx-btn"
      disabled={running || !anyHeatmapEnabled}
      onclick={() => void runHeatmaps()}
    >
      {t("rnaseq.runHeatmapsOnly")}
    </button>
    <button
      type="button"
      class="mynx-btn"
      disabled={running || (!pcaEnabled && !volcanoEnabled && !qcEnabled)}
      onclick={() => void runPlots()}
    >
      {t("rnaseq.runPlotsOnly")}
    </button>
    {#if running}
      <span class="mynx-badge mynx-badge-running">{t("status.running")}</span>
    {/if}
  </div>
</div>
