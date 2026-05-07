import { NextResponse } from 'next/server'
import { api } from '@/convex/_generated/api'
import { getConvexServerClient } from '@/lib/convex/server'
import { createClient } from '@/lib/supabase/server'
import { getFleetUserId } from '@/lib/fleet-user'

/**
 * Phase F (AI-8320): Offline contact ingestion.
 *
 * AI-9534 — writes the match to Convex via api.matches.upsertOffline. The
 * Phase F daemon (Mac Mini) still queues iMessage history pulls + IG
 * enrichment via clapcheeks_agent_jobs on Supabase — that table is out of
 * scope for this migration.
 *
 * AI-9579 — phone is now optional (form can submit without a phone number).
 * When phone is absent, external_match_id is keyed on a UUID so the row is
 * still unique but won't de-dupe against a future phone-keyed row for the
 * same person.
 */

type OfflinePayload = {
  name?: string
  phone?: string
  email?: string | null
  instagram_handle?: string | null
  met_at?: string | null
  first_impression?: string | null
  notes?: string | null
}

function normalizePhoneE164(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: OfflinePayload
  try {
    body = (await req.json()) as OfflinePayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // phone is optional — only validate format when provided
  const phoneRaw = (body.phone ?? '').trim()
  let phoneE164: string | null = null
  if (phoneRaw) {
    phoneE164 = normalizePhoneE164(phoneRaw)
    if (!phoneE164) {
      return NextResponse.json(
        { error: `phone '${phoneRaw}' is not a valid 10-digit NANP number` },
        { status: 400 },
      )
    }
  }

  const instagramHandle = (body.instagram_handle ?? '').trim().replace(/^@/, '') || null
  const metAt = (body.met_at ?? '').trim() || null
  const firstImpression = (body.first_impression ?? body.notes ?? '').trim() || null
  const emailClean = (body.email ?? '').trim() || null

  // Key external_id on phone digits when available; fall back to UUID so the
  // row is still unique but won't de-dupe with a phone-keyed row later.
  const externalId = phoneE164
    ? `offline:${phoneE164.replace(/\D+/g, '')}`
    : `offline:${crypto.randomUUID().replace(/-/g, '')}`

  const nowIso = new Date().toISOString() // still used by the agent_jobs insert below
  const nowMs = Date.now()

  // Store email in match_intel since the offline schema doesn't have a
  // dedicated email column.
  const matchIntel = emailClean ? { email: emailClean } : undefined

  // AI-9534 — write the match to Convex (idempotent on
  // (user_id, platform=offline, external_match_id)).
  const convex = getConvexServerClient()
  let upserted: { _id: string; external_id?: string } | null = null
  try {
    const result = await convex.mutation(api.matches.upsertOffline, {
      user_id: getFleetUserId(),
      external_match_id: externalId,
      match_id: externalId,
      external_id: externalId,
      match_name: name,
      name,
      her_phone: phoneE164 ?? '',
      source: 'manual',
      primary_channel: phoneE164 ? 'imessage' : 'email',
      handoff_complete: !!phoneE164,
      julian_shared_phone: !!phoneE164,
      handoff_detected_at: phoneE164 ? nowMs : undefined,
      instagram_handle: instagramHandle ?? undefined,
      met_at: metAt ?? undefined,
      first_impression: firstImpression ?? undefined,
      match_intel: matchIntel,
      status: 'conversing',
    })
    upserted = {
      _id: result._id as unknown as string,
      external_id: result.external_id,
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to create offline match',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }

  // Best-effort: queue iMessage history pull + IG enrichment for the daemon.
  try {
    const jobs: Array<Record<string, unknown>> = []
    if (phoneE164) {
      jobs.push({
        user_id: user.id,
        job_type: 'imessage_history_pull',
        status: 'queued',
        payload: {
          match_external_id: externalId,
          phone_e164: phoneE164,
          days: 90,
          source: 'phase_f_offline',
        },
        created_at: nowIso,
      })
    }
    if (instagramHandle) {
      jobs.push({
        user_id: user.id,
        job_type: 'ig_enrich_match',
        status: 'queued',
        payload: {
          match_external_id: externalId,
          instagram_handle: instagramHandle,
          source: 'phase_f_offline',
        },
        created_at: nowIso,
      })
    }
    if (jobs.length > 0) await (supabase as any).from('clapcheeks_agent_jobs').insert(jobs)
  } catch (err) {
    // Non-fatal — match row exists; daemon can pick these up on next tick
    console.warn('[offline-match] job enqueue failed (non-fatal):', err)
  }

  return NextResponse.json(
    {
      ok: true,
      match: {
        id: upserted?._id,
        external_id: externalId,
        name,
        phone_e164: phoneE164,
        email: emailClean,
        instagram_handle: instagramHandle,
      },
    },
    { status: 201 },
  )
}
