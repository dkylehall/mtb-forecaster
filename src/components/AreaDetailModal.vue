<script setup>
import { computed, ref } from "vue";
import ConditionSummary from "./ConditionSummary.vue";
import { summarize } from "../lib/summary.js";
import { wmo } from "../lib/weather.js";
import { whenLabel, clock, timeLeftLabel } from "../lib/format.js";

const props = defineProps({
  area: { type: Object, required: true },
  result: { type: Object, default: null },
  current: { type: Object, default: null },
  error: { type: String, default: "" },
  maxWindows: { type: Number, default: 3 },
  tempLabels: {
    type: Object,
    default: () => ({ green: "ideal", yellow: "tolerable", orange: "uncomfortable", red: "no" }),
  },
});
const emit = defineEmits(["close"]);

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
  props.result ? summarize(props.result, new Date(), props.maxWindows) : null
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
function durationPhrase(hours) {
  if (hours >= 24) {
    const d = Math.round(hours / 24);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
function reasonText(w) {
  if (!w.reason) return "";
  if ((w.reason === "heat" || w.reason === "cold") && w.temp != null) {
    return `${w.reason} - ${Math.round(w.temp)}°`;
  }
  if (w.reason === "sunset") return `sunset ${clock(w.end)}`;
  return w.reason;
}

const rideWindows = computed(() => summary.value?.rideWindows || []);
function windowText(w) {
  const start = w.startAtSunrise
    ? `${dayLabel(w.at)} @ sunrise (${clock(w.at)})`
    : `${dayLabel(w.at)} @ ${clock(w.at)}`;
  return `${start} for ${durationPhrase(w.hours)} (${reasonText(w)})`;
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

const windowCharts = computed(() =>
  rideWindows.value.map((w, i) => (w.bars && w.bars.length ? chartFor(w.bars, i) : null))
);
const hasAnyFeels = computed(() => windowCharts.value.some((c) => c && c.feels));

// Which series are visible (toggled via the legend). Both on by default.
const showActual = ref(true);
const showFeels = ref(true);
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
          <h3>Riding conditions</h3>
          <div class="ride-row">
            <div class="big">
              <span class="bigval" :style="{ color: tempColor }">
                {{ cur.temp != null ? cur.temp + "°" : "—" }}
              </span>
              <span class="unit">F</span>
            </div>
            <div class="metrics">
              <span v-if="cur.feels != null">Feels {{ cur.feels }}°</span>
              <span v-if="cur.humidity != null">💧 {{ cur.humidity }}% RH</span>
            </div>
          </div>
          <ConditionSummary :summary="summary" :result="result" :show="['temp']" :temp-labels="tempLabels" />
        </section>

        <!-- Trail conditions -->
        <section class="block trail">
          <h3>Trail conditions</h3>
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

        <!-- Ideal ride windows -->
        <div class="windows" :class="{ none: !rideWindows.length }">
          <div class="w-head">
            <div class="w-label">🚵 Ideal ride windows</div>
            <div v-if="rideWindows.length && hasAnyFeels" class="w-legend">
              <button class="leg" :class="{ off: !showActual }" @click="showActual = !showActual">
                <span class="leg-line solid"></span>Actual
              </button>
              <button class="leg" :class="{ off: !showFeels }" @click="showFeels = !showFeels">
                <span class="leg-line dashed"></span>Feels like
              </button>
            </div>
          </div>
          <ul v-if="rideWindows.length" class="w-list">
            <li v-for="(w, i) in rideWindows" :key="i" class="w-item">
              <div class="w-text">{{ windowText(w) }}</div>
              <div v-if="windowCharts[i]" class="w-chart">
                <div class="w-temps">
                  <span
                    v-for="(b, bi) in w.bars"
                    :key="bi"
                    class="w-t"
                    :style="{ color: showActual ? tierHex(b.tier, b.dir) : tierHex(b.feelsTier, b.feelsDir) }"
                  ><template v-if="showActual">{{ b.temp != null ? b.temp + "°" : "—"
                    }}<small
                      v-if="showFeels && b.feels != null && b.feels !== b.temp"
                      class="w-feels"
                      :style="{ color: tierHex(b.feelsTier, b.feelsDir) }"
                    > ({{ b.feels }}°)</small></template><template
                    v-else-if="showFeels">{{ b.feels != null ? b.feels + "°" : "—" }}</template></span>
                </div>
                <svg class="w-spark" viewBox="0 0 100 46" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient :id="windowCharts[i].gradId" x1="0" y1="0" x2="1" y2="0">
                      <stop
                        v-for="(s, si) in windowCharts[i].actual.stops"
                        :key="si"
                        :offset="s.offset"
                        :stop-color="s.color"
                      />
                    </linearGradient>
                    <linearGradient v-if="windowCharts[i].feels" :id="windowCharts[i].feelsGradId" x1="0" y1="0" x2="1" y2="0">
                      <stop
                        v-for="(s, si) in windowCharts[i].feels.stops"
                        :key="si"
                        :offset="s.offset"
                        :stop-color="s.color"
                      />
                    </linearGradient>
                  </defs>
                  <path
                    v-if="showActual && windowCharts[i].actual.area"
                    :d="windowCharts[i].actual.area"
                    :fill="`url(#${windowCharts[i].gradId})`"
                    fill-opacity="0.16"
                    stroke="none"
                  />
                  <path
                    v-if="showActual"
                    :d="windowCharts[i].actual.line"
                    fill="none"
                    :stroke="`url(#${windowCharts[i].gradId})`"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    vector-effect="non-scaling-stroke"
                  />
                  <path
                    v-if="showFeels && windowCharts[i].feels"
                    :d="windowCharts[i].feels.line"
                    fill="none"
                    :stroke="`url(#${windowCharts[i].feelsGradId})`"
                    stroke-width="2"
                    stroke-dasharray="4 3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    vector-effect="non-scaling-stroke"
                  />
                </svg>
                <div class="w-times">
                  <span v-for="(b, bi) in w.bars" :key="bi" class="w-time">
                    <span v-if="b.code != null" class="w-ico" :title="skyLabel(b.code)">{{ skyEmoji(b.code) }}</span>
                    <span class="w-clock">{{ clock(b.time) }}</span>
                  </span>
                </div>
              </div>
            </li>
          </ul>
          <div v-else class="w-none">None in the foreseeable future</div>
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
  flex: 1 1 0; min-width: 0; text-align: center; white-space: nowrap;
  font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.w-feels { font-size: 9px; font-weight: 600; }
.w-spark { width: 100%; height: 46px; display: block; overflow: visible; }
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
