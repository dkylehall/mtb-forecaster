// Find mountain-bike trail systems and trailheads from OpenStreetMap via the
// Overpass API (free, no key). This is the open-data answer to "put trail
// systems on the map" — OSM has named MTB route relations and trailhead nodes.

const ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * Query OSM for MTB trails/trailheads within a bounding box.
 * @param {{south:number,west:number,north:number,east:number}} bbox
 * @returns {Promise<Array<{name,lat,lon,kind}>>}
 */
export async function findTrails(bbox) {
  const bb = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // Named MTB route relations/ways, bike parks, and trailheads.
  const q = `
    [out:json][timeout:25];
    (
      relation["route"="mtb"]["name"](${bb});
      way["route"="mtb"]["name"](${bb});
      nwr["sport"="mtb"]["name"](${bb});
      node["highway"="trailhead"](${bb});
      nwr["leisure"="trailhead"](${bb});
      nwr["tourism"="trailhead"](${bb});
    );
    out center tags 80;`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: q,
  });
  if (!res.ok) throw new Error(`Overpass query failed (${res.status})`);
  const json = await res.json();

  const seen = new Set();
  const out = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const tags = el.tags || {};
    const name = tags.name || (tags.highway === "trailhead" ? "Trailhead" : null);
    if (!name) continue;
    // De-dupe by name + rough location.
    const key = `${name}|${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      lat,
      lon,
      kind:
        tags.route === "mtb"
          ? "MTB route"
          : tags.highway === "trailhead" || tags.leisure === "trailhead"
          ? "Trailhead"
          : tags.sport === "mtb"
          ? "Bike park"
          : "Trail",
    });
  }
  return out;
}
