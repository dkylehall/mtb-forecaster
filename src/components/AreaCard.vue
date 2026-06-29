<script setup>
import { computed } from "vue";
import ConditionSummary from "./ConditionSummary.vue";
import DailyOutlook from "./DailyOutlook.vue";
import { DRAINAGE } from "../lib/drying.js";
import { summarize } from "../lib/summary.js";
import { whenLabel, dateTimeLabel, clock } from "../lib/format.js";

const props = defineProps({
  area: { type: Object, required: true },
  result: { type: Object, default: null }, // computeConditions() output, or null while loading
  current: { type: Object, default: null }, // raw Open-Meteo `current` block
  error: { type: String, default: "" },
  selected: { type: Boolean, default: false },
});
const emit = defineEmits(["remove", "drainage", "select"]);

const DRAINAGE_OPTS = Object.keys(DRAINAGE); // fast / medium / slow

// Trail surface labels, color-coded by dryness tier.
const TRAIL_LABEL = { green: "Dry", yellow: "Drying", orange: "Very wet", red: "Soaked" };

const summary = computed(() =>
  props.result ? summarize(props.result, new Date()) : null
);

// Temperature is the primary rideability driver, so it sets the card's accent.
const tempColor = computed(() =>
  props.result && props.result.tempCondition ? props.result.tempCondition.color : "var(--line)"
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

const bestRide = computed(() => summary.value?.bestRide || null);
const bestRideText = computed(() => {
  const b = bestRide.value;
  if (!b) return "None in the foreseeable future";
  // "Tue, Jun 30, 8am–10am" (end shown as full date if it spills to another day).
  const sameDay = new Date(b.at).toDateString() === new Date(b.end).toDateString();
  const range = `${dateTimeLabel(b.at)}–${sameDay ? clock(b.end) : dateTimeLabel(b.end)}`;
  return b.reason ? `${range} (${b.reason})` : range;
});
</script>

<template>
  <div
    class="area-card"
    :class="{ selected }"
    :style="{ '--cond': tempColor }"
    @click="emit('select', area.id)"
  >
    <div class="head">
      <span class="drag-handle" title="Drag to reorder" @click.stop>⠿</span>
      <div class="dot" />
      <div class="names">
        <div class="name">{{ area.name }}</div>
        <div class="region">{{ area.region }}</div>
      </div>
      <button class="remove" title="Remove area" @click.stop="emit('remove', area.id)">×</button>
    </div>

    <div v-if="error" class="status err">{{ error }}</div>

    <template v-else-if="result">
      <!-- Headline takeaway: when temp + dryness next align -->
      <div class="best-ride" :class="{ none: !bestRide }">
        <span class="br-ico">🚵</span>
        <span class="br-label">Next best ride</span>
        <span class="br-val">{{ bestRideText }}</span>
      </div>

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

      <ConditionSummary :summary="summary" :result="result" :show="['next']" />

      <DailyOutlook v-if="summary" :days="summary.days" />

      <div class="drainage">
        <span class="dlabel">Soil</span>
        <select
          :value="area.drainage"
          @change.stop="emit('drainage', area.id, $event.target.value)"
          @click.stop
        >
          <option v-for="d in DRAINAGE_OPTS" :key="d" :value="d">
            {{ d }}{{ d === "fast" ? " (sandy)" : d === "slow" ? " (clay)" : "" }}
          </option>
        </select>
      </div>
    </template>

    <div v-else class="status loading">Loading…</div>
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
.drag-handle {
  cursor: grab; color: var(--muted); font-size: 14px; line-height: 1;
  padding: 0 2px; user-select: none; flex: 0 0 auto;
}
.drag-handle:hover { color: var(--text); }
.drag-handle:active { cursor: grabbing; }
.dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--cond);
  box-shadow: 0 0 10px var(--cond);
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

/* Headline "next best ride" banner */
.best-ride {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px;
  background: rgba(91, 224, 160, 0.08);
  border: 1px solid rgba(91, 224, 160, 0.35);
  border-radius: 10px;
}
.best-ride.none { background: rgba(255, 255, 255, 0.03); border-color: var(--line); }
.br-ico { flex: 0 0 auto; }
.br-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--muted); font-weight: 650;
}
.br-val { font-size: 14px; font-weight: 700; color: var(--good); margin-left: auto; }
.best-ride.none .br-val { color: var(--muted); font-weight: 600; }

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

.drainage { display: flex; align-items: center; gap: 8px; }
.dlabel {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--muted);
}
.drainage select {
  background: var(--card); color: var(--text);
  border: 1px solid var(--line); border-radius: 8px;
  padding: 4px 8px; font: inherit; font-size: 12px; cursor: pointer;
}
</style>
