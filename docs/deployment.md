# Deployment

Better STB has two deployed components:

| Component | Hosting | URL |
|---|---|---|
| Static app (frontend) | GitHub Pages | `https://fabian20ro.github.io/better-stb/` |
| API proxy (worker) | Cloudflare Workers | `https://better-stb-proxy.fabian20ro.workers.dev` |

## Frontend (GitHub Pages)

The frontend deploys automatically on push to `main` via GitHub Actions.

```bash
git push origin main
```

That's it. The workflow runs type-check, tests, build, and deploys to GitHub Pages.

The production build reads `VITE_STB_API_BASE` from `.env.production` to know the worker URL.

## Worker (Cloudflare)

The worker does **not** auto-deploy. You must deploy it manually when you change `worker/src/index.ts`.

### First-time setup

```bash
cd worker
npm install
npx wrangler login    # Opens browser to authenticate with Cloudflare
npx wrangler deploy   # Deploys to https://better-stb-proxy.fabian20ro.workers.dev
```

### Deploying a new version

```bash
cd worker
npm run deploy        # Alias for: wrangler deploy
```

That's it. Wrangler reads `wrangler.toml` for the worker name and entry point, builds the TypeScript, and pushes it to Cloudflare. Deploys take ~5 seconds and are instant (no downtime).

### Testing locally before deploying

```bash
cd worker
npm run dev           # Starts worker at http://localhost:8787
```

Test it:

```bash
curl -s -o /dev/null -w "%{http_code}" 'http://localhost:8787/lines/stop?stop_id=3570'
# Should print: 200
```

### When to redeploy the worker

You only need to redeploy the worker if you change:

- `worker/src/index.ts` (proxy logic, auth flow, allowed paths, CORS)
- `worker/wrangler.toml` (worker name, compatibility date)

Changes to the frontend (`src/`, `vite.config.ts`, etc.) do **not** require a worker redeploy.

### Monitoring

The worker has observability enabled (`wrangler.toml`). View logs and metrics at:

```bash
npx wrangler tail     # Live log stream (from worker/ directory)
```

Or visit the [Cloudflare dashboard](https://dash.cloudflare.com/) > Workers & Pages > `better-stb-proxy`.

### Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Worker returns 502 | STB API is down or auth changed | Check `npx wrangler tail` for error details |
| Worker returns 404 | Path not in whitelist | Only `/lines/stop` is allowed (see `ALLOWED_PATHS` in `index.ts`) |
| Worker returns 405 | Non-GET request | Worker only accepts GET and OPTIONS |
| `wrangler deploy` fails | Not logged in | Run `npx wrangler login` |
| Auth token errors (412 loops) | STB changed credentials | Re-check `info.stb.ro/main-es2015.*.js` for new `userInfoAppKey` value |

## Quick reference

```bash
# Deploy frontend (automatic on push)
git push origin main

# Deploy worker (manual)
cd worker && npm run deploy

# Test worker locally
cd worker && npm run dev

# View worker logs
cd worker && npx wrangler tail
```
