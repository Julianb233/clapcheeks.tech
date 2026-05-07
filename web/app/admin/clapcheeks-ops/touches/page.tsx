/**
 * Touches preview — what's scheduled to fire in the next N hours.
 * Cancel buttons for queued non-urgent items.
 *
 * AI-9500 Wave2 #K: pre_date_debrief rows show an expandable debrief card.
 * Date-related rows (date_ask, date_confirm_24h, date_dayof, pre_date_debrief)
 * can be expanded to show the full debrief summary.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState } from "react"
import Link from "next/link"
import { Id } from "@/convex/_generated/dataModel"

const FLEET_USER_ID = "fleet-julian"

const DATE_TYPES = new Set([
  "date_ask", "date_confirm_24h", "date_dayof",
  "date_dayof_transit", "date_check_in", "date_postmortem",
  "pre_date_debrief",
])

export default function TouchesPage() {
  const [horizon, setHorizon] = useState(72)
  const upcoming = useQuery(api.touches.listUpcoming, {
    user_id: FLEET_USER_ID, horizon_hours: horizon, limit: 200,
  })
  const cancel = useMutation(api.touches.cancelOne)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (upcoming === undefined) return <div className="p-8 text-gray-500">Loading…</div>

  const grouped: Record<string, any[]> = {}
  for (const t of upcoming) {
    const day = new Date(t.scheduled_for).toLocaleDateString()
    grouped[day] ||= []
    grouped[day].push(t)
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="p-8 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">Scheduled Touches</h1>
      <p className="text-gray-400 mb-6">
        {upcoming.length} touches in next {horizon}h.
      </p>

      <div className="flex gap-2 mb-6">
        {[24, 72, 168].map((h) => (
          <button key={h} onClick={() => setHorizon(h)}
                  className={`px-4 py-2 rounded-lg text-sm ${horizon === h ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300"}`}>
            {h === 168 ? "1 week" : `${h}h`}
          </button>
        ))}
      </div>

      {Object.entries(grouped).map(([day, ts]) => (
        <section key={day} className="mb-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">{day}</h2>
          <div className="space-y-2">
            {ts.map((t: any) => {
              const isDateType = DATE_TYPES.has(t.type)
              const isDebriefTouch = t.type === "pre_date_debrief"
              const isExpanded = expanded[t._id]

              return (
                <div
                  key={t._id}
                  className={`bg-gray-900 border rounded-lg ${
                    isDebriefTouch
                      ? "border-amber-700/50"
                      : isDateType
                      ? "border-purple-800/50"
                      : "border-gray-800"
                  }`}
                >
                  <div className="p-3 flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex gap-2 items-center text-sm flex-wrap">
                        {isDebriefTouch && <span className="text-amber-400">📋</span>}
                        <span className={`font-medium ${isDebriefTouch ? "text-amber-300" : isDateType ? "text-purple-300" : ""}`}>
                          {t.type}
                        </span>
                        <span className="text-gray-500">·</span>
                        <span className="text-gray-400">
                          {new Date(t.scheduled_for).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                        {t.urgency && (
                          <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                            t.urgency === "hot" ? "bg-red-900 text-red-200"
                              : t.urgency === "warm" ? "bg-yellow-900 text-yellow-200"
                              : "bg-gray-800 text-gray-400"
                          }`}>
                            {t.urgency}
                          </span>
                        )}
                        {t.person_id && (
                          <Link
                            href={`/admin/clapcheeks-ops/people/${t.person_id}`}
                            className="text-xs text-purple-400 hover:text-purple-300 underline ml-1"
                          >
                            view dossier
                          </Link>
                        )}
                      </div>
                      {/* Draft preview (non-debrief) */}
                      {t.draft_body && !isDebriefTouch && (
                        <div className="text-sm text-gray-400 mt-1 line-clamp-2">{t.draft_body}</div>
                      )}
                      {t.prompt_template && !t.draft_body && (
                        <div className="text-xs text-gray-500 mt-1 italic">
                          regenerate at fire time · template={t.prompt_template}
                        </div>
                      )}
                      {/* Debrief touch — show expand button */}
                      {isDebriefTouch && t.draft_body && (
                        <button
                          onClick={() => toggleExpand(t._id)}
                          className="mt-1 text-xs text-amber-400 hover:text-amber-300"
                        >
                          {isExpanded ? "▲ hide debrief" : "▼ show debrief"}
                        </button>
                      )}
                    </div>
                    <button onClick={() => cancel({ touch_id: t._id, reason: "manual_cancel" })}
                            className="ml-3 text-xs text-gray-500 hover:text-red-400 shrink-0">
                      cancel
                    </button>
                  </div>

                  {/* Expandable debrief card */}
                  {isDebriefTouch && isExpanded && t.draft_body && (
                    <div className="px-4 pb-4">
                      <div className="border-t border-amber-700/30 pt-3">
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">
                          {t.draft_body}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {upcoming.length === 0 && (
        <div className="text-gray-500 text-sm">
          Nothing scheduled. Touches are auto-created by the inbound interpreter
          when she texts, and by the date-ask sweep every 6h.
        </div>
      )}
    </div>
  )
}
