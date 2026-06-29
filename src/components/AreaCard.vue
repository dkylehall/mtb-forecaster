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
</script>

<template>
  <div class="area-card" @click="emit('open', area.id)">
    <div class="dot" :style="{ background: statusColor, boxShadow: '0 0 10px ' + statusColor }" />
    <div class="names">
      <div class="name">{{ area.name }}</div>
      <div class="region">{{ area.region }}</div>
    </div>

    <div v-if="result" class="quick">
      <span class="q-temp" :style="{ color: tempColor }">{{ curTemp != null ? curTemp + "°" : "—" }}</span>
      <span class="q-wet" :style="{ color: wetColor }">{{ wetText }}</span>
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
  display: flex; align-items: baseline; gap: 12px; flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
.q-temp { font-size: 20px; font-weight: 750; line-height: 1; }
.q-wet { font-size: 14px; font-weight: 650; }
.quick.muted { color: var(--muted); font-size: 12px; }

.remove {
  flex: 0 0 auto;
  border: none; background: transparent; color: var(--muted);
  font-size: 20px; line-height: 1; padding: 0 2px;
}
.remove:hover { color: var(--red); background: transparent; }
</style>
