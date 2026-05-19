import { NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'

export async function POST() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'manual_match_sync_not_wired',
      message: 'Manual dashboard sync is disabled until Tinder/Hinge auth tokens are present. The MBP daemon still runs scheduled match sync.',
    },
    { status: 501 },
  )
}
