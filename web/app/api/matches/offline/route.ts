import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Phase F (AI-8320): Offline contact ingestion.
 *
 * Creates a `clapcheeks_matches` row with platform='offline', source='imessage'.
 * The Phase F daemon then pulls iMessage history for the phone and (if an IG
 * handle was given) enqueues a Phase C enrichment job onto
 * clapcheeks_agent_jobs.
 *
 * This route is intentionally lightweight — it does the DB write + job-enqueue
 * synchronously; the heavy iMessage history read happens in the daemon
 * because only the Mac Mini has Full Disk Access.
 */

type OfflinePayload = {
  name?: string
  phone?: string
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
  const phoneRaw = (body.phone ?? '').trim()
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!phoneRaw) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }
  const phoneE164 = normalizePhoneE164(phoneRaw)
  if (!phoneE164) {
    return NextResponse.json(
      { error: `phone '${phoneRaw}' is not a valid 10-digit NANP number` },
      { status: 400 },
    )
  }

  const instagramHandle = (body.instagram_handle ?? '').trim().replace(/^@/, '') || null
  const metAt = (body.met_at ?? '').trim() || null
  const firstImpression = (body.first_impression ?? body.notes ?? '').trim() || null

  const digits = phoneE164.replace(/\D+/g, '')
  const externalId = `offline:${digits}`
  const nowIso = new Date().toISOString()

  const row = {
    user_id: user.id,
    platform: 'offline' as const,
    external_id: externalId,
    match_id: externalId,
    match_name: name,
    name,
    her_phone: phoneE164,
    source: 'imessage',
    primary_channel: 'imessage',
    handoff_complete: true,
    julian_shared_phone: true,
    handoff_detected_at: nowIso,
    instagram_handle: instagramHandle,
    met_at: metAt,
    first_impression: firstImpression,
    status: 'conversing',
    created_at: nowIso,
    updated_at: nowIso,
    last_activity_at: nowIso,
  }

  const { data: upserted, error: upsertError } = await (supabase as any)
    .from('clapcheeks_matches')
    .upsert(row, { onConflict: 'user_id,platform,external_id' })
    .select('id, external_id')
    .single()

  if (upsertError) {
    return NextResponse.json(
      { error: 'Failed to create offline match', detail: upsertError.message },
      { status: 500 },
    )
  }

  // Best-effort: queue iMessage history pull + IG enrichment for the daemon.
  try {
    const jobs: Array<Record<string, unknown>> = [
      {
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
      },
    ]
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
    await (supabase as any).from('clapcheeks_agent_jobs').insert(jobs)
  } catch (err) {
    // Non-fatal — match row exists; daemon can pick these up on next tick
    console.warn('[offline-match] job enqueue failed (non-fatal):', err)
  }

  return NextResponse.json(
    {
      ok: true,
      match: {
        id: upserted?.id,
        external_id: externalId,
        name,
        phone_e164: phoneE164,
        instagram_handle: instagramHandle,
      },
    },
    { status: 201 },
  )
}
