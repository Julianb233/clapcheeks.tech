import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ArrowLeft, Calendar, MapPin, Clock } from "lucide-react"
import Link from "next/link"

export const metadata: Metadata = {
  title: 'Events | Clapcheeks',
  description: 'Track your dates and events.',
}

export default async function DatesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Fetch upcoming dates synced from the local agent
  const { data: dates } = await supabase
    .from("clapcheeks_dates")
    .select("*")
    .eq("user_id", user.id)
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })

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
            <h1 className="text-2xl font-bold text-white">Upcoming Dates</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        {!dates || dates.length === 0 ? (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-12 text-center">
            <Calendar className="w-12 h-12 text-white/20 mx-auto mb-4" />
            <p className="text-lg text-white/60">No upcoming dates</p>
            <p className="text-sm text-white/30 mt-2">
              Dates will appear here once the agent books them from your conversations.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {dates.map((date: { id: string; match_name?: string; status?: string; location?: string; scheduled_at?: string }) => (
              <div key={date.id} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 hover:bg-white/[0.05] transition-colors">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-white">{date.match_name || "Date"}</h3>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 flex-shrink-0">
                        {date.status || "Confirmed"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm text-white/40">
                      {date.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {date.location}
                        </span>
                      )}
                      {date.scheduled_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(date.scheduled_at).toLocaleDateString()} at{" "}
                          {new Date(date.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
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
