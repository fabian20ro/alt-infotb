# Better STB

[![Build](https://github.com/fabian20ro/alt-stb/actions/workflows/deploy.yml/badge.svg)](https://github.com/fabian20ro/alt-stb/actions/workflows/deploy.yml)

Real-time arrivals for bus, tram, trolleybus, and subway across Bucharest.
No accounts, no tracking, runs entirely in your browser.

**[Open the live app](https://fabian20ro.github.io/alt-stb/)**

## Features

- Real-time arrivals for all 2,710 STB stations (bus, tram, trolleybus, subway M1–M4)
- Interactive map with GPS-based station discovery
- Favorites and recent stations
- Light/dark theme, Romanian/English
- Installable as PWA
- Auto-refresh every 30s (optional)
- Offline support with cached data

## Tech Stack

- SvelteKit 2 with adapter-static
- Svelte 5 (runes syntax)
- TypeScript (strict mode)
- Vitest for unit tests
- vite-plugin-pwa for service worker
- Deployed on GitHub Pages

## Data Source Disclaimer

This app consumes publicly available transit data from STB SA / TPBI.
All transit data is fetched directly by your browser from STB's servers.
No data is stored, proxied, or redistributed by this application.
Transit data (c) STB SA / TPBI. This project is not affiliated with STB or TPBI.

## Development

```bash
npm install
npm run dev
```

## Test

```bash
npm test
```

## Build

```bash
npm run build
npm run preview
```

## License

MIT
