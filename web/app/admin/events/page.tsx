import { createAdminClient } from "@/lib/supabase/admin"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Radio } from "lucide-react"

export const dynamic = "force-dynamic"

const EVENT_TYPES = [
  "all",
  "match_received",
  "date_booked",
  "ban_detected",
  "session_complete",
] as const

const EVENT_COLORS: Record<string, string> = {
  match_received: "bg-pink-900/50 text-pink-300",
  date_booked: "bg-green-900/50 text-green-300",
  ban_detected: "bg-red-900/50 text-red-300",
  session_complete: "bg-blue-900/50 text-blue-300",
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!local || !domain) return email
  const visible = local.slice(0, 2)
  return `${visible}***@${domain}`
}

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const params = await searchParams
  const filterType = params.type ?? "all"

  const supabase = createAdminClient()

  // Query events
  let query = supabase
    .from("clapcheeks_agent_events")
    .select("id, created_at, event_type, platform, data, user_id")
    .order("created_at", { ascending: false })
    .limit(100)

  if (filterType !== "all") {
    query = query.eq("event_type", filterType)
  }

  const { data: events } = await query

  // Get user emails for display
  const userIds = [...new Set((events ?? []).map((e) => e.user_id).filter(Boolean))]
  const { data: userProfiles } = userIds.length > 0
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [] }

  const emailByUser: Record<string, string> = {}
  for (const p of userProfiles ?? []) {
    emailByUser[p.id] = p.email
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Radio className="w-6 h-6" />
          Agent Events
        </h1>
        <span className="text-sm text-gray-500">{events?.length ?? 0} events</span>
      </div>

      {/* Filter */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-4">
          <form className="flex items-center gap-4">
            <label className="text-sm text-gray-400">Event Type:</label>
            <select
              name="type"
              defaultValue={filterType}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "all" ? "All types" : t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
            >
              Filter
            </button>
          </form>
        </CardContent>
      </Card>

      {/* Events Feed */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-0">
          <div className="divide-y divide-gray-800">
            {(events ?? []).length === 0 ? (
              <div className="py-12 text-center text-gray-600">No events found</div>
            ) : (
              (events ?? []).map((event) => {
                const email = emailByUser[event.user_id] ?? "unknown"
                const dataPreview = event.data
                  ? typeof event.data === "string"
                    ? event.data.slice(0, 120)
                    : JSON.stringify(event.data).slice(0, 120)
                  : "--"

                return (
                  <div key={event.id} className="px-4 py-3 hover:bg-gray-800/30 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`${EVENT_COLORS[event.event_type] ?? "bg-gray-800 text-gray-400"} border-0 text-xs`}
                          >
                            {event.event_type?.replace(/_/g, " ") ?? "unknown"}
                          </Badge>
                          {event.platform && (
                            <span className="text-xs text-gray-500 capitalize">
                              {event.platform}
                            </span>
                          )}
                          <span className="text-xs text-gray-600">
                            {maskEmail(email)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{dataPreview}</p>
                      </div>
                      <time className="text-xs text-gray-600 flex-shrink-0">
                        {new Date(event.created_at).toLocaleString()}
                      </time>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
