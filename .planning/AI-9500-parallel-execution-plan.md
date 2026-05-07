# AI-9500 — 8 Upgrades, Parallel Execution Plan

## Goal

Ship all 8 conversion-improvement upgrades from `AI-9500-conversion-improvement-strategy.md` in parallel.

## Conflict matrix (which files each upgrade touches)

| File | #1 curiosity | #2 ask-window | #3 slots | #4 velocity | #5 anti-flake | #6 post-date | #7 self-coach | #8 opener A/B |
|---|---|---|---|---|---|---|---|---|
| `schema.ts` | A | A | - | - | - | A | - | A |
| `enrichment.ts` | B | B | - | - | - | - | - | B |
| `touches.ts` | B | B | - | - | B | B | - | - |
| `crons.ts` | - | - | - | - | - | B | - | B |
| `calendar.ts` | - | - | C | - | - | - | - | - |
| `convex_runner.py` | C | - | - | C | C | C | - | - |
| `network/page.tsx` | C | - | - | - | - | - | - | - |
| `people/[id]/page.tsx` | C | - | - | - | - | C | - | - |
| `coach/page.tsx` (new) | - | - | - | - | - | - | NEW | - |
| `coach.ts` (new) | - | - | - | - | - | - | NEW | - |
| `opener.ts` (new) | - | - | - | - | - | - | - | NEW |

**A** = schema (multi-touched — must pre-bundle so subsequent agents start with valid schema)
**B** = enrichment.ts / touches.ts / crons.ts (multi-touched — serialize merges)
**C** = isolated section in shared file
**NEW** = brand-new file (zero conflict)

## Execution waves

### Wave 0 — Foundation (1 agent, must finish before Wave A starts)
**Agent F1** — schema bundle + shared validators
- Add to `schema.ts`:
  - `her_question_ratio_7d` (number, optional) on people
  - `ask_outcome` (string union: yes/soft_no/hard_no/no_reply, optional) on scheduled_touches
  - `date_done_at` (number, optional) on scheduled_touches
  - `date_notes_text` (string, optional) on scheduled_touches
  - new `post_date_calibration` value in `type` union on scheduled_touches
  - new table `opener_experiments` (variant_id, archetype, message_id, outcome, created_at, plus indexes)
  - new touch types `easy_question_revival`, `date_dayof_transit`, `post_date_calibration`
- Deploy convex, verify schema valid against live data
- PR + auto-merge

**Budget:** 25 tool calls. Model: sonnet.

### Wave A — Sequential (touches enrichment.ts/touches.ts/crons.ts) — 3 agents, merged in order
**Agent A1** — #1 Curiosity-question scheduler
- `enrichment.ts`: add `_computeHerQuestionRatio` helper; in `recalibrateCadenceForOne` write `her_question_ratio_7d`; if ratio < 0.15 AND last_inbound > 24h, set `next_followup_kind = "easy_question_revival"`
- `touches.ts`: add `easy_question_revival` template branch in `_draft_with_template`
- `convex_runner.py`: handle the template
- Dossier Memory tab: render the metric + a "quiet thread" badge on network row
- **Budget:** 35 tool calls. **Model:** sonnet.

**Agent A2** — #2 Ask-window optimizer
- `enrichment.ts`: replace `sweepAskCandidates` straight `runAfter(0)` path with `_findActivelyTypingCandidates`; for those, schedule the ask `runAfter(60_000)`; for others, fall back to existing 30-90min stagger
- `touches.ts`: add `ask_outcome` writer when reply lands or 7d passes
- `messages.ts` `upsertFromWebhook`: detect when an inbound message follows a recent date_ask outbound and patch the touch row's `ask_outcome`
- **Budget:** 35 tool calls. **Model:** sonnet.

**Agent A3** — #6 Post-date calibrator
- `crons.ts`: schedule `post_date_calibration` touch +18h after any `scheduled_touches` row is marked `date_done_at` set
- `touches.ts`: implement `_handlePostDateCalibration` that returns 3 candidate drafts (callback / photo-share / generic-thanks)
- Dossier Schedule tab: "Date notes" textarea writes `date_notes_text`
- Compose panel: when post_date_calibration fires, show all 3 candidates side-by-side; click to commit one
- `_draft_with_template`: post_date prompt that uses date_notes_text
- **Budget:** 50 tool calls. **Model:** sonnet.

Wave A merges sequentially because A1 → A2 → A3 each touch `touches.ts` / `enrichment.ts`.

### Wave B — Fully parallel (independent files) — 4 agents
**Agent B1** — #3 Triple-slot diversification
- `calendar.ts`: extend `listFreeSlots` to return mixed kinds (1 evening + 1 weekend + 1 activity preferred)
- VPS `cc-calendar-worker`: read `~/.clapcheeks/activity-suggestions.yml` (we author template) and write activity slots
- `_draft_with_template` for `date_ask_three_options`: label slot kinds in prompt ("Tuesday 7p drinks?  Saturday 11am hike?  Sunday brunch?")
- **Budget:** 30 tool calls. **Model:** sonnet.

**Agent B2** — #4 Reply-velocity enforcement
- `convex_runner.py` `_handle_send_imessage`: read `cadence_overrides.her_avg_reply_minutes`; compute `min_wait = max(60, 0.6 * her_avg_seconds)`; if `(now - her_last_inbound) < min_wait`, reschedule via `touches:_reschedule` for `min_wait`
- Logging: emit one line per enforcement so we see how often it fires
- **Budget:** 20 tool calls. **Model:** sonnet.

**Agent B3** — #5 Anti-flake kit (transit ping + check-in)
- `touches.ts`: when a `date_confirm_24h` touch fires successfully, schedule a `date_dayof_transit` for 90min before the date
- New template `date_dayof_transit` in `_draft_with_template`: "headed to <venue> — text me when you're 5 out 🙏"
- New template `date_check_in`: schedule 30min before if she's been silent
- **Budget:** 30 tool calls. **Model:** sonnet.

**Agent B4** — #7 Self-coaching dashboard
- New route `app/admin/clapcheeks-ops/coach/page.tsx`
- New convex file `coach.ts` with queries:
  - `getOverPursueList(user_id)` — your investment ratio > 2.5x hers, last 30d
  - `getLateNightConversion(user_id)` — sends after 11pm vs daytime, conversion rate
  - `getSameOpenerOveruse(user_id)` — group outbounds by sha1 of first 50 chars
  - `getCutListCandidates(user_id)` — high effort + low hotness + no reciprocity
  - `getStuckInStage(user_id)` — >14d in early_chat
  - `getTimeOfDayHeatmap(user_id)` — your sends × her replies, color by yes-rate
- Each card on /coach page shows 1 actionable sentence + the data
- **Budget:** 50 tool calls. **Model:** sonnet.

### Wave C — Biggest infra (parallel with B) — 1 agent
**Agent C1** — #8 Opener A/B engine
- New convex file `opener.ts`:
  - `_draft_opener_variants(her_archetype)` returns 2 variants
  - `recordOpenerVariant(message_id, variant_id, archetype)` mutation
  - `markOpenerOutcome(message_id, outcome)` mutation
  - `getArchetypeWinner(archetype)` query (epsilon-greedy after N=30 samples)
- `messages.ts` `upsertFromWebhook`: on first reply for a conversation, fire `markOpenerOutcome("replied")`; on 7d-no-reply via cron, fire `markOpenerOutcome("ghosted")`
- `crons.ts`: weekly archetype-winner cohort analysis writes to a `opener_winners` collection
- `convex_runner.py` opener path: call `getArchetypeWinner` first; if no clear winner, pick variant uniformly random
- **Budget:** 60 tool calls. **Model:** sonnet (this is the most code).

## Pre-resolved context (passed to every agent)

Path: `/tmp/AI-9500-shared-context.json` — written by orchestrator before any spawn:
```json
{
  "worktree_root": "/tmp/cc-agent11-AI-9500-bg",
  "main_branch": "main",
  "convex_deployment": "valiant-oriole-651",
  "convex_url": "https://valiant-oriole-651.convex.cloud",
  "convex_deploy_key_op_path": "API-Keys/CONVEX-clapcheeks-dev-admin-key",
  "fleet_user_id": "fleet-julian",
  "linear_parent": "AI-9500",
  "audit_findings_doc": "/tmp/cc-agent11-AI-9500-bg/.planning/AI-9500-dashboard-audit-plan.md",
  "strategy_doc": "/tmp/cc-agent11-AI-9500-bg/.planning/AI-9500-conversion-improvement-strategy.md",
  "factor_matrix_doc": "/tmp/cc-agent11-AI-9500-bg/.planning/AI-9500-mens-dating-coach-factors.md",
  "my_canvas_doc": "/tmp/cc-agent11-AI-9500-bg/.planning/AI-9500-parallel-execution-plan.md",
  "today_iso": "2026-05-06"
}
```

## Linear sub-issues (created before spawn)

Per `linear-sub-issues-and-resumability.md`, every spawn-worthy parallel agent gets a sub-issue:

| Sub | Title | Agent | Branch |
|---|---|---|---|
| AI-9500-F | AI-9500 Wave 0 schema foundation | F1 | AI-9500-F-schema-foundation |
| AI-9500-A1 | AI-9500 #1 curiosity-question scheduler | A1 | AI-9500-A1-curiosity |
| AI-9500-A2 | AI-9500 #2 ask-window optimizer | A2 | AI-9500-A2-ask-window |
| AI-9500-A3 | AI-9500 #6 post-date calibrator | A3 | AI-9500-A3-post-date |
| AI-9500-B1 | AI-9500 #3 triple-slot diversification | B1 | AI-9500-B1-triple-slot |
| AI-9500-B2 | AI-9500 #4 reply-velocity enforcement | B2 | AI-9500-B2-velocity |
| AI-9500-B3 | AI-9500 #5 anti-flake kit | B3 | AI-9500-B3-anti-flake |
| AI-9500-B4 | AI-9500 #7 self-coaching dashboard | B4 | AI-9500-B4-coach |
| AI-9500-C1 | AI-9500 #8 opener A/B engine | C1 | AI-9500-C1-opener-ab |

## Wall-clock estimate
- Wave 0 (schema): ~30 min
- Wave A (sequential merges): ~3h
- Wave B (parallel): ~2-3h (ends roughly when Wave A ends)
- Wave C (parallel with B): ~3-4h

**Total:** ~4 hours wall-clock for the dashboard side. Mac Mini daemon updates land progressively as each PR merges (convex_runner.py can be hot-reloaded).

## Verification (after each wave)

After Wave 0:
- `npx convex deploy` green
- Schema validates against existing 500 people + scheduled_touches rows

After Wave A:
- Trigger sweepCourtshipCandidates → 10 enrichments fire → her_question_ratio_7d populated for ≥5 people within 5min
- Trigger sweepAskCandidates → activity-typing-detection logs path taken
- Mark a test scheduled_touches row as date_done_at → confirm post_date_calibration scheduled at +18h

After Wave B:
- listFreeSlots returns mixed kinds (free + activity + weekend) when populated
- convex_runner sends fire respecting cadence-mirror floor
- /admin/clapcheeks-ops/coach renders all 6 cards with non-empty data

After Wave C:
- _draft_opener_variants returns 2 variants
- opener_experiments rows accumulate
- Weekly cohort cron schedules

## Risk + mitigation
- **Convex schema deploy fails on live data** — Wave 0 must run a `--dry-run` validation step before push. If old `scheduled_touches` rows lack `ask_outcome`, the union must be `v.optional(...)` everywhere.
- **Wave A merge conflicts** — agents work in their own worktrees; orchestrator merges sequentially with `git merge -X theirs` if needed; deploy after each merge to catch breaks early.
- **LLM cost spike** — opener variants 2x the LLM calls per opener. Cap to 1 outbound opener per match per session; track total cost.
- **OCC retries** — every sweep that scans `conversations` should use the per-person index pattern from the AI-9500 vibe-sweep fix.

## Done definition (per upgrade)
1. Code on its branch, PR opened, CI green (or no CI)
2. Auto-merged to main
3. Vercel deploy green for the SHA (poll until READY)
4. Convex deploy green for any backend change
5. One smoke-test against the deployed feature (varies per upgrade — see verification section)
6. Linear sub-issue closed with PR + verify proof
