import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Shield, Award, Calendar, Users, ArrowLeft, Edit } from "lucide-react"
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

  // Get user's events
  const { data: createdEvents } = await supabase
    .from("events")
    .select("*")
    .eq("creator_id", user.id)
    .order("event_date", { ascending: false })
    .limit(5)

  const { data: joinedEvents } = await supabase
    .from("event_participants")
    .select(
      `
      *,
      event:events(*)
    `,
    )
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false })
    .limit(5)

  // Get user's groups
  const { data: groups } = await supabase
    .from("group_members")
    .select(
      `
      *,
      group:groups(*)
    `,
    )
    .eq("user_id", user.id)

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
                </div>
                {profile?.bio && <p className="text-white/60 leading-relaxed">{profile.bio}</p>}
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/[0.06]">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Calendar className="w-4 h-4 text-purple-400" />
                  <span className="text-2xl font-bold text-purple-400">{profile?.total_events_attended || 0}</span>
                </div>
                <p className="text-sm text-white/50">Events Joined</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Users className="w-4 h-4 text-pink-400" />
                  <span className="text-2xl font-bold text-pink-400">{profile?.total_events_created || 0}</span>
                </div>
                <p className="text-sm text-white/50">Events Created</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Award className="w-4 h-4 text-teal-400" />
                  <span className="text-2xl font-bold text-teal-400">{profile?.reputation_score || 0}</span>
                </div>
                <p className="text-sm text-white/50">Reputation</p>
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
                    Verify your identity to build trust with the community and unlock additional features.
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

          {/* Preferred Sports */}
          {profile?.preferred_sports && profile.preferred_sports.length > 0 && (
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.06]">
                <h2 className="text-white font-semibold">Preferred Sports</h2>
              </div>
              <div className="p-5">
                <div className="flex flex-wrap gap-2">
                  {profile.preferred_sports.map((sport: string) => (
                    <span key={sport} className="text-xs font-medium px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {sport.replace("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Groups */}
          {groups && groups.length > 0 && (
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.06]">
                <h2 className="text-white font-semibold">My Groups ({groups.length})</h2>
              </div>
              <div className="p-5 space-y-3">
                {groups.map((membership: { id: string; role: string; group: { id: string; name: string; sport_type: string } }) => (
                  <Link
                    key={membership.id}
                    href={`/groups/${membership.group.id}`}
                    className="block p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-white">{membership.group.name}</p>
                        <p className="text-sm text-white/40">{membership.group.sport_type.replace("_", " ")}</p>
                      </div>
                      {membership.role === "leader" && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          Leader
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Created Events */}
          {createdEvents && createdEvents.length > 0 && (
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.06]">
                <h2 className="text-white font-semibold">Events I Created</h2>
              </div>
              <div className="p-5 space-y-3">
                {createdEvents.map((event: { id: string; title: string; event_date: string; event_time: string }) => (
                  <Link
                    key={event.id}
                    href={`/events/${event.id}`}
                    className="block p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
                  >
                    <p className="font-medium text-white">{event.title}</p>
                    <p className="text-sm text-white/40">
                      {new Date(event.event_date).toLocaleDateString()} at {event.event_time}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Joined Events */}
          {joinedEvents && joinedEvents.length > 0 && (
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.06]">
                <h2 className="text-white font-semibold">Events I Joined</h2>
              </div>
              <div className="p-5 space-y-3">
                {joinedEvents.map((participation: { id: string; event: { id: string; title: string; event_date: string; event_time: string } }) => (
                  <Link
                    key={participation.id}
                    href={`/events/${participation.event.id}`}
                    className="block p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
                  >
                    <p className="font-medium text-white">{participation.event.title}</p>
                    <p className="text-sm text-white/40">
                      {new Date(participation.event.event_date).toLocaleDateString()} at{" "}
                      {participation.event.event_time}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
