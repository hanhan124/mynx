/**
 * normalizeCountMatrix 冒烟测试 — 断言值对齐 publication_pipeline_wails/normalize_matrix_test.go。
 * 用法:node --experimental-strip-types scripts/rnaseq-matrix-smoke.ts
 */
import { parseDelimited, normalizeCountMatrix, toCsvText, detectDelimiter } from '../src/lib/rnaseq/matrix.ts';

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}`, detail ?? '');
  }
}

// ── CSV 解析 ──
const parsed = parseDelimited('a,b,c\r\n1,"x,y",3\n"q""uote",,z\r\n', ',');
check('parseDelimited rows', parsed.length === 3, parsed);
check('parseDelimited quoted comma', parsed[1][1] === 'x,y', parsed[1]);
check('parseDelimited escaped quote', parsed[2][0] === 'q"uote', parsed[2]);
check('parseDelimited empty field', parsed[2][1] === '', parsed[2]);
check('detectDelimiter tsv', detectDelimiter('a\tb\tc\n1\t2\t3\n') === '\t');
check('detectDelimiter csv', detectDelimiter('a,b,c\n1,2,3\n') === ',');

// ── featureCounts:丢弃注释列,保留 Geneid + 数值列 ──
const fc = normalizeCountMatrix(
  [
    ['Geneid', 'Chr', 'Start', 'End', 'Strand', 'Length', 'G1', 'G2', 'extra'],
    ['geneA', 'chr1', '100', '200', '+', '50', '5', '6', 'note'],
    ['geneB', 'chr2', '300', '400', '-', '60', '7', '8', 'x'],
  ],
  'featurecounts',
);
check('fc headers', JSON.stringify(fc.headers) === JSON.stringify(['Geneid', 'G1', 'G2']), fc.headers);
check('fc applied', fc.applied === 'featurecounts');
check('fc drops anno col (warning)', fc.warnings.some((w) => w.includes('extra')), fc.warnings);

// ── HTSeq:过滤 __no_feature 行 ──
const ht = normalizeCountMatrix(
  [
    ['gene', 'S1', 'S2'],
    ['geneA', '1', '2'],
    ['__no_feature', '10', '20'],
    ['__ambiguous', '1', '1'],
    ['geneB', '3', '4'],
  ],
  'htseq',
);
check('htseq filters __ rows', ht.body.length === 2 && ht.body[0][0] === 'geneA', ht.body);

// ── 未知预设回退 counts_matrix ──
const unk = normalizeCountMatrix([['g', 'a', 'b'], ['x', '1', '2']], 'whatever');
check('unknown preset falls back', unk.applied === 'counts_matrix');

// counts_matrix 也过滤 HTSeq 汇总行
const cm = normalizeCountMatrix([['gene', 'S1'], ['__no_feature', '5'], ['g1', '3']], '');
check('counts_matrix filters __ rows', cm.body.length === 1);

// ── 重复基因名按原始计数求和合并(Go 测试断言值)──
const dup = normalizeCountMatrix(
  [
    ['gene_id', 'G1', 'G2'],
    ['a', '5', '6'],
    ['a', '10', '20'],
    ['b', '2', '3'],
  ],
  'counts_matrix',
);
check('dup merged by sum G1=15', dup.body.length === 2 && dup.body[0][1] === '15', dup.body);
check('dup merged by sum G2=26', dup.body[0][2] === '26', dup.body);
check('dup warning', dup.warnings.some((w) => w.includes('重复基因名')), dup.warnings);

// ── TPM 疑似检测 ──
const tpmRows: string[][] = [['gene', 'S1']];
for (let i = 0; i < 100; i++) tpmRows.push([`g${i}`, (i * 1.37 + 0.5).toFixed(4)]);
const tpm = normalizeCountMatrix(tpmRows, 'counts_matrix');
check('fractional data warns TPM', tpm.warnings.some((w) => w.includes('TPM')), tpm.warnings);

// ── CSV 写回可再解析 ──
const csv = toCsvText(['gene_id', 'G,1'], [['a', '1'], ['b"q', '2']]);
const re = parseDelimited(csv, ',');
check('toCsvText roundtrip', re.length === 3 && re[0][1] === 'G,1' && re[2][0] === 'b"q', re);

// ── 错误路径 ──
try {
  normalizeCountMatrix([['only_one_col']], 'counts_matrix');
  check('throws on single column', false);
} catch (e) {
  check('throws on single column', (e as Error).message.includes('至少需要'));
}
try {
  normalizeCountMatrix([], 'counts_matrix');
  check('throws on empty', false);
} catch {
  check('throws on empty', true);
}

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
