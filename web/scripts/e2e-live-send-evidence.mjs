#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const base = process.env.CLAPCHEEKS_E2E_BASE_URL || 'http://127.0.0.1:3002'
const outputPath = process.env.CLAPCHEEKS_LIVE_SEND_EVIDENCE || '/tmp/clapcheeks-live-send-evidence.json'
const preflightPath = process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json'
const permission = process.env.CLAPCHEEKS_LIVE_SEND_PERMISSION || ''
const phone = process.env.CLAPCHEEKS_LIVE_SEND_PHONE || ''
const body = process.env.CLAPCHEEKS_LIVE_SEND_BODY || ''
const expectedLast4 = process.env.CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4 || ''
const sample2944Override = process.env.CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944 || ''
const preflightMaxAgeSeconds = Number(process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS || '900')
const requiredPermission = 'SEND LIVE TO JULIAN'
const sample2944OverridePhrase = 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION'

function writeEvidence(evidence) {
  writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    base,
    ...evidence,
  }, null, 2))
  console.log(`Evidence: ${outputPath}`)
}

async function jsonFetch(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text.slice(0, 1000) }
  }
  return { res, body: parsed }
}

function refusal(reason, missing = []) {
  writeEvidence({
    ok: false,
    refused: true,
    refusal_reason: reason,
    missing,
    live_send_performed: false,
    messages_db_verified: false,
    required_permission: requiredPermission,
  })
  console.log(`Refused live send: ${reason}`)
}

function sha256(value) {
  if (!value) return null
  return createHash('sha256').update(value).digest('hex')
}

function loadJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function validateInputs() {
  const missing = []
  if (permission !== requiredPermission) missing.push('CLAPCHEEKS_LIVE_SEND_PERMISSION')
  if (!phone) missing.push('CLAPCHEEKS_LIVE_SEND_PHONE')
  if (!body) missing.push('CLAPCHEEKS_LIVE_SEND_BODY')
  if (!expectedLast4) missing.push('CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4')
  if (missing.length > 0) {
    return { ok: false, reason: 'missing explicit live-send permission, destination, body, or expected last4', missing }
  }

  const digits = phone.replace(/\D/g, '')
  if (!/^\+?[0-9]{8,15}$/.test(phone.trim())) {
    return { ok: false, reason: 'destination phone must be E.164-ish digits only', missing: [] }
  }
  if (digits.slice(-4) !== expectedLast4) {
    return { ok: false, reason: 'destination last4 does not match explicit expected last4', missing: [] }
  }
  if (digits.slice(-4) === '2944' && sample2944Override !== sample2944OverridePhrase) {
    return {
      ok: false,
      reason: 'safe sample 2944 requires explicit sample-destination override',
      missing: ['CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944'],
    }
  }
  if (body.trim().length < 3) {
    return { ok: false, reason: 'message body is too short for a meaningful live-send test', missing: [] }
  }

  return { ok: true }
}

function validatePreflightEvidence() {
  const preflight = loadJson(preflightPath)
  if (!preflight) {
    return {
      ok: false,
      reason: 'matching live-send preflight evidence is required before live harness can run',
      missing: ['CLAPCHEEKS_LIVE_SEND_PREFLIGHT'],
      preflight,
    }
  }

  const currentHash = sha256(body)
  const currentLast4 = phone.replace(/\D/g, '').slice(-4)
  const currentLength = body.length
  const issues = []
  const generatedAtMs = Date.parse(preflight.generated_at || '')
  const ageSeconds = Number.isFinite(generatedAtMs) ? Math.floor((Date.now() - generatedAtMs) / 1000) : null
  if (preflight.ok_to_run_live_harness !== true) issues.push('preflight is not ready')
  if (preflight.no_send_performed !== true) issues.push('preflight must be no-send')
  if (preflight.no_dashboard_mutation_performed !== true) issues.push('preflight must not mutate dashboard state')
  if (preflight.validation?.message_sha256 !== currentHash) issues.push('preflight body SHA-256 does not match current body')
  if (preflight.validation?.message_length !== currentLength) issues.push('preflight body length does not match current body')
  if (preflight.validation?.phone_last4 !== currentLast4) issues.push('preflight destination last4 does not match current destination')
  if (ageSeconds === null) issues.push('preflight generated_at is missing or invalid')
  if (ageSeconds !== null && ageSeconds > preflightMaxAgeSeconds) {
    issues.push(`preflight is stale; regenerate within ${preflightMaxAgeSeconds} seconds of the live harness`)
  }

  return {
    ok: issues.length === 0,
    reason: issues.length > 0
      ? `matching live-send preflight evidence is required before live harness can run: ${issues.join('; ')}`
      : null,
    missing: [],
    preflight: {
      path: preflightPath,
      generated_at: preflight.generated_at || null,
      age_seconds: ageSeconds,
      max_age_seconds: preflightMaxAgeSeconds,
      ok_to_run_live_harness: preflight.ok_to_run_live_harness === true,
      no_send_performed: preflight.no_send_performed === true,
      no_dashboard_mutation_performed: preflight.no_dashboard_mutation_performed === true,
      phone_last4: preflight.validation?.phone_last4 || null,
      message_length: preflight.validation?.message_length ?? null,
      message_sha256: preflight.validation?.message_sha256 || null,
      issues,
    },
  }
}

async function cancelUnsentFixture(id) {
  if (!id) return { attempted: false, reason: 'missing_id' }
  try {
    const cancel = await jsonFetch(`/api/scheduled-messages/${id}`, { method: 'DELETE' })
    return {
      attempted: true,
      ok: cancel.res.ok && cancel.body?.message?.status === 'failed',
      status: cancel.body?.message?.status,
      rejection_reason: cancel.body?.message?.rejection_reason,
      response_status: cancel.res.status,
    }
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  const validation = validateInputs()
  if (!validation.ok) {
    refusal(validation.reason, validation.missing)
    return
  }

  const preflightValidation = validatePreflightEvidence()
  if (!preflightValidation.ok) {
    writeEvidence({
      ok: false,
      refused: true,
      refusal_reason: preflightValidation.reason,
      missing: preflightValidation.missing,
      live_send_performed: false,
      messages_db_verified: false,
      required_permission: requiredPermission,
      preflight_evidence: preflightValidation.preflight,
    })
    console.log(`Refused live send: ${preflightValidation.reason}`)
    return
  }

  const scheduledAt = new Date(Date.now() - 60_000).toISOString()
  const create = await jsonFetch('/api/scheduled-messages', {
    method: 'POST',
    body: JSON.stringify({
      match_name: `Live Send Evidence ${expectedLast4}`,
      platform: 'iMessage',
      phone,
      message_text: body,
      scheduled_at: scheduledAt,
      sequence_type: 'manual_live_evidence',
    }),
  })

  const id = create.body?.message?.id || create.body?.message?._id
  if (create.res.status !== 201 || !id) {
    writeEvidence({
      ok: false,
      live_send_performed: false,
      messages_db_verified: false,
      failure_step: 'create',
      response: create.body,
    })
    process.exit(1)
  }

  const approve = await jsonFetch(`/api/scheduled-messages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' }),
  })
  if (!approve.res.ok || approve.body?.message?.status !== 'approved') {
    const cleanup = await cancelUnsentFixture(id)
    writeEvidence({
      ok: false,
      live_send_performed: false,
      messages_db_verified: false,
      failure_step: 'approve',
      scheduled_message_id: id,
      cleanup,
      response: approve.body,
    })
    process.exit(1)
  }

  const send = await jsonFetch('/api/scheduled-messages/send', {
    method: 'POST',
    body: JSON.stringify({
      id,
      confirm_send: true,
      dry_run: false,
      live_send_phrase: 'SEND LIVE TO JULIAN',
    }),
  })

  const verification = send.body?.messages_db_verification
  const provenance = send.body?.send_provenance
  const expectedHash = sha256(body)
  const provenanceVerified = provenance?.source_label === 'clapcheeks_scheduled_messages_send_api' &&
    provenance?.route === 'POST /api/scheduled-messages/send' &&
    provenance?.phone_last4 === phone.replace(/\D/g, '').slice(-4) &&
    provenance?.message_length === body.length &&
    provenance?.message_sha256 === expectedHash &&
    typeof provenance?.request_id === 'string'
  const messagesDbVerified = verification?.checked === true && verification?.ok === true
  const sentStatus = send.body?.message?.status === 'sent'
  const ok = send.res.ok && sentStatus && messagesDbVerified && provenanceVerified
  const cleanup = ok ? { attempted: false, reason: 'verified_sent' } : await cancelUnsentFixture(id)

  writeEvidence({
    ok,
    refused: false,
    live_send_performed: send.res.ok && sentStatus,
    messages_db_verified: messagesDbVerified,
    scheduled_message_id: id,
    phone_last4: phone.replace(/\D/g, '').slice(-4),
    message_length: body.length,
    message_sha256: expectedHash,
    preflight_evidence: preflightValidation.preflight,
    send_provenance: provenance || null,
    send_provenance_verified: provenanceVerified,
    cleanup,
    response: {
      status: send.res.status,
      delay_minutes: send.body?.delay_minutes,
      god_draft_id: send.body?.god_draft_id,
      message_status: send.body?.message?.status,
      messages_db_verification: verification,
      error: send.body?.error,
    },
  })

  if (!ok) process.exit(1)
}

main().catch((error) => {
  writeEvidence({
    ok: false,
    live_send_performed: false,
    messages_db_verified: false,
    failure_step: 'unexpected_error',
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
