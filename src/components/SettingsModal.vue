<script setup>
// Adjusts the scoring thresholds. Mutates the passed-in reactive `settings`
// object directly (nested-prop mutation, not a prop reassignment), so App's
// watchers pick up changes and persist/recompute.
const props = defineProps({
  settings: { type: Object, required: true },
});
const emit = defineEmits(["close", "reset"]);

// Keep the temperature tiers ordered: each tier's degrees can't be less than the
// tier before it (bump the later one up if a previous value surpasses it).
function normalizeTemp() {
  const t = props.settings.temp;
  t.orange.hot = Math.max(t.orange.hot, t.yellow.hot);
  t.red.hot = Math.max(t.red.hot, t.orange.hot);
  t.orange.cold = Math.max(t.orange.cold, t.yellow.cold);
  t.red.cold = Math.max(t.red.cold, t.orange.cold);
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel" role="dialog" aria-label="Settings">
      <header class="p-head">
        <h2>Settings</h2>
        <button class="x" title="Close" @click="emit('close')">×</button>
      </header>

      <!-- Rainfall lookback -->
      <section class="group">
        <h3>Rainfall lookback</h3>
        <p class="hint">How many days of past rain feed the current wetness estimate.</p>
        <div class="row">
          <input type="range" min="3" max="7" step="1" v-model.number="settings.lookbackDays" />
          <span class="val">{{ settings.lookbackDays }} day{{ settings.lookbackDays === 1 ? "" : "s" }}</span>
        </div>
      </section>

      <!-- Ride windows to show -->
      <section class="group">
        <h3>Ride windows to show</h3>
        <p class="hint">How many upcoming ideal ride windows to list per area.</p>
        <div class="row">
          <input type="range" min="1" max="10" step="1" v-model.number="settings.maxWindows" />
          <span class="val">{{ settings.maxWindows }}</span>
        </div>
      </section>

      <!-- Riding (temperature) windows -->
      <section class="group">
        <h3>Riding conditions — temperature tiers</h3>
        <p class="hint">Rename each tier and set how far outside your ideal band it reaches (hotter / colder).</p>
        <div class="tlist">
          <div class="trow">
            <i class="sw" style="background: var(--green)"></i>
            <input class="tlabel" v-model="settings.temp.green.label" />
            <span class="tband">your ideal band (set on the main page)</span>
          </div>
          <div class="trow" v-for="k in ['yellow', 'orange', 'red']" :key="k">
            <i class="sw" :style="{ background: 'var(--' + k + ')' }"></i>
            <input class="tlabel" v-model="settings.temp[k].label" />
            <label class="tval">+<input type="number" min="0" max="80" v-model.number="settings.temp[k].hot" @change="normalizeTemp" />°</label>
            <label class="tval">−<input type="number" min="0" max="80" v-model.number="settings.temp[k].cold" @change="normalizeTemp" />°</label>
          </div>
        </div>
      </section>

      <!-- Trail (dry-time) windows -->
      <section class="group">
        <h3>Trail conditions — dry-time windows</h3>
        <p class="hint">Hours until a trail is dry that separate each tier.</p>
        <div class="grid">
          <span class="lbl"><i class="sw" style="background: var(--yellow)"></i> Drying up to</span>
          <label><input type="number" min="1" max="240" v-model.number="settings.dry.drying" /> h</label>
          <span></span>

          <span class="lbl"><i class="sw" style="background: var(--orange)"></i> Very wet up to</span>
          <label><input type="number" min="1" max="240" v-model.number="settings.dry.wet" /> h</label>
          <span></span>
        </div>
        <p class="note">Beyond Very wet reads <span style="color: var(--red)">Soaked</span>.</p>
      </section>

      <footer class="p-foot">
        <button class="reset" @click="emit('reset')">Reset to defaults</button>
        <button class="done" @click="emit('close')">Done</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(5, 8, 18, 0.6);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 6vh 16px; overflow: auto;
}
.panel {
  width: min(520px, 100%);
  background: linear-gradient(180deg, var(--card), var(--card-2));
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: 18px 20px;
}
.p-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.p-head h2 { margin: 0; font-size: 18px; }
.x { border: none; background: transparent; color: var(--muted); font-size: 24px; line-height: 1; cursor: pointer; }
.x:hover { color: var(--text); }

.group { padding: 12px 0; border-top: 1px solid var(--line); }
.group h3 { margin: 0 0 2px; font-size: 13px; }
.hint { margin: 0 0 10px; color: var(--muted); font-size: 12px; }
.note { margin: 8px 0 0; color: var(--muted); font-size: 12px; }

.row { display: flex; align-items: center; gap: 10px; }
.row input[type="range"] { width: 180px; accent-color: var(--accent); cursor: pointer; }
.val { color: var(--text); font-variant-numeric: tabular-nums; font-size: 13px; }

.grid {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 8px 12px;
  align-items: center;
}
.lbl { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
.grid label { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 3px; }
.grid input[type="number"] {
  width: 52px; padding: 4px 6px; font-size: 13px; text-align: center;
  font-variant-numeric: tabular-nums;
}
.sw { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex: 0 0 auto; }

/* Editable temperature tiers */
.tlist { display: flex; flex-direction: column; gap: 8px; }
.trow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
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

.p-foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 14px; }
.reset { background: transparent; color: var(--muted); }
.reset:hover { color: var(--text); }
.done {
  border-color: var(--accent); background: var(--card-2); color: var(--text); font-weight: 600;
}
</style>
