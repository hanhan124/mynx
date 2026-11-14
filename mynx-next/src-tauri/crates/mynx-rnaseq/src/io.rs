//! File IO helpers for the RNA-seq counts pipeline.
//!
//! Port of the legacy file layer (`src/lib/rnaseq/io.ts`): the fs-plugin reads
//! with PowerShell/bash fallbacks are replaced by direct `std::fs` access,
//! while the path helpers keep the exact legacy semantics (`pathBase`,
//! `pathExtLower`, `joinPath`) so produced paths look identical on both sides.

use std::fs;
use std::time::UNIX_EPOCH;

use calamine::{Data, Reader};
use mynx_contracts::task::MynxError;

// ── path helpers (ports of io.ts / matrix.ts) ───────────────────────────────

/// `pathBase`: file name with trailing separators stripped.
pub(crate) fn path_base(path: &str) -> &str {
    let norm = path.trim_end_matches(['\\', '/']);
    match norm.rfind(['\\', '/']) {
        Some(idx) => &norm[idx + 1..],
        None => norm,
    }
}

/// `pathExtLower`: extension including the dot, lowercased (`""` when absent).
pub(crate) fn path_ext_lower(path: &str) -> String {
    let base = path_base(path);
    match base.rfind('.') {
        Some(idx) => base[idx..].to_lowercase(),
        None => String::new(),
    }
}

/// `joinPath`: joins parts using the separator style of the accumulated base
/// (backslash only when the base so far uses backslashes exclusively).
pub(crate) fn join_path(parts: &[&str]) -> String {
    let mut joined = String::new();
    for part in parts {
        if part.is_empty() {
            continue;
        }
        if joined.is_empty() {
            joined = part.to_string();
            continue;
        }
        let separator =
            if joined.contains('\\') && !joined.contains('/') { '\\' } else { '/' };
        let trimmed = joined.trim_end_matches(['\\', '/']);
        joined = format!("{trimmed}{separator}{part}");
    }
    joined
}

/// Legacy import path cleanup (`filePath.trim().replace(/^["'\s]+|["'\s]+$/g)`):
/// strips whitespace, quotes and BOM characters from both ends.
pub(crate) fn clean_import_path(path: &str) -> &str {
    path.trim_matches(|c: char| {
        c.is_whitespace() || c == '"' || c == '\'' || c == '\u{feff}'
    })
}

// ── reads ───────────────────────────────────────────────────────────────────

/// Reads a delimited-text file as a string (UTF-8; invalid bytes are replaced,
/// mirroring the legacy fs-plugin text read).
pub(crate) fn read_text_file(path: &str) -> Result<String, MynxError> {
    let bytes = fs::read(path)
        .map_err(|error| MynxError::io(format!("无法读取文件 {}: {}", path, error)))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Reads the first worksheet of an Excel workbook (.xlsx/.xls) as a string
/// table — port of matrix.ts `readXlsxRows` (exceljs) with the same
/// cell-to-string rules.
pub(crate) fn read_xlsx_rows(path: &str) -> Result<Vec<Vec<String>>, MynxError> {
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
/// come back empty (exceljs surfaces them as Date objects which the legacy
/// helper renders as `""`), error cells keep their `#…` text.
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

/// mtime in epoch ms (0 when unavailable) — legacy `FileMeta.mtimeMs`.
pub(crate) fn mtime_ms(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_helpers_match_legacy() {
        assert_eq!(path_base("D:/a/b/counts.csv"), "counts.csv");
        assert_eq!(path_base("D:\\a\\b\\counts.csv"), "counts.csv");
        assert_eq!(path_base("dir/"), "dir");
        assert_eq!(path_base("/"), "");
        assert_eq!(path_ext_lower("D:/A/Counts.TSV"), ".tsv");
        assert_eq!(path_ext_lower("noext"), "");
        assert_eq!(path_ext_lower("a.b.CSV"), ".csv");
    }

    #[test]
    fn join_path_uses_base_separator_style() {
        assert_eq!(join_path(&["D:\\out", "run1"]), "D:\\out\\run1");
        assert_eq!(join_path(&["D:/out", "run1"]), "D:/out/run1");
        assert_eq!(join_path(&["D:\\out\\", "run1"]), "D:\\out\\run1");
        assert_eq!(
            join_path(&["D:\\out", "prepared", "params.json"]),
            "D:\\out\\prepared\\params.json"
        );
        assert_eq!(join_path(&["D:/out", "prepared", "params.json"]), "D:/out/prepared/params.json");
    }

    #[test]
    fn clean_import_path_strips_quotes_and_whitespace() {
        assert_eq!(clean_import_path("  \"D:/a/counts.csv\"  "), "D:/a/counts.csv");
        assert_eq!(clean_import_path("'D:\\a\\counts.csv'"), "D:\\a\\counts.csv");
        assert_eq!(clean_import_path("counts.csv"), "counts.csv");
    }
}
