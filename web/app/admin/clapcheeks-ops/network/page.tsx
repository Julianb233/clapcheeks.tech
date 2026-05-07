/**
 * Network — CC TECH people, ranked by recency + courtship signals.
 * Click a person → /admin/clapcheeks-ops/people/[id] for the full dossier
 * (timeline / memory / schedule / media / profile / notes + compose panel).
 */
"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import Link from "next/link"

const FLEET_USER_ID = "fleet-julian"

const STAGE_ORDER = [
  "matched", "early_chat", "phone_swap", "pre_date",
  "first_date_done", "ongoing", "exclusive", "ghosted", "ended",
]

export default function NetworkPage() {
  const people = useQuery(api.people.listForUser, {
    user_id: FLEET_USER_ID, limit: 200, only_cc_tech: true,
  })

  if (people === undefined) return <div className="p-8 text-gray-500">Loading…</div>

  const byStage: Record<string, any[]> = {}
  for (const p of people) {
    const stage = p.courtship_stage || "early_chat"
    byStage[stage] ||= []
    byStage[stage].push(p)
  }

  return (
    <div className="p-8 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">CC TECH Network</h1>
      <p className="text-gray-400 mb-6">
        {people.length} people · ranked within courtship stage by last_inbound_at.
      </p>

      {STAGE_ORDER.map((stage) => {
        const ppl = (byStage[stage] || []).sort(
          (a, b) => (b.last_inbound_at ?? 0) - (a.last_inbound_at ?? 0),
        )
        if (ppl.length === 0) return null
        return (
          <section key={stage} className="mb-8">
            <h2 className="text-xl font-semibold mb-2 capitalize">
              {stage.replace(/_/g, " ")} ({ppl.length})
            </h2>
            <div className="space-y-2">
              {ppl.map((p) => (
                <PersonRow key={p._id} p={p} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function PersonRow({ p }: { p: any }) {
  const lastInbound = p.last_inbound_at
    ? `${Math.round((Date.now() - p.last_inbound_at) / 3600000)}h ago`
    : "—"
  const trust = p.trust_score?.toFixed(2) ?? "—"
  const ttas = p.time_to_ask_score?.toFixed(2) ?? "—"
  const lastEmotion = (p.emotional_state_recent ?? []).slice(-1)[0]?.state ?? "—"
  return (
    <Link
      href={`/admin/clapcheeks-ops/people/${p._id}`}
      className="block bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-purple-700 hover:bg-gray-800/60 transition-colors"
    >
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="font-medium">{p.display_name}</div>
          <div className="text-xs text-gray-500 mt-1">
            inbound {lastInbound} · trust {trust} · ask {ttas} · {lastEmotion}
          </div>
          {p.next_best_move && (
            <div className="text-sm text-purple-300 mt-2">
              💡 {p.next_best_move}
            </div>
          )}
          {p.curiosity_ledger && p.curiosity_ledger.filter((q: any) => q.status === "pending").length > 0 && (
            <div className="text-xs text-gray-400 mt-1">
              Q: {p.curiosity_ledger.filter((q: any) => q.status === "pending")[0]?.question}
            </div>
          )}
        </div>
        <div className="text-right text-xs text-gray-500">
          {p.cadence_profile} · {p.whitelist_for_autoreply ? "✓ whitelisted" : "○ manual"}
        </div>
      </div>
    </Link>
  )
}
