// Temperature comfort scoring for riding.
//
// A rider sets an ideal temperature band (e.g. 70–76°F). Hours inside the band
// are green; the further outside, the worse. The bands are asymmetric — riders
// tolerate cold differently from heat — and match the spec:
//
//   yellow:  up to +5 above / -5 below the ideal band
//   orange:  up to +10 above / -15 below
//   red:     up to +15 above / -25 below   (and anything beyond)

export const TEMP_TIERS = {
  green: { key: "green", label: "Ideal temp", color: "var(--green)", severity: 0 },
  yellow: { key: "yellow", label: "A bit off", color: "var(--yellow)", severity: 1 },
  orange: { key: "orange", label: "Uncomfortable", color: "var(--orange)", severity: 2 },
  red: { key: "red", label: "Harsh temp", color: "var(--red)", severity: 3 },
};

// Degrees outside the ideal band at which each tier begins (hot side / cold side).
export const TEMP_THRESHOLDS = {
  yellow: { hot: 5, cold: 5 },
  orange: { hot: 10, cold: 15 },
  red: { hot: 15, cold: 25 },
};

export const DEFAULT_IDEAL = { min: 70, max: 76 };

/**
 * Classify a temperature against the ideal band.
 * @param {number} temp       temperature (same unit as the band, °F here)
 * @param {number} idealMin
 * @param {number} idealMax
 * @returns {object} a TEMP_TIERS entry
 */
export function tempCondition(temp, idealMin, idealMax, thresholds = TEMP_THRESHOLDS) {
  if (temp == null || Number.isNaN(temp)) return TEMP_TIERS.green;
  if (temp >= idealMin && temp <= idealMax) return TEMP_TIERS.green;

  const over = temp > idealMax ? temp - idealMax : 0; // too hot by this much
  const under = temp < idealMin ? idealMin - temp : 0; // too cold by this much
  const t = thresholds;

  if (over > 0) {
    if (over <= t.yellow.hot) return TEMP_TIERS.yellow;
    if (over <= t.orange.hot) return TEMP_TIERS.orange;
    return TEMP_TIERS.red;
  }
  // under > 0
  if (under <= t.yellow.cold) return TEMP_TIERS.yellow;
  if (under <= t.orange.cold) return TEMP_TIERS.orange;
  return TEMP_TIERS.red;
}
