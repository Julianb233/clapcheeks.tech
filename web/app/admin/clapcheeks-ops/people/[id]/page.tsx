/**
 * Wave 2.4 Task B — Person dossier deep-dive route.
 *
 * Click any person in /admin/clapcheeks-ops/network → land here. Tabs:
 *   Timeline / Memory / Schedule / Media / Profile / Notes
 *
 * Wave 2.4 Task G — Compose panel ("Send a touch now"):
 *   pick template → click Preview → Mac Mini drafts → editable textarea → Send.
 *
 * AI-9500 W2 #D — Unified cross-platform thread (Timeline tab):
 *   Interleaves iMessage + Hinge + IG + Telegram + email messages into one
 *   chronological feed. Each message gets a platform pill. Toggle to single-
 *   platform view. Powered by messages.unifiedThreadForPerson Convex query.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState, useMemo } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Id } from "@/convex/_generated/dataModel"

const TABS = ["Timeline", "Memory", "Schedule", "Media", "Profile", "Notes"] as const
type TabName = typeof TABS[number]

const TEMPLATE_OPTIONS = [
  { value: "context_aware_reply", label: "Context-aware reply" },
  { value: "hot_reply", label: "Hot reply (high interest)" },
  { value: "callback_reference", label: "Callback to something she said" },
  { value: "pattern_interrupt", label: "Pattern interrupt (stale)" },
  { value: "easy_question_revival", label: "💤 Easy yes/no question (quiet thread revival)" },
  { value: "morning_text", label: "Morning text" },
  { value: "ghost_recovery", label: "Ghost recovery" },
  { value: "date_ask_three_options", label: "Ask for the date" },
  { value: "date_confirm_24h", label: "Date confirm (24h)" },
  { value: "date_dayof", label: "Date day-of" },
  { value: "date_postmortem", label: "Date postmortem" },
  { value: "event_followup", label: "Event followup" },
]

export default function PersonDossierPage() {
  const params = useParams<{ id: string }>()
  const personId = params.id as Id<"people">
  const dossier = useQuery(api.people.getDossier, { person_id: personId })
  const [tab, setTab] = useState<TabName>("Timeline")

  if (dossier === undefined) {
    return <div className="p-8 text-gray-500">Loading dossier…</div>
  }
  if (dossier === null) {
    return (
      <div className="p-8">
        <div className="text-red-400">Person not found.</div>
        <Link className="text-purple-300 underline" href="/admin/clapcheeks-ops/network">
          Back to network
        </Link>
      </div>
    )
  }

  const { person, messages, conversations, scheduled_touches, media_uses, media_assets, pending_links } = dossier as any

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      <div className="mb-4">
        <Link href="/admin/clapcheeks-ops/network" className="text-xs text-gray-500 hover:text-gray-300">
          ← back to network
        </Link>
      </div>

      <HeaderCard person={person} />

      <OperatorPanel person={person} />

      {/* Tabs — scrollable on mobile so all tabs remain accessible */}
      <div className="mt-6 flex gap-1 border-b border-gray-800 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-t-md whitespace-nowrap flex-shrink-0 ${
              tab === t
                ? "bg-gray-900 text-white border border-gray-800 border-b-transparent"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 border-t-0 rounded-b-md p-4 sm:p-6 mb-8">
        {tab === "Timeline" && <TimelineTab messages={messages} conversations={conversations} personId={personId} />}
        {tab === "Memory" && <MemoryTab person={person} />}
        {tab === "Schedule" && <ScheduleTab person={person} touches={scheduled_touches} />}
        {tab === "Media" && <MediaTab uses={media_uses} assets={media_assets} />}
        {tab === "Profile" && <ProfileTab person={person} pendingLinks={pending_links} />}
        {tab === "Notes" && <NotesTab person={person} />}
      </div>

      <ComposePanel person={person} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI-9500 W2 #C — Tier 2 badge helpers (flirtation, attachment, love langs, ask prob)
// ---------------------------------------------------------------------------

/** Flirtation thermometer: 0-10 mapped to color bands */
function FlirtationThermometer({ level }: { level: number | undefined }) {
  if (level === undefined) return null
  const pct = Math.round((level / 10) * 100)
  const colorClass =
    level <= 3 ? "bg-blue-500" :
    level <= 6 ? "bg-amber-400" :
    "bg-rose-500"
  const label =
    level <= 3 ? "low" :
    level <= 6 ? "med" :
    "hot"
  return (
    <div className="flex items-center gap-1.5" title={`Flirtation level: ${level}/10`}>
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">flirt</span>
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-mono ${
        level <= 3 ? "text-blue-400" : level <= 6 ? "text-amber-400" : "text-rose-400"
      }`}>{level}/{label}</span>
    </div>
  )
}

/** Attachment style pill badge */
function AttachmentBadge({ style }: { style: string | undefined }) {
  if (!style || style === "unclear") return null
  const colors: Record<string, string> = {
    secure: "bg-emerald-900/60 text-emerald-300 border-emerald-700/40",
    anxious: "bg-amber-900/60 text-amber-300 border-amber-700/40",
    avoidant: "bg-blue-900/60 text-blue-300 border-blue-700/40",
    fearful: "bg-red-900/60 text-red-300 border-red-700/40",
  }
  const cls = colors[style] ?? "bg-gray-800 text-gray-400 border-gray-700/40"
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${cls}`}>
      {style}
    </span>
  )
}

/** Love language emoji chips */
const LOVE_LANG_EMOJI: Record<string, string> = {
  words_of_affirmation: "✍️",
  acts_of_service: "🫳",
  receiving_gifts: "🎁",
  quality_time: "⏰",
  physical_touch: "🤗",
}
function LoveLangChips({ langs }: { langs: string[] | undefined }) {
  if (!langs || langs.length === 0) return null
  return (
    <div className="flex gap-1" title={langs.join(" + ")}>
      {langs.map((l) => (
        <span key={l} className="text-sm" title={l.replace(/_/g, " ")}>
          {LOVE_LANG_EMOJI[l] ?? "💬"}
        </span>
      ))}
    </div>
  )
}

/** "Ready to ask" badge when ask_yes_prob_now > 0.6 */
function AskReadyBadge({ prob }: { prob: number | undefined }) {
  if (prob === undefined || prob <= 0.6) return null
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded bg-green-900/70 text-green-300 border border-green-700/50 font-semibold"
      title={`ask_yes_prob_now = ${prob.toFixed(2)}`}
    >
      💪 ready to ask
    </span>
  )
}

// ---------------------------------------------------------------------------
// Header card
// ---------------------------------------------------------------------------
function HeaderCard({ person }: { person: any }) {
  const lastInbound = person.last_inbound_at
    ? `${Math.round((Date.now() - person.last_inbound_at) / 3600000)}h ago`
    : "—"
  const lastOutbound = person.last_outbound_at
    ? `${Math.round((Date.now() - person.last_outbound_at) / 3600000)}h ago`
    : "—"
  const trust = person.trust_score?.toFixed(2) ?? "—"
  const tta = person.time_to_ask_score?.toFixed(2) ?? "—"
  const lastEmotion = (person.emotional_state_recent ?? []).slice(-1)[0]?.state ?? "—"

  // Tier 2 signals
  const hasTier2 = person.flirtation_level !== undefined
    || person.attachment_style !== undefined
    || (person.love_languages_top2 ?? []).length > 0
    || person.ask_yes_prob_now !== undefined

  return (
    <div className="bg-gradient-to-br from-purple-900/20 to-gray-900 border border-purple-800/40 rounded-lg p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold">{person.display_name}</h1>
            {person.age && <span className="text-gray-500">· {person.age}</span>}
            <span className={`text-xs px-2 py-0.5 rounded ${
              person.whitelist_for_autoreply
                ? "bg-green-900 text-green-300" : "bg-gray-800 text-gray-500"
            }`}>
              {person.whitelist_for_autoreply ? "✓ whitelisted" : "○ manual only"}
            </span>
            {/* AI-9500 W2 #C: ask-ready badge */}
            <AskReadyBadge prob={person.ask_yes_prob_now} />
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {person.location_observed || person.company || "—"}
            {person.occupation_observed ? ` · ${person.occupation_observed}` : ""}
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-4 mt-2 sm:mt-3 text-xs text-gray-400">
            <span>stage: <b className="text-purple-300">{person.courtship_stage ?? "early_chat"}</b></span>
            <span>cadence: {person.cadence_profile}</span>
            <span className="hidden sm:inline">vibe: {person.conversation_temperature ?? "—"}</span>
            <span>emo: {lastEmotion}</span>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-4 mt-1 sm:mt-2 text-xs text-gray-500">
            <span>in {lastInbound}</span>
            <span>out {lastOutbound}</span>
            <span className="hidden sm:inline">trust {trust}</span>
            <span className="hidden sm:inline">ask {tta}</span>
            <span className="hidden sm:inline">msgs {person.total_messages_30d ?? 0}</span>
          </div>
          {/* AI-9500 W2 #C — Tier 2 row: flirtation + attachment + love langs */}
          {hasTier2 && (
            <div className="flex items-center gap-3 mt-2">
              <FlirtationThermometer level={person.flirtation_level} />
              <AttachmentBadge style={person.attachment_style} />
              <LoveLangChips langs={person.love_languages_top2} />
            </div>
          )}
        </div>
        <div className="text-xs text-gray-500 sm:text-right sm:max-w-sm">
          {person.next_best_move && (
            <div className="text-purple-300 italic">💡 {person.next_best_move}</div>
          )}
          {person.zodiac_sign && (
            <div className="mt-1 sm:mt-2 capitalize">♈ {person.zodiac_sign} · {person.disc_inference || "DISC ?"}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Operator panel — inline editing for ratings + status + cadence + whitelist
// + nurture + boundaries + notes. Wires every field to people:patchPerson.
// AI-9500 audit gap: schema + mutation existed but no UI; this fills that gap.
// ---------------------------------------------------------------------------
const STATUS_OPTIONS = ["lead", "active", "dating", "paused", "ghosted", "ended"] as const
const CADENCE_OPTIONS = ["hot", "warm", "slow_burn", "nurture", "dormant"] as const
const NURTURE_OPTIONS = ["", "active_pursuit", "steady", "nurture", "dormant", "close"] as const
const STAGE_OPTIONS = [
  "matched", "early_chat", "phone_swap", "pre_date",
  "first_date_done", "ongoing", "exclusive", "ghosted", "ended",
] as const

function OperatorPanel({ person }: { person: any }) {
  const patch = useMutation(api.people.patchPerson)
  const [saving, setSaving] = useState<string | null>(null)
  const [boundaryDraft, setBoundaryDraft] = useState("")
  const [notesDraft, setNotesDraft] = useState(person.operator_notes ?? "")

  async function save(field: string, value: any) {
    setSaving(field)
    try {
      await patch({ person_id: person._id, [field]: value })
    } finally {
      setSaving(null)
    }
  }

  async function addBoundary() {
    const text = boundaryDraft.trim()
    if (!text) return
    const next = [...(person.boundaries_stated ?? []), text]
    await save("boundaries_stated", next)
    setBoundaryDraft("")
  }

  async function removeBoundary(idx: number) {
    const next = [...(person.boundaries_stated ?? [])]
    next.splice(idx, 1)
    await save("boundaries_stated", next)
  }

  return (
    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Ratings */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-3">Ratings</div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-gray-300">🔥 Hotness</label>
            <span className="text-pink-300 font-mono text-sm">
              {person.hotness_rating ? `${person.hotness_rating}/10` : "unrated"}
            </span>
          </div>
          <input
            type="range" min={0} max={10} step={1}
            value={person.hotness_rating ?? 0}
            onChange={(e) => save("hotness_rating", Number(e.target.value) || undefined)}
            disabled={saving === "hotness_rating"}
            className="w-full accent-pink-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-gray-300">⚡ Effort</label>
            <span className="text-amber-300 font-mono text-sm">
              {person.effort_rating ? `${person.effort_rating}/5` : "unrated"}
            </span>
          </div>
          <input
            type="range" min={0} max={5} step={1}
            value={person.effort_rating ?? 0}
            onChange={(e) => save("effort_rating", Number(e.target.value) || undefined)}
            disabled={saving === "effort_rating"}
            className="w-full accent-amber-500"
          />
        </div>
      </div>

      {/* Status, cadence, stage, nurture, whitelist */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 grid grid-cols-2 gap-3">
        <div className="col-span-2 text-xs uppercase tracking-wider text-gray-500">Lifecycle</div>

        <Select label="Status" value={person.status ?? "lead"}
          options={STATUS_OPTIONS as readonly string[]}
          onChange={(v) => save("status", v)} disabled={saving === "status"} />

        <Select label="Stage" value={person.courtship_stage ?? "early_chat"}
          options={STAGE_OPTIONS as readonly string[]}
          onChange={(v) => save("courtship_stage", v)} disabled={saving === "courtship_stage"} />

        <Select label="Cadence" value={person.cadence_profile ?? "warm"}
          options={CADENCE_OPTIONS as readonly string[]}
          onChange={(v) => save("cadence_profile", v)} disabled={saving === "cadence_profile"} />

        <Select label="Nurture" value={person.nurture_state ?? ""}
          options={NURTURE_OPTIONS as readonly string[]}
          onChange={(v) => save("nurture_state", v || undefined)} disabled={saving === "nurture_state"} />

        <label className="col-span-2 flex items-center gap-2 text-sm text-gray-300 cursor-pointer mt-2">
          <input
            type="checkbox" checked={person.whitelist_for_autoreply ?? false}
            onChange={(e) => save("whitelist_for_autoreply", e.target.checked)}
            disabled={saving === "whitelist_for_autoreply"}
          />
          <span>
            <b className={person.whitelist_for_autoreply ? "text-green-400" : "text-gray-400"}>
              {person.whitelist_for_autoreply ? "✓ Auto-reply ON" : "○ Auto-reply OFF"}
            </b>
            <span className="text-xs text-gray-500 ml-2">
              (5 brakes still apply: active hours · anti-loop · cadence-mirror · boundaries · safety)
            </span>
          </span>
        </label>
      </div>

      {/* Boundaries */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Boundaries (HARD RULES)</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(person.boundaries_stated ?? []).map((b: string, i: number) => (
            <span key={i} className="bg-red-900/40 border border-red-800/60 text-red-200 text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1">
              {b}
              <button onClick={() => removeBoundary(i)} className="text-red-400 hover:text-red-200">×</button>
            </span>
          ))}
          {(!person.boundaries_stated || person.boundaries_stated.length === 0) && (
            <span className="text-xs text-gray-500">No boundaries stated yet.</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text" value={boundaryDraft}
            onChange={(e) => setBoundaryDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addBoundary()}
            placeholder="add boundary…"
            className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
          />
          <button onClick={addBoundary} className="text-xs px-3 py-1 bg-red-900/40 border border-red-800 text-red-200 rounded hover:bg-red-800/40">
            add
          </button>
        </div>
      </div>

      {/* Operator notes */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Operator notes</div>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => notesDraft !== (person.operator_notes ?? "") && save("operator_notes", notesDraft)}
          placeholder="private notes — not shown to her, not used for sends"
          rows={4}
          className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
        />
        {saving === "operator_notes" && <div className="text-xs text-gray-500 mt-1">saving…</div>}
      </div>
    </div>
  )
}

function Select({
  label, value, options, onChange, disabled,
}: {
  label: string; value: string; options: readonly string[];
  onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <label className="text-xs text-gray-400">
      <span className="block mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1 text-sm text-gray-200 capitalize"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o ? o.replace(/_/g, " ") : "— none —"}</option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Platform pill colors for the unified thread feed
// ---------------------------------------------------------------------------
const PLATFORM_STYLES: Record<string, string> = {
  hinge:     "bg-rose-900/60 text-rose-300 border-rose-700/50",
  tinder:    "bg-orange-900/60 text-orange-300 border-orange-700/50",
  bumble:    "bg-yellow-900/60 text-yellow-300 border-yellow-700/50",
  imessage:  "bg-blue-900/60 text-blue-300 border-blue-700/50",
  instagram: "bg-fuchsia-900/60 text-fuchsia-300 border-fuchsia-700/50",
  telegram:  "bg-sky-900/60 text-sky-300 border-sky-700/50",
  email:     "bg-emerald-900/60 text-emerald-300 border-emerald-700/50",
  other:     "bg-gray-800 text-gray-400 border-gray-700",
}
function platformStyle(p: string) {
  return PLATFORM_STYLES[p] ?? PLATFORM_STYLES.other
}

// ---------------------------------------------------------------------------
// Timeline tab — AI-9500 W2 #D unified cross-platform thread
//
// Unified mode (default): fetches unifiedThreadForPerson from Convex — merges
// all platforms (iMessage, Hinge, IG, Telegram, email…) into one chronological
// feed. Each message gets a platform pill.
// Per-platform mode: shows only the dossier messages (existing behavior).
// Toggle hidden when only one platform is present (_handles_summary.length < 2).
// ---------------------------------------------------------------------------
function TimelineTab({ messages: dossierMessages, conversations, personId }: {
  messages: any[];
  conversations: any[];
  personId: string;
}) {
  const [mode, setMode] = useState<"unified" | "platform">("unified")

  // Unified thread query (always subscribed so switching is instant)
  const unified = useQuery(api.messages.unifiedThreadForPerson, {
    person_id: personId as Id<"people">,
    limit: 200,
  })

  const handlesSummary: string[] = unified?._handles_summary ?? []
  const multiPlatform = handlesSummary.length > 1

  // Active message list — unified is oldest-first from the query;
  // dossier list is newest-first so we reverse it for chronological display.
  const activeMessages: any[] = mode === "unified"
    ? (unified?.messages ?? [])
    : [...dossierMessages].reverse()

  const isLoading = mode === "unified" && unified === undefined

  if (isLoading) {
    return <div className="text-gray-500 text-sm">Loading unified thread…</div>
  }
  if (!activeMessages.length) {
    return <div className="text-gray-500 text-sm">No messages yet.</div>
  }

  const platforms = Array.from(new Set(conversations.map((c: any) => c.platform)))

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-500">
          {activeMessages.length} message{activeMessages.length !== 1 ? "s" : ""}
          {" · "}
          {mode === "unified"
            ? handlesSummary.join(", ") || platforms.join(", ")
            : `${conversations.length} conversation(s) · ${platforms.join(", ")}`}
        </div>

        {/* Toggle — only shown when more than one platform exists */}
        {multiPlatform && (
          <div className="flex rounded border border-gray-700 overflow-hidden text-xs">
            <button
              onClick={() => setMode("unified")}
              className={`px-3 py-1 transition-colors ${
                mode === "unified"
                  ? "bg-purple-700 text-white"
                  : "bg-gray-900 text-gray-400 hover:text-gray-200"
              }`}
            >
              unified
            </button>
            <button
              onClick={() => setMode("platform")}
              className={`px-3 py-1 transition-colors border-l border-gray-700 ${
                mode === "platform"
                  ? "bg-purple-700 text-white"
                  : "bg-gray-900 text-gray-400 hover:text-gray-200"
              }`}
            >
              this platform
            </button>
          </div>
        )}
      </div>

      {/* Message feed */}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
        {activeMessages.map((m: any, idx: number) => {
          const isOut = m.direction === "outbound"
          const ts = new Date(m.sent_at).toLocaleString()
          const platform: string = m._platform ?? "imessage"
          return (
            <div key={m._id ?? idx} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-lg px-3 py-2 ${
                isOut ? "bg-purple-700/40 border border-purple-700/60" : "bg-gray-800 border border-gray-700"
              }`}>
                <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[10px] text-gray-500">{ts}</span>
                  {mode === "unified" && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${platformStyle(platform)}`}>
                      {platform}
                    </span>
                  )}
                  {(m.transport || m.source) && (
                    <span className="text-[10px] text-gray-600">{m.transport ?? m.source}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Memory tab — personal_details, curiosity_ledger, life_events, lit topics
// ---------------------------------------------------------------------------
function MemoryTab({ person }: { person: any }) {
  const details = person.personal_details ?? []
  const curiosity = (person.curiosity_ledger ?? []).filter((q: any) => q.status === "pending")
  const events = person.recent_life_events ?? []
  const lit = person.topics_that_lit_her_up ?? []

  // AI-9500 #1 — curiosity-question ratio metric
  const questionRatio: number | null = person.her_question_ratio_7d ?? null
  const ratioComputedAt: number | null = person.her_question_ratio_computed_at ?? null
  const isQuietThread = questionRatio !== null && questionRatio < 0.15
  const lastInboundAgo = person.last_inbound_at
    ? Math.round((Date.now() - person.last_inbound_at) / 3600000)
    : null
  const isSilent24h = lastInboundAgo !== null && lastInboundAgo > 24

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

      {/* AI-9500 #1 — Curiosity-question ratio badge */}
      {questionRatio !== null && (
        <div className={`col-span-full rounded-lg border p-3 mb-2 ${
          isQuietThread && isSilent24h
            ? "border-amber-700/60 bg-amber-900/10"
            : "border-gray-700 bg-gray-800/40"
        }`}>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-lg">{isQuietThread && isSilent24h ? "💤" : "💬"}</span>
            <div>
              <span className="font-medium text-gray-200">
                Question ratio (7d inbound):&nbsp;
                <span className={isQuietThread ? "text-amber-300 font-bold" : "text-green-300"}>
                  {(questionRatio * 100).toFixed(0)}%
                </span>
              </span>
              {isQuietThread && isSilent24h ? (
                <span className="ml-2 text-xs text-amber-400 font-semibold">
                  — flagged for easy_question_revival (she's stopped asking questions &amp; hasn't replied in {lastInboundAgo}h)
                </span>
              ) : isQuietThread ? (
                <span className="ml-2 text-xs text-gray-500">low ratio but still active</span>
              ) : (
                <span className="ml-2 text-xs text-gray-500">healthy engagement</span>
              )}
            </div>
          </div>
          {ratioComputedAt && (
            <div className="text-[10px] text-gray-600 mt-1">
              computed {new Date(ratioComputedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
      <Section title={`Personal details (${details.length})`}>
        {details.length === 0 ? <Empty /> : (
          <ul className="space-y-1 text-sm">
            {details.slice(-12).reverse().map((d: any, i: number) => (
              <li key={i} className="text-gray-300">
                <span className="text-purple-300">·</span> {d.fact}
                <span className="text-xs text-gray-600 ml-2">
                  {new Date(d.learned_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Open questions (${curiosity.length})`}>
        {curiosity.length === 0 ? <Empty /> : (
          <ul className="space-y-1 text-sm">
            {curiosity.slice(0, 10).map((q: any, i: number) => (
              <li key={i} className="text-gray-300">
                <span className="text-amber-400">?</span> {q.question}
                {q.topic && <span className="text-xs text-gray-500 ml-2">[{q.topic}]</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Recent life events (${events.length})`}>
        {events.length === 0 ? <Empty /> : (
          <ul className="space-y-1 text-sm">
            {events.slice(-8).reverse().map((e: any, i: number) => (
              <li key={i} className="text-gray-300">
                <span className={
                  e.status === "happened" ? "text-green-400" :
                  e.status === "missed" ? "text-red-400" :
                  e.status === "faded" ? "text-gray-600" : "text-amber-300"
                }>●</span> {e.event}
                <span className="text-xs text-gray-600 ml-2">{e.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Topics that lit her up (${lit.length})`}>
        {lit.length === 0 ? <Empty /> : (
          <ul className="space-y-1 text-sm">
            {lit.slice(0, 10).map((t: any, i: number) => (
              <li key={i} className="text-gray-300">
                <span className="text-pink-400">★</span> {t.topic}
                <span className="text-xs text-gray-500 ml-2">×{t.signal_count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="She loves / she dislikes">
        <div className="text-xs space-y-1">
          {(person.things_she_loves ?? []).map((s: string, i: number) =>
            <div key={`l${i}`} className="text-green-400">+ {s}</div>)}
          {(person.things_she_dislikes ?? []).map((s: string, i: number) =>
            <div key={`d${i}`} className="text-red-400">– {s}</div>)}
          {!person.things_she_loves?.length && !person.things_she_dislikes?.length && <Empty />}
        </div>
      </Section>

      <Section title="Boundaries stated">
        {(person.boundaries_stated ?? []).length === 0 ? <Empty /> : (
          <ul className="text-xs space-y-1">
            {(person.boundaries_stated ?? []).map((b: string, i: number) =>
              <li key={i} className="text-amber-300">⚠ {b}</li>)}
          </ul>
        )}
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Schedule tab — pending touches, post-date calibration, and recent fires
// ---------------------------------------------------------------------------
function ScheduleTab({ person, touches }: { person: any; touches: any[] }) {
  const cancelMut = useMutation(api.touches.cancelOne)
  const markDateDone = useMutation(api.touches.markDateDone)
  const commitPostDateChoice = useMutation(api.touches.commitPostDateChoice)
  const FLEET_USER_ID = "fleet-julian"

  // AI-9500 W2 #I — date logistics checklists for this person
  const dateChecklists = useQuery(api.date_logistics.listForPerson, { person_id: person._id })
  const tickItemMut = useMutation(api.date_logistics.tickItem)
  const completeChecklistMut = useMutation(api.date_logistics.complete)

  const [showDateDoneForm, setShowDateDoneForm] = useState(false)
  const [dateNotesText, setDateNotesText] = useState("")
  const [dateMarkingId, setDateMarkingId] = useState<string | null>(null)
  const [markingBusy, setMarkingBusy] = useState(false)
  const [choiceError, setChoiceError] = useState<string | null>(null)

  const upcoming = touches.filter((t) => t.status === "scheduled" && !t.is_preview)
  const fired = touches.filter((t) => t.status === "fired").slice(0, 10)
  const skipped = touches.filter((t) => t.status === "skipped").slice(0, 10)

  // Post-date calibration touches with candidates awaiting operator choice.
  const pendingCalibrations = upcoming.filter(
    (t: any) => t.type === "post_date_calibration" && t.candidate_drafts?.length > 0 && !t.draft_body
  )

  // Date-ask or date-dayof touches that could be "marked done".
  const dateCandidates = [...upcoming, ...fired].filter(
    (t: any) => t.type === "date_ask" || t.type === "date_dayof" || t.type === "date_confirm_24h"
  ).slice(0, 5)

  async function handleMarkDateDone(sourceTouchId?: string) {
    setMarkingBusy(true)
    try {
      await markDateDone({
        user_id: FLEET_USER_ID,
        person_id: person._id,
        source_touch_id: sourceTouchId as any,
        date_done_at: Date.now(),
        date_notes_text: dateNotesText || undefined,
      })
      setShowDateDoneForm(false)
      setDateNotesText("")
      setDateMarkingId(null)
    } catch (e: any) {
      alert("Error: " + (e?.message ?? String(e)))
    } finally {
      setMarkingBusy(false)
    }
  }

  async function handleCommitChoice(touchId: string, kind: "callback" | "photo" | "generic") {
    setChoiceError(null)
    try {
      await commitPostDateChoice({ touch_id: touchId as any, chosen_kind: kind })
    } catch (e: any) {
      setChoiceError(e?.message ?? String(e))
    }
  }

  return (
    <div className="space-y-6">

      {/* ------------------------------------------------------------------ */}
      {/* AI-9500 #6 — Post-date calibration candidate pickers                */}
      {/* ------------------------------------------------------------------ */}
      {pendingCalibrations.length > 0 && (
        <Section title={`Post-date follow-up — choose a message (${pendingCalibrations.length})`}>
          {choiceError && (
            <div className="text-red-400 text-xs mb-2">{choiceError}</div>
          )}
          {pendingCalibrations.map((t: any) => (
            <div key={t._id} className="mb-6 border border-purple-800 rounded-lg p-4 bg-purple-950/20">
              <div className="text-xs text-purple-300 mb-1">
                Calibration scheduled for {new Date(t.scheduled_for).toLocaleString()}
                {t.date_notes_text && (
                  <span className="ml-2 text-gray-400 italic">· "{t.date_notes_text}"</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mb-3">
                Pick one — operator choice committed immediately. Auto-picks "callback" in 6h if no choice made.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(t.candidate_drafts ?? []).map((draft: any) => (
                  <div key={draft.kind} className="border border-gray-700 rounded-lg p-3 bg-gray-900 flex flex-col justify-between">
                    <div>
                      <div className={`text-[10px] font-semibold mb-1 uppercase tracking-wider ${
                        draft.kind === "callback" ? "text-green-400" :
                        draft.kind === "photo" ? "text-blue-400" : "text-amber-400"
                      }`}>
                        {draft.kind}
                        {draft.kind === "callback" && " ★ 3x conversion"}
                      </div>
                      <p className="text-sm text-white mb-2">{draft.body}</p>
                      {draft.reasoning && (
                        <p className="text-[10px] text-gray-500 italic">{draft.reasoning}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleCommitChoice(t._id, draft.kind)}
                      className={`mt-3 w-full text-xs py-1.5 rounded font-semibold ${
                        draft.kind === "callback"
                          ? "bg-green-700 hover:bg-green-600 text-white"
                          : draft.kind === "photo"
                          ? "bg-blue-700 hover:bg-blue-600 text-white"
                          : "bg-amber-700 hover:bg-amber-600 text-white"
                      }`}
                    >
                      Use this
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => cancelMut({ touch_id: t._id, reason: "operator_declined_all_candidates" })}
                className="mt-2 text-xs text-red-400 hover:text-red-300"
              >
                Skip — don't send any of these
              </button>
            </div>
          ))}
        </Section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* AI-9500 W2 #I — Date logistics checklists                           */}
      {/* ------------------------------------------------------------------ */}
      {dateChecklists && dateChecklists.length > 0 && (
        <Section title={`Date logistics (${dateChecklists.length})`}>
          <div className="space-y-6">
            {dateChecklists.map((cl: any) => {
              const allDone = cl.items.every((it: any) => it.done)
              const doneCnt = cl.items.filter((it: any) => it.done).length
              const dateLabel = new Date(cl.date_time_ms).toLocaleDateString(undefined, {
                weekday: "short", month: "short", day: "numeric",
              })
              return (
                <div
                  key={cl._id}
                  className={`rounded-lg border p-4 ${
                    allDone
                      ? "border-green-700 bg-green-950/20"
                      : "border-purple-800/50 bg-purple-950/10"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-semibold text-purple-300">
                        Date: {dateLabel}
                      </span>
                      {cl.venue && (
                        <span className="ml-2 text-xs text-gray-400">@ {cl.venue}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono ${allDone ? "text-green-400" : "text-gray-500"}`}>
                        {doneCnt}/{cl.items.length}
                      </span>
                      {!allDone && (
                        <button
                          onClick={() => completeChecklistMut({ checklist_id: cl._id })}
                          className="text-xs px-2 py-0.5 rounded bg-green-800 hover:bg-green-700 text-white"
                        >
                          Mark all done
                        </button>
                      )}
                      {allDone && (
                        <span className="text-xs text-green-400 font-semibold">All done!</span>
                      )}
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {cl.items.map((item: any) => (
                      <li key={item.key} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={(e) => tickItemMut({
                            checklist_id: cl._id,
                            key: item.key,
                            done: e.target.checked,
                          })}
                          className="mt-0.5 accent-green-500 cursor-pointer"
                        />
                        <div className="flex-1">
                          <span className={`text-sm ${item.done ? "line-through text-gray-500" : "text-gray-200"}`}>
                            {item.label}
                          </span>
                          {item.done_at_ms && (
                            <span className="ml-2 text-xs text-gray-600">
                              {new Date(item.done_at_ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                          {item.notes && (
                            <div className="text-xs text-gray-500 italic mt-0.5">{item.notes}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* AI-9500 #6 — Mark date done (schedules calibration touch)           */}
      {/* ------------------------------------------------------------------ */}
      <Section title="Date completed?">
        {!showDateDoneForm ? (
          <div className="text-xs text-gray-500 space-y-2">
            <p>
              If you just came back from a date, mark it done to schedule a +18h post-date follow-up with 3 AI-drafted candidate messages.
            </p>
            <button
              onClick={() => setShowDateDoneForm(true)}
              className="px-3 py-1.5 text-xs rounded bg-purple-800 hover:bg-purple-700 text-white font-semibold"
            >
              Mark date done
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Date notes (optional — specific moments = 3x 2nd-date booking rate)
              </label>
              <textarea
                value={dateNotesText}
                onChange={(e) => setDateNotesText(e.target.value)}
                placeholder="e.g. laughed at the raccoon story, she brought up hiking, mentioned her sister's wedding"
                rows={3}
                className="w-full text-xs bg-gray-950 border border-gray-700 rounded p-2 text-white placeholder-gray-600 resize-none"
              />
            </div>
            {dateCandidates.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">Link to a date touch (optional):</div>
                <div className="space-y-1">
                  {dateCandidates.map((t: any) => (
                    <label key={t._id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="date-source"
                        value={t._id}
                        checked={dateMarkingId === t._id}
                        onChange={() => setDateMarkingId(t._id)}
                        className="accent-purple-500"
                      />
                      <span className="text-gray-300">{t.type} · {new Date(t.scheduled_for).toLocaleDateString()}</span>
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="date-source"
                      value=""
                      checked={dateMarkingId === null}
                      onChange={() => setDateMarkingId(null)}
                      className="accent-purple-500"
                    />
                    <span className="text-gray-400">No linked touch</span>
                  </label>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handleMarkDateDone(dateMarkingId ?? undefined)}
                disabled={markingBusy}
                className="px-3 py-1.5 text-xs rounded bg-purple-700 hover:bg-purple-600 text-white font-semibold disabled:opacity-50"
              >
                {markingBusy ? "Scheduling…" : "Schedule +18h calibration touch"}
              </button>
              <button
                onClick={() => { setShowDateDoneForm(false); setDateNotesText(""); setDateMarkingId(null) }}
                className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title={`Upcoming (${upcoming.length})`}>
        {upcoming.length === 0 ? <Empty text="Nothing queued." /> : (
          <table className="w-full text-xs">
            <thead className="text-gray-500">
              <tr><th className="text-left pb-1">when</th><th className="text-left">type</th><th className="text-left">template</th><th></th></tr>
            </thead>
            <tbody>
              {upcoming.map((t: any) => (
                <tr key={t._id} className="border-t border-gray-800">
                  <td className="py-1">{new Date(t.scheduled_for).toLocaleString()}</td>
                  <td>{t.type}</td>
                  <td className="text-gray-500">{t.prompt_template ?? "—"}</td>
                  <td className="text-right">
                    <button
                      onClick={() => cancelMut({ touch_id: t._id, reason: "manual_dossier_cancel" })}
                      className="text-xs text-red-400 hover:text-red-300"
                    >cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Recent fired (${fired.length})`}>
        {fired.length === 0 ? <Empty /> : (
          <ul className="text-xs space-y-1">
            {fired.map((t: any) => (
              <li key={t._id} className="text-gray-400">
                <span className="text-green-400">✓</span> {t.type} · {t.fired_at && new Date(t.fired_at).toLocaleString()}
                {t.pattern_hash && <span className="ml-2 text-gray-600">hash:{t.pattern_hash.slice(0,8)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Recent skipped (${skipped.length})`}>
        {skipped.length === 0 ? <Empty /> : (
          <ul className="text-xs space-y-1">
            {skipped.map((t: any) => (
              <li key={t._id} className="text-gray-500">
                <span className="text-gray-600">−</span> {t.type} · {t.skip_reason} ·
                {t.fired_at && ` ${new Date(t.fired_at).toLocaleString()}`}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="text-xs text-gray-600">
        Cadence overrides:{" "}
        {person.cadence_overrides
          ? <code className="bg-gray-950 px-1 rounded">{JSON.stringify(person.cadence_overrides)}</code>
          : "—"}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Media tab — what we've sent her
// ---------------------------------------------------------------------------
function MediaTab({ uses, assets }: { uses: any[]; assets: any[] }) {
  if (!uses.length) return <Empty text="No media sent yet." />
  const assetById: Record<string, any> = {}
  for (const a of assets || []) if (a) assetById[a._id] = a

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {uses.map((u: any) => {
        const asset = assetById[u.asset_id]
        return (
          <div key={u._id} className="bg-gray-950 border border-gray-800 rounded p-2">
            {asset?.thumbnail_url || asset?.storage_url ? (
              <img src={asset.thumbnail_url || asset.storage_url}
                   alt="sent media"
                   className="w-full h-24 object-cover rounded" />
            ) : (
              <div className="w-full h-24 bg-gray-900 rounded flex items-center justify-center text-xs text-gray-600">
                no preview
              </div>
            )}
            <div className="text-xs text-gray-400 mt-1 truncate">{asset?.caption ?? "—"}</div>
            <div className="text-[10px] text-gray-600">
              {new Date(u.sent_at).toLocaleDateString()} · {u.fire_context ?? "—"}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile tab — handles, identity, vibe, courtship signals, source
// ---------------------------------------------------------------------------
function ProfileTab({ person, pendingLinks }: { person: any; pendingLinks: any[] }) {
  return (
    <div className="space-y-6">
      <Section title={`Handles (${person.handles?.length ?? 0})`}>
        {person.handles?.length ? (
          <ul className="text-xs space-y-1">
            {person.handles.map((h: any, i: number) => (
              <li key={i} className="text-gray-300">
                <span className="text-purple-300">{h.channel}</span> · {h.value}
                {h.verified && <span className="text-green-400 ml-2">✓</span>}
                {h.primary && <span className="text-amber-400 ml-1">★</span>}
              </li>
            ))}
          </ul>
        ) : <Empty />}
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <KeyVal label="DISC primary" v={person.disc_primary} />
        <KeyVal label="DISC inference" v={person.disc_inference} />
        <KeyVal label="VAK" v={person.vak_primary} />
        <KeyVal label="Comm style" v={person.communication_style} />
        <KeyVal label="Cialdini lever" v={person.cialdini_principle} />
        <KeyVal label="Best contact time" v={person.best_contact_time} />
        <KeyVal label="Energy" v={person.energy} />
        <KeyVal label="Active hours"
                v={person.active_hours_local ? `${person.active_hours_local.start_hour}-${person.active_hours_local.end_hour} ${person.active_hours_local.tz}` : null} />
      </div>

      {person.zodiac_analysis && (
        <Section title={`♈ Zodiac (${person.zodiac_sign ?? "?"})`}>
          <p className="text-sm text-gray-300 italic">{person.zodiac_analysis}</p>
        </Section>
      )}

      {person.imported_from_profile_screenshot && (
        <Section title="Profile import source">
          <div className="text-xs text-gray-500">
            Imported from {person.imported_from_platform ?? "unknown"} screenshot.
            {person.bio_text && <p className="mt-1 italic text-gray-400">"{person.bio_text}"</p>}
          </div>
        </Section>
      )}

      {pendingLinks.length > 0 && (
        <Section title={`Pending cross-channel links (${pendingLinks.length})`}>
          <ul className="text-xs space-y-1">
            {pendingLinks.map((p: any) => (
              <li key={p._id} className="text-amber-300">
                {p.handle_channel} · {p.handle_value} ({p.candidate_person_ids.length} candidates)
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notes tab — Obsidian context blob, free-form
// ---------------------------------------------------------------------------
function NotesTab({ person }: { person: any }) {
  return (
    <div className="space-y-4">
      <Section title="Obsidian context">
        {person.obsidian_path ? (
          <div className="text-xs text-gray-500 mb-2">
            <code className="bg-gray-950 px-1 rounded">{person.obsidian_path}</code>
          </div>
        ) : null}
        {person.context_notes
          ? <p className="text-sm text-gray-300 whitespace-pre-wrap">{person.context_notes}</p>
          : <Empty text="No context notes." />}
      </Section>

      <Section title="Interests / goals / values">
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-gray-500 mb-1">interests</div>
            <ul className="space-y-0.5">{(person.interests ?? []).map((s: string, i: number) =>
              <li key={i} className="text-gray-300">· {s}</li>)}</ul>
          </div>
          <div>
            <div className="text-gray-500 mb-1">goals</div>
            <ul className="space-y-0.5">{(person.goals ?? []).map((s: string, i: number) =>
              <li key={i} className="text-gray-300">· {s}</li>)}</ul>
          </div>
          <div>
            <div className="text-gray-500 mb-1">values</div>
            <ul className="space-y-0.5">{(person.values ?? []).map((s: string, i: number) =>
              <li key={i} className="text-gray-300">· {s}</li>)}</ul>
          </div>
        </div>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wave 2.4 Task G — ComposePanel
//
// Bottom of the page. Operator picks a template + clicks Preview.
// touches.scheduleOne fires with preview_only:true → enqueues draft_preview
// agent_job for Mac Mini → runner drafts via _draft_with_template → calls
// touches.setPreviewDraft → this component's reactive subscription updates.
// Operator edits, clicks Send → touches.commitPreview fires the touch.
// ---------------------------------------------------------------------------
function ComposePanel({ person }: { person: any }) {
  const FLEET_USER_ID = "fleet-julian"
  const previews = useQuery(api.touches.listPreviewsForPerson, { person_id: person._id, limit: 10 })
  const scheduleOne = useMutation(api.touches.scheduleOne)
  const commitPreview = useMutation(api.touches.commitPreview)
  const cancelOne = useMutation(api.touches.cancelOne)

  const [template, setTemplate] = useState<string>("context_aware_reply")
  const [busy, setBusy] = useState(false)
  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({})

  async function startPreview() {
    setBusy(true)
    try {
      await scheduleOne({
        user_id: FLEET_USER_ID,
        person_id: person._id,
        type: "reply",
        scheduled_for: Date.now(),
        prompt_template: template,
        generate_at_fire_time: false,
        preview_only: true,
      })
    } finally { setBusy(false) }
  }

  async function send(touch_id: any, body: string) {
    if (!body.trim()) return
    if (!confirm(`Send to ${person.display_name}?\n\n${body}`)) return
    await commitPreview({ touch_id, edited_body: body, scheduled_for_ms: Date.now() })
  }

  const drafting = previews?.filter((p: any) => !p.draft_body) ?? []
  const ready = previews?.filter((p: any) => p.draft_body) ?? []

  return (
    <div className="bg-gray-900 border border-purple-800/40 rounded-lg p-6 mt-6">
      <h2 className="text-lg font-semibold mb-3">Compose / send a touch now</h2>
      <p className="text-xs text-gray-500 mb-4">
        Mac Mini drafts using her interests + curiosity ledger + last 30 messages, applies the 4 hard rules
        (callback / emotion-match / specific-question / no-pivot-to-Julian) and the boundary respect.
        You preview, edit, then send. Whitelist + active-hours + anti-loop still apply.
      </p>

      <div className="flex gap-2 items-center mb-4">
        <select value={template} onChange={(e) => setTemplate(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-sm flex-1">
          {TEMPLATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button onClick={startPreview} disabled={busy}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm">
          {busy ? "queueing…" : "Preview draft"}
        </button>
      </div>

      {drafting.length > 0 && (
        <div className="mb-4 p-3 bg-gray-950 border border-gray-800 rounded">
          <div className="text-xs text-amber-300 mb-1">⏳ Drafting on Mac Mini…</div>
          <ul className="text-xs text-gray-500 space-y-0.5">
            {drafting.map((p: any) => (
              <li key={p._id}>
                {p.prompt_template ?? p.type}{" "}
                <button onClick={() => cancelOne({ touch_id: p._id, reason: "manual_compose_discard" })}
                        className="text-red-400 hover:text-red-300 ml-2">discard</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready.map((p: any) => {
        const body = editedBodies[p._id] ?? p.draft_body ?? ""
        return (
          <div key={p._id} className="mb-4 p-3 bg-gray-950 border border-purple-800/40 rounded">
            <div className="text-xs text-purple-300 mb-2">
              ✦ Draft ready · {p.prompt_template ?? p.type}
            </div>
            <textarea value={body}
                      onChange={(e) => setEditedBodies((prev) => ({ ...prev, [p._id]: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-sm text-gray-200 min-h-[80px]"
                      placeholder="Mac Mini draft will appear here…" />
            <div className="text-[10px] text-gray-600 mt-1">{body.length} chars</div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => send(p._id, body)}
                      className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-1 rounded text-sm">
                Send to {person.display_name}
              </button>
              <button onClick={() => cancelOne({ touch_id: p._id, reason: "manual_compose_discard" })}
                      className="bg-gray-800 hover:bg-red-700 text-gray-300 px-3 py-1 rounded text-sm">
                Discard
              </button>
            </div>
          </div>
        )
      })}

      {previews?.length === 0 && (
        <div className="text-xs text-gray-600">
          Pick a template and click "Preview draft" to start. (Mac Mini takes ~5-15s.)
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  )
}

function Empty({ text = "—" }: { text?: string }) {
  return <div className="text-xs text-gray-600">{text}</div>
}

function KeyVal({ label, v }: { label: string; v: any }) {
  return (
    <div className="text-xs">
      <span className="text-gray-500">{label}:</span>{" "}
      <span className="text-gray-300">{v ?? "—"}</span>
    </div>
  )
}
