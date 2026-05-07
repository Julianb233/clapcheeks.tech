/**
 * AI-9500 #7 — Self-coaching dashboard.
 *
 * Shows Julian his own patterns across 60+ active threads:
 *   - Dashboard summary (KPIs)
 *   - Over-pursue list (who he's out-investing)
 *   - Late-night conversion (sends after 11pm vs daytime)
 *   - Same-opener overuse (repetitive first messages)
 *   - Cut-list candidates (high effort, low return)
 *   - Stuck-in-stage warnings (>14d in matched/early_chat)
 *   - Time-of-day heatmap (7×24 grid)
 *
 * Each card has 1 actionable sentence.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import Link from "next/link"
import { useState } from "react"

const FLEET_USER_ID = "fleet-julian"

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function formatHour(h: number): string {
  if (h === 0) return "12am"
  if (h < 12) return `${h}am`
  if (h === 12) return "12pm"
  return `${h - 12}pm`
}

function daysAgo(ms: number | undefined): string {
  if (!ms) return "never"
  const d = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000))
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  return `${d}d ago`
}

// ---------------------------------------------------------------------------
// Roster KPI card
// ---------------------------------------------------------------------------
function RosterCard({ kpis }: { kpis: any }) {
  if (!kpis)
    return (
      <CardShell title="Roster KPIs" loading />
    )

  const capacityColor =
    kpis.capacity >= 2
      ? "text-green-400"
      : kpis.capacity < 0
        ? "text-red-400"
        : "text-amber-400"

  const actionLine =
    kpis.capacity >= 2
      ? `You have capacity for ${kpis.capacity} more active threads.`
      : kpis.capacity === 0
        ? "Roster is full — consider cooling someone."
        : `You're over capacity by ${Math.abs(kpis.capacity)}. Time to pause or end.`

  return (
    <CardShell title="Roster KPIs" action={actionLine}>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800 rounded p-4">
          <div className="text-sm text-gray-400">Target</div>
          <div className="text-3xl font-bold">{kpis.target}</div>
        </div>
        <div className="bg-gray-800 rounded p-4">
          <div className="text-sm text-gray-400">Active</div>
          <div className="text-3xl font-bold">{kpis.active}</div>
        </div>
        <div className={`bg-gray-800 rounded p-4 ${capacityColor}`}>
          <div className="text-sm text-gray-400">Capacity</div>
          <div className="text-3xl font-bold">{kpis.capacity}</div>
        </div>
      </div>

      {kpis.top_5_warmest && kpis.top_5_warmest.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">
            Top 5 to move forward
          </h4>
          <div className="space-y-2">
            {kpis.top_5_warmest.map((p: any) => (
              <Link
                key={p.person_id}
                href={`/admin/clapcheeks-ops/people/${p.person_id}`}
                className="flex items-center justify-between bg-gray-800 hover:bg-gray-750 rounded px-3 py-2 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="text-blue-400 hover:underline">{p.display_name}</div>
                  <div className="text-xs text-gray-500">
                    hotness {p.hotness_rating}
                  </div>
                </div>
                <div className="text-xs font-mono text-green-400">
                  warmth {p.warmth_score}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {kpis.cooling_threats && kpis.cooling_threats.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-red-300 mb-3">
            Cooling threats ({kpis.cooling_threats.length})
          </h4>
          <div className="space-y-2">
            {kpis.cooling_threats.map((p: any) => (
              <Link
                key={p.person_id}
                href={`/admin/clapcheeks-ops/people/${p.person_id}`}
                className="flex items-center justify-between bg-red-950 hover:bg-red-900 rounded px-3 py-2 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="text-red-300 hover:underline">{p.display_name}</div>
                  <div className="text-xs text-red-400">
                    hotness {p.hotness_rating}
                  </div>
                </div>
                <div className="text-xs font-mono text-red-400">
                  silent {p.days_since_last_inbound}d
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Top summary KPI bar
// ---------------------------------------------------------------------------
function SummaryCard({ summary, callStats }: { summary: any; callStats: any }) {
  if (!summary) return <div className="text-sm text-gray-500">Loading summary…</div>

  const callsTotal = callStats?.total_30d ?? "—"

  // AI-9526 — show dating-active separately from total active so the operator
  // can see at-a-glance that ~half the active threads are professional/platonic.
  const datingActive = summary.active_dating_threads
  const datingLabel =
    typeof datingActive === "number" && datingActive !== summary.active_threads
      ? `${datingActive} (of ${summary.active_threads} total)`
      : summary.active_threads
  const kpis = [
    { label: "Dating threads", value: datingLabel },
    { label: "Dates this week", value: summary.dates_this_week },
    {
      label: "Ghost rate (30d)",
      value: `${Math.round(summary.ghost_rate_this_month * 100)}%`,
      warn: summary.ghost_rate_this_month > 0.25,
    },
    {
      label: "Avg reply rate",
      value: `${Math.round(summary.avg_reply_rate * 100)}%`,
      warn: summary.avg_reply_rate < 0.3,
    },
    { label: "Kissed (notes)", value: summary.kissed_this_month },
    { label: "Closed (notes)", value: summary.slept_with_this_month },
    // AI-9500 W2 E13 — call stat
    { label: "📞 Calls (30d)", value: callsTotal },
  ]

  return (
    <div className="grid grid-cols-3 md:grid-cols-7 gap-3 mb-8">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className={`bg-gray-900 border rounded-lg p-4 text-center ${
            (kpi as any).warn ? "border-amber-700" : "border-gray-800"
          }`}
        >
          <div className="text-2xl font-bold">{kpi.value ?? "—"}</div>
          <div className="text-xs text-gray-400 mt-1">{kpi.label}</div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CallsCard — 30-day call breakdown for /coach
// AI-9500 W2 E13
// ---------------------------------------------------------------------------
function CallsCard({ data }: { data: any }) {
  if (!data) return <CardShell title="Calls (30d)" loading />

  const { total_30d, by_direction, avg_duration_seconds } = data

  if (total_30d === 0) {
    return (
      <CardShell title="📞 Calls (30d)" action="No calls logged this month — consider voice-based check-ins.">
        <p className="text-sm text-gray-500">Connect a call source or log manually.</p>
      </CardShell>
    )
  }

  const durationLabel = avg_duration_seconds
    ? (() => {
        const m = Math.floor(avg_duration_seconds / 60)
        const s = avg_duration_seconds % 60
        return m > 0 ? `${m}m${s > 0 ? `${s}s` : ""}` : `${s}s`
      })()
    : null

  const action = `${total_30d} calls in 30d — ${by_direction.missed} missed${durationLabel ? `, avg ${durationLabel}` : ""}.`

  return (
    <CardShell title="📞 Calls (30d)" action={action}>
      <div className="grid grid-cols-3 gap-3 text-center text-sm">
        <div>
          <div className="text-xl font-bold text-blue-400">{by_direction.outbound}</div>
          <div className="text-xs text-gray-500">outbound</div>
        </div>
        <div>
          <div className="text-xl font-bold text-green-400">{by_direction.inbound}</div>
          <div className="text-xs text-gray-500">inbound</div>
        </div>
        <div>
          <div className={`text-xl font-bold ${by_direction.missed > 0 ? "text-red-400" : "text-gray-500"}`}>
            {by_direction.missed}
          </div>
          <div className="text-xs text-gray-500">missed</div>
        </div>
      </div>
      {durationLabel && (
        <div className="mt-3 text-xs text-gray-400 text-center">
          avg duration: {durationLabel}
        </div>
      )}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Over-pursue card
// ---------------------------------------------------------------------------
function OverPursueCard({ data }: { data: any[] | undefined }) {
  if (!data) return <CardShell title="Over-pursue list" loading />
  if (data.length === 0)
    return (
      <CardShell title="Over-pursue list" action="No over-pursuing detected this month — nice.">
        <p className="text-sm text-gray-500">All active threads are balanced.</p>
      </CardShell>
    )

  const top = data[0]
  return (
    <CardShell
      title="Over-pursue list"
      action={`Pull back on ${top.display_name} — you're sending ${top.ratio}x her word volume.`}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-800">
            <th className="pb-2">Name</th>
            <th className="pb-2 text-right">Your words</th>
            <th className="pb-2 text-right">Her words</th>
            <th className="pb-2 text-right">Ratio</th>
            <th className="pb-2 text-right">Her last msg</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {data.map((p: any) => (
            <tr key={p.person_id}>
              <td className="py-2">
                <Link
                  href={`/admin/clapcheeks-ops/people/${p.person_id}`}
                  className="text-blue-400 hover:underline"
                >
                  {p.display_name}
                </Link>
              </td>
              <td className="py-2 text-right">{p.outbound_words}</td>
              <td className="py-2 text-right">{p.inbound_words}</td>
              <td className={`py-2 text-right font-bold ${p.ratio > 5 ? "text-red-400" : "text-amber-400"}`}>
                {p.ratio}×
              </td>
              <td className="py-2 text-right text-gray-500">{daysAgo(p.last_inbound_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Late-night conversion card
// ---------------------------------------------------------------------------
function LateNightCard({ data }: { data: any[] | undefined }) {
  if (!data) return <CardShell title="Late-night conversion" loading />

  // Find late-night (11pm–2am) vs prime-time (6pm–10pm) conversion
  const lateNight = data.filter((d: any) => d.hour >= 23 || d.hour <= 2)
  const primeTime = data.filter((d: any) => d.hour >= 18 && d.hour <= 22)

  const avgLate =
    lateNight.length === 0
      ? 0
      : lateNight.reduce((acc: number, d: any) => acc + d.conversion_rate, 0) /
        lateNight.length
  const avgPrime =
    primeTime.length === 0
      ? 0
      : primeTime.reduce((acc: number, d: any) => acc + d.conversion_rate, 0) /
        primeTime.length

  const diff = avgLate - avgPrime
  const action =
    lateNight.reduce((acc: number, d: any) => acc + d.sends, 0) === 0
      ? "No late-night sends this month."
      : diff < -0.1
      ? `Your late-night sends convert ${Math.round(Math.abs(diff) * 100)}% worse than evening — stop sending after 11pm.`
      : diff > 0.05
      ? `Late-night sends actually convert ${Math.round(diff * 100)}% better — unusual, keep it.`
      : "Late-night conversion is similar to evening — timing isn't your issue."

  // Show top 6 by sends
  const sorted = [...data].sort((a: any, b: any) => b.sends - a.sends).slice(0, 12)
  const maxSends = Math.max(...sorted.map((d: any) => d.sends), 1)

  return (
    <CardShell title="Late-night conversion" action={action}>
      <div className="mt-3 space-y-1">
        {sorted.map((d: any) => (
          <div key={d.hour} className="flex items-center gap-2 text-sm">
            <span className="w-10 text-gray-400 text-right">{formatHour(d.hour)}</span>
            <div className="flex-1 bg-gray-800 rounded-full h-2 relative">
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${
                  d.hour >= 23 || d.hour <= 2 ? "bg-red-500" : "bg-blue-500"
                }`}
                style={{ width: `${(d.sends / maxSends) * 100}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-green-500 opacity-60"
                style={{ width: `${(d.replies / maxSends) * 100}%` }}
              />
            </div>
            <span className="w-8 text-gray-400 text-right">{d.sends}</span>
            <span className="w-12 text-right text-xs text-gray-500">
              {Math.round(d.conversion_rate * 100)}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-3 text-xs text-gray-500">
        <span><span className="inline-block w-3 h-3 rounded-full bg-blue-500 mr-1" />Prime sends</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-red-500 mr-1" />Late-night sends</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-green-500 opacity-60 mr-1" />Replies</span>
      </div>
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Same-opener overuse card
// ---------------------------------------------------------------------------
function OpenerOveruseCard({ data }: { data: any[] | undefined }) {
  if (!data) return <CardShell title="Opener overuse" loading />
  if (data.length === 0)
    return (
      <CardShell title="Opener overuse" action="Good variety — no opener is overused (3+ uses).">
        <p className="text-sm text-gray-500">No repeated openers detected this month.</p>
      </CardShell>
    )

  const top = data[0]
  const action = `"${top.preview}…" used ${top.count}× with ${Math.round(top.reply_rate * 100)}% reply rate — rotate your opener.`

  return (
    <CardShell title="Opener overuse" action={action}>
      <table className="w-full text-sm mt-2">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-800">
            <th className="pb-2">Opener (first 50 chars)</th>
            <th className="pb-2 text-right">Uses</th>
            <th className="pb-2 text-right">Reply rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {data.map((g: any, i: number) => (
            <tr key={i}>
              <td className="py-2 text-gray-300 truncate max-w-xs">
                {g.preview}…
              </td>
              <td className="py-2 text-right">{g.count}</td>
              <td className={`py-2 text-right ${g.reply_rate < 0.3 ? "text-red-400" : "text-green-400"}`}>
                {Math.round(g.reply_rate * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Cut-list candidates card — with one-click Archive button per row
// ---------------------------------------------------------------------------
function CutListCard({ data }: { data: any[] | undefined }) {
  const archivePerson = useMutation(api.people.archivePerson)
  const [archiving, setArchiving] = useState<Record<string, boolean>>({})
  const [archived, setArchived] = useState<Record<string, boolean>>({})

  if (!data) return <CardShell title="Cut list" loading />
  if (data.length === 0)
    return (
      <CardShell title="Cut list" action="No obvious cut candidates — ROI looks balanced.">
        <p className="text-sm text-gray-500">No one meets the cut criteria (high effort, low hotness, low reciprocity).</p>
      </CardShell>
    )

  const visible = data.filter((p: any) => !archived[p.person_id])
  const top = visible[0]
  const action = top
    ? `Stop putting energy into ${top.display_name} — effort=${top.effort_rating}/5, hotness=${top.hotness_rating ?? "?"}/10, she's at ${Math.round(top.her_word_ratio * 100)}% reciprocity.`
    : "All cut candidates archived — nice cleanup."

  async function handleArchive(personId: string) {
    setArchiving((prev) => ({ ...prev, [personId]: true }))
    try {
      await archivePerson({ person_id: personId as any, reason: "manual_cut" })
      setArchived((prev) => ({ ...prev, [personId]: true }))
    } finally {
      setArchiving((prev) => ({ ...prev, [personId]: false }))
    }
  }

  return (
    <CardShell title="Cut list" action={action}>
      <table className="w-full text-sm mt-2">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-800">
            <th className="pb-2">Name</th>
            <th className="pb-2 text-right">Effort</th>
            <th className="pb-2 text-right">Hotness</th>
            <th className="pb-2 text-right">Reciprocity</th>
            <th className="pb-2 text-right">Last heard</th>
            <th className="pb-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {visible.map((p: any) => (
            <tr key={p.person_id}>
              <td className="py-2">
                <Link
                  href={`/admin/clapcheeks-ops/people/${p.person_id}`}
                  className="text-blue-400 hover:underline"
                >
                  {p.display_name}
                </Link>
              </td>
              <td className="py-2 text-right text-amber-400">{p.effort_rating}/5</td>
              <td className="py-2 text-right">{p.hotness_rating ?? "—"}/10</td>
              <td className="py-2 text-right text-red-400">{Math.round(p.her_word_ratio * 100)}%</td>
              <td className="py-2 text-right text-gray-500">{daysAgo(p.last_inbound_at)}</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => handleArchive(p.person_id)}
                  disabled={archiving[p.person_id]}
                  className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-300 border border-red-700/50 hover:bg-red-800/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {archiving[p.person_id] ? "…" : "Archive"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(archived).length > 0 && (
        <p className="text-xs text-gray-500 mt-3">
          {Object.keys(archived).length} archived this session — check <Link href="/admin/clapcheeks-ops/network" className="text-blue-400 hover:underline">Network</Link> to review.
        </p>
      )}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Stuck-in-stage card
// ---------------------------------------------------------------------------
function StuckInStageCard({ data }: { data: any[] | undefined }) {
  if (!data) return <CardShell title="Stuck in stage" loading />
  if (data.length === 0)
    return (
      <CardShell title="Stuck in stage" action="No one stuck for 14+ days — momentum looks good.">
        <p className="text-sm text-gray-500">No matched/early_chat threads older than 14 days.</p>
      </CardShell>
    )

  const top = data[0]
  const action = `${top.display_name} has been in "${top.courtship_stage}" for ${top.days_in_stage} days — move forward or move on.`

  return (
    <CardShell title="Stuck in stage" action={action}>
      <table className="w-full text-sm mt-2">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-800">
            <th className="pb-2">Name</th>
            <th className="pb-2">Stage</th>
            <th className="pb-2 text-right">Days stuck</th>
            <th className="pb-2 text-right">Last heard</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {data.map((p: any) => (
            <tr key={p.person_id}>
              <td className="py-2">
                <Link
                  href={`/admin/clapcheeks-ops/people/${p.person_id}`}
                  className="text-blue-400 hover:underline"
                >
                  {p.display_name}
                </Link>
              </td>
              <td className="py-2 text-gray-400">{p.courtship_stage}</td>
              <td className={`py-2 text-right font-bold ${p.days_in_stage > 30 ? "text-red-400" : "text-amber-400"}`}>
                {p.days_in_stage}d
              </td>
              <td className="py-2 text-right text-gray-500">{daysAgo(p.last_inbound_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Time-of-day heatmap card
// ---------------------------------------------------------------------------
function HeatmapCard({ data }: { data: any[] | undefined }) {
  if (!data) return <CardShell title="Send heatmap" loading />

  // Build 7×24 grid
  const grid: Record<string, { sends: number; replies: number; conversion_rate: number }> = {}
  for (const cell of data) {
    grid[`${cell.dow}:${cell.hour}`] = cell
  }

  const maxSends = Math.max(...data.map((d: any) => d.sends), 1)

  // Find best and worst hours
  const withSends = data.filter((d: any) => d.sends >= 3)
  const best = withSends.sort((a: any, b: any) => b.conversion_rate - a.conversion_rate)[0]
  const worst = withSends.sort((a: any, b: any) => a.conversion_rate - b.conversion_rate)[0]

  const action =
    best
      ? `Best send window: ${DOW_LABELS[best.dow]} ${formatHour(best.hour)} (${Math.round(best.conversion_rate * 100)}% reply rate). Worst: ${worst ? DOW_LABELS[worst.dow] + " " + formatHour(worst.hour) : "—"}.`
      : "Not enough data yet — need 3+ sends per slot."

  // Show hours 7am-2am (7-26) for readability
  const SHOW_HOURS = Array.from({ length: 20 }, (_, i) => (i + 7) % 24)

  return (
    <CardShell title="Send heatmap (7d × 24h)" action={action}>
      <div className="mt-3 overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="w-8" />
              {DOW_LABELS.map((d) => (
                <th key={d} className="px-1 text-gray-500 font-normal pb-1">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHOW_HOURS.map((hour) => (
              <tr key={hour}>
                <td className="text-gray-500 pr-2 text-right w-10">
                  {formatHour(hour)}
                </td>
                {Array.from({ length: 7 }, (_, dow) => {
                  const cell = grid[`${dow}:${hour}`]
                  const intensity = cell ? cell.sends / maxSends : 0
                  const rate = cell ? cell.conversion_rate : 0
                  const bg =
                    !cell
                      ? "bg-gray-900"
                      : rate > 0.5
                      ? "bg-green-700"
                      : rate > 0.25
                      ? "bg-blue-700"
                      : "bg-gray-700"
                  return (
                    <td key={dow} className="px-0.5 py-0.5">
                      <div
                        title={cell ? `${cell.sends} sends, ${Math.round(rate * 100)}% replied` : "no sends"}
                        className={`w-7 h-5 rounded-sm ${bg} flex items-center justify-center text-gray-300`}
                        style={{ opacity: cell ? 0.3 + intensity * 0.7 : 0.2 }}
                      >
                        {cell ? cell.sends : ""}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-4 mt-2 text-xs text-gray-500">
          <span><span className="inline-block w-3 h-3 rounded-sm bg-green-700 mr-1" />&gt;50% reply</span>
          <span><span className="inline-block w-3 h-3 rounded-sm bg-blue-700 mr-1" />25–50%</span>
          <span><span className="inline-block w-3 h-3 rounded-sm bg-gray-700 mr-1" />&lt;25%</span>
        </div>
      </div>
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Shell component for all cards
// ---------------------------------------------------------------------------
function CardShell({
  title,
  action,
  loading,
  children,
}: {
  title: string
  action?: string
  loading?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-1">{title}</h2>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {action && (
        <p className="text-sm text-amber-400 bg-amber-950 border border-amber-800 rounded-lg px-3 py-2 mb-4">
          {action}
        </p>
      )}
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function CoachPage() {
  const summary = useQuery(api.coach.getDashboardSummary, { user_id: FLEET_USER_ID })
  const rosterKpis = useQuery(api.coach.getRosterKPIs, { user_id: FLEET_USER_ID })
  const overPursue = useQuery(api.coach.getOverPursueList, { user_id: FLEET_USER_ID })
  const lateNight = useQuery(api.coach.getLateNightConversion, { user_id: FLEET_USER_ID })
  const openerOveruse = useQuery(api.coach.getSameOpenerOveruse, { user_id: FLEET_USER_ID })
  const cutList = useQuery(api.coach.getCutListCandidates, { user_id: FLEET_USER_ID })
  const stuckInStage = useQuery(api.coach.getStuckInStage, { user_id: FLEET_USER_ID })
  const heatmap = useQuery(api.coach.getTimeOfDayHeatmap, { user_id: FLEET_USER_ID })
  // AI-9500 W2 E13 — call stats for /coach KPI bar + breakdown card
  const callStats = useQuery(api.calls.recentForCoach, { user_id: FLEET_USER_ID })

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <h1 className="text-2xl sm:text-3xl font-bold">Self-Coaching Dashboard</h1>
        <Link
          href="/admin/clapcheeks-ops"
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          ← Ops overview
        </Link>
      </div>
      <p className="text-gray-400 text-sm mb-6 sm:mb-8">
        Your patterns across all active threads — last 30 days. Each card has one thing to do.
      </p>

      {/* KPI Summary — includes calls (30d) stat */}
      <SummaryCard summary={summary} callStats={callStats} />

      {/* Roster KPIs — full width */}
      <div className="mb-4 sm:mb-6">
        <RosterCard kpis={rosterKpis} />
      </div>

      {/* Cards — 1 col on mobile, 2 col on lg+ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <OverPursueCard data={overPursue} />
        <CutListCard data={cutList} />
        <StuckInStageCard data={stuckInStage} />
        <OpenerOveruseCard data={openerOveruse} />
        <LateNightCard data={lateNight} />
        <HeatmapCard data={heatmap} />
        {/* AI-9500 W2 E13 — calls breakdown card */}
        <CallsCard data={callStats} />
      </div>
    </div>
  )
}
