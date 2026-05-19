#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const base = process.env.CLAPCHEEKS_E2E_BASE_URL || 'http://127.0.0.1:3002'
const outputPath = process.env.CLAPCHEEKS_BACKEND_DOCTOR_EVIDENCE || '/tmp/clapcheeks-backend-doctor-2026-05-18.json'
const root = process.cwd()
const checks = []

function record(name, ok, detail = {}) {
  checks.push({ name, ok, detail })
  const status = ok ? '[ok]' : '[X]'
  console.log(`${status} ${name}${detail.summary ? ` -- ${detail.summary}` : ''}`)
}

async function jsonFetch(route) {
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

  const ok = [200, 503].includes(health.res.status) &&
    convexService?.status !== 'down' &&
    tokenHealth.res.ok &&
    tokenRowsRedacted &&
    analytics.res.ok &&
    analytics.body?.totals?.matches === 22 &&
    analytics.body?.totals?.conversations === 200 &&
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
    analytics_matches: analytics.body?.totals?.matches ?? null,
    analytics_conversations: analytics.body?.totals?.conversations ?? null,
    scheduled_status: scheduled.res.status,
    scheduled_count: scheduledRows.length,
    scheduled_counts: scheduledDerivedCounts,
    scheduled_rows_valid: scheduledRowsValid,
    imessage_status: imessage.res.status,
    imessage_gate_ready: imessageGate?.ready === true,
    imessage_gate_no_send: imessageGate?.no_send_performed === true,
    summary: ok
      ? `convex=${convexService.status} analytics=22/200 scheduled=${scheduledRows.length} no_send=true`
      : 'one or more backend route checks failed',
  })
}

console.log(`Safe ClapCheeks backend doctor against ${base}`)
console.log('This doctor is read-only and performs no live outbound send.')

verifyNoRuntimeSupabaseImports()
verifyConvexFacadeMappings()
await verifyEndpointMatrix()

const evidence = {
  ok: checks.every((item) => item.ok),
  generated_at: new Date().toISOString(),
  base_url: base,
  no_live_send_performed: true,
  no_dashboard_mutation_performed: true,
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
