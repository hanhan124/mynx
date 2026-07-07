import { useState, useMemo, useEffect } from 'react';
import { IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import type ExcelJS from 'exceljs';
import { calculateQpcr } from '@/lib/qpcr-calculate';
import { detectTransformedGenes } from '@/lib/qpcr-transform';
import { loadChartColor, saveChartColor } from '@/lib/config';
import { DEFAULT_CHART_COLOR } from '@/lib/chart-gen';

interface CalculateProps {
  workbook: ExcelJS.Workbook | null;
  geneNames: string[];
  onComplete: (repeatCount: number, chartColor: string) => void;
  onProgress?: (current: number, total: number, text?: string) => void;
}

type Status = 'ready' | 'processing' | 'success' | 'error';

export default function Calculate({ workbook, geneNames, onComplete, onProgress }: CalculateProps) {
  const [repeatCount, setRepeatCount] = useState(2);
  const [refGene, setRefGene] = useState('');
  const [chartColor, setChartColor] = useState(DEFAULT_CHART_COLOR);
  const [status, setStatus] = useState<Status>('ready');
  const [errorMsg, setErrorMsg] = useState('');
  const [resultMsg, setResultMsg] = useState('');

  // Restore saved chart color on mount
  useEffect(() => {
    let cancelled = false;
    loadChartColor().then((c) => {
      if (!cancelled) setChartColor(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-detect gene names from workbook's Transformed Data sheet
  // if not already provided (e.g. file was already transformed)
  const effectiveGeneNames = useMemo(() => {
    if (geneNames.length > 0) return geneNames;
    if (!workbook) return [];
    return detectTransformedGenes(workbook);
  }, [geneNames, workbook]);

  // Auto-select first gene as reference gene
  useEffect(() => {
    if (effectiveGeneNames.length > 0 && !refGene) {
      setRefGene(effectiveGeneNames[0]);
    }
  }, [effectiveGeneNames, refGene]);

  // Button is enabled whenever a workbook is loaded and a ref gene is selected
  const canExecute = workbook !== null && refGene !== '' && status !== 'processing';

  async function handleExecute() {
    if (!workbook || !refGene) return;
    try {
      setStatus('processing');
      setErrorMsg('');
      onProgress?.(0, 2, '正在计算相对表达量...');
      calculateQpcr(workbook, repeatCount, refGene);
      onProgress?.(2, 2, '计算完成');
      setStatus('success');
      setResultMsg(`计算完成，${effectiveGeneNames.length} 个基因`);
      onComplete(repeatCount, chartColor);
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : '计算出错');
    }
  }

  if (!workbook) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '4px 0' }}>
        请先选择数据文件
      </div>
    );
  }

  const hasGenes = effectiveGeneNames.length > 0;

  return (
    <>
      <div className="form-row form-row--three">
        <div className="form-group">
          <label>重复次数</label>
          <select value={repeatCount} onChange={(e) => setRepeatCount(Number(e.target.value))} disabled={status === 'processing'}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>参考基因</label>
          <select
            value={refGene}
            onChange={(e) => setRefGene(e.target.value)}
            disabled={status === 'processing' || !hasGenes}
          >
            {hasGenes ? (
              effectiveGeneNames.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))
            ) : (
              <option value="">请先转换数据</option>
            )}
          </select>
        </div>
        <div className="form-group">
          <label>柱状图颜色</label>
          <div className="color-picker-row">
            <input
              type="color"
              value={chartColor}
              disabled={status === 'processing'}
              onChange={(e) => {
                const next = e.target.value;
                setChartColor(next);
                // Persist on every change so the user's choice survives reloads
                saveChartColor(next).catch(() => undefined);
              }}
              aria-label="柱状图颜色"
            />
            <span className="color-hex">{chartColor.toUpperCase()}</span>
          </div>
        </div>
      </div>

      <button
        className="btn btn-primary btn-full"
        onClick={handleExecute}
        disabled={!canExecute}
      >
        {status === 'processing' ? '正在计算...' : '执行计算'}
      </button>

      {status === 'success' && resultMsg && (
        <div className="result-success">
          <IconCircleCheck size={14} stroke={2} />
          <div>{resultMsg}</div>
        </div>
      )}

      {status === 'error' && (
        <div className="result-success" style={{ color: '#ff453a', background: 'rgba(255,69,58,0.08)' }}>
          <IconCircleX size={14} stroke={2} />
          <div>{errorMsg}</div>
        </div>
      )}
    </>
  );
}
