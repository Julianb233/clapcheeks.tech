'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

const POLL_INTERVAL = 30_000 // 30 seconds
const ONLINE_THRESHOLD = 2 * 60 * 1000 // 2 minutes

interface DeviceStatus {
  last_seen_at: string
  is_active: boolean
}

interface AgentTokenStatus {
  status: string | null
  degraded_platform: string | null
  degraded_reason: string | null
}

interface AgentStatusBadgeProps {
  initialDevice: { last_seen_at: string; is_active: boolean } | null
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function AgentStatusBadge({ initialDevice }: AgentStatusBadgeProps) {
  const [device, setDevice] = useState<DeviceStatus | null>(initialDevice)
  const [agentToken, setAgentToken] = useState<AgentTokenStatus | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/status')
      if (!res.ok) return
      const json = await res.json()
      setDevice(json.device)
      setAgentToken(json.agentToken)
    } catch {
      // silently ignore -- keep stale data
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const isOnline = device
    ? Date.now() - new Date(device.last_seen_at).getTime() < ONLINE_THRESHOLD
    : false

  const isDegraded = agentToken?.status === 'degraded'
  const degradedPlatform = agentToken?.degraded_platform
  const degradedReason = agentToken?.degraded_reason

  // No device found
  if (!device) {
    return (
      <div className="inline-flex items-center gap-2 border border-white/10 bg-white/5 rounded-full px-4 py-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
        <span className="text-xs font-medium text-white/40">No agent connected</span>
        <Link
          href="/device"
          className="text-xs text-purple-400 hover:text-purple-300 ml-1 underline underline-offset-2"
        >
          Set up
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Connection status badge */}
      {isOnline ? (
        <div className="inline-flex items-center gap-2 border border-green-700/40 bg-green-900/30 rounded-full px-4 py-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-medium text-green-300">Agent online</span>
        </div>
      ) : (
        <div className="inline-flex items-center gap-2 border border-white/10 bg-white/5 rounded-full px-4 py-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          <span className="text-xs font-medium text-white/40">Agent offline</span>
          <span className="text-xs text-white/25 ml-1">Last seen {timeAgo(device.last_seen_at)}</span>
        </div>
      )}

      {/* Degraded status warning banner */}
      {isDegraded && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <div className="text-amber-400 font-semibold text-sm">Agent Degraded</div>
            <p className="text-white/50 text-xs mt-0.5">
              {degradedPlatform
                ? `${degradedPlatform} automation has crashed repeatedly and may have stopped.`
                : (degradedReason || 'A platform worker has crashed repeatedly.')}
            </p>
            <p className="text-white/30 text-xs mt-1">
              Restart your agent with <code className="font-mono bg-white/5 px-1 rounded">clapcheeks restart</code>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
