<script lang="ts">
  import type { TaskKind } from "../lib/contracts/generated/task/TaskKind.js";
  import type { IconComponent } from "../lib/icons.js";
  import type { TaskRecord } from "../lib/contracts/generated/task/TaskRecord.js";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconFileSpreadsheet from "@tabler/icons-svelte/icons/file-spreadsheet";
  import IconDna2 from "@tabler/icons-svelte/icons/dna-2";
  import IconChartHistogram from "@tabler/icons-svelte/icons/chart-histogram";
  import IconDownload from "@tabler/icons-svelte/icons/download";
  import IconPackage from "@tabler/icons-svelte/icons/package";
  import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconX from "@tabler/icons-svelte/icons/x";
  import { app, activeTaskCount, pushToast } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import * as client from "../app/tauri.js";
  import StateBadge from "./StateBadge.svelte";
  import EmptyState from "./EmptyState.svelte";

  const KIND_ICONS: Record<TaskKind, IconComponent> = {
    imageConvert: IconPhoto,
    qpcrPlot: IconChartBar,
    qpcrExcel: IconFileSpreadsheet,
    rnaseqRun: IconDna2,
    chartRun: IconChartHistogram,
    rInstall: IconDownload,
    rDependencyCheck: IconPackage,
  };

  function openOutput(task: TaskRecord): void {
    if (!task.outputDir) return;
    void client
      .openPath(task.outputDir)
      .then((opened) => {
        if (!opened) pushOpenError(task.outputDir ?? "");
      })
      .catch(() => pushOpenError(task.outputDir ?? ""));
  }

  function pushOpenError(path: string): void {
    pushToast("error", t("task.openDirFailed", { detail: path }));
  }

  function cancelTask(task: TaskRecord): void {
    void client
      .tasksCancel(task.id)
      .then((cancelled) => {
        if (!cancelled) {
          pushToast("error", t("task.cancelFailed", { detail: task.label }));
        }
      })
      .catch(() => {
        pushToast("error", t("task.cancelFailed", { detail: task.label }));
      });
  }
</script>

<aside
  class="fixed inset-x-0 bottom-0 z-30 flex h-[280px] flex-col border-t border-border bg-surface transition-transform duration-200 {app.taskDrawerOpen
    ? 'translate-y-0'
    : 'pointer-events-none translate-y-full'}"
  aria-label={t("task.center")}
  aria-hidden={!app.taskDrawerOpen}
>
  <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
    <p class="flex-1 text-[13px] font-semibold">{t("task.center")}</p>
    {#if activeTaskCount() > 0}
      <span class="mynx-badge mynx-badge-running">
        {activeTaskCount()}
      </span>
    {/if}
    <button
      type="button"
      class="mynx-btn !h-7 !w-7 !p-0"
      onclick={() => (app.taskDrawerOpen = false)}
      aria-label={t("common.close")}
      title={t("common.close")}
    >
      <IconChevronDown size={15} stroke={1.6} />
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if app.tasks.length === 0}
      <EmptyState
        title={t("task.empty")}
        hint={t("task.emptyHint")}
        icon={IconFolderOpen}
      />
    {:else}
      <ul class="flex flex-col divide-y divide-border">
        {#each app.tasks as task (task.id)}
          {@const KindIcon = KIND_ICONS[task.kind]}
          <li class="flex flex-col gap-1 px-3 py-2">
            <div class="flex items-center gap-2">
              <KindIcon size={16} stroke={1.6} class="shrink-0 text-text-secondary" />
              <span class="mynx-truncate flex-1" title={task.label}>{task.label}</span>
              <StateBadge status={task.status} />
              {#if task.outputDir}
                <button
                  type="button"
                  class="mynx-btn !h-7 !w-7 !p-0 shrink-0"
                  onclick={() => openOutput(task)}
                  aria-label={t("task.openOutput")}
                  title={t("task.openOutput")}
                >
                  <IconFolderOpen size={14} stroke={1.6} />
                </button>
              {/if}
              {#if task.status === "running" || task.status === "queued"}
                <button
                  type="button"
                  class="mynx-btn mynx-btn-danger !h-7 shrink-0"
                  onclick={() => cancelTask(task)}
                  aria-label={t("task.cancel")}
                  title={t("task.cancel")}
                >
                  <IconX size={13} stroke={1.8} />
                  <span class="px-1">{t("common.cancel")}</span>
                </button>
              {/if}
            </div>
            {#if task.progress !== null}
              <div class="flex items-center gap-2">
                <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    class="h-full rounded-full bg-accent"
                    style={`width: ${Math.round(Math.min(Math.max(task.progress, 0), 1) * 100)}%`}
                  ></div>
                </div>
                <span class="mynx-mono shrink-0 text-text-secondary">
                  {Math.round(task.progress * 100)}%
                </span>
              </div>
            {/if}
            {#if task.error}
              <p class="mynx-truncate text-[12px] text-danger" title={task.error}>
                {task.error}
              </p>
            {:else if task.detail}
              <p class="mynx-truncate text-[12px] text-text-secondary" title={task.detail}>
                {task.detail}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</aside>
