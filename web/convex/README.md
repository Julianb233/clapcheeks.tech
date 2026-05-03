# Convex — Clapcheeks Messaging Engine

Foundation scaffolded under Linear AI-9196 (Phase 3 of off-Fly migration).

## Scope

Convex owns ONLY the live messaging engine. Postgres (Supabase) still owns
users, profiles, subscriptions, billing, photos, and analytics. See
`/opt/agency-workspace/.claude/rules/` rationale notes (file
`AI-9196-architecture.md` if added) and the conversation thread Linear
AI-9196.

| Convex tables | Replaces (Postgres) |
|---|---|
| `conversations` | `clapcheeks_matches` (live state subset) |
| `messages` | `clapcheeks_messages` (live state subset) |
| `scheduled_messages` | `clapcheeks_scheduled_messages` |
| `agent_jobs` | `agent_jobs_queue` |
| `drip_states` | drip columns on `clapcheeks_matches` |

## Files

| File | Purpose |
|---|---|
| `schema.ts` | Table definitions + indexes |
| `crons.ts` | Scheduled functions — replaces `pg_cron` + worker pollers |
| `conversations.ts` | Upsert + reactive list/get + reconciliation cron |
| `messages.ts` | Append, mark-read, recent-feed query |
| `scheduled_messages.ts` | Schedule, list, cancel, send-due cron |
| `agent_jobs.ts` | Enqueue, claim (atomic), complete/fail, reap-stuck cron |
| `drip.ts` | Drip state machine + advance cron |

## To deploy (NOT done tonight — needs Convex CLI auth)

1. From `web/`:
   ```
   npx convex dev
   ```
   First run prompts to authenticate via browser. Pick "create new project"
   named `clapcheeks` (or similar) — DO NOT reuse the existing
   `optimistic-cricket-162` deployment, which is JuliBoop's.

2. Convex CLI writes `.env.local` with `CONVEX_DEPLOYMENT` and
   `NEXT_PUBLIC_CONVEX_URL`. Add both to Vercel project env.

3. Wrap the Next.js app in `<ConvexProvider client={convex}>` — see
   `web/lib/convex.tsx` (TODO).

4. Use `useQuery` / `useMutation` hooks in components for live
   reactive UI. Example:
   ```tsx
   const conversations = useQuery(api.conversations.listForUser, {
     user_id: session.user.id,
   });
   ```

5. Migration of historical data from Postgres → Convex is the Hitesh task
   under AI-9196. Don't drop the Postgres tables until Convex has been
   live for 1+ week.

## Why this lives on Convex and not Postgres

- `crons.ts` replaces `pg_cron` + a separate worker poller. No more
  "is the worker running?" outages.
- Reactive queries in the dashboard replace Supabase Realtime channel
  subscription + reconnection plumbing.
- Atomic `agent_jobs.claim` mutation prevents two agents from double-
  picking the same job — Postgres needs `SELECT … FOR UPDATE SKIP LOCKED`
  patterns that have been a source of bugs.
- Document model fits messaging conversation state cleanly.

## What stays on Supabase

User identity, auth, RLS, Stripe-driven subscription state, profile
photos, immutable analytics. Industry-standard relational SaaS data —
Postgres is the right tool, Convex would be a downgrade.

## Bridge: Supabase ↔ Convex

The Mac agent and web app authenticate via Supabase Auth. To call Convex
functions on behalf of a Supabase user, set `user_id` arg to
`session.user.id` from the Supabase session. (No Convex Auth integration
tonight; that's a Hitesh task — likely Clerk-style JWT bridge or
Supabase JWT verification in a Convex HTTP action.)
