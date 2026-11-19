//! Transform stage — port of `src/lib/qpcr-transform.ts` (`transformQpcrData`).
//!
//! Reads a raw Target/Gene + Sample/Group + Cq/Ct sheet and produces the
//! `Transformed Data` sheet patch: one row per sample replicate, genes as
//! columns, missing Cq values imputed with the mean of the valid replicates
//! of the same sample+gene (or 50 when none remain) and flagged yellow.

use std::collections::HashMap;

use mynx_contracts::qpcr::{
    CellValue, SheetPatch, TransformRequest, TransformResult, WorkbookPatch,
};
use mynx_contracts::task::MynxError;
use mynx_contracts::WIRE_VERSION;

use crate::jsval::{js_parse_float, js_string_of_value};
use crate::sheet::{cell, fills, PatchSheetBuf, SheetView};
use mynx_contracts::qpcr::PatchCell;

const TARGET_HEADERS: [&str; 3] = ["Target", "Gene", "基因"];
const SAMPLE_HEADERS: [&str; 4] = ["Sample", "Group", "样本", "分组"];
const CT_HEADERS: [&str; 2] = ["Cq", "Ct"];

const TRANSFORMED_SHEET: &str = "Transformed Data";
const FONT_NAME: &str = "Times New Roman";

/// One raw Cq observation. `None` mirrors the legacy `{ value: null,
/// missing: true }` pair (the two are always set together there).
type CtObservation = Option<f64>;

pub fn transform(request: TransformRequest) -> Result<TransformResult, MynxError> {
    let source = SheetView::new(&request.source);

    // ── Header detection ────────────────────────────────────────────────
    let mut headers: Vec<String> = Vec::with_capacity(source.column_count() as usize);
    for c in 1..=source.column_count() {
        let (value, _) = source.cell(1, c);
        headers.push(js_string_of_value(value));
    }

    let mut target_col = detect_column(&headers, &TARGET_HEADERS);
    let mut sample_col = detect_column(&headers, &SAMPLE_HEADERS);
    let mut ct_col = detect_column(&headers, &CT_HEADERS);

    if target_col == usize::MAX && headers.len() >= 6 {
        let fallback_target = headers[2].to_lowercase();
        if fallback_target.contains("target")
            || fallback_target.contains("gene")
            || fallback_target.contains("基因")
        {
            target_col = 2;
            sample_col = 4;
            ct_col = 5;
        }
    }

    if target_col == usize::MAX {
        return Err(MynxError::validation("未找到 Target/Gene/基因 列"));
    }
    if sample_col == usize::MAX {
        return Err(MynxError::validation("未找到 Sample/Group/样本/分组 列"));
    }
    if ct_col == usize::MAX {
        return Err(MynxError::validation("未找到 Cq/Ct 列"));
    }

    // 1-based column numbers inside the workbook.
    let target_col_index = (target_col + 1) as u32;
    let sample_col_index = (sample_col + 1) as u32;
    let ct_col_index = (ct_col + 1) as u32;

    // ── Group rows into sample → gene → Cq observations ─────────────────
    // Insertion order is significant (JS Map/Set semantics): samples and
    // genes keep their first-seen order and drive the output layout.
    let mut sample_order: Vec<String> = Vec::new();
    let mut sample_map: HashMap<String, HashMap<String, Vec<CtObservation>>> = HashMap::new();
    let mut gene_order: Vec<String> = Vec::new();
    let mut gene_seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for r in 2..=source.row_count() {
        let (gene_value, _) = source.cell(r, target_col_index);
        let gene = js_string_of_value(gene_value);
        let gene = gene.trim();
        let (sample_value, _) = source.cell(r, sample_col_index);
        let sample = js_string_of_value(sample_value);
        let sample = sample.trim();

        if gene.is_empty() || sample.is_empty() {
            continue;
        }
        let (ct_value, _) = source.cell(r, ct_col_index);
        let ct: CtObservation = match ct_value {
            CellValue::Num(n) => Some(*n),
            CellValue::Text(text) => {
                let parsed = js_parse_float(text);
                if parsed.is_nan() {
                    None
                } else {
                    Some(parsed)
                }
            }
            CellValue::Empty => None,
        };

        if gene_seen.insert(gene.to_string()) {
            gene_order.push(gene.to_string());
        }
        let gene_map = sample_map.entry(sample.to_string()).or_insert_with(|| {
            sample_order.push(sample.to_string());
            HashMap::new()
        });
        gene_map.entry(gene.to_string()).or_default().push(ct);
    }

    let gene_names = gene_order;

    // ── Build the Transformed Data sheet patch ──────────────────────────
    let mut sheet = PatchSheetBuf::new(TRANSFORMED_SHEET);

    // Header row: Num/Group blue, gene columns darker blue; bold with a
    // medium grey bottom border.
    let mut header_cells = vec![
        cell::header("Num", Some(fills::HEADER_IDENTITY)),
        cell::header("Group", Some(fills::HEADER_IDENTITY)),
    ];
    for gene in &gene_names {
        header_cells.push(cell::header(gene, Some(fills::HEADER_REPEATS)));
    }
    sheet.push_row(header_cells);

    let mut groups: Vec<String> = Vec::new();
    for sample in &sample_order {
        let gene_map = &sample_map[sample];
        groups.push(sample.clone());

        let sample_max_reps = gene_map.values().map(Vec::len).max().unwrap_or(0);
        for rep in 0..sample_max_reps {
            let mut cells = Vec::with_capacity(2 + gene_names.len());
            // 1-based data row index minus one: the Num column counts data
            // rows starting at 1 (header excluded).
            cells.push(cell::num(sheet.next_row() as f64 - 1.0));
            cells.push(cell::text(sample));

            for gene in &gene_names {
                let missing_cell = |cells: &mut Vec<PatchCell>| {
                    let mut cell = cell::num(50.0);
                    cell.fill = Some(fills::YELLOW.to_string());
                    cells.push(cell);
                };
                match gene_map.get(gene) {
                    None => missing_cell(&mut cells),
                    Some(vals) if vals.is_empty() => missing_cell(&mut cells),
                    Some(vals) => {
                        // Missing values are imputed with the mean of the
                        // valid replicates of the same sample+gene, or 50
                        // when none remain.
                        let valid: Vec<f64> = vals.iter().filter_map(|v| *v).collect();
                        let fill_value = if !valid.is_empty() {
                            valid.iter().fold(0.0, |sum, v| sum + v) / valid.len() as f64
                        } else {
                            50.0
                        };
                        let item = vals.get(rep).copied().flatten();
                        match item {
                            Some(value) => cells.push(cell::num(value)),
                            None => {
                                let mut cell = cell::num(fill_value);
                                cell.fill = Some(fills::YELLOW.to_string());
                                cells.push(cell);
                            }
                        }
                    }
                }
            }
            sheet.push_row(cells);
        }
    }

    // Sheet-wide envelope: Times New Roman, left alignment, identity fill on
    // the Group column (data rows), frozen first row + first two columns,
    // auto column widths.
    sheet.font_name = FONT_NAME.to_string();
    sheet.left_align = true;
    sheet.identity_fill_cols = vec![2];
    sheet.freeze_x = 2;
    sheet.freeze_y = 1;
    sheet.apply_auto_widths();

    let patch: SheetPatch = sheet.build();
    Ok(TransformResult {
        v: WIRE_VERSION,
        patch: WorkbookPatch {
            v: WIRE_VERSION,
            remove_sheets: Vec::new(),
            upsert_sheets: vec![patch],
        },
        gene_names,
        groups,
    })
}

/// Legacy `detectColumn`: first 0-based column whose trimmed, lowercased
/// header equals one of the keywords. `usize::MAX` mirrors `-1`.
fn detect_column(headers: &[String], keywords: &[&str]) -> usize {
    for (i, header) in headers.iter().enumerate() {
        let h = header.trim().to_lowercase();
        if !h.is_empty() && keywords.iter().any(|k| k.to_lowercase() == h) {
            return i;
        }
    }
    usize::MAX
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

    fn snapshot(
        name: &str,
        rows: Vec<Vec<Option<CellValue>>>,
    ) -> mynx_contracts::qpcr::SheetSnapshot {
        let width = rows.iter().map(Vec::len).max().unwrap_or(0) as u32;
        let mut out_rows = Vec::new();
        for (ri, row) in rows.iter().enumerate() {
            let mut cells = Vec::new();
            for (ci, value) in row.iter().enumerate() {
                if let Some(v) = value {
                    cells.push(mynx_contracts::qpcr::CellSnapshot {
                        col: ci as u32 + 1,
                        value: v.clone(),
                        yellow_fill: false,
                    });
                }
            }
            out_rows.push(mynx_contracts::qpcr::RowSnapshot {
                row: ri as u32 + 1,
                cells,
            });
        }
        mynx_contracts::qpcr::SheetSnapshot {
            name: name.to_string(),
            column_count: width,
            row_count: rows.len() as u32,
            rows: out_rows,
        }
    }

    #[test]
    fn header_fallback_kicks_in_when_keywords_miss() {
        // Legacy 6-column layout: target at C, sample at E, Cq at F.
        let rows = vec![
            vec![
                Some(CellValue::Text("No".into())),
                Some(CellValue::Text("Note".into())),
                Some(CellValue::Text("GeneName".into())),
                Some(CellValue::Text("Rep".into())),
                Some(CellValue::Text("Sample".into())),
                Some(CellValue::Text("Ct value".into())),
            ],
            vec![
                None,
                None,
                Some(CellValue::Text("GAPDH".into())),
                None,
                Some(CellValue::Text("C1".into())),
                Some(CellValue::Num(21.0)),
            ],
        ];
        let request = TransformRequest {
            v: WIRE_VERSION,
            source: snapshot("Data", rows),
        };
        let result = transform(request).expect("transform succeeds");
        assert_eq!(result.gene_names, vec!["GAPDH"]);
        assert_eq!(result.groups, vec!["C1"]);
        let sheet = &result.patch.upsert_sheets[0];
        assert_eq!(sheet.rows.len(), 2);
        assert_eq!(
            show(&sheet.rows[1].cells[1].value),
            format!("text({})", "C1")
        );
        assert_eq!(
            show(&sheet.rows[1].cells[2].value),
            format!("num({})", 21.0)
        );
    }

    #[test]
    fn missing_columns_error_in_legacy_order() {
        let rows = vec![vec![Some(CellValue::Text("A".into()))]];
        let err = transform(TransformRequest {
            v: WIRE_VERSION,
            source: snapshot("Data", rows),
        })
        .unwrap_err();
        assert_eq!(err.message, "未找到 Target/Gene/基因 列");

        let rows = vec![vec![
            Some(CellValue::Text("Target".into())),
            Some(CellValue::Text("x".into())),
        ]];
        let err = transform(TransformRequest {
            v: WIRE_VERSION,
            source: snapshot("Data", rows),
        })
        .unwrap_err();
        assert_eq!(err.message, "未找到 Sample/Group/样本/分组 列");
    }

    #[test]
    fn text_numbers_parse_and_junk_rows_are_skipped() {
        let rows = vec![
            vec![
                Some(CellValue::Text("样本".into())),
                Some(CellValue::Text("Target".into())),
                Some(CellValue::Text("Cq".into())),
            ],
            vec![
                Some(CellValue::Text("G1".into())),
                Some(CellValue::Text("GAPDH".into())),
                Some(CellValue::Text("  21.5 ".into())),
            ],
            vec![
                Some(CellValue::Text("".into())),
                Some(CellValue::Text("GAPDH".into())),
                Some(CellValue::Num(20.0)),
            ],
            vec![
                Some(CellValue::Text("G1".into())),
                Some(CellValue::Text("".into())),
                Some(CellValue::Num(20.0)),
            ],
            vec![
                Some(CellValue::Text("G1".into())),
                Some(CellValue::Text("GAPDH".into())),
                Some(CellValue::Text("not-a-number".into())),
            ],
        ];
        let request = TransformRequest {
            v: WIRE_VERSION,
            source: snapshot("Data", rows),
        };
        let result = transform(request).expect("transform succeeds");
        assert_eq!(result.gene_names, vec!["GAPDH"]);
        assert_eq!(result.groups, vec!["G1"]);
        let sheet = &result.patch.upsert_sheets[0];
        // Rows 3/4 are skipped (empty sample / empty gene); rows 2 and 5
        // give G1 two observations → two data rows after the header.
        assert_eq!(sheet.rows.len(), 3);
        assert_eq!(
            show(&sheet.rows[1].cells[2].value),
            format!("num({})", 21.5)
        );
        assert_eq!(sheet.rows[1].cells[2].fill, None);
        // Second replicate: "not-a-number" → missing → imputed 21.5, yellow.
        assert_eq!(
            show(&sheet.rows[2].cells[2].value),
            format!("num({})", 21.5)
        );
        assert_eq!(sheet.rows[2].cells[2].fill.as_deref(), Some("FFFFFF00"));
    }

    #[test]
    fn fully_missing_gene_uses_50_and_yellow() {
        let rows = vec![
            vec![
                Some(CellValue::Text("Sample".into())),
                Some(CellValue::Text("Target".into())),
                Some(CellValue::Text("Cq".into())),
            ],
            vec![
                Some(CellValue::Text("S1".into())),
                Some(CellValue::Text("TNF".into())),
                Some(CellValue::Text("bad".into())),
            ],
            vec![
                Some(CellValue::Text("S1".into())),
                Some(CellValue::Text("GAPDH".into())),
                Some(CellValue::Num(20.0)),
            ],
        ];
        let result = transform(TransformRequest {
            v: WIRE_VERSION,
            source: snapshot("Data", rows),
        })
        .expect("transform succeeds");
        assert_eq!(result.gene_names, vec!["TNF", "GAPDH"]);
        let sheet = &result.patch.upsert_sheets[0];
        let data = &sheet.rows[1].cells;
        assert_eq!(show(&data[2].value), format!("num({})", 50.0));
        assert_eq!(data[2].fill.as_deref(), Some("FFFFFF00"));
        assert_eq!(show(&data[3].value), format!("num({})", 20.0));
        assert_eq!(data[3].fill, None);
    }
}
