// Place lookup. Search uses Photon (https://photon.komoot.io), an OSM-based
// geocoder built for typeahead. It beats Nominatim for named POIs/landmarks
// (resorts, trailheads, "Observatory Hill") and supports a location bias so a
// search for "Snowshoe" near Virginia returns Snowshoe Mountain, WV rather than
// a same-named place in Canada. Free, no API key (please be fair on volume).
//
// Reverse geocoding (for dropped map pins) still uses Nominatim, which is solid
// for coordinate -> address.

const PHOTON = "https://photon.komoot.io/api/";
const NOMINATIM = "https://nominatim.openstreetmap.org";

/**
 * Free-text POI/place search, optionally biased toward a coordinate.
 * @param {string} query
 * @param {{limit?:number, bias?:{lat:number,lon:number}}} [opts]
 * @returns {Promise<Array<{name,region,lat,lon,kind}>>}
 */
export async function searchPOI(query, opts = {}) {
  const { limit = 6, bias = null } = opts;
  let url = `${PHOTON}?limit=${limit}&q=${encodeURIComponent(query)}`;
  if (bias && bias.lat != null && bias.lon != null) {
    url += `&lat=${bias.lat}&lon=${bias.lon}`;
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const json = await res.json();

  // Photon often returns the same place under several OSM tag types; collapse
  // by name + coarse location so the list stays clean.
  const seen = new Set();
  const out = [];
  for (const f of json.features || []) {
    const p = f.properties || {};
    const c = (f.geometry && f.geometry.coordinates) || [];
    const lon = c[0];
    const lat = c[1];
    if (lat == null || lon == null) continue;
    const name =
      p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || "Unnamed place";
    const region = [p.city || p.county || p.district, p.state, p.countrycode]
      .filter(Boolean)
      .join(", ");
    const key = `${name}|${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, region, lat, lon, kind: p.osm_value || p.type || "" });
  }
  return out;
}

// Trim Nominatim's long display_name into a short "name".
function splitName(displayName) {
  const parts = (displayName || "").split(",").map((s) => s.trim());
  return { name: parts[0] || "Unknown spot" };
}

/**
 * Reverse geocode a coordinate to a human label (for dropped map pins).
 * @returns {Promise<{name,region,lat,lon}>}
 */
export async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error();
    const r = await res.json();
    const a = r.address || {};
    // Prefer a named feature; fall back through the address hierarchy.
    const name =
      r.name ||
      a.leisure ||
      a.park ||
      a.tourism ||
      a.road ||
      a.hamlet ||
      a.village ||
      a.town ||
      a.city ||
      splitName(r.display_name).name;
    const region = [a.county || a.city || a.town, a.state, a.country_code?.toUpperCase()]
      .filter(Boolean)
      .join(", ");
    return { name, region, lat, lon };
  } catch {
    // Offline / blocked: still allow the pin with a coordinate label.
    return {
      name: `Pin ${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      region: "",
      lat,
      lon,
    };
  }
}
