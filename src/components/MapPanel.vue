<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const props = defineProps({
  areas: { type: Array, required: true },
  conditions: { type: Object, required: true }, // id -> { result, error }
});
const emit = defineEmits(["select", "centerchange"]);

// Resolve condition keys to concrete hex (SVG fill won't take CSS vars reliably).
const COLOR = {
  green: "#5be0a0",
  yellow: "#ffe45c",
  orange: "#ffb454",
  red: "#ff6b6b",
  none: "#5cc8ff",
};

// We let the user zoom to z14 but never REQUEST a tile past each layer's real
// coverage — Leaflet upscales beyond maxNativeZoom. The base maps (CARTO, Esri)
// have tiles well past z12. RainViewer radar, however, only serves real tiles
// through z7: beyond that it returns a "Zoom Level Not Supported" placeholder
// PNG (a real 200, so errorTileUrl can't catch it), which Leaflet would then
// upscale across the whole map. Capping radar at its native max avoids that.
const MAP_MIN_ZOOM = 3;
const MAP_MAX_ZOOM = 14; // how far the user can zoom (tiles upscale past native)
const MAP_NATIVE_MAX = 12; // base layers: never request tiles beyond this
const RADAR_NATIVE_MAX = 7; // RainViewer's real max — z8+ is "not supported"
const BLANK_TILE =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

const el = ref(null);
const baseMode = ref(localStorage.getItem("trail_map_base") || "streets");
const radarOn = ref(localStorage.getItem("mtb_radar") !== "off"); // default on
let map = null;
let markerLayer = null;
let baseLayer = null;
let labelLayer = null;
let radarLayer = null;
let radarTimer = null;

// Light, labeled base maps make trailheads easy to spot; satellite shows the
// actual terrain/clearings.
const TILE_OPTS = {
  maxZoom: MAP_MAX_ZOOM,
  maxNativeZoom: MAP_NATIVE_MAX,
  errorTileUrl: BLANK_TILE,
};
const BASES = {
  streets: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    opts: { ...TILE_OPTS, subdomains: "abcd", attribution: "© OpenStreetMap, © CARTO" },
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    opts: { ...TILE_OPTS, attribution: "© Esri, Maxar, Earthstar Geographics" },
    labels:
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  },
};

function setBase(mode) {
  baseMode.value = BASES[mode] ? mode : "streets";
  try {
    localStorage.setItem("trail_map_base", baseMode.value);
  } catch {
    /* ignore */
  }
  if (!map) return;
  if (baseLayer) map.removeLayer(baseLayer);
  if (labelLayer) {
    map.removeLayer(labelLayer);
    labelLayer = null;
  }
  const b = BASES[baseMode.value];
  baseLayer = L.tileLayer(b.url, b.opts).addTo(map);
  baseLayer.bringToBack();
  if (b.labels) {
    labelLayer = L.tileLayer(b.labels, { ...TILE_OPTS }).addTo(map);
  }
}

function colorFor(area) {
  const c = props.conditions[area.id];
  return c && c.result ? COLOR[c.result.condition.key] || COLOR.none : COLOR.none;
}

function renderMarkers() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  const pts = [];
  for (const area of props.areas) {
    const color = colorFor(area);
    const m = L.circleMarker([area.lat, area.lon], {
      radius: 8,
      color: "#0b1020",
      weight: 2,
      fillColor: color,
      fillOpacity: 0.95,
    });
    m.bindTooltip(area.name, { direction: "top", offset: [0, -6] });
    m.on("click", () => emit("select", area.id)); // jump to card
    m.addTo(markerLayer);
    pts.push([area.lat, area.lon]);
  }
  if (pts.length) {
    map.fitBounds(pts, { padding: [40, 40], maxZoom: 10 });
  }
}

// RainViewer precipitation radar (free, no key). Loads the latest frame.
async function loadRadar() {
  if (!map) return;
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    const j = await res.json();
    let frames = j.radar && j.radar.past ? j.radar.past.slice() : [];
    if (j.radar && j.radar.nowcast) frames = frames.concat(j.radar.nowcast);
    if (!frames.length) return;
    const latest = frames[frames.length - 1];
    const host = j.host || "https://tilecache.rainviewer.com";
    const url = `${host}${latest.path}/256/{z}/{x}/{y}/4/1_1.png`;
    if (radarLayer) {
      map.removeLayer(radarLayer);
      radarLayer = null;
    }
    radarLayer = L.tileLayer(url, {
      opacity: 0.65,
      maxNativeZoom: RADAR_NATIVE_MAX, // upscale past z7 instead of fetching the placeholder
      maxZoom: MAP_MAX_ZOOM,
      errorTileUrl: BLANK_TILE,
    });
    if (radarOn.value) radarLayer.addTo(map);
  } catch {
    /* offline / blocked — just skip radar */
  }
}

function toggleRadar() {
  radarOn.value = !radarOn.value;
  try {
    localStorage.setItem("mtb_radar", radarOn.value ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (!radarLayer) {
    if (radarOn.value) loadRadar();
    return;
  }
  if (radarOn.value) radarLayer.addTo(map);
  else map.removeLayer(radarLayer);
}

onMounted(() => {
  map = L.map(el.value, {
    zoomControl: true, // the +/- buttons
    attributionControl: true,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    scrollWheelZoom: false, // don't zoom while scrolling the page
    doubleClickZoom: false, // only the +/- buttons zoom
    boxZoom: false,
  }).setView([38.2, -78.7], 7);
  setBase(baseMode.value);
  markerLayer = L.layerGroup().addTo(map);
  // Bias place search toward wherever the map is looking.
  const emitCenter = () => {
    const c = map.getCenter();
    emit("centerchange", { lat: c.lat, lon: c.lng });
  };
  map.on("moveend", emitCenter);
  emitCenter();
  renderMarkers();
  loadRadar();
  radarTimer = setInterval(loadRadar, 5 * 60 * 1000); // refresh radar every 5 min
  setTimeout(() => map && map.invalidateSize(), 200);
});

onBeforeUnmount(() => {
  if (radarTimer) clearInterval(radarTimer);
  if (map) map.remove();
  map = null;
});

watch(() => props.areas, renderMarkers, { deep: true });
watch(() => props.conditions, renderMarkers, { deep: true });

// Let the parent recentre/zoom the map on a specific area.
defineExpose({
  focus(area) {
    if (map && area) map.setView([area.lat, area.lon], Math.max(map.getZoom(), 10), { animate: true });
  },
});
</script>

<template>
  <div class="map-panel">
    <div class="maptop">
      <div class="hint">Tap a dot to jump to its card.</div>
      <div class="map-ctrls">
        <button class="ctrl" :class="{ on: radarOn }" @click="toggleRadar">🌧️ Radar</button>
        <div class="base-toggle">
          <button :class="{ on: baseMode === 'streets' }" @click="setBase('streets')">Map</button>
          <button :class="{ on: baseMode === 'satellite' }" @click="setBase('satellite')">Satellite</button>
        </div>
      </div>
    </div>
    <div ref="el" class="map"></div>
    <div v-if="radarOn" class="radar-legend">
      <span>Light</span>
      <span class="bar"></span>
      <span>Heavy</span>
    </div>
  </div>
</template>

<style scoped>
.map-panel {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: calc(100vh - 32px);
}
.maptop { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: 0 0 auto; }
.hint { color: var(--muted); font-size: 12px; }
.map-ctrls { display: flex; align-items: center; gap: 8px; }
.ctrl {
  padding: 5px 10px; font-size: 12px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--card); color: var(--muted);
}
.ctrl.on { color: var(--text); border-color: var(--accent); background: var(--card-2); }
.base-toggle { display: flex; gap: 0; flex: 0 0 auto; }
.base-toggle button {
  padding: 5px 11px; font-size: 12px; border-radius: 0;
  border: 1px solid var(--line); background: var(--card); color: var(--muted);
}
.base-toggle button:first-child { border-radius: 8px 0 0 8px; }
.base-toggle button:last-child { border-radius: 0 8px 8px 0; border-left: none; }
.base-toggle button.on { color: var(--text); border-color: var(--accent); background: var(--card-2); }
.map {
  flex: 1 1 auto;
  min-height: 320px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  background: #0a0e1c;
}
.radar-legend {
  display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
  font-size: 11px; color: var(--muted);
}
.radar-legend .bar {
  flex: 0 0 auto; width: 110px; height: 7px; border-radius: 6px;
  background: linear-gradient(90deg, #1a73e8, #34d399, #fbbf24, #ef4444, #d946ef);
}

@media (max-width: 900px) {
  .map-panel { position: static; height: auto; }
  .map { height: 340px; }
}
</style>
