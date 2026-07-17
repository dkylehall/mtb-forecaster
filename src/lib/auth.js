// Auth + sync bootstrap — the one place that knows Supabase exists.
//
// INERT BY DEFAULT. With no Supabase env vars set, isSyncConfigured() is false,
// initAuth() returns immediately, and the app runs exactly as it does today:
// anonymous, local-only, no network identity. Sync switches on the moment both
// env vars are present — no other code changes.
//
// To switch it on:
//   1. Create a Supabase project; run supabase/schema.sql in its SQL editor.
//   2. Put these in .env.local (both are public — they ship in the bundle, which
//      is expected for the anon key; RLS is what protects the data):
//        VITE_SUPABASE_URL=https://<project>.supabase.co
//        VITE_SUPABASE_ANON_KEY=<anon public key>
//   3. That's it — AuthControls.vue's Sync button appears and calls signIn().
//
// @supabase/supabase-js is installed but imported dynamically and only when
// configured, so Vite code-splits it into its own chunk. While inert that chunk
// is never fetched — anonymous visitors download none of it.

import { setRemote } from "./store.js";
import { createSupabaseAreas } from "./remote/supabase.js";
import { setRemotePrefs } from "./prefs.js";
import { createSupabasePrefs } from "./remote/supabase.js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True only when both env vars are present. The single gate for everything. */
export function isSyncConfigured() {
  return Boolean(URL && ANON_KEY);
}

/** @type {object|null} lazily-created Supabase client */
let client = null;

async function getClient() {
  if (client) return client;
  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(URL, ANON_KEY);
  return client;
}

/**
 * Wire auth state to the sync layer. No-op (and safe to call) when unconfigured.
 *
 * On sign-in: registers the per-user area + prefs adapters, then calls
 * onSignedIn() so the app can pull and re-hydrate. On sign-out: clears both
 * adapters, dropping the app back to local-only without a reload.
 *
 * @param {{ onSignedIn?: () => void|Promise<void>, onChange?: (session:object|null) => void }} hooks
 */
export async function initAuth({ onSignedIn, onChange } = {}) {
  if (!isSyncConfigured()) return;
  const sb = await getClient();

  const apply = (session) => {
    if (session?.user) {
      setRemote(createSupabaseAreas(sb, session.user.id));
      setRemotePrefs(createSupabasePrefs(sb, session.user.id));
    } else {
      setRemote(null);
      setRemotePrefs(null);
    }
    onChange?.(session);
  };

  // Existing session on load (returning user), then future changes.
  const { data } = await sb.auth.getSession();
  apply(data.session);
  if (data.session) await onSignedIn?.();

  sb.auth.onAuthStateChange(async (_event, session) => {
    apply(session);
    if (session) await onSignedIn?.();
  });
}

/** Send a magic-link sign-in email. No passwords for us to store or leak. */
export async function signIn(email) {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithOtp({ email });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  const sb = await getClient();
  await sb.auth.signOut();
}
