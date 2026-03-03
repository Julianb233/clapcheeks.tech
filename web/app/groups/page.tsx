import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ArrowLeft, MessageSquare, Heart } from "lucide-react"
import Link from "next/link"

export const metadata: Metadata = { title: 'Groups | Clapcheeks' }

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
    .from("clapcheeks_conversations")
    .select("*")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false })

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="bg-black/90 backdrop-blur border-b border-white/8 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/home"
              className="text-white/40 hover:text-white/70 p-1.5 rounded-lg hover:bg-white/5 transition-all"
              aria-label="Back to home"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold text-white">Conversations</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        {!conversations || conversations.length === 0 ? (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-12 text-center">
            <MessageSquare className="w-12 h-12 text-white/20 mx-auto mb-4" />
            <p className="text-lg text-white/60">No conversations synced yet</p>
            <p className="text-sm text-white/30 mt-2">
              Make sure your Clapcheeks agent is running on your Mac. Conversations will appear here once synced.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((convo: { id: string; match_name?: string; platform?: string; last_message?: string }) => (
              <div key={convo.id} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 hover:bg-white/[0.05] transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <Heart className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <h3 className="font-semibold text-white truncate">{convo.match_name || "Unknown"}</h3>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 flex-shrink-0">
                        {convo.platform || "iMessage"}
                      </span>
                    </div>
                    <p className="text-sm text-white/40 truncate">{convo.last_message || "No messages yet"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
