<script setup>
import { ref, reactive, onMounted, watch, computed, nextTick } from "vue";
import Sortable from "sortablejs";
import AddArea from "./components/AddArea.vue";
import AreaCard from "./components/AreaCard.vue";
import MapPanel from "./components/MapPanel.vue";
import SettingsModal from "./components/SettingsModal.vue";
import { fetchTrailWeather } from "./lib/weather.js";
import { computeConditions, DEFAULT_DRY_CUTOFFS } from "./lib/drying.js";
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
const COLLAPSED_KEY = "mtb_collapsed_v1";

const areas = ref([]);
// id -> { result, error, loading }
const conditions = reactive({});
const selectedId = ref(null);

// Per-area collapsed state (id -> bool), persisted.
const collapsed = reactive(loadCollapsed());
function loadCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function persistCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  } catch {
    /* ignore */
  }
}
function toggleCollapse(id) {
  collapsed[id] = !collapsed[id];
  persistCollapsed();
}
function collapseAll() {
  areas.value.forEach((a) => (collapsed[a.id] = true));
  persistCollapsed();
}
function expandAll() {
  areas.value.forEach((a) => (collapsed[a.id] = false));
  persistCollapsed();
}
const mapCenter = ref({ lat: 38.2, lon: -78.7 }); // search bias, follows the map
const boardEl = ref(null);
const showSettings = ref(false);

// Adjustable scoring settings (edited in the Settings modal). Defaults come from
// the engine constants so they stay in sync.
const DEFAULT_SETTINGS = {
  lookbackDays: 3,
  temp: {
    fairHot: TEMP_THRESHOLDS.yellow.hot,
    fairCold: TEMP_THRESHOLDS.yellow.cold,
    marginalHot: TEMP_THRESHOLDS.orange.hot,
    marginalCold: TEMP_THRESHOLDS.orange.cold,
  },
  dry: { drying: DEFAULT_DRY_CUTOFFS.drying, wet: DEFAULT_DRY_CUTOFFS.wet },
};

function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (v && typeof v === "object") {
      const lb = parseInt(v.lookbackDays, 10);
      return {
        lookbackDays: lb >= 3 && lb <= 7 ? lb : DEFAULT_SETTINGS.lookbackDays,
        temp: { ...DEFAULT_SETTINGS.temp, ...(v.temp || {}) },
        dry: { ...DEFAULT_SETTINGS.dry, ...(v.dry || {}) },
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
  Object.assign(settings.temp, d.temp);
  Object.assign(settings.dry, d.dry);
}

// Map settings → engine threshold shapes.
function tempThresholds() {
  return {
    yellow: { hot: settings.temp.fairHot, cold: settings.temp.fairCold },
    orange: { hot: settings.temp.marginalHot, cold: settings.temp.marginalCold },
  };
}
function dryCutoffs() {
  return { drying: settings.dry.drying, wet: settings.dry.wet };
}

// Legend rows, derived reactively from the current settings.
const degLabel = (hot, cold) => (hot === cold ? `±${hot}°` : `+${hot}°/−${cold}°`);
const ridingKey = computed(() => [
  { color: "var(--green)", label: "Ideal", note: "" },
  { color: "var(--yellow)", label: "Fair", note: degLabel(settings.temp.fairHot, settings.temp.fairCold) },
  { color: "var(--orange)", label: "Marginal", note: degLabel(settings.temp.marginalHot, settings.temp.marginalCold) },
  { color: "var(--red)", label: "No", note: `beyond ${degLabel(settings.temp.marginalHot, settings.temp.marginalCold)}` },
]);
const trailKey = computed(() => [
  { color: "var(--green)", label: "Dry", note: "rideable" },
  { color: "var(--yellow)", label: "Drying", note: `≤${settings.dry.drying}h to dry` },
  { color: "var(--orange)", label: "Very wet", note: `${settings.dry.drying}–${settings.dry.wet}h to dry` },
  { color: "var(--red)", label: "Soaked", note: `>${settings.dry.wet}h to dry` },
]);

// React to settings changes: lookback needs a refetch; temp/dry only recompute.
watch(() => settings.lookbackDays, () => {
  persistSettings();
  refreshAll();
});
watch(
  () => [settings.temp, settings.dry],
  () => {
    persistSettings();
    recomputeAll();
  },
  { deep: true }
);

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

// Sort control: drag order (manual), name, or best conditions.
const SORT_KEY = "mtb_sort";
const sortBy = ref(localStorage.getItem(SORT_KEY) || "custom");
watch(sortBy, (v) => {
  try {
    localStorage.setItem(SORT_KEY, v);
  } catch {
    /* ignore */
  }
  if (sortable) sortable.option("disabled", v !== "custom");
});

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
    now: new Date(),
    drainage: area.drainage,
    idealTempMin: ideal.min,
    idealTempMax: ideal.max,
    dryCutoffs: dryCutoffs(),
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
  // Already have this spot? Select it rather than silently doing nothing.
  const existing = findExisting(areas.value, place);
  if (existing) {
    selectedId.value = existing.id;
    return;
  }
  const next = addArea(areas.value, place);
  areas.value = next;
  persist();
  const added = next[next.length - 1];
  selectedId.value = added.id;
  refreshArea(added);
}

function onRemove(id) {
  clearRetry(id);
  areas.value = removeArea(areas.value, id);
  delete conditions[id];
  persist();
}

// Clicking a map dot: highlight, expand, and scroll its card into view.
function onMarkerSelect(id) {
  selectedId.value = id;
  if (collapsed[id]) {
    collapsed[id] = false;
    persistCollapsed();
  }
  nextTick(() => {
    const elc = document.querySelector(`[data-card="${id}"]`);
    if (elc) elc.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
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
        <AddArea :bias="mapCenter" @add="onAdd" />
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
        <span v-for="t in trailKey" :key="t.label" class="k">
          <i class="sw" :style="{ background: t.color }"></i>
          {{ t.label }} <small v-if="t.note">({{ t.note }})</small>
        </span>
      </div>
    </div>

    <div class="layout">
      <main class="left">
        <div v-if="areas.length" class="board-tools">
          <button @click="expandAll">Expand all</button>
          <button @click="collapseAll">Collapse all</button>
          <label class="sort">
            Sort
            <select v-model="sortBy">
              <option value="custom">Drag order</option>
              <option value="name">Name A–Z</option>
              <option value="conditions">Best conditions</option>
            </select>
          </label>
        </div>
        <div v-if="areas.length" ref="boardEl" class="board">
          <AreaCard
            v-for="area in displayedAreas"
            :key="area.id"
            :data-card="area.id"
            :area="area"
            :result="conditions[area.id] ? conditions[area.id].result : null"
            :current="conditions[area.id] && conditions[area.id].wx ? conditions[area.id].wx.current : null"
            :error="conditions[area.id] ? conditions[area.id].error : ''"
            :selected="area.id === selectedId"
            :collapsed="!!collapsed[area.id]"
            @remove="onRemove"
            @select="selectedId = $event"
            @toggle="toggleCollapse"
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
          @select="onMarkerSelect"
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
      @reset="resetSettings"
      @close="showSettings = false"
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
.key-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.key-title {
  flex: 0 0 116px;
  text-transform: uppercase; letter-spacing: 0.6px; font-size: 10.5px;
  color: var(--muted); font-weight: 650;
}
.k { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
.k small { color: var(--muted); }
.sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: 0 0 auto; }

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
.board-tools { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex: 0 0 auto; }
.board-tools button { font-size: 12px; padding: 5px 11px; }
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
</style>
