<script lang="ts">
  import { onMount } from "svelte";
  import type { IconComponent } from "../../lib/icons.js";
  import IconCloud from "@tabler/icons-svelte/icons/cloud";
  import IconMapPin from "@tabler/icons-svelte/icons/map-pin";
  import IconRefresh from "@tabler/icons-svelte/icons/refresh";
  import IconSnowflake from "@tabler/icons-svelte/icons/snowflake";
  import IconSun from "@tabler/icons-svelte/icons/sun";
  import IconCloudRain from "@tabler/icons-svelte/icons/cloud-rain";
  import IconCloudFog from "@tabler/icons-svelte/icons/cloud-fog";
  import { t } from "../../app/i18n.svelte";
  import { app } from "../../app/state.svelte";
  import {
    conditionKey,
    loadWeatherSettings,
    refreshWeather,
    setWeatherEnabled,
    weather,
  } from "./weather.svelte.js";

  let observedLanguage = app.language;

  onMount(() => {
    void loadWeatherSettings();
  });

  $effect(() => {
    const language = app.language;
    if (language === observedLanguage) return;
    observedLanguage = language;
    if (weather.enabled) void refreshWeather();
  });

  function cityLabel(city: { name: string; admin1?: string | null; country: string }): string {
    return [city.name, city.admin1, city.country].filter(Boolean).join(" · ");
  }

  function weatherIcon(code: number): IconComponent {
    if (code === 0) return IconSun;
    if (code === 45 || code === 48) return IconCloudFog;
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return IconSnowflake;
    if (code >= 51) return IconCloudRain;
    return IconCloud;
  }

</script>

<section class="flex min-w-0 items-center gap-2 text-text-secondary" aria-label={t("home.weatherTitle")}>
  {#if !weather.enabled}
    <IconCloud size={16} stroke={1.7} class="shrink-0" aria-hidden="true" />
    <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
      <p class="text-[11px] font-medium">{t("home.weatherTitle")}</p>
      <p class="text-[10px]">{t("home.weatherOffHint")}</p>
    </div>
    <button type="button" class="mynx-btn mynx-btn-ghost h-7 min-h-7 shrink-0 px-2 text-[11px]" onclick={() => void setWeatherEnabled(true)}>
      {t("home.weatherEnable")}
    </button>
  {:else}
    {#if weather.current}
      {@const WeatherIcon = weatherIcon(weather.current.code)}
      <span aria-hidden="true">
        <WeatherIcon size={16} stroke={1.7} class="shrink-0" />
      </span>
      <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-tight">
        <span
          class="mynx-truncate max-w-full text-[11px]"
          title={weather.city ? cityLabel(weather.city) : t("home.weatherTitle")}
        >{weather.city ? cityLabel(weather.city) : t("home.weatherTitle")}</span>
        <span class="text-[14px] font-semibold leading-none tabular-nums text-text">{Math.round(weather.current.temperature)}°C</span>
        <span class="text-[10px]">{t(conditionKey(weather.current.code))}</span>
        <span class="text-[10px]">
          {t("home.weatherDetails", {
            feelsLike: Math.round(weather.current.feelsLike),
            humidity: Math.round(weather.current.humidity),
            wind: Math.round(weather.current.windSpeed),
          })}
        </span>
      </div>
    {:else}
      <IconMapPin size={16} stroke={1.7} class="shrink-0" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <p class="text-[11px] font-medium">{t("home.weatherTitle")}</p>
        <p class="text-[10px]">
          {#if weather.loading}
            {t("home.weatherLoading")}
          {:else if weather.city}
            {cityLabel(weather.city)}
          {:else}
            {t("home.weatherAutoHint")}
          {/if}
        </p>
      </div>
    {/if}

    <button
      type="button"
      class="mynx-btn mynx-btn-ghost h-7 w-7 min-h-7 shrink-0 justify-center px-0 text-text-secondary"
      aria-label={t("home.weatherRefresh")}
      title={t("home.weatherRefresh")}
      disabled={weather.loading}
      onclick={() => void refreshWeather()}
    >
      <IconRefresh size={15} stroke={1.7} aria-hidden="true" />
    </button>

  {/if}

</section>
