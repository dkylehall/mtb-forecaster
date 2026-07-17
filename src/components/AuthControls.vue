<script setup>
// Sign-in control for cross-device sync. Renders NOTHING until Supabase is
// configured (isSyncConfigured()), so today it's invisible and the header looks
// exactly as it did. Once env vars are set, it shows a "Sync" button that opens
// a magic-link email form, or the signed-in email with a sign-out.
import { ref } from "vue";
import { isSyncConfigured, signIn, signOut } from "../lib/auth.js";

// Parent passes the current session's email (or null). Kept a prop so App.vue
// stays the single owner of auth state via initAuth's onChange hook.
const props = defineProps({
  email: { type: String, default: null },
});

const configured = isSyncConfigured();
const open = ref(false);
const address = ref("");
const status = ref(null); // null | "sending" | "sent" | error string

async function submit() {
  const value = address.value.trim();
  if (!value) return;
  status.value = "sending";
  try {
    await signIn(value);
    status.value = "sent";
  } catch (e) {
    status.value = e.message || "Couldn't send the sign-in link";
  }
}
</script>

<template>
  <div v-if="configured" class="auth">
    <template v-if="email">
      <span class="who" :title="email">{{ email }}</span>
      <button class="link" @click="signOut">Sign out</button>
    </template>

    <template v-else>
      <button class="refresh" title="Sync across devices" @click="open = !open">⇄ Sync</button>

      <div v-if="open" class="pop" @click.stop>
        <p v-if="status === 'sent'" class="ok">Check your email for a sign-in link.</p>
        <template v-else>
          <label>Sync your areas and settings across devices.</label>
          <div class="row">
            <input
              type="email"
              placeholder="you@example.com"
              v-model="address"
              @keydown.enter="submit"
            />
            <button class="link" :disabled="status === 'sending'" @click="submit">
              {{ status === "sending" ? "Sending…" : "Send link" }}
            </button>
          </div>
          <p v-if="status && status !== 'sending'" class="err">{{ status }}</p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.auth {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}
.who {
  max-width: 12ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  opacity: 0.8;
}
.link {
  background: none;
  border: none;
  color: var(--accent, #6ab0ff);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 4px 6px;
}
.link:disabled {
  opacity: 0.5;
  cursor: default;
}
.pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  width: 260px;
  padding: 12px;
  border-radius: 10px;
  background: var(--panel, #182234);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.pop label {
  display: block;
  font-size: 0.8rem;
  opacity: 0.8;
  margin-bottom: 8px;
}
.pop .row {
  display: flex;
  gap: 6px;
}
.pop input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.2);
  color: inherit;
}
.ok {
  font-size: 0.85rem;
  margin: 0;
}
.err {
  font-size: 0.8rem;
  color: var(--red, #ff6b6b);
  margin: 8px 0 0;
}
</style>
