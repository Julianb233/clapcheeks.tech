/**
 * Network — operator's dating-relevant people, ranked by hotness × recency.
 * Click a person → /admin/clapcheeks-ops/people/[id] for the full dossier.
 *
 * Filter (default ON): only show people who are dating-relevant —
 *   - status in {lead, active, dating, paused} AND
 *   - (has any iMessage/dating-app handle OR last_inbound_at within 90d
 *     OR explicitly hotness_rating set OR vibe_classification=="dating")
 *
 * Toggle the "Everyone" switch to drop the filter and see all 500+ rows.
 */
"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import Link from "next/link"
import { useState } from "react"

const FLEET_USER_ID = "fleet-julian"

const STAGE_ORDER = [
  "matched", "early_chat", "phone_swap", "pre_date",
  "first_date_done", "ongoing", "exclusive", "ghosted", "ended",
]

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000

function isDatingRelevant(p: any): boolean {
  if (!["lead", "active", "dating", "paused"].includes(p.status)) return false
  const hasHandle = (p.handles ?? []).some((h: any) =>
    ["imessage", "hinge", "tinder", "bumble", "instagram"].includes(h.channel)
  )
  const hasRecentInbound = p.last_inbound_at && (Date.now() - p.last_inbound_at) < NINETY_DAYS
  const hasOperatorRating = p.hotness_rating !== undefined || p.effort_rating !== undefined
  const isDatingVibe = p.vibe_classification === "dating"
  const isImported = p.imported_from_profile_screenshot === true
  return Boolean(hasHandle || hasRecentInbound || hasOperatorRating || isDatingVibe || isImported)
}

function priorityScore(p: any): number {
  let score = 0
  if (p.hotness_rating) score += p.hotness_rating * 10
  if (p.last_inbound_at) {
    const hoursAgo = (Date.now() - p.last_inbound_at) / 3600000
    score += Math.max(0, 50 - hoursAgo)
  }
  if (p.next_followup_at && p.next_followup_at < Date.now()) score += 20
  if (p.time_to_ask_score) score += p.time_to_ask_score * 30
  if (p.whitelist_for_autoreply) score += 5
  return score
}

export default function NetworkPage() {
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState("")
  const people = useQuery(api.people.listForUser, {
    user_id: FLEET_USER_ID, limit: 500, only_cc_tech: false,
  })

  if (people === undefined) return <div className="p-8 text-gray-500">Loading…</div>

  const filtered = people.filter((p: any) => {
    if (search) {
      const q = search.toLowerCase()
      if (!p.display_name?.toLowerCase().includes(q) &&
          !p.context_notes?.toLowerCase().includes(q)) return false
    }
    return showAll ? true : isDatingRelevant(p)
  })

  // AI-9500 coach pulse — 3 buckets that tell you "what to do now":
  //   needs_response: she replied, you haven't, last 12h
  //   cooling: last_inbound > 3d AND was warm (last emotional_state positive)
  //   followup_due: next_followup_at past now
  const now = Date.now()
  const TWELVE_H = 12 * 3600 * 1000
  const THREE_D = 3 * 24 * 3600 * 1000
  const needsResponse = filtered
    .filter((p: any) => {
      if (!p.last_inbound_at) return false
      if (now - p.last_inbound_at > TWELVE_H) return false
      if (p.last_outbound_at && p.last_outbound_at > p.last_inbound_at) return false
      return true
    })
    .sort((a: any, b: any) => priorityScore(b) - priorityScore(a))
    .slice(0, 5)
  const cooling = filtered
    .filter((p: any) => {
      if (!p.last_inbound_at) return false
      const sinceIn = now - p.last_inbound_at
      if (sinceIn < THREE_D || sinceIn > 30 * 24 * 3600 * 1000) return false
      const emo = (p.emotional_state_recent ?? []).slice(-1)[0]?.state
      const wasWarm = emo === "happy" || emo === "playful" || emo === "flirty" || emo === "warm" ||
        p.conversation_temperature === "warm" || p.conversation_temperature === "hot"
      return wasWarm
    })
    .sort((a: any, b: any) => (a.last_inbound_at ?? 0) - (b.last_inbound_at ?? 0))
    .slice(0, 5)
  const followupDue = filtered
    .filter((p: any) => p.next_followup_at && p.next_followup_at < now)
    .sort((a: any, b: any) => (a.next_followup_at ?? 0) - (b.next_followup_at ?? 0))
    .slice(0, 5)

  const byStage: Record<string, any[]> = {}
  for (const p of filtered) {
    const stage = p.courtship_stage || (p.status === "lead" ? "matched" : "early_chat")
    byStage[stage] ||= []
    byStage[stage].push(p)
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h1 className="text-3xl font-bold">Network</h1>
          <p className="text-gray-400">
            {filtered.length} of {people.length} people · ranked by hotness × recency
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            value={search}
            placeholder="search name…"
            onChange={(e) => setSearch(e.target.value)}
            className="bg-gray-950 border border-gray-800 rounded px-3 py-1.5 text-sm w-48"
          />
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            show all (incl. non-dating)
          </label>
        </div>
      </div>

      <div className="text-xs text-gray-600 mb-4">
        Default view: lead/active/dating/paused with dating-channel handle, recent inbound, operator rating, or dating vibe.
      </div>

      <PulseCard needsResponse={needsResponse} cooling={cooling} followupDue={followupDue} />

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          {search ? "No matches." : "No dating-relevant people yet — toggle 'show all' to see everyone."}
        </div>
      )}

      {STAGE_ORDER.map((stage) => {
        const ppl = (byStage[stage] || []).sort((a, b) => priorityScore(b) - priorityScore(a))
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
  const platforms = Array.from(new Set((p.handles ?? []).map((h: any) => h.channel)))
  return (
    <Link
      href={`/admin/clapcheeks-ops/people/${p._id}`}
      className="block bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-purple-700 hover:bg-gray-800/60 transition-colors"
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium">{p.display_name}</span>
            {p.age && <span className="text-gray-500 text-xs">· {p.age}</span>}
            {p.hotness_rating && (
              <span className="text-pink-300 text-xs font-mono">🔥 {p.hotness_rating}/10</span>
            )}
            {p.effort_rating && (
              <span className="text-amber-300 text-xs font-mono">⚡ {p.effort_rating}/5</span>
            )}
            {p.nurture_state && (
              <span className="text-purple-300 text-xs uppercase">{p.nurture_state}</span>
            )}
            {platforms.length > 0 && (
              <span className="text-xs text-gray-600">{platforms.join(" · ")}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            inbound {lastInbound} · trust {trust} · ask {ttas} · emo {lastEmotion}
            {p.zodiac_sign && <span className="ml-2 capitalize">♈ {p.zodiac_sign}</span>}
          </div>
          {p.next_best_move && (
            <div className="text-sm text-purple-300 mt-2 line-clamp-1">💡 {p.next_best_move}</div>
          )}
          {p.curiosity_ledger && p.curiosity_ledger.filter((q: any) => q.status === "pending").length > 0 && (
            <div className="text-xs text-gray-400 mt-1 line-clamp-1">
              Q: {p.curiosity_ledger.filter((q: any) => q.status === "pending")[0]?.question}
            </div>
          )}
        </div>
        <div className="text-right text-xs text-gray-500 flex-shrink-0">
          <div>{p.cadence_profile}</div>
          <div className={p.whitelist_for_autoreply ? "text-green-400" : "text-gray-600"}>
            {p.whitelist_for_autoreply ? "✓ whitelisted" : "○ manual"}
          </div>
          {p.next_followup_at && (
            <div className="text-amber-400 mt-1">
              follow-up {new Date(p.next_followup_at).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

// AI-9500 — Pulse card. Tier 1 coach view: 3 buckets that tell you "what to
// do now" without LLM scoring. Pure math on existing fields.
function PulseCard({ needsResponse, cooling, followupDue }: {
  needsResponse: any[]; cooling: any[]; followupDue: any[];
}) {
  if (needsResponse.length === 0 && cooling.length === 0 && followupDue.length === 0) {
    return null
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
      <PulseColumn
        title="🔥 Needs response now"
        subtitle="she replied, you haven't · last 12h"
        people={needsResponse}
        accent="border-pink-700/60 bg-pink-900/10"
        emptyMsg="all caught up — ✓"
      />
      <PulseColumn
        title="📉 Cooling off"
        subtitle="last warm > 3d ago · intervene now"
        people={cooling}
        accent="border-amber-700/60 bg-amber-900/10"
        emptyMsg="nobody cooling"
      />
      <PulseColumn
        title="⏰ Follow-up due"
        subtitle="next_followup_at past now"
        people={followupDue}
        accent="border-purple-700/60 bg-purple-900/10"
        emptyMsg="no scheduled follow-ups overdue"
      />
    </div>
  )
}

function PulseColumn({ title, subtitle, people, accent, emptyMsg }: {
  title: string; subtitle: string; people: any[]; accent: string; emptyMsg: string;
}) {
  return (
    <div className={`rounded-lg p-3 border ${accent}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[10px] text-gray-500 mb-2">{subtitle}</div>
      {people.length === 0 ? (
        <div className="text-xs text-gray-600">{emptyMsg}</div>
      ) : (
        <ul className="space-y-1">
          {people.map((p: any) => {
            const sinceIn = p.last_inbound_at ? Math.round((Date.now() - p.last_inbound_at) / 3600000) : null
            return (
              <li key={p._id}>
                <Link
                  href={`/admin/clapcheeks-ops/people/${p._id}`}
                  className="block text-xs text-gray-200 hover:text-white py-1 px-2 rounded hover:bg-white/5"
                >
                  <span className="font-medium">{p.display_name}</span>
                  {p.hotness_rating && <span className="ml-2 text-pink-300">🔥{p.hotness_rating}</span>}
                  {sinceIn !== null && (
                    <span className="text-[10px] text-gray-500 ml-2">
                      {sinceIn < 24 ? `${sinceIn}h ago` : `${Math.round(sinceIn / 24)}d ago`}
                    </span>
                  )}
                  {p.next_best_move && (
                    <div className="text-[10px] text-purple-300 line-clamp-1">💡 {p.next_best_move}</div>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
