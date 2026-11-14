<script lang="ts">
  import IconDna2 from "@tabler/icons-svelte/icons/dna-2";
  import { t } from "../../app/i18n.svelte";
  import { navigate } from "../../lib/router.svelte";
  import EmptyState from "../../components/EmptyState.svelte";
</script>

<section class="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
  <header class="flex flex-col gap-1">
    <h1 class="text-[16px] font-semibold">{t("rnaseq.title")}</h1>
    <p class="text-[12px] text-text-secondary">{t("rnaseq.subtitle")}</p>
  </header>

  <div class="mynx-card">
    <EmptyState
      title={t("tool.rnaseq.title")}
      hint={t("empty.migrating")}
      icon={IconDna2}
    >
      <button type="button" class="mynx-btn" onclick={() => navigate("/")}>
        {t("empty.backHome")}
      </button>
    </EmptyState>
  </div>
</section>
