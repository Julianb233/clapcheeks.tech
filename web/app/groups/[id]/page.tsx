import { redirect, notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, Shield, Lock, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { JoinGroupButton } from "@/components/join-group-button"

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id } = await params

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Fetch group details
  const { data: group, error } = await supabase
    .from("groups")
    .select(
      `
      *,
      leader:profiles!groups_leader_id_fkey(id, full_name, display_name, is_verified, reputation_score, profile_image_url)
    `,
    )
    .eq("id", id)
    .single()

  if (error || !group) {
    notFound()
  }

  // Check if user is already a member
  const { data: membership } = await supabase
    .from("group_members")
    .select("*")
    .eq("group_id", id)
    .eq("user_id", user.id)
    .single()

  const isMember = !!membership
  const isLeader = group.leader_id === user.id

  // Fetch members
  const { data: members } = await supabase
    .from("group_members")
    .select(
      `
      *,
      user:profiles!group_members_user_id_fkey(id, full_name, display_name, is_verified, reputation_score, profile_image_url)
    `,
    )
    .eq("group_id", id)

  // Fetch group events
  const { data: groupEvents } = await supabase
    .from("events")
    .select("*")
    .eq("creator_id", group.leader_id)
    .eq("sport_type", group.sport_type)
    .gte("event_date", new Date().toISOString().split("T")[0])
    .order("event_date", { ascending: true })
    .limit(5)

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-purple-100 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/groups">
                <ArrowLeft className="w-5 h-5" />
                <span className="sr-only">Back</span>
              </Link>
            </Button>
            <h1 className="text-2xl font-bold text-gray-800">Group Details</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="space-y-6">
          {/* Group Header Card */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardHeader className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h2 className="text-3xl font-bold text-gray-800 mb-3">{group.name}</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                      {group.sport_type.replace("_", " ")}
                    </Badge>
                    {group.is_private && (
                      <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-200">
                        <Lock className="w-3 h-3 mr-1" />
                        Private Group
                      </Badge>
                    )}
                    {group.leader.is_verified && (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        <Shield className="w-3 h-3 mr-1" />
                        Verified Leader
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-gray-700 leading-relaxed">{group.description}</p>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Group Stats */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-600" />
                  <span className="font-semibold text-gray-800">
                    {group.current_members}/{group.max_members || "∞"} members
                  </span>
                </div>
              </div>

              {/* Join Button */}
              {!isLeader && <JoinGroupButton groupId={group.id} isMember={isMember} />}

              {isLeader && (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                  You are the leader of this group
                </Badge>
              )}
            </CardContent>
          </Card>

          {/* Leader Card */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardHeader>
              <CardTitle>Group Leader</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 flex items-center justify-center text-white font-semibold text-lg">
                  {(group.leader.display_name || group.leader.full_name || "U")[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{group.leader.display_name || group.leader.full_name}</p>
                    {group.leader.is_verified && <Shield className="w-4 h-4 text-blue-600" />}
                  </div>
                  <p className="text-sm text-gray-600">Reputation: {group.leader.reputation_score} points</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Members Card */}
          {members && members.length > 0 && (
            <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
              <CardHeader>
                <CardTitle>Members ({members.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-r from-teal-400 to-teal-600 flex items-center justify-center text-white font-semibold">
                        {(member.user.display_name || member.user.full_name || "U")[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-800">
                            {member.user.display_name || member.user.full_name}
                          </p>
                          {member.user.is_verified && <Shield className="w-3 h-3 text-blue-600" />}
                          {member.role === "leader" && (
                            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                              Leader
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">Reputation: {member.user.reputation_score} points</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upcoming Events */}
          {groupEvents && groupEvents.length > 0 && (
            <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
              <CardHeader>
                <CardTitle>Upcoming Events</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {groupEvents.map((event) => (
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
        </div>
      </main>
    </div>
  )
}
