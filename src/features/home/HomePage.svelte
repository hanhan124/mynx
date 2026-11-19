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
  import IconAlertTriangle from "@tabler/icons-svelte/icons/alert-triangle";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconExternalLink from "@tabler/icons-svelte/icons/external-link";
  import IconListCheck from "@tabler/icons-svelte/icons/list-check";
  import IconSearch from "@tabler/icons-svelte/icons/search";
  import { isSearchEngine, SEARCH_ENGINES, searchUrl, type SearchEngine } from "./search.js";
  import { patchSettings } from "../../app/state.svelte";
  import WeatherWidget from "./WeatherWidget.svelte";

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
  let searchEngine = $state<SearchEngine>("bing");
  let searchEngineTouched = false;

  client
    .settingsLoad()
    .then((settings) => {
      if (!searchEngineTouched && isSearchEngine(settings.searchEngine)) {
        searchEngine = settings.searchEngine;
      }
    })
    .catch(() => {});

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

  function chooseSearchEngine(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isSearchEngine(value)) return;
    searchEngineTouched = true;
    searchEngine = value;
    void patchSettings({ searchEngine: value });
  }

  function searchWeb(): void {
    const query = toolQuery.trim();
    if (!query) return;
    void client.openExternal(searchUrl(searchEngine, query)).catch(() => {
      pushToast("error", t("home.searchFailed"));
    });
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    searchWeb();
  }

  function warmTool(route: string): void {
    if (route === "/charts") {
      void import("../charts/ChartsPage.svelte").catch(() => {});
    }
  }

  function openProject(path: unknown): void {
    if (typeof path !== "string") return;
    client.openPath(path).catch(() => undefined);
  }

  function openOutput(path: unknown): void {
    if (typeof path !== "string") return;
    client.openPath(path).catch(() => undefined);
  }

  function pathLeaf(path: string): string {
    return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  }

  function pathParent(path: string): string {
    const normalized = path.replace(/[\\/]+$/, "");
    const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    return separator > 0 ? normalized.slice(0, separator) : normalized;
  }
</script>

<section class="mx-auto flex w-full max-w-[1280px] flex-col gap-7 p-4 sm:gap-8 sm:p-6">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="flex min-w-0 flex-col gap-1.5">
      <h1 class="text-[28px] leading-tight font-semibold sm:text-[32px]">{t("app.name")}</h1>
      <p class="text-[13px] text-text-secondary">{t("about.tagline")}</p>
    </div>
    <search class="flex min-w-0 flex-1 items-center gap-2 md:max-w-[620px]" aria-label={t("home.searchTools")}>
      <label class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 focus-within:border-accent">
        <IconSearch size={16} stroke={1.7} class="shrink-0 text-text-secondary" />
        <input
          type="search"
          class="w-full bg-transparent text-[13px] outline-none"
          placeholder={t("home.searchTools")}
          bind:value={toolQuery}
          aria-label={t("home.searchTools")}
          aria-describedby="home-search-hint"
          title={t("home.searchHint")}
          onkeydown={handleSearchKeydown}
          autocorrect="off"
          autocapitalize="none"
          spellcheck={false}
        />
      </label>
      <select
        class="min-h-10 w-[132px] shrink-0 cursor-pointer rounded-lg border border-border bg-surface px-2 text-[12px] text-text-secondary focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent"
        value={searchEngine}
        onchange={chooseSearchEngine}
        aria-label={t("home.searchEngine")}
      >
        {#each SEARCH_ENGINES as engine (engine.id)}
          <option value={engine.id}>{engine.label}</option>
        {/each}
      </select>
      <span id="home-search-hint" class="sr-only">{t("home.searchHint")}</span>
    </search>
  </header>

  <WeatherWidget />

  <section class="flex flex-col gap-3" aria-label={t("home.toolsHeading")}>
    <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div class="min-w-0">
        <h2 class="text-[16px] font-semibold">{t("home.toolsHeading")}</h2>
        <p class="mt-1 text-[12px] text-text-secondary">{t("home.toolsHint")}</p>
      </div>
    </div>

    {#if visibleTools.length === 0}
      <EmptyState title={t("home.noMatch", { query: toolQuery })} hint={t("home.toolsHint")} icon={IconSearch} />
    {:else}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {#each visibleTools as tool (tool.route)}
          {@const ToolIcon = tool.icon}
          <button
            type="button"
            class="mynx-card group flex min-h-[96px] items-center gap-3 p-3 text-left transition-colors hover:border-accent/60 focus-visible:border-accent sm:gap-4 sm:p-4"
            onpointerenter={() => warmTool(tool.route)}
            onfocus={() => warmTool(tool.route)}
            onclick={() => openTool(tool.route)}
            aria-label={`${t(tool.titleKey)} — ${t("home.openTool")}`}
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-accent transition-colors group-hover:border-accent/40 group-hover:bg-accent/10 sm:h-11 sm:w-11">
              <ToolIcon size={20} stroke={1.7} />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[14px] font-semibold">{t(tool.titleKey)}</span>
              <span class="mt-1 block text-[12px] leading-relaxed text-text-secondary">
                {t(tool.descKey)}
              </span>
            </span>
            <IconChevronRight size={17} stroke={1.7} class="shrink-0 text-text-secondary transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
          </button>
        {/each}
      </div>
    {/if}
  </section>

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

  <RStatusCard />

  <section class="mynx-card min-w-0 overflow-hidden" aria-label={t("home.recentActivity")}>
    <header class="flex items-center gap-2.5 border-b border-border px-4 py-3 sm:px-5">
      <span class="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">
        <IconListCheck size={17} stroke={1.7} aria-hidden="true" />
      </span>
      <h2 class="text-[14px] font-semibold">{t("home.recentActivity")}</h2>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-3 md:divide-x md:divide-border">
      <section class="min-w-0 px-4 py-4 sm:px-5" aria-label={t("home.recentTasks")}>
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-[12px] font-semibold text-text-secondary">{t("home.recentTasks")}</h3>
          {#if recentTasks !== null}<span class="font-mono text-[10px] text-text-secondary">{String(Math.min(recentTasks.length, 4)).padStart(2, "0")}</span>{/if}
        </div>
        {#if recentTasks === null}
          <p class="mt-3 text-[12px] text-text-secondary">{t("common.loading")}</p>
        {:else if recentTasks.length === 0}
          <p class="mt-3 text-[12px] text-text-secondary">{t("task.empty")}</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-1">
            {#each recentTasks.slice(0, 4) as task (task.id)}
              <li class="flex min-h-11 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-surface-2">
                <span class="min-w-0 flex-1">
                  <span class="mynx-truncate block text-[12px] font-medium" title={task.label}>{task.label}</span>
                  <span class="mt-0.5 block font-mono text-[10px] text-text-secondary">
                    {new Date(task.createdAtMs).toLocaleString(undefined, {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
                <StateBadge status={task.status} />
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="min-w-0 border-t border-border px-4 py-4 md:border-t-0 sm:px-5" aria-label={t("home.projects")}>
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-[12px] font-semibold text-text-secondary">{t("home.projects")}</h3>
          {#if recentProjects !== null}<span class="font-mono text-[10px] text-text-secondary">{String(Math.min(recentProjects.length, 4)).padStart(2, "0")}</span>{/if}
        </div>
        {#if recentProjects === null}
          <p class="mt-3 text-[12px] text-text-secondary">{t("common.loading")}</p>
        {:else if recentProjects.length === 0}
          <p class="mt-3 text-[12px] text-text-secondary">{t("home.noRecentItems")}</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-1">
            {#each recentProjects.slice(0, 4) as project, index (index)}
              {@const path = String(project.path ?? "")}
              <li class="group flex min-h-9 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-surface-2">
                <span class="min-w-0 flex-1">
                  <span class="mynx-truncate block text-[12px] font-medium" title={path}>{String(project.name ?? path)}</span>
                  <span class="mynx-truncate mt-0.5 block text-[10px] text-text-secondary">{String(project.kind ?? "")}</span>
                </span>
                <button
                  type="button"
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  onclick={() => openProject(project.path)}
                  aria-label={t("home.openProject", { path })}
                  title={t("common.openDir")}
                ><IconExternalLink size={15} stroke={1.7} aria-hidden="true" /></button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="min-w-0 border-t border-border px-4 py-4 md:border-t-0 sm:px-5" aria-label={t("home.recentOutputs")}>
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-[12px] font-semibold text-text-secondary">{t("home.recentOutputs")}</h3>
          {#if recentOutputs !== null}<span class="font-mono text-[10px] text-text-secondary">{String(Math.min(recentOutputs.length, 4)).padStart(2, "0")}</span>{/if}
        </div>
        {#if recentOutputs === null}
          <p class="mt-3 text-[12px] text-text-secondary">{t("common.loading")}</p>
        {:else if recentOutputs.length === 0}
          <p class="mt-3 text-[12px] text-text-secondary">{t("home.noRecentItems")}</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-1">
            {#each recentOutputs.slice(0, 4) as output, index (index)}
              {@const path = String(output.path ?? "")}
              <li class="group flex min-h-9 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-surface-2">
                <IconFolderOpen size={15} stroke={1.6} class="shrink-0 text-accent" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="mynx-truncate block text-[12px] font-medium" title={path}>{pathLeaf(path)}</span>
                  <span class="mynx-truncate mt-0.5 block font-mono text-[10px] text-text-secondary" title={path}>{pathParent(path)}</span>
                </span>
                <button
                  type="button"
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  onclick={() => openOutput(output.path)}
                  aria-label={t("home.openOutputDir", { path })}
                  title={t("common.openDir")}
                ><IconExternalLink size={15} stroke={1.7} aria-hidden="true" /></button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  </section>
</section>
