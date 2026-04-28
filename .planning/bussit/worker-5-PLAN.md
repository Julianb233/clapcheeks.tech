# Worker-5 Plan: AI-8808 Reactions, Tapbacks, iMessage Effects + BlueBubbles Adapter

## Research Findings

### BlueBubbles API
- REST endpoint: `POST /api/v1/message/react` with `{chatGuid, selectedMessageGuid, reaction}`
- REST endpoint: `POST /api/v1/message/text` with `{effectId}` field for screen effects
- Server requires BlueBubbles Helper plugin for tapbacks (Private API plugin)
- Auth via `?password=` query param or `Authorization: Basic base64(password)` header
- WebSocket at `ws://{host}/socket.io/?v=1&password=...` for inbound events

### Decision Record
BlueBubbles chosen over alternatives:
- ~~osascript~~: AppleScript `Messages.app` has NO tapback or effect API. Cannot send tapbacks.
- ~~Private MMSv4~~: Requires jailbroken device + Frida injection. High security risk, unsupported.
- ~~MSMessageLiveLayout~~: Not available in Messages.app context. iOS iMessage extension API only.
- **BlueBubbles Server**: Well-documented REST API, community-maintained, no jailbreak required.
  Requires BlueBubbles Server app on Mac + Helper plugin for tapbacks. This is the correct path.

### Per-Platform Native APIs
- **Tinder**: No public API for reactions. The native iOS app uses likes but no message reactions.
  `NotImplementedError` stub — document as AI-8808 followup.
- **Hinge**: `POST /prompts/{promptId}/like` for prompt-like (react to opener prompt).
  Message reactions: no documented public API → `NotImplementedError` stub.
- **Bumble**: No reaction API documented → `NotImplementedError` stub + log.
- **Instagram DM**: `POST /api/v1/direct_v2/threads/{thread_id}/items/{item_id}/like/` (private API).
  Implemented with NotImplementedError stub noting the endpoint (IG aggressively rate-limits).

## Implementation Plan

### 1. Migration `20260428030000_reactions_and_bluebubbles.sql`
- Add `reactions JSONB DEFAULT '[]'::jsonb` to `clapcheeks_match_messages` (IF table exists)
- Add `effect_id TEXT` to same
- Add `bluebubbles_url TEXT` to `clapcheeks_user_settings`
- Add `bluebubbles_password bytea` (encrypted, same AES-GCM wire format as other *_enc columns)
- NOTE: Since `clapcheeks_match_messages` doesn't appear to exist yet, we add columns only IF
  table already exists (not create it — that's separate concern). Use conditional DDL.

### 2. `agent/clapcheeks/imessage/bluebubbles.py`
- `TapbackKind(Enum)` — LOVE/LIKE/DISLIKE/LAUGH/EMPHASIZE/QUESTION + REMOVE_* variants
- `EFFECT_IDS` constants dict
- `BlueBubblesClient(url, password)` — REST via requests
- `send_text(handle, body, effect_id=None) -> SendResult`
- `send_tapback(target_message_guid, kind) -> SendResult`
- `connect_ws() / iter_events()` — scaffolded stubs for inbound events

### 3. Extend `agent/clapcheeks/imessage/sender.py`
- `send_tapback(phone, target_msg_guid, kind)` — routes through BB if configured
- `send_with_effect(phone, body, effect_id)` — routes through BB if configured
- Keep `send_imessage()` unchanged

### 4. Platform reaction stubs
- `tinder_api.py`: `send_reaction(match_id, target_message_id, kind)` → NotImplementedError
- `hinge_api.py`: same → NotImplementedError
- `bumble.py`: same → log no-op
- Instagram: find the file, add `send_dm_like(thread_id, item_id)` with endpoint documented

### 5. Tests
- `tests/test_bluebubbles_client.py` — mock REST+WS, assert request shapes for tapback+effect
- `tests/test_imessage_sender_tapbacks.py` — routing logic with BB configured vs not

## File Checklist
- [ ] `.planning/bussit/worker-5-PLAN.md` (this file)
- [ ] `supabase/migrations/20260428030000_reactions_and_bluebubbles.sql`
- [ ] `agent/clapcheeks/imessage/bluebubbles.py`
- [ ] `agent/clapcheeks/imessage/sender.py` (extended)
- [ ] `agent/clapcheeks/platforms/tinder_api.py` (reaction stub)
- [ ] `agent/clapcheeks/platforms/hinge_api.py` (reaction stub)
- [ ] `agent/clapcheeks/platforms/bumble.py` (reaction stub)
- [ ] Instagram reaction stub (find right file)
- [ ] `agent/tests/test_bluebubbles_client.py`
- [ ] `agent/tests/test_imessage_sender_tapbacks.py`
