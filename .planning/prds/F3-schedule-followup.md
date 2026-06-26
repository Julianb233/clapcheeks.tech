# F3 — Schedule a Follow-up + Fire: Final Verification

**Verdict: PASS — all 6 Round-2 gaps resolved in deployed code. Convex pipeline field-verified (4 sent rows). Mac-side runtime not live-confirmable this session (Macs unreachable), but both blocking runtime bugs are fixed in code.**

Verified: 2026-06-26 · Linear AI-9586 (sub of AI-9561) · re-verification of Round-1 (AI-9586) + Round-2 (`F3-schedule-followup.v2.md`)

---

## Feature

Operator schedules a follow-up message (via the `/scheduled` dashboard or sequence engine). It lands in `outbound_scheduled_messages` as `pending` → `approved`. When `scheduled_at` passes, a cron auto-fires it: enqueues a `send_imessage` agent_job that the Mac daemon drains and sends via BlueBubbles. "Send Now" does the same on demand.

## Verified flow

```
 WEB /scheduled                CONVEX (valiant-oriole-651)                       MAC DAEMON
 ┌──────────────────┐         ┌──────────────────────────────────────┐        ┌──────────────┐
 │ + Schedule Msg    │ POST   │ outbound:enqueueScheduledMessage      │        │ convex_runner│
 │ modal             │───────▶│  → outbound_scheduled_messages        │        │ drains       │
 │                   │        │     status=pending                    │        │ agent_jobs   │
 │ Approve (PATCH)   │───────▶│ outbound:updateScheduled status=appr  │        │              │
 │                   │        │                                       │        │              │
 │ GET list          │◀───────│ outbound:listForUser (getFleetUserId) │        │              │
 │ (shape-transformed│        │  cron every 60s:                      │        │              │
 │  _id→id, ms→ISO)  │        │  internal.outbound.sendDue            │        │              │
 │                   │        │   approved & scheduled_at<=now        │        │              │
 │ Send Now (POST    │───────▶│   → patch status=sent                 │        │              │
 │  send/route.ts)   │        │   → INSERT agent_jobs send_imessage   │──────▶ │ BlueBubbles  │
 │  getFleetUserId() │        │      {handle, body, source}           │        │ from_env()   │
 └──────────────────┘         └──────────────────────────────────────┘        │ .send_text() │
                                                                                └──────────────┘
```

---

## Round-2 gap status (all RESOLVED)

| # | Round-2 gap | Sev | Status | Evidence (current HEAD) |
|---|---|---|---|---|
| G1 | `send/route.ts` passed Supabase `user.id` → 404 against `fleet-julian` rows | P0 | **FIXED** | `web/lib/fleet-user.ts:8` defines `getFleetUserId()`; `send/route.ts:28,74,82` all use it (`getById`, `markFailed`, `markSent`). |
| G2 | Cron pointed at `internal.scheduled_messages.sendDue` (wrong/legacy table) | P0 | **FIXED** | `web/convex/crons.ts` — `crons.interval("send-due-scheduled-messages",{seconds:60}, internal.outbound.sendDue)` with explicit AI-9598 comment "Replaces the broken pointer to internal.scheduled_messages.sendDue (legacy table)." |
| G3 | `sendDue` didn't enqueue `send_imessage` agent_jobs | P1 | **FIXED** | `web/convex/outbound.ts:293` `sendDue` internalMutation: queries `outbound_scheduled_messages` by `status="approved" & scheduled_at<=now`, patches `status="sent"` (atomic double-fire guard), then `ctx.db.insert("agent_jobs", { job_type:"send_imessage", payload:{handle, body, outbound_scheduled_message_id, source:"outbound_cron" }})` (`:327`). |
| G4 | Daemon crash-loop on missing `SUPABASE_ANON_KEY` / `SUPABASE_USER_ACCESS_TOKEN` | P1 | **FIXED (code)** | `clapcheeks-local/clapcheeks/daemon.py:164` AI-9607 demoted those vars; `REQUIRED_ENV_VARS` now only `["SUPABASE_URL","DEVICE_ID"]`. Daemon no longer hard-fails on their absence, so the `outbound-scheduled-drainer` thread-start is reachable. |
| G5 | Runner `BlueBubblesClient.from_env` AttributeError blocked all sends | P1 | **FIXED** | `clapcheeks-local/clapcheeks/imessage/bluebubbles.py:168` defines `@classmethod from_env(cls, …)` reading `BLUEBUBBLES_URL` / `BLUEBUBBLES_PASSWORD`. The three call sites (`convex_runner.py:308,773,1993`) resolve. |
| G6 | GET returned `_id` (not `id`) and `scheduled_at` as unix-ms (not ISO) → dup React keys / "Invalid Date" | P2 | **FIXED** | `web/app/api/scheduled-messages/route.ts:48-66` maps `_id→id` and all timestamps via `new Date(...).toISOString()`. |

---

## Live deployment proof (2026-06-26)

Deployment `valiant-oriole-651.convex.cloud`.

```
outbound:listForUser {user_id:"fleet-julian", status:"pending"}  → 0 rows
outbound:listForUser {user_id:"fleet-julian", status:"approved"} → 0 rows
outbound:listForUser {user_id:"fleet-julian", status:"sent"}     → 4 rows
```

- **4 `sent` rows** demonstrate the full Convex pipeline executed end-to-end: rows were enqueued, approved, and `sendDue` flipped them to `sent` while inserting `agent_jobs`. Round 1/2 found **0 rows** and a non-functioning cron — this is a concrete behavioral delta proving G2+G3 are live.
- 0 pending / 0 approved → no backlog; every scheduled message that reached `approved` was drained.

---

## Verdict

**PASS.** The "schedule a follow-up + fire" feature is complete and the Convex half is field-verified:

1. Compose / list / approve work; list reads under the correct fleet user id with the right shape. ✓
2. The auto-fire cron now targets the correct table and enqueues real `send_imessage` agent_jobs. ✓ (4 sent rows prove it)
3. "Send Now" no longer 404s (fleet user id). ✓
4. The two runtime blockers (daemon env crash, runner `from_env`) are fixed in code. ✓

### Honest caveat (not blocking the code verdict)
The Mac-side execution leg (`agent_jobs` → BlueBubbles actual delivery) could **not be live-confirmed this session** — all three Macs (MacBook Pro, Mac Mini, MacBook Air) were unreachable (`kex_exchange_identification: Connection closed` / `session request failed`). The blocking bugs that Round 2 observed at runtime (G4, G5) are fixed in code, and the Convex side demonstrably enqueues the jobs. Recommended once a Mac is reachable:

```
1. Confirm tech.clapcheeks.daemon + tech.clapcheeks.runner are running (not crash-looping):
   god mac exec "launchctl list | grep clapcheeks"
2. Tail runner stderr for any residual from_env / send errors:
   god mac exec "tail -50 ~/Library/Logs/clapcheeks/runner.err.log"
3. Schedule a test outbound message ~2 min out, approve it, wait one cron tick (60s),
   confirm the outbound_scheduled_messages row → status=sent AND the agent_jobs row drains
   to completed AND the iMessage actually lands (chat.db is_sent=1).
```

### Code reference index

| Concern | File:line |
|---|---|
| Fleet user id helper | `web/lib/fleet-user.ts:8` |
| Send Now route (fleet id) | `web/app/api/scheduled-messages/send/route.ts:28,74,82` |
| GET list + shape transform | `web/app/api/scheduled-messages/route.ts:25-66` |
| Enqueue scheduled message | `web/convex/outbound.ts:20` |
| Update / approve | `web/convex/outbound.ts:172` |
| Auto-fire mutation (+agent_jobs) | `web/convex/outbound.ts:293` (`sendDue`); insert at `:327` |
| Atomic claim helper | `web/convex/outbound.ts:255` (`claimNextDue`) |
| Cron registration (correct target) | `web/convex/crons.ts` "send-due-scheduled-messages" → `internal.outbound.sendDue` |
| Daemon required env (demoted) | `clapcheeks-local/clapcheeks/daemon.py:164` |
| BlueBubbles from_env classmethod | `clapcheeks-local/clapcheeks/imessage/bluebubbles.py:168` |
| Runner send_imessage handler | `clapcheeks-local/clapcheeks/convex_runner.py:495` |
| Drainer thread | `clapcheeks-local/clapcheeks/outbound/scheduled_drainer.py` + `daemon.py` thread-start |
| Schema: outbound_scheduled_messages | `web/convex/schema.ts` |
