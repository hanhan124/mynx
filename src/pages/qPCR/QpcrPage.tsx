import { useState, useCallback } from 'react';
import { FlaskConical, FileSpreadsheet } from 'lucide-react';
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



  const autoSave = useCallback(async (label: string) => {
    if (!file) return;
    try {
      await saveExcelFile(file.workbook, file.path);
      showToast(`${label}`, 'success');
    } catch (e) {
      showToast(`自动保存失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [file]);

  const handleTransformComplete = useCallback(async (names: string[]) => {
    setGeneNames(names);
    setLoading(true);
    setLoadingText('转换中...');
    await autoSave('转换完成，已保存');
    setLoading(false);
  }, [autoSave]);

  const handleCalculateComplete = useCallback(async (repeatCount: number) => {
    setLoading(true);
    setLoadingText('计算中...');
    await autoSave('计算完成，已保存');
    if (file) {
      try {
        const result = await generateVbsCharts(file.path, repeatCount);
        if (result.success) {
          const created = result.chartsCreated ?? 0;
          showToast(`已生成 ${created} 个图表`, 'success');
        } else {
          showToast(`图表生成失败：${result.reason ?? '未知错误'}`, 'error');
        }
      } catch (e) {
        showToast(`图表生成出错：${String(e)}`, 'error');
      }
    }
    setLoading(false);
  }, [autoSave, file]);

  return (
    <div className="page-shell">
      <LoadingOverlay visible={loading} text={loadingText} />

      <div className="panel-header">
        <div className="panel-icon" style={{ background: '#0a84ff' }}>
          <FlaskConical size={18} color="white" strokeWidth={1.8} />
        </div>
        <div className="panel-title">
          <h2>qPCR 分析</h2>
          <p>转换数据，计算相对表达量</p>
        </div>
      </div>

      {/* 步骤 0: 文件 */}
      <div className="card">
        <div className="card-title">
          <FileSpreadsheet size={14} strokeWidth={1.8} />
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
          />
        </div>
      </div>


    </div>
  );
}
