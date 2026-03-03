import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Shield, CheckCircle, ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata: Metadata = { title: 'Verify Profile | Clapcheeks' }

export default async function VerifyProfilePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Get user profile
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  if (profile?.is_verified) {
    redirect("/profile")
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="bg-black/90 backdrop-blur border-b border-white/8 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/profile"
              className="text-white/40 hover:text-white/70 p-1.5 rounded-lg hover:bg-white/5 transition-all"
              aria-label="Back to profile"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold text-white">Identity Verification</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="space-y-6">
          {/* Info Card */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="text-center p-6 pb-0">
              <div className="mx-auto w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mb-4">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Get Verified</h2>
              <p className="text-white/50">Verify your identity to unlock full access</p>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <h3 className="font-semibold text-white">Why verify your identity?</h3>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <span className="text-white/60">Build trust with other members of the community</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <span className="text-white/60">Get a verified badge on your profile</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <span className="text-white/60">Increase your reputation score</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <span className="text-white/60">Access exclusive verified-only events</span>
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t border-white/[0.06]">
                <h3 className="font-semibold text-white mb-3">Verification Methods</h3>
                <p className="text-sm text-white/50 mb-4">
                  Choose one of the following methods to verify your identity:
                </p>
                <div className="space-y-3">
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                    <h4 className="font-medium text-white mb-1">Government ID</h4>
                    <p className="text-sm text-white/50 mb-3">
                      Upload a photo of your government-issued ID (passport, driver's license, or national ID)
                    </p>
                    <button className="w-full px-4 py-2 rounded-lg border border-white/[0.08] text-white/30 text-sm font-medium cursor-not-allowed" disabled>
                      Coming Soon
                    </button>
                  </div>

                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                    <h4 className="font-medium text-white mb-1">Social Media Verification</h4>
                    <p className="text-sm text-white/50 mb-3">
                      Connect your verified social media account (Instagram, Facebook, or LinkedIn)
                    </p>
                    <button className="w-full px-4 py-2 rounded-lg border border-white/[0.08] text-white/30 text-sm font-medium cursor-not-allowed" disabled>
                      Coming Soon
                    </button>
                  </div>

                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                    <h4 className="font-medium text-white mb-1">Video Verification</h4>
                    <p className="text-sm text-white/50 mb-3">
                      Complete a quick video verification call with our team
                    </p>
                    <button className="w-full px-4 py-2 rounded-lg border border-white/[0.08] text-white/30 text-sm font-medium cursor-not-allowed" disabled>
                      Coming Soon
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/[0.06]">
                <p className="text-xs text-white/30 text-center">
                  Your personal information is encrypted and stored securely. We never share your verification details
                  with other users.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
