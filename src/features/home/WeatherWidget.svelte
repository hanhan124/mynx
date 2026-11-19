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
  import {
    conditionKey,
    loadWeatherSettings,
    refreshWeather,
    setWeatherEnabled,
    weather,
  } from "./weather.svelte.js";

  onMount(() => {
    void loadWeatherSettings();
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

<section class="mynx-card flex min-w-0 flex-wrap items-center gap-3 px-3 py-2.5" aria-label={t("home.weatherTitle")}>
  {#if !weather.enabled}
    <IconCloud size={19} stroke={1.7} class="shrink-0 text-text-secondary" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <p class="text-[12px] font-medium">{t("home.weatherTitle")}</p>
      <p class="text-[11px] text-text-secondary">{t("home.weatherOffHint")}</p>
    </div>
    <button type="button" class="mynx-btn min-h-9 px-3 text-[12px]" onclick={() => void setWeatherEnabled(true)}>
      {t("home.weatherEnable")}
    </button>
  {:else}
    {#if weather.current}
      {@const WeatherIcon = weatherIcon(weather.current.code)}
      <span aria-hidden="true">
        <WeatherIcon size={22} stroke={1.7} class="shrink-0 text-accent" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-baseline gap-x-2 text-[12px] font-medium">
          <span>{weather.city ? cityLabel(weather.city) : t("home.weatherTitle")}</span>
          <span class="text-[20px] leading-none tabular-nums">{Math.round(weather.current.temperature)}°C</span>
          <span class="text-[11px] font-normal text-text-secondary">{t(conditionKey(weather.current.code))}</span>
        </p>
        <p class="mt-1 text-[11px] text-text-secondary">
          {t("home.weatherDetails", {
            feelsLike: Math.round(weather.current.feelsLike),
            humidity: Math.round(weather.current.humidity),
            wind: Math.round(weather.current.windSpeed),
          })}
        </p>
      </div>
    {:else}
      <IconMapPin size={19} stroke={1.7} class="shrink-0 text-accent" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-[12px] font-medium">{t("home.weatherTitle")}</p>
        <p class="text-[11px] text-text-secondary">
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
      class="mynx-btn h-9 w-9 shrink-0 justify-center px-0"
      aria-label={t("home.weatherRefresh")}
      title={t("home.weatherRefresh")}
      disabled={weather.loading}
      onclick={() => void refreshWeather()}
    >
      <IconRefresh size={15} stroke={1.7} aria-hidden="true" />
    </button>

  {/if}

</section>
