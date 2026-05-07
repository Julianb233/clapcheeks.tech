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

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import Link from "next/link"

const FLEET_USER_ID = "fleet-julian"

export default function ClapcheeksOpsOverview() {
  const vibeCandidates = useQuery(api.people.listVibeCandidates, {
    user_id: FLEET_USER_ID, limit: 5,
  })
  const pendingMedia = useQuery(api.media.listForApproval, { user_id: FLEET_USER_ID })
  const orphanStatus = useQuery(api.backfill.orphanStatus, { user_id: FLEET_USER_ID })

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      <h1 className="text-2xl sm:text-3xl font-bold mb-2">Clapcheeks Ops</h1>
      <p className="text-gray-400 text-sm mb-6 sm:mb-8">
        Your dating co-pilot — live state, ranked surfaces, one-tap controls.
      </p>

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Card title="Pending media for approval"
              value={pendingMedia?.length ?? "—"}
              href="/admin/clapcheeks-ops/media" />
        <Card title="Orphan conversations (un-linked)"
              value={orphanStatus?.orphan_conversations_visible ?? "—"} />
        <Card title="Vibe candidates not yet in network"
              value={vibeCandidates?.length ?? "—"}
              href="/admin/clapcheeks-ops/network" />
        <Card title="Scheduled touches (next 24h)"
              value={"—"}
              href="/admin/clapcheeks-ops/touches" />
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
