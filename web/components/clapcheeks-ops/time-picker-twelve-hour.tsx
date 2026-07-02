/**
 * AI-10022 — TimePickerTwelveHour
 *
 * Extracted 12-hour clock picker. Used by ComposePanel schedule-send +
 * the cross-person drafts inbox. Supports four quick presets (In 1h,
 * In 3h, Tonight 8pm, Tomorrow 9am) plus manual day/hour/minute/AmPm.
 */
"use client"

import { useEffect, useState } from "react"

type Props = {
  onScheduledMs: (ms: number) => void
  initialMs?: number
  compact?: boolean
}

type DayChoice = "today" | "tomorrow"
type AmPm = "AM" | "PM"

function decompose(ms: number): { day: DayChoice; hour: string; minute: string; ampm: AmPm } {
  const target = new Date(ms)
  const now = new Date()
  const sameDay = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth() && target.getDate() === now.getDate()
  const day: DayChoice = sameDay ? "today" : "tomorrow"
  let h = target.getHours()
  const ampm: AmPm = h >= 12 ? "PM" : "AM"
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  const minute = String(target.getMinutes()).padStart(2, "0")
  return { day, hour: String(h), minute, ampm }
}

function compose(day: DayChoice, hour: string, minute: string, ampm: AmPm): number {
  const target = new Date()
  let h = parseInt(hour)
  if (ampm === "PM" && h < 12) h += 12
  if (ampm === "AM" && h === 12) h = 0
  target.setHours(h, parseInt(minute), 0, 0)
  if (day === "tomorrow") target.setDate(target.getDate() + 1)
  if (day === "today" && target.getTime() < Date.now()) target.setDate(target.getDate() + 1)
  return target.getTime()
}

function fmtMs(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  })
}

export function TimePickerTwelveHour({ onScheduledMs, initialMs, compact = false }: Props) {
  const init = decompose(initialMs ?? (() => {
    const t = new Date()
    t.setHours(9, 0, 0, 0)
    if (t.getTime() < Date.now()) t.setDate(t.getDate() + 1)
    return t.getTime()
  })())
  const [day, setDay] = useState<DayChoice>(init.day)
  const [hour, setHour] = useState<string>(init.hour)
  const [minute, setMinute] = useState<string>(init.minute)
  const [ampm, setAmPm] = useState<AmPm>(init.ampm)

  const currentMs = compose(day, hour, minute, ampm)

  useEffect(() => {
    onScheduledMs(currentMs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, hour, minute, ampm])

  function applyPreset(ms: number) {
    const d = decompose(ms)
    setDay(d.day); setHour(d.hour); setMinute(d.minute); setAmPm(d.ampm)
  }

  return (
    <div className="space-y-2">
      {/* Quick presets */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => applyPreset(Date.now() + 1 * 60 * 60 * 1000)}
          className="px-2 py-0.5 text-[10px] rounded bg-blue-950/60 border border-blue-800/40 text-blue-300 hover:bg-blue-900/60"
        >
          In 1h
        </button>
        <button
          type="button"
          onClick={() => applyPreset(Date.now() + 3 * 60 * 60 * 1000)}
          className="px-2 py-0.5 text-[10px] rounded bg-blue-950/60 border border-blue-800/40 text-blue-300 hover:bg-blue-900/60"
        >
          In 3h
        </button>
        <button
          type="button"
          onClick={() => {
            const t = new Date(); t.setHours(20, 0, 0, 0)
            if (t.getTime() < Date.now()) t.setDate(t.getDate() + 1)
            applyPreset(t.getTime())
          }}
          className="px-2 py-0.5 text-[10px] rounded bg-blue-950/60 border border-blue-800/40 text-blue-300 hover:bg-blue-900/60"
        >
          Tonight 8pm
        </button>
        <button
          type="button"
          onClick={() => {
            const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0)
            applyPreset(t.getTime())
          }}
          className="px-2 py-0.5 text-[10px] rounded bg-blue-950/60 border border-blue-800/40 text-blue-300 hover:bg-blue-900/60"
        >
          Tomorrow 9am
        </button>
      </div>

      {/* Manual picker */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={day} onChange={(e) => setDay(e.target.value as DayChoice)}
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-sm">
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
        </select>
        <span className="text-gray-500 text-sm">at</span>
        <select value={hour} onChange={(e) => setHour(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-sm w-16">
          {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="text-gray-500 text-sm">:</span>
        <select value={minute} onChange={(e) => setMinute(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-sm w-16">
          {["00", "15", "30", "45"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select value={ampm} onChange={(e) => setAmPm(e.target.value as AmPm)}
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-sm">
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>

      {!compact && (
        <div className="text-[10px] text-gray-600">
          fires at {fmtMs(currentMs)}
        </div>
      )}
    </div>
  )
}
