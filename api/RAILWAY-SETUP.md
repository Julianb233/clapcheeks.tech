# Railway Deployment Setup

## Required Environment Variables

Set these in the Railway service dashboard:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (e.g. `https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (not anon key) |
| `PORT` | Set by Railway automatically |
| `WEB_URL` | `https://clapcheeks.tech` (for CORS) |

## Manual Deploy

```bash
npm install -g @railway/cli
railway login
cd api/
railway link  # select the clapcheeks-api service
railway up
```

## GitHub Actions Auto-Deploy

1. Get a Railway deploy token: Railway Dashboard > Project > Settings > Tokens
2. Add `RAILWAY_TOKEN` as a GitHub Actions secret
3. Pushes to `main`/`master` that touch `api/**` will auto-deploy

## Configuration

The `railway.toml` in `api/` configures:
- Build: nixpacks with `npm install`
- Start: `node server.js`
- Health check: `GET /health`
- Restart policy: on failure (max 3 retries)
