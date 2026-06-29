# MTB Forecaster

A mountain-bike trail forecaster. Save your riding areas and see, at a glance,
whether each one is **dry enough** and **warm enough** to ride — based on recent
and forecast weather. It estimates when a trail will dry out after rain, scores
comfort against your ideal temperature band, and tells you the **next best ride
window**.

Built as a single-page app (Vue 3 + Vite) on free, no-key weather/geocoding
APIs. No backend, no accounts — your areas live in the browser.

## Features

- **Trail dryness model** — ~24h of drying per inch of rain (after it stops),
  generalized into a continuous water-balance model so multiple rain events
  stack correctly. Per-area soil drainage (sandy / medium / clay) tunes it.
- **Riding comfort** — current temp, feels-like, and humidity scored against an
  adjustable ideal-temperature band (asymmetric hot/cold tolerance).
- **Next best ride** — the next daytime window when temperature *and* dryness
  both line up, shown as a date/time range with the reason it ends (too hot,
  rain, etc.).
- **Plain-language windows** — "rideable in ~3 hours, then good for ~2 days",
  "warms to marginal by 4pm", next-change with cause.
- **7-day outlook** — a color-coded strip scored from each day's daytime temps
  and rainfall.
- **Map** — light/satellite Leaflet map; add areas via location-biased place
  search (resorts, trailheads, landmarks) or by dropping a pin on the exact
  spot. Drag to reorder cards.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm test         # run the engine unit tests
npm run build    # production build to dist/
```

## Data sources

- [Open-Meteo](https://open-meteo.com) — forecast + past weather (no API key)
- [Photon](https://photon.komoot.io) / [Nominatim](https://nominatim.org) —
  place search & reverse geocoding (OpenStreetMap)
- [Leaflet](https://leafletjs.com) + CARTO / Esri base maps

## How it works

The scoring logic lives in pure, unit-tested modules under [`src/lib/`](src/lib):
`drying.js` (water-balance dryness), `temperature.js` (comfort band),
`summary.js` (windows, next-rain, next-best-ride, daily outlook). The Vue
components are a thin presentation layer over those.

## License

MIT
