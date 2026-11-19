<script lang="ts">
  import type { TaskStatus } from "../lib/contracts/generated/task/TaskStatus.js";
  import { t } from "../app/i18n.svelte";

  let { status }: { status: TaskStatus } = $props();

  const MODIFIER: Record<TaskStatus, string> = {
    queued: "mynx-badge-queued",
    running: "mynx-badge-running",
    succeeded: "mynx-badge-success",
    failed: "mynx-badge-error",
    cancelled: "mynx-badge-cancelled",
  };

  const modifier = $derived(MODIFIER[status]);
  const label = $derived(t(`status.${status}`));
</script>

<span class="mynx-badge {modifier}">{label}</span>
