/**
 * Placeholder command surface for the feature pages. Feature agents replace
 * these with the real typed wrappers once the corresponding Rust commands
 * land. Keep every call routed through `call()` in ./tauri.js so the
 * MynxError mapping stays consistent, and reuse these event-name constants
 * for feature streams.
 */

import { EVENT_R_INSTALL_LOG } from "./tauri.js";

export { EVENT_R_INSTALL_LOG };

/* TODO(image): convert_images(options: ConvertOptions, outDir: string) →
 *   task id; progress via ConvertEvent stream on `mynx://convert-log`,
 *   cancel via tasks_cancel. Thumbnails via `mynx://thumbnails`. */

/* TODO(qpcr): workbook_load(path, sheet) → WorkbookSnapshot;
 *   workbook_transform(...) → TransformResult;
 *   workbook_calculate(request: CalcRequest) → CalcResult;
 *   plot_run(config: QpcrPlotRunConfig) → QpcrPlotRunResult;
 *   chart_inject(request: ChartInjectionRequest) → WorkbookPatch;
 *   sheet_patch(patch: SheetPatch) → WorkbookPatch. */

/* TODO(rnaseq): import_data(request: ImportRequest) → ImportData;
 *   run(config: RnaSeqConfig) → task id with `mynx://rnaseq-log` stream;
 *   results_list / history_load via RunDirEntry / RunResult. */

/* TODO(charts): templates_list() → ChartTemplateManifest[];
 *   charts_import_data(...) → ChartImportedData;
 *   charts_run(config: ChartRunConfig) → ChartRunResult with
 *   `mynx://chart-run` ChartRunEvent stream; zip export via ChartZipRequest. */

export {};
