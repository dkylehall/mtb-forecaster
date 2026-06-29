// Saved riding areas, persisted in localStorage. City-level locations plus a
// per-area drainage setting (sandy trails dry faster than clay).

const KEY = "trail_areas_v1";

export function loadAreas() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveAreas(areas) {
  try {
    localStorage.setItem(KEY, JSON.stringify(areas));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

// ~0.003° ≈ 1,000 ft. Tight enough that distinct trailheads in the same town
// (Observatory Hill vs. Preddy Creek) are separate areas, loose enough to catch
// an exact re-pin of the same spot.
function sameSpot(a, b) {
  return Math.abs(a.lat - b.lat) < 0.003 && Math.abs(a.lon - b.lon) < 0.003;
}

// Returns the existing area at this spot, or null.
export function findExisting(areas, area) {
  return areas.find((a) => sameSpot(a, area)) || null;
}

export function addArea(areas, area) {
  if (areas.some((a) => sameSpot(a, area))) return areas;
  return [
    ...areas,
    {
      id: `${area.lat.toFixed(3)},${area.lon.toFixed(3)}`,
      name: area.name,
      region: area.region || "",
      lat: area.lat,
      lon: area.lon,
      drainage: area.drainage || "medium",
    },
  ];
}

export function removeArea(areas, id) {
  return areas.filter((a) => a.id !== id);
}

export function setDrainage(areas, id, drainage) {
  return areas.map((a) => (a.id === id ? { ...a, drainage } : a));
}

// A few sensible defaults so a first-time board isn't empty.
export const SEED_AREAS = [
  { name: "Charlottesville", region: "Virginia, US", lat: 38.0293, lon: -78.4767, drainage: "slow" },
  { name: "Massanutten", region: "Virginia, US", lat: 38.4119, lon: -78.7136, drainage: "medium" },
  { name: "Snowshoe", region: "West Virginia, US", lat: 38.4101, lon: -79.9939, drainage: "medium" },
];
