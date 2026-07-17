// Supabase implementation of the RemoteAreas interface in ../store.js.
//
// Inert until something calls it. It imports nothing and takes the client as an
// argument, so picking a different provider means writing a sibling file with
// the same two methods rather than touching the store or App.vue.
//
// To turn it on:
//   npm i @supabase/supabase-js
//   import { createClient } from "@supabase/supabase-js";
//   import { createSupabaseAreas } from "./lib/remote/supabase.js";
//   import { setRemote, readLocal, pullAndMerge } from "./lib/store.js";
//
//   const sb = createClient(import.meta.env.VITE_SUPABASE_URL,
//                           import.meta.env.VITE_SUPABASE_ANON_KEY);
//   sb.auth.onAuthStateChange(async (_e, session) => {
//     setRemote(session ? createSupabaseAreas(sb, session.user.id) : null);
//     const merged = await pullAndMerge(readLocal({ seed: false }));
//     if (merged) areas.value = merged;
//   });
//
// Both env vars are public — they land in the client bundle, which is fine for
// the anon key and expected by Supabase. The RLS policies in supabase/schema.sql
// are what actually protect the data. Never put the service_role key here.

/**
 * @param {object} sb      a @supabase/supabase-js client
 * @param {string} userId  session.user.id
 * @returns {import("../store.js").RemoteAreas}
 */
export function createSupabaseAreas(sb, userId) {
  return {
    async list() {
      const { data, error } = await sb
        .from("areas")
        .select("name, region, lat, lon, drainage")
        .order("created_at", { ascending: true });
      if (error) throw new Error(`Couldn't load saved areas (${error.message})`);
      // The client's `id` is derived from lat/lon, so it isn't stored — addArea
      // regenerates it on the way in and the two representations stay in sync.
      return data || [];
    },

    async replace(areas) {
      // Delete-then-insert rather than upsert: the client list is authoritative
      // and tiny, and this is the only way a removal propagates. Not atomic — a
      // crash between the two leaves the account empty, which the next write
      // from any device repairs.
      const { error: delError } = await sb.from("areas").delete().eq("user_id", userId);
      if (delError) throw new Error(`Couldn't sync areas (${delError.message})`);
      if (!areas.length) return;

      const rows = areas.map((a) => ({
        user_id: userId,
        name: a.name,
        region: a.region || "",
        lat: a.lat,
        lon: a.lon,
        drainage: a.drainage || "medium",
      }));
      const { error: insError } = await sb.from("areas").insert(rows);
      if (insError) throw new Error(`Couldn't sync areas (${insError.message})`);
    },
  };
}

/**
 * Supabase implementation of the RemotePrefs interface in ../prefs.js. One row
 * per user in `prefs`, holding the whole preference blob as jsonb.
 *
 * @param {object} sb      a @supabase/supabase-js client
 * @param {string} userId  session.user.id
 * @returns {import("../prefs.js").RemotePrefs}
 */
export function createSupabasePrefs(sb, userId) {
  return {
    async get() {
      // maybeSingle: no row yet (first sign-in) is not an error, it's null.
      const { data, error } = await sb
        .from("prefs")
        .select("blob")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`Couldn't load saved settings (${error.message})`);
      return data ? data.blob : null;
    },

    async set(blob) {
      // Upsert on the user_id primary key: insert the first time, overwrite after.
      const { error } = await sb
        .from("prefs")
        .upsert({ user_id: userId, blob }, { onConflict: "user_id" });
      if (error) throw new Error(`Couldn't sync settings (${error.message})`);
    },
  };
}
