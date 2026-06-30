<script setup>
import { computed } from "vue";
import { timeLeftLabel } from "../lib/format.js";

const props = defineProps({
  area: { type: Object, required: true },
  result: { type: Object, default: null }, // computeConditions() output, or null while loading
  current: { type: Object, default: null }, // raw Open-Meteo `current` block
  error: { type: String, default: "" },
});
const emit = defineEmits(["remove", "open"]);

// Trail dryness shown as drying time: "Dry" (green) when ready, otherwise
// "drying for N more hours" tinted by the green→red gradient color.
const isDry = computed(() => !props.result || props.result.hoursUntilDry <= 0);
const wetText = computed(() =>
  isDry.value ? "Dry" : `drying for ${timeLeftLabel(props.result.hoursUntilDry)}`
);
const wetColor = computed(() =>
  isDry.value ? "var(--green)" : props.result.dryColor
);

// The dot shows overall go/no-go (combined temp + trail).
const statusColor = computed(() =>
  props.result ? props.result.condition.color : "var(--line)"
);
const tempColor = computed(() =>
  props.result && props.result.tempCondition ? props.result.tempCondition.color : "var(--text)"
);
const curTemp = computed(() => {
  const c = props.current;
  const t = c?.temperature_2m ?? (props.result ? props.result.tempNow : null);
  return t != null ? Math.round(t) : null;
});
const feels = computed(() => {
  const f = props.current?.apparent_temperature;
  return f != null ? Math.round(f) : null;
});
const rh = computed(() => {
  const h = props.current?.relative_humidity_2m;
  return h != null ? Math.round(h) : null;
});
</script>

<template>
  <div class="area-card" @click="emit('open', area.id)">
    <div class="dot" :style="{ background: statusColor, boxShadow: '0 0 10px ' + statusColor }" />
    <div class="names">
      <div class="name">{{ area.name }}</div>
      <div class="region">{{ area.region }}</div>
    </div>

    <div v-if="result" class="quick">
      <div class="q-head">Current conditions</div>
      <div class="q-params">
        <span class="q-field">Temp: <b :style="{ color: tempColor }">{{ curTemp != null ? curTemp + "°" : "—" }}</b></span>
        <span class="q-field">Feels like: <b :style="{ color: tempColor }">{{ feels != null ? feels + "°" : "—" }}</b></span>
        <span class="q-field">RH: <b>{{ rh != null ? rh + "%" : "—" }}</b></span>
        <span class="q-field">Trails: <b :style="{ color: wetColor }">{{ wetText }}</b></span>
      </div>
    </div>
    <div v-else-if="error" class="quick muted">retrying…</div>
    <div v-else class="quick muted">Loading…</div>

    <button class="remove" title="Remove area" @click.stop="emit('remove', area.id)">×</button>
  </div>
</template>

<style scoped>
.area-card {
  background: linear-gradient(180deg, var(--card), var(--card-2));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 11px 14px;
  display: flex;
  align-items: center;
  gap: 11px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.area-card:hover { border-color: var(--accent); }

.dot { width: 13px; height: 13px; border-radius: 50%; flex: 0 0 auto; }
.names { min-width: 0; flex: 1 1 auto; }
.name { font-weight: 650; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.region { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.quick {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  flex: 0 1 auto;
  font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums;
}
.q-head { font-weight: 650; color: var(--text); }
.q-params { display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 3px 12px; }
.q-field { white-space: nowrap; }
.q-field b { font-weight: 700; color: var(--text); }
.quick.muted { font-size: 12px; }

.remove {
  flex: 0 0 auto;
  border: none; background: transparent; color: var(--muted);
  font-size: 20px; line-height: 1; padding: 0 2px;
}
.remove:hover { color: var(--red); background: transparent; }
</style>
