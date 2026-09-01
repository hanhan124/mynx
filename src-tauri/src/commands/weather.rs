use crate::error::CommandError;
use crate::services::weather::{fetch_weather_by_ip, WeatherResult};

#[tauri::command]
pub(crate) async fn weather_by_ip() -> Result<WeatherResult, CommandError> {
    fetch_weather_by_ip().await
}
