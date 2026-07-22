import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PREF_KEYS,
  snapshotPrefs,
  applyPrefs,
  writePref,
  pullPrefs,
  setRemotePrefs,
  isPrefsSynced,
} from "./prefs.js";

// jsdom isn't configured for this project (vitest runs in node), so stub the
// one browser API these functions touch.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  setRemotePrefs(null);
});

describe("snapshotPrefs / applyPrefs", () => {
  it("captures only the known preference keys", () => {
    localStorage.setItem("mtb_basis", "feels");
    localStorage.setItem("mtb_sort", "nearest");
    localStorage.setItem("unrelated_key", "ignore me");
    const blob = snapshotPrefs();
    expect(blob).toEqual({ mtb_basis: "feels", mtb_sort: "nearest" });
    expect("unrelated_key" in blob).toBe(false);
  });

  it("round-trips a snapshot back onto a fresh device", () => {
    localStorage.setItem("mtb_precip_tol", "30");
    const blob = snapshotPrefs();
    localStorage.clear();
    const changed = applyPrefs(blob);
    expect(changed).toEqual(["mtb_precip_tol"]);
    expect(localStorage.getItem("mtb_precip_tol")).toBe("30");
  });

  it("reports no change when applying identical values", () => {
    localStorage.setItem("mtb_basis", "temp");
    expect(applyPrefs({ mtb_basis: "temp" })).toEqual([]);
  });

  it("leaves a local setting untouched when the blob omits its key", () => {
    // A cloud record saved before "mtb_sort" existed must not wipe it.
    localStorage.setItem("mtb_sort", "name");
    applyPrefs({ mtb_basis: "feels" });
    expect(localStorage.getItem("mtb_sort")).toBe("name");
  });

  it("only knows the documented keys", () => {
    expect(PREF_KEYS).toEqual([
      "mtb_settings_v1",
      "trail_ideal_temp_v1",
      "mtb_precip_tol",
      "mtb_aqi_limit",
      "mtb_params_enabled",
      "mtb_area_hours",
      "mtb_basis",
      "mtb_sort",
    ]);
  });
});

describe("writePref", () => {
  it("writes locally with no remote registered", () => {
    writePref("mtb_basis", "feels");
    expect(localStorage.getItem("mtb_basis")).toBe("feels");
    expect(isPrefsSynced()).toBe(false);
  });

  it("pushes the whole blob to the remote, best-effort", async () => {
    const set = vi.fn().mockResolvedValue();
    setRemotePrefs({ get: vi.fn(), set });
    localStorage.setItem("mtb_sort", "name");
    writePref("mtb_basis", "feels");
    expect(set).toHaveBeenCalledWith({ mtb_sort: "name", mtb_basis: "feels" });
  });

  it("swallows a remote push failure without throwing", () => {
    setRemotePrefs({ get: vi.fn(), set: vi.fn().mockRejectedValue(new Error("offline")) });
    expect(() => writePref("mtb_basis", "temp")).not.toThrow();
    expect(localStorage.getItem("mtb_basis")).toBe("temp");
  });
});

describe("pullPrefs", () => {
  it("returns null when not synced", async () => {
    expect(await pullPrefs()).toBe(null);
  });

  it("applies the cloud blob, cloud winning over local", async () => {
    localStorage.setItem("mtb_basis", "temp");
    setRemotePrefs({ get: vi.fn().mockResolvedValue({ mtb_basis: "feels" }), set: vi.fn() });
    const changed = await pullPrefs();
    expect(changed).toEqual(["mtb_basis"]);
    expect(localStorage.getItem("mtb_basis")).toBe("feels");
  });

  it("seeds an empty cloud from local on first sign-in", async () => {
    localStorage.setItem("mtb_sort", "nearest");
    const set = vi.fn().mockResolvedValue();
    setRemotePrefs({ get: vi.fn().mockResolvedValue(null), set });
    const changed = await pullPrefs();
    expect(changed).toEqual([]);
    expect(set).toHaveBeenCalledWith({ mtb_sort: "nearest" });
  });
});
