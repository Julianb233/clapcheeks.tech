#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const baseUrl = process.env.CLAPCHEEKS_E2E_BASE_URL || 'http://127.0.0.1:3002'
const outputPath = process.env.CLAPCHEEKS_LIVE_SEND_REHEARSAL || '/tmp/clapcheeks-live-send-rehearsal.json'
const source = process.env.CLAPCHEEKS_LIVE_SEND_REHEARSAL_SOURCE || 'sample'
const samplePreflightPath = process.env.CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT || '/tmp/clapcheeks-live-send-sample-preflight.json'
const livePreflightPath = process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json'
const samplePhone = '+17578312944'
const sampleBody = 'Safe ClapCheeks no-send preflight for 757 sample. Do not reply.'

function loadJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function redactPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return null
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}

function last4(value) {
  return String(value || '').replace(/\D/g, '').slice(-4)
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { parse_error: text.slice(0, 200) }
  }
  return { status: response.status, ok: response.ok, json }
}

function getPlan() {
  if (source === 'live') {
    const preflight = loadJson(livePreflightPath)
    return {
      source: 'live_env',
      preflight_path: livePreflightPath,
      preflight,
      phone: process.env.CLAPCHEEKS_LIVE_SEND_PHONE || '',
      body: process.env.CLAPCHEEKS_LIVE_SEND_BODY || '',
      expected_last4: preflight?.validation?.phone_last4 || process.env.CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4 || '',
      expected_sha256: preflight?.validation?.message_sha256 || null,
      preflight_ready: preflight?.ok_to_run_live_harness === true,
    }
  }

  const preflight = loadJson(samplePreflightPath)
  return {
    source: 'sample_757',
    preflight_path: samplePreflightPath,
    preflight,
    phone: samplePhone,
    body: sampleBody,
    expected_last4: preflight?.validation?.phone_last4 || '2944',
    expected_sha256: preflight?.validation?.message_sha256 || null,
    preflight_ready: preflight?.ok_to_run_live_harness === true,
  }
}

const evidence = {
  ok: false,
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  source,
  no_live_send_performed: true,
  dry_run_only: true,
  no_raw_phone_written: true,
  no_raw_body_written: true,
  preflight_path: null,
  preflight_ready: false,
  redacted_plan: null,
  create: null,
  approve: null,
  dry_run: null,
  cleanup: null,
  failures: [],
}

let fixtureId = null

async function cleanup() {
  if (!fixtureId) return
  const result = await request(`/api/scheduled-messages/${fixtureId}`, { method: 'DELETE' })
  evidence.cleanup = {
    ok: result.ok && result.json?.message?.status === 'failed',
    status: result.status,
    final_status: result.json?.message?.status || null,
    rejection_reason: result.json?.message?.rejection_reason || null,
  }
}

try {
  const plan = getPlan()
  evidence.source = plan.source
  evidence.preflight_path = plan.preflight_path
  evidence.preflight_ready = plan.preflight_ready
  evidence.redacted_plan = {
    destination: redactPhone(plan.phone),
    expected_last4: plan.expected_last4 || null,
    message_length: plan.body.length,
    message_sha256: plan.expected_sha256,
  }

  if (!plan.preflight_ready) evidence.failures.push('preflight is not ready for rehearsal')
  if (!plan.phone) evidence.failures.push('rehearsal phone is missing')
  if (!plan.body) evidence.failures.push('rehearsal body is missing')
  if (!plan.expected_sha256) evidence.failures.push('preflight message hash is missing')
  if (last4(plan.phone) !== plan.expected_last4) evidence.failures.push('rehearsal phone last4 does not match preflight')

  if (evidence.failures.length === 0) {
    const scheduledAt = new Date(Date.now() - 60_000).toISOString()
    const created = await request('/api/scheduled-messages', {
      method: 'POST',
      body: JSON.stringify({
        match_name: `Safe Live Rehearsal ${plan.expected_last4}`,
        platform: 'iMessage',
        phone: plan.phone,
        message_text: plan.body,
        scheduled_at: scheduledAt,
        sequence_type: 'manual',
      }),
    })
    fixtureId = created.json?.message?.id || created.json?.message?._id || null
    evidence.create = {
      ok: created.ok && Boolean(fixtureId),
      status: created.status,
      id_present: Boolean(fixtureId),
      row_status: created.json?.message?.status || null,
    }
    if (!evidence.create.ok) evidence.failures.push('scheduled rehearsal create failed')

    if (fixtureId) {
      const approved = await request(`/api/scheduled-messages/${fixtureId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved' }),
      })
      evidence.approve = {
        ok: approved.ok && approved.json?.message?.status === 'approved',
        status: approved.status,
        row_status: approved.json?.message?.status || null,
      }
      if (!evidence.approve.ok) evidence.failures.push('scheduled rehearsal approve failed')
    }

    if (fixtureId && evidence.approve?.ok) {
      const dryRun = await request('/api/scheduled-messages/send', {
        method: 'POST',
        body: JSON.stringify({
          id: fixtureId,
          confirm_send: true,
          dry_run: true,
        }),
      })
      const provenance = dryRun.json?.send_provenance || {}
      const wouldSend = dryRun.json?.would_send || {}
      const hashMatch = provenance.message_sha256 === plan.expected_sha256 && wouldSend.message_sha256 === plan.expected_sha256
      const last4Match = provenance.phone_last4 === plan.expected_last4 && wouldSend.phone_last4 === plan.expected_last4
      const immediateAdapter = wouldSend.adapter === 'osascript Messages.send'
      evidence.dry_run = {
        ok: dryRun.ok && dryRun.json?.dry_run === true && hashMatch && last4Match && immediateAdapter,
        status: dryRun.status,
        route_dry_run: dryRun.json?.dry_run === true,
        source_label: provenance.source_label || null,
        adapter: wouldSend.adapter || null,
        immediate_adapter: immediateAdapter,
        message_sha256_match: hashMatch,
        destination_last4_match: last4Match,
        message_length_match: wouldSend.message_length === plan.body.length,
        approved_row: dryRun.json?.verified?.approved_row === true,
        send_confirmation_present: dryRun.json?.verified?.send_confirmation_present === true,
      }
      if (!evidence.dry_run.ok) evidence.failures.push('scheduled rehearsal dry-run did not match preflight')
    }
  }
} catch (error) {
  evidence.failures.push(error instanceof Error ? error.message : String(error))
} finally {
  try {
    await cleanup()
  } catch (error) {
    evidence.cleanup = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

evidence.ok = evidence.failures.length === 0 &&
  evidence.create?.ok === true &&
  evidence.approve?.ok === true &&
  evidence.dry_run?.ok === true &&
  evidence.cleanup?.ok === true

const serialized = JSON.stringify(evidence)
if (serialized.includes(samplePhone) || serialized.includes(sampleBody)) {
  evidence.ok = false
  evidence.no_raw_phone_written = !serialized.includes(samplePhone)
  evidence.no_raw_body_written = !serialized.includes(sampleBody)
  evidence.failures.push('raw sample phone/body leaked into rehearsal evidence')
}

writeFileSync(outputPath, JSON.stringify(evidence, null, 2))

console.log(`Live-send no-send rehearsal: ${evidence.ok ? 'PASS' : 'FAIL'}`)
console.log(`Evidence: ${outputPath}`)
console.log(`Source: ${evidence.source}`)
console.log(`No live send performed: ${evidence.no_live_send_performed}`)
if (evidence.redacted_plan) {
  console.log(`Plan: destination=${evidence.redacted_plan.destination} sha256=${evidence.redacted_plan.message_sha256 || 'missing'} length=${evidence.redacted_plan.message_length}`)
}
if (evidence.dry_run) {
  console.log(`Dry run: adapter=${evidence.dry_run.adapter} hash_match=${evidence.dry_run.message_sha256_match} last4_match=${evidence.dry_run.destination_last4_match}`)
}
if (evidence.cleanup) console.log(`Cleanup: ok=${evidence.cleanup.ok} final_status=${evidence.cleanup.final_status || 'unknown'}`)
if (evidence.failures.length) console.log(`Failures: ${evidence.failures.join('; ')}`)

if (!evidence.ok) process.exit(1)
