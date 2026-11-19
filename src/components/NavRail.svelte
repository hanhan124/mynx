<script lang="ts">
  import type { IconComponent } from "../lib/icons.js";
  import IconHome from "@tabler/icons-svelte/icons/home";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import IconDna2 from "@tabler/icons-svelte/icons/dna-2";
  import IconChartHistogram from "@tabler/icons-svelte/icons/chart-histogram";
  import IconSettingsCog from "@tabler/icons-svelte/icons/settings-cog";
  import IconExternalLink from "@tabler/icons-svelte/icons/external-link";
  import IconCheck from "@tabler/icons-svelte/icons/check";
  import { app } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import { navigate } from "../lib/router.svelte";
  import * as client from "../app/tauri.js";
  import { MYNX_WEBSITE_URL } from "../app/tauri.js";

  interface NavItem {
    route: string;
    icon: IconComponent;
    key: string;
  }

  const items: NavItem[] = [
    { route: "/", icon: IconHome, key: "nav.home" },
    { route: "/image", icon: IconPhoto, key: "nav.image" },
    { route: "/qpcr", icon: IconChartBar, key: "nav.qpcr" },
    { route: "/rnaseq", icon: IconDna2, key: "nav.rnaseq" },
    { route: "/charts", icon: IconChartHistogram, key: "nav.charts" },
  ];

  const settingsActive = $derived(app.route === "/settings");
  const settingsLabel = $derived(t("nav.settings"));
  const websiteLabel = $derived(t("nav.website"));

  function openWebsite(): void {
    void client.openExternal(MYNX_WEBSITE_URL).catch(() => {});
  }

  function warmRoute(route: string): void {
    if (route === "/charts") {
      void import("../features/charts/ChartsPage.svelte").catch(() => {});
    }
  }
</script>

<nav
  class="mynx-navrail flex w-[208px] shrink-0 flex-col items-stretch gap-1 px-2.5 py-3 max-[1100px]:w-14 max-[1100px]:px-1.5 max-[1100px]:py-2"
  aria-label={t("nav.primary")}
>
  {#each items as item (item.route)}
    {@const active = app.route === item.route}
    {@const label = t(item.key)}
    {@const Icon = item.icon}
    <button
      type="button"
      class="mynx-nav-button relative flex min-h-10 w-full items-center justify-start gap-3 rounded-lg border border-transparent px-3 {active
        ? 'mynx-nav-button-active'
        : ''} max-[1100px]:mx-auto max-[1100px]:h-11 max-[1100px]:w-11 max-[1100px]:justify-center max-[1100px]:gap-0 max-[1100px]:px-0"
      onpointerenter={() => warmRoute(item.route)}
      onfocus={() => warmRoute(item.route)}
      onclick={() => navigate(item.route)}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      {#if active}
        <span
          class="mynx-nav-active-mark absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
          aria-hidden="true"
        ></span>
      {/if}
      <Icon size={20} stroke={1.9} />
      <span class="mynx-nav-label min-w-0 flex-1 truncate text-left text-[13px] max-[1100px]:hidden">{label}</span>
      {#if active}
        <IconCheck size={12} stroke={2.2} class="absolute right-1 bottom-1 text-accent max-[1100px]:block min-[1101px]:hidden" aria-hidden="true" />
      {/if}
    </button>
  {/each}

  <div class="min-h-2 flex-1"></div>

  <button
    type="button"
    class="mynx-nav-button flex min-h-10 w-full items-center justify-start gap-3 rounded-lg border border-transparent px-3 max-[1100px]:mx-auto max-[1100px]:h-11 max-[1100px]:w-11 max-[1100px]:justify-center max-[1100px]:gap-0 max-[1100px]:px-0"
    onclick={openWebsite}
    aria-label={websiteLabel}
    title={`${websiteLabel}: ${MYNX_WEBSITE_URL}`}
  >
    <IconExternalLink size={20} stroke={1.9} />
    <span class="mynx-nav-label min-w-0 flex-1 truncate text-left text-[13px] max-[1100px]:hidden">{websiteLabel}</span>
  </button>

  <button
    type="button"
    class="mynx-nav-button relative flex min-h-10 w-full items-center justify-start gap-3 rounded-lg border border-transparent px-3 {settingsActive
      ? 'mynx-nav-button-active'
      : ''} max-[1100px]:mx-auto max-[1100px]:h-11 max-[1100px]:w-11 max-[1100px]:justify-center max-[1100px]:gap-0 max-[1100px]:px-0"
    onclick={() => navigate("/settings")}
    aria-label={settingsLabel}
    aria-current={settingsActive ? "page" : undefined}
    title={settingsLabel}
  >
    {#if settingsActive}
      <span
        class="mynx-nav-active-mark absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
        aria-hidden="true"
      ></span>
    {/if}
    <IconSettingsCog size={20} stroke={1.9} />
    <span class="mynx-nav-label min-w-0 flex-1 truncate text-left text-[13px] max-[1100px]:hidden">{settingsLabel}</span>
    {#if settingsActive}
      <IconCheck size={12} stroke={2.2} class="absolute right-1 bottom-1 text-accent max-[1100px]:block min-[1101px]:hidden" aria-hidden="true" />
    {/if}
  </button>
</nav>
