# Worker-3 Plan — AI-8743 E2E Outbound Test

## Objective
Add `clapcheeks send-test +PHONE --body "..."` CLI subcommand that sends one iMessage and verifies delivery against `chat.db` per `.claude/rules/comms-must-be-verified.md`.

## Analysis

### Production Send Path
`clapcheeks/imessage/sender.py:send_imessage()` is the canonical path:
1. Normalizes phone to E.164 via `to_e164_us()`
2. P3: chat.db recheck (abort if operator just typed)
3. Tries `god mac send` first (god CLI)
4. Falls back to `osascript` (direct Mac Messages)

### chat.db Verification Requirements (per comms-must-be-verified.md)
- Query `~/Library/Messages/chat.db` for `is_sent=1`
- Check BOTH `text` column AND `attributedBody` BLOB (newer macOS)
- `attributedBody` is NSKeyedArchiver BLOB — scan raw bytes for ASCII nonce
- Existing helper: `clapcheeks/voice/clone.py:extract_text_from_attributedbody()`

### Key Observations
- `voice/clone.py` already has `extract_text_from_attributedbody()` — reuse this
- `tests/test_voice_clone.py` shows the fake BLOB pattern: `b"\x07NSString\x01+<text>"`
- `tests/test_sender_p3_p4.py` shows the monkeypatching pattern for chat.db

## Implementation Plan

### Layer 1: `clapcheeks/imessage/chatdb_verifier.py` (new module)
- `verify_outbound_sent(phone, nonce, timeout=10, db_path=None)` function
- Polls chat.db every 0.5s for up to `timeout` seconds
- Checks rows where `is_sent=1` and handle matches phone
- Scans both `text` column and `attributedBody` BLOB for nonce
- Returns `VerifyResult(found=bool, rowid=int|None, handle=str|None)`
- Reuses `extract_text_from_attributedbody()` from voice/clone.py

### Layer 2: `clapcheeks/commands/send_test.py` (new CLI command)
- `clapcheeks send-test +PHONE --body "..." [--timeout N]`
- Generates nonce: `f"CC-E2E-{uuid.uuid4().hex[:8]}"`
- Builds full body: `f"{body} {nonce}"` (nonce appended)
- Calls `send_imessage(phone, full_body)` — the production path
- Calls `verify_outbound_sent(phone, nonce, timeout)` to verify
- Prints PASS with chat.db ROWID and handle on success
- Prints FAIL with channel + error on failure
- Exits 0 on PASS, 1 on FAIL

### Layer 3: Wire into `cli.py`
- `from clapcheeks.commands.send_test import send_test`
- `main.add_command(send_test)`

### Layer 4: `agent/tests/test_chat_db_verifier.py` (unit tests)
- Test with fake SQLite that has `is_sent=1` and nonce in `text` column
- Test with `text=None` and nonce embedded in fake `attributedBody` BLOB
- Test timeout behavior (nonce not found → returns `found=False`)
- Test phone normalization (+/no-+ variants)
- All tests run in CI without Mac

### Layer 5: `agent/tests/test_outbound_e2e.py` (integration test, skip-on-CI)
- `@pytest.mark.skipif(not os.getenv('RUN_E2E'), reason='E2E test requires Mac chat.db')`
- Full send + verify cycle against +16199919355
- Manual run on Mac Mini after merge

## Files to Create/Modify
1. **NEW** `agent/clapcheeks/imessage/chatdb_verifier.py`
2. **NEW** `agent/clapcheeks/commands/send_test.py`
3. **MODIFY** `agent/clapcheeks/cli.py` — add `send_test` command
4. **NEW** `agent/tests/test_chat_db_verifier.py`
5. **NEW** `agent/tests/test_outbound_e2e.py`
6. **NEW** `.planning/bussit/worker-3-PLAN.md` (this file)
