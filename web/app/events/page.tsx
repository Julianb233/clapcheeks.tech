import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Calendar, MapPin, Clock } from "lucide-react"
import Link from "next/link"

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
            <h1 className="text-2xl font-bold text-gray-800">Upcoming Dates</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        {!dates || dates.length === 0 ? (
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardContent className="py-12 text-center">
              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-lg text-gray-600">No upcoming dates</p>
              <p className="text-sm text-gray-500 mt-2">
                Dates will appear here once the agent books them from your conversations.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {dates.map((date) => (
              <Card key={date.id} className="border-0 bg-white/80 backdrop-blur shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-gradient-to-r from-pink-400 to-purple-500 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-gray-800">{date.match_name || "Date"}</h3>
                        <Badge variant="outline" className="bg-pink-50 text-pink-700 border-pink-200 flex-shrink-0 text-xs">
                          {date.status || "Confirmed"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm text-gray-500">
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
