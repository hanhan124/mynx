<script lang="ts">
  import SwitchTrack from "./SwitchTrack.svelte";

  /**
   * A card whose whole surface is an on/off switch (title + hint + track),
   * e.g. RNA-seq figure picker. Same semantics as the inline markup it
   * replaces: role="switch", aria-checked, onchange(next).
   */
  let {
    checked,
    label,
    hint,
    onchange,
  }: {
    checked: boolean;
    label: string;
    hint: string;
    onchange: (next: boolean) => void;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="mynx-switch-card flex flex-col gap-1 rounded-md border p-2 text-left {checked
    ? 'border-accent bg-accent/10'
    : 'border-border hover:border-text-secondary'}"
  onclick={() => onchange(!checked)}
>
  <span class="flex items-center justify-between gap-2">
    <span class="text-callout font-medium">{label}</span>
    <SwitchTrack {checked} />
  </span>
  <span class="text-footnote text-text-secondary">{hint}</span>
</button>
