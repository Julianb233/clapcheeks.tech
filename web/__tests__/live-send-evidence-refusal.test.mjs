import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const liveEnvKeys = [
  'CLAPCHEEKS_LIVE_SEND_PERMISSION',
  'CLAPCHEEKS_LIVE_SEND_PHONE',
  'CLAPCHEEKS_LIVE_SEND_BODY',
  'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
  'CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944',
]

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2))
}

function readyPreflight({ phone = '+15555550123', body = 'Safe live harness refusal test only.' } = {}) {
  const digits = phone.replace(/\D/g, '')
  return {
    generated_at: new Date().toISOString(),
    ok_to_run_live_harness: true,
    no_send_performed: true,
    no_dashboard_mutation_performed: true,
    validation: {
      missing: [],
      issues: [],
      phone_last4: digits.slice(-4),
      phone_redacted: `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`,
      message_length: body.length,
      message_sha256: createHash('sha256').update(body).digest('hex'),
    },
  }
}

async function runLiveHarness(overrides = {}, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'clapcheeks-live-refusal-'))
  const evidencePath = join(dir, 'live.json')
  const preflightPath = join(dir, 'preflight.json')
  if (options.preflight) await writeJson(preflightPath, options.preflight)
  const env = { ...process.env }
  for (const key of liveEnvKeys) delete env[key]
  const result = await execFileAsync(process.execPath, ['scripts/e2e-live-send-evidence.mjs'], {
    env: {
      ...env,
      CLAPCHEEKS_E2E_BASE_URL: 'http://127.0.0.1:1',
      CLAPCHEEKS_LIVE_SEND_EVIDENCE: evidencePath,
      CLAPCHEEKS_LIVE_SEND_PREFLIGHT: preflightPath,
      ...overrides,
    },
  })
  return {
    result,
    evidence: JSON.parse(await readFile(evidencePath, 'utf8')),
  }
}

test('live-send evidence harness refuses before network calls when env is missing', async () => {
  const { result, evidence } = await runLiveHarness()

  assert.equal(evidence.ok, false)
  assert.equal(evidence.refused, true)
  assert.equal(evidence.live_send_performed, false)
  assert.equal(evidence.messages_db_verified, false)
  assert.deepEqual(evidence.missing, [
    'CLAPCHEEKS_LIVE_SEND_PERMISSION',
    'CLAPCHEEKS_LIVE_SEND_PHONE',
    'CLAPCHEEKS_LIVE_SEND_BODY',
    'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
  ])
  assert.match(result.stdout, /Refused live send/)
})

test('live-send evidence harness refuses sample 2944 without explicit override before creating dashboard rows', async () => {
  const { evidence } = await runLiveHarness({
    CLAPCHEEKS_LIVE_SEND_PERMISSION: 'SEND LIVE TO JULIAN',
    CLAPCHEEKS_LIVE_SEND_PHONE: '+17578312944',
    CLAPCHEEKS_LIVE_SEND_BODY: 'Safe live harness refusal test only.',
    CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4: '2944',
  })

  assert.equal(evidence.ok, false)
  assert.equal(evidence.refused, true)
  assert.equal(evidence.refusal_reason, 'safe sample 2944 requires explicit sample-destination override')
  assert.deepEqual(evidence.missing, ['CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944'])
  assert.equal(evidence.live_send_performed, false)
  assert.equal(evidence.messages_db_verified, false)
  assert.equal(evidence.scheduled_message_id, undefined)
})

test('live-send evidence harness refuses destination last4 mismatch before creating dashboard rows', async () => {
  const { evidence } = await runLiveHarness({
    CLAPCHEEKS_LIVE_SEND_PERMISSION: 'SEND LIVE TO JULIAN',
    CLAPCHEEKS_LIVE_SEND_PHONE: '+15555550123',
    CLAPCHEEKS_LIVE_SEND_BODY: 'Safe live harness refusal test only.',
    CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4: '9999',
  })

  assert.equal(evidence.ok, false)
  assert.equal(evidence.refused, true)
  assert.equal(evidence.refusal_reason, 'destination last4 does not match explicit expected last4')
  assert.equal(evidence.live_send_performed, false)
  assert.equal(evidence.messages_db_verified, false)
  assert.equal(evidence.scheduled_message_id, undefined)
})

test('live-send evidence harness refuses without matching preflight evidence before creating dashboard rows', async () => {
  const { evidence } = await runLiveHarness({
    CLAPCHEEKS_LIVE_SEND_PERMISSION: 'SEND LIVE TO JULIAN',
    CLAPCHEEKS_LIVE_SEND_PHONE: '+15555550123',
    CLAPCHEEKS_LIVE_SEND_BODY: 'Safe live harness refusal test only.',
    CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4: '0123',
  })

  assert.equal(evidence.ok, false)
  assert.equal(evidence.refused, true)
  assert.match(evidence.refusal_reason, /matching live-send preflight evidence is required/)
  assert.deepEqual(evidence.missing, ['CLAPCHEEKS_LIVE_SEND_PREFLIGHT'])
  assert.equal(evidence.live_send_performed, false)
  assert.equal(evidence.scheduled_message_id, undefined)
})

test('live-send evidence harness refuses preflight body mismatch before creating dashboard rows', async () => {
  const { evidence } = await runLiveHarness({
    CLAPCHEEKS_LIVE_SEND_PERMISSION: 'SEND LIVE TO JULIAN',
    CLAPCHEEKS_LIVE_SEND_PHONE: '+15555550123',
    CLAPCHEEKS_LIVE_SEND_BODY: 'Safe live harness refusal test only.',
    CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4: '0123',
  }, {
    preflight: readyPreflight({ body: 'Different preflight body.' }),
  })

  assert.equal(evidence.ok, false)
  assert.equal(evidence.refused, true)
  assert.match(evidence.refusal_reason, /body SHA-256 does not match/)
  assert.ok(evidence.preflight_evidence.issues.includes('preflight body SHA-256 does not match current body'))
  assert.equal(evidence.live_send_performed, false)
  assert.equal(evidence.scheduled_message_id, undefined)
})

test('live-send evidence harness refuses stale preflight before creating dashboard rows', async () => {
  const stale = readyPreflight()
  stale.generated_at = new Date(Date.now() - 60_000).toISOString()
  const { evidence } = await runLiveHarness({
    CLAPCHEEKS_LIVE_SEND_PERMISSION: 'SEND LIVE TO JULIAN',
    CLAPCHEEKS_LIVE_SEND_PHONE: '+15555550123',
    CLAPCHEEKS_LIVE_SEND_BODY: 'Safe live harness refusal test only.',
    CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4: '0123',
    CLAPCHEEKS_LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS: '1',
  }, {
    preflight: stale,
  })

  assert.equal(evidence.ok, false)
  assert.equal(evidence.refused, true)
  assert.match(evidence.refusal_reason, /preflight is stale/)
  assert.ok(evidence.preflight_evidence.issues.some((issue) => issue.includes('preflight is stale')))
  assert.equal(evidence.preflight_evidence.max_age_seconds, 1)
  assert.equal(evidence.live_send_performed, false)
  assert.equal(evidence.scheduled_message_id, undefined)
})
