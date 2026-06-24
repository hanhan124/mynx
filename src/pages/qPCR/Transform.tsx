import { useState, useMemo } from 'react';
import { Info, CheckCircle2, XCircle } from 'lucide-react';
import type ExcelJS from 'exceljs';
import { transformQpcrData, detectTransformedGenes } from '@/lib/qpcr-transform';

interface TransformProps {
  workbook: ExcelJS.Workbook | null;
  sheetName: string;
  onComplete: (geneNames: string[]) => void;
}

type Status = 'ready' | 'processing' | 'success' | 'error';

export default function Transform({ workbook, sheetName, onComplete }: TransformProps) {
  const [status, setStatus] = useState<Status>('ready');
  const [errorMsg, setErrorMsg] = useState('');
  const [resultMsg, setResultMsg] = useState('');

  // Check if file already has transformed data
  const existingGenes = useMemo(() => {
    if (!workbook) return [];
    return detectTransformedGenes(workbook);
  }, [workbook]);

  const alreadyTransformed = existingGenes.length > 0;

  // If file is already transformed and status is still 'ready', show the info
  const showAlreadyTransformed = alreadyTransformed && status === 'ready';

  const canExecute = workbook && sheetName && status !== 'processing';

  async function handleExecute() {
    if (!workbook || !sheetName) return;
    try {
      setStatus('processing');
      const sourceSheet = workbook.getWorksheet(sheetName);
      if (!sourceSheet) throw new Error('工作表未找到');
      const { geneNames } = transformQpcrData(sourceSheet, workbook);
      setStatus('success');
      setResultMsg(`转换完成，${geneNames.length} 个基因`);
      onComplete(geneNames);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <>
      <div className="notice">
        <Info size={14} strokeWidth={1.8} />
        <span>转置数据为按样本分组，缺失值标黄</span>
      </div>

      {showAlreadyTransformed && (
        <div className="result-success">
          <CheckCircle2 size={14} strokeWidth={2} />
          <div>已转换（{existingGenes.length} 个基因），可直接计算</div>
        </div>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={handleExecute}
        disabled={!canExecute}
      >
        {status === 'processing' ? '执行中...' : alreadyTransformed ? '重新转换' : '执行转换'}
      </button>

      {status === 'success' && resultMsg && (
        <div className="result-success">
          <CheckCircle2 size={14} strokeWidth={2} />
          <div>{resultMsg}</div>
        </div>
      )}

      {status === 'error' && (
        <div className="result-success" style={{ color: 'var(--red)', background: 'rgba(255,59,48,0.08)' }}>
          <XCircle size={14} strokeWidth={2} />
          <div>{errorMsg}</div>
        </div>
      )}
    </>
  );
}
