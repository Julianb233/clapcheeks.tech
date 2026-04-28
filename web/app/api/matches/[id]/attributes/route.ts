/**
 * AI-8814 — Match attributes API
 *
 * GET  /api/matches/[id]/attributes → return current attributes JSONB
 * POST /api/matches/[id]/attributes → dismiss a chip (action: "dismiss")
 */

import { NextRequest, NextResponse } from 'next/server'
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

  const { data, error } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('attributes, attributes_updated_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
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

  // Fetch current attributes
  const { data: matchRow, error: fetchError } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('attributes')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !matchRow) {
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

  const { error: patchError } = await (supabase as any)
    .from('clapcheeks_matches')
    .update({ attributes: updatedAttrs })
    .eq('id', id)
    .eq('user_id', user.id)

  if (patchError) {
    console.error('[attributes] patch failed:', patchError.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ attributes: updatedAttrs })
}
