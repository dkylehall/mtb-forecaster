<script setup>
import { ref, reactive, onMounted, onUnmounted, watch, computed } from "vue";
import AddArea from "./components/AddArea.vue";
import AreaCard from "./components/AreaCard.vue";
import MapPanel from "./components/MapPanel.vue";
import SettingsModal from "./components/SettingsModal.vue";
import TempTiersModal from "./components/TempTiersModal.vue";
import AreaDetailModal from "./components/AreaDetailModal.vue";
import AuthControls from "./components/AuthControls.vue";
import { fetchTrailWeather, fetchAirQuality, aqiCategory, aqiColor } from "./lib/weather.js";
import { computeConditions } from "./lib/drying.js";
import { DEFAULT_IDEAL, TEMP_THRESHOLDS } from "./lib/temperature.js";
import { addArea, removeArea, findExisting } from "./lib/areas.js";
import { readLocal, writeAreas, pullAndMerge } from "./lib/store.js";
import { writePref, pullPrefs } from "./lib/prefs.js";
import { initAuth } from "./lib/auth.js";

const IDEAL_KEY = "trail_ideal_temp_v1";
const PRECIP_KEY = "mtb_precip_tol";
const AQI_KEY = "mtb_aqi_limit";
const BASIS_KEY = "mtb_basis";
const ENABLED_KEY = "mtb_params_enabled";
const AREA_HOURS_KEY = "mtb_area_hours";
const AREA_WET_KEY = "mtb_area_wet";
const SETTINGS_KEY = "mtb_settings_v1";

const areas = ref([]);
// id -> { result, error, loading }
const conditions = reactive({});
// Signed-in user's email, or null. Only ever set when sync is configured.
const userEmail = ref(null);
const mapCenter = ref({ lat: 38.2, lon: -78.7 }); // search bias, follows the map
const showSettings = ref(false);
const showTiers = ref(false); // the "Customize" tier editor

// Which area's detail modal is open (id, or null).
const detailId = ref(null);
const detailArea = computed(() => areas.value.find((a) => a.id === detailId.value) || null);
function openDetail(id) {
  detailId.value = id;
}

// Adjustable scoring settings (edited in the Settings modal). Defaults come from
// the engine constants so they stay in sync.
const DEFAULT_SETTINGS = {
  lookbackDays: 3,
  // Riding (temperature) tiers: editable labels; yellow/orange/red carry a
  // hot/cold degrees-outside-band value (green = the ideal band itself).
  temp: {
    green: { label: "Ideal" },
    yellow: { label: "Tolerable", hot: TEMP_THRESHOLDS.yellow.hot, cold: TEMP_THRESHOLDS.yellow.cold },
    orange: { label: "Uncomfortable", hot: TEMP_THRESHOLDS.orange.hot, cold: TEMP_THRESHOLDS.orange.cold },
    red: { label: "Unbearable", hot: TEMP_THRESHOLDS.red.hot, cold: TEMP_THRESHOLDS.red.cold },
  },
  maxWindows: 3,
  // Auto-refresh interval in minutes; 0 = off (refresh only on load / ↻ button).
  refreshMinutes: 30,
};

function numOr(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function mergeTemp(vt) {
  const d = DEFAULT_SETTINGS.temp;
  if (!vt || !vt.yellow) return JSON.parse(JSON.stringify(d)); // absent/old shape → defaults
  const tier = (k, withVals) => {
    const dv = d[k];
    const sv = vt[k] || {};
    const o = { label: typeof sv.label === "string" && sv.label ? sv.label : dv.label };
    if (withVals) {
      o.hot = numOr(sv.hot, dv.hot);
      o.cold = numOr(sv.cold, dv.cold);
    }
    return o;
  };
  return {
    green: tier("green", false),
    yellow: tier("yellow", true),
    orange: tier("orange", true),
    red: tier("red", true),
  };
}

function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (v && typeof v === "object") {
      const lb = parseInt(v.lookbackDays, 10);
      const mw = parseInt(v.maxWindows, 10);
      const rf = parseInt(v.refreshMinutes, 10);
      const temp = mergeTemp(v.temp);
      // Migrate the former default "No" label to the new "Unbearable" default
      // (leaves any custom label untouched).
      if (temp.red.label === "No") temp.red.label = DEFAULT_SETTINGS.temp.red.label;
      return {
        lookbackDays: lb >= 3 && lb <= 7 ? lb : DEFAULT_SETTINGS.lookbackDays,
        temp,
        maxWindows: mw >= 1 && mw <= 10 ? mw : DEFAULT_SETTINGS.maxWindows,
        refreshMinutes: rf >= 0 && rf <= 1440 ? rf : DEFAULT_SETTINGS.refreshMinutes,
      };
    }
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

const settings = reactive(loadSettings());

function persistSettings() {
  writePref(SETTINGS_KEY, JSON.stringify(settings));
}

function resetSettings() {
  const d = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.lookbackDays = d.lookbackDays;
  settings.maxWindows = d.maxWindows;
  settings.refreshMinutes = d.refreshMinutes;
  for (const k of ["green", "yellow", "orange", "red"]) Object.assign(settings.temp[k], d.temp[k]);
}

// Map settings → engine threshold shapes.
function tempThresholds() {
  return {
    yellow: { hot: settings.temp.yellow.hot, cold: settings.temp.yellow.cold },
    orange: { hot: settings.temp.orange.hot, cold: settings.temp.orange.cold },
  };
}
// Lowercased tier labels for the detail modal's sentence text.
const tempLabels = computed(() => ({
  green: settings.temp.green.label.toLowerCase(),
  yellow: settings.temp.yellow.label.toLowerCase(),
  orange: settings.temp.orange.label.toLowerCase(),
  red: settings.temp.red.label.toLowerCase(),
}));

// React to settings changes: lookback needs a refetch; temp/dry only recompute.
watch(() => settings.lookbackDays, () => {
  persistSettings();
  refreshAll();
});
watch(
  () => settings.temp,
  () => {
    persistSettings();
    recomputeAll();
  },
  { deep: true }
);
// maxWindows only affects display (the cards' summary computed reads it as a
// prop), so just persist — no refetch/recompute needed.
watch(() => settings.maxWindows, persistSettings);

// Auto-refresh: re-fetch every area on a timer. 0 = off. Restart the timer
// whenever the interval changes so a new value takes effect immediately.
let autoRefreshTimer = null;
function restartAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  const mins = settings.refreshMinutes;
  if (mins > 0) autoRefreshTimer = setInterval(refreshAll, mins * 60 * 1000);
}
watch(() => settings.refreshMinutes, () => {
  persistSettings();
  restartAutoRefresh();
});

// Sort control: name, best conditions, or nearest.
const SORT_KEY = "mtb_sort";
const VALID_SORTS = ["name", "conditions", "nearest"];
const storedSort = localStorage.getItem(SORT_KEY);
const sortBy = ref(VALID_SORTS.includes(storedSort) ? storedSort : "conditions");
watch(sortBy, (v, old) => {
  writePref(SORT_KEY, v);
  // "Nearest" needs the user's location; request it (revert if denied).
  if (v === "nearest") {
    requestLocation(() => {
      sortBy.value = old && old !== "nearest" ? old : "conditions";
      alert("Couldn't get your location. Allow location access to sort by distance.");
    });
  }
});

// User location for the "nearest" sort — requested lazily, not persisted.
const userLoc = ref(null);
const locating = ref(false);

function requestLocation(onFail) {
  if (userLoc.value || locating.value) return;
  if (!navigator.geolocation) {
    onFail && onFail();
    return;
  }
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLoc.value = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      locating.value = false;
    },
    () => {
      locating.value = false;
      onFail && onFail();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
}

// Great-circle distance in miles between two {lat, lon} points.
function distanceMiles(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Temperature distance from the ideal band (0 = inside). Used as the primary
// sort key for "best conditions", with hours-until-dry as the tiebreak.
function tempVarOf(r) {
  if (!r || r.tempNow == null) return Infinity;
  return Math.max(0, r.tempNow - ideal.max, ideal.min - r.tempNow);
}
// Does trail dryness count for this area? Off globally, or bypassed because the
// area rides fine wet, means a wet trail shouldn't drag its ranking down.
function dryCounts(area) {
  return enabledParams.dry && !areaWet[area.id];
}

const displayedAreas = computed(() => {
  const list = areas.value;
  if (sortBy.value === "name") {
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (sortBy.value === "conditions") {
    return [...list].sort((a, b) => {
      const ra = conditions[a.id] && conditions[a.id].result;
      const rb = conditions[b.id] && conditions[b.id].result;
      // Rank on the combined condition first: it already folds in every enabled
      // parameter — temperature, precip chance, AQI, dryness — including the
      // per-area "rides wet" bypass. Ranking on temperature alone (as this used
      // to) meant those parameters never moved anything.
      const sa = ra && ra.condition ? ra.condition.severity : Infinity;
      const sb = rb && rb.condition ? rb.condition.severity : Infinity;
      if (sa !== sb) return sa - sb;
      const ta = tempVarOf(ra);
      const tb = tempVarOf(rb);
      if (ta !== tb) return ta - tb; // then closer to the ideal temp
      // Then drier first — but only where dryness actually counts for that area.
      const ha = dryCounts(a) && ra ? ra.hoursUntilDry : 0;
      const hb = dryCounts(b) && rb ? rb.hoursUntilDry : 0;
      return ha - hb;
    });
  }
  if (sortBy.value === "nearest") {
    const loc = userLoc.value;
    if (!loc) return list; // no fix yet — keep current order until it resolves
    return [...list].sort((a, b) => distanceMiles(loc, a) - distanceMiles(loc, b));
  }
  return list; // insertion order (fallback)
});

// Ideal riding temperature band (°F).
const ideal = reactive(loadIdeal());

function loadIdeal() {
  try {
    const v = JSON.parse(localStorage.getItem(IDEAL_KEY));
    if (v && typeof v.min === "number" && typeof v.max === "number") return v;
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_IDEAL };
}

function onIdealChange() {
  // Keep min <= max.
  if (ideal.min > ideal.max) {
    [ideal.min, ideal.max] = [ideal.max, ideal.min];
  }
  writePref(IDEAL_KEY, JSON.stringify({ min: ideal.min, max: ideal.max }));
  recomputeAll(); // temperature scoring only — no refetch needed
}

// Precip-chance tolerance (%): hours whose forecast precip chance exceeds this
// are scored unfavorable. 100 = ignore precip chance entirely.
const precipTol = ref(loadPrecipTol());
function loadPrecipTol() {
  const v = parseInt(localStorage.getItem(PRECIP_KEY), 10);
  return v >= 0 && v <= 100 ? v : 50;
}
function onPrecipChange() {
  const v = Math.max(0, Math.min(100, Math.round(precipTol.value)));
  precipTol.value = v;
  writePref(PRECIP_KEY, String(v));
  recomputeAll(); // already-fetched precip-probability — no refetch needed
}

// Prediction basis: score ride windows by actual temp or "feels like".
const predictionBasis = ref(localStorage.getItem(BASIS_KEY) === "feels" ? "feels" : "temp");
function setBasis(b) {
  predictionBasis.value = b === "feels" ? "feels" : "temp";
  writePref(BASIS_KEY, predictionBasis.value);
  recomputeAll();
}

// Air-quality ceiling, on the US AQI scale the API reports (0–500).
const aqiLimit = ref(loadAqiLimit());
function loadAqiLimit() {
  const v = parseInt(localStorage.getItem(AQI_KEY), 10);
  return v >= 0 && v <= 500 ? v : 100;
}
function onAqiChange() {
  const v = Math.max(0, Math.min(500, Math.round(aqiLimit.value)));
  aqiLimit.value = v;
  writePref(AQI_KEY, String(v));
  recomputeAll();
}
const aqiLimitLabel = computed(() => aqiCategory(aqiLimit.value));

// Which parameters take part in scoring. Unchecking one drops it entirely.
const DEFAULT_ENABLED = { temp: true, precip: true, aqi: true, dry: true };
const enabledParams = reactive(loadEnabled());
function loadEnabled() {
  try {
    const v = JSON.parse(localStorage.getItem(ENABLED_KEY));
    if (v && typeof v === "object") {
      return {
        temp: v.temp !== false,
        precip: v.precip !== false,
        aqi: v.aqi !== false,
        dry: v.dry !== false,
      };
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_ENABLED };
}
function onEnabledChange() {
  writePref(ENABLED_KEY, JSON.stringify({ ...enabledParams }));
  recomputeAll();
}
const activeParamCount = computed(
  () => Object.values(enabledParams).filter(Boolean).length
);

// Per-area operating hours, {areaId: {open: "10:00", close: "18:00"}}. Kept in
// the synced prefs blob rather than on the area itself, so it needs no change
// to the remote areas table. An empty/absent entry means "use daylight".
const areaHours = reactive(loadAreaHours());
function loadAreaHours() {
  try {
    const v = JSON.parse(localStorage.getItem(AREA_HOURS_KEY));
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  return {};
}
function setAreaHours(id, hours) {
  if (hours && hours.open && hours.close) areaHours[id] = { ...hours };
  else delete areaHours[id];
  writePref(AREA_HOURS_KEY, JSON.stringify({ ...areaHours }));
}
// Areas that ride fine wet (rock, sand, hardpack). Trail dryness is skipped for
// these, but only for that area — the global parameter stays as it is.
const areaWet = reactive(loadAreaWet());
function loadAreaWet() {
  try {
    const v = JSON.parse(localStorage.getItem(AREA_WET_KEY));
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  return {};
}
function setAreaWet(id, on) {
  if (on) areaWet[id] = true;
  else delete areaWet[id];
  writePref(AREA_WET_KEY, JSON.stringify({ ...areaWet }));
  recomputeAll();
}

// Drop per-area entries whose area is gone — e.g. deleted on another device,
// then pulled down here. Guarded on a non-empty list so a not-yet-loaded board
// can't wipe entries wholesale.
function pruneAreaHours() {
  if (!areas.value.length) return;
  const live = new Set(areas.value.map((a) => a.id));
  const staleHours = Object.keys(areaHours).filter((id) => !live.has(id));
  if (staleHours.length) {
    for (const id of staleHours) delete areaHours[id];
    writePref(AREA_HOURS_KEY, JSON.stringify({ ...areaHours }));
  }
  const staleWet = Object.keys(areaWet).filter((id) => !live.has(id));
  if (staleWet.length) {
    for (const id of staleWet) delete areaWet[id];
    writePref(AREA_WET_KEY, JSON.stringify({ ...areaWet }));
  }
}

// Collapsed/expanded state of the parameters card. Device-local UI state, so
// it's plain localStorage rather than a synced preference — you might want it
// collapsed on a phone and open on a laptop.
const PARAMS_OPEN_KEY = "mtb_params_open";
const paramsOpen = ref(localStorage.getItem(PARAMS_OPEN_KEY) !== "0");
function toggleParams() {
  paramsOpen.value = !paramsOpen.value;
  try {
    localStorage.setItem(PARAMS_OPEN_KEY, paramsOpen.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Info popovers for the scoring controls.
const activeInfo = ref(null);
const INFO = {
  temp: "The air-temperature range you most enjoy riding in. Hours inside this band score as ideal; the further outside, the worse — with separate tolerances for hotter vs. colder.",
  precip:
    "The highest chance of precipitation you'll put up with. Any forecast hour whose rain/snow chance is above this is treated as unfavorable and dropped from your ride windows.",
  aqi:
    "The highest air-quality index you'll still ride in, on the US AQI scale (0–500) the air-quality API reports — set 160 and you'll ride at 160 or lower. Hours above it are treated as unfavorable. 50 = Good, 100 = Moderate, 150 = unhealthy for sensitive groups.",
  dry:
    "Whether trail wetness counts. Dryness is estimated from recent rain and the area's soil drainage — roughly a day of drying per inch of rain.",
  basis:
    "Whether ride windows are judged by the actual air temperature or the “feels like” temperature (which factors in humidity and wind). “Feels like” is usually stricter in humid heat.",
};
function toggleInfo(key) {
  activeInfo.value = activeInfo.value === key ? null : key;
}
function onDocClick(e) {
  if (!e.target.closest(".info, .info-pop")) activeInfo.value = null;
}

function persist() {
  writeAreas(areas.value);
}

// The air-quality API has its own (shorter) hourly series, so line it up with
// the weather timestamps; hours it doesn't cover stay null and simply don't
// constrain scoring.
function alignAqi(times, aq) {
  const t = aq?.hourly?.time;
  const v = aq?.hourly?.us_aqi;
  if (!t || !v) return null;
  const byTime = new Map();
  for (let i = 0; i < t.length; i++) byTime.set(t[i], v[i]);
  return times.map((iso) => (byTime.has(iso) ? byTime.get(iso) : null));
}

// Recompute conditions from already-fetched weather (e.g. ideal-temp changed).
function recompute(area) {
  const c = conditions[area.id];
  if (!c || !c.wx) return;
  c.result = computeConditions({
    times: c.wx.hourly.time,
    precip: c.wx.hourly.precipitation,
    temp: c.wx.hourly.temperature_2m,
    feels: c.wx.hourly.apparent_temperature,
    codes: c.wx.hourly.weather_code,
    precipProb: c.wx.hourly.precipitation_probability,
    rh: c.wx.hourly.relative_humidity_2m,
    aqi: alignAqi(c.wx.hourly.time, c.aq),
    now: new Date(),
    drainage: area.drainage,
    idealTempMin: ideal.min,
    idealTempMax: ideal.max,
    precipTolerance: precipTol.value,
    aqiLimit: aqiLimit.value,
    basis: predictionBasis.value,
    // "Rideable when wet" drops dryness for this area only.
    enabled: { ...enabledParams, dry: enabledParams.dry && !areaWet[area.id] },
    tempThresholds: tempThresholds(),
    daily: c.wx.daily,
  });
}

function recomputeAll() {
  areas.value.forEach(recompute);
}

const retryTimers = {}; // id -> timeout handle

function clearRetry(id) {
  if (retryTimers[id]) {
    clearTimeout(retryTimers[id]);
    delete retryTimers[id];
  }
}

async function refreshArea(area, attempt = 0) {
  clearRetry(area.id);
  const prev = conditions[area.id] || {};
  // Keep showing any prior data while (re)loading.
  conditions[area.id] = {
    result: prev.result || null, error: "", loading: true,
    wx: prev.wx || null, aq: prev.aq || null,
  };
  try {
    // Air quality is a separate endpoint and strictly optional — if it fails,
    // the card still loads and AQI simply doesn't constrain scoring.
    const [wx, aq] = await Promise.all([
      fetchTrailWeather(area.lat, area.lon, { pastDays: settings.lookbackDays }),
      fetchAirQuality(area.lat, area.lon, { pastDays: settings.lookbackDays }).catch(() => null),
    ]);
    conditions[area.id] = { result: null, error: "", loading: false, wx, aq };
    recompute(area); // fills .result using the current ideal band
  } catch (e) {
    // Don't retry an area that's since been removed.
    if (!areas.value.some((a) => a.id === area.id)) return;
    // Auto-retry with backoff until the card loads (cap ~30s).
    const delay = Math.min(30000, 2500 * Math.pow(1.6, attempt));
    conditions[area.id] = {
      result: prev.result || null,
      error: `${e.message || "Couldn't load weather"} — retrying…`,
      loading: false,
      wx: prev.wx || null,
      aq: prev.aq || null,
    };
    retryTimers[area.id] = setTimeout(() => refreshArea(area, attempt + 1), delay);
  }
}

function refreshAll() {
  areas.value.forEach((a) => refreshArea(a));
}

function onAdd(place) {
  // Already have this spot? Open its detail rather than silently doing nothing.
  const existing = findExisting(areas.value, place);
  if (existing) {
    openDetail(existing.id);
    return;
  }
  const next = addArea(areas.value, place);
  areas.value = next;
  persist();
  refreshArea(next[next.length - 1]);
}

function onRemove(id) {
  clearRetry(id);
  if (detailId.value === id) detailId.value = null;
  areas.value = removeArea(areas.value, id);
  delete conditions[id];
  // Drop this area's operating hours too. Area ids are derived from lat/lon, so
  // leaving them would silently resurrect old hours if the same spot is re-added.
  setAreaHours(id, null);
  setAreaWet(id, false);
  persist();
}

// Re-read preferences from localStorage into reactive state. Called after a
// sign-in pull writes the account's prefs locally, so a device picks up the
// settings saved elsewhere without a page reload. Reassigns each reactive holder
// through its own loader — the loaders are the single source of parsing truth.
function hydratePrefsFromLocal() {
  Object.assign(settings, loadSettings());
  Object.assign(ideal, loadIdeal());
  precipTol.value = loadPrecipTol();
  aqiLimit.value = loadAqiLimit();
  Object.assign(enabledParams, loadEnabled());
  for (const k of Object.keys(areaHours)) delete areaHours[k];
  Object.assign(areaHours, loadAreaHours());
  for (const k of Object.keys(areaWet)) delete areaWet[k];
  Object.assign(areaWet, loadAreaWet());
  predictionBasis.value = localStorage.getItem(BASIS_KEY) === "feels" ? "feels" : "temp";
  const s = localStorage.getItem(SORT_KEY);
  if (VALID_SORTS.includes(s)) sortBy.value = s;
  restartAutoRefresh();
  recomputeAll();
}

// Sign-in bootstrap. Inert unless Supabase env vars are set (see lib/auth.js):
// with none, this returns immediately and the app stays 100% local. With them,
// it pulls the account's areas + prefs on sign-in and re-hydrates reactive state.
async function onAuthSync() {
  const changed = await pullPrefs();
  if (changed && changed.length) hydratePrefsFromLocal();
  const merged = await pullAndMerge(areas.value);
  if (merged) {
    areas.value = merged;
    refreshAll();
  }
  pruneAreaHours();
}

onMounted(() => {
  // Local read only — instant, and correct for anonymous use. If a session
  // resolves later, onAuthSync() layers the account's data on top.
  areas.value = readLocal();
  pruneAreaHours();
  refreshAll();
  restartAutoRefresh();
  // If "nearest" was the last-used sort, the watcher won't fire on load, so
  // kick off the location request here (silently revert if it's denied).
  if (sortBy.value === "nearest") {
    requestLocation(() => {
      sortBy.value = "conditions";
    });
  }
  document.addEventListener("click", onDocClick);
  // Wire auth only if configured; no-op otherwise (keeps anonymous use pristine).
  initAuth({
    onSignedIn: onAuthSync,
    onChange: (session) => {
      userEmail.value = session?.user?.email || null;
    },
  });
});

onUnmounted(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  document.removeEventListener("click", onDocClick);
});
</script>

<template>
  <div class="wrap">
    <header>
      <div class="title">
        <h1>🚵 MTB Ride Forecaster</h1>
        <p class="tag">Find your ideal rides based on weather and trail conditions</p>
      </div>
      <div class="controls">
        <AuthControls :email="userEmail" />
        <button class="refresh" title="Refresh all" @click="refreshAll">↻</button>
        <button class="refresh" title="Settings" @click="showSettings = true">⚙</button>
      </div>
    </header>

    <div class="settings">
      <button class="s-head" :aria-expanded="paramsOpen" @click="toggleParams">
        <span class="s-chevron">{{ paramsOpen ? "▾" : "▸" }}</span>
        Forecast parameters
        <span v-if="!paramsOpen" class="s-summary">{{ activeParamCount }} of 4 on</span>
      </button>

      <div v-show="paramsOpen" class="s-body">
      <!-- Temperature -->
      <div class="setting" :class="{ off: !enabledParams.temp }">
        <label class="s-check">
          <input type="checkbox" v-model="enabledParams.temp" @change="onEnabledChange" />
          <span class="s-name">Ideal riding temp</span>
        </label>
        <button class="info" title="What is this?" @click.stop="toggleInfo('temp')">ⓘ</button>
        <div class="s-control">
          <input
            class="num"
            type="number"
            min="0"
            max="120"
            step="1"
            :disabled="!enabledParams.temp"
            v-model.number="ideal.min"
            @change="onIdealChange"
          />
          <span class="dash">–</span>
          <input
            class="num"
            type="number"
            min="0"
            max="120"
            step="1"
            :disabled="!enabledParams.temp"
            v-model.number="ideal.max"
            @change="onIdealChange"
          />
          <span class="val">°F</span>
          <button class="s-link" :disabled="!enabledParams.temp" @click="showTiers = true">Customize</button>
          <span class="seg s-basis">
            <button
              :class="{ on: predictionBasis === 'temp' }"
              :disabled="!enabledParams.temp"
              @click="setBasis('temp')"
            >Temp</button>
            <button
              :class="{ on: predictionBasis === 'feels' }"
              :disabled="!enabledParams.temp"
              @click="setBasis('feels')"
            >Feels like</button>
          </span>
          <button class="info" title="About prediction basis" @click.stop="toggleInfo('basis')">ⓘ</button>
        </div>
        <div v-if="activeInfo === 'temp'" class="info-pop">{{ INFO.temp }}</div>
        <div v-if="activeInfo === 'basis'" class="info-pop">{{ INFO.basis }}</div>
      </div>

      <!-- Precipitation chance -->
      <div class="setting" :class="{ off: !enabledParams.precip }">
        <label class="s-check">
          <input type="checkbox" v-model="enabledParams.precip" @change="onEnabledChange" />
          <span class="s-name">Precip % tolerance</span>
        </label>
        <button class="info" title="What is this?" @click.stop="toggleInfo('precip')">ⓘ</button>
        <div class="s-control">
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            :disabled="!enabledParams.precip"
            v-model.number="precipTol"
            @change="onPrecipChange"
          />
          <span class="val">{{ precipTol }}%</span>
        </div>
        <div v-if="activeInfo === 'precip'" class="info-pop">{{ INFO.precip }}</div>
      </div>

      <!-- Air quality -->
      <div class="setting" :class="{ off: !enabledParams.aqi }">
        <label class="s-check">
          <input type="checkbox" v-model="enabledParams.aqi" @change="onEnabledChange" />
          <span class="s-name">Air quality (max AQI)</span>
        </label>
        <button class="info" title="What is this?" @click.stop="toggleInfo('aqi')">ⓘ</button>
        <div class="s-control">
          <input
            type="range"
            min="0"
            max="500"
            step="10"
            :disabled="!enabledParams.aqi"
            v-model.number="aqiLimit"
            @change="onAqiChange"
          />
          <span class="val" :style="{ color: aqiColor(aqiLimit) }">≤ {{ aqiLimit }}<small class="aqi-cat"> · {{ aqiLimitLabel }}</small></span>
        </div>
        <div v-if="activeInfo === 'aqi'" class="info-pop">{{ INFO.aqi }}</div>
      </div>

      <!-- Trail dryness -->
      <div class="setting" :class="{ off: !enabledParams.dry }">
        <label class="s-check">
          <input type="checkbox" v-model="enabledParams.dry" @change="onEnabledChange" />
          <span class="s-name">Trail dryness</span>
        </label>
        <button class="info" title="What is this?" @click.stop="toggleInfo('dry')">ⓘ</button>
        <div class="s-control">
          <span class="val muted-note">Estimated from recent rain &amp; soil drainage</span>
        </div>
        <div v-if="activeInfo === 'dry'" class="info-pop">{{ INFO.dry }}</div>
      </div>
      </div>
    </div>

    <div class="layout">
      <main class="left">
        <div class="board-head">
          <AddArea class="board-search" :bias="mapCenter" @add="onAdd" />
          <label v-if="areas.length" class="sort">
            Sort
            <select v-model="sortBy">
              <option value="name">Name A–Z</option>
              <option value="conditions">Best conditions</option>
              <option value="nearest">Nearest</option>
            </select>
          </label>
        </div>
        <div v-if="areas.length" class="board">
          <AreaCard
            v-for="area in displayedAreas"
            :key="area.id"
            :area="area"
            :result="conditions[area.id] ? conditions[area.id].result : null"
            :current="conditions[area.id] && conditions[area.id].wx ? conditions[area.id].wx.current : null"
            :error="conditions[area.id] ? conditions[area.id].error : ''"
            :wet-ok="!!areaWet[area.id]"
            @remove="onRemove"
            @open="openDetail"
          />
        </div>
        <p v-else class="empty">
          No areas yet — search above to add your first riding spot.
        </p>
      </main>

      <aside class="right">
        <MapPanel
          :areas="areas"
          :conditions="conditions"
          @select="openDetail"
          @centerchange="mapCenter = $event"
        />
      </aside>
    </div>

    <footer>
      Conditions combine trail dryness (~24h drying per inch of rain, adjusted per-area
      for soil) and your ideal temperature band. Weather from Open-Meteo; places from
      OpenStreetMap. Estimates only — your local trail may vary.
    </footer>

    <TempTiersModal
      v-if="showTiers"
      :settings="settings"
      :ideal="ideal"
      @close="showTiers = false"
    />

    <SettingsModal
      v-if="showSettings"
      :settings="settings"
      :ideal="ideal"
      @reset="resetSettings"
      @close="showSettings = false"
    />

    <AreaDetailModal
      v-if="detailArea"
      :area="detailArea"
      :result="conditions[detailArea.id] ? conditions[detailArea.id].result : null"
      :current="conditions[detailArea.id] && conditions[detailArea.id].wx ? conditions[detailArea.id].wx.current : null"
      :error="conditions[detailArea.id] ? conditions[detailArea.id].error : ''"
      :max-windows="settings.maxWindows"
      :temp-labels="tempLabels"
      :hours="areaHours[detailArea.id] || null"
      :wet-ok="!!areaWet[detailArea.id]"
      @set-hours="setAreaHours(detailArea.id, $event)"
      @set-wet="setAreaWet(detailArea.id, $event)"
      @close="detailId = null"
    />
  </div>
</template>

<style scoped>
.wrap {
  max-width: 1500px;
  margin: 0 auto;
  padding: 20px clamp(14px, 3vw, 30px) 40px;
}
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
h1 { margin: 0; font-size: clamp(22px, 3vw, 30px); }
.tag { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.controls { display: flex; align-items: center; gap: 8px; }
.refresh { font-size: 16px; padding: 8px 12px; }

.settings {
  display: flex; flex-direction: column; gap: 2px;
  margin-bottom: 16px; padding: 12px 14px;
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
}
.s-head {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 0; border: none; background: transparent; cursor: pointer; text-align: left;
  text-transform: uppercase; letter-spacing: 0.7px; font-size: 10px;
  color: var(--muted); font-weight: 650;
}
.s-head:hover { color: var(--text); }
.s-chevron { font-size: 9px; line-height: 1; }
.s-summary {
  margin-left: auto; text-transform: none; letter-spacing: 0;
  font-size: 11px; font-weight: 500;
}
.s-body { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
/* One row per scoring parameter: [checkbox + name] [ⓘ] [control] */
.setting {
  display: flex; align-items: center; gap: 8px; position: relative;
  padding: 5px 0; flex-wrap: wrap;
}
.setting.off { opacity: 0.5; }
.s-check {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  flex: 0 0 190px; min-width: 0;
}
.s-check input[type="checkbox"] {
  width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; flex: 0 0 auto;
}
.s-name {
  text-transform: uppercase; letter-spacing: 0.6px; font-size: 10.5px; color: var(--muted);
  white-space: nowrap;
}
.s-control { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.s-basis { margin-left: 6px; }
.aqi-cat { color: var(--muted); font-weight: 400; }
.s-link {
  border: none; background: transparent; padding: 0 2px; cursor: pointer;
  color: var(--accent); font-size: 12px; text-decoration: underline;
}
.s-link:hover { color: var(--text); }
.s-link:disabled { color: var(--muted); text-decoration: none; cursor: default; }
.muted-note { color: var(--muted); font-size: 12px; }
.setting input:disabled, .setting button:disabled { opacity: 0.6; cursor: default; }
.info {
  flex: 0 0 auto; border: none; background: transparent; color: var(--muted);
  font-size: 13px; line-height: 1; padding: 0; cursor: pointer; margin-left: -4px;
}
.info:hover { color: var(--accent); }
.info-pop {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 50;
  width: 260px; padding: 9px 11px;
  background: var(--card-2); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: var(--shadow); color: var(--text);
  font-size: 12px; line-height: 1.45; text-transform: none; letter-spacing: 0;
}
.seg { display: inline-flex; }
.seg button {
  padding: 5px 11px; font-size: 12px; border-radius: 0;
  border: 1px solid var(--line); background: var(--card); color: var(--muted); cursor: pointer;
}
.seg button:first-child { border-radius: 8px 0 0 8px; }
.seg button:last-child { border-radius: 0 8px 8px 0; border-left: none; }
.seg button.on { color: var(--text); border-color: var(--accent); background: var(--card-2); }
.setting input[type="range"] { width: 110px; accent-color: var(--accent); cursor: pointer; }
.setting input.num {
  width: 56px; padding: 5px 7px; font-size: 13px;
  font-variant-numeric: tabular-nums; text-align: center;
}
.setting .dash { color: var(--muted); }
.val { color: var(--text); font-variant-numeric: tabular-nums; font-size: 12.5px; }

.layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  align-items: start;
}
/* Cards scroll in their own pane so the map + tools stay put. */
.left {
  position: sticky;
  top: 16px;
  align-self: start;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
}
.board-head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 12px; flex: 0 0 auto;
}
.board-search { flex: 1 1 auto; min-width: 0; }
.sort {
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted);
}
.sort select {
  background: var(--card); color: var(--text); border: 1px solid var(--line);
  border-radius: 8px; padding: 4px 8px; font-size: 12px; cursor: pointer;
  text-transform: none; letter-spacing: 0;
}
.board {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  min-height: 0;
  padding-right: 6px;
}
.empty { color: var(--muted); }

footer {
  margin-top: 24px; color: var(--muted); font-size: 11.5px; line-height: 1.5;
  max-width: 720px;
}

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .right { order: -1; } /* map on top when stacked */
  .left { position: static; max-height: none; }
  .board { overflow: visible; padding-right: 0; }
}

/* Narrow screens: let each parameter's control wrap under its name. */
@media (max-width: 560px) {
  .s-check { flex-basis: 100%; }
  .info-pop { width: min(260px, 78vw); }
}
</style>
