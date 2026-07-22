<script setup>
// Adjusts the scoring thresholds. Mutates the passed-in reactive `settings`
// object directly (nested-prop mutation, not a prop reassignment), so App's
// watchers pick up changes and persist/recompute.
import TempTiers from "./TempTiers.vue";

const props = defineProps({
  settings: { type: Object, required: true },
  // The ideal riding band (min/max °F) set on the main page. The green tier IS
  // this band, so we display it read-only here rather than letting it be edited.
  ideal: { type: Object, required: true },
});
const emit = defineEmits(["close", "reset"]);
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

      <!-- Auto-refresh -->
      <section class="group">
        <h3>Auto-refresh</h3>
        <p class="hint">How often to re-fetch weather for every area while the app is open.</p>
        <div class="row">
          <select v-model.number="settings.refreshMinutes">
            <option :value="0">Off</option>
            <option :value="10">Every 10 minutes</option>
            <option :value="15">Every 15 minutes</option>
            <option :value="30">Every 30 minutes</option>
            <option :value="60">Every hour</option>
          </select>
        </div>
      </section>

      <!-- Days of forecast to display -->
      <section class="group">
        <h3>Days of forecast to display</h3>
        <p class="hint">How many days to show in each area's ride outlook.</p>
        <div class="row">
          <input type="range" min="1" max="7" step="1" v-model.number="settings.maxWindows" />
          <span class="val">{{ settings.maxWindows }} day{{ settings.maxWindows === 1 ? "" : "s" }}</span>
        </div>
      </section>

      <!-- Riding (temperature) windows -->
      <section class="group">
        <h3>Riding conditions — temperature tiers</h3>
        <p class="hint">Rename each tier and set how far outside your ideal band it reaches (hotter / colder).</p>
        <TempTiers :settings="settings" :ideal="ideal" />
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
.row select {
  padding: 6px 8px; font-size: 13px; cursor: pointer;
  background: var(--card-2); color: var(--text); border: 1px solid var(--line); border-radius: 8px;
}
.val { color: var(--text); font-variant-numeric: tabular-nums; font-size: 13px; }

.p-foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 14px; }
.reset { background: transparent; color: var(--muted); }
.reset:hover { color: var(--text); }
.done {
  border-color: var(--accent); background: var(--card-2); color: var(--text); font-weight: 600;
}
</style>
