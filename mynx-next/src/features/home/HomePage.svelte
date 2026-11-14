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

  function loadRecentTasks(): void {
    client
      .tasksList()
      .then((tasks) => {
        recentTasks = tasks.slice(0, 5);
      })
      .catch((err: unknown) => {
        const detail =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        pushToast("error", t("home.tasksFailed", { detail }));
      });
  }

  loadRecentTasks();

  function openTool(route: string): void {
    navigate(route);
  }
</script>

<section class="mx-auto flex w-full max-w-[860px] flex-col gap-5 p-6">
  <header class="flex flex-col gap-1">
    <h1 class="text-[18px] font-semibold">{t("app.workbench")}</h1>
    <p class="text-[12px] text-text-secondary">{t("about.tagline")}</p>
  </header>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {#each tools as tool (tool.route)}
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
</section>
