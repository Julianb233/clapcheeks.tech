# F4 — Approve Auto-Draft → Agent Fires: Final Verification

**Verdict: PASS — chain is code-complete and deployed. All Round-1 P0s + the Round-2 residual gap are resolved.**

Verified: 2026-06-26 · Linear AI-9587 (sub of AI-9561) · re-verification of Round-1 (AI-9587) + Round-2 (`F4-approve-auto-draft.v2.md`)

---

## Feature

In **supervised** autonomy mode, an AI-drafted iMessage must NOT fire directly. It must be parked in the dashboard approval queue. When the operator taps **Approve**, the agent then fires the (optionally edited) message. Reject discards it.

## Verified flow

```
  DRAFT SOURCE                         CONVEX (valiant-oriole-651)              WEB DASHBOARD            MAC DAEMON
 ┌──────────────────┐                 ┌───────────────────────────┐          ┌──────────────────┐    ┌──────────────┐
 │ A) Mac runner     │  enqueue       │ queues:enqueueApproval     │          │ /autonomy         │    │ convex_runner│
 │ _handle_send_     │───approval────▶│  → approval_queue          │◀──read───│ listApprovalsFor  │    │ polls        │
 │ imessage (gate)   │  (supervised)  │   status=pending           │ getFleet │ User(fleet-julian)│    │ agent_jobs   │
 └──────────────────┘                 │                            │ UserId() └────────┬─────────┘    └──────┬───────┘
 ┌──────────────────┐  enqueue        │                            │                   │ Approve            │
 │ B) Convex         │───approval────▶│                            │   PATCH /autonomy-approval/[id]        │
 │ touches:fireOne   │ (supervised:   │ queues:decideApproval      │◀──────────────────┘                    │
 │ _getAutonomyLevel │  _getAutonomy  │  status=approved           │                                        │
 │ gate)             │  Level)        │  → INSERT agent_jobs        │────── send_imessage job ──────────────▶│ BlueBubbles
 └──────────────────┘                 │     job_type=send_imessage  │                                        │ send
                                       └───────────────────────────┘                                        └──────────────┘
```

Both draft sources (Mac-side `send_imessage` jobs **and** Convex-side scheduled touches) now honor the gate, reading from one source of truth: the `autonomy_config` table.

---

## Round-1 P0 status (all FIXED, re-confirmed in current code)

| # | Round-1 finding | Status | Evidence (current HEAD) |
|---|---|---|---|
| P0-1 | `enqueueApproval` never called by the runner | **FIXED** | `clapcheeks-local/clapcheeks/convex_runner.py:679-696` — `_handle_send_imessage` reads `autonomy_mode` from payload; `supervised`/`semi_auto` → `_cm("queues:enqueueApproval", …)`. Fail-closed: if enqueue fails it blocks the direct send (`:731`). |
| P0-2 | `autonomy/page.tsx` + count route used Supabase `user.id` for Convex | **FIXED** | `web/app/(main)/autonomy/page.tsx:28` `user_id: getFleetUserId()`; `web/app/api/autonomy-approval/count/route.ts:15` same. Runner stamps rows as `fleet-julian`; web reads with same key. |
| P0-3 | `decideApproval` flipped status but nothing fired | **FIXED** | `web/convex/queues.ts:401-420` — on `status==="approved"`, inserts `agent_jobs` row `job_type:"send_imessage"`, payload `{match_id, person_id, handle, body, source:"approved_draft", approval_id}`. |

## Round-2 residual gap status: **CLOSED**

Round 2 flagged that `touches.fireOne` (Convex-side scheduled fire path) inserted `agent_jobs` without consulting autonomy config, so Convex-originated touches bypassed the gate.

**Now closed.** `web/convex/touches.ts`:
- `_getAutonomyLevel` (`:1008`) reads the `autonomy_config` table (default `auto_send` when no row → existing fleets unchanged).
- `fireOne` (`:911-925`) — before enqueueing the send job, if `autonomyLevel === "supervised"` it calls `api.queues.enqueueApproval` (action_type `touch:<type>`, carries `person_id` + `touch_id` in `proposed_data`) and marks the touch `skipped / autonomy_supervised`. It does **not** reach `_enqueueSendJob`.
- `upsertAutonomyConfig` (`:1028`) is the single writer for `global_level` (literals: `supervised | semi_auto | auto_send | full_auto`), surfaced via `web/app/api/autonomy-config/route.ts`. This consolidates the legacy `clapcheeks_autonomy_config` into one Convex source of truth read by every gate.

---

## Live deployment proof (2026-06-26)

Deployment `valiant-oriole-651.convex.cloud` (`web/.env.local:42 NEXT_PUBLIC_CONVEX_URL`).

```
# Functions are deployed and serving (Round 1 returned [] — empty table):
POST /api/query queues:listApprovalsForUser {user_id:"fleet-julian", limit:200}
  → 5 rows, all status=approved, all decided_at set

POST /api/query queues:countPendingApprovalsForUser {user_id:"fleet-julian"}
  → 0   (no pending; all historical drafts were decided)
```

- The `approve → decided_at set` leg is **field-exercised**: 5 `send_imessage` approval rows exist (Ralph test harness `legacy_id: ralph-q22-…`, created 2026-05-07→08), all moved to `approved`. Round 1 found the table empty, so enqueue + decide are demonstrably working in prod.
- The Convex `fireOne → enqueueApproval` (touch-originated) leg is **code- + deploy-verified but not yet field-exercised**: 0 rows have `action_type` starting `touch:`. It only produces a row when a user's `autonomy_config.global_level = "supervised"` AND a scheduled touch fires. No supervised touch has fired in prod since the gate landed.

---

## Verdict

**PASS.** The end-to-end "approve auto-draft → agent fires" feature is complete and live:

1. Drafts in supervised mode are parked for approval from **both** entry points (Mac runner + Convex `fireOne`). ✓
2. The dashboard reads the queue under the correct fleet user id. ✓
3. Approve inserts an `agent_jobs` row the Mac daemon drains and sends; edited text is respected. ✓
4. All three Round-1 P0s and the Round-2 residual gap are resolved in deployed code. ✓

### One honest caveat (not blocking)
The Convex `fireOne` supervised branch is verified by code-read + deploy presence, not by a live supervised touch in production (0 `touch:*` approval rows to date). Recommended smoke test to convert this to fully field-verified:

```
1. upsertAutonomyConfig { user_id:"fleet-julian", global_level:"supervised" }
2. Schedule/drain a touch via touches.fireOne for a test person.
3. Confirm a new approval_queue row appears with action_type="touch:<type>", status=pending.
4. PATCH /api/autonomy-approval/[id] {status:"approved"}.
5. Confirm an agent_jobs row (source not required; person_id+touch_id in payload) is created
   and the Mac daemon picks it up within one poll cycle (~5s).
6. Restore global_level to its prior value.
```

### Code reference index

| Concern | File:line |
|---|---|
| Mac runner supervised gate | `clapcheeks-local/clapcheeks/convex_runner.py:679-739` |
| Convex enqueueApproval | `web/convex/queues.ts:287` |
| Convex listApprovalsForUser | `web/convex/queues.ts:322` |
| Convex countPendingApprovalsForUser | `web/convex/queues.ts:352` |
| Convex decideApproval (+agent_jobs insert) | `web/convex/queues.ts:365`, insert at `:403` |
| Web queue read (fleet id) | `web/app/(main)/autonomy/page.tsx:28` |
| Web count badge (fleet id) | `web/app/api/autonomy-approval/count/route.ts:15` |
| Web approve/reject PATCH | `web/app/api/autonomy-approval/[id]/route.ts` |
| Convex fireOne supervised gate | `web/convex/touches.ts:911-925` |
| Convex autonomy level read | `web/convex/touches.ts:1008` (`_getAutonomyLevel`) |
| Convex autonomy level write (SSOT) | `web/convex/touches.ts:1028` (`upsertAutonomyConfig`) |
| Web autonomy-config route | `web/app/api/autonomy-config/route.ts` |
| Schema: approval_queue / agent_jobs / autonomy_config | `web/convex/schema.ts:1155 / :150 / :1185` |
