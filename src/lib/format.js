// Presentational time/duration formatting shared across components.
// Note: timeline timestamps are the location's local-naive times; we render them
// in the browser's locale, which is fine for nearby areas.

export function clock(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

export function dayPrefix(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / 86400000);
  if (diff <= 0) return "";
  if (diff === 1) return "tomorrow ";
  return d.toLocaleDateString(undefined, { weekday: "long" }) + " ";
}

export function whenLabel(iso) {
  return `${dayPrefix(iso)}${clock(iso)}`.trim();
}

export function humanize(h) {
  if (h <= 0) return "now";
  if (h < 1) return `~${Math.round(h * 60)} min`;
  if (h < 24) return `~${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `~${d} day${d === 1 ? "" : "s"}`;
}

export function durationLabel(hours, openEnded) {
  if (openEnded) return "days";
  return humanize(hours).replace(/^~/, "");
}

// Time remaining until a trail dries, e.g. "2 more hours" / "1 more hour" /
// "3 more days". Used for the drying-time text on cards and the detail view.
export function timeLeftLabel(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} more min`;
  if (hours < 36) {
    const h = Math.round(hours);
    return `${h} more hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(hours / 24);
  return `${d} more day${d === 1 ? "" : "s"}`;
}

// Explicit date + time, e.g. "Sat, Jun 30, 9am".
export function dateTimeLabel(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${date}, ${clock(iso)}`;
}
