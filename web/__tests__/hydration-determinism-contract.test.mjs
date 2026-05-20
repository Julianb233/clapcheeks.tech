import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  communicationsConsole: readFileSync('app/(main)/communications/communications-console.tsx', 'utf8'),
  autonomyDashboard: readFileSync('app/(main)/autonomy/components/autonomy-dashboard.tsx', 'utf8'),
}

test('client timestamps use deterministic timezone formatting for hydration', () => {
  assert.match(files.communicationsConsole, /timeZone: 'UTC'/)
  assert.match(files.autonomyDashboard, /timeZone: 'UTC'/)
  assert.doesNotMatch(files.communicationsConsole, /toLocaleString\(undefined/)
  assert.doesNotMatch(files.autonomyDashboard, /toLocaleString\(/)
})
