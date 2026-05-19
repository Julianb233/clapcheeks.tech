import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'
import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'

const LIVE_SEND_PHRASE = 'SEND LIVE TO JULIAN'
const LIVE_SEND_ENV = [
  'CLAPCHEEKS_LIVE_SEND_PERMISSION',
  'CLAPCHEEKS_LIVE_SEND_PHONE',
  'CLAPCHEEKS_LIVE_SEND_BODY',
  'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
] as const
const SAMPLE_2944_OVERRIDE_PHRASE = 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION'
const LIVE_SEND_PREFLIGHT_PATH = process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json'
const LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS = Number(process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS || '900')

// Normalize a phone number to +1XXXXXXXXXX format
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 11) return `+${digits}` // international
  return null
}

function configuredSelfTestPhone() {
  return process.env.CLAPCHEEKS_SELF_TEST_PHONE || process.env.CC_E2E_SMOKE_PHONE || ''
}

function phoneLast4(phone: string | null) {
  return phone?.replace(/\D/g, '').slice(-4) || null
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function redactPhone(phone: string | null) {
  const digits = phone?.replace(/\D/g, '') || ''
  if (!digits) return null
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}

function liveSendPreflightMetadata() {
  if (!existsSync(LIVE_SEND_PREFLIGHT_PATH)) {
    return {
      path: LIVE_SEND_PREFLIGHT_PATH,
      exists: false,
      ready: false,
      fresh: false,
      generated_at: null,
      age_seconds: null,
      max_age_seconds: LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS,
      phone_last4: null,
      body_length: null,
      body_sha256: null,
      no_send_performed: null,
      no_dashboard_mutation_performed: null,
    }
  }

  try {
    const preflight = JSON.parse(readFileSync(LIVE_SEND_PREFLIGHT_PATH, 'utf8'))
    const generatedAtMs = Date.parse(preflight.generated_at || '')
    const ageSeconds = Number.isFinite(generatedAtMs) ? Math.floor((Date.now() - generatedAtMs) / 1000) : null
    const fresh = ageSeconds !== null && ageSeconds <= LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS
    return {
      path: LIVE_SEND_PREFLIGHT_PATH,
      exists: true,
      ready: preflight.ok_to_run_live_harness === true,
      fresh,
      generated_at: preflight.generated_at || null,
      age_seconds: ageSeconds,
      max_age_seconds: LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS,
      phone_last4: preflight.validation?.phone_last4 || null,
      body_length: preflight.validation?.message_length ?? null,
      body_sha256: preflight.validation?.message_sha256 || null,
      no_send_performed: preflight.no_send_performed === true,
      no_dashboard_mutation_performed: preflight.no_dashboard_mutation_performed === true,
    }
  } catch {
    return {
      path: LIVE_SEND_PREFLIGHT_PATH,
      exists: true,
      ready: false,
      fresh: false,
      generated_at: null,
      age_seconds: null,
      max_age_seconds: LIVE_SEND_PREFLIGHT_MAX_AGE_SECONDS,
      phone_last4: null,
      body_length: null,
      body_sha256: null,
      no_send_performed: null,
      no_dashboard_mutation_performed: null,
    }
  }
}

function liveSendGateMetadata(selfTestHandle: string | null) {
  const missing: string[] = LIVE_SEND_ENV.filter((name) => !process.env[name])
  if (process.env.CLAPCHEEKS_LIVE_SEND_PERMISSION !== LIVE_SEND_PHRASE && !missing.includes('CLAPCHEEKS_LIVE_SEND_PERMISSION')) {
    missing.push('CLAPCHEEKS_LIVE_SEND_PERMISSION')
  }
  const issues: string[] = []
  const envPhone = normalizePhone(process.env.CLAPCHEEKS_LIVE_SEND_PHONE || '')
  const expectedLast4 = process.env.CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4 || ''
  const expectedBody = process.env.CLAPCHEEKS_LIVE_SEND_BODY || ''
  const preflight = liveSendPreflightMetadata()

  if (envPhone && expectedLast4 && phoneLast4(envPhone) !== expectedLast4) {
    issues.push('configured live-send phone does not match expected last4')
  }
  if (expectedLast4 && selfTestHandle && phoneLast4(selfTestHandle) !== expectedLast4) {
    issues.push('self-test recipient does not match the live-send expected last4')
  }
  const sampleOverrideRequired =
    phoneLast4(selfTestHandle) === '2944' && process.env.CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944 !== SAMPLE_2944_OVERRIDE_PHRASE
  if (sampleOverrideRequired) {
    missing.push('CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944')
    issues.push('safe sample 2944 requires explicit sample-destination override')
  }
  if (!preflight.exists) {
    issues.push('live-send preflight evidence is missing')
  } else if (!preflight.ready) {
    issues.push('live-send preflight evidence is not ready')
  } else if (!preflight.fresh) {
    issues.push('live-send preflight evidence is stale')
  }

  return {
    ready: missing.length === 0 && issues.length === 0,
    missing: Array.from(new Set(missing)),
    issues,
    sample_override_required: sampleOverrideRequired,
    required_permission: 'SEND LIVE TO JULIAN',
    runbook: 'docs/e2e-live-send-runbook.md',
    preflight,
    redacted_execution_plan: {
      destination: redactPhone(envPhone),
      expected_last4: expectedLast4 || null,
      body_length: expectedBody.length,
      body_sha256: expectedBody ? sha256(expectedBody) : null,
    },
    no_send_performed: true,
  }
}

function validateLiveSendRequest(handle: string, bodyText: string) {
  const gate = liveSendGateMetadata(handle)
  const issues: string[] = []
  const envPhone = normalizePhone(process.env.CLAPCHEEKS_LIVE_SEND_PHONE || '')
  const expectedLast4 = process.env.CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4 || ''
  const expectedBody = process.env.CLAPCHEEKS_LIVE_SEND_BODY || ''

  if (!gate.ready) {
    issues.push('live-send environment gate is not ready')
  }
  if (envPhone && phoneLast4(envPhone) !== expectedLast4) {
    issues.push('configured live-send phone does not match expected last4')
  }
  if (expectedLast4 && phoneLast4(handle) !== expectedLast4) {
    issues.push('target phone does not match the live-send expected last4')
  }
  if (expectedBody && bodyText !== expectedBody) {
    issues.push('message body does not match the live-send preflight body')
  }

  return {
    ok: gate.ready && issues.length === 0,
    gate,
    issues,
  }
}

// POST /api/imessage/test — queue a test iMessage to a phone number
export async function POST(request: NextRequest) {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { phone, message, opener_style, dry_run, confirm_send, live_send_phrase, use_self_test_recipient } = body
  const targetPhone = use_self_test_recipient === true ? configuredSelfTestPhone() : phone

  if (!targetPhone) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }

  const handle = normalizePhone(targetPhone)
  if (!handle) {
    return NextResponse.json(
      { error: 'Invalid phone number. Use a 10-digit US number or include country code.' },
      { status: 400 }
    )
  }

  // Use provided message or a default opener based on style
  const openers: Record<string, string> = {
    witty: "Hey — the AI made me do this 😅 But seriously, wanted to reach out.",
    warm: "Hey! Reaching out to connect — hope you're having a great day.",
    direct: "Hey, let's connect. What are you up to this week?",
  }

  const body_text = message?.trim() || openers[opener_style] || openers.warm

  if (dry_run === true) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      verified: {
        phone_valid: true,
        queue_shape_valid: true,
      },
      would_queue: {
        recipient_last4: handle.slice(-4),
        message_length: body_text.length,
        source: 'web_test',
      },
      message: `Dry run passed for ${handle.slice(-4)}. No message was queued or sent.`,
    })
  }

  if (confirm_send !== true) {
    return NextResponse.json(
      { error: 'Explicit live-send confirmation required' },
      { status: 400 },
    )
  }

  if (live_send_phrase !== LIVE_SEND_PHRASE) {
    return NextResponse.json(
      { error: `Type ${LIVE_SEND_PHRASE} to queue a live iMessage` },
      { status: 400 },
    )
  }

  const liveValidation = validateLiveSendRequest(handle, body_text)
  if (!liveValidation.ok) {
    return NextResponse.json(
      {
        error: 'Live iMessage queueing is locked until the dashboard request matches the explicit live-send preflight gate.',
        live_send_gate: liveValidation.gate,
        issues: liveValidation.issues,
      },
      { status: 423 },
    )
  }

  // Insert into the queue — local Mac agent will pick this up within 30s
  const { data, error } = await convex
    .from('clapcheeks_queued_replies')
    .insert({
      user_id: user.id,
      recipient_handle: handle,
      body: body_text,
      status: 'queued',
      source: 'web_test',
    })
    .select('id, recipient_handle, body, status, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    queued: data,
    message: `Message queued for ${handle}. Your Mac agent will send it within 30 seconds.`,
  })
}

// GET /api/imessage/test — list recent test messages for this user
export async function GET(request: NextRequest) {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await convex
    .from('clapcheeks_queued_replies')
    .select('id, recipient_handle, body, status, created_at, source')
    .eq('user_id', user.id)
    .eq('source', 'web_test')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const selfTestHandle = normalizePhone(configuredSelfTestPhone())

  return NextResponse.json({
    messages: data || [],
    self_test_recipient: {
      configured: Boolean(selfTestHandle),
      last4: phoneLast4(selfTestHandle),
    },
    live_send_gate: liveSendGateMetadata(selfTestHandle),
  })
}
