"""chat.db outbound delivery verifier — AI-8743.

Implements the verification standard from .claude/rules/comms-must-be-verified.md:
  "Query ~/Library/Messages/chat.db for is_sent=1 with a unique marker in
  text OR attributedBody BLOB within 10s of send."

macOS 11+ stores message text in the attributedBody NSKeyedArchiver BLOB
instead of (or in addition to) the legacy text column. We scan both.

Usage:
    nonce = "CC-E2E-a1b2c3d4"
    result = verify_outbound_sent("+16199919355", nonce, timeout=10)
    if result.found:
        print(f"PASS — chat.db ROWID={result.rowid} handle={result.handle}")
    else:
        print("FAIL — nonce not found within timeout")
"""
from __future__ import annotations

import logging
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("clapcheeks.imessage.chatdb_verifier")

IMESSAGE_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"

# Poll interval in seconds while waiting for delivery confirmation.
_POLL_INTERVAL = 0.5


@dataclass
class VerifyResult:
    """Result from verify_outbound_sent()."""
    found: bool
    rowid: int | None = None
    handle: str | None = None
    error: str | None = None


def _normalize_phone(phone: str) -> list[str]:
    """Return E.164 variants to match against chat.db handle.id.

    chat.db stores handles in varying forms:
    - "+16195551234" (E.164, iMessage)
    - "+16195551234" or "16195551234" (SMS)
    We generate both with and without the leading + so we match either.
    """
    stripped = phone.strip()
    variants = [stripped]
    if stripped.startswith("+"):
        variants.append(stripped[1:])          # without leading +
    else:
        variants.append("+" + stripped)        # with leading +
    return variants


def _extract_nonce_from_attributedbody(blob: bytes | memoryview | None, nonce: str) -> bool:
    """Return True if `nonce` appears (as ASCII) in the attributedBody BLOB.

    NSKeyedArchiver BLOBs are binary plists. Rather than depend on plistlib
    (which is fragile across OS versions), we scan raw bytes for the ASCII
    encoding of the nonce — the nonce is always pure ASCII so this is safe
    and exact.

    The nonce will appear as plain UTF-8 / ASCII bytes somewhere in the
    serialised string data. Even if embedded in the NSArchive framing, the
    string bytes will be present verbatim.
    """
    if not blob:
        return False
    if isinstance(blob, memoryview):
        blob = bytes(blob)
    nonce_bytes = nonce.encode("ascii")
    return nonce_bytes in blob


def verify_outbound_sent(
    phone: str,
    nonce: str,
    timeout: float = 10.0,
    db_path: Path | str | None = None,
) -> VerifyResult:
    """Poll chat.db until a sent message containing `nonce` appears.

    Checks rows where:
    - handle.id matches the target phone (with/without leading +)
    - is_sent = 1
    - nonce found in text column OR attributedBody BLOB

    Polls every 0.5 s up to `timeout` seconds. On the Mac Mini this
    typically resolves within 1-3 s after the send completes.

    Args:
        phone: Target phone number in E.164 format (+16199919355).
        nonce: Unique string embedded in the message body (e.g. "CC-E2E-a1b2c3d4").
        timeout: Max seconds to wait (default 10).
        db_path: Override chat.db path (for testing).

    Returns:
        VerifyResult with found=True and rowid/handle on success.
        VerifyResult with found=False and error on failure or timeout.
    """
    path = Path(db_path) if db_path else IMESSAGE_DB_PATH

    if not path.exists():
        return VerifyResult(
            found=False,
            error=f"chat.db not found at {path} (not on Mac or FDA not granted)",
        )

    phone_variants = _normalize_phone(phone)
    placeholders = ",".join("?" * len(phone_variants))
    query = f"""
        SELECT m.ROWID, m.text, m.attributedBody, h.id
        FROM message m
        JOIN handle h ON m.handle_id = h.ROWID
        WHERE h.id IN ({placeholders})
          AND m.is_sent = 1
        ORDER BY m.date DESC
        LIMIT 200
    """

    deadline = time.monotonic() + timeout
    nonce_bytes = nonce.encode("ascii")

    while time.monotonic() < deadline:
        try:
            conn = sqlite3.connect(
                f"file:{path}?mode=ro", uri=True, timeout=2.0
            )
            try:
                rows = conn.execute(query, phone_variants).fetchall()
            finally:
                conn.close()

            for rowid, text, attributed_body, handle in rows:
                # Check text column first (fast path, pre-macOS-11)
                if text and nonce in text:
                    return VerifyResult(found=True, rowid=rowid, handle=handle)
                # Check attributedBody BLOB (macOS 11+)
                if attributed_body and _extract_nonce_from_attributedbody(
                    attributed_body, nonce
                ):
                    return VerifyResult(found=True, rowid=rowid, handle=handle)

        except sqlite3.OperationalError as exc:
            log.debug("chat.db query error (will retry): %s", exc)
        except Exception as exc:  # noqa: BLE001
            log.warning("Unexpected chat.db error: %s", exc)
            return VerifyResult(found=False, error=f"unexpected error: {exc}")

        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(_POLL_INTERVAL, remaining))

    return VerifyResult(
        found=False,
        error=f"nonce {nonce!r} not found in chat.db within {timeout}s",
    )
