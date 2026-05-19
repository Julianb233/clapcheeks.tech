#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const samplePhone = '+17578312944'
const sampleLast4 = '2944'
const sampleBody = 'Safe ClapCheeks no-send preflight for 757 sample. Do not reply.'
const sampleOverride = 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION'
const outputPath = process.env.CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT || '/tmp/clapcheeks-live-send-sample-preflight.json'
const sampleAuditPath = process.env.CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT_AUDIT || '/tmp/clapcheeks-live-send-sample-preflight-audit.json'
const safeEvidencePath = process.env.CLAPCHEEKS_E2E_EVIDENCE || '/tmp/clapcheeks-safe-e2e-readiness.json'
const browserEvidencePath = process.env.CLAPCHEEKS_BROWSER_EVIDENCE || '/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json'
const runtimeEvidencePath = process.env.CLAPCHEEKS_RUNTIME_SMOKE_EVIDENCE || '/tmp/clapcheeks-runtime-smoke-evidence.json'
const liveEvidencePath = process.env.CLAPCHEEKS_LIVE_SEND_EVIDENCE || '/tmp/clapcheeks-live-send-evidence.json'

function loadJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function hasSafeCheck(evidence, name) {
  return Array.isArray(evidence?.checks) && evidence.checks.some((item) => item.name === name && item.ok === true)
}

function writeVerifiedSampleAudit() {
  const safe = loadJson(safeEvidencePath)
  const browser = loadJson(browserEvidencePath)
  const runtime = loadJson(runtimeEvidencePath)
  const issues = []

  if (safe?.ok !== true) issues.push('safe readiness evidence is not ok')
  if (safe?.no_live_send_performed !== true) issues.push('safe readiness evidence did not prove no live send')
  if (!hasSafeCheck(safe, 'messages db read-only sample lookup')) issues.push('sample Messages DB read-only check is missing')
  if (!hasSafeCheck(safe, 'scheduled dry-run')) issues.push('scheduled dry-run check is missing')
  if (browser?.ok !== true) issues.push('browser evidence is not ok')
  if (browser?.no_live_send_performed !== true) issues.push('browser evidence did not prove no live send')
  if (browser?.checks?.scheduled_ui_matches_api !== true) issues.push('scheduled UI/API browser proof is missing')
  if (browser?.checks?.dashboard_imessage_dry_run?.no_queue_delta !== true) issues.push('dashboard iMessage dry-run no-queue proof is missing')
  if (runtime?.ok !== true || runtime?.no_send !== true) issues.push('runtime smoke no-send proof is missing')

  if (issues.length) {
    console.error(`Sample preflight cannot prove safe readiness from current artifacts: ${issues.join('; ')}`)
    process.exit(1)
  }

  writeFileSync(sampleAuditPath, JSON.stringify({
    complete: false,
    safe_to_continue_without_live_send: true,
    generated_at: new Date().toISOString(),
    evidence: {
      safe: safeEvidencePath,
      browser: browserEvidencePath,
      runtime_smoke: runtimeEvidencePath,
    },
    requirements: [
      { name: 'required E2E evidence artifacts are fresh', status: 'proved' },
      { name: 'safe sample 757-831-2944 used without accidental real outbound send', status: 'proved' },
      { name: 'scheduled message create approve dry-run cancel path works', status: 'proved' },
      { name: 'dashboard imessage self-test dry-run works', status: 'proved' },
      { name: 'real outbound send-to-Julian test', status: 'unproved_requires_explicit_live_permission' },
    ],
  }, null, 2))
}

writeVerifiedSampleAudit()

const env = {
  ...process.env,
  CLAPCHEEKS_COMPLETION_AUDIT: sampleAuditPath,
  CLAPCHEEKS_LIVE_SEND_EVIDENCE: liveEvidencePath,
  CLAPCHEEKS_LIVE_SEND_PERMISSION: 'SEND LIVE TO JULIAN',
  CLAPCHEEKS_LIVE_SEND_PHONE: samplePhone,
  CLAPCHEEKS_LIVE_SEND_BODY: sampleBody,
  CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4: sampleLast4,
  CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944: sampleOverride,
  CLAPCHEEKS_LIVE_SEND_PREFLIGHT: outputPath,
}

execFileSync(process.execPath, ['scripts/e2e-live-send-preflight.mjs'], {
  env,
  stdio: 'inherit',
})

if (!existsSync(outputPath)) {
  console.error(`Sample preflight evidence was not written: ${outputPath}`)
  process.exit(1)
}

const evidence = JSON.parse(readFileSync(outputPath, 'utf8'))
const validation = evidence.validation || {}

const failures = []
if (evidence.ok_to_run_live_harness !== true) failures.push('sample preflight is not ready')
if (evidence.no_send_performed !== true) failures.push('sample preflight did not prove no-send')
if (evidence.no_dashboard_mutation_performed !== true) failures.push('sample preflight did not prove no dashboard mutation')
if (validation.phone_last4 !== sampleLast4) failures.push('sample preflight last4 mismatch')
if (validation.phone_redacted !== '*******2944') failures.push('sample preflight did not redact destination as expected')
if (validation.sample_2944_override_required !== true) failures.push('sample override was not marked required')
if (validation.sample_2944_override_present !== true) failures.push('sample override was not marked present')
if (validation.message_length !== sampleBody.length) failures.push('sample body length mismatch')
if (!validation.message_sha256) failures.push('sample body hash missing')

const serialized = JSON.stringify(evidence)
if (serialized.includes(sampleBody)) failures.push('raw sample body leaked into evidence')
if (serialized.includes(samplePhone)) failures.push('raw sample phone leaked into evidence')

if (failures.length) {
  for (const failure of failures) console.error(`Sample preflight failure: ${failure}`)
  process.exit(1)
}

console.log(`Sample live-send preflight: READY`)
console.log(`Evidence: ${outputPath}`)
console.log(`No send performed: ${evidence.no_send_performed}`)
