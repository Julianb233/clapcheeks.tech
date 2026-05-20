import { NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'

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

type MatchRecord = {
  id?: string | null
  _id?: string | null
  external_id?: string | null
  external_match_id?: string | null
  match_id?: string | null
}

function normalizePhoneE164(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function matchRecordId(row: MatchRecord | null | undefined): string | null {
  const id = row?.id ?? row?._id
  return typeof id === 'string' && id.trim() ? id : null
}

async function resolvePersistedMatch(
  convex: unknown,
  externalId: string,
  initial: MatchRecord | null | undefined,
): Promise<MatchRecord | null> {
  if (matchRecordId(initial)) return initial ?? null

  // Convex writes can return the upserted external fields without the document
  // id. Resolve the persisted row so dashboard edit/archive links get a real id.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
    }
    const { data, error } = await (convex as any)
      .from('clapcheeks_matches')
      .select('id, _id, external_id, external_match_id, match_id')
      .eq('external_id', externalId)
      .maybeSingle()

    if (error) {
      console.warn('[offline-match] id resolve failed (non-fatal retry):', error)
      continue
    }
    if (data && matchRecordId(data)) return data
  }

  return initial ?? null
}

export async function POST(req: Request) {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
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

  const { data: upserted, error: upsertError } = await (convex as any)
    .from('clapcheeks_matches')
    .upsert(row, { onConflict: 'user_id,platform,external_id' })
    .select('id, _id, external_id, external_match_id, match_id')
    .single()

  if (upsertError) {
    return NextResponse.json(
      { error: 'Failed to create offline match', detail: upsertError.message },
      { status: 500 },
    )
  }

  const persistedMatch = await resolvePersistedMatch(convex, externalId, upserted)
  const persistedMatchId = matchRecordId(persistedMatch)
  if (!persistedMatchId) {
    return NextResponse.json(
      {
        error: 'Created offline match but could not resolve editable match id',
        external_id: externalId,
      },
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
    await (convex as any).from('clapcheeks_agent_jobs').insert(jobs)
  } catch (err) {
    // Non-fatal — match row exists; daemon can pick these up on next tick
    console.warn('[offline-match] job enqueue failed (non-fatal):', err)
  }

  return NextResponse.json(
    {
      ok: true,
      match: {
        id: persistedMatchId,
        _id: persistedMatch?._id ?? persistedMatchId,
        external_id: externalId,
        name,
        phone_e164: phoneE164,
        instagram_handle: instagramHandle,
      },
    },
    { status: 201 },
  )
}
