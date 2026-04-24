#!/usr/bin/env bash
# Clapcheeks BlueBubbles integration smoke test (fleet, 2026-04-24).
#
# Usage: ./scripts/test-bluebubbles-integration.sh [--send <phone>]
#
# --dry-run (default): exercises every layer except the actual iMessage send.
# --send <phone>:      sends a real iMessage via the full python sender path
#                      and verifies `mac send` output says "via BlueBubbles".
#
# Exits non-zero on any failure. Designed to be CI-friendly.

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)"
AGENT_DIR="$REPO_ROOT/agent"
SEND_TARGET=""
DRY=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --send) SEND_TARGET="$2"; DRY=0; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

step() { printf "\n▸ %s\n" "$*"; }
pass() { printf "  ✓ %s\n" "$*"; }
fail() { printf "  ✗ %s\n" "$*" >&2; exit 1; }

cd "$AGENT_DIR"
export PYTHONPATH="$AGENT_DIR${PYTHONPATH:+:$PYTHONPATH}"

step "1. Env loader populates BLUEBUBBLES_* from fleet-config files"
python3 -c "
from clapcheeks.imessage.sender import _ensure_bluebubbles_env
import os
_ensure_bluebubbles_env()
assert os.environ.get('BLUEBUBBLES_ENABLED') == 'true', 'BLUEBUBBLES_ENABLED not loaded'
assert os.environ.get('BLUEBUBBLES_URL'), 'BLUEBUBBLES_URL not loaded'
assert os.environ.get('BLUEBUBBLES_PASSWORD'), 'BLUEBUBBLES_PASSWORD not loaded'
print('  ', os.environ['BLUEBUBBLES_URL'])
" || fail "env loader did not populate BLUEBUBBLES_*"
pass "env loaded"

step "2. BlueBubbles tunnel reachable"
URL="$(python3 -c 'from clapcheeks.imessage.sender import _ensure_bluebubbles_env as f; f(); import os; print(os.environ["BLUEBUBBLES_URL"])')"
HTTP_CODE="$(curl -o /dev/null -s -w '%{http_code}' -m 8 "$URL/api/v1/server/info" || echo 000)"
[[ "$HTTP_CODE" =~ ^(200|401|403)$ ]] || fail "tunnel unreachable (HTTP $HTTP_CODE)"
pass "tunnel returns HTTP $HTTP_CODE"

step "3. Inbox consumer round-trip (write → read)"
python3 - <<'PY' || fail "inbox consumer round-trip failed"
import json
from pathlib import Path
from datetime import datetime, timezone
from clapcheeks.imessage.bluebubbles_inbox import BlueBubblesInbox

d = Path('/opt/agency-workspace/fleet-shared/inbox/clapcheeks')
d.mkdir(parents=True, exist_ok=True)
today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
fp = d / f'{today}.ndjson'
test_marker = f'bb-smoke-test-{datetime.now(timezone.utc).isoformat()}'
with fp.open('a') as fh:
    fh.write(json.dumps({
        'ts': datetime.now(timezone.utc).isoformat(),
        'type': 'new-message',
        'from': '+10000000000',
        'text': test_marker,
        'guid': test_marker,
        'slug': 'clapcheeks',
        'raw': {},
    }) + '\n')

# Reset cursor so we re-read the just-appended line
from clapcheeks.imessage.bluebubbles_inbox import CURSOR_PATH
if CURSOR_PATH.exists():
    CURSOR_PATH.unlink()

seen = []
BlueBubblesInbox(slug='clapcheeks', callback=seen.append).drain_once()
assert any(e.text == test_marker for e in seen), f'marker not read back; saw {[e.text for e in seen]}'
print(f'  marker read back: {test_marker[:40]}...')
PY
pass "inbox round-trip"

step "4. Contact-index register → unregister"
python3 - <<'PY' || fail "contact-index roundtrip failed"
from clapcheeks.imessage.contact_index import register, load, unregister
register('+19999999999', 'clapcheeks-smoke')
assert load().get('+19999999999') == 'clapcheeks-smoke'
unregister('+19999999999')
assert '+19999999999' not in load()
print('  register + unregister OK')
PY
pass "contact-index OK"

step "5. Send-path dispatch (dry_run)"
python3 -c "
from clapcheeks.imessage.sender import send_imessage
r = send_imessage('+12177665134', 'dry', dry_run=True)
assert r.ok and r.channel == 'noop', r
print('  dry_run:', r)
"
pass "dry send"

if [[ "$DRY" -eq 0 ]]; then
  step "6. Live send via python sender to $SEND_TARGET"
  RESULT="$(python3 -c "
from clapcheeks.imessage.sender import send_imessage
r = send_imessage('$SEND_TARGET', 'Clapcheeks BlueBubbles smoke test — if you got this, the integration works. ($(date -u +%H:%M:%S)Z)')
print(r.channel, r.ok, r.error or '')
")"
  echo "  result: $RESULT"
  echo "$RESULT" | grep -q "True" || fail "live send failed: $RESULT"
  if echo "$RESULT" | grep -q "god-mac-bluebubbles"; then
    pass "live send via BlueBubbles"
  elif echo "$RESULT" | grep -q "god-mac-applescript"; then
    echo "  ⚠ live send succeeded via AppleScript fallback, NOT BlueBubbles" >&2
    exit 2
  else
    fail "unexpected channel in: $RESULT"
  fi
fi

echo
echo "All BlueBubbles integration checks passed."
