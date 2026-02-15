# AGENTS.md

Guidelines for AI agents and contributors working on this codebase.

## Memory & Continuous Learning

This project maintains a persistent learning system across AI agent sessions.

### Required Workflow

1. **Start of task:** Read `LESSONS_LEARNED.md` before writing any code
2. **During work:** Note any surprises, gotchas, or non-obvious discoveries
3. **End of iteration:** Append to `ITERATION_LOG.md` with what happened
4. **End of iteration:** If the insight is reusable and validated, also add to `LESSONS_LEARNED.md`
5. **Pattern detection:** If the same issue appears 2+ times in the log, promote it to a lesson

### Files

| File | Purpose | When to Write |
|------|---------|---------------|
| [`LESSONS_LEARNED.md`](./LESSONS_LEARNED.md) | Curated, validated, reusable wisdom | End of iteration (if insight is reusable) |
| [`ITERATION_LOG.md`](./ITERATION_LOG.md) | Raw session journal, append-only | End of every iteration (always) |

### Rules

- Never delete entries from `ITERATION_LOG.md` — it's append-only
- In `LESSONS_LEARNED.md`, obsolete lessons go to the Archive section, not deleted
- Keep entries concise — a future agent scanning 100 entries needs signal, not prose
- Date-stamp everything in `YYYY-MM-DD` format
- When in doubt about whether something is worth logging: log it

## Tech stack

| Layer | Technology | Version |
|---|---|---|
| Framework | SvelteKit | 2.x |
| UI library | Svelte | 5.x (runes syntax: `$state`, `$derived`, `$effect`, `$props`) |
| Language | TypeScript | 5.x (strict mode) |
| Build tool | Vite | 7.x |
| Test runner | Vitest | 4.x |
| PWA | vite-plugin-pwa / @vite-pwa/sveltekit | 1.x |
| Hosting | GitHub Pages (static adapter) | — |
| API proxy | Cloudflare Workers | — |
| E2E testing | Playwright | 1.x |
| API protocol | Protocol Buffers (custom decoder, no library) | — |

## Developer experience required

- **Svelte 5 runes** — The app uses the modern runes API (`$state`, `$derived`, `$effect`, `$props`), not the legacy `$:` reactive syntax. Understand how runes work before modifying stores or components.
- **TypeScript strict mode** — All code must pass `svelte-check` with strict settings. No `any` types, no implicit returns.
- **Protobuf wire format** — The STB API returns binary protobuf, not JSON. See `src/lib/api/proto.ts` for the decoder and `docs/api.md` for the schema. Understanding varint encoding and wire types is helpful when debugging API changes.
- **SvelteKit static adapter** — There is no server. All rendering happens client-side (`ssr = false`, `prerender = true`). API calls go through a proxy (Vite plugin in dev, Cloudflare Worker in prod).
- **Vitest** — Tests live next to source files (`*.test.ts`). Run `npm test` before committing.
- **Playwright** — E2E tests in `e2e/`. Run `npm run test:e2e` to verify the full app flow.

## UX expertise

- **Mobile-first** — The primary use case is checking tram times on a phone at the station. All design decisions optimize for a narrow viewport held at arm's length.
- **Dark theme** — Uses CSS custom properties defined in `app.css`. All colors use the `--color-*` variables. No light theme exists yet.
- **Minimal UI** — The interface shows exactly three things: line badge, direction, arrival times. No maps, no route details, no settings screens. Resist adding complexity.
- **Offline-first PWA** — The app should remain useful when the network is unreliable. Cached data displays immediately, then gets replaced by fresh data when available.
- **Romanian language** — UI strings are in Romanian. Keep them concise — display space is very limited on small screens.

## Documentation

Detailed documentation is in the [`docs/`](./docs/) folder:

- **[`docs/architecture.md`](./docs/architecture.md)** — High-level data flow, design decisions, protobuf schema
- **[`docs/codemap.md`](./docs/codemap.md)** — File-by-file directory listing, module dependency graph, configuration reference
- **[`docs/api.md`](./docs/api.md)** — STB API endpoint, auth flow, required headers, proxy architecture, curl examples
- **[`docs/deployment.md`](./docs/deployment.md)** — How to deploy the frontend (GitHub Pages) and worker (Cloudflare)

## Commands

```bash
# App
npm install          # Install dependencies
npm run dev          # Start dev server (with STB API proxy)
npm run check        # Type check (svelte-check)
npm test             # Run unit tests (vitest)
npm run test:integration  # Run integration tests (real API, needs network)
npm run test:e2e     # Run E2E tests (Playwright, needs dev server)
npm run build        # Production build (static)
npm run preview      # Preview production build

# Worker (auto-deploys on push if worker/* changed — see docs/deployment.md)
cd worker && npm install      # Install worker dependencies (first time only)
cd worker && npm run dev      # Run worker locally (localhost:8787)
cd worker && npm run deploy   # Manual deploy (normally not needed)
```

## Project conventions

- Test files live next to their source: `proto.ts` / `proto.test.ts`
- All configuration constants are in `src/lib/api/constants.ts`
- Components use Svelte 5 snippet-based slots, not legacy `<slot>`
- CSS is scoped per-component with global variables in `app.css`
- No external runtime dependencies (only devDependencies + @vite-pwa/sveltekit)
