import { describe, expect, it } from "vitest";
import { conditionKey } from "./weather.svelte.js";

describe("weather condition labels", () => {
  it.each([
    [0, "home.weatherClear"],
    [3, "home.weatherCloudy"],
    [45, "home.weatherFog"],
    [61, "home.weatherRain"],
    [73, "home.weatherSnow"],
    [95, "home.weatherStorm"],
  ])("maps WMO code %i to %s", (code, key) => {
    expect(conditionKey(code)).toBe(key);
  });
});
