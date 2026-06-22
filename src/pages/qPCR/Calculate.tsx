import { useState } from 'react';
import type ExcelJS from 'exceljs';
import { calculateQpcr } from '../../lib/qpcr-calculate';

interface CalculateProps {
  workbook: ExcelJS.Workbook | null;
  geneNames: string[];
}

type Status = 'ready' | 'processing' | 'success' | 'error';

export default function Calculate({ workbook, geneNames }: CalculateProps) {
  const [repeatCount, setRepeatCount] = useState(2);
  const [refGene, setRefGene] = useState('');
  const [status, setStatus] = useState<Status>('ready');
  const [errorMsg, setErrorMsg] = useState('');

  const canExecute = workbook && geneNames.length > 0 && refGene && status !== 'processing';

  async function handleExecute() {
    if (!workbook || !refGene) return;

    try {
      setStatus('processing');
      setErrorMsg('');
      calculateQpcr(workbook, repeatCount, refGene);
      setStatus('success');
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : '计算出错');
    }
  }

  const statusLabels: Record<Status, string> = {
    ready: '待执行',
    processing: '处理中...',
    success: '完成',
    error: '出错',
  };

  const statusColors: Record<Status, string> = {
    ready: 'var(--text-secondary)',
    processing: 'var(--accent)',
    success: '#22c55e',
    error: 'var(--red)',
  };

  const badgeColor = status === 'success' ? '#22c55e' : 'var(--accent)';

  return (
    <div className="transform-step">
      <div className="transform-header">
        <div className="step-badge" style={{ background: badgeColor }}>2</div>
        <div className="transform-info">
          <h3 className="transform-title">qPCR 计算</h3>
          <span className="transform-desc">
            2^(-ΔCt) 相对表达量计算，按重复次数分组
          </span>
        </div>
        <span className="transform-status" style={{ color: statusColors[status] }}>
          {statusLabels[status]}
        </span>
      </div>

      <div className="opt-grid">
        <div className="opt-field">
          <label className="opt-label-sm">重复次数</label>
          <select
            value={repeatCount}
            onChange={(e) => setRepeatCount(Number(e.target.value))}
            disabled={status === 'processing'}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="opt-field">
          <label className="opt-label-sm">参考基因</label>
          <select
            value={refGene}
            onChange={(e) => setRefGene(e.target.value)}
            disabled={status === 'processing'}
          >
            <option value="">选择参考基因</option>
            {geneNames.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      {status === 'error' && (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>{errorMsg}</div>
      )}

      <button
        className="btn btn-accent transform-execute"
        onClick={handleExecute}
        disabled={!canExecute}
      >
        执行计算
      </button>
    </div>
  );
}
