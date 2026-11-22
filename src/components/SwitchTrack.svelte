<script lang="ts">
  /**
   * Non-interactive switch visual, for rows where the whole row is the
   * switch control (e.g. RNA-seq figure cards). Same look as Switch.svelte.
   */
  let { checked }: { checked: boolean } = $props();
</script>

<span class="mynx-switch" data-checked={checked ? "true" : "false"} aria-hidden="true">
  <span class="mynx-switch-thumb"></span>
</span>
