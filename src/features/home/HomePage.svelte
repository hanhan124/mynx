<script lang="ts">
  import { onMount } from "svelte";
  import type { IconComponent } from "../../lib/icons.js";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconDna2 from "@tabler/icons-svelte/icons/dna-2";
  import IconChartHistogram from "@tabler/icons-svelte/icons/chart-histogram";
  import IconChevronRight from "@tabler/icons-svelte/icons/chevron-right";
  import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";
  import { t } from "../../app/i18n.svelte";
  import { pushToast } from "../../app/state.svelte";
  import { navigate } from "../../lib/router.svelte";
  import * as client from "../../app/tauri.js";
  import EmptyState from "../../components/EmptyState.svelte";
  import IconAlertTriangle from "@tabler/icons-svelte/icons/alert-triangle";
  import IconSearch from "@tabler/icons-svelte/icons/search";
  import { isSearchEngine, SEARCH_ENGINES, searchUrl, type SearchEngine } from "./search.js";
  import { patchSettings } from "../../app/state.svelte";
  import WeatherWidget from "./WeatherWidget.svelte";

  interface ToolCard {
    route: string;
    icon: IconComponent;
    titleKey: string;
    tile: string;
  }

  const tools: ToolCard[] = [
    { route: "/charts", icon: IconChartHistogram, titleKey: "tool.charts.title", tile: "mynx-tool-tile--charts" },
    { route: "/qpcr", icon: IconChartBar, titleKey: "tool.qpcr.title", tile: "mynx-tool-tile--qpcr" },
    { route: "/image", icon: IconPhoto, titleKey: "tool.image.title", tile: "mynx-tool-tile--image" },
    { route: "/rnaseq", icon: IconDna2, titleKey: "tool.rnaseq.title", tile: "mynx-tool-tile--rnaseq" },
  ];

  let recentFailures = $state<Record<string, unknown>[] | null>(null);
  let toolQuery = $state("");
  let searchEngine = $state<SearchEngine>("bing");
  let searchEngineTouched = false;
  let homeHeaderHeight = $state(192);
  let maxHomeHeaderHeight = $state(540);
  let homeHeaderTouched = false;
  let homeShell: HTMLElement | undefined;
  let activeResizePointerId: number | null = null;

  const MIN_HOME_HEADER_HEIGHT = 128;
  const HOME_DIVIDER_HEIGHT = 28;

  function clampHomeHeaderHeight(height: number): number {
    return Math.min(
      maxHomeHeaderHeight,
      Math.max(MIN_HOME_HEADER_HEIGHT, Math.round(height)),
    );
  }

  function resizeHomeHeader(height: number): void {
    homeHeaderTouched = true;
    homeHeaderHeight = clampHomeHeaderHeight(height);
  }

  function saveHomeHeaderHeight(): void {
    void patchSettings({ homeHeaderHeight });
  }

  function updateHomeHeaderFromPointer(event: PointerEvent): void {
    if (activeResizePointerId !== event.pointerId || !homeShell) return;
    const shellTop = homeShell.getBoundingClientRect().top;
    resizeHomeHeader(event.clientY - shellTop - HOME_DIVIDER_HEIGHT / 2);
  }

  function beginHomeHeaderResize(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || !homeShell) return;
    const separator = event.currentTarget;
    if (!(separator instanceof HTMLElement)) return;
    event.preventDefault();
    activeResizePointerId = event.pointerId;
    separator.setPointerCapture(event.pointerId);
    updateHomeHeaderFromPointer(event);
  }

  function finishHomeHeaderResize(event: PointerEvent): void {
    if (activeResizePointerId !== event.pointerId) return;
    activeResizePointerId = null;
    saveHomeHeaderHeight();
  }

  function handleHomeDividerKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      resizeHomeHeader(homeHeaderHeight - 12);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      resizeHomeHeader(homeHeaderHeight + 12);
    } else if (event.key === "Home") {
      event.preventDefault();
      resizeHomeHeader(MIN_HOME_HEADER_HEIGHT);
    } else if (event.key === "End") {
      event.preventDefault();
      resizeHomeHeader(maxHomeHeaderHeight);
    } else {
      return;
    }
    saveHomeHeaderHeight();
  }

  function syncHomeHeaderLimit(): void {
    const availableHeight = homeShell?.parentElement?.clientHeight ?? window.innerHeight;
    maxHomeHeaderHeight = Math.max(
      MIN_HOME_HEADER_HEIGHT,
      Math.round(availableHeight - 180),
    );
    if (homeHeaderHeight > maxHomeHeaderHeight) {
      homeHeaderHeight = maxHomeHeaderHeight;
    }
  }

  onMount(() => {
    syncHomeHeaderLimit();
    const scrollContainer = homeShell?.parentElement;
    if (!scrollContainer) {
      window.addEventListener("resize", syncHomeHeaderLimit);
      return () => window.removeEventListener("resize", syncHomeHeaderLimit);
    }
    const observer = new ResizeObserver(syncHomeHeaderLimit);
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  });

  client
    .settingsLoad()
    .then((settings) => {
      if (!searchEngineTouched && isSearchEngine(settings.searchEngine)) {
        searchEngine = settings.searchEngine;
      }
      if (
        !homeHeaderTouched &&
        Number.isFinite(settings.homeHeaderHeight) &&
        settings.homeHeaderHeight >= MIN_HOME_HEADER_HEIGHT
      ) {
        homeHeaderHeight = clampHomeHeaderHeight(settings.homeHeaderHeight);
      }
    })
    .catch(() => {});

  const visibleTools = $derived.by(() => {
    const q = toolQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (tool) =>
        t(tool.titleKey).toLowerCase().includes(q) ||
        tool.route.includes(q),
    );
  });

  function loadHomeData(): void {
    client
      .homeData()
      .then((data) => {
        recentFailures = (data.recentFailures ?? []) as Record<string, unknown>[];
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

</script>

<section bind:this={homeShell} class="mynx-home mx-auto flex w-full max-w-[1488px] flex-col px-3 pb-3 sm:px-4 lg:px-5">
  <header
    id="home-header"
    class="flex w-full shrink-0 flex-col items-center justify-center pt-[clamp(0.5rem,3dvh,1.5rem)]"
    style={`--mynx-home-header-height: ${homeHeaderHeight}px`}
  >
    <div class="flex items-center gap-2.5">
      <img src="/mynx.svg" alt="" aria-hidden="true" class="h-9 w-9 sm:h-10 sm:w-10" />
      <h1 class="text-[21px] leading-none font-bold tracking-tight sm:text-[24px]">{t("app.name")}</h1>
    </div>
    <div class="mynx-home-weather mt-2 min-h-5 text-center">
      <WeatherWidget />
    </div>

    <search class="mt-3 flex w-full max-w-[680px] items-center" aria-label={t("home.searchAria")}>
      <label class="mynx-home-search flex min-h-[38px] w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 sm:min-h-[42px] sm:gap-2.5 sm:px-3.5">
        <IconSearch size={18} stroke={1.7} class="shrink-0 text-text-secondary" aria-hidden="true" />
        <span class="mynx-home-engine-select relative flex h-8 w-5 shrink-0 items-center justify-center text-text-secondary">
          <IconChevronDown size={14} stroke={1.7} aria-hidden="true" />
          <select
            class="mynx-home-search-engine absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent text-[1px] text-transparent outline-none"
            value={searchEngine}
            onchange={chooseSearchEngine}
            aria-label={t("home.searchEngine")}
          >
            {#each SEARCH_ENGINES as engine (engine.id)}
              <option value={engine.id}>{engine.label}</option>
            {/each}
          </select>
        </span>
        <input
          type="search"
          class="min-w-0 flex-1 bg-transparent text-[12px] outline-none sm:text-[13px]"
          placeholder={t("home.searchPlaceholder")}
          bind:value={toolQuery}
          aria-label={t("home.searchAria")}
          aria-describedby="home-search-hint"
          title={t("home.searchHint")}
          onkeydown={handleSearchKeydown}
          autocorrect="off"
          autocapitalize="none"
          spellcheck={false}
        />
      </label>
      <span id="home-search-hint" class="sr-only">{t("home.searchHint")}</span>
    </search>
  </header>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="mynx-home-divider"
    role="separator"
    aria-label={t("home.resizeSections")}
    aria-orientation="horizontal"
    aria-controls="home-header"
    aria-valuemin={MIN_HOME_HEADER_HEIGHT}
    aria-valuemax={maxHomeHeaderHeight}
    aria-valuenow={homeHeaderHeight}
    tabindex="0"
    onpointerdown={beginHomeHeaderResize}
    onpointermove={updateHomeHeaderFromPointer}
    onpointerup={finishHomeHeaderResize}
    onpointercancel={finishHomeHeaderResize}
    onkeydown={handleHomeDividerKeydown}
  ></div>

  <section class="mt-4 flex flex-col gap-3 sm:mt-5" aria-label={t("home.toolsHeading")}>
    <h2 class="flex items-baseline gap-1 text-[16px] font-bold tracking-tight">
      <span class="mynx-home-tool-count text-[20px] leading-none tabular-nums">{tools.length}</span>
      <span class="text-[12px] font-semibold text-text-secondary">{t("home.tools")}</span>
    </h2>

    {#if visibleTools.length === 0}
      <EmptyState title={t("home.noMatch", { query: toolQuery })} icon={IconSearch} />
    {:else}
      <div class="mynx-home-grid grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5 lg:grid-cols-3">
        {#each visibleTools as tool (tool.route)}
          {@const ToolIcon = tool.icon}
          <button
            type="button"
            class="mynx-card mynx-home-tool group cursor-pointer flex min-h-[56px] items-center gap-2.5 p-2.5 text-left transition-colors hover:border-accent/60 focus-visible:border-accent sm:min-h-[64px] sm:gap-3 sm:p-3 lg:min-h-[68px]"
            onpointerenter={() => warmTool(tool.route)}
            onfocus={() => warmTool(tool.route)}
            onclick={() => openTool(tool.route)}
            aria-label={`${t(tool.titleKey)} — ${t("home.openTool")}`}
          >
            <span class="mynx-tool-tile {tool.tile}" aria-hidden="true">
              <ToolIcon size={25} stroke={1.9} />
            </span>
            <span class="mynx-truncate min-w-0 flex-1 text-[14px] font-bold">{t(tool.titleKey)}</span>
            <IconChevronRight size={15} stroke={2} class="shrink-0 text-text-secondary transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
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

</section>
