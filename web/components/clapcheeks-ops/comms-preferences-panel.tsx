/**
 * CommsPreferencesPanel — single source of truth for a person's communication
 * preferences. Used in:
 *   - The dossier page (replaces the scattered cadence/whitelist/active_hours
 *     widgets formerly spread across the operator panel + facts sidebar)
 *   - The /messages live dashboard right rail
 *
 * Reads + writes via Convex `people.patchPerson` so every edit is reactive
 * everywhere the dashboard renders this person.
 */
"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Id } from "@/convex/_generated/dataModel"
import { useState, useEffect } from "react"

const CADENCES = [
  { value: "hot", label: "Hot", hint: "reply 5-30m" },
  { value: "warm", label: "Warm", hint: "reply 1-4h" },
  { value: "slow_burn", label: "Slow burn", hint: "1/day" },
  { value: "nurture", label: "Nurture", hint: "2-3/week" },
  { value: "dormant", label: "Dormant", hint: "1/month" },
] as const

const NURTURE_STATES = [
  { value: "active_pursuit", label: "Active pursuit", hint: "chase, fast cadence, willing to invest" },
  { value: "steady", label: "Steady", hint: "consistent, not aggressive" },
  { value: "nurture", label: "Nurture", hint: "light keep-warm" },
  { value: "dormant", label: "Dormant", hint: "re-awaken occasionally" },
  { value: "close", label: "Close", hint: "wind down, stop sending" },
] as const

const FOLLOWUP_KINDS = [
  "reply", "nudge", "date_ask", "pattern_interrupt", "event_followup", "none",
] as const

const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
]

type Person = any

export function CommsPreferencesPanel({ person, compact = false }: { person: Person; compact?: boolean }) {
  const patch = useMutation(api.people.patchPerson)
  const [saving, setSaving] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  async function save(field: string, value: any) {
    if (!person?._id) return
    setSaving(field)
    try {
      await patch({ person_id: person._id as Id<"people">, [field]: value } as any)
      setSavedAt(Date.now())
    } finally {
      setTimeout(() => setSaving(null), 300)
    }
  }

  const tz = person?.active_hours_local?.tz ?? "America/Los_Angeles"
  const startHour = person?.active_hours_local?.start_hour ?? 9
  const endHour = person?.active_hours_local?.end_hour ?? 22

  const responseRate = typeof person?.response_rate === "number" ? person.response_rate : null
  const avgRespMin = typeof person?.avg_response_time_minutes === "number" ? person.avg_response_time_minutes : null

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-lg ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-gray-200">Communication preferences</div>
          {!compact && person?.display_name && (
            <div className="text-xs text-gray-500">{person.display_name}</div>
          )}
        </div>
        <SaveBadge saving={saving} savedAt={savedAt} />
      </div>

      {/* Whitelist toggle — biggest, most honest control */}
      <label className={`flex items-center justify-between gap-3 px-3 py-2 rounded border cursor-pointer mb-3 ${
        person?.whitelist_for_autoreply
          ? "border-green-700/60 bg-green-950/30"
          : "border-red-800/60 bg-red-950/20"
      }`}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            {person?.whitelist_for_autoreply ? "Auto-reply ON" : "Auto-reply OFF"}
          </div>
          <div className="text-[11px] text-gray-500">
            {person?.whitelist_for_autoreply
              ? "AI may draft + send within active hours"
              : "drafts only, no auto-send"}
          </div>
        </div>
        <input
          type="checkbox"
          className="w-5 h-5"
          checked={person?.whitelist_for_autoreply ?? false}
          onChange={(e) => save("whitelist_for_autoreply", e.target.checked)}
          disabled={saving === "whitelist_for_autoreply"}
        />
      </label>

      {/* Cadence */}
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Cadence</div>
        <div className="grid grid-cols-5 gap-1">
          {CADENCES.map((c) => (
            <button
              key={c.value}
              onClick={() => save("cadence_profile", c.value)}
              disabled={saving === "cadence_profile"}
              className={`text-[11px] py-1.5 rounded border ${
                person?.cadence_profile === c.value
                  ? "border-purple-500 bg-purple-900/40 text-purple-100"
                  : "border-gray-800 bg-gray-950 text-gray-400 hover:border-gray-600"
              }`}
              title={c.hint}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active hours band */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs uppercase tracking-wide text-gray-500">Active hours</div>
          <div className="text-[11px] text-gray-500">{tz.split("/").pop()?.replace("_", " ")}</div>
        </div>
        <ActiveHoursBand startHour={startHour} endHour={endHour} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          <select
            value={tz}
            onChange={(e) => save("active_hours_local", { tz: e.target.value, start_hour: startHour, end_hour: endHour })}
            disabled={saving === "active_hours_local"}
            className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
          >
            {COMMON_TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <HourSelect
            label="from"
            value={startHour}
            onChange={(h) => save("active_hours_local", { tz, start_hour: h, end_hour: endHour })}
            disabled={saving === "active_hours_local"}
          />
          <HourSelect
            label="to"
            value={endHour}
            onChange={(h) => save("active_hours_local", { tz, start_hour: startHour, end_hour: h })}
            disabled={saving === "active_hours_local"}
          />
        </div>
      </div>

      {/* Nurture state — radio-style */}
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Pursuit posture</div>
        <div className="grid grid-cols-5 gap-1">
          {NURTURE_STATES.map((n) => (
            <button
              key={n.value}
              onClick={() => save("nurture_state", n.value)}
              disabled={saving === "nurture_state"}
              className={`text-[11px] py-1.5 rounded border ${
                person?.nurture_state === n.value
                  ? "border-pink-500 bg-pink-900/40 text-pink-100"
                  : "border-gray-800 bg-gray-950 text-gray-400 hover:border-gray-600"
              }`}
              title={n.hint}
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>

      {/* Next followup kind */}
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Next followup kind</div>
        <select
          value={person?.next_followup_kind ?? "reply"}
          onChange={(e) => save("next_followup_kind", e.target.value)}
          disabled={saving === "next_followup_kind"}
          className="bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs w-full"
        >
          {FOLLOWUP_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      {/* AI-9645 — Dev-mode bypass for over-pursue protection. ONLY visible on
          rows already flagged as dev tests OR explicitly toggled here. Hidden
          from the casual operator flow so it doesn't get misused on real
          prospects. */}
      <details className="mb-3">
        <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">
          🧪 dev test settings (advanced)
        </summary>
        <label className={`mt-2 flex items-center justify-between gap-3 px-3 py-2 rounded border cursor-pointer ${
          person?.dev_mode_bypass_overpursue
            ? "border-amber-700/60 bg-amber-950/30"
            : "border-gray-800 bg-gray-950/40"
        }`}>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium">
              {person?.dev_mode_bypass_overpursue ? "🧪 Dev test target — over-pursue bypassed" : "Dev test target (bypass over-pursue)"}
            </div>
            <div className="text-[10px] text-gray-500">
              When ON, cadence-runner will NOT auto-flip whitelist=false on 3+ unanswered outbounds. Use ONLY on rows you control for testing the send pipeline. Never on real prospects.
            </div>
          </div>
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={person?.dev_mode_bypass_overpursue ?? false}
            onChange={(e) => save("dev_mode_bypass_overpursue", e.target.checked)}
            disabled={saving === "dev_mode_bypass_overpursue"}
          />
        </label>
      </details>

      {/* Insights strip */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Insight
          label="Response rate"
          value={responseRate !== null ? `${Math.round(responseRate * 100)}%` : "—"}
          hint="fraction of your outbound that gets a reply"
        />
        <Insight
          label="Avg reply time"
          value={avgRespMin !== null ? formatMinutes(avgRespMin) : "—"}
          hint="median time she takes to respond"
        />
        <Insight
          label="Question ratio 7d"
          value={typeof person?.her_question_ratio_7d === "number"
            ? `${Math.round(person.her_question_ratio_7d * 100)}%` : "—"}
          hint="how often she asks something back; <15% = quiet thread"
        />
        <Insight
          label="Time-to-ask"
          value={typeof person?.time_to_ask_score === "number"
            ? person.time_to_ask_score.toFixed(2) : "—"}
          hint="0-1 model score; >0.7 means propose a date"
        />
      </div>
    </div>
  )
}

function ActiveHoursBand({ startHour, endHour }: { startHour: number; endHour: number }) {
  const cells = Array.from({ length: 24 }, (_, h) => h)
  // wrap-around windows (e.g. 22 -> 4) handled by checking either side
  const isActive = (h: number) =>
    startHour <= endHour ? (h >= startHour && h < endHour) : (h >= startHour || h < endHour)

  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const currentHour = now.getHours()

  return (
    <div className="flex h-5 w-full overflow-hidden rounded border border-gray-800">
      {cells.map((h) => (
        <div
          key={h}
          className={`flex-1 border-r border-gray-900 last:border-r-0 ${
            isActive(h) ? "bg-emerald-700/70" : "bg-gray-950"
          } ${currentHour === h ? "ring-2 ring-amber-400 ring-inset" : ""}`}
          title={`${h.toString().padStart(2, "0")}:00${isActive(h) ? " (active)" : ""}${currentHour === h ? " ← now (your tz)" : ""}`}
        />
      ))}
    </div>
  )
}

function HourSelect({
  label, value, onChange, disabled,
}: { label: string; value: number; onChange: (h: number) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-500">
      <span className="w-8">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1"
      >
        {Array.from({ length: 24 }, (_, h) => h).map((h) => (
          <option key={h} value={h}>{h.toString().padStart(2, "0")}:00</option>
        ))}
      </select>
    </label>
  )
}

function SaveBadge({ saving, savedAt }: { saving: string | null; savedAt: number | null }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!savedAt) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [savedAt])
  if (saving) {
    return <span className="text-[11px] text-amber-400">saving...</span>
  }
  if (!savedAt) {
    return <span className="text-[11px] text-gray-600">unsaved edits not lost; everything autosaves</span>
  }
  const secs = Math.max(1, Math.round((Date.now() - savedAt) / 1000))
  void tick
  return <span className="text-[11px] text-emerald-500">saved {secs}s ago</span>
}

function Insight({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-950 px-2 py-1.5" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-200">{value}</div>
    </div>
  )
}

function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)}m`
  if (m < 60 * 24) return `${(m / 60).toFixed(1)}h`
  return `${(m / 60 / 24).toFixed(1)}d`
}
