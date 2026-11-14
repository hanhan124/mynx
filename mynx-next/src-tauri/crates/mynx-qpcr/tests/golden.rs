//! Golden-fixture parity tests for the qPCR transform/calculate pipeline.
//!
//! `tests/fixtures/golden-gen.mjs` replays the LEGACY TypeScript pipeline
//! (`src/lib/qpcr-transform.ts` + `src/lib/qpcr-calculate.ts` of the React
//! app) on a synthetic workbook and dumps the input sheet snapshots plus the
//! expected results. These tests replay the same snapshots through the Rust
//! pipeline and compare every cell (value/bold/fill/border), every sheet
//! envelope field, gene/group names, method notes, chart series and error
//! strings. Floats compare with a 1e-9 relative tolerance so a possible
//! 1-ULP `pow` difference between V8 and the platform libm does not fail
//! the fixture; everything else (strings, structure, order) must match
//! exactly.

use serde_json::{json, Map, Value};

use mynx_contracts::qpcr::{
    CalcMethod, CalcOptions, CalcRequest, CellSnapshot, CellValue, PatchValue, RowSnapshot,
    SheetPatch, SheetSnapshot, TransformRequest,
};
use mynx_contracts::task::{ErrorCode, MynxError};
use mynx_qpcr::{calculate, transform};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");

fn read_fixture(name: &str) -> Value {
    let raw = std::fs::read_to_string(format!("{FIXTURES}/{name}"))
        .unwrap_or_else(|e| panic!("read fixture {name}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse fixture {name}: {e}"))
}

// ── Fixture JSON → contract types ───────────────────────────────────────────
//
// `mynx-contracts` cannot deserialize `CellValue`/`PatchValue` over serde
// (see report: internally-tagged enums with primitive newtype variants fail
// at runtime), so the fixtures are decoded by hand here.

fn cell_value_from(value: &Value) -> CellValue {
    match value["t"].as_str().expect("cell value tag") {
        "num" => CellValue::Num(value["v"].as_f64().expect("num payload")),
        "text" => CellValue::Text(value["v"].as_str().expect("text payload").to_string()),
        "empty" => CellValue::Empty,
        other => panic!("unknown cell value tag {other}"),
    }
}

fn snapshot_from(value: &Value) -> SheetSnapshot {
    SheetSnapshot {
        name: value["name"].as_str().expect("sheet name").to_string(),
        column_count: value["columnCount"].as_u64().expect("columnCount") as u32,
        row_count: value["rowCount"].as_u64().expect("rowCount") as u32,
        rows: value["rows"]
            .as_array()
            .expect("rows")
            .iter()
            .map(|row| RowSnapshot {
                row: row["row"].as_u64().expect("row") as u32,
                cells: row["cells"]
                    .as_array()
                    .expect("cells")
                    .iter()
                    .map(|cell| CellSnapshot {
                        col: cell["col"].as_u64().expect("col") as u32,
                        value: cell_value_from(&cell["value"]),
                        yellow_fill: cell["yellowFill"].as_bool().unwrap_or(false),
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn transform_request_from(value: &Value) -> TransformRequest {
    TransformRequest {
        v: value["v"].as_u64().expect("v") as u32,
        source: snapshot_from(&value["source"]),
    }
}

fn calc_request_from(value: &Value) -> CalcRequest {
    CalcRequest {
        v: value["v"].as_u64().expect("v") as u32,
        source: snapshot_from(&value["source"]),
        repeat_count: value["repeatCount"].as_u64().expect("repeatCount") as u32,
        ref_gene: value["refGene"].as_str().expect("refGene").to_string(),
        options: calc_options_from(&value["options"]),
        with_charts_sheet: value["withChartsSheet"].as_bool().unwrap_or(false),
    }
}

fn calc_options_from(value: &Value) -> CalcOptions {
    let method = match value["method"].as_str().unwrap_or("ref-normalized") {
        "control-relative" => CalcMethod::ControlRelative,
        _ => CalcMethod::RefNormalized,
    };
    CalcOptions {
        method,
        control_group: value["controlGroup"].as_str().unwrap_or("").to_string(),
        select_num: value["selectNum"].as_u64().unwrap_or(0) as u32,
        outlier_sd: value["outlierSd"].as_f64().unwrap_or(0.0),
    }
}

// ── Contract types → fixture-shaped JSON ────────────────────────────────────

fn patch_value_to(value: &PatchValue) -> Value {
    match value {
        PatchValue::Empty => json!({ "t": "empty" }),
        PatchValue::Num(n) => {
            // serde_json maps non-finite floats to null, same as
            // JSON.stringify(NaN) on the fixture side.
            json!({ "t": "num", "v": n })
        }
        PatchValue::Text(s) => json!({ "t": "text", "v": s }),
    }
}

fn sheet_patch_to(patch: &SheetPatch) -> Value {
    Value::Object({
        let mut map = Map::new();
        map.insert("name".into(), json!(patch.name));
        map.insert(
            "rows".into(),
            Value::Array(
                patch
                    .rows
                    .iter()
                    .map(|row| {
                        json!({
                            "cells": row.cells.iter().map(|cell| json!({
                                "value": patch_value_to(&cell.value),
                                "bold": cell.bold,
                                "fill": cell.fill,
                                "bottomBorder": cell.bottom_border,
                            })).collect::<Vec<_>>(),
                        })
                    })
                    .collect(),
            ),
        );
        map.insert("fontName".into(), json!(patch.font_name));
        map.insert("leftAlign".into(), json!(patch.left_align));
        map.insert("identityFillCols".into(), json!(patch.identity_fill_cols));
        map.insert("freezeX".into(), json!(patch.freeze_x));
        map.insert("freezeY".into(), json!(patch.freeze_y));
        map.insert("colWidths".into(), json!(patch.col_widths));
        map.insert(
            "a1Note".into(),
            match &patch.a1_note {
                Some(note) => json!(note),
                None => Value::Null,
            },
        );
        map
    })
}

fn transform_result_to(result: &mynx_contracts::qpcr::TransformResult) -> Value {
    json!({
        "patch": {
            "removeSheets": result.patch.remove_sheets,
            "upsertSheets": result.patch.upsert_sheets.iter().map(sheet_patch_to).collect::<Vec<_>>(),
        },
        "geneNames": result.gene_names,
        "groups": result.groups,
    })
}

fn calc_result_to(result: &mynx_contracts::qpcr::CalcResult) -> Value {
    json!({
        "patch": {
            "removeSheets": result.patch.remove_sheets,
            "upsertSheets": result.patch.upsert_sheets.iter().map(sheet_patch_to).collect::<Vec<_>>(),
        },
        "geneSheetNames": result.gene_sheet_names,
        "methodNote": result.method_note,
        "chartSeries": result.chart_series.iter().map(|series| json!({
            "geneName": series.gene_name,
            "refGene": series.ref_gene,
            "points": series.points.iter().map(|p| json!({
                "name": p.name, "avg": p.avg, "stdev": p.stdev,
            })).collect::<Vec<_>>(),
            "groupCol": series.group_col,
            "dataStartRow": series.data_start_row,
            "dataRowCount": series.data_row_count,
        })).collect::<Vec<_>>(),
    })
}

// ── Tolerant JSON comparison ────────────────────────────────────────────────

const REL_TOLERANCE: f64 = 1e-9;

fn assert_json_eq(actual: &Value, expected: &Value, path: &str) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            let a = a.as_f64().expect("f64");
            let b = b.as_f64().expect("f64");
            if a == b {
                return;
            }
            let scale = a.abs().max(b.abs()).max(1e-300);
            let rel = (a - b).abs() / scale;
            assert!(
                rel <= REL_TOLERANCE,
                "number mismatch at {path}: {a} vs {b} (relative {rel:e})"
            );
        }
        (Value::String(a), Value::String(b)) => {
            assert!(a == b, "string mismatch at {path}: {a:?} vs {b:?}")
        }
        (Value::Bool(a), Value::Bool(b)) => assert!(a == b, "bool mismatch at {path}"),
        (Value::Null, Value::Null) => {}
        (Value::Array(a), Value::Array(b)) => {
            assert!(
                a.len() == b.len(),
                "array length mismatch at {path}: {} vs {}",
                a.len(),
                b.len()
            );
            for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
                assert_json_eq(x, y, &format!("{path}[{i}]"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            let mut keys: Vec<&String> = b.keys().collect();
            keys.sort();
            for key in keys {
                let x = a
                    .get(key)
                    .unwrap_or_else(|| panic!("missing key {path}.{key}"));
                let y = &b[key];
                assert_json_eq(x, y, &format!("{path}.{key}"));
            }
            for key in a.keys() {
                assert!(
                    b.contains_key(key),
                    "unexpected key {path}.{key} (actual-only)"
                );
            }
        }
        _ => panic!("type mismatch at {path}: actual={actual} expected={expected}"),
    }
}

fn assert_matches_fixture(actual: Value, fixture_name: &str) {
    let mut expected = read_fixture(fixture_name);
    // Expected files carry the result minus `v`; the comparison covers the
    // payload only.
    if let Some(obj) = expected.as_object_mut() {
        obj.remove("v");
    }
    assert_json_eq(&actual, &expected, "$");
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn transform_matches_legacy_golden() {
    let request = transform_request_from(&read_fixture("input-transform.json"));
    let result = transform(request).expect("transform succeeds");
    assert_matches_fixture(transform_result_to(&result), "expected-transform.json");
}

fn calc_request() -> CalcRequest {
    calc_request_from(&read_fixture("input-calc.json"))
}

#[test]
fn calculate_default_matches_legacy_golden() {
    let result = calculate(calc_request()).expect("calculate succeeds");
    assert_matches_fixture(calc_result_to(&result), "expected-calc.json");
}

#[test]
fn calculate_best_replicates_matches_legacy_golden() {
    let mut request = calc_request();
    request.options.select_num = 2;
    let result = calculate(request).expect("calculate succeeds");
    assert_matches_fixture(calc_result_to(&result), "expected-calc-best.json");
}

#[test]
fn calculate_outlier_removed_matches_legacy_golden() {
    let mut request = calc_request();
    request.options.outlier_sd = 2.0;
    let result = calculate(request).expect("calculate succeeds");
    assert_matches_fixture(calc_result_to(&result), "expected-calc-outlier.json");
}

#[test]
fn calculate_control_relative_matches_legacy_golden() {
    let mut request = calc_request();
    request.options.method = CalcMethod::ControlRelative;
    request.options.control_group = "对照组".to_string();
    let result = calculate(request).expect("calculate succeeds");
    assert_matches_fixture(calc_result_to(&result), "expected-calc-control.json");
}

#[test]
fn calculate_error_strings_match_legacy() {
    let errors = read_fixture("expected-errors.json");

    // Wrong repeat count → block mismatch error, quoting the first group.
    let mut request = calc_request();
    request.repeat_count = 4;
    let err = calculate(request).expect_err("must fail");
    assert_eq!(err.code, ErrorCode::Validation);
    assert_eq!(
        err.message,
        errors["repeatCountMismatch"].as_str().expect("string")
    );

    // 择优重复 + 离群值剔除 are mutually exclusive.
    let mut request = calc_request();
    request.options.select_num = 2;
    request.options.outlier_sd = 2.0;
    let err = calculate(request).expect_err("must fail");
    assert_eq!(err.code, ErrorCode::Validation);
    assert_eq!(
        err.message,
        errors["mutuallyExclusive"].as_str().expect("string")
    );

    // control-relative requires a control group.
    let mut request = calc_request();
    request.options.method = CalcMethod::ControlRelative;
    let err = calculate(request).expect_err("must fail");
    assert_eq!(err.code, ErrorCode::Validation);
    assert_eq!(
        err.message,
        errors["missingControlGroup"].as_str().expect("string")
    );
}

#[test]
fn mynx_error_shape_is_stable() {
    // The error serializes as { v, code, message } with camelCase keys.
    let err = MynxError::validation("boom");
    let value = serde_json::to_value(&err).expect("serializes");
    assert_eq!(value["v"], json!(1));
    assert_eq!(value["code"], json!("validation"));
    assert_eq!(value["message"], json!("boom"));
}
