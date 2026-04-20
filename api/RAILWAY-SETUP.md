# API Deployment Guide

## Primary: Fly.io (active)

The Express API deploys to Fly.io via GitHub Actions on push to `main`.

- **App:** `clapcheeks-api`
- **URL:** `https://clapcheeks-api.fly.dev`
- **Region:** LAX (Los Angeles)
- **Health:** `GET /health`

### Required Secrets (Fly.io dashboard)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | `https://oouuoepmkeqdyzsxrnjh.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `STRIPE_SECRET_KEY` | Stripe live secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `RESEND_API_KEY` | Resend API key for email delivery |
| `WEB_URL` | `https://clapcheeks.tech` |
| `JWT_SECRET` | JWT signing secret |
| `NODE_ENV` | `production` |

### Set secrets via CLI

```bash
flyctl secrets set -a clapcheeks-api \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_KEY="..." \
  STRIPE_SECRET_KEY="..." \
  STRIPE_WEBHOOK_SECRET="..." \
  RESEND_API_KEY="..." \
  WEB_URL="https://clapcheeks.tech" \
  JWT_SECRET="..." \
  NODE_ENV="production"
```

### Manual deploy

```bash
cd api/
flyctl deploy --remote-only --app clapcheeks-api
```

### CI/CD

GitHub Actions workflow (`.github/workflows/deploy-api.yml`) auto-deploys on push to `main` when `api/**` files change. Requires `FLY_API_TOKEN` GitHub secret (already set).

Post-deploy health check is included in the workflow — verifies `/health` returns 200.

### Verify

```bash
curl https://clapcheeks-api.fly.dev/health
# {"status":"ok","db":"connected","latency_ms":...,"uptime":...,"version":"0.7.0"}
```

## Alternative: Railway (backup)

`railway.toml` is configured as a fallback. To use Railway instead:

```bash
npm install -g @railway/cli
railway login
cd api/
railway link  # select the clapcheeks-api service
railway up
```

## Resend DNS Configuration

For email delivery from `hello@clapcheeks.tech`, verify domain in the Resend dashboard at https://resend.com/domains and add the DNS records Resend provides to the clapcheeks.tech domain.

The API email module (`api/email/resend.js`) sends via Resend REST API using `RESEND_API_KEY`.
