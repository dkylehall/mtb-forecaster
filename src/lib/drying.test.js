import { describe, it, expect } from "vitest";
import {
  computeConditions,
  conditionFor,
  bestRideWindow,
  DRAINAGE,
} from "./drying.js";

// ---- helpers -------------------------------------------------------------

// Build an array of N hourly ISO timestamps starting at `startIso`.
function hours(startIso, n) {
  const start = new Date(startIso).getTime();
  return Array.from({ length: n }, (_, i) =>
    new Date(start + i * 3600_000).toISOString()
  );
}

// Place precipitation amounts at given hour-offsets from the start.
function precipAt(n, events) {
  const p = new Array(n).fill(0);
  for (const [offset, inches] of events) p[offset] = inches;
  return p;
}

// ---- the user's canonical example ---------------------------------------

describe("the 0.5\" overnight example", () => {
  // 48h window starting midnight. 0.5" of rain falls in the hour ending 4am
  // (offset 4), then stops. "Now" is 4am.
  const start = "2026-06-01T00:00:00Z";
  const times = hours(start, 48);
  const precip = precipAt(48, [[4, 0.5]]);

  it("needs ~12 hours to dry right after the rain stops", () => {
    const r = computeConditions({ times, precip, now: "2026-06-01T04:00:00Z" });
    expect(r.wetness).toBeCloseTo(0.5, 2);
    expect(r.hoursUntilDry).toBeCloseTo(12, 1);
  });

  it("is dry at 4pm (12h later)", () => {
    const r = computeConditions({ times, precip, now: "2026-06-01T04:00:00Z" });
    expect(new Date(r.dryAt).getUTCHours()).toBe(16); // 4pm UTC
  });

  it("has ~4 hours left by noon → yellow", () => {
    const r = computeConditions({ times, precip, now: "2026-06-01T12:00:00Z" });
    expect(r.hoursUntilDry).toBeCloseTo(4, 1);
    expect(r.condition.key).toBe("yellow");
  });

  it("is green once dry", () => {
    const r = computeConditions({ times, precip, now: "2026-06-01T16:00:00Z" });
    expect(r.hoursUntilDry).toBe(0);
    expect(r.condition.key).toBe("green");
    expect(r.dryAt).toBeNull();
  });
});

// ---- color tiers ---------------------------------------------------------

describe("condition tiers", () => {
  it("maps hours-until-dry to the right color", () => {
    expect(conditionFor(0).key).toBe("green");
    expect(conditionFor(3).key).toBe("yellow");
    expect(conditionFor(8).key).toBe("orange");
    expect(conditionFor(20).key).toBe("red");
  });
});

// ---- multiple rain events ------------------------------------------------

describe("multiple rain events", () => {
  it("ignores an old event that has fully dried", () => {
    // 0.3" at hour 2 (dries in ~7.2h), then 0.5" at hour 40. Now = hour 40.
    const start = "2026-06-01T00:00:00Z";
    const times = hours(start, 72);
    const precip = precipAt(72, [[2, 0.3], [40, 0.5]]);
    const nowIso = times[40];
    const r = computeConditions({ times, precip, now: nowIso });
    // Only the fresh 0.5" should matter.
    expect(r.wetness).toBeCloseTo(0.5, 2);
    expect(r.hoursUntilDry).toBeCloseTo(12, 1);
  });

  it("stacks rain that falls before the previous batch dries", () => {
    // 0.5" at hour 10 and another 0.5" at hour 12; now = hour 12.
    const start = "2026-06-01T00:00:00Z";
    const times = hours(start, 72);
    const precip = precipAt(72, [[10, 0.5], [12, 0.5]]);
    const r = computeConditions({ times, precip, now: times[12] });
    // ~1.0" minus the two dry hours (11 and... none, since 10 & 12 are rain
    // hours and 11 is dry): wetness ≈ 1.0 - 1*dryRate.
    expect(r.wetness).toBeGreaterThan(0.9);
    expect(r.condition.key).toBe("red");
  });
});

// ---- heavy rain ----------------------------------------------------------

describe("heavy rain", () => {
  it("1 inch needs ~24h and reads red", () => {
    const start = "2026-06-01T00:00:00Z";
    const times = hours(start, 72);
    const precip = precipAt(72, [[5, 1.0]]);
    const r = computeConditions({ times, precip, now: times[5] });
    expect(r.hoursUntilDry).toBeCloseTo(24, 1);
    expect(r.condition.key).toBe("red");
  });
});

// ---- drainage presets ----------------------------------------------------

describe("drainage presets", () => {
  const start = "2026-06-01T00:00:00Z";
  const times = hours(start, 48);
  const precip = precipAt(48, [[4, 0.5]]);

  it("fast-draining trails dry sooner than slow", () => {
    const fast = computeConditions({ times, precip, now: times[4], drainage: "fast" });
    const slow = computeConditions({ times, precip, now: times[4], drainage: "slow" });
    expect(fast.hoursUntilDry).toBeLessThan(slow.hoursUntilDry);
    expect(fast.hoursUntilDry).toBeCloseTo(12 * DRAINAGE.fast, 1);
    expect(slow.hoursUntilDry).toBeCloseTo(12 * DRAINAGE.slow, 1);
  });
});

// ---- forecast rain re-wets ----------------------------------------------

describe("forecast rain", () => {
  it("pushes the dry time out when more rain is coming", () => {
    // Dry now, but 1.0" arrives a few hours from now.
    const start = "2026-06-01T00:00:00Z";
    const times = hours(start, 48);
    const precip = precipAt(48, [[10, 1.0]]); // future rain at hour 10
    const r = computeConditions({ times, precip, now: times[7] });
    // Dry right now...
    expect(r.wetness).toBe(0);
    // ...but the timeline should turn red when the 1" hits.
    const wetCell = r.timeline.find((c) => c.precip > 0);
    expect(wetCell).toBeTruthy();
    expect(wetCell.condition.key).toBe("red");
  });
});

// ---- temperature combined with dryness ----------------------------------

describe("dryness + temperature combine to the worse of the two", () => {
  const start = "2026-06-01T00:00:00Z";
  const times = hours(start, 48);
  const dry = precipAt(48, []); // never rains → always dry

  it("a dry trail reads red when it's brutally cold", () => {
    const temp = new Array(48).fill(35); // ideal is 70–76
    const r = computeConditions({
      times,
      precip: dry,
      temp,
      now: times[5],
      idealTempMin: 70,
      idealTempMax: 76,
    });
    expect(r.hoursUntilDry).toBe(0); // dryness is fine
    expect(r.dryCondition.key).toBe("green");
    expect(r.tempCondition.key).toBe("red"); // temp is not
    expect(r.condition.key).toBe("red"); // headline = worse
    expect(r.timeline.every((c) => c.condition.key === "red")).toBe(true);
  });

  it("a dry trail in the ideal band reads green", () => {
    const temp = new Array(48).fill(73);
    const r = computeConditions({
      times,
      precip: dry,
      temp,
      now: times[5],
      idealTempMin: 70,
      idealTempMax: 76,
    });
    expect(r.condition.key).toBe("green");
  });

  it("wet + perfect temp still reads by dryness", () => {
    const wet = precipAt(48, [[4, 0.5]]);
    const temp = new Array(48).fill(73);
    const r = computeConditions({
      times,
      precip: wet,
      temp,
      now: times[4],
      idealTempMin: 70,
      idealTempMax: 76,
    });
    expect(r.tempCondition.key).toBe("green");
    expect(r.condition.key).toBe("orange"); // 12h to dry → orange dominates
  });
});

// ---- best ride window ----------------------------------------------------

describe("bestRideWindow", () => {
  it("finds a green daylight block with no rain", () => {
    const start = "2026-06-01T00:00:00Z";
    const times = hours(start, 48);
    const precip = precipAt(48, [[4, 0.5]]);
    const r = computeConditions({ times, precip, now: times[4] });
    const win = bestRideWindow(r.timeline); // no daylight filter
    expect(win).toBeTruthy();
    // First green hour should be ~12h out (4pm), i.e. hour 16.
    expect(new Date(win.start).getUTCHours()).toBe(16);
  });
});
