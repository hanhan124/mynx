<script lang="ts">
  import type { Snippet } from "svelte";
  import type { IconComponent } from "../lib/icons.js";
  import IconInbox from "@tabler/icons-svelte/icons/inbox";

  let {
    title,
    hint,
    icon: Icon = IconInbox,
    children,
  }: {
    title: string;
    hint?: string;
    /** Icon component rendered above the title. */
    icon?: IconComponent;
    children?: Snippet;
  } = $props();
</script>

<div class="mynx-empty flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
  <Icon size={26} stroke={1.5} class="text-text-secondary" />
  <p class="text-body font-medium text-text">{title}</p>
  {#if hint}
    <p class="max-w-[360px] text-callout text-text-secondary">{hint}</p>
  {/if}
  {#if children}
    <div class="mt-2">{@render children()}</div>
  {/if}
</div>
