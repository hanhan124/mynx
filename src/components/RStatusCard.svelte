<script lang="ts">
  import type { RScriptStatus } from "../lib/contracts/generated/r/RScriptStatus.js";
  import IconRefresh from "@tabler/icons-svelte/icons/refresh";
  import { t } from "../app/i18n.svelte";
  import { pushToast } from "../app/state.svelte";
  import * as client from "../app/tauri.js";
  import CopyableText from "./CopyableText.svelte";

  let rStatus = $state<RScriptStatus | null>(null);
  let loading = $state(false);

  const found = $derived(rStatus?.found ?? false);
  const rscriptPath = $derived(rStatus?.rscript ?? "");

  function refresh(): void {
    loading = true;
    client
      .rStatus()
      .then((status) => {
        rStatus = status;
      })
      .catch((err: unknown) => {
        const detail =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        pushToast("error", t("home.rCheckFailed", { detail }));
      })
      .finally(() => {
        loading = false;
      });
  }

  // Initial load; parent cards also trigger refresh via the button.
  refresh();

  const title = $derived(t("home.rEnvironment"));
</script>

<section class="mynx-card p-4" aria-label={title}>
  <div class="flex items-center gap-2">
    <h2 class="mynx-section-title flex-1">{title}</h2>
    <button
      type="button"
      class="mynx-btn h-7 w-7 p-0"
      onclick={refresh}
      disabled={loading}
      aria-label={t("common.refresh")}
      title={t("common.refresh")}
    >
      <IconRefresh size={14} stroke={1.6} />
    </button>
  </div>

  <div class="mt-2 flex items-center gap-2">
    {#if loading}
      <span class="mynx-badge mynx-badge-queued">{t("common.loading")}</span>
    {:else if found}
      <span class="mynx-badge mynx-badge-success">{t("home.rFound")}</span>
    {:else}
      <span class="mynx-badge mynx-badge-error">{t("home.rMissing")}</span>
    {/if}
  </div>

  {#if found && rscriptPath}
    <div class="mt-2 flex items-center gap-2 text-[12px] text-text-secondary">
      <span class="shrink-0">{t("home.rPath")}</span>
      <div class="min-w-0 flex-1">
        <CopyableText text={rscriptPath} />
      </div>
    </div>
  {:else if !loading && !found}
    <p class="mt-2 text-[12px] text-text-secondary">{t("home.rMissingHint")}</p>
  {/if}
</section>
