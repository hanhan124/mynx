//! Chart run plumbing: `chart_event` line parsing (R prints one JSON object
//! per stdout line), the sidecar JSON written next to the figure (legacy
//! `runner.ts`), and the output-file scan for the terminal result.

use std::fs;
use std::path::PathBuf;

use mynx_contracts::charts::{ChartRunConfig, ChartRunEvent};
use mynx_contracts::task::{LogLevel, MynxError};
use mynx_contracts::WIRE_VERSION;

// ── event parsing ───────────────────────────────────────────────────────────

/// Build a [`ChartRunConfig`] from the raw invoke JSON (camelCase wire keys,
/// same shape the legacy runner sent).
///
/// This deliberately avoids `serde_json::from_value::<ChartRunConfig>`: the
/// contract type carries container-level `#[serde(default)]` whose derive
/// calls `Default::default()` on every deserialization, while the contract's
/// `Default` impl itself parses a *partial* JSON — an infinite recursion
/// (stack overflow) for any input. Reading the pub fields directly sidesteps
/// that; unset optionals become `None`, missing strings stay empty and
/// `installMissing` defaults to `true` like the legacy default config.
pub fn chart_run_config_from_value(
    value: &serde_json::Value,
) -> Result<ChartRunConfig, MynxError> {
    use serde_json::Value;

    let object = value
        .as_object()
        .ok_or_else(|| MynxError::validation("图表运行配置必须是 JSON 对象"))?;
    let string = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let opt_string =
        |key: &str| object.get(key).and_then(Value::as_str).map(str::to_string);
    let opt_f64 = |key: &str| object.get(key).and_then(Value::as_f64);
    let opt_bool = |key: &str| object.get(key).and_then(Value::as_bool);
    let opt_u32 = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_u64)
            .map(|number| number as u32)
    };

    Ok(ChartRunConfig {
        file_path: string("filePath"),
        output_dir: string("outputDir"),
        template: string("template"),
        kind: string("kind"),
        gallery_url: opt_string("galleryUrl"),
        source_repo_path: opt_string("sourceRepoPath"),
        x: string("x"),
        y: string("y"),
        group: opt_string("group"),
        size: opt_string("size"),
        title: string("title"),
        subtitle: opt_string("subtitle"),
        caption: opt_string("caption"),
        plot_tag: opt_string("plotTag"),
        color: string("color"),
        format: string("format"),
        width: opt_f64("width"),
        height: opt_f64("height"),
        dpi: opt_u32("dpi"),
        gg_theme: opt_string("ggTheme"),
        base_size: opt_f64("baseSize"),
        font_family: opt_string("fontFamily"),
        show_legend: opt_bool("showLegend"),
        legend_position: opt_string("legendPosition"),
        show_grid: opt_bool("showGrid"),
        show_title: opt_bool("showTitle"),
        title_size: opt_f64("titleSize"),
        title_hjust: opt_f64("titleHjust"),
        axis_text_size: opt_f64("axisTextSize"),
        axis_title_size: opt_f64("axisTitleSize"),
        publication_preset: opt_string("publicationPreset"),
        palette: opt_string("palette"),
        palette_reverse: opt_bool("paletteReverse"),
        point_size: opt_f64("pointSize"),
        line_width: opt_f64("lineWidth"),
        bar_width: opt_f64("barWidth"),
        alpha: opt_f64("alpha"),
        axis_line_width: opt_f64("axisLineWidth"),
        grid_line_width: opt_f64("gridLineWidth"),
        panel_border: opt_bool("panelBorder"),
        show_raw_points: opt_bool("showRawPoints"),
        show_stats: opt_bool("showStats"),
        stat_test: opt_string("statTest"),
        p_adjust_method: opt_string("pAdjustMethod"),
        heatmap_cluster_rows: opt_bool("heatmapClusterRows"),
        heatmap_cluster_cols: opt_bool("heatmapClusterCols"),
        heatmap_scale: opt_string("heatmapScale"),
        install_missing: object
            .get("installMissing")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        verified: opt_bool("verified"),
    })
}

/// Parse one stdout/stderr line into a [`ChartRunEvent`]:
///   - a JSON object (as printed by `chart_runtime.R`:
///     `{timestamp, stage, level, message, progress, detail}`) becomes the
///     structured event; a missing `stage` falls back to `"log"`, a missing
///     `level` to `"info"` and an unparseable `timestamp` to `now_ms`;
///   - anything else is forwarded as `{stage: "log", level: fallback_level,
///     message: line}` — the legacy plain-log path (`JSON.parse` try/catch).
///     `fallback_level` is the shared log classifier's verdict for the raw
///     line (contract levels are strings: "info"/"warning"/"error"/"success").
pub fn chart_event_from_line(line: &str, now_ms: i64, fallback_level: LogLevel) -> ChartRunEvent {
    let log_event = |stage: &str, level: String, message: String| ChartRunEvent {
        v: WIRE_VERSION,
        ts_ms: now_ms,
        stage: stage.to_string(),
        level,
        message,
        progress: None,
        detail: None,
    };

    let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
        return log_event("log", fallback_level.to_string(), line.to_string());
    };
    let Some(object) = value.as_object() else {
        return log_event("log", fallback_level.to_string(), line.to_string());
    };

    let stage = object
        .get("stage")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("log")
        .to_string();
    let level = object
        .get("level")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("info")
        .to_string();
    let message = object
        .get("message")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(line)
        .to_string();
    let ts_ms = object
        .get("timestamp")
        .and_then(serde_json::Value::as_str)
        .map(|ts| parse_r_timestamp(ts, now_ms))
        .unwrap_or(now_ms);

    ChartRunEvent {
        v: WIRE_VERSION,
        ts_ms,
        stage,
        level,
        message,
        progress: object.get("progress").and_then(serde_json::Value::as_f64),
        detail: object
            .get("detail")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    }
}

// ── output files ────────────────────────────────────────────────────────────

/// `<output_dir>/mynx-<template>.<format>` (legacy output path).
pub fn output_file_path(output_dir: &str, template: &str, format: &str) -> String {
    let mut path = PathBuf::from(output_dir);
    path.push(format!("mynx-{template}.{format}"));
    path.to_string_lossy().into_owned()
}

/// Every `mynx-<template>.*` figure file currently in `output_dir` (sidecar
/// JSON files excluded), sorted, as full paths.
pub fn list_output_files(output_dir: &str, template: &str) -> Vec<String> {
    let prefix = format!("mynx-{template}.");
    let mut files: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(output_dir) {
        for entry in entries.flatten() {
            if !entry.path().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(&prefix) && !name.ends_with(".json") {
                files.push(entry.path().to_string_lossy().into_owned());
            }
        }
    }
    files.sort();
    files
}

// ── sidecar JSON (legacy runner.ts) ─────────────────────────────────────────

/// Write `<output_dir>/mynx-<template>.<format>.json` next to the figure:
/// `{version, createdAt, outputPath, template{id,kind,sourceUrl,
/// sourceRepoPath}, output{format,width,height,dpi}, config}` — pretty
/// printed. Optional config fields that are unset are omitted (JS
/// `JSON.stringify` drops `undefined`; the explicit nulls of `template` /
/// `output` are kept like the legacy `?? null` expressions). Returns the
/// sidecar path, or `None` when the write failed (legacy `.catch(() => {})`).
pub fn write_sidecar(
    config: &ChartRunConfig,
    output_dir: &str,
    template: &str,
    format: &str,
    now_ms: i64,
) -> Option<String> {
    let output_path = output_file_path(output_dir, template, format);
    let sidecar_path = {
        let mut path = PathBuf::from(output_dir);
        path.push(format!("mynx-{template}.{format}.json"));
        path
    };

    let mut config_value = serde_json::to_value(config).ok()?;
    if let Some(object) = config_value.as_object_mut() {
        object.retain(|_, value| !value.is_null());
    }

    let sidecar = serde_json::json!({
        "version": 1,
        "createdAt": iso_utc_now(now_ms),
        "outputPath": output_path,
        "template": {
            "id": config.template,
            "kind": config.kind,
            "sourceUrl": config.gallery_url,
            "sourceRepoPath": config.source_repo_path,
        },
        "output": {
            "format": format,
            "width": config.width,
            "height": config.height,
            "dpi": config.dpi,
        },
        "config": config_value,
    });
    let text = serde_json::to_string_pretty(&sidecar).ok()?;
    fs::write(&sidecar_path, text.as_bytes()).ok()?;
    Some(sidecar_path.to_string_lossy().into_owned())
}

// ── timestamps ──────────────────────────────────────────────────────────────

/// `new Date().toISOString()` shape: `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC).
pub fn iso_utc_now(now_ms: i64) -> String {
    let days = now_ms.div_euclid(86_400_000);
    let rest = now_ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour = rest / 3_600_000;
    let minute = (rest % 3_600_000) / 60_000;
    let second = (rest % 60_000) / 1_000;
    let milli = rest % 1_000;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z"
    )
}

/// Parse the R `chart_event` timestamp
/// (`format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z")`, e.g.
/// `2026-11-15T10:00:00.000+0800`); also accepts `Z`/`±HH:MM` offsets.
/// Returns `fallback_ms` when the shape is not recognized.
pub fn parse_r_timestamp(timestamp: &str, fallback_ms: i64) -> i64 {
    parse_r_timestamp_inner(timestamp).unwrap_or(fallback_ms)
}

fn parse_r_timestamp_inner(timestamp: &str) -> Option<i64> {
    let ts = timestamp.trim();
    let (date, time) = ts.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some() {
        return None;
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    // Trailing zone: Z, or ±HH[MM]/±HH:MM.
    let (clock, offset_ms) = if let Some(stripped) =
        time.strip_suffix('Z').or_else(|| time.strip_suffix('z'))
    {
        (stripped, 0i64)
    } else if let Some(sign_pos) = time.rfind(['+', '-']) {
        if sign_pos < 8 {
            return None;
        }
        let sign = if time.as_bytes()[sign_pos] == b'+' { 1i64 } else { -1i64 };
        let digits: String = time[sign_pos + 1..].chars().filter(|c| *c != ':').collect();
        if digits.len() != 4 || !digits.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let hours: i64 = digits[..2].parse().ok()?;
        let minutes: i64 = digits[2..].parse().ok()?;
        (&time[..sign_pos], sign * (hours * 3_600 + minutes * 60) * 1_000)
    } else {
        (time, 0i64)
    };

    // Clock: HH:MM:SS[.mmm]
    let mut clock_parts = clock.split(':');
    let hour: i64 = clock_parts.next()?.parse().ok()?;
    let minute: i64 = clock_parts.next()?.parse().ok()?;
    let second_part = clock_parts.next()?;
    if clock_parts.next().is_some() {
        return None;
    }
    let (second, milli) = match second_part.split_once('.') {
        Some((sec, frac)) => {
            let sec: i64 = sec.parse().ok()?;
            let mut frac_ms = 0i64;
            if !frac.is_empty() && frac.chars().all(|c| c.is_ascii_digit()) {
                // At most 3 digits are meaningful for milliseconds.
                let digits: String = frac.chars().take(3).collect();
                let value: i64 = digits.parse().ok()?;
                frac_ms = value * 10i64.pow(3 - digits.len() as u32);
            }
            (sec, frac_ms)
        }
        None => (second_part.parse().ok()?, 0i64),
    };

    let day_secs = days_from_civil(year, month, day) * 86_400
        + hour * 3_600
        + minute * 60
        + second;
    Some(day_secs * 1_000 + milli - offset_ms)
}

// ── civil-date math (Howard Hinnant's algorithms) ───────────────────────────

/// Days since 1970-01-01 for a proleptic Gregorian civil date.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = ((month + 9) % 12) as i64; // [0, 11], March = 0
    let doy = (153 * mp + 2) / 5 + day as i64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Inverse of [`days_from_civil`].
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn config_from(json: serde_json::Value) -> ChartRunConfig {
        chart_run_config_from_value(&json).expect("config")
    }

    // ── chart_event_from_line ───────────────────────────────────────────────

    #[test]
    fn parses_runtime_chart_event_line() {
        // Exactly what chart_runtime.R prints via jsonlite.
        let line = r#"{"timestamp":"2026-11-15T10:00:00.000+0800","stage":"render","level":"info","message":"render.running","progress":65,"detail":null}"#;
        let event = chart_event_from_line(line, 1_000, LogLevel::Info);
        assert_eq!(event.v, WIRE_VERSION);
        assert_eq!(event.stage, "render");
        assert_eq!(event.level, "info");
        assert_eq!(event.message, "render.running");
        assert_eq!(event.progress, Some(65.0));
        assert_eq!(event.detail, None);
        // 10:00 +0800 → 02:00 UTC
        assert_eq!(event.ts_ms, 1_794_708_000_000);
    }

    #[test]
    fn parses_save_event_with_detail() {
        let line = r#"{"timestamp":"2026-11-15T10:00:00.000Z","stage":"save","level":"success","message":"save.complete","progress":100,"detail":"D:/out/mynx-demo.png"}"#;
        let event = chart_event_from_line(line, 1_000, LogLevel::Info);
        assert_eq!(event.stage, "save");
        assert_eq!(event.level, "success");
        assert_eq!(event.progress, Some(100.0));
        assert_eq!(event.detail.as_deref(), Some("D:/out/mynx-demo.png"));
        assert_eq!(event.ts_ms, 1_794_736_800_000);
    }

    #[test]
    fn non_json_line_becomes_log_event_with_classified_level() {
        let event =
            chart_event_from_line("Loading required package: ggplot2", 7_000, LogLevel::Warning);
        assert_eq!(event.stage, "log");
        assert_eq!(event.level, "warning");
        assert_eq!(event.message, "Loading required package: ggplot2");
        assert_eq!(event.ts_ms, 7_000);
        assert_eq!(event.progress, None);
    }

    #[test]
    fn non_object_json_becomes_log_event() {
        let event = chart_event_from_line("42", 5_000, LogLevel::Error);
        assert_eq!(event.stage, "log");
        assert_eq!(event.level, "error");
        assert_eq!(event.message, "42");
    }

    #[test]
    fn json_without_stage_or_timestamp_uses_defaults() {
        let event = chart_event_from_line(r#"{"message":"自定义消息"}"#, 9_000, LogLevel::Info);
        assert_eq!(event.stage, "log");
        assert_eq!(event.message, "自定义消息");
        assert_eq!(event.ts_ms, 9_000);
    }

    #[test]
    fn unknown_r_level_passes_through_verbatim() {
        let line = r#"{"timestamp":"2026-11-15T10:00:00.000Z","stage":"data","level":"verbose","message":"x"}"#;
        let event = chart_event_from_line(line, 1_000, LogLevel::Info);
        assert_eq!(event.level, "verbose");
    }

    // ── timestamps ──────────────────────────────────────────────────────────

    #[test]
    fn iso_utc_now_matches_js_to_iso_string() {
        assert_eq!(iso_utc_now(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc_now(1_794_708_000_000), "2026-11-15T02:00:00.000Z");
        assert_eq!(iso_utc_now(1_582_977_600_000), "2020-02-29T12:00:00.000Z");
        assert_eq!(iso_utc_now(-1), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn parse_r_timestamp_handles_zones_and_fallbacks() {
        assert_eq!(parse_r_timestamp("2026-11-15T10:00:00.000+0800", -1), 1_794_708_000_000);
        assert_eq!(parse_r_timestamp("2026-11-15T10:00:00.000+08:00", -1), 1_794_708_000_000);
        assert_eq!(parse_r_timestamp("2026-11-15T02:00:00.000Z", -1), 1_794_708_000_000);
        assert_eq!(parse_r_timestamp("2020-02-29T20:00:00.000-0500", -1), 1_583_024_400_000);
        assert_eq!(parse_r_timestamp("1970-01-01T08:00:00.000+0800", -1), 0);
        assert_eq!(parse_r_timestamp("garbage", 42), 42);
        assert_eq!(parse_r_timestamp("2026-13-01T00:00:00.000Z", 42), 42);
        assert_eq!(parse_r_timestamp("2026-11-15 10:00:00", 42), 42);
    }

    #[test]
    fn iso_parse_round_trip() {
        for ms in [0i64, 86_400_000, 1_582_977_600_000, 1_794_708_000_000, 951_789_076_789] {
            let iso = iso_utc_now(ms);
            assert_eq!(parse_r_timestamp(&iso, i64::MIN), ms, "round trip {iso}");
        }
    }

    // ── output files ────────────────────────────────────────────────────────

    #[test]
    fn list_output_files_scans_template_prefix_and_skips_sidecars() {
        let dir = temp_dir("outputs");
        fs::write(dir.join("mynx-demo.png"), b"png").expect("file");
        fs::write(dir.join("mynx-demo.svg"), b"svg").expect("file");
        fs::write(dir.join("mynx-demo.png.json"), b"{}").expect("sidecar");
        fs::write(dir.join("mynx-other.png"), b"other").expect("other");
        fs::write(dir.join("notes.txt"), b"txt").expect("txt");
        fs::create_dir(dir.join("mynx-demo.dir")).expect("dir entry");

        let files = list_output_files(dir.to_str().expect("utf8"), "demo");
        let names: Vec<String> = files
            .iter()
            .map(|path| {
                PathBuf::from(path)
                    .file_name()
                    .expect("name")
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["mynx-demo.png", "mynx-demo.svg"]);

        assert!(list_output_files(dir.join("missing").to_str().expect("utf8"), "demo").is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    // ── sidecar ─────────────────────────────────────────────────────────────

    #[test]
    fn write_sidecar_matches_legacy_shape() {
        let dir = temp_dir("sidecar");
        let config = config_from(serde_json::json!({
            "filePath": "D:/data/counts.csv",
            "outputDir": dir.to_string_lossy(),
            "template": "demo",
            "kind": "line",
            "galleryUrl": "https://example.com/r/279",
            "sourceRepoPath": "279.Rmd",
            "x": "group",
            "y": "value",
            "title": "标题",
            "color": "#0A84FF",
            "format": "png",
            "width": 1600.0,
            "height": 900.0,
            "dpi": 300,
            "installMissing": true,
            "verified": true
        }));

        let sidecar_path =
            write_sidecar(&config, dir.to_str().expect("utf8"), "demo", "png", 1_794_708_000_000)
                .expect("sidecar written");
        assert_eq!(
            PathBuf::from(&sidecar_path).file_name().and_then(|n| n.to_str()),
            Some("mynx-demo.png.json")
        );
        assert!(PathBuf::from(&sidecar_path).is_file());

        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar_path).expect("read")).expect("json");
        assert_eq!(value["version"], 1);
        assert_eq!(value["createdAt"], "2026-11-15T02:00:00.000Z");
        let expected_output = output_file_path(dir.to_str().expect("utf8"), "demo", "png");
        assert_eq!(value["outputPath"], expected_output.as_str());
        assert_eq!(value["template"]["id"], "demo");
        assert_eq!(value["template"]["kind"], "line");
        assert_eq!(value["template"]["sourceUrl"], "https://example.com/r/279");
        assert_eq!(value["template"]["sourceRepoPath"], "279.Rmd");
        assert_eq!(value["output"]["format"], "png");
        assert_eq!(value["output"]["width"], 1600.0);
        assert_eq!(value["output"]["height"], 900.0);
        assert_eq!(value["output"]["dpi"], 300);
        // config round-trips in camelCase
        assert_eq!(value["config"]["filePath"], "D:/data/counts.csv");
        assert_eq!(value["config"]["installMissing"], true);
        assert_eq!(value["config"]["verified"], true);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_sidecar_omits_unset_optional_config_fields_and_keeps_explicit_nulls() {
        let dir = temp_dir("sidecar_nulls");
        let config = config_from(serde_json::json!({
            "filePath": "a.csv",
            "outputDir": dir.to_string_lossy(),
            "template": "demo",
            "kind": "bar",
            "x": "x",
            "y": "y",
            "title": "",
            "color": "#0A84FF",
            "format": "svg",
            "installMissing": false
        }));
        let sidecar_path =
            write_sidecar(&config, dir.to_str().expect("utf8"), "demo", "svg", 0)
                .expect("sidecar written");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar_path).expect("read")).expect("json");
        // unset optional fields dropped (JSON.stringify undefined parity)…
        assert!(value["config"].get("group").is_none());
        assert!(value["config"].get("width").is_none());
        // …while the legacy ?? null fields stay explicit
        assert_eq!(value["output"]["width"], serde_json::Value::Null);
        assert_eq!(value["output"]["dpi"], serde_json::Value::Null);
        assert_eq!(value["template"]["sourceUrl"], serde_json::Value::Null);
        assert_eq!(value["createdAt"], "1970-01-01T00:00:00.000Z");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn output_file_path_joins_with_platform_separator() {
        let path = output_file_path("D:\\out", "demo", "png");
        assert!(path.ends_with("mynx-demo.png"));
        assert!(path.contains("out"));
    }

    // ── chart_run_config_from_value ─────────────────────────────────────────

    #[test]
    fn config_from_value_reads_camel_case_wire_keys() {
        let config = config_from(serde_json::json!({
            "filePath": "D:/data/counts.csv",
            "outputDir": "D:/out",
            "template": "demo",
            "kind": "line",
            "galleryUrl": "https://example.com/r/279",
            "sourceRepoPath": "279.Rmd",
            "x": "group",
            "y": "value",
            "group": null,
            "title": "图",
            "color": "#0A84FF",
            "format": "png",
            "width": 1600.0,
            "height": 900.0,
            "dpi": 300,
            "ggTheme": "minimal",
            "showGrid": true,
            "installMissing": false,
            "verified": true,
            "heatmapScale": "row"
        }));
        assert_eq!(config.file_path, "D:/data/counts.csv");
        assert_eq!(config.output_dir, "D:/out");
        assert_eq!(config.template, "demo");
        assert_eq!(config.kind, "line");
        assert_eq!(config.gallery_url.as_deref(), Some("https://example.com/r/279"));
        assert_eq!(config.source_repo_path.as_deref(), Some("279.Rmd"));
        assert_eq!(config.x, "group");
        assert_eq!(config.y, "value");
        assert_eq!(config.group, None);
        assert_eq!(config.title, "图");
        assert_eq!(config.color, "#0A84FF");
        assert_eq!(config.format, "png");
        assert_eq!(config.width, Some(1600.0));
        assert_eq!(config.height, Some(900.0));
        assert_eq!(config.dpi, Some(300));
        assert_eq!(config.gg_theme.as_deref(), Some("minimal"));
        assert_eq!(config.show_grid, Some(true));
        assert!(!config.install_missing);
        assert_eq!(config.verified, Some(true));
        assert_eq!(config.heatmap_scale.as_deref(), Some("row"));
    }

    #[test]
    fn config_from_value_defaults_match_legacy_default_config() {
        // Legacy default: x/y fall back to group/value, color #0A84FF,
        // format png, installMissing true.
        let config = config_from(serde_json::json!({
            "filePath": "", "outputDir": "", "template": "", "kind": ""
        }));
        assert_eq!(config.x, "");
        assert_eq!(config.y, "");
        assert_eq!(config.title, "");
        assert_eq!(config.color, "");
        assert_eq!(config.format, "");
        assert!(config.install_missing);
        assert_eq!(config.verified, None);
        assert_eq!(config.gallery_url, None);
    }

    #[test]
    fn config_from_value_rejects_non_objects() {
        let error = chart_run_config_from_value(&serde_json::json!(42)).expect_err("must fail");
        assert!(error.message.contains("JSON 对象"), "{}", error.message);
    }

    #[test]
    fn config_serializes_back_to_camel_case_for_sidecar() {
        let config = config_from(serde_json::json!({
            "filePath": "a.csv", "outputDir": "o", "template": "t", "kind": "k",
            "x": "x", "y": "y", "title": "", "color": "#0A84FF", "format": "png",
            "installMissing": true, "verified": true
        }));
        let value = serde_json::to_value(&config).expect("serialize");
        assert_eq!(value["filePath"], "a.csv");
        assert_eq!(value["outputDir"], "o");
        assert_eq!(value["installMissing"], true);
        assert_eq!(value["verified"], true);
    }
}
