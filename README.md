# Better STB

Real-time arrival times for STB trams in București.
No accounts, no tracking, runs entirely in your browser.

## Features

- Arrival times for trams at Piața Unirii (7, 27, 47)
- Installable as PWA
- Dark theme, mobile-first
- Auto-refresh every 30s (optional)
- Offline support with cached data

## Tech Stack

- SvelteKit 2 with adapter-static
- Svelte 5 (runes syntax)
- TypeScript (strict mode)
- vite-plugin-pwa for service worker
- Deployed on GitHub Pages

## Data Source Disclaimer

This app consumes publicly available transit data from STB SA / TPBI.
All transit data is fetched directly by your browser from STB's servers.
No data is stored, proxied, or redistributed by this application.
Transit data &copy; STB SA / TPBI. This project is not affiliated with STB or TPBI.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## License

MIT &mdash; see LICENSE
