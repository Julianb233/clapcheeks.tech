/**
 * AI-9500 Wave 2 #M — Cohort Retro Analysis Dashboard
 *
 * Shows the funnel breakdown + LLM-generated insights from the most recent
 * cohort retro run. Triggered via CLI:
 *   npx convex run cohort_retro:runCohortRetro '{"user_id":"fleet-julian","period_start_ms":<12mo ago>,"period_end_ms":<now>}'
 */
"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import Link from "next/link"

const FLEET_USER_ID = "fleet-julian"

const FUNNEL_STAGES = [
  { key: "matched", label: "Matched", color: "bg-gray-700", textColor: "text-gray-300" },
  { key: "first_message", label: "First Message Sent", color: "bg-blue-900", textColor: "text-blue-300" },
  { key: "reply", label: "Reply Received", color: "bg-blue-700", textColor: "text-blue-200" },
  { key: "ongoing_chat", label: "Ongoing Chat (5+ ea.)", color: "bg-indigo-800", textColor: "text-indigo-200" },
  { key: "phone_swap", label: "Phone Swap", color: "bg-violet-800", textColor: "text-violet-200" },
  { key: "first_date_done", label: "First Date Done", color: "bg-purple-700", textColor: "text-purple-200" },
  { key: "second_date_done", label: "Second Date Done", color: "bg-fuchsia-800", textColor: "text-fuchsia-200" },
  { key: "ongoing", label: "Ongoing Dating", color: "bg-pink-700", textColor: "text-pink-200" },
  { key: "ended", label: "Ended", color: "bg-red-900", textColor: "text-red-400" },
  { key: "ghosted", label: "Ghosted", color: "bg-gray-900", textColor: "text-gray-500" },
] as const

function pct(n: number, total: number) {
  if (total === 0) return "—"
  return `${Math.round((n / total) * 100)}%`
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function CohortRetroPage() {
  const retros = useQuery(api.cohort_retro.listRecent, {
    user_id: FLEET_USER_ID,
    limit: 5,
  })

  const latest = retros?.[0]

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/admin/clapcheeks-ops" className="text-gray-500 hover:text-gray-300 text-sm">
          ← Ops overview
        </Link>
      </div>
      <h1 className="text-3xl font-bold mb-1">Cohort Retro Analysis</h1>
      <p className="text-gray-400 mb-6 text-sm">
        Funnel breakdown + surprising insights from the last 12 months of dating activity.
      </p>

      {/* CLI hint */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-8 font-mono text-xs text-gray-400">
        <div className="text-gray-500 mb-1">Run a fresh retro (12-month window):</div>
        <div className="text-green-400 break-all">
          npx convex run cohort_retro:runCohortRetro &#123;&quot;user_id&quot;:&quot;fleet-julian&quot;,&quot;period_start_ms&quot;:{Math.floor((Date.now() - 365 * 86400 * 1000))},&quot;period_end_ms&quot;:{Math.floor(Date.now())}&#125;
        </div>
      </div>

      {retros === undefined && (
        <div className="text-gray-500 text-sm animate-pulse">Loading...</div>
      )}

      {retros !== undefined && retros.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📊</div>
          <div className="text-gray-300 font-semibold mb-2">No retros run yet</div>
          <div className="text-gray-500 text-sm">
            Run the CLI command above to analyze your last 12 months of conversations.
          </div>
        </div>
      )}

      {latest && (
        <>
          {/* Period header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-sm text-gray-400">
                Period: <span className="text-white">{fmtDate(latest.period_start_ms)} → {fmtDate(latest.period_end_ms)}</span>
                {" "}<span className="text-gray-600">·</span>{" "}
                Computed: <span className="text-white">{fmtDate(latest.computed_at)}</span>
              </div>
            </div>
            <div className="text-sm text-gray-500">
              {latest.summary?.total_conversations ?? "?"} total conversations · {latest.summary?.period_days ?? "?"} days
            </div>
          </div>

          {/* Funnel */}
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Conversion Funnel</h2>
            {latest.funnel ? (
              <FunnelChart funnel={latest.funnel} />
            ) : (
              <div className="text-gray-500 text-sm">No funnel data.</div>
            )}
          </section>

          {/* Key rates */}
          {latest.summary && (
            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">Key Metrics</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                  label="Reply Rate"
                  value={`${Math.round((latest.summary.overall_reply_rate ?? 0) * 100)}%`}
                  sub="of first messages"
                />
                <MetricCard
                  label="Avg Msgs (advanced)"
                  value={`${latest.summary.avg_messages_advanced ?? "—"}`}
                  sub="before moving up funnel"
                />
                <MetricCard
                  label="Avg Msgs (ghosted)"
                  value={`${latest.summary.avg_messages_ghosted ?? "—"}`}
                  sub="before ghost/end"
                />
                <MetricCard
                  label="Total Conversations"
                  value={`${latest.summary.total_conversations ?? "—"}`}
                  sub={`across ${latest.summary.period_days ?? "?"} days`}
                />
              </div>
            </section>
          )}

          {/* Opener length breakdown */}
          {latest.summary?.opener_buckets && (
            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">Opener Length vs Reply Rate</h2>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(latest.summary.opener_buckets as Record<string, any>).map(([bucket, data]) => (
                  <div key={bucket} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">
                      {bucket === "short" ? "Short (<80 chars)" : bucket === "medium" ? "Medium (80-200)" : "Long (>200)"}
                    </div>
                    <div className="text-2xl font-bold">
                      {data.total > 0 ? `${Math.round((data.converted / data.total) * 100)}%` : "—"}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{data.converted}/{data.total} replied</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Day of week */}
          {latest.summary?.day_of_week && Object.keys(latest.summary.day_of_week).length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">Match Day vs Reply Rate</h2>
              <div className="grid grid-cols-7 gap-1">
                {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day) => {
                  const d = (latest.summary as any).day_of_week?.[day]
                  if (!d) return (
                    <div key={day} className="bg-gray-900 border border-gray-800 rounded p-2 text-center opacity-30">
                      <div className="text-xs text-gray-500">{day.slice(0,3)}</div>
                      <div className="text-sm font-bold">—</div>
                    </div>
                  )
                  const rate = d.rate ?? 0
                  const intensity = rate > 0.5 ? "border-green-700 bg-green-950" : rate > 0.3 ? "border-yellow-800 bg-yellow-950" : "border-gray-800 bg-gray-900"
                  return (
                    <div key={day} className={`border rounded p-2 text-center ${intensity}`}>
                      <div className="text-xs text-gray-400">{day.slice(0,3)}</div>
                      <div className="text-sm font-bold">{Math.round(rate * 100)}%</div>
                      <div className="text-xs text-gray-500">{d.total}</div>
                    </div>
                  )
                })}
              </div>
              <div className="text-xs text-gray-600 mt-2">Number shown = total matches that day. Color = reply rate.</div>
            </section>
          )}

          {/* Insights */}
          {latest.insights && latest.insights.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">AI Insights</h2>
              <div className="space-y-3">
                {(latest.insights as string[]).map((insight, i) => (
                  <div key={i} className="flex gap-3 bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <div className="text-yellow-400 text-lg flex-shrink-0">💡</div>
                    <div className="text-sm text-gray-200">{insight}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Historical retros */}
          {retros && retros.length > 1 && (
            <section>
              <h2 className="text-xl font-semibold mb-4">Previous Retros</h2>
              <div className="space-y-2">
                {retros.slice(1).map((r) => (
                  <div key={r._id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between">
                    <div className="text-sm">
                      <span className="text-white">{fmtDate(r.period_start_ms)}</span>
                      <span className="text-gray-600 mx-2">→</span>
                      <span className="text-white">{fmtDate(r.period_end_ms)}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {r.summary?.total_conversations ?? "?"} convos · computed {fmtDate(r.computed_at)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function FunnelChart({ funnel }: { funnel: any }) {
  const total = funnel.matched + funnel.first_message + funnel.reply +
    funnel.ongoing_chat + funnel.phone_swap + funnel.first_date_done +
    funnel.second_date_done + funnel.ongoing + funnel.ended + funnel.ghosted

  const maxBarVal = Math.max(
    funnel.matched, funnel.first_message, funnel.reply, funnel.ongoing_chat,
    funnel.phone_swap, funnel.first_date_done, funnel.second_date_done,
    funnel.ongoing, 1,
  )

  return (
    <div className="space-y-2">
      {FUNNEL_STAGES.map((stage) => {
        const count = (funnel as any)[stage.key] ?? 0
        const barPct = maxBarVal > 0 ? Math.max(2, (count / maxBarVal) * 100) : 0
        return (
          <div key={stage.key} className="flex items-center gap-3">
            <div className="w-40 text-xs text-gray-400 text-right flex-shrink-0">{stage.label}</div>
            <div className="flex-1 h-8 bg-gray-900 rounded overflow-hidden border border-gray-800">
              <div
                className={`h-full ${stage.color} rounded flex items-center px-2 transition-all`}
                style={{ width: `${barPct}%`, minWidth: count > 0 ? "2rem" : "0" }}
              >
                {count > 0 && (
                  <span className={`text-xs font-bold ${stage.textColor} whitespace-nowrap`}>{count}</span>
                )}
              </div>
            </div>
            <div className="w-14 text-xs text-gray-500 text-right flex-shrink-0">
              {pct(count, total)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-600 mt-1">{sub}</div>
    </div>
  )
}
