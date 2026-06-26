# F9 — Coaching Tips Reflect Real Data: Round 3 (FIX)
**Date:** 2026-06-25 | **Agent:** agent8 | **Linear:** AI-9592 (sub of AI-9561)

## Verdict: FIXED (data-correctness gaps closed; one deferred infra note)

Rounds 1–2 (2026-05-07) found 4 gaps. Between then and now the codebase advanced
(`getFleetUserId()` introduced, `sessionId` surfaced, a coaching cron registered).
This round closes the two remaining **data-correctness** gaps so the `/coaching`
page renders tips derived from real telemetry.

## Gap-by-gap status

| # | Gap | Prior | Now |
|---|-----|-------|-----|
| 1 | user_id split — coaching generation queried Convex telemetry with the Supabase auth UUID, never `fleet-julian` → empty rows → `null` → no tips | open | **FIXED this PR** |
| 2 | `/coaching` feedback POST omitted `sessionId` → 400 | open | already fixed (route surfaces `sessionId`; page sends it) |
| 3 | No automated weekly coaching generation | open | cron `weekly-coaching-session` registered; `internal.coaching.generateSession` is an intentional **no-op placeholder** that defers to lazy page-load generation. Functional pre-gen deferred (see Deferred). |
| 4 | 30-day analytics window vs 7-day product goal | open | **FIXED this PR** |

## Changes in this PR

- `web/app/api/coaching/tips/route.ts`
  - Analytics window 30d → **7d** (`since.setDate(getDate() - 7)`).
  - `getLatestCoaching` / `generateCoaching` now receive **`fleetUserId`** (was Supabase `user.id`). This aligns the on-demand coaching read/write + the telemetry query inside `generateCoaching` with the `fleet-julian` Convex namespace, matching the telemetry/conversation_stats queries at the top of the route. Per repo CLAUDE.md: *"An API route that uses `user.id` (Supabase UUID) for a Convex query is a bug."*
- `web/lib/coaching/generate.ts`
  - Analytics window 30d → **7d** (matches the route).
  - Claude prompt copy "past 30 days" → "past 7 days" so the LLM reasons over the same window it's given.

## Why this makes tips reflect real data

Before: `generateCoaching(supabase, user.id)` → `telemetry.getDailyForUser({user_id: <UUID>})`.
The daemon writes telemetry under `"fleet-julian"`, so the UUID query returned `[]`,
`generateCoaching` returned `null`, and the page showed an empty `tips` array (or stale cache).
After: the same call uses `fleet-julian`, so real daily telemetry rows are fetched,
aggregated, and fed to Claude — producing tips grounded in the operator's actual 7-day stats.

## Verification

- `getLatestCoaching` / `generateCoaching` now pass `fleetUserId`; no stray `user.id`
  reaches a Convex coaching call.
- Both the route and the generator use a 7-day window; prompt copy matches.
- Telemetry/conversation_stats queries at the top of the route already used
  `getFleetUserId()` — the coaching path is now consistent with them.

## Deferred (separate issue recommended)

- **Gap 3 (real weekly pre-generation):** `internal.coaching.generateSession` should call the
  analytics pipeline from inside Convex and `upsertSession` directly, instead of no-op'ing.
  This is a larger change (move LLM synthesis server-side / schedule an action) and is
  intentionally out of scope for this data-correctness fix. The cron target already exists,
  so wiring real generation is additive.
