//! Counts matrix import / normalization — 1:1 port of
//! `src/lib/rnaseq/matrix.ts` plus the worker entry
//! (`src/features/rnaseq/workers/matrix.worker.ts`, folded into
//! [`import_counts`]).
//!
//! Parsing, normalization, warning strings and error messages are kept
//! byte-identical to the legacy layer. The legacy fs-plugin/PowerShell reads
//! are replaced by direct filesystem access; the normalized CSV cache that
//! legacy wrote to `~/.mynx/rnaseq-import` is written alongside the source
//! file as `<stem>.normalized.csv`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use mynx_contracts::rnaseq::{
    CountRounding, DuplicateGenes, ImportData, ImportRequest, MatrixFormat,
};
use mynx_contracts::task::MynxError;
use mynx_contracts::WIRE_VERSION;
use serde_json::{Map, Number, Value};

use crate::io::{
    clean_import_path, join_path, path_base, path_ext_lower, read_text_file, read_xlsx_rows,
};

/// Preview rows returned by the import summary. The legacy store calls
/// `importCountsApi(path, 5, ...)` (src/pages/rnaseq/store.tsx).
const PREVIEW_ROWS: usize = 5;

/// featureCounts annotation columns that are never sample columns.
const FEATURECOUNTS_ANNO_COLS: [&str; 10] = [
    "chr",
    "chromosome",
    "start",
    "end",
    "strand",
    "length",
    "gene_length",
    "status",
    "biotype",
    "gene_biotype",
];

/// Header names tried (in order) when picking the gene column for
/// featureCounts files.
const GENE_COL_PRIORITY: [&str; 9] = [
    "geneid",
    "gene_id",
    "genesymbol",
    "gene_symbol",
    "symbol",
    "gene_name",
    "genename",
    "gene",
    "id",
];

// ── delimited parsing (port of parseDelimited / detectDelimiter) ────────────

/// RFC4180 + lazy quotes (aligned with Go csv.Reader LazyQuotes): a `"` opens
/// a quoted section anywhere, `""` is an escaped quote, `\r` terminates rows
/// just like `\n`, and a leading BOM is dropped.
pub(crate) fn parse_delimited(text: &str, delimiter: char) -> Vec<Vec<String>> {
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
pub(crate) fn detect_delimiter(text: &str) -> char {
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

/// `toCsvText`: comma-separated with legacy `csvEscape` quoting (quote only
/// when a cell contains `"`, `,`, `\r` or `\n`; quotes doubled) and rows
/// joined with `\r\n`. Produced via the csv crate configured to emit exactly
/// those bytes.
pub(crate) fn to_csv_text(headers: &[String], body: &[Vec<String>]) -> String {
    let mut buffer: Vec<u8> = Vec::new();
    {
        let mut writer = csv::WriterBuilder::new()
            .delimiter(b',')
            .terminator(csv::Terminator::CRLF)
            .quote_style(csv::QuoteStyle::Necessary)
            .has_headers(false)
            .flexible(true)
            .from_writer(&mut buffer);
        let cells =
            |row: &[String]| row.iter().map(String::as_str).collect::<Vec<&str>>();
        writer.write_record(cells(headers)).expect("in-memory csv write");
        for row in body {
            writer.write_record(cells(row)).expect("in-memory csv write");
        }
        writer.flush().expect("in-memory csv flush");
    }
    String::from_utf8(buffer).expect("csv output is utf-8")
}

// ── column detection ────────────────────────────────────────────────────────

/// `isNumericCell`: empty / NA / NaN / `.` count as numeric (R's NA handling).
fn is_numeric_cell(cell: &str) -> bool {
    let value = cell.trim();
    if value.is_empty() || value == "NA" || value == "NaN" || value == "nan" || value == "." {
        return true;
    }
    value.parse::<f64>().map_or(false, |number| number.is_finite())
}

/// `colMostlyNumeric`: at least 85% of the first non-empty cells (up to
/// `max_check`) are numeric.
fn col_mostly_numeric(rows: &[Vec<String>], col: usize, max_check: usize) -> bool {
    let mut checked = 0usize;
    let mut numeric = 0usize;
    for row in rows {
        if col >= row.len() {
            continue;
        }
        let value = row[col].trim();
        if value.is_empty() {
            continue;
        }
        checked += 1;
        if is_numeric_cell(value) {
            numeric += 1;
        }
        if checked >= max_check {
            break;
        }
    }
    if checked == 0 {
        return false;
    }
    (numeric as f64) / (checked as f64) >= 0.85
}

/// `pickGeneColIndex`: first header matching the gene-name priority list;
/// `None` when nothing matches (the legacy helper falls back to column 0).
fn pick_gene_col_index(headers: &[String]) -> Option<usize> {
    if headers.is_empty() {
        return None;
    }
    let lower: Vec<String> =
        headers.iter().map(|header| header.trim().to_lowercase()).collect();
    for name in GENE_COL_PRIORITY {
        if let Some(idx) = lower.iter().position(|header| header == name) {
            return Some(idx);
        }
    }
    None
}

/// Auto-detects the matrix preset from parsed rows when the request carries no
/// explicit hint:
///   - `#` comment lines before the table → featureCounts (real featureCounts
///     output starts with `# Program`/`#` lines which carry the sample names);
///   - a gene-name header column plus annotation columns → featureCounts;
///   - a two-column gene/count table → htseq;
///   - everything else → counts_matrix.
fn detect_matrix_format(rows: &[Vec<String>]) -> MatrixFormat {
    if rows.iter().take(8).any(|row| {
        row.first().is_some_and(|cell| cell.trim_start().starts_with('#'))
    }) {
        return MatrixFormat::Featurecounts;
    }
    if let Some(headers) = rows.first() {
        if pick_gene_col_index(headers).is_some()
            && headers.iter().any(|header| {
                FEATURECOUNTS_ANNO_COLS
                    .contains(&header.trim().to_lowercase().as_str())
            })
        {
            return MatrixFormat::Featurecounts;
        }
        if headers.len() == 2 {
            return MatrixFormat::Htseq;
        }
    }
    MatrixFormat::CountsMatrix
}

/// Drops featureCounts `#` comment lines (rows whose first cell starts with
/// `#` — the parsed form of the engine's comment block).
fn drop_comment_rows(rows: Vec<Vec<String>>) -> Vec<Vec<String>> {
    rows.into_iter()
        .filter(|row| {
            !row.first().is_some_and(|cell| cell.trim_start().starts_with('#'))
        })
        .collect()
}

// ── normalization (port of normalizeCountMatrix) ────────────────────────────

pub(crate) struct NormalizedMatrix {
    pub(crate) headers: Vec<String>,
    pub(crate) body: Vec<Vec<String>>,
    pub(crate) applied: MatrixFormat,
    pub(crate) warnings: Vec<String>,
}

/// Normalizes `[gene_id, sample1, sample2, …]` rows:
///   - featureCounts preset drops annotation columns and non-numeric columns,
///     keeping the gene column (auto-detected by header name) + numeric columns;
///   - htseq preset keeps the gene column + numeric columns;
///   - counts_matrix keeps every column, warning on mostly-non-numeric ones;
///   - rows with an empty gene name are dropped when `drop_empty_gene` (kept
///     for renaming otherwise), `__`-prefixed HTSeq summary rows always go.
fn normalize_count_matrix(
    all_rows: &[Vec<String>],
    applied: MatrixFormat,
    drop_empty_gene: bool,
    gene_col: u32,
) -> Result<NormalizedMatrix, MynxError> {
    if all_rows.is_empty() {
        return Err(MynxError::validation("文件为空,没有可读的数据"));
    }
    let mut raw_headers = all_rows[0].clone();
    if raw_headers.len() < 2 {
        return Err(MynxError::validation("至少需要 1 列基因 ID + 1 列样本计数"));
    }
    if let Some(stripped) = raw_headers[0].strip_prefix('\u{feff}') {
        raw_headers[0] = stripped.to_string();
    }
    let data = &all_rows[1..];
    let mut warnings: Vec<String> = Vec::new();

    // Gene column: gene_col >= 2 is an explicit 1-based override into the
    // source file; 0/1 keep the legacy behavior (auto-detect for
    // featureCounts, column 1 otherwise).
    let gene_idx = if gene_col >= 2 {
        let idx = gene_col as usize - 1;
        if idx >= raw_headers.len() {
            return Err(MynxError::validation(format!(
                "gene_col {} 超出列数(表头 {} 列)",
                gene_col,
                raw_headers.len()
            )));
        }
        idx
    } else {
        match applied {
            MatrixFormat::Featurecounts => pick_gene_col_index(&raw_headers).unwrap_or(0),
            _ => 0,
        }
    };

    let mut keep_idx: Vec<usize> = Vec::new();
    match applied {
        MatrixFormat::Featurecounts => {
            for (idx, header) in raw_headers.iter().enumerate() {
                if idx == gene_idx {
                    continue;
                }
                let lower = header.trim().to_lowercase();
                if FEATURECOUNTS_ANNO_COLS.contains(&lower.as_str()) {
                    continue;
                }
                if col_mostly_numeric(data, idx, 40) {
                    keep_idx.push(idx);
                } else {
                    warnings.push(format!("已跳过非数值列「{}」", header.trim()));
                }
            }
            keep_idx.insert(0, gene_idx);
        }
        MatrixFormat::Htseq => {
            keep_idx.push(gene_idx);
            for idx in 1..raw_headers.len() {
                if idx == gene_idx {
                    continue;
                }
                if col_mostly_numeric(data, idx, 40) {
                    keep_idx.push(idx);
                }
            }
        }
        MatrixFormat::CountsMatrix => {
            keep_idx.push(gene_idx);
            for idx in 1..raw_headers.len() {
                if idx == gene_idx {
                    continue;
                }
                if !col_mostly_numeric(data, idx, 30) {
                    warnings.push(format!(
                        "列「{}」多数单元格非数值,仍按样本列导入;若为注释列请改用 featureCounts 预设",
                        raw_headers[idx].trim()
                    ));
                }
                keep_idx.push(idx);
            }
        }
    }

    if keep_idx.len() < 2 {
        return Err(MynxError::validation(
            "规范化后没有可用的样本列。请确认文件是基因×样本计数矩阵,或更换「矩阵格式」预设",
        ));
    }

    let mut headers: Vec<String> = keep_idx
        .iter()
        .map(|&idx| {
            if idx < raw_headers.len() {
                raw_headers[idx].trim().to_string()
            } else {
                format!("col{}", idx + 1)
            }
        })
        .collect();
    if headers[0].is_empty() {
        headers[0] = "gene_id".to_string();
    }

    let mut body: Vec<Vec<String>> = Vec::new();
    for row in data {
        let out: Vec<String> = keep_idx
            .iter()
            .map(|&idx| {
                if idx < row.len() {
                    row[idx].trim().to_string()
                } else {
                    String::new()
                }
            })
            .collect();
        let gene = out[0].as_str();
        if gene.is_empty() && drop_empty_gene {
            continue;
        }
        if gene.starts_with("__") {
            continue; // HTSeq summary rows: __no_feature etc.
        }
        body.push(out);
    }
    if body.is_empty() {
        return Err(MynxError::validation("没有有效的基因行"));
    }

    // Duplicate gene names are reported here; the merge strategy itself is
    // applied afterwards from the request's duplicate_genes (R engine parity).
    let mut gene_set = HashSet::new();
    for row in &body {
        gene_set.insert(row[0].clone());
    }
    if gene_set.len() < body.len() {
        warnings.push(format!(
            "发现 {} 行重复基因名;将按分析参数的重名基因处理策略合并",
            body.len() - gene_set.len()
        ));
    }

    // Count quality sampling: raw integer counts vs TPM/FPKM/log data.
    let mut checked = 0u64;
    let mut integerish = 0u64;
    let mut negative = 0u64;
    let mut fractional = 0u64;
    'outer: for row in &body {
        for cell in row.iter().skip(1) {
            let value = cell.trim();
            if value.is_empty() || value == "NA" {
                continue;
            }
            let Ok(number) = value.parse::<f64>() else { continue };
            if !number.is_finite() {
                continue;
            }
            checked += 1;
            if number < 0.0 {
                negative += 1;
            }
            let rounded = (number + 0.5).floor();
            if number == number.trunc()
                || (number > 1.0 && (number - rounded).abs() < 1e-6)
            {
                integerish += 1;
            } else if number != number.trunc() {
                fractional += 1;
            }
            if checked >= 2000 {
                break 'outer;
            }
        }
    }
    if checked > 50 {
        let frac_ratio = fractional as f64 / checked as f64;
        let int_ratio = integerish as f64 / checked as f64;
        if fractional > 0 {
            warnings.push(format!(
                "抽样检测到 {} 个小数 Counts；分析时会按「计数取整」参数处理为整数。请确认文件不是 TPM、FPKM 或 log 转换数据。",
                fractional
            ));
        }
        if frac_ratio > 0.35 && int_ratio < 0.7 {
            warnings.push(
                "检测到大量非整数值。虽然软件会取整以继续计算，但 TPM、FPKM 或 log 转换矩阵不能用于 DESeq2/edgeR；请改用原始或 estimated counts。".to_string(),
            );
        }
        if negative > 0 {
            warnings.push(format!("发现 {} 个负值,原始 counts 不应为负", negative));
        }
    }

    Ok(NormalizedMatrix { headers, body, applied, warnings })
}

// ── input options (port of the R engine's clean_counts) ─────────────────────

/// JS `Number(cell)` with empty/whitespace → 0 (never counted as > 0).
fn parse_number_lenient(cell: &str) -> Option<f64> {
    let trimmed = cell.trim();
    if trimmed.is_empty() {
        return Some(0.0);
    }
    trimmed.parse::<f64>().ok().filter(|number| number.is_finite())
}

/// Raw count cell for merging: empty / NA / non-numeric count as 0
/// (R read_counts sets NA counts to 0 before merging).
fn parse_count(cell: &str) -> f64 {
    let trimmed = cell.trim();
    if trimmed.is_empty() || trimmed == "NA" {
        return 0.0;
    }
    trimmed.parse::<f64>().unwrap_or(0.0)
}

/// Whole numbers render without decimals (JS String(number) for the integer
/// range; huge values fall back to the default float formatting).
fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 9.0e15 {
        format!("{}", value as i64)
    } else {
        format!("{}", value)
    }
}

/// Rounded count cells are integral by construction; render as integers.
fn format_integer(value: f64) -> String {
    if value.abs() < 9.22e18 {
        format!("{}", value as i64)
    } else {
        format!("{:.0}", value)
    }
}

/// Applies the request-level input options — port of the R engine's
/// `clean_counts` (r/rnaseq_engine.R): rename empty genes → merge duplicates
/// on the RAW counts → round. Returns the final body and whether any row or
/// cell changed (used to decide the source-as-data-file fast path).
fn apply_input_options(
    body: Vec<Vec<String>>,
    drop_empty_gene: bool,
    duplicate_genes: DuplicateGenes,
    rounding: CountRounding,
) -> (Vec<Vec<String>>, bool) {
    let mut transformed = false;
    let mut rows = body;

    // 1. Empty gene names: dropped during normalization when drop_empty_gene;
    //    otherwise renamed unnamed_1..N (R: paste0("unnamed_", seq_len)).
    if !drop_empty_gene {
        let mut unnamed = 0usize;
        for row in rows.iter_mut() {
            if row[0].is_empty() {
                unnamed += 1;
                row[0] = format!("unnamed_{}", unnamed);
                transformed = true;
            }
        }
    }

    // 2. Duplicate gene names, merged on the raw counts.
    let mut seen = HashSet::new();
    let duplicated = rows.iter().any(|row| !seen.insert(row[0].clone()));
    if duplicated {
        match duplicate_genes {
            DuplicateGenes::Sum => {
                // rowsum(group = genes, reorder = FALSE): first-appearance
                // order, raw counts summed.
                let mut merged: Vec<Vec<String>> = Vec::new();
                let mut index: HashMap<String, usize> = HashMap::new();
                for row in rows {
                    match index.get(&row[0]) {
                        Some(&position) => {
                            for (cell, target) in row
                                .iter()
                                .skip(1)
                                .zip(merged[position].iter_mut().skip(1))
                            {
                                let sum = parse_count(cell) + parse_count(target);
                                *target = format_number(sum);
                            }
                            transformed = true;
                        }
                        None => {
                            index.insert(row[0].clone(), merged.len());
                            merged.push(row);
                        }
                    }
                }
                rows = merged;
            }
            DuplicateGenes::MaxMean => {
                // Keep the row with the highest row-mean per gene (R which.max
                // → first max wins); kept rows stay in original order.
                let mut best: HashMap<String, (usize, f64)> = HashMap::new();
                for (position, row) in rows.iter().enumerate() {
                    let cells = row.len().saturating_sub(1);
                    let total: f64 =
                        row.iter().skip(1).map(|cell| parse_count(cell)).sum();
                    let mean = if cells > 0 { total / cells as f64 } else { 0.0 };
                    let gene = row[0].clone();
                    match best.get(&gene) {
                        Some((_, current)) if *current >= mean => {}
                        _ => {
                            best.insert(gene, (position, mean));
                        }
                    }
                }
                let keep: HashSet<usize> =
                    best.into_values().map(|(position, _)| position).collect();
                let mut kept = Vec::with_capacity(keep.len());
                for (position, row) in rows.into_iter().enumerate() {
                    if keep.contains(&position) {
                        kept.push(row);
                    }
                }
                rows = kept;
                transformed = true;
            }
            DuplicateGenes::MakeUnique => {
                // R make.unique with sep "_dup": the first occurrence keeps the
                // name, later duplicates get _dup1, _dup2, … (per-name counter,
                // skipping candidates already in use).
                let mut used: HashSet<String> = HashSet::new();
                let mut counters: HashMap<String, u32> = HashMap::new();
                for row in rows.iter_mut() {
                    let gene = row[0].clone();
                    if used.insert(gene.clone()) {
                        continue;
                    }
                    let counter = counters.entry(gene.clone()).or_insert(0);
                    loop {
                        *counter += 1;
                        let candidate = format!("{}_dup{}", gene, counter);
                        if used.insert(candidate.clone()) {
                            row[0] = candidate;
                            break;
                        }
                    }
                    transformed = true;
                }
            }
        }
    }

    // 3. Rounding (R round_counts: round = floor(x + 0.5), i.e. the classic
    //    "round half up", not banker's rounding).
    for row in rows.iter_mut() {
        for cell in row.iter_mut().skip(1) {
            let trimmed = cell.trim();
            if trimmed.is_empty() || trimmed == "NA" {
                continue;
            }
            let Ok(number) = trimmed.parse::<f64>() else { continue };
            if !number.is_finite() {
                continue;
            }
            let rounded = match rounding {
                CountRounding::Round => (number + 0.5).floor(),
                CountRounding::Floor => number.floor(),
                CountRounding::Ceiling => number.ceil(),
            };
            let formatted = format_integer(rounded);
            if formatted != *cell {
                transformed = true;
            }
            *cell = formatted;
        }
    }

    (rows, transformed)
}

// ── preview helpers (port of toNumber) ──────────────────────────────────────

/// `toNumber`: numeric cells render as JSON numbers (whole numbers without a
/// decimal mark), everything else stays text.
fn number_cell(cell: &str) -> Value {
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

// ── import entry point (port of resolveImportFile + importCounts) ───────────

/// `<dir>/<stem>.normalized.csv` — written alongside the source file. (The
/// legacy cache lived in `~/.mynx/rnaseq-import/<base>_<fnv1a>.csv`; the new
/// pipeline keeps the artifact next to the data instead so users can find and
/// reuse it.)
fn normalized_csv_path(source: &str) -> String {
    let base = path_base(source);
    let stem = match base.rfind('.') {
        Some(idx) => &base[..idx],
        None => base,
    };
    let file = format!("{}.normalized.csv", stem);
    match source.rfind(['\\', '/']) {
        Some(idx) => join_path(&[&source[..idx], &file]),
        None => file,
    }
}

/// Import entry point — replaces the legacy `resolveImportFile` +
/// `importCounts` chain and the matrix worker (`{text, preset}` → parse +
/// normalize) with a single synchronous call:
///   1. read the source (.csv/.tsv/.txt as text, .xlsx/.xls via calamine),
///   2. detect the delimiter (CSV vs TSV) and, when the request carries no
///      matrix_format hint, the preset (featureCounts `#` comments / two-column
///      htseq lines / counts_matrix),
///   3. normalize the matrix (legacy `normalizeCountMatrix` semantics),
///   4. apply the request input options (drop/keep empty genes, duplicate
///      strategy, rounding — R engine `clean_counts` semantics),
///   5. compute nonzero counts, preview rows and totals,
///   6. when `write_normalized_csv`, either reuse the source (already a plain
///      normalized counts CSV, unchanged columns, no warnings, no transform)
///      or write `<stem>.normalized.csv` next to it.
pub fn import_counts(request: ImportRequest) -> Result<ImportData, MynxError> {
    let path = clean_import_path(&request.path);
    fs::metadata(path)
        .map_err(|_| MynxError::not_found(format!("文件不存在: {}", path)))?;

    let ext = path_ext_lower(path);
    let (rows, format): (Vec<Vec<String>>, &'static str) = match ext.as_str() {
        ".csv" | ".tsv" | ".txt" => {
            let text = read_text_file(path)?;
            let delimiter = detect_delimiter(&text);
            let parsed = parse_delimited(&text, delimiter);
            let format = if delimiter == '\t' { "tsv" } else { "csv" };
            (parsed, format)
        }
        ".xlsx" | ".xls" => (read_xlsx_rows(path)?, "excel"),
        other => {
            return Err(MynxError::validation(format!(
                "不支持的文件格式 {}(支持 .csv/.tsv/.txt/.xlsx)",
                other
            )))
        }
    };

    let first_row_raw: Vec<String> = rows.first().cloned().unwrap_or_default();
    let applied =
        request.matrix_format.unwrap_or_else(|| detect_matrix_format(&rows));
    let rows = if applied == MatrixFormat::Featurecounts {
        drop_comment_rows(rows)
    } else {
        rows
    };

    let NormalizedMatrix { headers, body, applied, warnings } =
        normalize_count_matrix(&rows, applied, request.drop_empty_gene, request.gene_col)?;
    if headers.len() < 2 {
        return Err(MynxError::validation("至少需要 1 列基因 ID + 1 列样本计数"));
    }
    let (body, transformed) = apply_input_options(
        body,
        request.drop_empty_gene,
        request.duplicate_genes,
        request.rounding,
    );

    // Per-sample nonzero gene counts, keyed by sample column name in column
    // order (legacy key semantics: finite values > 0 counted per column).
    let mut nonzero_counts: Map<String, Value> = Map::new();
    for header in headers.iter().skip(1) {
        nonzero_counts
            .entry(header.clone())
            .or_insert_with(|| Value::Number(Number::from(0)));
    }
    for row in &body {
        for (header, cell) in headers.iter().skip(1).zip(row.iter().skip(1)) {
            if parse_number_lenient(cell).is_some_and(|number| number > 0.0) {
                if let Some(slot) = nonzero_counts.get_mut(header) {
                    let next = slot.as_u64().unwrap_or(0) + 1;
                    *slot = Value::Number(Number::from(next));
                }
            }
        }
    }

    // Preview rows (first PREVIEW_ROWS, column order kept, numeric cells as
    // JSON numbers).
    let mut preview: Vec<Map<String, Value>> = Vec::new();
    for row in body.iter().take(PREVIEW_ROWS) {
        let mut row_object = Map::new();
        for (header, cell) in headers.iter().zip(row.iter()) {
            row_object.insert(header.clone(), number_cell(cell));
        }
        preview.push(row_object);
    }

    // data_file / converted: legacy always wrote the cached normalized CSV;
    // here the write is gated by write_normalized_csv. The source itself is
    // reused (converted = false) only when it already IS the normalized
    // matrix: plain CSV, counts_matrix preset, no warnings, unchanged columns
    // and no transform applied.
    let mut data_file: Option<String> = None;
    let mut converted = false;
    if request.write_normalized_csv {
        let headers_match = headers.len() == first_row_raw.len()
            && headers.iter().zip(first_row_raw.iter()).all(|(header, raw)| {
                raw.trim().trim_start_matches('\u{feff}') == header.as_str()
            });
        let fast_path = format == "csv"
            && applied == MatrixFormat::CountsMatrix
            && warnings.is_empty()
            && headers_match
            && !transformed;
        if fast_path {
            data_file = Some(path.to_string());
        } else {
            let target = normalized_csv_path(path);
            let text = to_csv_text(&headers, &body);
            fs::write(&target, text.as_bytes()).map_err(|error| {
                MynxError::io(format!("无法写入规范化 CSV {}: {}", target, error))
            })?;
            data_file = Some(target);
            converted = true;
        }
    }

    Ok(ImportData {
        v: WIRE_VERSION,
        gene_col: headers[0].clone(),
        sample_cols: headers[1..].to_vec(),
        nonzero_counts,
        total_genes: body.len() as u64,
        preview,
        preview_columns: headers,
        source_file: path.to_string(),
        data_file,
        converted,
        format: Some(format.to_string()),
        matrix_format: Some(applied),
        matrix_format_applied: Some(applied),
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn rows(spec: &[&[&str]]) -> Vec<Vec<String>> {
        spec.iter()
            .map(|row| row.iter().map(|cell| cell.to_string()).collect())
            .collect()
    }

    /// Legacy preset spellings (`normalizeMatrixFormat`): the typed
    /// `MatrixFormat` enum on ImportRequest makes the unknown-preset fallback
    /// a test-only path.
    #[cfg(test)]
    fn normalize_matrix_format(preset: &str) -> MatrixFormat {
        match preset.trim().to_lowercase().as_str() {
            "featurecounts" | "feature_counts" | "fc" => MatrixFormat::Featurecounts,
            "htseq" | "htseq_merged" | "htseq-count" => MatrixFormat::Htseq,
            _ => MatrixFormat::CountsMatrix,
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir()
            .join(format!("mynx_rnaseq_{}_{nanos}", name));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn request(path: &str) -> ImportRequest {
        ImportRequest {
            v: 1,
            path: path.to_string(),
            matrix_format: None,
            gene_col: 1,
            drop_empty_gene: true,
            duplicate_genes: DuplicateGenes::Sum,
            rounding: CountRounding::Round,
            write_normalized_csv: true,
        }
    }

    // ── ports of scripts/rnaseq-matrix-smoke.ts ─────────────────────────────

    #[test]
    fn parse_delimited_rows() {
        let parsed =
            parse_delimited("a,b,c\r\n1,\"x,y\",3\n\"q\"\"uote\",,z\r\n", ',');
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

    #[test]
    fn featurecounts_drops_annotation_columns() {
        let data = rows(&[
            &["Geneid", "Chr", "Start", "End", "Strand", "Length", "G1", "G2", "extra"],
            &["geneA", "chr1", "100", "200", "+", "50", "5", "6", "note"],
            &["geneB", "chr2", "300", "400", "-", "60", "7", "8", "x"],
        ]);
        let normalized =
            normalize_count_matrix(&data, MatrixFormat::Featurecounts, true, 1)
                .expect("normalize");
        assert_eq!(normalized.headers, vec!["Geneid", "G1", "G2"]);
        assert_eq!(normalized.applied, MatrixFormat::Featurecounts);
        assert!(normalized.warnings.iter().any(|warning| warning.contains("extra")));
    }

    #[test]
    fn htseq_filters_special_rows() {
        let data = rows(&[
            &["gene", "S1", "S2"],
            &["geneA", "1", "2"],
            &["__no_feature", "10", "20"],
            &["__ambiguous", "1", "1"],
            &["geneB", "3", "4"],
        ]);
        let normalized =
            normalize_count_matrix(&data, MatrixFormat::Htseq, true, 1).expect("normalize");
        assert_eq!(normalized.body.len(), 2);
        assert_eq!(normalized.body[0][0], "geneA");
    }

    #[test]
    fn unknown_preset_falls_back_to_counts_matrix() {
        assert_eq!(normalize_matrix_format("whatever"), MatrixFormat::CountsMatrix);
        assert_eq!(normalize_matrix_format("FeatureCounts"), MatrixFormat::Featurecounts);
        assert_eq!(normalize_matrix_format("feature_counts"), MatrixFormat::Featurecounts);
        assert_eq!(normalize_matrix_format("fc"), MatrixFormat::Featurecounts);
        assert_eq!(normalize_matrix_format("htseq-count"), MatrixFormat::Htseq);
        assert_eq!(normalize_matrix_format("HTSEQ_MERGED"), MatrixFormat::Htseq);
    }

    #[test]
    fn counts_matrix_filters_special_rows() {
        let data = rows(&[&["gene", "S1"], &["__no_feature", "5"], &["g1", "3"]]);
        let normalized =
            normalize_count_matrix(&data, MatrixFormat::CountsMatrix, true, 1)
                .expect("normalize");
        assert_eq!(normalized.body.len(), 1);
    }

    #[test]
    fn duplicate_rows_preserved_with_warning() {
        let data = rows(&[
            &["gene_id", "G1", "G2"],
            &["a", "5", "6"],
            &["a", "10", "20"],
            &["b", "2", "3"],
        ]);
        let normalized =
            normalize_count_matrix(&data, MatrixFormat::CountsMatrix, true, 1)
                .expect("normalize");
        assert_eq!(normalized.body.len(), 3);
        assert_eq!(normalized.body[0][1], "5");
        assert_eq!(normalized.body[1][1], "10");
        assert!(normalized.warnings.iter().any(|warning| warning.contains("重复基因名")));
    }

    #[test]
    fn fractional_data_warns_tpm() {
        let mut data = vec![vec!["gene".to_string(), "S1".to_string()]];
        for index in 0..100 {
            data.push(vec![
                format!("g{}", index),
                format!("{:.4}", index as f64 * 1.37 + 0.5),
            ]);
        }
        let normalized =
            normalize_count_matrix(&data, MatrixFormat::CountsMatrix, true, 1)
                .expect("normalize");
        assert!(normalized.warnings.iter().any(|warning| warning.contains("TPM")));
    }

    #[test]
    fn to_csv_text_roundtrip() {
        let csv = to_csv_text(
            &["gene_id".to_string(), "G,1".to_string()],
            &[
                vec!["a".to_string(), "1".to_string()],
                vec!["b\"q".to_string(), "2".to_string()],
            ],
        );
        let reparsed = parse_delimited(&csv, ',');
        assert_eq!(reparsed.len(), 3);
        assert_eq!(reparsed[0][1], "G,1");
        assert_eq!(reparsed[2][0], "b\"q");
    }

    #[test]
    fn throws_on_single_column() {
        let data = rows(&[&["only_one_col"]]);
        let error = normalize_count_matrix(&data, MatrixFormat::CountsMatrix, true, 1)
            .expect_err("must fail");
        assert!(error.message.contains("至少需要"), "{}", error.message);
    }

    #[test]
    fn throws_on_empty_input() {
        let error = normalize_count_matrix(&[], MatrixFormat::CountsMatrix, true, 1)
            .expect_err("must fail");
        assert!(error.message.contains("文件为空"), "{}", error.message);
    }

    // ── format detection ────────────────────────────────────────────────────

    #[test]
    fn featurecounts_detected_from_hash_comments() {
        let text = "# Program: featureCounts v2.4.0\n\
                    # Gene\tSampleA.bam\tSampleB.bam\n\
                    Geneid\tChr\tStart\tEnd\tStrand\tLength\tSampleA\tSampleB\n\
                    geneA\tchr1\t100\t200\t+\t1234\t5\t6\n\
                    geneB\tchr2\t300\t400\t-\t987\t7\t8\n";
        let parsed = parse_delimited(text, detect_delimiter(text));
        assert_eq!(detect_matrix_format(&parsed), MatrixFormat::Featurecounts);
        let normalized = normalize_count_matrix(
            &drop_comment_rows(parsed),
            MatrixFormat::Featurecounts,
            true,
            1,
        )
        .expect("normalize");
        assert_eq!(normalized.headers, vec!["Geneid", "SampleA", "SampleB"]);
        assert_eq!(normalized.body.len(), 2);
    }

    #[test]
    fn htseq_detected_from_two_column_lines() {
        let text = "gene\tcount\nENSG1\t10\nENSG2\t0\n";
        let parsed = parse_delimited(text, detect_delimiter(text));
        assert_eq!(detect_matrix_format(&parsed), MatrixFormat::Htseq);
    }

    #[test]
    fn plain_matrix_detected_as_counts_matrix() {
        let text = "gene_id,S1,S2\ng1,1,2\ng2,3,4\n";
        let parsed = parse_delimited(text, detect_delimiter(text));
        assert_eq!(detect_matrix_format(&parsed), MatrixFormat::CountsMatrix);
    }

    // ── CSV round trips ─────────────────────────────────────────────────────

    #[test]
    fn chinese_sample_names_survive_csv_roundtrip() {
        let headers = vec!["基因".to_string(), "样本一".to_string(), "样本,二".to_string()];
        let body = vec![
            vec!["基因一".to_string(), "1".to_string(), "2".to_string()],
            vec!["基因、\"二\"".to_string(), "3".to_string(), "4".to_string()],
        ];
        let text = to_csv_text(&headers, &body);
        let reparsed = parse_delimited(&text, ',');
        assert_eq!(reparsed.len(), 3);
        assert_eq!(reparsed[0], headers);
        assert_eq!(reparsed[1], body[0]);
        assert_eq!(reparsed[2], body[1]);
    }

    // ── input options (R engine clean_counts semantics) ─────────────────────

    #[test]
    fn duplicate_gene_strategies_match_engine() {
        let data = vec![
            vec!["gene".into(), "S1".into(), "S2".into()],
            vec!["a".into(), "5".into(), "6".into()],
            vec!["a".into(), "10".into(), "20".into()],
            vec!["b".into(), "2".into(), "3".into()],
        ];
        let (sum, transformed) =
            apply_input_options(data.clone(), true, DuplicateGenes::Sum, CountRounding::Round);
        assert!(transformed);
        assert_eq!(
            sum,
            vec![
                vec!["a".into(), "15".into(), "26".into()],
                vec!["b".into(), "2".into(), "3".into()],
            ]
        );

        let (max_mean, _) =
            apply_input_options(data.clone(), true, DuplicateGenes::MaxMean, CountRounding::Round);
        assert_eq!(
            max_mean,
            vec![
                vec!["a".into(), "10".into(), "20".into()],
                vec!["b".into(), "2".into(), "3".into()],
            ]
        );

        let (unique, _) =
            apply_input_options(data, true, DuplicateGenes::MakeUnique, CountRounding::Round);
        assert_eq!(
            unique,
            vec![
                vec!["a".into(), "5".into(), "6".into()],
                vec!["a_dup1".into(), "10".into(), "20".into()],
                vec!["b".into(), "2".into(), "3".into()],
            ]
        );
    }

    #[test]
    fn rounding_modes_match_engine() {
        let data = vec![
            vec!["gene".into(), "S1".into(), "S2".into(), "S3".into()],
            vec!["g".into(), "2.5".into(), "2.4".into(), "-0.5".into()],
        ];
        let (round, changed) =
            apply_input_options(data.clone(), true, DuplicateGenes::Sum, CountRounding::Round);
        assert!(changed);
        assert_eq!(
            round[1],
            vec!["g".into(), "3".into(), "2".into(), "0".into()]
        );

        let (floor, _) =
            apply_input_options(data.clone(), true, DuplicateGenes::Sum, CountRounding::Floor);
        assert_eq!(
            floor[1],
            vec!["g".into(), "2".into(), "2".into(), "-1".into()]
        );

        let (ceiling, _) =
            apply_input_options(data, true, DuplicateGenes::Sum, CountRounding::Ceiling);
        assert_eq!(
            ceiling[1],
            vec!["g".into(), "3".into(), "3".into(), "0".into()]
        );
    }

    #[test]
    fn rounding_integers_is_a_no_op() {
        let data = vec![
            vec!["gene".into(), "S1".into()],
            vec!["g1".into(), "5".into()],
            vec!["g2".into(), "7".into()],
        ];
        let (body, transformed) =
            apply_input_options(data, true, DuplicateGenes::Sum, CountRounding::Round);
        assert!(!transformed);
        assert_eq!(body[1][1], "5");
    }

    #[test]
    fn empty_gene_dropping_follows_request() {
        let data = vec![
            vec!["gene".into(), "S1".into()],
            vec!["".into(), "1".into()],
            vec!["g1".into(), "2".into()],
        ];
        let dropped =
            normalize_count_matrix(&data, MatrixFormat::CountsMatrix, true, 1)
                .expect("normalize");
        assert_eq!(dropped.body.len(), 1);

        let kept = normalize_count_matrix(&data, MatrixFormat::CountsMatrix, false, 1)
            .expect("normalize");
        assert_eq!(kept.body.len(), 2);
        let (body, transformed) = apply_input_options(
            kept.body,
            false,
            DuplicateGenes::Sum,
            CountRounding::Round,
        );
        assert!(transformed);
        assert_eq!(body[0][0], "unnamed_1");
        assert_eq!(body[1][0], "g1");
    }

    // ── import_counts end to end ────────────────────────────────────────────

    #[test]
    fn import_counts_plain_csv_reuses_source_as_data_file() {
        let dir = temp_dir("fast");
        let path = dir.join("counts.csv");
        fs::write(&path, "gene_id,S1,S2\ng1,1,2\ng2,3,4\n").expect("fixture");

        let data = import_counts(request(path.to_str().expect("utf8"))).expect("import");
        assert_eq!(data.gene_col, "gene_id");
        assert_eq!(data.sample_cols, vec!["S1", "S2"]);
        assert_eq!(data.total_genes, 2);
        assert_eq!(data.preview.len(), 2);
        assert_eq!(data.preview_columns, vec!["gene_id", "S1", "S2"]);
        assert_eq!(data.nonzero_counts.get("S1").and_then(Value::as_u64), Some(2));
        assert_eq!(data.nonzero_counts.get("S2").and_then(Value::as_u64), Some(2));
        assert!(!data.converted);
        assert_eq!(data.data_file.as_deref(), Some(path.to_str().expect("utf8")));
        assert_eq!(data.format.as_deref(), Some("csv"));
        assert_eq!(data.matrix_format, Some(MatrixFormat::CountsMatrix));
        assert_eq!(data.matrix_format_applied, Some(MatrixFormat::CountsMatrix));
        assert!(data.warnings.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_counts_writes_normalized_csv_when_needed() {
        let dir = temp_dir("write");
        let path = dir.join("raw.tsv");
        fs::write(&path, "gene_id\tS1\tS2\ng1\t1\t2\ng2\t3\t4\n").expect("fixture");

        let data = import_counts(request(path.to_str().expect("utf8"))).expect("import");
        assert_eq!(data.format.as_deref(), Some("tsv"));
        assert!(data.converted);
        let expected = dir.join("raw.normalized.csv");
        assert_eq!(data.data_file.as_deref(), Some(expected.to_str().expect("utf8")));
        let text = fs::read_to_string(&expected).expect("csv cache");
        assert!(text.starts_with("gene_id,S1,S2\r\n"), "{text:?}");
        assert!(text.contains("g1,1,2\r\n"), "{text:?}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_counts_skips_csv_write_when_not_requested() {
        let dir = temp_dir("nowrite");
        let path = dir.join("raw.tsv");
        fs::write(&path, "gene_id\tS1\ng1\t1\n").expect("fixture");

        let mut req = request(path.to_str().expect("utf8"));
        req.write_normalized_csv = false;
        let data = import_counts(req).expect("import");
        assert_eq!(data.data_file, None);
        assert!(!data.converted);
        assert!(!dir.join("raw.normalized.csv").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_counts_caps_preview_and_counts_nonzero() {
        let dir = temp_dir("preview");
        let path = dir.join("counts.csv");
        let mut text = String::from("gene_id,S1,S2\n");
        for index in 0..8 {
            text.push_str(&format!("g{},0,{}\n", index, index + 1));
        }
        fs::write(&path, text).expect("fixture");

        let data = import_counts(request(path.to_str().expect("utf8"))).expect("import");
        assert_eq!(data.preview.len(), PREVIEW_ROWS);
        assert_eq!(data.total_genes, 8);
        assert_eq!(data.nonzero_counts.get("S1").and_then(Value::as_u64), Some(0));
        assert_eq!(data.nonzero_counts.get("S2").and_then(Value::as_u64), Some(8));
        // preview numbers render as JSON numbers
        assert_eq!(
            data.preview[0].get("S2").and_then(Value::as_i64),
            Some(1)
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_counts_missing_file_errors() {
        let error = import_counts(request("Z:/definitely/missing.csv"))
            .expect_err("must fail");
        assert!(error.message.contains("文件不存在"), "{}", error.message);
    }

    #[test]
    fn import_counts_rejects_unknown_extension() {
        let dir = temp_dir("ext");
        let path = dir.join("data.parquet");
        fs::write(&path, "x").expect("fixture");
        let error =
            import_counts(request(path.to_str().expect("utf8"))).expect_err("must fail");
        assert!(error.message.contains("不支持的文件格式"), "{}", error.message);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_counts_applies_duplicate_and_rounding_options() {
        let dir = temp_dir("options");
        let path = dir.join("counts.csv");
        fs::write(&path, "gene_id,S1\ng1,1.5\ng1,2.5\ng2,3\n").expect("fixture");

        let mut req = request(path.to_str().expect("utf8"));
        req.matrix_format = Some(MatrixFormat::CountsMatrix);
        req.duplicate_genes = DuplicateGenes::Sum;
        req.rounding = CountRounding::Round;
        let data = import_counts(req).expect("import");
        assert_eq!(data.total_genes, 2);
        assert!(data.warnings.iter().any(|warning| warning.contains("重复基因名")));
        let first = &data.preview[0];
        assert_eq!(first.get("gene_id").and_then(Value::as_str), Some("g1"));
        assert_eq!(first.get("S1").and_then(Value::as_i64), Some(4)); // 1.5 + 2.5, rounded
        // merging changed rows → normalized CSV written next to the source
        assert!(data.converted);
        assert_eq!(
            data.data_file.as_deref(),
            Some(dir.join("counts.normalized.csv").to_str().expect("utf8"))
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_counts_featurecounts_hash_file() {
        let dir = temp_dir("fc");
        let path = dir.join("counts.txt");
        fs::write(
            &path,
            "# Program: featureCounts\n\
             # Gene\tS1.bam\n\
             Geneid\tChr\tStart\tEnd\tStrand\tLength\tS1\n\
             geneA\tchr1\t1\t2\t+\t100\t5\n\
             geneB\tchr2\t3\t4\t-\t200\t0\n",
        )
        .expect("fixture");

        let data = import_counts(request(path.to_str().expect("utf8"))).expect("import");
        assert_eq!(data.matrix_format, Some(MatrixFormat::Featurecounts));
        assert_eq!(data.matrix_format_applied, Some(MatrixFormat::Featurecounts));
        assert_eq!(data.sample_cols, vec!["S1"]);
        assert_eq!(data.total_genes, 2);
        assert_eq!(data.nonzero_counts.get("S1").and_then(Value::as_u64), Some(1));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_counts_htseq_file() {
        let dir = temp_dir("htseq");
        let path = dir.join("counts.tsv");
        fs::write(
            &path,
            "gene\tS1\tS2\ngeneA\t1\t2\n__no_feature\t10\t20\ngeneB\t3\t4\n",
        )
        .expect("fixture");

        let mut req = request(path.to_str().expect("utf8"));
        req.matrix_format = Some(MatrixFormat::Htseq);
        let data = import_counts(req).expect("import");
        assert_eq!(data.format.as_deref(), Some("tsv"));
        assert_eq!(data.total_genes, 2);
        assert_eq!(data.nonzero_counts.get("S1").and_then(Value::as_u64), Some(2));
        assert_eq!(data.nonzero_counts.get("S2").and_then(Value::as_u64), Some(2));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_counts_explicit_gene_col_override() {
        let dir = temp_dir("genecol");
        let path = dir.join("counts.csv");
        fs::write(&path, "sample_id,gene_id,S1\ns1,gA,5\ns2,gB,7\n").expect("fixture");

        let mut req = request(path.to_str().expect("utf8"));
        req.gene_col = 2; // 1-based: second column carries the gene names
        let data = import_counts(req).expect("import");
        assert_eq!(data.gene_col, "gene_id");
        assert_eq!(data.sample_cols, vec!["sample_id", "S1"]);
        assert_eq!(data.total_genes, 2);

        // out-of-range gene_col → validation error
        let mut req = request(path.to_str().expect("utf8"));
        req.gene_col = 9;
        let error = import_counts(req).expect_err("must fail");
        assert!(error.message.contains("gene_col"), "{}", error.message);
        fs::remove_dir_all(&dir).ok();
    }
}
