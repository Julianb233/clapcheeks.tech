'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

const POLL_INTERVAL = 30_000 // 30 seconds
const ONLINE_THRESHOLD = 2 * 60 * 1000 // 2 minutes

interface DeviceStatus {
  last_seen_at: string
  is_active: boolean
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

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/status')
      if (!res.ok) return
      const json = await res.json()
      setDevice(json.device)
    } catch {
      // silently ignore -- keep stale data
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(fetchStatus, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const isOnline = device
    ? Date.now() - new Date(device.last_seen_at).getTime() < ONLINE_THRESHOLD
    : false

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

  // Online
  if (isOnline) {
    return (
      <div className="inline-flex items-center gap-2 border border-green-700/40 bg-green-900/30 rounded-full px-4 py-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs font-medium text-green-300">Agent online</span>
      </div>
    )
  }

  // Offline
  return (
    <div className="inline-flex items-center gap-2 border border-white/10 bg-white/5 rounded-full px-4 py-1.5">
      <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      <span className="text-xs font-medium text-white/40">Agent offline</span>
      <span className="text-xs text-white/25 ml-1">Last seen {timeAgo(device.last_seen_at)}</span>
    </div>
  )
}
