import { createClient } from '@/lib/convex/compat-client'
import { convexHealth } from '@/lib/convex/http'
import { getRuntimeHealth } from '@/lib/clapcheeks/runtime-health'

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

async function checkConvex(): Promise<HealthCheckResult> {
  const start = Date.now()
  const result = await convexHealth()
  const latency = Date.now() - start
  return {
    service: 'convex',
    status: result.ok ? (latency > 2000 ? 'degraded' : 'healthy') : 'down',
    latencyMs: latency,
    message: result.ok ? undefined : result.error,
    checkedAt: new Date().toISOString(),
  }
}

async function checkStripe(): Promise<HealthCheckResult> {
  const start = Date.now()
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      service: 'stripe',
      status: 'healthy',
      latencyMs: Date.now() - start,
      message: 'skipped: STRIPE_SECRET_KEY not configured in this environment',
      checkedAt: new Date().toISOString(),
    }
  }
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

async function checkApiBackend(): Promise<HealthCheckResult> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  const start = Date.now()
  if (!apiUrl) {
    return {
      service: 'api-backend',
      status: 'healthy',
      latencyMs: Date.now() - start,
      message: 'skipped: Convex is the runtime source; NEXT_PUBLIC_API_URL is optional',
      checkedAt: new Date().toISOString(),
    }
  }
  try {
    const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5000) })
    const latency = Date.now() - start
    const data = await res.json().catch(() => ({}))
    return {
      service: 'api-backend',
      status: res.ok && data.status === 'ok' ? (latency > 2000 ? 'degraded' : 'healthy') : 'degraded',
      latencyMs: latency,
      message: res.ok ? undefined : `API HTTP ${res.status}`,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      service: 'api-backend',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Connection failed',
      checkedAt: new Date().toISOString(),
    }
  }
}

async function checkInboundWatcher(): Promise<HealthCheckResult> {
  const start = Date.now()
  const runtime = getRuntimeHealth()
  return {
    service: 'inbound-watcher',
    status: runtime.ok ? 'healthy' : 'degraded',
    latencyMs: Date.now() - start,
    message: runtime.ok
      ? 'chat.db tailer can read Messages and no FDA alert send is enabled'
      : runtime.blockers.map((item) => `${item.name}: ${item.reason}`).join('; '),
    checkedAt: new Date().toISOString(),
  }
}

export async function runHealthChecks(): Promise<SystemHealth> {
  const checks = await Promise.all([checkConvex(), checkStripe(), checkApiBackend(), checkInboundWatcher()])
  const convex = checks.find((c) => c.service === 'convex')
  const hasDegraded = checks.some((c) => c.status === 'degraded')
  return {
    overall: convex?.status === 'down' ? 'down' : hasDegraded ? 'degraded' : 'healthy',
    services: checks,
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  }
}

export async function logHealthCheck(health: SystemHealth): Promise<void> {
  try {
    const convex = createClient()
    for (const check of health.services) {
      await convex.from('api_health_checks').insert({
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
