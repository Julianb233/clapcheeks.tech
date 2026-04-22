'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { signup, loginWithGoogle } from '@/app/auth/actions'

export default function SignupForm() {
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const searchParams = useSearchParams()

  // Capture referral code from URL and store in localStorage
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) {
      localStorage.setItem('clapcheeks_ref', ref)
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const password = formData.get('password') as string
    const confirm = formData.get('confirm_password') as string

    if (password !== confirm) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setIsLoading(false)
      return
    }

    // Include referral code if present
    const ref = localStorage.getItem('clapcheeks_ref')
    if (ref) {
      formData.set('ref', ref)
    }

    const result = await signup(formData)

    if (result?.error) {
      setError(result.error)
      setIsLoading(false)
    } else {
      // Clear stored referral code after successful signup
      localStorage.removeItem('clapcheeks_ref')
      setSuccess(true)
    }
  }

  async function handleGoogleSignup() {
    setGoogleLoading(true)
    // Store ref in localStorage so callback can pick it up
    await loginWithGoogle()
  }

  if (success) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="orb w-[500px] h-[500px] bg-brand-700" style={{ top: '-10%', right: '-10%' }} />
        </div>
        <div className="relative text-center max-w-sm animate-scale-in">
          <div className="w-14 h-14 bg-brand-600/20 border border-brand-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <CheckIcon />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Check your email</h1>
          <p className="text-white/40 text-sm leading-relaxed mb-6">
            We&apos;ve sent you a confirmation link. Click it to activate your account and get started.
          </p>
          <Link
            href="/auth/login"
            className="inline-block text-brand-400 hover:text-brand-300 text-sm transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
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
        <div className="orb floating w-56 h-56 bg-red-900" style={{ top: '20%', left: '5%', animationDelay: '1s' }} />
      </div>

      <div className="relative w-full max-w-sm animate-scale-in">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-10">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl font-bold gradient-text">Clapcheeks</span>
            <span className="text-xs text-white/30 font-mono bg-white/5 px-2 py-0.5 rounded">
            </span>
          </Link>
        </div>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-brand-500 to-transparent mx-auto mb-8" />

        {/* Card */}
        <div className="bg-white/[0.03] border border-white/[0.12] rounded-2xl p-8 glow-border shadow-2xl shadow-brand-900/20">
          <h1 className="text-2xl font-bold text-white mb-1">Create account</h1>
          <p className="text-white/40 text-sm mb-8">Start your AI dating co-pilot journey</p>

          {/* Referral banner */}
          {searchParams.get('ref') && (
            <div className="bg-brand-900/30 border border-brand-700/30 rounded-xl px-4 py-3 mb-6">
              <p className="text-brand-300 text-sm">You were referred by a friend! Sign up and subscribe to earn them a free month.</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3 mb-6">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleSignup}
            disabled={googleLoading || isLoading}
            className="w-full flex items-center justify-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white font-medium py-3 rounded-xl transition-all duration-200 mb-6 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-white/30 text-xs">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="full_name" className="block text-sm text-white/60 mb-1.5">
                Full name
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                autoComplete="name"
                placeholder="Alex Johnson"
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
              />
            </div>

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
                autoComplete="new-password"
                placeholder="Min. 8 characters"
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
              />
            </div>

            <div>
              <label htmlFor="confirm_password" className="block text-sm text-white/60 mb-1.5">
                Confirm password
              </label>
              <input
                id="confirm_password"
                name="confirm_password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || googleLoading}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : null}
              Create account
            </button>
          </form>

          <p className="text-center text-white/30 text-sm mt-6">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-brand-400 hover:text-brand-300 transition-colors">
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          By signing up, you agree to our{' '}
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

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 6L9 17L4 12"
        stroke="#a78bfa"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
