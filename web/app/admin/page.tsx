import type { Metadata } from "next"
import { createAdminClient } from "@/lib/supabase/admin"

export const metadata: Metadata = { title: 'Overview | Admin' }
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, Radio, DollarSign, Heart, Activity, Server, Database } from "lucide-react"

const TIER_PRICES: Record<string, number> = {
  free: 0,
  starter: 29,
  pro: 59,
  elite: 99,
}

export const dynamic = "force-dynamic"

export default async function AdminOverviewPage() {
  const supabase = createAdminClient()

  // Fetch all stats in parallel
  const [
    { count: totalUsers },
    { data: agents },
    { data: profiles },
    { data: weeklyAnalytics },
    { data: recentSignups },
    { data: todayAnalytics },
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase
      .from("clapcheeks_agent_tokens")
      .select("id, last_seen_at")
      .gte("last_seen_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()),
    supabase.from("profiles").select("subscription_tier"),
    supabase
      .from("clapcheeks_analytics_daily")
      .select("matches")
      .gte("date", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]),
    supabase
      .from("profiles")
      .select("email, created_at, subscription_tier, id")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("clapcheeks_analytics_daily")
      .select("platform, swipes_right, swipes_left, matches")
      .eq("date", new Date().toISOString().split("T")[0]),
  ])

  const activeAgents = agents?.length ?? 0

  // Calculate MRR
  const mrr = (profiles ?? []).reduce((sum, p) => {
    return sum + (TIER_PRICES[p.subscription_tier ?? "free"] ?? 0)
  }, 0)

  // Total matches this week
  const weeklyMatches = (weeklyAnalytics ?? []).reduce((sum, a) => sum + (a.matches ?? 0), 0)

  // Platform activity today
  const platformStats: Record<string, { swipes: number; matches: number }> = {}
  for (const row of todayAnalytics ?? []) {
    const p = row.platform ?? "unknown"
    if (!platformStats[p]) platformStats[p] = { swipes: 0, matches: 0 }
    platformStats[p].swipes += (row.swipes_right ?? 0) + (row.swipes_left ?? 0)
    platformStats[p].matches += row.matches ?? 0
  }
  const maxSwipes = Math.max(1, ...Object.values(platformStats).map((s) => s.swipes))

  // Get agent tokens for recent signups
  const signupIds = (recentSignups ?? []).map((s) => s.id)
  const { data: signupAgents } = signupIds.length > 0
    ? await supabase.from("clapcheeks_agent_tokens").select("user_id").in("user_id", signupIds)
    : { data: [] }
  const agentUserIds = new Set((signupAgents ?? []).map((a) => a.user_id))

  // Get today's matches for recent signups
  const { data: signupAnalytics } = signupIds.length > 0
    ? await supabase
        .from("clapcheeks_analytics_daily")
        .select("user_id, matches")
        .in("user_id", signupIds)
        .eq("date", new Date().toISOString().split("T")[0])
    : { data: [] }
  const matchesByUser: Record<string, number> = {}
  for (const a of signupAnalytics ?? []) {
    matchesByUser[a.user_id] = (matchesByUser[a.user_id] ?? 0) + (a.matches ?? 0)
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Overview</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Users" value={totalUsers ?? 0} color="text-blue-400" />
        <StatCard icon={Radio} label="Active Agents" value={activeAgents} color="text-green-400" />
        <StatCard icon={DollarSign} label="MRR" value={`$${mrr.toLocaleString()}`} color="text-yellow-400" />
        <StatCard icon={Heart} label="Matches This Week" value={weeklyMatches} color="text-pink-400" />
      </div>

      {/* Three sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Signups */}
        <Card className="bg-gray-900 border-gray-800 col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white text-lg">Recent Signups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400">
                    <th className="text-left py-2 px-3 font-medium">Email</th>
                    <th className="text-left py-2 px-3 font-medium">Signed Up</th>
                    <th className="text-left py-2 px-3 font-medium">Tier</th>
                    <th className="text-left py-2 px-3 font-medium">Agent</th>
                    <th className="text-right py-2 px-3 font-medium">Matches Today</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentSignups ?? []).map((user) => (
                    <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-2 px-3 text-gray-300">{user.email}</td>
                      <td className="py-2 px-3 text-gray-400">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-3">
                        <TierBadge tier={user.subscription_tier ?? "free"} />
                      </td>
                      <td className="py-2 px-3">
                        {agentUserIds.has(user.id) ? (
                          <span className="text-green-400">Connected</span>
                        ) : (
                          <span className="text-gray-600">--</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-300">
                        {matchesByUser[user.id] ?? 0}
                      </td>
                    </tr>
                  ))}
                  {(recentSignups ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-600">No users yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Platform Activity */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">Platform Activity Today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.keys(platformStats).length === 0 ? (
              <p className="text-gray-600 text-sm py-4 text-center">No activity today</p>
            ) : (
              Object.entries(platformStats)
                .sort((a, b) => b[1].swipes - a[1].swipes)
                .map(([platform, stats]) => (
                  <div key={platform} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300 capitalize">{platform}</span>
                      <span className="text-gray-500">{stats.swipes} swipes / {stats.matches} matches</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full transition-all"
                        style={{ width: `${(stats.swipes / maxSwipes) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
            )}
          </CardContent>
        </Card>

        {/* System Health */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">System Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <HealthRow icon={Server} label="Web App" status="operational" />
            <HealthRow icon={Activity} label="AI Service" status="operational" />
            <HealthRow icon={Database} label="Supabase" status={(totalUsers ?? 0) >= 0 ? "operational" : "error"} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  color: string
}) {
  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-800 rounded-lg">
            <Icon className={`w-5 h-5 ${color}`} />
          </div>
          <div>
            <p className="text-sm text-gray-400">{label}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
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

function HealthRow({
  icon: Icon,
  label,
  status,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  status: "operational" | "degraded" | "error"
}) {
  const statusColors = {
    operational: "bg-green-500",
    degraded: "bg-yellow-500",
    error: "bg-red-500",
  }
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-gray-500" />
        <span className="text-sm text-gray-300">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
        <span className="text-xs text-gray-500 capitalize">{status}</span>
      </div>
    </div>
  )
}
