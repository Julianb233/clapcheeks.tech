import type { Metadata } from "next"
import Link from "next/link"
import { Mail } from "lucide-react"

export const metadata: Metadata = { title: 'Check Your Email | Clapcheeks' }

export default function SignUpSuccessPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute top-1/4 -left-32 w-64 h-64 bg-brand-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-32 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="glow-border rounded-2xl p-8 text-center">
          <div className="mx-auto w-16 h-16 bg-gradient-to-r from-pink-500 to-purple-600 rounded-full flex items-center justify-center mb-6">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Check Your Email</h1>
          <p className="text-white/50 mb-6">We've sent you a confirmation link</p>
          <p className="text-sm text-white/40 mb-6">
            Please check your email and click the confirmation link to activate your account. Once confirmed, you'll
            be able to sign in and start using Clapcheeks.
          </p>
          <Link
            href="/auth/login"
            className="block w-full px-4 py-3 rounded-xl border border-white/[0.08] text-white/70 hover:bg-white/5 transition-colors text-sm font-medium text-center"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
