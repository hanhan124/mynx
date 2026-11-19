export type ChartNavigationStage =
  | "routeUpdated"
  | "moduleReady"
  | "visibleFrame"
  | "settingsReady"
  | "manifestReady"
  | "referenceReady"
  | "rStatusReady"
  | "moduleLoadError";

interface StageTiming {
  elapsedMs: number;
  source?: string;
}

interface LongTaskSummary {
  supported: boolean | null;
  count: number | null;
  maxDurationMs: number | null;
}

interface MutableSample {
  id: number;
  startedAt: number;
  stages: Partial<Record<ChartNavigationStage, StageTiming>>;
  longTasks: LongTaskSummary;
}

export interface ChartNavigationSample {
  id: number;
  stages: Partial<Record<ChartNavigationStage, StageTiming>>;
  longTasks: LongTaskSummary;
}

export interface ChartNavigationDiagnostics {
  schemaVersion: 1;
  retention: "current-process-memory";
  samples: ChartNavigationSample[];
}

const MAX_SAMPLES = 20;
let nextSampleId = 1;
let activeSampleId: number | null = null;
const samples: MutableSample[] = [];
let longTaskObserver: PerformanceObserver | null = null;
let observedSampleId: number | null = null;

function sampleFor(id: number | null): MutableSample | undefined {
  if (id === null) return undefined;
  return samples.find((sample) => sample.id === id);
}

function stopLongTaskObserver(): void {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  observedSampleId = null;
}

function observeLongTasks(sample: MutableSample): void {
  const supported =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
  sample.longTasks = {
    supported,
    count: supported ? 0 : null,
    maxDurationMs: supported ? 0 : null,
  };
  if (!supported) return;

  try {
    const observer = new PerformanceObserver((list) => {
      if (activeSampleId !== sample.id || observedSampleId !== sample.id) return;
      for (const entry of list.getEntries()) {
        sample.longTasks.count = (sample.longTasks.count ?? 0) + 1;
        sample.longTasks.maxDurationMs = Math.max(
          sample.longTasks.maxDurationMs ?? 0,
          Number(entry.duration.toFixed(1)),
        );
      }
    });
    observer.observe({ type: "longtask", buffered: false });
    longTaskObserver = observer;
    observedSampleId = sample.id;
  } catch {
    sample.longTasks = { supported: false, count: null, maxDurationMs: null };
  }
}

/** Starts a local, in-memory timing sample when the user enters charting. */
export function beginChartNavigation(): number | null {
  if (typeof performance === "undefined") return null;
  stopLongTaskObserver();
  const sample: MutableSample = {
    id: nextSampleId++,
    startedAt: performance.now(),
    stages: {},
    longTasks: { supported: null, count: null, maxDurationMs: null },
  };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();
  activeSampleId = sample.id;
  observeLongTasks(sample);
  return sample.id;
}

export function currentChartNavigationId(): number | null {
  return activeSampleId;
}

export function recordChartNavigationStage(
  sampleId: number | null,
  stage: ChartNavigationStage,
  source?: string,
): void {
  if (sampleId === null || sampleId !== activeSampleId || typeof performance === "undefined")
    return;
  const sample = sampleFor(sampleId);
  if (!sample || sample.stages[stage]) return;

  sample.stages[stage] = {
    elapsedMs: Number(Math.max(0, performance.now() - sample.startedAt).toFixed(1)),
    ...(source ? { source } : {}),
  };
}

/** Ends collection when leaving charting; completed samples remain available to copy. */
export function endChartNavigation(sampleId: number | null): void {
  if (sampleId === null || sampleId !== activeSampleId) return;
  activeSampleId = null;
  stopLongTaskObserver();
}

export function getChartNavigationDiagnostics(): ChartNavigationDiagnostics | null {
  if (samples.length === 0) return null;
  return {
    schemaVersion: 1,
    retention: "current-process-memory",
    samples: samples.map(({ id, stages, longTasks }) => ({
      id,
      stages: { ...stages },
      longTasks: { ...longTasks },
    })),
  };
}

export function formatChartNavigationDiagnostics(): string {
  const diagnostics = getChartNavigationDiagnostics();
  return diagnostics ? JSON.stringify(diagnostics, null, 2) : "";
}
