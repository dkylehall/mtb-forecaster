<script setup>
import { ref, reactive, onMounted, watch } from "vue";
import Sortable from "sortablejs";
import AddArea from "./components/AddArea.vue";
import AreaCard from "./components/AreaCard.vue";
import MapPanel from "./components/MapPanel.vue";
import { fetchTrailWeather } from "./lib/weather.js";
import { computeConditions } from "./lib/drying.js";
import { DEFAULT_IDEAL } from "./lib/temperature.js";
import {
  loadAreas,
  saveAreas,
  addArea,
  removeArea,
  setDrainage,
  findExisting,
  SEED_AREAS,
} from "./lib/areas.js";

const LOOKBACK_KEY = "trail_lookback_days_v1";
const IDEAL_KEY = "trail_ideal_temp_v1";

const areas = ref([]);
// id -> { result, error, loading }
const conditions = reactive({});
const selectedId = ref(null);
const mapCenter = ref({ lat: 38.2, lon: -78.7 }); // search bias, follows the map
const boardEl = ref(null);

// Drag-to-reorder the cards (via the grip handle), persisting the new order.
let sortable = null;
watch(boardEl, (el) => {
  if (sortable) {
    sortable.destroy();
    sortable = null;
  }
  if (el) {
    sortable = Sortable.create(el, {
      handle: ".drag-handle",
      animation: 160,
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

// How many days of past rainfall to factor into current wetness (3–7).
const lookbackDays = ref(loadLookback());
// Ideal riding temperature band (°F).
const ideal = reactive(loadIdeal());

function loadLookback() {
  const n = parseInt(localStorage.getItem(LOOKBACK_KEY), 10);
  return n >= 3 && n <= 7 ? n : 3;
}

function loadIdeal() {
  try {
    const v = JSON.parse(localStorage.getItem(IDEAL_KEY));
    if (v && typeof v.min === "number" && typeof v.max === "number") return v;
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_IDEAL };
}

function onLookbackChange() {
  try {
    localStorage.setItem(LOOKBACK_KEY, String(lookbackDays.value));
  } catch {
    /* ignore */
  }
  refreshAll(); // re-fetch every area with the new window
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
      pastDays: lookbackDays.value,
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

function onDrainage(id, drainage) {
  areas.value = setDrainage(areas.value, id, drainage);
  persist();
  const area = areas.value.find((a) => a.id === id);
  if (area) recompute(area); // soil change → recompute, no refetch
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
      </div>
    </header>

    <div class="settings">
      <div class="setting">
        <label for="lookback">Rainfall lookback</label>
        <input
          id="lookback"
          type="range"
          min="3"
          max="7"
          step="1"
          v-model.number="lookbackDays"
          @change="onLookbackChange"
        />
        <span class="val">{{ lookbackDays }}d</span>
      </div>

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

      <div class="legend">
        <span><i class="sw" style="background: var(--green)"></i> Ride</span>
        <span><i class="sw" style="background: var(--yellow)"></i> Fair</span>
        <span><i class="sw" style="background: var(--orange)"></i> Marginal</span>
        <span><i class="sw" style="background: var(--red)"></i> No</span>
      </div>
    </div>

    <div class="layout">
      <main class="left">
        <div v-if="areas.length" ref="boardEl" class="board">
          <AreaCard
            v-for="area in areas"
            :key="area.id"
            :area="area"
            :result="conditions[area.id] ? conditions[area.id].result : null"
            :current="conditions[area.id] && conditions[area.id].wx ? conditions[area.id].wx.current : null"
            :error="conditions[area.id] ? conditions[area.id].error : ''"
            :selected="area.id === selectedId"
            @remove="onRemove"
            @drainage="onDrainage"
            @select="selectedId = area.id"
          />
        </div>
        <p v-else class="empty">
          No areas yet — search above or click the map to add your first riding spot.
        </p>
      </main>

      <aside class="right">
        <MapPanel
          :areas="areas"
          :conditions="conditions"
          @add="onAdd"
          @select="selectedId = $event"
          @centerchange="mapCenter = $event"
        />
      </aside>
    </div>

    <footer>
      Conditions combine trail dryness (~24h drying per inch of rain, adjusted per-area
      for soil) and your ideal temperature band. Weather from Open-Meteo; places from
      OpenStreetMap. Estimates only — your local trail may vary.
    </footer>
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

.legend { display: flex; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: 12px; margin-left: auto; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(340px, 38vw, 560px);
  gap: 18px;
  align-items: start;
}
.board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.empty { color: var(--muted); }

footer {
  margin-top: 24px; color: var(--muted); font-size: 11.5px; line-height: 1.5;
  max-width: 720px;
}

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .right { order: -1; } /* map on top when stacked */
  .legend { margin-left: 0; }
}
</style>
