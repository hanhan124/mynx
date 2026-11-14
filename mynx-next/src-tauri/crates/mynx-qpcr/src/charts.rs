//! charts.rs — Native Excel chart XML injection (1:1 port of
//! `src/lib/chart-xml.ts` plus the read/rewrite steps of
//! `src/lib/chart-gen.ts::generateCharts`).
//!
//! The workbook file at [`ChartInjectionRequest::file_path`] is opened as a
//! zip, per-gene native clustered-column charts (`xlColumnClustered`) are
//! injected (chart XML, drawing XML, relationship wiring, sheet XML drawing
//! reference and `[Content_Types].xml` overrides), and the file is rewritten
//! in place through a temp file so a failure never corrupts the user file.
//!
//! Parity notes (legacy behaviour reproduced deliberately):
//! - Chart numbering follows `chart-xml.ts`: the index increments for every
//!   series before the sheet lookup, so a missing gene sheet leaves a gap
//!   (`chart1`, `chart3`, …) and the summary drawing's relationships map by
//!   processed order to `../charts/chart{i+1}.xml` exactly like the legacy.
//! - Worksheet files are addressed as `xl/worksheets/sheet{sheetId}.xml`
//!   directly from the `xl/workbook.xml` sheet list (no workbook.xml.rels
//!   hop), matching `buildSheetNameMap` in `chart-xml.ts`. For the
//!   ExcelJS-compatible renderer output this equals the rels resolution.
//! - The sheet-name map uses the raw `name` attribute text (no entity
//!   unescaping), exactly like the legacy regex, so a sheet name containing
//!   XML-escapable characters (`& < >`) does not resolve — same as legacy.
//! - Column references derive from [`QpcrChartSeries::group_col`] (A for the
//!   Group_Name column, then B/C); the legacy hardcoded A/B/C, which is the
//!   same output for `group_col = 1` (the only value `calculate` emits).
//! - Series with no points are filtered before injection (legacy
//!   `extractChartData` never produced them), so they consume no chart index.
//! - Deliberate deviations in the skip path (all gene sheets resolve in the
//!   real pipeline, so the happy path is byte-identical to legacy):
//!   - `[Content_Types].xml` overrides are only written for chart parts that
//!     actually exist — the legacy loop added orphan overrides for skipped
//!     indices, producing an invalid OPC package.
//!   - The summary drawing's relationships target the actual chart part of
//!     each processed series — the legacy mapped by processed order, which
//!     pointed at the wrong (or a missing) chart when a sheet was skipped.

use std::collections::HashMap;
use std::io::{Cursor, Read, Write};

use mynx_contracts::qpcr::{CalcMethod, ChartInjectionRequest, QpcrChartSeries};
use mynx_contracts::task::MynxError;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

// ── Namespaces (chart-xml.ts `NS`) ──────────────────────────────────────────
const NS_CHART: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_DRAWING: &str = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_RELS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CHART_REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const NS_DRAWING_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";

const CHART_CT: &str = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const DRAWING_CT: &str = "application/vnd.openxmlformats-officedocument.drawing+xml";

/// 汇总柱状图 sheet 的名字：把每个基因 sheet 的柱状图复制一份放到这里。
const CHARTS_SUMMARY_SHEET: &str = "Charts_All_Genes";

/// Default chart fill color when `color_hex` is invalid
/// (chart-gen.ts `hexToRgb` fallback `#3C9FDF`).
const DEFAULT_COLOR_RGB: u32 = 0x3C9FDF;

// ── Entry store (JSZip-compatible load/file/generate) ───────────────────────

/// All zip entries of the workbook in original order. `set` mirrors
/// JSZip's `zip.file(name, content)`: replace when present, append when new.
struct WorkbookZip {
    names: Vec<String>,
    data: Vec<Vec<u8>>,
    modified: bool,
}

impl WorkbookZip {
    fn read(bytes: &[u8]) -> Result<Self, MynxError> {
        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .map_err(|error| MynxError::io(format!("无法解析工作簿压缩包: {error}")))?;
        let mut names = Vec::with_capacity(archive.len());
        let mut data = Vec::with_capacity(archive.len());
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| MynxError::io(format!("无法读取工作簿条目: {error}")))?;
            if entry.is_dir() {
                continue;
            }
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut buf)
                .map_err(|error| MynxError::io(format!("无法读取工作簿条目: {error}")))?;
            names.push(entry.name().to_string());
            data.push(buf);
        }
        Ok(Self { names, data, modified: false })
    }

    fn get_text(&self, name: &str) -> Option<String> {
        self.names
            .iter()
            .position(|n| n == name)
            .map(|i| String::from_utf8_lossy(&self.data[i]).into_owned())
    }

    fn set(&mut self, name: &str, content: String) {
        if let Some(i) = self.names.iter().position(|n| n == name) {
            self.data[i] = content.into_bytes();
        } else {
            self.names.push(name.to_string());
            self.data.push(content.into_bytes());
        }
        self.modified = true;
    }

    fn to_bytes(&self) -> Result<Vec<u8>, MynxError> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, content) in self.names.iter().zip(self.data.iter()) {
            writer
                .start_file(
                    name.as_str(),
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
                )
                .map_err(|error| MynxError::io(format!("无法写入工作簿条目 {name}: {error}")))?;
            writer
                .write_all(content)
                .map_err(|error| MynxError::io(format!("无法写入工作簿条目 {name}: {error}")))?;
        }
        let cursor = writer
            .finish()
            .map_err(|error| MynxError::io(format!("无法生成工作簿压缩包: {error}")))?;
        Ok(cursor.into_inner())
    }
}

// ── XML Helpers ─────────────────────────────────────────────────────────────

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn safe_gene_name(name: &str) -> String {
    name.chars().take(31).collect()
}

/// JS `Number.prototype.toString` parity for the value ranges used by qPCR
/// averages/stdevs: shortest round-trip decimal, integral values without a
/// fractional part. (Extreme magnitudes would switch to exponent notation in
/// JS; Excel parses both spellings identically, so this is harmless.)
fn num_to_xml(v: f64) -> String {
    if v.is_nan() {
        return "NaN".to_string();
    }
    if v.is_infinite() {
        return if v > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if v == 0.0 {
        return "0".to_string();
    }
    format!("{v}")
}

/// 1-based column number → spreadsheet column letters (1 = "A").
fn column_letter(mut col: u32) -> String {
    let mut s = String::new();
    while col > 0 {
        let rem = ((col - 1) % 26) as u8;
        s.insert(0, (b'A' + rem) as char);
        col = (col - 1) / 26;
    }
    s
}

/// chart-gen.ts `hexToRgb`: optional `#`, 6 or 8 hex digits (alpha ignored),
/// anything else → `#3C9FDF`.
fn parse_color_hex(hex: &str) -> u32 {
    let body = hex.trim().strip_prefix('#').unwrap_or(hex.trim());
    let is_valid = (body.len() == 6 || body.len() == 8)
        && body.chars().take(6).all(|c| c.is_ascii_hexdigit());
    if is_valid {
        if let Ok(v) = u32::from_str_radix(&body[..6], 16) {
            return v;
        }
    }
    DEFAULT_COLOR_RGB
}

/// Build the rich-text runs for the Y-axis title.
/// - ref-normalized:   "Normalize to <i>{refGene}</i>"
/// - control-relative: "Normalize to {controlGroup} (<i>{refGene}</i>)"
///
/// Gene names are rendered italic (i="1"); group names are not.
fn build_val_axis_title_runs(
    ref_gene: &str,
    method: CalcMethod,
    control_group: &str,
) -> String {
    let run = |text: &str, italic: bool| {
        format!(
            r#"<a:r>
      <a:rPr lang="en-US" sz="900" i="{}">
        <a:latin typeface="Calibri"/>
      </a:rPr>
      <a:t>{}</a:t>
    </a:r>"#,
            if italic { 1 } else { 0 },
            esc(text)
        )
    };

    match method {
        CalcMethod::ControlRelative => {
            run(&format!("Normalize to {control_group} ("), false)
                + &run(ref_gene, true)
                + &run(")", false)
        }
        CalcMethod::RefNormalized => run("Normalize to ", false) + &run(ref_gene, true),
    }
}

// ── Chart XML Builder ───────────────────────────────────────────────────────

fn build_chart_xml(
    sheet: &QpcrChartSeries,
    chart_table_start: u32,
    chart_table_end: u32,
    color_hex: &str,
    repeat_count: u32,
    method: CalcMethod,
    control_group: &str,
) -> String {
    let data = &sheet.points;
    let n = data.len();
    let has_error_bars = repeat_count > 1;
    let gene = esc(&safe_gene_name(&sheet.gene_name));
    let sheet_name = esc(&sheet.gene_name);
    // Group_Name column (A in every current producer), then Average, Stdev.
    let cat_col = column_letter(sheet.group_col);
    let avg_col = column_letter(sheet.group_col.saturating_add(1));
    let stdev_col = column_letter(sheet.group_col.saturating_add(2));
    let col_a = format!(
        "'{sheet_name}'!${cat_col}${chart_table_start}:${cat_col}${chart_table_end}"
    );
    let col_b = format!(
        "'{sheet_name}'!${avg_col}${chart_table_start}:${avg_col}${chart_table_end}"
    );
    let col_c = if has_error_bars {
        format!(
            "'{sheet_name}'!${stdev_col}${chart_table_start}:${stdev_col}${chart_table_end}"
        )
    } else {
        String::new()
    };

    // Series: solid fill + black outline
    let ser_fill = format!(
        r#"<c:spPr>
      <a:solidFill><a:srgbClr val="{color_hex}"/></a:solidFill>
      <a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
    </c:spPr>"#
    );

    // Category (X axis): Group names — these are strings, use strRef
    let cat_xml = format!(
        r#"<c:cat>
      <c:strRef>
        <c:f>{col_a}</c:f>
      </c:strRef>
    </c:cat>"#
    );

    // Value (Y axis): Average values
    let avg_pts = data
        .iter()
        .enumerate()
        .map(|(i, dp)| {
            format!(r#"<c:pt idx="{i}"><c:v>{}</c:v></c:pt>"#, num_to_xml(dp.avg))
        })
        .collect::<String>();
    let val_xml = format!(
        r#"<c:val>
      <c:numRef>
        <c:f>{col_b}</c:f>
        <c:numCache>
          <c:formatCode>General</c:formatCode>
          <c:ptCount val="{n}"/>
          {avg_pts}
        </c:numCache>
      </c:numRef>
    </c:val>"#
    );

    // Error bars — VBA: Include:=xlBoth (both directions)
    // But user wants only upper half (plus only), so use errBarType="plus"
    let err_bars_xml = if has_error_bars {
        let stdev_pts = data
            .iter()
            .enumerate()
            .map(|(i, dp)| {
                format!(r#"<c:pt idx="{i}"><c:v>{}</c:v></c:pt>"#, num_to_xml(dp.stdev))
            })
            .collect::<String>();
        format!(
            r#"<c:errBars>
      <c:errDir val="y"/>
      <c:errBarType val="plus"/>
      <c:errValType val="cust"/>
      <c:noEndCap val="0"/>
      <c:spPr>
        <a:ln>
          <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
        </a:ln>
      </c:spPr>
      <c:plus>
        <c:numRef>
          <c:f>{col_c}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="{n}"/>
            {stdev_pts}
          </c:numCache>
        </c:numRef>
      </c:plus>
      <c:minus>
        <c:numRef>
          <c:f>{col_c}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="{n}"/>
            {stdev_pts}
          </c:numCache>
        </c:numRef>
      </c:minus>
    </c:errBars>"#
        )
    } else {
        String::new()
    };

    let axis_title_runs = build_val_axis_title_runs(&sheet.ref_gene, method, control_group);

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace
  xmlns:c="{NS_CHART}"
  xmlns:a="{NS_A}"
  xmlns:r="{NS_R}">
  <c:chart>
    <c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr lang="en-US" sz="1500" b="1" i="1">
                <a:latin typeface="Calibri"/>
              </a:rPr>
              <a:t>{gene}</a:t>
            </a:r>
          </a:p>
        </c:rich>
      </c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          {ser_fill}
          {cat_xml}
          {val_xml}
          {err_bars_xml}
        </c:ser>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="2"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
        <c:majorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:txPr>
          <a:bodyPr rot="-2700000"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr>
              <a:defRPr sz="800">
                <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
                <a:latin typeface="Calibri"/>
              </a:defRPr>
            </a:pPr>
            <a:endParaRPr/>
          </a:p>
        </c:txPr>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:crossAx val="1"/>
        <c:crosses val="min"/>
        <c:crossBetween val="between"/>
        <c:title>
        <c:tx>
          <c:rich>
            <a:bodyPr/>
            <a:lstStyle/>
            <a:p>
              {axis_title_runs}
              </a:p>
            </c:rich>
          </c:tx>
          <c:overlay val="0"/>
        </c:title>
        <c:txPr>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr>
              <a:defRPr sz="800">
                <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
                <a:latin typeface="Calibri"/>
              </a:defRPr>
            </a:pPr>
            <a:endParaRPr/>
          </a:p>
        </c:txPr>
      </c:valAx>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>"#
    )
}

// ── Drawing XML Builder ─────────────────────────────────────────────────────

fn build_drawing_xml(chart_r_id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr
  xmlns:xdr="{NS_DRAWING}"
  xmlns:a="{NS_A}"
  xmlns:r="{NS_R}"
  xmlns:c="{NS_CHART}">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:colOff>95250</xdr:colOff>
      <xdr:row>0</xdr:row>
      <xdr:rowOff>190500</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>6</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>14</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="Chart 1"/>
        <xdr:cNvGraphicFramePr>
          <a:graphicFrameLocks noGrp="1"/>
        </xdr:cNvGraphicFramePr>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm>
        <a:off x="95250" y="190500"/>
        <a:ext cx="3810000" cy="2857500"/>
      </xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="{NS_CHART}">
          <c:chart r:id="{chart_r_id}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>"#
    )
}

// ── Relationships Helpers ────────────────────────────────────────────────────

struct RelsItem {
    id: String,
    ty: &'static str,
    target: String,
}

fn build_rels_xml(rels: &[RelsItem]) -> String {
    let items = rels
        .iter()
        .map(|r| {
            format!(
                r#"    <Relationship Id="{}" Type="{}" Target="{}"/>"#,
                r.id, r.ty, r.target
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{NS_RELS}">
{items}
</Relationships>"#
    )
}

/// 汇总图表 drawing：把每张柱状图用一个 twoCellAnchor 纵向堆叠，
/// 每个图表占 15 行（与基因 sheet 里的尺寸一致），图表之间空 1 行。
/// 第 i 张图引用 rId{i+1}（对应 xl/charts/chart{i+1}.xml）。
fn build_summary_drawing_xml(count: usize) -> String {
    let rows_per_chart = 16; // 15 行图表 + 1 行间隔
    let anchors = (0..count)
        .map(|i| {
            let from_row = i * rows_per_chart;
            let to_row = from_row + 14;
            let y_off = 190500 + i * rows_per_chart * 190500; // 每行约 15pt = 190500 EMU
            format!(
                r#"  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:colOff>95250</xdr:colOff>
      <xdr:row>{from_row}</xdr:row>
      <xdr:rowOff>190500</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>6</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>{to_row}</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="{}" name="Chart {}"/>
        <xdr:cNvGraphicFramePr>
          <a:graphicFrameLocks noGrp="1"/>
        </xdr:cNvGraphicFramePr>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm>
        <a:off x="95250" y="{y_off}"/>
        <a:ext cx="3810000" cy="2857500"/>
      </xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="{NS_CHART}">
          <c:chart r:id="rId{}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>"#,
                i + 2,
                i + 1,
                i + 1
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr
  xmlns:xdr="{NS_DRAWING}"
  xmlns:a="{NS_A}"
  xmlns:r="{NS_R}"
  xmlns:c="{NS_CHART}">
{anchors}
</xdr:wsDr>"#
    )
}

fn build_chart_rels_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{NS_RELS}">
  <Relationship Id="rId1" Type="{NS_R}/package" Target="../theme/theme1.xml"/>
</Relationships>"#
    )
}

// ── Sheet Name → Sheet ID Lookup ───────────────────────────────────────────

fn find_sub(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

/// Parse `key="value"` / `key='value'` attributes out of a tag body.
fn parse_xml_attrs(body: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let b = body.as_bytes();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let start = i;
        while i < b.len() && b[i] != b'=' && !b[i].is_ascii_whitespace() {
            i += 1;
        }
        let key = body.get(start..i).unwrap_or("").to_string();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || b[i] != b'=' {
            continue;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || (b[i] != b'"' && b[i] != b'\'') {
            continue;
        }
        let quote = b[i];
        i += 1;
        let vstart = i;
        while i < b.len() && b[i] != quote {
            i += 1;
        }
        let value = body.get(vstart..i).unwrap_or("").to_string();
        if i < b.len() {
            i += 1;
        }
        attrs.push((key, value));
    }
    attrs
}

/// Port of `buildSheetNameMap`: sheet name → sheetId from `xl/workbook.xml`.
fn build_sheet_name_map(zip: &WorkbookZip) -> HashMap<String, u32> {
    let mut map = HashMap::new();
    let Some(wb_xml) = zip.get_text("xl/workbook.xml") else {
        return map;
    };
    let bytes = wb_xml.as_bytes();
    let mut cursor = 0;
    while let Some(pos) = find_sub(bytes, b"<sheet", cursor) {
        cursor = pos + 6;
        let Some(gt) = find_sub(bytes, b">", cursor) else {
            break;
        };
        let body = wb_xml.get(pos + 6..gt).unwrap_or("");
        let attrs = parse_xml_attrs(body);
        let name = attrs
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("name"))
            .map(|(_, v)| v.clone());
        let sheet_id = attrs
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("sheetId"))
            .and_then(|(_, v)| v.parse::<u32>().ok());
        if let (Some(name), Some(sheet_id)) = (name, sheet_id) {
            if !name.is_empty() {
                map.insert(name, sheet_id);
            }
        }
    }
    map
}

/// Port of `maxRId`: highest `Id="rIdN"` number in a rels document.
fn max_r_id(rels_xml: &str) -> u32 {
    let b = rels_xml.as_bytes();
    let needle = b"Id=\"rId";
    let mut max = 0;
    let mut cursor = 0;
    while let Some(pos) = find_sub(b, needle, cursor) {
        let mut j = pos + needle.len();
        let mut n: u32 = 0;
        while j < b.len() && b[j].is_ascii_digit() {
            n = n.saturating_mul(10).saturating_add((b[j] - b'0') as u32);
            j += 1;
        }
        if n > max {
            max = n;
        }
        cursor = j;
    }
    max
}

// ── Main Injection Function ────────────────────────────────────────────────

/// Rewrite `target` in place: write to a temp sibling file then rename over
/// the original so a failure never corrupts the user file.
fn write_file_atomic(target: &str, bytes: &[u8]) -> Result<(), MynxError> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = format!("{target}.mynx-{nanos}.tmp");
    let result = (|| -> std::io::Result<()> {
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, target)?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(MynxError::io(format!("无法写入工作簿 {target}: {error}")));
    }
    Ok(())
}

/// Inject native Excel charts into the saved workbook at
/// [`ChartInjectionRequest::file_path`]. Returns `Ok(true)` when the file was
/// rewritten, `Ok(false)` when there was nothing to inject (file untouched).
pub fn inject_charts(request: &ChartInjectionRequest) -> Result<bool, MynxError> {
    // Series without points never reach the legacy injector (extractChartData
    // filters them), so drop them before counting chart indices.
    let sheets: Vec<&QpcrChartSeries> = request
        .series
        .iter()
        .filter(|s| !s.points.is_empty())
        .collect();
    if sheets.is_empty() {
        return Ok(false);
    }

    let color_rgb = parse_color_hex(&request.color_hex);
    let color_hex = format!("{color_rgb:06X}");
    let repeat_count = request.repeat_count;
    let method = request.method;
    let control_group = request.control_group.as_str();

    let bytes = std::fs::read(&request.file_path)
        .map_err(|error| MynxError::io(format!("无法读取工作簿 {}: {}", request.file_path, error)))?;

    let mut zip = WorkbookZip::read(&bytes)?;
    let sheet_name_map = build_sheet_name_map(&zip);

    let mut chart_index: u32 = 0;
    // Series that resolved to a workbook sheet, with the chart index each one
    // was written as (indices keep legacy gaps when sheets are skipped).
    let mut processed_sheets: Vec<(&QpcrChartSeries, u32)> = Vec::new();
    let mut summary_drawing_index: u32 = 0;

    for sheet in sheets {
        chart_index += 1;

        // Missing sheets are skipped (the chart index gap matches legacy).
        let Some(&sheet_id) = sheet_name_map.get(&sheet.gene_name) else {
            continue;
        };
        processed_sheets.push((sheet, chart_index));

        let sheet_path = format!("xl/worksheets/sheet{sheet_id}.xml");
        let sheet_rels_path = format!("xl/worksheets/_rels/sheet{sheet_id}.xml.rels");

        // Chart table rows — data starts at data_start_row (the row after the
        // Group_Name header) and spans data_row_count rows.
        let chart_table_start = sheet.data_start_row;
        let chart_table_end = sheet.data_start_row + sheet.points.len() as u32 - 1;

        let chart_xml = build_chart_xml(
            sheet,
            chart_table_start,
            chart_table_end,
            &color_hex,
            repeat_count,
            method,
            control_group,
        );
        zip.set(&format!("xl/charts/chart{chart_index}.xml"), chart_xml);

        let chart_rels_xml = build_chart_rels_xml();
        zip.set(&format!("xl/charts/_rels/chart{chart_index}.xml.rels"), chart_rels_xml);

        let drawing_r_id = format!("rId{chart_index}");
        let drawing_xml = build_drawing_xml(&drawing_r_id);
        zip.set(&format!("xl/drawings/drawing{chart_index}.xml"), drawing_xml);

        let drawing_rels_xml = build_rels_xml(&[RelsItem {
            id: drawing_r_id.clone(),
            ty: NS_CHART_REL,
            target: format!("../charts/chart{chart_index}.xml"),
        }]);
        zip.set(&format!("xl/drawings/_rels/drawing{chart_index}.xml.rels"), drawing_rels_xml);

        let Some(sheet_xml) = zip.get_text(&sheet_path) else {
            continue;
        };

        let mut updated_sheet_xml = sheet_xml.clone();
        if !sheet_xml.contains("<drawing") {
            let drawing_rel_id = format!("rId{}", chart_index + 100);
            updated_sheet_xml = sheet_xml.replacen(
                "</worksheet>",
                &format!("  <drawing r:id=\"{drawing_rel_id}\"/>\n</worksheet>"),
                1,
            );

            if let Some(rels_xml) = zip.get_text(&sheet_rels_path) {
                if !rels_xml.contains(NS_DRAWING_REL) {
                    let next_r_id = max_r_id(&rels_xml) + 1;
                    let new_r_id = format!("rId{next_r_id}");
                    let patched = rels_xml.replacen(
                        "</Relationships>",
                        &format!(
                            "  <Relationship Id=\"{new_r_id}\" Type=\"{NS_DRAWING_REL}\" Target=\"../drawings/drawing{chart_index}.xml\"/>\n</Relationships>"
                        ),
                        1,
                    );
                    zip.set(&sheet_rels_path, patched);
                }
            } else {
                let rels_xml = build_rels_xml(&[RelsItem {
                    id: drawing_rel_id,
                    ty: NS_DRAWING_REL,
                    target: format!("../drawings/drawing{chart_index}.xml"),
                }]);
                zip.set(&sheet_rels_path, rels_xml);
            }
        }

        zip.set(&sheet_path, updated_sheet_xml);
    }

    // ── 汇总柱状图 sheet：把每个基因的柱状图复制一份，纵向堆叠到一张表里 ──
    // 图表本身在 xl/charts/chart*.xml（上面循环已生成），这里只新建一个 drawing
    // 让汇总 sheet 引用这些 chart 部件即可，不必复制 chart XML。
    let summary_sheet_id = sheet_name_map.get(CHARTS_SUMMARY_SHEET).copied();
    if let Some(summary_sheet_id) = summary_sheet_id {
        if !processed_sheets.is_empty() {
            let summary_sheet_path = format!("xl/worksheets/sheet{summary_sheet_id}.xml");
            if let Some(summary_sheet_xml) = zip.get_text(&summary_sheet_path) {
                summary_drawing_index = chart_index + 1; // 与现有 drawing1..N 不冲突
                let summary_drawing_path = format!("xl/drawings/drawing{summary_drawing_index}.xml");

                let summary_drawing = build_summary_drawing_xml(processed_sheets.len());
                zip.set(&summary_drawing_path, summary_drawing);

                // 汇总 drawing 的 rels：每个图表一条关系。Target 指向该系列
                // 实际写入的 chart 部件（跳过缺失 sheet 时与序号可能不同）。
                let summary_drawing_rels = processed_sheets
                    .iter()
                    .enumerate()
                    .map(|(i, (_, chart_no))| RelsItem {
                        id: format!("rId{}", i + 1),
                        ty: NS_CHART_REL,
                        target: format!("../charts/chart{chart_no}.xml"),
                    })
                    .collect::<Vec<_>>();
                let rels = build_rels_xml(&summary_drawing_rels);
                zip.set(
                    &format!("xl/drawings/_rels/drawing{summary_drawing_index}.xml.rels"),
                    rels,
                );

                if !summary_sheet_xml.contains("<drawing") {
                    let summary_sheet_rels_path =
                        format!("xl/worksheets/_rels/sheet{summary_sheet_id}.xml.rels");
                    let updated_summary_sheet_xml;
                    if let Some(rels_xml) = zip.get_text(&summary_sheet_rels_path) {
                        let next_r_id = max_r_id(&rels_xml) + 1;
                        let patched = rels_xml.replacen(
                            "</Relationships>",
                            &format!(
                                "  <Relationship Id=\"rId{next_r_id}\" Type=\"{NS_DRAWING_REL}\" Target=\"../drawings/drawing{summary_drawing_index}.xml\"/>\n</Relationships>"
                            ),
                            1,
                        );
                        zip.set(&summary_sheet_rels_path, patched);
                        updated_summary_sheet_xml = summary_sheet_xml.replacen(
                            "</worksheet>",
                            &format!("  <drawing r:id=\"rId{next_r_id}\"/>\n</worksheet>"),
                            1,
                        );
                    } else {
                        let rels_xml = build_rels_xml(&[RelsItem {
                            id: "rId1".to_string(),
                            ty: NS_DRAWING_REL,
                            target: format!("../drawings/drawing{summary_drawing_index}.xml"),
                        }]);
                        zip.set(&summary_sheet_rels_path, rels_xml);
                        updated_summary_sheet_xml = summary_sheet_xml.replacen(
                            "</worksheet>",
                            "  <drawing r:id=\"rId1\"/>\n</worksheet>",
                            1,
                        );
                    }
                    zip.set(&summary_sheet_path, updated_summary_sheet_xml);
                }
            }
        }
    }

    // Update [Content_Types].xml — only for chart parts that were actually
    // written (skipped series would otherwise get orphan OPC overrides).
    if let Some(ct_xml) = zip.get_text("[Content_Types].xml") {
        let original_ct = ct_xml.clone();
        let mut ct_xml = ct_xml;
        for i in processed_sheets.iter().map(|(_, chart_no)| *chart_no) {
            let chart_override = format!(
                r#"<Override PartName="/xl/charts/chart{i}.xml" ContentType="{CHART_CT}"/>"#
            );
            let drawing_override = format!(
                r#"<Override PartName="/xl/drawings/drawing{i}.xml" ContentType="{DRAWING_CT}"/>"#
            );
            if !ct_xml.contains(&format!("chart{i}.xml")) {
                ct_xml = ct_xml.replacen(
                    "</Types>",
                    &format!("  {chart_override}\n  {drawing_override}\n</Types>"),
                    1,
                );
            }
        }
        if summary_drawing_index > 0 {
            let summary_drawing_override = format!(
                r#"<Override PartName="/xl/drawings/drawing{summary_drawing_index}.xml" ContentType="{DRAWING_CT}"/>"#
            );
            if !ct_xml.contains(&format!("drawing{summary_drawing_index}.xml")) {
                ct_xml = ct_xml.replacen(
                    "</Types>",
                    &format!("  {summary_drawing_override}\n</Types>"),
                    1,
                );
            }
        }
        if ct_xml != original_ct {
            zip.set("[Content_Types].xml", ct_xml);
        }
    }

    if !zip.modified {
        // Nothing was injected (e.g. all gene sheets missing) — leave the
        // user's file untouched instead of round-tripping identical content.
        return Ok(false);
    }

    let new_bytes = zip.to_bytes()?;
    write_file_atomic(&request.file_path, &new_bytes)?;
    Ok(true)
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use mynx_contracts::qpcr::QpcrChartPoint;
    use mynx_contracts::WIRE_VERSION;
    use std::path::PathBuf;

    const CT_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;

    const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;

    const WORKBOOK_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="GeneA" sheetId="1" r:id="rId1"/>
    <sheet name="Charts_All_Genes" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"#;

    const WORKBOOK_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"#;

    const SHEET1_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>GeneA</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Group_Name</t></is></c></row>
  </sheetData>
</worksheet>"#;

    const SHEET2_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
</worksheet>"#;

    fn build_workbook_zip() -> Vec<u8> {
        let entries: Vec<(&str, &str)> = vec![
            ("[Content_Types].xml", CT_XML),
            ("_rels/.rels", ROOT_RELS),
            ("xl/workbook.xml", WORKBOOK_XML),
            ("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
            ("xl/worksheets/sheet1.xml", SHEET1_XML),
            ("xl/worksheets/sheet2.xml", SHEET2_XML),
        ];
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, content) in entries {
            writer
                .start_file(
                    name,
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
                )
                .expect("start_file");
            writer.write_all(content.as_bytes()).expect("write entry");
        }
        writer.finish().expect("finish").into_inner()
    }

    fn series(gene: &str, data_start_row: u32, data_row_count: u32) -> QpcrChartSeries {
        QpcrChartSeries {
            gene_name: gene.to_string(),
            ref_gene: "RefGene".to_string(),
            points: vec![
                QpcrChartPoint { name: "Ctrl".to_string(), avg: 1.0, stdev: 0.1 },
                QpcrChartPoint { name: "Trt".to_string(), avg: 2.5, stdev: 0.25 },
            ],
            group_col: 1,
            data_start_row,
            data_row_count,
        }
    }

    fn request(file_path: &str, series: Vec<QpcrChartSeries>) -> ChartInjectionRequest {
        ChartInjectionRequest {
            v: WIRE_VERSION,
            file_path: file_path.to_string(),
            series,
            repeat_count: 2,
            color_hex: "#3C9FDF".to_string(),
            method: CalcMethod::RefNormalized,
            control_group: String::new(),
        }
    }

    /// Materialize the minimal workbook on disk and return its path.
    fn temp_workbook(tag: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "mynx-qpcr-charts-{tag}-{}-{}.xlsx",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, build_workbook_zip()).expect("write temp workbook");
        path
    }

    fn zip_text(bytes: &[u8], name: &str) -> String {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("reopen zip");
        let mut entry = archive.by_name(name).expect(name);
        let mut out = String::new();
        entry.read_to_string(&mut out).expect("entry utf8");
        out
    }

    fn zip_has(bytes: &[u8], name: &str) -> bool {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("reopen zip");
        let found = archive.by_name(name).is_ok();
        found
    }

    #[test]
    fn zero_series_returns_false_without_touching_file() {
        let path = temp_workbook("zero");
        let before = std::fs::read(&path).unwrap();
        let result = inject_charts(&request(path.to_str().unwrap(), vec![])).unwrap();
        assert!(!result);
        let after = std::fs::read(&path).unwrap();
        assert_eq!(before, after);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_gene_sheet_skips_series_and_leaves_file_untouched() {
        let path = temp_workbook("missing");
        let before = std::fs::read(&path).unwrap();
        let result = inject_charts(&request(
            path.to_str().unwrap(),
            vec![series("NoSuchSheet", 5, 2)],
        ))
        .unwrap();
        assert!(!result);
        let after = std::fs::read(&path).unwrap();
        assert_eq!(before, after);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn injects_chart_drawing_and_content_types() {
        let path = temp_workbook("inject");
        let result = inject_charts(&request(
            path.to_str().unwrap(),
            vec![series("GeneA", 5, 2)],
        ))
        .unwrap();
        assert!(result);

        let bytes = std::fs::read(&path).unwrap();

        // Chart part + its rels (theme package reference, legacy literal).
        assert!(zip_has(&bytes, "xl/charts/chart1.xml"));
        assert!(zip_has(&bytes, "xl/charts/_rels/chart1.xml.rels"));
        let chart_rels = zip_text(&bytes, "xl/charts/_rels/chart1.xml.rels");
        assert!(chart_rels.contains(
            r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../theme/theme1.xml"/>"#
        ));

        // Drawing part + rels wiring to chart1.
        let drawing = zip_text(&bytes, "xl/drawings/drawing1.xml");
        assert!(drawing.contains(r#"<c:chart r:id="rId1"/>"#));
        assert!(drawing.contains(r#"<xdr:cNvPr id="2" name="Chart 1"/>"#));
        let drawing_rels = zip_text(&bytes, "xl/drawings/_rels/drawing1.xml.rels");
        assert!(drawing_rels.contains(
            r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>"#
        ));

        // Sheet XML patched with the drawing reference (legacy rId{index+100}).
        let sheet = zip_text(&bytes, "xl/worksheets/sheet1.xml");
        assert!(sheet.contains(r#"<drawing r:id="rId101"/>"#));
        let sheet_rels = zip_text(&bytes, "xl/worksheets/_rels/sheet1.xml.rels");
        assert!(sheet_rels.contains(
            r#"<Relationship Id="rId101" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>"#
        ));

        // [Content_Types].xml patched with chart + drawing overrides.
        let ct = zip_text(&bytes, "[Content_Types].xml");
        assert!(ct.contains(
            r#"<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>"#
        ));
        assert!(ct.contains(
            r#"<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>"#
        ));

        // Summary drawing stacked on Charts_All_Genes (index = chartIndex+1).
        assert!(zip_has(&bytes, "xl/drawings/drawing2.xml"));
        let summary_drawing = zip_text(&bytes, "xl/drawings/drawing2.xml");
        assert!(summary_drawing.contains("<xdr:row>0</xdr:row>"));
        assert!(summary_drawing.contains(r#"<c:chart r:id="rId1"/>"#));
        let summary_rels = zip_text(&bytes, "xl/drawings/_rels/drawing2.xml.rels");
        assert!(summary_rels.contains(
            r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>"#
        ));
        let sheet2 = zip_text(&bytes, "xl/worksheets/sheet2.xml");
        assert!(sheet2.contains(r#"<drawing r:id="rId1"/>"#));
        let sheet2_rels = zip_text(&bytes, "xl/worksheets/_rels/sheet2.xml.rels");
        assert!(sheet2_rels.contains(
            r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing2.xml"/>"#
        ));
        let ct = zip_text(&bytes, "[Content_Types].xml");
        assert!(ct.contains(
            r#"<Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>"#
        ));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn chart_xml_matches_legacy_snippets() {
        let path = temp_workbook("parity");
        let req = request(path.to_str().unwrap(), vec![series("GeneA", 5, 2)]);
        inject_charts(&req).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let chart = zip_text(&bytes, "xl/charts/chart1.xml");

        // Document header + namespaces (legacy literal).
        assert!(chart.starts_with(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<c:chartSpace\n  xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"\n  xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"\n  xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
        ));

        // Title: italic bold gene name, 15pt (legacy literal).
        assert!(chart.contains(
            "              <a:rPr lang=\"en-US\" sz=\"1500\" b=\"1\" i=\"1\">\n                <a:latin typeface=\"Calibri\"/>\n              </a:rPr>\n              <a:t>GeneA</a:t>"
        ));

        // Series fill: user color + black outline (legacy literal).
        assert!(chart.contains(
            "          <c:spPr>\n      <a:solidFill><a:srgbClr val=\"3C9FDF\"/></a:solidFill>\n      <a:ln><a:solidFill><a:srgbClr val=\"000000\"/></a:solidFill></a:ln>\n    </c:spPr>"
        ));

        // Categories: strRef to the Group_Name column range.
        assert!(chart.contains(
            "    <c:cat>\n      <c:strRef>\n        <c:f>'GeneA'!$A$5:$A$6</c:f>\n      </c:strRef>\n    </c:cat>"
        ));

        // Values: numCache of Averages (avg 1.0 → "1", 2.5 → "2.5").
        assert!(chart.contains(
            "          <c:ptCount val=\"2\"/>\n          <c:pt idx=\"0\"><c:v>1</c:v></c:pt><c:pt idx=\"1\"><c:v>2.5</c:v></c:pt>"
        ));

        // Error bars: custom plus/minus from Stdev (repeat_count > 1).
        assert!(chart.contains("<c:errBarType val=\"plus\"/>"));
        assert!(chart.contains("<c:errValType val=\"cust\"/>"));
        assert!(chart.contains(
            "            <c:ptCount val=\"2\"/>\n            <c:pt idx=\"0\"><c:v>0.1</c:v></c:pt><c:pt idx=\"1\"><c:v>0.25</c:v></c:pt>"
        ));

        // X axis: 45° tick labels (rot=-2700000), no major tick marks.
        assert!(chart.contains("<a:bodyPr rot=\"-2700000\"/>"));
        assert!(chart.contains("<c:majorTickMark val=\"none\"/>"));

        // Y axis title (ref-normalized): "Normalize to <i>RefGene</i>".
        assert!(chart.contains(
            "              <a:r>\n      <a:rPr lang=\"en-US\" sz=\"900\" i=\"0\">\n        <a:latin typeface=\"Calibri\"/>\n      </a:rPr>\n      <a:t>Normalize to </a:t>\n    </a:r><a:r>\n      <a:rPr lang=\"en-US\" sz=\"900\" i=\"1\">\n        <a:latin typeface=\"Calibri\"/>\n      </a:rPr>\n      <a:t>RefGene</a:t>\n    </a:r>"
        ));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn control_relative_y_axis_title_runs() {
        let path = temp_workbook("control");
        let mut req = request(path.to_str().unwrap(), vec![series("GeneA", 5, 2)]);
        req.method = CalcMethod::ControlRelative;
        req.control_group = "Vehicle".to_string();
        inject_charts(&req).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let chart = zip_text(&bytes, "xl/charts/chart1.xml");
        assert!(chart.contains("<a:t>Normalize to Vehicle (</a:t>"));
        assert!(chart.contains("<a:t>RefGene</a:t>"));
        assert!(chart.contains("<a:t>)</a:t>"));
        // The italic flag sits on the gene run, not the group runs.
        assert!(chart.contains("sz=\"900\" i=\"1\">\n        <a:latin typeface=\"Calibri\"/>\n      </a:rPr>\n      <a:t>RefGene</a:t>"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn single_repeat_has_no_error_bars() {
        let path = temp_workbook("norepeat");
        let mut req = request(path.to_str().unwrap(), vec![series("GeneA", 5, 2)]);
        req.repeat_count = 1;
        inject_charts(&req).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let chart = zip_text(&bytes, "xl/charts/chart1.xml");
        assert!(!chart.contains("<c:errBars>"));
        assert!(!chart.contains("$C$"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn color_parsing_falls_back_to_default() {
        assert_eq!(parse_color_hex("#3C9FDF"), 0x3C9FDF);
        assert_eq!(parse_color_hex("FF0000"), 0xFF0000);
        assert_eq!(parse_color_hex("#11223344"), 0x112233); // alpha ignored
        assert_eq!(parse_color_hex("#12345"), DEFAULT_COLOR_RGB);
        assert_eq!(parse_color_hex("zzz"), DEFAULT_COLOR_RGB);
        assert_eq!(parse_color_hex(""), DEFAULT_COLOR_RGB);
        // Invalid color in a request still injects with the default fill.
        let path = temp_workbook("colordef");
        let mut req = request(path.to_str().unwrap(), vec![series("GeneA", 5, 2)]);
        req.color_hex = "not-a-color".to_string();
        assert!(inject_charts(&req).unwrap());
        let bytes = std::fs::read(&path).unwrap();
        let chart = zip_text(&bytes, "xl/charts/chart1.xml");
        assert!(chart.contains("<a:srgbClr val=\"3C9FDF\"/>"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn xml_helpers_match_legacy_behaviour() {
        assert_eq!(esc("Gene<1>&\"X\""), "Gene&lt;1&gt;&amp;&quot;X&quot;");
        assert_eq!(safe_gene_name(&"G".repeat(40)), "G".repeat(31));
        assert_eq!(column_letter(1), "A");
        assert_eq!(column_letter(26), "Z");
        assert_eq!(column_letter(27), "AA");
        assert_eq!(column_letter(52), "AZ");
        // Series with XML-escapable sheet names cannot resolve in the sheet
        // map (raw attribute text, legacy regex parity) — documented skip.
        let path = temp_workbook("escape");
        let s = series("Gene<1>", 5, 2);
        assert!(!inject_charts(&request(path.to_str().unwrap(), vec![s])).unwrap());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn max_r_id_scans_relationship_documents() {
        let rels = r#"<Relationships>
  <Relationship Id="rId3" Target="a"/>
  <Relationship Id="rId12" Target="b"/>
  <Relationship Id="rId1" Target="c"/>
</Relationships>"#;
        assert_eq!(max_r_id(rels), 12);
        assert_eq!(max_r_id("<Relationships/>"), 0);
    }

    #[test]
    fn num_to_xml_matches_js_number_to_string() {
        assert_eq!(num_to_xml(1.0), "1");
        assert_eq!(num_to_xml(2.5), "2.5");
        assert_eq!(num_to_xml(-0.4), "-0.4");
        assert_eq!(num_to_xml(0.0), "0");
        assert_eq!(num_to_xml(-0.0), "0");
        assert_eq!(num_to_xml(f64::NAN), "NaN");
        assert_eq!(num_to_xml(f64::INFINITY), "Infinity");
    }

    #[test]
    fn reinjection_keeps_existing_drawing() {
        // Inject once, then again: the second pass must not re-patch the
        // already-wired sheet (legacy checks for an existing <drawing>).
        let path = temp_workbook("reinj");
        let req = request(path.to_str().unwrap(), vec![series("GeneA", 5, 2)]);
        assert!(inject_charts(&req).unwrap());
        let bytes = std::fs::read(&path).unwrap();
        let sheet = zip_text(&bytes, "xl/worksheets/sheet1.xml");
        assert_eq!(sheet.matches("<drawing").count(), 1);
        let _ = std::fs::remove_file(&path);
    }
}
