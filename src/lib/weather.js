// Open-Meteo data access (free, no API key).
//
// We request a single forecast call with `past_days` so one fetch gives us both
// recent rainfall (to compute how wet the trail already is) and the outlook (to
// see when it will dry / next get rained on).

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

/**
 * Search for a place by name (city-level). Returns up to `count` matches.
 * @returns {Promise<Array<{name,region,lat,lon}>>}
 */
export async function geocode(query, count = 6) {
  const url =
    `${GEOCODE_URL}?count=${count}&language=en&format=json&name=` +
    encodeURIComponent(query);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country_code].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/**
 * Fetch hourly precipitation (past + forecast) and daily sun times for a point.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {object} [opts]
 * @param {number} [opts.pastDays=3]      days of history (for current wetness)
 * @param {number} [opts.forecastDays=3]  days ahead (for drying / outlook)
 * @returns {Promise<{
 *   timezone: string,
 *   hourly: { time: string[], precipitation: number[], precipitation_probability: number[], weather_code: number[] },
 *   daily: { time: string[], sunrise: string[], sunset: string[] },
 *   current: object
 * }>}
 */
export async function fetchTrailWeather(lat, lon, opts = {}) {
  const { pastDays = 3, forecastDays = 7 } = opts;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation",
    hourly:
      "precipitation,precipitation_probability,weather_code,temperature_2m,apparent_temperature,relative_humidity_2m",
    daily:
      "sunrise,sunset,precipitation_sum,weather_code,temperature_2m_max,temperature_2m_min",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    wind_speed_unit: "mph",
    timezone: "auto",
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
  });
  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`Weather fetch failed (${res.status})`);
  return res.json();
}

/**
 * Hourly US AQI for a point, from Open-Meteo's separate air-quality API.
 * Its forecast horizon is shorter than the weather API's, so callers should
 * align by timestamp and tolerate missing hours.
 * @returns {Promise<{hourly: {time: string[], us_aqi: number[]}}>}
 */
export async function fetchAirQuality(lat, lon, opts = {}) {
  const { pastDays = 3, forecastDays = 7 } = opts;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "us_aqi",
    timezone: "auto",
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
  });
  const res = await fetch(`${AIR_QUALITY_URL}?${params}`);
  if (!res.ok) throw new Error(`Air-quality fetch failed (${res.status})`);
  return res.json();
}

// US AQI category for a value (matches the EPA breakpoints the API uses).
export function aqiCategory(v) {
  if (v == null) return "";
  if (v <= 50) return "Good";
  if (v <= 100) return "Moderate";
  if (v <= 150) return "Unhealthy for sensitive groups";
  if (v <= 200) return "Unhealthy";
  if (v <= 300) return "Very unhealthy";
  return "Hazardous";
}

// Colour for each of the six AQI levels. Concrete hex (not CSS vars) so the
// pink/purple steps — which have no tier variable — stay in one place.
export function aqiColor(v) {
  if (v == null) return "var(--muted)";
  if (v <= 50) return "#5be0a0"; // Good
  if (v <= 100) return "#ffe45c"; // Moderate
  if (v <= 150) return "#ffb454"; // Unhealthy for sensitive groups
  if (v <= 200) return "#ff8ac4"; // Unhealthy
  if (v <= 300) return "#ff6b6b"; // Very unhealthy
  return "#a06bff"; // Hazardous
}

// Minimal WMO weather-code → label/emoji map (shared look with the legacy app).
export const WMO = {
  0: ["Clear", "☀️"], 1: ["Mostly clear", "🌤️"], 2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"], 45: ["Fog", "🌫️"], 48: ["Rime fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌦️"],
  61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"],
  80: ["Showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Violent showers", "⛈️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"],
};

export function wmo(code) {
  return WMO[code] || ["—", "❓"];
}
