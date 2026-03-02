import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Bell, User, LogOut, MessageSquare, Lock, Activity, Calendar } from "lucide-react"
import Link from "next/link"

export default async function HomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Get user profile
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  if (!profile) {
    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email!,
      full_name: user.user_metadata?.full_name || null,
    })
  }

  const handleSignOut = async () => {
    "use server"
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect("/")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-purple-100 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
              Clapcheeks
            </h1>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" asChild>
                <Link href="/diagnostics">
                  <Activity className="w-5 h-5" />
                  <span className="sr-only">Agent Status</span>
                </Link>
              </Button>
              <Button variant="ghost" size="icon" asChild>
                <Link href="/groups">
                  <MessageSquare className="w-5 h-5" />
                  <span className="sr-only">Conversations</span>
                </Link>
              </Button>
              <Button variant="ghost" size="icon" className="relative" asChild>
                <Link href="/notifications">
                  <Bell className="w-5 h-5" />
                  <span className="sr-only">Notifications</span>
                </Link>
              </Button>
              <Button variant="ghost" size="icon" asChild>
                <Link href="/profile">
                  <User className="w-5 h-5" />
                  <span className="sr-only">Profile</span>
                </Link>
              </Button>
              <form action={handleSignOut}>
                <Button variant="ghost" size="icon" type="submit">
                  <LogOut className="w-5 h-5" />
                  <span className="sr-only">Sign out</span>
                </Button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Welcome Section */}
          <div className="text-center space-y-3">
            <h2 className="text-3xl font-bold text-gray-800">
              Welcome back, {profile?.full_name || user.email?.split("@")[0]}!
            </h2>
            <p className="text-lg text-gray-600">Your agent is running. Here&apos;s your dating activity.</p>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white/80 backdrop-blur rounded-xl p-4 text-center shadow-sm">
              <div className="text-2xl font-bold text-purple-600">{profile?.total_swipes || 0}</div>
              <div className="text-sm text-gray-600">Swipes Today</div>
            </div>
            <div className="bg-white/80 backdrop-blur rounded-xl p-4 text-center shadow-sm">
              <div className="text-2xl font-bold text-pink-600">{profile?.total_matches || 0}</div>
              <div className="text-sm text-gray-600">Total Matches</div>
            </div>
            <div className="bg-white/80 backdrop-blur rounded-xl p-4 text-center shadow-sm">
              <div className="text-2xl font-bold text-teal-600">{profile?.active_conversations || 0}</div>
              <div className="text-sm text-gray-600">Active Convos</div>
            </div>
            <div className="bg-white/80 backdrop-blur rounded-xl p-4 text-center shadow-sm">
              <div className="text-2xl font-bold text-orange-600">{profile?.dates_booked || 0}</div>
              <div className="text-sm text-gray-600">Dates Booked</div>
            </div>
          </div>

          {/* Quick Nav */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link href="/groups" className="bg-white/80 backdrop-blur rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="font-semibold text-gray-800">Conversations</div>
                <div className="text-sm text-gray-500">Active iMessage threads</div>
              </div>
            </Link>
            <Link href="/events" className="bg-white/80 backdrop-blur rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-r from-teal-500 to-purple-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="font-semibold text-gray-800">Upcoming Dates</div>
                <div className="text-sm text-gray-500">Scheduled & proposed</div>
              </div>
            </Link>
            <Link href="/safety" className="bg-white/80 backdrop-blur rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-teal-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <Lock className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="font-semibold text-gray-800">Privacy</div>
                <div className="text-sm text-gray-500">Data & sync settings</div>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
