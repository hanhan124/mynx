//! JSON Schema export for core wire contracts. QpcrPlotRunConfig is
//! excluded: schemars 1.0 recurses without bound for that type (root cause
//! not isolated); the TypeScript binding remains authoritative there.

use mynx_contracts::charts::ChartRunEvent;
use mynx_contracts::image::ConvertEvent;
use mynx_contracts::rnaseq::RnaSeqConfig;
use mynx_contracts::settings::SettingsDoc;
use mynx_contracts::task::{LogLine, MynxError, TaskRecord};
use std::fs;
use std::path::Path;

fn out_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../contracts")
}

fn schema_value<T: schemars::JsonSchema>() -> serde_json::Value {
    serde_json::to_value(schemars::schema_for!(T)).expect("schema serializes")
}

fn write_doc(name: &str, title: &str, entries: Vec<(&str, serde_json::Value)>) {
    let mut map = serde_json::Map::new();
    map.insert(
        "$schema".to_string(),
        serde_json::Value::String("http://json-schema.org/draft/2020-12/schema".into()),
    );
    map.insert("title".to_string(), serde_json::Value::String(title.into()));
    for (key, schema) in entries {
        map.insert(key.to_string(), schema);
    }
    let doc = serde_json::Value::Object(map);
    let pretty = serde_json::to_string_pretty(&doc).expect("pretty print");
    fs::write(out_dir().join(name), pretty).expect("write schema file");
}

#[test]
fn export_json_schemas() {
    // schemars recurses deeply; a big-stack worker keeps the export stable.
    let handle = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(|| {
            fs::create_dir_all(out_dir()).expect("create contracts dir");
            write_doc(
                "task-event.schema.json",
                "Mynx task events",
                vec![
                    ("taskRecord", schema_value::<TaskRecord>()),
                    ("logLine", schema_value::<LogLine>()),
                    ("convertEvent", schema_value::<ConvertEvent>()),
                    ("chartRunEvent", schema_value::<ChartRunEvent>()),
                ],
            );
            write_doc(
                "error.schema.json",
                "Mynx command errors",
                vec![("mynxError", schema_value::<MynxError>())],
            );
            write_doc(
                "project.schema.json",
                "Mynx project documents",
                vec![
                    ("rnaseqConfig", schema_value::<RnaSeqConfig>()),
                    ("settingsDoc", schema_value::<SettingsDoc>()),
                ],
            );
            write_doc(
                "result.schema.json",
                "Mynx results",
                vec![("logLine", schema_value::<LogLine>())],
            );
        })
        .expect("spawn worker")
        .join();
    assert!(handle.is_ok(), "schema export panicked");
}
