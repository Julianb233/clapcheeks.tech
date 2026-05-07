/**
 * Calendar — see upcoming free slots the AI can propose for date_ask.
 * Refreshed every 30 min by the Mac Mini daemon's fetch_calendar_slots job.
 */
"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

const FLEET_USER_ID = "fleet-julian"

export default function CalendarPage() {
  const slots = useQuery(api.calendar.listFreeSlots, {
    user_id: FLEET_USER_ID, horizon_days: 14, limit: 100,
  })

  if (slots === undefined) return <div className="p-8 text-gray-500">Loading…</div>

  const grouped: Record<string, any[]> = {}
  for (const s of slots) {
    const day = new Date(s.slot_start_ms).toLocaleDateString()
    grouped[day] ||= []
    grouped[day].push(s)
  }

  return (
    <div className="p-8 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">Free Slots</h1>
      <p className="text-gray-400 mb-6">
        AI proposes date times only from these. {slots.length} 1-hour windows in next 14 days.
        Refreshed every 30 min from <span className="text-purple-300">julian@aiacrobatics.com primary</span>
        {" + "}<span className="text-purple-300">Dating</span> calendar. Confirmed dates land on the Dating calendar.
        Override via <code className="text-xs bg-gray-800 px-1 rounded">CC_BUSY_CALENDARS</code> env on Mac Mini.
      </p>

      {Object.entries(grouped).map(([day, ss]) => (
        <section key={day} className="mb-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">{day}</h2>
          <div className="flex flex-wrap gap-2">
            {ss.map((s: any) => (
              <span key={s._id} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-1 text-sm">
                {s.label_local || new Date(s.slot_start_ms).toLocaleTimeString([], { hour: "numeric" })}
              </span>
            ))}
          </div>
        </section>
      ))}

      {slots.length === 0 && (
        <div className="text-gray-500 text-sm">
          No slots cached yet. The Mac Mini daemon&apos;s fetch_calendar_slots cron runs every
          30 min — first run populates this within an hour.
        </div>
      )}
    </div>
  )
}
