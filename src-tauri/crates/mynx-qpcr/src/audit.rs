//! Read-only qPCR worksheet audit; it does not mutate or filter input data.
use std::collections::{HashMap, HashSet};

use mynx_contracts::qpcr::{CellValue, QpcrAuditRequest, QpcrAuditResult};
use mynx_contracts::task::MynxError;
use mynx_contracts::WIRE_VERSION;

use crate::jsval::{js_parse_float, js_string_of_value};
use crate::sheet::SheetView;

const TARGET_HEADERS: [&str; 3] = ["Target", "Gene", "基因"];
const SAMPLE_HEADERS: [&str; 4] = ["Sample", "Group", "样本", "分组"];
const CT_HEADERS: [&str; 2] = ["Cq", "Ct"];

pub fn audit(request: QpcrAuditRequest) -> Result<QpcrAuditResult, MynxError> {
    let source = SheetView::new(&request.source);
    let mut result = QpcrAuditResult {
        v: WIRE_VERSION,
        sheet_name: source.name().to_string(),
        data_rows: source.row_count().saturating_sub(1),
        accepted_rows: 0,
        skipped_rows: 0,
        missing_ct_rows: 0,
        invalid_ct_rows: 0,
        sample_count: 0,
        gene_count: 0,
        incomplete_cells: 0,
        imputed_cells: 0,
        issue_rows: Vec::new(),
        target_header: None,
        sample_header: None,
        ct_header: None,
    };
    if request.transformed {
        let mut samples = HashSet::new();
        let mut genes = HashSet::new();
        for col in 3..=source.column_count() {
            let (value, _) = source.cell(1, col);
            let name = js_string_of_value(value).trim().to_string();
            if !name.is_empty() {
                genes.insert(name);
            }
        }
        for row in 2..=source.row_count() {
            let (sample, _) = source.cell(row, 2);
            if !js_string_of_value(sample).trim().is_empty() {
                samples.insert(js_string_of_value(sample).trim().to_string());
                result.accepted_rows += 1;
            }
            for col in 3..=source.column_count() {
                let (value, yellow) = source.cell(row, col);
                if yellow {
                    result.imputed_cells += 1;
                }
                if matches!(value, CellValue::Empty) {
                    result.incomplete_cells += 1;
                    record_issue(&mut result, row);
                }
            }
        }
        result.sample_count = samples.len() as u32;
        result.gene_count = genes.len() as u32;
        result.skipped_rows = result.data_rows.saturating_sub(result.accepted_rows);
        return Ok(result);
    }

    let mut headers = Vec::with_capacity(source.column_count() as usize);
    for col in 1..=source.column_count() {
        let (value, _) = source.cell(1, col);
        headers.push(js_string_of_value(value));
    }
    let mut target = detect(&headers, &TARGET_HEADERS);
    let mut sample = detect(&headers, &SAMPLE_HEADERS);
    let mut ct = detect(&headers, &CT_HEADERS);
    if target == usize::MAX && headers.len() >= 6 {
        let fallback = headers[2].to_lowercase();
        if fallback.contains("target") || fallback.contains("gene") || fallback.contains("基因") {
            target = 2;
            sample = 4;
            ct = 5;
        }
    }
    if target == usize::MAX {
        return Err(MynxError::validation("未找到 Target/Gene/基因 列"));
    }
    if sample == usize::MAX {
        return Err(MynxError::validation("未找到 Sample/Group/样本/分组 列"));
    }
    if ct == usize::MAX {
        return Err(MynxError::validation("未找到 Cq/Ct 列"));
    }
    result.target_header = Some(headers[target].clone());
    result.sample_header = Some(headers[sample].clone());
    result.ct_header = Some(headers[ct].clone());

    let mut samples = HashSet::new();
    let mut genes = HashSet::new();
    let mut per_sample: HashMap<String, HashMap<String, Vec<bool>>> = HashMap::new();
    for row in 2..=source.row_count() {
        let gene = js_string_of_value(source.cell(row, target as u32 + 1).0)
            .trim()
            .to_string();
        let sample_name = js_string_of_value(source.cell(row, sample as u32 + 1).0)
            .trim()
            .to_string();
        if gene.is_empty() || sample_name.is_empty() {
            result.skipped_rows += 1;
            record_issue(&mut result, row);
            continue;
        }
        result.accepted_rows += 1;
        samples.insert(sample_name.clone());
        genes.insert(gene.clone());
        let value = source.cell(row, ct as u32 + 1).0;
        let valid = match value {
            CellValue::Num(_) => true,
            CellValue::Text(s) => !js_parse_float(s).is_nan(),
            CellValue::Empty => false,
        };
        if !valid {
            if matches!(value, CellValue::Empty) {
                result.missing_ct_rows += 1;
            } else {
                result.invalid_ct_rows += 1;
            }
            record_issue(&mut result, row);
        }
        per_sample
            .entry(sample_name)
            .or_default()
            .entry(gene)
            .or_default()
            .push(valid);
    }
    result.sample_count = samples.len() as u32;
    result.gene_count = genes.len() as u32;
    for gene_map in per_sample.values() {
        let max_reps = gene_map.values().map(Vec::len).max().unwrap_or(0);
        for gene in &genes {
            match gene_map.get(gene) {
                None => result.incomplete_cells += max_reps as u32,
                Some(values) => {
                    result.incomplete_cells += values.iter().filter(|valid| !**valid).count() as u32
                        + (max_reps - values.len()) as u32
                }
            }
        }
    }
    result.imputed_cells = result.incomplete_cells;
    Ok(result)
}

fn detect(headers: &[String], keywords: &[&str]) -> usize {
    headers
        .iter()
        .position(|header| {
            let h = header.trim().to_lowercase();
            !h.is_empty() && keywords.iter().any(|keyword| keyword.to_lowercase() == h)
        })
        .unwrap_or(usize::MAX)
}

fn record_issue(result: &mut QpcrAuditResult, row: u32) {
    if result.issue_rows.len() < 20 && !result.issue_rows.contains(&row) {
        result.issue_rows.push(row);
    }
}
