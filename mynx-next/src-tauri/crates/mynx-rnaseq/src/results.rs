//! Run-directory layer — port of `src/lib/rnaseq/results.ts` (scanning,
//! params restore, DE summary) plus the `defaults.ts` deep-merge used to
//! restore configs from history. The fs-plugin reads are replaced by direct
//! `std::fs` access.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;

use mynx_contracts::rnaseq::{
    DeSummaryRow, ResultFileItem, RnaSeqConfig, RunDirEntry,
};
use mynx_contracts::task::MynxError;
use mynx_contracts::WIRE_VERSION;
use serde_json::Value;

use crate::io::{join_path, mtime_ms};
use crate::matrix::{detect_delimiter, parse_delimited};

/// Run directories produced by the engine (reference-script QC/DEG layout).
pub const RESULT_IMAGE_DIRS: [&str; 8] = [
    "heatmap",
    "plots",
    "QC",
    "PCA",
    "MA",
    "DEG",
    "expression",
    "overlap",
];

fn dir_exists(path: &str) -> bool {
    fs::metadata(path).map(|metadata| metadata.is_dir()).unwrap_or(false)
}

fn file_exists(path: &str) -> bool {
    fs::metadata(path).map(|metadata| metadata.is_file()).unwrap_or(false)
}

/// JS `localeCompare` approximation for the ASCII file/dir names the engine
/// produces: case-insensitive primary comparison, byte order tiebreak (so
/// uppercase sorts before lowercase, like the ICU tertiary level).
fn locale_cmp(a: &str, b: &str) -> Ordering {
    a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| a.cmp(b))
}

// ── run-dir scanning ────────────────────────────────────────────────────────

/// `isRunDir`: a directory containing any engine output sub-directory
/// (heatmap/, plots/, QC/, …) or `DE/`.
pub fn is_run_dir(path: &str) -> bool {
    if path.trim().is_empty() {
        return false;
    }
    RESULT_IMAGE_DIRS
        .iter()
        .chain(std::iter::once(&"DE"))
        .any(|dir| dir_exists(&join_path(&[path, dir])))
}

/// `hasDeResult`: the run produced DE output (DE/ exists).
pub fn has_de_result(run_dir: &str) -> bool {
    if run_dir.trim().is_empty() {
        return false;
    }
    dir_exists(&join_path(&[run_dir, "DE"]))
}

/// prepared/params.json (or the legacy root params.json) exists.
fn params_file_exists(run_dir: &str) -> bool {
    file_exists(&join_path(&[run_dir, "prepared", "params.json"]))
        || file_exists(&join_path(&[run_dir, "params.json"]))
}

/// `listRunDirs`: run directories under the output base, newest first.
/// Unreadable bases yield an empty list; ties on mtime break by name so the
/// order is deterministic.
pub fn list_run_dirs(output_base: &str) -> Vec<RunDirEntry> {
    let entries = match fs::read_dir(output_base) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut runs: Vec<(String, String, i64)> = Vec::new(); // (path, name, mtime)
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else { continue };
        if !metadata.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = join_path(&[output_base, &name]);
        if !is_run_dir(&path) {
            continue;
        }
        runs.push((path, name, mtime_ms(&metadata)));
    }
    runs.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| locale_cmp(&a.1, &b.1)));
    runs.into_iter()
        .map(|(path, name, mtime)| RunDirEntry {
            v: WIRE_VERSION,
            has_de: has_de_result(&path),
            has_params: params_file_exists(&path),
            path,
            name,
            mtime_ms: mtime,
        })
        .collect()
}

// ── params restore (defaults.ts deepMerge) ──────────────────────────────────

/// Exact port of defaults.ts `deepMerge` on JSON values:
///   - array base: an array patch replaces it wholesale, anything else keeps it;
///   - object base: non-object patches (null / array / scalar) keep the base,
///     object patches merge recursively — keys unknown to the base are inserted
///     as-is, null patch values keep the existing value (in JS, `undefined`
///     patch keys are skipped and null falls through `?? base`);
///   - scalar base: null patches keep the base, anything else replaces it.
pub(crate) fn deep_merge(base: &Value, patch: &Value) -> Value {
    match base {
        Value::Array(_) => {
            if patch.is_array() {
                patch.clone()
            } else {
                base.clone()
            }
        }
        Value::Object(base_map) => {
            let patch_map = match patch {
                Value::Object(map) => map,
                _ => return base.clone(),
            };
            let mut merged = base_map.clone();
            for (key, value) in patch_map {
                let next = match merged.get(key) {
                    Some(existing) => {
                        if value.is_null() {
                            existing.clone()
                        } else {
                            deep_merge(existing, value)
                        }
                    }
                    None => value.clone(),
                };
                merged.insert(key.clone(), next);
            }
            Value::Object(merged)
        }
        _ => {
            if patch.is_null() {
                base.clone()
            } else {
                patch.clone()
            }
        }
    }
}

/// Restores a config from raw history params: strips the runtime `steps`
/// field (step/run state is never restored), deep-merges over the default
/// config and deserializes. When the merged JSON no longer fits
/// `RnaSeqConfig` (e.g. a wrong-typed legacy field), the defaults are kept.
fn restore_config(params: &Value) -> RnaSeqConfig {
    let mut rest = params.clone();
    if let Value::Object(map) = &mut rest {
        map.remove("steps");
    }
    let defaults = match serde_json::to_value(RnaSeqConfig::default()) {
        Ok(value) => value,
        Err(_) => return RnaSeqConfig::default(),
    };
    let merged = deep_merge(&defaults, &rest);
    serde_json::from_value(merged).unwrap_or_else(|_| RnaSeqConfig::default())
}

/// `loadRunParams` with the legacy fallback: reads `prepared/params.json`
/// (written by the runner) and falls back to the root-level `params.json`
/// kept by old run layouts. The parsed params are restored into a
/// fully-populated `RnaSeqConfig` (defaults fill missing fields).
pub fn load_run_params(run_dir: &str) -> Result<RnaSeqConfig, MynxError> {
    // Resolve to a canonical (symlink- and `..`-free) absolute path before
    // touching any bytes; relative run dirs are rejected outright.
    let run_path = {
        let raw = std::path::Path::new(run_dir);
        if !raw.is_absolute() {
            return Err(MynxError::validation("run 目录必须为绝对路径"));
        }
        fs::canonicalize(raw)
            .map_err(|e| MynxError::not_found(format!("run 目录不存在: {e}")))?
    };
    let prepared = run_path.join("prepared").join("params.json");
    let root = run_path.join("params.json");
    let (path, text) = match fs::read_to_string(&prepared) {
        Ok(text) => (prepared, text),
        Err(_) => {
            let text = fs::read_to_string(&root).map_err(|_| {
                MynxError::not_found(format!(
                    "params.json not found: {} (fallback {})",
                    prepared.display(),
                    root.display()
                ))
            })?;
            (root, text)
        }
    };
    let params: Value = serde_json::from_str(&text).map_err(|error| {
        MynxError::validation(format!("params.json 解析失败 {}: {}", path.display(), error))
    })?;
    Ok(restore_config(&params))
}

/// `merge_params`: deep-merges a params patch over a base config (defaults.ts
/// `deepMerge` semantics) and deserializes the result — serde defaults fill
/// the gaps. If the merged JSON no longer fits `RnaSeqConfig`, the base
/// config is returned unchanged.
pub fn merge_params(base: &RnaSeqConfig, patch: &Value) -> RnaSeqConfig {
    let Ok(base_json) = serde_json::to_value(base) else {
        return base.clone();
    };
    let merged = deep_merge(&base_json, patch);
    serde_json::from_value(merged).unwrap_or_else(|_| base.clone())
}

/// `mergeRunParams`: restores a config from history params — merges the patch
/// over the DEFAULT config (steps stripped), then applies the current
/// output_dir and the run_name fallback.
pub fn merge_run_params(config: &RnaSeqConfig, params: &Value) -> RnaSeqConfig {
    let mut merged = restore_config(params);
    merged.output_dir = config.output_dir.clone();
    if !config.run_name.is_empty() {
        merged.run_name = config.run_name.clone();
    }
    merged
}

// ── DE results ──────────────────────────────────────────────────────────────

/// `parseCsvText`: delimited text → row maps keyed by (BOM-stripped, trimmed)
/// headers; blank rows are dropped.
fn parse_csv_text(text: &str) -> Vec<HashMap<String, String>> {
    let delimiter = detect_delimiter(text);
    let rows = parse_delimited(text, delimiter);
    if rows.is_empty() {
        return Vec::new();
    }
    let headers: Vec<String> = rows[0]
        .iter()
        .map(|header| {
            header
                .trim()
                .trim_start_matches('\u{feff}')
                .to_string()
        })
        .collect();
    rows.into_iter()
        .skip(1)
        .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
        .map(|row| {
            let mut object: HashMap<String, String> = HashMap::new();
            for (header, cell) in headers.iter().zip(row.iter()) {
                object.insert(header.clone(), cell.trim().to_string());
            }
            object
        })
        .collect()
}

fn text_field(row: &HashMap<String, String>, key: &str) -> String {
    row.get(key).cloned().unwrap_or_default()
}

/// `Number(x) || 0` — unparsable/zero fields collapse to 0; negatives clamp to
/// 0 through the saturating u32 cast (DE summaries never carry them).
fn number_field_u32(row: &HashMap<String, String>, key: &str) -> u32 {
    let parsed = row
        .get(key)
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite());
    match parsed {
        Some(value) if value != 0.0 => value as u32,
        _ => 0,
    }
}

fn number_field_f64(row: &HashMap<String, String>, key: &str) -> f64 {
    let parsed = row
        .get(key)
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite());
    match parsed {
        Some(value) if value != 0.0 => value,
        _ => 0.0,
    }
}

/// `readDeSummary`: DE/DE_summary.csv rows. Missing/empty file → not-found
/// error (the legacy API returned null for both).
pub fn read_de_summary(run_dir: &str) -> Result<Vec<DeSummaryRow>, MynxError> {
    // Canonical absolute path before touching bytes (symlink/.. resolution).
    let run_path = {
        let raw = std::path::Path::new(run_dir);
        if !raw.is_absolute() {
            return Err(MynxError::validation("run 目录必须为绝对路径"));
        }
        fs::canonicalize(raw)
            .map_err(|e| MynxError::not_found(format!("run 目录不存在: {e}")))?
    };
    let path = run_path.join("DE").join("DE_summary.csv");
    let text = fs::read_to_string(&path)
        .map_err(|_| MynxError::not_found(format!("DE_summary.csv not found: {}", path.display())))?;
    let rows = parse_csv_text(&text);
    if rows.is_empty() {
        return Err(MynxError::not_found(format!(
            "DE_summary.csv is empty: {}",
            path.display()
        )));
    }
    Ok(rows
        .iter()
        .map(|row| DeSummaryRow {
            v: WIRE_VERSION,
            comparison: text_field(row, "comparison"),
            case: text_field(row, "case"),
            control: text_field(row, "control"),
            n_case: number_field_u32(row, "n_case"),
            n_control: number_field_u32(row, "n_control"),
            path: text_field(row, "path"),
            method: text_field(row, "method"),
            genes_tested: number_field_u32(row, "genes_tested"),
            padj_cutoff: number_field_f64(row, "padj_cutoff"),
            log2fc_cutoff: number_field_f64(row, "log2fc_cutoff"),
            up: number_field_u32(row, "Up"),
            down: number_field_u32(row, "Down"),
        })
        .collect())
}

// ── result files ────────────────────────────────────────────────────────────

/// `listResultImages`: png/svg/pdf files in the engine sub-directories,
/// sorted by sub-directory then file name (locale-style ordering).
pub fn list_result_files(run_dir: &str) -> Vec<ResultFileItem> {
    let mut out = Vec::new();
    for subdir in RESULT_IMAGE_DIRS {
        let dir = join_path(&[run_dir, subdir]);
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else { continue };
            if metadata.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            if !(lower.ends_with(".png")
                || lower.ends_with(".svg")
                || lower.ends_with(".pdf"))
            {
                continue;
            }
            out.push(ResultFileItem {
                v: WIRE_VERSION,
                subdir: (*subdir).to_string(),
                size: metadata.len(),
                mtime_ms: mtime_ms(&metadata),
                name,
            });
        }
    }
    out.sort_by(|a, b| {
        locale_cmp(&a.subdir, &b.subdir).then_with(|| locale_cmp(&a.name, &b.name))
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use mynx_contracts::rnaseq::{FilterMethod, ShrinkMethod, TopN};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mynx_rnaseq_{}_{nanos}", name));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write_run(
        base: &Path,
        name: &str,
        with_de: bool,
        with_params: bool,
    ) -> PathBuf {
        let run = base.join(name);
        fs::create_dir_all(run.join("heatmap")).expect("run dir");
        if with_de {
            fs::create_dir_all(run.join("DE")).expect("DE dir");
        }
        if with_params {
            fs::create_dir_all(run.join("prepared")).expect("prepared dir");
            fs::write(run.join("prepared").join("params.json"), "{}")
                .expect("params.json");
        }
        run
    }

    #[test]
    fn list_run_dirs_orders_newest_first() {
        let base = temp_dir("runs");
        let old = write_run(&base, "run_old", false, false);
        std::thread::sleep(Duration::from_millis(60));
        let mid = write_run(&base, "run_mid", true, false);
        std::thread::sleep(Duration::from_millis(60));
        let _new = write_run(&base, "run_new", true, true);
        // noise that must be skipped
        fs::create_dir_all(base.join("not_a_run")).expect("noise dir");
        fs::write(base.join("plain.txt"), "x").expect("noise file");

        let dirs = list_run_dirs(base.to_str().expect("utf8"));
        assert_eq!(dirs.len(), 3, "{dirs:?}");
        assert_eq!(dirs[0].name, "run_new");
        assert_eq!(dirs[1].name, "run_mid");
        assert_eq!(dirs[2].name, "run_old");
        assert!(dirs[0].has_de && dirs[0].has_params);
        assert!(dirs[1].has_de && !dirs[1].has_params);
        assert!(!dirs[2].has_de && !dirs[2].has_params);
        assert!(dirs[0].mtime_ms >= dirs[1].mtime_ms);
        assert!(dirs[1].mtime_ms >= dirs[2].mtime_ms);
        assert!(dirs[0].path.ends_with("run_new"));

        assert!(is_run_dir(old.to_str().expect("utf8")));
        assert!(!is_run_dir(base.join("not_a_run").to_str().expect("utf8")));
        assert!(!is_run_dir(""));
        assert!(!has_de_result(old.to_str().expect("utf8")));
        assert!(has_de_result(mid.to_str().expect("utf8")));
        assert!(list_run_dirs(base.join("missing").to_str().expect("utf8")).is_empty());

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn load_run_params_prefers_prepared_then_root() {
        let base = temp_dir("params");

        // prepared/params.json wins
        let run = base.join("with_prepared");
        fs::create_dir_all(run.join("prepared")).expect("prepared");
        fs::write(
            run.join("prepared").join("params.json"),
            r#"{"run_name":"prepared","de":{"padj":0.1,"filter":{"min_count":7}}}"#,
        )
        .expect("params");
        let config = load_run_params(run.to_str().expect("utf8")).expect("load");
        assert_eq!(config.run_name, "prepared");
        assert!((config.de.padj - 0.1).abs() < 1e-12);
        assert!((config.de.filter.min_count - 7.0).abs() < 1e-12);
        assert_eq!(config.de.filter.method, FilterMethod::FilterByExpr); // default kept
        assert_eq!(config.input.gene_col, 1); // default filled
        assert_eq!(config.steps, None); // runtime field stripped

        // legacy root params.json fallback
        let run = base.join("root_only");
        fs::create_dir_all(&run).expect("run");
        fs::write(run.join("params.json"), r#"{"run_name":"root"}"#).expect("params");
        let config = load_run_params(run.to_str().expect("utf8")).expect("load");
        assert_eq!(config.run_name, "root");

        // neither file → error
        let run = base.join("empty");
        fs::create_dir_all(&run).expect("run");
        assert!(load_run_params(run.to_str().expect("utf8")).is_err());

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn load_run_params_fills_defaults_from_partial_json() {
        let base = temp_dir("partial");
        let run = base.join("run");
        fs::create_dir_all(run.join("prepared")).expect("prepared");
        fs::write(
            run.join("prepared").join("params.json"),
            r#"{
                "comparisons": [{"name":"c1","case":"A","control":"B"}],
                "overall_heatmap": {"top_n": 42}
            }"#,
        )
        .expect("params");
        let config = load_run_params(run.to_str().expect("utf8")).expect("load");
        assert_eq!(config.comparisons.len(), 1);
        assert_eq!(config.comparisons[0].name, "c1");
        assert_eq!(config.overall_heatmap.top_n, TopN::Count(42));
        assert_eq!(config.overall_heatmap.name, "overall"); // sibling default kept
        assert_eq!(config.plots.dpi, 300); // untouched defaults elsewhere
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn merge_params_follows_deep_merge_semantics() {
        let mut base = RnaSeqConfig::default();
        base.output_dir = "D:/orig".to_string();
        let patch: Value = serde_json::json!({
            "de": {
                "padj": 0.01,
                "filter": {"min_count": 3.5},
                "shrink": "apeglm"
            },
            "comparisons": [{"name": "x", "case": "C", "control": "T"}],
            "input": null,
            "unknown_key": {"a": 1},
            "run_name": "renamed",
            "overall_heatmap": {"marker_genes": ["KLF4"]}
        });
        let merged = merge_params(&base, &patch);
        assert!((merged.de.padj - 0.01).abs() < 1e-12);
        assert!((merged.de.filter.min_count - 3.5).abs() < 1e-12);
        assert!((merged.de.log2fc - base.de.log2fc).abs() < 1e-12); // sibling default
        assert_eq!(merged.de.shrink, ShrinkMethod::Apeglm);
        assert_eq!(merged.comparisons.len(), 1); // arrays replace wholesale
        assert_eq!(merged.comparisons[0].name, "x");
        assert_eq!(merged.input, base.input); // null patch keeps base object
        assert_eq!(merged.run_name, "renamed"); // scalar patch replaces
        assert_eq!(merged.overall_heatmap.marker_genes, vec!["KLF4".to_string()]);
        assert_eq!(merged.output_dir, "D:/orig"); // untouched base field

        // wrong-typed patch → base returned unchanged
        let bad: Value = serde_json::json!({"input": {"gene_col": "not-a-number"}});
        assert_eq!(merge_params(&base, &bad), base);

        // non-object patch keeps the whole base
        let scalar: Value = serde_json::json!("nope");
        assert_eq!(merge_params(&base, &scalar), base);
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn merge_run_params_overrides_output_dir_and_drops_steps() {
        let mut current = RnaSeqConfig::default();
        current.output_dir = "D:/current".to_string();
        current.run_name = "current".to_string();
        let params: Value = serde_json::json!({
            "steps": ["de", "heatmap"],
            "run_name": "from_history",
            "output_dir": "D:/history"
        });
        let merged = merge_run_params(&current, &params);
        assert_eq!(merged.output_dir, "D:/current");
        assert_eq!(merged.run_name, "current"); // non-empty current wins
        assert_eq!(merged.steps, None);

        let mut current = RnaSeqConfig::default();
        current.output_dir = "D:/current2".to_string();
        current.run_name = String::new();
        let merged = merge_run_params(&current, &params);
        assert_eq!(merged.run_name, "from_history"); // empty current falls back
        assert_eq!(merged.output_dir, "D:/current2");
    }

    #[test]
    fn read_de_summary_parses_rows() {
        let base = temp_dir("de");
        let run = base.join("run");
        fs::create_dir_all(run.join("DE")).expect("DE");
        fs::write(
            run.join("DE").join("DE_summary.csv"),
            "comparison,case,control,n_case,n_control,path,method,genes_tested,padj_cutoff,log2fc_cutoff,Up,Down\n\
             c1_vs_c2,A,B,3,3,DE_c1_vs_c2.csv,deseq2,1200,0.05,1,15,23\n",
        )
        .expect("summary");
        let rows = read_de_summary(run.to_str().expect("utf8")).expect("summary");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].comparison, "c1_vs_c2");
        assert_eq!(rows[0].case, "A");
        assert_eq!(rows[0].control, "B");
        assert_eq!(rows[0].n_case, 3);
        assert_eq!(rows[0].n_control, 3);
        assert_eq!(rows[0].method, "deseq2");
        assert_eq!(rows[0].genes_tested, 1200);
        assert!((rows[0].padj_cutoff - 0.05).abs() < 1e-12);
        assert!((rows[0].log2fc_cutoff - 1.0).abs() < 1e-12);
        assert_eq!(rows[0].up, 15);
        assert_eq!(rows[0].down, 23);

        // missing file → error
        let run = base.join("no_de");
        fs::create_dir_all(&run).expect("run");
        assert!(read_de_summary(run.to_str().expect("utf8")).is_err());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn list_result_files_collects_plot_outputs() {
        let base = temp_dir("results");
        let run = base.join("run");
        fs::create_dir_all(run.join("heatmap")).expect("heatmap");
        fs::create_dir_all(run.join("plots")).expect("plots");
        fs::create_dir_all(run.join("QC")).expect("QC");
        fs::write(run.join("heatmap").join("overall.png"), "x").expect("png");
        fs::write(run.join("heatmap").join("overall.PDF"), "x").expect("pdf");
        fs::write(run.join("heatmap").join("notes.txt"), "x").expect("txt");
        fs::write(run.join("plots").join("PCA.svg"), "x").expect("svg");
        fs::create_dir_all(run.join("plots").join("nested")).expect("nested");
        fs::write(run.join("QC").join("dist.png"), "x").expect("qc png");

        let files = list_result_files(run.to_str().expect("utf8"));
        // subdir order follows the locale-style compare: heatmap < plots < QC
        assert_eq!(files.len(), 4, "{files:?}");
        assert_eq!(files[0].subdir, "heatmap");
        assert_eq!(files[0].name, "overall.PDF");
        assert_eq!(files[1].name, "overall.png");
        assert_eq!(files[2].subdir, "plots");
        assert_eq!(files[2].name, "PCA.svg");
        assert_eq!(files[3].subdir, "QC");
        assert_eq!(files[3].name, "dist.png");
        assert_eq!(files[0].size, 1);
        assert!(files[0].v >= 1);

        fs::remove_dir_all(&base).ok();
    }
}
