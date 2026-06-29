<script setup>
import { computed } from "vue";
import ConditionSummary from "./ConditionSummary.vue";
import { summarize } from "../lib/summary.js";
import { whenLabel, clock } from "../lib/format.js";

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

const TRAIL_LABEL = { green: "Dry", yellow: "Drying", orange: "Very wet", red: "Soaked" };

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

const TIER_COLOR = {
  green: "var(--green)", yellow: "var(--yellow)", orange: "var(--orange)", red: "var(--red)",
};
function tierColor(t) {
  return TIER_COLOR[t] || "var(--muted)";
}
function barHeight(temp) {
  if (temp == null) return "20%";
  const h = Math.max(0, Math.min(1, (temp - 30) / 70));
  return `${Math.round(20 + h * 80)}%`;
}
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
            <span class="trail-status" :style="{ color: result.dryCondition.color }">
              {{ TRAIL_LABEL[result.dryCondition.key] }}
            </span>
            <span class="metrics">
              <span>Recent {{ result.recentRainIn }}"</span>
              <span>Next rain: {{ nextRainText }}</span>
            </span>
          </div>
          <ConditionSummary :summary="summary" :result="result" :show="['wet']" />
        </section>

        <!-- Ideal ride windows -->
        <div class="windows" :class="{ none: !rideWindows.length }">
          <div class="w-label">🚵 Ideal ride windows</div>
          <ul v-if="rideWindows.length" class="w-list">
            <li v-for="(w, i) in rideWindows" :key="i" class="w-item">
              <div class="w-text">{{ windowText(w) }}</div>
              <div v-if="w.bars && w.bars.length" class="w-bars">
                <div v-for="(b, bi) in w.bars" :key="bi" class="w-bar">
                  <span class="w-temp">{{ b.temp != null ? b.temp + "°" : "—" }}</span>
                  <span class="w-track">
                    <span class="w-fill" :style="{ height: barHeight(b.temp), background: tierColor(b.tier) }"></span>
                  </span>
                  <span class="w-time">{{ clock(b.time) }}</span>
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
  padding: 11px 13px;
  background: rgba(91, 224, 160, 0.08);
  border: 1px solid rgba(91, 224, 160, 0.35);
  border-radius: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.windows.none { background: rgba(255, 255, 255, 0.03); border-color: var(--line); }
.w-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); font-weight: 650; }
.w-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px; }
.w-item { display: flex; flex-direction: column; gap: 5px; }
.w-text { font-size: 13.5px; font-weight: 650; color: var(--good); font-variant-numeric: tabular-nums; }
.w-none { font-size: 13px; color: var(--muted); }

.w-bars { display: flex; gap: 4px; align-items: flex-end; }
.w-bar { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.w-temp { font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
.w-track { width: 100%; height: 52px; display: flex; align-items: flex-end; }
.w-fill { width: 100%; border-radius: 3px 3px 0 0; min-height: 3px; }
.w-time { font-size: 9px; color: var(--muted); white-space: nowrap; }

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
