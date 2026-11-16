<script lang="ts">
  import { app } from "../app/state.svelte";
  import { t } from "../app/i18n.svelte";
  import { routeTitleKey } from "../lib/router.svelte";
  import Modal from "./Modal.svelte";

  type ManualKey = "home" | "image" | "qpcr" | "rnaseq" | "charts" | "settings";

  const toolName = $derived(t(routeTitleKey(app.route)));

  const key = $derived.by((): ManualKey => {
    switch (app.route) {
      case "/image":
        return "image";
      case "/qpcr":
        return "qpcr";
      case "/rnaseq":
        return "rnaseq";
      case "/charts":
        return "charts";
      case "/settings":
        return "settings";
      default:
        return "home";
    }
  });

  const intro = $derived(t(`help.${key}.body`));
  const steps = $derived(t(`help.${key}.steps`).split("\n").filter((s) => s.trim()));
  const buttons = $derived(
    t(`help.${key}.buttons`)
      .split("·")
      .map((s) => s.trim())
      .filter(Boolean),
  );
</script>

<Modal bind:open={app.helpOpen} title={t("help.label")} width={560}>
  <div class="flex flex-col gap-3">
    <p class="text-[13px] font-medium">{toolName} · {t("help.center.title")}</p>
    <p class="text-[12px] leading-relaxed text-text-secondary">{intro}</p>

    <div>
      <h3 class="mb-1.5 text-[12px] font-semibold text-text">{t("help.manual.steps")}</h3>
      <ol class="flex flex-col gap-1.5">
        {#each steps as step, i (i)}
          <li class="flex gap-2 text-[12px] leading-relaxed text-text-secondary">
            <span
              class="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border border-border text-[11px] font-semibold text-text"
            >{i + 1}</span>
            <span>{step}</span>
          </li>
        {/each}
      </ol>
    </div>

    <div>
      <h3 class="mb-1.5 text-[12px] font-semibold text-text">{t("help.manual.buttons")}</h3>
      <ul class="flex flex-col gap-1">
        {#each buttons as button (button)}
          <li class="text-[12px] leading-relaxed text-text-secondary">· {button}</li>
        {/each}
      </ul>
    </div>
  </div>
</Modal>
