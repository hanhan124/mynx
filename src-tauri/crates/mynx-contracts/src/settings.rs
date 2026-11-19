//! Settings contracts. Key names match the legacy `config.json` store so a
//! user's existing settings migrate losslessly into SQLite.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Theme identifiers. `graphite` is the dark surface, `pearl` the light one;
/// the legacy `dark`/`light` values normalize onto these.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema,
)]
#[ts(export, export_to = "settings/")]
#[serde(rename_all = "camelCase")]
pub enum ThemeId {
    System,
    Graphite,
    Pearl,
}

/// Full settings document persisted in SQLite (`settings` key-value table).
/// Existing keys remain compatible with legacy config, with new UI settings appended.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "settings/")]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsDoc {
    /// legacy key `theme`
    pub theme: ThemeId,
    /// legacy key `alwaysOnTop`
    pub always_on_top: bool,
    /// legacy key `chartColor` ("#RRGGBB[AA]")
    pub chart_color: String,
    /// legacy localStorage `mynx-language`
    pub language: String,
    /// legacy localStorage `mynx-search-engine`
    pub search_engine: String,
    /// legacy localStorage `mynx-home-header-height`
    pub home_header_height: u32,
    /// legacy key `imageConverterOptions` (opaque tool options blob)
    #[schemars(schema_with = "crate::json_any_schema")]
    pub image_converter_options: Option<serde_json::Value>,
    /// legacy key `chartStudioPresets`
    pub chart_studio_presets: Vec<ChartPreset>,
    /// Home-page weather is enabled by default and uses device geolocation after permission.
    pub weather_enabled: bool,
    /// True after the user has explicitly changed the enabled setting. Allows one-time migration
    /// from the previous disabled-by-default behavior without overriding later opt-outs.
    pub weather_configured: bool,
    /// Selected city or saved current-device coordinates used when weather is enabled.
    pub weather_city: Option<WeatherCity>,
}

/// A city explicitly selected by the user for the optional weather widget.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "settings/")]
#[serde(rename_all = "camelCase")]
pub struct WeatherCity {
    pub name: String,
    pub country: String,
    pub admin1: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "settings/")]
#[serde(rename_all = "camelCase")]
pub struct ChartPreset {
    pub id: String,
    pub name: String,
    #[schemars(schema_with = "crate::json_any_schema")]
    pub config: serde_json::Value,
    #[ts(type = "number")]
    pub updated_at: i64,
}

impl Default for SettingsDoc {
    fn default() -> Self {
        Self {
            theme: ThemeId::Pearl,
            always_on_top: false,
            chart_color: "#3C9FDF".into(),
            language: "zh".into(),
            search_engine: String::new(),
            home_header_height: 0,
            image_converter_options: None,
            chart_studio_presets: Vec::new(),
            weather_enabled: true,
            weather_configured: false,
            weather_city: None,
        }
    }
}

/// Request to migrate legacy settings (config.json store + localStorage
/// mirrors) into SQLite. `null` entries mean "not present, keep default".
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "settings/")]
#[serde(rename_all = "camelCase")]
pub struct LegacySettings {
    pub v: u32,
    pub theme: Option<String>,
    pub always_on_top: Option<bool>,
    pub chart_color: Option<String>,
    pub language: Option<String>,
    pub search_engine: Option<String>,
    pub home_header_height: Option<u32>,
    pub image_converter_options: Option<serde_json::Value>,
    pub chart_studio_presets: Option<serde_json::Value>,
}

/// Basic app info for the about dialog and update flows.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "settings/")]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub v: u32,
    pub version: String,
    pub exe_path: String,
    pub is_portable: bool,
}
