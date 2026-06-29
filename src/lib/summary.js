// Turns the hourly condition timeline into human-readable "windows" and a
// multi-day outlook — friendlier than reading a 168-cell hourly strip.
//
// Pure functions over a computeConditions() result. No formatting/clock logic
// lives here (that's presentational) — we return times, durations, keys, and
// reasons; the component renders them.

// Generic tiers for the day outlook, indexed by severity 0..3.
export const OUTLOOK_TIERS = [
  { key: "green", label: "Good", color: "var(--green)", severity: 0 },
  { key: "yellow", label: "Fair", color: "var(--yellow)", severity: 1 },
  { key: "orange", label: "Marginal", color: "var(--orange)", severity: 2 },
  { key: "red", label: "Poor", color: "var(--red)", severity: 3 },
];

function dateKey(iso) {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}
function hourOf(iso) {
  return Number(iso.slice(11, 13));
}

/**
 * @param {object} result  computeConditions() output (timeline must span ahead)
 * @param {string|number|Date} now
 * @returns {{
 *   temp: {nowKey, nowTemp, change: {at,toKey,dir}|null},
 *   wet:  {nowKey, rideableInHours, alreadyRideable, greenForHours, openEnded},
 *   next: {at, fromKey, toKey, reason}|null,
 *   days: Array<{date, tier, hi, lo, rainIn, reason}>
 * }}
 */
export function summarize(result, now) {
  const cells = result.timeline || [];
  const nowIso = new Date(now).toISOString();

  // Synthetic "now" cell so we can scan transitions uniformly from the present.
  const nowCell = {
    time: nowIso,
    temp: result.tempNow,
    wetness: result.wetness,
    precip: 0,
    dry: result.dryCondition,
    tempCond: result.tempCondition,
    condition: result.condition,
  };
  const series = [nowCell, ...cells];

  return {
    temp: tempWindow(result, series),
    wet: wetWindow(result, cells),
    next: nextChange(series),
    nextRain: nextRain(cells),
    days: dailyOutlook(cells),
  };
}

// Next forecast rain: the first upcoming wet hour, with the total of that
// contiguous rain event. Returns null if it stays dry across the horizon.
function nextRain(cells) {
  const WET = 0.01; // inches; ignore trace amounts
  let start = -1;
  for (let i = 0; i < cells.length; i++) {
    if ((cells[i].precip || 0) >= WET) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let amount = 0;
  let i = start;
  for (; i < cells.length; i++) {
    const p = cells[i].precip || 0;
    if (p < WET) break;
    amount += p;
  }
  return { at: cells[start].time, amountIn: Math.round(amount * 100) / 100 };
}

function tempWindow(result, series) {
  const nowKey = result.tempCondition ? result.tempCondition.key : null;
  const nowTemp = result.tempNow;
  let change = null;
  if (nowKey) {
    for (let i = 1; i < series.length; i++) {
      const c = series[i];
      if (c.tempCond && c.tempCond.key !== nowKey) {
        change = {
          at: c.time,
          toKey: c.tempCond.key,
          dir: c.temp != null && nowTemp != null && c.temp >= nowTemp ? "up" : "down",
        };
        break;
      }
    }
  }
  return { nowKey, nowTemp, change };
}

function wetWindow(result, cells) {
  const rideableInHours = result.hoursUntilDry;
  const alreadyRideable = rideableInHours === 0;

  // Find the first rideable (dry === green) hour, then how long it stays green
  // before forecast rain re-wets it.
  let firstGreen = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].dry && cells[i].dry.key === "green") {
      firstGreen = i;
      break;
    }
  }
  let greenForHours = null;
  let openEnded = false;
  if (firstGreen >= 0) {
    let run = 0;
    let i = firstGreen;
    for (; i < cells.length; i++) {
      if (cells[i].dry && cells[i].dry.key === "green") run++;
      else break;
    }
    greenForHours = run;
    openEnded = i >= cells.length; // ran to the end of the forecast horizon
  }

  return {
    nowKey: result.dryCondition ? result.dryCondition.key : null,
    rideableInHours,
    alreadyRideable,
    greenForHours,
    openEnded,
  };
}

function nextChange(series) {
  const startKey = series[0].condition.key;
  for (let i = 1; i < series.length; i++) {
    const cell = series[i];
    const prev = series[i - 1];
    if (cell.condition.key === startKey) continue;

    // Attribute the change to whichever dimension flipped.
    const dryChanged = cell.dry && prev.dry && cell.dry.key !== prev.dry.key;
    const tempChanged =
      cell.tempCond && prev.tempCond && cell.tempCond.key !== prev.tempCond.key;
    let reason = "conditions";
    if (dryChanged && cell.wetness > prev.wetness) reason = "rain";
    else if (dryChanged) reason = "drying";
    else if (tempChanged) reason = "temperature";

    return { at: cell.time, fromKey: startKey, toKey: cell.condition.key, reason };
  }
  return null;
}

function dailyOutlook(cells) {
  const byDay = new Map();
  for (const c of cells) {
    const k = dateKey(c.time);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(c);
  }

  const days = [];
  for (const [date, dayCells] of byDay) {
    // Daytime hours (8am–6pm) drive the score; nighttime isn't riding time.
    const daytime = dayCells.filter((c) => {
      const h = hourOf(c.time);
      return h >= 8 && h < 18;
    });
    const scoreCells = daytime.length ? daytime : dayCells;

    const avg = (fn) =>
      scoreCells.reduce((s, c) => s + fn(c), 0) / scoreCells.length;
    const combinedSev = avg((c) => c.condition.severity);
    const tempSev = avg((c) => (c.tempCond ? c.tempCond.severity : 0));
    const drySev = avg((c) => (c.dry ? c.dry.severity : 0));

    const tierIdx = Math.min(3, Math.max(0, Math.round(combinedSev)));
    const temps = scoreCells.map((c) => c.temp).filter((t) => t != null);
    const rainIn = dayCells.reduce((s, c) => s + (c.precip || 0), 0);

    days.push({
      date,
      tier: OUTLOOK_TIERS[tierIdx],
      hi: temps.length ? Math.max(...temps) : null,
      lo: temps.length ? Math.min(...temps) : null,
      rainIn: Math.round(rainIn * 100) / 100,
      reason: tempSev >= drySev ? "temperature" : "wetness",
    });
  }
  return days.slice(0, 7);
}
