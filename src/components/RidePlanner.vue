<script setup>
// Ride Planner: pick a saved location and a date (or range), then Submit to see
// that spot's riding conditions for those days. Selecting a location only fills
// the field — nothing runs until Submit — so tabbing/clicking away never fires a
// lookup.
import { ref, computed } from "vue";

const props = defineProps({
  areas: { type: Array, default: () => [] },
  // Dates the weather API covers, {min, max} as "YYYY-MM-DD", or null until
  // weather has loaded. Bounds the pickers.
  avail: { type: Object, default: null },
  // Shared date range {from, to}; App owns it so it can hand it to the modal.
  range: { type: Object, required: true },
});
const emit = defineEmits(["plan", "update-range"]);

const query = ref("");
const open = ref(false);
const selectedId = ref("");
const selectedName = ref("");

const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.areas;
  return props.areas.filter(
    (a) =>
      a.name.toLowerCase().includes(q) || (a.region || "").toLowerCase().includes(q)
  );
});

function pick(area) {
  selectedId.value = area.id;
  selectedName.value = area.name;
  query.value = area.name;
  open.value = false;
}
// Editing the text after a pick means they're choosing again — drop the
// selection so Submit can't fire against a stale location.
function onInput() {
  if (query.value !== selectedName.value) selectedId.value = "";
  open.value = true;
}
function submit() {
  if (selectedId.value) emit("plan", selectedId.value);
}

function onFrom(e) {
  emit("update-range", { ...props.range, from: e.target.value });
}
function onTo(e) {
  emit("update-range", { ...props.range, to: e.target.value });
}
function clearDates() {
  emit("update-range", { from: "", to: "" });
}
// Close the dropdown when focus leaves the control — never selects or submits.
function onFocusOut(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) open.value = false;
}
</script>

<template>
  <div class="planner" @focusout="onFocusOut">
    <div class="p-head">🗓️ Ride planner</div>

    <div class="combo">
      <input
        class="p-input"
        type="text"
        placeholder="Search saved locations…"
        v-model="query"
        @focus="open = true"
        @input="onInput"
        @keydown.escape="open = false"
      />
      <ul v-if="open && matches.length" class="p-list">
        <li v-for="a in matches" :key="a.id" @mousedown.prevent="pick(a)">
          <span class="p-name">{{ a.name }}</span>
          <span class="p-region">{{ a.region }}</span>
        </li>
      </ul>
      <p v-else-if="open && !areas.length" class="p-empty">Add a location first.</p>
    </div>

    <div class="p-dates">
      <input
        type="date"
        class="p-date"
        :value="range.from"
        :min="avail ? avail.min : null"
        :max="avail ? avail.max : null"
        aria-label="From date"
        @change="onFrom"
      />
      <span class="p-dash">–</span>
      <input
        type="date"
        class="p-date"
        :value="range.to"
        :min="avail ? avail.min : null"
        :max="avail ? avail.max : null"
        aria-label="To date"
        @change="onTo"
      />
      <button v-if="range.from || range.to" class="p-clear" @click="clearDates">Clear</button>
    </div>

    <div class="p-actions">
      <button class="p-submit" :disabled="!selectedId" @click="submit">Show conditions</button>
      <span class="p-hint">{{
        selectedId
          ? range.from || range.to
            ? "For the selected dates."
            : "For the next few days."
          : "Pick a saved location, then Submit."
      }}</span>
    </div>
  </div>
</template>

<style scoped>
.planner {
  display: flex; flex-direction: column; gap: 9px;
  padding: 11px 14px;
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
}
.p-head {
  text-transform: uppercase; letter-spacing: 0.6px; font-size: 10.5px;
  color: var(--muted); font-weight: 650;
}
.combo { position: relative; }
.p-input {
  width: 100%; padding: 8px 10px; font-size: 13px;
  background: var(--card-2); color: var(--text);
  border: 1px solid var(--line); border-radius: 8px;
}
.p-list {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 40;
  margin: 0; padding: 4px; list-style: none; max-height: 240px; overflow: auto;
  background: var(--card-2); border: 1px solid var(--line); border-radius: 8px;
  box-shadow: var(--shadow);
}
.p-list li {
  display: flex; align-items: baseline; gap: 8px; padding: 7px 8px;
  border-radius: 6px; cursor: pointer;
}
.p-list li:hover { background: rgba(255, 255, 255, 0.06); }
.p-name { font-size: 13px; font-weight: 600; }
.p-region { font-size: 11px; color: var(--muted); }
.p-empty { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.p-dates { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.p-date {
  padding: 5px 8px; font-size: 12.5px; color-scheme: dark;
  background: var(--card-2); color: var(--text);
  border: 1px solid var(--line); border-radius: 8px; font-variant-numeric: tabular-nums;
}
.p-dash { color: var(--muted); }
.p-clear {
  padding: 4px 9px; font-size: 11px; cursor: pointer;
  background: transparent; color: var(--muted);
  border: 1px solid var(--line); border-radius: 8px;
}
.p-clear:hover { color: var(--text); border-color: var(--accent); }
.p-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.p-submit {
  padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
  border: 1px solid var(--accent); border-radius: 8px;
  background: var(--card-2); color: var(--text);
}
.p-submit:hover:not(:disabled) { background: var(--accent); color: #0b1020; }
.p-submit:disabled { opacity: 0.45; cursor: default; border-color: var(--line); }
.p-hint { font-size: 11px; color: var(--muted); }
</style>
