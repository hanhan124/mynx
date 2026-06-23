import { Command } from "@tauri-apps/plugin-shell";

async function getPlatform(): Promise<string> {
  try {
    const { platform } = await import("@tauri-apps/plugin-os");
    return await platform();
  } catch {
    return navigator.userAgent.toLowerCase().includes("mac") ? "darwin" : "win32";
  }
}

export interface ChartGenResult {
  ok: boolean;
  error?: string;
  chartsCreated?: number;
  failedCount?: number;
}

// resultPath is the absolute path the VBS will write its ASCII-only outcome to.
// We deliberately AVOID putting localized text (Err.Description) into the result,
// because cscript runs under the system ANSI codepage (GBK on zh-CN Windows) and
// the Tauri shell channel decodes stdout as strict UTF-8 → "invalid utf-8" errors.
// The result file carries only ASCII codes; the frontend maps them to messages.
function buildVbsScript(resultPath: string): string {
  // Double backslashes for the VBS string literal.
  const escapedPath = resultPath.replace(/\\/g, "\\\\");
  return `On Error Resume Next
Dim xlApp, xlBook, ws, chartObj, lastRow, chartTableStart, i, geneName
Dim successCount, failCount, lastDataRow, s, r, n
Dim fso, resultFile
Dim resultPath
resultPath = "${escapedPath}"

' Write the outcome as a fresh ASCII-only file. We never put localized text
' (Err.Description) in here to avoid codepage issues on the JS side.
Sub WriteResult(txt)
  Set fso = CreateObject("Scripting.FileSystemObject")
  Set resultFile = fso.CreateTextFile(resultPath, True)
  resultFile.WriteLine txt
  resultFile.Close
End Sub

Set xlApp = CreateObject("Excel.Application")
If Err.Number <> 0 Then
  Err.Clear
  WriteResult "ERROR:NO_EXCEL"
  WScript.Quit 1
End If

' Initialize FSO early so the diagnostic dump (which runs before the final
' WriteResult) can use it. On Error Resume Next is active so this is safe.
Set fso = CreateObject("Scripting.FileSystemObject")

xlApp.Visible = False
xlApp.DisplayAlerts = False
xlApp.ScreenUpdating = False

Set xlBook = xlApp.Workbooks.Open(WScript.Arguments(0))
If Err.Number <> 0 Then
  Err.Clear
  xlApp.Quit
  WriteResult "ERROR:OPEN_FAILED"
  WScript.Quit 1
End If

successCount = 0
failCount = 0
n = CInt(WScript.Arguments(1))

' On Error Resume Next stays ACTIVE for the whole loop so a single bad sheet
' increments failCount instead of aborting the script.
For Each ws In xlBook.Worksheets
  If ws.Name = "Summary_All_Genes" Or ws.Name = "Transformed Data" Or Left(ws.Name, 5) = "Sheet" Then
    ' protected / empty sheets are skipped (not failures)
  Else
    geneName = ws.Name
    chartTableStart = 0
    lastDataRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
    If Err.Number <> 0 Then Err.Clear

    ' Use the UsedRange as a more reliable upper bound (ExcelJS sometimes leaves
    ' End(xlUp) pointing below the Group_Name header).
    Dim usedLast
    usedLast = ws.UsedRange.Rows.Count + ws.UsedRange.Row - 1
    If usedLast > lastDataRow Then lastDataRow = usedLast
    If Err.Number <> 0 Then Err.Clear

    For i = 1 To lastDataRow
      If Trim(CStr(ws.Cells(i, 1).Value)) = "Group_Name" Then
        chartTableStart = i
        Exit For
      End If
    Next

    If chartTableStart > 0 Then
      lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
      If Err.Number <> 0 Then Err.Clear

      ws.ChartObjects.Delete
      If Err.Number <> 0 Then Err.Clear

      Set chartObj = ws.ChartObjects.Add(10, 20, 420, 280)
      If Err.Number <> 0 Then
        Err.Clear
        failCount = failCount + 1
      Else
        ' Chart object created — count it as success now.
        ' All formatting below is best-effort (On Error Resume Next is active).
        successCount = successCount + 1

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
            Set s = .SeriesCollection(1)
            s.Format.Fill.ForeColor.RGB = 12419407
            s.Format.Line.ForeColor.RGB = 0
            If n > 1 Then
              s.HasErrorBars = True
              Set r = ws.Range(ws.Cells(chartTableStart + 1, 3), ws.Cells(lastRow, 3))
              s.ErrorBar 1, 1, -4114, r, r
            End If
          End If
        End With

        Err.Clear
      End If
    Else
      failCount = failCount + 1
    End If
  End If
Next

xlBook.Save
xlBook.Close
xlApp.Quit

WriteResult "RESULT:" & successCount & "|" & failCount
`;
}

function buildAppleScript(
  excelPath: string,
  repeatCount: number,
  resultPath: string
): string {
  // macOS AppleScript cannot easily emit to stdout reliably for our purposes,
  // so this branch writes its outcome to a result file (best-effort; the app
  // is Windows-primary). The Windows branch (above) is the maintained path.
  const escapedPath = excelPath.replace(/"/g, '\\"');
  const escapedResult = resultPath.replace(/"/g, '\\"');
  return `set resultPath to "${escapedResult}"

tell application "Microsoft Excel"
  activate
  set xlFile to POSIX file "${escapedPath}"
  open xlFile
  set wb to active workbook

  set successCount to 0
  set failCount to 0
  set n to ${repeatCount}

  repeat with ws in (worksheets of wb)
    set wsName to name of ws
    if wsName is "Summary_All_Genes" or wsName is "Transformed Data" then
      -- protected sheets are skipped (not failures)
    else
      set geneName to wsName
      set chartTableStart to 0
      set lastDataRow to (count of rows of used range of ws)

      repeat with i from 1 to lastDataRow
        set cellVal to (value of cell i column 1 of ws) as text
        if cellVal is "Group_Name" then
          set chartTableStart to i
          exit repeat
        end if
      end repeat

      if chartTableStart > 0 then
        set lastRow to (count of rows of used range of ws)

        repeat while (count of chart objects of ws) > 0
          delete chart object 1 of ws
        end repeat

        set chartObj to make new chart object at end of chart objects of ws with properties {left:10, top:20, width:420, height:280}

        set chartSourceRange to range (("A" & (chartTableStart + 1)) & ":B" & lastRow) of ws
        set source data of chart of chartObj to chartSourceRange

        set chart type of chart of chartObj to column clustered
        set has title of chart of chartObj to true
        set title text of chart of chartObj to geneName
        set italic of title font of chart of chartObj to true
        set has legend of chart of chartObj to false

        set tickOrientation of tick labels of axis 1 of chart of chartObj to -45

        set has title of axis 2 of chart of chartObj to true
        set title text of axis 2 of chart of chartObj to "Normalize to TBP"
        set has major gridlines of axis 2 of chart of chartObj to false

        if (count of series of chart of chartObj) > 0 then
          set s to series 1 of chart of chartObj
          set fill foreground color of s to 12419407
          set line foreground color of s to 0

          if n > 1 then
            set has error bars of s to true
            set errorBar range of s to range (("C" & (chartTableStart + 1)) & ":C" & lastRow) of ws
          end if
        end if

        set successCount to successCount + 1
      else
        set failCount to failCount + 1
      end if
    end if
  end repeat

  save wb
  close wb
end tell

set f to open for access file resultPath with write permission
set eof of f to 0
write f "RESULT:" & successCount & "|" & failCount
close access f
`;
}

function parseChartResult(resultText: string): ChartGenResult {
  const trimmed = (resultText || "").trim();
  // Find the LAST RESULT:/ERROR: line (Excel/cscript may print warnings before it).
  const lines = trimmed.split(/\r?\n/);
  let resultLine: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l.startsWith("RESULT:") || l.startsWith("ERROR:")) {
      resultLine = l;
      break;
    }
  }

  if (!resultLine) {
    return {
      ok: false,
      error: trimmed
        ? `脚本未返回结果。输出：\n${trimmed.slice(0, 800)}`
        : "脚本未返回任何输出（可能未安装 Excel 或被拦截）",
    };
  }

  if (resultLine.startsWith("RESULT:")) {
    const payload = resultLine.slice("RESULT:".length);
    const [okStr, failStr] = payload.split("|");
    const created = parseInt(okStr, 10) || 0;
    const failed = parseInt(failStr, 10) || 0;
    return { ok: true, chartsCreated: created, failedCount: failed };
  }

  // ERROR: line — map ASCII code to a readable Chinese message.
  const code = resultLine.slice("ERROR:".length).trim();
  const messages: Record<string, string> = {
    NO_EXCEL: "未检测到 Excel（请确认已安装 Microsoft Excel）",
    OPEN_FAILED: "无法打开 Excel 文件（文件可能被占用或损坏）",
  };
  return { ok: false, error: messages[code] || code };
}

async function readResultFile(
  readFile: (path: string) => Promise<Uint8Array>,
  resultPath: string
): Promise<string> {
  try {
    const buf = await readFile(resultPath);
    return new TextDecoder().decode(buf).trim();
  } catch {
    return "";
  }
}

export async function generateVbsCharts(
  excelPath: string,
  repeatCount: number
): Promise<ChartGenResult> {
  const currentPlatform = await getPlatform();
  const isMac = currentPlatform === "darwin";
  const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
  const localDataDir = await appLocalDataDir();
  const { writeFile, readFile, remove } = await import("@tauri-apps/plugin-fs");
  const textEncoder = new TextEncoder();

  const cleanupFiles: string[] = [];

  // Single shared result file — both branches write their ASCII-only outcome here.
  // We deliberately do NOT read process stdout: on zh-CN Windows, cscript/powershell
  // emit localized text in the system ANSI codepage (GBK), and the Tauri shell
  // channel decodes stdout as strict UTF-8, which throws "invalid utf-8 sequence".
  // Routing through a file sidesteps the codepage problem entirely.
  const resultPath = await join(localDataDir, "chart_result.txt");
  cleanupFiles.push(resultPath);

  try {
    if (isMac) {
      const scriptContent = buildAppleScript(excelPath, repeatCount, resultPath);
      const utf8Bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
      const contentBytes = textEncoder.encode(scriptContent);
      const bytes = new Uint8Array(utf8Bom.length + contentBytes.length);
      bytes.set(utf8Bom, 0);
      bytes.set(contentBytes, utf8Bom.length);

      const dir = excelPath.replace(/[\\/][^\\/]+$/, "");
      const scriptPath = dir + "/chart_gen.scpt";
      cleanupFiles.push(scriptPath);
      await writeFile(scriptPath, bytes);

      const cmdPromise = Command.create("osascript", [scriptPath]).execute();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("执行超时 (120s)")), 120000)
      );
      await Promise.race([cmdPromise, timeoutPromise]);

      return parseChartResult(await readResultFile(readFile, resultPath));
    } else {
      // ---- Windows: VBS via cscript launched through a PowerShell wrapper ----
      const scriptContent = buildVbsScript(resultPath);
      const bytes = textEncoder.encode(scriptContent);

      const vbsPath = await join(localDataDir, "chart_gen.vbs");
      cleanupFiles.push(vbsPath);
      await writeFile(vbsPath, bytes);

      // PowerShell wrapper invokes cscript and DISCARDS its stdout/stderr
      // (> $null 2>&1) so no non-UTF-8 bytes reach the Tauri shell channel.
      // The VBS writes its ASCII result to resultPath; we read that instead.
      const psScript = `& cscript //Nologo "${vbsPath}" "${excelPath}" ${repeatCount} > $null 2>&1`;
      const psPath = await join(localDataDir, "chart_gen.ps1");
      cleanupFiles.push(psPath);
      await writeFile(psPath, textEncoder.encode(psScript));

      const execPromise = Command.create("powershell", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath
      ]).execute();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("执行超时 (120s)")), 120000)
      );

      let exitCode = 0;
      try {
        const output = await Promise.race([execPromise, timeoutPromise]);
        exitCode = output?.code ?? 0;
      } catch (err) {
        return { ok: false, error: String(err) };
      }

      const resultText = await readResultFile(readFile, resultPath);
      const parsed = parseChartResult(resultText);
      // If there's no usable result line AND the script exited non-zero,
      // report the exit code so the user has a clue.
      if (!parsed.ok && !resultText && exitCode !== 0) {
        return { ok: false, error: `脚本执行失败（退出码 ${exitCode}）` };
      }
      return parsed;
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    for (const f of cleanupFiles) {
      try { await remove(f); } catch { /* ignore cleanup errors */ }
    }
  }
}
