<script setup>
// A focused editor for just the riding-condition temperature tiers, opened from
// the "Customize" link beside the ideal-temp control. Same editor the Settings
// modal shows — this is the shortcut for it, right where the band is set.
import TempTiers from "./TempTiers.vue";

defineProps({
  settings: { type: Object, required: true },
  ideal: { type: Object, required: true },
});
const emit = defineEmits(["close"]);
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel" role="dialog" aria-label="Temperature tiers">
      <header class="p-head">
        <h2>Riding conditions — temperature tiers</h2>
        <button class="x" title="Close" @click="emit('close')">×</button>
      </header>
      <p class="hint">
        Rename each tier and set how far outside your ideal band it reaches (hotter / colder).
      </p>
      <TempTiers :settings="settings" :ideal="ideal" />
      <footer class="p-foot">
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
  padding: 8vh 16px; overflow: auto;
}
.panel {
  width: min(520px, 100%);
  background: linear-gradient(180deg, var(--card), var(--card-2));
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: 18px 20px;
}
.p-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
.p-head h2 { margin: 0; font-size: 16px; }
.x { border: none; background: transparent; color: var(--muted); font-size: 24px; line-height: 1; cursor: pointer; }
.x:hover { color: var(--text); }
.hint { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
.p-foot { display: flex; justify-content: flex-end; margin-top: 14px; }
.done {
  border-color: var(--accent); background: var(--card-2); color: var(--text); font-weight: 600;
}
</style>
