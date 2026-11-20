<script lang="ts">
  import { onMount } from "svelte";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import type { IconComponent } from "../lib/icons.js";
  import IconHome from "@tabler/icons-svelte/icons/home";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconDna2 from "@tabler/icons-svelte/icons/dna-2";
  import IconChartHistogram from "@tabler/icons-svelte/icons/chart-histogram";
  import IconSettingsCog from "@tabler/icons-svelte/icons/settings-cog";
  import { app } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import { navigate } from "../lib/router.svelte";
  import * as client from "../app/tauri.js";
  import { getNavRailWidth } from "../app/panel-widths.svelte";

  interface NavItem {
    route: string;
    icon: IconComponent;
    key: string;
  }

  const items: NavItem[] = [
    { route: "/", icon: IconHome, key: "nav.home" },
    { route: "/charts", icon: IconChartHistogram, key: "nav.charts" },
    { route: "/qpcr", icon: IconChartBar, key: "nav.qpcr" },
    { route: "/image", icon: IconPhoto, key: "nav.image" },
    { route: "/rnaseq", icon: IconDna2, key: "nav.rnaseq" },
  ];

  const settingsActive = $derived(app.route === "/settings");
  const settingsLabel = $derived(t("nav.settings"));
  let maximized = $state(false);
  const railWidth = $derived(getNavRailWidth(maximized));
  const expanded = $derived(railWidth >= 168);
  let unlisten: UnlistenFn | null = null;

  onMount(() => {
    void (async () => {
      try {
        maximized = await client.isMaximized();
      } catch {
        /* headless/test environment */
      }
      unlisten = await client.onWindowResized(() => {
        void client
          .isMaximized()
          .then((value) => (maximized = value))
          .catch(() => {});
      });
    })();
    return () => {
      unlisten?.();
    };
  });

  function warmRoute(route: string): void {
    if (route === "/charts") {
      void import("../features/charts/ChartsPage.svelte").catch(() => {});
    }
  }
</script>

<nav
  class="mynx-navrail flex shrink-0 flex-col gap-1.5 px-1.5 py-2 {expanded
    ? 'items-stretch'
    : 'items-center'}"
  style={`width: ${railWidth}px`}
  aria-label={t("nav.primary")}
>
  {#each items as item (item.route)}
    {@const active = app.route === item.route}
    {@const label = t(item.key)}
    {@const Icon = item.icon}
    <button
      type="button"
      class="mynx-nav-button cursor-pointer relative flex h-11 items-center rounded-(--mynx-radius-control) border border-transparent {expanded
        ? 'w-full justify-start gap-3 px-3'
        : 'w-11 justify-center'} {active
        ? 'mynx-nav-button-active'
        : ''}"
      onpointerenter={() => warmRoute(item.route)}
      onfocus={() => warmRoute(item.route)}
      onclick={() => navigate(item.route)}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      {#if active}
        <span class="mynx-nav-active-mark absolute left-0 top-2 bottom-2 w-[3px] rounded-full" aria-hidden="true"></span>
      {/if}
      <span class="shrink-0" aria-hidden="true"><Icon size={18} stroke={1.9} /></span>
      {#if expanded}
        <span class="mynx-nav-label min-w-0 flex-1 truncate text-left text-[13px]">{label}</span>
      {/if}
    </button>
  {/each}

  <div class="min-h-2 flex-1"></div>

  <div class="mynx-nav-utilities mt-2 flex w-full flex-col items-center gap-1 border-t border-nav-border pt-3">
    <button
      type="button"
      class="mynx-nav-button cursor-pointer relative flex h-11 items-center rounded-(--mynx-radius-control) border border-transparent {expanded
        ? 'w-full justify-start gap-3 px-3'
        : 'w-11 justify-center'} {settingsActive
        ? 'mynx-nav-button-active'
        : ''}"
      onclick={() => navigate("/settings")}
      aria-label={settingsLabel}
      aria-current={settingsActive ? "page" : undefined}
      title={settingsLabel}
    >
      {#if settingsActive}
        <span class="mynx-nav-active-mark absolute left-0 top-2 bottom-2 w-[3px] rounded-full" aria-hidden="true"></span>
      {/if}
      <IconSettingsCog size={18} stroke={1.9} aria-hidden="true" />
      {#if expanded}
        <span class="mynx-nav-label min-w-0 flex-1 truncate text-left text-[13px]">{settingsLabel}</span>
      {/if}
    </button>
  </div>
</nav>
