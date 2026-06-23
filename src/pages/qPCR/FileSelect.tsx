import { open } from '@tauri-apps/plugin-dialog';
import { FileSpreadsheet } from 'lucide-react';
import { readExcelFile, getSheetNames, type ExcelFile } from '@/lib/excel-io';
import { showToast } from '@/components/Toast';

interface FileSelectProps {
  file: ExcelFile | null;
  sheetName: string;
  onFileChange: (file: ExcelFile | null) => void;
  onSheetChange: (name: string) => void;
}

export default function FileSelect({ file, sheetName, onFileChange, onSheetChange }: FileSelectProps) {
  const sheets = file ? getSheetNames(file.workbook) : [];

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
      showToast(`文件打开失败: ${msg}`, 'error');
    }
  }

  return (
    <>
      <div className="file-display">
        <div className="file-icon" style={{ background: '#34c759' }}>
          <FileSpreadsheet size={20} color="white" strokeWidth={1.5} />
        </div>
        <div className="file-info">
          <div className="file-name">{file ? file.name : '未选择文件'}</div>
          <div className="file-path">{file ? file.path : '支持 .xlsx 格式'}</div>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" onClick={handleOpen}>打开</button>
        {file && (
          <button className="btn" style={{ marginLeft: 'auto', color: 'var(--red)' }} onClick={() => onFileChange(null)}>
            清空
          </button>
        )}
      </div>

      {file && sheets.length > 0 && (
        <div className="form-group">
          <label>工作表</label>
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
