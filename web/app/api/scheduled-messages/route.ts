import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/scheduled-messages — list messages for current user
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') // pending, approved, sent, all
  const limit = parseInt(searchParams.get('limit') ?? '50')

  let query = supabase
    .from('clapcheeks_scheduled_messages')
    .select('*')
    .eq('user_id', user.id)
    .order('scheduled_at', { ascending: true })
    .limit(limit)

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ messages: data ?? [] })
}

// POST /api/scheduled-messages — create a scheduled message
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    match_name,
    match_id,
    platform,
    phone,
    message_text,
    scheduled_at,
    sequence_type,
    sequence_step,
    delay_hours,
  } = body

  if (!match_name || !message_text || !scheduled_at) {
    return NextResponse.json(
      { error: 'match_name, message_text, and scheduled_at are required' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('clapcheeks_scheduled_messages')
    .insert({
      user_id: user.id,
      match_id: match_id ?? null,
      match_name,
      platform: platform ?? 'iMessage',
      phone: phone ?? null,
      message_text,
      scheduled_at,
      sequence_type: sequence_type ?? 'manual',
      sequence_step: sequence_step ?? 0,
      delay_hours: delay_hours ?? null,
      status: 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: data }, { status: 201 })
}
