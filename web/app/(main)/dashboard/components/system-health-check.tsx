'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'

type HealthStatus = 'healthy' | 'degraded' | 'down'

type HealthService = {
  service: string
  status: HealthStatus
  latencyMs: number
  message?: string
  checkedAt: string
}

type HealthResponse = {
  overall: HealthStatus
  services: HealthService[]
  timestamp: string
  version: string
}

function tone(status: HealthStatus) {
  if (status === 'healthy') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'degraded') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  return 'border-rose-500/30 bg-rose-500/10 text-rose-200'
}

function label(status: HealthStatus) {
  if (status === 'healthy') return 'Healthy'
  if (status === 'degraded') return 'Degraded'
  return 'Down'
}

export default function SystemHealthCheck() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadHealth() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/health?detailed=true', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!json || !Array.isArray(json.services)) {
        throw new Error(res.ok ? 'Unexpected health payload' : `Health check failed with HTTP ${res.status}`)
      }
      setHealth(json as HealthResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHealth()
  }, [])

  const blockers = useMemo(
    () => health?.services.filter((service) => service.status !== 'healthy') ?? [],
    [health],
  )

  const overall = health?.overall ?? 'degraded'

  return (
    <section className="bg-white/[0.035] border border-white/10 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-300" />
            <h2 className="text-white font-semibold text-sm">Health check</h2>
          </div>
          <p className="mt-1 text-xs text-white/40">
            Live runtime, Convex, billing, and watcher status.
          </p>
        </div>
        <button
          type="button"
          onClick={loadHealth}
          disabled={loading}
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          aria-label="Refresh health check"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className={`mb-3 inline-flex rounded border px-2.5 py-1 text-[10px] uppercase tracking-widest font-mono ${tone(overall)}`}>
        {loading && !health ? 'Checking' : label(overall)}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/80">
          {error}
        </div>
      ) : (
        <div className="space-y-2">
          {(health?.services ?? []).map((service) => (
            <div key={service.service} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">{service.service}</div>
                {service.message && (
                  <div className="mt-0.5 truncate text-[10px] text-white/35">{service.message}</div>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <span className="text-[10px] font-mono text-white/35">{service.latencyMs}ms</span>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-mono ${tone(service.status)}`}>
                  {label(service.status)}
                </span>
              </div>
            </div>
          ))}
          {!loading && health && blockers.length === 0 && (
            <p className="text-[11px] text-emerald-200/70">No runtime blockers found.</p>
          )}
          {!loading && health && blockers.length > 0 && (
            <p className="text-[11px] text-amber-100/70">
              {blockers.length} service{blockers.length === 1 ? '' : 's'} need attention.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
