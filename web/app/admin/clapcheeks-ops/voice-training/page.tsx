/**
 * Voice training page — operator picks the option that sounds most like Julian
 * for each turn in a courtship path, plus dedicated Compliments section.
 * Saves to voice_profiles.boosted_samples which the Mac daemon's
 * _load_julian_examples reads as voice exemplars.
 */
"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

const FLEET_USER_ID = "fleet-julian"
const SHEET_VERSION = "v2"

type Option = { letter: string; text: string; abstain?: boolean }
type Turn = {
  id: string
  label: string
  her_message?: string
  context_note?: string
  options: Option[]
}
type Path = {
  id: string
  title: string
  blurb: string
  turns: Turn[]
}

const PATHS: Path[] = [
  {
    id: "1",
    title: "HINGE MATCH → FIRST DATE",
    blurb: "Full arc: opener through morning-after follow-up. Pick how YOU'd handle each turn.",
    turns: [
      {
        id: "1.1",
        label: "Opener",
        context_note: "Her Hinge prompt: 'best margaritas in San Diego'",
        options: [
          { letter: "A", text: "Putting my money on the margarita lie — proof or I'm taking #3" },
          { letter: "B", text: "30 countries is impressive — where was your favorite" },
          { letter: "C", text: "If margaritas is the lie that's our first date" },
          { letter: "D", text: "Going with #1 — round numbers always sus" },
        ],
      },
      {
        id: "1.2",
        label: "She replied short",
        her_message: "haha thanks 😊",
        options: [
          { letter: "A", text: "So what'd you get up to this week" },
          { letter: "B", text: "Tell me something nobody knows about you" },
          { letter: "C", text: "What are you doing tonight" },
          { letter: "D", text: "Plan-everything person or see-what-happens person" },
        ],
      },
      {
        id: "1.3",
        label: "She opened up",
        her_message: "honestly just got back from a solo trip to Bali — needed to reset",
        context_note: "She's giving you something real. Match her depth without making it heavy.",
        options: [
          { letter: "A", text: "Solo Bali is a power move. What did you actually go to find" },
          { letter: "B", text: "Damn that's awesome. How was it" },
          { letter: "C", text: "Reset from what — work or something heavier" },
          { letter: "D", text: "I respect anyone who solo travels. What surprised you most" },
        ],
      },
      {
        id: "1.4",
        label: "Asking her out",
        context_note: "Conversation has been good. Time to make a move (3-5 days in).",
        options: [
          { letter: "A", text: "Drinks Thursday? I know a place" },
          { letter: "B", text: "We should grab a drink sometime" },
          { letter: "C", text: "I'm in [neighborhood] Thursday — quick drink?" },
          { letter: "D", text: "Let's actually do this. Thursday or Friday" },
        ],
      },
      {
        id: "1.5",
        label: "Day-of confirmation",
        her_message: "(she said yes the day before)",
        options: [
          { letter: "A", text: "Still on for tonight?" },
          { letter: "B", text: "7pm at [bar] — see you there" },
          { letter: "C", text: "Tonight's still happening right" },
          { letter: "D", text: "Excited for tonight. 7pm still" },
        ],
      },
      {
        id: "1.6",
        label: "Morning after the date",
        context_note: "Date went well. First text the next morning.",
        options: [
          { letter: "A", text: "Last night was fun" },
          { letter: "B", text: "Last night was fun. Round 2?" },
          { letter: "C", text: "Hope you got home okay. That was fun" },
          { letter: "D", text: "Just realized I forgot to hate you for [callback]. Round 2?" },
        ],
      },
    ],
  },
  {
    id: "2",
    title: "SHE WENT COLD",
    blurb: "Recovery path when she stops responding mid-conversation.",
    turns: [
      {
        id: "2.1",
        label: "3 days silent — re-engage",
        her_message: "(your last message went unread for 3 days)",
        options: [
          { letter: "A", text: "Hey stranger you alive" },
          { letter: "B", text: "Did I lose you to a more interesting man or just life" },
          { letter: "C", text: "You ghosting me already" },
          { letter: "D", text: "[don't message — wait for her]", abstain: true },
          { letter: "E", text: "Callback to last topic — how'd [thing] go" },
        ],
      },
      {
        id: "2.2",
        label: "She replied lazy",
        her_message: "haha sorry just seeing this — life's been crazy 😅",
        context_note: "Don't accept the brush-off but don't punish her either.",
        options: [
          { letter: "A", text: "All good. Crazy how" },
          { letter: "B", text: "Lol welcome back. Tell me what's going on" },
          { letter: "C", text: "I'll allow it. So when are we actually meeting" },
          { letter: "D", text: "No worries — let me know when you surface" },
        ],
      },
      {
        id: "2.3",
        label: "Re-anchor with a hook",
        context_note: "She's back but lukewarm. Pull her into a real conversation.",
        options: [
          { letter: "A", text: "Quick question — [specific callback to her interest]" },
          { letter: "B", text: "Random but I just saw [thing relevant to her] and thought of you" },
          { letter: "C", text: "Coffee or drink this week — easier than texting" },
          { letter: "D", text: "What's actually going on with you. Real answer" },
        ],
      },
    ],
  },
  {
    id: "3",
    title: "SHE CANCELLED THE DATE",
    blurb: "Recover without losing power, lock in the reschedule.",
    turns: [
      {
        id: "3.1",
        label: "She cancelled 2 hours before",
        her_message: "ugh I'm so sorry, something came up — can we reschedule? 🥺",
        options: [
          { letter: "A", text: "No worries — let's reschedule" },
          { letter: "B", text: "All good. Let me know when you're free" },
          { letter: "C", text: "Lol fine. You owe me though" },
          { letter: "D", text: "Got it. Hit me up when life's less chaotic" },
        ],
      },
      {
        id: "3.2",
        label: "Pinning down a new date",
        her_message: "yes! thank you. Saturday maybe?",
        context_note: "Don't let it stay vague. Lock the time.",
        options: [
          { letter: "A", text: "Saturday works. 7pm same place?" },
          { letter: "B", text: "Saturday it is. Pick a time and I'll be there" },
          { letter: "C", text: "Done. Sat 7pm at [bar]" },
          { letter: "D", text: "Sat works. What's good for you" },
        ],
      },
    ],
  },
  {
    id: "4",
    title: "PHONE SWAP → FIRST CALL",
    blurb: "Move her off the app and onto a phone call before the date.",
    turns: [
      {
        id: "4.1",
        label: "Ask for her number",
        context_note: "Conversation is rolling. Move it off the app.",
        options: [
          { letter: "A", text: "We should take this off here. What's your number" },
          { letter: "B", text: "Way easier on text — [your number]" },
          { letter: "C", text: "Tired of opening this app. Number?" },
          { letter: "D", text: "[don't ask — wait for her]", abstain: true },
        ],
      },
      {
        id: "4.2",
        label: "First text after the swap",
        context_note: "She just texted you saying hi.",
        options: [
          { letter: "A", text: "Now I have a face for the texts" },
          { letter: "B", text: "Welcome to my phone. Behave" },
          { letter: "C", text: "Hey. Way better than that app" },
          { letter: "D", text: "Saved as 'Hinge [her name]' — temporary" },
        ],
      },
      {
        id: "4.3",
        label: "Propose first call",
        context_note: "Move from text to voice before the date.",
        options: [
          { letter: "A", text: "Free for a quick call tonight?" },
          { letter: "B", text: "I want to hear your voice. 10 min tonight?" },
          { letter: "C", text: "We should jump on a call before we meet — saves us the awkward" },
          { letter: "D", text: "Phone call > more texting. Tonight or tomorrow?" },
        ],
      },
    ],
  },
]

type Compliment = {
  id: string
  context: string
  blurb: string
  options: Option[]
}

const COMPLIMENTS: Compliment[] = [
  {
    id: "C.1",
    context: "She sent you a photo / selfie",
    blurb: "Calibrated reply — not thirsty, not robotic.",
    options: [
      { letter: "A", text: "Damn ok, you're trying to ruin my day" },
      { letter: "B", text: "That's a problem" },
      { letter: "C", text: "Wow. Now I have to be smart with what I say next" },
      { letter: "D", text: "You look amazing" },
    ],
  },
  {
    id: "C.2",
    context: "She shared something vulnerable / personal",
    blurb: "Compliment that honors what she just gave you.",
    options: [
      { letter: "A", text: "I respect the hell out of that" },
      { letter: "B", text: "That's actually really cool of you to share" },
      { letter: "C", text: "Most people don't say things like that out loud. I like it" },
      { letter: "D", text: "Noted — and not surprised, somehow" },
    ],
  },
  {
    id: "C.3",
    context: "Morning after the first date",
    blurb: "A compliment that locks in attraction without being mushy.",
    options: [
      { letter: "A", text: "You're better in person than your profile. That's rare" },
      { letter: "B", text: "I had way more fun than I expected" },
      { letter: "C", text: "You're trouble. I want more of it" },
      { letter: "D", text: "Definitely thinking about [specific moment from the date]" },
    ],
  },
  {
    id: "C.4",
    context: "Callback compliment — referencing something she said",
    blurb: "Specific compliment > generic compliment. What's your style?",
    options: [
      { letter: "A", text: "I keep thinking about that thing you said about [topic]" },
      { letter: "B", text: "Your take on [topic] was actually sharp. I'm impressed" },
      { letter: "C", text: "You're way more interesting than you let on" },
      { letter: "D", text: "[specific quote from her, paraphrased back] — you're dangerous" },
    ],
  },
  {
    id: "C.5",
    context: "Late-night flirty compliment",
    blurb: "Crossing from friendly to charged. How direct do you go?",
    options: [
      { letter: "A", text: "I shouldn't be liking this as much as I am" },
      { letter: "B", text: "Careful — I'm not great at staying friends" },
      { letter: "C", text: "You're going to get me in trouble" },
      { letter: "D", text: "Bad idea to text me right now. Keep going" },
    ],
  },
  {
    id: "C.6",
    context: "Compliment her energy / vibe (not looks)",
    blurb: "Substance compliment — what you'd say to someone you actually want.",
    options: [
      { letter: "A", text: "Your energy is rare. I notice" },
      { letter: "B", text: "You don't carry yourself like everyone else" },
      { letter: "C", text: "There's something different about you. I'm trying to figure out what" },
      { letter: "D", text: "Most people are exhausting. You're not" },
    ],
  },
]

type PickState = {
  pick: string | null
  note: string
  write_in: string
}

function emptyState(): PickState {
  return { pick: null, note: "", write_in: "" }
}

export default function VoiceTrainingPage() {
  const saved = useQuery(api.voice.getTrainingPicks, { user_id: FLEET_USER_ID })
  const save = useMutation(api.voice.saveTrainingPicks)

  const ALL_IDS = useMemo(() => {
    const ids: string[] = []
    PATHS.forEach((p) => p.turns.forEach((t) => ids.push(t.id)))
    COMPLIMENTS.forEach((c) => ids.push(c.id))
    return ids
  }, [])

  const [picks, setPicks] = useState<Record<string, PickState>>(() =>
    Object.fromEntries(ALL_IDS.map((id) => [id, emptyState()]))
  )
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string>("")
  const [pathFreeform, setPathFreeform] = useState<string>("")

  // Hydrate from previous save
  useEffect(() => {
    if (!saved?.boosted_samples?.length) return
    setPicks((prev) => {
      const next = { ...prev }
      for (const s of saved.boosted_samples as any[]) {
        if (!s?.scenario || !next[s.scenario]) continue
        if (s.source === "write_in") {
          next[s.scenario] = { ...next[s.scenario], write_in: s.text || "", note: s.note || "" }
        } else {
          next[s.scenario] = {
            pick: s.pick || null,
            note: s.note || "",
            write_in: next[s.scenario].write_in,
          }
        }
        if (s.scenario === "_path_suggestion" && s.source === "write_in") {
          setPathFreeform(s.text || "")
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
  function clearOne(id: string) {
    setPicks((prev) => ({ ...prev, [id]: emptyState() }))
  }

  async function onSave() {
    setStatus("saving")
    setErrorMsg("")
    try {
      const optionLookup: Record<string, { label: string; option?: Option; context: string }> = {}
      PATHS.forEach((p) =>
        p.turns.forEach((t) => {
          optionLookup[t.id] = {
            label: `${p.title} — ${t.label}`,
            context: t.her_message ? `[her] ${t.her_message}` : t.context_note || "",
            option: undefined,
          }
        })
      )
      COMPLIMENTS.forEach((c) => {
        optionLookup[c.id] = { label: `COMPLIMENT — ${c.context}`, context: c.blurb, option: undefined }
      })

      const payload: any[] = []
      for (const id of ALL_IDS) {
        const state = picks[id]
        const meta = optionLookup[id]
        if (!meta) continue
        if (state.pick) {
          let opt: Option | undefined
          PATHS.forEach((p) => p.turns.forEach((t) => {
            if (t.id === id) opt = t.options.find((o) => o.letter === state.pick) ?? undefined
          }))
          COMPLIMENTS.forEach((c) => {
            if (c.id === id) opt = c.options.find((o) => o.letter === state.pick) ?? undefined
          })
          if (opt && !opt.abstain) {
            payload.push({
              scenario: id,
              label: meta.label,
              context: meta.context,
              pick: state.pick,
              text: opt.text,
              note: state.note || undefined,
            })
          }
        }
        if (state.write_in.trim()) {
          payload.push({
            scenario: id,
            label: meta.label,
            context: meta.context,
            write_in: state.write_in.trim(),
          })
        }
      }
      if (pathFreeform.trim()) {
        payload.push({
          scenario: "_path_suggestion",
          label: "PATH SUGGESTION",
          context: "operator-proposed new path or scenario",
          write_in: pathFreeform.trim(),
        })
      }

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
    <div className="p-4 sm:p-8 max-w-3xl mx-auto pb-32">
      <header className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Voice Training</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          Each path is a real courtship arc — pick the option that sounds most like you at each turn.
          Add tone notes ("B but no '?' at end") or a write-in if none fit. Picks save to Convex and feed
          the AI's voice when drafting your replies.
        </p>
        <div className="mt-3 flex gap-2 items-center text-xs flex-wrap">
          <span className="px-2 py-1 rounded bg-gray-800 text-gray-300">
            {completed}/{ALL_IDS.length} answered
          </span>
          {saved?.updated_at && (
            <span className="text-gray-500">
              Last saved {new Date(saved.updated_at).toLocaleString()}
            </span>
          )}
        </div>
      </header>

      {/* Paths */}
      <div className="space-y-8">
        {PATHS.map((path) => (
          <section key={path.id}>
            <div className="mb-3">
              <h2 className="text-lg font-bold text-white">
                Path {path.id} · {path.title}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{path.blurb}</p>
            </div>

            <div className="relative pl-5 border-l-2 border-purple-800/50 space-y-4">
              {path.turns.map((turn) => {
                const state = picks[turn.id]
                return (
                  <article
                    key={turn.id}
                    className="bg-gray-900 border border-gray-800 rounded-lg p-4 -ml-[3px] relative"
                  >
                    <span className="absolute -left-[11px] top-5 w-4 h-4 rounded-full bg-purple-600 border-2 border-gray-950" />
                    <div className="flex items-baseline justify-between mb-1 gap-2">
                      <h3 className="text-sm font-semibold text-purple-300">
                        Turn {turn.id} · {turn.label}
                      </h3>
                      {(state.pick || state.write_in) && (
                        <button
                          onClick={() => clearOne(turn.id)}
                          className="text-xs text-gray-500 hover:text-red-400 shrink-0"
                        >
                          clear
                        </button>
                      )}
                    </div>

                    {/* Her message bubble */}
                    {turn.her_message && (
                      <div className="my-2 inline-block max-w-full bg-gray-800 text-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm text-sm">
                        <span className="text-[10px] text-gray-500 block mb-0.5">her</span>
                        {turn.her_message}
                      </div>
                    )}
                    {turn.context_note && (
                      <p className="text-xs text-gray-500 italic mb-2">{turn.context_note}</p>
                    )}

                    <p className="text-[11px] uppercase tracking-wider text-gray-500 mt-2 mb-1">
                      You reply
                    </p>
                    <div className="space-y-2">
                      {turn.options.map((opt) => {
                        const selected = state.pick === opt.letter
                        return (
                          <button
                            key={opt.letter}
                            onClick={() => setPick(turn.id, opt.letter)}
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
                        onChange={(e) => setNote(turn.id, e.target.value)}
                        placeholder="tone note (e.g. 'B but no ? at end')"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500"
                      />
                      <textarea
                        value={state.write_in}
                        onChange={(e) => setWriteIn(turn.id, e.target.value)}
                        placeholder="or write your own version…"
                        rows={2}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 resize-y"
                      />
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}

        {/* Compliments */}
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-bold text-white">COMPLIMENTS</h2>
            <p className="text-xs text-gray-500 mt-1">
              Calibrated compliments by context — the kind that land instead of feeling try-hard.
            </p>
          </div>
          <div className="space-y-3">
            {COMPLIMENTS.map((c) => {
              const state = picks[c.id]
              return (
                <article key={c.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-baseline justify-between mb-1 gap-2">
                    <h3 className="text-sm font-semibold text-pink-300">
                      {c.id} · {c.context}
                    </h3>
                    {(state.pick || state.write_in) && (
                      <button
                        onClick={() => clearOne(c.id)}
                        className="text-xs text-gray-500 hover:text-red-400 shrink-0"
                      >
                        clear
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 italic mb-3">{c.blurb}</p>
                  <div className="space-y-2">
                    {c.options.map((opt) => {
                      const selected = state.pick === opt.letter
                      return (
                        <button
                          key={opt.letter}
                          onClick={() => setPick(c.id, opt.letter)}
                          className={`w-full text-left px-3 py-3 rounded-md border transition-colors min-h-[52px] ${
                            selected
                              ? "bg-pink-900/40 border-pink-500 text-white"
                              : "bg-gray-800/40 border-gray-700 text-gray-200 hover:border-gray-500"
                          }`}
                        >
                          <span className="font-mono text-xs text-pink-400 mr-2">{opt.letter})</span>
                          {opt.text}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-3 space-y-2">
                    <input
                      type="text"
                      value={state.note}
                      onChange={(e) => setNote(c.id, e.target.value)}
                      placeholder="tone note"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500"
                    />
                    <textarea
                      value={state.write_in}
                      onChange={(e) => setWriteIn(c.id, e.target.value)}
                      placeholder="or write your own version…"
                      rows={2}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 resize-y"
                    />
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        {/* Operator-proposed paths */}
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-bold text-white mb-1">Suggest a new path or scenario</h2>
          <p className="text-xs text-gray-500 mb-3">
            What didn't I cover? Drop a scenario, full path, or single moment you want trained on. I'll
            fold it into the next sheet.
          </p>
          <textarea
            value={pathFreeform}
            onChange={(e) => setPathFreeform(e.target.value)}
            placeholder="e.g. 'add a path for when she's testing me — playful negging where I have to hold frame without being mean'"
            rows={4}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 resize-y"
          />
        </section>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-950/95 backdrop-blur border-t border-gray-800 p-4 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400 truncate">
            {status === "saved" && <span className="text-emerald-400">✓ Saved to Convex</span>}
            {status === "saving" && <span>Saving…</span>}
            {status === "error" && <span className="text-red-400">Error: {errorMsg}</span>}
            {status === "idle" && <span>{completed} answers ready</span>}
          </div>
          <button
            onClick={onSave}
            disabled={status === "saving" || (completed === 0 && !pathFreeform.trim())}
            className="px-5 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-md min-h-[44px] shrink-0"
          >
            {status === "saving" ? "Saving…" : "Save picks"}
          </button>
        </div>
      </div>
    </div>
  )
}
