/**
 * Touches preview — what's scheduled to fire in the next N hours.
 * Cancel buttons for queued non-urgent items.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState } from "react"

const FLEET_USER_ID = "fleet-julian"

export default function TouchesPage() {
  const [horizon, setHorizon] = useState(72)
  const upcoming = useQuery(api.touches.listUpcoming, {
    user_id: FLEET_USER_ID, horizon_hours: horizon, limit: 200,
  })
  const cancel = useMutation(api.touches.cancelOne)

  if (upcoming === undefined) return <div className="p-8 text-gray-500">Loading…</div>

  const grouped: Record<string, any[]> = {}
  for (const t of upcoming) {
    const day = new Date(t.scheduled_for).toLocaleDateString()
    grouped[day] ||= []
    grouped[day].push(t)
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
            {ts.map((t: any) => (
              <div key={t._id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex gap-2 items-center text-sm">
                    <span className="font-medium">{t.type}</span>
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
                  </div>
                  {t.draft_body && (
                    <div className="text-sm text-gray-400 mt-1 line-clamp-2">{t.draft_body}</div>
                  )}
                  {t.prompt_template && !t.draft_body && (
                    <div className="text-xs text-gray-500 mt-1 italic">
                      regenerate at fire time · template={t.prompt_template}
                    </div>
                  )}
                </div>
                <button onClick={() => cancel({ touch_id: t._id, reason: "manual_cancel" })}
                        className="ml-3 text-xs text-gray-500 hover:text-red-400">
                  cancel
                </button>
              </div>
            ))}
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
