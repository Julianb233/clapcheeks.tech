'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function ActivatePage() {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      setStatus('error')
      setErrorMsg('You must be logged in to activate a device.')
      return
    }

    // Approve the device code via the API
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://clapcheeks-api.up.railway.app'
    const res = await fetch(`${apiUrl}/auth/device/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    })

    if (res.ok) {
      setStatus('success')
    } else {
      const data = await res.json().catch(() => ({ error: 'Unknown error' }))
      setStatus('error')
      setErrorMsg(data.error || 'Failed to activate device')
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Activate Device</h1>
          <p className="text-white/50 text-sm">
            Enter the code shown in your CLI to link this device to your account.
          </p>
        </div>

        {status === 'success' ? (
          <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-900/60 border border-emerald-600/50 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Device Activated</h2>
            <p className="text-white/50 text-sm mb-6">
              Your CLI is now connected. You can close this page.
            </p>
            <Link
              href="/dashboard"
              className="inline-block bg-white/6 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-200 text-sm"
            >
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-8">
              <label htmlFor="device-code" className="block text-sm font-medium text-white/70 mb-3">
                Device Code
              </label>
              <input
                id="device-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX"
                maxLength={9}
                className="w-full bg-white/[0.04] border border-white/12 rounded-xl px-4 py-3 text-white text-center text-2xl font-mono tracking-[0.2em] placeholder:text-white/20 focus:outline-none focus:border-brand-600/60 focus:ring-1 focus:ring-brand-600/30 transition-all"
                autoFocus
                autoComplete="off"
              />

              {status === 'error' && (
                <p className="mt-3 text-sm text-red-400">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={code.trim().length < 9 || status === 'loading'}
                className="w-full mt-6 bg-brand-600 hover:bg-brand-500 disabled:bg-white/6 disabled:text-white/30 text-white font-semibold py-3 rounded-xl transition-all duration-200 text-sm"
              >
                {status === 'loading' ? 'Activating...' : 'Activate Device'}
              </button>
            </div>

            <p className="text-center text-xs text-white/25 mt-4">
              Run <code className="text-brand-400 bg-white/5 px-1.5 py-0.5 rounded font-mono">clapcheeks login</code> in your terminal to get a code.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
