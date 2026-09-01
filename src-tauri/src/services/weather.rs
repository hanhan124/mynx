use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::CommandError;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WeatherResult {
    pub(crate) temperature: i32,
    pub(crate) weather_code: i32,
    pub(crate) humidity: i32,
    pub(crate) wind_speed: i32,
    pub(crate) city: String,
    pub(crate) is_day: bool,
}

pub(crate) async fn fetch_weather_by_ip() -> Result<WeatherResult, CommandError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mynx/2.2")
        .build()
        .map_err(|error| CommandError::Network(error.to_string()))?;
    let location: IpWhoLocation = client
        .get("https://ipwho.is/")
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| CommandError::Network(format!("Location service: {error}")))?
        .json()
        .await
        .map_err(|error| CommandError::Network(format!("Invalid location response: {error}")))?;
    if !location.success {
        return Err(CommandError::Network(
            "Location service returned no location".into(),
        ));
    }

    let latitude = location
        .latitude
        .ok_or_else(|| CommandError::Network("Missing latitude".into()))?;
    let longitude = location
        .longitude
        .ok_or_else(|| CommandError::Network("Missing longitude".into()))?;
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
        .map_err(|error| CommandError::Network(format!("Weather service: {error}")))?
        .json()
        .await
        .map_err(|error| CommandError::Network(format!("Invalid weather response: {error}")))?;
    let current = weather
        .current
        .ok_or_else(|| CommandError::Network("Weather data unavailable".into()))?;

    Ok(WeatherResult {
        temperature: current.temperature_2m.round() as i32,
        weather_code: current.weather_code,
        humidity: current.relative_humidity_2m.round() as i32,
        wind_speed: current.wind_speed_10m.round() as i32,
        city,
        is_day: current.is_day == 1,
    })
}
