import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 11) return `+${digits}`
  return null
}

type SendResult = { ok: true; channel: string } | { ok: false; channel: string; error: string }

async function sendViaBlueBubbles(
  baseUrl: string | undefined,
  password: string | undefined,
  handle: string,
  body: string,
  timeoutMs: number,
): Promise<SendResult> {
  if (!baseUrl || !password) return { ok: false, channel: 'bluebubbles', error: 'not configured' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/v1/message/text?password=${encodeURIComponent(password)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatGuid: `iMessage;-;${handle}`, message: body, method: 'apple-script' }),
      signal: ctrl.signal,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, channel: `bluebubbles:${baseUrl}`, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    return { ok: true, channel: `bluebubbles:${baseUrl}` }
  } catch (e) {
    return { ok: false, channel: `bluebubbles:${baseUrl}`, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(t)
  }
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
    witty: "Hey - the AI made me do this. But seriously, wanted to reach out.",
    warm: "Hey! Reaching out to connect - hope you're having a great day.",
    direct: "Hey, let's connect. What are you up to this week?",
  }
  const body_text = message?.trim() || openers[opener_style] || openers.warm

  const { data: queued } = await supabase
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

  const timeoutMs = Number(process.env.BLUEBUBBLES_TIMEOUT_MS || '10000')
  const primary = await sendViaBlueBubbles(
    process.env.BLUEBUBBLES_URL,
    process.env.BLUEBUBBLES_PASSWORD,
    handle, body_text, timeoutMs,
  )
  let result: SendResult = primary
  if (!primary.ok) {
    const fallback = await sendViaBlueBubbles(
      process.env.BLUEBUBBLES_URL_FALLBACK,
      process.env.BLUEBUBBLES_PASSWORD_FALLBACK,
      handle, body_text, timeoutMs,
    )
    if (fallback.ok) result = fallback
    else result = { ok: false, channel: 'bluebubbles:both', error: `primary: ${primary.error} | fallback: ${fallback.error}` }
  }

  if (queued?.id) {
    await supabase
      .from('clapcheeks_queued_replies')
      .update({ status: result.ok ? 'sent' : 'failed' })
      .eq('id', queued.id)
  }

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      sent: true,
      via: result.channel,
      queued,
      message: `Sent to ${handle} via ${result.channel}.`,
    })
  }

  return NextResponse.json({
    ok: true,
    sent: false,
    via: 'queue',
    queued,
    message: `BlueBubbles unavailable. Queued for AppleScript fallback. Detail: ${result.error}`,
  })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('clapcheeks_queued_replies')
    .select('id, recipient_handle, body, status, created_at, source')
    .eq('user_id', user.id)
    .eq('source', 'web_test')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages: data || [] })
}
