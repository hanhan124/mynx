const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let isAlwaysOnTop = false;
const configPath = path.join(app.getPath('userData'), 'config.json');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = { info: () => {}, warn: () => {}, error: () => {} };

function loadConfig() {
  try { if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
  return { theme: 'light', alwaysOnTop: false };
}
function saveConfig(config) { try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); } catch (e) {} }

function createWindow() {
  const config = loadConfig();
  isAlwaysOnTop = config.alwaysOnTop || false;
  mainWindow = new BrowserWindow({
    width: 960, height: 680, minWidth: 720, minHeight: 480,
    frame: false, transparent: false, backgroundColor: '#1c1c1e',
    show: false,
    alwaysOnTop: isAlwaysOnTop,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      v8CacheOptions: 'code',
      spellcheck: false
    },
    icon: path.join(__dirname, 'icon.png'), title: 'ToolBox'
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window-close', () => mainWindow.close());
ipcMain.on('toggle-always-on-top', (event) => {
  isAlwaysOnTop = !isAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isAlwaysOnTop);
  const config = loadConfig(); config.alwaysOnTop = isAlwaysOnTop; saveConfig(config);
  event.reply('always-on-top-changed', isAlwaysOnTop);
});
ipcMain.handle('get-always-on-top', () => isAlwaysOnTop);
ipcMain.handle('get-theme', () => loadConfig().theme);
ipcMain.on('set-theme', (event, theme) => { const config = loadConfig(); config.theme = theme; saveConfig(config); });
ipcMain.on('open-website', () => shell.openExternal('https://www.fanguanghan.homes'));

autoUpdater.on('checking-for-update', () => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'checking' });
});
autoUpdater.on('update-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'available', version: info.version });
});
autoUpdater.on('update-not-available', () => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'up-to-date' });
});
autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'downloading', percent: Math.round(progress.percent) });
});
autoUpdater.on('update-downloaded', () => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'downloaded' });
});
autoUpdater.on('error', () => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'error' });
});

ipcMain.handle('check-update', async () => {
  try { await autoUpdater.checkForUpdates(); } catch (e) {}
});
ipcMain.handle('download-update', async () => {
  try { await autoUpdater.downloadUpdate(); } catch (e) {}
});
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

const getXLSX = (() => { let m; return () => (m = m || require('xlsx')); })();
const getExcelJS = (() => { let m; return () => (m = m || require('exceljs')); })();

ipcMain.handle('open-excel', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Excel 文件', filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }], properties: ['openFile']
  });
  if (result.canceled) return null;
  return result.filePaths;
});

ipcMain.handle('read-excel', async (event, filePath) => {
  try {
    const XLSX = getXLSX();
    const workbook = XLSX.readFile(filePath);
    const sheets = {};
    workbook.SheetNames.forEach(name => { sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }); });
    return { success: true, sheetNames: workbook.SheetNames, sheets };
  } catch (error) { return { success: false, error: error.message }; }
});

async function autoCreateCharts(filePath, numRepeats) {
  if (process.platform !== 'win32') return { success: false, reason: 'not_windows' };
  const { execSync } = require('child_process');
  const os = require('os');
  try {
    const vbsPath = path.join(os.tmpdir(), `qpcr_charts_${Date.now()}.vbs`);
    const vbsCode = `On Error Resume Next
Dim xlApp, xlBook, ws, chartObj, lastRow, chartTableStart, i, geneName
Dim successCount, failCount, lastDataRow

Set xlApp = CreateObject("Excel.Application")
xlApp.Visible = False
xlApp.DisplayAlerts = False
xlApp.ScreenUpdating = False

Set xlBook = xlApp.Workbooks.Open("${filePath.replace(/\\/g, '\\\\')}")
If Err.Number <> 0 Then
    WScript.Quit 1
End If

successCount = 0
failCount = 0

For Each ws In xlBook.Worksheets
    If ws.Name <> "Summary_All_Genes" And ws.Name <> "Transformed Data" Then
        geneName = ws.Name
        chartTableStart = 0
        lastDataRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
        
        For i = 1 To lastDataRow
            If Trim(ws.Cells(i, 1).Value) = "Group_Name" Then
                chartTableStart = i
                Exit For
            End If
        Next
        
        If chartTableStart > 0 Then
            lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
            
            On Error Resume Next
            ws.ChartObjects.Delete
            On Error GoTo 0
            
            Set chartObj = ws.ChartObjects.Add(10, 20, 400, 300)
            
            With chartObj.Chart
                .ChartType = 51
                .SetSourceData ws.Range(ws.Cells(chartTableStart + 1, 1), ws.Cells(lastRow, 2))
                .PlotArea.Format.Line.Visible = 0
                .ChartArea.Format.Line.Visible = 0
                .HasTitle = True
                .ChartTitle.Text = geneName
                .ChartTitle.Font.Italic = True
                .HasLegend = False
                
                With .Axes(1)
                    .TickLabels.Orientation = 45
                End With
                
                With .Axes(2)
                    .HasTitle = True
                    .AxisTitle.Text = "Normalize to TBP"
                    .HasMajorGridlines = False
                End With
                
                If .SeriesCollection.Count > 0 Then
                    Dim s
                    Set s = .SeriesCollection(1)
                    s.Format.Fill.ForeColor.RGB = 12419407
                    s.Format.Line.ForeColor.RGB = 0
                    If ${numRepeats} > 1 Then
                        s.HasErrorBars = True
                        s.ErrorBar 1, 1, -4114, _
                            ws.Range(ws.Cells(chartTableStart + 1, 3), ws.Cells(lastRow, 3)), _
                            ws.Range(ws.Cells(chartTableStart + 1, 3), ws.Cells(lastRow, 3))
                    End If
                End If
            End With
            
            successCount = successCount + 1
        Else
            failCount = failCount + 1
        End If
    End If
Next

xlBook.Save
xlBook.Close
xlApp.Quit

Set chartObj = Nothing
Set xlBook = Nothing
Set xlApp = Nothing

WScript.Echo "SUCCESS:" & successCount
`;
    fs.writeFileSync(vbsPath, vbsCode, 'utf8');
    const output = execSync(`cscript //nologo "${vbsPath}"`, { timeout: 120000, encoding: 'utf8', stdio: 'pipe' });
    try { fs.unlinkSync(vbsPath); } catch (e) {}
    if (output && output.includes('SUCCESS:')) {
      return { success: true, chartsCreated: parseInt(output.split(':')[1]) };
    }
    return { success: false, reason: 'execution_failed' };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

async function saveAndCreateCharts(workbook, filePath, numRepeats) {
  try {
    await workbook.xlsx.writeFile(filePath);
    return await autoCreateCharts(filePath, numRepeats);
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

ipcMain.handle('data-transform', async (event, { filePath, sheetName }) => {
  try {
    const XLSX = getXLSX();
    const ExcelJS = getExcelJS();
    const origWb = XLSX.readFile(filePath);
    const ws = origWb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (data.length < 2) throw new Error('数据行不足');

    const headers = data[0].map(h => String(h || '').trim().toLowerCase());
    let targetIdx = -1, sampleIdx = -1, cqIdx = -1;
    if (headers.length >= 6) {
      const col2 = headers[2] || '';
      if (col2.includes('target') || col2.includes('gene') || col2.includes('基因')) { targetIdx = 2; sampleIdx = 4; cqIdx = 5; }
    }
    if (targetIdx === -1) {
      targetIdx = headers.findIndex(h => h === 'target' || h === 'gene' || h === '基因');
      sampleIdx = headers.findIndex(h => h === 'sample' || h === 'group' || h === '样本' || h === '分组');
      cqIdx = headers.findIndex(h => h === 'cq' || h === 'ct');
    }
    if (targetIdx === -1) throw new Error('未找到 Target 列');
    if (sampleIdx === -1) throw new Error('未找到 Sample 列');
    if (cqIdx === -1) throw new Error('未找到 Cq 列');

    const sampleData = {}, geneSet = new Set(), sampleOrder = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const sample = String(row[sampleIdx] || '').trim();
      const target = String(row[targetIdx] || '').trim();
      const cq = row[cqIdx];
      if (!sample || !target) continue;
      if (!sampleData[sample]) { sampleData[sample] = {}; sampleOrder.push(sample); }
      if (!sampleData[sample][target]) sampleData[sample][target] = [];
      const val = parseFloat(cq);
      if (!isNaN(val) && cq !== '' && cq !== null && String(cq) !== 'NaN') {
        sampleData[sample][target].push({ value: val, missing: false });
      } else {
        sampleData[sample][target].push({ value: null, missing: true });
      }
      geneSet.add(target);
    }

    const geneOrder = Array.from(geneSet), modifiedCells = [];
    const outputData = [['num', 'group name', ...geneOrder]];
    let rowNum = 1;
    for (const sample of sampleOrder) {
      const maxReps = Math.max(...Object.values(sampleData[sample]).map(arr => arr.length));
      for (let j = 0; j < maxReps; j++) {
        const row = [rowNum, sample];
        for (let g = 0; g < geneOrder.length; g++) {
          const gene = geneOrder[g], values = sampleData[sample][gene] || [];
          let cellValue = '', isModified = false;
          if (j < values.length) {
            const item = values[j];
            if (item.missing) {
              const allMissing = values.every(v => v.missing);
              if (allMissing) { cellValue = 50; isModified = true; }
              else { const fv = values.find(v => !v.missing); cellValue = fv ? fv.value : ''; isModified = true; }
            } else { cellValue = item.value; }
          } else {
            const allMissing = values.every(v => v.missing);
            if (allMissing && values.length > 0) { cellValue = 50; isModified = true; }
            else { const fv = values.find(v => !v.missing); cellValue = fv ? fv.value : ''; if (fv) isModified = true; }
          }
          row.push(cellValue);
          if (isModified) modifiedCells.push({ row: rowNum, col: g + 3 });
        }
        outputData.push(row);
        rowNum++;
      }
    }

    const excelWb = new ExcelJS.Workbook();
    for (const name of origWb.SheetNames) {
      const origData = XLSX.utils.sheet_to_json(origWb.Sheets[name], { header: 1, defval: '' });
      const newSheet = excelWb.addWorksheet(name);
      for (const row of origData) { newSheet.addRow(row); }
    }
    const existing = excelWb.getWorksheet('Transformed Data');
    if (existing) excelWb.removeWorksheet(existing.id);
    const ts = excelWb.addWorksheet('Transformed Data');
    ts.addRow(outputData[0]);
    ts.getRow(1).font = { bold: true };
    for (let i = 1; i < outputData.length; i++) {
      ts.addRow(outputData[i]);
      const mCols = modifiedCells.filter(m => m.row === outputData[i][0]).map(m => m.col);
      if (mCols.length > 0) {
        const row = ts.getRow(i + 1);
        for (const c of mCols) { row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; }
      }
    }
    ts.columns.forEach((col, i) => { col.width = i < 2 ? 15 : 12; });
    await excelWb.xlsx.writeFile(filePath);
    return {
      success: true,
      message: `转换完成：${sampleOrder.length} 个样本，${geneOrder.length} 个基因${modifiedCells.length > 0 ? `，${modifiedCells.length} 个缺失值已标黄` : ''}`,
      sheetName: 'Transformed Data', data: outputData, modifiedCells,
      stats: { samples: sampleOrder.length, genes: geneOrder.length, rows: outputData.length - 1, modified: modifiedCells.length }
    };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('qpcr-calculate', async (event, { filePath, numRepeats, refGene }) => {
  try {
    const XLSX = getXLSX();
    const ExcelJS = getExcelJS();
    const origWb = XLSX.readFile(filePath);
    const srcSheetName = 'Transformed Data';
    if (!origWb.SheetNames.includes(srcSheetName)) throw new Error('未找到 Transformed Data');
    const wsSrc = origWb.Sheets[srcSheetName];
    const srcData = XLSX.utils.sheet_to_json(wsSrc, { header: 1, defval: '' });
    if (srcData.length < 2) throw new Error('数据不足');
    const headers = srcData[0].map(h => String(h || '').trim());
    const refCol = headers.indexOf(refGene);
    if (refCol === -1) throw new Error(`未找到参考基因 [${refGene}]`);
    const groupCol = 1;
    const geneNames = headers.slice(3).filter(h => { const name = String(h || '').trim(); return name && name !== refGene; });
    if (geneNames.length === 0) throw new Error('未找到目标基因');

    const excelWb = new ExcelJS.Workbook();
    await excelWb.xlsx.readFile(filePath);
    const sheetsToRemove = [];
    excelWb.eachSheet((sheet) => {
      const name = sheet.name;
      if (name === 'Summary_All_Genes' || name === 'Transformed Data') return;
      if (geneNames.some(g => name === g.substring(0, 31)) || name.endsWith('_chart')) sheetsToRemove.push(sheet.id);
    });
    sheetsToRemove.forEach(id => excelWb.removeWorksheet(id));

    const summarySheet = excelWb.addWorksheet('Summary_All_Genes');
    const summaryHeader = ['Gene', 'Group_Name'];
    for (let r = 1; r <= numRepeats; r++) summaryHeader.push(`Repeat${r}`);
    summaryHeader.push('Average', 'Stdev');
    summarySheet.addRow(summaryHeader);
    summarySheet.getRow(1).font = { bold: true };

    const geneResults = {};

    for (const gene of geneNames) {
      const targetCol = headers.indexOf(gene);
      if (targetCol === -1) continue;
      const sheetData = [[refGene, gene, 'Relative Expression', 'Average', 'Stdev', 'Group_Name']];
      const groupStats = {}, groupOrder = [];

      for (let i = 1; i < srcData.length; i += numRepeats) {
        const groupName = String(srcData[i][groupCol] || '').trim();
        if (!groupName) continue;
        const reValues = [];
        let allNumeric = true;
        for (let r = 0; r < numRepeats; r++) {
          const currRow = i + r;
          if (currRow >= srcData.length) { allNumeric = false; break; }
          const refVal = parseFloat(srcData[currRow][refCol]);
          const targetVal = parseFloat(srcData[currRow][targetCol]);
          if (isNaN(refVal) || isNaN(targetVal)) { allNumeric = false; break; }
          reValues.push(Math.pow(2, -(targetVal - refVal)));
          sheetData.push([refVal, targetVal, Math.pow(2, -(targetVal - refVal)), '', '', groupName]);
        }
        if (allNumeric && reValues.length > 0) {
          const avg = reValues.reduce((a, b) => a + b, 0) / reValues.length;
          const sd = reValues.length >= 2 ? Math.sqrt(reValues.reduce((s, v) => s + (v - avg) ** 2, 0) / (reValues.length - 1)) : 0;
          const baseRow = sheetData.length - reValues.length + 1;
          sheetData[baseRow - 1][3] = avg;
          sheetData[baseRow - 1][4] = sd;
          if (!groupStats[groupName]) { groupStats[groupName] = { values: reValues, avg, sd }; groupOrder.push(groupName); }
        }
      }

      for (const grp of groupOrder) {
        const stats = groupStats[grp];
        summarySheet.addRow([gene, grp, ...stats.values, stats.avg, stats.sd]);
      }

      const sheetName = gene.substring(0, 31);
      const geneSheet = excelWb.addWorksheet(sheetName);
      for (const row of sheetData) { geneSheet.addRow(row); }
      geneSheet.getRow(1).font = { bold: true };
      geneSheet.columns.forEach(col => { col.width = 14; });

      const chartTableStart = sheetData.length + 2;
      geneSheet.getCell(`A${chartTableStart}`).value = 'Group_Name';
      geneSheet.getCell(`B${chartTableStart}`).value = 'Average';
      geneSheet.getCell(`C${chartTableStart}`).value = 'Stdev';
      geneSheet.getCell(`A${chartTableStart}`).font = { bold: true };
      geneSheet.getCell(`B${chartTableStart}`).font = { bold: true };
      geneSheet.getCell(`C${chartTableStart}`).font = { bold: true };

      for (let i = 0; i < groupOrder.length; i++) {
        const rowIdx = chartTableStart + 1 + i;
        const stats = groupStats[groupOrder[i]];
        geneSheet.getCell(`A${rowIdx}`).value = groupOrder[i];
        geneSheet.getCell(`B${rowIdx}`).value = stats.avg;
        geneSheet.getCell(`C${rowIdx}`).value = stats.sd;
      }

      geneResults[gene] = { sheetData, chartData: [] };
    }

    summarySheet.columns.forEach(col => { col.width = 15; });

    const chartResult = await saveAndCreateCharts(excelWb, filePath, numRepeats);
    let chartMessage = chartResult.success
      ? `完成！已自动在 ${chartResult.chartsCreated} 个基因 Sheet 中生成图表`
      : '数据计算完成，但图表自动生成失败';

    return {
      success: true,
      message: `处理了 ${geneNames.length} 个基因，重复数=${numRepeats}。\n\n${chartMessage}`,
      geneResults, summaryData: [],
      stats: { genes: geneNames.length, repeats: numRepeats, refGene },
      chartsCreated: chartResult.success ? chartResult.chartsCreated : 0
    };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('save-excel', async (event, { filePath }) => {
  try {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: '保存', defaultPath: filePath || 'output.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (!saveResult.canceled) { fs.copyFileSync(filePath, saveResult.filePath); return { success: true, filePath: saveResult.filePath }; }
    return { success: false, error: '取消' };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择包含 TIFF 文件的文件夹', properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('tiff-convert', async (event, options) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const { folderPath, addLabel, font, fontSize, fontBold, fontItalic,
            marginX, marginY, paddingX, paddingY, bgAlpha, quality } = options;

    if (!fs.existsSync(folderPath)) throw new Error('文件夹不存在');
    const files = fs.readdirSync(folderPath).filter(f => /\.tiff?$/i.test(f));
    if (files.length === 0) throw new Error('未找到 .tif/.tiff 文件');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace(/[T]/, '_');
    const outputDir = path.join(folderPath, `JPG_output_${timestamp}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    let psScript = `Add-Type -AssemblyName System.Drawing\n`;
    psScript += `$FontName = '${font}'\n`;
    psScript += `$FontSize = ${fontSize}\n`;
    psScript += `$FontBold = $${fontBold}\n`;
    psScript += `$FontItalic = $${fontItalic}\n`;
    psScript += `$MarginX = ${marginX}\n`;
    psScript += `$MarginY = ${marginY}\n`;
    psScript += `$PaddingX = ${paddingX}\n`;
    psScript += `$PaddingY = ${paddingY}\n`;
    psScript += `$TextColor = [System.Drawing.Color]::White\n`;
    psScript += `$BackgroundColor = [System.Drawing.Color]::FromArgb(${bgAlpha}, 90, 90, 90)\n`;
    psScript += `$JpegQuality = ${quality}\n`;
    psScript += `$OutputDir = '${outputDir.replace(/\\/g, '\\\\')}'\n`;
    psScript += `$AddFileName = $${addLabel}\n`;
    psScript += `$jpgCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }\n`;
    psScript += `$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)\n`;
    psScript += `$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$JpegQuality)\n`;
    psScript += `$ok = 0; $failed = 0\n`;
    psScript += `$Files = Get-ChildItem -LiteralPath '${folderPath.replace(/\\/g, '\\\\')}' -File | Where-Object { $_.Extension -match '^\\.tiff?$' }\n`;
    psScript += `foreach ($file in $Files) {\n`;
    psScript += `  $image = $null; $bitmap = $null; $graphics = $null; $font = $null; $textBrush = $null; $bgBrush = $null\n`;
    psScript += `  try {\n`;
    psScript += `    $image = [System.Drawing.Image]::FromFile($file.FullName)\n`;
    psScript += `    $bitmap = New-Object System.Drawing.Bitmap($image.Width, $image.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)\n`;
    psScript += `    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)\n`;
    psScript += `    $graphics.Clear([System.Drawing.Color]::White)\n`;
    psScript += `    $graphics.DrawImage($image, 0, 0, $image.Width, $image.Height)\n`;
    psScript += `    if ($AddFileName) {\n`;
    psScript += `      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias\n`;
    psScript += `      $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit\n`;
    psScript += `      $style = [System.Drawing.FontStyle]::Regular\n`;
    psScript += `      if ($FontBold) { $style = $style -bor [System.Drawing.FontStyle]::Bold }\n`;
    psScript += `      if ($FontItalic) { $style = $style -bor [System.Drawing.FontStyle]::Italic }\n`;
    psScript += `      $font = New-Object System.Drawing.Font($FontName, $FontSize, $style, [System.Drawing.GraphicsUnit]::Pixel)\n`;
    psScript += `      $textBrush = New-Object System.Drawing.SolidBrush($TextColor)\n`;
    psScript += `      $bgBrush = New-Object System.Drawing.SolidBrush($BackgroundColor)\n`;
    psScript += `      $label = $file.BaseName\n`;
    psScript += `      $maxWidth = [single]($image.Width - $MarginX - $PaddingX)\n`;
    psScript += `      $stringFormat = New-Object System.Drawing.StringFormat\n`;
    psScript += `      $stringFormat.FormatFlags = [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces\n`;
    psScript += `      $textLayoutRect = New-Object System.Drawing.RectangleF([single]$MarginX, [single]$MarginY, [single]$maxWidth, [single]$image.Height)\n`;
    psScript += `      $textSize = $graphics.MeasureString($label, $font, [single]$maxWidth, $stringFormat)\n`;
    psScript += `      $bgRect = New-Object System.Drawing.RectangleF([single]$MarginX, [single]$MarginY, [single]([Math]::Min($textSize.Width + 2 * $PaddingX, $maxWidth)), [single]($textSize.Height + 2 * $PaddingY))\n`;
    psScript += `      $textPoint = New-Object System.Drawing.PointF([single]($MarginX + $PaddingX), [single]($MarginY + $PaddingY))\n`;
    psScript += `      $graphics.FillRectangle($bgBrush, $bgRect)\n`;
    psScript += `      $graphics.DrawString($label, $font, $textBrush, $textLayoutRect, $stringFormat)\n`;
    psScript += `    }\n`;
    psScript += `    $outPath = Join-Path $OutputDir ($file.BaseName + ".jpg")\n`;
    psScript += `    $bitmap.Save($outPath, $jpgCodec, $encoderParams)\n`;
    psScript += `    $ok++\n`;
    psScript += `  } catch { $failed++ }\n`;
    psScript += `  finally {\n`;
    psScript += `    if ($graphics) { $graphics.Dispose() }\n`;
    psScript += `    if ($bitmap) { $bitmap.Dispose() }\n`;
    psScript += `    if ($image) { $image.Dispose() }\n`;
    psScript += `    if ($font) { $font.Dispose() }\n`;
    psScript += `    if ($textBrush) { $textBrush.Dispose() }\n`;
    psScript += `    if ($bgBrush) { $bgBrush.Dispose() }\n`;
    psScript += `  }\n`;
    psScript += `}\n`;
    psScript += `Write-Output "RESULT:$ok|$failed"`;

    const psPath = path.join(os.tmpdir(), `tiff_convert_${Date.now()}.ps1`);
    fs.writeFileSync(psPath, psScript, 'utf8');
    try {
      const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, {
        timeout: 300000, encoding: 'utf8', stdio: 'pipe'
      });
      if (output && output.includes('RESULT:')) {
        const match = output.match(/RESULT:(\d+)\|(\d+)/);
        if (match) {
          return { success: true, message: `成功转换 ${match[1]} 个文件${parseInt(match[2]) > 0 ? `，${match[2]} 个失败` : ''}。输出目录：${outputDir}`, successCount: parseInt(match[1]), failCount: parseInt(match[2]), outputDir };
        }
      }
      return { success: false, error: '转换执行失败' };
    } finally {
      try { fs.unlinkSync(psPath); } catch (e) {}
    }
  } catch (error) { return { success: false, error: error.message }; }
});
