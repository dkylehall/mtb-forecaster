<script setup>
// A compact colored timeline: one cell per forecast hour, colored by riding
// condition. Rain hours show a droplet. Hover for detail.
const props = defineProps({
  timeline: { type: Array, required: true },
});

function hourLabel(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const ap = h >= 12 ? "p" : "a";
  return (h % 12 || 12) + ap;
}
function title(cell) {
  const when = new Date(cell.time).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
  });
  const dry = cell.hoursUntilDry > 0 ? `${cell.hoursUntilDry}h to dry` : "dry";
  const rain = cell.precip > 0 ? `, ${cell.precip}" rain` : "";
  const temp = cell.temp != null ? `, ${cell.temp}°F` : "";
  return `${when}: ${cell.condition.label} — ${dry}${rain}${temp}`;
}
</script>

<template>
  <div class="timeline">
    <div
      v-for="(cell, i) in timeline"
      :key="cell.time"
      class="cell"
      :style="{ background: cell.condition.color }"
      :title="title(cell)"
    >
      <span v-if="cell.precip > 0" class="drop">💧</span>
      <span v-if="i % 6 === 0" class="tick">{{ hourLabel(cell.time) }}</span>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  gap: 2px;
  height: 34px;
  align-items: stretch;
}
.cell {
  flex: 1 1 0;
  border-radius: 3px;
  position: relative;
  min-width: 0;
  opacity: 0.9;
}
.drop {
  position: absolute;
  top: 1px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
}
.tick {
  position: absolute;
  bottom: -15px;
  left: 0;
  font-size: 9px;
  color: var(--muted);
  white-space: nowrap;
}
</style>
