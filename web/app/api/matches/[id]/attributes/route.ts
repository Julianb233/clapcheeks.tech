/**
 * AI-8814 — Match attributes API
 *
 * GET  /api/matches/[id]/attributes → return current attributes JSONB
 * POST /api/matches/[id]/attributes → dismiss a chip (action: "dismiss")
 *
 * AI-9534 — match data on Convex; auth on Supabase.
 */

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { getConvexServerClient } from '@/lib/convex/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const convex = getConvexServerClient()
  const data = (await convex.query(api.matches.resolveByAnyId, { id })) as
    | (Record<string, unknown> & {
        user_id?: string
        attributes?: unknown
        attributes_updated_at?: string | null
      })
    | null
  if (!data || data.user_id !== user.id) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  }

  return NextResponse.json({
    attributes: data.attributes ?? {},
    attributes_updated_at: data.attributes_updated_at ?? null,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { action?: string; category?: string; value?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action, category, value } = body

  if (action !== 'dismiss') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const VALID_CATEGORIES = ['allergy', 'dietary', 'schedule', 'lifestyle', 'logistics', 'comms']
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }
  if (!value || typeof value !== 'string') {
    return NextResponse.json({ error: 'Missing value' }, { status: 400 })
  }

  // Fetch current attributes from Convex.
  const convex = getConvexServerClient()
  const matchRow = (await convex.query(api.matches.resolveByAnyId, {
    id,
  })) as
    | (Record<string, unknown> & {
        _id?: Id<'matches'>
        user_id?: string
        attributes?: Record<string, unknown> | null
      })
    | null

  if (!matchRow || !matchRow._id || matchRow.user_id !== user.id) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  }

  const current: Record<string, unknown> = matchRow.attributes ?? {}

  // Add to _dismissed list
  const dismissed: Array<{ category: string; value: string; dismissed_at: string }> =
    Array.isArray(current._dismissed) ? (current._dismissed as any) : []

  dismissed.push({
    category,
    value,
    dismissed_at: new Date().toISOString(),
  })

  // Remove from the category list
  const catItems: Array<{ value?: string }> = Array.isArray(current[category])
    ? (current[category] as any)
    : []
  const updatedCatItems = catItems.filter(
    (item) => typeof item?.value === 'string' && item.value.toLowerCase() !== value.toLowerCase(),
  )

  const updatedAttrs = {
    ...current,
    [category]: updatedCatItems,
    _dismissed: dismissed,
  }

  try {
    await convex.mutation(api.matches.patchByUser, {
      id: matchRow._id,
      user_id: user.id,
      attributes: updatedAttrs,
      attributes_updated_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[attributes] patch failed:', err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ attributes: updatedAttrs })
}
