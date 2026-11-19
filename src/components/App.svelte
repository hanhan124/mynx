<script lang="ts">
  import type { Component } from "svelte";
  import { onMount, tick } from "svelte";
  import { app } from "../app/state.svelte";
  import { bootstrap } from "../app/bootstrap.svelte";
  import { startRouter } from "../lib/router.svelte";
  import {
    currentChartNavigationId,
    recordChartNavigationStage,
  } from "../lib/chart-navigation-timings.js";
  import { t } from "../app/i18n.svelte";
  import TitleBar from "./TitleBar.svelte";
  import NavRail from "./NavRail.svelte";
  import TaskDrawer from "./TaskDrawer.svelte";
  import ToastStack from "./ToastStack.svelte";
  import HelpModal from "./HelpModal.svelte";
  import AboutModal from "./AboutModal.svelte";
  import UpdateBanner from "./UpdateBanner.svelte";
  type PageModule = { default: Component };
  const pageLoaders: Record<string, () => Promise<PageModule>> = {
    "/": () => import("../features/home/HomePage.svelte"),
    "/settings": () => import("../features/settings/SettingsPage.svelte"),
    "/image": () => import("../features/image/ImagePage.svelte"),
    "/qpcr": () => import("../features/qpcr/QpcrPage.svelte"),
    "/rnaseq": () => import("../features/rnaseq/RnaSeqPage.svelte"),
    "/charts": () => import("../features/charts/ChartsPage.svelte"),
  };

  let activePage = $state<Component | null>(null);
  let chartsPage = $state<Component | null>(null);
  let loadedRoute = $state<string | null>(null);
  let pageLoadFailed = $state(false);
  let retrySequence = $state(0);

  $effect(() => {
    const route = app.route;
    const retry = retrySequence;
    void retry;
    if (!app.ready) return;
    pageLoadFailed = false;
    if (route === "/charts" && chartsPage) {
      const sampleId = currentChartNavigationId();
      recordChartNavigationStage(sampleId, "moduleReady", "cached");
      let current = true;
      void tick()
        .then(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            }),
        )
        .then(() => {
          if (
            current &&
            app.route === "/charts" &&
            currentChartNavigationId() === sampleId
          ) {
            recordChartNavigationStage(sampleId, "visibleFrame");
          }
        });
      return () => {
        current = false;
      };
    }

    let current = true;
    const load = pageLoaders[route] ?? pageLoaders["/charts"];
    void load()
      .then((module) => {
        if (!current) return;
        if (route === "/charts") {
          chartsPage = module.default;
          recordChartNavigationStage(currentChartNavigationId(), "moduleReady", "loaded");
        } else {
          activePage = module.default;
          loadedRoute = route;
        }
      })
      .catch(() => {
        if (current) {
          if (route === "/charts") {
            recordChartNavigationStage(currentChartNavigationId(), "moduleLoadError");
          }
          pageLoadFailed = true;
        }
      });

    return () => {
      current = false;
    };
  });

  function retryPageLoad(): void {
    retrySequence += 1;
  }

  onMount(() => {
    startRouter();
    void bootstrap();
  });
</script>

<div class="mynx-app-shell flex h-screen min-h-0 flex-col text-text">
  <TitleBar />
  <UpdateBanner />
  <div class="flex min-h-0 flex-1">
    <NavRail />
    <main class="min-w-0 flex-1 overflow-y-auto">
      {#if chartsPage}
        {@const CachedChartsPage = chartsPage}
        <div
          class="h-full min-h-0 {app.route === '/charts' ? '' : 'hidden'}"
          aria-hidden={app.route === "/charts" ? "false" : "true"}
          inert={app.route !== "/charts"}
        >
          <CachedChartsPage />
        </div>
      {/if}

      {#if !app.ready}
        <div class="flex h-full items-center justify-center text-text-secondary">
          <p>{t("common.loading")}</p>
        </div>
      {:else if pageLoadFailed}
        <div class="flex h-full flex-col items-center justify-center gap-3 text-text-secondary">
          <p>{t("app.pageLoadFailed")}</p>
          <button type="button" class="mynx-btn mynx-btn-ghost" onclick={retryPageLoad}>
            {t("common.retry")}
          </button>
        </div>
      {:else if app.route === "/charts"}
        {#if !chartsPage}
          <div class="flex h-full items-center justify-center text-text-secondary">
            <p>{t("common.loading")}</p>
          </div>
        {/if}
      {:else if activePage && loadedRoute === app.route}
        {@const Page = activePage}
        <Page />
      {:else}
        <div class="flex h-full items-center justify-center text-text-secondary">
          <p>{t("common.loading")}</p>
        </div>
      {/if}
    </main>
  </div>
  <TaskDrawer />
</div>

<ToastStack />
<HelpModal />
<AboutModal />
