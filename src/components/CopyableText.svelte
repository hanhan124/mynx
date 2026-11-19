<script lang="ts">
  import IconCopy from "@tabler/icons-svelte/icons/copy";
  import { t } from "../app/i18n.svelte";
  import { pushToast } from "../app/state.svelte";

  let { text, label, copyLabel }: { text: string; label?: string; copyLabel?: string } = $props();

  const display = $derived(label ?? text);

  /** Clipboard API with a textarea fallback for restricted webview contexts. */
  async function copyText(value: string): Promise<boolean> {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // fall through to the legacy path
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function copy(): Promise<void> {
    const ok = await copyText(text);
    pushToast(ok ? "success" : "error", t(ok ? "copy.copied" : "copy.failed"));
  }
</script>

<span class="inline-flex min-w-0 max-w-full items-center gap-1">
  <span class="mynx-truncate" title={display}>{display}</span>
  <button
    class="mynx-link shrink-0"
    onclick={() => void copy()}
    aria-label={copyLabel ?? t("common.copy")}
    title={copyLabel ?? t("common.copy")}
    type="button"
  >
    <IconCopy size={14} stroke={1.6} />
  </button>
</span>
