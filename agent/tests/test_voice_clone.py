"""Tests for clapcheeks.voice.clone — chat.db scanner + style digest.

AI-8763.

We stub chat.db with an in-memory sqlite that mirrors the relevant
schema (message + handle), seed a known set of outbound rows, and
assert the digest structure + sane numeric values.
"""
from __future__ import annotations

import datetime as _dt
import sqlite3
from pathlib import Path

import pytest

from clapcheeks.voice.clone import (
    DIGEST_PATH,
    compute_style_digest,
    extract_text_from_attributedbody,
    load_digest,
    save_digest,
    scan_operator_sends,
)


# ---------------------------------------------------------------------------
# chat.db fixture
# ---------------------------------------------------------------------------


def _build_chat_db(tmp_path: Path, rows: list[dict]) -> Path:
    """Construct a minimal chat.db-shaped sqlite at tmp_path/chat.db."""
    db_path = tmp_path / "chat.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE handle (
            ROWID INTEGER PRIMARY KEY,
            id TEXT
        );
        CREATE TABLE message (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            attributedBody BLOB,
            is_from_me INTEGER NOT NULL,
            date INTEGER NOT NULL,
            handle_id INTEGER
        );
        """
    )
    handles = [
        (1, "+14154718553"),
        (2, "+17084661102"),
        (3, "+16194029514"),
    ]
    conn.executemany("INSERT INTO handle (ROWID, id) VALUES (?, ?)", handles)

    apple_epoch = _dt.datetime(2001, 1, 1)

    for r in rows:
        ts = r["dt"]
        nanos = int((ts - apple_epoch).total_seconds() * 1e9)
        conn.execute(
            """
            INSERT INTO message (text, attributedBody, is_from_me, date, handle_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                r.get("text"),
                r.get("attributed_body"),
                1 if r["is_from_me"] else 0,
                nanos,
                r.get("handle_id"),
            ),
        )
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture
def chat_db(tmp_path: Path) -> Path:
    base = _dt.datetime(2026, 4, 27, 9, 0, 0)
    rows: list[dict] = []

    outbound_msgs = [
        "heyy hows it going",
        "lol that's so true",
        "yeah wanna grab coffee saturday",
        "omg same",
        "hahaha you're killing me 😂",
        "wanna meet up later this week?",
        "sounds good 👍",
        "im down for that",
        "sounds good 👍",
        "hey what's up?",
        "you free tonight?",
        "cool let's do it",
        "deadass that was wild",
        "lowkey im starving lol",
        "haha okay",
        "morning ☀️",
        "let me know when you're free",
        "yeah for sure",
        "tbh same",
        "lmao",
    ]
    for i, text in enumerate(outbound_msgs):
        rows.append({
            "text": text,
            "is_from_me": True,
            "dt": base + _dt.timedelta(hours=i),
            "handle_id": (i % 3) + 1,
        })

    rows.append({
        "text": "Loved “sounds good 👍”",
        "is_from_me": True,
        "dt": base + _dt.timedelta(days=1),
        "handle_id": 1,
    })

    for i in range(5):
        rows.append({
            "text": f"hey reply {i}",
            "is_from_me": False,
            "dt": base + _dt.timedelta(hours=i, minutes=30),
            "handle_id": (i % 3) + 1,
        })

    body_payload = b"\x07NSString\x01+yo this came from the attributedBody fallback"
    rows.append({
        "text": None,
        "attributed_body": body_payload,
        "is_from_me": True,
        "dt": base + _dt.timedelta(days=2),
        "handle_id": 2,
    })

    return _build_chat_db(tmp_path, rows)


# ---------------------------------------------------------------------------
# scan_operator_sends
# ---------------------------------------------------------------------------


class TestScanOperatorSends:
    def test_returns_only_outbound(self, chat_db: Path):
        msgs = scan_operator_sends(db_path=chat_db, limit=200)
        texts = [m["text"] for m in msgs]
        assert all(not t.startswith("Loved ") for t in texts)
        assert "yo this came from the attributedBody fallback" in " ".join(texts)
        assert not any(t.startswith("hey reply ") for t in texts)

    def test_returns_dicts_with_expected_keys(self, chat_db: Path):
        msgs = scan_operator_sends(db_path=chat_db, limit=10)
        assert msgs, "expected at least one outbound row"
        for m in msgs:
            assert set(m.keys()) >= {"text", "timestamp", "handle"}
            assert isinstance(m["text"], str) and m["text"]

    def test_handles_missing_db(self, tmp_path: Path):
        bogus = tmp_path / "does-not-exist.db"
        assert scan_operator_sends(db_path=bogus) == []


# ---------------------------------------------------------------------------
# extract_text_from_attributedbody
# ---------------------------------------------------------------------------


class TestAttributedBody:
    def test_returns_empty_for_none(self):
        assert extract_text_from_attributedbody(None) == ""

    def test_returns_empty_for_empty_bytes(self):
        assert extract_text_from_attributedbody(b"") == ""

    def test_pulls_string_after_marker(self):
        blob = b"\x00garbage\x00NSString\x01hello world payload\x00more"
        out = extract_text_from_attributedbody(blob)
        assert "hello world payload" in out

    def test_handles_unicode(self):
        blob = b"NSString\x01don\xe2\x80\x99t worry"
        out = extract_text_from_attributedbody(blob)
        assert "don" in out and "t worry" in out


# ---------------------------------------------------------------------------
# compute_style_digest
# ---------------------------------------------------------------------------


class TestComputeStyleDigest:
    def test_empty_input_returns_empty_digest(self):
        d = compute_style_digest([])
        assert d["message_count"] == 0
        assert d["sample_messages"] == []
        assert d["avg_length_chars"] == 0.0
        for k in (
            "median_length_chars", "emoji_per_message", "most_common_openers",
            "common_phrases", "slang_dictionary", "time_of_day_clusters",
            "computed_at",
        ):
            assert k in d

    def test_full_digest_shape(self, chat_db: Path):
        msgs = scan_operator_sends(db_path=chat_db, limit=200)
        d = compute_style_digest(msgs)

        assert d["message_count"] >= 15
        assert d["avg_length_chars"] > 0
        assert isinstance(d["median_length_chars"], int)
        assert 0.0 <= d["emoji_per_message"] <= 1.0
        assert isinstance(d["most_common_openers"], list)
        assert isinstance(d["common_phrases"], list)
        assert isinstance(d["slang_dictionary"], list)
        assert isinstance(d["time_of_day_clusters"], dict)
        assert len(d["time_of_day_clusters"]) == 24
        assert isinstance(d["sample_messages"], list)
        assert d["computed_at"].endswith("Z")

    def test_emoji_ratio_picks_up_emoji_messages(self, chat_db: Path):
        msgs = scan_operator_sends(db_path=chat_db, limit=200)
        d = compute_style_digest(msgs)
        assert d["emoji_per_message"] > 0

    def test_slang_dictionary_picks_up_lol_lmao(self, chat_db: Path):
        msgs = scan_operator_sends(db_path=chat_db, limit=200)
        d = compute_style_digest(msgs)
        assert "lol" in d["slang_dictionary"]

    def test_sample_messages_dedupes_and_caps(self, chat_db: Path):
        msgs = scan_operator_sends(db_path=chat_db, limit=200)
        d = compute_style_digest(msgs)
        samples = d["sample_messages"]
        assert len(samples) <= 50
        normalized = [s.lower().strip() for s in samples]
        assert len(normalized) == len(set(normalized))


# ---------------------------------------------------------------------------
# save_digest / load_digest round trip
# ---------------------------------------------------------------------------


class TestPersistence:
    def test_save_and_load_round_trip(self, tmp_path: Path):
        target = tmp_path / "voice-profile.json"
        digest = {
            "message_count": 7,
            "avg_length_chars": 24.3,
            "median_length_chars": 22,
            "emoji_per_message": 0.14,
            "most_common_openers": ["hey", "yo"],
            "common_phrases": ["wanna grab coffee"],
            "slang_dictionary": ["lol"],
            "time_of_day_clusters": {str(h): 0 for h in range(24)},
            "sample_messages": ["heyy hows it going"],
            "computed_at": "2026-04-27T19:30:00Z",
        }
        path = save_digest(digest, path=target)
        assert path == target
        assert target.exists()
        roundtrip = load_digest(path=target)
        assert roundtrip == digest

    def test_load_returns_none_when_missing(self, tmp_path: Path):
        assert load_digest(path=tmp_path / "missing.json") is None

    def test_load_returns_none_on_corrupt_file(self, tmp_path: Path):
        bad = tmp_path / "corrupt.json"
        bad.write_text("{ this is not valid json")
        assert load_digest(path=bad) is None

    def test_default_digest_path_under_clapcheeks(self):
        assert DIGEST_PATH.name == "voice-profile.json"
        assert DIGEST_PATH.parent.name == ".clapcheeks"
