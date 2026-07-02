/**
 * AI-10022 — Cross-person drafts inbox.
 *
 * One page showing ALL pending preview drafts across every person, newest
 * first. Same approve / edit / feedback / schedule flow as the per-person
 * ComposePanel. Saves Julian from navigating person-by-person.
 *
 * Reactive — uses api.touches.listAllPreviews so new drafts surface the
 * moment Mac Mini finishes generating them.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState, useEffect } from "react"
import Link from "next/link"
import { DraftInsightsCard } from "@/components/clapcheeks-ops/draft-insights-card"
import { EditDiffStrip } from "@/components/clapcheeks-ops/edit-diff-strip"
import { ConfirmModal } from "@/components/clapcheeks-ops/confirm-modal"
import { TimePickerTwelveHour } from "@/components/clapcheeks-ops/time-picker-twelve-hour"

const FLEET_USER_ID = "fleet-julian"

const FEEDBACK_CHIPS: { label: string; feedback: string }[] = [
  { label: "more casual", feedback: "make it more casual and conversational" },
  { label: "more flirty", feedback: "make it more flirty, less buttoned-up" },
  { label: "shorter", feedback: "make it ~half the length, one sentence if possible" },
  { label: "ask about her work", feedback: "ask a specific question about her work or what she's been working on" },
  { label: "add date proposal", feedback: "propose a specific time/place to meet up" },
  { label: "less try-hard", feedback: "make it less try-hard, more relaxed energy" },
]

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  })
}

export default function DraftsInboxPage() {
  const rows = useQuery(api.touches.listAllPreviews, { user_id: FLEET_USER_ID, limit: 50 })
  const commitPreview = useMutation(api.touches.commitPreview)
  const cancelOne = useMutation(api.touches.cancelOne)
  const regenerateWithFeedback = useMutation(api.touches.regenerateWithFeedback)

  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({})
  const [feedbackTexts, setFeedbackTexts] = useState<Record<string, string>>({})
  const [scheduledMs, setScheduledMs] = useState<Record<string, number>>({})
  // AI-10022 followup — per-draft disclosure toggles. Feedback + schedule
  // sections collapse by default so the inbox stays scannable.
  const [feedbackOpen, setFeedbackOpen] = useState<Record<string, boolean>>({})
  const [scheduleOpen, setScheduleOpen] = useState<Record<string, boolean>>({})
  const [modal, setModal] = useState<{
    kind: "send" | "schedule" | null
    touch_id?: any
    body?: string
    whenMs?: number
    personName?: string
  }>({ kind: null })

  // Live heartbeat
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const ready = (rows ?? []).filter((r: any) => r.touch.draft_body)
  const drafting = (rows ?? []).filter((r: any) => !r.touch.draft_body)

  function askSend(touch_id: any, body: string, personName: string) {
    if (!body.trim()) return
    setModal({ kind: "send", touch_id, body, personName })
  }

  function askSchedule(touch_id: any, body: string, personName: string) {
    if (!body.trim()) return
    setModal({ kind: "schedule", touch_id, body, personName, whenMs: scheduledMs[touch_id] ?? Date.now() + 60 * 60 * 1000 })
  }

  async function confirmModal() {
    if (!modal.kind || !modal.touch_id || !modal.body) return
    const when = modal.kind === "send" ? Date.now() : (modal.whenMs ?? Date.now())
    setModal({ kind: null })
    await commitPreview({ touch_id: modal.touch_id, edited_body: modal.body, scheduled_for_ms: when })
  }

  async function applyFeedback(touch_id: any, feedback: string) {
    if (!feedback.trim()) return
    await regenerateWithFeedback({ touch_id, feedback_text: feedback.trim() })
    setFeedbackTexts((prev) => ({ ...prev, [touch_id]: "" }))
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-semibold">Drafts inbox</h1>
        <span className="text-[10px] text-gray-600">live · {ready.length} ready · {drafting.length} drafting</span>
      </div>
      <p className="text-xs text-gray-500 mb-6">
        Every pending AI draft across all people. Approve, edit, give feedback, or schedule.
        Same controls as the per-person panel — just batched. Reactive subscription, no refresh needed.
      </p>

      {rows === undefined && <div className="text-gray-600 text-sm">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="text-gray-600 text-sm">
          No pending drafts. Trigger one from a person's dossier
          (<Link href="/admin/clapcheeks-ops/network" className="text-purple-400 hover:text-purple-300">network</Link>),
          or wait for the Mac Mini cadence runner to schedule the next sweep.
        </div>
      )}

      {drafting.length > 0 && (
        <div className="mb-6 p-3 bg-gray-950 border border-gray-800 rounded">
          <div className="text-xs text-amber-300 mb-2">⏳ Drafting on Mac Mini ({drafting.length})</div>
          <ul className="text-xs text-gray-500 space-y-1">
            {drafting.map((r: any) => (
              <li key={r.touch._id} className="flex gap-2 items-center">
                <Link href={`/admin/clapcheeks-ops/people/${r.person_id}`}
                      className="text-purple-300 hover:text-purple-200">
                  {r.person_display_name}
                </Link>
                <span className="text-gray-700">·</span>
                <span>{r.touch.prompt_template ?? r.touch.type}</span>
                <button onClick={() => cancelOne({ touch_id: r.touch._id, reason: "manual_drafts_inbox_discard" })}
                        className="text-red-400 hover:text-red-300 text-[10px] ml-auto">discard</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready.map((r: any) => {
        const p = r.touch
        const body = editedBodies[p._id] ?? p.draft_body ?? ""
        const original = p.draft_original ?? p.draft_body ?? ""
        const updatedAgoSec = p.updated_at ? Math.max(0, Math.floor((Date.now() - p.updated_at) / 1000)) : null
        return (
          <div key={p._id} className="mb-4 bg-gray-900 border border-purple-800/40 rounded-lg p-4">
            <div className="flex items-baseline justify-between mb-2">
              <div className="flex items-center gap-2">
                <Link href={`/admin/clapcheeks-ops/people/${r.person_id}`}
                      className="text-base font-semibold text-purple-300 hover:text-purple-200">
                  {r.person_display_name}
                </Link>
                <span className="text-xs text-gray-500">·</span>
                <span className="text-xs text-gray-500">{p.prompt_template ?? p.type}</span>
              </div>
              {updatedAgoSec !== null && (
                <span className="text-[10px] text-gray-600">
                  {updatedAgoSec < 60 ? `${updatedAgoSec}s` : `${Math.floor(updatedAgoSec / 60)}m`} ago
                </span>
              )}
            </div>

            <DraftInsightsCard touch_id={p._id} />

            <textarea
              value={body}
              onChange={(e) => setEditedBodies((prev) => ({ ...prev, [p._id]: e.target.value }))}
              className="mt-2 w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-gray-200 min-h-[80px]"
            />
            <div className="flex justify-between items-center mt-1">
              <span className="text-[10px] text-gray-600">{body.length} chars</span>
            </div>

            <EditDiffStrip original={original} edited={body} />

            <div className="flex gap-2 mt-3">
              <button onClick={() => askSend(p._id, body, r.person_display_name)}
                      className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-1 rounded text-sm">
                Send now
              </button>
              <button onClick={() => cancelOne({ touch_id: p._id, reason: "manual_drafts_inbox_discard" })}
                      className="bg-gray-800 hover:bg-red-700 text-gray-300 px-3 py-1 rounded text-sm">
                Discard
              </button>
              <button
                onClick={() => setFeedbackOpen((s) => ({ ...s, [p._id]: !s[p._id] }))}
                className="ml-auto text-[11px] text-amber-300 hover:text-amber-200"
              >
                {feedbackOpen[p._id] ? "▼" : "▶"} feedback
              </button>
              <button
                onClick={() => setScheduleOpen((s) => ({ ...s, [p._id]: !s[p._id] }))}
                className="text-[11px] text-blue-300 hover:text-blue-200"
              >
                {scheduleOpen[p._id] ? "▼" : "▶"} schedule
              </button>
            </div>

            {feedbackOpen[p._id] && (
              <div className="mt-3 p-2 bg-gray-950 border border-amber-900/40 rounded">
                <div className="text-[10px] text-amber-300 mb-2 uppercase tracking-wider">
                  Don't like it? Tell the AI why
                </div>
                <div className="flex gap-1 mb-2">
                  <input
                    type="text"
                    value={feedbackTexts[p._id] ?? ""}
                    onChange={(e) => setFeedbackTexts((prev) => ({ ...prev, [p._id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyFeedback(p._id, feedbackTexts[p._id] ?? "")
                    }}
                    placeholder="Try again with feedback… (e.g. 'more flirty')"
                    className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600"
                  />
                  <button
                    onClick={() => applyFeedback(p._id, feedbackTexts[p._id] ?? "")}
                    disabled={!feedbackTexts[p._id]?.trim()}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white px-3 py-1 rounded text-xs"
                  >
                    Regenerate
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {FEEDBACK_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      onClick={() => applyFeedback(p._id, chip.feedback)}
                      className="px-2 py-0.5 text-[10px] rounded bg-amber-950/60 border border-amber-800/40 text-amber-300 hover:bg-amber-900/60"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {scheduleOpen[p._id] && (
              <div className="mt-3 p-3 bg-gray-950 border border-blue-800/40 rounded">
                <div className="text-xs text-blue-300 mb-2">📅 Schedule for later</div>
                <TimePickerTwelveHour
                  onScheduledMs={(ms) => setScheduledMs((prev) => ({ ...prev, [p._id]: ms }))}
                  initialMs={scheduledMs[p._id]}
                />
                <div className="mt-2">
                  <button onClick={() => askSchedule(p._id, body, r.person_display_name)}
                          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1 rounded text-sm">
                    Schedule send
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <ConfirmModal
        open={modal.kind === "send"}
        title={`Send now to ${modal.personName ?? "(unknown)"}?`}
        body={modal.body ?? ""}
        confirmLabel="Send"
        onConfirm={confirmModal}
        onCancel={() => setModal({ kind: null })}
      />
      <ConfirmModal
        open={modal.kind === "schedule"}
        title={`Schedule send to ${modal.personName ?? "(unknown)"}?`}
        body={modal.body ?? ""}
        scheduledFor={modal.whenMs ? fmtTime(modal.whenMs) : undefined}
        confirmLabel="Schedule"
        onConfirm={confirmModal}
        onCancel={() => setModal({ kind: null })}
      />
    </div>
  )
}
