import { patchSettings } from "./state.svelte.js";

/** In-session widths for the application's resizable work-area columns. */
export const panelWidths = $state({
  navRail: 208,
  qpcrSidebar: 240,
  rnaseqSidebar: 260,
  imageFiles: 320,
  chartsCatalog: 280,
  chartsInspector: 340,
});
let navRailCustomized = $state(false);

const limits = {
  navRail: [64, 280],
  qpcrSidebar: [180, 480],
  rnaseqSidebar: [180, 480],
  imageFiles: [220, 620],
  chartsCatalog: [220, 520],
  chartsInspector: [240, 600],
} as const satisfies Record<keyof typeof panelWidths, readonly [number, number]>;

export function setPanelWidth(id: keyof typeof panelWidths, width: number): void {
  panelWidths[id] = Math.round(width);
  if (id === "navRail") navRailCustomized = true;
}

export function getNavRailWidth(maximized: boolean): number {
  return navRailCustomized ? panelWidths.navRail : maximized ? 208 : 72;
}

export function loadPanelWidths(saved: Record<string, number>): void {
  navRailCustomized = false;
  for (const id of Object.keys(limits) as (keyof typeof panelWidths)[]) {
    const width = saved[id];
    if (typeof width !== "number" || !Number.isFinite(width)) continue;
    const [min, max] = limits[id];
    panelWidths[id] = Math.min(max, Math.max(min, Math.round(width)));
    if (id === "navRail") navRailCustomized = true;
  }
}

export function savePanelWidths(): void {
  const savedWidths: Record<string, number> = { ...panelWidths };
  if (!navRailCustomized) delete savedWidths.navRail;
  void patchSettings({ panelWidths: savedWidths });
}
