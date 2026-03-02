import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-purple-100 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" asChild>
                <Link href="/home">
                  <ArrowLeft className="w-5 h-5" />
                  <span className="sr-only">Back</span>
                </Link>
              </Button>
              <h1 className="text-2xl font-bold text-gray-800">My Profile</h1>
            </div>
            <Button variant="outline" asChild>
              <Link href="/profile/edit">
                <Edit className="w-4 h-4 mr-2" />
                Edit Profile
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="space-y-6">
          {/* Profile Header Card */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                <div className="w-24 h-24 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 flex items-center justify-center text-white font-bold text-3xl">
                  {(profile?.display_name || profile?.full_name || user.email || "U")[0].toUpperCase()}
                </div>
                <div className="flex-1 text-center md:text-left space-y-3">
                  <div>
                    <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                      <h2 className="text-2xl font-bold text-gray-800">
                        {profile?.display_name || profile?.full_name || "User"}
                      </h2>
                      {profile?.is_verified && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          <Shield className="w-3 h-3 mr-1" />
                          Verified
                        </Badge>
                      )}
                    </div>
                    <p className="text-gray-600">{user.email}</p>
                    {profile?.city && (
                      <p className="text-sm text-gray-500">
                        {profile.city}, {profile.country}
                      </p>
                    )}
                  </div>
                  {profile?.bio && <p className="text-gray-700 leading-relaxed">{profile.bio}</p>}
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-100">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Calendar className="w-4 h-4 text-purple-600" />
                    <span className="text-2xl font-bold text-purple-600">{profile?.total_events_attended || 0}</span>
                  </div>
                  <p className="text-sm text-gray-600">Events Joined</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Users className="w-4 h-4 text-pink-600" />
                    <span className="text-2xl font-bold text-pink-600">{profile?.total_events_created || 0}</span>
                  </div>
                  <p className="text-sm text-gray-600">Events Created</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Award className="w-4 h-4 text-teal-600" />
                    <span className="text-2xl font-bold text-teal-600">{profile?.reputation_score || 0}</span>
                  </div>
                  <p className="text-sm text-gray-600">Reputation</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Verification Status Card */}
          {!profile?.is_verified && (
            <Card className="border-0 bg-gradient-to-r from-blue-50 to-purple-50 shadow-lg">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Shield className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-800 mb-2">Get Verified</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Verify your identity to build trust with the community and unlock additional features.
                    </p>
                    <Button
                      className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
                      asChild
                    >
                      <Link href="/profile/verify">Start Verification</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Preferred Sports */}
          {profile?.preferred_sports && profile.preferred_sports.length > 0 && (
            <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
              <CardHeader>
                <CardTitle>Preferred Sports</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {profile.preferred_sports.map((sport) => (
                    <Badge key={sport} variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                      {sport.replace("_", " ")}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Groups */}
          {groups && groups.length > 0 && (
            <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
              <CardHeader>
                <CardTitle>My Groups ({groups.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {groups.map((membership) => (
                    <Link
                      key={membership.id}
                      href={`/groups/${membership.group.id}`}
                      className="block p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-800">{membership.group.name}</p>
                          <p className="text-sm text-gray-600">{membership.group.sport_type.replace("_", " ")}</p>
                        </div>
                        {membership.role === "leader" && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            Leader
                          </Badge>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Created Events */}
          {createdEvents && createdEvents.length > 0 && (
            <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
              <CardHeader>
                <CardTitle>Events I Created</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {createdEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={`/events/${event.id}`}
                      className="block p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <p className="font-medium text-gray-800">{event.title}</p>
                      <p className="text-sm text-gray-600">
                        {new Date(event.event_date).toLocaleDateString()} at {event.event_time}
                      </p>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Joined Events */}
          {joinedEvents && joinedEvents.length > 0 && (
            <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
              <CardHeader>
                <CardTitle>Events I Joined</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {joinedEvents.map((participation) => (
                    <Link
                      key={participation.id}
                      href={`/events/${participation.event.id}`}
                      className="block p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <p className="font-medium text-gray-800">{participation.event.title}</p>
                      <p className="text-sm text-gray-600">
                        {new Date(participation.event.event_date).toLocaleDateString()} at{" "}
                        {participation.event.event_time}
                      </p>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
