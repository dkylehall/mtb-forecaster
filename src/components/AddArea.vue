<script setup>
import { ref } from "vue";
import { searchPOI } from "../lib/geocode.js";

const props = defineProps({
  bias: { type: Object, default: null }, // {lat, lon} to rank nearby results first
});
const emit = defineEmits(["add"]);
const query = ref("");
const results = ref([]);
const open = ref(false);
const searching = ref(false);
let timer = null;
let seq = 0;

function onInput() {
  clearTimeout(timer);
  const q = query.value.trim();
  if (q.length < 2) {
    results.value = [];
    open.value = false;
    return;
  }
  timer = setTimeout(async () => {
    const mine = ++seq; // ignore out-of-order responses
    searching.value = true;
    try {
      const r = await searchPOI(q, { bias: props.bias });
      if (mine !== seq) return;
      results.value = r;
      open.value = true;
    } catch {
      if (mine !== seq) return;
      results.value = [];
      open.value = false;
    } finally {
      if (mine === seq) searching.value = false;
    }
  }, 280);
}

function pick(r) {
  emit("add", r);
  query.value = "";
  results.value = [];
  open.value = false;
}
</script>

<template>
  <div class="add-area">
    <input
      v-model="query"
      type="text"
      placeholder="Search a resort, trailhead, landmark, or city…"
      autocomplete="off"
      @input="onInput"
      @focus="open = results.length > 0"
    />
    <div v-if="open" class="results">
      <div
        v-for="r in results"
        :key="`${r.lat},${r.lon}`"
        class="result"
        @click="pick(r)"
      >
        <span class="rname">{{ r.name }}</span>
        <span class="rregion">{{ r.region }}</span>
      </div>
      <div v-if="!results.length && !searching" class="result empty">No matches</div>
    </div>
  </div>
</template>

<style scoped>
.add-area { position: relative; width: min(360px, 100%); }
.add-area input { width: 100%; }
.results {
  position: absolute;
  top: 44px; left: 0; right: 0;
  background: var(--card-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  z-index: 20;
  box-shadow: var(--shadow);
}
.result {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 9px 12px; cursor: pointer; font-size: 13px;
  border-bottom: 1px solid var(--line);
}
.result:last-child { border-bottom: none; }
.result:hover { background: var(--card); }
.rregion { color: var(--muted); }
</style>
