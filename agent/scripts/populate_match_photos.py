"""For each match in clapcheeks_matches without photos:
1. Try to use her iMessage image attachment (HEIC -> JPG via sips)
2. Fall back to generated initials avatar via ui-avatars.com

Uploads to Supabase Storage match-photos bucket and updates photos_jsonb.
Run on MBP (has chat.db + sips).
"""
import sqlite3, os, json, re, subprocess, tempfile, urllib.request, urllib.parse, sys
from pathlib import Path

CHAT_DB = os.path.expanduser('~/Library/Messages/chat.db')
SUPABASE_URL = os.environ['SUPABASE_URL']
SERVICE_KEY = os.environ['SUPABASE_SERVICE_KEY']
USER_ID = '9c848c51-8996-4f1f-9dbf-50128e3408ea'

def supa_get(path: str):
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/{path}',
        headers={'apikey': SERVICE_KEY, 'Authorization': f'Bearer {SERVICE_KEY}'},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

def supa_patch(path: str, payload: dict):
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/{path}', method='PATCH',
        data=json.dumps(payload).encode(),
        headers={
            'Content-Type': 'application/json',
            'apikey': SERVICE_KEY,
            'Authorization': f'Bearer {SERVICE_KEY}',
            'Prefer': 'return=minimal',
        },
    )
    urllib.request.urlopen(req, timeout=20)

def supa_upload(bucket: str, path: str, content: bytes, content_type: str = 'image/jpeg'):
    """Upload to Supabase Storage. Use upsert via x-upsert header."""
    req = urllib.request.Request(
        f'{SUPABASE_URL}/storage/v1/object/{bucket}/{path}', method='POST',
        data=content,
        headers={
            'Content-Type': content_type,
            'Authorization': f'Bearer {SERVICE_KEY}',
            'x-upsert': 'true',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except urllib.error.HTTPError as e:
        if e.code == 409:  # exists, retry with PUT
            req = urllib.request.Request(
                f'{SUPABASE_URL}/storage/v1/object/{bucket}/{path}', method='PUT',
                data=content,
                headers={
                    'Content-Type': content_type,
                    'Authorization': f'Bearer {SERVICE_KEY}',
                },
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status == 200
        raise

def heic_to_jpg(heic_path: str) -> "bytes":
    """Use macOS sips to convert HEIC -> JPG."""
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
        print(f'  sips failed: {exc}')
        return None

def get_largest_attachment(phone: str) -> "str":
    db = sqlite3.connect(f'file:{CHAT_DB}?mode=ro', uri=True)
    cur = db.cursor()
    cur.execute('''SELECT attachment.filename, attachment.total_bytes
        FROM message JOIN message_attachment_join maj ON maj.message_id=message.ROWID
        JOIN attachment ON attachment.ROWID=maj.attachment_id
        JOIN chat_message_join cmj ON cmj.message_id=message.ROWID
        JOIN chat ON chat.ROWID=cmj.chat_id
        WHERE chat.chat_identifier = ? AND chat.style = 45
          AND message.is_from_me = 0
          AND attachment.mime_type LIKE 'image/%'
        ORDER BY attachment.total_bytes DESC LIMIT 1''', (phone,))
    r = cur.fetchone()
    db.close()
    if r and r[0]:
        f = r[0]
        if f.startswith('~'): f = os.path.expanduser(f)
        return f if os.path.isfile(f) else None
    return None

def fetch_avatar(name: str) -> "bytes":
    """Fallback: deterministic avatar via DiceBear, then locally-generated SVG.
    Returns PNG bytes."""
    seed = (name or 'X').strip()
    # Try DiceBear (initials style, returns PNG)
    try:
        url = f'https://api.dicebear.com/7.x/initials/png?seed={urllib.parse.quote(seed)}&size=400&backgroundType=gradientLinear'
        req = urllib.request.Request(url, headers={'User-Agent': 'clapcheeks/1.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
            if len(data) > 1000:  # sanity: not an error page
                return data
    except Exception as exc:
        print(f'  dicebear failed: {exc}')

    # Local fallback: generate via macOS built-in `qlmanage` (Quartz) from SVG file
    try:
        first = seed[:1].upper() or 'X'
        seed_hash = sum(ord(c) for c in seed)
        colors = ['ff6b6b','4ecdc4','feca57','ff9ff3','54a0ff','5f27cd','00d2d3','c44569','f8b500','6c5ce7']
        bg = colors[seed_hash % len(colors)]
        svg = f'''<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#{bg}"/>
  <text x="200" y="240" text-anchor="middle" fill="white" font-family="Helvetica" font-size="180" font-weight="bold">{first}</text>
</svg>'''
        with tempfile.NamedTemporaryFile(suffix='.svg', delete=False, mode='w') as tmp:
            tmp.write(svg)
            svg_path = tmp.name
        png_path = svg_path.replace('.svg', '.png')
        # macOS sips can convert SVG -> PNG via the Image I/O subsystem
        subprocess.run(['rsvg-convert', '-w', '400', '-h', '400', svg_path, '-o', png_path],
                      check=True, capture_output=True, timeout=20)
        with open(png_path, 'rb') as f:
            data = f.read()
        os.unlink(svg_path); os.unlink(png_path)
        return data
    except Exception as exc:
        print(f'  local svg failed: {exc}')

    return None

# Fetch matches
matches = supa_get(f'clapcheeks_matches?select=match_id,name,photos_jsonb&user_id=eq.{USER_ID}')
print(f'Processing {len(matches)} matches...\n')

updated = 0
for m in matches:
    match_id = m['match_id']
    name = m.get('name') or 'Unknown'
    existing = m.get('photos_jsonb') or []
    if isinstance(existing, list) and len(existing) > 0:
        print(f'[skip] {name}: already has {len(existing)} photos')
        continue

    # Extract phone from match_id like "imessage:+1xxx"
    phone = match_id.split(':', 1)[1] if ':' in match_id else None
    img_bytes = None
    source = None

    if phone and phone.startswith('+1'):
        att_path = get_largest_attachment(phone)
        if att_path:
            ext = att_path.lower().split('.')[-1]
            if ext == 'heic':
                img_bytes = heic_to_jpg(att_path)
            else:
                with open(att_path, 'rb') as f:
                    img_bytes = f.read()
            if img_bytes:
                source = f'imessage:{os.path.basename(att_path)}'

    if not img_bytes:
        img_bytes = fetch_avatar(name)
        source = 'avatar'

    if not img_bytes:
        print(f'[fail] {name}: could not get any image')
        continue

    storage_path = f'{USER_ID}/{match_id}/0.jpg'
    try:
        supa_upload('match-photos', storage_path, img_bytes, 'image/jpeg')
    except Exception as exc:
        print(f'[fail upload] {name}: {exc}')
        continue

    public_url = f'{SUPABASE_URL}/storage/v1/object/public/match-photos/{storage_path}'
    photos = [{'idx': 0, 'url': public_url, 'storage_path': storage_path, 'source': source}]
    try:
        supa_patch(
            f'clapcheeks_matches?user_id=eq.{USER_ID}&match_id=eq.{urllib.parse.quote(match_id)}',
            {'photos_jsonb': photos},
        )
        updated += 1
        print(f'[ok] {name}: {source} -> {storage_path}')
    except Exception as exc:
        print(f'[fail patch] {name}: {exc}')

print(f'\n{updated}/{len(matches)} matches updated with photos')
