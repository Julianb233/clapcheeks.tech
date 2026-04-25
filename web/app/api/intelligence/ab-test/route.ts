import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Stub-grade A/B opener results until clapcheeks_opener_log is populated.
// Returns empty styles array — the client renders a clean "no data yet" state.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ styles: [], winner: null })
}
