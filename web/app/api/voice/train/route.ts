/**
 * AI-8763 — voice training API.
 *
 * The actual chat.db scan happens LOCALLY on the operator's Mac via the
 * `clapcheeks voice scan` CLI (agent/clapcheeks/voice/clone.py). That CLI
 * computes the digest and PATCHes it into Supabase clapcheeks_voice_profiles.
 *
 * This API route exposes:
 *
 *   GET   /api/voice/train  ->  returns the latest digest for the auth'd user
 *   POST  /api/voice/train  ->  upserts boosted_samples (the operator's
 *                               curated "most like me" picks from the
 *                               /studio/voice tone-calibration UI).
 *
 * We deliberately DO NOT trigger a remote chat.db scan from this server —
 * that would require shipping the operator's chat.db off-device, which
 * violates the agent's data-locality contract.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: migrated voice profile reads/writes to Convex voice_profiles.

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let data: unknown = null
  try {
    const convex = getConvexServerClient()
    data = await convex.query(api.voice.getProfile, { user_id: user.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'voice_load_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({
    profile: data || null,
    instructions: {
      cli: 'clapcheeks voice scan',
      docs:
        'The chat.db scan runs locally on your Mac. Install the agent ' +
        '(curl -fsSL https://clapcheeks.tech/install.sh | bash) and run ' +
        '`clapcheeks voice scan` once. The digest will appear here.',
    },
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { boostedSamples?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const boosted = body.boostedSamples
  if (!Array.isArray(boosted)) {
    return NextResponse.json(
      { error: 'boostedSamples must be an array of strings' },
      { status: 400 }
    )
  }
  if (boosted.length > 25) {
    return NextResponse.json(
      { error: 'boostedSamples capped at 25 entries' },
      { status: 400 }
    )
  }
  const cleaned = (boosted as unknown[])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())

  try {
    const convex = getConvexServerClient()
    await convex.mutation(api.voice.upsertProfileDigest, {
      user_id: user.id,
      boosted_samples: cleaned,
    })
    const data = await convex.query(api.voice.getProfile, { user_id: user.id })
    return NextResponse.json({ profile: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'voice_save_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
