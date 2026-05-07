#!/usr/bin/env bash
# AI-9500-C (AI-9502) — Hinge SendBird poller wrapper
#
# Activates the clapcheeks venv, loads ~/.clapcheeks/.env, and runs the
# Hinge message poller. Designed for launchd StartInterval invocation.
#
# Usage:
#   bash run-hinge-poller.sh
#
# Environment variables loaded (in order of precedence):
#   1. ~/.clapcheeks/.env            (per-user secrets: HINGE_AUTH_TOKEN etc.)
#   2. Shell environment at invocation time

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAPCHEEKS_ENV_FILE="$HOME/.clapcheeks/.env"
VENV_PATH="$AGENT_DIR/.venv"
LOG_DIR="$HOME/.clapcheeks"

# ---------------------------------------------------------------------------
# Logging helper
# ---------------------------------------------------------------------------
log() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") [hinge-poller] $*" >&2
}

# ---------------------------------------------------------------------------
# Load .env (source it so env vars are available to Python subprocess)
# ---------------------------------------------------------------------------
if [[ -f "$CLAPCHEEKS_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$CLAPCHEEKS_ENV_FILE" 2>/dev/null || true
  set +a
  log "Loaded $CLAPCHEEKS_ENV_FILE"
else
  log "No .env at $CLAPCHEEKS_ENV_FILE — relying on shell environment"
fi

# ---------------------------------------------------------------------------
# CONVEX_URL: fall back to well-known deployment if not set
# ---------------------------------------------------------------------------
if [[ -z "${CONVEX_URL:-}" ]]; then
  log "CONVEX_URL not set in environment — set it in ~/.clapcheeks/.env"
fi

# ---------------------------------------------------------------------------
# Activate virtual environment
# ---------------------------------------------------------------------------
if [[ -f "$VENV_PATH/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$VENV_PATH/bin/activate"
  log "Activated venv: $VENV_PATH"
elif command -v python3 &>/dev/null; then
  log "No venv found at $VENV_PATH — using system python3"
else
  log "ERROR: python3 not found. Install clapcheeks dependencies first."
  exit 1
fi

# ---------------------------------------------------------------------------
# Run the poller
# ---------------------------------------------------------------------------
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/hinge-poller.log"

log "Starting Hinge poller (agent_dir=$AGENT_DIR)"
cd "$AGENT_DIR"

python3 -m clapcheeks.intel.hinge_poller 2>>"$LOG_FILE"
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  log "Hinge poller exited with code $EXIT_CODE (see $LOG_FILE)"
fi

exit $EXIT_CODE
