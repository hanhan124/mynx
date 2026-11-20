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
  import CommandPalette from "./CommandPalette.svelte";
  import { app, setAlwaysOnTopState } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import * as client from "../app/tauri.js";

  let maximized = $state(false);
  let unlisten: UnlistenFn | null = null;

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
</script>

<header
  class="mynx-titlebar flex h-12 shrink-0 select-none items-stretch text-text"
>
  <div
    class="flex min-w-0 flex-1 items-center gap-3 px-4"
    data-tauri-drag-region
  >
    <img src="/mynx.svg" alt="" class="h-7 w-7" data-tauri-drag-region />
    <span class="text-[15px] font-semibold tracking-tight" data-tauri-drag-region>Mynx</span>
  </div>

  <div class="flex shrink-0 items-stretch">
    {#if app.route !== "/"}
    <div class="flex items-center px-1.5 max-[520px]:px-1">
      <CommandPalette />
    </div>
    <button
      type="button"
      class="flex w-[46px] max-[520px]:w-11 items-center justify-center text-text-secondary hover:bg-surface-2 hover:text-text"
      onclick={() => (app.helpOpen = true)}
      aria-label={t("help.title")}
      title={t("help.title")}
    >
      <IconHelp size={16} stroke={1.6} />
    </button>
    <button
      type="button"
      class="relative flex w-[46px] max-[520px]:w-11 items-center justify-center text-text-secondary hover:bg-surface-2 hover:text-text"
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
          class="absolute right-[5px] top-[4px] min-w-[14px] rounded-full bg-accent px-[3px] text-center text-[10px] leading-[14px] mynx-on-accent"
        >
          {runningCount}
        </span>
      {/if}
    </button>
    {/if}

    <button
      type="button"
      class="flex w-[46px] max-[520px]:w-11 items-center justify-center text-text-secondary hover:bg-surface-2 hover:text-text {app.alwaysOnTop
        ? 'text-accent'
        : ''}"
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
    <span class="my-2 w-px bg-border" aria-hidden="true"></span>

    <button
      type="button"
      class="flex w-[46px] items-center justify-center text-text-secondary hover:bg-surface-2 hover:text-text"
      onclick={() => void client.minimizeWindow().catch(() => {})}
      aria-label={t("window.minimize")}
      title={t("window.minimize")}
    >
      <IconMinus size={16} stroke={1.6} />
    </button>

    <button
      type="button"
      class="flex w-[46px] items-center justify-center text-text-secondary hover:bg-surface-2 hover:text-text"
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
      class="flex w-[46px] items-center justify-center text-text-secondary hover:bg-danger hover:text-white"
      onclick={() => void client.closeWindow().catch(() => {})}
      aria-label={t("window.close")}
      title={t("window.close")}
    >
      <IconX size={16} stroke={1.6} />
    </button>
  </div>
</header>
