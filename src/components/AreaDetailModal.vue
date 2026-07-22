<script setup>
import { computed, ref, watch } from "vue";
import ConditionSummary from "./ConditionSummary.vue";
import { summarize } from "../lib/summary.js";
import { wmo, aqiCategory, aqiColor } from "../lib/weather.js";
import { whenLabel, clock, timeLeftLabel } from "../lib/format.js";

const props = defineProps({
  area: { type: Object, required: true },
  result: { type: Object, default: null },
  current: { type: Object, default: null },
  error: { type: String, default: "" },
  maxWindows: { type: Number, default: 3 },
  // Operating hours for this area, {open:"10:00", close:"18:00"}, or null for
  // "use daylight".
  hours: { type: Object, default: null },
  // This area rides fine wet — skip trail dryness for it.
  wetOk: { type: Boolean, default: false },
  tempLabels: {
    type: Object,
    default: () => ({ green: "ideal", yellow: "tolerable", orange: "uncomfortable", red: "no" }),
  },
});
const emit = defineEmits(["close", "set-hours", "set-wet"]);

// "HH:MM" → decimal hours, for the engine's day-span maths.
function hhmmToHours(s) {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  return Number.isFinite(h) ? h + (m || 0) / 60 : null;
}
// Editable copies of the area's hours; empty strings mean "use daylight".
const openTime = ref(props.hours?.open || "");
const closeTime = ref(props.hours?.close || "");
// Re-seed only when a different area is opened. Watching `hours` instead would
// clobber a half-finished edit: clearing one end saves null, which would bounce
// back and blank the other field too.
watch(
  () => props.area?.id,
  () => {
    openTime.value = props.hours?.open || "";
    closeTime.value = props.hours?.close || "";
  }
);
const usingHours = computed(() => !!(openTime.value && closeTime.value));
function onHoursChange() {
  // Only a complete, non-empty window counts. Anything else (one side cleared,
  // or close before open) falls back to daylight — and clears what was stored,
  // so a half-edited state can't resurrect the old hours on reopen.
  if (openTime.value && closeTime.value && closeTime.value > openTime.value) {
    emit("set-hours", { open: openTime.value, close: closeTime.value });
  } else {
    emit("set-hours", null);
  }
}
// Clear just one end (the × beside each field).
function clearOne(which) {
  if (which === "open") openTime.value = "";
  else closeTime.value = "";
  onHoursChange();
}
function clearHours() {
  openTime.value = "";
  closeTime.value = "";
  emit("set-hours", null);
}
// Step a time by ±minutes, clamped to the day. Empty fields seed from sensible
// defaults (9am open / 5pm close) so the arrows work from a blank state.
function nudge(which, mins) {
  const cur = which === "open" ? openTime.value : closeTime.value;
  const base = cur || (which === "open" ? "09:00" : "17:00");
  let total = hhmmToHours(base) * 60 + mins;
  total = Math.max(0, Math.min(23 * 60 + 30, total));
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  if (which === "open") openTime.value = `${hh}:${mm}`;
  else closeTime.value = `${hh}:${mm}`;
  onHoursChange();
}
const hoursLabel = computed(() =>
  usingHours.value
    ? `${clock(`2000-01-01T${openTime.value}`)}–${clock(`2000-01-01T${closeTime.value}`)}`
    : "sunrise to sunset"
);

// Trail dryness as drying time (continuous gradient), matching the cards.
const isDry = computed(() => !props.result || props.result.hoursUntilDry <= 0);
const wetText = computed(() =>
  isDry.value ? "Dry" : `Drying for ${timeLeftLabel(props.result.hoursUntilDry)}`
);
const wetColor = computed(() =>
  isDry.value ? "var(--green)" : props.result.dryColor
);
const dryByText = computed(() =>
  props.result && props.result.dryAt ? `Dry by ${whenLabel(props.result.dryAt)}` : null
);

const summary = computed(() =>
  props.result
    ? summarize(props.result, new Date(), props.maxWindows, {
        open: hhmmToHours(openTime.value),
        close: hhmmToHours(closeTime.value),
      })
    : null
);
const tempColor = computed(() =>
  props.result && props.result.tempCondition ? props.result.tempCondition.color : "var(--line)"
);

const cur = computed(() => {
  const c = props.current;
  const temp = c?.temperature_2m ?? (props.result ? props.result.tempNow : null);
  return {
    temp: temp != null ? Math.round(temp) : null,
    feels: c?.apparent_temperature != null ? Math.round(c.apparent_temperature) : null,
    humidity: c?.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : null,
    aqi: props.result ? props.result.aqiNow : null,
  };
});

const nextRainText = computed(() => {
  const nr = summary.value?.nextRain;
  if (!nr) return "None forecast";
  return `${nr.amountIn}" ${whenLabel(nr.at)}`;
});

function dayLabel(iso) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString(undefined, { weekday: "short" });
  const md = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${wd} ${md}`;
}
// Concrete hex per tier (SVG gradient stops won't take CSS vars reliably).
// Hot deviations warm up (yellow→orange→red); cold deviations cool down
// (blue→indigo→purple) so direction reads at a glance.
const TIER_HEX = {
  green: "#5be0a0", yellow: "#ffe45c", orange: "#ffb454", red: "#ff6b6b",
};
const COLD_HEX = {
  green: "#5be0a0", yellow: "#7ec8ff", orange: "#5b8def", red: "#a06bff",
};
function tierHex(t, dir) {
  return (dir === "cold" ? COLD_HEX : TIER_HEX)[t] || "#8aa0b8";
}
// WMO weather code → [label, emoji] for the per-hour sky icons (sun vs shade).
function skyEmoji(code) {
  return code == null ? "" : wmo(code)[1];
}
function skyLabel(code) {
  return code == null ? "" : wmo(code)[0];
}

// Curvy temperature sparkline geometry for one ride window's hourly `bars`.
// Coordinate space is 0..100 wide × 0..CH_H tall; we render with
// preserveAspectRatio="none" so it fills the row width.
const CH_H = 46;
const CH_PAD = 6;

// Catmull-Rom → cubic-bezier, for a smooth flowing line through the points.
function smoothPath(pts) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M0,${pts[0].y} L100,${pts[0].y}`; // flat line
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

// One series (actual or feels-like): smooth line, fill, and per-point gradient.
function seriesGeom(bars, valKey, tierKey, dirKey, lo, hi, withArea) {
  const pts = bars.map((b, i) => {
    const x = bars.length === 1 ? 50 : (i / (bars.length - 1)) * 100;
    const v = b[valKey];
    const ratio = v == null ? 0.5 : (v - lo) / (hi - lo);
    const y = CH_PAD + (1 - ratio) * (CH_H - 2 * CH_PAD);
    return { x, y };
  });
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  const area = withArea && pts.length > 1 ? `${line} L${last.x},${CH_H} L${pts[0].x},${CH_H} Z` : "";
  const stops = bars.map((b, i) => ({
    offset: (bars.length === 1 ? 0 : (i / (bars.length - 1)) * 100).toFixed(1) + "%",
    color: tierHex(b[tierKey], b[dirKey]),
  }));
  return { line, area, stops };
}

function chartFor(bars, idx) {
  // Scale to this window's combined actual+feels range (with a minimum span so
  // a tiny wiggle isn't over-amplified) so both lines flow and stay comparable.
  const vals = [];
  bars.forEach((b) => {
    if (b.temp != null) vals.push(b.temp);
    if (b.feels != null) vals.push(b.feels);
  });
  let lo = vals.length ? Math.min(...vals) : 30;
  let hi = vals.length ? Math.max(...vals) : 100;
  const span = Math.max(hi - lo, 6);
  const mid = (lo + hi) / 2;
  lo = mid - span / 2;
  hi = mid + span / 2;
  const hasFeels = bars.some((b) => b.feels != null);
  return {
    actual: seriesGeom(bars, "temp", "tier", "dir", lo, hi, true),
    feels: hasFeels ? seriesGeom(bars, "feels", "feelsTier", "feelsDir", lo, hi, false) : null,
    gradId: `wgrad-${idx}`,
    feelsGradId: `wfeels-${idx}`,
  };
}

// Hour-of-day from an ISO string (TZ-agnostic), e.g. "…T05:28" → 5.47.
function hourOf(iso) {
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
}
// X position (0–100) for a sunrise/sunset marker within a window's bars, or
// null if it falls outside the charted span.
function markerX(iso, bars) {
  if (!iso || !bars || bars.length < 2) return null;
  const t0 = hourOf(bars[0].time);
  const t1 = hourOf(bars[bars.length - 1].time);
  if (t1 <= t0) return null;
  const t = hourOf(iso);
  // Each bar represents its whole hour, so allow a marker up to ~1h past the
  // last bar (and a touch before the first); clamp its position to the edge.
  if (t < t0 - 0.5 || t > t1 + 1) return null;
  const frac = (t - t0) / (t1 - t0);
  return Math.max(0, Math.min(1, frac)) * 100;
}

// Per-day outlook charts: full sunrise→sunset arc, with the optimal ride
// windows marked as vertical dashed lines labelled with their start/end times.
const dayOutlooks = computed(() => summary.value?.dayOutlooks || []);
const dayCharts = computed(() =>
  dayOutlooks.value.map((d, i) => {
    if (!d.bars || !d.bars.length) return null;
    const c = chartFor(d.bars, i);
    c.date = d.date;
    c.srX = markerX(d.sunrise, d.bars);
    c.ssX = markerX(d.sunset, d.bars);
    c.windows = (d.windows || [])
      .map((w) => ({
        startX: markerX(w.at, d.bars),
        endX: markerX(w.end, d.bars),
        startLabel: clock(w.at),
        endLabel: clock(w.end),
      }))
      .filter((w) => w.startX != null || w.endX != null);
    // Non-rideable segments = the complement of the windows across [0,100];
    // these get hatched out so the clean stretches read as the ride windows.
    const wins = c.windows
      .filter((w) => w.startX != null && w.endX != null)
      .map((w) => ({ s: Math.max(0, Math.min(100, w.startX)), e: Math.max(0, Math.min(100, w.endX)) }))
      .sort((a, b) => a.s - b.s);
    const dim = [];
    let cursor = 0;
    for (const w of wins) {
      if (w.s > cursor) dim.push({ left: cursor, width: w.s - cursor });
      cursor = Math.max(cursor, w.e);
    }
    if (cursor < 100) dim.push({ left: cursor, width: 100 - cursor });
    c.dimSegs = dim;
    return c;
  })
);
const hasAnyFeels = computed(() => dayCharts.value.some((c) => c && c.feels));
function dayTitle(iso) {
  return dayLabel(`${iso}T12:00`);
}

// Which series are visible (toggled via the legend). All on by default.
const showActual = ref(true);
const showFeels = ref(true);
const showRH = ref(true);
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel" role="dialog" :aria-label="area.name">
      <header class="p-head">
        <div class="names">
          <div class="name">{{ area.name }}</div>
          <div class="region">{{ area.region }}</div>
        </div>
        <button class="x" title="Close" @click="emit('close')">×</button>
      </header>

      <div v-if="error" class="status err">{{ error }}</div>

      <template v-else-if="result">
        <!-- Riding conditions -->
        <section class="block">
          <h3>Current riding conditions</h3>
          <div class="ride-row">
            <div class="big">
              <span class="bigval" :style="{ color: tempColor }">
                {{ cur.temp != null ? cur.temp + "°" : "—" }}
              </span>
              <span class="unit">F</span>
            </div>
            <div class="metrics">
              <span v-if="cur.feels != null">Feels like {{ cur.feels }}°</span>
              <span v-if="cur.humidity != null">💧 {{ cur.humidity }}% RH</span>
              <span v-if="cur.aqi != null">AQI <b :style="{ color: aqiColor(cur.aqi) }">{{ cur.aqi }}</b> {{ aqiCategory(cur.aqi) }}</span>
            </div>
          </div>
          <ConditionSummary :summary="summary" :result="result" :show="['temp']" :temp-labels="tempLabels" />
        </section>

        <!-- Trail conditions -->
        <section class="block trail">
          <h3>Current trail conditions</h3>
          <div class="trail-row">
            <span class="trail-status" :style="{ color: wetColor }">{{ wetText }}</span>
            <span class="metrics">
              <span v-if="dryByText">{{ dryByText }}</span>
              <span>Recent {{ result.recentRainIn }}"</span>
              <span>Next rain: {{ nextRainText }}</span>
            </span>
          </div>
          <ConditionSummary :summary="summary" :result="result" :show="['wet']" />
        </section>

        <!-- Ride outlook (whole days, sunrise→sunset) -->
        <div class="windows">
          <div class="w-head">
            <div class="w-label">🚵 Ride outlook<span class="w-sun"> ({{ hoursLabel }})</span></div>
            <div v-if="hasAnyFeels" class="w-legend">
              <button class="leg" :class="{ off: !showActual }" @click="showActual = !showActual">
                <span class="leg-line solid"></span>Actual
              </button>
              <button class="leg" :class="{ off: !showFeels }" @click="showFeels = !showFeels">
                <span class="leg-line dashed"></span>(Feels like)
              </button>
              <button class="leg" :class="{ off: !showRH }" @click="showRH = !showRH">RH%</button>
            </div>
          </div>

          <!-- Operating hours: overrides daylight for this area (lift hours,
               gate hours). Blank both to fall back to sunrise→sunset. -->
          <div class="w-hours">
            <div class="wh-head">
              <span class="wh-title">🕘 Open hours</span>

              <span class="wh-state">{{ usingHours ? hoursLabel : "Daylight (sunrise–sunset)" }}</span>
              <button v-if="usingHours" class="wh-clear" @click="clearHours">Reset to daylight</button>
            </div>
            <div class="wh-row">
              <span class="wh-cap">Opens</span>
              <span class="wh-stepper">
                <input type="time" class="wh-input" v-model="openTime" aria-label="Opening time" @change="onHoursChange" />
                <span class="wh-arrows">
                  <button title="Later" @click="nudge('open', 30)">▲</button>
                  <button title="Earlier" @click="nudge('open', -30)">▼</button>
                </span>
                <button v-if="openTime" class="wh-x" title="Clear opening time" @click="clearOne('open')">×</button>
              </span>
              <span class="wh-cap">Closes</span>
              <span class="wh-stepper">
                <input type="time" class="wh-input" v-model="closeTime" aria-label="Closing time" @change="onHoursChange" />
                <span class="wh-arrows">
                  <button title="Later" @click="nudge('close', 30)">▲</button>
                  <button title="Earlier" @click="nudge('close', -30)">▼</button>
                </span>
                <button v-if="closeTime" class="wh-x" title="Clear closing time" @click="clearOne('close')">×</button>
              </span>
              <span v-if="!usingHours" class="wh-note">Set both to override sunrise/sunset for this spot</span>
            </div>

            <label class="wh-wet">
              <input
                type="checkbox"
                :checked="wetOk"
                @change="emit('set-wet', $event.target.checked)"
              />
              <span class="wh-wet-name">Rideable when wet</span>
              <span class="wh-note">Rock, sand or hardpack — ignore trail dryness here</span>
            </label>
          </div>
          <ul v-if="dayOutlooks.length" class="w-list">
            <li v-for="(d, i) in dayOutlooks" :key="i" class="w-item">
              <div class="w-text">
                {{ dayTitle(d.date) }}
                <span v-if="dayCharts[i] && dayCharts[i].windows.length" class="w-win">·
                  rideable<template v-for="(win, wi) in dayCharts[i].windows" :key="wi">{{ wi ? "," : "" }} {{ win.startLabel }}–{{ win.endLabel }}</template>
                </span>
                <span v-else class="w-win none">· no ideal window<template
                  v-if="d.noWindowReasons && d.noWindowReasons.length"
                > ({{ d.noWindowReasons.join(", ") }})</template></span>
              </div>
              <div v-if="dayCharts[i]" class="w-chart">
                <div class="w-temps">
                  <span v-for="(b, bi) in d.bars" :key="bi" class="w-t">
                    <span v-if="showActual" class="w-ta" :style="{ color: tierHex(b.tier, b.dir) }">{{ b.temp != null ? b.temp + "°" : "—" }}</span>
                    <span v-if="showFeels && b.feels != null" class="w-tf" :style="{ color: tierHex(b.feelsTier, b.feelsDir) }">({{ b.feels }}°)</span>
                    <span v-if="showRH && b.rh != null" class="w-rh">{{ b.rh }}%</span>
                  </span>
                </div>
                <div class="w-spark-wrap">
                  <span
                    v-for="(seg, si) in dayCharts[i].dimSegs"
                    :key="'dim' + si"
                    class="dim-band"
                    :style="{ left: seg.left + '%', width: seg.width + '%' }"
                  ></span>
                  <svg class="w-spark" viewBox="0 0 100 46" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <linearGradient :id="dayCharts[i].gradId" x1="0" y1="0" x2="1" y2="0">
                        <stop v-for="(s, si) in dayCharts[i].actual.stops" :key="si" :offset="s.offset" :stop-color="s.color" />
                      </linearGradient>
                      <linearGradient v-if="dayCharts[i].feels" :id="dayCharts[i].feelsGradId" x1="0" y1="0" x2="1" y2="0">
                        <stop v-for="(s, si) in dayCharts[i].feels.stops" :key="si" :offset="s.offset" :stop-color="s.color" />
                      </linearGradient>
                    </defs>
                    <path
                      v-if="showActual && dayCharts[i].actual.area"
                      :d="dayCharts[i].actual.area"
                      :fill="`url(#${dayCharts[i].gradId})`"
                      fill-opacity="0.16"
                      stroke="none"
                    />
                    <path
                      v-if="showActual"
                      :d="dayCharts[i].actual.line"
                      fill="none"
                      :stroke="`url(#${dayCharts[i].gradId})`"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      vector-effect="non-scaling-stroke"
                    />
                    <path
                      v-if="showFeels && dayCharts[i].feels"
                      :d="dayCharts[i].feels.line"
                      fill="none"
                      :stroke="`url(#${dayCharts[i].feelsGradId})`"
                      stroke-width="2"
                      stroke-dasharray="4 3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      vector-effect="non-scaling-stroke"
                    />
                  </svg>
                  <template v-for="(win, wi) in dayCharts[i].windows" :key="'box' + wi">
                    <span
                      v-if="win.startX != null && win.endX != null"
                      class="win-box"
                      :style="{ left: win.startX + '%', width: win.endX - win.startX + '%' }"
                    ></span>
                  </template>
                  <template v-for="(win, wi) in dayCharts[i].windows" :key="'wt' + wi">
                    <span v-if="win.startX != null" class="win-label" :style="{ left: win.startX + '%' }">{{ win.startLabel }}</span>
                    <span v-if="win.endX != null" class="win-label end" :style="{ left: win.endX + '%' }">{{ win.endLabel }}</span>
                  </template>
                </div>
                <div class="w-times">
                  <span v-for="(b, bi) in d.bars" :key="bi" class="w-time">
                    <span v-if="b.code != null" class="w-ico" :title="skyLabel(b.code)">{{ skyEmoji(b.code) }}</span>
                    <span v-if="b.precipProb != null && b.precipProb > 0" class="w-prob">{{ b.precipProb }}%</span>
                    <span class="w-clock">{{ clock(b.time) }}</span>
                  </span>
                </div>
              </div>
            </li>
          </ul>
          <div v-else class="w-none">No outlook available</div>
        </div>
      </template>

      <div v-else class="status loading">Loading…</div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(5, 8, 18, 0.65);
  display: flex; align-items: center; justify-content: center;
  padding: 4vh 3vw;
}
.panel {
  width: min(760px, 100%);
  max-height: 92vh;
  overflow-y: auto;
  background: linear-gradient(180deg, var(--card), var(--card-2));
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.p-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.names { min-width: 0; }
.name { font-weight: 700; font-size: 20px; }
.region { color: var(--muted); font-size: 13px; }
.x { border: none; background: transparent; color: var(--muted); font-size: 26px; line-height: 1; cursor: pointer; }
.x:hover { color: var(--text); }

.windows {
  border-top: 1px solid var(--line);
  padding-top: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.w-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.w-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); font-weight: 650; }
.w-sun { text-transform: none; letter-spacing: 0; font-weight: 500; opacity: 0.85; }
/* Operating hours: its own card so it reads as a real per-area setting. */
.w-hours {
  display: flex; flex-direction: column; gap: 8px;
  margin: 2px 0 10px; padding: 10px 12px;
  background: var(--card-2); border: 1px solid var(--line); border-radius: 10px;
}
.wh-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wh-title {
  text-transform: uppercase; letter-spacing: 0.6px; font-size: 10.5px;
  color: var(--text); font-weight: 700;
}
.wh-state { font-size: 12px; color: var(--accent); font-variant-numeric: tabular-nums; }
.wh-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wh-cap { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
.wh-stepper { display: inline-flex; align-items: stretch; gap: 4px; }
.wh-input {
  padding: 4px 7px; font-size: 12.5px; color-scheme: dark;
  background: var(--card); color: var(--text);
  border: 1px solid var(--line); border-radius: 7px; font-variant-numeric: tabular-nums;
}
.wh-arrows { display: inline-flex; flex-direction: column; gap: 2px; }
.wh-arrows button {
  padding: 0 5px; font-size: 7px; line-height: 1.5; cursor: pointer;
  background: var(--card); color: var(--muted);
  border: 1px solid var(--line); border-radius: 4px;
}
.wh-arrows button:hover { color: var(--text); border-color: var(--accent); }
.wh-x {
  padding: 0 6px; font-size: 14px; line-height: 1; cursor: pointer;
  background: transparent; color: var(--muted);
  border: 1px solid var(--line); border-radius: 6px;
}
.wh-x:hover { color: var(--red); border-color: var(--red); }
.wh-clear {
  margin-left: auto; padding: 3px 9px; font-size: 11px; cursor: pointer;
  background: transparent; color: var(--muted);
  border: 1px solid var(--line); border-radius: 7px;
}
.wh-clear:hover { color: var(--text); border-color: var(--accent); }
.wh-note { font-size: 11px; color: var(--muted); }
.wh-wet {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; cursor: pointer;
  padding-top: 8px; border-top: 1px solid var(--line);
}
.wh-wet input[type="checkbox"] {
  width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; flex: 0 0 auto;
}
.wh-wet-name {
  text-transform: uppercase; letter-spacing: 0.6px; font-size: 10.5px;
  color: var(--text); font-weight: 700;
}
.w-legend { display: flex; gap: 6px; }
.leg {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 8px; font-size: 11px; cursor: pointer;
  border: 1px solid var(--line); border-radius: 999px;
  background: var(--card); color: var(--text);
}
.leg:hover { border-color: var(--accent); }
.leg.off { color: var(--muted); opacity: 0.55; }
.leg-line { width: 16px; height: 0; border-top: 2px solid currentColor; }
.leg-line.dashed { border-top-style: dashed; }
.w-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px; }
.w-item { display: flex; flex-direction: column; gap: 5px; }
.w-text { font-size: 13.5px; font-weight: 650; color: var(--good); font-variant-numeric: tabular-nums; }
.w-none { font-size: 13px; color: var(--muted); }

/* Curvy temperature sparkline (replaces the old hourly bars). */
.w-chart { display: flex; flex-direction: column; gap: 1px; }
.w-temps, .w-times { display: flex; justify-content: space-between; gap: 2px; }
.w-t {
  flex: 1 1 0; min-width: 0; white-space: nowrap;
  display: flex; flex-direction: column; align-items: center; line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.w-ta { font-size: 10px; font-weight: 700; }
.w-tf { font-size: 9px; font-weight: 600; }
.w-rh { font-size: 8px; color: var(--muted); }
.w-prob { font-size: 8px; color: #7ec8ff; font-variant-numeric: tabular-nums; }
/* Hatch out the non-rideable stretches so the clean gaps read as the windows. */
.dim-band {
  position: absolute; top: 0; bottom: 0; pointer-events: none;
  background:
    linear-gradient(rgba(8, 11, 20, 0.45), rgba(8, 11, 20, 0.45)),
    repeating-linear-gradient(
      45deg,
      rgba(150, 160, 180, 0.22) 0, rgba(150, 160, 180, 0.22) 1px,
      transparent 1px, transparent 6px
    );
}
.win-label {
  position: absolute; top: 0; transform: translateX(-50%);
  font-size: 8.5px; font-weight: 700; color: var(--green);
  background: rgba(11, 16, 32, 0.7); padding: 0 2px; border-radius: 3px;
  white-space: nowrap; pointer-events: none;
}
.win-box {
  position: absolute; top: 0; bottom: 0; pointer-events: none;
  border: 1px dashed rgba(91, 224, 160, 0.7);
  border-radius: 3px;
}
.w-spark-wrap { position: relative; }
.w-spark { width: 100%; height: 46px; display: block; overflow: visible; }
.sun-line { stroke: #ffce7a; stroke-width: 1.3; stroke-dasharray: 2 2; opacity: 0.7; }
.sun-line.sunset { stroke: #ff9e7a; }
.sun-mark {
  position: absolute; top: -1px; transform: translateX(-50%);
  font-size: 10px; line-height: 1; pointer-events: none;
}
.w-time {
  flex: 1 1 0; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  font-size: 9px; color: var(--muted); white-space: nowrap;
}
.w-ico { font-size: 12px; line-height: 1; }
.w-clock { font-variant-numeric: tabular-nums; }

.block { display: flex; flex-direction: column; gap: 6px; }
.block.trail { border-top: 1px solid var(--line); padding-top: 12px; }
.block h3 { margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); font-weight: 650; }
.ride-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.big { display: flex; align-items: baseline; gap: 3px; }
.bigval { font-size: 34px; font-weight: 750; line-height: 1; letter-spacing: -0.5px; }
.unit { font-size: 14px; color: var(--muted); }
.trail-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.trail-status { font-size: 22px; font-weight: 750; line-height: 1; }
.metrics { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--muted); font-size: 13px; }
.status.loading, .status.err { color: var(--muted); font-size: 14px; }
.status.err { color: var(--orange); }
</style>
