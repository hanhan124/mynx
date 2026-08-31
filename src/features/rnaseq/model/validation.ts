import type { Config } from '@/lib/rnaseq/types';

export function validComparisonsOf(config: Config): [string, string][] {
  return config.comparisons.filter(([t, ctrl]) => t && ctrl && t !== ctrl && config.selected_groups.includes(t) && config.selected_groups.includes(ctrl));
}

export function batchConfounded(config: Config): boolean {
  const entries = Object.entries(config.batches || {});
  if (entries.length === 0) return false;
  const sample2batch: Record<string, string> = {};
  for (const [batch, samples] of entries) for (const sample of samples) sample2batch[sample] = batch;
  const selected = Object.entries(config.groups).filter(([name, samples]) => config.selected_groups.includes(name) && samples.length > 0);
  if (selected.length < 2) return false;
  const groupBatch = selected.map(([, samples]) => [...new Set(samples.map((sample) => sample2batch[sample]))]);
  if (groupBatch.some((batches) => batches.length > 1)) return false;
  return new Set(groupBatch.map((batches) => batches[0])).size === selected.length;
}
