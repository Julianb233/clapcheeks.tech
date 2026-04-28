# Worker-6 Plan — AI-8809 Realtime + AI Toggle

## Objective
1. Supabase Realtime subscription on `clapcheeks_match_messages` → live updates + push via AI-8772 path
2. Master "AI Active" toggle (per-user + per-match override) that pauses ALL agent autonomy when OFF

## Layers (in order)

### Layer 1: Migration `20260428040000_realtime_and_ai_gate.sql`
- ALTER `clapcheeks_user_settings` to add `ai_active`, `ai_paused_until`, `ai_paused_reason`
- ALTER `clapcheeks_matches` to add `ai_active`
- CREATE VIEW `clapcheeks_ai_effective_state`
- ALTER PUBLICATION to add `clapcheeks_match_messages` (wrapped in exception block)
- Postgres trigger on `clapcheeks_match_messages` AFTER INSERT WHERE direction='incoming'

### Layer 2: Backend AI gate — `agent/clapcheeks/autonomy/gate.py`
- `is_ai_active(supabase, user_id, match_id) -> bool`
- Checks the `clapcheeks_ai_effective_state` view

### Layer 3: Call-site gates
- `agent/clapcheeks/followup/drip.py::evaluate_conversation_state` — bail to STATE_NOOP
- `agent/clapcheeks/ai/drafter.py::run_pipeline` — return early
- `agent/clapcheeks/imessage/sender.py::send_imessage` — refuse + log "ai_paused"
- Platform senders (find via grep)

### Layer 4: Tests
- `agent/tests/test_ai_gate.py` — all gate combinations
- `agent/tests/test_drip_respects_gate.py` — drip noop when gate False
- `agent/tests/test_sender_respects_gate.py` — sender refusal when gate False

### Layer 5: Web realtime hooks — `web/lib/realtime/messages.ts`
- `useMatchMessages(matchId)` — Supabase Realtime filtered by match_id
- `useInboxStream(userId)` — fans out new her-messages

### Layer 6: Web AI toggle UI
- `web/components/header/AiActiveSwitch.tsx` — big toggle in sidebar
- `web/components/matches/AiActiveSwitchPerMatch.tsx` — per-match override
- `web/components/header/AiActiveBanner.tsx` — paused banner

### Layer 7: Header wiring
- Wire `AiActiveSwitch` into app-sidebar (at bottom of user section)
- Wire `AiActiveBanner` into `(main)/layout.tsx`

## Constraints
- DO NOT touch `web/components/matches/ConversationThread.tsx`
- DO NOT touch `agent/clapcheeks/imessage/bluebubbles.py`
- DO NOT modify `agent/clapcheeks/followup/reactivation.py` except TOP gate check
- DO NOT push to main
- Migration slot: `20260428040000_*`
