#!/usr/bin/env python3
"""Run on a Mac. Reads chat.db, decodes attributedBody via NSKeyedUnarchiver
(typedstream), and emits a per-phone JSON object with full message text.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

# pyobjc is preinstalled on macOS python3
try:
    from Foundation import NSData, NSUnarchiver  # type: ignore
except Exception as e:
    print(json.dumps({"error": f"pyobjc unavailable: {e}"}), file=sys.stderr)
    sys.exit(2)


def decode_attributed_body(blob: bytes) -> str:
    """Best-effort: typedstream → NSAttributedString → string."""
    if not blob:
        return ""
    try:
        data = NSData.dataWithBytes_length_(blob, len(blob))
        obj = NSUnarchiver.unarchiveObjectWithData_(data)
        if obj is None:
            return ""
        # NSAttributedString responds to .string()
        s = obj.string() if hasattr(obj, "string") else str(obj)
        return str(s) if s else ""
    except Exception:
        # Some rows are non-typedstream; try crude UTF-8 scan as fallback.
        try:
            i = blob.find(b"NSString")
            if i < 0:
                return ""
            # NSString token is followed by a length byte then UTF-8 bytes.
            j = i + len(b"NSString")
            # walk until we hit the next chunk header (0x86 0x84 ...)
            chunk = blob[j : j + 8000]
            # try decoding the trailing portion conservatively
            for start in range(len(chunk)):
                tail = chunk[start:]
                try:
                    s = tail.decode("utf-8")
                    s = s.replace("\x00", " ").strip()
                    if s and len(s) > 2:
                        return s.split("\x86")[0].strip()
                except Exception:
                    pass
            return ""
        except Exception:
            return ""


PHONES = [
    "+14154718553",
    "+17084661102",
    "+16194029514",
    "+14242063116",
    "+19167516573",
    "+16195496601",
]

DB = str(Path.home() / "Library" / "Messages" / "chat.db")


_HAS_TRANSCRIPTION_COL: bool | None = None


def _attachment_columns(cur) -> str:
    """attachment.transcription only exists on macOS 15+ / iOS 18+. Detect
    once and pick SELECT accordingly."""
    global _HAS_TRANSCRIPTION_COL
    if _HAS_TRANSCRIPTION_COL is None:
        cur.execute("PRAGMA table_info(attachment)")
        cols = {row[1] for row in cur.fetchall()}
        _HAS_TRANSCRIPTION_COL = "transcription" in cols
    return (
        "a.filename, a.mime_type, a.total_bytes, a.transcription"
        if _HAS_TRANSCRIPTION_COL
        else "a.filename, a.mime_type, a.total_bytes, NULL AS transcription"
    )


def fetch_attachments(cur, msg_rowid: int) -> list[dict]:
    """Pull every attachment row joined to a message. Returns list of
    {kind, mime, filename, total_bytes, transcription} where kind is one
    of: audio, image, video, file. macOS stores audio messages with
    mime_type='audio/x-caf' or 'audio/amr'."""
    cur.execute(
        f"""
        SELECT {_attachment_columns(cur)}
        FROM attachment a
        JOIN message_attachment_join j ON j.attachment_id = a.ROWID
        WHERE j.message_id = ?
        """,
        (msg_rowid,),
    )
    out = []
    for filename, mime, total_bytes, transcription in cur.fetchall():
        mime = mime or ""
        if mime.startswith("audio/"):
            kind = "audio"
        elif mime.startswith("image/"):
            kind = "image"
        elif mime.startswith("video/"):
            kind = "video"
        else:
            kind = "file"
        out.append({
            "kind": kind,
            "mime": mime,
            "filename": filename,
            "total_bytes": total_bytes,
            "transcription": transcription,  # macOS Live Transcription on iOS 18+
        })
    return out


def label_for_attachments(atts: list[dict]) -> str:
    """Render a placeholder text for attachment-only messages so the UI
    shows '🎤 audio note (3s)' instead of the empty replacement char."""
    if not atts:
        return ""
    parts: list[str] = []
    for a in atts:
        if a["kind"] == "audio":
            # macOS Live Transcription sometimes fills `transcription`
            tx = (a.get("transcription") or "").strip()
            if tx:
                parts.append(f"🎤 \"{tx}\"")
            else:
                parts.append("🎤 audio note")
        elif a["kind"] == "image":
            parts.append("📷 photo")
        elif a["kind"] == "video":
            parts.append("🎥 video")
        else:
            fn = a.get("filename") or ""
            short = Path(fn).name if fn else "file"
            parts.append(f"📎 {short}")
    return " · ".join(parts)


def main() -> int:
    conn = sqlite3.connect(f"file:{DB}?mode=ro&immutable=1", uri=True)
    cur = conn.cursor()
    out: dict[str, list[dict]] = {}
    for phone in PHONES:
        cur.execute(
            """
            SELECT
              m.ROWID                                                   AS rowid,
              m.guid,
              m.is_from_me,
              COALESCE(m.text, '')                                      AS text,
              m.attributedBody                                          AS body,
              m.cache_has_attachments                                   AS has_atts,
              datetime(m.date/1000000000 + strftime('%s','2001-01-01'),
                       'unixepoch')                                     AS ts_utc,
              m.associated_message_type                                 AS reaction_type
            FROM message m
            JOIN handle h ON m.handle_id = h.ROWID
            WHERE h.id = ?
            ORDER BY m.date ASC
            """,
            (phone,),
        )
        rows = []
        for rowid, guid, is_from_me, text, body, has_atts, ts, reaction_type in cur.fetchall():
            t = text or ""
            if not t and body:
                t = decode_attributed_body(bytes(body))
            atts: list[dict] = []
            if has_atts:
                atts = fetch_attachments(cur, rowid)
            # Replace OBJ char (￼) with attachment label, OR if text is
            # empty and we have attachments, use the label as the text.
            stripped = t.replace("￼", "").strip()
            if not stripped and atts:
                t = label_for_attachments(atts)
            elif "￼" in t and atts:
                # Inline attachments: substitute each ￼ with its label
                pieces = t.split("￼")
                labels = [label_for_attachments([a]) for a in atts]
                merged = []
                for i, piece in enumerate(pieces):
                    merged.append(piece)
                    if i < len(labels):
                        merged.append(labels[i])
                t = "".join(merged).strip()
            row = {
                "guid": guid,
                "is_from_me": int(is_from_me),
                "text": t,
                "ts_utc": ts,
                "reaction_type": reaction_type or 0,
            }
            if atts:
                row["attachments"] = atts
            rows.append(row)
        out[phone] = rows
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
