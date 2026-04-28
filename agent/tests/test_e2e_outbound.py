"""Integration test for E2E outbound iMessage + chat.db verification — AI-8743.

This test is SKIPPED in CI. It requires:
  - Running on a Mac with ~/Library/Messages/chat.db
  - Full Disk Access granted to Python
  - god mac send available OR osascript (Messages.app running)
  - RUN_E2E=1 environment variable set

To run on Mac Mini after deploy:
    RUN_E2E=1 pytest agent/tests/test_e2e_outbound.py -v -s

Or via god mac exec:
    god mac exec "cd ~/.clapcheeks && RUN_E2E=1 python -m pytest tests/test_e2e_outbound.py -v -s"
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Guard — skip entirely outside Mac + RUN_E2E=1
# ---------------------------------------------------------------------------

_RUN_E2E = os.getenv("RUN_E2E", "").lower() in ("1", "true", "yes")

pytestmark = pytest.mark.skipif(
    not _RUN_E2E,
    reason="E2E test requires Mac chat.db + RUN_E2E=1 env var",
)

TARGET_PHONE = "+16199919355"
CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"


@pytest.mark.manual
class TestE2EOutboundSendVerify:
    """Full send + verify cycle against the target number.

    Marked @pytest.mark.manual so it can be filtered separately:
        pytest -m manual agent/tests/test_e2e_outbound.py
    """

    def test_send_and_verify_via_chat_db(self):
        """Send one iMessage and verify delivery in chat.db within 10s."""
        from clapcheeks.imessage.sender import send_imessage
        from clapcheeks.imessage.chatdb_verifier import verify_outbound_sent

        # Pre-flight checks
        if not CHAT_DB.exists():
            pytest.skip(f"chat.db not found at {CHAT_DB}")

        # Generate unique nonce so even re-runs don't clash
        nonce = f"CC-E2E-{uuid.uuid4().hex[:8]}"
        body = f"Clapcheeks E2E test [{nonce}]"

        # --- SEND ---
        result = send_imessage(TARGET_PHONE, body, dry_run=False)
        assert result.ok, (
            f"send_imessage failed: channel={result.channel} error={result.error}"
        )

        # --- VERIFY ---
        verify = verify_outbound_sent(TARGET_PHONE, nonce, timeout=10.0)
        assert verify.found, (
            f"FAIL — nonce {nonce!r} not found in chat.db within 10s. "
            f"error={verify.error}"
        )

        # Surface the proof for Linear/log
        print(
            f"\nPASS — chat.db ROWID={verify.rowid} "
            f"handle={verify.handle} "
            f"nonce={nonce}"
        )

    def test_dry_run_does_not_send(self):
        """Dry-run send should return ok=True via noop channel without chat.db."""
        from clapcheeks.imessage.sender import send_imessage

        nonce = f"CC-E2E-{uuid.uuid4().hex[:8]}"
        body = f"DRY RUN [{nonce}]"

        result = send_imessage(TARGET_PHONE, body, dry_run=True)
        assert result.ok is True
        assert result.channel == "noop"
