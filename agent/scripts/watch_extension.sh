#!/usr/bin/env bash
# Polls clapcheeks_agent_tokens.last_seen_at every 60s. When the
# julian-mbp-chrome row becomes fresh (seen within the last 5 min),
# runs snapshot_now.py for instagram and iMessages Julian a summary.
#
# Times out after 2h. Exits 0 on success, 1 on timeout, 2 on error.

set -eu

cd /opt/agency-workspace/clapcheeks.tech
# shellcheck disable=SC1091
set -a; source .env.local; set +a

DEVICE_NAME="${DEVICE_NAME:-julian-mbp-chrome}"
DEADLINE=$(( $(date +%s) + 7200 ))   # 2h
FRESH_SECONDS=300
POLL_INTERVAL=60

log() { echo "[$(date '+%H:%M:%S')] $*"; }

while :; do
  NOW=$(date +%s)
  if [ "$NOW" -gt "$DEADLINE" ]; then
    log "Timed out after 2h waiting for extension"
    god mac send "+16195090699" "clapcheeks extension watcher: 2h timeout. Extension never checked in. Make sure you loaded it in Chrome with the device token." 2>/dev/null || true
    exit 1
  fi

  # Get last_seen_at for the target device
  RESP=$(curl -s \
    "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/clapcheeks_agent_tokens?select=device_name,last_seen_at&device_name=eq.${DEVICE_NAME}&limit=1" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")

  LAST_SEEN=$(echo "$RESP" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['last_seen_at'] if rows and rows[0].get('last_seen_at') else '')" 2>/dev/null || echo "")

  if [ -n "$LAST_SEEN" ]; then
    AGE=$(python3 -c "
from datetime import datetime, timezone
ts = datetime.fromisoformat('$LAST_SEEN'.replace('Z','+00:00'))
print(int((datetime.now(timezone.utc) - ts).total_seconds()))
" 2>/dev/null || echo "99999")
    if [ "$AGE" -lt "$FRESH_SECONDS" ]; then
      log "Extension ACTIVE (${DEVICE_NAME} seen ${AGE}s ago). Running snapshot…"

      SNAPSHOT_OUT=$(PYTHONPATH=agent python3 agent/scripts/snapshot_now.py --timeout 180 --top-messages 5 2>&1 || true)
      log "Snapshot output:"
      echo "$SNAPSHOT_OUT"

      # Parse the most recent snapshot file for a compact summary
      SUMMARY=$(python3 -c "
import glob, json, os
files = sorted(glob.glob(os.path.expanduser('~/.clapcheeks/snapshots/snapshot-*.json')))
if not files:
    print('No snapshot file written')
else:
    data = json.load(open(files[-1]))
    p = data.get('platforms', {})
    h = p.get('hinge', {})
    i = p.get('instagram', {})
    t = p.get('tinder', {})
    def ok(d):
        if d.get('ok'):
            return 'OK'
        return 'FAIL: ' + str(d.get('reason',''))
    print(f\"Hinge: {ok(h)} ({h.get('matches_count', 0)} matches, {len([x for x in h.get('threads',[]) if x.get('ok')])} threads)\")
    print(f\"Instagram: {ok(i)} ({i.get('inbox_count', 0)} threads in inbox, {len(i.get('threads',[]))} fully pulled)\")
    print(f\"Tinder: {ok(t)} ({t.get('matches_count', 0)} matches)\")
" 2>&1 || echo "(summary parse failed)")

      god mac send "+16195090699" "clapcheeks snapshot ready

Extension came online, snapshot pulled:

${SUMMARY}

Full JSON: ~/.clapcheeks/snapshots/
VPS: /opt/agency-workspace/clapcheeks.tech" 2>/dev/null || log "iMessage failed"

      log "Done."
      exit 0
    fi
  fi

  log "Extension not yet active (last_seen=${LAST_SEEN:-never}). Sleeping ${POLL_INTERVAL}s…"
  sleep "$POLL_INTERVAL"
done
