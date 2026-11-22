<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    invert?: boolean;
    alwaysVisible?: boolean;
    edgeStart?: boolean;
    onresize: (value: number) => void;
    oncommit: () => void;
  }

  let {
    label,
    value,
    min,
    max,
    invert = false,
    alwaysVisible = false,
    edgeStart = false,
    onresize,
    oncommit,
  }: Props = $props();
  let pointerId: number | null = null;
  let startX = 0;
  let startValue = 0;

  function clamp(next: number): number {
    return Math.min(max, Math.max(min, Math.round(next)));
  }

  function beginResize(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return;
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    event.preventDefault();
    pointerId = event.pointerId;
    startX = event.clientX;
    startValue = value;
    handle.setPointerCapture(event.pointerId);
  }

  function moveResize(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    onresize(clamp(startValue + (invert ? -1 : 1) * (event.clientX - startX)));
  }

  function endResize(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    // Pointer-driven drags must not leave the (focusable) track focused,
    // otherwise its accent focus line stays lit long after the drag.
    const handle = event.currentTarget;
    if (handle instanceof HTMLElement && handle.matches(":focus")) handle.blur();
    oncommit();
  }

  function handleKeydown(event: KeyboardEvent): void {
    let next: number | null = null;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      next = value + (invert ? 12 : -12);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next = value + (invert ? -12 : 12);
    } else if (event.key === "Home") {
      event.preventDefault();
      next = invert ? max : min;
    } else if (event.key === "End") {
      event.preventDefault();
      next = invert ? min : max;
    }
    if (next === null) return;
    onresize(clamp(next));
    oncommit();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="mynx-column-resizer {alwaysVisible ? 'mynx-column-resizer--always' : ''} {edgeStart
    ? 'mynx-column-resizer--edge-start'
    : ''}"
  role="separator"
  aria-label={label}
  aria-orientation="vertical"
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  tabindex="0"
  onpointerdown={beginResize}
  onpointermove={moveResize}
  onpointerup={endResize}
  onpointercancel={endResize}
  onkeydown={handleKeydown}
></div>
