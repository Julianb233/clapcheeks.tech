#!/usr/bin/env bash
# Fires 7d after AI-9196 cutover. Verifies Convex deployment health, row counts.
# If verified, asks Julian for OK before dropping deprecated PG tables. Linear: AI-9196.
set -euo pipefail
LOG=/opt/agency-workspace/.claude/logs/ai-9196-soak-verify.log
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) soak-verify-convex.sh ==="

DEPLOY_KEY=$(op item get "CONVEX-clapcheeks-dev-admin-key" --vault API-Keys --fields credential --reveal 2>/dev/null || echo "")
if [ -z "$DEPLOY_KEY" ]; then
  echo "FATAL: deploy key missing"
  god mac --target macbook-pro send "+16195090699" "AI-9196 soak: Convex deploy key missing from 1Password. Investigation needed." || true
  exit 1
fi

# 1. Function spec — should return ~20 functions
FN_COUNT=$(CONVEX_DEPLOY_KEY="$DEPLOY_KEY" cd /opt/agency-workspace/clapcheeks.tech/web && npx convex function-spec 2>/dev/null | python3 -c "
import json, sys
text = sys.stdin.read()
idx = text.find('{')
d = json.loads(text[idx:]) if idx >= 0 else {}
fns = set(f.get('identifier','') for f in d.get('functions',[]))
print(len(fns))
" || echo "0")
echo "function count: $FN_COUNT"

# 2. Table row counts — call public mutations
USER_ID="9c848c51-8996-4f1f-9dbf-50128e3408ea"
CONV_COUNT=$(curl -sS -X POST -H "Authorization: Convex $DEPLOY_KEY" -H "Content-Type: application/json" \
  "https://valiant-oriole-651.convex.cloud/api/run/conversations/listForUser" \
  -d "{\"args\":{\"user_id\":\"$USER_ID\"},\"format\":\"json\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
val = d.get('value', d)
print(len(val) if isinstance(val, list) else 0)
" || echo "0")
echo "conversation count: $CONV_COUNT"

JOB_COUNT=$(curl -sS -X POST -H "Authorization: Convex $DEPLOY_KEY" -H "Content-Type: application/json" \
  "https://valiant-oriole-651.convex.cloud/api/run/agent_jobs/listForUser" \
  -d "{\"args\":{\"user_id\":\"$USER_ID\"},\"format\":\"json\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
val = d.get('value', d)
print(len(val) if isinstance(val, list) else 0)
" || echo "0")
echo "agent_jobs count: $JOB_COUNT"

# Decide
HEALTHY=true
[ "$FN_COUNT" -lt 18 ] && HEALTHY=false
[ "$CONV_COUNT" -lt 3 ] && HEALTHY=false
[ "$JOB_COUNT" -lt 50 ] && HEALTHY=false

if [ "$HEALTHY" = "true" ]; then
  god mac --target macbook-pro send "+16195090699" "AI-9196 soak verify: Convex healthy after 7d. Functions=$FN_COUNT, conversations=$CONV_COUNT, agent_jobs=$JOB_COUNT. Reply YES to drop deprecated PG tables (clapcheeks_scheduled_messages, clapcheeks_agent_jobs). Don't drop without your OK." || true
  echo "verified — awaiting Julian's drop OK"
else
  god mac --target macbook-pro send "+16195090699" "AI-9196 soak verify FAILED. Functions=$FN_COUNT (expected ≥18), conversations=$CONV_COUNT (≥3), agent_jobs=$JOB_COUNT (≥50). Investigating + filing bug." || true
  bash /opt/agency-workspace/scripts/escalate-bug-to-linear.sh \
    --title "AI-9196 soak verify failed: Convex counts off after 7d" \
    --priority 2 \
    --system fleet-hooks \
    --description-file <(echo "FN_COUNT=$FN_COUNT CONV_COUNT=$CONV_COUNT JOB_COUNT=$JOB_COUNT — see /opt/agency-workspace/.claude/logs/ai-9196-soak-verify.log") \
    --fix-already-deployed no || true
  echo "FAILED — escalated"
fi
