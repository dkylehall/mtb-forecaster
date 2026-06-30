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
export function summarize(result, now, maxWindows = 3) {
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
    rideWindows: rideWindows(cells, result.sun, maxWindows),
    days: dailyOutlook(cells),
  };
}

// Up-to-N ride windows: per day, the first stretch where BOTH temperature and
// dryness are green, clamped to daylight (sunrise..sunset). Each window reports
// whether it begins at sunrise, its end, length in hours, and WHY it ends —
// "sunset", or a degradation ("heat"/"cold" with the triggering temp, "rain",
// "wet"). Falls back to an 8am–6pm daylight assumption if no sun times given.
function rideWindows(cells, sun, maxWindows = 3) {
  const sunMap = sun || synthSun(cells);
  const windows = [];
  for (const day of Object.keys(sunMap).sort()) {
    if (windows.length >= maxWindows) break;
    const s = sunMap[day];
    if (!s || !s.sunrise || !s.sunset) continue;
    const srH = timeOfDay(s.sunrise);
    const ssH = timeOfDay(s.sunset);

    // Daylight cells for this day, compared by wall-clock (TZ-agnostic — both
    // cells and sun times are in the location's local time).
    const dayIdx = [];
    for (let i = 0; i < cells.length; i++) {
      if (dateKey(cells[i].time) !== day) continue;
      const h = timeOfDay(cells[i].time);
      if (h >= Math.floor(srH) && h <= ssH) dayIdx.push(i);
    }
    if (!dayIdx.length) continue;

    // Find EVERY green stretch within the day's daylight (a day can have more
    // than one — e.g. rideable morning, too-hot midday, rideable evening).
    let i = 0;
    while (i < dayIdx.length && windows.length < maxWindows) {
      if (cells[dayIdx[i]].condition.key !== "green") {
        i++;
        continue;
      }
      const p = i;
      let q = p;
      while (q + 1 < dayIdx.length && cells[dayIdx[q + 1]].condition.key === "green") q++;

      // "At sunrise" only if this is the day's first stretch AND the first
      // daylight cell really is near sunrise (today's window starts at the
      // current time, not this morning's sunrise).
      const startAtSunrise =
        p === 0 && timeOfDay(cells[dayIdx[0]].time) <= Math.floor(srH) + 1;
      const atIso = startAtSunrise ? s.sunrise : cells[dayIdx[p]].time;

      let endIso, reason, temp = null;
      if (q === dayIdx.length - 1) {
        endIso = s.sunset; // ran to the end of daylight
        reason = "sunset";
      } else {
        const bIdx = dayIdx[q + 1];
        endIso = cells[bIdx].time;
        const r = degradeReason(cells, bIdx);
        reason = r.reason;
        temp = r.temp;
      }

      const hours = Math.max(1, Math.round(timeOfDay(endIso) - timeOfDay(atIso)));

      // Hourly temperature bars: rideable hours + 2 of wiggle room, each colored
      // by its temperature tier — but never past sunset (the hard cutoff).
      const bars = [];
      const barCount = Math.min(hours + 2, 12);
      for (let k = 0; k < barCount; k++) {
        const ci = dayIdx[p] + k;
        if (ci >= cells.length) break;
        const c = cells[ci];
        if (dateKey(c.time) !== day || timeOfDay(c.time) > ssH) break;
        bars.push({
          time: k === 0 ? atIso : c.time,
          temp: c.temp,
          tier: c.tempCond ? c.tempCond.key : "green",
          feels: c.feels,
          feelsTier: c.feelsCond ? c.feelsCond.key : c.tempCond ? c.tempCond.key : "green",
          dir: c.tempDir,
          feelsDir: c.feelsDir,
          code: c.code,
        });
      }

      windows.push({ at: atIso, startAtSunrise, end: endIso, hours, reason, temp, bars });
      i = q + 1; // continue scanning for the next stretch this same day
    }
  }
  return windows;
}

// Hour-of-day as a decimal (e.g. "…T05:54" → 5.9), read straight from the
// string so it's independent of the runtime timezone.
function timeOfDay(iso) {
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
}

// Fallback daylight (8am–6pm) per date present in the timeline.
function synthSun(cells) {
  const out = {};
  for (const c of cells) {
    const d = dateKey(c.time);
    if (!out[d]) out[d] = { sunrise: `${d}T08:00`, sunset: `${d}T18:00` };
  }
  return out;
}

// Why a green stretch ends at the degrading cell `idx`.
function degradeReason(cells, idx) {
  const b = cells[idx];
  const prev = cells[idx - 1];
  const dryBroke = b.dry && b.dry.key !== "green";
  const tempBroke = b.tempCond && b.tempCond.key !== "green";
  const gotWetter = (b.precip || 0) > 0 || (b.wetness || 0) > (prev?.wetness || 0);
  if (dryBroke && gotWetter) return { reason: "rain", temp: null };
  if (tempBroke) {
    const hot = b.temp != null && prev?.temp != null && b.temp >= prev.temp;
    return { reason: hot ? "heat" : "cold", temp: b.temp };
  }
  if (dryBroke) return { reason: "wet", temp: null };
  return { reason: "weather", temp: null };
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
