import { describe, it, expect } from "vitest";
import { mergeAreas } from "./store.js";

const cville = { name: "Charlottesville", region: "Virginia, US", lat: 38.0293, lon: -78.4767 };
const snowshoe = { name: "Snowshoe", region: "West Virginia, US", lat: 38.4101, lon: -79.9939 };

describe("mergeAreas", () => {
  it("unions a device's areas with the account's", () => {
    const merged = mergeAreas([cville], [snowshoe]);
    expect(merged.map((a) => a.name)).toEqual(["Charlottesville", "Snowshoe"]);
  });

  it("keeps the device's copy of a spot saved on both", () => {
    // Same trailhead, renamed on this device. The local edit is the one the user
    // just made, so it wins over whatever the account last synced.
    const renamed = { ...cville, name: "Observatory Hill" };
    const merged = mergeAreas([renamed], [cville]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Observatory Hill");
  });

  it("treats a near-identical re-pin as the same area", () => {
    // ~0.001° apart: inside the ~1,000 ft threshold, so not a second pin.
    const nudged = { ...snowshoe, lat: snowshoe.lat + 0.001 };
    expect(mergeAreas([snowshoe], [nudged])).toHaveLength(1);
  });

  it("is a no-op when the account has nothing", () => {
    expect(mergeAreas([cville], [])).toHaveLength(1);
  });

  it("adopts the account's areas onto an empty device", () => {
    const merged = mergeAreas([], [cville, snowshoe]);
    expect(merged).toHaveLength(2);
  });
});
