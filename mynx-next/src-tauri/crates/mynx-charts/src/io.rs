//! Chart data import — first row is the header, every following row becomes a
//! JSON value array (numbers where parseable, strings otherwise).
//!
//! Delimited parsing is a local port of the shared RNA-seq parser
//! (`mynx_rnaseq::matrix::{parse_delimited, detect_delimiter}`, which stays
//! `pub(crate)` there) and Excel reads mirror `mynx_rnaseq::io::read_xlsx_rows`
//! (calamine, first worksheet, exceljs `cellStr` semantics). Keeping the rules
//! identical means a file imported by either feature parses the same way.

use std::fs;

use calamine::{Data, Reader};
use mynx_contracts::charts::ChartImportedData;
use mynx_contracts::task::MynxError;
use mynx_contracts::WIRE_VERSION;
use serde_json::{Number, Value};

// ── path helpers (ports of rnaseq io.ts) ────────────────────────────────────

/// Legacy import path cleanup: strips whitespace, quotes and BOM characters
/// from both ends.
fn clean_import_path(path: &str) -> &str {
    path.trim_matches(|c: char| {
        c.is_whitespace() || c == '"' || c == '\'' || c == '\u{feff}'
    })
}

/// `pathExtLower`: extension including the dot, lowercased (`""` when absent).
fn path_ext_lower(path: &str) -> String {
    let norm = path.trim_end_matches(['\\', '/']);
    let base = match norm.rfind(['\\', '/']) {
        Some(idx) => &norm[idx + 1..],
        None => norm,
    };
    match base.rfind('.') {
        Some(idx) => base[idx..].to_lowercase(),
        None => String::new(),
    }
}

// ── reads ───────────────────────────────────────────────────────────────────

/// Reads a delimited-text file as a string (UTF-8; invalid bytes are replaced,
/// mirroring the legacy fs-plugin text read).
fn read_text_file(path: &str) -> Result<String, MynxError> {
    let bytes = fs::read(path)
        .map_err(|error| MynxError::io(format!("无法读取文件 {}: {}", path, error)))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// RFC4180 + lazy quotes: a `"` opens a quoted section anywhere, `""` is an
/// escaped quote, `\r` terminates rows just like `\n`, and a leading BOM is
/// dropped. Port of `mynx_rnaseq::matrix::parse_delimited`.
fn parse_delimited(text: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let src = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut chars = src.chars().peekable();
    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == delimiter {
            row.push(std::mem::take(&mut field));
        } else if ch == '\n' {
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
        } else if ch == '\r' {
            // \r\n and lone \r both terminate the row
            if chars.peek() != Some(&'\n') {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
        } else {
            field.push(ch);
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/// `detectDelimiter`: tabs outnumbering commas in the first 4096 chars → TSV.
fn detect_delimiter(text: &str) -> char {
    let mut tabs = 0usize;
    let mut commas = 0usize;
    for ch in text.chars().take(4096) {
        match ch {
            '\t' => tabs += 1,
            ',' => commas += 1,
            _ => {}
        }
    }
    if tabs > commas { '\t' } else { ',' }
}

/// Reads the first worksheet of an Excel workbook (.xlsx/.xls) as a string
/// table with the same cell-to-string rules as the RNA-seq reader.
fn read_xlsx_rows(path: &str) -> Result<Vec<Vec<String>>, MynxError> {
    let mut workbook = calamine::open_workbook_auto(path)
        .map_err(|error| MynxError::io(format!("无法读取 Excel 文件 {}: {}", path, error)))?;
    let sheet_names = workbook.sheet_names();
    let first = sheet_names
        .first()
        .ok_or_else(|| MynxError::validation("Excel 文件没有工作表"))?
        .clone();
    let range = workbook
        .worksheet_range(&first)
        .map_err(|error| MynxError::io(format!("无法读取 Excel 工作表 {}: {}", first, error)))?;
    let mut rows = Vec::with_capacity(range.height());
    for row in range.rows() {
        rows.push(row.iter().map(xlsx_cell_to_string).collect());
    }
    Ok(rows)
}

/// exceljs `cellStr` semantics: integers render without decimals, Date cells
/// come back empty, error cells keep their `#…` text.
fn xlsx_cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => value.clone(),
        Data::Int(value) => value.to_string(),
        Data::Float(value) => {
            if value.fract() == 0.0 && value.abs() < 1e15 {
                format!("{}", *value as i64)
            } else {
                format!("{}", value)
            }
        }
        Data::Bool(value) => {
            if *value { "true".to_string() } else { "false".to_string() }
        }
        Data::DateTime(_) => String::new(),
        Data::DateTimeIso(value) | Data::DurationIso(value) => value.clone(),
        Data::Error(error) => error.to_string(),
    }
}

// ── cell conversion ─────────────────────────────────────────────────────────

/// Numeric cells render as JSON numbers (whole numbers without a decimal
/// mark), everything else stays text — same coercion as the RNA-seq preview.
fn json_cell(cell: &str) -> Value {
    if cell.is_empty() {
        return Value::String(String::new());
    }
    let trimmed = cell.trim();
    if trimmed.is_empty() {
        return Value::String(cell.to_string());
    }
    match trimmed.parse::<f64>() {
        Ok(number) if number.is_finite() => {
            if number.fract() == 0.0 && number.abs() < 9.0e15 {
                Value::Number(Number::from(number as i64))
            } else {
                Number::from_f64(number)
                    .map(Value::Number)
                    .unwrap_or_else(|| Value::String(cell.to_string()))
            }
        }
        _ => Value::String(cell.to_string()),
    }
}

// ── import entry point ──────────────────────────────────────────────────────

/// Import a dataset for chart field mapping:
///   1. read the source (.csv/.tsv/.txt as text, .xlsx/.xls via calamine),
///   2. parse it (CSV vs TSV delimiter detection, RFC4180 quotes),
///   3. first row = header (trimmed), remaining rows = data,
///   4. return the first `preview_rows` data rows with numeric cells as JSON
///      numbers plus the full row count.
pub fn import_data(path: &str, preview_rows: u32) -> Result<ChartImportedData, MynxError> {
    let path = clean_import_path(path);
    fs::metadata(path)
        .map_err(|_| MynxError::not_found(format!("文件不存在: {}", path)))?;

    let ext = path_ext_lower(path);
    let parsed: Vec<Vec<String>> = match ext.as_str() {
        ".csv" | ".tsv" | ".txt" => {
            let text = read_text_file(path)?;
            let delimiter = detect_delimiter(&text);
            parse_delimited(&text, delimiter)
        }
        ".xlsx" | ".xls" => read_xlsx_rows(path)?,
        _ => return Err(MynxError::validation("不支持的文件类型")),
    };

    let header = parsed.first().ok_or_else(|| MynxError::validation("未找到表头"))?;
    let columns: Vec<String> = header.iter().map(|cell| cell.trim().to_string()).collect();
    if columns.iter().all(String::is_empty) {
        return Err(MynxError::validation("未找到表头"));
    }
    let width = columns.len();

    let data = &parsed[1..];
    let mut warnings: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Value>> = Vec::with_capacity(data.len().min(preview_rows as usize));
    for row in data.iter().take(preview_rows as usize) {
        let ragged = row.len() != width;
        if ragged && warnings.is_empty() {
            warnings.push("部分数据行的列数与表头不一致".to_string());
        }
        // Pad short rows with empty cells so column mapping stays positional;
        // extra cells are kept as-is (they have no mapped column).
        let mut values: Vec<Value> = row.iter().map(|cell| json_cell(cell)).collect();
        while values.len() < width {
            values.push(Value::String(String::new()));
        }
        rows.push(values);
    }

    Ok(ChartImportedData {
        v: WIRE_VERSION,
        file_path: path.to_string(),
        columns,
        rows,
        total_rows: data.len() as u64,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mynx_charts_{}_{nanos}", name));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write_fixture(name: &str, text: &str) -> String {
        let dir = temp_dir(name);
        let path = dir.join(name);
        fs::write(&path, text).expect("fixture");
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn csv_import_maps_columns_and_coerces_numbers() {
        let path = write_fixture("data.csv", "gene,fc,padj\nGeneA,1.5,0.021\nGeneB,2,NA\n");
        let data = import_data(&path, 50).expect("import");
        assert_eq!(data.columns, vec!["gene", "fc", "padj"]);
        assert_eq!(data.total_rows, 2);
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.rows[0][0], Value::String("GeneA".into()));
        assert_eq!(data.rows[0][1], Value::Number(Number::from_f64(1.5).unwrap()));
        assert_eq!(data.rows[0][2], Value::Number(Number::from_f64(0.021).unwrap()));
        // whole numbers render as integers, NA/text stays a string
        assert_eq!(data.rows[1][1], Value::Number(Number::from(2)));
        assert_eq!(data.rows[1][2], Value::String("NA".into()));
        assert!(data.warnings.is_empty());
        assert_eq!(data.v, WIRE_VERSION);
        assert_eq!(data.file_path, path);
    }

    #[test]
    fn tsv_import_keeps_chinese_text() {
        let path = write_fixture(
            "data.tsv",
            "基因\t分组\t数值\n基因A\t对照组\t3\n基因B\t处理组\t7\n",
        );
        let data = import_data(&path, 50).expect("import");
        assert_eq!(data.columns, vec!["基因", "分组", "数值"]);
        assert_eq!(data.total_rows, 2);
        assert_eq!(data.rows[0][0], Value::String("基因A".into()));
        assert_eq!(data.rows[1][2], Value::Number(Number::from(7)));
    }

    #[test]
    fn quoted_csv_cells_and_bom_survive() {
        let path = write_fixture(
            "quoted.csv",
            "\u{feff}name,note\nGeneA,\"含,逗号\"\nGeneB,\"引\"\"号\"\n",
        );
        let data = import_data(&path, 50).expect("import");
        assert_eq!(data.columns, vec!["name", "note"]);
        assert_eq!(data.rows[0][1], Value::String("含,逗号".into()));
        assert_eq!(data.rows[1][1], Value::String("引\"号".into()));
    }

    #[test]
    fn preview_rows_caps_rows_but_not_total() {
        let path = write_fixture("data.csv", "a,b\n1,2\n3,4\n5,6\n");
        let data = import_data(&path, 2).expect("import");
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.total_rows, 3);
        assert_eq!(data.rows[1][1], Value::Number(Number::from(4)));
    }

    #[test]
    fn ragged_rows_warn_and_pad() {
        let path = write_fixture("ragged.csv", "a,b,c\n1,2,3\n4\n5,6,7,8\n");
        let data = import_data(&path, 50).expect("import");
        assert_eq!(data.total_rows, 3);
        assert_eq!(data.rows[0].len(), 3);
        // short row padded with empty cells
        assert_eq!(data.rows[1], vec![
            Value::Number(Number::from(4)),
            Value::String(String::new()),
            Value::String(String::new()),
        ]);
        // long row keeps its extra cell
        assert_eq!(data.rows[2].len(), 4);
        assert_eq!(data.rows[2][3], Value::Number(Number::from(8)));
        assert_eq!(data.warnings, vec!["部分数据行的列数与表头不一致"]);
    }

    #[test]
    fn whitespace_around_numbers_still_coerces() {
        let path = write_fixture("space.csv", "a,b\n 1 , x\n");
        let data = import_data(&path, 50).expect("import");
        assert_eq!(data.rows[0][0], Value::Number(Number::from(1)));
        // non-numeric cells keep their original text (shared number_cell rule)
        assert_eq!(data.rows[0][1], Value::String(" x".into()));
    }

    #[test]
    fn header_only_file_returns_zero_rows() {
        let path = write_fixture("header.csv", "a,b\n");
        let data = import_data(&path, 50).expect("import");
        assert_eq!(data.total_rows, 0);
        assert!(data.rows.is_empty());
    }

    #[test]
    fn empty_file_errors() {
        let path = write_fixture("empty.csv", "");
        let error = import_data(&path, 50).expect_err("must fail");
        assert_eq!(error.message, "未找到表头");
    }

    #[test]
    fn blank_header_row_errors() {
        let path = write_fixture("blank.csv", ",,\n1,2,3\n");
        let error = import_data(&path, 50).expect_err("must fail");
        assert_eq!(error.message, "未找到表头");
    }

    #[test]
    fn missing_file_errors() {
        let error = import_data("Z:/definitely/missing.csv", 50).expect_err("must fail");
        assert!(error.message.contains("文件不存在"), "{}", error.message);
    }

    #[test]
    fn unsupported_extension_errors() {
        let path = write_fixture("data.parquet", "x");
        let error = import_data(&path, 50).expect_err("must fail");
        assert_eq!(error.message, "不支持的文件类型");
    }

    #[test]
    fn quoted_path_argument_is_cleaned() {
        let dir = temp_dir("clean");
        let path = dir.join("data.csv");
        fs::write(&path, "a,b\n1,2\n").expect("fixture");
        let quoted = format!("\"{}\"", path.to_string_lossy());
        let data = import_data(&quoted, 50).expect("import");
        assert_eq!(data.columns, vec!["a", "b"]);
    }

    #[test]
    fn parse_delimited_matches_shared_parser() {
        let parsed = parse_delimited("a,b,c\r\n1,\"x,y\",3\n\"q\"\"uote\",,z\r\n", ',');
        assert_eq!(parsed.len(), 3, "{parsed:?}");
        assert_eq!(parsed[1][1], "x,y");
        assert_eq!(parsed[2][0], "q\"uote");
        assert_eq!(parsed[2][1], "");
    }

    #[test]
    fn detect_delimiter_tsv_and_csv() {
        assert_eq!(detect_delimiter("a\tb\tc\n1\t2\t3\n"), '\t');
        assert_eq!(detect_delimiter("a,b,c\n1,2,3\n"), ',');
    }
}
