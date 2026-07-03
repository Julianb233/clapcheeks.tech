# Clapcheeks Dashboard — Setup, Deploy & Verify SOP

> **Obsidian mirror doc.** Paste/symlink this into the vault at
> `Fleet/SOPs/Clapcheeks-Dashboard-Ops.md` so fleet docs match the repo.
> Canonical source of truth is this file in the repo (`docs/sops/`).
>
> **History:** This supersedes the never-created `OBSIDIAN-PASTE-SafeMove-dashboard.md`
> referenced by Linear **AI-8991**. The product was renamed **SafeMove/Outward → Clapcheeks**
> and migrated **Supabase Postgres → Convex**. The original checklist (`dashboard-src`,
> `scripts/001..006` SQL, `npm run verify:production`) no longer maps to the codebase; this
> doc is the modernized, accurate equivalent.

## What the dashboard is

`clapcheeks.tech` is Julian's operator-only AI dating co-pilot. The Next.js 15 app lives in
`web/`; the operator dashboard is auth-gated under `web/app/admin/clapcheeks-ops/*`. Live
state is in **Convex** (`web/convex/*.ts`), not Supabase. A Mac Mini Python daemon
(`clapcheeks-local/`) does the actual iMessage send/receive work.

## Deploy topology

```
 ┌──────────────┐   push main    ┌──────────────┐   auto-deploy   ┌─────────────────┐
 │ web/ (Next15)│ ─────────────► │   Vercel     │ ──────────────► │ clapcheeks.tech │
 │  App Router  │                │ clapcheeks-  │                 │  (auth → /login)│
 └──────┬───────┘                │  tech        │                 └─────────────────┘
        │ useQuery / useMutation                                            │
        ▼                                                                   │ operator taps
 ┌──────────────┐   convex deploy ┌────────────────────────┐               ▼
 │ web/convex/* │ ──────────────► │ Convex valiant-oriole- │◄──── Mac Mini daemon
 │ schema+fns   │                 │ 651 (source of truth)  │      (clapcheeks-local/)
 └──────────────┘                 └────────────────────────┘      BlueBubbles ↔ iMessage
```

| Piece | Value |
|---|---|
| Prod URL | `https://clapcheeks.tech` (all routes redirect to `/login` — auth-gated) |
| Vercel project | `clapcheeks-tech` → `prj_0Ra8fB9WK2RsKV31xUjnFXy2iAki` (team `team_Fs8nLavBTXBbOfb7Yxcydw83`) |
| Vercel link file | `web/.vercel/project.json` |
| Convex deployment | `valiant-oriole-651` → `https://valiant-oriole-651.convex.cloud` |
| Admin emails | `julian@clapcheeks.tech`, `admin@clapcheeks.tech`, `julianb233@gmail.com`, `julian@aiacrobatics.com` (others → `/dashboard`) |
| Mac Mini daemon | `ssh thewizzard@100.108.83.124`, logs `~/.clapcheeks/daemon.log` |

## Setup

1. **Env** — Vercel project must carry `NEXT_PUBLIC_CONVEX_URL` (→ `valiant-oriole-651`) plus
   the app's auth + integration keys. `NODE_ENV=production` is set by Vercel for prod builds.
2. **Convex** — schema/functions live in `web/convex/`. Convex deploys are **full-source
   replacements**: if local source is missing a module that's live, those functions get
   DELETED. Verify local source has every module before deploying.
   ```bash
   cd web
   CONVEX_DEPLOY_KEY="$(op item get 'CONVEX-clapcheeks-dev-admin-key' --vault API-Keys --fields credential --reveal)" \
     npx convex deploy -y
   npx convex function-spec --prod        # confirm your functions are listed
   ```
3. **Auth redirect URLs** — include the Vercel prod domain and any Tailscale Serve
   `https://…ts.net` host Julian uses from iPhone (see `LOCAL_MAC_IPHONE.md`).

## Deploy

- **Default:** push to `main` → Vercel auto-deploys.
- **Manual:** `cd web && VERCEL_TOKEN="…" npx vercel --prod --yes`
- Capture the deployment SHA and confirm it matches the merge commit.

## Verify (smoke test)

```bash
# 1. Build proven green? Vercel READY on the HEAD SHA IS the build gate.
curl -s "https://api.vercel.com/v6/deployments?projectId=prj_0Ra8fB9WK2RsKV31xUjnFXy2iAki&teamId=team_Fs8nLavBTXBbOfb7Yxcydw83&target=production&limit=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | python3 -c "import json,sys;d=json.load(sys.stdin)['deployments'][0];print(d['readyState'], d['meta'].get('githubCommitSha','')[:12])"

# 2. Unit tests on the same commit
cd web && npm test         # vitest — expect all passing

# 3. Route smoke — every route is auth-gated → 200 landing on /login
for u in / /admin/clapcheeks-ops /dashboard /login; do
  curl -sL -o /dev/null -w "$u -> %{http_code}\n" "https://clapcheeks.tech$u?cb=$(date +%s)"
done
# Expect: all 200, unauthenticated requests land on /login ("Sign In — Clapcheeks")
```

There is no `npm run verify:production` script — the production **Vercel READY state on the
HEAD commit** plus `npm test` is the equivalent build+verify gate.

## Done-when

Comment on the tracking Linear issue with: **prod URL**, **commit SHA**, **what was
click/route-tested**, and the Obsidian mirror path.
