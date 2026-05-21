'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { login } from '@/app/auth/actions'

export default function LoginForm() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const result = await login(formData)

    if (result?.error) {
      setError(result.error)
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="orb floating w-[500px] h-[500px] bg-brand-700"
          style={{ top: '-10%', right: '-10%' }}
        />
        <div
          className="orb floating-slow w-72 h-72 bg-pink-700"
          style={{ bottom: '10%', left: '-5%' }}
        />
        <div className="orb floating-delayed w-48 h-48 bg-red-800" style={{ top: '50%', right: '5%', animationDelay: '2s' }} />
      </div>

      <div className="relative w-full max-w-sm animate-scale-in">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-10">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="font-display text-3xl gold-text uppercase tracking-wide">Clapcheeks</span>
            <span className="font-body text-xs text-white/30 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10">
            </span>
          </Link>
        </div>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-yellow-500 to-transparent mx-auto mb-8" />

        {/* Card */}
        <div className="rounded-2xl p-8 shadow-2xl" style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(201,164,39,0.2)', boxShadow: '0 0 60px rgba(201,164,39,0.05)' }}>
          <h1 className="font-display text-3xl text-white uppercase mb-1">Welcome Back</h1>
          <p className="font-body text-white/40 text-sm mb-8">Sign in to your Clapcheeks account</p>

          {/* Error */}
          {(error || urlError) && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3 mb-6">
              <p className="text-red-400 text-sm">{error || urlError}</p>
            </div>
          )}

          {/* Email/password form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm text-white/60 mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm text-white/60 mb-1.5">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-gold font-body w-full py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
            >
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : null}
              Sign in
            </button>
          </form>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="underline underline-offset-2 hover:text-white/40 transition-colors">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-white/40 transition-colors">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
