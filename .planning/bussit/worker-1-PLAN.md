# AI-8804 Ghost-Recovery / Reactivation Campaign — Worker-1 Plan

## Goal
Build backend of the ghost-recovery reactivation campaign. Ghosted matches sit
abandoned today; after this PR the state machine will attempt low-pressure
reactivation N days after ghosting, routed through the existing Phase E
sanitizer pipeline.

## Files to Touch (in order)

1. **`supabase/migrations/20260427200000_phase_g2_reactivation.sql`** — additive
   migration: `reactivation_count`, `last_reactivation_at`,
   `reactivation_eligible_at`, `reactivation_outcome`, `reactivation_disabled` +
   one partial index on `clapcheeks_matches`.

2. **`agent/clapcheeks/followup/drip.py`** — extend `DEFAULT_CADENCE` with
   reactivation keys; add 3 state constants and 2 `DripAction.kind` values;
   add reactivation arm to `evaluate_conversation_state`; extend
   `queue_drip_action` and `scan_and_fire` to handle new kinds; extend
   `_patch_match` helpers.

3. **`agent/clapcheeks/followup/reactivation.py`** — new file: pure
   prompt-builder function. Takes (stage_when_died, memo_text, persona) and
   returns a reactivation prompt. Templates pulled from
   `persona.reactivation.templates_by_stage`, NOT hardcoded.

4. **`agent/tests/test_drip_state_machine.py`** — add 4 state-machine tests +
   1 sanitizer regression test:
   - 14d ghosted → `queue_reactivation`
   - 14d ghosted + `reactivation_disabled=True` → noop
   - 2 attempts exhausted → `mark_reactivation_burned`
   - reply after reactivation → conversing (state machine exits ghosted arm)
   - sanitizer rejects "hey stranger", "long time no talk", "did i do something wrong"

## Out of Scope for This PR
- UI pills / chips / history panel
- Approval flow wiring to `pending_approvals`
- ML learner feedback (Phase H)

## Key Design Decisions
- State machine remains a pure function — no Supabase calls
- Reactivation drafts ALWAYS route through `drafter.run_pipeline` (Phase E)
- Templates in persona JSON, not hardcoded strings
- `reactivation_disabled` is a hard opt-out per match (user or operator sets it)
- `reactivation_count` is capped by `reactivation_max_attempts` (default 2)
- `quiet_window` prevents re-ghosting immediately after failed reactivation
