<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import IconHelp from "@tabler/icons-svelte/icons/help";
  import IconListCheck from "@tabler/icons-svelte/icons/list-check";
  import IconPinned from "@tabler/icons-svelte/icons/pinned";
  import IconPin from "@tabler/icons-svelte/icons/pin";
  import IconMinus from "@tabler/icons-svelte/icons/minus";
  import IconSquare from "@tabler/icons-svelte/icons/square";
  import IconCopy from "@tabler/icons-svelte/icons/copy";
  import IconX from "@tabler/icons-svelte/icons/x";
  import IconArrowsDiagonal from "@tabler/icons-svelte/icons/arrows-diagonal";
  import IconArrowsMinimize from "@tabler/icons-svelte/icons/arrows-minimize";
  import { platform } from "@tauri-apps/plugin-os";
  import CommandPalette from "./CommandPalette.svelte";
  import { app, setAlwaysOnTopState } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import * as client from "../app/tauri.js";

  let maximized = $state(false);
  let unlisten: UnlistenFn | null = null;
  let windowFocused = $state(true);

  // Window chrome follows the OS convention, independent of the visual style:
  // macOS renders traffic lights at the leading edge, Windows keeps the
  // caption button strip at the trailing edge. The UA check covers the first
  // paint and browser previews; the os plugin result corrects it afterwards.
  let chromeMac = $state(
    typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent),
  );

  const runningCount = $derived(
    app.tasks.filter(
      (task) => task.status === "running" || task.status === "queued",
    ).length,
  );

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

  function togglePin(): void {
    const previous = setAlwaysOnTopState(!app.alwaysOnTop);
    void client.setAlwaysOnTop(!previous).catch(() => {
      setAlwaysOnTopState(previous);
    });
  }

  async function toggleTasks(): Promise<void> {
    app.taskDrawerOpen = !app.taskDrawerOpen;
    if (app.taskDrawerOpen) {
      await tick();
      document.getElementById("mynx-task-close")?.focus();
    }
  }

  // macOS traffic lights dim while the window is unfocused (HIG).
  $effect(() => {
    const onFocus = () => (windowFocused = true);
    const onBlur = () => (windowFocused = false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  });

  $effect(() => {
    try {
      // plugin-os resolves synchronously inside Tauri; outside (browser
      // preview) it throws and the UA guess from first paint stays.
      chromeMac = platform() === "macos";
    } catch {
      /* plugin unavailable outside Tauri */
    }
  });

  // The window title names the current page (HIG: title reflects content).
  const ROUTE_TITLES: Record<string, string> = {
    "/chat": "nav.chat",
    "/charts": "nav.charts",
    "/qpcr": "nav.qpcr",
    "/image": "nav.image",
    "/rnaseq": "nav.rnaseq",
    "/settings": "nav.settings",
  };
  const windowTitle = $derived(
    ROUTE_TITLES[app.route] ? t(ROUTE_TITLES[app.route]) : "Mynx",
  );
  // Every UI style uses the macOS 27 toolbar: inset capsule tools and the
  // page title. Windows keeps its 46px caption buttons (see below).
  const toolBtnClass = "mynx-titlebar-btn mynx-titlebar-tool";
  const titleClass = "mynx-titlebar-title mynx-truncate";
</script>

<header
  class="mynx-titlebar flex h-12 shrink-0 select-none items-stretch text-text {chromeMac
    ? 'mynx-titlebar--mac'
    : ''}"
>
  {#if chromeMac}
    <!-- macOS traffic lights: close / minimize / zoom, glyphs on group hover,
         dimmed while the window is unfocused. -->
    <div
      class="mynx-traffic {windowFocused ? '' : 'mynx-traffic-inactive'}"
      data-tauri-drag-region
    >
      <button
        type="button"
        class="mynx-traffic-btn mynx-traffic-close"
        onclick={() => void client.closeWindow().catch(() => {})}
        aria-label={t("window.close")}
        title={t("window.close")}
      >
        <span class="mynx-traffic-glyph" aria-hidden="true"><IconX size={9} stroke={2.8} /></span>
      </button>
      <button
        type="button"
        class="mynx-traffic-btn mynx-traffic-min"
        onclick={() => void client.minimizeWindow().catch(() => {})}
        aria-label={t("window.minimize")}
        title={t("window.minimize")}
      >
        <span class="mynx-traffic-glyph" aria-hidden="true"><IconMinus size={10} stroke={2.8} /></span>
      </button>
      <button
        type="button"
        class="mynx-traffic-btn mynx-traffic-max"
        onclick={() => void client.toggleMaximizeWindow().catch(() => {})}
        aria-label={t("window.maximize")}
        title={t("window.maximize")}
      >
        <span class="mynx-traffic-glyph" aria-hidden="true">
          {#if maximized}
            <IconArrowsMinimize size={9} stroke={2.8} />
          {:else}
            <IconArrowsDiagonal size={8} stroke={2.8} />
          {/if}
        </span>
      </button>
    </div>
  {/if}

  <div
    class="flex min-w-0 flex-1 items-center gap-3 {chromeMac ? 'px-3' : 'px-4'}"
    data-tauri-drag-region
  >
    {#if !chromeMac}
      <img src="/mynx.svg" alt="" class="h-7 w-7" data-tauri-drag-region />
    {/if}
    <span class={titleClass} data-tauri-drag-region>{windowTitle}</span>
  </div>

  <div class="flex shrink-0 items-stretch">
    <div class="mynx-toolbar-group">
    {#if app.route !== "/"}
    <div class="flex items-center px-1.5 max-[520px]:px-1">
      <CommandPalette />
    </div>
    <button
      type="button"
      class={toolBtnClass}
      onclick={() => (app.helpOpen = true)}
      aria-label={t("help.title")}
      title={t("help.title")}
    >
      <IconHelp size={16} stroke={1.6} />
    </button>
    <button
      type="button"
      class="{toolBtnClass} relative"
      onclick={toggleTasks}
      aria-label={t("task.center")}
      id="mynx-task-trigger"
      aria-controls="mynx-task-drawer"
      aria-expanded={app.taskDrawerOpen}
      title={t("task.center")}
    >
      <IconListCheck size={16} stroke={1.6} />
      {#if runningCount > 0}
        <span
          class="absolute right-[5px] top-[4px] min-w-[14px] rounded-full bg-accent px-[3px] text-center text-caption2 leading-[14px] mynx-on-accent"
        >
          {runningCount}
        </span>
      {/if}
    </button>
    {/if}

    <button
      type="button"
      class="{toolBtnClass} {app.alwaysOnTop ? 'text-accent' : ''}"
      onclick={togglePin}
      aria-label={t("window.pin")}
      aria-pressed={app.alwaysOnTop}
      title={t("window.pin")}
    >
      {#if app.alwaysOnTop}
        <IconPinned size={16} stroke={1.6} />
      {:else}
        <IconPin size={16} stroke={1.6} />
      {/if}
    </button>
    </div>
    {#if !chromeMac}
      <span class="my-2 w-px bg-separator" aria-hidden="true"></span>

      <button
        type="button"
        class="mynx-titlebar-btn w-[46px]"
        onclick={() => void client.minimizeWindow().catch(() => {})}
        aria-label={t("window.minimize")}
        title={t("window.minimize")}
      >
        <IconMinus size={16} stroke={1.6} />
      </button>

      <button
        type="button"
        class="mynx-titlebar-btn w-[46px]"
        onclick={() => void client.toggleMaximizeWindow().catch(() => {})}
        aria-label={t("window.maximize")}
        title={t("window.maximize")}
      >
        {#if maximized}
          <IconCopy size={14} stroke={1.6} />
        {:else}
          <IconSquare size={13} stroke={1.6} />
        {/if}
      </button>

      <button
        type="button"
        class="mynx-titlebar-btn w-[46px] hover:bg-danger hover:text-on-accent"
        onclick={() => void client.closeWindow().catch(() => {})}
        aria-label={t("window.close")}
        title={t("window.close")}
      >
        <IconX size={16} stroke={1.6} />
      </button>
    {/if}
  </div>
</header>
