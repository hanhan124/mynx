import { performance } from 'node:perf_hooks';
import { normalizeCountMatrix, parseDelimited } from '../src/lib/rnaseq/matrix.ts';

const genes = 20_000;
const samples = 12;
const header = ['gene', ...Array.from({ length: samples }, (_, i) => `S${i + 1}`)].join(',');
const rows = Array.from({ length: genes }, (_, i) =>
  [`G${i + 1}`, ...Array.from({ length: samples }, (_, j) => String((i + j) % 1000))].join(','),
);
const text = `${header}\n${rows.join('\n')}\n`;
const start = performance.now();
const parsed = parseDelimited(text, ',');
const normalized = normalizeCountMatrix(parsed, 'counts_matrix');
const elapsed = performance.now() - start;
const mb = text.length / (1024 * 1024);
console.log(`matrix benchmark: ${genes} genes × ${samples} samples, ${mb.toFixed(1)} MiB, ${elapsed.toFixed(0)} ms`);
if (normalized.body.length !== genes) throw new Error('row count mismatch');
