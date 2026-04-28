import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET  /api/memo/[handle]    — fetch the memo content for the current user + handle.
 * PUT  /api/memo/[handle]    — upsert memo content. Body: { content: string }.
 *
 * `handle` is a URL-encoded contact identifier:
 *   - E.164 phone (e.g. "+15551234567") for contacts that have exchanged a number
 *   - platform external id (e.g. "tinder:abc123") otherwise
 *
 * RLS on clapcheeks_memos enforces ownership but we also pass user_id explicitly.
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

  const { data, error } = await (supabase as any)
    .from('clapcheeks_memos')
    .select('content, updated_at')
    .eq('user_id', user.id)
    .eq('contact_handle', handle)
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to load memo' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    handle,
    content: data?.content ?? '',
    updated_at: data?.updated_at ?? null,
    exists: !!data,
  })
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

  const now = new Date().toISOString()

  const { data, error } = await (supabase as any)
    .from('clapcheeks_memos')
    .upsert(
      {
        user_id: user.id,
        contact_handle: handle,
        content: body.content,
        updated_at: now,
      },
      { onConflict: 'user_id,contact_handle' },
    )
    .select('content, updated_at')
    .single()

  if (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to save memo' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    handle,
    content: data?.content ?? body.content,
    updated_at: data?.updated_at ?? now,
  })
}
