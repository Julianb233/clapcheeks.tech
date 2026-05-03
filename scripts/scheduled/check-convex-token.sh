#!/usr/bin/env bash
# Fires ~23h after AI-9196 cutover. If Convex personal access token has expired,
# pings Julian with a one-tap action message. Linear: AI-9196.
set -euo pipefail
LOG=/opt/agency-workspace/.claude/logs/ai-9196-token-check.log
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) check-convex-token.sh ==="

TOKEN=$(op item get "CONVEX-personal-access-token-julian" --vault API-Keys --fields credential --reveal 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  echo "WARN: token not found in 1Password — sending alert"
  god mac --target macbook-pro send "+16195090699" "AI-9196: Convex personal token missing from 1Password. Refresh at dashboard.convex.dev/auth and paste here so I can save it." || true
  exit 0
fi

CODE=$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "https://api.convex.dev/api/dashboard/teams" || echo "000")
echo "convex teams check: $CODE"

if [ "$CODE" = "200" ]; then
  echo "token still valid — no action"
  exit 0
fi

# expired or revoked
god mac --target macbook-pro send "+16195090699" "AI-9196: Convex personal token expired. 1 tap: dashboard.convex.dev/auth → paste token in our chat → I save it. Deploy key still works for production, this is only for CLI access." || true
echo "expired alert sent"
