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
  class="flex w-14 shrink-0 flex-col items-stretch border-r border-border bg-surface py-2"
  aria-label={t("nav.primary")}
>
  {#each items as item (item.route)}
    {@const active = app.route === item.route}
    {@const label = t(item.key)}
    {@const Icon = item.icon}
    <button
      type="button"
      class="relative flex h-11 items-center justify-center {active
        ? 'bg-accent/10 text-accent'
        : 'text-text-secondary hover:bg-surface-2 hover:text-text'}"
      onpointerenter={() => warmRoute(item.route)}
      onfocus={() => warmRoute(item.route)}
      onclick={() => navigate(item.route)}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      {#if active}
        <span
          class="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-accent"
          aria-hidden="true"
        ></span>
      {/if}
      <Icon size={20} stroke={1.6} />
      {#if active}
        <IconCheck
          size={12}
          stroke={2.2}
          class="absolute right-1 bottom-1 text-accent"
          aria-hidden="true"
        />
      {/if}
    </button>
  {/each}

  <div class="min-h-2 flex-1"></div>

  <button
    type="button"
    class="flex h-11 items-center justify-center text-text-secondary hover:bg-surface-2 hover:text-text"
    onclick={openWebsite}
    aria-label={websiteLabel}
    title={`${websiteLabel}: ${MYNX_WEBSITE_URL}`}
  >
    <IconExternalLink size={20} stroke={1.6} />
  </button>

  <button
    type="button"
    class="relative flex h-11 items-center justify-center {settingsActive
      ? 'bg-accent/10 text-accent'
      : 'text-text-secondary hover:bg-surface-2 hover:text-text'}"
    onclick={() => navigate("/settings")}
    aria-label={settingsLabel}
    aria-current={settingsActive ? "page" : undefined}
    title={settingsLabel}
  >
    {#if settingsActive}
      <span
        class="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-accent"
        aria-hidden="true"
      ></span>
    {/if}
    <IconSettingsCog size={20} stroke={1.6} />
    {#if settingsActive}
      <IconCheck
        size={12}
        stroke={2.2}
        class="absolute right-1 bottom-1 text-accent"
        aria-hidden="true"
      />
    {/if}
  </button>
</nav>
