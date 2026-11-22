<script lang="ts">
  import IconDatabase from "@tabler/icons-svelte/icons/database";
  import IconFileImport from "@tabler/icons-svelte/icons/file-import";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconTable from "@tabler/icons-svelte/icons/table";
  import IconTag from "@tabler/icons-svelte/icons/tag";
  import { t } from "../../app/i18n.svelte";
  import { pushToast } from "../../app/state.svelte";
  import { openPath } from "../../app/tauri.js";
  import CopyableText from "../../components/CopyableText.svelte";
  import { pickOpenFile } from "./client.js";
  import { MATRIX_FORMATS, baseName } from "./model.js";
  import {
    appliedFormatLabel,
    importCounts,
    importWarnings,
    pickOutputDir,
    rnaseq,
    updateConfig,
  } from "./state.svelte";

  /**
   * Step 1 — counts import. Only column selection and the normalized cache
   * happen here; duplicate genes / rounding are engine (input config) work.
   */

  const cfg = $derived(rnaseq.config);
  const data = $derived(rnaseq.importData);
  const sampleCols = $derived(data?.sampleCols ?? []);
  const warnings = $derived(importWarnings());
  const importing = $derived(rnaseq.importPhase === "running");

  async function pickFile(): Promise<void> {
    const picked = await pickOpenFile({
      title: t("rnaseq.chooseFile"),
      filters: [{ name: t("rnaseq.countsFile"), extensions: ["csv", "tsv", "txt", "xlsx"] }],
    });
    if (!picked) return;
    try {
      await importCounts(picked);
    } catch (err) {
      pushToast("error", t("rnaseq.importFailed", { detail: detailOf(err) }));
    }
  }

  async function chooseFormat(id: (typeof MATRIX_FORMATS)[number]["id"]): Promise<void> {
    rnaseq.matrixFormat = id;
    if (rnaseq.importSourcePath) {
      try {
        await importCounts(rnaseq.importSourcePath, id);
      } catch (err) {
        pushToast("error", t("rnaseq.importFailed", { detail: detailOf(err) }));
      }
    }
  }

  function setSampleLabel(sample: string, value: string): void {
    updateConfig((draft) => {
      if (value) draft.sample_labels[sample] = value;
      else delete draft.sample_labels[sample];
    });
  }

  function setRunName(value: string): void {
    updateConfig((draft) => {
      draft.run_name = value;
    });
  }

  function detailOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<div class="flex flex-col gap-3">
  <!-- ── Counts data file ─────────────────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconFileImport size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-callout font-semibold">{t("rnaseq.countsFile")}</span>
      {#if rnaseq.importPhase !== "idle"}
        <span
          class="mynx-badge ml-auto {rnaseq.importPhase === 'running'
            ? 'mynx-badge-running'
            : rnaseq.importPhase === 'success'
              ? 'mynx-badge-success'
              : 'mynx-badge-error'}"
        >
          {rnaseq.importPhase === "running"
            ? t("status.running")
            : rnaseq.importPhase === "success"
              ? t("status.succeeded")
              : t("status.failed")}
        </span>
      {/if}
    </div>
    <div class="flex flex-col gap-3 p-3">
      {#if !data}
        <button
          type="button"
          class="flex min-h-[120px] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed p-4 text-center {rnaseq.dragOver
            ? 'border-accent bg-accent/10'
            : 'border-border hover:border-accent/50'}"
          onclick={() => void pickFile()}
        >
          <IconTable size={26} stroke={1.5} aria-hidden="true" />
          <span class="text-body font-medium">{t("rnaseq.dropCounts")}</span>
          <span class="text-footnote text-text-secondary">{t("rnaseq.dropCountsHint")}</span>
          <span class="text-footnote text-warning">{t("rnaseq.rawCountsHint")}</span>
        </button>
      {:else}
        <div class="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-2">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent"
          >
            <IconTable size={18} stroke={1.75} aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1">
            <span
              class="mynx-truncate block text-callout font-medium"
              title={rnaseq.importSourcePath}
            >
              {baseName(rnaseq.importSourcePath)}
            </span>
            <CopyableText text={rnaseq.importSourcePath} />
          </span>
          <button type="button" class="mynx-btn" onclick={() => void pickFile()}>
            {t("rnaseq.replaceFile")}
          </button>
        </div>
      {/if}

      <!-- matrix format presets -->
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup">
        {#each MATRIX_FORMATS as fmt (fmt.id)}
          <button
            type="button"
            role="radio"
            aria-checked={rnaseq.matrixFormat === fmt.id}
            class="flex flex-col items-start gap-0.5 rounded-md border p-2 text-left {rnaseq.matrixFormat ===
            fmt.id
              ? 'border-accent bg-accent/10'
              : 'border-border hover:border-text-secondary'}"
            onclick={() => void chooseFormat(fmt.id)}
          >
            <span class="text-callout font-medium">{t(fmt.labelKey)}</span>
            <span class="text-footnote text-text-secondary">{t(fmt.subKey)}</span>
          </button>
        {/each}
      </div>

      {#if data}
        <div class="flex flex-wrap items-center gap-2">
          <span class="mynx-chip">
            {t("rnaseq.genesRow")}: {data.totalGenes.toLocaleString()}
          </span>
          <span class="mynx-chip">{t("rnaseq.samplesCol")}: {sampleCols.length}</span>
          <span class="mynx-chip">{appliedFormatLabel()}</span>
          {#if data.converted}
            <span class="mynx-chip" title={cfg.data_file}>{t("rnaseq.normalizedCache")}</span>
          {/if}
        </div>
        <div class="flex flex-wrap gap-1">
          {#each sampleCols as sample (sample)}
            <span class="mynx-chip max-w-[180px]">
              <span class="mynx-truncate">{sample}</span>
              <span class="text-text-secondary">
                · {data.nonzeroCounts[sample] ?? 0}
              </span>
            </span>
          {/each}
        </div>
        {#if warnings.length > 0}
          <div class="flex flex-col gap-1" role="alert">
            {#each warnings as warning, i (i)}
              <p
                class="mynx-callout mynx-callout-warning rounded-md border border-warning/40 bg-warning/10 p-2 text-callout text-warning"
              >
                {warning}
              </p>
            {/each}
          </div>
        {/if}
      {/if}

      {#if rnaseq.importPhase === "error" && rnaseq.importMessage}
        <p
          class="rounded-md border border-danger/40 bg-danger/10 p-2 text-callout text-danger"
          role="alert"
        >
          {rnaseq.importMessage}
        </p>
      {/if}
    </div>
  </div>

  <!-- ── Sample display names ─────────────────────────────────────────── -->
  {#if sampleCols.length > 0}
    <div class="mynx-card flex flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconTag size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-callout font-semibold">{t("rnaseq.sampleLabels")}</span>
      </div>
      <div class="flex flex-col gap-2 p-3">
        <p class="text-footnote text-text-secondary">{t("rnaseq.sampleLabelsHint")}</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each sampleCols as sample (sample)}
            <label class="flex min-w-0 flex-col gap-1">
              <span class="mynx-truncate text-callout font-medium" title={sample}>
                {sample}
              </span>
              <input
                type="text"
                class="mynx-input"
                value={cfg.sample_labels[sample] ?? ""}
                placeholder={sample}
                aria-label={t("rnaseq.sampleLabelAria", { name: sample })}
                oninput={(event) => setSampleLabel(sample, event.currentTarget.value)}
              />
            </label>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- ── Output directory & run name ──────────────────────────────────── -->
  <div class="mynx-card flex flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <IconDatabase size={15} stroke={1.75} aria-hidden="true" />
      <span class="text-callout font-semibold">{t("rnaseq.outputSettings")}</span>
    </div>
    <div class="flex flex-col gap-3 p-3">
      <label class="flex min-w-0 flex-col gap-1">
        <span class="text-callout font-medium">{t("rnaseq.outputRoot")}</span>
        <div class="flex items-center gap-2">
          <input
            type="text"
            class="mynx-input min-w-0 flex-1"
            value={cfg.output_dir}
            readonly
            placeholder={t("rnaseq.outputRootPlaceholder")}
            aria-label={t("rnaseq.outputRoot")}
          />
          <button
            type="button"
            class="mynx-btn h-8 w-8 p-0"
            onclick={() => void pickOutputDir()}
            aria-label={t("rnaseq.chooseDir")}
            title={t("rnaseq.chooseDir")}
          >
            <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
          </button>
        </div>
      </label>
      <label class="flex min-w-0 flex-col gap-1">
        <span class="text-callout font-medium">{t("rnaseq.runName")}</span>
        <input
          type="text"
          class="mynx-input"
          value={cfg.run_name}
          placeholder="auto"
          aria-label={t("rnaseq.runName")}
          oninput={(event) => setRunName(event.currentTarget.value)}
        />
      </label>
      {#if cfg.output_dir}
        <button type="button" class="mynx-btn self-start" onclick={() => void openPath(cfg.output_dir)}>
          <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
          {t("common.openDir")}
        </button>
      {/if}
    </div>
  </div>

  <!-- ── Data preview ─────────────────────────────────────────────────── -->
  {#if data && data.previewColumns.length > 0}
    <div class="mynx-card flex flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconTable size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-callout font-semibold">{t("rnaseq.preview")}</span>
        <span class="mynx-badge mynx-badge-queued ml-auto">
          {t("rnaseq.previewCols", { count: data.previewColumns.length })}
        </span>
      </div>
      <div class="overflow-x-auto p-3">
        <table class="w-full text-left text-callout">
          <thead>
            <tr class="border-b border-border text-text-secondary">
              {#each data.previewColumns as column (column)}
                <th class="px-2 py-1 font-medium">{column}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.preview as row, i (i)}
              <tr class="border-b border-border/60 last:border-0">
                {#each data.previewColumns as column (column)}
                  <td class="px-2 py-1">{String(row[column] ?? "")}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  {#if importing}
    <p class="text-callout text-text-secondary" role="status">{t("rnaseq.importing")}</p>
  {/if}
</div>
