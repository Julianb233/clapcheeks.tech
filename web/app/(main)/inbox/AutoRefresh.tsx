'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Mount this once on /inbox. Every 30s it calls router.refresh() which
 * re-runs the server component (force-dynamic, no cache) so new her-
 * messages, queued sends, and Top 5 changes appear without a page reload.
 * Pauses while the tab is in the background to avoid wasted polls.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    let id: number | null = null
    function start() {
      if (id != null) return
      id = window.setInterval(() => router.refresh(), intervalMs)
    }
    function stop() {
      if (id != null) {
        window.clearInterval(id)
        id = null
      }
    }
    function onVisibility() {
      if (document.hidden) stop()
      else {
        router.refresh()
        start()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router, intervalMs])
  return null
}
