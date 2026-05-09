/**
 * AI-9449 Wave 2.2 — Clapcheeks operator overview.
 *
 * Live snapshot of Julian's dating ops:
 *   - CC TECH network size + courtship-stage breakdown
 *   - Pending media awaiting approval
 *   - Scheduled touches in next 24h
 *   - Latest digest items
 *   - Backfill orphan status
 *
 * Read-only. Action surfaces live in /admin/clapcheeks-ops/{network,media,touches,calendar}.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import Link from "next/link"
import { useState } from "react"

const FLEET_USER_ID = "fleet-julian"

export default function ClapcheeksOpsOverview() {
  const vibeCandidates = useQuery(api.people.listVibeCandidates, {
    user_id: FLEET_USER_ID, limit: 5,
  })
  const pendingMedia = useQuery(api.media.listForApproval, { user_id: FLEET_USER_ID })
  const orphanStatus = useQuery(api.backfill.orphanStatus, { user_id: FLEET_USER_ID })
  // AI-9526: wire the previously hardcoded "—" touches card to live data.
  const upcomingTouches = useQuery(api.touches.listUpcoming, {
    user_id: FLEET_USER_ID, horizon_hours: 24, limit: 200,
  })
  const pendingLinks = useQuery(api.people.listPendingLinks, {
    user_id: FLEET_USER_ID, limit: 100,
  })
  const profileImports = useQuery(api.profile_import.listForReview, {
    user_id: FLEET_USER_ID, limit: 50,
  })
  // AI-9526: kick-sweep affordance — operator can force-run the sweeps without
  // waiting 6h. Helpful right after a backfill or when adding a new batch of
  // people from screenshots.
  const triggerCourtshipSweep = useMutation(api.enrichment.triggerCourtshipSweep)
  const triggerVibeSweep = useMutation(api.enrichment.triggerVibeSweep)
  const [sweepStatus, setSweepStatus] = useState<string | null>(null)
  const [sweeping, setSweeping] = useState(false)

  async function kickSweeps() {
    setSweeping(true); setSweepStatus(null)
    try {
      const c = await triggerCourtshipSweep({})
      const v = await triggerVibeSweep({})
      setSweepStatus(
        `✓ Courtship: scheduled ${c.scheduled}/${c.eligible} (of ${c.total_people}) · Vibe: scheduled ${v.scheduled}/${v.eligible}. Results land in 30-180s.`
      )
    } catch (e: any) {
      setSweepStatus(`✗ Failed: ${e?.message ?? "unknown"}`)
    } finally { setSweeping(false) }
  }

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      <h1 className="text-2xl sm:text-3xl font-bold mb-2">Clapcheeks Ops</h1>
      <p className="text-gray-400 text-sm mb-6 sm:mb-8">
        Your dating co-pilot — live state, ranked surfaces, one-tap controls.
      </p>

      {/* AI-9643 — Live messages dashboard nav card */}
      <Link href="/admin/clapcheeks-ops/messages"
            className="block mb-4 bg-gradient-to-r from-rose-950 to-gray-900 border border-rose-800 rounded-xl p-5 hover:border-rose-600 transition">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💬</span>
          <div>
            <div className="font-bold text-lg text-white">Live messages dashboard</div>
            <div className="text-sm text-rose-300">
              Real-time inbound + outbound feed across the network. Quick send, regenerate, edit, and comms preferences in one screen.
            </div>
          </div>
          <span className="ml-auto text-rose-400 text-xl">→</span>
        </div>
      </Link>

      {/* AI-9500 W2 #M — Cohort retro nav card */}
      <Link href="/admin/clapcheeks-ops/cohort"
            className="block mb-4 bg-gradient-to-r from-indigo-950 to-gray-900 border border-indigo-800 rounded-xl p-5 hover:border-indigo-600 transition">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📊</span>
          <div>
            <div className="font-bold text-lg text-white">Cohort retro analysis</div>
            <div className="text-sm text-indigo-300">
              12-month funnel: matched → reply → date → dating. Opener length, day-of-week, LLM insights.
            </div>
          </div>
          <span className="ml-auto text-indigo-400 text-xl">→</span>
        </div>
      </Link>

      {/* AI-9500 W2 #I — Upcoming dates nav card */}
      <Link href="/admin/clapcheeks-ops/upcoming-dates"
            className="block mb-4 bg-gradient-to-r from-green-950 to-gray-900 border border-green-800 rounded-xl p-5 hover:border-green-600 transition">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <div className="font-bold text-lg text-white">Upcoming dates</div>
            <div className="text-sm text-green-300">
              Pre-date logistics checklists — auto-created when she says yes
            </div>
          </div>
          <span className="ml-auto text-green-400 text-xl">→</span>
        </div>
      </Link>

      {/* AI-9500 #7 — Self-coaching nav card */}
      <Link href="/admin/clapcheeks-ops/coach"
            className="block mb-6 bg-gradient-to-r from-purple-950 to-gray-900 border border-purple-800 rounded-xl p-5 hover:border-purple-600 transition">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🧠</span>
          <div>
            <div className="font-bold text-lg text-white">Self-coaching dashboard</div>
            <div className="text-sm text-purple-300">
              See your patterns — over-pursue, late-night sends, opener overuse, cut list, stuck threads, heatmap
            </div>
          </div>
          <span className="ml-auto text-purple-400 text-xl">→</span>
        </div>
      </Link>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <Card title="Pending media for approval"
              value={pendingMedia === undefined ? "…" : pendingMedia.length}
              href="/admin/clapcheeks-ops/media" />
        <Card title="Orphan conversations (un-linked)"
              value={orphanStatus === undefined ? "…" : (orphanStatus.orphans ?? orphanStatus.orphan_conversations_visible ?? 0)} />
        <Card title="Vibe candidates not yet in network"
              value={vibeCandidates === undefined ? "…" : vibeCandidates.length}
              href="/admin/clapcheeks-ops/network" />
        <Card title="Scheduled touches (next 24h)"
              value={upcomingTouches === undefined ? "…" : upcomingTouches.length}
              href="/admin/clapcheeks-ops/touches" />
        <Card title="Pending links (need review)"
              value={pendingLinks === undefined ? "…" : pendingLinks.length}
              href="/admin/clapcheeks-ops/pending-links" />
        <Card title="Profile screenshots awaiting"
              value={profileImports === undefined ? "…" : profileImports.length}
              href="/admin/clapcheeks-ops/profile-imports" />
      </div>

      {/* AI-9526 — Kick sweeps now */}
      <div className="mb-8 p-4 rounded-lg border border-purple-800/50 bg-purple-950/20">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-semibold text-purple-200">Force-run enrichment sweeps</div>
            <div className="text-xs text-purple-400/80 mt-0.5">
              Sweeps run every 6h on cron. Click to fire now — populates
              vibe / courtship / next_best_move / curiosity for up to 30 people.
            </div>
            {sweepStatus && (
              <div className="text-xs mt-2 font-mono text-gray-300">{sweepStatus}</div>
            )}
          </div>
          <button
            onClick={kickSweeps}
            disabled={sweeping}
            className="text-sm px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white whitespace-nowrap"
          >
            {sweeping ? "Sweeping…" : "🌀 Kick sweeps now"}
          </button>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Vibe candidates</h2>
        <p className="text-sm text-gray-500 mb-3">
          Conversations the AI thinks are dating-vibe but you haven&apos;t added to CC TECH yet.
        </p>
        <div className="space-y-2">
          {vibeCandidates && vibeCandidates.length > 0 ? (
            vibeCandidates.slice(0, 5).map((c: any) => (
              <div key={c._id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{c.display_name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      vibe: {c.vibe_classification} · conf {(c.vibe_confidence ?? 0).toFixed(2)}
                    </div>
                    {c.vibe_evidence && (
                      <div className="text-sm text-gray-400 mt-2 italic">&quot;{c.vibe_evidence}&quot;</div>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-500">
              No candidates yet. Vibe sweep runs every 6h — populates as backfill catches up.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Pending media</h2>
        <div className="space-y-2">
          {pendingMedia && pendingMedia.length > 0 ? (
            pendingMedia.slice(0, 8).map((m: any) => (
              <div key={m._id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex gap-3">
                {m.thumbnail_url || m.storage_url ? (
                  <img src={m.thumbnail_url || m.storage_url} alt={m.caption || ""}
                       className="w-16 h-16 object-cover rounded" />
                ) : (
                  <div className="w-16 h-16 bg-gray-800 rounded flex items-center justify-center text-xs text-gray-500">no preview</div>
                )}
                <div className="flex-1">
                  <div className="text-sm font-medium">{m.caption || m.asset_id}</div>
                  <div className="text-xs text-gray-500">
                    {m.kind} · vibe={m.vibe ?? "—"} · flex={m.flex_level ?? "—"}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    tags: {(m.tags ?? []).slice(0, 5).join(", ") || "(untagged)"}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-500">
              No pending media. Drop photos into your &quot;Clapcheeks Media&quot; Drive folder
              to populate the library.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Card({ title, value, href }: { title: string; value: any; href?: string }) {
  const inner = (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition">
      <div className="text-sm text-gray-400">{title}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
