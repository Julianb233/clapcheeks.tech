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


def main() -> int:
    conn = sqlite3.connect(f"file:{DB}?mode=ro&immutable=1", uri=True)
    cur = conn.cursor()
    out: dict[str, list[dict]] = {}
    for phone in PHONES:
        cur.execute(
            """
            SELECT
              m.guid,
              m.is_from_me,
              COALESCE(m.text, '') AS text,
              m.attributedBody    AS body,
              datetime(m.date/1000000000 + strftime('%s','2001-01-01'),
                       'unixepoch') AS ts_utc,
              m.associated_message_type AS reaction_type
            FROM message m
            JOIN handle h ON m.handle_id = h.ROWID
            WHERE h.id = ?
            ORDER BY m.date ASC
            """,
            (phone,),
        )
        rows = []
        for guid, is_from_me, text, body, ts, reaction_type in cur.fetchall():
            t = text or ""
            if not t and body:
                t = decode_attributed_body(bytes(body))
            rows.append(
                {
                    "guid": guid,
                    "is_from_me": int(is_from_me),
                    "text": t,
                    "ts_utc": ts,
                    "reaction_type": reaction_type or 0,
                }
            )
        out[phone] = rows
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
