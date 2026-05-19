'use client'

import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Exposes an "Install app" prompt button when the browser can install.
 *
 * Older production builds registered `/sw.js`. The app now keeps dynamic
 * dashboard routes network-first, so any existing worker must be retired or
 * it can keep serving a stale loading shell after deploys.
 */
export default function PWAProvider() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    async function unregisterStaleWorkers() {
      if (!('serviceWorker' in navigator)) return
      try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(
          registrations
            .filter((registration) => registration.scope.startsWith(window.location.origin))
            .map((registration) => registration.unregister()),
        )
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((key) => caches.delete(key)))
        }
      } catch (err) {
        console.warn('SW cleanup failed:', err)
      }
    }

    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      if (process.env.NEXT_PUBLIC_ENABLE_PWA_SW === '1') {
        fetch('/sw.js', { method: 'HEAD', cache: 'no-store' })
          .then((res) => {
            if (res.ok) {
              void navigator.serviceWorker.register('/sw.js', { scope: '/' })
              return
            }
            return unregisterStaleWorkers()
          })
          .catch((err) => console.warn('SW register failed:', err))
      } else {
        void unregisterStaleWorkers()
      }
    }

    const onBefore = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBefore)

    const onInstalled = () => setDeferred(null)
    window.addEventListener('appinstalled', onInstalled)

    // Hide if user dismissed this session
    if (sessionStorage.getItem('cc_install_dismissed') === '1') {
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
      sessionStorage.setItem('cc_install_dismissed', '1')
      setDismissed(true)
    }
    setDeferred(null)
  }

  function handleSkip() {
    sessionStorage.setItem('cc_install_dismissed', '1')
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
