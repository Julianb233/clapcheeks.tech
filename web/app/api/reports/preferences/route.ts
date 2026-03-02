import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data } = await supabase
      .from('clapcheeks_report_preferences')
      .select('email_enabled, send_day, send_hour')
      .eq('user_id', user.id)
      .single()

    return NextResponse.json(data || { email_enabled: true, send_day: 'monday', send_hour: 9 })
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

    const { error } = await supabase
      .from('clapcheeks_report_preferences')
      .upsert(
        {
          user_id: user.id,
          email_enabled: email_enabled ?? true,
          send_day: send_day ?? 'sunday',
          send_hour: send_hour ?? 8,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

    if (error) {
      console.error('Preferences update error:', error)
      return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Preferences API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
