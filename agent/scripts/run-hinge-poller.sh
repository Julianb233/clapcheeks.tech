#!/usr/bin/env bash
# run-hinge-poller.sh — AI-9500-C (AI-9507)
#
# Bash launcher for the Hinge SendBird message poller.
# Invoked by launchd every 300 seconds via tech.clapcheeks.hingepoller.plist.
#
# Behaviour
# ---------
# 1. Finds the Python interpreter inside the clapcheeks-local venv (or falls
#    back to the system python3).
# 2. Loads ~/.clapcheeks/.env for CONVEX_URL, HINGE_AUTH_TOKEN, etc.
# 3. Runs `python -m clapcheeks.intel.hinge_poller` (single poll cycle).
# 4. Logs the exit code and stdout/stderr to ~/.clapcheeks/hinge-poller.log
#    (capped at 5 000 lines via tail rotation).
#
# Note: this script intentionally does NOT invoke `launchctl load`.
# The plist is installed and loaded by the user manually (or by install.sh).

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"                 # ~/clapcheeks-local
LOG_FILE="${HOME}/.clapcheeks/hinge-poller.log"
MAX_LOG_LINES=5000

# ---------------------------------------------------------------------------
# Logging helper
# ---------------------------------------------------------------------------
log() {
    echo "$(date '+%Y-%m-%dT%H:%M:%S') [run-hinge-poller] $*" >> "$LOG_FILE"
}

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
mkdir -p "${HOME}/.clapcheeks"

# Load .env (soft-fail if absent)
ENV_FILE="${HOME}/.clapcheeks/.env"
if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
fi

# ---------------------------------------------------------------------------
# Python interpreter — prefer venv, fall back to system python3
# ---------------------------------------------------------------------------
VENV_PYTHON="${AGENT_DIR}/venv/bin/python"
if [[ -x "$VENV_PYTHON" ]]; then
    PYTHON="$VENV_PYTHON"
elif command -v python3 &>/dev/null; then
    PYTHON="python3"
else
    log "ERROR: No python3 found — aborting"
    exit 1
fi

# ---------------------------------------------------------------------------
# Run the poller
# ---------------------------------------------------------------------------
log "Starting Hinge poller (python=$PYTHON)"

cd "$AGENT_DIR"

OUTPUT=$("$PYTHON" -m clapcheeks.intel.hinge_poller 2>&1) || true
EXIT_CODE=$?

log "Exit code: $EXIT_CODE"
log "Output: $OUTPUT"

# Rotate log (keep last MAX_LOG_LINES lines)
if [[ -f "$LOG_FILE" ]]; then
    LINES=$(wc -l < "$LOG_FILE")
    if (( LINES > MAX_LOG_LINES )); then
        TMP=$(mktemp)
        tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "$TMP"
        mv "$TMP" "$LOG_FILE"
    fi
fi

exit "$EXIT_CODE"
