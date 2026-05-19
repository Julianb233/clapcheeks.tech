#!/usr/bin/env bash
set -euo pipefail
for RUNTIME_ENV in "$HOME/.clapcheeks-local/.env" "$HOME/.clapcheeks/.env"; do
  if [ -f "$RUNTIME_ENV" ]; then
    set -a
    . "$RUNTIME_ENV"
    set +a
  fi
done
export NEXT_PUBLIC_CONVEX_URL="${NEXT_PUBLIC_CONVEX_URL:-${CONVEX_URL:-}}"
export CONVEX_FLEET_USER_ID="${CONVEX_FLEET_USER_ID:-fleet-julian}"
export CLAPCHEEKS_OPERATOR_EMAIL="${CLAPCHEEKS_OPERATOR_EMAIL:-julianb233@gmail.com}"
exec npm run dev -- "$@"
