import { Channel } from "@tauri-apps/api/core";
import { call } from "../../app/tauri.js";
import type { ChartImportedData } from "../../lib/contracts/generated/charts/ChartImportedData.js";
import type { ChartRunConfig } from "../../lib/contracts/generated/charts/ChartRunConfig.js";
import type { ChartRunEvent } from "../../lib/contracts/generated/charts/ChartRunEvent.js";
import type { ChartRunResult } from "../../lib/contracts/generated/charts/ChartRunResult.js";
import type { ChartTemplateManifest } from "../../lib/contracts/generated/charts/ChartTemplateManifest.js";
import type { ChartZipRequest } from "../../lib/contracts/generated/charts/ChartZipRequest.js";

/**
 * Scientific chart studio commands. Rust side: `commands/charts.rs` +
 * the `mynx-charts` crate. All failures reject with a `CommandError` via
 * the shared invoke helper.
 */

/** Reads one template's manifest from the app resources. */
export function readChartManifest(templateId: string): Promise<ChartTemplateManifest> {
  return call("charts_read_manifest", { templateId });
}

/** Installed template ids under `<resource_dir>/r/chart-templates`. */
export function listChartTemplates(): Promise<string[]> {
  return call("charts_list_templates");
}

/** Imports a dataset for field mapping (csv/tsv/txt/xlsx/xls; JSON cells). */
export function importChartData(path: string, previewRows?: number): Promise<ChartImportedData> {
  return call("charts_import_data", { path, previewRows: previewRows ?? null });
}

/**
 * Runs chart_runner.R. Events stream through the channel (attached
 * synchronously before the invoke, so no early event can be missed); the
 * promise resolves with the terminal `ChartRunResult`. Cancel via
 * `cancelChartRun` / `tasksCancel` with the task-center job id.
 */
export function runChart(
  config: ChartRunConfig,
  onEvent: (event: ChartRunEvent) => void,
): Promise<ChartRunResult> {
  const channel = new Channel<ChartRunEvent>();
  channel.onmessage = onEvent;
  return call("charts_run", { config, onEvent: channel });
}

/** Cancels a running chart job (job registry id, not a pipeline id). */
export function cancelChartRun(taskId: number): Promise<boolean> {
  return call("charts_cancel", { taskId });
}

/** Builds the figure package ZIP (output figure + template resources). */
export function exportChartZip(request: ChartZipRequest): Promise<boolean> {
  return call("charts_export_zip", { request });
}

/** Installs a template package ZIP into the app-data template dir. */
export function installChartTemplatePackage(zipPath: string): Promise<ChartTemplateManifest> {
  return call("charts_install_template_package", { zipPath });
}
