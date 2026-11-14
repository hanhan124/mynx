//! Image → PNG batch conversion contracts. Shapes are byte-compatible with
//! the legacy `services/image_convert.rs` payloads so historical events keep
//! parsing: the event union is tagged by `kind` and every field name is
//! camelCase on the wire.

use crate::WIRE_VERSION;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "image/")]
#[serde(rename_all = "camelCase")]
pub struct WatermarkOptions {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(default)]
    pub font_size: u32,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub opacity: f64,
    #[serde(default)]
    pub position: String,
    #[serde(default)]
    pub background: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(default)]
    pub scale: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "image/")]
#[serde(rename_all = "camelCase")]
pub struct ConvertOptions {
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub optimize_level: u8,
    #[serde(default)]
    pub colors: u32,
    #[serde(default)]
    pub dither: bool,
    #[serde(default)]
    pub output_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watermark: Option<WatermarkOptions>,
}

/// Per-file / batch lifecycle events streamed over a Tauri `Channel`.
/// Discriminated by the `kind` tag; `rename_all_fields` keeps every member
/// camelCase (a serde field rename here silently drops fields on the JS side).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "image/")]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ConvertEvent {
    Started {
        total: u32,
    },
    Item {
        index: u32,
        total: u32,
        source: String,
        status: String,
        outputs: Vec<String>,
        error: Option<String>,
        #[ts(type = "number")]
        original_bytes: u64,
        #[ts(type = "number")]
        output_bytes: u64,
    },
    Finished {
        status: String,
        ok: u32,
        failed: u32,
        #[ts(type = "number")]
        total_input: u64,
        #[ts(type = "number")]
        total_output: u64,
        watermark_applied: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "image/")]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub v: u32,
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    #[ts(type = "number")]
    pub file_size: u64,
}

impl Thumbnail {
    pub fn new(data_url: String, width: u32, height: u32, file_size: u64) -> Self {
        Self { v: WIRE_VERSION, data_url, width, height, file_size }
    }
}
