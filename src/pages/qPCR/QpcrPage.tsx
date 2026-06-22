import { useState } from 'react';
import FileSelect from './FileSelect';
import Transform from './Transform';
import Calculate from './Calculate';
import type { ExcelFile } from '../../lib/excel-io';

export default function QpcrPage() {
  const [file, setFile] = useState<ExcelFile | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [geneNames, setGeneNames] = useState<string[]>([]);

  return (
    <div className="qpcr-page">
      <FileSelect
        file={file}
        sheetName={sheetName}
        onFileChange={setFile}
        onSheetChange={setSheetName}
      />
      {file && sheetName && (
        <Transform
          workbook={file.workbook}
          sheetName={sheetName}
          onComplete={setGeneNames}
        />
      )}
      {file && geneNames.length > 0 && (
        <Calculate
          workbook={file.workbook}
          geneNames={geneNames}
        />
      )}
    </div>
  );
}
