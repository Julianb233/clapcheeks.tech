"""Copy audio attachments from chat.db to Supabase Storage `match-audio`
bucket and stamp playable URLs onto clapcheeks_conversations.messages.

Runs on the Mac (needs filesystem access to ~/Library/Messages/Attachments/).
After this lands the UI's <audio> tag has a real source.

Idempotent — skips audio files already uploaded (match by guid in the
message). Audio files in chat.db are typically .caf or .amr.
Browsers can't play those natively, so we transcode to .mp4/aac via
ffmpeg if available; otherwise we still upload the raw file (works in
Safari / iOS Chrome via WebKit codec).

Usage on Mac:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
    /usr/bin/python3 populate_audio_messages.py
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"
ATTACH_ROOT = Path.home() / "Library" / "Messages" / "Attachments"
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
USER_ID = "9c848c51-8996-4f1f-9dbf-50128e3408ea"
BUCKET = "match-audio"

PHONES = [
    "+14154718553", "+17084661102", "+16194029514",
    "+14242063116", "+19167516573", "+16195496601",
]


def supa(method: str, path: str, body=None):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Content-Type": "application/json",
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def upload_audio(local: Path, key: str, content_type: str) -> str | None:
    """Upload to Supabase Storage. Returns the public URL or None."""
    with local.open("rb") as f:
        body = f.read()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{key}",
        method="POST",
        data=body,
        headers={
            "Content-Type": content_type,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60):
            pass
    except urllib.error.HTTPError as e:
        if e.code != 200:
            sys.stderr.write(f"  upload failed {e.code}: {e.read().decode()[:200]}\n")
            return None
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(key)}"


def maybe_transcode(local: Path) -> tuple[Path, str]:
    """Convert .caf / .amr to .m4a (AAC) so Chrome/Firefox can play them.
    Falls back to original if ffmpeg isn't available."""
    suffix = local.suffix.lower()
    if suffix in (".m4a", ".mp3", ".mp4", ".aac", ".wav"):
        ct = {".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".mp4": "audio/mp4",
              ".aac": "audio/aac", ".wav": "audio/wav"}[suffix]
        return local, ct
    if not shutil.which("ffmpeg"):
        # Best guess on content type so Safari can still try
        ct = {".caf": "audio/x-caf", ".amr": "audio/amr"}.get(
            suffix, "application/octet-stream"
        )
        return local, ct
    out = local.with_suffix(".m4a")
    if not out.exists():
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error",
                 "-i", str(local), "-c:a", "aac", "-b:a", "64k", str(out)],
                check=True, timeout=30,
            )
        except Exception as e:
            sys.stderr.write(f"  ffmpeg failed for {local.name}: {e}\n")
            return local, "audio/x-caf"
    return out, "audio/mp4"


def main() -> int:
    if not CHAT_DB.exists():
        print("chat.db not found", file=sys.stderr)
        return 2

    conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro&immutable=1", uri=True)
    cur = conn.cursor()

    # Build phone → list[(guid, ts_utc, is_from_me, filename, mime)]
    audio_by_phone: dict[str, list[dict]] = {}
    for phone in PHONES:
        cur.execute(
            """
            SELECT m.guid, m.is_from_me,
                   datetime(m.date/1000000000 + strftime('%s','2001-01-01'),
                            'unixepoch') AS ts_utc,
                   a.filename, a.mime_type
            FROM message m
            JOIN handle h ON m.handle_id = h.ROWID
            JOIN message_attachment_join j ON j.message_id = m.ROWID
            JOIN attachment a ON a.ROWID = j.attachment_id
            WHERE h.id = ?  AND a.mime_type LIKE 'audio/%'
            ORDER BY m.date ASC
            """,
            (phone,),
        )
        rows = []
        for guid, is_from_me, ts, filename, mime in cur.fetchall():
            if not filename:
                continue
            local = Path(os.path.expanduser(filename))
            if not local.exists():
                continue
            rows.append({
                "guid": guid, "is_from_me": int(is_from_me),
                "ts_utc": ts, "local": local, "mime": mime or "audio/x-caf",
            })
        if rows:
            audio_by_phone[phone] = rows

    if not audio_by_phone:
        print("no audio attachments found")
        return 0

    print(f"Found audio in {len(audio_by_phone)} thread(s):")
    for phone, items in audio_by_phone.items():
        print(f"  {phone}: {len(items)} audio file(s)")

    total_uploaded = 0
    # Pull conversations once and patch in place per match
    for phone, items in audio_by_phone.items():
        match_id = f"imessage:{phone}"
        s, conv = supa(
            "GET",
            f"/clapcheeks_conversations?user_id=eq.{USER_ID}"
            f"&match_id=eq.{urllib.parse.quote(match_id)}&select=messages",
        )
        if s != 200 or not conv:
            print(f"  ! no conv row for {phone}")
            continue
        messages = conv[0].get("messages") or []
        if not messages:
            continue

        # Build guid → audio_url mapping
        upload_map: dict[str, str] = {}
        for it in items:
            local, ct = maybe_transcode(it["local"])
            ext = local.suffix.lstrip(".")
            key = f"{USER_ID}/{match_id}/{it['guid']}.{ext}"
            url = upload_audio(local, key, ct)
            if url:
                upload_map[it["guid"]] = url
                total_uploaded += 1
                print(f"    ↑ {phone} {it['ts_utc']} → {key}")

        # Patch existing messages: if a message's guid matches one we
        # uploaded, set audio_url. Otherwise leave it alone.
        changed = False
        for m in messages:
            g = m.get("guid")
            if g and g in upload_map and not m.get("audio_url"):
                m["audio_url"] = upload_map[g]
                # ensure label is sensible
                if not (m.get("text") or "").strip():
                    m["text"] = "🎤 audio note"
                changed = True
        if changed:
            supa(
                "PATCH",
                f"/clapcheeks_conversations?user_id=eq.{USER_ID}"
                f"&match_id=eq.{urllib.parse.quote(match_id)}",
                {"messages": messages},
            )

    print(f"\nDone — uploaded {total_uploaded} audio file(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
