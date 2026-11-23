//! Template manifest access: read one template's `manifest.json` and list the
//! installed templates under `<resource_dir>/r/chart-templates`.
//!
//! Unknown manifest keys are captured by the contract's `extra` flatten map
//! instead of failing the parse, so templates shipped with newer fields stay
//! readable.

use std::fs;
use std::path::{Path, PathBuf};

use mynx_contracts::charts::ChartTemplateManifest;
use mynx_contracts::task::MynxError;

/// Directory names rejected as template ids / install targets. Public so the
/// run command can refuse a crafted id before any path is built from it.
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && !id.starts_with('.')
        && !id.contains(['/', '\\', ':', '\0'])
        && !id.contains("..")
}

/// `<resource_dir>/r/chart-templates/<template_id>` after validating the id as
/// a single safe directory name (no separators, dots-walks or drive letters).
pub(crate) fn template_dir(resource_dir: &Path, template_id: &str) -> Result<PathBuf, MynxError> {
    if !is_safe_id(template_id) {
        return Err(MynxError::validation(format!(
            "模板标识不合法: {}",
            template_id
        )));
    }
    Ok(resource_dir
        .join("r")
        .join("chart-templates")
        .join(template_id))
}

/// Parse one template's manifest. Unknown fields are ignored (they land in the
/// contract's `extra` map).
pub fn read_manifest(template_id: &str, resource_dir: &Path) -> Result<ChartTemplateManifest, MynxError> {
    let dir = template_dir(resource_dir, template_id)?;
    let manifest_path = dir.join("manifest.json");
    let bytes = fs::read(&manifest_path).map_err(|_| {
        MynxError::not_found(format!("模板清单不存在: {}", manifest_path.to_string_lossy()))
    })?;
    serde_json::from_slice::<ChartTemplateManifest>(&bytes).map_err(|error| {
        MynxError::io(format!(
            "无法解析模板清单 {}: {}",
            manifest_path.to_string_lossy(),
            error
        ))
    })
}

/// Installed template ids (directory names under `r/chart-templates`),
/// sorted; an empty or missing directory yields an empty list.
pub fn list_templates(resource_dir: &Path) -> Vec<String> {
    let root = resource_dir.join("r").join("chart-templates");
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mynx_charts_{}_{nanos}", name));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    const MANIFEST_JSON: &str = r#"{
        "id": "line-basic-ggplot2",
        "name": "基础折线图",
        "family": "line",
        "status": "verified",
        "sourceUrl": "https://r-graph-gallery.com/279",
        "sourceRepoPath": "279-plotting-time-series.Rmd",
        "packages": ["ggplot2"],
        "outputs": ["png", "svg"],
        "dataRoles": [
            {"key": "x", "label": "横轴", "acceptedTypes": ["number", "date"], "required": true},
            {"key": "y", "label": "纵轴", "acceptedTypes": ["number"], "required": true, "description": "数值"}
        ],
        "referencePath": "reference.png",
        "description": "未知字段应被忽略而不导致解析失败"
    }"#;

    fn install_fixture(root: &Path, id: &str, manifest: &str) {
        let dir = root.join("r").join("chart-templates").join(id);
        fs::create_dir_all(&dir).expect("template dir");
        fs::write(dir.join("manifest.json"), manifest).expect("manifest");
    }

    #[test]
    fn read_manifest_parses_inline_fixture() {
        let root = temp_root("manifest");
        install_fixture(&root, "line-basic-ggplot2", MANIFEST_JSON);

        let manifest =
            read_manifest("line-basic-ggplot2", &root).expect("manifest");
        assert_eq!(manifest.id, "line-basic-ggplot2");
        assert_eq!(manifest.name, "基础折线图");
        assert_eq!(manifest.family, "line");
        assert_eq!(manifest.status, "verified");
        assert_eq!(manifest.packages, vec!["ggplot2"]);
        assert_eq!(manifest.outputs, vec!["png", "svg"]);
        assert_eq!(manifest.data_roles.len(), 2);
        assert_eq!(manifest.data_roles[0].key, "x");
        assert!(manifest.data_roles[0].required);
        assert_eq!(
            manifest.source_repo_path.as_deref(),
            Some("279-plotting-time-series.Rmd")
        );
        // unknown fields are captured, not rejected
        assert_eq!(
            manifest.extra.get("description").and_then(|v| v.as_str()),
            Some("未知字段应被忽略而不导致解析失败")
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_manifest_missing_file_errors() {
        let root = temp_root("manifest_missing");
        fs::create_dir_all(root.join("r").join("chart-templates")).expect("root");
        let error = read_manifest("nope", &root).expect_err("must fail");
        assert!(error.message.contains("模板清单不存在"), "{}", error.message);
    }

    #[test]
    fn template_id_rejects_path_tricks() {
        let root = temp_root("manifest_ids");
        for bad in [
            "../escape",
            "a/b",
            "a\\b",
            "C:evil",
            ".hidden",
            "",
            "..",
            "a..b",
        ] {
            assert!(
                read_manifest(bad, &root).is_err(),
                "id must be rejected: {bad}"
            );
        }
    }

    #[test]
    fn list_templates_sorts_directory_names() {
        let root = temp_root("list");
        install_fixture(&root, "bar-basic-ggplot2", MANIFEST_JSON);
        install_fixture(&root, "alluvial-basic", MANIFEST_JSON);
        install_fixture(&root, "line-basic-ggplot2", MANIFEST_JSON);
        // files under the root are not templates
        fs::create_dir_all(root.join("r").join("chart-templates")).expect("root");
        fs::write(
            root.join("r").join("chart-templates").join("notes.txt"),
            "not a template",
        )
        .expect("file");

        let names = list_templates(&root);
        assert_eq!(
            names,
            vec!["alluvial-basic", "bar-basic-ggplot2", "line-basic-ggplot2"]
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_templates_missing_dir_is_empty() {
        let root = temp_root("list_missing");
        assert!(list_templates(&root).is_empty());
    }
}
