# Phase 5: Vercel Deployment Summary

Deployed clapcheeks.tech to Vercel with GitHub CI/CD integration, custom domain with SSL, and all Supabase environment variables configured.

## What Was Done

### 1. Created Vercel Project
- Project: `clapcheeks-tech` (ID: `prj_0Ra8fB9WK2RsKV31xUjnFXy2iAki`)
- Linked to GitHub repo: `Julianb233/clapcheeks.tech`
- Framework: Next.js, Root directory: `web`
- Team: `team_Fs8nLavBTXBbOfb7Yxcydw83` (AI Acrobatics)

### 2. Environment Variables
All environment variables added to Vercel project:

| Variable | Targets | Type |
|----------|---------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | production, preview, development | plain |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production, preview, development | plain |
| `SUPABASE_SERVICE_ROLE_KEY` | production, preview | encrypted |
| `NEXT_PUBLIC_SITE_URL` | production (`https://clapcheeks.tech`) | plain |
| `NEXT_PUBLIC_SITE_URL` | development (`http://localhost:3000`) | plain |

### 3. Custom Domains
- `clapcheeks.tech` - primary domain, verified
- `www.clapcheeks.tech` - redirects to `clapcheeks.tech` (308 permanent)

### 4. SSL Certificate
- Provider: Let's Encrypt (R12)
- Subject: `*.clapcheeks.tech` (wildcard)
- Valid: Mar 2, 2026 - May 31, 2026
- Auto-renews via Vercel

### 5. CI/CD
- Push to `main` branch auto-deploys to production
- Pull requests get preview deployments via Vercel GitHub integration
- PR comments enabled for deployment previews

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed vercel.json build commands**
- **Found during:** Initial deployment
- **Issue:** `vercel.json` at repo root had `cd web && npm install` and `cd web && npm run build` commands, which failed because Vercel project `rootDirectory` was set to `web` (commands already run from web/)
- **Fix:** Simplified vercel.json to only `{"framework": "nextjs"}`, letting Vercel project-level settings handle build/install commands
- **Files modified:** `vercel.json`
- **Commit:** `859f3f1`

## Deployment Details

| Deployment | Status | URL |
|------------|--------|-----|
| `dpl_6xdP1eZC3FKSzCxXkAbVHLwLtRie` | READY | clapcheeks.tech |

## Verification

- `https://clapcheeks.tech` - HTTP 200
- `https://www.clapcheeks.tech` - redirects to clapcheeks.tech, HTTP 200
- SSL valid with Let's Encrypt wildcard cert
- GitHub issue #5 closed

## Commits

- `859f3f1`: fix(deploy): remove cd web from vercel.json commands
