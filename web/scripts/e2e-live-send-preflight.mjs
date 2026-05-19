#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const outputPath = process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json'
const auditPath = process.env.CLAPCHEEKS_COMPLETION_AUDIT || '/tmp/clapcheeks-completion-audit-2026-05-18.json'
const liveEvidencePath = process.env.CLAPCHEEKS_LIVE_SEND_EVIDENCE || '/tmp/clapcheeks-live-send-evidence.json'
const permission = process.env.CLAPCHEEKS_LIVE_SEND_PERMISSION || ''
const phone = process.env.CLAPCHEEKS_LIVE_SEND_PHONE || ''
const body = process.env.CLAPCHEEKS_LIVE_SEND_BODY || ''
const expectedLast4 = process.env.CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4 || ''
const sample2944Override = process.env.CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944 || ''
const requiredPermission = 'SEND LIVE TO JULIAN'
const sample2944OverridePhrase = 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION'

function loadJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function redactPhone(value) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}

function sha256(value) {
  if (!value) return null
  return createHash('sha256').update(value).digest('hex')
}

function validationResult() {
  const missing = []
  if (permission !== requiredPermission) missing.push('CLAPCHEEKS_LIVE_SEND_PERMISSION')
  if (!phone) missing.push('CLAPCHEEKS_LIVE_SEND_PHONE')
  if (!body) missing.push('CLAPCHEEKS_LIVE_SEND_BODY')
  if (!expectedLast4) missing.push('CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4')

  const digits = phone.replace(/\D/g, '')
  const issues = []
  if (phone && !/^\+?[0-9]{8,15}$/.test(phone.trim())) issues.push('destination phone must be E.164-ish digits only')
  if (phone && expectedLast4 && digits.slice(-4) !== expectedLast4) issues.push('destination last4 does not match explicit expected last4')
  if (phone && digits.slice(-4) === '2944' && sample2944Override !== sample2944OverridePhrase) {
    missing.push('CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944')
    issues.push('safe sample 2944 requires explicit sample-destination override')
  }
  if (body && body.trim().length < 3) issues.push('message body is too short for a meaningful live-send test')

  return {
    ok: missing.length === 0 && issues.length === 0,
    missing,
    issues,
    phone_last4: digits.slice(-4) || null,
    phone_redacted: redactPhone(phone),
    message_length: body.length,
    message_sha256: sha256(body),
    message_sha256_available: Boolean(body),
    sample_2944_override_required: digits.slice(-4) === '2944',
    sample_2944_override_present: sample2944Override === sample2944OverridePhrase,
  }
}

const audit = loadJson(auditPath)
const live = loadJson(liveEvidencePath)
const validation = validationResult()
const requirements = Array.isArray(audit?.requirements) ? audit.requirements : []
const nonLiveMissing = requirements.filter((item) => item.status === 'missing_or_unproved')
const liveGate = requirements.find((item) => item.name === 'real outbound send-to-Julian test')
const safeGatesProved = audit?.safe_to_continue_without_live_send === true && nonLiveMissing.length === 0
const liveAlreadyPerformed = live?.live_send_performed === true

const preflight = {
  generated_at: new Date().toISOString(),
  ok_to_run_live_harness: validation.ok && safeGatesProved && liveAlreadyPerformed !== true,
  no_send_performed: true,
  no_dashboard_mutation_performed: true,
  required_permission: requiredPermission,
  sample_2944_override_phrase: sample2944OverridePhrase,
  validation,
  current_readiness: {
    audit_path: auditPath,
    safe_non_live_gates_proved: safeGatesProved,
    non_live_missing: nonLiveMissing.map((item) => item.name),
    live_gate_status: liveGate?.status || null,
  },
  current_live_evidence: {
    live_evidence_path: liveEvidencePath,
    live_send_performed: liveAlreadyPerformed,
    messages_db_verified: live?.messages_db_verified === true,
  },
  redacted_execution_plan: validation.ok ? {
    phone_last4: validation.phone_last4,
    phone_redacted: validation.phone_redacted,
    message_length: validation.message_length,
    message_sha256: validation.message_sha256,
    command: 'npm run test:e2e:live',
    expected_evidence: liveEvidencePath,
    required_env: [
      'CLAPCHEEKS_LIVE_SEND_PERMISSION',
      'CLAPCHEEKS_LIVE_SEND_PHONE',
      'CLAPCHEEKS_LIVE_SEND_BODY',
      'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
    ],
    extra_env_if_last4_2944: 'CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944',
  } : null,
}

writeFileSync(outputPath, JSON.stringify(preflight, null, 2))

console.log(`Live-send preflight: ${preflight.ok_to_run_live_harness ? 'READY' : 'NOT READY'}`)
console.log(`Evidence: ${outputPath}`)
console.log(`No send performed: ${preflight.no_send_performed}`)
console.log(`Safe non-live gates: ${safeGatesProved ? 'proved' : 'not fully proved'}`)
if (validation.phone_last4) console.log(`Destination: ${validation.phone_redacted}`)
if (validation.message_length) console.log(`Message length: ${validation.message_length}`)
if (validation.message_sha256) console.log(`Message SHA-256: ${validation.message_sha256}`)
if (validation.missing.length) console.log(`Missing: ${validation.missing.join(', ')}`)
if (validation.issues.length) console.log(`Issues: ${validation.issues.join('; ')}`)
if (liveAlreadyPerformed) console.log('Existing live evidence already reports a performed send; inspect before running again.')

if (!preflight.ok_to_run_live_harness) process.exit(1)
