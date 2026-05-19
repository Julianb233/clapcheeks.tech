# ClapCheeks E2E Readiness Audit

Date: 2026-05-18

## Scope

This audit maps the active experimental readiness goal to current evidence. The goal is not complete until every required item below is proven, including a real message-to-Julian test if explicitly confirmed.

## Requirements And Evidence

| Requirement | Current status | Evidence |
| --- | --- | --- |
| Dashboard works end to end | Proved for touched dashboard surface | Browser E2E rendered `/dashboard` with no console errors; contract tests cover Convex `id` normalization, briefing counts, and iMessage dry-run gate. |
| Insights are functional | Proved for current implementation | `/intelligence` renders from `/api/analytics/summary?days=30`; contract test verifies analytics fallback and no unconfigured sidecar dependency. |
| Scheduled-message create/approve/send/cancel path works | Proved for dry-run and cancel; live send gated | Live API proof with `+17578312944`: create -> approve -> dry-run send -> audit-safe cancel. Live non-dry-run now requires `SEND LIVE TO JULIAN` plus the explicit live-send preflight gate. |
| Dashboard iMessage self-test works | Proved for dry-run; live send gated | API and browser proof show configured self-test recipient last4 `2944`, dry-run success, live without confirmation/phrase blocked, and live queueing locked behind the explicit preflight env gate. |
| No accidental real outbound sends | Proved for current UI/API gates | Dashboard iMessage and scheduled live sends require `SEND LIVE TO JULIAN`, ready live-send env, and target/body match to the preflight inputs. Dry-run remains default. No real send was performed during these passes. |
| Mobile quick-view is usable | Proved for scheduled page | Browser checks at 390x844 show no horizontal overflow; schedule modal opens; scheduled cleanup check verifies no test row left visible. |
| Runtime/inbound source of truth is reachable | Proved in read-only mode | `python -m clapcheeks.scripts.e2e_smoke --no-send`: Convex PASS, schema PASS, inbound Messages DB PASS with 1,288,752 messages. |
| Full real outbound send-to-Julian test | Not complete | Requires explicit destination number and exact message body confirmation before running a real send. |

## Repeatable Safe E2E Verifier

```bash
PORT=3002 CLAPCHEEKS_SELF_TEST_PHONE=+17578312944 npm run dev:runtime -- --hostname 127.0.0.1 --port 3002
npm run test:e2e:browser
npm run test:e2e:safe
npm run test:e2e:live
npm run test:e2e:audit
```

Latest result: passed on 2026-05-18. The verifier rendered `/dashboard`, `/scheduled`, `/intelligence`, and `/analytics`; checked `/api/analytics/summary?days=30`; proved the dashboard iMessage self-test dry-run for last4 `2944`; proved live iMessage is blocked without `SEND LIVE TO JULIAN`; proved live iMessage remains locked by the preflight env gate even with the phrase; created, approved, dry-ran, and audit-safe canceled a scheduled message for `+17578312944`; and wrote evidence to `/tmp/clapcheeks-safe-e2e-readiness.json`.

Latest Messages DB read-only evidence on 2026-05-18 01:17 PDT: the safe verifier queried `~/Library/Messages/chat.db` in read-only mode for the sample phone tail `2944`, logged no message content, and proved the local source of truth is reachable with `sample_handle_rows=28`, `sample_outbound_rows=14`, and `total_rows=1288752`.

Latest fixture cleanup result: passed on 2026-05-18. The safe verifier now scans active `pending` and `approved` scheduled rows for `Safe E2E Readiness` and `Live Send Evidence` fixtures, audit-safe cancels any leftovers, and proved `active fixtures=0`.

Latest core route matrix result: passed on 2026-05-18. The safe verifier checked 16 dashboard/operator routes and all returned 200: `/dashboard`, `/dashboard/matches`, `/dashboard/roster`, `/dashboard/content-library`, `/matches`, `/conversation`, `/leads`, `/scheduled`, `/intelligence`, `/analytics`, `/photos`, `/device`, `/autonomy`, `/settings/ai`, `/billing`, and `/support`.

Latest route matrix hardening on 2026-05-18 01:13 PDT: the same 16 dashboard/operator routes now require route-specific content assertions, not just HTTP 200. Fresh cold-start evidence passed with `16 routes ok with content assertions`; every route reported `missing: []`.

All-in-one safe command:

```bash
npm run test:e2e:readiness
```

Latest result: passed on 2026-05-18. This command ran the repeatable Chrome browser proof, safe API/send-path proof, fail-closed live-send refusal harness, and completion audit. It performed no live outbound send and ended with `Safe readiness suite complete. Overall completion remains gated by real live-send evidence.`

Cold-start safe command:

```bash
npm run test:e2e:readiness:local
```

Latest result: passed on 2026-05-18. This command started the env-backed dashboard locally, waited for `/dashboard`, ran the all-in-one safe readiness suite, and shut the server down afterward. Port `3002` was clear after completion.

## Browser Visual Evidence

Latest Chrome/Computer Use pass on 2026-05-18:

- Desktop `/dashboard`: roster command center rendered with Convex-derived active roster count `22`, quick actions, and runtime heartbeat warning visible.
- Mobile-width `/scheduled`: 430px-wide Chrome window showed mobile header, quick counters, segmented filters, and no visible horizontal overflow.
- Mobile schedule modal: opened from `+ Schedule Message`, showing match name, phone, message, send-at, type controls, and pending-review/live-delivery guardrail copy.
- Desktop `/intelligence`: rendered opener performance, platform bars, and conversation funnel values populated from analytics summary.
- Server self-test metadata: `GET /api/imessage/test` returned configured recipient last4 `2944` only.

Repeatable command: `npm run test:e2e:browser`.

Latest result: passed on 2026-05-18. Browser evidence manifest: `/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json`.

Latest verifier hardening on 2026-05-18 01:07 PDT: the Chrome visual verifier now polls each browser assertion for up to 30 seconds, reloads `/scheduled` or `/intelligence` only when Chrome is stuck in a transient empty/not-found cold-compile state, and captures a failure screenshot before exiting. Fresh cold-start evidence proved desktop dashboard, mobile scheduled quick view, mobile schedule modal, and desktop intelligence after this hardening.

## Fresh Verification Commands

```bash
npm run test:e2e:live:preflight
```

Result without live-send env: refused safely, wrote `/tmp/clapcheeks-live-send-preflight.json`, performed no send, performed no dashboard mutation, and confirmed safe non-live gates were already proved. Missing inputs were `CLAPCHEEKS_LIVE_SEND_PERMISSION`, `CLAPCHEEKS_LIVE_SEND_PHONE`, `CLAPCHEEKS_LIVE_SEND_BODY`, and `CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4`.

```bash
npm run test:e2e:audit
```

Result: all non-live gates proved; overall completion remains `not complete` because the real outbound send-to-Julian evidence is intentionally missing until live-send permission is explicit. Evidence file: `/tmp/clapcheeks-completion-audit-2026-05-18.json`.

```bash
npm run test:e2e:live
```

Result without live-send env: refused safely, wrote `/tmp/clapcheeks-live-send-evidence.json`, and performed no send. A real live-send evidence run requires all of `CLAPCHEEKS_LIVE_SEND_PERMISSION="SEND LIVE TO JULIAN"`, `CLAPCHEEKS_LIVE_SEND_PHONE`, `CLAPCHEEKS_LIVE_SEND_BODY`, and `CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4`.

Latest harness cleanup update: passed on 2026-05-18. If an authorized live-send evidence run creates or approves a fixture but fails before a verified send, the harness now attempts an audit-safe cancel and records the cleanup result in `/tmp/clapcheeks-live-send-evidence.json`.

Latest sample-number live-send guard on 2026-05-18 01:26 PDT: both `npm run test:e2e:live:preflight` and `npm run test:e2e:live` refuse a final destination ending in `2944` unless `CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944="I CONFIRM 757-831-2944 IS THE LIVE DESTINATION"` is also set. Verified with all normal live env present for `+17578312944`; preflight refused with no send/no mutation, and live harness refused before creating any dashboard row.

```bash
npm run test:e2e:status
```

Result: reported `NOT COMPLETE`, `Safe non-live gates: proved`, `Proved requirements: 6`, `Unproved requirements: 1`, and named the remaining gate as `real outbound send-to-Julian test`.

Latest status reporter update on 2026-05-18 01:19 PDT: status output now includes first-class Messages DB sample proof: `last4=2944`, `rows=28`, `outbound=14`, `content_logged=false`.

Latest status reporter update on 2026-05-18 01:24 PDT: status output now also includes first-class live preflight proof: `ready=false`, `no_send=true`, `missing=4`, with `no_dashboard_mutation_performed=true` in the JSON block.

Latest status reporter update on 2026-05-18 01:27 PDT: when the preflight blocker is only `CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944`, `npm run test:e2e:status` now prints the precise next action: confirm whether `757-831-2944` is intentionally the live destination and set the sample override only if so.

```bash
npm run test:e2e:evidence
```

Result: wrote consolidated evidence index `/tmp/clapcheeks-e2e-evidence-index-2026-05-18.json`; reported `Complete: false`, `Safe non-live gates proved: true`, `Proved requirements: 6`, `Unproved requirements: 1`, and remaining gate `real outbound send-to-Julian test`. The index records artifact existence and sizes for the safe verifier, Chrome visual proof, live-send refusal harness, completion audit, live-send runbook, and this readiness audit.

Latest evidence index update on 2026-05-18 01:19 PDT: the index now exposes the same Messages DB sample proof in `summary.messages_db_sample_rows`, `summary.messages_db_sample_outbound_rows`, and `evidence_highlights.messages_db`.

Latest evidence index update on 2026-05-18 01:22 PDT: the index now tracks `/tmp/clapcheeks-live-send-preflight.json` as `artifacts.live_preflight` and exposes `evidence_highlights.live_preflight`. Current preflight summary: `ready=false`, `no_send=true`, `missing=4`, `safe_non_live_gates_proved=true`.

```bash
npm exec -- node --test __tests__/*.test.mjs
```

Result: 34 passed.

Latest result after adding repeatable visual verifier coverage: 35 passed.

Latest result after adding repeatable completion-audit coverage: 36 passed.

Latest result after adding fail-closed live-send evidence harness coverage: 37 passed.

Latest result after adding the all-in-one safe readiness suite coverage: 38 passed.

Latest result after adding cold-start local readiness lifecycle coverage: 39 passed.

Latest result after adding scheduled test-fixture cleanup coverage: 40 passed.

Latest result after adding readiness status reporter coverage: 42 passed.

Latest result after adding core dashboard route matrix coverage: 43 passed.

Latest result after adding live-send failure cleanup coverage: 44 passed.

Latest result after adding consolidated evidence index coverage: 45 passed.

Latest result after adding cold-start verifier hardening coverage: 46 passed.

Latest result after promoting Messages DB proof in status/evidence reporters: 47 passed.

Latest result after adding no-send live-send preflight coverage: 48 passed.

Latest result after promoting live preflight into readiness status: 48 passed.

Latest result after making runtime no-send smoke a first-class audit gate: 49 passed.

```bash
npx tsc --noEmit --pretty false --incremental false 2>&1 | rg "app/\(main\)/(dashboard|scheduled|intelligence)|app/api/(scheduled-messages|imessage)|lib/convex/compat-client|dashboard-e2e-contract"
```

Result: no diagnostics for the touched scope.

Latest touched-scope filter after verifier hardening: no diagnostics for `scripts/e2e-readiness-safe`, `scripts/e2e-browser-visual-safe`, `dashboard-e2e-contract`, scheduled/iMessage routes, and Convex compat.

```bash
~/.clapcheeks-local/.venv/bin/python -m clapcheeks.scripts.e2e_smoke --no-send
```

Result: Convex PASS, schema PASS, inbound PASS, outbound/drainer skipped by `--no-send`.

Latest runtime smoke harness:

```bash
npm run test:e2e:runtime
```

Result: PASS. Evidence file `/tmp/clapcheeks-runtime-smoke-evidence.json` records `no_send=true`, `outbound_insert_skipped=true`, `drainer_skipped=true`, and `inbound_message_rows=1288753`.

Latest cold-start safe readiness suite after adding the runtime gate:

```bash
npm run test:e2e:readiness:local
```

Result: passed. The suite started the env-backed local dashboard, proved Chrome browser views, safe API/send-path checks, runtime no-send smoke, fail-closed live-send refusal, completion audit, and then shut the server down.

Latest status/evidence summary: `npm run test:e2e:status` and `npm run test:e2e:evidence` both report `Complete: false`, safe non-live gates proved, 7 proved requirements, 1 unproved requirement, runtime smoke `ok=true no_send=true inbound_rows=1288753`, and the remaining gate as the real outbound send-to-Julian test.

Latest final-gate clarity update:

- `npm run test:e2e:status` now reports the live harness and live preflight blockers separately.
- Current status: `live_env_missing=4`, `sample_override_required=false`, and `evidence_mismatch=false`.
- Meaning: the live harness evidence and no-send preflight evidence now agree. Both are fail-closed with the four base live-send env values missing. The next action is explicit: set Julian-confirmed live-send env and rerun `npm run test:e2e:live:preflight` before any live harness run.
- `npm run test:e2e:evidence` exposes the same final gate blockers.
- Fresh `npm run test:e2e:readiness:local` passed after this reporter hardening; the local server shut down afterward.
- Fresh contract tests passed: 49/49.
- Focused TypeScript check for the touched status/evidence/test files returned no diagnostics.

Latest safe-suite final-gate artifact refresh:

- Updated `npm run test:e2e:readiness` so it runs `npm run test:e2e:live:preflight` before the live-refusal harness.
- The suite now accepts a non-ready preflight only after validating `/tmp/clapcheeks-live-send-preflight.json` proves `no_send_performed=true` and `no_dashboard_mutation_performed=true`.
- Fresh `npm run test:e2e:readiness:local` passed after this change.
- Fresh `npm run test:e2e:status`: `live_env_missing=4`, `sample_override_required=false`, `evidence_mismatch=false`.
- Fresh `npm run test:e2e:evidence`: same final-gate blockers; runtime smoke still `ok=true no_send=true inbound_rows=1288753`.
- Fresh `npm exec -- node --test __tests__/*.test.mjs`: 49/49 passed.
- Focused TypeScript check for touched suite/test files returned no diagnostics.
- No live outbound send was performed.

## Status Evidence Freshness

Latest update: `npm run test:e2e:status` now reports freshness for the consolidated evidence index and includes artifact modified times from the index.

Fresh verification:

- `npm exec -- node --test __tests__/*.test.mjs`: 49/49 passed.
- Focused TypeScript check for touched status/test files returned no diagnostics.
- `npm run test:e2e:readiness:local`: passed from cold start and refreshed all evidence artifacts.
- `npm run test:e2e:status`: prints `Visual evidence: screenshots=6 all_present=true age_seconds=4` on the fresh run.
- Status JSON includes `evidence_index_generated_at`, `evidence_index_age_seconds`, screenshot file details, and artifact modified times for safe verifier, browser visual proof, runtime smoke, live refusal, live preflight, completion audit, runbook, and repo audit doc.
- `npm run test:e2e:status`: still not complete, safe non-live gates proved, 7 proved requirements, 1 unproved requirement, final gate blockers unchanged.
- Local server stopped after verification.
- No live outbound send was performed.

## Status Visual Evidence Summary

Latest update: `npm run test:e2e:status` now reads the consolidated evidence index and exposes browser screenshot integrity in the quick status output.

Fresh verification:

- `npm exec -- node --test __tests__/*.test.mjs`: 49/49 passed.
- Focused TypeScript check for touched status/test files returned no diagnostics.
- `npm run test:e2e:readiness:local`: passed from cold start and refreshed all six browser screenshots plus the evidence index.
- `npm run test:e2e:status`: prints `Visual evidence: screenshots=6 all_present=true` and includes each screenshot path, existence flag, byte size, and modified time in JSON.
- `npm run test:e2e:status`: still not complete, safe non-live gates proved, 7 proved requirements, 1 unproved requirement, final gate blockers unchanged.
- Local server stopped after verification.
- No live outbound send was performed.

## Browser Screenshot Integrity Index

Latest update: `/tmp/clapcheeks-e2e-evidence-index-2026-05-18.json` now includes screenshot-level integrity for the browser visual evidence.

## Scheduled Filter And Live-Gate Hardening

Latest update: fresh cold-start readiness on 2026-05-18 exposed a real dashboard gap: `/scheduled?filter=approved` could miss an approved fixture once the first `status=all&limit=100` page was crowded with older safe-test rows.

- Updated `/scheduled` so the visible list fetches the active status directly with `status=${listStatus}&limit=200`, while quick-view counters still fetch `status=all&limit=200`.
- Updated the Chrome visual verifier so scheduled mobile evidence proves API-bound counters, pending-list hydration, approved fixture visibility, and the send-confirmation guardrails.
- Updated the scheduled live-send preflight response to return a redacted execution plan and message SHA-256 without writing the raw phone or message body.
- Fresh `npm run test:e2e:readiness:local`: passed from cold start. Scheduled proof reported UI/API match, total `102`, pending `0`, approved `1`, guardrail cleanup `true`, active fixtures `0`, and no live outbound send.
- Fresh `npm run test:e2e:status`: still `NOT COMPLETE`, safe non-live gates proved, 10 proved requirements, 1 unproved requirement, scheduled live gate plan `redacted=true sha256=present`.
- Fresh `npm exec -- node --test __tests__/*.test.mjs`: 70/70 passed.
- Port `3002` was clear after the cold-start runner exited.

The remaining gap is unchanged by design: the real outbound send-to-Julian proof requires current explicit permission, destination, body, expected last4, and a matching live preflight before the live harness can run.

## Live-Send No-Send Rehearsal

Latest update: added a first-class no-send rehearsal for the final scheduled-send path.

- Added `scripts/e2e-live-send-rehearsal.mjs` and `npm run test:e2e:live:rehearsal`.
- The rehearsal reads the ready sample 757 preflight, creates a temporary scheduled row for the redacted plan, approves it, calls `/api/scheduled-messages/send` with `confirm_send: true` and `dry_run: true`, verifies the immediate adapter path `osascript Messages.send`, verifies message SHA-256 and last4 match the preflight, then audit-safe cancels the fixture.
- Evidence file: `/tmp/clapcheeks-live-send-rehearsal.json`.
- Fresh cold-start result: `Live-send no-send rehearsal: PASS`, source `sample_757`, destination `*******2944`, hash match `true`, last4 match `true`, cleanup `true`, no live send performed.
- Completion audit now has 11 proved safe requirements and 1 remaining unproved requirement: the real outbound send-to-Julian test.
- Fresh `npm run test:e2e:readiness:local`: passed.
- Fresh `npm run test:e2e:status`: safe non-live gates proved, live-send rehearsal `ok=true`, source `sample_757`, `no_send=true`, `dry_run=true`, `immediate=true`, `hash=true`, `last4=true`, `cleanup=true`.
- Fresh `npm exec -- node --test __tests__/*.test.mjs`: 71/71 passed.

This narrows the remaining gap to current explicit live-send approval and live evidence only. The route, adapter selection, fingerprint matching, browser/mobile views, cleanup, and no-send sample handling are now proved.

## Approval Packet Handoff Includes Rehearsal

Latest update: the live-send approval packet now includes the no-send rehearsal proof.

- Updated `scripts/e2e-live-send-approval-packet.mjs` so `current_safe_evidence.live_send_rehearsal` records source, no-send status, dry-run status, immediate adapter proof, SHA-256 match, last4 match, cleanup status, and raw phone/body absence.
- Updated the operator sequence to rerun `npm run test:e2e:live:rehearsal` if the safe evidence is not fresh before live preflight.
- Updated `npm run test:e2e:status` and `npm run test:e2e:evidence` so they print approval-packet rehearsal status.
- Fresh `npm run test:e2e:live:approval-packet`: `READY_FOR_APPROVAL`, safe gates proved, 11 proved requirements, live gate unproved, rehearsal `ok=true no_send=true immediate=true hash=true last4=true cleanup=true`, raw phone/body written `false`.
- Fresh `npm run test:e2e:evidence`: approval packet `ready=true no_send=true missing_base_env=4 rehearsal=true raw_phone_written=false raw_body_written=false`.
- Fresh `npm exec -- node --test __tests__/*.test.mjs`: 71/71 passed.

The final handoff packet now carries the same rehearsal evidence as the audit, so the remaining action is operational approval and live evidence only.

## Approval Packet Template

Latest update: the approval packet now includes a redacted current-approval request template.

- Added `approval_request_template` to `/tmp/clapcheeks-live-send-approval-packet-2026-05-18.json`.
- The template requires five lines: permission phrase, exact destination phone placeholder, expected last4 placeholder, exact message body placeholder, and the sample-2944 override phrase only if the destination ends in `2944`.
- The template records `raw_values_written=false`; it does not write the actual destination phone or message body into generated evidence.
- Operator verification notes now require checking that the destination, last4, and body match the current approval, and that old shell env is not reused without rechecking approval text.
- Fresh `npm run test:e2e:live:approval-packet`: template `required_lines=5`, `raw_values_written=false`, packet `READY_FOR_APPROVAL`.
- Fresh `npm run test:e2e:status`: approval packet `ready=true no_send=true missing_base_env=4 rehearsal=true template=true raw_phone_written=false raw_body_written=false`.
- Fresh `npm run test:e2e:evidence`: same packet summary with `template=true`.
- Fresh `npm exec -- node --test __tests__/*.test.mjs`: 71/71 passed.

The live-send handoff now has explicit, copyable fields for the only remaining blocker while still avoiding durable raw-phone/body storage.

## Human-Readable Approval Packet

Latest update: the approval packet now writes a Markdown handoff alongside the JSON packet.

- Added `/tmp/clapcheeks-live-send-approval-packet-2026-05-18.md` via `CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET_MD`.
- The Markdown packet contains current status, the approval fields, safe evidence summary, operator verification checklist, and command sequence.
- The Markdown uses placeholders for destination phone and message body and states that raw destination phone and raw message body are not written.
- Fresh `npm run test:e2e:live:approval-packet`: wrote JSON and Markdown packets, `READY_FOR_APPROVAL`, `required_lines=5`, `raw_values_written=false`.
- Fresh `npm run test:e2e:status`: approval packet `ready=true no_send=true missing_base_env=4 rehearsal=true template=true markdown=true raw_phone_written=false raw_body_written=false`.
- Fresh `npm run test:e2e:evidence`: same approval packet summary with `markdown=true`.
- Fresh `npm exec -- node --test __tests__/*.test.mjs`: 71/71 passed.

The final approval handoff is now both machine-readable and human-readable without persisting the raw live-send destination or body.

## Approval Packet Freshness Gate

Latest update: the consolidated evidence index now treats both approval handoff files as required fresh artifacts.

- Added `approval_packet` and `approval_packet_markdown` to the evidence index required-fresh artifact set.
- The evidence index will now fail the safe non-live readiness summary if `/tmp/clapcheeks-live-send-approval-packet-2026-05-18.json` or `/tmp/clapcheeks-live-send-approval-packet-2026-05-18.md` is missing, empty, or stale.
- Updated fingerprint-audit fixtures so synthetic evidence tests include both approval packet artifacts.
- Fresh `npm run test:e2e:evidence`: approval packet `ready=true no_send=true missing_base_env=4 rehearsal=true template=true markdown=true raw_phone_written=false raw_body_written=false`; artifact freshness `fresh=true`.
- Fresh `npm run test:e2e:status`: safe non-live gates proved, approval packet `markdown=true`.
- Fresh `npm exec -- node --test __tests__/*.test.mjs`: 71/71 passed.

The final approval handoff is no longer only generated; it is part of the required fresh evidence bundle.

Fresh verification:

- `npm exec -- node --test __tests__/*.test.mjs`: 49/49 passed.
- Focused TypeScript check for touched evidence/test files returned no diagnostics.
- `npm run test:e2e:readiness:local`: passed from cold start and refreshed the evidence index.
- Evidence index generated at `2026-05-18T08:52:23.096Z`.
- Screenshot integrity summary: `browser_screenshot_count=6`, `browser_screenshots_all_present=true`.
- Nonempty screenshot files recorded in the index:
  - `/tmp/clapcheeks-e2e-browser/dashboard-desktop-2026-05-18.png`
  - `/tmp/clapcheeks-e2e-browser/dashboard-mobile-2026-05-18.png`
  - `/tmp/clapcheeks-e2e-browser/scheduled-mobile-2026-05-18.png`
  - `/tmp/clapcheeks-e2e-browser/scheduled-mobile-modal-2026-05-18.png`
  - `/tmp/clapcheeks-e2e-browser/intelligence-desktop-2026-05-18.png`
  - `/tmp/clapcheeks-e2e-browser/intelligence-mobile-2026-05-18.png`
- `npm run test:e2e:status`: still not complete, safe non-live gates proved, 7 proved requirements, 1 unproved requirement, final gate blockers unchanged.
- Local server stopped after verification.
- No live outbound send was performed.

## Evidence Index In Safe Suite

Latest update: `npm run test:e2e:readiness` now runs `npm run test:e2e:evidence` after the completion audit, so the one-command safe suite leaves behind the consolidated evidence index automatically.

Fresh verification:

- `npm exec -- node --test __tests__/*.test.mjs`: 49/49 passed.
- Focused TypeScript check for touched suite/test files returned no diagnostics.
- `npm run test:e2e:readiness:local`: passed from cold start and ended by writing `/tmp/clapcheeks-e2e-evidence-index-2026-05-18.json`.
- Evidence index generated at `2026-05-18T08:49:33.893Z`.
- Evidence index confirms all expected artifacts exist: safe verifier, browser visual proof, runtime smoke, live refusal, live preflight, and completion audit.
- Evidence index summary: `complete=false`, safe non-live gates proved, 7 proved requirements, 1 unproved requirement, `no_live_send_performed=true`, `final_gate_evidence_mismatch=false`, runtime inbound rows `1288753`.
- `npm run test:e2e:status`: still not complete, final gate is the real outbound send-to-Julian test.
- Local server stopped after verification.
- No live outbound send was performed.

## Evidence Files

- `/tmp/clapcheeks-browser-qa.json`
- `/tmp/clapcheeks-scheduled-cleanup-qa.json`
- `/tmp/clapcheeks-self-test-browser-qa.json`
- `/tmp/clapcheeks-dashboard-self-test-dryrun.png`
- `/tmp/clapcheeks-scheduled-phrase-gate.png`
- `/tmp/clapcheeks-scheduled-phrase-gate-qa.json`
- `/tmp/clapcheeks-safe-e2e-readiness.json`
- `/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json`
- `/tmp/clapcheeks-completion-audit-2026-05-18.json`
- `/tmp/clapcheeks-runtime-smoke-evidence.json`
- `/tmp/clapcheeks-live-send-evidence.json`
- `/tmp/clapcheeks-live-send-preflight.json`
- `/tmp/clapcheeks-e2e-evidence-index-2026-05-18.json`
- `/tmp/clapcheeks-e2e-browser/dashboard-desktop-2026-05-18.png`
- `/tmp/clapcheeks-e2e-browser/dashboard-mobile-2026-05-18.png`
- `/tmp/clapcheeks-e2e-browser/scheduled-mobile-2026-05-18.png`
- `/tmp/clapcheeks-e2e-browser/scheduled-mobile-modal-2026-05-18.png`
- `/tmp/clapcheeks-e2e-browser/intelligence-desktop-2026-05-18.png`
- `/tmp/clapcheeks-e2e-browser/intelligence-mobile-2026-05-18.png`

## Remaining Completion Gate

The only known unproven requirement is the real outbound message-to-Julian test. It should be run only after explicit confirmation of:

1. Destination number.
2. Exact message body.
3. Permission to perform a live send.

After live send, completion evidence must include the route response plus Messages DB or drainer verification showing the message actually sent.

Final live-send runbook: `docs/e2e-live-send-runbook.md`.

## Dashboard Mobile Quick-View Coverage

Latest update: the repeatable Chrome visual verifier now checks `/dashboard` at 430px mobile width, asserts command-center content and no horizontal overflow, captures `/tmp/clapcheeks-e2e-browser/dashboard-mobile-2026-05-18.png`, and writes `dashboard_mobile_quick_view=true` into `/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json`.

Fresh verification:

- `npm exec -- node --test __tests__/*.test.mjs`: 49/49 passed.
- Focused TypeScript check for touched browser/audit/test files returned no diagnostics.
- `npm run test:e2e:readiness:local`: passed from cold start, including dashboard desktop, dashboard mobile quick view, scheduled mobile quick view, scheduled modal, intelligence desktop, safe API/send path, runtime no-send smoke, live preflight refusal, live harness refusal, and completion audit.
- `npm run test:e2e:status`: still not complete, safe non-live gates proved, 7 proved requirements, 1 unproved requirement, final gate blockers unchanged.
- `npm run test:e2e:evidence`: same 7/1 summary and final-gate blockers.
- Local server stopped after verification.
- No live outbound send was performed.

## Scheduled Flow Status Summary

Latest update: `npm run test:e2e:status` now reads `/tmp/clapcheeks-safe-e2e-readiness.json` and reports the scheduled-send proof directly in the quick status output.

Fresh verification:

- `npm exec -- node --test __tests__/*.test.mjs`: 49/49 passed.
- Focused TypeScript check for touched status/test files returned no diagnostics.
- `npm run test:e2e:readiness:local`: passed from cold start and refreshed browser, safe API, runtime, live-preflight, live-refusal, completion-audit, and evidence-index artifacts.
- Safe scheduled flow created fixture `ps7fx6czx2z918mem3dzq62xr986z32n`, approved it, proved live send is blocked without the required phrase, performed a dry-run through adapter `god draft`, cancelled it from the dashboard path, and confirmed `active fixtures=0`.
- `npm run test:e2e:status`: prints `Scheduled flow: created=true approved=true dry_run=true cleanup=true active_fixtures=0`.
- Status JSON now includes `scheduled_flow.evidence_path`, `created_id`, `live_blocked_without_phrase`, `dry_run_adapter`, `dry_run_last4`, and cleanup fields.
- Final readiness status remains `NOT COMPLETE` because the only unproved requirement is still the real outbound send-to-Julian test.
- No live outbound send was performed.

## Mobile Quick-View Metric Evidence

Latest update: the Chrome-controlled visual verifier now records durable viewport metrics for each mobile quick-view screen, not just screenshots and pass/fail booleans.

Fresh verification:

- `npm exec -- node --test __tests__/*.test.mjs`: 50/50 passed.
- `bash -n scripts/e2e-browser-visual-safe.sh scripts/e2e-readiness-all-safe.sh scripts/e2e-readiness-local-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm run test:e2e:readiness:local`: passed from cold start and regenerated Chrome screenshots plus mobile metrics.
- `npm run test:e2e:status`: prints `Mobile metrics: pages=4 overflow_free=true`.
- Metric evidence now covers dashboard mobile, scheduled mobile, scheduled modal, and intelligence mobile at 430px viewport width.
- Latest measured mobile pages all report `inner_width=430`, `scroll_width=430`, and `overflow_x=false`.
- Completion audit now requires `mobile_metrics_overflow_free=true` for the `mobile quick-view UX works` gate.
- Evidence index now records `mobile_metric_count=4`, `mobile_metrics_overflow_free=true`, and the per-page metric payloads.
- Local server stopped after verification.
- No live outbound send was performed.

## Insights Analytics Contract Evidence

Latest update: the safe E2E verifier now checks the `/api/analytics/summary?days=30` response as an insights data contract instead of only checking for top-level fields.

Fresh verification:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 25/25 passed.
- `node --check scripts/e2e-readiness-safe.mjs && node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm run test:e2e:readiness:local`: passed from cold start and refreshed browser, safe API, runtime, live-preflight, live-refusal, completion-audit, and evidence-index artifacts.
- `npm exec -- node --test __tests__/*.test.mjs`: 51/51 passed.
- Safe API evidence now includes `analytics summary contract`.
- Latest proven analytics summary: `matches=22`, `conversations=200`, `platforms=3`, `days=5`, `funnel=Swipes>Matches>Conversations>Dates`.
- Contract checks include numeric totals, platform row schema, time-series row schema, spending shape, data-quality warnings shape, match-rate fields, rizz score/trend shape, required funnel stages, and consistency between the `Conversations` funnel stage and `totals.conversations`.
- Completion audit now requires `analytics summary contract` for the `insights are functional` gate.
- `npm run test:e2e:status`: prints `Insights data: contract=true matches=22 conversations=200 platforms=3 days=5`.
- Local server stopped after verification.
- No live outbound send was performed.

## Dashboard Runtime Health Contract Evidence

Latest update: the safe E2E verifier now checks dashboard runtime health through actual local API calls to `/api/health?detailed=true` and `/api/agent/token-health`.

Fresh verification:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 26/26 passed.
- `node --check scripts/e2e-readiness-safe.mjs && node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm run test:e2e:readiness:local`: passed from cold start and refreshed browser, safe API, runtime, live-preflight, live-refusal, completion-audit, and evidence-index artifacts.
- `npm exec -- node --test __tests__/*.test.mjs`: 52/52 passed.
- Safe API evidence now includes `dashboard runtime health contract`.
- Latest proven dashboard health summary: `overall=healthy`, `convex=healthy`, `missing_required=3`, `sendbird=missing`.
- Token-health proof confirms four platform rows are present, required token blockers are surfaced, and token values are omitted/redacted.
- The verifier records the scope limitation: health proves Convex reachability, optional service status, and redacted token metadata; it is not a full backend schema/index doctor.
- Completion audit now requires `dashboard runtime health contract` for the `dashboard works end to end` gate.
- `npm run test:e2e:status`: prints `Dashboard health: contract=true overall=healthy convex=healthy missing_required=3 sendbird=missing redacted=true`.
- Messages DB safe sample lookup now retries transient read failures and records attempts without logging content; latest proof used `attempts=1`.
- Local server stopped after verification.
- No live outbound send was performed.

## Live-Send Preflight Fingerprint Evidence

Latest update: the final live-send gate now records a SHA-256 fingerprint of the Julian-approved body in preflight and live evidence, without writing the raw message body into artifacts.

Fresh verification:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 26/26 passed.
- `node --check scripts/e2e-live-send-preflight.mjs && node --check scripts/e2e-live-send-evidence.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm run test:e2e:live:preflight` with no live env: refused safely, `No send performed: true`, missing the four required live env vars.
- Redacted positive preflight with dummy destination `+15555550123` and body `Safe live preflight fingerprint only. Do not send.` returned `Live-send preflight: READY`, `No send performed: true`, destination `*******0123`, message length `50`, and SHA-256 `76688d3b4fabe7a487c45b8845c3839b0be9a22facde6c98d35a7369a5799ca6`.
- After the positive preflight check, `npm run test:e2e:live:preflight` was rerun with no env to reset the persisted preflight evidence to `NOT READY`.
- `npm run test:e2e:live` with no env refused safely and wrote `live_send_performed=false`.
- `npm run test:e2e:status`: still `NOT COMPLETE`, live preflight not ready, missing the four required live env vars.
- `npm exec -- node --test __tests__/*.test.mjs`: 52/52 passed.
- `docs/e2e-live-send-runbook.md` now instructs the operator to compare `validation.message_sha256` and `message_length` between preflight and final live evidence before marking completion.
- No live outbound send was performed.

## Live/Preflight Fingerprint Match Gate

Latest update: completion now requires the live-send evidence to match the approved preflight on message SHA-256, message length, and destination last4.

Fresh verification:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 26/26 passed.
- `node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm run test:e2e:live:preflight` with no live env: refused safely and performed no send.
- `npm run test:e2e:live` with no live env: refused safely and wrote `live_send_performed=false`.
- `npm run test:e2e:audit`: not complete, all non-live gates proved, final gate still `unproved_requires_explicit_live_permission`.
- `npm run test:e2e:evidence`: writes `live_evidence_matches_preflight=false`, `live_body_hash_match=false`, `live_body_length_match=false`, and `live_destination_last4_match=false`.
- `npm run test:e2e:status`: prints `Live/preflight match: false hash=false length=false last4=false`.
- `npm exec -- node --test __tests__/*.test.mjs`: 52/52 passed.
- No live outbound send was performed.

## Live Fingerprint Audit Fixture Tests

Latest update: added executable fixture tests for the final live/preflight fingerprint decision logic.

Fresh verification:

- New test file: `__tests__/live-fingerprint-audit.test.mjs`.
- The test creates temporary safe, browser, runtime, preflight, live, and screenshot evidence files, then executes `scripts/e2e-completion-audit.mjs`.
- Mismatch case: preflight body hash `aaaaaaaa...` and live body hash `bbbbbbbb...` leaves `complete=false`, keeps `real outbound send-to-Julian test` unproved, and records `body_hash_match=false` while body length and destination last4 match.
- Match case: preflight and live body hash `cccccccc...` lets the synthetic audit complete and records `body_hash_match=true`, `body_length_match=true`, `destination_last4_match=true`, and `live_evidence_matches_preflight=true`.
- `npm exec -- node --test __tests__/live-fingerprint-audit.test.mjs`: 2/2 passed.
- `npm exec -- node --test __tests__/*.test.mjs`: 54/54 passed.
- `npm run test:e2e:audit`: still not complete against real current evidence; all non-live gates proved and live gate remains unproved.
- `npm run test:e2e:evidence`: still records `live_evidence_matches_preflight=false` with no live evidence.
- `npm run test:e2e:status`: still `NOT COMPLETE`, `Live/preflight match: false hash=false length=false last4=false`.
- No live outbound send was performed.

## Live Fingerprint Evidence Index Fixture Tests

Latest update: expanded the live fingerprint fixture coverage so the consolidated evidence index must expose the same preflight/live match fields as the completion audit.

Fresh verification:

- Updated test file: `__tests__/live-fingerprint-audit.test.mjs`.
- Evidence-index mismatch fixture: preflight body hash `dddddddd...` and live body hash `eeeeeeee...` leaves `complete=false`, records `live_evidence_matches_preflight=false`, `live_body_hash_match=false`, and keeps body length plus destination last4 matched.
- Evidence-index match fixture: preflight and live body hash `ffffffff...` records `complete=true`, `live_evidence_matches_preflight=true`, `live_body_hash_match=true`, `live_body_length_match=true`, and `live_destination_last4_match=true`.
- The fixture browser evidence now includes four mobile metric objects, and the index test asserts `mobile_metric_count=4` plus `mobile_metrics_overflow_free=true`.
- `npm exec -- node --test __tests__/live-fingerprint-audit.test.mjs`: 4/4 passed.
- `npm exec -- node --test __tests__/*.test.mjs`: 56/56 passed.
- `npm run test:e2e:evidence`: still not complete against real current evidence; safe non-live gates proved, screenshots 6/6 present, mobile metrics 4/4 overflow-free, live preflight not ready because the four required live env vars are missing.
- `npm run test:e2e:status`: still `NOT COMPLETE`, 7 proved requirements, 1 unproved requirement, final gate remains the real outbound send-to-Julian test, `Live/preflight match: false hash=false length=false last4=false`.
- `lsof -nP -iTCP:3002 -sTCP:LISTEN || true`: no local server is currently listening on 3002.
- No live outbound send was performed.

## Scheduled Send Provenance Hardening

Latest update: the scheduled-message send path now returns and verifies a redacted provenance envelope so future attribution can answer whether a send came through ClapCheeks.

What changed:

- `app/api/scheduled-messages/send/route.ts` now emits `send_provenance` with `request_id`, `source_label=clapcheeks_scheduled_messages_send_api`, `route=POST /api/scheduled-messages/send`, adapter, destination last4, message length, and message SHA-256.
- Immediate Messages DB verification now requires both the outbound body snippet and destination tail to match after the send start time.
- `scripts/e2e-readiness-safe.mjs` now requires scheduled dry-run provenance in the safe E2E gate.
- `scripts/e2e-live-send-evidence.mjs` now records `send_provenance` and requires `send_provenance_verified=true` before live evidence can be `ok`.
- `scripts/e2e-completion-audit.mjs`, `scripts/e2e-evidence-index.mjs`, and `scripts/e2e-readiness-status.mjs` now carry the scheduled dry-run provenance verification field into the scheduled gate, evidence index, and final status output.
- `docs/e2e-live-send-runbook.md` now lists provenance as a required completion check.

Fresh verification:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 30/30 passed.
- `node --check` for the touched E2E scripts passed.
- `npm exec -- node --test __tests__/*.test.mjs`: 56/56 passed.
- `npm run test:e2e:readiness:local`: passed from cold start; scheduled dry-run proof reported `adapter=god draft provenance=true`.
- Fresh safe evidence scheduled dry-run provenance: `ok=true`, `provenance_ok=true`, source `clapcheeks_scheduled_messages_send_api`, route `POST /api/scheduled-messages/send`, last4 `2944`, SHA-256 length `64`.
- Fresh evidence index summary now includes `scheduled_dry_run_provenance_verified=true`, and `evidence_highlights.scheduled_dry_run.provenance_verified=true`.
- `npm run test:e2e:status`: still `NOT COMPLETE`, safe non-live gates proved, 7 proved requirements, 1 unproved requirement, scheduled flow prints `provenance=true`, final gate remains the real outbound send-to-Julian test, `Live/preflight match: false hash=false length=false last4=false provenance=false`.
- `lsof -nP -iTCP:3002 -sTCP:LISTEN || true`: no local server is currently listening on 3002.
- Repo-wide `npm exec -- tsc --noEmit --pretty false --incremental false` still fails on pre-existing unrelated strictness/type errors in admin, photos, reports, profile, and other areas; no TypeScript error from the touched scheduled send route was reported before those unrelated failures.
- No live outbound send was performed.

## Evidence Freshness Summary

Latest update: the completion audit, consolidated evidence index, and readiness status now enforce/report freshness for the required readiness artifacts and browser screenshot proof.

What changed:

- `scripts/e2e-completion-audit.mjs` now has a non-live requirement named `required E2E evidence artifacts are fresh`.
- The freshness gate checks safe, browser, runtime, live-refusal, live-preflight, and browser screenshot artifacts.
- `scripts/e2e-evidence-index.mjs` now accepts `CLAPCHEEKS_EVIDENCE_MAX_AGE_SECONDS` and defaults to `3600`.
- Each artifact entry now includes `age_seconds` and `fresh`.
- The evidence index summary now includes `evidence_artifacts_fresh`, `stale_artifact_count`, `oldest_required_artifact_age_seconds`, and `evidence_max_age_seconds`.
- `scripts/e2e-readiness-status.mjs` now prints `Artifact freshness` and includes the freshness detail under `visual_evidence.artifact_freshness`.
- `__tests__/live-fingerprint-audit.test.mjs` now includes a stale-artifact fixture test proving the completion audit refuses stale required evidence.

Fresh verification:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs`: passed.
- `npm exec -- node --test __tests__/*.test.mjs`: 57/57 passed.
- `npm run test:e2e:audit`: safe non-live gates proved, including `[proved] required E2E evidence artifacts are fresh`; final live-send gate remains unproved.
- `npm run test:e2e:evidence`: `Artifact freshness: fresh=true max_age=3600s stale=0 oldest=496s`.
- `npm run test:e2e:status`: `Artifact freshness: fresh=true max_age=3600s stale=0 oldest=496s`; 8 proved requirements, 1 unproved requirement.
- Current status remains `NOT COMPLETE`; safe non-live gates are proved, and the only unproved gate remains the explicit real outbound send-to-Julian test.
- No live outbound send was performed.

## Live-Send Preflight Executable Guard Tests

Latest update: added executable no-send tests for the live-send preflight script so the sample-number and readiness guards are proven by running the preflight, not only by string checks or manual notes.

What changed:

- Added `__tests__/live-send-preflight-exec.test.mjs`.
- The test creates temporary completion-audit and live-evidence fixtures and runs `scripts/e2e-live-send-preflight.mjs` directly.
- Missing live env case proves the preflight refuses, writes `no_send_performed=true`, and writes `no_dashboard_mutation_performed=true`.
- `+17578312944` case proves the preflight refuses without `CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944`, marks `sample_2944_override_required=true`, and does not create a redacted execution plan.
- Dummy non-sample destination `+15555550123` case proves the preflight can become `READY` with redacted destination, body length, and SHA-256 while still performing no send and no dashboard mutation.

Fresh verification:

- `npm exec -- node --test __tests__/live-send-preflight-exec.test.mjs`: 3/3 passed.
- `node --check __tests__/live-send-preflight-exec.test.mjs`: passed.
- `npm exec -- node --test __tests__/*.test.mjs`: 60/60 passed.
- `npm run test:e2e:status`: still `NOT COMPLETE`, safe non-live gates proved, 8 proved requirements, 1 unproved requirement, final gate remains the explicit real outbound send-to-Julian test.
- No live outbound send was performed.

## Live-Send Evidence Harness Refusal Tests

Latest update: added executable no-send tests for the final live evidence harness validation phase, proving it refuses before creating dashboard rows when inputs are unsafe.

What changed:

- Added `__tests__/live-send-evidence-refusal.test.mjs`.
- Missing env case proves the live harness refuses with `live_send_performed=false` and `messages_db_verified=false`.
- `+17578312944` case proves the live harness refuses without `CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944` before any `scheduled_message_id` exists.
- Last4 mismatch case proves the live harness refuses before creating dashboard rows when the explicit expected last4 does not match the destination.

Fresh verification:

- `npm exec -- node --test __tests__/live-send-evidence-refusal.test.mjs`: 3/3 passed.
- `npm exec -- node --test __tests__/*.test.mjs`: 63/63 passed.
- `npm run test:e2e:status`: still `NOT COMPLETE`, safe non-live gates proved, 8 proved requirements, 1 unproved requirement, final gate remains the explicit real outbound send-to-Julian test.
- No live outbound send was performed.

## Live Harness Requires Matching Preflight

Latest update: the final live-send evidence harness now refuses before creating a scheduled row unless the no-send preflight artifact is present, ready, and matches the current live env on destination last4, body length, and body SHA-256.

What changed:

- `scripts/e2e-live-send-evidence.mjs` now loads `CLAPCHEEKS_LIVE_SEND_PREFLIGHT`.
- After env validation and before any dashboard API call, the harness requires `ok_to_run_live_harness=true`, `no_send_performed=true`, and `no_dashboard_mutation_performed=true`.
- The live harness compares current env-derived `phone_last4`, `message_length`, and `message_sha256` against the preflight evidence.
- The live runbook now states that `/tmp/clapcheeks-live-send-preflight.json` must remain in place and match before the live harness can run.
- `__tests__/live-send-evidence-refusal.test.mjs` now proves the harness refuses without matching preflight evidence and refuses on preflight body mismatch before any `scheduled_message_id` exists.

Fresh verification:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-send-evidence-refusal.test.mjs`: 31/31 passed.
- `node --check scripts/e2e-live-send-evidence.mjs`: passed.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- `npm run test:e2e:live`: refused safely with missing env and performed no live send.
- `npm run test:e2e:status`: still `NOT COMPLETE`, safe non-live gates proved, 8 proved requirements, 1 unproved requirement, final gate remains the explicit real outbound send-to-Julian test.
- No live outbound send was performed.

## Readiness Refresh After Matching-Preflight Guard

Latest update: refreshed the status and Linear/Obsidian trail after the final live harness was changed to require matching no-send preflight evidence.

Fresh status:

- `npm run test:e2e:status`: `NOT COMPLETE`.
- Safe non-live gates: proved.
- Proved requirements: 8.
- Unproved requirements: 1.
- Remaining gate: `real outbound send-to-Julian test`.
- Missing live-send env: `CLAPCHEEKS_LIVE_SEND_PERMISSION`, `CLAPCHEEKS_LIVE_SEND_PHONE`, `CLAPCHEEKS_LIVE_SEND_BODY`, `CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4`.
- Live preflight ready: `false`.
- Live/preflight match: `false`; hash, length, last4, and provenance are all false because no approved live-send plan has been supplied yet.

Fresh evidence:

- Visual evidence: screenshots `6`, all present, mobile pages `4`, overflow-free `true`.
- Artifact freshness: `true` with zero stale artifacts.
- Dashboard health contract: `true`; overall `healthy`, Convex `healthy`, SendBird `missing`, token values redacted.
- Insights contract: `true`; matches `22`, conversations `200`, platforms `3`, days `5`.
- Scheduled flow: create `true`, approve `true`, dry-run `true`, provenance `true`, cleanup `true`, active fixtures `0`.
- Runtime smoke: ok `true`, no-send `true`, inbound Messages DB rows `1,288,753`.
- Messages DB sample proof for 757-831-2944: last4 `2944`, rows `28`, outbound `14`, content logged `false`.

Verification:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-send-evidence-refusal.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 36/36 passed.
- Linear update created: `a018ead1-7aa9-4cd5-a40f-f76ed4f02855`.
- No live outbound send was performed.

## Mobile Scheduled Compose Form Proof

Latest update: strengthened the browser-side mobile scheduling proof so it does more than open the modal. The visual verifier now fills the mobile compose form with the safe sample number, a no-send draft body, and a future scheduled time, then records evidence without clicking `Schedule`.

What changed:

- Updated `scripts/e2e-browser-visual-safe.sh`.
- Updated `scripts/e2e-completion-audit.mjs`.
- Updated `scripts/e2e-evidence-index.mjs`.
- Updated `scripts/e2e-readiness-status.mjs`.
- Updated `__tests__/dashboard-e2e-contract.test.mjs`.
- Updated `__tests__/live-fingerprint-audit.test.mjs`.

New evidence:

- Browser verifier writes `/tmp/clapcheeks-e2e-browser/scheduled-mobile-form-proof.json`.
- Browser manifest now records `scheduled_mobile_form_filled=true`.
- Browser manifest now records `scheduled_mobile_form_no_submit=true`.
- Captured form proof uses sample last4 `2944`, message length `44`, sequence type `manual`, submit button present `true`, overflow `false`.
- The completion audit now requires this form-fill/no-submit proof inside `mobile quick-view UX works`.
- The readiness status now prints `Scheduled mobile form: filled=true no_submit=true sample_last4=2944`.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs scripts/e2e-readiness-status.mjs scripts/e2e-evidence-index.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start, including `scheduled mobile form fill no-send`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; safe non-live gates proved, 8 requirements proved, 1 live-send requirement unproved.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Dashboard Health Blocker Visibility

Linear update: `4562226a-bc30-4290-9d7e-00a13f3967e0`.

Latest update: made the dashboard health readiness blockers actionable without exposing token values.

Changes:

- `/api/agent/token-health` now returns redacted `missing_required_services`.
- Safe health evidence validates that the blocker list is secret-safe and matches `missing_required`.
- `npm run test:e2e:status` now prints `Dashboard health: ... missing_required=3 blockers=tinder,hinge,sendbird sendbird=missing redacted=true`.
- Browser verifier now waits for the dashboard iMessage self-test/live-send gate surface before capturing the proof, removing a cold-start hydration race found during verification.

Fresh proof:

- `npm run test:e2e:readiness:local`: passed from cold start.
- Safe API verifier proved `dashboard runtime health contract -- overall=healthy convex=healthy missing_required=3 blockers=tinder,hinge,sendbird sendbird=missing`.
- `npm run test:e2e:status`: safe non-live gates proved and dashboard health prints the named blockers.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Scheduled Live Gate Status Surface

Linear update: `e4904187-fff0-4601-8002-39ccaab79031`.

Latest update: surfaced the scheduled live preflight lock directly in quick status and evidence-index output so the scheduling/sending gate can be checked without digging through raw safe verifier JSON.

Changes:

- `npm run test:e2e:status` now prints `Scheduled live gate: blocked_by_preflight=true no_send=true missing=5`.
- Status JSON now includes `scheduled_flow.live_blocked_by_preflight_gate` and `scheduled_flow.live_preflight_gate_status`.
- `npm run test:e2e:evidence` now prints the scheduled live gate line.
- Evidence index now records `summary.scheduled_live_blocked_by_preflight_gate`, `summary.scheduled_live_preflight_no_send`, `summary.scheduled_live_preflight_missing_count`, and `evidence_highlights.scheduled_live_preflight_gate`.

Fresh proof:

- `npm run test:e2e:evidence && npm run test:e2e:status`: passed and printed the scheduled live gate line.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- Safe non-live gates remain proved; final real outbound send remains gated by explicit env/permission.
- No live outbound send was performed.

## Intelligence UI/API Binding Proof

Latest update: strengthened the browser-side insights proof so the rendered `/intelligence` page must match the live `/api/analytics/summary?days=30` values, not only show the right section headings.

What changed:

- Updated `scripts/e2e-browser-visual-safe.sh`.
- Updated `scripts/e2e-completion-audit.mjs`.
- Updated `scripts/e2e-evidence-index.mjs`.
- Updated `scripts/e2e-readiness-status.mjs`.
- Updated `__tests__/dashboard-e2e-contract.test.mjs`.
- Updated `__tests__/live-fingerprint-audit.test.mjs`.

New evidence:

- Browser verifier writes `/tmp/clapcheeks-e2e-browser/intelligence-api-binding-proof.json`.
- Browser manifest now records `intelligence_ui_matches_api=true`.
- Completion audit now requires `intelligence_ui_matches_api=true` for `insights are functional`.
- Readiness status now prints `Intelligence UI/API: match=true reply_rate=100 replied=200`.
- Latest binding proof expected values: reply rate `100`, opened `200`, replied `200`, date-ready `60`, booked `0`, matches `22`, conversations `200`, messages sent `200`, dates booked `0`.
- The proof records no missing rendered labels and no missing rendered values.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs scripts/e2e-readiness-status.mjs scripts/e2e-evidence-index.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start, including `[ok] intelligence api-bound values`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; safe non-live gates proved, 8 requirements proved, 1 live-send requirement unproved.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Dashboard Navigation Integrity Proof

Latest update: strengthened the browser-side dashboard proof so the dashboard must expose its operator navigation and quick actions with working destinations.

What changed:

- Updated `scripts/e2e-browser-visual-safe.sh`.
- Updated `scripts/e2e-completion-audit.mjs`.
- Updated `scripts/e2e-evidence-index.mjs`.
- Updated `scripts/e2e-readiness-status.mjs`.
- Updated `__tests__/dashboard-e2e-contract.test.mjs`.
- Updated `__tests__/live-fingerprint-audit.test.mjs`.

New evidence:

- Browser verifier writes `/tmp/clapcheeks-e2e-browser/dashboard-navigation-proof.json`.
- Browser manifest now records `dashboard_navigation_integrity=true`.
- Completion audit now requires `dashboard_navigation_integrity=true` for `dashboard works end to end`.
- Readiness status now prints `Dashboard navigation: ok=true routes=9 failed=0`.
- Latest dashboard navigation proof found no missing quick actions and no missing top nav links.
- Checked routes: `/dashboard/roster`, `/conversation?goal=ask_date`, `/scheduled`, `/matches/add`, `/intelligence`, `/device`, `/analytics`, `/conversation`, and `/billing`.
- All 9 route checks returned HTTP 200.
- The proof records `no_click_performed=true` and `no_live_send_performed=true`.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs scripts/e2e-readiness-status.mjs scripts/e2e-evidence-index.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start, including `[ok] dashboard navigation integrity`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; safe non-live gates proved, 8 requirements proved, 1 live-send requirement unproved.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Dashboard iMessage Self-Test Surface Proof

Latest update: strengthened the browser-side dashboard send proof so the visible iMessage self-test panel must be safe by default and wired to the configured self-test recipient metadata.

What changed:

- Updated `scripts/e2e-browser-visual-safe.sh`.
- Updated `scripts/e2e-completion-audit.mjs`.
- Updated `scripts/e2e-evidence-index.mjs`.
- Updated `scripts/e2e-readiness-status.mjs`.
- Updated `__tests__/dashboard-e2e-contract.test.mjs`.
- Updated `__tests__/live-fingerprint-audit.test.mjs`.

New evidence:

- Browser verifier writes `/tmp/clapcheeks-e2e-browser/dashboard-imessage-self-test-proof.json`.
- Browser manifest now records `dashboard_imessage_self_test_surface=true`.
- Completion audit now requires `dashboard_imessage_self_test_surface=true` for `dashboard works end to end`.
- Readiness status now prints `Dashboard iMessage self-test: ok=true dry_run=true last4=2944`.
- Latest proof confirms `/api/imessage/test` returns HTTP 200, self-test recipient is configured, last4 is `2944`, the self-test button matches metadata, dry-run is checked by default, the `Verify Test iMessage` button is present, and the live-send warning is visible.
- The proof records `no_click_performed=true` and `no_live_send_performed=true`.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs scripts/e2e-readiness-status.mjs scripts/e2e-evidence-index.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start, including `[ok] dashboard imessage self-test dry-run surface`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; safe non-live gates proved, 8 requirements proved, 1 live-send requirement unproved.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Intelligence Mobile Quick-View Coverage

Latest update: the repeatable Chrome visual verifier now checks `/intelligence` at 430px mobile width, asserts conversation intelligence, opener performance, conversation funnel, and no horizontal overflow, captures `/tmp/clapcheeks-e2e-browser/intelligence-mobile-2026-05-18.png`, and writes `intelligence_mobile_quick_view=true` into `/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json`.

The completion audit now requires mobile intelligence evidence for `insights are functional`, and the broader `mobile quick-view UX works` gate now includes dashboard mobile, scheduled mobile, scheduled modal, and intelligence mobile proof.

Fresh verification:

- `npm exec -- node --test __tests__/*.test.mjs`: 49/49 passed.
- Focused TypeScript check for touched browser/audit/test files returned no diagnostics.
- `npm run test:e2e:readiness:local`: passed from cold start, including dashboard desktop, dashboard mobile quick view, scheduled mobile quick view, scheduled modal, intelligence desktop, intelligence mobile quick view, safe API/send path, runtime no-send smoke, live preflight refusal, live harness refusal, and completion audit.
- Browser manifest now includes `intelligence_mobile_quick_view=true`.
- `npm run test:e2e:status`: still not complete, safe non-live gates proved, 7 proved requirements, 1 unproved requirement, final gate blockers unchanged.
- `npm run test:e2e:evidence`: same 7/1 summary and final-gate blockers.
- Local server stopped after verification.
- No live outbound send was performed.

## Dashboard iMessage Dry-Run Click Proof

Latest update: strengthened the browser-side dashboard send proof so Chrome must actually select the configured self-test recipient, click `Verify Test iMessage` with dry-run enabled, observe the success message, and prove that no queue/history delta occurred.

Linear update: `f52823b4-2283-41ed-9b8f-e084027d7d01`.

What changed:

- Updated `scripts/e2e-browser-visual-safe.sh`.
- Updated `scripts/e2e-completion-audit.mjs`.
- Updated `scripts/e2e-evidence-index.mjs`.
- Updated `scripts/e2e-readiness-status.mjs`.
- Updated `__tests__/dashboard-e2e-contract.test.mjs`.
- Updated `__tests__/live-fingerprint-audit.test.mjs`.

New evidence:

- Browser verifier writes `/tmp/clapcheeks-e2e-browser/dashboard-imessage-dry-run-click-proof.json`.
- Browser manifest now records `dashboard_imessage_dry_run_click=true`.
- Completion audit now requires the browser dry-run click proof and `no_queue_delta=true` for `dashboard imessage self-test dry-run works`.
- Readiness status now prints `Dashboard iMessage dry-run click: ok=true no_queue_delta=true success=true`.
- Latest proof confirms the self-test recipient last4 `2944`, dry-run success text is present, before/after message counts stayed `1 -> 1`, the before snapshot was recorded, and `no_live_send_performed=true`.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start, including `[ok] dashboard imessage dry-run click no-queue`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; safe non-live gates proved, 8 requirements proved, 1 live-send requirement unproved.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Scheduled Send Confirmation Guardrail Proof

Latest update: strengthened the browser-side scheduled-send proof so Chrome must create an approved safe fixture, open the real `Confirm live send` modal, verify the review checkbox and phrase guardrails, confirm that a wrong phrase keeps `Send now` disabled, and then audit-safe cancel the fixture.

Linear update: `6e6970f0-5b4e-46d9-9524-3d9d77986c8c`.

New evidence:

- Browser verifier writes `/tmp/clapcheeks-e2e-browser/scheduled-send-confirmation-fixture.json`.
- Browser verifier writes `/tmp/clapcheeks-e2e-browser/scheduled-send-confirmation-before-proof.json`.
- Browser verifier writes `/tmp/clapcheeks-e2e-browser/scheduled-send-confirmation-guardrail-proof.json`.
- Browser verifier writes `/tmp/clapcheeks-e2e-browser/scheduled-send-confirmation-cleanup.json`.
- Browser manifest now records `scheduled_send_confirmation_guardrail=true`.
- Readiness status now prints `Scheduled send confirmation: guardrail=true wrong_phrase_disabled=true cleanup=true`.
- Latest proof used fixture `Safe E2E Browser Guardrail 2944`, approved it, opened the modal from the approved list, verified phrase hidden before review, typed `SEND SAFE`, verified the send button remained disabled, did not click send, and canceled the fixture with `deleted_from_dashboard`.
- Safe fixture cleanup now also sweeps `Safe E2E Browser Guardrail` rows if a verifier run is interrupted.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs && node --check scripts/e2e-readiness-safe.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start, including `[ok] scheduled send confirmation guardrails` and `[ok] scheduled send confirmation fixture cleanup`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; safe non-live gates proved, 8 requirements proved, 1 live-send requirement unproved.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Scheduled Send Confirmation Mobile Visual Proof

Latest update: added visual proof for the scheduled live-send confirmation modal itself, so the mobile quick-view evidence now includes the confirmation guardrail surface, not only the scheduled list and compose modal.

Linear update: `3b0cd5e1-9f6d-4d28-b6aa-92f33c26c399`.

New evidence:

- Browser verifier captures `/tmp/clapcheeks-e2e-browser/scheduled-send-confirmation-modal-2026-05-18.png`.
- Browser verifier writes `/tmp/clapcheeks-e2e-browser/scheduled-send-confirmation-modal-metrics.json`.
- Browser manifest now includes 7 screenshots instead of 6.
- Browser mobile metrics now include 5 pages instead of 4: dashboard mobile, scheduled list, scheduled compose modal, scheduled send confirmation modal, and intelligence mobile.
- Completion audit now requires the scheduled send confirmation modal screenshot for `mobile quick-view UX works`.
- Latest metric for `scheduled_send_confirmation_modal` had `overflow_x=false`, `scroll_width=430`, and `client_width=430`.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start and reported `Browser screenshots: count=7 all_present=true`, `Mobile metrics: count=5 overflow_free=true`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; safe non-live gates proved, 8 requirements proved, 1 live-send requirement unproved.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Analytics Mobile UI/API Binding Proof

Latest update: added a browser-side proof for `/analytics` on mobile so the insights evidence covers both the Intelligence page and the Analytics dashboard surface.

Linear update: `8bd5a6a6-fdb3-49b2-9c80-57926f759704`.

New evidence:

- Browser verifier captures `/tmp/clapcheeks-e2e-browser/analytics-mobile-2026-05-18.png`.
- Browser verifier writes `/tmp/clapcheeks-e2e-browser/analytics-mobile-metrics.json`.
- Browser verifier writes `/tmp/clapcheeks-e2e-browser/analytics-mobile-api-binding-proof.json`.
- Browser manifest now includes 8 screenshots and 6 mobile metric pages.
- Completion audit now requires `analytics_mobile_quick_view=true`, `analytics_mobile_ui_matches_api=true`, and the analytics mobile screenshot for `insights are functional` and `mobile quick-view UX works`.

Latest proof:

- `/api/analytics/summary?days=30` returned HTTP 200.
- Rendered mobile `/analytics` included `Analytics`, `Back to Dashboard`, `Total Swipes`, `Matches`, `Dates Booked`, `Match Rate`, `Rizz Score`, `Swipes & Matches`, `Platform Breakdown`, and `Conversion Funnel`.
- Rendered values matched API-backed expectations: matches `22`, dates booked `0`, match rate `0%`, rizz score `40`, platforms `3`, time series rows `5`, and funnel stages `Swipes`, `Matches`, `Conversations`, `Dates`.
- Mobile metric recorded `overflow_x=false`.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start and included `[ok] analytics mobile api-bound values`.
- `npm run test:e2e:status`: `Analytics mobile UI/API: match=true matches=22 rizz=40`; still `NOT COMPLETE` because the live send-to-Julian gate needs explicit permission/env.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Device Runtime Mobile Safety Proof

Latest update: added browser-backed `/device` mobile proof and fixed the device-control panel mobile overflow found by that proof.

Linear update: `3ed80abb-0789-4686-b4fb-8c916862a80d`.

New evidence:

- Browser verifier captures `/tmp/clapcheeks-e2e-browser/device-mobile-2026-05-18.png`.
- Browser verifier writes `/tmp/clapcheeks-e2e-browser/device-mobile-metrics.json`.
- Browser verifier writes `/tmp/clapcheeks-e2e-browser/device-control-safety-proof.json`.
- Browser manifest now includes 9 screenshots and 7 mobile metric pages.
- Completion audit now requires `device_mobile_quick_view=true`, `device_control_safety_surface=true`, and the device mobile screenshot for dashboard/mobile gates.

Latest proof:

- `/api/device-control/status` returned HTTP 200.
- Rendered `/device` included `Runtime readiness`, `Always-On Device Add-On`, `iPhone device control`, physical PNG proof copy, queue controls, and the post-unlock proof runner.
- Status proof records selected line `2`, blocker `physical_readiness_not_verified`, and all safety gates true: personal line blocked, live swipes require approval, live messages require approval, outbound sends require second confirmation, and approval failures fail closed.
- No queue click, live action, or live send was performed.
- Mobile metric recorded `overflow_x=false`, `scroll_width=430`, and `client_width=430` after fixing the panel layout.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh`: passed.
- `node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs __tests__/device-control-api-contract.test.mjs`: 41/41 passed.
- `npm run test:e2e:readiness:local`: passed from cold start and included `[ok] device control mobile safety surface`.
- `npm run test:e2e:status`: `Device control safety: ok=true mobile=true line=2 blocker=physical_readiness_not_verified no_live_action=true`; still `NOT COMPLETE` because the real outbound send-to-Julian gate needs explicit live-send env.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Dashboard Live-Send Gate Visibility Proof

Latest update: surfaced the final live-send preflight gate inside the dashboard iMessage test panel so the operator sees the same redacted blocker state that the CLI status reports.

Linear update: `d8e444e1-cde9-48de-8a1d-cfd1a5eac8b1`.

New evidence:

- `GET /api/imessage/test` now returns `live_send_gate` metadata with readiness, missing env names, sample override requirement, required permission phrase, runbook path, and `no_send_performed=true`.
- The dashboard iMessage panel renders `Final live-send gate`, the required permission phrase, runbook path, missing env names, sample override warning when applicable, and a no-send marker.
- Browser verifier now requires that live-send gate surface during the dashboard iMessage proof.
- Evidence index and readiness status now report `Dashboard live-send gate: ready=false missing=4`.

Latest proof:

- Browser proof `/tmp/clapcheeks-e2e-browser/dashboard-imessage-self-test-proof.json` records `live_send_gate_present=true`, `live_send_gate_ready=false`, `live_send_gate_missing` with the four required live-send env vars, `live_send_gate_sample_override_required=true`, and `live_send_gate_no_send=true`.
- The dashboard still dry-runs the configured self-test recipient ending in `2944` without queue delta or live send.

Verification:

- `node --check app/api/imessage/test/route.ts && bash -n scripts/e2e-browser-visual-safe.sh && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start.
- `npm run test:e2e:status`: `Dashboard live-send gate: ready=false missing=4`; still `NOT COMPLETE` because the real outbound send-to-Julian gate needs explicit live-send env.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Scheduled UI/API Binding Proof

Latest update: added browser-backed evidence that the `/scheduled` dashboard cards and default list state are bound to `/api/scheduled-messages?status=all&limit=100`, and added URL filter support for stable approved-message review links.

Linear update: `658da6f7-a658-4347-aa7c-1924a257911d`.

New evidence:

- Browser verifier writes `/tmp/clapcheeks-e2e-browser/scheduled-api-binding-proof.json`.
- Browser manifest now records `scheduled_ui_matches_api=true` and `scheduled_api_binding`.
- Evidence index and readiness status now report scheduled UI/API matching, total scheduled messages, pending count, and approved count.
- `/scheduled` now accepts `?filter=approved` or `?status=approved`, which the browser verifier uses to open the approved guardrail fixture without an extra transient filter click.

Latest proof:

- `/api/scheduled-messages?status=all&limit=100` returned HTTP 200.
- Rendered scheduled status cards matched API counts exactly: pending `0`, approved `1`, sent `4`, failed `56`, total `61`.
- Default pending state was valid with zero pending rows.
- Mobile metric remained `overflow_x=false`.
- The approved guardrail fixture was created, opened through `/scheduled?filter=approved`, verified in the live-send confirmation modal, and cleaned up. Fixture cleanup reported `active fixtures=0`.
- No submit, queue click, or live send was performed by the UI/API binding proof.

Verification:

- `bash -n scripts/e2e-browser-visual-safe.sh && node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start and included `[ok] scheduled ui api-bound values`.
- `npm run test:e2e:status`: `Scheduled UI/API: match=true total=61 pending=0 approved=1`; still `NOT COMPLETE` because the real outbound send-to-Julian gate needs explicit live-send env.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Dashboard iMessage Live Gate Hardening

Linear update: `73a5600c-b2e2-4744-aa8d-399214864080`.

Latest update: hardened the dashboard iMessage live path so it cannot queue a real message unless it matches the final explicit live-send preflight gate.

Changes:

- Dashboard iMessage live queueing now requires `SEND LIVE TO JULIAN`.
- `POST /api/imessage/test` refuses non-dry-run queueing unless the live-send env gate is ready.
- A dashboard live request must match the env-confirmed destination last4 and exact message body before anything is inserted into the queue.
- The dashboard panel now renders the locked state and disables live queueing while the gate is missing.
- The safe E2E verifier now proves the API refuses with HTTP `423` and `no_send_performed=true` even when the phrase is supplied but preflight env is missing.

Fresh proof:

- `npm run test:e2e:readiness:local`: passed from cold start and included `[ok] imessage live blocked by preflight gate`.
- `npm run test:e2e:status`: safe non-live gates proved, `Dashboard live-send gate: ready=false missing=4`, and completion remains gated only by the explicit real outbound send.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- Browser evidence remains fresh with `9` screenshots present and `7` mobile metrics overflow-free.
- No live outbound send was performed.

## Scheduled Live Gate Hardening

Linear update: `2be89156-d7c1-475c-8ddd-5834e849d3d7`.

Latest update: hardened the scheduled-message live send path so it now shares the final live-send preflight gate rather than relying on a weaker dashboard-only confirmation phrase.

Changes:

- `/api/scheduled-messages/send` now requires `SEND LIVE TO JULIAN` for non-dry-run sends.
- Scheduled live sends refuse unless the live-send env gate is ready.
- The scheduled recipient must match `CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4`.
- The scheduled message body must match `CLAPCHEEKS_LIVE_SEND_BODY`.
- The `757-831-2944` sample path also requires `CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944` at the scheduled API boundary.
- The scheduled dashboard confirmation modal now asks for `SEND LIVE TO JULIAN`.
- The final live harness now sends the stronger phrase to the scheduled-send API.

Fresh proof:

- `npm run test:e2e:readiness:local`: passed from cold start and included `[ok] scheduled live blocked by preflight gate`.
- Safe API verifier proved HTTP `423` with `no_send_performed=true` when the phrase is supplied but the live-send env/preflight gate is missing.
- Browser verifier passed the scheduled confirmation modal and wrong-phrase disabled guardrail after the phrase update.
- `npm run test:e2e:status`: safe non-live gates proved, `Scheduled send confirmation: guardrail=true wrong_phrase_disabled=true cleanup=true`, and completion remains gated only by the explicit real outbound send.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- No live outbound send was performed.

## Dashboard Quick-View Blocker Proof

Linear update: `00f3478d-0bec-40f5-8b53-d5198d3f9c38`.

Latest update: promoted the named health blockers into the dashboard quick-view surface and made browser/completion evidence require that proof before the dashboard can be counted as end-to-end proved.

Changes:

- Dashboard `Tokens Missing` briefing tile now shows the redacted blocker names: `tinder, hinge, sendbird`.
- Browser visual E2E writes `/tmp/clapcheeks-e2e-browser/dashboard-health-blockers-proof.json`.
- Browser evidence now records `dashboard_health_blockers_quick_view=true` and `dashboard_health_blockers.expected_blockers=["tinder","hinge","sendbird"]`.
- Completion audit, evidence index, readiness status, and fingerprint fixtures now require/report the dashboard blocker quick-view proof.
- Browser verifier waits for the dashboard iMessage self-test surface before proving the live-send gate, covering the cold-start hydration race.

Fresh proof:

- `npm run test:e2e:readiness:local`: passed from cold start and included `[ok] dashboard health blockers quick view`.
- `npm run test:e2e:status`: `Dashboard blocker quick view: ok=true blockers=tinder,hinge,sendbird redacted=true`; safe non-live gates proved; completion still `NOT COMPLETE`.
- `npm exec -- node --test __tests__/*.test.mjs`: 65/65 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Readiness Status Approval Packet Surface

Linear update: `b5ed46df-5578-4490-afdb-fe52bc76b574`.

Latest update: surfaced the final live-send approval packet directly in `npm run test:e2e:status`.

Changes:

- `scripts/e2e-readiness-status.mjs` now reads `/tmp/clapcheeks-live-send-approval-packet-2026-05-18.json`.
- Status JSON now includes `approval_packet` with readiness, no-send/no-mutation flags, missing base env, required permission phrase, sample override phrase, local Chrome proof, and sample preflight proof.
- Status output now prints `Approval packet: ready=true no_send=true missing_base_env=4 raw_phone_written=false raw_body_written=false`.
- Contract tests assert the status reporter includes the approval-packet surface and raw phone/body write flags.

Fresh proof:

- `node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 28/28 passed.
- `npm run test:e2e:readiness:local`: passed from cold start.
- `npm run test:e2e:status`: printed the approval-packet line and still reports `NOT COMPLETE`.
- `npm exec -- node --test __tests__/*.test.mjs`: 68/68 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Backend Doctor Safe Coverage

Linear update: `988e3d19-766b-47e5-9e59-105bc73ce955`.

Latest update: added a read-only backend doctor to close the dashboard backend/schema coverage gap called out in the vault.

Changes:

- Added `scripts/e2e-backend-doctor-safe.mjs`.
- Added `npm run test:e2e:backend-doctor` and wired it into `npm run test:e2e:readiness`.
- The backend doctor checks runtime dashboard paths for Supabase imports, verifies Convex facade read/write mapping coverage, and calls the health, token-health, analytics, scheduled-message, and iMessage metadata APIs without sending or mutating.
- Completion audit now includes `backend Convex and schema route coverage doctor passes` as a safe requirement.
- Evidence index and readiness status now print `Backend doctor: ok=true no_send=true checks=3/3`.

Fresh proof:

- `node --check scripts/e2e-backend-doctor-safe.mjs && node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 29/29 passed.
- `npm run test:e2e:readiness:local`: passed from cold start and included `[ok] backend API route matrix -- convex=healthy analytics=22/200 scheduled=99 no_send=true`.
- `npm run test:e2e:status`: safe non-live gates proved, 10 proved requirements, 1 unproved requirement, backend doctor `3/3`.
- `npm exec -- node --test __tests__/*.test.mjs`: 69/69 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Dashboard iMessage Gate Metadata Hardening

Linear update: `fe013904-f09b-4cea-9620-ddfbc76bbe0c`.

Latest update: hardened the dashboard iMessage live-send gate metadata so it cannot appear ready when the permission phrase or configured live destination is wrong.

Changes:

- `GET /api/imessage/test` now treats a wrong `CLAPCHEEKS_LIVE_SEND_PERMISSION` value as a missing gate input, not just an absent env var.
- The metadata now reports issue strings for configured live phone / expected-last4 mismatch and self-test recipient / expected-last4 mismatch.
- The metadata now exposes a redacted execution plan with destination redaction, expected last4, body length, and body SHA-256 only.
- Browser and safe readiness verifiers now require the redacted gate plan and verify the raw 757 phone/body are absent from dashboard metadata evidence.

Fresh proof:

- `node --check app/api/imessage/test/route.ts`: passed.
- `node --check scripts/e2e-readiness-safe.mjs && bash -n scripts/e2e-browser-visual-safe.sh && node --check scripts/e2e-readiness-status.mjs && node --check scripts/e2e-evidence-index.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 30/30 passed.
- `npm run test:e2e:readiness:local`: passed from cold start.
- `npm run test:e2e:status`: safe non-live gates proved, 10 proved requirements, 1 unproved requirement; dashboard live-send gate now reports `missing=5` because the sample `2944` override is also required for the dashboard self-test target.
- `npm exec -- node --test __tests__/*.test.mjs`: 70/70 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## 757 Sample No-Send Live Preflight

Linear update: `72f36eb1-d970-473a-802f-65158d8ee88b`.

Latest update: added a dedicated no-send preflight verifier for the `757-831-2944` sample path so the final live-send plumbing can be proven ready without sending a real message.

Changes:

- Added `npm run test:e2e:live:sample-preflight`.
- Added `/tmp/clapcheeks-live-send-sample-preflight.json` as the sample preflight evidence artifact.
- The sample preflight sets `SEND LIVE TO JULIAN`, destination `+17578312944`, expected last4 `2944`, and the required sample override, then delegates to the existing live preflight harness.
- The verifier asserts `ok_to_run_live_harness=true`, `no_send_performed=true`, `no_dashboard_mutation_performed=true`, sample override present, and no raw phone/body leakage in evidence.
- Readiness status now prints the sample preflight readiness separately from the real live-send gate.
- The live-send runbook now documents the safe sample no-send preflight command.

Fresh proof:

- `npm run test:e2e:live:sample-preflight`: passed and wrote `/tmp/clapcheeks-live-send-sample-preflight.json`.
- `npm run test:e2e:status`: `Sample 757 preflight: ready=true no_send=true last4=2944 override=true`; redacted plan `destination=*******2944`, body hash `2b29aeb65203c8095271dadda15e4818f54d3bed853ea22df10d8d8468df8997`, body length `63`.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed.
- No live outbound send was performed.

## Dashboard Sample Override Contract And Scheduled Hydration Proof

Linear update: `2b2775bb-eca8-444c-abed-8729713563b7`.

Latest update: fixed the dashboard iMessage sample override contract and hardened scheduled browser proof against cold-start hydration races.

Changes:

- `/api/imessage/test` now requires `CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944="I CONFIRM 757-831-2944 IS THE LIVE DESTINATION"` for sample 2944, matching the scheduled sender, live preflight harness, live evidence harness, and runbook.
- Contract tests now assert the dashboard route cannot drift back to the older `CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944 !== 'true'` check.
- Browser E2E now waits for `/scheduled` status cards to match `/api/scheduled-messages?status=all&limit=100` before recording the scheduled UI/API proof.

Fresh proof:

- `npm run test:e2e:readiness:local`: passed from cold start.
- Browser evidence included `[ok] scheduled api-bound cards hydrated` before `[ok] scheduled ui api-bound values`.
- `npm run test:e2e:live:sample-preflight`: passed with no send and redacted destination `*******2944`.
- `npm run test:e2e:status`: `Sample 757 preflight: ready=true no_send=true last4=2944 override=true`; `Scheduled UI/API: match=true total=71 pending=0 approved=0`.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Computer Use Chrome Browser Proof

Linear update: `2bd42387-d043-432a-82e1-858f2fd138af`.

Latest update: verified the local ClapCheeks app through Julian's actual Google Chrome window with Computer Use, not only scripted Playwright/headless proof.

Evidence:

- Chrome was running on `127.0.0.1:3002/analytics`; the accessibility tree showed the Analytics quick-view UI with `22 Matches`, `0 Dates Booked`, `0% Match Rate`, and `RIZZ SCORE 40 / 100`.
- After the safe local server was restarted, Chrome loaded `127.0.0.1:3002/scheduled`.
- Scheduled quick-view rendered in Chrome with `Pending Review 0`, `Approved 0`, `Sent 4`, `Failed 81`, and `No pending messages`.
- Opened `+ Schedule Message` in Chrome and filled a safe browser proof draft using the 2944 sample destination and body `Safe browser proof only. Do not send.`
- Did not click `Schedule`; clicked `Cancel` and returned to the scheduled list.
- Follow-up API check against `/api/scheduled-messages?status=all&limit=100` returned `pending=0`, `approved=0`, and `safe_browser_proof_present=false`.
- `npm run test:e2e:readiness:local`: passed from cold start after the browser proof.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed after the browser proof.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Machine-Readable Local Chrome Proof

Linear update: `a4d82d9e-d019-4319-b9b3-7d290a52a2c9`.

Latest update: added a repeatable local Chrome proof command that turns the Computer Use browser observation into a durable JSON artifact.

Changes:

- Added `scripts/e2e-local-browser-proof.mjs`.
- Added `npm run test:e2e:local-browser`.
- The proof reads Google Chrome's front active tab via `osascript`, verifies it is on the local ClapCheeks app, calls `/api/scheduled-messages?status=all&limit=100`, and calls `/api/analytics/summary?days=30`.
- The proof writes `/tmp/clapcheeks-local-browser-proof-2026-05-18.json` with no-send/no-mutation assertions.
- Evidence index now includes the optional local Chrome artifact, summary fields, evidence highlights, repeatable command, and console line `Local Chrome proof: ...`.
- Contract tests now assert the local Chrome proof command is read-only and checks for accidental browser-proof fixture persistence.

Fresh proof:

- `node --check scripts/e2e-local-browser-proof.mjs && node --check scripts/e2e-evidence-index.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 27/27 passed.
- `npm run test:e2e:local-browser`: passed and wrote `/tmp/clapcheeks-local-browser-proof-2026-05-18.json`; Chrome route `/analytics`; scheduled `pending=0`, `approved=0`, `sent=4`, `failed=83`, `forbidden_fixture_present=false`; analytics `matches=22`, `conversations=200`, `rizz=40`.
- `npm run test:e2e:readiness:local`: passed from cold start and evidence index printed `Local Chrome proof: ok=true route=/analytics no_send=true pending=0 approved=0 forbidden_fixture=false`.
- `npm exec -- node --test __tests__/*.test.mjs`: 67/67 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Live Send Approval Packet

Linear update: `1bda40a4-1bf4-4331-837b-f56d9a25b43c`.

Latest update: added a machine-readable no-send approval packet for the final live-send gate.

Changes:

- Added `scripts/e2e-live-send-approval-packet.mjs`.
- Added `npm run test:e2e:live:approval-packet`.
- `scripts/e2e-readiness-all-safe.sh` now generates the approval packet after completion audit and before evidence indexing.
- The packet writes `/tmp/clapcheeks-live-send-approval-packet-2026-05-18.json`.
- The packet records safe-gate status, live gate status, required permission phrase, exact destination/body requirements, expected last4 requirement, sample `2944` override phrase, missing env names, command sequence, and current safe evidence references.
- The packet explicitly records `raw_phone_written=false` and `raw_body_written=false`.
- Evidence index now reports approval packet readiness and raw phone/body write flags.
- Live-send runbook now includes `npm run test:e2e:live:approval-packet` before asking Julian to confirm the final live send.

Fresh proof:

- `node --check scripts/e2e-live-send-approval-packet.mjs && node --check scripts/e2e-evidence-index.mjs && bash -n scripts/e2e-readiness-all-safe.sh`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 28/28 passed.
- `npm run test:e2e:readiness:local`: passed from cold start.
- Approval packet output: `READY_FOR_APPROVAL`, safe non-live gates proved, 9 proved requirements, 1 unproved live-send requirement, missing base env names listed, sample 757 preflight ready/no-send, local Chrome proof ok, raw phone/body written false.
- Evidence index reports `Approval packet: ready=true no_send=true missing_base_env=4 raw_phone_written=false raw_body_written=false`.
- `npm exec -- node --test __tests__/*.test.mjs`: 68/68 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Local Chrome Proof Promoted To Completion Gate

Linear update: `f2c2ebf1-5c4b-4f27-ad5f-6eb658a99148`.

Latest update: promoted the local Chrome proof from optional evidence into the completion audit's safe requirement set.

Changes:

- `scripts/e2e-readiness-all-safe.sh` now runs `npm run test:e2e:local-browser` before live preflight/audit/evidence indexing.
- `scripts/e2e-completion-audit.mjs` now requires `local Chrome browser proof from Julian computer is current and read-only`.
- The audit requires the local Chrome artifact to be fresh, no-send, no-mutation, on route `/analytics`, with scheduled `pending=0`, `approved=0`, no browser-proof fixture, analytics `matches=22`, and analytics `conversations=200`.
- `scripts/e2e-local-browser-proof.mjs` now actively opens/navigates Google Chrome to the local `/analytics` route before reading the tab, making the proof repeatable in the local desktop context.
- `scripts/e2e-evidence-index.mjs` now treats `/tmp/clapcheeks-local-browser-proof-2026-05-18.json` as a required fresh artifact.
- Contract tests assert the local Chrome proof is part of the one-command readiness suite, completion audit, and required evidence index artifacts.

Fresh proof:

- `node --check scripts/e2e-local-browser-proof.mjs && node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-evidence-index.mjs && bash -n scripts/e2e-readiness-all-safe.sh`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 27/27 passed.
- `npm run test:e2e:readiness:local`: passed from cold start.
- Completion audit now reports 9 proved safe requirements and 1 unproved live-send requirement.
- Evidence index reports `Proved requirements: 9`, `Unproved requirements: 1`, and `Local Chrome proof: ok=true route=/analytics no_send=true pending=0 approved=0 forbidden_fixture=false`.
- `npm exec -- node --test __tests__/*.test.mjs`: 67/67 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Evidence Index Final Gate Next Action

Linear update: `d5f844b4-dea6-4bf0-9e7f-88d3760a2e95`.

Latest update: promoted the completion audit final gate into the consolidated evidence index for quick review/dashboard consumption.

Changes:

- Evidence index summary now records `final_gate_preflight_ready` and `final_gate_next_required_action`.
- Evidence highlights now include a `final_gate` object with live env blockers, preflight state, fingerprint/provenance checks, and the exact next required action.
- `npm run test:e2e:evidence` now prints `Next required action: ...` after the final live/preflight match line.
- Contract tests assert the evidence index carries and prints the final-gate next action.

Fresh proof:

- `node --check scripts/e2e-evidence-index.mjs && node --check scripts/e2e-completion-audit.mjs && node --check scripts/e2e-readiness-status.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 31/31 passed.
- `npm run test:e2e:readiness:local`: passed from cold start.
- Evidence index reports `Complete: false`, `Safe non-live gates proved: true`, `Proved requirements: 8`, `Unproved requirements: 1`, `Sample 757 preflight: ready=true no_send=true last4=2944 override=true`, and the live-send next action.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## 757 Sample Preflight In One-Command Readiness

Linear update: `c17bbbcb-f635-4041-a4d9-c65eeb3cd61d`.

Latest update: promoted the 757 sample no-send preflight from a standalone helper into required evidence for the main safe readiness suite.

Changes:

- `npm run test:e2e:readiness` now runs `npm run test:e2e:live:sample-preflight`.
- Completion audit now treats `/tmp/clapcheeks-live-send-sample-preflight.json` as required fresh non-live evidence.
- The `safe sample 757-831-2944 used without accidental real outbound send` gate now requires the sample preflight to be ready, no-send, no-mutation, last4 `2944`, and sample override present.
- Evidence index now includes `sample_live_preflight_*` summary fields and prints the sample preflight status.
- Synthetic completion/evidence-index tests now include the sample preflight artifact.

Fresh proof:

- `npm run test:e2e:readiness:local`: passed from cold start and executed the sample preflight inside the suite.
- E2E output included `Sample live-send preflight: READY`, `Evidence: /tmp/clapcheeks-live-send-sample-preflight.json`, and `No send performed: true`.
- `npm run test:e2e:evidence`: `Sample 757 preflight: ready=true no_send=true last4=2944 override=true`.
- `npm run test:e2e:status`: safe non-live gates proved; `Scheduled UI/API: match=true total=73 pending=0 approved=0`.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Sample Preflight Direct Artifact Validation

Linear update: `0c758a34-caa8-4d91-b83b-51ef7d97f6fc`.

Latest update: removed the sample preflight's dependency on a previously generated completion audit by validating the current safe/browser/runtime artifacts directly.

Changes:

- `scripts/e2e-live-send-sample-preflight.mjs` now reads current safe readiness, browser, and runtime smoke evidence before delegating to the live preflight harness.
- The sample preflight refuses unless those artifacts prove no-send/no-mutation readiness, the sample Messages DB read-only check, scheduled dry-run, scheduled UI/API proof, dashboard iMessage dry-run no-queue proof, and runtime no-send proof.
- It writes a small verified sample audit for the delegated preflight call, preventing stale audit state from making the sample path look ready.
- The executable test fixture now supplies current safe/browser/runtime artifacts for clean test runs.

Fresh proof:

- `npm run test:e2e:readiness:local`: passed from cold start.
- The full suite executed `npm run test:e2e:live:sample-preflight` and produced `Sample live-send preflight: READY` with `No send performed: true`.
- `npm run test:e2e:status`: safe non-live gates proved; `Sample 757 preflight: ready=true no_send=true last4=2944 override=true`.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Sample Evidence Leak Checks In Completion Audit

Linear update: `8379b50b-3a71-416c-bff6-0ea29fe010ac`.

Latest update: made the completion audit independently enforce raw phone/body absence in the 757 sample preflight artifact.

Changes:

- Completion audit now fails the `safe sample 757-831-2944 used without accidental real outbound send` gate if `/tmp/clapcheeks-live-send-sample-preflight.json` contains the raw sample phone `+17578312944` or the raw sample body.
- Evidence index now reports `sample_live_preflight_raw_phone_absent` and `sample_live_preflight_raw_body_absent`.
- Evidence highlights now include `raw_phone_absent` and `raw_body_absent`.
- Fingerprint/index tests assert both raw-leak checks.

Fresh proof:

- `npm run test:e2e:readiness:local`: passed from cold start.
- Completion audit still reports all safe non-live gates proved and the real outbound send gate unproved.
- Evidence index reports `Sample 757 preflight: ready=true no_send=true last4=2944 override=true`.
- `npm run test:e2e:status`: safe non-live gates proved; `Sample 757 preflight: ready=true no_send=true last4=2944 override=true`.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Readiness Status Sample Redaction Proof

Linear update: `3c75b30f-dba7-46e4-a607-40836de56712`.

Latest update: promoted the sample preflight raw-leak proof into the normal readiness status output.

Changes:

- `npm run test:e2e:status` now prints `Sample 757 redaction: raw_phone_absent=true raw_body_absent=true`.
- Status JSON now includes `sample_live_preflight.raw_phone_absent` and `sample_live_preflight.raw_body_absent`.
- Contract tests assert the status reporter includes the redaction fields.

Fresh proof:

- `npm run test:e2e:status`: printed `Sample 757 redaction: raw_phone_absent=true raw_body_absent=true`.
- `npm run test:e2e:readiness:local`: passed from cold start.
- The full suite still executed `npm run test:e2e:live:sample-preflight` and produced `Sample live-send preflight: READY` with `No send performed: true`.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Completion Audit Final Gate Next Action

Linear update: `b2ead0e0-168f-4ac1-8e3e-677936a423a3`.

Latest update: made the completion audit itself print the final live-send blocker and exact next action.

Changes:

- Completion audit now writes `final_gate` and `next_required_action` into `/tmp/clapcheeks-completion-audit-2026-05-18.json`.
- `npm run test:e2e:audit` now prints `Final gate blockers: live_env_missing=4 sample_override_required=false preflight_ready=false`.
- `npm run test:e2e:audit` now prints the next action to get current explicit live-send approval, exact destination, and exact body; set the missing env; rerun preflight before the live harness.
- Contract tests assert the final-gate and next-action output.

Fresh proof:

- `npm run test:e2e:audit`: printed the final blocker and next-action lines.
- `npm run test:e2e:readiness:local`: passed from cold start and included the same completion-audit final-gate output inside the one-command suite.
- `npm exec -- node --test __tests__/*.test.mjs`: 66/66 passed.
- Port `3002` was clear after the cold-start suite.
- No live outbound send was performed.

## Approval Packet Markdown Leak Checks

Latest update: the human-readable live-send approval packet now has explicit evidence-index and status checks proving it stays redacted.

Changes:

- `scripts/e2e-readiness-status.mjs` reports `markdown_raw_e164_absent`, `markdown_raw_body_absent`, and `markdown_sample_override_phrase_present` for `/tmp/clapcheeks-live-send-approval-packet-2026-05-18.md`.
- `scripts/e2e-evidence-index.mjs` now records the same Markdown leak checks in both `summary` and `evidence_highlights.approval_packet`.
- Contract and fingerprint tests assert the Markdown packet does not include the raw sample E.164 phone or raw sample body while preserving the required 2944 override phrase.

Fresh proof:

- `node --check scripts/e2e-readiness-status.mjs`: passed.
- `node --check scripts/e2e-evidence-index.mjs`: passed.
- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs __tests__/live-fingerprint-audit.test.mjs`: 36/36 passed.
- `npm run test:e2e:live:approval-packet`: `READY_FOR_APPROVAL`, raw phone/body written false, no send performed.
- `npm run test:e2e:status`: `Approval packet: ready=true ... markdown=true markdown_e164_absent=true markdown_body_absent=true raw_phone_written=false raw_body_written=false`.
- `npm run test:e2e:evidence`: `Approval packet: ready=true ... markdown=true markdown_e164_absent=true markdown_body_absent=true raw_phone_written=false raw_body_written=false`.
- `npm exec -- node --test __tests__/*.test.mjs`: 71/71 passed.
- Port `3002` was clear after verification.
- No live outbound send was performed.

## Inbound Watcher Launchd And FDA Gate

Latest update: converted the Gina/Convex staleness finding into an explicit runtime readiness gate.

Changes:

- Runtime repo now has MBP-safe launchd templates for `tech.clapcheeks.runner`, `tech.clapcheeks.mediawatcher`, and `tech.clapcheeks.inbound-watcher`.
- Installed and loaded `~/Library/LaunchAgents/tech.clapcheeks.inbound-watcher.plist`.
- `clapcheeks.imessage.inbound_watcher` now writes a redacted local status file at `~/.clapcheeks-local/state/inbound-watcher-status.json`.
- The old Full Disk Access alert iMessage is now opt-in only: `CC_INBOUND_WATCHER_SEND_FDA_ALERT=1`; the installed LaunchAgent sets it to `0`.
- `scripts/launchd_doctor.sh` now includes the inbound watcher and fails when launchd Python cannot read `chat.db`.
- Web `npm run test:e2e:runtime` now consumes the inbound watcher status file, so stale chat.db to Convex ingestion is a first-class readiness blocker instead of being hidden by shell-level `chat.db` access.

Fresh proof:

- Runtime `python -m compileall -q clapcheeks/imessage/inbound_watcher.py`: passed.
- Runtime `bash -n scripts/launchd_doctor.sh scripts/run-inbound-watcher.sh`: passed.
- Runtime `plutil -lint` for launchd templates: passed.
- Runtime `$HOME/.clapcheeks-local/.venv/bin/python -m pytest -q`: 54/54 passed.
- Web `node --check` for runtime smoke, readiness status, and evidence index: passed.
- Web `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 31/31 passed.
- Web `npm exec -- node --test __tests__/*.test.mjs`: 71/71 passed.
- Installed LaunchAgent evidence: `tech.clapcheeks.inbound-watcher` is loaded and running with `CC_INBOUND_WATCHER_SEND_FDA_ALERT=0`.
- Runtime status evidence: `inbound-watcher-status.json` reports `running=true`, `fda_alert_imessage_enabled=false`, `can_read_chatdb=false`, and `last_error_kind=full_disk_access_missing`.
- `scripts/launchd_doctor.sh` now reports `FAIL tech.clapcheeks.inbound-watcher cannot read chat.db: Full Disk Access missing for launchd Python`.
- `npm run test:e2e:runtime` now fails the runtime readiness gate with `Inbound watcher blocker: full_disk_access_missing`.
- `npm run test:e2e:audit`: not complete; missing non-live evidence is `runtime inbound source of truth is reachable in no-send mode`.
- `npm run test:e2e:status`: safe non-live gates are not fully proved; unproved requirements are runtime inbound source of truth and the final live send.
- `npm run test:e2e:evidence`: `Safe non-live gates proved: false`, remaining gate includes runtime inbound source of truth and final live send.
- No live outbound send was performed.

Current blocker:

- Grant Full Disk Access to the launchd Python app shown in the process path, currently `/opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/Python.app`, then restart `tech.clapcheeks.inbound-watcher` and rerun `npm run test:e2e:runtime`, `npm run test:e2e:audit`, `npm run test:e2e:status`, and `npm run test:e2e:evidence`.

## Dashboard Runtime Blocker Quick View

Latest update: surfaced the inbound watcher blocker directly in the dashboard and health API, and fixed the scheduled page production build blocker.

Changes:

- Added `lib/clapcheeks/runtime-health.ts` to read the redacted inbound watcher status file.
- `/api/health?detailed=true` now includes `service=inbound-watcher` and returns `overall=degraded` when the watcher cannot read `chat.db`.
- Dashboard `Today's Briefing` now includes `Runtime Blockers`; current rendered detail is `Full Disk Access missing for launchd Python`.
- Browser visual proof now requires the runtime blocker tile and text, alongside token blocker proof.
- `/scheduled` is now wrapped in a Suspense boundary so `useSearchParams()` no longer breaks production prerender.

Fresh proof:

- `npm exec -- node --test __tests__/dashboard-e2e-contract.test.mjs`: 31/31 passed.
- `npm run build`: passed. Existing Sentry/OpenTelemetry warnings remained, but `/scheduled` prerender now succeeds.
- `npm exec -- node --test __tests__/*.test.mjs`: 71/71 passed.
- `CLAPCHEEKS_SELF_TEST_PHONE=+17578312944 npm run dev:runtime -- --port 3002`: served local app for verification.
- `curl 'http://127.0.0.1:3002/api/health?detailed=true'`: returned `overall=degraded` and inbound watcher message `Full Disk Access missing for launchd Python`.
- `npm run test:e2e:browser`: passed; browser evidence shows `runtime_tile_present=true` and `runtime_blocker_present=true`.
- `npm run test:e2e:safe`: passed; dashboard runtime health contract reports `overall=degraded`, `convex=healthy`, and `inbound_watcher=degraded`.
- `npm run test:e2e:backend-doctor`: passed.
- `npm run test:e2e:runtime`: failed correctly with `Inbound watcher blocker: full_disk_access_missing`.
- `npm run test:e2e:local-browser`: passed against local Chrome, route `/analytics`.
- `npm run test:e2e:audit`: not complete; missing non-live evidence remains `runtime inbound source of truth is reachable in no-send mode`.
- `npm run test:e2e:evidence`: safe non-live gates remain not fully proved; remaining gates are runtime inbound source of truth and final live send.
- Dev server on port `3002` was stopped after verification.
- No live outbound send was performed.

## Inbound Watcher Terminal Read-Only Proof

Latest update: proved the foreground Terminal path can read local Messages safely while keeping the launchd readiness gate blocked until unattended ingestion is fixed.

Changes:

- Added `/Users/julianbradley/clapcheeks-local/scripts/prove-inbound-watcher-terminal-read.sh`.
- The proof imports `fetch_messages_since` only; it does not call `tick()`, does not call `messages:upsertFromWebhook`, does not invoke `osascript`, and writes no message bodies or raw handles.
- Added `/Users/julianbradley/clapcheeks-local/scripts/open-inbound-watcher-fda-settings.sh` to open Full Disk Access settings and print the exact Python app/restart/doctor flow.
- Added script-contract coverage in `/Users/julianbradley/clapcheeks-local/tests/test_device_control_scripts.py`.

Fresh proof:

- `/Users/julianbradley/clapcheeks-local/scripts/prove-inbound-watcher-terminal-read.sh`: passed and wrote `/tmp/clapcheeks-inbound-watcher-terminal-proof-2026-05-18.json`.
- Evidence summary: `ok=true`, `can_read_chatdb=true`, `count=553`, `inbound=237`, `outbound=316`, `handle_count=47`, `no_send=true`, `mutation=false`, `bodies_written=false`, `raw_handles_written=false`.
- `bash -n scripts/prove-inbound-watcher-terminal-read.sh scripts/open-inbound-watcher-fda-settings.sh scripts/launchd_doctor.sh scripts/run-inbound-watcher.sh`: passed.
- Runtime `pytest -q tests/test_device_control_scripts.py`: `16 passed`.
- Runtime full test suite: `56 passed`.
- `scripts/launchd_doctor.sh`: still fails correctly with `Full Disk Access missing for launchd Python`.
- Web `npm run test:e2e:runtime`: still fails correctly with `Inbound watcher blocker: full_disk_access_missing`.
- Web `npm run test:e2e:status`: `NOT COMPLETE`; safe non-live gates are not fully proved because runtime inbound source of truth remains unproved.

Current interpretation:

- Terminal has Full Disk Access and the chat.db extractor works.
- `tech.clapcheeks.inbound-watcher` is still blocked because launchd Python lacks Full Disk Access, so unattended chat.db -> Convex ingestion is not proved.
- The completion audit must remain incomplete until the launchd status file reports `can_read_chatdb=true` and `npm run test:e2e:runtime` passes.
- No live outbound send was performed.

## Dashboard Terminal Proof Diagnostic

Latest update: surfaced the read-only Terminal proof in dashboard/runtime evidence without changing the fail-closed launchd gate.

Changes:

- `/Users/julianbradley/clapcheeks.tech/web/lib/clapcheeks/runtime-health.ts` now reads `/tmp/clapcheeks-inbound-watcher-terminal-proof-2026-05-18.json` or `CLAPCHEEKS_INBOUND_TERMINAL_PROOF`.
- `/api/health?detailed=true` and the dashboard `Runtime Blockers` tile now include the distinction: launchd Python lacks Full Disk Access, while Terminal read-only proof passed.
- `/Users/julianbradley/clapcheeks.tech/web/scripts/e2e-runtime-smoke-safe.mjs` records `inbound_terminal_proof_ok`, proof path, and proof payload in `/tmp/clapcheeks-runtime-smoke-evidence.json`.
- Readiness status and evidence index now print/report `Runtime terminal proof`.
- Contract coverage in `/Users/julianbradley/clapcheeks.tech/web/__tests__/dashboard-e2e-contract.test.mjs` asserts the new proof plumbing.

Fresh proof:

- `node --check` for runtime smoke, readiness status, and evidence index: passed.
- Dashboard contract test: `31 passed`.
- `npm run build`: passed; existing Sentry/OpenTelemetry warnings remained.
- `npm run test:e2e:runtime`: still fails correctly, now printing `Terminal read-only proof: ok=true` and `Inbound watcher blocker: full_disk_access_missing`.
- Local `/api/health?detailed=true`: returned `overall=degraded` with inbound watcher message `Full Disk Access missing for launchd Python; Terminal read-only proof passed (553 rows), grant Full Disk Access to launchd Python`.
- Local `/dashboard` HTML includes `Runtime Blockers`, `Full Disk Access missing for launchd Python`, and `Terminal read-only proof passed`.
- `npm run test:e2e:browser`: passed and refreshed browser evidence.
- `npm run test:e2e:safe`: passed, including dashboard runtime health, route matrix, Messages DB read-only sample proof, iMessage dry-run, scheduled dry-run, and fixture cleanup.
- Full web tests: `71 passed`.
- `npm run test:e2e:status` and `npm run test:e2e:evidence`: still `NOT COMPLETE` / `Complete=false` with two remaining gates: runtime inbound source-of-truth and final real outbound send.
- Dev server on port `3002` was stopped after verification.
- No live outbound send was performed.

## Device Operator Inbound Watcher Unblock

Latest update: added the exact inbound watcher Full Disk Access unblock path to the operator `/device` page and made browser evidence require it.

Changes:

- `/api/device-control/status` now includes `inbound_watcher` with launchd status, Terminal proof status, required Python app path, opener command, restart command, and runtime verification command.
- `/device` now renders an `Inbound watcher unblock` section showing:
  - Required Python app: `/opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/Python.app`
  - Unblock command: `cd ~/clapcheeks-local && scripts/open-inbound-watcher-fda-settings.sh`
  - Restart command: `launchctl kickstart -k gui/$(id -u)/tech.clapcheeks.inbound-watcher`
  - Verify command: `cd ~/clapcheeks-local && scripts/launchd_doctor.sh && cd ~/clapcheeks.tech/web && npm run test:e2e:runtime`
- Browser visual verifier now requires the `/device` page and `/api/device-control/status` to expose the inbound watcher unblock details and Terminal proof status.

Fresh proof:

- Focused contract tests: `41 passed`.
- Touched-file TypeScript filter for `/device` and status route: no diagnostics.
- Live `/api/device-control/status` reported `blocker=full_disk_access_missing`, `terminal_ok=true`, `terminal_count=553`, the exact `open-inbound-watcher-fda-settings.sh` unblock command, the Python app path, and runtime verify command.
- Live `/device` HTML includes `Inbound watcher unblock`, `Python.app`, `open-inbound-watcher-fda-settings.sh`, `tech.clapcheeks.inbound-watcher`, and `npm run test:e2e:runtime`.
- `npm run test:e2e:browser`: passed; `/tmp/clapcheeks-e2e-browser/device-control-safety-proof.json` now records `inbound_watcher.terminal_proof_ok=true`, `no_send=true`, `mutation=false`, and unblock/restart/verify command presence.
- `npm run test:e2e:safe`: passed.
- Full web tests: `71 passed`.
- Dev server on port `3002` was stopped after verification.
- No live outbound send was performed.

## One-Command Inbound Watcher FDA Repair Harness

Latest update: added a single repair/verification command for the inbound watcher Full Disk Access blocker.

Changes:

- Added `/Users/julianbradley/clapcheeks-local/scripts/repair-inbound-watcher-fda.sh`.
- The harness can open Full Disk Access settings, rerun the read-only Terminal proof, restart `tech.clapcheeks.inbound-watcher`, run `scripts/launchd_doctor.sh`, run web `npm run test:e2e:runtime`, and write `/tmp/clapcheeks-inbound-watcher-fda-repair-2026-05-18.json`.
- The harness records `no_live_send_performed=true` and `convex_inbound_mutation_after_fda_possible=true`; after FDA is granted, the restarted watcher may upsert fresh inbound Messages rows to Convex, which is the intended runtime source-of-truth proof.
- `/api/device-control/status`, `/device`, and browser visual proof now expose `cd ~/clapcheeks-local && scripts/repair-inbound-watcher-fda.sh`.

Fresh proof:

- No-open harness run: `CLAPCHEEKS_INBOUND_REPAIR_OPEN_SETTINGS=0 CLAPCHEEKS_INBOUND_REPAIR_WAIT_SECONDS=0 scripts/repair-inbound-watcher-fda.sh` failed closed as expected.
- Repair evidence summary: `ok=false`, `launchd_ready=false`, `terminal_proof_ok=true`, `remaining_blocker=full_disk_access_missing`, `no_live_send_performed=true`, `runtime_smoke_exit=1`.
- Runtime focused script tests: `17 passed`.
- Runtime full tests: `57 passed`.
- Web focused contract tests: `41 passed`.
- Web touched-file TypeScript filter: no diagnostics.
- Live `/api/device-control/status` exposes the repair command, `blocker=full_disk_access_missing`, and `terminal_ok=true`.
- Live `/device` HTML includes `Inbound watcher unblock`, `repair-inbound-watcher-fda.sh`, and `open-inbound-watcher-fda-settings.sh`.
- `npm run test:e2e:browser`: passed; `/tmp/clapcheeks-e2e-browser/device-control-safety-proof.json` records `repair_verify_command_present=true`, `terminal_proof_ok=true`, `no_send=true`, and `mutation=false`.
- Web full tests: `71 passed`.
- `npm run test:e2e:evidence`: still `Complete=false` with remaining gates `runtime inbound source of truth is reachable in no-send mode` and `real outbound send-to-Julian test`.
- Dev server on port `3002` was stopped after verification.
- No live outbound send was performed.

## Repair Artifact In Readiness Evidence

Latest update: promoted the inbound watcher repair artifact into the main readiness status and evidence index.

Changes:

- `/Users/julianbradley/clapcheeks.tech/web/scripts/e2e-readiness-status.mjs` now reads `/tmp/clapcheeks-inbound-watcher-fda-repair-2026-05-18.json` or `CLAPCHEEKS_INBOUND_REPAIR_EVIDENCE`.
- `/Users/julianbradley/clapcheeks.tech/web/scripts/e2e-evidence-index.mjs` now includes an `inbound_repair` artifact and summary fields for `ok`, `launchd_ready`, `terminal_proof_ok`, `remaining_blocker`, `no_live_send_performed`, and runtime-smoke exit code.
- Contract coverage now asserts the repair artifact path and `Inbound repair harness` console output.

Fresh proof:

- `node --check scripts/e2e-readiness-status.mjs scripts/e2e-evidence-index.mjs`: passed.
- Dashboard contract tests: `31 passed`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; it now prints `Inbound repair harness: ok=false launchd_ready=false terminal=true blocker=full_disk_access_missing no_send=true`.
- `npm run test:e2e:evidence`: still `Complete=false`; it now prints the same repair-harness state and keeps the remaining gates unchanged.
- Full web tests: `71 passed`.
- No live outbound send was performed.

## Readiness Next Action Priority

Latest update: fixed the status reporter so the next required action prioritizes the missing non-live inbound watcher source-of-truth proof before any live-send preparation.

Changes:

- `/Users/julianbradley/clapcheeks.tech/web/scripts/e2e-readiness-status.mjs` now checks for the unproved `runtime inbound source of truth is reachable in no-send mode` gate before live-send env/preflight guidance.
- If the repair artifact reports `launchd_ready=false`, the status fallback names `full_disk_access_missing` as the blocker.
- `/Users/julianbradley/clapcheeks.tech/web/__tests__/dashboard-e2e-contract.test.mjs` now asserts the repair-first guidance, runtime inbound gate name, repair command, and FDA blocker fallback.

Fresh proof:

- `node --check scripts/e2e-readiness-status.mjs`: passed.
- Dashboard contract tests: `31 passed`.
- `npm run test:e2e:status`: still `NOT COMPLETE`; `Next:` now says to run `cd ~/clapcheeks-local && scripts/repair-inbound-watcher-fda.sh`, grant Full Disk Access to launchd Python, then rerun runtime evidence. Current blocker: `full_disk_access_missing`.
- `npm run test:e2e:evidence`: still `Complete=false` and keeps remaining gates as `runtime inbound source of truth is reachable in no-send mode` and `real outbound send-to-Julian test`.
- No live outbound send was performed.

## FDA UI Proof And Audit Priority Alignment

Latest update: used Computer Use to inspect the live macOS Full Disk Access UI and aligned completion audit guidance with the true blocker.

Findings:

- System Settings > Privacy & Security > Full Disk Access shows `python3.14` present but toggled off.
- Attempting to enable `python3.14` opened the macOS authorization sheet: `Privacy & Security is trying to modify your system settings. Enter your password to allow this.`
- The prompt was canceled without entering a password. The switch remains off.
- Fresh repair harness evidence still reports `ok=false`, `launchd_ready=false`, `terminal_proof_ok=true`, `remaining_blocker=full_disk_access_missing`, and `no_live_send_performed=true`.

Changes:

- `/Users/julianbradley/clapcheeks.tech/web/scripts/e2e-completion-audit.mjs` now prioritizes the `runtime inbound source of truth is reachable in no-send mode` gate before artifact freshness if runtime smoke or the inbound watcher is blocked.
- Contract coverage now asserts the completion audit repair-first guidance and `Current blocker:` output.

Fresh proof:

- `scripts/launchd_doctor.sh`: still fails only at `tech.clapcheeks.inbound-watcher cannot read chat.db: Full Disk Access missing for launchd Python`.
- `npm run test:e2e:runtime`: still fails correctly with `Inbound watcher blocker: full_disk_access_missing`.
- Env-backed local dashboard started on `127.0.0.1:3002`.
- `npm run test:e2e:browser`: passed against the real local browser/dashboard, including dashboard dry-run, mobile quick views, scheduled confirmation guardrails, intelligence, analytics, and device safety.
- `npm run test:e2e:safe`: passed; it created, approved, dry-run sent, and audit-safe canceled a scheduled fixture for last4 `2944`; no real send.
- `node scripts/e2e-backend-doctor-safe.mjs`: passed.
- `npm run test:e2e:local-browser`: passed.
- `npm run test:e2e:live`: refused safely with missing live env.
- `npm run test:e2e:live:rehearsal`: passed in no-send dry-run mode.
- `npm run test:e2e:live:sample-preflight`: refused because runtime smoke no-send proof is missing.
- `node --check scripts/e2e-completion-audit.mjs`: passed.
- Dashboard contract tests: `31 passed`.
- `npm run test:e2e:audit`: still not complete, but `Next required action` now points to `scripts/repair-inbound-watcher-fda.sh`, Full Disk Access for launchd Python, and rerunning runtime/audit.
- `npm run test:e2e:evidence`: still `Complete=false`; next action now matches the runtime FDA blocker.
- No live outbound send was performed.

## TCC Proof In Repair And Readiness Evidence

Latest update: added direct macOS TCC evidence to the inbound watcher repair artifact and surfaced it in readiness status/evidence.

Changes:

- `/Users/julianbradley/clapcheeks-local/scripts/repair-inbound-watcher-fda.sh` now records:
  - `real_python`
  - `full_disk_access_tcc.python_row_count`
  - `full_disk_access_tcc.python_authorized`
  - `full_disk_access_tcc.python_denied_or_off`
  - redacted matching TCC rows for `kTCCServiceSystemPolicyAllFiles`
- `/Users/julianbradley/clapcheeks-local/scripts/open-inbound-watcher-fda-settings.sh` now tells the operator to turn on `python3.14` if it is already listed and notes macOS may ask for the Julian Bradley account password.
- `/Users/julianbradley/clapcheeks.tech/web/scripts/e2e-readiness-status.mjs` and `/Users/julianbradley/clapcheeks.tech/web/scripts/e2e-evidence-index.mjs` now print `Inbound repair TCC`.
- Contract coverage asserts the TCC fields and console output.

Fresh proof:

- `CLAPCHEEKS_INBOUND_REPAIR_OPEN_SETTINGS=0 CLAPCHEEKS_INBOUND_REPAIR_WAIT_SECONDS=0 scripts/repair-inbound-watcher-fda.sh` failed closed as expected.
- Repair artifact now reports `real_python=/opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/bin/python3.14`, `python_row_count=1`, `python_authorized=false`, `python_denied_or_off=true`, and the matching system TCC row with `auth_value=0`.
- `scripts/launchd_doctor.sh`: still fails only at `Full Disk Access missing for launchd Python`.
- Runtime tests: `57 passed`.
- Web tests: `71 passed`.
- `npm run test:e2e:status`: prints `Inbound repair TCC: python_authorized=false denied_or_off=true rows=1 ...`.
- `npm run test:e2e:evidence`: prints the same TCC line and remains `Complete=false` with the true blockers.
- No live outbound send was performed.

## Dashboard Device TCC Proof Surface

Latest update: exposed the inbound watcher Full Disk Access TCC proof inside the dashboard `/device` operator surface and browser verifier.

Changes:

- `/api/device-control/status` now reads `/tmp/clapcheeks-inbound-watcher-fda-repair-2026-05-18.json` and returns `inbound_watcher.tcc` with the redacted TCC summary.
- `/device` now renders `TCC python`, `TCC rows`, and `Full Disk Access TCC` inside `Inbound watcher unblock`.
- Browser visual proof now requires the `/device` page and status API to expose `python_authorized=false`, `python_denied_or_off=true`, and at least one Python TCC row.
- Fixed a mobile overflow regression caused by the long `real_python` path by forcing the TCC evidence text to wrap.

Fresh proof:

- `/api/device-control/status` returned `inbound_watcher.tcc.status=loaded`, `python_authorized=false`, `python_denied_or_off=true`, `python_row_count=1`, and the real Python binary.
- Focused device/dashboard contracts: `41 passed`.
- Touched-file TypeScript filter: no diagnostics for `app/api/device-control/status`, `app/(main)/device/device-control-panel`, or the browser script.
- `npm run test:e2e:browser`: passed; `/tmp/clapcheeks-e2e-browser/device-control-safety-proof.json` records `tcc_python_authorized=false`, `tcc_python_denied_or_off=true`, `tcc_python_row_count=1`, and `overflow_x=false`.
- Full web tests: `71 passed`.
- `npm run test:e2e:status` and `npm run test:e2e:evidence`: still incomplete, but both print the TCC proof and keep the next action on the launchd Python Full Disk Access repair.
- Dev server on port `3002` was stopped after verification.
- No live outbound send was performed.

## Browser E2E TCC Proof Rerun

Latest update: reran the real-browser E2E after hardening the `/device` TCC assertion.

Fix:

- The `/device` browser assertion was using exact-case text for `Inbound watcher unblock`; the rendered label is uppercased by CSS. The verifier now checks that label case-insensitively while still requiring exact `TCC python:` and `Full Disk Access TCC:` strings.

Fresh proof at 2026-05-18 07:46 PDT:

- `npm run test:e2e:browser`: passed end to end.
- Browser proof includes dashboard desktop, dashboard navigation, dashboard runtime blocker quick view, dashboard iMessage self-test dry-run, dashboard mobile quick view, `/device` mobile runtime safety, `/device` inbound watcher TCC proof, scheduled mobile create/form guardrails, approved-send confirmation guardrails, intelligence desktop/mobile, and analytics mobile.
- `/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json` reports `screenshots=9`, `mobile metrics=7`, `overflow_free=true`, `device_control_status.inbound_watcher.tcc_python_authorized=false`, `tcc_python_denied_or_off=true`, `tcc_python_row_count=1`, and `no_live_send_performed=true`.
- `npm exec -- node --test __tests__/*.test.mjs`: `71 passed`.
- Touched-file TypeScript filter: no diagnostics for runtime health, device-control panel, browser verifier, or related contract tests.
- `npm run test:e2e:status` and `npm run test:e2e:evidence`: still correctly `Complete=false`. The remaining blockers are launchd Python Full Disk Access for the inbound watcher and a final explicitly approved real outbound send.
- `node scripts/e2e-live-send-preflight.mjs`: refreshed the no-send live preflight and refused safely because live permission, destination, body, and expected last4 are not provided.
- `node scripts/e2e-live-send-sample-preflight.mjs`: refused to refresh sample-757 evidence because runtime smoke no-send proof is still blocked by `full_disk_access_missing`.
- No live outbound send was performed.

## Full Disk Access Accepted And Non-Live Gates Proved

Latest update: after Julian accepted the macOS Full Disk Access prompt, the inbound watcher repair and readiness chain now pass.

Fresh proof at 2026-05-18 09:12 PDT:

- `/Users/julianbradley/clapcheeks-local/scripts/repair-inbound-watcher-fda.sh`: `ok=true`, `launchd_ready=true`, `terminal_proof_ok=true`, `remaining_blocker=null`, `no_live_send_performed=true`.
- `/Users/julianbradley/clapcheeks-local/scripts/launchd_doctor.sh`: passed; `tech.clapcheeks.inbound-watcher can read chat.db`.
- Runtime tests: `57 passed`.
- `npm run test:e2e:runtime`: `Runtime smoke: PASS`, `inbound_watcher=true`, `blocker=none`, `no_send=true`.
- `npm run test:e2e:safe`: passed. It verified routes, analytics, healthy runtime health, Messages DB read-only sample lookup for last4 `2944` (`rows=28`, `outbound=14`, `content_logged=false`), dashboard iMessage dry-run/no-queue, scheduled create -> approve -> live blocked -> dry-run -> cancel, and active fixture cleanup.
- `npm run test:e2e:live:sample-preflight`: ready for the redacted 757 sample plan with `destination=*******2944`, body hash only, no raw phone/body leakage, and `no_send=true`.
- `npm run test:e2e:browser`: passed before the final Chrome AppleEvent instability. Evidence file `/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json` has 9 screenshots, 7 mobile metrics, `overflow_free=true`, dashboard runtime healthy, device TCC authorized, scheduled guardrails, intelligence, analytics, and `no_live_send_performed=true`.
- `npm exec -- node --test __tests__/*.test.mjs`: `71 passed`.
- Touched-file TypeScript filter: no diagnostics.
- `npm run test:e2e:audit`: all non-live gates proved.
- `npm run test:e2e:evidence`: `Safe non-live gates proved: true`, `Proved requirements: 11`, `Unproved requirements: 1`.
- `npm run test:e2e:status`: `Safe non-live gates: proved`; the only remaining gate is `real outbound send-to-Julian test`.

Remaining gate:

- A real outbound send was not performed. The live harness still refuses without `CLAPCHEEKS_LIVE_SEND_PERMISSION`, `CLAPCHEEKS_LIVE_SEND_PHONE`, `CLAPCHEEKS_LIVE_SEND_BODY`, and `CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4`.
- Next required action from status/evidence: get current explicit live-send approval, exact destination, and exact body; run `npm run test:e2e:live:preflight`; then run `npm run test:e2e:live`.
