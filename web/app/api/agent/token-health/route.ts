import { NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'
import { getTokenHealth } from '@/lib/clapcheeks/token-health'

export async function GET() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const health = await getTokenHealth(user.id)
  return NextResponse.json({
    ...health,
    note: 'Token values are intentionally omitted; this endpoint reports presence and metadata only.',
  })
}
