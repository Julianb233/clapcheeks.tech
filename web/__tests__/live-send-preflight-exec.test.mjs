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

async function makePaths() {
  const dir = await mkdtemp(join(tmpdir(), 'clapcheeks-live-preflight-'))
  const paths = {
    audit: join(dir, 'audit.json'),
    safe: join(dir, 'safe.json'),
    browser: join(dir, 'browser.json'),
    runtime: join(dir, 'runtime.json'),
    live: join(dir, 'live.json'),
    preflight: join(dir, 'preflight.json'),
  }
  await writeJson(paths.audit, {
    complete: false,
    safe_to_continue_without_live_send: true,
    requirements: [
      { name: 'required E2E evidence artifacts are fresh', status: 'proved' },
      { name: 'real outbound send-to-Julian test', status: 'unproved_requires_explicit_live_permission' },
    ],
  })
  await writeJson(paths.live, {
    ok: false,
    refused: true,
    live_send_performed: false,
    messages_db_verified: false,
  })
  await writeJson(paths.safe, {
    ok: true,
    no_live_send_performed: true,
    checks: [
      { name: 'messages db read-only sample lookup', ok: true },
      { name: 'scheduled dry-run', ok: true },
    ],
  })
  await writeJson(paths.browser, {
    ok: true,
    no_live_send_performed: true,
    checks: {
      scheduled_ui_matches_api: true,
      dashboard_imessage_dry_run: {
        no_queue_delta: true,
      },
    },
  })
  await writeJson(paths.runtime, {
    ok: true,
    no_send: true,
  })
  return paths
}

function cleanEnv(paths, overrides = {}) {
  const env = { ...process.env }
  for (const key of liveEnvKeys) delete env[key]
  return {
    ...env,
    CLAPCHEEKS_COMPLETION_AUDIT: paths.audit,
    CLAPCHEEKS_E2E_EVIDENCE: paths.safe,
    CLAPCHEEKS_BROWSER_EVIDENCE: paths.browser,
    CLAPCHEEKS_RUNTIME_SMOKE_EVIDENCE: paths.runtime,
    CLAPCHEEKS_LIVE_SEND_EVIDENCE: paths.live,
    CLAPCHEEKS_LIVE_SEND_PREFLIGHT: paths.preflight,
    ...overrides,
  }
}

async function runPreflight(overrides = {}, expectFailure = false) {
  const paths = await makePaths()
  try {
    const result = await execFileAsync(process.execPath, ['scripts/e2e-live-send-preflight.mjs'], {
      env: cleanEnv(paths, overrides),
    })
    return {
      paths,
      result,
      preflight: JSON.parse(await readFile(paths.preflight, 'utf8')),
    }
  } catch (error) {
    if (!expectFailure) throw error
    return {
      paths,
      result: error,
      preflight: JSON.parse(await readFile(paths.preflight, 'utf8')),
    }
  }
}

test('live-send preflight refuses safely when live env is missing', async () => {
  const { preflight, result } = await runPreflight({}, true)

  assert.equal(preflight.ok_to_run_live_harness, false)
  assert.equal(preflight.no_send_performed, true)
  assert.equal(preflight.no_dashboard_mutation_performed, true)
  assert.deepEqual(preflight.validation.missing, [
    'CLAPCHEEKS_LIVE_SEND_PERMISSION',
    'CLAPCHEEKS_LIVE_SEND_PHONE',
    'CLAPCHEEKS_LIVE_SEND_BODY',
    'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
  ])
  assert.match(result.stdout, /No send performed: true/)
})

test('live-send preflight requires explicit sample override for 757-831-2944', async () => {
  const { preflight } = await runPreflight({
    CLAPCHEEKS_LIVE_SEND_PERMISSION: 'SEND LIVE TO JULIAN',
    CLAPCHEEKS_LIVE_SEND_PHONE: '+17578312944',
    CLAPCHEEKS_LIVE_SEND_BODY: 'Safe preflight only for sample override proof.',
    CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4: '2944',
  }, true)

  assert.equal(preflight.ok_to_run_live_harness, false)
  assert.equal(preflight.no_send_performed, true)
  assert.equal(preflight.validation.sample_2944_override_required, true)
  assert.equal(preflight.validation.sample_2944_override_present, false)
  assert.ok(preflight.validation.missing.includes('CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944'))
  assert.ok(preflight.validation.issues.includes('safe sample 2944 requires explicit sample-destination override'))
  assert.equal(preflight.redacted_execution_plan, null)
})

test('live-send preflight can become ready for a dummy non-sample destination without sending', async () => {
  const body = 'Safe live preflight executable test only. Do not send.'
  const { preflight, result } = await runPreflight({
    CLAPCHEEKS_LIVE_SEND_PERMISSION: 'SEND LIVE TO JULIAN',
    CLAPCHEEKS_LIVE_SEND_PHONE: '+15555550123',
    CLAPCHEEKS_LIVE_SEND_BODY: body,
    CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4: '0123',
  })

  assert.equal(preflight.ok_to_run_live_harness, true)
  assert.equal(preflight.no_send_performed, true)
  assert.equal(preflight.no_dashboard_mutation_performed, true)
  assert.equal(preflight.validation.phone_last4, '0123')
  assert.equal(preflight.validation.phone_redacted, '*******0123')
  assert.equal(preflight.validation.message_length, body.length)
  assert.equal(preflight.validation.message_sha256, createHash('sha256').update(body).digest('hex'))
  assert.equal(preflight.redacted_execution_plan.command, 'npm run test:e2e:live')
  assert.match(result.stdout, /Live-send preflight: READY/)
  assert.match(result.stdout, /No send performed: true/)
})

test('sample live-send preflight can become ready for 757-831-2944 without sending or leaking raw inputs', async () => {
  const paths = await makePaths()
  const samplePath = join(paths.preflight.replace(/preflight\.json$/, ''), 'sample-preflight.json')
  const env = cleanEnv(paths, {
    CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT: samplePath,
  })
  const result = await execFileAsync(process.execPath, ['scripts/e2e-live-send-sample-preflight.mjs'], { env })
  const sample = JSON.parse(await readFile(samplePath, 'utf8'))
  const serialized = JSON.stringify(sample)

  assert.equal(sample.ok_to_run_live_harness, true)
  assert.equal(sample.no_send_performed, true)
  assert.equal(sample.no_dashboard_mutation_performed, true)
  assert.equal(sample.validation.phone_last4, '2944')
  assert.equal(sample.validation.phone_redacted, '*******2944')
  assert.equal(sample.validation.sample_2944_override_required, true)
  assert.equal(sample.validation.sample_2944_override_present, true)
  assert.equal(sample.validation.missing.length, 0)
  assert.equal(sample.validation.issues.length, 0)
  assert.equal(serialized.includes('+17578312944'), false)
  assert.equal(serialized.includes('Safe ClapCheeks no-send preflight for 757 sample. Do not reply.'), false)
  assert.match(result.stdout, /Sample live-send preflight: READY/)
  assert.match(result.stdout, /No send performed: true/)
})
