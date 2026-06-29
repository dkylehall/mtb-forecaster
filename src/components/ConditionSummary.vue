<script setup>
// Plain-language windows derived from the hourly timeline. `show` selects which
// lines to render so the card can place each in its own section.
import { whenLabel, humanize, durationLabel } from "../lib/format.js";

const props = defineProps({
  summary: { type: Object, required: true },
  result: { type: Object, required: true },
  show: { type: Array, default: () => ["wet", "temp", "next"] },
  // Riding (temperature) tier labels — editable in settings.
  tempLabels: {
    type: Object,
    default: () => ({ green: "ideal", yellow: "tolerable", orange: "uncomfortable", red: "no" }),
  },
});

const DRY_NOW = { green: "Dry", yellow: "Drying", orange: "Very wet", red: "Soaked" };

function tempLine() {
  const t = props.summary.temp;
  if (!t || t.nowKey == null) return null;
  const L = props.tempLabels;
  const here = `${t.nowTemp}°F`;
  const nowLabel = cap(L[t.nowKey]);
  if (t.change) {
    const verb = t.change.dir === "up" ? "warms" : "cools";
    return `${nowLabel} now (${here}) — ${verb} to ${L[t.change.toKey]} by ${whenLabel(t.change.at)}`;
  }
  if (t.nowKey === "green") return `${nowLabel} temps (${here}) across the week`;
  return `${nowLabel} now (${here})`;
}

function wetLine() {
  const w = props.summary.wet;
  if (!w || w.nowKey == null) return null;
  if (w.alreadyRideable) {
    if (w.greenForHours != null) {
      return `Dry now — rideable for ${durationLabel(w.greenForHours, w.openEnded)} before rain returns`;
    }
    return "Dry now — good to ride";
  }
  const becomes = `rideable in ${humanize(w.rideableInHours)}`;
  if (w.greenForHours != null) {
    return `${DRY_NOW[w.nowKey]} — ${becomes}, then good for ${durationLabel(w.greenForHours, w.openEnded)}`;
  }
  return `${DRY_NOW[w.nowKey]} — ${becomes}`;
}

function nextLine() {
  const n = props.summary.next;
  if (!n) return null;
  const better = sev(n.toKey) < sev(n.fromKey);
  const verb = better ? "Improves to" : "Drops to";
  const reason = n.reason && n.reason !== "conditions" ? ` (${n.reason})` : "";
  return `Next: ${verb} ${props.tempLabels[n.toKey]} ${whenLabel(n.at)}${reason}`;
}

function sev(key) {
  return { green: 0, yellow: 1, orange: 2, red: 3 }[key] ?? 0;
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
</script>

<template>
  <div class="summary">
    <div v-if="show.includes('wet') && wetLine()" class="line">
      <span class="ico">💧</span><span>{{ wetLine() }}</span>
    </div>
    <div v-if="show.includes('temp') && tempLine()" class="line">
      <span class="ico">🌡️</span><span>{{ tempLine() }}</span>
    </div>
    <div v-if="show.includes('next') && nextLine()" class="line muted">
      <span class="ico">⏭️</span><span>{{ nextLine() }}</span>
    </div>
  </div>
</template>

<style scoped>
.summary { display: flex; flex-direction: column; gap: 5px; }
.line {
  display: flex; gap: 7px; align-items: baseline;
  font-size: 12.5px; line-height: 1.35;
}
.line .ico { flex: 0 0 auto; font-size: 12px; }
.line.muted { color: var(--muted); }
</style>
