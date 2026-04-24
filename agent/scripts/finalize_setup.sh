#!/usr/bin/env bash
# One-shot finisher — run this ON YOUR MAC (where Chrome and Keychain live).
# Decrypts session cookies from Chrome Profile 6, extracts the Tinder
# auth token from localStorage, pushes everything to Supabase, and kicks
# off a snapshot via the VPS cron path.
#
# Usage on the Mac (paste into Terminal.app):
#   curl -sSL https://raw.githubusercontent.com/Julianb233/clapcheeks.tech/main/agent/scripts/finalize_setup.sh | bash
# OR after a git pull:
#   bash ~/clapcheeks.tech/agent/scripts/finalize_setup.sh

set -eu

PROFILE="${PROFILE:-$HOME/Library/Application Support/Google/Chrome/Profile 6}"
SUPABASE_URL="${SUPABASE_URL:-https://oouuoepmkeqdyzsxrnjh.supabase.co}"
USER_ID="${USER_ID:-9c848c51-8996-4f1f-9dbf-50128e3408ea}"
VPS_HOST="${VPS_HOST:-julianb233@100.82.80.45}"

if [ ! -f "$PROFILE/Cookies" ]; then
  echo "ERROR: Chrome Profile 6 not found at: $PROFILE"
  echo "       Set PROFILE=... if your IG-logged-in profile is elsewhere."
  exit 1
fi

# Get the Supabase service role key from VPS
echo "Fetching service-role key from VPS..."
SERVICE_KEY=$(ssh -o StrictHostKeyChecking=no "$VPS_HOST" "grep '^SUPABASE_SERVICE_ROLE_KEY' /opt/agency-workspace/clapcheeks.tech/.env.local | cut -d= -f2- | tr -d '\"'")
if [ -z "$SERVICE_KEY" ]; then
  echo "ERROR: could not fetch SUPABASE_SERVICE_ROLE_KEY from $VPS_HOST"
  exit 2
fi

# 1) Get Chrome Safe Storage password from keychain (this prompts for permission ONCE)
echo ""
echo "Fetching Chrome cookie encryption key from keychain..."
echo "(macOS may ask you to allow keychain access — click 'Always Allow' once)"
CHROME_PASS=$(security find-generic-password -wa "Chrome" 2>/dev/null || echo "")
if [ -z "$CHROME_PASS" ]; then
  echo "ERROR: could not read Chrome Safe Storage from keychain."
  echo "       Try: security find-generic-password -ga Chrome"
  exit 3
fi

# 2) Decrypt cookies + extract localStorage with Python
python3 <<PYEOF
import sqlite3, json, sys, base64, hashlib, os, urllib.request
from pathlib import Path

profile = Path("$PROFILE")
chrome_pass = "$CHROME_PASS"
supabase_url = "$SUPABASE_URL"
service_key = "$SERVICE_KEY"
user_id = "$USER_ID"

# Derive AES key (Chrome on macOS: PBKDF2-HMAC-SHA1, 1003 iter, salt 'saltysalt', 16-byte key)
key = hashlib.pbkdf2_hmac("sha1", chrome_pass.encode(), b"saltysalt", 1003, dklen=16)
iv = b" " * 16

def decrypt_v10(blob: bytes) -> str:
    if not blob.startswith(b"v10"):
        return ""
    try:
        from Crypto.Cipher import AES
    except ImportError:
        os.system("python3 -m pip install --quiet pycryptodome")
        from Crypto.Cipher import AES
    cipher = AES.new(key, AES.MODE_CBC, iv)
    raw = cipher.decrypt(blob[3:])
    pad = raw[-1]
    if isinstance(pad, str): pad = ord(pad)
    return raw[:-pad].decode("utf-8", errors="replace")

# IG cookies
con = sqlite3.connect(f"file:{profile}/Cookies?mode=ro", uri=True)
cur = con.cursor()
cur.execute("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%instagram.com'")
ig = {}
for name, enc in cur.fetchall():
    val = decrypt_v10(enc)
    if val:
        ig[name] = val
con.close()

required_ig = ["sessionid", "ds_user_id", "csrftoken", "mid", "ig_did"]
ig_subset = {k: ig[k] for k in required_ig if k in ig}
print(f"IG cookies decrypted: {len(ig_subset)}/{len(required_ig)} required")
if len(ig_subset) < 3:
    print("  (insufficient IG cookies — try logging into instagram.com in Profile 6 again)")

# Tinder auth token — try to find it in Local Storage leveldb
tinder_token = ""
try:
    import plyvel  # pip install plyvel
except ImportError:
    os.system("python3 -m pip install --quiet plyvel")
    try:
        import plyvel
    except Exception:
        plyvel = None

if plyvel:
    ldb_path = profile / "Local Storage" / "leveldb"
    try:
        db = plyvel.DB(str(ldb_path), create_if_missing=False)
        for k, v in db.iterator():
            if b"tinder.com" in k and (b"APIToken" in k or b"auth_token" in k):
                # Strip leading marker bytes (Chrome localStorage prefix)
                val = v.decode("utf-8", errors="replace").lstrip("\x01\x00").strip('"').strip()
                if len(val) > 12:
                    tinder_token = val
                    break
        db.close()
    except Exception as exc:
        print(f"  leveldb read failed: {exc}")
print(f"Tinder token: {'FOUND ('+str(len(tinder_token))+' chars)' if tinder_token else 'NOT FOUND'}")

# Push to Supabase
def patch_settings(payload: dict) -> bool:
    url = f"{supabase_url}/rest/v1/clapcheeks_user_settings?user_id=eq.{user_id}"
    req = urllib.request.Request(url, method="PATCH",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "return=minimal",
        })
    try:
        urllib.request.urlopen(req, timeout=20)
        return True
    except Exception as exc:
        print(f"  PATCH failed: {exc}")
        return False

updates = {}
if len(ig_subset) >= 3:
    updates["instagram_auth_token"] = json.dumps(ig_subset)
    updates["instagram_auth_source"] = "chrome-cookie-extract"
    updates["instagram_auth_token_updated_at"] = "now()"
if tinder_token:
    updates["tinder_auth_token"] = tinder_token
    updates["tinder_auth_source"] = "chrome-localstorage-extract"
    updates["tinder_auth_token_updated_at"] = "now()"

if updates:
    # Strip the now() literal — Supabase REST doesn't eval it; use ISO string instead
    from datetime import datetime, timezone
    iso = datetime.now(timezone.utc).isoformat()
    for k in list(updates.keys()):
        if updates[k] == "now()":
            updates[k] = iso
    ok = patch_settings(updates)
    print(f"Supabase update: {'OK' if ok else 'FAIL'}")
else:
    print("Nothing to push (no cookies decrypted, no Tinder token).")
PYEOF

# 3) Trigger a fresh snapshot on the VPS
echo ""
echo "Triggering VPS snapshot..."
ssh -o StrictHostKeyChecking=no "$VPS_HOST" "cd /opt/agency-workspace/clapcheeks.tech && PYTHONPATH=agent /usr/bin/python3 agent/scripts/direct_snapshot.py --top-messages 5 2>&1 | tail -20"

echo ""
echo "DONE. Check ~/.clapcheeks/snapshots/ on the VPS for the JSON output."
echo "Hourly cron will keep refreshing automatically."
