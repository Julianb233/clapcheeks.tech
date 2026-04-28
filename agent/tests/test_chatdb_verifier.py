"""Unit tests for clapcheeks.imessage.chatdb_verifier — AI-8743.

These tests run in CI without Mac hardware. They use a fake sqlite database
that mirrors the chat.db schema (message + handle tables).

The attributedBody BLOB tests use the same fake blob format established
in test_voice_clone.py: b"\x07NSString\x01+<text>" where the nonce
appears as plain ASCII bytes — the verifier scans raw bytes so this
is correctly detected.
"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from unittest import mock

import pytest

from clapcheeks.imessage import chatdb_verifier
from clapcheeks.imessage.chatdb_verifier import (
    VerifyResult,
    _extract_nonce_from_attributedbody,
    _normalize_phone,
    verify_outbound_sent,
)


# ---------------------------------------------------------------------------
# Helpers — fake chat.db builder
# ---------------------------------------------------------------------------

def _make_chat_db(
    path: Path,
    rows: list[dict],
) -> None:
    """Build a minimal chat.db schema and seed it with message rows.

    Each row dict:
        handle (str): phone number
        text (str|None): text column
        attributed_body (bytes|None): attributedBody BLOB
        is_sent (int): 1 = sent by us, 0 = received
    """
    conn = sqlite3.connect(str(path))
    conn.executescript(
        """
        CREATE TABLE handle (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT
        );
        CREATE TABLE message (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            handle_id INTEGER,
            is_sent INTEGER DEFAULT 0,
            is_from_me INTEGER DEFAULT 0,
            date INTEGER DEFAULT 0,
            text TEXT,
            attributedBody BLOB
        );
        """
    )
    handle_ids: dict[str, int] = {}
    for row in rows:
        handle = row["handle"]
        if handle not in handle_ids:
            cur = conn.execute("INSERT INTO handle (id) VALUES (?)", (handle,))
            handle_ids[handle] = cur.lastrowid

    for row in rows:
        conn.execute(
            """
            INSERT INTO message (handle_id, is_sent, is_from_me, date, text, attributedBody)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                handle_ids[row["handle"]],
                row.get("is_sent", 0),
                row.get("is_from_me", 0),
                row.get("date", 0),
                row.get("text"),
                row.get("attributed_body"),
            ),
        )
    conn.commit()
    conn.close()


@pytest.fixture
def fake_db(tmp_path: Path, monkeypatch) -> Path:
    """Return path to a fresh empty chat.db and monkeypatch IMESSAGE_DB_PATH."""
    db = tmp_path / "chat.db"
    _make_chat_db(db, [])
    monkeypatch.setattr(chatdb_verifier, "IMESSAGE_DB_PATH", db)
    return db


# ---------------------------------------------------------------------------
# _normalize_phone
# ---------------------------------------------------------------------------


class TestNormalizePhone:
    def test_e164_with_plus(self):
        variants = _normalize_phone("+16199919355")
        assert "+16199919355" in variants
        assert "16199919355" in variants

    def test_no_plus(self):
        variants = _normalize_phone("16199919355")
        assert "16199919355" in variants
        assert "+16199919355" in variants

    def test_both_variants_present(self):
        variants = _normalize_phone("+12025551234")
        assert len(variants) == 2


# ---------------------------------------------------------------------------
# _extract_nonce_from_attributedbody
# ---------------------------------------------------------------------------


class TestExtractNonceFromAttributedBody:
    NONCE = "CC-E2E-a1b2c3d4"

    def test_nonce_in_text_body(self):
        """Nonce appears as plain ASCII in blob — detected."""
        blob = b"\x07NSString\x01+" + self.NONCE.encode("ascii") + b" extra stuff"
        assert _extract_nonce_from_attributedbody(blob, self.NONCE) is True

    def test_nonce_not_in_blob(self):
        """Blob does not contain nonce — not detected."""
        blob = b"\x07NSString\x01+Hello world this is a message"
        assert _extract_nonce_from_attributedbody(blob, self.NONCE) is False

    def test_empty_blob_returns_false(self):
        assert _extract_nonce_from_attributedbody(b"", self.NONCE) is False

    def test_none_blob_returns_false(self):
        assert _extract_nonce_from_attributedbody(None, self.NONCE) is False

    def test_memoryview_blob(self):
        """memoryview input works the same as bytes."""
        blob = b"\x07NSString\x01+" + self.NONCE.encode("ascii")
        mv = memoryview(blob)
        assert _extract_nonce_from_attributedbody(mv, self.NONCE) is True

    def test_nonce_embedded_in_larger_message(self):
        """Nonce anywhere in blob body is found."""
        blob = (
            b"\x00\x01\x02binary\x07NSString\x01+Hey there! [CC-E2E-a1b2c3d4] check this"
            b"\x03\x04trailing junk"
        )
        assert _extract_nonce_from_attributedbody(blob, self.NONCE) is True

    def test_partial_nonce_not_matched(self):
        """Only a partial nonce present — not matched."""
        blob = b"\x07NSString\x01+CC-E2E-a1b2"  # truncated
        assert _extract_nonce_from_attributedbody(blob, self.NONCE) is False


# ---------------------------------------------------------------------------
# verify_outbound_sent — text column path
# ---------------------------------------------------------------------------


class TestVerifyOutboundSentTextColumn:
    PHONE = "+16199919355"
    NONCE = "CC-E2E-deadbeef"

    def _db_with_row(
        self, tmp_path: Path, is_sent: int, text: str | None = None, ab: bytes | None = None
    ) -> Path:
        db = tmp_path / "chat.db"
        _make_chat_db(db, [
            {
                "handle": self.PHONE,
                "is_sent": is_sent,
                "text": text,
                "attributed_body": ab,
                "date": 1000000,
            }
        ])
        return db

    def test_nonce_in_text_column_is_found(self, tmp_path):
        db = self._db_with_row(tmp_path, is_sent=1, text=f"Hello [{self.NONCE}]")
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=1.0, db_path=db)
        assert result.found is True
        assert result.rowid is not None
        assert result.handle == self.PHONE

    def test_is_sent_zero_not_matched(self, tmp_path):
        """is_sent=0 (received message) should NOT match."""
        db = self._db_with_row(tmp_path, is_sent=0, text=f"Hello [{self.NONCE}]")
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=0.6, db_path=db)
        assert result.found is False

    def test_wrong_nonce_not_matched(self, tmp_path):
        db = self._db_with_row(tmp_path, is_sent=1, text="Hello [CC-E2E-wrongnonce]")
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=0.6, db_path=db)
        assert result.found is False

    def test_wrong_phone_not_matched(self, tmp_path):
        """Nonce present but wrong handle — no match."""
        db = tmp_path / "chat.db"
        _make_chat_db(db, [
            {
                "handle": "+10000000000",  # different phone
                "is_sent": 1,
                "text": f"Hello [{self.NONCE}]",
                "date": 1000000,
            }
        ])
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=0.6, db_path=db)
        assert result.found is False

    def test_phone_without_plus_matches(self, tmp_path):
        """Handle stored without leading + still matches."""
        db = tmp_path / "chat.db"
        # Store handle as "16199919355" (no +)
        _make_chat_db(db, [
            {
                "handle": "16199919355",  # no leading +
                "is_sent": 1,
                "text": f"Hello [{self.NONCE}]",
                "date": 1000000,
            }
        ])
        result = verify_outbound_sent("+16199919355", self.NONCE, timeout=1.0, db_path=db)
        assert result.found is True

    def test_missing_db_returns_error(self, tmp_path):
        missing = tmp_path / "does-not-exist.db"
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=0.5, db_path=missing)
        assert result.found is False
        assert result.error is not None
        assert "not found" in result.error.lower()

    def test_timeout_returns_false(self, tmp_path):
        """Empty db — polling times out and returns found=False."""
        db = tmp_path / "chat.db"
        _make_chat_db(db, [])
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=0.3, db_path=db)
        assert result.found is False


# ---------------------------------------------------------------------------
# verify_outbound_sent — attributedBody BLOB path (macOS 11+)
# ---------------------------------------------------------------------------


class TestVerifyOutboundSentAttributedBody:
    PHONE = "+16199919355"
    NONCE = "CC-E2E-cafebabe"

    def _db_with_blob_row(self, tmp_path: Path, blob: bytes) -> Path:
        db = tmp_path / "chat.db"
        _make_chat_db(db, [
            {
                "handle": self.PHONE,
                "is_sent": 1,
                "text": None,          # no text column
                "attributed_body": blob,
                "date": 2000000,
            }
        ])
        return db

    def test_nonce_in_attributedbody_is_found(self, tmp_path):
        """text=NULL, nonce in attributedBody BLOB — should PASS."""
        blob = (
            b"\x62\x70\x6c\x69\x73\x74\x00\x00"  # fake bplist magic
            b"\x07NSString\x01+"
            + f"Hey this is a test [{self.NONCE}] ok".encode("ascii")
        )
        db = self._db_with_blob_row(tmp_path, blob)
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=1.0, db_path=db)
        assert result.found is True
        assert result.rowid is not None

    def test_empty_blob_not_matched(self, tmp_path):
        """Empty attributedBody — not matched (nonce never present)."""
        db = self._db_with_blob_row(tmp_path, b"")
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=0.5, db_path=db)
        assert result.found is False

    def test_blob_without_nonce_not_matched(self, tmp_path):
        """Blob that doesn't contain the nonce — no match."""
        blob = b"\x07NSString\x01+Some other message entirely no nonce here"
        db = self._db_with_blob_row(tmp_path, blob)
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=0.5, db_path=db)
        assert result.found is False

    def test_text_column_takes_precedence(self, tmp_path):
        """Both text and attributedBody present — text with nonce wins."""
        nonce_in_text = self.NONCE
        blob_without_nonce = b"\x07NSString\x01+something else"
        db = tmp_path / "chat.db"
        _make_chat_db(db, [
            {
                "handle": self.PHONE,
                "is_sent": 1,
                "text": f"msg [{nonce_in_text}]",
                "attributed_body": blob_without_nonce,
                "date": 3000000,
            }
        ])
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=1.0, db_path=db)
        assert result.found is True

    def test_realistic_nsarchiver_blob_format(self, tmp_path):
        """Simulate macOS 11+ NSKeyedArchiver BLOB containing the nonce."""
        # Mirrors the BLOB format from test_voice_clone.py fixture
        nonce = self.NONCE
        blob = b"\x07NSString\x01+" + nonce.encode("ascii")
        db = self._db_with_blob_row(tmp_path, blob)
        result = verify_outbound_sent(self.PHONE, self.NONCE, timeout=1.0, db_path=db)
        assert result.found is True
