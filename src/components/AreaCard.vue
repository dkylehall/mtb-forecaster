<script setup>
import { computed } from "vue";
import ConditionSummary from "./ConditionSummary.vue";
import DailyOutlook from "./DailyOutlook.vue";
import { DRAINAGE } from "../lib/drying.js";
import { summarize } from "../lib/summary.js";
import { whenLabel } from "../lib/format.js";

const props = defineProps({
  area: { type: Object, required: true },
  result: { type: Object, default: null }, // computeConditions() output, or null while loading
  current: { type: Object, default: null }, // raw Open-Meteo `current` block
  error: { type: String, default: "" },
  selected: { type: Boolean, default: false },
});
const emit = defineEmits(["remove", "drainage", "select"]);

const DRAINAGE_OPTS = Object.keys(DRAINAGE); // fast / medium / slow

const summary = computed(() =>
  props.result ? summarize(props.result, new Date()) : null
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
</script>

<template>
  <div
    class="area-card"
    :class="{ selected }"
    :style="{ '--cond': result ? result.condition.color : 'var(--line)' }"
    @click="emit('select', area.id)"
  >
    <!-- Identity column -->
    <div class="identity">
      <div class="head">
        <div class="dot" />
        <div class="names">
          <div class="name">{{ area.name }}</div>
          <div class="region">{{ area.region }}</div>
        </div>
        <button class="remove" title="Remove area" @click.stop="emit('remove', area.id)">×</button>
      </div>
      <span v-if="result" class="verdict" :style="{ color: result.condition.color }">
        {{ result.condition.label }}
      </span>
      <div v-if="result" class="drainage">
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
    </div>

    <div v-if="error" class="status err">{{ error }}</div>

    <template v-else-if="result">
      <!-- Two condition panes -->
      <div class="panes">
        <!-- Riding conditions: the air (temp / feels-like / humidity) -->
        <section
          class="pane"
          :style="{ '--accent': result.tempCondition ? result.tempCondition.color : 'var(--line)' }"
        >
          <h3>Riding conditions</h3>
          <div class="big">
            <span class="bigval">{{ cur.temp != null ? cur.temp + "°" : "—" }}</span>
            <span class="unit">F</span>
          </div>
          <div class="metrics">
            <span v-if="cur.feels != null">Feels {{ cur.feels }}°</span>
            <span v-if="cur.humidity != null">💧 {{ cur.humidity }}% RH</span>
          </div>
          <ConditionSummary :summary="summary" :result="result" :show="['temp']" />
        </section>

        <!-- Trail conditions: the surface (wetness / rain) -->
        <section
          class="pane"
          :style="{ '--accent': result.dryCondition ? result.dryCondition.color : 'var(--line)' }"
        >
          <h3>Trail conditions</h3>
          <div class="big text">
            <span class="bigval" :style="{ color: result.dryCondition.color }">
              {{ result.dryCondition.label }}
            </span>
          </div>
          <div class="metrics">
            <span>Recent {{ result.recentRainIn }}"</span>
            <span>Next rain: {{ nextRainText }}</span>
          </div>
          <ConditionSummary :summary="summary" :result="result" :show="['wet']" />
        </section>
      </div>

      <!-- Outlook column -->
      <div class="aside">
        <DailyOutlook v-if="summary" :days="summary.days" />
        <ConditionSummary :summary="summary" :result="result" :show="['next']" />
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
  flex-direction: row;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 16px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.area-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), var(--shadow); }

/* Identity column */
.identity {
  flex: 0 0 188px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.head { display: flex; align-items: center; gap: 10px; }
.dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--cond);
  box-shadow: 0 0 10px var(--cond);
  flex: 0 0 auto;
}
.names { min-width: 0; flex: 1 1 auto; }
.name { font-weight: 650; font-size: 16px; }
.region { color: var(--muted); font-size: 12px; }
.verdict { font-size: 15px; font-weight: 700; white-space: nowrap; }
.remove {
  border: none; background: transparent; color: var(--muted);
  font-size: 20px; line-height: 1; padding: 0 4px; align-self: flex-start;
}
.remove:hover { color: var(--red); background: transparent; }

/* Two side-by-side panes: riding (air) vs trail (surface). */
.panes {
  flex: 1 1 380px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  min-width: 0;
}

/* Outlook column */
.aside {
  flex: 1 1 280px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  min-width: 0;
}
.pane {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-top: 3px solid var(--accent);
  border-radius: 11px;
  padding: 10px 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pane h3 {
  margin: 0;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--muted); font-weight: 650;
}
.big { display: flex; align-items: baseline; gap: 3px; min-height: 28px; }
.bigval { font-size: 26px; font-weight: 750; line-height: 1; letter-spacing: -0.5px; }
.big.text .bigval { font-size: 19px; line-height: 1.1; }
.unit { font-size: 13px; color: var(--muted); }
.pane .metrics {
  display: flex; flex-wrap: wrap; gap: 4px 12px;
  color: var(--muted); font-size: 12px;
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

@media (max-width: 360px) {
  .panes { grid-template-columns: 1fr; }
}
</style>
