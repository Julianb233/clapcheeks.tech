import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getValidAccessToken, createCalendarEvent, type CalendarEventInput } from '@/lib/google/calendar'

export const runtime = 'nodejs'
export const maxDuration = 30

interface CreateEventRequest {
  summary: string
  description?: string
  location?: string
  startISO: string
  endISO: string
  timeZone?: string
  attendees?: { email: string; displayName?: string }[]
  addMeet?: boolean
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: CreateEventRequest
  try {
    body = (await req.json()) as CreateEventRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.summary || !body.startISO || !body.endISO) {
    return NextResponse.json(
      { error: 'summary, startISO, endISO are required' },
      { status: 400 },
    )
  }

  const token = await getValidAccessToken(supabase, user.id)
  if (!token) {
    return NextResponse.json(
      { error: 'Calendar not connected', code: 'NOT_CONNECTED' },
      { status: 412 },
    )
  }

  const event: CalendarEventInput = {
    summary: body.summary,
    description: body.description,
    location: body.location,
    start: { dateTime: body.startISO, timeZone: body.timeZone ?? 'America/Los_Angeles' },
    end: { dateTime: body.endISO, timeZone: body.timeZone ?? 'America/Los_Angeles' },
    attendees: body.attendees,
  }

  try {
    const created = await createCalendarEvent(
      token.accessToken,
      token.tokens.calendar_id,
      event,
      {
        sendUpdates: body.sendUpdates ?? 'all',
        addMeet: body.addMeet ?? true,
      },
    )
    return NextResponse.json({
      id: created.id,
      htmlLink: created.htmlLink,
      meetLink: created.hangoutLink,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Create event failed'
    console.error('Create event error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('google_calendar_tokens')
    .select('google_email, calendar_id, scopes, created_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json({ connected: false })
  return NextResponse.json({
    connected: true,
    email: data.google_email,
    calendarId: data.calendar_id,
    scopes: data.scopes,
    connectedAt: data.created_at,
  })
}
