import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: clapcheeks_referrals migrated to Convex.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const convex = getConvexServerClient()
    const rows = await convex.query(api.referrals.listForReferrer, { referrer_id: user.id })
    return NextResponse.json({
      referrals: (rows ?? [])
        .map((r) => ({
          id: r._id,
          referred_id: r.referred_id ?? null,
          status: r.status,
          converted_at: r.converted_at ? new Date(r.converted_at).toISOString() : null,
          rewarded_at: r.rewarded_at ? new Date(r.rewarded_at).toISOString() : null,
          created_at: new Date(r.created_at).toISOString(),
        }))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'load_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
