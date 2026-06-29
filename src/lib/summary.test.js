import { describe, it, expect } from "vitest";
import { computeConditions } from "./drying.js";
import { summarize } from "./summary.js";

// Hourly ISO timestamps starting at midnight UTC for N hours.
function hours(startIso, n) {
  const start = new Date(startIso).getTime();
  return Array.from({ length: n }, (_, i) =>
    new Date(start + i * 3600_000).toISOString()
  );
}
function precipAt(n, events) {
  const p = new Array(n).fill(0);
  for (const [o, v] of events) p[o] = v;
  return p;
}

const IDEAL = { idealTempMin: 70, idealTempMax: 76 };

describe("wet window", () => {
  it("reports when a wet trail becomes rideable and for how long", () => {
    // 0.5" at hour 4 (12h to dry). Comfortable temp throughout. 4 days of hours.
    const n = 96;
    const times = hours("2026-06-01T00:00:00Z", n);
    const precip = precipAt(n, [[4, 0.5]]);
    const temp = new Array(n).fill(73);
    const r = computeConditions({ times, precip, temp, now: times[4], ...IDEAL });
    const s = summarize(r, times[4]);

    expect(s.wet.alreadyRideable).toBe(false);
    expect(s.wet.rideableInHours).toBeCloseTo(12, 1);
    // Stays green from ~hour 16 to the end of the window → open-ended run.
    expect(s.wet.greenForHours).toBeGreaterThan(24);
    expect(s.wet.openEnded).toBe(true);
  });

  it("ends the green run when forecast rain returns", () => {
    const n = 96;
    const times = hours("2026-06-01T00:00:00Z", n);
    // dries by ~noon, then a fresh soaking at hour 40
    const precip = precipAt(n, [[2, 0.3], [40, 0.8]]);
    const temp = new Array(n).fill(73);
    const r = computeConditions({ times, precip, temp, now: times[12], ...IDEAL });
    const s = summarize(r, times[12]);
    expect(s.wet.greenForHours).toBeGreaterThan(0);
    expect(s.wet.openEnded).toBe(false); // rain at hour 40 interrupts
  });
});

describe("temp window", () => {
  it("flags when temperature climbs out of the ideal band", () => {
    const n = 48;
    const times = hours("2026-06-01T00:00:00Z", n);
    const precip = precipAt(n, []); // always dry
    // 73° for 6h, then jumps to 90° (red) at hour 6.
    const temp = times.map((_, i) => (i < 6 ? 73 : 90));
    const r = computeConditions({ times, precip, temp, now: times[0], ...IDEAL });
    const s = summarize(r, times[0]);

    expect(s.temp.nowKey).toBe("green");
    expect(s.temp.change).toBeTruthy();
    expect(s.temp.change.dir).toBe("up");
    expect(s.temp.change.toKey).toBe("red");
  });
});

describe("next change", () => {
  it("attributes an incoming change to rain", () => {
    const n = 48;
    const times = hours("2026-06-01T00:00:00Z", n);
    const precip = precipAt(n, [[10, 1.0]]); // dry now, big rain at hour 10
    const temp = new Array(n).fill(73);
    const r = computeConditions({ times, precip, temp, now: times[5], ...IDEAL });
    const s = summarize(r, times[5]);
    expect(s.next).toBeTruthy();
    expect(s.next.reason).toBe("rain");
    expect(s.next.fromKey).toBe("green");
  });
});

describe("next rain", () => {
  it("reports the next rain event and its total", () => {
    const n = 48;
    const times = hours("2026-06-01T00:00:00Z", n);
    // dry now; a 2-hour event at hours 10–11 totaling 0.4"
    const precip = precipAt(n, [[10, 0.25], [11, 0.15]]);
    const temp = new Array(n).fill(73);
    const r = computeConditions({ times, precip, temp, now: times[5], ...IDEAL });
    const s = summarize(r, times[5]);
    expect(s.nextRain).toBeTruthy();
    expect(s.nextRain.amountIn).toBeCloseTo(0.4, 2);
    expect(new Date(s.nextRain.at).getUTCHours()).toBe(10);
  });

  it("is null when no rain is forecast", () => {
    const n = 48;
    const times = hours("2026-06-01T00:00:00Z", n);
    const r = computeConditions({
      times,
      precip: precipAt(n, []),
      temp: new Array(n).fill(73),
      now: times[5],
      ...IDEAL,
    });
    const s = summarize(r, times[5]);
    expect(s.nextRain).toBeNull();
  });
});

describe("optimal ride windows", () => {
  it("finds the next daytime window where temp and dryness both align", () => {
    const n = 96;
    const times = hours("2026-06-01T00:00:00Z", n);
    const precip = precipAt(n, [[4, 0.5]]); // dry by ~16:00 (4pm, daytime)
    const temp = new Array(n).fill(73); // ideal all week
    const r = computeConditions({ times, precip, temp, now: times[4], ...IDEAL });
    const s = summarize(r, times[4]);
    expect(s.rideWindows.length).toBeGreaterThanOrEqual(1);
    expect(new Date(s.rideWindows[0].at).getUTCHours()).toBe(16);
  });

  it("reports the window end + reason when temp climbs out of band", () => {
    const n = 48;
    const times = hours("2026-06-01T00:00:00Z", n);
    const precip = precipAt(n, []); // dry all day
    // ideal 73° early, then jumps to 95° (too hot) at hour 11
    const temp = times.map((_, i) => (i < 11 ? 73 : 95));
    const r = computeConditions({ times, precip, temp, now: times[8], ...IDEAL });
    const s = summarize(r, times[8]);
    const w = s.rideWindows[0];
    expect(w).toBeTruthy();
    expect(w.reason).toBe("heat");
    expect(w.temp).toBe(95); // the triggering temperature
    // window ends right when it gets too hot (hour 11)
    expect(new Date(w.end).getUTCHours()).toBe(11);
  });

  it("clamps a window at sunset rather than running into the night", () => {
    const n = 48;
    const times = hours("2026-06-01T00:00:00Z", n);
    const precip = precipAt(n, []); // dry
    const temp = new Array(n).fill(73); // ideal all day & night
    // Explicit sun times: sunrise 06:00, sunset 20:00 UTC.
    const daily = {
      time: ["2026-06-01", "2026-06-02"],
      sunrise: ["2026-06-01T06:00:00Z", "2026-06-02T06:00:00Z"],
      sunset: ["2026-06-01T20:00:00Z", "2026-06-02T20:00:00Z"],
    };
    const r = computeConditions({ times, precip, temp, now: times[0], ...IDEAL, daily });
    const s = summarize(r, times[0]);
    const w = s.rideWindows[0];
    expect(w.startAtSunrise).toBe(true);
    expect(w.reason).toBe("sunset");
    expect(new Date(w.end).getUTCHours()).toBe(20); // clamped to sunset, not 11h into night
  });

  it("returns multiple windows across days when temp dips out of band nightly", () => {
    const n = 96; // 4 days
    const times = hours("2026-06-01T00:00:00Z", n);
    const precip = precipAt(n, []); // dry all week
    // Ideal (73°) from 8am–6pm, cold (50°) otherwise, so green breaks each night.
    const temp = times.map((iso) => {
      const h = new Date(iso).getUTCHours();
      return h >= 8 && h < 18 ? 73 : 50;
    });
    // Sunrise 8am / sunset 6pm UTC so windows start exactly at first light.
    const dates = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"];
    const daily = {
      time: dates,
      sunrise: dates.map((d) => `${d}T08:00:00Z`),
      sunset: dates.map((d) => `${d}T18:00:00Z`),
    };
    const r = computeConditions({ times, precip, temp, now: times[0], ...IDEAL, daily });
    const s = summarize(r, times[0]);
    expect(s.rideWindows.length).toBe(3); // capped at 3
    for (const w of s.rideWindows) {
      expect(w.startAtSunrise).toBe(true);
      expect(new Date(w.at).getUTCHours()).toBe(8);
    }
  });

  it("is empty when temp never enters the ideal band", () => {
    const n = 96;
    const times = hours("2026-06-01T00:00:00Z", n);
    const r = computeConditions({
      times,
      precip: precipAt(n, []), // always dry
      temp: new Array(n).fill(105), // but brutally hot all week
      now: times[0],
      ...IDEAL,
    });
    const s = summarize(r, times[0]);
    expect(s.rideWindows).toEqual([]);
  });
});

describe("daily outlook", () => {
  it("scores a blazing-hot day as poor (red)", () => {
    const n = 96; // 4 days
    const times = hours("2026-06-01T00:00:00Z", n);
    const precip = precipAt(n, []); // bone dry all week
    // Day 3 (hours 48–71) runs 95°+ during daytime; other days ideal.
    const temp = times.map((iso, i) => {
      const day = Math.floor(i / 24);
      return day === 2 ? 100 : 73;
    });
    const r = computeConditions({ times, precip, temp, now: times[0], ...IDEAL });
    const s = summarize(r, times[0]);
    expect(s.days.length).toBeGreaterThanOrEqual(3);
    expect(s.days[0].tier.key).toBe("green");
    expect(s.days[2].tier.key).toBe("red");
    expect(s.days[2].reason).toBe("temperature");
  });
});
