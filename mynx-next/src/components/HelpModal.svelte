<script lang="ts">
  import { app } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import { routeTitleKey } from "../lib/router.svelte";
  import Modal from "./Modal.svelte";

  const toolName = $derived(t(routeTitleKey(app.route)));

  const body = $derived.by(() => {
    switch (app.route) {
      case "/":
        return { title: t("help.center.title"), lines: [t("help.center.intro"), t("help.center.note")] };
      case "/image":
        return { title: t("nav.image"), lines: [t("help.image.body")] };
      case "/qpcr":
        return { title: t("nav.qpcr"), lines: [t("help.qpcr.body")] };
      case "/rnaseq":
        return { title: t("nav.rnaseq"), lines: [t("help.rnaseq.body")] };
      case "/charts":
        return { title: t("nav.charts"), lines: [t("help.charts.body")] };
      case "/settings":
        return { title: t("nav.settings"), lines: [t("help.settings.body")] };
      default:
        return { title: t("help.center.title"), lines: [t("help.center.intro")] };
    }
  });
</script>

<Modal bind:open={app.helpOpen} title={t("help.label")} width={480}>
  <div class="flex flex-col gap-2">
    <p class="text-[13px] font-medium">{toolName} · {body.title}</p>
    {#each body.lines as line (line)}
      <p class="text-[12px] leading-relaxed text-text-secondary">{line}</p>
    {/each}
  </div>
</Modal>
