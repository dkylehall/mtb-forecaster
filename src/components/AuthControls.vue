<script setup>
// Sign-in control for cross-device sync. Renders NOTHING until Supabase is
// configured (isSyncConfigured()), so while inert the header looks exactly as it
// did. Once env vars are set it shows a "Sync" button offering Google sign-in,
// or the signed-in email with a sign-out.
import { ref } from "vue";
import { isSyncConfigured, signInWithGoogle, signOut } from "../lib/auth.js";

// Parent passes the current session's email (or null). Kept a prop so App.vue
// stays the single owner of auth state via initAuth's onChange hook.
defineProps({
  email: { type: String, default: null },
});

const configured = isSyncConfigured();
const open = ref(false);
const error = ref("");

async function google() {
  error.value = "";
  try {
    // Redirects the page to Google; nothing after this runs on success.
    await signInWithGoogle();
  } catch (e) {
    error.value = e.message || "Couldn't start Google sign-in";
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
        <label>Sync your areas and settings across devices.</label>
        <button class="google" @click="google">Continue with Google</button>
        <p v-if="error" class="err">{{ error }}</p>
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
.google {
  width: 100%;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: #fff;
  color: #1f1f1f;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.google:hover {
  background: #f2f2f2;
}
.err {
  font-size: 0.8rem;
  color: var(--red, #ff6b6b);
  margin: 8px 0 0;
}
</style>
