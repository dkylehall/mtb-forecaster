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
let radarTimer = null; // periodic re-fetch of the frame list

// Animated radar: RainViewer serves ~13 recent frames + short nowcast. We load
// them all (one tile layer each, opacity-toggled) and cycle through for a loop.
const RADAR_OPACITY = 0.65;
const RADAR_FRAME_MS = 500; // per-frame dwell while playing
const RADAR_LOOP_PAUSE_MS = 1200; // hold on the newest frame before looping
let radarFrames = [];
let radarHost = "";
const radarLayers = {}; // frame index -> L.tileLayer (added to map, opacity 0/0.65)
let radarAnimTimer = null;
const radarIdx = ref(0);
const radarPlaying = ref(true);
const radarTime = ref("");
const radarCount = ref(0); // frame count, for the scrubber's range
let youMarker = null; // "you are here" dot from the locate button

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
    // Leaflet assigns string tooltip content via innerHTML, and area names come
    // from OSM search results — world-editable, so treat them as untrusted. An
    // element with textContent is appended as-is, no HTML parsing.
    const label = document.createElement("span");
    label.textContent = area.name;
    m.bindTooltip(label, { direction: "top", offset: [0, -6] });
    m.on("click", () => emit("select", area.id)); // jump to card
    m.addTo(markerLayer);
    pts.push([area.lat, area.lon]);
  }
  if (pts.length) {
    map.fitBounds(pts, { padding: [40, 40], maxZoom: 10 });
  }
}

// Get (creating + caching) the tile layer for frame `i`, added to the map at
// opacity 0 so it preloads without showing.
function frameLayer(i) {
  if (radarLayers[i]) return radarLayers[i];
  const f = radarFrames[i];
  const url = `${radarHost}${f.path}/256/{z}/{x}/{y}/4/1_1.png`;
  const layer = L.tileLayer(url, {
    opacity: 0,
    maxNativeZoom: RADAR_NATIVE_MAX, // upscale past z7 instead of fetching the placeholder
    maxZoom: MAP_MAX_ZOOM,
    errorTileUrl: BLANK_TILE,
    zIndex: 5,
  });
  radarLayers[i] = layer;
  if (map) layer.addTo(map);
  return layer;
}

// Show frame `i`: reveal it, hide the rest. Updates the timestamp label.
function showFrame(i) {
  if (!radarFrames.length) return;
  radarIdx.value = ((i % radarFrames.length) + radarFrames.length) % radarFrames.length;
  frameLayer(radarIdx.value);
  for (const k in radarLayers) {
    radarLayers[k].setOpacity(Number(k) === radarIdx.value ? RADAR_OPACITY : 0);
  }
  const t = radarFrames[radarIdx.value].time;
  radarTime.value = t
    ? new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
}

// Recursive timer so we can dwell longer on the newest frame each loop.
function startRadarAnim() {
  stopRadarAnim();
  if (!radarOn.value || !radarPlaying.value || radarFrames.length < 2) return;
  const tick = () => {
    const next = radarIdx.value >= radarFrames.length - 1 ? 0 : radarIdx.value + 1;
    showFrame(next);
    const onNewest = radarIdx.value >= radarFrames.length - 1;
    radarAnimTimer = setTimeout(tick, onNewest ? RADAR_LOOP_PAUSE_MS : RADAR_FRAME_MS);
  };
  radarAnimTimer = setTimeout(tick, RADAR_FRAME_MS);
}

function stopRadarAnim() {
  if (radarAnimTimer) {
    clearTimeout(radarAnimTimer);
    radarAnimTimer = null;
  }
}

function clearRadarLayers() {
  stopRadarAnim();
  for (const k in radarLayers) {
    if (map) map.removeLayer(radarLayers[k]);
    delete radarLayers[k];
  }
  radarCount.value = 0;
}

// Scrubbing the timeline pauses the loop and jumps to the chosen frame.
function onScrub(e) {
  radarPlaying.value = false;
  stopRadarAnim();
  showFrame(Number(e.target.value));
}

// RainViewer precipitation radar (free, no key). Loads the full frame list and
// preloads every frame so the animation loops smoothly.
async function loadRadar() {
  if (!map) return;
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    const j = await res.json();
    let frames = j.radar && j.radar.past ? j.radar.past.slice() : [];
    if (j.radar && j.radar.nowcast) frames = frames.concat(j.radar.nowcast);
    if (!frames.length) return;
    radarHost = j.host || "https://tilecache.rainviewer.com";
    clearRadarLayers(); // drop stale frames before swapping in the fresh list
    radarFrames = frames;
    radarCount.value = frames.length;
    if (radarOn.value) {
      radarFrames.forEach((_, i) => frameLayer(i)); // preload all frames
      showFrame(radarFrames.length - 1); // rest on the newest
      startRadarAnim();
    }
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
  if (radarOn.value) {
    if (!radarFrames.length) {
      loadRadar();
      return;
    }
    radarCount.value = radarFrames.length;
    radarFrames.forEach((_, i) => frameLayer(i));
    showFrame(radarFrames.length - 1);
    startRadarAnim();
  } else {
    clearRadarLayers();
  }
}

function toggleRadarPlay() {
  radarPlaying.value = !radarPlaying.value;
  if (radarPlaying.value) startRadarAnim();
  else stopRadarAnim();
}

// Center the map on the user's GPS location and drop a "you are here" dot.
const locating = ref(false);
function locateMe() {
  if (!map) return;
  if (!navigator.geolocation) {
    alert("Location isn't available in this browser.");
    return;
  }
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false;
      const ll = [pos.coords.latitude, pos.coords.longitude];
      map.setView(ll, Math.max(map.getZoom(), 10), { animate: true });
      if (youMarker) map.removeLayer(youMarker);
      youMarker = L.circleMarker(ll, {
        radius: 6,
        color: "#fff",
        weight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 1,
      }).addTo(map);
      youMarker.bindTooltip("You are here", { direction: "top", offset: [0, -6] });
    },
    () => {
      locating.value = false;
      alert("Couldn't get your location. Allow location access to use this.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

// Trackpad pinch (ctrl+wheel): zoom toward the pointer, clamped to the map's range.
function onPinchZoom(e) {
  if (!map || !e.ctrlKey) return;
  e.preventDefault();
  const pt = map.mouseEventToContainerPoint(e);
  const target = map.getZoom() - e.deltaY * 0.01;
  const z = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, target));
  map.setZoomAround(map.containerPointToLatLng(pt), z, { animate: false });
}

onMounted(() => {
  map = L.map(el.value, {
    zoomControl: true, // the +/- buttons
    attributionControl: true,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    scrollWheelZoom: false, // plain scroll pans the page, not the map…
    doubleClickZoom: true, // …but double-click zooms in
    touchZoom: true, // two-finger pinch on touchscreens
    boxZoom: false,
  }).setView([38.2, -78.7], 7);
  // Trackpad pinch arrives as ctrl+wheel — zoom toward the cursor on that only,
  // so ordinary scrolling still moves the page rather than the map.
  el.value.addEventListener("wheel", onPinchZoom, { passive: false });
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
  stopRadarAnim();
  if (el.value) el.value.removeEventListener("wheel", onPinchZoom);
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
        <button class="ctrl" :class="{ on: locating }" title="Center on my location" @click="locateMe">📍</button>
        <button class="ctrl" :class="{ on: radarOn }" @click="toggleRadar">🌧️ Radar</button>
        <div class="base-toggle">
          <button :class="{ on: baseMode === 'streets' }" @click="setBase('streets')">Map</button>
          <button :class="{ on: baseMode === 'satellite' }" @click="setBase('satellite')">Satellite</button>
        </div>
      </div>
    </div>
    <div ref="el" class="map"></div>
    <div v-if="radarOn" class="radar-bar">
      <button
        class="radar-play"
        :title="radarPlaying ? 'Pause radar loop' : 'Play radar loop'"
        @click="toggleRadarPlay"
      >
        {{ radarPlaying ? "⏸" : "▶" }}
      </button>
      <span v-if="radarTime" class="radar-time">{{ radarTime }}</span>
      <input
        class="radar-scrub"
        type="range"
        min="0"
        :max="Math.max(0, radarCount - 1)"
        :value="radarIdx"
        :disabled="radarCount < 2"
        title="Scrub radar timeline"
        @input="onScrub"
      />
    </div>
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
.radar-bar {
  display: flex; align-items: center; gap: 9px; flex: 0 0 auto;
  font-size: 11px; color: var(--muted);
}
.radar-legend {
  display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
  font-size: 11px; color: var(--muted);
}
.radar-play {
  flex: 0 0 auto; padding: 2px 7px; font-size: 11px; line-height: 1;
  border-radius: 6px; border: 1px solid var(--line);
  background: var(--card); color: var(--text); cursor: pointer;
}
.radar-play:hover { border-color: var(--accent); background: var(--card-2); }
.radar-time { flex: 0 0 auto; font-variant-numeric: tabular-nums; min-width: 52px; }
.radar-scrub {
  flex: 1 1 auto; min-width: 0; accent-color: var(--accent); cursor: pointer;
}
.radar-scrub:disabled { opacity: 0.4; cursor: default; }
.radar-legend .bar {
  flex: 0 0 auto; width: 110px; height: 7px; border-radius: 6px;
  background: linear-gradient(90deg, #1a73e8, #34d399, #fbbf24, #ef4444, #d946ef);
}

@media (max-width: 900px) {
  .map-panel { position: static; height: auto; }
  .map { height: 340px; }
}
</style>
