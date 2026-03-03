import type { Metadata } from "next"
import { createAdminClient } from "@/lib/supabase/admin"

export const metadata: Metadata = { title: 'Revenue | Admin' }
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DollarSign, TrendingUp, TrendingDown, UserMinus } from "lucide-react"

export const dynamic = "force-dynamic"

const TIER_PRICES: Record<string, number> = {
  free: 0,
  starter: 29,
  pro: 59,
  elite: 99,
}

const TIER_ORDER = ["free", "starter", "pro", "elite"] as const

export default async function AdminRevenuePage() {
  const supabase = createAdminClient()

  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // Get all profiles for tier breakdown
  const { data: profiles } = await supabase
    .from("profiles")
    .select("subscription_tier, created_at, updated_at")

  // Count by tier
  const tierCounts: Record<string, number> = { free: 0, starter: 0, pro: 0, elite: 0 }
  for (const p of profiles ?? []) {
    const tier = p.subscription_tier ?? "free"
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
  }

  // MRR
  const mrr = Object.entries(tierCounts).reduce(
    (sum, [tier, count]) => sum + (TIER_PRICES[tier] ?? 0) * count,
    0
  )

  // New subscribers this week vs last week (non-free signups)
  const thisWeekSubs = (profiles ?? []).filter(
    (p) =>
      (p.subscription_tier ?? "free") !== "free" &&
      new Date(p.created_at) >= weekAgo
  ).length

  const lastWeekSubs = (profiles ?? []).filter(
    (p) =>
      (p.subscription_tier ?? "free") !== "free" &&
      new Date(p.created_at) >= twoWeeksAgo &&
      new Date(p.created_at) < weekAgo
  ).length

  // Churn estimate: users updated this month who are now free but were previously paid
  // (simple heuristic: updated_at this month, tier = free, created_at before this month)
  const churnedThisMonth = (profiles ?? []).filter(
    (p) =>
      (p.subscription_tier ?? "free") === "free" &&
      p.updated_at &&
      new Date(p.updated_at) >= monthStart &&
      new Date(p.created_at) < monthStart
  ).length

  // Referral conversions this month
  const { count: referralConversions } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .not("referred_by", "is", null)
    .gte("created_at", monthStart.toISOString())

  const maxTierCount = Math.max(1, ...Object.values(tierCounts))

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <DollarSign className="w-6 h-6" />
        Revenue
      </h1>

      {/* Top stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Monthly Recurring Revenue"
          value={`$${mrr.toLocaleString()}`}
          icon={DollarSign}
          color="text-green-400"
        />
        <StatCard
          label="New Subscribers (7d)"
          value={thisWeekSubs}
          subtitle={`vs ${lastWeekSubs} last week`}
          icon={TrendingUp}
          color="text-blue-400"
        />
        <StatCard
          label="Churn (This Month)"
          value={churnedThisMonth}
          icon={UserMinus}
          color="text-red-400"
        />
        <StatCard
          label="Referral Conversions (Mo)"
          value={referralConversions ?? 0}
          icon={TrendingDown}
          color="text-purple-400"
        />
      </div>

      {/* MRR Breakdown by Tier */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">MRR Breakdown by Tier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {TIER_ORDER.map((tier) => {
            const count = tierCounts[tier] ?? 0
            const revenue = count * (TIER_PRICES[tier] ?? 0)
            return (
              <div key={tier} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-300 capitalize font-medium w-16">{tier}</span>
                    <span className="text-gray-500">{count} users</span>
                  </div>
                  <span className="text-gray-300 font-medium">
                    ${revenue.toLocaleString()}/mo
                  </span>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${tierBarColor(tier)}`}
                    style={{ width: `${(count / maxTierCount) * 100}%` }}
                  />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Subscriber growth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">New vs Last Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-8 justify-center py-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-400">{lastWeekSubs}</div>
                <div className="text-xs text-gray-500 mt-1">Last Week</div>
              </div>
              <div className="text-2xl text-gray-600">vs</div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-400">{thisWeekSubs}</div>
                <div className="text-xs text-gray-500 mt-1">This Week</div>
              </div>
            </div>
            {thisWeekSubs > lastWeekSubs && (
              <p className="text-center text-sm text-green-400">
                +{thisWeekSubs - lastWeekSubs} growth
              </p>
            )}
            {thisWeekSubs < lastWeekSubs && (
              <p className="text-center text-sm text-red-400">
                {thisWeekSubs - lastWeekSubs} decline
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">Key Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MetricRow
              label="Paid Users"
              value={Object.entries(tierCounts)
                .filter(([t]) => t !== "free")
                .reduce((s, [, c]) => s + c, 0)}
            />
            <MetricRow label="Free Users" value={tierCounts.free ?? 0} />
            <MetricRow
              label="Conversion Rate"
              value={`${(
                ((Object.entries(tierCounts)
                  .filter(([t]) => t !== "free")
                  .reduce((s, [, c]) => s + c, 0) /
                  Math.max(1, (profiles ?? []).length)) *
                  100)
              ).toFixed(1)}%`}
            />
            <MetricRow label="ARPU" value={`$${((mrr / Math.max(1, (profiles ?? []).length))).toFixed(2)}`} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function tierBarColor(tier: string): string {
  const colors: Record<string, string> = {
    free: "bg-gray-600",
    starter: "bg-blue-500",
    pro: "bg-purple-500",
    elite: "bg-yellow-500",
  }
  return colors[tier] ?? "bg-gray-600"
}

function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  label: string
  value: string | number
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
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
            <p className="text-xs text-gray-400">{label}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-200">{value}</span>
    </div>
  )
}
