import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { getFleetUserId } from '@/lib/fleet-user'

/**
 * GET  /api/memo/[handle]    — fetch the memo content for the current user + handle.
 * PUT  /api/memo/[handle]    — upsert memo content. Body: { content: string }.
 *
 * `handle` is a URL-encoded contact identifier:
 *   - E.164 phone (e.g. "+15551234567") for contacts that have exchanged a number
 *   - platform external id (e.g. "tinder:abc123") otherwise
 *
 * AI-9537: migrated from Supabase clapcheeks_memos to Convex memos.
 */

const MAX_CONTENT_LENGTH = 200_000 // ~200 KB markdown ceiling

function normalizeHandle(raw: string): string {
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw.trim()
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ handle: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { handle: rawHandle } = await ctx.params
  const handle = normalizeHandle(rawHandle)
  if (!handle) {
    return NextResponse.json({ error: 'handle required' }, { status: 400 })
  }

  try {
    const convex = getConvexServerClient()
    const row = await convex.query(api.memos.getForContact, {
      user_id: getFleetUserId(),
      contact_handle: handle,
    })
    return NextResponse.json({
      handle,
      content: row?.content ?? '',
      updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      exists: !!row,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load memo'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ handle: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { handle: rawHandle } = await ctx.params
  const handle = normalizeHandle(rawHandle)
  if (!handle) {
    return NextResponse.json({ error: 'handle required' }, { status: 400 })
  }

  let body: { content?: unknown }
  try {
    body = (await req.json()) as { content?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.content !== 'string') {
    return NextResponse.json(
      { error: 'content must be a string' },
      { status: 400 },
    )
  }
  if (body.content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `content exceeds ${MAX_CONTENT_LENGTH} character limit` },
      { status: 400 },
    )
  }

  try {
    const convex = getConvexServerClient()
    const result = await convex.mutation(api.memos.upsertMemo, {
      user_id: getFleetUserId(),
      contact_handle: handle,
      content: body.content,
    })
    return NextResponse.json({
      handle,
      content: body.content,
      updated_at: new Date().toISOString(),
      action: result.action,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save memo'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
