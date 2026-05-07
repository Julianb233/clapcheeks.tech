import type { Metadata } from "next"
import { createAdminClient } from "@/lib/supabase/admin"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, TrendingUp, Gift, AlertTriangle, Target, UserMinus } from "lucide-react"
import { getConvexServerClient } from "@/lib/convex/server"
import { api } from "@/convex/_generated/api"

// AI-9537: clapcheeks_referrals migrated to Convex referrals.

export const metadata: Metadata = { title: 'Soft Launch | Admin' }
export const dynamic = "force-dynamic"

const SOFT_LAUNCH_CAP = 50
const LAUNCH_DATE = '2026-04-20'

export default async function SoftLaunchPage() {
  const supabase = createAdminClient()
  const convex = getConvexServerClient()
  const [
    { count: totalUsers },
    { data: paidProfiles },
    { data: recentChurn },
    { data: referralSignups },
    allReferralsRaw,
    { data: weeklySignups },
    { data: dailyActive },
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("id, subscription_tier, created_at").neq("subscription_tier", "free"),
    supabase.from("profiles").select("id, email, subscription_tier, updated_at").eq("subscription_tier", "free").not("stripe_customer_id", "is", null),
    supabase.from("profiles").select("id, created_at").not("referred_by", "is", null),
    convex.query(api.referrals.summary, {}),
    supabase.from("profiles").select("id, created_at").gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    supabase.from("clapcheeks_analytics_daily").select("user_id, date").gte("date", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]),
  ])
  const allReferrals = (allReferralsRaw ?? []) as Array<{ id: string; status: string; created_at: number }>
  const paidCount = paidProfiles?.length ?? 0
  const total = totalUsers ?? 0
  const capacityPct = Math.round((paidCount / SOFT_LAUNCH_CAP) * 100)
  const churnedCount = recentChurn?.length ?? 0
  const churnRate = paidCount > 0 ? Math.round((churnedCount / (paidCount + churnedCount)) * 100) : 0
  const referralCount = referralSignups?.length ?? 0
  const referralPct = total > 0 ? Math.round((referralCount / total) * 100) : 0
  const weeklyCount = weeklySignups?.length ?? 0
  const dauCount = new Set((dailyActive ?? []).map(r => r.user_id)).size
  const daysSinceLaunch = Math.max(0, Math.floor((Date.now() - new Date(LAUNCH_DATE).getTime()) / (1000 * 60 * 60 * 24)))
  const projectedDaysTo50 = weeklyCount > 0 ? Math.ceil(((SOFT_LAUNCH_CAP - paidCount) / (weeklyCount / 7))) : null
  const convertedReferrals = (allReferrals ?? []).filter(r => r.status === 'converted' || r.status === 'rewarded').length
  const totalReferrals = allReferrals?.length ?? 0
  const referralConvRate = totalReferrals > 0 ? Math.round((convertedReferrals / totalReferrals) * 100) : 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Soft Launch Monitor</h1>
          <p className="text-gray-400 text-sm mt-1">Target: {SOFT_LAUNCH_CAP} paying users in 30 days</p>
        </div>
        <Badge variant="outline" className="text-green-400 border-green-700 bg-green-900/30">Day {daysSinceLaunch} of 30</Badge>
      </div>
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Target className="w-5 h-5 text-purple-400" /><span className="text-white font-medium">Subscriber Capacity</span></div>
            <span className="text-2xl font-bold text-white">{paidCount} / {SOFT_LAUNCH_CAP}</span>
          </div>
          <div className="h-4 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${capacityPct >= 90 ? 'bg-green-500' : capacityPct >= 50 ? 'bg-blue-500' : 'bg-purple-500'}`} style={{ width: `${Math.min(100, capacityPct)}%` }} />
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>{capacityPct}% filled</span>
            {projectedDaysTo50 !== null && <span>Est. {projectedDaysTo50} days to cap</span>}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Users} label="Total Signups" value={total} sublabel={`${weeklyCount} this week`} color="text-blue-400" />
        <MetricCard icon={UserMinus} label="Churn Rate" value={`${churnRate}%`} sublabel={churnRate > 15 ? 'Above 15% target' : 'Below 15% target'} color={churnRate > 15 ? "text-red-400" : "text-green-400"} />
        <MetricCard icon={Gift} label="Referral Signups" value={`${referralPct}%`} sublabel={`${referralCount} via referral`} color={referralPct >= 10 ? "text-green-400" : "text-yellow-400"} />
        <MetricCard icon={TrendingUp} label="DAU" value={dauCount} sublabel={`${total > 0 ? Math.round((dauCount / total) * 100) : 0}% of users`} color="text-purple-400" />
      </div>
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader><CardTitle className="text-white text-lg">Success Criteria</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <CriteriaRow label="50 paying subscribers in 30 days" met={paidCount >= 50} current={`${paidCount}/50`} />
          <CriteriaRow label="Churn rate below 15%" met={churnRate <= 15} current={`${churnRate}%`} />
          <CriteriaRow label="Referrals >10% of signups" met={referralPct >= 10} current={`${referralPct}%`} />
          <CriteriaRow label="Referral conversion >20%" met={referralConvRate >= 20} current={`${referralConvRate}%`} />
        </CardContent>
      </Card>
      {(churnRate > 15 || (daysSinceLaunch > 15 && paidCount < 25)) && (
        <Card className="bg-red-950/50 border-red-800/50">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-red-300 font-medium mb-1">Attention Required</h3>
                <ul className="text-red-400/80 text-sm space-y-1">
                  {churnRate > 15 && <li>Churn ({churnRate}%) exceeds 15% target.</li>}
                  {daysSinceLaunch > 15 && paidCount < 25 && <li>Under 50% target halfway through launch.</li>}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, sublabel, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sublabel: string; color: string }) {
  return (
    <Card className="bg-gray-900 border-gray-800"><CardContent className="p-5">
      <div className="flex items-center gap-3 mb-2"><div className="p-2 bg-gray-800 rounded-lg"><Icon className={`w-5 h-5 ${color}`} /></div><p className="text-sm text-gray-400">{label}</p></div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sublabel}</p>
    </CardContent></Card>
  )
}

function CriteriaRow({ label, met, current }: { label: string; met: boolean; current: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div className="flex items-center gap-3"><div className={`w-3 h-3 rounded-full ${met ? 'bg-green-500' : 'bg-gray-600'}`} /><span className="text-sm text-gray-300">{label}</span></div>
      <Badge variant="outline" className={`${met ? 'text-green-400 border-green-700' : 'text-gray-400 border-gray-700'} text-xs`}>{current}</Badge>
    </div>
  )
}
