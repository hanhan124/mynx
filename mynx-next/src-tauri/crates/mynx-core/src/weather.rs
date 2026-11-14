//! Home-page weather lookup (`weather_by_ip`): IP geolocation via ipwho.is,
//! then current conditions from Open-Meteo. Port of the legacy desktop shell
//! service (`src-tauri/src/services/weather.rs`) — same endpoints, timeouts,
//! user agent and city formatting.

use std::time::Duration;

use mynx_contracts::task::MynxError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct IpWhoLocation {
    success: bool,
    latitude: Option<f64>,
    longitude: Option<f64>,
    city: Option<String>,
    region: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoResponse {
    current: Option<OpenMeteoCurrent>,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoCurrent {
    temperature_2m: f64,
    relative_humidity_2m: f64,
    weather_code: i32,
    wind_speed_10m: f64,
    is_day: i32,
}

/// Payload consumed by the home weather widget (`WeatherInfo`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherResult {
    pub temperature: i32,
    pub weather_code: i32,
    pub humidity: i32,
    pub wind_speed: i32,
    pub city: String,
    pub is_day: bool,
}

fn network(message: impl Into<String>) -> MynxError {
    MynxError::internal(message.into())
}

pub async fn fetch_weather_by_ip() -> Result<WeatherResult, MynxError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mynx/2.2")
        .build()
        .map_err(|error| network(error.to_string()))?;
    let location: IpWhoLocation = client
        .get("https://ipwho.is/")
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| network(format!("Location service: {error}")))?
        .json()
        .await
        .map_err(|error| network(format!("Invalid location response: {error}")))?;
    if !location.success {
        return Err(network("Location service returned no location"));
    }

    let latitude = location
        .latitude
        .ok_or_else(|| network("Missing latitude"))?;
    let longitude = location
        .longitude
        .ok_or_else(|| network("Missing longitude"))?;
    let city = match (location.city, location.region) {
        (Some(city), Some(region)) if city != region => format!("{city} · {region}"),
        (Some(city), _) => city,
        (_, Some(region)) => region,
        _ => "当前位置".into(),
    };
    let weather_url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day&timezone=auto"
    );
    let weather: OpenMeteoResponse = client
        .get(weather_url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| network(format!("Weather service: {error}")))?
        .json()
        .await
        .map_err(|error| network(format!("Invalid weather response: {error}")))?;
    let current = weather
        .current
        .ok_or_else(|| network("Weather data unavailable"))?;

    Ok(WeatherResult {
        temperature: current.temperature_2m.round() as i32,
        weather_code: current.weather_code,
        humidity: current.relative_humidity_2m.round() as i32,
        wind_speed: current.wind_speed_10m.round() as i32,
        city,
        is_day: current.is_day == 1,
    })
}
