// Scoring preferences persistence — the settings sibling of store.js/areas.
//
// Unlike areas (a list that unions cleanly across devices), preferences are a
// bag of independent localStorage keys with no natural merge: if this laptop
// wants an ideal band of 70–76 and the phone wants 68–74, neither is "more
// right". So this layer treats the whole bag as one opaque blob and syncs it
// last-writer-wins, rather than pretending a field-level merge exists.
//
// The blob is a map of {localStorage key -> raw stored string}. Keeping it as
// the raw strings means this file never has to understand the shape of any one
// setting — App.vue's own loaders stay the single source of truth for parsing.

// Every key that holds a user preference. Adding a new setting? Add its key
// here and its writes flow to the cloud for free.
export const PREF_KEYS = [
  "mtb_settings_v1", // lookback, temp tiers, maxWindows, refreshMinutes
  "trail_ideal_temp_v1", // ideal riding band {min,max}
  "mtb_precip_tol", // precip-chance tolerance
  "mtb_basis", // temp vs. feels-like
  "mtb_sort", // list sort order
];

/**
 * A remote preferences store: read/replace the whole blob for the signed-in
 * user. One row per user, not one per key.
 *
 * @typedef {object} RemotePrefs
 * @property {() => Promise<Object<string,string>|null>} get
 * @property {(blob: Object<string,string>) => Promise<void>} set
 */

/** @type {RemotePrefs|null} */
let remote = null;

/** Register the signed-in user's prefs store, or null on sign-out. */
export function setRemotePrefs(adapter) {
  remote = adapter;
}

export function isPrefsSynced() {
  return remote !== null;
}

/** Snapshot the current local preferences as a {key -> raw string} blob. */
export function snapshotPrefs() {
  const blob = {};
  for (const k of PREF_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) blob[k] = v;
  }
  return blob;
}

/**
 * Write a blob back to localStorage. Only touches keys present in the blob, so a
 * cloud record saved before a new setting existed won't wipe that setting's
 * local value. Returns the keys it changed, so the caller knows whether a
 * re-hydrate of reactive state is worth doing.
 */
export function applyPrefs(blob) {
  const changed = [];
  for (const k of PREF_KEYS) {
    if (!(k in blob)) continue;
    if (localStorage.getItem(k) === blob[k]) continue;
    try {
      localStorage.setItem(k, blob[k]);
      changed.push(k);
    } catch {
      /* quota / private mode — skip this key */
    }
  }
  return changed;
}

/**
 * Persist one preference. localStorage always and synchronously (anonymous and
 * offline keep working); the remote push is best-effort and pushes the whole
 * blob, since the remote record is the blob. A failed push leaves this device
 * correct and the account stale until the next successful write.
 *
 * `value` must already be the string you want stored — callers JSON.stringify
 * their own shapes, exactly as the old inline setItem calls did.
 */
export function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode errors, as the old call sites did */
  }
  if (remote) remote.set(snapshotPrefs()).catch(() => {});
}

/**
 * On sign-in: pull the account's prefs and apply them locally. Last-writer-wins
 * with the cloud as winner when a record exists — a fresh device's local values
 * are just defaults, so the account's saved prefs should take over. If the cloud
 * has nothing yet (first sign-in ever), push this device's prefs up to seed it.
 *
 * Returns the list of changed keys (possibly empty), or null if not synced.
 * A non-empty list is the caller's cue to re-hydrate reactive state.
 */
export async function pullPrefs() {
  if (!remote) return null;
  const blob = await remote.get();
  if (!blob) {
    await remote.set(snapshotPrefs());
    return [];
  }
  return applyPrefs(blob);
}
