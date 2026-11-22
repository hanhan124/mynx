<script lang="ts">
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconChartHistogram from "@tabler/icons-svelte/icons/chart-histogram";
  import IconDna2 from "@tabler/icons-svelte/icons/dna-2";
  import IconHome from "@tabler/icons-svelte/icons/home";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconSettingsCog from "@tabler/icons-svelte/icons/settings-cog";
  import IconDownload from "@tabler/icons-svelte/icons/download";
  import { save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { app } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import { pushToast } from "../app/state.svelte";
  import CopyableText from "./CopyableText.svelte";
  import { qpcrAnalysisTemplate } from "../features/qpcr/analysis-template.js";
  import { workerCreateImportTemplate, writeFileBytes } from "../features/qpcr/client.js";
  import { routeTitleKey } from "../lib/router.svelte";
  import Modal from "./Modal.svelte";

  type ManualKey = "home" | "image" | "qpcr" | "rnaseq" | "charts" | "settings";

  const pageIcons = {
    home: IconHome,
    image: IconPhoto,
    qpcr: IconChartBar,
    rnaseq: IconDna2,
    charts: IconChartHistogram,
    settings: IconSettingsCog,
  };

  const toolName = $derived(t(routeTitleKey(app.route)));

  const key = $derived.by((): ManualKey => {
    switch (app.route) {
      case "/image":
        return "image";
      case "/qpcr":
        return "qpcr";
      case "/rnaseq":
        return "rnaseq";
      case "/charts":
        return "charts";
      case "/settings":
        return "settings";
      default:
        return "home";
    }
  });

  const PageIcon = $derived(pageIcons[key]);
  const intro = $derived(t(`help.${key}.body`));
  const principle = $derived(t(`help.${key}.principle`).split("\n").filter((s) => s.trim()));
  const prepare = $derived(t(`help.${key}.prepare`).split("\n").filter((s) => s.trim()));
  const flow = $derived(t(`help.${key}.flow`).split("\n").filter((s) => s.trim()));
  const steps = $derived.by(() =>
    t(`help.${key}.steps`)
      .split("\n")
      .filter((s) => s.trim())
      .map((entry) => {
        const separator = entry.search(/[：:]/);
        return separator < 0
          ? { title: entry, detail: "" }
          : {
              title: entry.slice(0, separator).trim(),
              detail: entry.slice(separator + 1).trim(),
            };
      }),
  );
  const controls = $derived.by(() =>
    t(`help.${key}.buttons`)
      .split("\n")
      .filter((s) => s.trim())
      .map((entry) => {
        const separator = entry.search(/[：:]/);
        return separator < 0
          ? { name: t("help.manual.other"), detail: entry }
          : {
              name: entry.slice(0, separator).trim(),
              detail: entry.slice(separator + 1).trim(),
            };
      }),
  );
  const results = $derived(t(`help.${key}.results`).split("\n").filter((s) => s.trim()));
  const troubleshooting = $derived(
    t(`help.${key}.troubleshooting`).split("\n").filter((s) => s.trim()),
  );
  const qpcrTemplate = $derived(qpcrAnalysisTemplate(app.language));

  async function downloadQpcrTemplate(): Promise<void> {
    const path = await saveDialog({
      defaultPath: app.language === "zh" ? "qPCR实验分析记录模板.md" : "qPCR-analysis-record-template.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    await writeFileBytes(path, new TextEncoder().encode(qpcrTemplate).buffer);
    pushToast("success", t("qpcr.templateDownloaded"));
  }

  async function downloadQpcrImportTemplate(): Promise<void> {
    const path = await saveDialog({
      defaultPath: app.language === "zh" ? "qPCR原始数据导入模板.xlsx" : "qPCR-raw-data-import-template.xlsx",
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
    });
    if (!path) return;
    const { bytes } = await workerCreateImportTemplate();
    await writeFileBytes(path, bytes);
    pushToast("success", t("qpcr.importTemplateDownloaded"));
  }
</script>

<Modal bind:open={app.helpOpen} title={t("help.label")} description={intro} width={760}>
  <article class="help-layout mynx-help flex min-w-0 flex-col gap-5">
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="mynx-help-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-accent">
        <PageIcon size={18} stroke={1.7} aria-hidden="true" />
      </span>
      <h2 class="min-w-0 text-headline font-semibold">{toolName}</h2>
    </div>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-body font-semibold text-text">{t("help.manual.flow")}</h3>
      <ol class="help-flow" aria-label={t("help.manual.flow")}>
        {#each flow as stage, i (i)}
          <li class="help-flow-step">
            <span class="help-flow-marker" aria-hidden="true">{i + 1}</span>
            <span class="help-flow-label">{stage}</span>
          </li>
        {/each}
      </ol>
    </section>

    <div class="help-two-col min-w-0">
      <section class="min-w-0 border-s-2 border-accent/35 ps-3">
        <h3 class="mb-2 text-body font-semibold text-text">{t("help.manual.principle")}</h3>
        <ul class="flex flex-col gap-2">
          {#each principle as item, i (i)}
            <li class="text-body leading-relaxed text-text-secondary">{item}</li>
          {/each}
        </ul>
      </section>

      <section class="min-w-0 border-s-2 border-border ps-3">
        <h3 class="mb-2 text-body font-semibold text-text">{t("help.manual.prepare")}</h3>
        <ul class="flex flex-col gap-2">
          {#each prepare as item, i (i)}
            <li class="text-body leading-relaxed text-text-secondary">{item}</li>
          {/each}
        </ul>
      </section>
    </div>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-body font-semibold text-text">{t("help.manual.steps")}</h3>
      <ol class="flex flex-col divide-y divide-border">
        {#each steps as step, i (i)}
          <li class="flex min-w-0 gap-3 py-2.5 first:pt-1 last:pb-1">
            <span
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-callout font-semibold text-accent"
            >{i + 1}</span>
            <div class="min-w-0 flex-1">
              <p class="text-body font-medium leading-relaxed text-text">{step.title}</p>
              {#if step.detail}
                <p class="mt-0.5 text-body leading-relaxed text-text-secondary">{step.detail}</p>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-body font-semibold text-text">{t("help.manual.buttons")}</h3>
      <dl class="mynx-help-controls divide-y divide-border rounded-md border border-border">
        {#each controls as control, i (i)}
          <div class="help-control-row min-w-0 px-3 py-2.5">
            <dt class="min-w-0 text-callout font-semibold leading-relaxed text-text">{control.name}</dt>
            <dd class="min-w-0 text-body leading-relaxed text-text-secondary">{control.detail}</dd>
          </div>
        {/each}
      </dl>
    </section>

    <div class="help-two-col min-w-0">
      <section class="min-w-0 flex flex-col gap-1.5">
        <h3 class="text-body font-semibold text-text">{t("help.manual.results")}</h3>
        <ul class="flex flex-col gap-2">
          {#each results as item, i (i)}
            <li class="text-body leading-relaxed text-text-secondary">{item}</li>
          {/each}
        </ul>
      </section>

      <section class="min-w-0 flex flex-col gap-1.5">
        <h3 class="text-body font-semibold text-text">{t("help.manual.troubleshooting")}</h3>
        <ul class="flex flex-col gap-2">
          {#each troubleshooting as item, i (i)}
            <li class="text-body leading-relaxed text-text-secondary">{item}</li>
          {/each}
        </ul>
      </section>
    </div>

    {#if key === "qpcr"}
      <section class="flex min-w-0 flex-col gap-2 border-t border-border pt-4">
        <div>
          <h3 class="text-body font-semibold text-text">{t("qpcr.importTemplateTitle")}</h3>
          <p class="mt-1 text-callout leading-relaxed text-text-secondary">{t("qpcr.importTemplateHint")}</p>
        </div>
        <div class="mynx-help-table max-w-full overflow-auto rounded-md border border-border">
          <table class="w-full min-w-[360px] border-separate border-spacing-0 text-left text-callout">
            <caption class="sr-only">{t("qpcr.importTemplateTitle")}</caption>
            <thead class="bg-surface-2 text-text-secondary">
              <tr>
                <th scope="col" class="border-b border-r border-border px-3 py-2">Target</th>
                <th scope="col" class="border-b border-r border-border px-3 py-2">Sample</th>
                <th scope="col" class="border-b border-border px-3 py-2">Cq</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="border-b border-r border-border px-3 py-2">ReferenceGene</td><td class="border-b border-r border-border px-3 py-2">Control</td><td class="border-b border-border px-3 py-2">20.3</td></tr>
              <tr><td class="border-b border-r border-border px-3 py-2">TargetGene</td><td class="border-b border-r border-border px-3 py-2">Control</td><td class="border-b border-border px-3 py-2">25.1</td></tr>
              <tr><td class="border-b border-r border-border px-3 py-2">ReferenceGene</td><td class="border-b border-r border-border px-3 py-2">Treatment</td><td class="border-b border-border px-3 py-2">20.1</td></tr>
              <tr><td class="border-r border-border px-3 py-2">TargetGene</td><td class="border-r border-border px-3 py-2">Treatment</td><td class="px-3 py-2">22.4</td></tr>
            </tbody>
          </table>
        </div>
        <button type="button" class="mynx-btn self-start" onclick={() => void downloadQpcrImportTemplate()}>
          <IconDownload size={15} stroke={1.7} aria-hidden="true" />
          {t("qpcr.downloadImportTemplate")}
        </button>
      </section>

      <section class="flex min-w-0 flex-col gap-2 border-t border-border pt-4">
        <div>
          <h3 class="text-body font-semibold text-text">{t("qpcr.templateTitle")}</h3>
          <p class="mt-1 text-callout leading-relaxed text-text-secondary">{t("qpcr.templateHint")}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <CopyableText text={qpcrTemplate} label={t("qpcr.copyTemplate")} copyLabel={t("qpcr.copyTemplate")} />
          <button type="button" class="mynx-btn" onclick={() => void downloadQpcrTemplate()}>
            <IconDownload size={15} stroke={1.7} aria-hidden="true" />
            {t("qpcr.downloadTemplate")}
          </button>
        </div>
        <pre class="mynx-help-pre max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-footnote leading-relaxed text-text-secondary">{qpcrTemplate}</pre>
      </section>
    {/if}
  </article>
</Modal>

<style>
  .help-layout {
    container: help / inline-size;
  }

  .help-flow {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .help-flow-step {
    position: relative;
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    align-items: start;
    gap: 0.75rem;
    min-width: 0;
    padding-block: 0.375rem 1rem;
  }

  .help-flow-step:not(:last-child)::before {
    position: absolute;
    inset-block: 2.375rem 0;
    inset-inline-start: 0.9375rem;
    width: 1px;
    background: var(--color-border);
    content: "";
  }

  .help-flow-marker {
    position: relative;
    z-index: 1;
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border: 1px solid var(--color-accent);
    border-radius: 9999px;
    background: var(--color-surface);
    color: var(--color-accent);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
  }

  .help-flow-label {
    min-width: 0;
    padding-block-start: 0.375rem;
    color: var(--color-text);
    font-size: 13px;
    font-weight: 500;
    line-height: 1.5;
  }

  .help-two-col {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }

  .help-control-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.375rem;
  }

  @container help (inline-size >= 40rem) {
    .help-flow {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .help-flow-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.625rem;
      padding: 0 0.375rem;
      text-align: center;
    }

    .help-flow-step:not(:last-child)::before {
      inset-block-start: 1rem;
      inset-block-end: auto;
      inset-inline-start: calc(50% + 1rem);
      inset-inline-end: calc(-50% + 1rem);
      width: auto;
      height: 1px;
    }

    .help-flow-label {
      padding-block-start: 0;
    }

    .help-two-col {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .help-control-row {
      grid-template-columns: minmax(0, 0.34fr) minmax(0, 1fr);
      gap: 1rem;
    }
  }
  :global(html[data-ui-style]) .help-flow-marker {
    border: 0;
    background: var(--color-accent);
    color: var(--color-on-accent);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  :global(html[data-ui-style]) .help-flow-step:not(:last-child)::before {
    background: var(--color-separator);
  }
</style>
