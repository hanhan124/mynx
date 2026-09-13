import { open } from '@tauri-apps/plugin-dialog';
import { IconFileSpreadsheet } from '@tabler/icons-react';
import { readExcelFile, getSheetNames, type ExcelFile } from '@/lib/excel-io';
import { showToast } from '@/components/Toast';
import { useDropZone } from '@/hooks/useDropZone';
import { useLanguage } from '@/lib/i18n';

interface FileSelectProps {
  file: ExcelFile | null;
  sheetName: string;
  onFileChange: (file: ExcelFile | null) => void;
  onSheetChange: (name: string) => void;
}

export default function FileSelect({ file, sheetName, onFileChange, onSheetChange }: FileSelectProps) {
  const { t } = useLanguage();
  const sheets = file ? getSheetNames(file.workbook) : [];

  const handleDrop = async (paths: string[]) => {
    const excelPath = paths.find((p) =>
      /\.(xlsx|xls)$/i.test(p),
    );
    if (!excelPath) return;
    try {
      const name = excelPath.split(/[/\\]/).pop() ?? excelPath;
      const excelFile = await readExcelFile(excelPath, name);
      onFileChange(excelFile);
      const names = getSheetNames(excelFile.workbook);
      onSheetChange(names[0] ?? '');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(t('qpcr.importFailed', { detail: msg }), 'error');
    }
  };

  const { dropRef, isDragOver } = useDropZone(handleDrop);

  async function handleOpen() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      const name = filePath.split(/[/\\]/).pop() ?? filePath;
      const excelFile = await readExcelFile(filePath, name);
      onFileChange(excelFile);
      const names = getSheetNames(excelFile.workbook);
      onSheetChange(names[0] ?? '');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(t('qpcr.openFailed', { detail: msg }), 'error');
    }
  }

  return (
    <>
      <div
        ref={dropRef}
        className={`file-display qpcr-file-input${isDragOver ? ' file-display--drag qpcr-file-input--drag' : ''}${file ? ' qpcr-file-input--loaded' : ''}`}
      >
        <div className="file-icon" style={{ background: '#34c759' }}>
          <IconFileSpreadsheet size={20} color="white" stroke={1.75} />
        </div>
        <div className="file-info">
          <div className="file-name">{file ? file.name : t('qpcr.noFileSelected')}</div>
          <div className="file-path">{file ? file.path : 'xlsx / xls'}</div>
        </div>
        {isDragOver && <span className="drop-hint">{t('tiff.drop')}</span>}
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" onClick={handleOpen}>{t('qpcr.open')}</button>
        {file && (
          <button className="btn" style={{ marginLeft: 'auto', color: 'var(--red)' }} onClick={() => {
            onSheetChange('');
            onFileChange(null);
          }}>
            {t('qpcr.clear')}
          </button>
        )}
      </div>

      {file && sheets.length > 0 && (
        <div className="form-group">
          <label>{t('qpcr.sheet')}</label>
          <select value={sheetName} onChange={(e) => onSheetChange(e.target.value)}>
            {sheets.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
