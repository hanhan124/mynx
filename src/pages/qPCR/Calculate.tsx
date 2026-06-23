import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type ExcelJS from 'exceljs';
import { calculateQpcr } from '@/lib/qpcr-calculate';

interface CalculateProps {
  workbook: ExcelJS.Workbook | null;
  geneNames: string[];
  onComplete: (repeatCount: number) => void;
}

type Status = 'ready' | 'processing' | 'success' | 'error';

export default function Calculate({ workbook, geneNames, onComplete }: CalculateProps) {
  const [repeatCount, setRepeatCount] = useState(2);
  const [refGene, setRefGene] = useState('');
  const [status, setStatus] = useState<Status>('ready');
  const [errorMsg, setErrorMsg] = useState('');
  const [resultMsg, setResultMsg] = useState('');

  const canExecute = workbook !== null && geneNames.length > 0 && refGene !== '' && status !== 'processing';

  async function handleExecute() {
    if (!workbook || !refGene) return;
    try {
      setStatus('processing');
      setErrorMsg('');
      calculateQpcr(workbook, repeatCount, refGene);
      setStatus('success');
      setResultMsg(`处理了 ${geneNames.length} 个基因，重复数 = ${repeatCount}`);
      onComplete(repeatCount);
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : '计算出错');
    }
  }

  const disabled = !workbook;

  return (
    <>
      {disabled ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '4px 0' }}>
          请先打开并转换数据文件
        </div>
      ) : geneNames.length === 0 ? (
        <div className="form-row">
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
            <select disabled>
              <option value="">请先执行数据转换</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="form-row">
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
            <select value={refGene} onChange={(e) => setRefGene(e.target.value)} disabled={status === 'processing'}>
              <option value="">请选择参考基因</option>
              {geneNames.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!disabled && (
        <button
          className="btn btn-primary btn-full"
          onClick={handleExecute}
          disabled={!canExecute}
        >
          {status === 'processing' ? '计算中...' : '执行计算'}
        </button>
      )}

      {status === 'success' && resultMsg && (
        <div className="result-success">
          <CheckCircle2 size={14} strokeWidth={2} />
          <div>{resultMsg}</div>
        </div>
      )}

      {status === 'error' && (
        <div className="result-success" style={{ color: '#ff453a', background: 'rgba(255,69,58,0.08)' }}>
          <XCircle size={14} strokeWidth={2} />
          <div>{errorMsg}</div>
        </div>
      )}
    </>
  );
}
