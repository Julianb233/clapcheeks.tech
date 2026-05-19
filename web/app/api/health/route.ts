import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'
import { runHealthChecks, logHealthCheck } from '@/lib/monitoring/health'

export const runtime = 'nodejs'
// Disable caching for health checks
export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 * System health check endpoint. Public (no auth).
 * Used by uptime monitors, load balancers, and internal dashboards.
 *
 * Query params:
 *   ?detailed=true  — include per-service breakdown (requires CRON_SECRET or a signed-in dashboard user)
 *   ?log=true       — persist results to DB (requires CRON_SECRET)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const detailed = params.get('detailed') === 'true'
  const shouldLog = params.get('log') === 'true'

  // Auth for detailed/log endpoints. Uptime monitors can use CRON_SECRET;
  // signed-in dashboard users can read detailed health from the app.
  const cronSecret = process.env.CRON_SECRET
  if ((detailed || shouldLog) && cronSecret) {
    const auth = request.headers.get('authorization')
    let isAuthorized = auth === `Bearer ${cronSecret}`

    if (!isAuthorized && detailed && !shouldLog) {
      const convex = await createClient()
      const { data: { user } } = await convex.auth.getUser()
      isAuthorized = Boolean(user)
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const health = await runHealthChecks()

    if (shouldLog) {
      await logHealthCheck(health)
    }

    if (detailed) {
      return NextResponse.json(health, {
        status: health.overall === 'healthy' ? 200 : 503,
      })
    }

    // Simple response for uptime monitors
    return NextResponse.json({
      status: health.overall,
      version: health.version,
      timestamp: health.timestamp,
    }, {
      status: health.overall === 'healthy' ? 200 : 503,
    })
  } catch (error) {
    console.error('[HEALTH] Check failed:', error)
    return NextResponse.json({
      status: 'down',
      error: 'Health check failed',
    }, { status: 503 })
  }
}
