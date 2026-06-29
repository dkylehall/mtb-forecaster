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

// Riding-condition tiers, keyed on hours-until-dry. Order matters (first match wins).
// `severity` lets us combine independent dimensions (dryness, temperature, …) by
// taking the worst one.
export const CONDITIONS = [
  { key: "green", label: "Ride now", color: "var(--green)", maxHours: 0, severity: 0 },
  { key: "yellow", label: "Almost dry", color: "var(--yellow)", maxHours: 4, severity: 1 },
  { key: "orange", label: "Still wet", color: "var(--orange)", maxHours: 12, severity: 2 },
  { key: "red", label: "Too wet", color: "var(--red)", maxHours: Infinity, severity: 3 },
];

export function conditionFor(hoursUntilDry) {
  return CONDITIONS.find((c) => hoursUntilDry <= c.maxHours);
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
    const p = precip[i] || 0;
    if (p > 0) {
      // Forecast rain re-wets and resets drying for that hour.
      w += p;
      hours += 1;
      continue;
    }
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

/**
 * Build an hour-by-hour timeline for charting. Each cell carries the dryness
 * condition, the temperature condition (if a temp series + ideal band are given),
 * and `condition` = the worse of the two (what the hour's color shows).
 *
 * @returns {Array<{ time, wetness, precip, hoursUntilDry, temp,
 *                   dry: object, tempCond: object, condition: object }>}
 */
function buildTimeline(times, precip, nowMs, startWetness, dryRate, maxHours, temp, ideal) {
  const out = [];
  let w = startWetness;
  const startIdx = indexAtOrBefore(times, nowMs);
  const end = Math.min(times.length, startIdx + 1 + maxHours);
  for (let i = startIdx + 1; i < end; i++) {
    const p = precip[i] || 0;
    if (p > 0) {
      w += p; // rain during this hour: wetter, no drying
    } else {
      w -= dryRate; // drying over the hour leading up to this timestamp
      if (w < 0) w = 0;
    }
    // Hours-until-dry as of THIS hour, assuming no further rain after it.
    const hud = w / dryRate;
    const dry = conditionFor(hud);
    const tval = temp ? temp[i] : null;
    const tempCond = ideal ? tempCondition(tval, ideal.min, ideal.max) : null;
    out.push({
      time: times[i],
      wetness: round2(w),
      precip: round2(p),
      hoursUntilDry: round1(hud),
      temp: tval == null ? null : Math.round(tval),
      dry,
      tempCond,
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
    now,
    drainage = "medium",
    timelineHours = 24 * 7, // cover the full week so summaries can look ahead
    idealTempMin = null,
    idealTempMax = null,
  } = opts;

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
  const dryCond = conditionFor(hoursUntilDry);
  const tempNow = temp ? temp[upTo] : null;
  const tempCond = ideal ? tempCondition(tempNow, ideal.min, ideal.max) : null;

  return {
    wetness: round2(wetness),
    hoursUntilDry: round1(hoursUntilDry),
    dryAt,
    dryCondition: dryCond,
    tempNow: tempNow == null ? null : Math.round(tempNow),
    tempCondition: tempCond,
    condition: worse(dryCond, tempCond), // combined headline
    recentRainIn: round2(recentRainIn),
    timeline: buildTimeline(
      times,
      precip,
      nowMs,
      wetness,
      dryRate,
      timelineHours,
      temp,
      ideal
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
