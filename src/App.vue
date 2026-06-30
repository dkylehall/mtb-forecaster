<script setup>
import { ref, reactive, onMounted, onUnmounted, watch, computed } from "vue";
import Sortable from "sortablejs";
import AddArea from "./components/AddArea.vue";
import AreaCard from "./components/AreaCard.vue";
import MapPanel from "./components/MapPanel.vue";
import SettingsModal from "./components/SettingsModal.vue";
import AreaDetailModal from "./components/AreaDetailModal.vue";
import { fetchTrailWeather } from "./lib/weather.js";
import { computeConditions, GRADIENT_CSS } from "./lib/drying.js";
import { DEFAULT_IDEAL, TEMP_THRESHOLDS } from "./lib/temperature.js";
import {
  loadAreas,
  saveAreas,
  addArea,
  removeArea,
  findExisting,
  SEED_AREAS,
} from "./lib/areas.js";

const IDEAL_KEY = "trail_ideal_temp_v1";
const SETTINGS_KEY = "mtb_settings_v1";

const areas = ref([]);
// id -> { result, error, loading }
const conditions = reactive({});
const mapCenter = ref({ lat: 38.2, lon: -78.7 }); // search bias, follows the map
const boardEl = ref(null);
const showSettings = ref(false);

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
    red: { label: "No", hot: TEMP_THRESHOLDS.red.hot, cold: TEMP_THRESHOLDS.red.cold },
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
      return {
        lookbackDays: lb >= 3 && lb <= 7 ? lb : DEFAULT_SETTINGS.lookbackDays,
        temp: mergeTemp(v.temp),
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
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
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

// Legend rows, derived reactively from the current settings.
const degLabel = (hot, cold) => (hot === cold ? `±${hot}°` : `+${hot}°/−${cold}°`);
const ridingKey = computed(() => [
  { color: "var(--green)", label: settings.temp.green.label, note: "" },
  { color: "var(--yellow)", label: settings.temp.yellow.label, note: degLabel(settings.temp.yellow.hot, settings.temp.yellow.cold) },
  { color: "var(--orange)", label: settings.temp.orange.label, note: degLabel(settings.temp.orange.hot, settings.temp.orange.cold) },
  { color: "var(--red)", label: settings.temp.red.label, note: degLabel(settings.temp.red.hot, settings.temp.red.cold) },
]);
// Trail dryness is shown as a continuous drying-time gradient (dry → soaked).
const gradientCss = `linear-gradient(90deg, ${GRADIENT_CSS.join(", ")})`;

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

// Drag-to-reorder the cards (via the grip handle), persisting the new order.
let sortable = null;
watch(boardEl, (el) => {
  if (sortable) {
    sortable.destroy();
    sortable = null;
  }
  if (el) {
    sortable = Sortable.create(el, {
      // Whole card is draggable; clicks and the listed controls still work
      // (Sortable only reorders on an actual drag movement).
      draggable: ".area-card",
      filter: "button, select, input, a, .leaflet-container",
      preventOnFilter: false,
      animation: 160,
      disabled: sortBy.value !== "custom", // drag only in manual order
      onEnd: onDragEnd,
    });
  }
});

function onDragEnd(evt) {
  const { oldIndex, newIndex } = evt;
  if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
  const arr = areas.value.slice();
  const [moved] = arr.splice(oldIndex, 1);
  arr.splice(newIndex, 0, moved);
  areas.value = arr;
  persist();
}

// Sort control: drag order (manual), name, best conditions, or nearest.
const SORT_KEY = "mtb_sort";
const sortBy = ref(localStorage.getItem(SORT_KEY) || "custom");
watch(sortBy, (v, old) => {
  try {
    localStorage.setItem(SORT_KEY, v);
  } catch {
    /* ignore */
  }
  if (sortable) sortable.option("disabled", v !== "custom");
  // "Nearest" needs the user's location; request it (revert if denied).
  if (v === "nearest") {
    requestLocation(() => {
      sortBy.value = old && old !== "nearest" ? old : "custom";
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

const displayedAreas = computed(() => {
  const list = areas.value;
  if (sortBy.value === "name") {
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (sortBy.value === "conditions") {
    return [...list].sort((a, b) => {
      const ra = conditions[a.id] && conditions[a.id].result;
      const rb = conditions[b.id] && conditions[b.id].result;
      const ta = tempVarOf(ra);
      const tb = tempVarOf(rb);
      if (ta !== tb) return ta - tb; // closer to ideal temp first
      const ha = ra ? ra.hoursUntilDry : Infinity;
      const hb = rb ? rb.hoursUntilDry : Infinity;
      return ha - hb; // then drier first
    });
  }
  if (sortBy.value === "nearest") {
    const loc = userLoc.value;
    if (!loc) return list; // no fix yet — keep current order until it resolves
    return [...list].sort((a, b) => distanceMiles(loc, a) - distanceMiles(loc, b));
  }
  return list; // custom / drag order
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
  try {
    localStorage.setItem(IDEAL_KEY, JSON.stringify({ min: ideal.min, max: ideal.max }));
  } catch {
    /* ignore */
  }
  recomputeAll(); // temperature scoring only — no refetch needed
}

function persist() {
  saveAreas(areas.value);
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
    now: new Date(),
    drainage: area.drainage,
    idealTempMin: ideal.min,
    idealTempMax: ideal.max,
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
  conditions[area.id] = { result: prev.result || null, error: "", loading: true, wx: prev.wx || null };
  try {
    const wx = await fetchTrailWeather(area.lat, area.lon, {
      pastDays: settings.lookbackDays,
    });
    conditions[area.id] = { result: null, error: "", loading: false, wx };
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
  persist();
}

onMounted(() => {
  let saved = loadAreas();
  if (!saved.length) {
    // First run: seed with the example areas.
    saved = SEED_AREAS.reduce((acc, a) => addArea(acc, a), []);
    saveAreas(saved);
  }
  areas.value = saved;
  refreshAll();
  restartAutoRefresh();
  // If "nearest" was the last-used sort, the watcher won't fire on load, so
  // kick off the location request here (silently revert if it's denied).
  if (sortBy.value === "nearest") {
    requestLocation(() => {
      sortBy.value = "custom";
    });
  }
});

onUnmounted(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
});
</script>

<template>
  <div class="wrap">
    <header>
      <div class="title">
        <h1>🚵 Trail Conditions</h1>
        <p class="tag">Dry enough &amp; warm enough to ride? From recent &amp; forecast weather.</p>
      </div>
      <div class="controls">
        <button class="refresh" title="Refresh all" @click="refreshAll">↻</button>
        <button class="refresh" title="Settings" @click="showSettings = true">⚙</button>
      </div>
    </header>

    <div class="settings">
      <div class="setting">
        <label>Ideal riding temp</label>
        <input
          class="num"
          type="number"
          min="0"
          max="120"
          step="1"
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
          v-model.number="ideal.max"
          @change="onIdealChange"
        />
        <span class="val">°F</span>
      </div>

    </div>

    <div class="key">
      <div class="key-row">
        <span class="key-title">Riding conditions</span>
        <span v-for="t in ridingKey" :key="t.label" class="k">
          <i class="sw" :style="{ background: t.color }"></i>
          {{ t.label }} <small v-if="t.note">({{ t.note }})</small>
        </span>
      </div>
      <div class="key-row">
        <span class="key-title">Trail conditions</span>
        <span class="k">Dry</span>
        <span class="grad-bar" :style="{ background: gradientCss }"></span>
        <span class="k">Soaked</span>
      </div>
    </div>

    <div class="layout">
      <main class="left">
        <div class="board-head">
          <AddArea class="board-search" :bias="mapCenter" @add="onAdd" />
          <label v-if="areas.length" class="sort">
            Sort
            <select v-model="sortBy">
              <option value="custom">Drag order</option>
              <option value="name">Name A–Z</option>
              <option value="conditions">Best conditions</option>
              <option value="nearest">Nearest</option>
            </select>
          </label>
        </div>
        <div v-if="areas.length" ref="boardEl" class="board">
          <AreaCard
            v-for="area in displayedAreas"
            :key="area.id"
            :area="area"
            :result="conditions[area.id] ? conditions[area.id].result : null"
            :current="conditions[area.id] && conditions[area.id].wx ? conditions[area.id].wx.current : null"
            :error="conditions[area.id] ? conditions[area.id].error : ''"
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
  display: flex; align-items: center; gap: 22px; flex-wrap: wrap;
  margin-bottom: 16px; padding: 10px 14px;
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
}
.setting { display: flex; align-items: center; gap: 8px; }
.setting label {
  text-transform: uppercase; letter-spacing: 0.6px; font-size: 10.5px; color: var(--muted);
}
.setting input[type="range"] { width: 110px; accent-color: var(--accent); cursor: pointer; }
.setting input.num {
  width: 56px; padding: 5px 7px; font-size: 13px;
  font-variant-numeric: tabular-nums; text-align: center;
}
.setting .dash { color: var(--muted); }
.val { color: var(--text); font-variant-numeric: tabular-nums; font-size: 12.5px; }

.key {
  display: flex; flex-direction: column; gap: 6px;
  margin-bottom: 16px; padding: 10px 14px;
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
}
.key-row { display: flex; align-items: center; gap: 14px; flex-wrap: nowrap; }
.key-title {
  flex: 0 0 116px;
  text-transform: uppercase; letter-spacing: 0.6px; font-size: 10.5px;
  color: var(--muted); font-weight: 650;
}
.k { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; }
.k small { color: var(--muted); }
.sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: 0 0 auto; }
/* Trail dryness legend: a continuous green→red drying-time gradient. */
.grad-bar {
  flex: 1 1 auto; max-width: 360px; height: 10px; border-radius: 5px;
  border: 1px solid var(--line);
}

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

/* Narrow screens: let the legend rows wrap instead of crushing the swatches. */
@media (max-width: 560px) {
  .key-row { flex-wrap: wrap; gap: 6px 14px; }
  .key-title { flex-basis: 100%; }
  .grad-bar { max-width: none; }
}
</style>
