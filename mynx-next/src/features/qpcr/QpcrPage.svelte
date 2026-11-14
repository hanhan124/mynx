<script lang="ts">
  import IconChartBar from "@tabler/icons-svelte/icons/chart-bar";
  import { t } from "../../app/i18n.svelte";
  import { navigate } from "../../lib/router.svelte";
  import EmptyState from "../../components/EmptyState.svelte";
</script>

<section class="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
  <header class="flex flex-col gap-1">
    <h1 class="text-[16px] font-semibold">{t("qpcr.title")}</h1>
    <p class="text-[12px] text-text-secondary">{t("qpcr.subtitle")}</p>
  </header>

  <div class="mynx-card">
    <EmptyState
      title={t("tool.qpcr.title")}
      hint={t("empty.migrating")}
      icon={IconChartBar}
    >
      <button type="button" class="mynx-btn" onclick={() => navigate("/")}>
        {t("empty.backHome")}
      </button>
    </EmptyState>
  </div>
</section>
