import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data } = await supabase
    .from('devices')
    .select('last_seen_at, is_active')
    .eq('user_id', user.id)
    .order('last_seen_at', { ascending: false })
    .limit(1)

  const device = data?.[0] || null

  return NextResponse.json({ device })
}
