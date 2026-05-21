import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  route: readFileSync('app/api/agent/status/route.ts', 'utf8'),
  badge: readFileSync('app/(main)/dashboard/components/agent-status-badge.tsx', 'utf8'),
}

test('agent status surfaces use the same five minute freshness window', () => {
  assert.match(files.route, /ONLINE_THRESHOLD_MS = 5 \* 60 \* 1000/)
  assert.match(files.badge, /ONLINE_THRESHOLD = 5 \* 60 \* 1000/)
  assert.match(files.route, /status: lastSeen \? \(online \? 'online' : 'stale'\) : 'no_convex_heartbeat'/)
})
