import { invoke } from "@tauri-apps/api/core";

export interface ChartGenResult {
  success: boolean;
  chartsCreated?: number;
  reason?: string;
}

/**
 * Builds the VBScript that uses Excel COM automation to create
 * a native column chart in each gene sheet.
 *
 * The VBS iterates all worksheets, skips protected sheets
 * (Summary_All_Genes, Transformed Data, Sheet1), finds the
 * "Group_Name" summary table at the bottom of each gene sheet,
 * and creates a clustered column chart with error bars.
 */
function buildVbsScript(filePath: string, numRepeats: number): string {
  // VBS strings use double quotes — escape any embedded double quotes in the path
  const escapedPath = filePath.replace(/"/g, '""');
  const repeats = String(numRepeats);

  return `On Error Resume Next
Dim xlApp, xlBook, ws, chartObj, lastRow, chartTableStart, i, geneName, refGeneName
Dim successCount, failCount

Set xlApp = CreateObject("Excel.Application")
If Err.Number <> 0 Then
    WScript.Echo "ERROR:NO_EXCEL:" & Err.Description
    WScript.Quit 1
End If

xlApp.Visible = False
xlApp.DisplayAlerts = False
xlApp.ScreenUpdating = False

Set xlBook = xlApp.Workbooks.Open("${escapedPath}")
If Err.Number <> 0 Then
    WScript.Echo "ERROR:OPEN_FAILED:" & Err.Description
    xlApp.Quit
    WScript.Quit 1
End If

successCount = 0
failCount = 0

For Each ws In xlBook.Worksheets
    If ws.Name <> "Summary_All_Genes" And ws.Name <> "Transformed Data" And ws.Name <> "Sheet1" Then
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

            ' Read reference gene name from cell A1 (set by calculate step)
            refGeneName = CStr(ws.Cells(1, 1).Value)
            If refGeneName = "" Then refGeneName = "Ref Gene"

            ' Delete existing charts (may fail if none — safe to ignore)
            ws.ChartObjects.Delete

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
                    .AxisTitle.Text = "Normalize to " & refGeneName
                    .HasMajorGridlines = False
                End With

                If .SeriesCollection.Count > 0 Then
                    Dim s
                    Set s = .SeriesCollection(1)
                    s.Format.Fill.ForeColor.RGB = 12419407
                    s.Format.Line.ForeColor.RGB = 0
                    If ${repeats} > 1 Then
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

WScript.Echo "SUCCESS:" & successCount
`;
}

/**
 * Generates native Excel charts (one per gene sheet) by invoking
 * a Rust command that writes and executes a VBS script via cscript.
 *
 * The VBS script uses Excel COM automation to create clustered column
 * charts with error bars, matching the reference VBA macro approach.
 */
export async function generateVbsCharts(
  excelPath: string,
  repeatCount: number
): Promise<ChartGenResult> {
  try {
    const vbsCode = buildVbsScript(excelPath, repeatCount);
    const output = await invoke<string>("run_vbs_script", {
      vbsContent: vbsCode,
    });

    if (output.includes("SUCCESS:")) {
      const match = output.match(/SUCCESS:(\d+)/);
      const count = match ? parseInt(match[1], 10) : 0;
      return { success: true, chartsCreated: isNaN(count) ? 0 : count };
    }

    if (output.includes("ERROR:")) {
      return { success: false, reason: output.trim() };
    }

    return { success: false, reason: output.trim() || "unknown_error" };
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
