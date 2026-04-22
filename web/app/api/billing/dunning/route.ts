import { NextRequest, NextResponse } from 'next/server'
import { processExpiredGracePeriods } from '@/lib/billing/dunning'

export const runtime = 'nodejs'

/**
 * POST /api/billing/dunning
 * Cron-triggered endpoint to process expired grace periods.
 * Protected by CRON_SECRET to prevent unauthorized access.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processExpiredGracePeriods()

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[BILLING] Dunning cron error:', error)
    return NextResponse.json(
      { error: 'Dunning processing failed' },
      { status: 500 }
    )
  }
}
