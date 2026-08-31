import { useState } from 'react';
import type { ChartConfig, ChartResult, RunEvent } from '@/features/charts/model';
import type { ChartTemplate } from '@/lib/charts/catalog';
import type { ChartPreset } from '@/lib/config';

export function useChartStudioState(initialConfig: () => ChartConfig, defaultTemplate: ChartTemplate) {
  const [cfg, setCfg] = useState<ChartConfig>(initialConfig);
  const [family, setFamily] = useState('全部');
  const [search, setSearch] = useState('');
  const [presets, setPresets] = useState<ChartPreset[]>([]);
  const [running, setRunning] = useState(false);
  const [installingR, setInstallingR] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [runStage, setRunStage] = useState(0);
  const [runProgress, setRunProgress] = useState<number | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [log, setLog] = useState('选择图表并载入数据。');
  const [referenceImage, setReferenceImage] = useState('');
  const [referenceLoadError, setReferenceLoadError] = useState(false);
  const [lastResult, setLastResult] = useState<ChartResult | null>(null);
  const [rscriptFound, setRscriptFound] = useState<boolean | null>(null);
  return { cfg, setCfg, family, setFamily, search, setSearch, presets, setPresets, running, setRunning, installingR, setInstallingR, cancelling, setCancelling, columns, setColumns, runStage, setRunStage, runProgress, setRunProgress, runEvents, setRunEvents, log, setLog, referenceImage, setReferenceImage, referenceLoadError, setReferenceLoadError, lastResult, setLastResult, rscriptFound, setRscriptFound, defaultTemplate };
}
