#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const base = process.env.CLAPCHEEKS_E2E_BASE_URL || 'http://127.0.0.1:3002'
const outputPath = process.env.CLAPCHEEKS_BACKEND_DOCTOR_EVIDENCE || '/tmp/clapcheeks-backend-doctor-2026-05-18.json'
const chromeDebugUrl = (process.env.CLAPCHEEKS_CCT_DEBUG_URL || 'http://127.0.0.1:9223').replace(/\/$/, '')
const useCct = process.env.CLAPCHEEKS_BACKEND_DOCTOR_USE_CCT === '1' || /^https:\/\/clapcheeks\.tech\b/.test(base)
const root = process.cwd()
const checks = []

function record(name, ok, detail = {}) {
  checks.push({ name, ok, detail })
  const status = ok ? '[ok]' : '[X]'
  console.log(`${status} ${name}${detail.summary ? ` -- ${detail.summary}` : ''}`)
}

async function jsonFetch(route) {
  if (useCct) return cctJsonFetch(route)
  const res = await fetch(`${base}${route}`, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 1000) }
  }
  return { res, body }
}

async function fetchJson(url) {
  const response = await fetch(url)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON from ${url}; got status ${response.status}`)
  }
}

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

async function getCctTab() {
  const tabs = await fetchJson(`${chromeDebugUrl}/json`)
  const existing = Array.isArray(tabs) ? tabs.find((tab) => String(tab.url || '').startsWith(base)) : null
  if (existing?.webSocketDebuggerUrl) return existing
  return fetchJson(`${chromeDebugUrl}/json/new?${base}/dashboard`)
}

let cctClient = null
let cctClientPromise = null

async function getCctClient() {
  if (!cctClient) {
    if (cctClientPromise) return cctClientPromise
    cctClientPromise = (async () => {
      const tab = await getCctTab()
      if (!tab.webSocketDebuggerUrl) throw new Error(`CCT tab did not expose a debugger URL from ${chromeDebugUrl}`)
      cctClient = new CdpClient(tab.webSocketDebuggerUrl)
      await cctClient.open()
      await cctClient.send('Runtime.enable')
      return cctClient
    })()
    return cctClientPromise
  }
  return cctClient
}

async function cctJsonFetch(route) {
  const client = await getCctClient()
  const result = await client.send('Runtime.evaluate', {
    expression: `fetch(${JSON.stringify(route)}, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store'
    }).then(async (response) => {
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      return { status: response.status, ok: response.ok, body: json, raw: text.slice(0, 1000) }
    })`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  const value = result.result.value
  return {
    res: { status: value.status, ok: value.ok },
    body: value.body ?? { raw: value.raw },
  }
}

function walkFiles(dir, files = []) {
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'dist', 'coverage'].includes(entry)) continue
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walkFiles(full, files)
    else if (/\.(cjs|mjs|js|jsx|ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

function verifyNoRuntimeSupabaseImports() {
  const roots = ['app', 'components', 'lib', 'middleware.ts']
  const files = roots.flatMap((item) => {
    const full = path.join(root, item)
    if (!existsSync(full)) return []
    return statSync(full).isDirectory() ? walkFiles(full) : [full]
  })
  const offenders = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (file.includes(`${path.sep}lib${path.sep}convex${path.sep}`)) continue
    if (/(from\s+['"]@supabase\/supabase-js['"]|import\(['"]@supabase\/supabase-js['"]|@\/lib\/supabase|lib\/supabase)/.test(source)) {
      offenders.push(path.relative(root, file))
    }
  }
  record('no runtime Supabase imports in dashboard path', offenders.length === 0, {
    scanned_files: files.length,
    offenders,
    summary: offenders.length === 0 ? `${files.length} files scanned` : `offenders=${offenders.join(',')}`,
  })
}

function verifyConvexFacadeMappings() {
  const compatPath = path.join(root, 'lib/convex/compat-client.ts')
  const httpPath = path.join(root, 'lib/convex/http.ts')
  const compat = readFileSync(compatPath, 'utf8')
  const http = readFileSync(httpPath, 'utf8')
  const requiredReadTables = [
    'conversations',
    'clapcheeks_conversations',
    'clapcheeks_matches',
    'clapcheeks_leads',
    'devices',
    'approval_queue',
    'clapcheeks_queued_replies',
    'outbound_scheduled_messages',
  ]
  const requiredFunctions = [
    'conversations:listForUser',
    'matches:listForUser',
    'devices:listForUser',
    'queues:listApprovalsForUser',
    'queues:listRepliesForUser',
    'outbound:listForUser',
    'outbound:enqueueScheduledMessage',
    'outbound:updateScheduled',
    'outbound:markSent',
    'outbound:markFailed',
    'queues:enqueueReply',
    'queues:decideApproval',
    'matches:upsertByExternal',
    'matches:patch',
  ]
  const missingTables = requiredReadTables.filter((name) => !compat.includes(`${name}:`) && !compat.includes(`"${name}"`) && !compat.includes(`'${name}'`))
  const missingFunctions = requiredFunctions.filter((name) => !compat.includes(name) && !http.includes(name))
  const rejectsFakeWrites = compat.includes('refusing fake write') && compat.includes('UNMAPPED_CONVEX_WRITE')
  const convexHealthUsesLiveQuery = http.includes('convexHealth') && http.includes('conversations:listForUser')
  const ok = missingTables.length === 0 && missingFunctions.length === 0 && rejectsFakeWrites && convexHealthUsesLiveQuery
  record('Convex facade mapping coverage', ok, {
    missing_tables: missingTables,
    missing_functions: missingFunctions,
    rejects_fake_writes: rejectsFakeWrites,
    convex_health_uses_live_query: convexHealthUsesLiveQuery,
    summary: ok ? `${requiredReadTables.length} read tables and ${requiredFunctions.length} functions covered` : 'mapping coverage incomplete',
  })
}

async function verifyEndpointMatrix() {
  const [health, tokenHealth, analytics, scheduled, imessage] = await Promise.all([
    jsonFetch('/api/health?detailed=true'),
    jsonFetch('/api/agent/token-health'),
    jsonFetch('/api/analytics/summary?days=30'),
    jsonFetch('/api/scheduled-messages?status=all&limit=100'),
    jsonFetch('/api/imessage/test'),
  ])

  const services = Array.isArray(health.body?.services) ? health.body.services : []
  const convexService = services.find((service) => service.service === 'convex')
  const tokenPlatforms = Array.isArray(tokenHealth.body?.platforms) ? tokenHealth.body.platforms : []
  const tokenRowsRedacted = tokenPlatforms.every((platform) => (
    !Object.prototype.hasOwnProperty.call(platform, 'token') &&
    !Object.prototype.hasOwnProperty.call(platform, 'access_token') &&
    !Object.prototype.hasOwnProperty.call(platform, 'refresh_token')
  ))
  const scheduledRows = Array.isArray(scheduled.body?.messages) ? scheduled.body.messages : []
  const scheduledDerivedCounts = scheduledRows.reduce((counts, message) => {
    const status = String(message.status || 'unknown')
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, {})
  const scheduledRowsValid = scheduledRows.every((message) => (
    typeof message.id === 'string' &&
    typeof message.status === 'string' &&
    typeof message.match_name === 'string'
  ))
  const scheduledCountsValid = ['pending', 'approved', 'sent', 'failed'].every((key) => typeof (scheduledDerivedCounts[key] || 0) === 'number')
  const imessageGate = imessage.body?.live_send_gate
  const analyticsMatches = analytics.body?.totals?.matches
  const analyticsConversations = analytics.body?.totals?.conversations

  const ok = [200, 503].includes(health.res.status) &&
    convexService?.status !== 'down' &&
    tokenHealth.res.ok &&
    tokenRowsRedacted &&
    analytics.res.ok &&
    typeof analyticsMatches === 'number' &&
    analyticsMatches >= 0 &&
    typeof analyticsConversations === 'number' &&
    analyticsConversations >= 0 &&
    scheduled.res.ok &&
    scheduledRowsValid &&
    scheduledCountsValid &&
    imessage.res.ok &&
    imessageGate?.no_send_performed === true &&
    imessageGate?.ready === false

  record('backend API route matrix', ok, {
    health_status: health.res.status,
    convex_status: convexService?.status || null,
    token_status: tokenHealth.res.status,
    token_rows_redacted: tokenRowsRedacted,
    missing_required: tokenHealth.body?.missing_required ?? null,
    analytics_status: analytics.res.status,
    analytics_matches: analyticsMatches ?? null,
    analytics_conversations: analyticsConversations ?? null,
    scheduled_status: scheduled.res.status,
    scheduled_count: scheduledRows.length,
    scheduled_counts: scheduledDerivedCounts,
    scheduled_rows_valid: scheduledRowsValid,
    imessage_status: imessage.res.status,
    imessage_gate_ready: imessageGate?.ready === true,
    imessage_gate_no_send: imessageGate?.no_send_performed === true,
    summary: ok
      ? `convex=${convexService.status} analytics=${analyticsMatches}/${analyticsConversations} scheduled=${scheduledRows.length} no_send=true`
      : 'one or more backend route checks failed',
  })
}

console.log(`Safe ClapCheeks backend doctor against ${base}`)
console.log('This doctor is read-only and performs no live outbound send.')
if (useCct) console.log(`Using authenticated CCT browser fetch via ${chromeDebugUrl}.`)

verifyNoRuntimeSupabaseImports()
verifyConvexFacadeMappings()
try {
  await verifyEndpointMatrix()
} finally {
  cctClient?.close()
}

const evidence = {
  ok: checks.every((item) => item.ok),
  generated_at: new Date().toISOString(),
  base_url: base,
  no_live_send_performed: true,
  no_dashboard_mutation_performed: true,
  authenticated_cct_fetch: useCct,
  chrome_debug_url: useCct ? chromeDebugUrl : null,
  checked_scope: [
    'runtime import boundaries',
    'Convex facade read/write mapping coverage',
    'health/token analytics/scheduled/iMessage metadata API matrix',
  ],
  checks,
}

writeFileSync(outputPath, JSON.stringify(evidence, null, 2))
console.log(`Evidence: ${outputPath}`)

if (!evidence.ok) process.exit(1)
