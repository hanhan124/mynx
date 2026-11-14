//! Calculate stage — port of `src/lib/qpcr-calculate.ts` (`calculateQpcr`),
//! which itself follows the legacy VBA macro (`2.caculate.txt`).
//!
//! Reads the `Transformed Data` snapshot and produces the `Summary_All_Genes`
//! sheet, one sheet per target gene (with the per-group chart-data table),
//! and the optional `Summary_Best_Replicates` / `Summary_Outlier_Removed`
//! QC sheets. The result also carries the per-gene chart payloads consumed
//! by native chart XML injection.

use mynx_contracts::qpcr::{
    CalcMethod, CalcRequest, CalcResult, PatchCell, QpcrChartPoint, QpcrChartSeries, SheetPatch,
    WorkbookPatch,
};
use mynx_contracts::task::MynxError;
use mynx_contracts::WIRE_VERSION;

use crate::jsval::{js_number_to_string, js_parse_float, js_string_of_value};
use crate::sheet::{cell, fills, PatchSheetBuf, SheetView};

/// Sheets the legacy pipeline never deletes when cleaning old result sheets.
const PROTECTED_SHEETS: [&str; 6] = [
    "Transformed Data",
    "Summary_All_Genes",
    "Summary_Best_Replicates",
    "Summary_Outlier_Removed",
    "Charts_All_Genes",
    "Sheet1",
];

const FONT_NAME: &str = "Times New Roman";

/// Sentinel row for `WorkbookPatch::remove_sheets`: the renderer expands it
/// to every sheet not in [`PROTECTED_SHEETS`] (legacy: non-protected sheets
/// are deleted before regeneration).
pub const REMOVE_NON_PROTECTED: &str = "__NON_PROTECTED__";

/// English method labels written into the workbook (Excel content stays
/// pure English, matching legacy `CALC_METHOD_LABELS_EN`).
fn method_label(method: CalcMethod) -> &'static str {
    match method {
        CalcMethod::RefNormalized => "Reference-normalized",
        CalcMethod::ControlRelative => "Control-relative (ΔΔCt)",
    }
}

/// One written Summary_All_Genes data row; the Best/Outlier sheets are
/// derived from these. Legacy re-reads the written sheet and re-parses the
/// cells — values round-trip exactly, so deriving from memory is equivalent.
struct SummaryRow {
    gene_name: String,
    group_name: String,
    repeats: Vec<f64>,
    ref_cts: Vec<f64>,
    target_cts: Vec<f64>,
    ref_filled: Vec<bool>,
    target_filled: Vec<bool>,
    method_note: String,
}

pub fn calculate(request: CalcRequest) -> Result<CalcResult, MynxError> {
    // ── Validation, in the exact legacy order so an invalid parameter
    //    never leaves a half-cleared workbook behind. ─────────────────────
    if request.repeat_count < 1 {
        return Err(MynxError::validation("重复次数必须是大于等于 1 的整数"));
    }
    let method = request.options.method;
    let control_group = request.options.control_group.trim().to_string();
    if method == CalcMethod::ControlRelative && control_group.is_empty() {
        return Err(MynxError::validation("相对对照方法需要指定对照组"));
    }
    let select_num = validate_select_num(request.options.select_num, request.repeat_count)?;
    let outlier_sd = validate_outlier_sd(request.options.outlier_sd)?;
    if select_num >= 2 && outlier_sd > 0.0 {
        return Err(MynxError::validation(
            "择优重复数与离群值剔除不能同时启用，请只选一种",
        ));
    }

    let source = SheetView::new(&request.source);
    if source.name() != "Transformed Data" {
        return Err(MynxError::not_found("Transformed Data sheet not found"));
    }

    let ref_col = find_column(&source, &request.ref_gene)?;

    // Validate all group boundaries before any sheet is regenerated, so a
    // bad repeat count cannot leave a half-cleared workbook.
    let group_ranges = read_group_ranges(&source, request.repeat_count)?;

    // Gene columns start at C (Num/Group are skipped). Must match the
    // transform output, which writes genes from column 3.
    let mut gene_names: Vec<String> = Vec::new();
    for c in 3..=source.column_count() {
        let (value, _) = source.cell(1, c);
        let name = js_string_of_value(value);
        let name = name.trim();
        if !name.is_empty() && name != request.ref_gene {
            gene_names.push(name.to_string());
        }
    }

    // ── Summary_All_Genes ───────────────────────────────────────────────
    let method_label = method_label(method);
    let method_note = if method == CalcMethod::ControlRelative {
        format!("{method_label} (control: {control_group})")
    } else {
        method_label.to_string()
    };
    // Under control-relative the third column holds expression normalized
    // to the control group.
    let re_col_header = match method {
        CalcMethod::ControlRelative => "Normalized Expression",
        CalcMethod::RefNormalized => "Relative Expression",
    };

    let mut summary = PatchSheetBuf::new("Summary_All_Genes");
    let method_col =
        write_summary_headers(&mut summary, request.repeat_count, &request.ref_gene) as usize;
    let summary_width = method_col + 2 * request.repeat_count as usize;

    let mut summary_rows: Vec<SummaryRow> = Vec::new();
    let mut gene_sheet_bufs: Vec<PatchSheetBuf> = Vec::new();
    let mut gene_sheet_names: Vec<String> = Vec::new();
    let mut chart_series: Vec<QpcrChartSeries> = Vec::new();

    for target_gene in &gene_names {
        let target_col = find_column(&source, target_gene)?;

        let mut sheet_name = js_cap_31(target_gene);
        if PROTECTED_SHEETS.contains(&sheet_name.as_str()) {
            sheet_name.push_str("_gene");
        }

        let mut gene_sheet = PatchSheetBuf::new(sheet_name.clone());
        let headers = [
            request.ref_gene.clone(),
            target_gene.clone(),
            re_col_header.to_string(),
            "Average".to_string(),
            "Stdev".to_string(),
            "Group_Name".to_string(),
            "Method".to_string(),
        ];
        gene_sheet.push_row(headers.into_iter().map(|h| cell::bold_text(h)).collect());

        // Pass 1: read contiguous group blocks and compute the raw
        // per-replicate relative expression 2^-(target − ref). Block
        // boundaries come from readGroupRanges, not from fixed stepping:
        // fixed-size stepping shifts every following group when a workbook
        // has a different number of rows for one group.
        struct Block {
            group_name: String,
            ref_vals: Vec<f64>,
            target_vals: Vec<f64>,
            ref_filled: Vec<bool>,
            target_filled: Vec<bool>,
            raw_re: Vec<f64>,
            all_valid: bool,
        }
        let mut blocks: Vec<Block> = Vec::new();
        for range in &group_ranges {
            let mut block = Block {
                group_name: range.group_name.clone(),
                ref_vals: Vec::new(),
                target_vals: Vec::new(),
                ref_filled: Vec::new(),
                target_filled: Vec::new(),
                raw_re: Vec::new(),
                all_valid: true,
            };
            for row in range.start_row..range.end_row {
                let (target_value, target_yellow) = source.cell(row, target_col);
                let (ref_value, ref_yellow) = source.cell(row, ref_col);
                let t_val = parse_number(target_value);
                let r_val = parse_number(ref_value);
                block.target_vals.push(t_val);
                block.ref_vals.push(r_val);
                block.target_filled.push(target_yellow);
                block.ref_filled.push(ref_yellow);
                if !t_val.is_nan() && !r_val.is_nan() {
                    block.raw_re.push((2.0f64).powf(-(t_val - r_val)));
                } else {
                    block.all_valid = false;
                }
            }
            blocks.push(block);
        }

        // Divisor: 1 for ref-normalized; the control group's mean raw RE for
        // control-relative (so the control group averages ~1).
        let mut divisor = 1.0f64;
        if method == CalcMethod::ControlRelative {
            let ctrl = blocks.iter().find(|b| {
                b.group_name == control_group
                    && b.all_valid
                    && b.raw_re.len() as u32 == request.repeat_count
            });
            let ctrl = match ctrl {
                Some(ctrl) => ctrl,
                None => {
                    return Err(MynxError::validation(format!(
                        "未找到对照组 \"{}\" 的有效数据（基因 {}）",
                        control_group, target_gene
                    )));
                }
            };
            let ctrl_avg = ctrl.raw_re.iter().fold(0.0, |a, b| a + b) / ctrl.raw_re.len() as f64;
            if !(ctrl_avg > 0.0) {
                return Err(MynxError::validation(format!(
                    "对照组 \"{}\" 平均值无效（基因 {}）",
                    control_group, target_gene
                )));
            }
            divisor = ctrl_avg;
        }

        // Pass 2: write rows using the (possibly scaled) expression values.
        let mut output_row: u32 = 2; // 1-based cursor, mirrors the legacy one
                                     // (group name, avg, stdev) in insertion order for the chart table.
        let mut group_map: Vec<(String, f64, f64)> = Vec::new();

        for block in &blocks {
            let mut re_values: Vec<f64> = Vec::new();
            for (r, _) in block.ref_vals.iter().enumerate() {
                let mut cells: Vec<PatchCell> = vec![cell::empty(); 7];
                cells[0] = cell::num(block.ref_vals[r]);
                cells[1] = cell::num(block.target_vals[r]);
                cells[5] = cell::text(block.group_name.clone());
                cells[6] = cell::text(method_note.clone());
                let r_val = block.ref_vals[r];
                let t_val = block.target_vals[r];
                if !t_val.is_nan() && !r_val.is_nan() {
                    let re = (2.0f64).powf(-(t_val - r_val)) / divisor;
                    cells[2] = cell::num(re);
                    re_values.push(re);
                } else {
                    cells[2] = cell::text("N/A");
                }
                // Cells 4/5 (Average/Stdev) are only written on the first
                // row of a complete valid block, right below.
                gene_sheet.write_row_at(output_row + r as u32, cells);
            }

            if block.all_valid
                && block.raw_re.len() as u32 == request.repeat_count
                && re_values.len() as u32 == request.repeat_count
            {
                let avg = re_values.iter().fold(0.0, |a, b| a + b) / re_values.len() as f64;
                let stdev = sample_stdev(&re_values);
                gene_sheet.write_cell(output_row, 4, cell::num(avg));
                gene_sheet.write_cell(output_row, 5, cell::num(stdev));
                group_map.push((block.group_name.clone(), avg, stdev));

                // Summary_All_Genes row.
                let mut s_cells: Vec<PatchCell> = vec![cell::empty(); summary_width];
                s_cells[0] = cell::text(target_gene.clone());
                s_cells[1] = cell::text(block.group_name.clone());
                for (i, re) in re_values.iter().enumerate() {
                    s_cells[2 + i] = cell::num(*re);
                }
                s_cells[2 + re_values.len()] = cell::num(avg);
                s_cells[3 + re_values.len()] = cell::num(stdev);
                s_cells[method_col - 1] = cell::text(method_note.clone());
                // Trailing raw Ct columns, copied with the yellow imputation
                // markers.
                for i in 0..request.repeat_count as usize {
                    s_cells[method_col + i] = ct_cell(block.ref_vals[i], block.ref_filled[i]);
                    s_cells[method_col + request.repeat_count as usize + i] =
                        ct_cell(block.target_vals[i], block.target_filled[i]);
                }
                summary.push_row(s_cells);

                summary_rows.push(SummaryRow {
                    gene_name: target_gene.clone(),
                    group_name: block.group_name.clone(),
                    repeats: re_values,
                    ref_cts: block.ref_vals.clone(),
                    target_cts: block.target_vals.clone(),
                    ref_filled: block.ref_filled.clone(),
                    target_filled: block.target_filled.clone(),
                    method_note: method_note.clone(),
                });
            }
            output_row += block.ref_vals.len() as u32;
        }

        // Chart-data table (Group_Name / Average / Stdev) at the bottom of
        // the gene sheet, plus the payload consumed by chart injection.
        if !group_map.is_empty() {
            let table_start = output_row + 2;
            gene_sheet.write_row_at(
                table_start,
                vec![
                    cell::bold_text("Group_Name"),
                    cell::bold_text("Average"),
                    cell::bold_text("Stdev"),
                ],
            );
            for (i, (name, avg, stdev)) in group_map.iter().enumerate() {
                gene_sheet.write_row_at(
                    table_start + 1 + i as u32,
                    vec![cell::text(name.clone()), cell::num(*avg), cell::num(*stdev)],
                );
            }
            chart_series.push(QpcrChartSeries {
                gene_name: sheet_name.clone(),
                ref_gene: request.ref_gene.clone(),
                points: group_map
                    .iter()
                    .map(|(name, avg, stdev)| QpcrChartPoint {
                        name: name.clone(),
                        avg: *avg,
                        stdev: *stdev,
                    })
                    .collect(),
                group_col: 1,
                data_start_row: table_start + 1,
                data_row_count: group_map.len() as u32,
            });
        }

        // Gene sheets are Times New Roman + left aligned, but receive no
        // identity fill, no freeze panes and no column widths (legacy only
        // runs the font/alignment pass on them).
        gene_sheet.font_name = FONT_NAME.to_string();
        gene_sheet.left_align = true;

        gene_sheet_bufs.push(gene_sheet);
        gene_sheet_names.push(sheet_name);
    }

    // Summary envelope: identity fill on the Gene/Group_Name columns, frozen
    // header row (set with the headers), Times New Roman, auto widths.
    summary.font_name = FONT_NAME.to_string();
    summary.left_align = true;
    summary.identity_fill_cols = vec![1, 2];
    summary.apply_auto_widths();

    let mut upsert_sheets: Vec<SheetPatch> = vec![summary.build()];
    for gene_sheet in gene_sheet_bufs {
        upsert_sheets.push(gene_sheet.build());
    }

    // Optional empty Charts_All_Genes placeholder (the renderer writes the
    // empty sheet; chart XML injection later rewrites the saved workbook in
    // place). Placed right after Summary_All_Genes, mirroring the legacy
    // tab order.
    if request.with_charts_sheet {
        upsert_sheets.insert(
            1,
            SheetPatch {
                name: "Charts_All_Genes".to_string(),
                rows: Vec::new(),
                font_name: String::new(),
                left_align: false,
                identity_fill_cols: Vec::new(),
                freeze_x: 0,
                freeze_y: 0,
                col_widths: Vec::new(),
                a1_note: None,
            },
        );
    }

    // ── Summary_Best_Replicates (择优重复) ───────────────────────────────
    if select_num >= 2 {
        let best = build_best_replicates(&summary_rows, select_num, &request.ref_gene);
        upsert_sheets.push(best);
    }

    // ── Summary_Outlier_Removed (离群值剔除) ─────────────────────────────
    if outlier_sd > 0.0 {
        let outlier = build_outlier_removed(
            &summary_rows,
            outlier_sd,
            request.repeat_count,
            &request.ref_gene,
        );
        upsert_sheets.push(outlier);
    }

    Ok(CalcResult {
        v: WIRE_VERSION,
        patch: WorkbookPatch {
            v: WIRE_VERSION,
            remove_sheets: vec![REMOVE_NON_PROTECTED.to_string()],
            upsert_sheets,
        },
        gene_sheet_names,
        method_note,
        chart_series,
    })
}

// ── Validation ──────────────────────────────────────────────────────────────

/// 择优重复数：0 关闭；否则必须是 ≥2 且 ≤ repeatCount（1 无意义，不允许）。
fn validate_select_num(select_num: u32, repeat_count: u32) -> Result<u32, MynxError> {
    if select_num == 0 {
        return Ok(select_num);
    }
    if select_num < 2 {
        return Err(MynxError::validation(
            "择优重复数必须是 0（关闭）或大于等于 2 的整数",
        ));
    }
    if select_num > repeat_count {
        return Err(MynxError::validation(format!(
            "择优重复数 {select_num} 不能大于重复次数 {repeat_count}"
        )));
    }
    Ok(select_num)
}

/// 离群值剔除阈值：0 关闭；否则必须是 >0 的有限数。
fn validate_outlier_sd(outlier_sd: f64) -> Result<f64, MynxError> {
    if outlier_sd == 0.0 {
        return Ok(outlier_sd);
    }
    if !outlier_sd.is_finite() || outlier_sd <= 0.0 {
        return Err(MynxError::validation(
            "离群值剔除阈值必须是大于 0 的数（或 0 关闭）",
        ));
    }
    Ok(outlier_sd)
}

// ── Sheet scanning ──────────────────────────────────────────────────────────

struct GroupRange {
    group_name: String,
    /// 1-based inclusive.
    start_row: u32,
    /// 1-based exclusive (legacy `endRow` is the row after the block).
    end_row: u32,
}

fn read_group_ranges(source: &SheetView, repeat_count: u32) -> Result<Vec<GroupRange>, MynxError> {
    let mut last_data_row = 1u32;
    for r in (2..=source.row_count()).rev() {
        let (value, _) = source.cell(r, 2);
        let group = js_string_of_value(value);
        if !group.trim().is_empty() {
            last_data_row = r;
            break;
        }
    }

    let mut ranges = Vec::new();
    let mut row = 2u32;
    while row <= last_data_row {
        let (value, _) = source.cell(row, 2);
        let group_name = js_string_of_value(value);
        let group_name = group_name.trim().to_string();
        if group_name.is_empty() {
            row += 1;
            continue;
        }
        let start_row = row;
        while row <= last_data_row {
            let (value, _) = source.cell(row, 2);
            let name = js_string_of_value(value);
            if name.trim() != group_name {
                break;
            }
            row += 1;
        }
        let actual = row - start_row;
        if actual != repeat_count {
            return Err(MynxError::validation(format!(
                "分组 \"{}\" 从第 {} 行开始有 {} 个重复，但当前设置为 {} 个。请检查重复次数或 Transformed Data 数据。",
                group_name, start_row, actual, repeat_count
            )));
        }
        ranges.push(GroupRange {
            group_name,
            start_row,
            end_row: row,
        });
    }
    Ok(ranges)
}

fn find_column(source: &SheetView, name: &str) -> Result<u32, MynxError> {
    for c in 1..=source.column_count() {
        let (value, _) = source.cell(1, c);
        let cell = js_string_of_value(value);
        if cell.trim() == name {
            return Ok(c);
        }
    }
    Err(MynxError::not_found(format!("Column {name} not found")))
}

// ── Value helpers ───────────────────────────────────────────────────────────

/// Legacy `parseNumber`: numbers pass through, strings go through
/// `parseFloat(String(v).trim())`, empty cells are NaN.
fn parse_number(value: &mynx_contracts::qpcr::CellValue) -> f64 {
    match value {
        mynx_contracts::qpcr::CellValue::Num(n) => *n,
        mynx_contracts::qpcr::CellValue::Text(text) => js_parse_float(text.trim()),
        mynx_contracts::qpcr::CellValue::Empty => f64::NAN,
    }
}

/// Raw Ct cell for the summary Ct columns: NaN becomes `N/A`, imputed cells
/// keep the yellow marker.
fn ct_cell(value: f64, filled: bool) -> PatchCell {
    let mut cell = if value.is_nan() {
        cell::text("N/A")
    } else {
        cell::num(value)
    };
    if filled {
        cell.fill = Some(fills::YELLOW.to_string());
    }
    cell
}

/// JS `String.prototype.substring(0, 31)` for the sheet-name cap. Only
/// differs from `chars().take(31)` for astral characters, which stay intact
/// here instead of being split mid-surrogate.
fn js_cap_31(name: &str) -> String {
    name.chars().take(31).collect()
}

/// Legacy `sampleStdev`: sample standard deviation over n−1; 0 for fewer
/// than two values.
fn sample_stdev(values: &[f64]) -> f64 {
    if values.len() <= 1 {
        return 0.0;
    }
    let avg = values.iter().fold(0.0, |a, b| a + b) / values.len() as f64;
    let variance = values
        .iter()
        .fold(0.0, |sum, v| sum + (v - avg) * (v - avg))
        / (values.len() - 1) as f64;
    variance.sqrt()
}

/// Legacy `bestKCombination`: exhaustive C(n,k) search for the k indices
/// with the lowest sample stdev; a strict `<` keeps the first-enumerated
/// combination on ties (lexicographic DFS order).
fn best_k_combination(values: &[f64], k: usize) -> Vec<usize> {
    let mut best: Vec<usize> = Vec::new();
    let mut best_stdev = f64::INFINITY;
    let mut combo: Vec<usize> = Vec::new();

    fn search(
        values: &[f64],
        k: usize,
        start: usize,
        combo: &mut Vec<usize>,
        best: &mut Vec<usize>,
        best_stdev: &mut f64,
    ) {
        if combo.len() == k {
            let selected: Vec<f64> = combo.iter().map(|&i| values[i]).collect();
            let stdev = sample_stdev(&selected);
            if stdev < *best_stdev {
                *best_stdev = stdev;
                *best = combo.clone();
            }
            return;
        }
        for i in start..values.len() {
            combo.push(i);
            search(values, k, i + 1, combo, best, best_stdev);
            combo.pop();
        }
    }

    search(values, k, 0, &mut combo, &mut best, &mut best_stdev);
    best
}

// ── Summary sheet scaffolding (shared by all summary sheets) ────────────────

/// Writes the summary header row (Gene, Group_Name, Repeat1..N, Average,
/// Stdev, Method, `{refGene}_Ct_R1..N`, `Target_Ct_R1..N`), bold with the
/// column-group fills and a medium bottom border, and freezes the first row
/// + first two columns. Returns the 1-based Method column.
fn write_summary_headers(sheet: &mut PatchSheetBuf, rep_count: u32, ref_gene: &str) -> u32 {
    let mut cells: Vec<PatchCell> = Vec::new();
    let push = |cells: &mut Vec<PatchCell>, text: &str, fill: &str| {
        cells.push(cell::header(text, Some(fill)))
    };
    push(&mut cells, "Gene", fills::HEADER_IDENTITY);
    push(&mut cells, "Group_Name", fills::HEADER_IDENTITY);
    for i in 1..=rep_count {
        push(&mut cells, &format!("Repeat{i}"), fills::HEADER_REPEATS);
    }
    push(&mut cells, "Average", fills::HEADER_STATS);
    push(&mut cells, "Stdev", fills::HEADER_STATS);
    push(&mut cells, "Method", fills::HEADER_METHOD);
    // 1-based index of 'Method' == number of header cells pushed so far
    // (legacy `summaryHeaders.length`).
    let method_col = cells.len() as u32;
    for i in 1..=rep_count {
        push(
            &mut cells,
            &format!("{ref_gene}_Ct_R{i}"),
            fills::HEADER_REF_CT,
        );
    }
    for i in 1..=rep_count {
        push(
            &mut cells,
            &format!("Target_Ct_R{i}"),
            fills::HEADER_TARGET_CT,
        );
    }
    sheet.push_row(cells);
    sheet.font_name = FONT_NAME.to_string();
    sheet.left_align = true;
    sheet.freeze_x = 2;
    sheet.freeze_y = 1;
    method_col
}

/// Shared styling envelope of the derived summary sheets (identity fill on
/// the Gene/Group_Name data columns + auto column widths).
fn finish_summary_sheet(sheet: &mut PatchSheetBuf) {
    sheet.font_name = FONT_NAME.to_string();
    sheet.left_align = true;
    sheet.identity_fill_cols = vec![1, 2];
    sheet.apply_auto_widths();
}

// ── Summary_Best_Replicates ─────────────────────────────────────────────────

fn build_best_replicates(rows: &[SummaryRow], select_num: u32, ref_gene: &str) -> SheetPatch {
    let mut sheet = PatchSheetBuf::new("Summary_Best_Replicates");
    let method_col = write_summary_headers(&mut sheet, select_num, ref_gene) as usize;
    let width = method_col + 2 * select_num as usize;
    sheet.a1_note = Some(
        "QC reference only: each row keeps the K replicates with the lowest standard deviation. \
         This understates variability and is not a standard statistical result — \
         use Summary_All_Genes (all replicates) for reporting."
            .to_string(),
    );

    for row in rows {
        let best_idx = best_k_combination(&row.repeats, select_num as usize);
        if best_idx.len() != select_num as usize {
            continue;
        }

        let mut cells: Vec<PatchCell> = vec![cell::empty(); width];
        cells[0] = cell::text(row.gene_name.clone());
        cells[1] = cell::text(row.group_name.clone());
        for (i, &idx) in best_idx.iter().enumerate() {
            cells[2 + i] = cell::num(row.repeats[idx]);
        }
        let selected: Vec<f64> = best_idx.iter().map(|&i| row.repeats[i]).collect();
        let avg = selected.iter().fold(0.0, |a, b| a + b) / selected.len() as f64;
        let stdev = sample_stdev(&selected);
        cells[2 + select_num as usize] = cell::num(avg);
        cells[3 + select_num as usize] = cell::num(stdev);
        // Method note annotated so every row self-identifies as the
        // lowest-stdev subset QC result.
        cells[method_col - 1] = if row.method_note.is_empty() {
            cell::text(String::new())
        } else {
            cell::text(format!("{} (Best-K subset)", row.method_note))
        };
        // Trailing Ct columns: only the selected replicates, keeping the
        // yellow imputation markers.
        for (i, &idx) in best_idx.iter().enumerate() {
            cells[method_col + i] = ct_cell(row.ref_cts[idx], row.ref_filled[idx]);
            cells[method_col + select_num as usize + i] =
                ct_cell(row.target_cts[idx], row.target_filled[idx]);
        }
        sheet.push_row(cells);
    }

    finish_summary_sheet(&mut sheet);
    sheet.build()
}

// ── Summary_Outlier_Removed ─────────────────────────────────────────────────

fn build_outlier_removed(
    rows: &[SummaryRow],
    outlier_sd: f64,
    repeat_count: u32,
    ref_gene: &str,
) -> SheetPatch {
    let mut sheet = PatchSheetBuf::new("Summary_Outlier_Removed");
    let method_col = write_summary_headers(&mut sheet, repeat_count, ref_gene) as usize;
    let removed_col = method_col + 1 + 2 * repeat_count as usize; // 1-based
    let width = removed_col;
    sheet.a1_note = Some(format!(
        "Outlier removal: replicates deviating from the group mean by more than {}×SD \
         (mean/SD recomputed after each removal) are excluded; the remaining replicates are \
         reported. Removed replicate numbers are listed in the Removed column.",
        js_number_to_string(outlier_sd)
    ));

    // Trailing Removed column header.
    {
        let header = sheet.header_row_mut();
        header.resize(removed_col, cell::empty());
        header[removed_col - 1] = cell::header("Removed", Some(fills::REMOVED));
    }

    for row in rows {
        // Iterative removal: each round removes the replicate with the
        // largest deviation when it exceeds outlierSd × SD, then recomputes
        // mean/SD, until nothing exceeds (or one replicate remains).
        let n = repeat_count as usize;
        let mut keep: Vec<usize> = (0..n).collect();
        let mut removed: Vec<usize> = Vec::new();
        while keep.len() > 1 {
            let kept_vals: Vec<f64> = keep.iter().map(|&i| row.repeats[i]).collect();
            let mean = kept_vals.iter().fold(0.0, |a, b| a + b) / kept_vals.len() as f64;
            let sd = sample_stdev(&kept_vals);
            if !(sd > 0.0) {
                break; // all equal, nothing to remove
            }
            let mut worst_pos = 0usize;
            let mut max_dev = 0.0f64;
            for (j, &idx) in keep.iter().enumerate() {
                let dev = (row.repeats[idx] - mean).abs();
                if dev > max_dev {
                    max_dev = dev;
                    worst_pos = j;
                }
            }
            if max_dev > outlier_sd * sd {
                removed.push(keep[worst_pos]);
                keep.remove(worst_pos);
            } else {
                break;
            }
        }
        removed.sort_unstable();

        let kept: std::collections::HashSet<usize> = keep.iter().copied().collect();
        let mut cells: Vec<PatchCell> = vec![cell::empty(); width];
        cells[0] = cell::text(row.gene_name.clone());
        cells[1] = cell::text(row.group_name.clone());
        for i in 0..n {
            if kept.contains(&i) {
                cells[2 + i] = cell::num(row.repeats[i]); // removed stay empty
            }
        }
        let kept_vals: Vec<f64> = keep.iter().map(|&i| row.repeats[i]).collect();
        let avg = kept_vals.iter().fold(0.0, |a, b| a + b) / kept_vals.len() as f64;
        cells[2 + n] = cell::num(avg);
        cells[3 + n] = cell::num(sample_stdev(&kept_vals));
        cells[method_col - 1] = if row.method_note.is_empty() {
            cell::text(String::new())
        } else {
            cell::text(format!(
                "{} (Outlier-removed: |Δ|>{}×SD)",
                row.method_note,
                js_number_to_string(outlier_sd)
            ))
        };
        for i in 0..n {
            if !kept.contains(&i) {
                continue;
            }
            cells[method_col + i] = ct_cell(row.ref_cts[i], row.ref_filled[i]);
            cells[method_col + repeat_count as usize + i] =
                ct_cell(row.target_cts[i], row.target_filled[i]);
        }
        cells[removed_col - 1] = if !removed.is_empty() {
            cell::text(format!(
                "R{}",
                removed
                    .iter()
                    .map(|i| (i + 1).to_string())
                    .collect::<Vec<_>>()
                    .join(", R")
            ))
        } else {
            cell::text("-")
        };
        sheet.push_row(cells);
    }

    finish_summary_sheet(&mut sheet);
    sheet.build()
}

#[cfg(test)]
mod tests {

    fn show(value: &mynx_contracts::qpcr::PatchValue) -> String {
        match value {
            mynx_contracts::qpcr::PatchValue::Empty => "empty".to_string(),
            mynx_contracts::qpcr::PatchValue::Num(n) => format!("num({n})"),
            mynx_contracts::qpcr::PatchValue::Text(s) => format!("text({s})"),
        }
    }
    use super::*;
    use mynx_contracts::qpcr::PatchValue;

    fn row(repeats: Vec<f64>) -> SummaryRow {
        SummaryRow {
            gene_name: "G".into(),
            group_name: "C".into(),
            ref_cts: vec![20.0; repeats.len()],
            target_cts: vec![24.0; repeats.len()],
            ref_filled: vec![false; repeats.len()],
            target_filled: vec![false; repeats.len()],
            method_note: "Reference-normalized".into(),
            repeats,
        }
    }

    #[test]
    fn stdev_matches_legacy() {
        assert_eq!(sample_stdev(&[]), 0.0);
        assert_eq!(sample_stdev(&[5.0]), 0.0);
        assert_eq!(
            sample_stdev(&[2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]),
            (32.0f64 / 7.0).sqrt()
        );
    }

    #[test]
    fn best_k_picks_lowest_stdev_first_on_ties() {
        // C(3,2): [0,1] sd=0 → picked immediately.
        assert_eq!(best_k_combination(&[1.0, 1.0, 9.0], 2), vec![0, 1]);
        // (1,5) and (5,9) tie at sd=√8 — first enumerated [0,1] wins.
        assert_eq!(best_k_combination(&[1.0, 5.0, 9.0], 2), vec![0, 1]);
        // Clear winner in the middle.
        assert_eq!(best_k_combination(&[0.0, 10.0, 10.5, 20.0], 2), vec![1, 2]);
    }

    #[test]
    fn outlier_removal_reports_removed_indices() {
        // At k=1.0 the 100 deviates more than 1×SD → removed in round one;
        // the remaining pair has sd=0 → stop.
        let sheet = build_outlier_removed(&[row(vec![100.0, 10.0, 10.0])], 1.0, 3, "GAPDH");
        let last = sheet.rows[0].cells.len();
        assert_eq!(
            show(&sheet.rows[1].cells[last - 1].value),
            format!("text({})", "R1")
        );
        // Kept replicates: col 3 empty (removed), cols 4/5 hold 10/10.
        assert_eq!(show(&sheet.rows[1].cells[2].value), "empty");
        assert_eq!(
            show(&sheet.rows[1].cells[3].value),
            format!("num({})", 10.0)
        );
        assert_eq!(
            show(&sheet.rows[1].cells[4].value),
            format!("num({})", 10.0)
        );
    }

    #[test]
    fn outlier_removal_is_iterative_until_stable() {
        // [100, 90, 10] at k=1.0: round one removes idx 2 (dev 56.7 > sd
        // 49.3); round two keeps [100, 90] (dev 5 ≤ sd 10).
        let sheet = build_outlier_removed(&[row(vec![100.0, 90.0, 10.0])], 1.0, 3, "GAPDH");
        let last = sheet.rows[0].cells.len();
        assert_eq!(
            show(&sheet.rows[1].cells[last - 1].value),
            format!("text({})", "R3")
        );
        assert_eq!(
            show(&sheet.rows[1].cells[2].value),
            format!("num({})", 100.0)
        );
        assert_eq!(
            show(&sheet.rows[1].cells[3].value),
            format!("num({})", 90.0)
        );
        assert_eq!(show(&sheet.rows[1].cells[4].value), "empty");
    }

    fn snapshot(
        rows: Vec<Vec<Option<mynx_contracts::qpcr::CellValue>>>,
    ) -> mynx_contracts::qpcr::SheetSnapshot {
        let width = rows.iter().map(Vec::len).max().unwrap_or(0) as u32;
        let out_rows = rows
            .iter()
            .enumerate()
            .map(|(ri, row)| mynx_contracts::qpcr::RowSnapshot {
                row: ri as u32 + 1,
                cells: row
                    .iter()
                    .enumerate()
                    .filter_map(|(ci, value)| {
                        value.clone().map(|v| mynx_contracts::qpcr::CellSnapshot {
                            col: ci as u32 + 1,
                            value: v,
                            yellow_fill: false,
                        })
                    })
                    .collect(),
            })
            .collect();
        mynx_contracts::qpcr::SheetSnapshot {
            name: "Transformed Data".to_string(),
            column_count: width,
            row_count: rows.len() as u32,
            rows: out_rows,
        }
    }

    use mynx_contracts::qpcr::{CalcOptions, CellValue};
    use mynx_contracts::WIRE_VERSION;

    #[test]
    fn non_numeric_replicates_become_na_and_skip_summary() {
        // Group A has a non-numeric TNF replicate → its gene-sheet row gets
        // 'N/A', the group is absent from Summary_All_Genes and from the
        // chart table; group B is complete.
        let source = snapshot(vec![
            vec![
                Some(CellValue::Text("Num".into())),
                Some(CellValue::Text("Group".into())),
                Some(CellValue::Text("GAPDH".into())),
                Some(CellValue::Text("TNF".into())),
            ],
            vec![
                Some(CellValue::Num(1.0)),
                Some(CellValue::Text("A".into())),
                Some(CellValue::Num(20.0)),
                Some(CellValue::Num(24.0)),
            ],
            vec![
                Some(CellValue::Num(2.0)),
                Some(CellValue::Text("A".into())),
                Some(CellValue::Num(20.5)),
                Some(CellValue::Text("bad".into())),
            ],
            vec![
                Some(CellValue::Num(3.0)),
                Some(CellValue::Text("B".into())),
                Some(CellValue::Num(20.2)),
                Some(CellValue::Num(25.0)),
            ],
            vec![
                Some(CellValue::Num(4.0)),
                Some(CellValue::Text("B".into())),
                Some(CellValue::Num(20.1)),
                Some(CellValue::Num(25.1)),
            ],
        ]);
        let request = CalcRequest {
            v: WIRE_VERSION,
            source,
            repeat_count: 2,
            ref_gene: "GAPDH".to_string(),
            options: CalcOptions::default(),
            with_charts_sheet: false,
        };
        let result = calculate(request).expect("calculate succeeds");

        // Only group B reaches the summary.
        let summary = &result.patch.upsert_sheets[0];
        assert_eq!(summary.rows.len(), 2);
        assert_eq!(
            show(&summary.rows[1].cells[1].value),
            format!("text({})", "B")
        );

        // TNF gene sheet: row 3 col 3 is 'N/A', cols 4/5 empty; the chart
        // table only holds group B.
        let tnf = &result.patch.upsert_sheets[1];
        assert_eq!(
            show(&tnf.rows[2].cells[2].value),
            format!("text({})", "N/A")
        );
        assert_eq!(show(&tnf.rows[2].cells[3].value), "empty");
        assert_eq!(result.chart_series.len(), 1);
        assert_eq!(result.chart_series[0].points.len(), 1);
        assert_eq!(result.chart_series[0].points[0].name, "B");
    }

    #[test]
    fn missing_sheet_and_column_errors() {
        let mut source = snapshot(vec![vec![Some(CellValue::Text("x".into()))]]);
        source.name = "Raw".to_string();
        let err = calculate(CalcRequest {
            v: WIRE_VERSION,
            source,
            repeat_count: 1,
            ref_gene: "GAPDH".to_string(),
            options: CalcOptions::default(),
            with_charts_sheet: false,
        })
        .unwrap_err();
        assert_eq!(err.message, "Transformed Data sheet not found");

        let source = snapshot(vec![
            vec![
                Some(CellValue::Text("Num".into())),
                Some(CellValue::Text("Group".into())),
                Some(CellValue::Text("TNF".into())),
            ],
            vec![
                Some(CellValue::Num(1.0)),
                Some(CellValue::Text("A".into())),
                Some(CellValue::Num(24.0)),
            ],
        ]);
        let err = calculate(CalcRequest {
            v: WIRE_VERSION,
            source,
            repeat_count: 1,
            ref_gene: "GAPDH".to_string(),
            options: CalcOptions::default(),
            with_charts_sheet: false,
        })
        .unwrap_err();
        assert_eq!(err.message, "Column GAPDH not found");
    }

    #[test]
    fn n3_group_never_triggers_removal_at_2sd() {
        // Grubbs bound for n=3 is ~1.15 SD — an isolated outlier can never
        // exceed 2×SD with three replicates, so the Removed column stays '-'.
        let sheet = build_outlier_removed(&[row(vec![0.7578, 0.7578, 0.0508])], 2.0, 3, "GAPDH");
        let last = sheet.rows[0].cells.len();
        assert_eq!(
            show(&sheet.rows[1].cells[last - 1].value),
            format!("text({})", "-")
        );
    }
}
