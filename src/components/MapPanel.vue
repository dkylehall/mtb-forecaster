<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// Leaflet's default marker images don't resolve under bundlers; wire them up
// explicitly so dropped/trail pins are visible.
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import { reverseGeocode } from "../lib/geocode.js";

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

const props = defineProps({
  areas: { type: Array, required: true },
  conditions: { type: Object, required: true }, // id -> { result, error }
});
const emit = defineEmits(["add", "select", "centerchange"]);

// Resolve condition keys to concrete hex (SVG fill won't take CSS vars reliably).
const COLOR = {
  green: "#5be0a0",
  yellow: "#ffe45c",
  orange: "#ffb454",
  red: "#ff6b6b",
  none: "#5cc8ff",
};

const el = ref(null);
const baseMode = ref(localStorage.getItem("trail_map_base") || "streets");
let map = null;
let markerLayer = null;
let dropMarker = null;
let baseLayer = null;
let labelLayer = null;

// Light, labeled base maps make it far easier to spot trailheads to pin than a
// dark canvas. Satellite is great for seeing actual clearings/parking lots.
const BASES = {
  streets: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    opts: { subdomains: "abcd", maxZoom: 20, attribution: "© OpenStreetMap, © CARTO" },
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    opts: { maxZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" },
    // Place labels overlaid on imagery for legibility.
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
    labelLayer = L.tileLayer(b.labels, { maxZoom: b.opts.maxZoom }).addTo(map);
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
    m.on("click", () => emit("select", area.id));
    m.addTo(markerLayer);
    pts.push([area.lat, area.lon]);
  }
  if (pts.length) {
    map.fitBounds(pts, { padding: [40, 40], maxZoom: 10 });
  }
}

// Build the "Add this spot?" popup shown when a pin is dropped.
function addPopupContent(place) {
  const box = document.createElement("div");
  box.className = "pin-pop";
  const input = document.createElement("input");
  input.type = "text";
  input.value = place.name;
  const region = document.createElement("div");
  region.className = "pin-region";
  region.textContent =
    (place.region || "") + `  (${place.lat.toFixed(4)}, ${place.lon.toFixed(4)})`;
  const btn = document.createElement("button");
  btn.textContent = "Add area";
  btn.addEventListener("click", () => {
    emit("add", {
      name: input.value.trim() || place.name,
      region: place.region,
      lat: place.lat,
      lon: place.lon,
    });
    map.closePopup();
    if (dropMarker) {
      map.removeLayer(dropMarker);
      dropMarker = null;
    }
  });
  box.appendChild(input);
  box.appendChild(region);
  box.appendChild(btn);
  return box;
}

async function onMapClick(e) {
  const { lat, lng } = e.latlng;
  if (dropMarker) map.removeLayer(dropMarker);
  dropMarker = L.marker([lat, lng]).addTo(map);
  dropMarker
    .bindPopup("<div class='pin-pop'>Looking up this spot…</div>")
    .openPopup();
  const place = await reverseGeocode(lat, lng);
  if (!dropMarker) return; // user may have added/closed already
  dropMarker.setPopupContent(addPopupContent(place));
}

onMounted(() => {
  map = L.map(el.value, { zoomControl: true, attributionControl: true }).setView(
    [38.2, -78.7],
    7
  );
  setBase(baseMode.value);
  markerLayer = L.layerGroup().addTo(map);
  map.on("click", onMapClick);
  // Bias place search toward wherever the map is looking.
  const emitCenter = () => {
    const c = map.getCenter();
    emit("centerchange", { lat: c.lat, lon: c.lng });
  };
  map.on("moveend", emitCenter);
  emitCenter();
  renderMarkers();
  setTimeout(() => map && map.invalidateSize(), 200);
});

onBeforeUnmount(() => {
  if (map) map.remove();
  map = null;
});

watch(() => props.areas, renderMarkers, { deep: true });
watch(() => props.conditions, renderMarkers, { deep: true });
</script>

<template>
  <div class="map-panel">
    <div class="maptop">
      <div class="hint">📍 Click the map to drop a pin on an exact trailhead.</div>
      <div class="base-toggle">
        <button :class="{ on: baseMode === 'streets' }" @click="setBase('streets')">Map</button>
        <button :class="{ on: baseMode === 'satellite' }" @click="setBase('satellite')">Satellite</button>
      </div>
    </div>
    <div ref="el" class="map"></div>
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

@media (max-width: 900px) {
  .map-panel { position: static; height: auto; }
  .map { height: 340px; }
}
</style>

<style>
/* Popup contents are created outside the scoped tree, so style globally. */
.pin-pop { display: flex; flex-direction: column; gap: 6px; min-width: 180px; }
.pin-pop input {
  font: inherit; padding: 6px 8px; border-radius: 8px;
  border: 1px solid var(--line); background: #fff; color: #111;
}
.pin-pop .pin-region { font-size: 11px; color: #555; }
.pin-pop button {
  font: inherit; padding: 6px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--accent); background: var(--accent); color: #06203a; font-weight: 600;
}
</style>
