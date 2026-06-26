# F8 — Spending + Funnel KPIs: Verification Verdict

**Date:** 2026-06-25
**Agent:** agent3
**Issue:** AI-9591 — "AI-9561 sub — F8 verify: spending + funnel KPIs are real"
**Parent:** AI-9561
**Repo:** `clapcheeks.tech` (queue labeled this `hafnia-financial` — wrong; the F8 KPIs live in the clapcheeks dashboard)
**Prior rounds:** R1 (2026-05-07, agent11) + R2 (`F8-spending-kpis.v2.md`, 2026-05-07, agent11) — both verdicts: SCHEMA REAL, DATA MISSING, fabricated `Date-ready` still present.

---

## Verdict: KPIs ARE REAL — the two prior fabrication/wiring gaps are now FIXED. Only data backfill remains (data-ops, not a code change).

The two open code findings from R1/R2 have both shipped since the v2 PRD was written:

1. **Fabricated `Date-ready` funnel stage — REMOVED** (AI-9526 F8).
2. **Read path migrated off the empty Supabase tables onto Convex** (AI-9575).

What is left is purely populating the Convex tables (a one-time backfill + an ongoing Mac-daemon writer), which requires `CONVEX_RUNNER_SHARED_SECRET` + live Convex/Mac-side access. No dashboard code change is needed.

---

## What changed since Round 2 (the deltas that flip the code verdict)

| Item | R2 (2026-05-07) | Now (2026-06-25) | Status |
|---|---|---|---|
| Fabricated `Date-ready = Math.round(messages * 0.3)` in `initialLiveData.funnel` | PRESENT (dashboard line 357) | **GONE** — grep across `dashboard/` returns no `* 0.3` and no `Date-ready` stage | fixed (AI-9526) |
| `conversation_stats` + `spending` read source | Supabase `clapcheeks_*` tables (frozen/legacy per CLAUDE.md) | **Convex** `api.conversation_stats.listForUser` + `api.spending.listForUser` | fixed (AI-9575) |
| `intelligence/page.tsx` `date_ready` | real count from events, but stage retained | stage dropped; ratios computed from real counts (`f.date_ready / f.replied`) — line 358-359 | clean |
| Both funnels real-aggregate only | chartData clean, initialLiveData fabricated | **both** clean: `Swipes -> Matches -> Conversations -> Dates Booked` from `totals.*` | clean |
| `Eve-Weekends` fake label | not found | not found | clean |
| `Warm` fallback (intelligence) | empty-state label, not a KPI | unchanged — acceptable | n/a |
| Convex tables populated for `fleet-julian` | empty (inferred) | **empty (live-confirmed)** — see below | backfill pending |

---

## Evidence

### Funnel — no fabrication (both arrays)
`web/app/(main)/dashboard/page.tsx`:
- `initialLiveData.funnel` (lines 382-387): `Swipes (totals.swipes_right) -> Matches (totals.matches) -> Conversations (totals.messages) -> Dates Booked (totals.dates)`.
- `chartData.funnel` (lines 399-404): `Swipes -> Matches -> Conversations (convoTotals.conversations_started) -> Dates (totals.dates)`.
- No `Math.round(* 0.3)`, no `Date-ready` stage anywhere under `dashboard/`. Grep confirmed.

### Read path — Convex, not the stale Supabase tables
`web/app/(main)/dashboard/page.tsx:97,111-123`:
```ts
// AI-9575: conversation_stats + spending migrated to Convex.
.query(api.conversation_stats.listForUser, { user_id: getFleetUserId() })
.query(api.spending.listForUser,           { user_id: getFleetUserId() })
```
This matches the project data rule (Convex is the only dating-engine store; the `clapcheeks_*` Supabase tables are frozen pre-migration snapshots and must not be read).

### Spending math — real, no fabrication
`externalSpent = spending.reduce(...amount)` (line 299) + `totals.money_spent` telemetry -> `totalSpent` feeds `costPerMatch`, `costPerDate`, `cpn` grade. All derived from real rows; zero rows => honest zeros, not invented numbers.

### Intelligence page — funnel ratios from real counts
`web/app/(main)/intelligence/page.tsx:96-97, 358-359`: `date_ready` sourced from `stats.stage_funnel` (real event counts); the lingering "Date-ready" standalone stage was dropped (AI-9526 note in source). Ratios shown only when denominators > 0, else `—`.

### Live data state (the remaining gap) — confirmed 2026-06-25
```
$ npx convex run conversation_stats:listForUser '{"user_id":"fleet-julian"}'  ->  []
$ npx convex run spending:listForUser           '{"user_id":"fleet-julian"}'  ->  []
```
Convex deployment `valiant-oriole-651`. Both tables respond correctly and are **empty**. The dashboard therefore shows honest zeros for conversations, spending, cost-per-match, cost-per-date, and CPN. Nothing is fabricated; the numbers are simply not yet populated.

---

## Remaining work (P1 — data-ops, NOT a dashboard code change)

Requires `CONVEX_RUNNER_SHARED_SECRET` + live Convex/Mac-side access — out of scope for a dashboard PR.

1. **One-time backfill** -> call the ready-but-uncalled mutations:
   - `conversation_stats:backfillConversationStatsFromScript` (aggregate daily `(platform, date)` counts from Convex `conversations`/`messages`).
   - `spending:backfillSpendingFromScript` (from telemetry `money_spent` / manual subscription costs).
2. **Ongoing writer** -> add a `conversation_stats:upsertDaily` call at the end of the `send_imessage` handler in the Mac daemon `convex_runner.py` so the table stays live.
3. **Verify** -> re-run the two `listForUser` queries; expect non-empty rows.

Track as a backfill/data-ops issue against an agent with live Convex + Mac access. This verification adds no further code work to the dashboard.

---

## Files verified (2026-06-25)

- `web/app/(main)/dashboard/page.tsx` (funnel + spending read path)
- `web/app/(main)/intelligence/page.tsx` (funnel ratios)
- `web/convex/conversation_stats.ts` + `web/convex/spending.ts` (backfill mutations exist, uncalled)
- Live Convex `valiant-oriole-651`: `conversation_stats:listForUser`, `spending:listForUser`

## Repo state note
At verification time the working tree carried 89 uncommitted files on branch `AI-10219-touches-schema-padding` (unrelated in-flight work). This PRD is committed in isolation in a clean worktree off `origin/main`; none of those changes are included.
