//! Wire contracts shared by every Mynx service, command adapter and the
//! Svelte frontend. Rust types are the single source of truth: `ts-rs`
//! exports TypeScript bindings and `schemars` exports JSON Schemas from the
//! same definitions, so neither side ever hand-maintains a copy.
//!
//! Every task event, log line, error and persisted document carries a `v`
//! (version) field so history files stay forward-compatible.

#![recursion_limit = "512"]

pub mod charts;
pub mod image;
pub mod qpcr;
pub mod r;
pub mod rnaseq;
pub mod settings;
pub mod task;
pub mod weather;

/// Wire protocol version stamped into events, logs and persisted documents.
pub const WIRE_VERSION: u32 = 1;

/// JSON Schema for an arbitrary JSON value (used on `serde_json::Value`
/// fields — generating a recursive schema for `Value` overflows the stack).
pub fn json_any_schema(_generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    let value: serde_json::Value = serde_json::json!({
        "type": ["object", "array", "string", "number", "boolean", "null"]
    });
    serde_json::from_value(value).expect("valid schema")
}
