'use client'

import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Persist dismissals across sessions for 30 days. Sidebar-audit Fix E
// flagged this prompt as covering content (e.g. the Support form's Send
// button) with no way to make it stay gone. The prompt now only re-appears
// after 30 days OR after a fresh accepted install.
const DISMISS_STORAGE_KEY = 'cc-pwa-dismissed'
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    if (Date.now() - ts > DISMISS_TTL_MS) {
      // Expired — clear and re-show.
      window.localStorage.removeItem(DISMISS_STORAGE_KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()))
  } catch {
    // localStorage may be blocked (Safari private mode, etc.) — fall through.
  }
}

/**
 * Registers the service worker and exposes an "Install app" prompt button
 * when the browser is able to install. Mount once near the root.
 *
 * The prompt is dismissable via either the "Not now" button or the new
 * top-right close (×) — both flip a 30-day localStorage flag so it stays
 * out of the way once the user says no.
 */
export default function PWAProvider() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => console.warn('SW register failed:', err))
    }

    const onBefore = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBefore)

    const onInstalled = () => {
      // Successful install — clear any stale dismiss flag so the prompt
      // can fire on a future device if the user reinstalls.
      try { window.localStorage.removeItem(DISMISS_STORAGE_KEY) } catch { /* noop */ }
      setDeferred(null)
    }
    window.addEventListener('appinstalled', onInstalled)

    if (isDismissed()) {
      setDismissed(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBefore)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!deferred || dismissed) return null

  async function handleInstall() {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'dismissed') {
      markDismissed()
      setDismissed(true)
    }
    setDeferred(null)
  }

  function handleSkip() {
    markDismissed()
    setDismissed(true)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-black/95 border border-yellow-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
      <button
        type="button"
        onClick={handleSkip}
        aria-label="Dismiss install prompt"
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-red-600 flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M12 2v13m0 0l-4-4m4 4l4-4M4 20h16" />
          </svg>
        </div>
        <div className="flex-1 min-w-0 pr-4">
          <div className="text-sm font-semibold text-white">Install Clapcheeks</div>
          <p className="text-xs text-white/60 mt-0.5">
            Add it to your dock. Works offline, no browser bar.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleInstall}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-yellow-500 to-red-600 text-black font-medium text-xs"
            >
              Install
            </button>
            <button
              onClick={handleSkip}
              className="px-3 py-1.5 rounded-lg text-white/50 text-xs hover:text-white/80"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
