import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Normalize a phone number to +1XXXXXXXXXX format
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 11) return `+${digits}` // international
  return null
}

// POST /api/imessage/test — queue a test iMessage to a phone number
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { phone, message, opener_style } = body

  if (!phone) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }

  const handle = normalizePhone(phone)
  if (!handle) {
    return NextResponse.json(
      { error: 'Invalid phone number. Use a 10-digit US number or include country code.' },
      { status: 400 }
    )
  }

  // Use provided message or a default opener based on style
  const openers: Record<string, string> = {
    witty: "Hey — the AI made me do this 😅 But seriously, wanted to reach out.",
    warm: "Hey! Reaching out to connect — hope you're having a great day.",
    direct: "Hey, let's connect. What are you up to this week?",
  }

  const body_text = message?.trim() || openers[opener_style] || openers.warm

  // Insert into the queue — local Mac agent will pick this up within 30s
  const { data, error } = await supabase
    .from('clapcheeks_queued_replies')
    .insert({
      user_id: user.id,
      recipient_handle: handle,
      body: body_text,
      status: 'queued',
      source: 'web_test',
    })
    .select('id, recipient_handle, body, status, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    queued: data,
    message: `Message queued for ${handle}. Your Mac agent will send it within 30 seconds.`,
  })
}

// GET /api/imessage/test — list recent test messages for this user
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('clapcheeks_queued_replies')
    .select('id, recipient_handle, body, status, created_at, source')
    .eq('user_id', user.id)
    .eq('source', 'web_test')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ messages: data || [] })
}
