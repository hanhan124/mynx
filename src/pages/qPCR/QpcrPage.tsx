import { useState, useCallback } from 'react';
import { IconFlask, IconFileSpreadsheet } from '@tabler/icons-react';
import FileSelect from './FileSelect';
import Transform from './Transform';
import Calculate from './Calculate';
import LoadingOverlay from '@/components/LoadingOverlay';
import type { ExcelFile } from '@/lib/excel-io';
import { saveExcelFile } from '@/lib/excel-io';
import { generateVbsCharts } from '@/lib/chart-gen';
import { detectTransformedGenes } from '@/lib/qpcr-transform';
import { showToast } from '@/components/Toast';

export default function QpcrPage() {
  const [file, setFile] = useState<ExcelFile | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [geneNames, setGeneNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  /** 0-100 determinate, or null for indeterminate. */
  const [progress, setProgress] = useState<number | null>(null);

  const startStage = useCallback(
    (text: string, mode: 'determinate' | 'indeterminate' = 'indeterminate') => {
      setLoadingText(text);
      setProgress(mode === 'indeterminate' ? null : 0);
      setLoading(true);
    },
    []
  );

  const endStage = useCallback(() => {
    setLoading(false);
    setProgress(null);
  }, []);

  const updateProgress = useCallback((current: number, total: number, text?: string) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    setProgress(pct);
    if (text) setLoadingText(text);
    setLoading(true);
  }, []);

  const silentSave = useCallback(async (): Promise<boolean> => {
    if (!file) return false;
    try {
      await saveExcelFile(file.workbook, file.path);
      return true;
    } catch (e) {
      showToast(`自动保存失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
  }, [file]);

  const handleTransformComplete = useCallback(
    async (names: string[]) => {
      setGeneNames(names);
      startStage('正在保存...', 'indeterminate');
      try {
        await silentSave();
      } finally {
        endStage();
      }
    },
    [silentSave, startStage, endStage]
  );

  const handleCalculateComplete = useCallback(
    async (repeatCount: number, chartColor: string) => {
      if (!file) return;
      try {
        startStage('正在保存...', 'indeterminate');
        await silentSave();

        startStage('正在生成图表...', 'determinate');
        const result = await generateVbsCharts(
          file.path,
          repeatCount,
          chartColor,
          (current, total) => {
            updateProgress(current, total, `正在生成图表 (${current}/${total})...`);
          }
        );
        if (result.success) {
          const created = result.chartsCreated ?? 0;
          const tail = result.reason ? `，${result.reason}` : '';
          showToast(`已生成 ${created} 个图表${tail}`, 'success');
        } else {
          showToast(`图表生成失败：${result.reason ?? '未知错误'}`, 'error');
        }
      } catch (e) {
        showToast(`图表生成出错：${String(e)}`, 'error');
      } finally {
        endStage();
      }
    },
    [file, silentSave, startStage, endStage, updateProgress]
  );

  return (
    <div className="page-shell">
      <LoadingOverlay visible={loading} text={loadingText} progress={progress} />

      <div className="panel-header">
        <div className="panel-icon" style={{ background: '#0a84ff' }}>
          <IconFlask size={18} color="white" stroke={2} />
        </div>
        <div className="panel-title">
          <h2>qPCR 分析</h2>
          <p>转换数据，计算相对表达量</p>
        </div>
      </div>

      {/* 步骤 0: 文件 */}
      <div className="card">
        <div className="card-title">
          <IconFileSpreadsheet size={14} stroke={2} />
          <span>数据文件</span>
        </div>
        <div className="card-body">
          <FileSelect
            file={file}
            sheetName={sheetName}
            onFileChange={(f) => {
              setFile(f);
              if (f) {
                // Auto-detect gene names if file already has Transformed Data sheet
                const genes = detectTransformedGenes(f.workbook);
                setGeneNames(genes);
              } else {
                setGeneNames([]);
              }
            }}
            onSheetChange={setSheetName}
          />
        </div>
      </div>

      {/* 步骤 1: 转换 — 始终显示 */}
      <div className="card">
        <div className="card-title">
          <span className="step-num">1</span>
          <span>数据转换</span>
        </div>
        <div className="card-body">
          <Transform
            workbook={file?.workbook ?? null}
            sheetName={sheetName}
            onComplete={handleTransformComplete}
            onProgress={updateProgress}
          />
        </div>
      </div>

      {/* 步骤 2: 计算 — 始终显示 */}
      <div className="card">
        <div className="card-title">
          <span className="step-num">2</span>
          <span>qPCR 计算</span>
        </div>
        <div className="card-body">
          <Calculate
            workbook={file?.workbook ?? null}
            geneNames={geneNames}
            onComplete={handleCalculateComplete}
            onProgress={updateProgress}
          />
        </div>
      </div>


    </div>
  );
}
