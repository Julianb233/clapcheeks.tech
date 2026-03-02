import { createAdminClient } from "@/lib/supabase/admin"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users } from "lucide-react"

export const dynamic = "force-dynamic"

const TIER_OPTIONS = ["all", "free", "starter", "pro", "elite"] as const

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; q?: string }>
}) {
  const params = await searchParams
  const filterTier = params.tier ?? "all"
  const searchQuery = params.q ?? ""

  const supabase = createAdminClient()

  // Build query
  let query = supabase
    .from("profiles")
    .select("id, email, full_name, subscription_tier, created_at, updated_at")
    .order("created_at", { ascending: false })

  if (filterTier !== "all") {
    query = query.eq("subscription_tier", filterTier)
  }

  if (searchQuery) {
    query = query.ilike("email", `%${searchQuery}%`)
  }

  const { data: users } = await query.limit(100)

  // Get agent connections and today's analytics
  const userIds = (users ?? []).map((u) => u.id)

  const [{ data: agentTokens }, { data: analytics }] = await Promise.all([
    userIds.length > 0
      ? supabase.from("clapcheeks_agent_tokens").select("user_id, last_seen_at").in("user_id", userIds)
      : Promise.resolve({ data: [] }),
    userIds.length > 0
      ? supabase
          .from("clapcheeks_analytics_daily")
          .select("user_id, swipes_right, swipes_left, matches")
          .in("user_id", userIds)
          .eq("date", new Date().toISOString().split("T")[0])
      : Promise.resolve({ data: [] }),
  ])

  const agentByUser: Record<string, string | null> = {}
  for (const t of agentTokens ?? []) {
    agentByUser[t.user_id] = t.last_seen_at
  }

  const statsByUser: Record<string, { swipes: number; matches: number }> = {}
  for (const a of analytics ?? []) {
    if (!statsByUser[a.user_id]) statsByUser[a.user_id] = { swipes: 0, matches: 0 }
    statsByUser[a.user_id].swipes += (a.swipes_right ?? 0) + (a.swipes_left ?? 0)
    statsByUser[a.user_id].matches += a.matches ?? 0
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Users className="w-6 h-6" />
          Users
        </h1>
        <span className="text-sm text-gray-500">{users?.length ?? 0} users</span>
      </div>

      {/* Filters */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-4">
          <form className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Search:</label>
              <input
                type="text"
                name="q"
                defaultValue={searchQuery}
                placeholder="Search by email..."
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Tier:</label>
              <select
                name="tier"
                defaultValue={filterTier}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                {TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t === "all" ? "All tiers" : t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
            >
              Filter
            </button>
          </form>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left py-3 px-4 font-medium">Email</th>
                  <th className="text-left py-3 px-4 font-medium">Tier</th>
                  <th className="text-left py-3 px-4 font-medium">Signed Up</th>
                  <th className="text-left py-3 px-4 font-medium">Agent</th>
                  <th className="text-right py-3 px-4 font-medium">Swipes Today</th>
                  <th className="text-right py-3 px-4 font-medium">Matches Today</th>
                  <th className="text-left py-3 px-4 font-medium">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((user) => {
                  const agentSeen = agentByUser[user.id]
                  const stats = statsByUser[user.id]
                  return (
                    <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-3 px-4">
                        <div>
                          <span className="text-gray-200">{user.email}</span>
                          {user.full_name && (
                            <p className="text-xs text-gray-500">{user.full_name}</p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <TierBadge tier={user.subscription_tier ?? "free"} />
                      </td>
                      <td className="py-3 px-4 text-gray-400">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        {agentSeen ? (
                          <span className="text-green-400 text-xs">Connected</span>
                        ) : (
                          <span className="text-gray-600 text-xs">--</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-300">
                        {stats?.swipes ?? 0}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-300">
                        {stats?.matches ?? 0}
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-xs">
                        {user.updated_at
                          ? new Date(user.updated_at).toLocaleDateString()
                          : "--"}
                      </td>
                    </tr>
                  )
                })}
                {(users ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-600">
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    free: "bg-gray-800 text-gray-400",
    starter: "bg-blue-900/50 text-blue-300",
    pro: "bg-purple-900/50 text-purple-300",
    elite: "bg-yellow-900/50 text-yellow-300",
  }
  return (
    <Badge variant="outline" className={`${colors[tier] ?? colors.free} border-0 text-xs`}>
      {tier}
    </Badge>
  )
}
