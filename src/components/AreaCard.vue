<script setup>
import { computed } from "vue";
import ConditionSummary from "./ConditionSummary.vue";
import { summarize } from "../lib/summary.js";
import { whenLabel, clock } from "../lib/format.js";

const props = defineProps({
  area: { type: Object, required: true },
  result: { type: Object, default: null }, // computeConditions() output, or null while loading
  current: { type: Object, default: null }, // raw Open-Meteo `current` block
  error: { type: String, default: "" },
  selected: { type: Boolean, default: false },
  collapsed: { type: Boolean, default: false },
});
const emit = defineEmits(["remove", "select", "toggle"]);

// Trail surface labels, color-coded by dryness tier.
const TRAIL_LABEL = { green: "Dry", yellow: "Drying", orange: "Very wet", red: "Soaked" };

const summary = computed(() =>
  props.result ? summarize(props.result, new Date()) : null
);

// Temperature is the primary rideability driver, so it sets the card's accent.
const tempColor = computed(() =>
  props.result && props.result.tempCondition ? props.result.tempCondition.color : "var(--line)"
);
// The dot shows overall go/no-go (combined temp + trail).
const statusColor = computed(() =>
  props.result ? props.result.condition.color : "var(--line)"
);

// Normalized "now" comfort readings.
const cur = computed(() => {
  const c = props.current;
  const temp = c?.temperature_2m ?? (props.result ? props.result.tempNow : null);
  return {
    temp: temp != null ? Math.round(temp) : null,
    feels: c?.apparent_temperature != null ? Math.round(c.apparent_temperature) : null,
    humidity:
      c?.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : null,
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
// "(heat - 89°)", "(cold - 38°)", "(rain)", "(sunset)", …
function reasonText(w) {
  if (!w.reason) return "";
  if ((w.reason === "heat" || w.reason === "cold") && w.temp != null) {
    return `${w.reason} - ${Math.round(w.temp)}°`;
  }
  return w.reason;
}

const rideWindows = computed(() => summary.value?.rideWindows || []);
function windowText(w) {
  // e.g. "Tue Jun 30 @ sunrise (5:54am) for 3 hours (heat - 89°)"
  const start = w.startAtSunrise
    ? `${dayLabel(w.at)} @ sunrise (${clock(w.at)})`
    : `${dayLabel(w.at)} @ ${clock(w.at)}`;
  return `${start} for ${durationPhrase(w.hours)} (${reasonText(w)})`;
}
</script>

<template>
  <div
    class="area-card"
    :class="{ selected }"
    :style="{ '--cond': tempColor }"
    @click="emit('select', area.id)"
  >
    <div class="head">
      <button
        class="chev"
        :title="collapsed ? 'Expand' : 'Collapse'"
        @click.stop="emit('toggle', area.id)"
      >
        {{ collapsed ? "+" : "−" }}
      </button>
      <div class="dot" :style="{ background: statusColor, boxShadow: '0 0 10px ' + statusColor }" />
      <div class="names">
        <div class="name">{{ area.name }}</div>
        <div class="region">{{ area.region }}</div>
      </div>
      <button class="remove" title="Remove area" @click.stop="emit('remove', area.id)">×</button>
    </div>

    <template v-if="!collapsed">
    <div v-if="error" class="status err">{{ error }}</div>

    <template v-else-if="result">
      <!-- Riding conditions: temperature, the primary driver -->
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
        <ConditionSummary :summary="summary" :result="result" :show="['temp']" />
      </section>

      <!-- Trail conditions: secondary; only the status word is color-coded -->
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

      <!-- Optimal ride windows: next few times temp + dryness both align -->
      <div class="windows" :class="{ none: !rideWindows.length }">
        <div class="w-label">🚵 Ideal ride windows</div>
        <ul v-if="rideWindows.length" class="w-list">
          <li v-for="(w, i) in rideWindows" :key="i">{{ windowText(w) }}</li>
        </ul>
        <div v-else class="w-none">None in the foreseeable future</div>
      </div>
    </template>

    <div v-else class="status loading">Loading…</div>
    </template>
  </div>
</template>

<style scoped>
.area-card {
  background: linear-gradient(180deg, var(--card), var(--card-2));
  border: 1px solid var(--line);
  border-left: 5px solid var(--cond);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.area-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), var(--shadow); }

.head { display: flex; align-items: center; gap: 10px; }
.chev {
  flex: 0 0 auto;
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--muted); border-radius: 8px;
  background: var(--card); color: var(--text);
  font-size: 18px; font-weight: 700; line-height: 1; cursor: pointer;
}
.chev:hover { border-color: var(--accent); color: var(--accent); background: var(--card-2); }
.dot {
  width: 12px; height: 12px; border-radius: 50%;
  flex: 0 0 auto;
}
.names { min-width: 0; flex: 1 1 auto; }
.name { font-weight: 650; font-size: 15px; }
.region { color: var(--muted); font-size: 12px; }
.remove {
  border: none; background: transparent; color: var(--muted);
  font-size: 20px; line-height: 1; padding: 0 4px;
}
.remove:hover { color: var(--red); background: transparent; }

/* "Optimal ride windows" box */
.windows {
  padding: 9px 11px;
  background: rgba(91, 224, 160, 0.08);
  border: 1px solid rgba(91, 224, 160, 0.35);
  border-radius: 10px;
  display: flex; flex-direction: column; gap: 6px;
}
.windows.none { background: rgba(255, 255, 255, 0.03); border-color: var(--line); }
.w-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--muted); font-weight: 650;
}
.w-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.w-list li {
  font-size: 13px; font-weight: 650; color: var(--good);
  font-variant-numeric: tabular-nums;
}
.w-none { font-size: 13px; color: var(--muted); }

/* Plain sections — no colored boxes. */
.block { display: flex; flex-direction: column; gap: 6px; }
.block.trail { border-top: 1px solid var(--line); padding-top: 10px; }
.block h3 {
  margin: 0;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--muted); font-weight: 650;
}

.ride-row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.big { display: flex; align-items: baseline; gap: 3px; }
.bigval { font-size: 30px; font-weight: 750; line-height: 1; letter-spacing: -0.5px; }
.unit { font-size: 14px; color: var(--muted); }

.trail-row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.trail-status { font-size: 20px; font-weight: 750; line-height: 1; }

.metrics {
  display: flex; flex-wrap: wrap; gap: 4px 12px;
  color: var(--muted); font-size: 12.5px;
}

.status.loading, .status.err { color: var(--muted); font-size: 13px; }
.status.err { color: var(--orange); }
</style>
