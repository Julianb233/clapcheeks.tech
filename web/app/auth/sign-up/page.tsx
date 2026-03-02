"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

export default function SignUpPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const router = useRouter()

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    if (password !== repeatPassword) {
      setError("Passwords don't match")
      setIsLoading(false)
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters")
      setIsLoading(false)
      return
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL || `${window.location.origin}/auth/login`,
          data: {
            full_name: fullName,
          },
        },
      })

      if (error) throw error

      if (data.user) {
        setShowSuccess(true)
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Something went wrong. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (showSuccess) {
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
        </div>

        <div className="relative w-full max-w-md animate-scale-in">
          <div className="bg-white/[0.03] border border-white/[0.12] rounded-2xl p-8 glow-border shadow-2xl shadow-brand-900/20 text-center">
            <div className="mx-auto w-16 h-16 bg-gradient-to-r from-brand-500 to-brand-700 rounded-full flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
            <p className="text-white/40 text-sm mb-6">
              We sent a verification link to <strong className="text-white/70">{email}</strong>
            </p>
            <p className="text-sm text-white/30 mb-6">
              Click the link in your email to verify your account. After verifying, you can sign in and complete your setup.
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-brand-900/40"
            >
              Go to Sign In
            </button>
          </div>
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
          style={{ top: '-10%', left: '-10%' }}
        />
        <div
          className="orb floating-slow w-72 h-72 bg-pink-700"
          style={{ bottom: '10%', right: '-5%' }}
        />
      </div>

      <div className="relative w-full max-w-sm animate-scale-in">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-10">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-2xl font-bold gradient-text">Clapcheeks</span>
            <span className="text-xs text-white/30 font-mono bg-white/5 px-2 py-0.5 rounded">
              beta
            </span>
          </Link>
        </div>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-brand-500 to-transparent mx-auto mb-8" />

        {/* Card */}
        <div className="bg-white/[0.03] border border-white/[0.12] rounded-2xl p-8 glow-border shadow-2xl shadow-brand-900/20">
          <h1 className="text-2xl font-bold text-white mb-1">Create your account</h1>
          <p className="text-white/40 text-sm mb-8">Join Clapcheeks — your AI dating co-pilot</p>

          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label htmlFor="fullName" className="block text-sm text-white/60 mb-1.5">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                placeholder="Your name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
              />
            </div>

            <div>
              <label htmlFor="repeat-password" className="block text-sm text-white/60 mb-1.5">
                Confirm Password
              </label>
              <input
                id="repeat-password"
                name="repeat-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="Repeat your password"
                value={repeatPassword}
                onChange={(e) => setRepeatPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
              />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-brand-900/40"
            >
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : null}
              Create Account
            </button>

            <p className="text-xs text-center text-white/30">
              Free to start — no credit card required
            </p>
          </form>

          <p className="text-center text-white/30 text-sm mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-brand-400 hover:text-brand-300 transition-colors">
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-white/40 transition-colors">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-white/40 transition-colors">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
