/**
 * Voice training page — operator picks the option that sounds most like Julian
 * for each scenario, plus optional write-in. Saves to voice_profiles.boosted_samples
 * which the Mac daemon's _load_julian_examples reads as voice exemplars.
 */
"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

const FLEET_USER_ID = "fleet-julian"
const SHEET_VERSION = "v1"

type Option = { letter: string; text: string; abstain?: boolean }
type Scenario = {
  id: string
  label: string
  context: string
  options: Option[]
}

const SCENARIOS: Scenario[] = [
  {
    id: "1",
    label: "HINGE OPENER",
    context: "Her prompt: best margaritas in SD",
    options: [
      { letter: "A", text: "Putting my money on the margarita lie — proof or I'm taking #3" },
      { letter: "B", text: "30 countries is impressive — where was your favorite" },
      { letter: "C", text: "If margaritas is the lie that's our first date" },
      { letter: "D", text: "Going with #1 — round numbers always sus" },
    ],
  },
  {
    id: "2",
    label: "SHE REPLIED 'HAHA THANKS'",
    context: "Keep it alive without sounding thirsty",
    options: [
      { letter: "A", text: "So what'd you get up to this week" },
      { letter: "B", text: "Tell me something nobody knows about you" },
      { letter: "C", text: "What are you doing tonight" },
      { letter: "D", text: "Plan-everything person or see-what-happens person" },
    ],
  },
  {
    id: "3",
    label: "ASKING HER OUT",
    context: "First meet proposal",
    options: [
      { letter: "A", text: "Drinks Thursday? I know a place" },
      { letter: "B", text: "We should grab a drink sometime" },
      { letter: "C", text: "I'm in [neighborhood] Thursday — quick drink?" },
      { letter: "D", text: "Let's actually do this. Thursday or Friday" },
    ],
  },
  {
    id: "4",
    label: "DAY-OF CONFIRMATION",
    context: "Confirming a date that's tonight",
    options: [
      { letter: "A", text: "Still on for tonight?" },
      { letter: "B", text: "7pm at [bar] — see you there" },
      { letter: "C", text: "Tonight's still happening right" },
      { letter: "D", text: "Excited for tonight. 7pm still" },
    ],
  },
  {
    id: "5",
    label: "NEXT-MORNING FOLLOW UP",
    context: "Morning after the first date",
    options: [
      { letter: "A", text: "Last night was fun" },
      { letter: "B", text: "Last night was fun. Round 2?" },
      { letter: "C", text: "Hope you got home okay. That was fun" },
      { letter: "D", text: "Just realized I forgot to hate you for [callback]. Round 2?" },
    ],
  },
  {
    id: "6",
    label: "SHE GHOSTED 3 DAYS",
    context: "Re-engaging after silence",
    options: [
      { letter: "A", text: "Hey stranger you alive" },
      { letter: "B", text: "Did I lose you to a more interesting man or just life" },
      { letter: "C", text: "You ghosting me already" },
      { letter: "D", text: "[don't message — wait for her]", abstain: true },
      { letter: "E", text: "Callback to date — how'd [thing] go" },
    ],
  },
  {
    id: "7",
    label: "FLIRTY ESCALATION",
    context: "Conversation has been good — turn up the heat",
    options: [
      { letter: "A", text: "You're trouble" },
      { letter: "B", text: "I shouldn't be liking this as much as I am" },
      { letter: "C", text: "Careful — I'm not great at staying friends" },
      { letter: "D", text: "Tell me something you definitely shouldn't tell me yet" },
    ],
  },
  {
    id: "8",
    label: "SHE CANCELLED LAST MINUTE",
    context: "Recover without losing power",
    options: [
      { letter: "A", text: "No worries — let's reschedule" },
      { letter: "B", text: "All good. Let me know when you're free" },
      { letter: "C", text: "Lol fine. You owe me though" },
      { letter: "D", text: "Got it. Hit me up when life's less chaotic" },
    ],
  },
  {
    id: "9",
    label: "PHONE NUMBER SWAP",
    context: "Moving from app to texting",
    options: [
      { letter: "A", text: "We should take this off here. What's your number" },
      { letter: "B", text: "Way easier on text — [number]" },
      { letter: "C", text: "Tired of opening this app. Number?" },
      { letter: "D", text: "[don't ask — wait for her]", abstain: true },
    ],
  },
  {
    id: "10",
    label: "FIRST CALL INVITE",
    context: "Suggesting a phone/voice call before meeting",
    options: [
      { letter: "A", text: "Free for a quick call tonight?" },
      { letter: "B", text: "I want to hear your voice. 10 min tonight?" },
      { letter: "C", text: "We should jump on a call before we meet — saves us the awkward" },
      { letter: "D", text: "Phone call > more texting. Tonight or tomorrow?" },
    ],
  },
]

type PickState = {
  pick: string | null
  note: string
  write_in: string
}

export default function VoiceTrainingPage() {
  const saved = useQuery(api.voice.getTrainingPicks, { user_id: FLEET_USER_ID })
  const save = useMutation(api.voice.saveTrainingPicks)

  const [picks, setPicks] = useState<Record<string, PickState>>(() =>
    Object.fromEntries(SCENARIOS.map((s) => [s.id, { pick: null, note: "", write_in: "" }]))
  )
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string>("")

  // Hydrate from previous save
  useEffect(() => {
    if (!saved?.boosted_samples?.length) return
    setPicks((prev) => {
      const next = { ...prev }
      for (const s of saved.boosted_samples as any[]) {
        if (!s?.scenario) continue
        if (!next[s.scenario]) continue
        if (s.source === "write_in") {
          next[s.scenario] = { ...next[s.scenario], write_in: s.text || "", note: s.note || "" }
        } else {
          next[s.scenario] = {
            pick: s.pick || null,
            note: s.note || "",
            write_in: next[s.scenario].write_in,
          }
        }
      }
      return next
    })
  }, [saved?.updated_at])

  const completed = useMemo(
    () => Object.values(picks).filter((p) => p.pick || p.write_in.trim()).length,
    [picks]
  )

  function setPick(id: string, letter: string) {
    setPicks((prev) => ({ ...prev, [id]: { ...prev[id], pick: letter } }))
  }
  function setNote(id: string, note: string) {
    setPicks((prev) => ({ ...prev, [id]: { ...prev[id], note } }))
  }
  function setWriteIn(id: string, write_in: string) {
    setPicks((prev) => ({ ...prev, [id]: { ...prev[id], write_in } }))
  }
  function clearPick(id: string) {
    setPicks((prev) => ({ ...prev, [id]: { pick: null, note: "", write_in: "" } }))
  }

  async function onSave() {
    setStatus("saving")
    setErrorMsg("")
    try {
      const payload = SCENARIOS.flatMap((s) => {
        const state = picks[s.id]
        const out: any[] = []
        if (state.pick) {
          const opt = s.options.find((o) => o.letter === state.pick)
          if (opt && !opt.abstain) {
            out.push({
              scenario: s.id,
              label: s.label,
              context: s.context,
              pick: state.pick,
              text: opt.text,
              note: state.note || undefined,
            })
          }
        }
        if (state.write_in.trim()) {
          out.push({
            scenario: s.id,
            label: s.label,
            context: s.context,
            write_in: state.write_in.trim(),
          })
        }
        return out
      })
      const res = await save({ user_id: FLEET_USER_ID, picks: payload, sheet_version: SHEET_VERSION })
      if (res?.ok) {
        setStatus("saved")
        setTimeout(() => setStatus("idle"), 3000)
      } else {
        throw new Error("save returned not-ok")
      }
    } catch (e: any) {
      setStatus("error")
      setErrorMsg(e?.message || "save failed")
    }
  }

  return (
    <div className="p-6 sm:p-8 max-w-3xl mx-auto pb-32">
      <header className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Voice Training</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          For each scenario, tap the option that sounds most like you. Add a note ("B but no '?' at end") or
          a write-in if none fit. Saves drive what the AI mimics when drafting your replies.
        </p>
        <div className="mt-3 flex gap-2 items-center text-xs">
          <span className="px-2 py-1 rounded bg-gray-800 text-gray-300">
            {completed}/{SCENARIOS.length} answered
          </span>
          {saved?.updated_at && (
            <span className="text-gray-500">
              Last saved {new Date(saved.updated_at).toLocaleString()}
            </span>
          )}
        </div>
      </header>

      <div className="space-y-5">
        {SCENARIOS.map((s) => {
          const state = picks[s.id]
          return (
            <section key={s.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-base font-semibold text-purple-300">
                  {s.id}. {s.label}
                </h2>
                {(state.pick || state.write_in) && (
                  <button
                    onClick={() => clearPick(s.id)}
                    className="text-xs text-gray-500 hover:text-red-400"
                  >
                    clear
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-3">{s.context}</p>

              <div className="space-y-2">
                {s.options.map((opt) => {
                  const selected = state.pick === opt.letter
                  return (
                    <button
                      key={opt.letter}
                      onClick={() => setPick(s.id, opt.letter)}
                      className={`w-full text-left px-3 py-3 rounded-md border transition-colors min-h-[52px] ${
                        selected
                          ? "bg-purple-900/40 border-purple-500 text-white"
                          : "bg-gray-800/40 border-gray-700 text-gray-200 hover:border-gray-500"
                      }`}
                    >
                      <span className="font-mono text-xs text-purple-400 mr-2">{opt.letter})</span>
                      <span className={opt.abstain ? "italic text-gray-400" : ""}>{opt.text}</span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  value={state.note}
                  onChange={(e) => setNote(s.id, e.target.value)}
                  placeholder="tone note (e.g. 'B but no ? at end')"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500"
                />
                <textarea
                  value={state.write_in}
                  onChange={(e) => setWriteIn(s.id, e.target.value)}
                  placeholder="or write your own version…"
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 resize-y"
                />
              </div>
            </section>
          )
        })}
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-950/95 backdrop-blur border-t border-gray-800 p-4 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            {status === "saved" && <span className="text-emerald-400">✓ Saved to Convex</span>}
            {status === "saving" && <span>Saving…</span>}
            {status === "error" && <span className="text-red-400">Error: {errorMsg}</span>}
            {status === "idle" && <span>{completed} answers ready</span>}
          </div>
          <button
            onClick={onSave}
            disabled={status === "saving" || completed === 0}
            className="px-5 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-md min-h-[44px]"
          >
            {status === "saving" ? "Saving…" : "Save picks"}
          </button>
        </div>
      </div>
    </div>
  )
}
