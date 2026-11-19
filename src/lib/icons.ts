import { SvelteComponent, type ComponentType } from "svelte";

/**
 * Prop contract for the @tabler/icons-svelte components used as dynamic
 * values (per-kind task icons, nav items, empty states, toasts). The tabler
 * package still ships legacy class components, so this uses ComponentType.
 */
export type IconComponent = ComponentType<
  SvelteComponent<{
    size?: number | string;
    stroke?: number | string;
    class?: string;
  }>
>;
