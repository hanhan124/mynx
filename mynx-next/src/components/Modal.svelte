<script lang="ts">
  import { Dialog } from "bits-ui";
  import type { Snippet } from "svelte";
  import IconX from "@tabler/icons-svelte/icons/x";
  import { t } from "../app/i18n.svelte";

  let {
    open = $bindable(false),
    title,
    description,
    children,
    width = 440,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    children?: Snippet;
    width?: number;
  } = $props();
</script>

<Dialog.Root bind:open>
  {#if open}
    <Dialog.Portal>
      <div class="fixed inset-0 z-40">
        <Dialog.Overlay class="fixed inset-0 bg-black/40" />
        <Dialog.Content
          class="mynx-card fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden"
          style="width: min({width}px, calc(100vw - 32px))"
        >
          <div class="flex items-start justify-between gap-2 px-4 pt-4">
            <Dialog.Title class="text-[14px] font-semibold text-text">{title}</Dialog.Title>
            <Dialog.Close
              class="mynx-btn !h-7 !w-7 !p-0"
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <IconX size={15} stroke={1.6} />
            </Dialog.Close>
          </div>
          {#if description}
            <Dialog.Description class="px-4 pt-1 text-[12px] text-text-secondary">
              {description}
            </Dialog.Description>
          {:else}
            <Dialog.Description class="sr-only">{title}</Dialog.Description>
          {/if}
          <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {@render children?.()}
          </div>
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  {/if}
</Dialog.Root>
