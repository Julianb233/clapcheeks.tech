import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Health Check & Monitoring System
// ---------------------------------------------------------------------------

interface HealthCheckResult {
  service: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  message?: string
  checkedAt: string
}

interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'down'
  services: HealthCheckResult[]
  timestamp: string
  version: string
}

const APP_VERSION = process.env.npm_package_version || '0.9.0'

/** Check Supabase connectivity */
async function checkSupabase(): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { error } = await supabase.from('profiles').select('id').limit(1)
    const latency = Date.now() - start

    if (error) {
      return {
        service: 'supabase',
        status: latency > 5000 ? 'down' : 'degraded',
        latencyMs: latency,
        message: error.message,
        checkedAt: new Date().toISOString(),
      }
    }

    return {
      service: 'supabase',
      status: latency > 2000 ? 'degraded' : 'healthy',
      latencyMs: latency,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      service: 'supabase',
      status: 'down',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Connection failed',
      checkedAt: new Date().toISOString(),
    }
  }
}

/** Check Stripe API connectivity */
async function checkStripe(): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    const { stripe } = await import('@/lib/stripe')
    await stripe.balance.retrieve()
    const latency = Date.now() - start

    return {
      service: 'stripe',
      status: latency > 3000 ? 'degraded' : 'healthy',
      latencyMs: latency,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      service: 'stripe',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Stripe check failed',
      checkedAt: new Date().toISOString(),
    }
  }
}

/** Check Express API backend */
async function checkApiBackend(): Promise<HealthCheckResult> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
  const start = Date.now()
  try {
    const res = await fetch(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    const latency = Date.now() - start
    const data = await res.json()

    return {
      service: 'api-backend',
      status: data.status === 'ok' ? (latency > 2000 ? 'degraded' : 'healthy') : 'degraded',
      latencyMs: latency,
      message: data.status !== 'ok' ? `API reports: ${data.status}` : undefined,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      service: 'api-backend',
      status: 'down',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Connection failed',
      checkedAt: new Date().toISOString(),
    }
  }
}

/** Run all health checks */
export async function runHealthChecks(): Promise<SystemHealth> {
  const checks = await Promise.all([
    checkSupabase(),
    checkStripe(),
    checkApiBackend(),
  ])

  const hasDown = checks.some(c => c.status === 'down')
  const hasDegraded = checks.some(c => c.status === 'degraded')

  return {
    overall: hasDown ? 'down' : hasDegraded ? 'degraded' : 'healthy',
    services: checks,
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  }
}

/** Log health check to Supabase for historical tracking */
export async function logHealthCheck(health: SystemHealth): Promise<void> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    for (const check of health.services) {
      await supabase.from('api_health_checks').insert({
        endpoint: check.service,
        status_code: check.status === 'healthy' ? 200 : check.status === 'degraded' ? 503 : 500,
        response_time_ms: check.latencyMs,
        is_healthy: check.status === 'healthy',
        error_message: check.message || null,
      })
    }
  } catch (err) {
    console.error('[MONITOR] Failed to log health check:', err)
  }
}
