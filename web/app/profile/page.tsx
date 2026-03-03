import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Shield, Heart, MessageSquare, Calendar, ArrowLeft, Edit } from "lucide-react"
import Link from "next/link"

export default async function ProfilePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Get user profile
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  // Get subscription info
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", user.id)
    .single()

  // Get aggregate dating stats
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().split("T")[0]

  const { data: analytics } = await supabase
    .from("clapcheeks_analytics_daily")
    .select("matches, conversations_started, dates_booked")
    .eq("user_id", user.id)
    .gte("date", sinceStr)

  const totalMatches = analytics?.reduce((sum, row) => sum + (row.matches || 0), 0) || 0
  const totalConvos = analytics?.reduce((sum, row) => sum + (row.conversations_started || 0), 0) || 0
  const totalDates = analytics?.reduce((sum, row) => sum + (row.dates_booked || 0), 0) || 0

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="bg-black/90 backdrop-blur border-b border-white/8 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/home"
                className="text-white/40 hover:text-white/70 p-1.5 rounded-lg hover:bg-white/5 transition-all"
                aria-label="Back to home"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-2xl font-bold text-white">My Profile</h1>
            </div>
            <Link
              href="/profile/edit"
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/[0.08] text-white/70 hover:bg-white/5 transition-colors text-sm font-medium"
            >
              <Edit className="w-4 h-4" />
              Edit Profile
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="space-y-6">
          {/* Profile Header Card */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6">
            <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
              <div className="w-24 h-24 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 flex items-center justify-center text-white font-bold text-3xl">
                {(profile?.display_name || profile?.full_name || user.email || "U")[0].toUpperCase()}
              </div>
              <div className="flex-1 text-center md:text-left space-y-3">
                <div>
                  <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                    <h2 className="text-2xl font-bold text-white">
                      {profile?.display_name || profile?.full_name || "User"}
                    </h2>
                    {profile?.is_verified && (
                      <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        <Shield className="w-3 h-3" />
                        Verified
                      </span>
                    )}
                  </div>
                  <p className="text-white/50">{user.email}</p>
                  {profile?.city && (
                    <p className="text-sm text-white/40">
                      {profile.city}, {profile.country}
                    </p>
                  )}
                  {subscription?.plan && (
                    <span className="inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 capitalize">
                      {subscription.plan} plan
                    </span>
                  )}
                </div>
                {profile?.bio && <p className="text-white/60 leading-relaxed">{profile.bio}</p>}
              </div>
            </div>

            {/* Stats Grid — last 30 days */}
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/[0.06]">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Heart className="w-4 h-4 text-pink-400" />
                  <span className="text-2xl font-bold text-pink-400">{totalMatches}</span>
                </div>
                <p className="text-sm text-white/50">Matches (30d)</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <MessageSquare className="w-4 h-4 text-purple-400" />
                  <span className="text-2xl font-bold text-purple-400">{totalConvos}</span>
                </div>
                <p className="text-sm text-white/50">Convos (30d)</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Calendar className="w-4 h-4 text-teal-400" />
                  <span className="text-2xl font-bold text-teal-400">{totalDates}</span>
                </div>
                <p className="text-sm text-white/50">Dates (30d)</p>
              </div>
            </div>
          </div>

          {/* Verification Status Card */}
          {!profile?.is_verified && (
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-6 h-6 text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-white mb-2">Get Verified</h3>
                  <p className="text-sm text-white/50 mb-4">
                    Verify your identity to build trust and unlock additional features.
                  </p>
                  <Link
                    href="/profile/verify"
                    className="inline-block px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white text-sm font-medium transition-colors"
                  >
                    Start Verification
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Connected Platforms */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-white font-semibold">Connected Platforms</h2>
            </div>
            <div className="p-5 space-y-3">
              {[
                { name: "Tinder", color: "from-red-400 to-orange-500" },
                { name: "Bumble", color: "from-yellow-400 to-amber-500" },
                { name: "Hinge", color: "from-pink-400 to-rose-600" },
              ].map((platform) => (
                <div key={platform.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-r ${platform.color} flex items-center justify-center`}>
                      <span className="text-white text-xs font-bold">{platform.name[0]}</span>
                    </div>
                    <span className="text-white/70 font-medium">{platform.name}</span>
                  </div>
                  <span className="text-sm text-white/30">Not connected</span>
                </div>
              ))}
              <p className="text-xs text-white/30 pt-2">
                Platforms are connected automatically when your local Clapcheeks agent is running.
              </p>
            </div>
          </div>

          {/* Account Info */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-white font-semibold">Account</h2>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-white/50">Email</span>
                <span className="text-white/70 text-sm">{user.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/50">Member since</span>
                <span className="text-white/70 text-sm">
                  {new Date(user.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/50">Plan</span>
                <span className="text-white/70 text-sm capitalize">
                  {subscription?.plan || "Free"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
