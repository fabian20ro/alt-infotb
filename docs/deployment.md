# Deployment

Better STB has two deployed components that auto-deploy independently on push to `main`:

| Component | Hosting | URL | Trigger |
|---|---|---|---|
| Static app (frontend) | GitHub Pages | `https://fabian20ro.github.io/better-stb/` | Any push to `main` |
| API proxy (worker) | Cloudflare Workers | `https://better-stb-proxy.fabian20ro.workers.dev` | Push to `main` that changes `worker/*` |

Both deploy automatically. You just push to `main` and everything updates.

## Frontend (GitHub Pages)

**Deploys automatically** on every push to `main` via GitHub Actions (`.github/workflows/deploy.yml`).

Pipeline: `svelte-check` -> `vitest` -> `vite build` -> deploy to GitHub Pages.

The production build reads `VITE_STB_API_BASE` from `.env.production` to know the worker URL.

### How it connects to the worker

```
.env.production
  VITE_STB_API_BASE=https://better-stb-proxy.fabian20ro.workers.dev

    |  baked into the JS bundle at build time
    v

build/_app/immutable/nodes/2.*.js
  contains: "https://better-stb-proxy.fabian20ro.workers.dev"
```

If the worker URL ever changes, update `.env.production` and push.

## Worker (Cloudflare)

**Deploys automatically** via Cloudflare's Git integration. Connected to the `fabian20ro/better-stb` GitHub repo.

### Cloudflare Git integration settings

Configured at: [Cloudflare dashboard](https://dash.cloudflare.com/) > Workers & Pages > `better-stb-proxy` > Settings > Build

| Setting | Value |
|---|---|
| Git repository | `fabian20ro/better-stb` |
| Production branch | `main` |
| Build command | `npm install` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `worker` |
| Build watch paths | `worker/*` |
| Build cache | Disabled |
| Builds for non-production branches | Enabled |

**Build watch paths** is set to `worker/*` so the worker only redeploys when files inside `worker/` change. Pushes that only touch `src/`, `docs/`, etc. do not trigger a worker build.

### How it works

1. You push to `main`
2. Cloudflare checks if any files in `worker/*` changed
3. If yes: `cd worker && npm install && npx wrangler deploy`
4. Worker is live in ~10 seconds, zero downtime

### API token

Cloudflare auto-created an API token named **"Workers Builds"** (2026-02-15) for the Git integration. This token lets Cloudflare deploy the worker on your behalf. You don't need to manage it — it's visible under Settings > API Token in the worker dashboard.

## Manual deployment (fallback)

If auto-deploy breaks or you need to deploy outside of Git:

### First-time setup (one-time)

```bash
cd worker
npm install
npx wrangler login    # Opens browser to authenticate with Cloudflare
```

### Deploy manually

```bash
cd worker
npm run deploy        # Alias for: npx wrangler deploy
```

### Test locally before deploying

```bash
cd worker
npm run dev           # Starts worker at http://localhost:8787
```

```bash
curl -s -o /dev/null -w "%{http_code}" 'http://localhost:8787/lines/stop?stop_id=3570'
# Should print: 200
```

## Monitoring

### Worker logs

```bash
cd worker
npx wrangler tail     # Live log stream
```

Or: [Cloudflare dashboard](https://dash.cloudflare.com/) > Workers & Pages > `better-stb-proxy` > Logs

### Worker metrics

[Cloudflare dashboard](https://dash.cloudflare.com/) > Workers & Pages > `better-stb-proxy` > Metrics

Shows request count, error rate, latency, CPU time.

### Frontend deploy status

[GitHub Actions](https://github.com/fabian20ro/better-stb/actions) > latest workflow run

## Troubleshooting

### Worker issues

| Problem | Cause | Fix |
|---|---|---|
| Worker returns 502 | STB API down or auth changed | Check `npx wrangler tail` for errors |
| Worker returns 404 | Path not in whitelist | Only `/lines/stop` is allowed (`ALLOWED_PATHS` in `index.ts`) |
| Worker returns 405 | Non-GET request | Worker only accepts GET and OPTIONS |
| Auth 412 loops | STB changed credentials | Re-check `info.stb.ro/main-es2015.*.js` for new `userInfoAppKey` |
| CORS errors in browser | Origin not in allow list | Add origin to `ALLOWED_ORIGINS` in `worker/src/index.ts` |

### Deployment issues

| Problem | Cause | Fix |
|---|---|---|
| Worker didn't auto-deploy | Files outside `worker/` changed | Expected behavior — only `worker/*` triggers deploy |
| Worker didn't auto-deploy | Git integration disconnected | Check Cloudflare dashboard > Settings > Build > Git repository |
| `wrangler deploy` fails locally | Not logged in | Run `npx wrangler login` |
| Frontend shows old worker URL | `.env.production` not committed | Verify it's tracked in git and has correct URL |
| Frontend loads but no data | Worker down or URL wrong | Test worker directly: `curl https://better-stb-proxy.fabian20ro.workers.dev/lines/stop?stop_id=3570` |

### Nuclear option: redeploy everything from scratch

```bash
# 1. Redeploy worker
cd worker && npm install && npx wrangler deploy

# 2. Verify worker works
curl -s -o /dev/null -w "%{http_code}" 'https://better-stb-proxy.fabian20ro.workers.dev/lines/stop?stop_id=3570'

# 3. Rebuild and redeploy frontend
cd .. && npm run build && git push origin main
```

## Architecture diagram

```
GitHub repo (push to main)
    |                    |
    |                    | (only if worker/* changed)
    v                    v
GitHub Actions        Cloudflare Git Build
    |                    |
    | npm run build      | cd worker && npm install
    | (reads .env.prod)  | npx wrangler deploy
    v                    v
GitHub Pages          Cloudflare Edge
(static HTML/JS)      (better-stb-proxy worker)
    |                    |
    |   Browser ------>  |  ------> info.stb.ro
    |   (no headers)     |  (injects Auth + headers)
```

## Quick reference

```bash
# Everything auto-deploys on push. But if you need to do it manually:

# Deploy worker
cd worker && npm run deploy

# Test worker
curl 'https://better-stb-proxy.fabian20ro.workers.dev/lines/stop?stop_id=3570'

# View worker logs
cd worker && npx wrangler tail

# Rebuild frontend
npm run build
```
