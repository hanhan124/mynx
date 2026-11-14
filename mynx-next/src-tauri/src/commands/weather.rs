//! Weather command for the home page widget.

use mynx_contracts::weather::WeatherInfo;
use mynx_contracts::WIRE_VERSION;
use mynx_contracts::task::MynxError;
use serde::Deserialize;

#[derive(Deserialize)]
struct IpWhoLocation {
    city: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[derive(Deserialize)]
struct OpenMeteoCurrent {
    temperature_2m: Option<f64>,
    relative_humidity_2m: Option<f64>,
    weather_code: Option<i64>,
    wind_speed_10m: Option<f64>,
    is_day: Option<i64>,
}

#[derive(Deserialize)]
struct OpenMeteoResponse {
    current: Option<OpenMeteoCurrent>,
}

/// Fetch current weather by IP geolocation (ipwho.is + open-meteo).
#[tauri::command]
pub async fn weather_by_ip() -> Result<WeatherInfo, MynxError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mynx/3.0")
        .build()
        .map_err(|e| MynxError::internal(e.to_string()))?;

    let location: IpWhoLocation = client
        .get("https://ipwho.is/")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| MynxError::internal(format!("location: {e}")))?
        .json()
        .await
        .map_err(|e| MynxError::internal(format!("location parse: {e}")))?;

    let lat = location.latitude.unwrap_or_default();
    let lon = location.longitude.unwrap_or_default();
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day&timezone=auto"
    );
    let forecast: OpenMeteoResponse = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| MynxError::internal(format!("forecast: {e}")))?
        .json()
        .await
        .map_err(|e| MynxError::internal(format!("forecast parse: {e}")))?;

    let current = forecast.current.unwrap_or(OpenMeteoCurrent {
        temperature_2m: None,
        relative_humidity_2m: None,
        weather_code: None,
        wind_speed_10m: None,
        is_day: None,
    });
    Ok(WeatherInfo {
        v: WIRE_VERSION,
        temperature: current.temperature_2m.unwrap_or_default().round() as i32,
        weather_code: current.weather_code.unwrap_or_default() as i32,
        humidity: current.relative_humidity_2m.unwrap_or_default().round() as i32,
        wind_speed: current.wind_speed_10m.unwrap_or_default().round() as i32,
        city: location.city.unwrap_or_default(),
        is_day: current.is_day.unwrap_or(1) != 0,
    })
}
