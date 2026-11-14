//! Home-page weather widget contract.

use crate::WIRE_VERSION;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "weather/")]
#[serde(rename_all = "camelCase")]
pub struct WeatherInfo {
    pub v: u32,
    pub temperature: i32,
    pub weather_code: i32,
    pub humidity: i32,
    pub wind_speed: i32,
    pub city: String,
    pub is_day: bool,
}
