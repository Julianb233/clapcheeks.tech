#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3002}"
HOST="${HOST:-127.0.0.1}"
BASE_URL="${CLAPCHEEKS_E2E_BASE_URL:-http://${HOST}:${PORT}}"
LOG_PATH="${CLAPCHEEKS_E2E_SERVER_LOG:-/tmp/clapcheeks-e2e-local-server.log}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use. Refusing to start a second local readiness server." >&2
  echo "Stop the existing process or run npm run test:e2e:readiness against it directly." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting env-backed local ClapCheeks server on ${BASE_URL}"
echo "Server log: ${LOG_PATH}"
PORT="$PORT" CLAPCHEEKS_SELF_TEST_PHONE="${CLAPCHEEKS_SELF_TEST_PHONE:-+17578312944}" \
  npm run dev:runtime -- --hostname "$HOST" --port "$PORT" >"$LOG_PATH" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS "${BASE_URL}/dashboard" >/dev/null 2>&1; then
    echo "Local server ready."
    CLAPCHEEKS_E2E_BASE_URL="$BASE_URL" npm run test:e2e:readiness
    exit 0
  fi

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "Local server exited before becoming ready. Last log lines:" >&2
    tail -80 "$LOG_PATH" >&2 || true
    exit 1
  fi

  sleep 1
done

echo "Timed out waiting for ${BASE_URL}/dashboard. Last log lines:" >&2
tail -80 "$LOG_PATH" >&2 || true
exit 1
