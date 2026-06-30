// Trail-drying engine.
//
// Core rule (user's): a trail needs ~24 hours of drying for every 1 inch of rain
// that fell. We generalize that flat rule into a continuous "water-balance bucket"
// so it also handles multiple rain events correctly:
//
//   wetness W (inches of standing water-equivalent) accumulates with rainfall and
//   bleeds off at a constant drying rate. The flat rule is just the special case
//   of one rain event with nothing since.
//
// Everything here is pure (no I/O, no clocks) so it is trivially testable. The UI
// passes in hourly precipitation arrays + an explicit `now`.

import { tempCondition } from "./temperature.js";

// Baseline: 24 hours to dry 1 inch.
export const BASE_DRY_HOURS_PER_INCH = 24;

// Per-area drainage presets scale the required drying time. Sandy/rocky trails
// shed water fast; clay holds it. (City-level weather, area-level soil.)
export const DRAINAGE = {
  fast: 0.6, // well-draining, sandy/rocky
  medium: 1.0, // default
  slow: 1.5, // clay / poorly draining
};

// Riding-condition tiers. `severity` lets us combine independent dimensions
// (dryness, temperature, …) by taking the worst one.
export const CONDITIONS = [
  { key: "green", label: "Ride now", color: "var(--green)", severity: 0 },
  { key: "yellow", label: "Almost dry", color: "var(--yellow)", severity: 1 },
  { key: "orange", label: "Still wet", color: "var(--orange)", severity: 2 },
  { key: "red", label: "Too wet", color: "var(--red)", severity: 3 },
];
const TIER = Object.fromEntries(CONDITIONS.map((c) => [c.key, c]));

// Hours-until-dry cutoffs separating the dryness tiers (configurable via settings).
export const DEFAULT_DRY_CUTOFFS = { drying: 4, wet: 12 };

// Classify hours-until-dry into a tier: green (dry), yellow (≤drying), orange
// (≤wet), red (beyond).
export function conditionFor(hoursUntilDry, cutoffs = DEFAULT_DRY_CUTOFFS) {
  if (hoursUntilDry <= 0) return TIER.green;
  if (hoursUntilDry <= cutoffs.drying) return TIER.yellow;
  if (hoursUntilDry <= cutoffs.wet) return TIER.orange;
  return TIER.red;
}

// Continuous green→red color for "hours until dry", used to show drying time as
// a gradient instead of discrete tiers. 0h reads fully dry (green); at/after
// SOAKED_HOURS it reads fully soaked (red), interpolating through yellow/orange.
export const SOAKED_HOURS = 24;

const GRADIENT_STOPS = [
  [0.0, [0x5b, 0xe0, 0xa0]], // green  — dry
  [0.34, [0xff, 0xe4, 0x5c]], // yellow
  [0.67, [0xff, 0xb4, 0x54]], // orange
  [1.0, [0xff, 0x6b, 0x6b]], // red    — soaked
];

// CSS color stops (left=dry … right=soaked) for the legend gradient bar.
export const GRADIENT_CSS = GRADIENT_STOPS.map(
  ([, [r, g, b]]) => `rgb(${r},${g},${b})`
);

export function dryingColor(hoursUntilDry, soakedHours = SOAKED_HOURS) {
  const t = Math.max(0, Math.min(1, (hoursUntilDry || 0) / soakedHours));
  for (let i = 1; i < GRADIENT_STOPS.length; i++) {
    const [t0, c0] = GRADIENT_STOPS[i - 1];
    const [t1, c1] = GRADIENT_STOPS[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const mix = (a, b) => Math.round(a + (b - a) * f);
      return `rgb(${mix(c0[0], c1[0])},${mix(c0[1], c1[1])},${mix(c0[2], c1[2])})`;
    }
  }
  return GRADIENT_CSS[GRADIENT_CSS.length - 1];
}

// Combine two condition objects: the worse (higher severity) one wins.
export function worse(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.severity >= b.severity ? a : b;
}

// Drying rate in inches/hour for a given drainage factor.
function dryRatePerHour(drainageFactor) {
  return 1 / (BASE_DRY_HOURS_PER_INCH * drainageFactor);
}

// Index of the hour at or just before `now` within an ISO time array.
function indexAtOrBefore(times, nowMs) {
  let idx = -1;
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i]).getTime() <= nowMs) idx = i;
    else break;
  }
  return idx;
}

/**
 * Simulate the wetness bucket across past hours up to `now`.
 *
 * @param {string[]} times  ISO hourly timestamps (ascending), local-naive ok
 * @param {number[]} precip hourly precipitation in inches, aligned to `times`
 * @param {number}   nowMs  current time in ms
 * @param {number}   dryRate inches/hour of drying
 * @returns {{ wetness: number, lastRainIndex: number }}
 */
function simulatePast(times, precip, nowMs, dryRate) {
  let w = 0;
  let lastRainIndex = -1;
  const upTo = indexAtOrBefore(times, nowMs);
  for (let i = 0; i <= upTo; i++) {
    const p = precip[i] || 0;
    if (p > 0) {
      // Rain hour: trail gets wetter and does NOT dry. The drying clock starts
      // once rain stops, matching the "24h per inch after it stops" rule.
      lastRainIndex = i;
      w += p;
    } else {
      w -= dryRate; // dry hour
      if (w < 0) w = 0;
    }
  }
  return { wetness: w, lastRainIndex };
}

/**
 * From current wetness, walk forward through forecast precip to find how many
 * hours until the trail is dry (W returns to 0). Forecast rain can push the
 * dry time further out — that's the point.
 *
 * @returns {number} hours until dry (0 if already dry)
 */
function hoursUntilDryForward(times, precip, nowMs, startWetness, dryRate) {
  let w = startWetness;
  if (w <= 0) return 0;

  let hours = 0;
  const startIdx = indexAtOrBefore(times, nowMs);
  for (let i = startIdx + 1; i < times.length; i++) {
    // Forecast rain just adds its water (24h of drying per inch). It does NOT
    // also cost an extra "no-drying" hour — that would double-count. So ¼" of
    // rain coming now simply pushes the dry time out by ¼ × 24 = 6 hours.
    w += precip[i] || 0;
    if (w <= dryRate) {
      // Dries partway through this hour — interpolate the crossing.
      hours += w / dryRate;
      w = 0;
      break;
    }
    w -= dryRate;
    hours += 1;
  }

  // If we ran out of forecast hours while still wet, extrapolate the tail
  // assuming no further rain.
  if (w > 0) hours += w / dryRate;
  return hours;
}

// Which side of the ideal band a temperature is on: "hot", "cold", or null
// (inside the band / unknown). Lets the UI color cold deviations differently
// from hot ones.
function tempDir(t, ideal) {
  if (!ideal || t == null) return null;
  if (t > ideal.max) return "hot";
  if (t < ideal.min) return "cold";
  return null;
}

/**
 * Build an hour-by-hour timeline for charting. Each cell carries the dryness
 * condition, the temperature condition (if a temp series + ideal band are given),
 * and `condition` = the worse of the two (what the hour's color shows).
 *
 * @returns {Array<{ time, wetness, precip, hoursUntilDry, temp,
 *                   dry: object, tempCond: object, condition: object }>}
 */
function buildTimeline(
  times,
  precip,
  nowMs,
  startWetness,
  dryRate,
  maxHours,
  temp,
  feels,
  codes,
  precipProb,
  rh,
  ideal,
  dryCutoffs,
  tempThresholds
) {
  const out = [];
  let w = startWetness;
  const startIdx = indexAtOrBefore(times, nowMs);
  const end = Math.min(times.length, startIdx + 1 + maxHours);
  for (let i = startIdx + 1; i < end; i++) {
    const p = precip[i] || 0;
    // Net water change for the hour: rain adds, drying removes (same rule the
    // headline hours-until-dry uses, so the chart and the number agree).
    w += p;
    w -= dryRate;
    if (w < 0) w = 0;
    // Hours-until-dry as of THIS hour, assuming no further rain after it.
    const hud = w / dryRate;
    const dry = conditionFor(hud, dryCutoffs);
    const tval = temp ? temp[i] : null;
    const fval = feels ? feels[i] : null;
    const tempCond = ideal ? tempCondition(tval, ideal.min, ideal.max, tempThresholds) : null;
    const feelsCond =
      ideal && fval != null ? tempCondition(fval, ideal.min, ideal.max, tempThresholds) : null;
    out.push({
      time: times[i],
      wetness: round2(w),
      precip: round2(p),
      hoursUntilDry: round1(hud),
      temp: tval == null ? null : Math.round(tval),
      feels: fval == null ? null : Math.round(fval),
      tempDir: tempDir(tval, ideal),
      feelsDir: tempDir(fval, ideal),
      code: codes ? codes[i] : null,
      precipProb: precipProb && precipProb[i] != null ? Math.round(precipProb[i]) : null,
      rh: rh && rh[i] != null ? Math.round(rh[i]) : null,
      dry,
      tempCond,
      feelsCond,
      condition: worse(dry, tempCond),
    });
  }
  return out;
}

/**
 * Main entry point. Given hourly precipitation (past + forecast) and "now",
 * compute the current riding condition for a trail area.
 *
 * @param {object} opts
 * @param {string[]} opts.times    ISO hourly timestamps, ascending (past..future)
 * @param {number[]} opts.precip   hourly precipitation in inches, aligned to times
 * @param {string|number|Date} opts.now  current time
 * @param {keyof DRAINAGE|number} [opts.drainage="medium"]  preset key or raw factor
 * @param {number} [opts.timelineHours=48]  how many forecast hours to chart
 * @returns {{
 *   wetness: number, hoursUntilDry: number, dryAt: string|null,
 *   condition: object, recentRainIn: number, timeline: Array
 * }}
 */
export function computeConditions(opts) {
  const {
    times,
    precip,
    temp = null,
    feels = null,
    codes = null,
    precipProb = null,
    rh = null,
    now,
    drainage = "medium",
    timelineHours = 24 * 7, // cover the full week so summaries can look ahead
    idealTempMin = null,
    idealTempMax = null,
    dryCutoffs = DEFAULT_DRY_CUTOFFS,
    tempThresholds = undefined, // falls back to temperature.js default
    daily = null, // { time[], sunrise[], sunset[] } for daylight-aware windows
  } = opts;

  // Build a date -> { sunrise, sunset } lookup for ride-window clamping.
  let sun = null;
  if (daily && daily.time && daily.sunrise && daily.sunset) {
    sun = {};
    for (let i = 0; i < daily.time.length; i++) {
      sun[daily.time[i]] = { sunrise: daily.sunrise[i], sunset: daily.sunset[i] };
    }
  }

  const ideal =
    idealTempMin != null && idealTempMax != null
      ? { min: idealTempMin, max: idealTempMax }
      : null;

  const nowMs = new Date(now).getTime();
  const factor = typeof drainage === "number" ? drainage : DRAINAGE[drainage] || 1;
  const dryRate = dryRatePerHour(factor);

  const { wetness } = simulatePast(times, precip, nowMs, dryRate);
  const hoursUntilDry = hoursUntilDryForward(times, precip, nowMs, wetness, dryRate);
  const dryAt =
    hoursUntilDry > 0 ? new Date(nowMs + hoursUntilDry * 3600_000).toISOString() : null;

  // Total rain over the simulated past window (for display).
  const upTo = indexAtOrBefore(times, nowMs);
  let recentRainIn = 0;
  for (let i = 0; i <= upTo; i++) recentRainIn += precip[i] || 0;

  // Current-hour conditions: dryness, temperature, and the combined headline.
  const dryCond = conditionFor(hoursUntilDry, dryCutoffs);
  const tempNow = temp ? temp[upTo] : null;
  const tempCond = ideal ? tempCondition(tempNow, ideal.min, ideal.max, tempThresholds) : null;

  return {
    wetness: round2(wetness),
    hoursUntilDry: round1(hoursUntilDry),
    dryAt,
    dryColor: dryingColor(hoursUntilDry), // continuous green→red drying-time color
    dryCondition: dryCond,
    tempNow: tempNow == null ? null : Math.round(tempNow),
    tempCondition: tempCond,
    condition: worse(dryCond, tempCond), // combined headline
    recentRainIn: round2(recentRainIn),
    sun,
    timeline: buildTimeline(
      times,
      precip,
      nowMs,
      wetness,
      dryRate,
      timelineHours,
      temp,
      feels,
      codes,
      precipProb,
      rh,
      ideal,
      dryCutoffs,
      tempThresholds
    ),
  };
}

/**
 * Find the best daylight riding window in the next N hours: the earliest run of
 * consecutive "green" hours that fall within daylight and have no active rain.
 *
 * @param {Array} timeline  output of computeConditions().timeline
 * @param {Array<{sunrise:string,sunset:string}>} [daylight]  per-day sun times
 * @returns {{ start: string, end: string, hours: number } | null}
 */
export function bestRideWindow(timeline, daylight) {
  let best = null;
  let run = null;

  const isDaylight = (iso) => {
    if (!daylight || !daylight.length) return true;
    const t = new Date(iso).getTime();
    return daylight.some(
      (d) => t >= new Date(d.sunrise).getTime() && t <= new Date(d.sunset).getTime()
    );
  };

  for (const h of timeline) {
    const rideable =
      h.condition.key === "green" && h.precip === 0 && isDaylight(h.time);
    if (rideable) {
      if (!run) run = { start: h.time, end: h.time, hours: 1 };
      else {
        run.end = h.time;
        run.hours += 1;
      }
    } else if (run) {
      if (!best || run.hours > best.hours) best = run;
      run = null;
    }
  }
  if (run && (!best || run.hours > best.hours)) best = run;
  return best;
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
