#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${CLAPCHEEKS_E2E_BASE_URL:-http://127.0.0.1:3002}"

echo "Safe ClapCheeks readiness suite against ${BASE_URL}"
echo "This suite does not perform a live outbound send."
echo

if ! curl -fsS "${BASE_URL}/dashboard" >/dev/null 2>&1; then
  echo "Dashboard is not reachable at ${BASE_URL}/dashboard" >&2
  echo "Start the env-backed server first:" >&2
  echo "  PORT=3002 CLAPCHEEKS_SELF_TEST_PHONE=+17578312944 npm run dev:runtime -- --hostname 127.0.0.1 --port 3002" >&2
  exit 1
fi

npm run test:e2e:browser
npm run test:e2e:safe
npm run test:e2e:backend-doctor
npm run test:e2e:runtime
npm run test:e2e:local-browser
set +e
npm run test:e2e:live:preflight
PREFLIGHT_STATUS=$?
set -e
node - <<'NODE'
const fs = require('node:fs')
const path = process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json'
const evidence = JSON.parse(fs.readFileSync(path, 'utf8'))
if (evidence.no_send_performed !== true || evidence.no_dashboard_mutation_performed !== true) {
  console.error('Live-send preflight did not prove no-send/no-mutation safety')
  process.exit(1)
}
NODE
if [ "$PREFLIGHT_STATUS" -eq 0 ]; then
  echo "Live-send preflight is ready; no send was performed."
else
  echo "Live-send preflight refused safely; no send was performed."
fi
npm run test:e2e:live:sample-preflight
npm run test:e2e:live:rehearsal
npm run test:e2e:live
npm run test:e2e:audit
npm run test:e2e:live:approval-packet
npm run test:e2e:evidence

echo
echo "Safe readiness suite complete. Overall completion remains gated by real live-send evidence."
