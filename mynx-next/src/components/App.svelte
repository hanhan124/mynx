<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../app/state.svelte";
  import { bootstrap } from "../app/bootstrap.svelte";
  import { startRouter } from "../lib/router.svelte";
  import { t } from "../app/i18n.svelte";
  import TitleBar from "./TitleBar.svelte";
  import NavRail from "./NavRail.svelte";
  import TaskDrawer from "./TaskDrawer.svelte";
  import ToastStack from "./ToastStack.svelte";
  import HelpModal from "./HelpModal.svelte";
  import AboutModal from "./AboutModal.svelte";
  import UpdateBanner from "./UpdateBanner.svelte";
  import HomePage from "../features/home/HomePage.svelte";
  import SettingsPage from "../features/settings/SettingsPage.svelte";
  import ImagePage from "../features/image/ImagePage.svelte";
  import QpcrPage from "../features/qpcr/QpcrPage.svelte";
  import RnaSeqPage from "../features/rnaseq/RnaSeqPage.svelte";
  import ChartsPage from "../features/charts/ChartsPage.svelte";

  onMount(() => {
    startRouter();
    void bootstrap();
  });
</script>

<div class="flex h-screen min-h-0 flex-col bg-bg text-text">
  <TitleBar />
  <div class="flex min-h-0 flex-1">
    <NavRail />
    <main class="min-w-0 flex-1 overflow-y-auto bg-bg">
      {#if app.ready}
        {#if app.route === "/"}
          <HomePage />
        {:else if app.route === "/settings"}
          <SettingsPage />
        {:else if app.route === "/image"}
          <ImagePage />
        {:else if app.route === "/qpcr"}
          <QpcrPage />
        {:else if app.route === "/rnaseq"}
          <RnaSeqPage />
        {:else}
          <ChartsPage />
        {/if}
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
<UpdateBanner />
<HelpModal />
<AboutModal />
