import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, MessageSquare, Heart } from "lucide-react"
import Link from "next/link"

export default async function ConversationsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Fetch active conversations synced from the local agent
  const { data: conversations } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false })

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-purple-100 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/home">
                <ArrowLeft className="w-5 h-5" />
                <span className="sr-only">Back</span>
              </Link>
            </Button>
            <h1 className="text-2xl font-bold text-gray-800">Conversations</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        {!conversations || conversations.length === 0 ? (
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardContent className="py-12 text-center">
              <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-lg text-gray-600">No conversations synced yet</p>
              <p className="text-sm text-gray-500 mt-2">
                Make sure your Clapcheeks agent is running on your Mac. Conversations will appear here once synced.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {conversations.map((convo) => (
              <Card key={convo.id} className="border-0 bg-white/80 backdrop-blur shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-gradient-to-r from-pink-400 to-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <Heart className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <h3 className="font-semibold text-gray-800 truncate">{convo.match_name || "Unknown"}</h3>
                        <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 flex-shrink-0 text-xs">
                          {convo.platform || "iMessage"}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500 truncate">{convo.last_message || "No messages yet"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
