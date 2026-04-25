'use client'

import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Registers the service worker and exposes an "Install app" prompt button
 * when the browser is able to install. Mount once near the root.
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

    const onInstalled = () => setDeferred(null)
    window.addEventListener('appinstalled', onInstalled)

    // Hide if user dismissed this session
    if (localStorage.getItem('cc_install_dismissed') === '1') {
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
      localStorage.setItem('cc_install_dismissed', '1')
      setDismissed(true)
    }
    setDeferred(null)
  }

  function handleSkip() {
    localStorage.setItem('cc_install_dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-black/95 border border-yellow-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-red-600 flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M12 2v13m0 0l-4-4m4 4l4-4M4 20h16" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
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
