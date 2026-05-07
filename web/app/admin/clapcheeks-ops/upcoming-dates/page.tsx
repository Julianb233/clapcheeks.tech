/**
 * AI-9500 Wave 2 #I — Upcoming dates operator view.
 *
 * Lists all active date logistics checklists across all people —
 * operator's "what dates do I have coming up" page.
 *
 * Route: /admin/clapcheeks-ops/upcoming-dates
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import Link from "next/link"

const FLEET_USER_ID = "fleet-julian"

export default function UpcomingDatesPage() {
  const checklists = useQuery(api.date_logistics.listForUser, {
    user_id: FLEET_USER_ID,
    include_completed: false,
  })
  const tickItemMut = useMutation(api.date_logistics.tickItem)
  const completeChecklistMut = useMutation(api.date_logistics.complete)

  if (checklists === undefined) {
    return <div className="p-8 text-gray-500">Loading upcoming dates…</div>
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/clapcheeks-ops"
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← back to ops
        </Link>
        <h1 className="text-2xl font-bold mt-2">Upcoming dates</h1>
        <p className="text-sm text-gray-400 mt-1">
          Pre-date logistics checklists — auto-created when she says yes.
        </p>
      </div>

      {checklists.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center text-gray-500 text-sm">
          No upcoming dates yet.{" "}
          <span className="text-gray-600">
            Checklists appear here when she replies "yes" to a date ask.
          </span>
        </div>
      ) : (
        <div className="space-y-6">
          {checklists.map((cl: any) => {
            const allDone = cl.items.every((it: any) => it.done)
            const doneCnt = cl.items.filter((it: any) => it.done).length
            const daysUntil = Math.ceil(
              (cl.date_time_ms - Date.now()) / (24 * 60 * 60 * 1000)
            )
            const dateLabel = new Date(cl.date_time_ms).toLocaleDateString(undefined, {
              weekday: "long", month: "long", day: "numeric",
            })
            const timeLabel = new Date(cl.date_time_ms).toLocaleTimeString(undefined, {
              hour: "2-digit", minute: "2-digit",
            })

            return (
              <div
                key={cl._id}
                className={`rounded-xl border p-5 ${
                  allDone
                    ? "border-green-700 bg-green-950/20"
                    : daysUntil <= 1
                    ? "border-amber-700/70 bg-amber-950/10"
                    : "border-purple-800/50 bg-gray-900"
                }`}
              >
                {/* Checklist header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    {/* Person name + dossier link */}
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/admin/clapcheeks-ops/people/${cl.person_id}`}
                        className="text-lg font-bold text-purple-300 hover:text-purple-200 underline decoration-purple-800"
                      >
                        {cl.person_name}
                      </Link>
                      {cl.person_courtship_stage && (
                        <span className="text-xs text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">
                          {cl.person_courtship_stage}
                        </span>
                      )}
                    </div>
                    {/* Date / time / venue */}
                    <div className="text-sm text-gray-300">
                      {dateLabel} at {timeLabel}
                      {cl.venue && (
                        <span className="ml-2 text-gray-400">@ {cl.venue}</span>
                      )}
                    </div>
                    {/* Countdown */}
                    <div className={`text-xs mt-1 font-semibold ${
                      daysUntil <= 0
                        ? "text-red-400"
                        : daysUntil === 1
                        ? "text-amber-400"
                        : "text-gray-500"
                    }`}>
                      {daysUntil <= 0
                        ? "TODAY"
                        : daysUntil === 1
                        ? "TOMORROW"
                        : `${daysUntil} days away`}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {/* Progress pill */}
                    <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                      allDone
                        ? "bg-green-900 text-green-300"
                        : "bg-gray-800 text-gray-400"
                    }`}>
                      {doneCnt}/{cl.items.length} done
                    </span>

                    {!allDone && (
                      <button
                        onClick={() => completeChecklistMut({ checklist_id: cl._id })}
                        className="text-xs px-3 py-1 rounded bg-green-800 hover:bg-green-700 text-white"
                      >
                        Mark all done
                      </button>
                    )}
                    {allDone && (
                      <span className="text-xs text-green-400 font-semibold">
                        All done!
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-gray-800 rounded-full mb-4 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      allDone ? "bg-green-500" : "bg-purple-500"
                    }`}
                    style={{ width: `${(doneCnt / cl.items.length) * 100}%` }}
                  />
                </div>

                {/* Items */}
                <ul className="space-y-2">
                  {cl.items.map((item: any) => (
                    <li key={item.key} className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={(e) =>
                          tickItemMut({
                            checklist_id: cl._id,
                            key: item.key,
                            done: e.target.checked,
                          })
                        }
                        className="w-4 h-4 accent-green-500 cursor-pointer flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <span
                          className={`text-sm ${
                            item.done
                              ? "line-through text-gray-500"
                              : "text-gray-200"
                          }`}
                        >
                          {item.label}
                        </span>
                        {item.done_at_ms && (
                          <span className="ml-2 text-xs text-gray-600">
                            {new Date(item.done_at_ms).toLocaleTimeString(undefined, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        {item.notes && (
                          <div className="text-xs text-gray-500 italic">
                            {item.notes}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
