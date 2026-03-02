import { Mail, ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute top-1/4 -left-32 w-64 h-64 bg-brand-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-32 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="glow-border rounded-2xl p-8 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-pink-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Mail className="w-10 h-10 text-white" />
          </div>

          <h1 className="text-3xl font-bold text-white mb-4">Verify your email</h1>

          <p className="text-white/50 mb-6 leading-relaxed">
            We sent you a verification email. Check your inbox and click the link to confirm your account.
          </p>

          <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4 mb-6">
            <p className="text-sm text-amber-300">
              <strong>Important:</strong> You won&apos;t be able to sign in until you verify your email. If you
              don&apos;t see it, check your spam folder.
            </p>
          </div>

          <Link
            href="/auth/login"
            className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 hover:from-brand-600 hover:to-purple-700 text-white font-semibold transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
