import { useState, useCallback } from 'react';
import { IconDna, IconFileSpreadsheet } from '@tabler/icons-react';
import FileSelect from './FileSelect';
import Transform from './Transform';
import Calculate from './Calculate';
import LoadingOverlay from '@/components/LoadingOverlay';
import HelpButton, { QpcrTutorial } from '@/components/HelpButton';
import type { ExcelFile } from '@/lib/excel-io';
import { saveExcelFile } from '@/lib/excel-io';
import { generateChartsFromFile } from '@/lib/chart-gen';
import { detectTransformedGenes } from '@/lib/qpcr-transform';
import { showToast } from '@/components/Toast';
import { useLanguage } from '@/lib/i18n';

export default function QpcrPage() {
  const { t, language } = useLanguage();
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
      showToast(t('qpcr.saveFailed', { detail: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }, [file]);

  const handleTransformComplete = useCallback(
    async (names: string[]) => {
      setGeneNames(names);
      startStage(t('qpcr.save'), 'indeterminate');
      try {
        const saved = await silentSave();
        if (!saved) return;
      } finally {
        endStage();
      }
    },
    [silentSave, startStage, endStage]
  );

  const handleCalculateComplete = useCallback(
    async (
      repeatCount: number,
      chartColor: string,
      methodOptions: { method: 'ref-normalized' | 'control-relative'; controlGroup?: string }
    ) => {
      if (!file) return;
      try {
        startStage(t('qpcr.save'), 'indeterminate');
        await silentSave();

        startStage(t('qpcr.generating'), 'determinate');
        const result = await generateChartsFromFile(
          file.path,
          repeatCount,
          chartColor,
          (current, total) => {
            updateProgress(current, total, `${t('qpcr.generating')} (${current}/${total})...`);
          },
          methodOptions
        );
        if (result.success) {
          const created = result.chartsCreated ?? 0;
          const tail = result.reason ? `，${result.reason}` : '';
          showToast(t('qpcr.chartComplete', { count: created, detail: tail }), 'success');
        } else {
          showToast(t('qpcr.chartFailed', { detail: result.reason ?? (language === 'en' ? 'Unknown error' : '未知错误') }), 'error');
        }
      } catch (e) {
      showToast(t('qpcr.chartError', { detail: String(e) }), 'error');
      } finally {
        endStage();
      }
    },
    [file, silentSave, startStage, endStage, updateProgress]
  );

  return (
    <div className="page-shell page-shell--wide">
      <LoadingOverlay visible={loading} text={loadingText} progress={progress} />

      <div className="panel-header">
        <div className="panel-icon" style={{ background: '#0a84ff' }}>
          <IconDna size={18} color="white" stroke={1.75} />
        </div>
        <div className="panel-title">
        <h2>{t('qpcr.title')}</h2>
          <p>{t('qpcr.subtitle')}</p>
        </div>
        <div className="panel-actions">
          <HelpButton>{(close) => <QpcrTutorial onClose={close} />}</HelpButton>
        </div>
      </div>

      {/* 步骤 0: 文件 */}
      <div className="card">
        <div className="card-title">
          <IconFileSpreadsheet size={14} stroke={1.75} />
          <span>{t('qpcr.dataFile')}</span>
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
                setSheetName('');
                setGeneNames([]);
                endStage();
              }
            }}
            onSheetChange={setSheetName}
          />
        </div>
      </div>

      {/* 步骤 1 + 2: 宽屏并排(转换 / 计算), 窄屏自动回退单列堆叠 */}
      <div className="card-grid card-grid--2">
        {/* 步骤 1: 转换 — 始终显示 */}
        <div className="card">
          <div className="card-title">
            <span className="step-num">1</span>
            <span>{t('qpcr.transform')}</span>
          </div>
          <div className="card-body">
            <Transform
              workbook={file?.workbook ?? null}
              sheetName={sheetName}
              onComplete={handleTransformComplete}
              onProgress={updateProgress}
              onError={endStage}
            />
          </div>
        </div>

        {/* 步骤 2: 计算 — 始终显示 */}
        <div className="card">
          <div className="card-title">
            <span className="step-num">2</span>
            <span>{t('qpcr.calculate')}</span>
          </div>
          <div className="card-body">
            <Calculate
              workbook={file?.workbook ?? null}
              geneNames={geneNames}
              onComplete={handleCalculateComplete}
              onProgress={updateProgress}
              onError={endStage}
            />
          </div>
        </div>
      </div>

    </div>
  );
}
