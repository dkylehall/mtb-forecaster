<script setup>
// The riding-condition temperature tiers editor. Shared by the Settings modal
// and the "Customize" link next to the ideal-temp control, so both edit the
// same thing through one implementation.
//
// Mutates the passed-in reactive `settings` object directly (nested-prop
// mutation, not a prop reassignment), so App's watchers persist/recompute.
const props = defineProps({
  settings: { type: Object, required: true },
  // The ideal band (min/max °F) set on the main page. The green tier IS that
  // band, so it's shown read-only here rather than being editable twice.
  ideal: { type: Object, required: true },
});

// Keep the tiers ordered: each tier's degrees can't be less than the tier
// before it (bump the later one up if a previous value surpasses it).
function normalizeTemp() {
  const t = props.settings.temp;
  t.orange.hot = Math.max(t.orange.hot, t.yellow.hot);
  t.red.hot = Math.max(t.red.hot, t.orange.hot);
  t.orange.cold = Math.max(t.orange.cold, t.yellow.cold);
  t.red.cold = Math.max(t.red.cold, t.orange.cold);
}
</script>

<template>
  <div class="tlist">
    <div class="trow">
      <i class="sw" style="background: var(--green)"></i>
      <input class="tlabel" v-model="settings.temp.green.label" />
      <label class="tval"><input type="number" :value="ideal.min" disabled />°</label>
      <span class="tdash">–</span>
      <label class="tval"><input type="number" :value="ideal.max" disabled />°</label>
      <span class="tband">set on the main page</span>
    </div>
    <div class="trow" v-for="k in ['yellow', 'orange', 'red']" :key="k">
      <i class="sw" :style="{ background: 'var(--' + k + ')' }"></i>
      <input class="tlabel" v-model="settings.temp[k].label" />
      <label class="tval">+<input type="number" min="0" max="80" v-model.number="settings.temp[k].hot" @change="normalizeTemp" />°</label>
      <label class="tval">−<input type="number" min="0" max="80" v-model.number="settings.temp[k].cold" @change="normalizeTemp" />°</label>
    </div>
  </div>
</template>

<style scoped>
.tlist { display: flex; flex-direction: column; gap: 8px; }
.trow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sw { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex: 0 0 auto; }
.tlabel {
  flex: 1 1 120px; min-width: 100px;
  padding: 5px 8px; font-size: 13px; font-weight: 600;
}
.tband { color: var(--muted); font-size: 12px; }
.tval { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
.tval input[type="number"] {
  width: 50px; padding: 4px 6px; font-size: 13px; text-align: center;
  font-variant-numeric: tabular-nums;
}
/* Green tier is the ideal band — shown read-only, but visually like the rest. */
.tval input[type="number"]:disabled {
  color: var(--text); opacity: 1; cursor: default;
  background: var(--card-2); border-color: var(--line);
}
.tdash { color: var(--muted); font-size: 13px; }
</style>
