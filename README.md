# Better STB

[![Build](https://github.com/fabian20ro/alt-stb/actions/workflows/deploy.yml/badge.svg)](https://github.com/fabian20ro/alt-stb/actions/workflows/deploy.yml)

Real-time arrivals for bus, tram, trolleybus, and subway across Bucharest.
No accounts, no tracking, runs entirely in your browser.

**[Open the live app](https://fabian20ro.github.io/alt-stb/)**

## Features

- Real-time arrivals for all 2,710 STB stations (bus, tram, trolleybus, subway M1–M4)
- Interactive map with GPS-based station discovery
- Map caps visible markers at 100 and always keeps the selected station on screen
- Favorites and recent stations
- Station search tolerates Romanian diacritics, punctuation, and extra whitespace
- Light/dark theme, Romanian/English
- Installable as PWA, including iOS Home Screen support
- Fixed auto-refresh every 20s, with immediate refresh when you return to the tab
- Station data freshness follows the 4 AM Romanian transit-day boundary
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
Transit requests are sent from your browser to a lightweight project proxy (Vite middleware in development, Cloudflare Worker in production), which injects the headers required by STB (for example `App-Id` and `User-Info`).
The proxy relays responses back to the browser and does not persist transit telemetry or user location data.
Transit data (c) STB SA / TPBI. This project is not affiliated with STB or TPBI.

## Development

```bash
# Setup environment variables
cp .env.example .env

# Install dependencies
npm install

# Run development server
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
