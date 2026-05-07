// AI-9535 — Migrated to Convex queued_replies.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { getFleetUserId } from '@/lib/fleet-user'

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 11) return `+${digits}`
  return null
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { phone, message, opener_style } = body

  if (!phone) return NextResponse.json({ error: 'phone is required' }, { status: 400 })

  const handle = normalizePhone(phone)
  if (!handle) {
    return NextResponse.json(
      { error: 'Invalid phone number. Use a 10-digit US number or include country code.' },
      { status: 400 }
    )
  }

  const openers: Record<string, string> = {
    witty: "Hey — the AI made me do this 😅 But seriously, wanted to reach out.",
    warm: "Hey! Reaching out to connect — hope you're having a great day.",
    direct: "Hey, let's connect. What are you up to this week?",
  }

  const body_text = message?.trim() || openers[opener_style] || openers.warm

  try {
    const data = await getConvexServerClient().mutation(api.queues.enqueueReply, {
      user_id: getFleetUserId(),
      recipient_handle: handle,
      body: body_text,
      status: 'queued',
      source: 'web_test',
    })

    return NextResponse.json({
      ok: true, queued: data,
      message: `Message queued for ${handle}. Your Mac agent will send it within 30 seconds.`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await getConvexServerClient().query(api.queues.listRepliesForUser, {
      user_id: getFleetUserId(), source: 'web_test', limit: 20,
    })
    return NextResponse.json({ messages: data || [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
