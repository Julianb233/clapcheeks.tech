#!/bin/bash
# Nightly chat.db sync. Pulls Julian's iMessage history from his MacBook Pro
# (or Mac Mini fallback) and pushes counts/ratios/messages/voice profile into
# Supabase. Designed to run on the VPS cron.
#
# Schedule example (root or any agency-group user):
#   30 5 * * * /opt/agency-workspace/clapcheeks.tech/scripts/nightly_chatdb_sync.sh \
#     >> /var/log/clapcheeks-chatdb.log 2>&1

set -euo pipefail

REPO=/opt/agency-workspace/clapcheeks.tech
DUMP=/tmp/chatdb_v2.json
LOG_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[$LOG_TS] starting chat.db nightly sync"

# Try MacBook Pro first (most current), fall back to Mac Mini.
HOST=""
for candidate in macbook-pro mac-mini; do
  if ssh -o BatchMode=yes -o ConnectTimeout=5 "$candidate" 'echo ok' >/dev/null 2>&1; then
    HOST="$candidate"
    break
  fi
done

if [ -z "$HOST" ]; then
  echo "[$LOG_TS] FATAL: no Mac reachable (tried macbook-pro, mac-mini)" >&2
  exit 1
fi
echo "[$LOG_TS] using $HOST"

# Push the puller (idempotent — overwrites on every run).
scp -q "$REPO/scripts/pull_chatdb.py" "$HOST:/tmp/pull_chatdb_v2.py"

# Run remotely. macOS python3 ships with pyobjc.
ssh "$HOST" "/usr/bin/python3 /tmp/pull_chatdb_v2.py" > "$DUMP"

bytes=$(wc -c < "$DUMP")
echo "[$LOG_TS] dumped $bytes bytes from $HOST"

# Push to Supabase.
python3 "$REPO/scripts/sync_chatdb_to_supabase.py"

echo "[$LOG_TS] done"
