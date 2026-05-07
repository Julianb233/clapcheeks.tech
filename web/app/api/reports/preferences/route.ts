import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: report_preferences now lives on Convex.

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const convex = getConvexServerClient()
    const data = await convex.query(api.reportPreferences.getForUser, { user_id: user.id })

    return NextResponse.json(
      data
        ? {
            email_enabled: data.email_enabled,
            send_day: data.send_day,
            send_hour: data.send_hour,
          }
        : { email_enabled: true, send_day: 'monday', send_hour: 9 },
    )
  } catch (error) {
    console.error('Preferences GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { email_enabled, send_day, send_hour } = body

    try {
      const convex = getConvexServerClient()
      await convex.mutation(api.reportPreferences.upsertForUser, {
        user_id: user.id,
        email_enabled: email_enabled ?? true,
        send_day: send_day ?? 'sunday',
        send_hour: send_hour ?? 8,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed'
      console.error('Preferences update error:', msg)
      return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Preferences API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
