<script lang="ts">
  import type { TaskRecord } from "../../lib/contracts/generated/task/TaskRecord.js";
  import type { IconComponent } from "../../lib/icons.js";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconDna2 from "@tabler/icons-svelte/icons/dna-2";
  import IconChartHistogram from "@tabler/icons-svelte/icons/chart-histogram";
  import IconChevronRight from "@tabler/icons-svelte/icons/chevron-right";
  import { t } from "../../app/i18n.svelte";
  import { pushToast } from "../../app/state.svelte";
  import { navigate } from "../../lib/router.svelte";
  import * as client from "../../app/tauri.js";
  import RStatusCard from "../../components/RStatusCard.svelte";
  import StateBadge from "../../components/StateBadge.svelte";
  import EmptyState from "../../components/EmptyState.svelte";
  import IconListCheck from "@tabler/icons-svelte/icons/list-check";
  import IconAlertTriangle from "@tabler/icons-svelte/icons/alert-triangle";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconSearch from "@tabler/icons-svelte/icons/search";

  interface ToolCard {
    route: string;
    icon: IconComponent;
    titleKey: string;
    descKey: string;
  }

  const tools: ToolCard[] = [
    { route: "/image", icon: IconPhoto, titleKey: "tool.image.title", descKey: "tool.image.description" },
    { route: "/qpcr", icon: IconChartBar, titleKey: "tool.qpcr.title", descKey: "tool.qpcr.description" },
    { route: "/rnaseq", icon: IconDna2, titleKey: "tool.rnaseq.title", descKey: "tool.rnaseq.description" },
    { route: "/charts", icon: IconChartHistogram, titleKey: "tool.charts.title", descKey: "tool.charts.description" },
  ];

  let recentTasks = $state<TaskRecord[] | null>(null);
  let recentFailures = $state<Record<string, unknown>[] | null>(null);
  let recentProjects = $state<Record<string, unknown>[] | null>(null);
  let recentOutputs = $state<Record<string, unknown>[] | null>(null);
  let toolQuery = $state("");

  const visibleTools = $derived.by(() => {
    const q = toolQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (tool) =>
        t(tool.titleKey).toLowerCase().includes(q) ||
        t(tool.descKey).toLowerCase().includes(q) ||
        tool.route.includes(q),
    );
  });

  function loadHomeData(): void {
    client
      .homeData()
      .then((data) => {
        recentTasks = ((data.recentTasks ?? []) as TaskRecord[]).slice(0, 5);
        recentFailures = (data.recentFailures ?? []) as Record<string, unknown>[];
        recentProjects = (data.recentProjects ?? []) as Record<string, unknown>[];
        recentOutputs = (data.recentOutputs ?? []) as Record<string, unknown>[];
      })
      .catch((err: unknown) => {
        const detail =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        pushToast("error", t("home.tasksFailed", { detail }));
      });
  }

  loadHomeData();

  function openTool(route: string): void {
    navigate(route);
  }

  function openProject(path: unknown): void {
    if (typeof path !== "string") return;
    client.openPath(path).catch(() => undefined);
  }

  function openOutput(path: unknown): void {
    if (typeof path !== "string") return;
    client.openPath(path).catch(() => undefined);
  }
</script>

<section class="mx-auto flex w-full max-w-[860px] flex-col gap-5 p-6">
  <header class="flex flex-col gap-1">
    <h1 class="text-[18px] font-semibold">{t("app.workbench")}</h1>
    <p class="text-[12px] text-text-secondary">{t("about.tagline")}</p>
  </header>

  <div class="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 focus-within:border-accent">
    <IconSearch size={15} stroke={1.6} class="shrink-0 text-text-secondary" />
    <input
      type="text"
      class="w-full bg-transparent text-[13px] outline-none"
      placeholder={t("home.searchTools")}
      bind:value={toolQuery}
      aria-label={t("home.searchTools")}
    />
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {#each visibleTools as tool (tool.route)}
      {@const ToolIcon = tool.icon}
      <button
        type="button"
        class="mynx-card flex items-start gap-3 p-4 text-left transition-colors hover:border-accent"
        onclick={() => openTool(tool.route)}
        aria-label={`${t(tool.titleKey)} — ${t("home.openTool")}`}
      >
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-accent">
          <ToolIcon size={18} stroke={1.6} />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[13px] font-semibold">{t(tool.titleKey)}</span>
          <span class="mt-0.5 block text-[12px] text-text-secondary">
            {t(tool.descKey)}
          </span>
        </span>
        <IconChevronRight size={16} stroke={1.6} class="mt-2 shrink-0 text-text-secondary" />
      </button>
    {/each}
  </div>

  <RStatusCard />

  {#if recentFailures !== null && recentFailures.length > 0}
    <section
      class="mynx-card border-danger/50 p-4"
      role="alert"
      aria-label={t("home.recentFailures")}
    >
      <h2 class="flex items-center gap-2 text-[13px] font-semibold text-danger">
        <IconAlertTriangle size={16} stroke={1.6} />
        {t("home.recentFailures")}
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border">
        {#each recentFailures as failure (String(failure.id ?? failure.label ?? ""))}
          <li class="flex items-start gap-2 py-2">
            <span class="mynx-truncate min-w-0 flex-1 text-[12px]" title={String(failure.label ?? "")}>
              {String(failure.label ?? "")}
            </span>
            <span
              class="mynx-truncate max-w-[45%] text-[11px] text-danger"
              title={String(failure.error ?? "")}
            >
              {String(failure.error ?? "")}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="mynx-card p-4" aria-label={t("home.recentTasks")}>
    <h2 class="text-[13px] font-semibold">{t("home.recentTasks")}</h2>
    {#if recentTasks === null}
      <p class="mt-2 text-[12px] text-text-secondary">{t("common.loading")}</p>
    {:else if recentTasks.length === 0}
      <EmptyState
        title={t("task.empty")}
        hint={t("task.emptyHint")}
        icon={IconListCheck}
      />
    {:else}
      <ul class="mt-2 flex flex-col divide-y divide-border">
        {#each recentTasks as task (task.id)}
          <li class="flex items-center gap-2 py-2">
            <span class="mynx-truncate min-w-0 flex-1 text-[12px]" title={task.label}>
              {task.label}
            </span>
            <StateBadge status={task.status} />
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if recentProjects !== null && recentProjects.length > 0}
    <section class="mynx-card p-4" aria-label={t("home.projects")}>
      <h2 class="text-[13px] font-semibold">{t("home.projects")}</h2>
      <ul class="mt-2 flex flex-col divide-y divide-border">
        {#each recentProjects as project, index (index)}
          <li class="flex items-center gap-2 py-2">
            <span class="mynx-truncate min-w-0 flex-1 font-mono text-[11px]" title={String(project.path ?? "")}>
              {String(project.name ?? project.path ?? "")}
            </span>
            <span class="text-[10px] uppercase text-text-secondary">{String(project.kind ?? "")}</span>
            <button
              type="button"
              class="mynx-btn px-2 py-1 text-[11px]"
              onclick={() => openProject(project.path)}
              aria-label={t("home.openProject", { path: String(project.path ?? "") })}
            >
              {t("common.openDir")}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recentOutputs !== null && recentOutputs.length > 0}
    <section class="mynx-card p-4" aria-label={t("home.recentOutputs")}>
      <h2 class="text-[13px] font-semibold">{t("home.recentOutputs")}</h2>
      <ul class="mt-2 flex flex-col divide-y divide-border">
        {#each recentOutputs as output, index (index)}
          <li class="flex items-center gap-2 py-2">
            <IconFolderOpen size={14} stroke={1.6} class="shrink-0 text-text-secondary" />
            <span class="mynx-truncate min-w-0 flex-1 font-mono text-[11px]" title={String(output.path ?? "")}>
              {String(output.path ?? "")}
            </span>
            <button
              type="button"
              class="mynx-btn px-2 py-1 text-[11px]"
              onclick={() => openOutput(output.path)}
              aria-label={t("home.openOutputDir", { path: String(output.path ?? "") })}
            >
              {t("common.openDir")}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</section>
