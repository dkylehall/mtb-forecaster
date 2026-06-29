<script setup>
// 7-day outlook strip: one chip per day, colored by that day's daytime score.
const props = defineProps({
  days: { type: Array, required: true },
});

function weekday(date) {
  // date is "YYYY-MM-DD"; append midday to avoid TZ rollover.
  return new Date(date + "T12:00").toLocaleDateString(undefined, { weekday: "short" });
}
function title(d) {
  const parts = [`${d.tier.label}`];
  if (d.hi != null) parts.push(`${Math.round(d.hi)}/${Math.round(d.lo)}°F`);
  if (d.rainIn > 0) parts.push(`${d.rainIn}" rain`);
  parts.push(`(driven by ${d.reason})`);
  return `${weekday(d.date)}: ${parts.join(" · ")}`;
}
</script>

<template>
  <div class="outlook">
    <div class="o-label">7-day outlook</div>
    <div class="strip">
      <div v-for="d in days" :key="d.date" class="day" :title="title(d)">
        <span class="wd">{{ weekday(d.date) }}</span>
        <span class="bar" :style="{ background: d.tier.color }">
          <span v-if="d.rainIn > 0" class="rain">💧</span>
        </span>
        <span class="hilo" v-if="d.hi != null">{{ Math.round(d.hi) }}°</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.outlook { display: flex; flex-direction: column; gap: 5px; }
.o-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--muted);
}
.strip { display: flex; gap: 4px; }
.day {
  flex: 1 1 0; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
}
.wd { font-size: 10px; color: var(--muted); }
.bar {
  width: 100%; height: 16px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
}
.bar .rain { font-size: 9px; }
.hilo { font-size: 11px; font-variant-numeric: tabular-nums; }
</style>
