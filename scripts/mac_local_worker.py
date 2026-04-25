"""Mac Mini local worker — runs continuously via launchd.

Loop:
  every 2 min:
    1. Pull chat.db deltas → Supabase (replaces nightly VPS cron)
    2. For each roster match where her last message > our last suggestion:
       - run Ollama with voice profile + last 12 msgs
       - write 3 reply drafts to match_intel.suggested_replies
  every 60 min:
    - rebuild voice profile from latest outbound corpus

Local-first: no API costs, runs as fast as Ollama can crunch (M4 + 8b
model = ~3-5s per draft). Vercel /api/conversation/suggest reads cached
drafts instantly.

Install:
  scp mac_local_worker.py mac-mini:~/clapcheeks/
  scp pull_chatdb_v2.py    mac-mini:~/clapcheeks/
  ssh mac-mini 'launchctl load ~/Library/LaunchAgents/tech.clapcheeks.local-worker.plist'
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# Config — populated by setup script into ~/.clapcheeks/worker.env
ENV_FILE = Path.home() / ".clapcheeks" / "worker.env"
ENV: dict[str, str] = {}
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            ENV[k.strip()] = v.strip().strip('"').strip("'")

SUPABASE_URL = ENV.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")
USER_ID = ENV.get("CLAPCHEEKS_USER_ID", "")
OLLAMA_MODEL = ENV.get("OLLAMA_MODEL", "llama3.1:8b")
OLLAMA_HOST = ENV.get("OLLAMA_HOST", "http://127.0.0.1:11434")
TICK_SECONDS = int(ENV.get("TICK_SECONDS", "120"))
VOICE_REFRESH_SECONDS = int(ENV.get("VOICE_REFRESH_SECONDS", "3600"))

CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"
LOG = Path.home() / ".clapcheeks" / "worker.log"
LOG.parent.mkdir(parents=True, exist_ok=True)

H = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line, flush=True)
    try:
        LOG.open("a").write(line + "\n")
    except Exception:
        pass


def call(method: str, path: str, body=None):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers=H,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")
    except Exception as e:
        return 0, {"error": str(e)}


# ---------- chat.db delta pull ----------

def decode_attributed_body(blob: bytes) -> str:
    if not blob:
        return ""
    try:
        from Foundation import NSData, NSUnarchiver  # type: ignore
        data = NSData.dataWithBytes_length_(blob, len(blob))
        obj = NSUnarchiver.unarchiveObjectWithData_(data)
        if obj is None:
            return ""
        s = obj.string() if hasattr(obj, "string") else str(obj)
        return str(s) if s else ""
    except Exception:
        return ""


def is_real(text: str) -> bool:
    if not text or not text.strip():
        return False
    return not text.startswith((
        "Loved “", "Liked “", "Disliked “", "Laughed at “",
        "Emphasized “", "Questioned “", "Reacted ",
    ))


_chat_db_disabled = False


def chatdb_messages_for(phone: str, since_iso: str | None) -> list[dict]:
    global _chat_db_disabled
    if _chat_db_disabled or not CHAT_DB.exists():
        return []
    try:
        conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro&immutable=1", uri=True)
    except sqlite3.OperationalError as e:
        # macOS Full Disk Access denied — skip chat.db forever this run.
        # The MacBook Pro nightly VPS cron feeds messages into Supabase
        # using the julianbradley user account which is authorized.
        log(f"chat.db inaccessible (Full Disk Access not granted): {e}; falling back to Supabase-only mode")
        _chat_db_disabled = True
        return []
    cur = conn.cursor()
    where = "h.id = ?"
    params: list = [phone]
    if since_iso:
        where += (
            " AND m.date/1000000000 + strftime('%s','2001-01-01') > "
            "strftime('%s', ?)"
        )
        params.append(since_iso)
    cur.execute(
        f"""
        SELECT m.guid, m.is_from_me, COALESCE(m.text, ''), m.attributedBody,
               datetime(m.date/1000000000 + strftime('%s','2001-01-01'),
                        'unixepoch')
        FROM message m JOIN handle h ON m.handle_id = h.ROWID
        WHERE {where}
        ORDER BY m.date ASC
        """,
        params,
    )
    out = []
    for guid, is_from_me, text, body, ts in cur.fetchall():
        t = text or ""
        if not t and body:
            t = decode_attributed_body(bytes(body))
        out.append({
            "guid": guid,
            "is_from_me": int(is_from_me),
            "text": t,
            "ts_utc": ts,
        })
    conn.close()
    return out


# ---------- Ollama ----------

def ollama_chat(system: str, user: str, model: str | None = None) -> str:
    payload = {
        "model": model or OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "options": {"temperature": 0.85},
    }
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode())
    return d.get("message", {}).get("content", "").strip()


# ---------- per-match logic ----------

def latest_message_ts(messages: list[dict]) -> str | None:
    if not messages:
        return None
    return messages[-1].get("ts")


def generate_suggestions(match: dict, voice: dict | None) -> list[str]:
    convo = match["match_intel"].get("recent_messages") or []
    if not convo:
        return []
    name = match["name"]
    style = (voice or {}).get("style_summary") or "Casual, short messages, lowercase, drops apostrophes."
    sample = (voice or {}).get("sample_phrases") or []
    sample_block = ""
    if sample:
        sample_block = "Real examples of how he texts:\n" + "\n".join(f"- {s}" for s in sample[:12])

    transcript = "\n".join(
        f"{'You' if m.get('from') == 'him' else name}: {m.get('text','')}"
        for m in convo[-12:]
    )

    system = (
        f"You write reply drafts in Julian's exact texting voice. "
        f"Voice fingerprint: {style}\n\n{sample_block}\n\n"
        "Rules:\n"
        "- 1 to 3 short messages (not one paragraph)\n"
        "- Match her energy, mirror her tone\n"
        "- No corporate phrasing, no emojis Julian wouldn't use\n"
        "- Output ONLY a JSON array of 3 reply objects, each like "
        '{"reply":"the message","reasoning":"why this lands"}'
    )
    user = (
        f"Match: {name} (stage: {match.get('stage')}, rank: {match.get('julian_rank')})\n"
        f"Recent thread:\n{transcript}\n\n"
        f"Write 3 reply options Julian could send right now. JSON array only."
    )

    raw = ollama_chat(system, user)
    # extract first JSON array from output
    arr_match = re.search(r"\[[\s\S]*\]", raw)
    if not arr_match:
        return []
    try:
        items = json.loads(arr_match.group(0))
    except Exception:
        return []
    out = []
    for it in items[:3]:
        if isinstance(it, dict) and isinstance(it.get("reply"), str):
            out.append(it["reply"].strip())
        elif isinstance(it, str):
            out.append(it.strip())
    return [s for s in out if s]


# ---------- voice profile rebuild (ASCII text only — no LLM needed) ----------

def rebuild_voice_profile() -> None:
    s, convos = call("GET", f"/clapcheeks_conversations?user_id=eq.{USER_ID}&select=messages")
    if s != 200:
        return
    out: list[str] = []
    for c in convos or []:
        msgs = c.get("messages") or []
        for m in msgs:
            if m.get("from") == "him" and isinstance(m.get("text"), str):
                t = m["text"].strip()
                if t and not t.startswith(("Loved “", "Reacted ", "Liked “", "Emphasized “")):
                    out.append(t)
    n = len(out)
    if n == 0:
        return
    # Cheap fingerprint (no LLM)
    emoji_re = re.compile(r"[\U0001F300-\U0001FAFF\U0001F900-\U0001F9FF\U0001F600-\U0001F64F]", re.UNICODE)
    no_apo = re.compile(r"\b(Im|Ill|whats|dont|cant|wont|youre|its|hes|shes|theyre)\b")
    double = re.compile(r"([a-z])\1{2,}")
    GREETINGS = ["heyy", "hey", "hi", "hola", "yo", "good morning", "whats up"]

    total_words = 0
    lower = endsq = ellip = excl = nap = doub = 0
    emo: Counter = Counter()
    grt: Counter = Counter()
    sample: list[str] = []
    seen: set[str] = set()
    for s in out:
        s = s.strip()
        if not s:
            continue
        words = s.split()
        total_words += len(words)
        if s.lower() == s and any(c.isalpha() for c in s):
            lower += 1
        if s.endswith("?"):
            endsq += 1
        if "..." in s:
            ellip += 1
        if "!" in s:
            excl += 1
        if no_apo.search(s):
            nap += 1
        if double.search(s.lower()):
            doub += 1
        for e in emoji_re.findall(s):
            emo[e] += 1
        sl = s.lower()
        for g in GREETINGS:
            if sl.startswith(g):
                grt[g] += 1
                break
        if 4 < len(s) < 90 and s not in seen:
            sample.append(s)
            seen.add(s)
        if len(sample) > 30:
            sample = sample[:30]

    avg = total_words / n
    top_emo = [k for k, _ in emo.most_common(15)]
    style = (
        f"Casual, lowercase {round(100*lower/n)}%, avg {avg:.1f} words. "
        f"Drops apostrophes {round(100*nap/n)}%. Doubles letters {round(100*doub/n)}%. "
        f"Top emojis: {' '.join(top_emo[:8]) if top_emo else '(rare)'}. "
        f"Top greetings: {', '.join(f'{g}({c})' for g,c in grt.most_common(5))}. "
        f"Bursts: 2-4 short msgs in quick succession."
    )

    body = {
        "user_id": USER_ID,
        "tone": "casual",
        "style_summary": style,
        "sample_phrases": sample,
        "profile_data": {
            "avg_words": round(avg, 2),
            "total_messages_analyzed": n,
            "uses_lowercase_only_pct": round(100 * lower / n, 1),
            "drops_apostrophes_pct": round(100 * nap / n, 1),
            "doubles_letters_for_warmth_pct": round(100 * doub / n, 1),
            "common_emojis": top_emo,
            "casual_greetings": [g for g, _ in grt.most_common()],
        },
        "messages_analyzed": n,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    s, _ = call("PATCH", f"/clapcheeks_voice_profiles?user_id=eq.{USER_ID}", body)
    log(f"voice profile refreshed n={n} HTTP {s}")


# ---------- main loop ----------

def tick() -> None:
    # Pull chat.db deltas + push to Supabase
    s, matches = call(
        "GET",
        f"/clapcheeks_matches?user_id=eq.{USER_ID}"
        "&select=id,name,her_phone,match_id,stage,julian_rank,match_intel"
        "&her_phone=not.is.null"
        "&stage=not.in.(archived,archived_cluster_dupe,ghosted,faded)",
    )
    if s != 200:
        log(f"matches fetch failed: {s}")
        return
    matches = matches or []
    if not matches:
        return

    # Voice once
    voice = None
    s, vrows = call("GET", f"/clapcheeks_voice_profiles?user_id=eq.{USER_ID}&select=style_summary,sample_phrases")
    if vrows:
        voice = vrows[0]

    for m in matches:
        phone = m["her_phone"]
        intel = m.get("match_intel") or {}
        # Last suggestion timestamp — we only redraft if she sent a NEW message after
        last_sugg_at = intel.get("suggestion_generated_at")
        last_inbound_ts = None
        for msg in reversed(intel.get("recent_messages") or []):
            if msg.get("from") == "her":
                last_inbound_ts = msg.get("ts")
                break

        # Pull anything new from chat.db (best-effort — falls back silently
        # to Supabase-only mode if Full Disk Access isn't granted).
        try:
            new_msgs = chatdb_messages_for(phone, last_inbound_ts)
        except Exception as e:
            log(f"{m['name']}: chat.db read err: {e}")
            new_msgs = []
        new_real = [x for x in new_msgs if is_real(x["text"])]

        if new_real:
            # Merge into match_intel.recent_messages (keep last 100)
            existing = intel.get("recent_messages") or []
            seen_guids = {x.get("guid") for x in existing if x.get("guid")}
            for x in new_real:
                if x["guid"] in seen_guids:
                    continue
                existing.append({
                    "ts": x["ts_utc"].replace(" ", "T") + "Z",
                    "from": "him" if x["is_from_me"] else "her",
                    "text": x["text"],
                    "guid": x["guid"],
                })
            existing = existing[-100:]
            intel["recent_messages"] = existing
            log(f"{m['name']}: +{len(new_real)} new messages")

        # Generate suggestions if there's an unanswered her-message
        recent = intel.get("recent_messages") or []
        if recent and recent[-1].get("from") == "her":
            need_new = True
            if last_sugg_at and last_inbound_ts and last_sugg_at >= last_inbound_ts:
                need_new = False
            if need_new:
                try:
                    suggestions = generate_suggestions(
                        {"name": m["name"], "stage": m.get("stage"),
                         "julian_rank": m.get("julian_rank"),
                         "match_intel": intel},
                        voice,
                    )
                except Exception as e:
                    log(f"{m['name']}: ollama failed: {e}")
                    suggestions = []
                if suggestions:
                    intel["suggested_replies"] = [
                        {"text": t, "model": OLLAMA_MODEL,
                         "generated_at": datetime.now(timezone.utc).isoformat()}
                        for t in suggestions
                    ]
                    intel["suggestion_generated_at"] = datetime.now(timezone.utc).isoformat()
                    log(f"{m['name']}: drafted {len(suggestions)} suggestion(s)")

        # Push back if anything changed
        call("PATCH", f"/clapcheeks_matches?id=eq.{m['id']}", {"match_intel": intel})


def main() -> int:
    if not (SUPABASE_URL and SERVICE_KEY and USER_ID):
        print("Missing config in ~/.clapcheeks/worker.env", file=sys.stderr)
        return 2
    log(f"local worker starting — model={OLLAMA_MODEL} tick={TICK_SECONDS}s")
    last_voice = 0.0
    while True:
        try:
            tick()
        except Exception as e:
            log(f"tick error: {e}")
        if time.time() - last_voice > VOICE_REFRESH_SECONDS:
            try:
                rebuild_voice_profile()
            except Exception as e:
                log(f"voice rebuild error: {e}")
            last_voice = time.time()
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
