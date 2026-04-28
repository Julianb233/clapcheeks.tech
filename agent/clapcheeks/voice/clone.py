"""Voice cloning from operator's past chat.db sends.

AI-8763. Top-10 research item: the cheapest, biggest reduction in
"AI voice" tells comes from few-shot prompting Ollama with the operator's
ACTUAL past iMessage outbound text. We compute a style digest locally
(chars, emoji ratio, openers, common phrases, time-of-day clusters) and
keep a curated set of representative sample messages on disk for use as
{role: "assistant"} few-shot examples in ai_reply.py.

Design notes
------------
- Read-only chat.db access. We never write to chat.db.
- We never exfiltrate raw message text. Only the digest (which by design
  contains a small curated sample set the operator approves) is uploaded
  to Supabase; the raw 5k-message scan stays on the Mac in
  ~/.clapcheeks/voice-profile.json.
- attributedBody decoding: newer macOS stores message text in the
  attributedBody NSKeyedArchiver blob, not the legacy text column. We
  decode it best-effort with stdlib only — no plistlib magic that breaks
  across OS versions, just a tolerant byte-scan that pulls the longest
  printable run after the NSString marker. Falls back to the text column
  when present.
- The digest schema is intentionally JSON-serialisable so the same payload
  round-trips cleanly into Supabase JSONB and back into the Ollama prompt.
- This module complements (not replaces) clapcheeks.imessage.voice.VoiceAnalyzer
  and clapcheeks.nlp.style_analyzer — those continue to feed the existing
  style_prompt path. The digest adds belt-and-suspenders few-shot examples.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import re
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Iterable

log = logging.getLogger(__name__)

CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"
DIGEST_DIR = Path.home() / ".clapcheeks"
DIGEST_PATH = DIGEST_DIR / "voice-profile.json"

# Emoji detection — same shape as imessage/voice.py to stay consistent.
_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"   # emoticons
    "\U0001F300-\U0001F5FF"   # symbols & pictographs
    "\U0001F680-\U0001F6FF"   # transport & map
    "\U0001F1E0-\U0001F1FF"   # regional flags
    "\U0001F900-\U0001F9FF"   # supplemental symbols
    "\U0001FA70-\U0001FAFF"   # symbols & pictographs extended-A
    "☀-➿"            # misc symbols / dingbats
    "]"
)

# iMessage / chat.db reactions and tapback markers we strip from outbound.
_REACTION_PREFIXES = (
    "Loved “",
    "Liked “",
    "Disliked “",
    "Laughed at “",
    "Emphasized “",
    "Questioned “",
    "Removed a heart from “",
    "Removed a like from “",
    "Removed a laugh from “",
    "Reacted ",
)

# Cocoa epoch (chat.db dates are nanoseconds since 2001-01-01).
_APPLE_EPOCH = _dt.datetime(2001, 1, 1)


# ---------------------------------------------------------------------------
# attributedBody best-effort decode (stdlib only, OS-version tolerant)
# ---------------------------------------------------------------------------

_NSSTRING_MARKER = b"NSString"


def extract_text_from_attributedbody(blob: bytes | memoryview | None) -> str:
    """Pull the message body text out of an attributedBody NSArchiver blob.

    macOS started moving message text out of `message.text` and into
    `message.attributedBody` (an NSKeyedArchiver-encoded NSAttributedString)
    around macOS 11. We don't need the rich attributes — just the body
    string. The blob layout puts the actual NSString payload after a
    `NSString` class marker, prefixed by a length byte (or short / long
    form). Rather than reach for plistlib (whose archive parsing is
    fragile across versions), we scan for the marker and pull the longest
    printable run that follows.

    Returns "" if no body text could be recovered.
    """
    if not blob:
        return ""
    if isinstance(blob, memoryview):
        blob = bytes(blob)
    if not isinstance(blob, (bytes, bytearray)):
        return ""

    idx = blob.find(_NSSTRING_MARKER)
    if idx < 0:
        return _extract_longest_printable_run(blob)

    tail = blob[idx + len(_NSSTRING_MARKER): idx + len(_NSSTRING_MARKER) + 4096]
    return _extract_longest_printable_run(tail)


def _extract_longest_printable_run(buf: bytes, min_len: int = 2) -> str:
    """Scan a byte buffer for the longest UTF-8 printable run.

    We accept ASCII printables + UTF-8 multibyte sequences (covers emoji,
    smart quotes, etc.). This is intentionally tolerant — we'd rather pick
    up a slightly noisy string than crash on a malformed blob.
    """
    best = ""
    current_chars: list[str] = []

    def _flush() -> None:
        nonlocal best, current_chars
        if len(current_chars) >= min_len:
            candidate = "".join(current_chars).strip("\x00 \t\r\n")
            if len(candidate) > len(best):
                best = candidate
        current_chars = []

    i = 0
    while i < len(buf):
        b = buf[i]
        if 0x20 <= b < 0x7F:
            current_chars.append(chr(b))
            i += 1
            continue
        if 0xC2 <= b <= 0xF4:
            decoded_ok = False
            for length in (4, 3, 2):
                if i + length <= len(buf):
                    chunk = buf[i: i + length]
                    try:
                        decoded = chunk.decode("utf-8")
                        if all(_is_printable(c) for c in decoded):
                            current_chars.append(decoded)
                            i += length
                            decoded_ok = True
                            break
                    except UnicodeDecodeError:
                        continue
            if decoded_ok:
                continue
            _flush()
            i += 1
            continue
        _flush()
        i += 1
    _flush()
    return best


def _is_printable(ch: str) -> bool:
    if not ch:
        return False
    if ch in "\n\r\t":
        return True
    cp = ord(ch[0])
    if cp < 0x20:
        return False
    if 0x7F <= cp < 0xA0:
        return False
    return True


# ---------------------------------------------------------------------------
# chat.db scanner
# ---------------------------------------------------------------------------


def scan_operator_sends(
    limit: int = 5000,
    db_path: Path | str | None = None,
) -> list[dict]:
    """Return [{text, timestamp, handle}] from chat.db for is_from_me=1.

    Reads only the operator's outbound messages. Decodes attributedBody
    when text is NULL. Returns most recent first, up to `limit` rows.
    """
    path = Path(db_path) if db_path else CHAT_DB
    if not path.exists():
        log.warning("scan_operator_sends: chat.db not found at %s", path)
        return []

    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.OperationalError as exc:
        log.warning("scan_operator_sends: cannot open chat.db (%s)", exc)
        return []
    conn.row_factory = sqlite3.Row

    try:
        cursor = conn.execute(
            """
            SELECT
                m.text          AS text,
                m.attributedBody AS attributed_body,
                m.date          AS apple_date,
                h.id            AS handle_id
            FROM message m
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            WHERE m.is_from_me = 1
            ORDER BY m.date DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    except sqlite3.OperationalError as exc:
        log.warning("scan_operator_sends: query failed (%s)", exc)
        conn.close()
        return []

    out: list[dict] = []
    for row in rows:
        text = (row["text"] or "").strip()
        if not text:
            text = extract_text_from_attributedbody(row["attributed_body"])
        text = text.strip()
        if not text:
            continue
        if any(text.startswith(p) for p in _REACTION_PREFIXES):
            continue
        ts = _apple_ts_to_dt(row["apple_date"])
        out.append({
            "text": text,
            "timestamp": ts.isoformat() if ts else None,
            "handle": row["handle_id"] or "",
        })

    conn.close()
    return out


def _apple_ts_to_dt(ts: int | float | None) -> _dt.datetime | None:
    if ts is None or ts == 0:
        return None
    if ts > 1e11:
        seconds = ts / 1e9
    else:
        seconds = float(ts)
    try:
        return _APPLE_EPOCH + _dt.timedelta(seconds=seconds)
    except (OverflowError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Style digest
# ---------------------------------------------------------------------------


_OPENER_STOPWORDS = {
    "i", "the", "a", "an", "my", "this", "that", "you", "your",
}


def compute_style_digest(messages: list[dict]) -> dict:
    """Compute a JSON-serialisable style digest from outbound messages.

    Args:
        messages: list of {text, timestamp, handle} dicts (usually the
            output of scan_operator_sends()).

    Returns:
        dict with keys:
          - message_count
          - avg_length_chars
          - median_length_chars
          - emoji_per_message
          - most_common_openers
          - common_phrases
          - slang_dictionary
          - time_of_day_clusters
          - sample_messages
          - computed_at (iso8601, UTC, suffixed Z)
    """
    if not messages:
        return _empty_digest()

    texts: list[str] = []
    timestamps: list[_dt.datetime] = []
    for m in messages:
        t = (m.get("text") or "").strip()
        if not t:
            continue
        texts.append(t)
        ts = m.get("timestamp")
        if isinstance(ts, str):
            try:
                timestamps.append(_dt.datetime.fromisoformat(ts))
            except ValueError:
                pass
        elif isinstance(ts, _dt.datetime):
            timestamps.append(ts)

    if not texts:
        return _empty_digest()

    lengths = [len(t) for t in texts]
    avg_length = sum(lengths) / len(lengths)
    median_length = _median_int(lengths)

    emoji_msg_count = sum(1 for t in texts if _EMOJI_RE.search(t))
    emoji_per_message = emoji_msg_count / len(texts)

    opener_counter: Counter[str] = Counter()
    for t in texts:
        words = t.split()
        if not words:
            continue
        first = words[0].strip(".,!?:;\"'").lower()
        if not first or first in _OPENER_STOPWORDS:
            continue
        opener_counter[first] += 1
    most_common_openers = [w for w, _ in opener_counter.most_common(20)]

    ngram_counter: Counter[str] = Counter()
    for t in texts:
        words = [w.lower() for w in re.findall(r"[A-Za-z']+", t)]
        for n in (3, 4, 5):
            for i in range(len(words) - n + 1):
                phrase = " ".join(words[i: i + n])
                if 6 < len(phrase) < 60:
                    ngram_counter[phrase] += 1
    common_phrases = [p for p, c in ngram_counter.most_common(40) if c >= 3][:25]

    slang_candidates = [
        "lol", "lmao", "haha", "hahaha", "omg", "tbh", "ngl", "idk", "imo",
        "rn", "tho", "gonna", "wanna", "kinda", "yeah", "yea", "yo", "sup",
        "bruh", "bet", "vibes", "lowkey", "highkey", "deadass", "fr", "ong",
        "mood", "hella", "lit", "ick", "rizz", "slay", "bussin",
    ]
    joined_lower = " ".join(t.lower() for t in texts)
    padded = f" {joined_lower} "
    slang_dictionary = [s for s in slang_candidates if f" {s} " in padded]

    tod: Counter[int] = Counter()
    for ts in timestamps:
        tod[ts.hour] += 1
    time_of_day_clusters = {str(h): tod.get(h, 0) for h in range(24)}

    sample_messages = _pick_representative_samples(texts, n=50, avg_length=avg_length)

    return {
        "message_count": len(texts),
        "avg_length_chars": round(avg_length, 1),
        "median_length_chars": median_length,
        "emoji_per_message": round(emoji_per_message, 3),
        "most_common_openers": most_common_openers,
        "common_phrases": common_phrases,
        "slang_dictionary": slang_dictionary,
        "time_of_day_clusters": time_of_day_clusters,
        "sample_messages": sample_messages,
        "computed_at": _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }


def _empty_digest() -> dict:
    return {
        "message_count": 0,
        "avg_length_chars": 0.0,
        "median_length_chars": 0,
        "emoji_per_message": 0.0,
        "most_common_openers": [],
        "common_phrases": [],
        "slang_dictionary": [],
        "time_of_day_clusters": {str(h): 0 for h in range(24)},
        "sample_messages": [],
        "computed_at": _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }


def _median_int(values: list[int]) -> int:
    if not values:
        return 0
    s = sorted(values)
    mid = len(s) // 2
    if len(s) % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) // 2


def _pick_representative_samples(
    texts: list[str],
    n: int = 50,
    avg_length: float | None = None,
) -> list[str]:
    """Pick a deduplicated, length-balanced sample for few-shot prompting.

    Strategy:
      1. dedupe by lowercase normalized text
      2. drop too-short (<3 chars) and too-long (>240 chars) outliers
      3. round-robin pick from short / medium / long buckets so the LLM
         sees range, not just the modal length
    """
    seen: set[str] = set()
    unique: list[str] = []
    for t in texts:
        norm = re.sub(r"\s+", " ", t.lower()).strip()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        unique.append(t)

    cleaned = [t for t in unique if 3 <= len(t) <= 240]
    if not cleaned:
        return []

    if avg_length is None:
        avg_length = sum(len(t) for t in cleaned) / len(cleaned)

    short_cap = max(20, int(avg_length * 0.5))
    long_floor = int(avg_length * 1.5)

    short_bucket = [t for t in cleaned if len(t) <= short_cap]
    medium_bucket = [t for t in cleaned if short_cap < len(t) < long_floor]
    long_bucket = [t for t in cleaned if len(t) >= long_floor]

    out: list[str] = []
    buckets = [short_bucket, medium_bucket, long_bucket]
    bucket_indices = [0, 0, 0]
    while len(out) < n:
        added = False
        for b_i, bucket in enumerate(buckets):
            if bucket_indices[b_i] < len(bucket):
                out.append(bucket[bucket_indices[b_i]])
                bucket_indices[b_i] += 1
                added = True
                if len(out) >= n:
                    break
        if not added:
            break
    return out


# ---------------------------------------------------------------------------
# Disk persistence
# ---------------------------------------------------------------------------


def save_digest(digest: dict, path: Path | None = None) -> Path:
    """Persist digest JSON to ~/.clapcheeks/voice-profile.json (or override).

    Returns the path written to. Mirrors the 0600 perm pattern used by the
    rest of the agent for ~/.clapcheeks/.env.
    """
    target = Path(path) if path else DIGEST_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(digest, indent=2, ensure_ascii=False))
    try:
        target.chmod(0o600)
    except OSError:
        pass
    return target


def load_digest(path: Path | None = None) -> dict | None:
    """Return the persisted digest, or None if missing / unreadable."""
    target = Path(path) if path else DIGEST_PATH
    if not target.exists():
        return None
    try:
        return json.loads(target.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("load_digest: %s unreadable (%s)", target, exc)
        return None


# ---------------------------------------------------------------------------
# Convenience: scan + compute + save in one call (used by CLI)
# ---------------------------------------------------------------------------


def scan_and_save(
    limit: int = 5000,
    db_path: Path | str | None = None,
    out_path: Path | None = None,
) -> dict:
    """End-to-end: scan chat.db, compute digest, persist, return digest."""
    msgs = scan_operator_sends(limit=limit, db_path=db_path)
    digest = compute_style_digest(msgs)
    save_digest(digest, path=out_path)
    return digest


def push_digest_to_supabase(digest: dict, user_id: str | None = None) -> tuple[int, str]:
    """Best-effort upload of the digest to Supabase clapcheeks_voice_profiles.

    Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env (with
    web/.env.local fallback). user_id can come from CLAPCHEEKS_USER_ID
    env var if not supplied. Returns (http_status, body_text).
    """
    import os
    import urllib.error
    import urllib.request

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    user_id = user_id or os.environ.get("CLAPCHEEKS_USER_ID")

    if not (url and key):
        env_path = Path("/opt/agency-workspace/clapcheeks.tech/web/.env.local")
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if "=" not in line or line.startswith("#"):
                    continue
                k, _, v = line.partition("=")
                v = v.strip().strip('"').strip("'")
                if k.strip() == "NEXT_PUBLIC_SUPABASE_URL":
                    url = url or v
                if k.strip() == "SUPABASE_SERVICE_ROLE_KEY":
                    key = key or v

    if not (url and key and user_id):
        return 0, "missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CLAPCHEEKS_USER_ID"

    payload = {
        "user_id": user_id,
        "digest": digest,
        "messages_analyzed": digest.get("message_count", 0),
        "updated_at": _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }
    body = json.dumps(payload).encode()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    rest_url = url.rstrip("/") + "/rest/v1/clapcheeks_voice_profiles?on_conflict=user_id"
    req = urllib.request.Request(rest_url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(errors="replace")
    except urllib.error.URLError as exc:
        return 0, f"network error: {exc}"


__all__ = [
    "CHAT_DB",
    "DIGEST_PATH",
    "extract_text_from_attributedbody",
    "scan_operator_sends",
    "compute_style_digest",
    "save_digest",
    "load_digest",
    "scan_and_save",
    "push_digest_to_supabase",
]


def _iter_for_doctest() -> Iterable[str]:  # pragma: no cover - keep linters quiet
    yield from []
