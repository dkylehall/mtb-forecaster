// Areas persistence, in two layers.
//
// localStorage is the source of truth for first paint: instant, offline-safe,
// and the entire story for anonymous users — nobody has to sign in to find out
// whether the trails are dry. A remote store is optional and gets registered via
// setRemote() once someone signs in, layering cross-device sync on top. Nothing
// here knows which provider that is.

import { loadAreas, saveAreas, addArea, SEED_AREAS } from "./areas.js";

/**
 * A remote areas store. Whole-list read/replace: the list is a handful of pins,
 * so row-level diffing buys nothing but bugs.
 *
 * @typedef {object} RemoteAreas
 * @property {() => Promise<Array<object>>} list
 * @property {(areas: Array<object>) => Promise<void>} replace
 */

/** @type {RemoteAreas|null} */
let remote = null;

/** Register the signed-in user's store, or pass null on sign-out. */
export function setRemote(adapter) {
  remote = adapter;
}

export function isSynced() {
  return remote !== null;
}

/**
 * Union two lists. addArea already drops any pin within ~1,000 ft of one it
 * already holds, so a fold does the whole job.
 */
export function mergeAreas(base, incoming) {
  return incoming.reduce((acc, a) => addArea(acc, a), base);
}

/**
 * Synchronous read for first paint, seeding a first-run device with the example
 * areas.
 *
 * Pass seed: false when a session is already known. Otherwise a signed-in user
 * opening the app on a new device gets the three seeds written locally, merged
 * into their real areas on pull, and then pushed back up — permanently polluting
 * every other device they own.
 */
export function readLocal({ seed = true } = {}) {
  const saved = loadAreas();
  if (saved.length || !seed) return saved;
  const seeded = SEED_AREAS.reduce((acc, a) => addArea(acc, a), []);
  saveAreas(seeded);
  return seeded;
}

/**
 * Pull the account's areas and union them with this device's. Call it once the
 * session resolves after sign-in. Returns the merged list, or null if nobody is
 * signed in — in which case the caller keeps what it already has.
 */
export async function pullAndMerge(local) {
  if (!remote) return null;
  const theirs = await remote.list();
  const merged = mergeAreas(local, theirs);
  // The device had pins the account didn't: push the union back up.
  if (merged.length !== theirs.length) await remote.replace(merged);
  saveAreas(merged);
  return merged;
}

/**
 * Write. localStorage always and synchronously, so anonymous and offline both
 * keep working. The remote write is best-effort: a failure leaves this device
 * correct and the account stale until the next successful write.
 */
export function writeAreas(areas) {
  saveAreas(areas);
  if (remote) remote.replace(areas).catch(() => {});
}
