import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAccessStatus } from '@/lib/billing/dunning'

/**
 * GET /api/billing/status
 * Returns the authenticated user's billing access status including grace period info.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const status = await checkAccessStatus(user.id)

    return NextResponse.json(status)
  } catch (error) {
    console.error('[BILLING] Status check error:', error)
    return NextResponse.json(
      { error: 'Failed to check billing status' },
      { status: 500 }
    )
  }
}
