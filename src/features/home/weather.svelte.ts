import type { WeatherCity } from "../../lib/contracts/generated/settings/WeatherCity.js";
import * as client from "../../app/tauri.js";
import { app, patchSettings } from "../../app/state.svelte";

interface IpLocation {
  success?: boolean;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  timezone?: { id?: string };
}

export interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  code: number;
}

interface WeatherState {
  enabled: boolean;
  city: WeatherCity | null;
  loading: boolean;
  current: CurrentWeather | null;
}

export const weather = $state<WeatherState>({
  enabled: false,
  city: null,
  loading: false,
  current: null,
});

let initialized = false;
let preferencesTouched = false;
let requestVersion = 0;
export async function loadWeatherSettings(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const settings = await client.settingsLoad();
    if (!preferencesTouched) {
      weather.enabled = settings.weatherConfigured ? settings.weatherEnabled : true;
    }
    if (weather.enabled) await locateCurrentWeather();
    if (!settings.weatherConfigured && !preferencesTouched) {
      await patchSettings({ weatherEnabled: true, weatherConfigured: true });
    }
  } catch {
    // Tauri is unavailable in a plain browser preview; default remains disabled.
  }
}

export async function setWeatherEnabled(enabled: boolean): Promise<void> {
  preferencesTouched = true;
  weather.enabled = enabled;
  weather.current = enabled ? weather.current : null;
  requestVersion += 1;
  await patchSettings({ weatherEnabled: enabled, weatherConfigured: true });
  if (enabled) await locateCurrentWeather();
}

export async function refreshWeather(): Promise<void> {
  await locateCurrentWeather();
}

export async function locateCurrentWeather(): Promise<void> {
  if (!weather.enabled) return;
  const version = ++requestVersion;
  weather.loading = true;
  weather.city = null;
  weather.current = null;
  try {
    const language = app.language === "zh" ? "zh-CN" : "en";
    const response = await fetch(`https://ipwho.is/?lang=${language}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`IP location request failed (${response.status})`);
    const location = (await response.json()) as IpLocation;
    if (version !== requestVersion || !weather.enabled) return;
    if (
      location.success !== true ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude)
    ) {
      throw new Error("IP location response did not include coordinates");
    }
    const locationCity = location.city?.trim();
    const region = location.region?.trim();
    const name = locationCity || region || location.country?.trim();
    if (!name) throw new Error("IP location response did not include a place name");
    const city: WeatherCity = {
      name,
      country: location.country?.trim() || "",
      admin1: locationCity ? region || null : null,
      latitude: location.latitude!,
      longitude: location.longitude!,
      timezone: location.timezone?.id || null,
    };
    weather.city = city;
    await fetchWeatherForCity(city, version);
  } catch {
    if (version === requestVersion) {
      weather.city = null;
      weather.current = null;
      weather.loading = false;
    }
  }
}

async function fetchWeatherForCity(city: WeatherCity, version: number): Promise<void> {
  if (!weather.enabled) return;
  weather.loading = true;
  try {
    const currentFields = "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m";
    const timezone = encodeURIComponent(city.timezone || "auto");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=${currentFields}&timezone=${timezone}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Weather request failed (${response.status})`);
    const payload = (await response.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        apparent_temperature?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
    };
    const current = payload.current;
    if (
      !current ||
      !Number.isFinite(current.temperature_2m) ||
      !Number.isFinite(current.weather_code)
    ) {
      throw new Error("Weather response did not include current conditions");
    }
    if (version !== requestVersion || !weather.enabled) return;
    weather.current = {
      temperature: current.temperature_2m!,
      feelsLike: Number.isFinite(current.apparent_temperature) ? current.apparent_temperature! : current.temperature_2m!,
      humidity: Number.isFinite(current.relative_humidity_2m) ? current.relative_humidity_2m! : 0,
      windSpeed: Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m! : 0,
      code: current.weather_code!,
    };
  } catch {
    if (version === requestVersion) {
      weather.city = null;
      weather.current = null;
    }
  } finally {
    if (version === requestVersion) weather.loading = false;
  }
}

export function conditionKey(code: number): string {
  if (code === 0) return "home.weatherClear";
  if (code <= 3) return "home.weatherCloudy";
  if (code === 45 || code === 48) return "home.weatherFog";
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return "home.weatherSnow";
  if (code >= 95) return "home.weatherStorm";
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return "home.weatherRain";
  return "home.weatherCloudy";
}

