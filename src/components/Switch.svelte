<script lang="ts">
  /**
   * Shared on/off switch (role="switch"). Visual only: callers own the
   * state and decide what `onchange` does, exactly as the inline switches
   * it replaces did. Styles: `.mynx-switch` in app.css (all UI styles),
   * re-voiced for macOS 27 in the macOS layer.
   */
  let {
    checked,
    label,
    onchange,
    disabled = false,
    title,
    class: className = "",
  }: {
    checked: boolean;
    label: string;
    /** Called with the requested next state when the user toggles. */
    onchange: (next: boolean) => void;
    disabled?: boolean;
    title?: string;
    class?: string;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  class="mynx-switch {className}"
  aria-checked={checked}
  aria-label={label}
  {title}
  {disabled}
  onclick={() => onchange(!checked)}
>
  <span class="mynx-switch-thumb" aria-hidden="true"></span>
</button>
