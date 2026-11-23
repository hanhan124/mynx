//! Figure ZIP packages: export a result figure (plus template resources,
//! README and sidecar JSON) into one archive, and install template packages
//! downloaded from elsewhere.
//!
//! Ports of the legacy ChartStudioPage flows:
//! - `exportResultPackage` + `downloadTemplate` (JSZip → `zip` crate) for
//!   [`export_zip`],
//! - the template package import for [`install_template_package`], hardened
//!   against zip-slip (absolute paths, drive prefixes and `..` walks are
//!   rejected before anything is extracted).

use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use mynx_contracts::charts::{ChartTemplateManifest, ChartZipRequest};
use mynx_contracts::task::MynxError;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::manifest;

/// Template package limits: a template is a manifest, an R script and a few
/// assets, so anything far beyond this is a broken or hostile archive.
const MAX_PACKAGE_ENTRIES: usize = 2_000;
const MAX_PACKAGE_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_PACKAGE_TOTAL_BYTES: u64 = 200 * 1024 * 1024;

/// Template resources copied under `template/` (legacy exportResultPackage).
const TEMPLATE_PACKAGE_FILES: [&str; 3] = ["manifest.json", "render.R", "README.zh-CN.md"];

// ── entry-name safety ───────────────────────────────────────────────────────

/// Reject zip entry names that could escape the extraction directory:
/// absolute paths, Windows drive prefixes / NUL bytes, and `.` or `..`
/// path components (on both `/` and `\` separators).
fn entry_name_is_safe(name: &str) -> bool {
    if name.is_empty() || name.contains('\0') || name.contains(':') {
        return false;
    }
    if name.starts_with('/') || name.starts_with('\\') {
        return false;
    }
    name.split(['/', '\\'])
        .all(|part| part != ".." && part != ".")
}

/// Last path segment (mirrors the legacy `path.split(/[\\/]/).pop()`).
fn base_name(path: &str) -> &str {
    let norm = path.trim_end_matches(['\\', '/']);
    match norm.rfind(['\\', '/']) {
        Some(idx) => &norm[idx + 1..],
        None => norm,
    }
}

// ── export ──────────────────────────────────────────────────────────────────

/// Build the figure package ZIP at `request.zip_path`:
///   - `output_file` stored under its own file name,
///   - `template_id` → `<resource_dir>/r/chart-templates/<id>/{manifest.json,
///     render.R, README.zh-CN.md}` stored under `template/` (missing files
///     skipped, like the legacy optional-metadata loop),
///   - `readme` → `README.txt`,
///   - `sidecar_json` → `mynx-<template>.json` (`mynx-chart.json` when the
///     template id is absent), pretty-printed.
///
/// Returns `Ok(true)` on success; an empty request (no entries at all) is a
/// validation error.
pub fn export_zip(request: ChartZipRequest, resource_dir: &Path) -> Result<bool, MynxError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut entries = 0usize;

    let add = |writer: &mut ZipWriter<Cursor<Vec<u8>>>, name: &str, bytes: &[u8]| {
        writer
            .start_file(name, options)
            .map_err(|error| MynxError::io(format!("无法写入压缩包条目 {name}: {error}")))?;
        writer
            .write_all(bytes)
            .map_err(|error| MynxError::io(format!("无法写入压缩包条目 {name}: {error}")))
    };

    if let Some(output_file) = &request.output_file {
        let bytes = fs::read(output_file).map_err(|error| {
            MynxError::io(format!("无法读取结果文件 {}: {}", output_file, error))
        })?;
        let name = base_name(output_file);
        let name = if name.is_empty() { "mynx-result" } else { name };
        add(&mut writer, name, &bytes)?;
        entries += 1;
    }

    if let Some(template_id) = &request.template_id {
        let dir = manifest::template_dir(resource_dir, template_id)?;
        for file in TEMPLATE_PACKAGE_FILES {
            // Template metadata files are optional — skip unreadable ones
            // (legacy try/catch around readTextFile).
            if let Ok(bytes) = fs::read(dir.join(file)) {
                add(&mut writer, &format!("template/{file}"), &bytes)?;
                entries += 1;
            }
        }
    }

    if let Some(readme) = &request.readme {
        add(&mut writer, "README.txt", readme.as_bytes())?;
        entries += 1;
    }

    if let Some(sidecar) = &request.sidecar_json {
        let name = match &request.template_id {
            Some(template_id) => format!("mynx-{template_id}.json"),
            None => "mynx-chart.json".to_string(),
        };
        let bytes = serde_json::to_vec_pretty(sidecar)
            .map_err(|error| MynxError::internal(format!("无法序列化 sidecar JSON: {error}")))?;
        add(&mut writer, &name, &bytes)?;
        entries += 1;
    }

    if entries == 0 {
        return Err(MynxError::validation(
            "结果包内容为空,请先指定输出文件、模板或说明文字",
        ));
    }

    let bytes = writer
        .finish()
        .map_err(|error| MynxError::io(format!("无法生成压缩包: {error}")))?
        .into_inner();
    fs::write(&request.zip_path, bytes).map_err(|error| {
        MynxError::io(format!("无法写入压缩包 {}: {}", request.zip_path, error))
    })?;
    Ok(true)
}

// ── install ─────────────────────────────────────────────────────────────────

/// Install a template package ZIP into `<install_dir>/<manifest.id>/`.
///
/// Safety: every entry name is validated before extraction (see
/// [`entry_name_is_safe`]); the archive is unpacked into a fresh temp
/// directory, `manifest.json` is located at the root or one level deep, and
/// only then are the files copied into place (replacing any previous version
/// of the same template id).
pub fn install_template_package(
    zip_path: &str,
    install_dir: &Path,
) -> Result<ChartTemplateManifest, MynxError> {
    let file = fs::File::open(zip_path)
        .map_err(|error| MynxError::io(format!("无法打开模板压缩包 {}: {}", zip_path, error)))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| MynxError::io(format!("无法解析模板压缩包 {}: {}", zip_path, error)))?;

    // Pass 1: reject unsafe names and oversized archives before extracting
    // anything (declared sizes; pass 2 re-checks the real byte counts).
    if archive.len() > MAX_PACKAGE_ENTRIES {
        return Err(MynxError::validation(format!(
            "模板压缩包文件过多（{} 个，上限 {MAX_PACKAGE_ENTRIES} 个）",
            archive.len()
        )));
    }
    let mut total_bytes: u64 = 0;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| MynxError::io(format!("无法读取压缩包条目: {error}")))?;
        let name = entry.name().to_string();
        if !entry_name_is_safe(&name) {
            return Err(MynxError::validation(format!(
                "压缩包包含不安全的路径: {name}"
            )));
        }
        if entry.size() > MAX_PACKAGE_FILE_BYTES {
            return Err(MynxError::validation(format!(
                "模板压缩包中的文件过大: {name}"
            )));
        }
        total_bytes = total_bytes.saturating_add(entry.size());
        if total_bytes > MAX_PACKAGE_TOTAL_BYTES {
            return Err(MynxError::validation("模板压缩包解压后超过 200 MB，已拒绝安装"));
        }
    }

    // Pass 2: extract into a fresh temp directory.
    let staging = temp_staging_dir();
    fs::create_dir_all(&staging)
        .map_err(|error| MynxError::io(format!("无法创建临时目录: {error}")))?;
    let extract_result = extract_archive(&mut archive, &staging);
    if let Err(error) = extract_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    // Locate manifest.json at the root or one level deep.
    let manifest = match locate_manifest_dir(&staging) {
        Some(source_base) => install_from_dir(&source_base, install_dir),
        None => Err(MynxError::validation("压缩包中未找到 manifest.json")),
    };
    let _ = fs::remove_dir_all(&staging);
    manifest
}

fn extract_archive<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    staging: &Path,
) -> Result<(), MynxError> {
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| MynxError::io(format!("无法读取压缩包条目: {error}")))?;
        let name = entry.name().to_string();
        let target = staging.join(name.replace('\\', "/"));
        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|error| MynxError::io(format!("无法创建目录 {}: {error}", target.to_string_lossy())))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                MynxError::io(format!("无法创建目录 {}: {error}", parent.to_string_lossy()))
            })?;
        }
        // Never trust the declared size: cap the real read as well.
        let mut bytes = Vec::new();
        (&mut entry)
            .take(MAX_PACKAGE_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| MynxError::io(format!("无法解压压缩包条目 {name}: {error}")))?;
        if bytes.len() as u64 > MAX_PACKAGE_FILE_BYTES {
            return Err(MynxError::validation(format!("模板压缩包中的文件过大: {name}")));
        }
        fs::write(&target, bytes).map_err(|error| {
            MynxError::io(format!("无法写入文件 {}: {error}", target.to_string_lossy()))
        })?;
    }
    Ok(())
}

/// `manifest.json` in the staging root, else in exactly one nested directory
/// (the common "everything wrapped in a folder" layout).
fn locate_manifest_dir(staging: &Path) -> Option<PathBuf> {
    if staging.join("manifest.json").is_file() {
        return Some(staging.to_path_buf());
    }
    let mut dirs: Vec<PathBuf> = fs::read_dir(staging)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join("manifest.json").is_file())
        .collect();
    dirs.sort();
    dirs.into_iter().next()
}

fn install_from_dir(source_base: &Path, install_dir: &Path) -> Result<ChartTemplateManifest, MynxError> {
    let manifest_path = source_base.join("manifest.json");
    let bytes = fs::read(&manifest_path).map_err(|error| {
        MynxError::io(format!("无法读取模板清单: {error}"))
    })?;
    let manifest: ChartTemplateManifest = serde_json::from_slice(&bytes).map_err(|error| {
        MynxError::io(format!(
            "无法解析模板清单 {}: {}",
            manifest_path.to_string_lossy(),
            error
        ))
    })?;
    if !manifest::is_safe_id(&manifest.id) {
        return Err(MynxError::validation(format!(
            "模板清单缺少有效的 id: {}",
            manifest.id
        )));
    }

    let target = install_dir.join(&manifest.id);
    // Upgrades replace the previous version of the same template id.
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|error| MynxError::io(format!("无法移除旧模板目录: {error}")))?;
    }
    copy_dir_recursive(source_base, &target)?;
    Ok(manifest)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), MynxError> {
    fs::create_dir_all(dst)
        .map_err(|error| MynxError::io(format!("无法创建目录 {}: {error}", dst.to_string_lossy())))?;
    for entry in fs::read_dir(src)
        .map_err(|error| MynxError::io(format!("无法读取目录 {}: {error}", src.to_string_lossy())))?
        .flatten()
    {
        let target = dst.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| MynxError::io(format!("无法读取文件类型: {error}")))?;
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target).map_err(|error| {
                MynxError::io(format!(
                    "无法复制文件 {}: {error}",
                    entry.path().to_string_lossy()
                ))
            })?;
        }
    }
    Ok(())
}

/// Fresh staging directory (`%TEMP%/mynx_chart_tpl_<nanos>`).
fn temp_staging_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("mynx_chart_tpl_{nanos}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mynx_charts_{}_{nanos}", name));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    const MANIFEST_JSON: &str = r#"{
        "id": "tpl-demo",
        "name": "演示模板",
        "family": "demo",
        "status": "verified",
        "packages": ["ggplot2"],
        "outputs": ["png"]
    }"#;

    /// Build a ZIP from (name, bytes) pairs.
    fn build_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).expect("zip file");
        let mut writer = ZipWriter::new(file);
        for (name, bytes) in entries {
            writer
                .start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
                )
                .expect("start file");
            writer.write_all(bytes).expect("write entry");
        }
        writer.finish().expect("finish zip");
    }

    fn read_zip_names(path: &Path) -> Vec<String> {
        let file = fs::File::open(path).expect("open zip");
        let mut archive = ZipArchive::new(file).expect("read zip");
        let mut names: Vec<String> = (0..archive.len())
            .map(|index| archive.by_index(index).expect("entry").name().to_string())
            .collect();
        names.sort();
        names
    }

    fn read_zip_entry(path: &Path, name: &str) -> Vec<u8> {
        let file = fs::File::open(path).expect("open zip");
        let mut archive = ZipArchive::new(file).expect("read zip");
        let mut entry = archive.by_name(name).expect("entry exists");
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).expect("read entry");
        bytes
    }

    // ── export_zip ──────────────────────────────────────────────────────────

    #[test]
    fn export_zip_contains_output_template_readme_and_sidecar() {
        let dir = temp_dir("export");
        // output figure + template resources on disk
        let output = dir.join("mynx-tpl-demo.png");
        fs::write(&output, b"PNGBYTES").expect("output");
        let tpl = dir.join("r").join("chart-templates").join("tpl-demo");
        fs::create_dir_all(&tpl).expect("tpl dir");
        fs::write(tpl.join("manifest.json"), MANIFEST_JSON).expect("manifest");
        fs::write(tpl.join("render.R"), "RSCRIPT").expect("render");
        // README.zh-CN.md intentionally absent → skipped like the legacy loop

        let zip_path = dir.join("package.zip");
        export_zip(
            ChartZipRequest {
                v: 1,
                zip_path: zip_path.to_string_lossy().into_owned(),
                output_file: Some(output.to_string_lossy().into_owned()),
                template_id: Some("tpl-demo".to_string()),
                readme: Some("Mynx 科研绘图结果包\n".to_string()),
                sidecar_json: Some(serde_json::json!({"template": "tpl-demo", "dpi": 300})),
            },
            &dir,
        )
        .expect("export");

        let names = read_zip_names(&zip_path);
        assert_eq!(
            names,
            vec![
                "README.txt",
                "mynx-tpl-demo.json",
                "mynx-tpl-demo.png",
                "template/manifest.json",
                "template/render.R",
            ]
        );
        assert_eq!(read_zip_entry(&zip_path, "mynx-tpl-demo.png"), b"PNGBYTES");
        assert_eq!(read_zip_entry(&zip_path, "template/manifest.json"), MANIFEST_JSON.as_bytes());
        assert_eq!(read_zip_entry(&zip_path, "README.txt"), "Mynx 科研绘图结果包\n".as_bytes());
        let sidecar: serde_json::Value =
            serde_json::from_slice(&read_zip_entry(&zip_path, "mynx-tpl-demo.json")).expect("json");
        assert_eq!(sidecar["template"], "tpl-demo");
        assert_eq!(sidecar["dpi"], 300);
        let _ = names.len();
    }

    #[test]
    fn export_zip_without_template_names_sidecar_fallback() {
        let dir = temp_dir("export_fallback");
        let zip_path = dir.join("package.zip");
        export_zip(
            ChartZipRequest {
                v: 1,
                zip_path: zip_path.to_string_lossy().into_owned(),
                output_file: None,
                template_id: None,
                readme: None,
                sidecar_json: Some(serde_json::json!({"ok": true})),
            },
            &dir,
        )
        .expect("export");
        let names = read_zip_names(&zip_path);
        assert_eq!(names, vec!["mynx-chart.json"]);
    }

    #[test]
    fn export_zip_output_stored_under_its_file_name() {
        let dir = temp_dir("export_name");
        let output = dir.join("nested");
        fs::create_dir_all(&output).expect("nested");
        let figure = output.join("my chart.svg");
        fs::write(&figure, b"<svg/>").expect("svg");

        let zip_path = dir.join("package.zip");
        export_zip(
            ChartZipRequest {
                v: 1,
                zip_path: zip_path.to_string_lossy().into_owned(),
                output_file: Some(figure.to_string_lossy().into_owned()),
                template_id: None,
                readme: None,
                sidecar_json: None,
            },
            &dir,
        )
        .expect("export");
        assert_eq!(read_zip_names(&zip_path), vec!["my chart.svg"]);
    }

    #[test]
    fn export_zip_empty_request_errors() {
        let dir = temp_dir("export_empty");
        let zip_path = dir.join("package.zip");
        let error = export_zip(
            ChartZipRequest {
                v: 1,
                zip_path: zip_path.to_string_lossy().into_owned(),
                output_file: None,
                template_id: None,
                readme: None,
                sidecar_json: None,
            },
            &dir,
        )
        .expect_err("must fail");
        assert!(error.message.contains("结果包内容为空"), "{}", error.message);
        assert!(!zip_path.exists(), "no zip written for an empty request");
    }

    #[test]
    fn export_zip_missing_output_file_errors() {
        let dir = temp_dir("export_missing");
        let error = export_zip(
            ChartZipRequest {
                v: 1,
                zip_path: dir.join("package.zip").to_string_lossy().into_owned(),
                output_file: Some(dir.join("nope.png").to_string_lossy().into_owned()),
                template_id: None,
                readme: None,
                sidecar_json: None,
            },
            &dir,
        )
        .expect_err("must fail");
        assert!(error.message.contains("无法读取结果文件"), "{}", error.message);
    }

    #[test]
    fn export_zip_rejects_unsafe_template_id() {
        let dir = temp_dir("export_badid");
        let error = export_zip(
            ChartZipRequest {
                v: 1,
                zip_path: dir.join("package.zip").to_string_lossy().into_owned(),
                output_file: None,
                template_id: Some("../escape".to_string()),
                readme: None,
                sidecar_json: None,
            },
            &dir,
        )
        .expect_err("must fail");
        assert!(error.message.contains("模板标识不合法"), "{}", error.message);
    }

    // ── install_template_package ────────────────────────────────────────────

    #[test]
    fn install_round_trip_manifest_and_files() {
        let dir = temp_dir("install");
        let zip_path = dir.join("tpl.zip");
        build_zip(
            &zip_path,
            &[
                ("manifest.json", MANIFEST_JSON.as_bytes()),
                ("render.R", b"RSCRIPT\n".as_slice()),
                ("README.zh-CN.md", "# 模板说明\n".as_bytes()),
            ],
        );

        let install_dir = dir.join("templates");
        let manifest = install_template_package(
            zip_path.to_str().expect("utf8"),
            &install_dir,
        )
        .expect("install");
        assert_eq!(manifest.id, "tpl-demo");
        assert_eq!(manifest.name, "演示模板");
        assert_eq!(manifest.outputs, vec!["png"]);

        let target = install_dir.join("tpl-demo");
        assert_eq!(
            fs::read_to_string(target.join("manifest.json")).expect("manifest"),
            MANIFEST_JSON
        );
        assert_eq!(
            fs::read_to_string(target.join("render.R")).expect("render"),
            "RSCRIPT\n"
        );
        assert_eq!(
            fs::read_to_string(target.join("README.zh-CN.md")).expect("readme"),
            "# 模板说明\n"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_accepts_one_level_deep_layout() {
        let dir = temp_dir("install_nested");
        let zip_path = dir.join("tpl.zip");
        build_zip(
            &zip_path,
            &[
                ("tpl-demo/manifest.json", MANIFEST_JSON.as_bytes()),
                ("tpl-demo/render.R", b"RSCRIPT\n".as_slice()),
            ],
        );
        let install_dir = dir.join("templates");
        let manifest = install_template_package(
            zip_path.to_str().expect("utf8"),
            &install_dir,
        )
        .expect("install");
        assert_eq!(manifest.id, "tpl-demo");
        assert!(install_dir.join("tpl-demo").join("render.R").is_file());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_replaces_previous_version() {
        let dir = temp_dir("install_upgrade");
        let zip_path = dir.join("tpl.zip");
        build_zip(&zip_path, &[("manifest.json", MANIFEST_JSON.as_bytes())]);
        let install_dir = dir.join("templates");
        install_template_package(zip_path.to_str().expect("utf8"), &install_dir)
            .expect("first install");

        let updated = MANIFEST_JSON.replace("\"outputs\": [\"png\"]", "\"outputs\": [\"png\", \"svg\"]");
        build_zip(
            &zip_path,
            &[
                ("manifest.json", updated.as_bytes()),
                ("defaults.json", b"{}\n".as_slice()),
            ],
        );
        let manifest = install_template_package(zip_path.to_str().expect("utf8"), &install_dir)
            .expect("second install");
        assert_eq!(manifest.outputs, vec!["png", "svg"]);
        let target = install_dir.join("tpl-demo");
        assert!(target.join("defaults.json").is_file());
        assert!(!target.join("render.R").is_file(), "old files replaced");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_rejects_zip_slip_entries() {
        let dir = temp_dir("install_slip");
        let zip_path = dir.join("evil.zip");
        let escape_target = dir.join("escaped.txt");
        let _ = fs::remove_file(&escape_target);
        build_zip(
            &zip_path,
            &[
                ("manifest.json", MANIFEST_JSON.as_bytes()),
                ("../escaped.txt", b"evil".as_slice()),
            ],
        );
        let install_dir = dir.join("templates");
        let error = install_template_package(zip_path.to_str().expect("utf8"), &install_dir)
            .expect_err("must fail");
        assert!(error.message.contains("不安全的路径"), "{}", error.message);
        assert!(!escape_target.exists(), "nothing may escape the staging dir");
        assert!(!install_dir.join("tpl-demo").exists(), "no partial install");
    }

    #[test]
    fn install_rejects_absolute_entry_names() {
        let dir = temp_dir("install_abs");
        let zip_path = dir.join("evil.zip");
        build_zip(
            &zip_path,
            &[
                ("manifest.json", MANIFEST_JSON.as_bytes()),
                ("/abs/evil.txt", b"evil".as_slice()),
            ],
        );
        let error =
            install_template_package(zip_path.to_str().expect("utf8"), &dir.join("templates"))
                .expect_err("must fail");
        assert!(error.message.contains("不安全的路径"), "{}", error.message);
    }

    #[test]
    fn install_rejects_drive_prefix_entry_names() {
        let dir = temp_dir("install_drive");
        let zip_path = dir.join("evil.zip");
        build_zip(
            &zip_path,
            &[("C:evil.txt", b"evil".as_slice()), ("manifest.json", MANIFEST_JSON.as_bytes())],
        );
        let error =
            install_template_package(zip_path.to_str().expect("utf8"), &dir.join("templates"))
                .expect_err("must fail");
        assert!(error.message.contains("不安全的路径"), "{}", error.message);
    }

    #[test]
    fn install_without_manifest_errors() {
        let dir = temp_dir("install_nomanifest");
        let zip_path = dir.join("plain.zip");
        build_zip(&zip_path, &[("readme.txt", b"no manifest here".as_slice())]);
        let error =
            install_template_package(zip_path.to_str().expect("utf8"), &dir.join("templates"))
                .expect_err("must fail");
        assert!(error.message.contains("未找到 manifest.json"), "{}", error.message);
    }

    #[test]
    fn install_rejects_invalid_manifest_id() {
        let dir = temp_dir("install_badid");
        let zip_path = dir.join("tpl.zip");
        let bad = MANIFEST_JSON.replace("\"id\": \"tpl-demo\"", "\"id\": \"../evil\"");
        build_zip(&zip_path, &[("manifest.json", bad.as_bytes())]);
        let error =
            install_template_package(zip_path.to_str().expect("utf8"), &dir.join("templates"))
                .expect_err("must fail");
        assert!(error.message.contains("缺少有效的 id"), "{}", error.message);
        assert!(!dir.join("templates").join("evil").exists());
    }

    #[test]
    fn install_missing_zip_errors() {
        let dir = temp_dir("install_missingzip");
        let error = install_template_package(
            dir.join("nope.zip").to_str().expect("utf8"),
            &dir.join("templates"),
        )
        .expect_err("must fail");
        assert!(error.message.contains("无法打开模板压缩包"), "{}", error.message);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    #[test]
    fn entry_name_safety_table() {
        assert!(entry_name_is_safe("manifest.json"));
        assert!(entry_name_is_safe("dir/render.R"));
        assert!(entry_name_is_safe("dir/")); // zip directory entries
        assert!(!entry_name_is_safe(""));
        assert!(!entry_name_is_safe("/abs/evil"));
        assert!(!entry_name_is_safe("\\abs\\evil"));
        assert!(!entry_name_is_safe("../evil"));
        assert!(!entry_name_is_safe("dir/../../evil"));
        assert!(!entry_name_is_safe("./evil"));
        assert!(!entry_name_is_safe("C:evil"));
        assert!(!entry_name_is_safe("bad\0name"));
    }

    #[test]
    fn base_name_matches_legacy_split() {
        assert_eq!(base_name("D:/out/mynx-demo.png"), "mynx-demo.png");
        assert_eq!(base_name("D:\\out\\mynx-demo.png"), "mynx-demo.png");
        assert_eq!(base_name("figure.png"), "figure.png");
        assert_eq!(base_name("dir/"), "dir");
        assert_eq!(base_name("/"), "");
    }
}
