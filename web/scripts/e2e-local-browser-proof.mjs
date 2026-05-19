#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const baseUrl = (process.env.CLAPCHEEKS_E2E_BASE_URL || 'http://127.0.0.1:3002').replace(/\/$/, '')
const outputPath = process.env.CLAPCHEEKS_LOCAL_BROWSER_PROOF || '/tmp/clapcheeks-local-browser-proof-2026-05-18.json'
const forbiddenFixtureTerms = [
  'Safe Browser Proof 2944',
  'Safe browser proof only. Do not send.',
]

async function openChromeLocalRoute(path) {
  const targetUrl = `${baseUrl}${path}`
  const script = `
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then
    make new window
  end if
  set URL of active tab of front window to "${targetUrl}"
end tell
`
  await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

async function getChromeActiveTab() {
  const script = `
tell application "Google Chrome"
  if (count of windows) = 0 then
    return "NO_WINDOWS"
  end if
  set tabUrl to URL of active tab of front window
  set tabTitle to title of active tab of front window
  return tabUrl & linefeed & tabTitle
end tell
`
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  })
  const [url = '', title = ''] = stdout.trim().split('\n')
  return { url, title }
}

async function fetchJson(path) {
  const url = `${baseUrl}${path}`
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // Keep JSON null and report status/body length only.
  }
  return {
    url,
    status: response.status,
    ok: response.ok,
    body_length: text.length,
    json,
  }
}

function scheduledSummary(json) {
  const rows = Array.isArray(json?.messages) ? json.messages : []
  const serialized = JSON.stringify(rows)
  return {
    returned: rows.length,
    pending: rows.filter((row) => row.status === 'pending').length,
    approved: rows.filter((row) => row.status === 'approved').length,
    sent: rows.filter((row) => row.status === 'sent').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    forbidden_fixture_present: forbiddenFixtureTerms.some((term) => serialized.includes(term)),
  }
}

function analyticsSummary(json) {
  return {
    matches: json?.totals?.matches ?? null,
    conversations: json?.totals?.conversations ?? null,
    dates_booked: json?.totals?.dates_booked ?? null,
    rizz_score: json?.rizzScore ?? null,
    platform_count: json?.platforms && typeof json.platforms === 'object' ? Object.keys(json.platforms).length : null,
    time_series_rows: Array.isArray(json?.timeSeries) ? json.timeSeries.length : null,
  }
}

await openChromeLocalRoute('/analytics')
const chrome = await getChromeActiveTab()
const scheduled = await fetchJson('/api/scheduled-messages?status=all&limit=100')
const analytics = await fetchJson('/api/analytics/summary?days=30')
const scheduledCounts = scheduledSummary(scheduled.json)
const analyticsCounts = analyticsSummary(analytics.json)

const activeUrlMatchesLocalApp = chrome.url.startsWith(`${baseUrl}/`)
const activeRoute = activeUrlMatchesLocalApp ? new URL(chrome.url).pathname : null
const ok =
  activeUrlMatchesLocalApp &&
  scheduled.ok &&
  analytics.ok &&
  scheduledCounts.pending === 0 &&
  scheduledCounts.approved === 0 &&
  scheduledCounts.forbidden_fixture_present === false &&
  analyticsCounts.matches === 22 &&
  analyticsCounts.conversations === 200

const proof = {
  ok,
  generated_at: new Date().toISOString(),
  output_path: outputPath,
  no_live_send_performed: true,
  no_dashboard_mutation_performed: true,
  chrome: {
    active_url: chrome.url,
    active_title: chrome.title,
    active_url_matches_local_app: activeUrlMatchesLocalApp,
    active_route: activeRoute,
  },
  scheduled: {
    api_status: scheduled.status,
    counts: scheduledCounts,
  },
  analytics: {
    api_status: analytics.status,
    summary: analyticsCounts,
  },
  assertions: {
    chrome_tab_on_local_app: activeUrlMatchesLocalApp,
    scheduled_api_reachable: scheduled.ok,
    analytics_api_reachable: analytics.ok,
    no_pending_or_approved_browser_draft: scheduledCounts.pending === 0 && scheduledCounts.approved === 0,
    browser_proof_fixture_absent: scheduledCounts.forbidden_fixture_present === false,
    analytics_matches_expected: analyticsCounts.matches === 22,
    analytics_conversations_expected: analyticsCounts.conversations === 200,
  },
}

writeFileSync(outputPath, JSON.stringify(proof, null, 2))

console.log(`Local browser proof: ${ok ? 'PASS' : 'FAIL'}`)
console.log(`Evidence: ${outputPath}`)
console.log(`Chrome: route=${activeRoute || 'n/a'} title=${chrome.title || 'n/a'}`)
console.log(`Scheduled: pending=${scheduledCounts.pending} approved=${scheduledCounts.approved} sent=${scheduledCounts.sent} failed=${scheduledCounts.failed} forbidden_fixture_present=${scheduledCounts.forbidden_fixture_present}`)
console.log(`Analytics: matches=${analyticsCounts.matches ?? 'n/a'} conversations=${analyticsCounts.conversations ?? 'n/a'} rizz=${analyticsCounts.rizz_score ?? 'n/a'}`)

if (!ok) process.exit(1)
