# Deployment

Alt InfoTB has two deployed components that auto-deploy on push to `main`:

| Component | Hosting | URL | Trigger |
|---|---|---|---|
| Static app (frontend) | GitHub Pages | `https://fabian20ro.github.io/alt-infotb/` | Any push to `main` |
| API proxy (worker) | Cloudflare Workers | `https://alt-stb-proxy.fabian20ro.workers.dev` | Any push to `main` |

Both deploy from a single GitHub Actions workflow (`.github/workflows/deploy.yml`).

## Secrets management

**All secrets are stored in one place: GitHub repository secrets.**

Go to: [GitHub repo](https://github.com/fabian20ro/alt-infotb) > Settings > Secrets and variables > Actions

| Secret name | Purpose | Where it's used |
|---|---|---|
| `STB_APP_ID` | STB API app identifier | Worker (Cloudflare secret), local dev (`.env`) |
| `STB_APP_KEY` | STB API app key | Worker (Cloudflare secret), local dev (`.env`) |
| `CLOUDFLARE_API_TOKEN` | Deploys the worker via wrangler | GitHub Actions `deploy-worker` job |

### Setting secrets (one-time setup)

1. Get the STB credentials from the official STB web app's JS bundle at `info.stb.ro`
2. Create a Cloudflare API token at [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) > Create Token > "Edit Cloudflare Workers" template
3. Add all three as GitHub repository secrets
4. Set the repository variable `WORKER_DEPLOY_ENABLED` to `true`

The Worker deployment job stays skipped while the variable is absent or `false`.
This lets frontend CI and Pages remain healthy during credential rotation without
deploying an unauthenticated Worker. The currently deployed Worker keeps serving
traffic until the next enabled deployment.

### Rotating credentials

When STB changes their API credentials (check `info.stb.ro/main-es2015.*.js`):

1. Extract the new `App-Id` and `App-key` values from the JS bundle
2. Update the two GitHub secrets (`STB_APP_ID`, `STB_APP_KEY`)
3. Push any commit (or use "Run workflow" button) — the worker redeploys with new secrets
4. Update your local `.env` file for dev

That's it. The GitHub Actions workflow pushes the secrets to Cloudflare automatically via `wrangler-action`'s `secrets` parameter.

### Local development

Copy `.env.example` to `.env` and fill in `STB_APP_ID` and `STB_APP_KEY`. These are loaded by:
- Vite dev proxy (via `loadEnv()`)
- Scripts (via `dotenv/config`)
- Integration tests (vitest loads `.env` automatically)

## Frontend (GitHub Pages)

**Deploys automatically** on every push to `main` via the `build` + `deploy-frontend` jobs.

Pipeline: `svelte-check` -> `vitest` -> `vite build` -> deploy to GitHub Pages.

The production build reads `VITE_STB_API_BASE` from `.env.production` to know the worker URL.

### How it connects to the worker

```
.env.production
  VITE_STB_API_BASE=https://alt-stb-proxy.fabian20ro.workers.dev

    |  baked into the JS bundle at build time
    v

build/_app/immutable/nodes/2.*.js
  contains: "https://alt-stb-proxy.fabian20ro.workers.dev"
```

If the worker URL ever changes, update `.env.production` and push.

## Worker (Cloudflare)

**Deploys automatically** on every push to `main` via the `deploy-worker` job in GitHub Actions when `WORKER_DEPLOY_ENABLED` is `true`.

The `cloudflare/wrangler-action@v3` action:
1. Deploys the worker code via `wrangler deploy`
2. Pushes `STB_APP_ID` and `STB_APP_KEY` as Cloudflare secrets (from GitHub secrets)

No separate Cloudflare Git integration needed — everything goes through GitHub Actions.

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

If secrets haven't been set yet via GitHub Actions, set them manually:

```bash
cd worker
npx wrangler secret put STB_APP_ID    # Prompts for value
npx wrangler secret put STB_APP_KEY   # Prompts for value
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

Or: [Cloudflare dashboard](https://dash.cloudflare.com/) > Workers & Pages > `alt-stb-proxy` > Logs

### Worker metrics

[Cloudflare dashboard](https://dash.cloudflare.com/) > Workers & Pages > `alt-stb-proxy` > Metrics

Shows request count, error rate, latency, CPU time.

### Frontend deploy status

[GitHub Actions](https://github.com/fabian20ro/alt-infotb/actions) > latest workflow run

## Troubleshooting

### Worker issues

| Problem | Cause | Fix |
|---|---|---|
| Worker returns 502 | STB API down or auth changed | Check `npx wrangler tail` for errors |
| Worker returns 404 | Path not in whitelist | Only `/lines/stop` is allowed (`ALLOWED_PATHS` in `index.ts`) |
| Worker returns 405 | Non-GET request | Worker only accepts GET and OPTIONS |
| Auth 412 loops | STB changed credentials | Re-extract from `info.stb.ro/main-es2015.*.js`, update GitHub secrets, push |
| CORS errors in browser | Origin not in allow list | Add origin to `ALLOWED_ORIGINS` in `worker/src/index.ts` |

### Deployment issues

| Problem | Cause | Fix |
|---|---|---|
| Worker deploy fails in CI | Missing `CLOUDFLARE_API_TOKEN` secret | Add it in GitHub repo settings > Secrets |
| Worker deploys but auth fails | Missing `STB_APP_ID`/`STB_APP_KEY` secrets | Add them in GitHub repo settings > Secrets |
| `wrangler deploy` fails locally | Not logged in | Run `npx wrangler login` |
| Frontend shows old worker URL | `.env.production` not committed | Verify it's tracked in git and has correct URL |
| Frontend loads but no data | Worker down or URL wrong | Test worker directly: `curl https://alt-stb-proxy.fabian20ro.workers.dev/lines/stop?stop_id=3570` |

### Nuclear option: redeploy everything from scratch

```bash
# 1. Redeploy worker
cd worker && npm install && npx wrangler deploy

# 2. Set secrets manually if needed
npx wrangler secret put STB_APP_ID
npx wrangler secret put STB_APP_KEY

# 3. Verify worker works
curl -s -o /dev/null -w "%{http_code}" 'https://alt-stb-proxy.fabian20ro.workers.dev/lines/stop?stop_id=3570'

# 4. Rebuild and redeploy frontend
cd .. && npm run build && git push origin main
```

## Architecture diagram

```
GitHub repo (push to main)
    |
    v
GitHub Actions (.github/workflows/deploy.yml)
    |
    ├── build job
    |     npm run check → npm test → npm run build
    |
    ├── deploy-frontend job (needs: build)
    |     Upload to GitHub Pages
    |     |
    |     v
    |   GitHub Pages (static HTML/JS)
    |
    └── deploy-worker job (needs: build)
          wrangler deploy + push secrets
          |
          v
        Cloudflare Edge (alt-stb-proxy worker)

    Browser ──GET──▸ Worker ──GET + headers──▸ info.stb.ro
             (no custom       (injects App-Id,
              headers)         User-Info, etc.)
```

Secrets flow:
```
GitHub Secrets (single source of truth)
    |
    ├── STB_APP_ID ──▸ wrangler-action ──▸ Cloudflare Worker secret
    ├── STB_APP_KEY ──▸ wrangler-action ──▸ Cloudflare Worker secret
    └── CLOUDFLARE_API_TOKEN ──▸ wrangler-action (auth to deploy)
```

## Quick reference

```bash
# Everything auto-deploys on push. But if you need to do it manually:

# Deploy worker
cd worker && npm run deploy

# Test worker
curl 'https://alt-stb-proxy.fabian20ro.workers.dev/lines/stop?stop_id=3570'

# View worker logs
cd worker && npx wrangler tail

# Rebuild frontend
npm run build
```
