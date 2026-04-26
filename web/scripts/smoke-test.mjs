#!/usr/bin/env node
// Lightweight smoke test for the production deployment. Runs no auth —
// just checks that public routes 200, authed routes 307→/login, and
// no route 500s. Run via:  node scripts/smoke-test.mjs [--prod | --local]

const TARGET = process.argv.includes('--local')
  ? 'http://localhost:3000'
  : 'https://clapcheeks.tech'

const PUBLIC_200 = ['/', '/login', '/signup', '/pricing']
const AUTH_307 = [
  '/dashboard', '/dashboard/roster', '/dashboard/matches',
  '/leads', '/conversation', '/intelligence', '/analytics',
  '/photos', '/coaching', '/ai-first-date', '/inbox',
  '/referrals', '/settings', '/settings/ai', '/billing', '/device',
]
const API_401 = [
  '/api/intelligence/stats', '/api/intelligence/ab-test',
  '/api/imessage/test', '/api/conversation/voice-profile',
  '/api/coaching/tips',
]
const CRON_401 = [
  '/api/cron/hot-reply-notify',
  '/api/cron/morning-brief',
]

let fail = 0
let pass = 0
const results = []

async function check(path, expected, label) {
  try {
    const res = await fetch(`${TARGET}${path}`, { redirect: 'manual' })
    const ok = res.status === expected
    results.push({ path, status: res.status, expected, ok, label })
    if (ok) pass++
    else fail++
  } catch (e) {
    results.push({ path, status: 'ERR', expected, ok: false, label, err: String(e).slice(0, 100) })
    fail++
  }
}

await Promise.all([
  ...PUBLIC_200.map(p => check(p, 200, 'public')),
  ...AUTH_307.map(p => check(p, 307, 'authed-gated')),
  ...API_401.map(p => check(p, 401, 'api-protected')),
  ...CRON_401.map(p => check(p, 401, 'cron-protected')),
])

results.sort((a, b) => (a.label > b.label ? 1 : -1))
for (const r of results) {
  const mark = r.ok ? '✓' : '✗'
  const padPath = r.path.padEnd(38)
  const padLabel = r.label.padEnd(16)
  console.log(`${mark} ${padLabel} ${padPath} ${r.status}${r.ok ? '' : ` (expected ${r.expected})`}${r.err ? ' ' + r.err : ''}`)
}
console.log(`\n${pass} pass · ${fail} fail · target ${TARGET}`)
process.exit(fail > 0 ? 1 : 0)
