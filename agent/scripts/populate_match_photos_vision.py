"""v2: For each match, vision-classify ALL her image attachments to find a real faceshot.
Falls back to initials avatar when no clear faceshot exists.

Pipeline per match:
1. Pull ALL image attachments she sent (sorted recent-first)
2. Convert HEIC -> JPG via sips
3. For each candidate, ask llama3.2-vision: 'Is this a clear faceshot of one person?'
4. Pick the highest-scored faceshot; tag the photo's source field with 'imessage-faceshot'
5. If no candidate scores high, fall back to DiceBear avatar (source='avatar')

Source markers in photos_jsonb:
- imessage-faceshot   = real photo of her, classified as a clear faceshot
- imessage-photo      = real photo, but not a clean faceshot (still uses if no avatar would be better)
- avatar              = DiceBear initials fallback
"""
import sqlite3, os, json, re, subprocess, tempfile, urllib.request, urllib.parse, base64, sys
from pathlib import Path

CHAT_DB = os.path.expanduser('~/Library/Messages/chat.db')
SUPABASE_URL = os.environ['SUPABASE_URL']
SERVICE_KEY = os.environ['SUPABASE_SERVICE_KEY']
USER_ID = '9c848c51-8996-4f1f-9dbf-50128e3408ea'
OLLAMA_HOST = os.environ.get('OLLAMA_VISION_URL', 'http://127.0.0.1:11434')
VISION_MODEL = 'moondream:latest'

CLASSIFY_PROMPT = (
    "You are classifying dating-app profile photos. Look at this image and answer:\n"
    "1) faceshot: yes/no — is this a CLEAR photo of ONE PERSON, with their face visible, suitable as a dating-app profile photo?\n"
    "2) score: 0-10 — how good would this be as her main dating-app photo? "
    "(10 = perfect headshot, 5 = full body or distant, 0 = no person/meme/screenshot/food/scenery)\n"
    "3) reason: one short sentence why\n\n"
    "Output ONLY JSON in this exact format, no preamble:\n"
    '{\"faceshot\": \"yes\" or \"no\", \"score\": <0-10>, \"reason\": \"<short>\"}'
)

def supa_get(path: str):
    req = urllib.request.Request(f'{SUPABASE_URL}/rest/v1/{path}',
        headers={'apikey': SERVICE_KEY, 'Authorization': f'Bearer {SERVICE_KEY}'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

def supa_patch(path: str, payload: dict):
    req = urllib.request.Request(f'{SUPABASE_URL}/rest/v1/{path}', method='PATCH',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'apikey': SERVICE_KEY,
                 'Authorization': f'Bearer {SERVICE_KEY}', 'Prefer': 'return=minimal'})
    urllib.request.urlopen(req, timeout=20)

def supa_upload(bucket: str, path: str, content: bytes, content_type='image/jpeg'):
    for method in ('POST', 'PUT'):
        try:
            req = urllib.request.Request(
                f'{SUPABASE_URL}/storage/v1/object/{bucket}/{path}',
                method=method, data=content,
                headers={'Content-Type': content_type,
                         'Authorization': f'Bearer {SERVICE_KEY}',
                         'x-upsert': 'true'})
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status in (200, 201):
                    return True
        except urllib.error.HTTPError as e:
            if e.code == 409:
                continue
            raise
    return False

def heic_to_jpg(heic_path):
    if not os.path.isfile(heic_path):
        return None
    try:
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            tmp_path = tmp.name
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-z', '1200', '1200',
                       heic_path, '--out', tmp_path],
                      check=True, capture_output=True, timeout=30)
        with open(tmp_path, 'rb') as f:
            data = f.read()
        os.unlink(tmp_path)
        return data
    except Exception as exc:
        print(f'    sips failed: {exc}')
        return None

def vision_classify(jpg_bytes):
    """Returns (faceshot_yes_no, score 0-10, reason). None on failure."""
    try:
        b64 = base64.b64encode(jpg_bytes).decode()
        req = urllib.request.Request(f'{OLLAMA_HOST}/api/chat', method='POST',
            data=json.dumps({
                'model': VISION_MODEL,
                'messages': [{'role': 'user', 'content': CLASSIFY_PROMPT, 'images': [b64]}],
                'stream': False,
                'options': {'temperature': 0.1},
            }).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.loads(r.read())
        text = resp.get('message', {}).get('content', '').strip()
        # Extract JSON from response
        m = re.search(r'\{[^}]+\}', text, re.DOTALL)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            # Try cleaning trailing commas etc
            cleaned = re.sub(r',\s*\}', '}', m.group(0))
            obj = json.loads(cleaned)
        return (
            obj.get('faceshot', 'no').lower().strip(),
            int(obj.get('score', 0)),
            obj.get('reason', '')[:120],
        )
    except Exception as exc:
        print(f'    vision_classify error: {exc}')
        return None

def get_all_image_attachments(phone, limit=20):
    db = sqlite3.connect(f'file:{CHAT_DB}?mode=ro', uri=True)
    cur = db.cursor()
    cur.execute('''SELECT attachment.filename, attachment.total_bytes, attachment.mime_type
        FROM message JOIN message_attachment_join maj ON maj.message_id=message.ROWID
        JOIN attachment ON attachment.ROWID=maj.attachment_id
        JOIN chat_message_join cmj ON cmj.message_id=message.ROWID
        JOIN chat ON chat.ROWID=cmj.chat_id
        WHERE chat.chat_identifier = ? AND chat.style = 45
          AND message.is_from_me = 0
          AND attachment.mime_type LIKE 'image/%'
        ORDER BY message.date DESC LIMIT ?''', (phone, limit))
    rows = cur.fetchall()
    db.close()
    out = []
    for r in rows:
        f = r[0]
        if not f: continue
        if f.startswith('~'): f = os.path.expanduser(f)
        if not os.path.isfile(f): continue
        out.append({'path': f, 'size': r[1] or 0, 'mime': r[2]})
    return out

def fetch_avatar(name):
    seed = (name or 'X').strip()
    try:
        url = f'https://api.dicebear.com/7.x/initials/png?seed={urllib.parse.quote(seed)}&size=400&backgroundType=gradientLinear'
        req = urllib.request.Request(url, headers={'User-Agent': 'clapcheeks/1.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
            if len(data) > 1000:
                return data
    except Exception as exc:
        print(f'    dicebear failed: {exc}')
    return None

# === main ===
matches = supa_get(f'clapcheeks_matches?select=match_id,name,photos_jsonb&user_id=eq.{USER_ID}')
print(f'Processing {len(matches)} matches with vision classifier...\n')

updated = 0
for m in matches:
    match_id = m['match_id']
    name = m.get('name') or 'Unknown'
    print(f'>> {name} ({match_id})')

    phone = match_id.split(':', 1)[1] if ':' in match_id else None
    chosen_bytes = None
    chosen_source = None

    if phone and phone.startswith('+1'):
        attachments = get_all_image_attachments(phone, limit=12)
        print(f'  found {len(attachments)} image attachments')
        candidates = []  # (score, faceshot, bytes, filename, reason)
        for i, a in enumerate(attachments):
            fname = os.path.basename(a['path'])
            ext = a['path'].lower().split('.')[-1]
            if ext in ('heic', 'heif'):
                jpg = heic_to_jpg(a['path'])
            elif ext in ('jpg', 'jpeg', 'png'):
                with open(a['path'], 'rb') as f:
                    jpg = f.read()
            else:
                continue
            if not jpg:
                continue
            cls = vision_classify(jpg)
            if not cls:
                print(f'    [{i+1}] {fname}: classify failed')
                continue
            faceshot, score, reason = cls
            print(f'    [{i+1}] {fname}: faceshot={faceshot} score={score} — {reason}')
            candidates.append((score, faceshot, jpg, fname, reason))

        # Pick best: highest score where faceshot=yes; if none, highest score period
        faceshots = [c for c in candidates if c[1] == 'yes' and c[0] >= 5]
        if faceshots:
            faceshots.sort(key=lambda x: -x[0])
            chosen = faceshots[0]
            chosen_bytes = chosen[2]
            chosen_source = f'imessage-faceshot:{chosen[3]} (score={chosen[0]})'
        elif candidates:
            # No faceshot — use avatar instead, don't show random pic
            print(f'  no faceshot found among {len(candidates)} candidates; using avatar')

    if not chosen_bytes:
        chosen_bytes = fetch_avatar(name)
        chosen_source = 'avatar'

    if not chosen_bytes:
        print(f'  FAIL: no image obtainable')
        continue

    storage_path = f'{USER_ID}/{match_id}/0.jpg'
    try:
        supa_upload('match-photos', storage_path, chosen_bytes, 'image/jpeg')
    except Exception as exc:
        print(f'  upload failed: {exc}')
        continue

    public_url = f'{SUPABASE_URL}/storage/v1/object/public/match-photos/{storage_path}'
    photos = [{'idx': 0, 'url': public_url, 'storage_path': storage_path, 'source': chosen_source}]
    try:
        supa_patch(
            f'clapcheeks_matches?user_id=eq.{USER_ID}&match_id=eq.{urllib.parse.quote(match_id)}',
            {'photos_jsonb': photos},
        )
        updated += 1
        print(f'  -> {chosen_source}\n')
    except Exception as exc:
        print(f'  patch failed: {exc}')

print(f'\n{updated}/{len(matches)} matches updated')
