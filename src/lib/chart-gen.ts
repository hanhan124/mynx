import { Command } from "@tauri-apps/plugin-shell";

export interface ChartGenResult {
  ok: boolean;
  error?: string;
}

export async function generateVbsCharts(
  excelPath: string,
  geneNames: string[],
  repeatCount: number
): Promise<ChartGenResult> {
  const escapedPath = excelPath.replace(/\\/g, "\\\\").replace(/"/g, '""');

  const chartBlocks: string[] = [];
  let yPos = 20;

  for (const gene of geneNames) {
    const safeName = gene.replace(/"/g, '""');

    chartBlocks.push(`
    ' Chart for ${gene}
    Set co = ws.ChartObjects.Add(10, ${yPos}, 400, 300)
    With co.Chart
      .ChartType = 51
      .HasLegend = False
      .HasTitle = True
      .ChartTitle.Text = "${safeName}"
      .ChartTitle.Font.Italic = True

      With .Axes(xlCategory, xlPrimary)
        .TickLabels.Orientation = 45
      End With

      With .Axes(xlValue, xlPrimary)
        .HasTitle = True
        .AxisTitle.Text = "Normalize to TBP"
        .HasMajorGridlines = False
      End With

      Set cs = .SeriesCollection.NewSeries
      cs.XValues = ws.Range("F2:F" & lastRow)
      cs.Values = ws.Range("C2:C" & lastRow)
      cs.Format.Fill.ForeColor.RGB = RGB(30, 142, 62)
      cs.Format.Line.ForeColor.RGB = RGB(0, 0, 0)
      cs.Format.Line.Weight = 1`);

    if (repeatCount > 1) {
      chartBlocks.push(`
      ' Error bars from Stdev column
      cs.HasErrorBars = True
      cs.ErrorBar Include:=xlBoth, EndStyle:=xlNoCap, Amount:=ws.Range("E2:E" & lastRow)`);
    }

    chartBlocks.push(`
    End With
    Set co = Nothing
    `);

    yPos += 340;
  }

  const vbsScript = `
Dim xlApp, wb, ws
Set xlApp = CreateObject("Excel.Application")
xlApp.Visible = False
Set wb = xlApp.Workbooks.Open("${escapedPath}")
Set ws = wb.Sheets(1)

lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row

Const xlCategory = 1
Const xlValue = 2
Const xlPrimary = 1
Const xlY = -4142
Const xlBoth = 1
Const xlNoCap = -4142

${chartBlocks.join("\n")}

wb.Save
wb.Close False
Set ws = Nothing
Set wb = Nothing
xlApp.Quit
Set xlApp = Nothing
`.trim();

  const dir = excelPath.replace(/[\\/][^\\/]+$/, "");
  const vbsPath = dir + "\\chart_gen.vbs";

  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(vbsPath, new TextEncoder().encode(vbsScript));

  try {
    const output = await Command.create("cmd", [
      "/c",
      "cscript",
      "//Nologo",
      vbsPath,
    ]).execute();

    if (output.code !== 0) {
      return { ok: false, error: output.stderr || "VBS script failed" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
