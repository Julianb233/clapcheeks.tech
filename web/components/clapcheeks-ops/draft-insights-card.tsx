/**
 * AI-10022 — DraftInsightsCard
 *
 * Collapsible "Why this draft?" panel that renders the daemon's draft_insights
 * blob: time gap, callback topics, voice-RAG citations, cadence rule applied,
 * 4-hard-rule ledger, template reasoning. Lives directly under each ready
 * draft in ComposePanel and in the cross-person drafts inbox.
 *
 * Reactive — pulls fresh insights via api.touches.getDraftInsights so it
 * stays in sync as the daemon redrafts after operator feedback.
 */
"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Id } from "@/convex/_generated/dataModel"
import { useState } from "react"

function fmtTimeGap(hours: number | undefined): string | null {
  if (hours === undefined || hours === null) return null
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 24) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} d`
}

function fmtTimestamp(ms: number | undefined): string | null {
  if (!ms) return null
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  })
}

export function DraftInsightsCard({ touch_id }: { touch_id: Id<"scheduled_touches"> }) {
  const data = useQuery(api.touches.getDraftInsights, { touch_id })
  const [open, setOpen] = useState(false)

  if (!data) return null
  const ins = data.draft_insights
  const gap = fmtTimeGap(ins?.time_gap_hours)
  const lastInbound = fmtTimestamp(ins?.last_inbound_at)
  const rag = ins?.rag_citations ?? []
  const callbacks = ins?.callback_topics ?? []
  const rules = ins?.hard_rules_checked
  const hasInsights = ins && (gap || lastInbound || rag.length > 0 || callbacks.length > 0 || rules || ins.template_reasoning)

  if (!hasInsights) {
    return (
      <div className="mt-2 text-[10px] text-gray-600 italic">
        No insights yet — daemon still on legacy drafter.
      </div>
    )
  }

  // Always show the headline summary; expand for full detail.
  const headlineBits: string[] = []
  if (gap) headlineBits.push(`🕐 ${gap} since last`)
  if (callbacks.length > 0) headlineBits.push(`🎯 callback: ${callbacks[0]}`)
  if (rag.length > 0) headlineBits.push(`🎙️ ${rag.length} voice refs`)

  return (
    <div className="mt-2 p-2 bg-gray-900/80 border border-purple-900/40 rounded text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-purple-300 hover:text-purple-200 w-full text-left"
      >
        <span className="text-[10px]">{open ? "▼" : "▶"}</span>
        <span className="text-[10px] uppercase tracking-wider">Why this draft?</span>
        <span className="text-gray-500 text-[10px] flex-1 truncate ml-2">
          {headlineBits.join(" · ")}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 text-[11px]">
          {gap && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20 shrink-0">Time gap</span>
              <span className="text-gray-200">{gap} since last reply</span>
            </div>
          )}
          {lastInbound && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20 shrink-0">Last inbound</span>
              <span className="text-gray-200">{lastInbound}</span>
            </div>
          )}
          {ins?.cadence_rule_applied && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20 shrink-0">Cadence</span>
              <span className="text-gray-200">{ins.cadence_rule_applied}</span>
            </div>
          )}
          {callbacks.length > 0 && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20 shrink-0">Callbacks</span>
              <span className="text-gray-200">{callbacks.join(" · ")}</span>
            </div>
          )}
          {ins?.template_reasoning && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20 shrink-0">Reasoning</span>
              <span className="text-gray-200">{ins.template_reasoning}</span>
            </div>
          )}
          {rag.length > 0 && (
            <div>
              <div className="text-gray-500 mb-1">Voice RAG · {ins?.voice_corpus_used ?? rag.length} retrieved</div>
              <ul className="space-y-0.5 ml-2">
                {rag.slice(0, 5).map((r: { text: string; score: number }, i: number) => (
                  <li key={i} className="text-gray-400 truncate">
                    <span className="text-purple-400 mr-1">{r.score.toFixed(2)}</span>
                    {r.text.slice(0, 90)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rules && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20 shrink-0">Hard rules</span>
              <span className="flex gap-2">
                <span className={rules.callback ? "text-emerald-400" : "text-red-400"}>
                  {rules.callback ? "✓" : "✗"} callback
                </span>
                <span className={rules.emotion_match ? "text-emerald-400" : "text-red-400"}>
                  {rules.emotion_match ? "✓" : "✗"} emotion
                </span>
                <span className={rules.specific_question ? "text-emerald-400" : "text-red-400"}>
                  {rules.specific_question ? "✓" : "✗"} question
                </span>
                <span className={rules.no_pivot_to_julian ? "text-emerald-400" : "text-red-400"}>
                  {rules.no_pivot_to_julian ? "✓" : "✗"} no-pivot
                </span>
              </span>
            </div>
          )}
          {data.operator_feedback && (
            <div className="flex gap-2 pt-1 border-t border-gray-800">
              <span className="text-amber-400 w-20 shrink-0">Feedback</span>
              <span className="text-amber-200 italic">"{data.operator_feedback}"</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
