import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
import os from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)
const HOME_BIN = path.join(os.homedir(), 'bin')
const GOD_BIN = process.env.GOD_BIN ||
  (existsSync(path.join(HOME_BIN, 'god')) ? path.join(HOME_BIN, 'god') : '/usr/local/bin/god')
const OSASCRIPT_BIN = '/usr/bin/osascript'
const LOCAL_PATH = [
  path.join(os.homedir(), '.local/bin'),
  HOME_BIN,
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':')
const LOCAL_IMESSAGE_APPLESCRIPT = `on run argv
  set recipient to item 1 of argv
  set bodyText to item 2 of argv
  tell application "Messages"
    try
      set targetService to 1st account whose service type = iMessage
    on error
      error "iMessage is not configured on this Mac. Open Messages.app and sign in with your Apple ID."
    end try
    set theBuddy to buddy recipient of targetService
    send bodyText to theBuddy
  end tell
end run`

// Phones must be E.164-ish: optional leading + then 8-15 digits. Blocks shell
// metachars from ever reaching god's argv.
const PHONE_RE = /^\+?[0-9]{8,15}$/
const LIVE_SEND_PHRASE = 'SEND LIVE TO JULIAN'
const SEND_SOURCE_LABEL = 'clapcheeks_scheduled_messages_send_api'
const LIVE_SEND_ENV = [
  'CLAPCHEEKS_LIVE_SEND_PERMISSION',
  'CLAPCHEEKS_LIVE_SEND_PHONE',
  'CLAPCHEEKS_LIVE_SEND_BODY',
  'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
] as const
const LIVE_SEND_PERMISSION = 'SEND LIVE TO JULIAN'
const SAMPLE_2944_OVERRIDE_PHRASE = 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION'
const LIVE_SEND_CLAIM_PREFIX = 'send_claim:'
const LIVE_SEND_LOCK_TTL_MS = 60_000
const LIVE_SEND_CLAIM_SETTLE_MS = 150
const CLAIM_PROBE_PHRASE = 'PROBE CLAIM WITHOUT SENDING'
const liveSendLocks = new Map<string, number>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function acquireLiveSendLock(id: string) {
  const now = Date.now()
  for (const [key, expiresAt] of liveSendLocks.entries()) {
    if (expiresAt <= now) liveSendLocks.delete(key)
  }
  const existing = liveSendLocks.get(id)
  if (existing && existing > now) return false
  liveSendLocks.set(id, now + LIVE_SEND_LOCK_TTL_MS)
  return true
}

function releaseLiveSendLock(id: string) {
  liveSendLocks.delete(id)
}

function sqlQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

function phoneLast4(value: string) {
  return digitsOnly(value).slice(-4)
}

function redactPhone(value: string | null) {
  const digits = digitsOnly(value || '')
  if (!digits) return null
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}

function normalizePhone(raw: string) {
  const digits = digitsOnly(raw)
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 11) return `+${digits}`
  return null
}

async function fetchScheduledMessage(convex: Awaited<ReturnType<typeof createClient>>, id: string, userId: string) {
  return convex
    .from('clapcheeks_scheduled_messages')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()
}

async function claimLiveSend(
  convex: Awaited<ReturnType<typeof createClient>>,
  id: string,
  userId: string,
  requestId: string,
) {
  const rejectionReason = `${LIVE_SEND_CLAIM_PREFIX}${requestId}`
  const { error: claimErr } = await convex
    .from('clapcheeks_scheduled_messages')
    .update({ status: 'rejected', rejection_reason: rejectionReason })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (claimErr) {
    return {
      claimed: false,
      rejectionReason,
      error: claimErr.message,
      message: null,
    }
  }

  // Give another near-simultaneous request a chance to overwrite our claim;
  // only the request whose claim is still current gets to touch transport.
  await sleep(LIVE_SEND_CLAIM_SETTLE_MS)

  const { data: claimedMsg, error: verifyErr } = await fetchScheduledMessage(convex, id, userId)
  if (verifyErr || !claimedMsg) {
    return {
      claimed: false,
      rejectionReason,
      error: verifyErr?.message ?? 'claimed row could not be reloaded',
      message: null,
    }
  }

  return {
    claimed: claimedMsg.status === 'rejected' && claimedMsg.rejection_reason === rejectionReason,
    rejectionReason,
    error: null,
    message: claimedMsg,
  }
}

function validateLiveSendGate(phone: string, messageText: string) {
  const missing = LIVE_SEND_ENV.filter((name) => !process.env[name])
  if (process.env.CLAPCHEEKS_LIVE_SEND_PERMISSION !== LIVE_SEND_PERMISSION && !missing.includes('CLAPCHEEKS_LIVE_SEND_PERMISSION')) {
    missing.push('CLAPCHEEKS_LIVE_SEND_PERMISSION')
  }

  const issues: string[] = []
  const expectedPhone = normalizePhone(process.env.CLAPCHEEKS_LIVE_SEND_PHONE || '')
  const expectedLast4 = process.env.CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4 || ''
  const expectedBody = process.env.CLAPCHEEKS_LIVE_SEND_BODY || ''

  if (expectedPhone && phoneLast4(expectedPhone) !== expectedLast4) {
    issues.push('configured live-send phone does not match expected last4')
  }
  if (expectedLast4 && phoneLast4(phone) !== expectedLast4) {
    issues.push('scheduled recipient does not match the live-send expected last4')
  }
  if (expectedBody && messageText !== expectedBody) {
    issues.push('scheduled message body does not match the live-send preflight body')
  }
  if (phoneLast4(phone) === '2944' && process.env.CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944 !== SAMPLE_2944_OVERRIDE_PHRASE) {
    missing.push('CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944')
    issues.push('safe sample 2944 requires explicit sample-destination override')
  }

  return {
    ready: missing.length === 0 && issues.length === 0,
    missing: Array.from(new Set(missing)),
    issues,
    required_permission: LIVE_SEND_PERMISSION,
    redacted_execution_plan: {
      destination: redactPhone(phone),
      expected_destination: redactPhone(expectedPhone),
      expected_last4: expectedLast4 || null,
      message_length: messageText.length,
      message_sha256: sha256(messageText),
      expected_body_length: expectedBody.length,
      expected_body_sha256: expectedBody ? sha256(expectedBody) : null,
    },
    no_send_performed: true,
  }
}

async function verifyImmediateSendInMessages(phone: string, messageText: string, sentAfterMs: number) {
  const dbPath = path.join(os.homedir(), 'Library/Messages/chat.db')
  if (!existsSync(dbPath)) {
    return { checked: false, ok: true, reason: 'messages_db_not_present' }
  }

  const needle = messageText.slice(0, 180)
  const phoneTail = phone.replace(/\D/g, '').slice(-10)
  const sentAfterAppleNs = Math.max(0, Math.floor((sentAfterMs - 978_307_200_000) * 1_000_000))
  const normalizedHandle = [
    "replace(",
    "replace(",
    "replace(",
    "replace(",
    "replace(coalesce(h.id,''), '+', ''),",
    "'-', ''),",
    "' ', ''),",
    "'(', ''),",
    "')', '')",
  ].join('')
  const query = [
    'select count(*) from message m',
    'left join handle h on h.ROWID = m.handle_id',
    `where m.is_from_me = 1 and m.date >= ${sentAfterAppleNs}`,
    `and m.text like ${sqlQuote(`%${needle}%`)}`,
    phoneTail.length >= 8 ? `and ${normalizedHandle} like ${sqlQuote(`%${phoneTail}`)}` : 'and 0',
  ].join(' ')

  let lastReason = 'message_not_found'
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const { stdout } = await execFileAsync('/usr/bin/sqlite3', [dbPath, query], {
        timeout: 10_000,
        env: { ...process.env, PATH: LOCAL_PATH },
      })
      const count = Number.parseInt(stdout.trim(), 10)
      if (Number.isFinite(count) && count > 0) {
        return { checked: true, ok: true, count }
      }
      lastReason = 'message_not_found'
    } catch (err: unknown) {
      lastReason = err instanceof Error ? err.message : String(err)
    }

    if (attempt < 11) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return {
    checked: true,
    ok: false,
    count: 0,
    reason: lastReason,
  }
}

// POST /api/scheduled-messages/send — fire a god draft for an approved message.
// Pass { dry_run: true } to validate the approved row, recipient, delay, and
// command shape without calling god or changing Convex state.
export async function POST(request: NextRequest) {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, confirm_send, dry_run, live_send_phrase, claim_probe, claim_probe_phrase } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (confirm_send !== true) {
    return NextResponse.json(
      { error: 'Explicit send confirmation required' },
      { status: 400 },
    )
  }

  const { data: msg, error: fetchErr } = await fetchScheduledMessage(convex, id, user.id)

  if (fetchErr || !msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (msg.status !== 'approved') {
    return NextResponse.json(
      { error: 'Message must be approved before sending' },
      { status: 400 },
    )
  }

  if (!msg.phone || !PHONE_RE.test(String(msg.phone).trim())) {
    return NextResponse.json(
      { error: 'Valid E.164 phone number required for iMessage delivery' },
      { status: 400 },
    )
  }

  const scheduledAt = new Date(msg.scheduled_at)
  const now = new Date()
  const delayMinutes = Math.max(
    0,
    Math.round((scheduledAt.getTime() - now.getTime()) / 60000),
  )

  const phone = String(msg.phone).trim()
  const messageText = String(msg.message_text)
  const adapter = delayMinutes > 0 ? 'god draft' : 'osascript Messages.send'
  const sendRequestId = randomUUID()
  const sendProvenance = {
    request_id: sendRequestId,
    source_label: SEND_SOURCE_LABEL,
    route: 'POST /api/scheduled-messages/send',
    adapter,
    phone_last4: phone.slice(-4),
    message_length: messageText.length,
    message_sha256: sha256(messageText),
  }

  if (claim_probe === true) {
    if (claim_probe_phrase !== CLAIM_PROBE_PHRASE) {
      return NextResponse.json(
        { error: `Type ${CLAIM_PROBE_PHRASE} to run the no-send claim probe` },
        { status: 400 },
      )
    }
    if (!acquireLiveSendLock(id)) {
      return NextResponse.json(
        {
          error: 'This scheduled message is already being sent or claim-probed. Refresh the queue before retrying.',
          send_provenance: sendProvenance,
          claim_probe: true,
          no_live_send_performed: true,
        },
        { status: 409 },
      )
    }

    const claim = await claimLiveSend(convex, id, user.id, sendRequestId)
    if (!claim.claimed) {
      releaseLiveSendLock(id)
      return NextResponse.json(
        {
          error: 'No-send claim probe could not claim this scheduled message safely.',
          send_provenance: sendProvenance,
          claim_probe: true,
          claim: {
            claimed: false,
            reason: claim.error,
            rejection_reason_prefix: LIVE_SEND_CLAIM_PREFIX,
          },
          no_live_send_performed: true,
        },
        { status: 409 },
      )
    }

    const { data: restored, error: restoreErr } = await convex
      .from('clapcheeks_scheduled_messages')
      .update({ status: 'approved', rejection_reason: 'claim_probe_restored_no_send' })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()
    releaseLiveSendLock(id)

    return NextResponse.json({
      ok: !restoreErr,
      claim_probe: true,
      no_live_send_performed: true,
      dry_run: false,
      send_provenance: sendProvenance,
      claim: {
        claimed: true,
        rejection_reason_prefix: LIVE_SEND_CLAIM_PREFIX,
      },
      restore: {
        ok: !restoreErr && restored?.status === 'approved',
        status: restored?.status ?? null,
        error: restoreErr?.message ?? null,
      },
    }, { status: restoreErr ? 500 : 200 })
  }

  if (dry_run === true) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      send_provenance: sendProvenance,
      verified: {
        approved_row: true,
        phone_valid: true,
        send_confirmation_present: true,
      },
      would_send: {
        id,
        platform: msg.platform ?? 'iMessage',
        match_name: msg.match_name ?? null,
        phone_last4: phone.slice(-4),
        scheduled_at: scheduledAt.toISOString(),
        delay_minutes: delayMinutes,
        message_length: messageText.length,
        adapter,
        source_label: SEND_SOURCE_LABEL,
        request_id: sendRequestId,
        message_sha256: sendProvenance.message_sha256,
      },
    })
  }

  if (live_send_phrase !== LIVE_SEND_PHRASE) {
    return NextResponse.json(
      { error: `Type ${LIVE_SEND_PHRASE} to send this scheduled message live` },
      { status: 400 },
    )
  }

  const liveGate = validateLiveSendGate(phone, messageText)
  if (!liveGate.ready) {
    return NextResponse.json(
      {
        error: 'Scheduled live send is locked until the request matches the explicit live-send preflight gate.',
        live_send_gate: liveGate,
      },
      { status: 423 },
    )
  }

  if (!acquireLiveSendLock(id)) {
    return NextResponse.json(
      {
        error: 'This scheduled message is already being sent. Refresh the queue before retrying.',
        send_provenance: sendProvenance,
        no_send_performed: true,
      },
      { status: 409 },
    )
  }

  const claim = await claimLiveSend(convex, id, user.id, sendRequestId)
  if (!claim.claimed) {
    releaseLiveSendLock(id)
    return NextResponse.json(
      {
        error: 'This scheduled message could not be claimed safely for live send. Refresh the queue before retrying.',
        send_provenance: sendProvenance,
        claim: {
          claimed: false,
          reason: claim.error,
          rejection_reason_prefix: LIVE_SEND_CLAIM_PREFIX,
        },
        no_send_performed: true,
      },
      { status: 409 },
    )
  }

  let godDraftId: string | null = null
  let godError: string | null = null
  let messagesDbVerification: Awaited<ReturnType<typeof verifyImmediateSendInMessages>> | null = null
  const sendStartedAt = Date.now()

  try {
    // execFile: each argv is passed literally, no shell interpretation, so
    // message body cannot inject commands regardless of contents.
    const bin = delayMinutes > 0 ? GOD_BIN : OSASCRIPT_BIN
    const args = delayMinutes > 0
      ? ['draft', phone, messageText, String(delayMinutes)]
      : ['-e', LOCAL_IMESSAGE_APPLESCRIPT, phone, messageText]
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: 30_000,
      env: { ...process.env, PATH: LOCAL_PATH },
    })
    godDraftId =
      stdout.trim().match(/draft[_-]?id[:\s]+(\S+)/i)?.[1] ??
      `sent-${Date.now()}`
    if (stderr && !stdout) godError = stderr.trim()
  } catch (err: unknown) {
    godError = err instanceof Error ? err.message : String(err)
  }

  if (!godError && delayMinutes === 0) {
    const verification = await verifyImmediateSendInMessages(phone, messageText, sendStartedAt)
    messagesDbVerification = verification
    if (verification.checked && !verification.ok) {
      godError = `god send exited successfully but Messages DB verification failed: ${verification.reason || 'message_not_found'}`
      godDraftId = null
    }
  }

  if (godError && !godDraftId) {
    await convex
      .from('clapcheeks_scheduled_messages')
      .update({ status: 'failed', rejection_reason: godError })
      .eq('id', id)

    releaseLiveSendLock(id)
    return NextResponse.json({ error: godError, send_provenance: sendProvenance }, { status: 500 })
  }

  const { data: updated, error: updateErr } = await convex
    .from('clapcheeks_scheduled_messages')
    .update({
      status: 'sent',
      sent_at: delayMinutes === 0 ? new Date().toISOString() : null,
      god_draft_id: godDraftId,
    })
    .eq('id', id)
    .select()
    .single()

  releaseLiveSendLock(id)

  if (updateErr) {
    return NextResponse.json(
      {
        error: `Live send completed but status update failed; the row was claimed before transport to prevent duplicate retries: ${updateErr.message}`,
        send_provenance: sendProvenance,
        messages_db_verification: messagesDbVerification,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    message: updated,
    god_draft_id: godDraftId,
    delay_minutes: delayMinutes,
    send_provenance: sendProvenance,
    messages_db_verification: messagesDbVerification,
  })
}
