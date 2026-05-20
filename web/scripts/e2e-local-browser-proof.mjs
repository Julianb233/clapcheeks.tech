#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const baseUrl = (process.env.CLAPCHEEKS_E2E_BASE_URL || 'http://127.0.0.1:3002').replace(/\/$/, '')
const outputPath = process.env.CLAPCHEEKS_LOCAL_BROWSER_PROOF || '/tmp/clapcheeks-local-browser-proof-2026-05-18.json'
const chromeDebugUrl = (process.env.CLAPCHEEKS_CCT_DEBUG_URL || 'http://127.0.0.1:9223').replace(/\/$/, '')
const useCct = process.env.CLAPCHEEKS_LOCAL_BROWSER_USE_CCT === '1' || /^https:\/\/clapcheeks\.tech\b/.test(baseUrl)
const forbiddenFixtureTerms = [
  'Safe Browser Proof 2944',
  'Safe browser proof only. Do not send.',
]

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 0
    this.pending = new Map()
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !this.pending.has(message.id)) return
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    })
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.ws.close()
  }
}

async function fetchDebugJson(url) {
  const response = await fetch(url)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON from ${url}; status=${response.status}`)
  }
}

async function getCctTab() {
  const tabs = await fetchDebugJson(`${chromeDebugUrl}/json`)
  const existing = Array.isArray(tabs) ? tabs.find((tab) => String(tab.url || '').startsWith(baseUrl)) : null
  if (existing?.webSocketDebuggerUrl) return existing
  return fetchDebugJson(`${chromeDebugUrl}/json/new?${baseUrl}/analytics`)
}

let cctClient = null

async function getCctClient() {
  if (cctClient) return cctClient
  const tab = await getCctTab()
  if (!tab.webSocketDebuggerUrl) throw new Error(`CCT tab did not expose a debugger URL from ${chromeDebugUrl}`)
  cctClient = new CdpClient(tab.webSocketDebuggerUrl)
  await cctClient.open()
  await cctClient.send('Page.enable')
  await cctClient.send('Runtime.enable')
  return cctClient
}

async function openChromeLocalRoute(path) {
  if (useCct) {
    const client = await getCctClient()
    await client.send('Page.navigate', { url: `${baseUrl}${path}` })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    return
  }

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
  if (useCct) {
    const client = await getCctClient()
    const result = await client.send('Runtime.evaluate', {
      expression: `({ url: location.href, title: document.title })`,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }

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
  if (useCct) {
    const client = await getCctClient()
    const result = await client.send('Runtime.evaluate', {
      expression: `fetch(${JSON.stringify(path)}, {
        credentials: 'include',
        headers: { accept: 'application/json' },
        cache: 'no-store'
      }).then(async (response) => {
        const text = await response.text()
        let json = null
        try { json = JSON.parse(text) } catch {}
        return { status: response.status, ok: response.ok, body_length: text.length, json }
      })`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return {
      url: `${baseUrl}${path}`,
      ...result.result.value,
    }
  }

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
  typeof analyticsCounts.matches === 'number' &&
  analyticsCounts.matches >= 0 &&
  typeof analyticsCounts.conversations === 'number' &&
  analyticsCounts.conversations >= 0

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
    analytics_matches_numeric: typeof analyticsCounts.matches === 'number' && analyticsCounts.matches >= 0,
    analytics_conversations_numeric: typeof analyticsCounts.conversations === 'number' && analyticsCounts.conversations >= 0,
  },
}

writeFileSync(outputPath, JSON.stringify(proof, null, 2))

console.log(`Local browser proof: ${ok ? 'PASS' : 'FAIL'}`)
console.log(`Evidence: ${outputPath}`)
console.log(`Chrome: route=${activeRoute || 'n/a'} title=${chrome.title || 'n/a'}`)
console.log(`Scheduled: pending=${scheduledCounts.pending} approved=${scheduledCounts.approved} sent=${scheduledCounts.sent} failed=${scheduledCounts.failed} forbidden_fixture_present=${scheduledCounts.forbidden_fixture_present}`)
console.log(`Analytics: matches=${analyticsCounts.matches ?? 'n/a'} conversations=${analyticsCounts.conversations ?? 'n/a'} rizz=${analyticsCounts.rizz_score ?? 'n/a'}`)

if (cctClient) cctClient.close()
if (!ok) process.exit(1)
