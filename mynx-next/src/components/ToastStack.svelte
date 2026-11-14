<script lang="ts">
  import type { LogLevel } from "../lib/contracts/generated/task/LogLevel.js";
  import type { IconComponent } from "../lib/icons.js";
  import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
  import IconCircleCheck from "@tabler/icons-svelte/icons/circle-check";
  import IconAlertTriangle from "@tabler/icons-svelte/icons/alert-triangle";
  import IconAlertOctagon from "@tabler/icons-svelte/icons/alert-octagon";
  import IconX from "@tabler/icons-svelte/icons/x";
  import { app, dismissToast } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";

  interface LevelStyle {
    icon: IconComponent;
    border: string;
    text: string;
  }

  const LEVELS: Record<LogLevel, LevelStyle> = {
    info: { icon: IconInfoCircle, border: "border-accent", text: "text-accent" },
    success: { icon: IconCircleCheck, border: "border-success", text: "text-success" },
    warning: { icon: IconAlertTriangle, border: "border-warning", text: "text-warning" },
    error: { icon: IconAlertOctagon, border: "border-danger", text: "text-danger" },
  };
</script>

<div
  class="pointer-events-none fixed right-3 top-12 z-50 flex w-80 flex-col gap-2"
  role="region"
  aria-label={t("toast.dismiss")}
>
  {#each app.toasts as toast (toast.id)}
    {@const level = LEVELS[toast.level]}
    {@const LevelIcon = level.icon}
    <div
      class="pointer-events-auto mynx-card flex items-start gap-2 border-l-2 p-2.5 {level.border}"
      role="status"
    >
      <LevelIcon size={16} stroke={1.6} class="shrink-0 {level.text}" />
      <span class="min-w-0 flex-1 break-words text-[12px]">{toast.message}</span>
      <button
        type="button"
        class="shrink-0 text-text-secondary hover:text-text"
        onclick={() => dismissToast(toast.id)}
        aria-label={t("toast.dismiss")}
        title={t("toast.dismiss")}
      >
        <IconX size={14} stroke={1.6} />
      </button>
    </div>
  {/each}
</div>
