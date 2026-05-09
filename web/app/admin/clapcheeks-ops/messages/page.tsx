/**
 * AI-9643 — Live messages ops dashboard.
 *
 * Three-zone layout:
 *   - LEFT (live feed): real-time stream of recent inbound + outbound messages
 *     across the entire network. Convex `useQuery` pushes new rows the moment
 *     BlueBubbles / Hinge / IG webhooks land. Filter chips + name search.
 *   - RIGHT TOP (next 24h schedule): touches firing in the next 24h with quick
 *     actions (send now, regenerate, edit draft inline, cancel).
 *   - RIGHT BOTTOM (comms prefs): editable preferences panel for whichever
 *     person is currently selected in the feed.
 *
 * Click any message row → focuses that person in the right rail.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Id } from "@/convex/_generated/dataModel"
import Link from "next/link"
import { useMemo, useState, useEffect, useRef } from "react"
import { CommsPreferencesPanel } from "@/components/clapcheeks-ops/comms-preferences-panel"

const FLEET_USER_ID = "fleet-julian"

type FilterKind = "all" | "inbound" | "needs_response" | "cooling" | "hot"

const TWELVE_H = 12 * 3600 * 1000
const THREE_D = 3 * 24 * 3600 * 1000
const THIRTY_D = 30 * 24 * 3600 * 1000

export default function LiveMessagesDashboard() {
  const [filter, setFilter] = useState<FilterKind>("all")
  const [search, setSearch] = useState("")
  const [focusedPersonId, setFocusedPersonId] = useState<string | null>(null)
  const [pingOnInbound, setPingOnInbound] = useState(false)

  const recent = useQuery(api.messages.recentForUser, { user_id: FLEET_USER_ID, limit: 100 })
  const people = useQuery(api.people.listForUser, { user_id: FLEET_USER_ID, limit: 2000, only_cc_tech: false })
  const upcoming = useQuery(api.touches.listUpcoming, {
    user_id: FLEET_USER_ID, horizon_hours: 24, limit: 100,
  })

  // Build a fast person index keyed by id so each message can render display_name + signals.
  const peopleById = useMemo(() => {
    const m = new Map<string, any>()
    for (const p of people ?? []) m.set(p._id, p)
    return m
  }, [people])

  // Annotate each message with the person row + a "needs response" flag.
  type EnrichedRow = { msg: any; person: any | null; isNeedsResponse: boolean }
  const enriched = useMemo<EnrichedRow[]>(() => {
    if (!recent) return []
    return recent
      .map((m: any): EnrichedRow => {
        const p = m.person_id ? peopleById.get(m.person_id) : null
        const isNeedsResponse =
          m.direction === "inbound" &&
          !!p &&
          (!p.last_outbound_at || p.last_outbound_at < (m.sent_at ?? 0))
        return { msg: m, person: p, isNeedsResponse }
      })
      .filter((row: EnrichedRow) => {
        if (search) {
          const q = search.toLowerCase()
          const name = (row.person?.display_name ?? "").toLowerCase()
          const body = (row.msg?.body ?? "").toLowerCase()
          if (!name.includes(q) && !body.includes(q)) return false
        }
        if (filter === "inbound") return row.msg.direction === "inbound"
        if (filter === "needs_response") return row.isNeedsResponse
        if (filter === "cooling") {
          const p = row.person
          if (!p?.last_inbound_at) return false
          const sinceIn = Date.now() - p.last_inbound_at
          return sinceIn >= THREE_D && sinceIn < THIRTY_D
        }
        if (filter === "hot") return (row.person?.cadence_profile === "hot")
        return true
      })
  }, [recent, peopleById, filter, search])

  // Audio ping on first new inbound. Debounced + only after explicit opt-in.
  const lastSeenInboundRef = useRef<number>(Date.now())
  useEffect(() => {
    if (!pingOnInbound || !recent?.length) return
    const newestInbound = recent.find((m: any) => m.direction === "inbound")
    if (!newestInbound) return
    if (newestInbound.sent_at > lastSeenInboundRef.current) {
      lastSeenInboundRef.current = newestInbound.sent_at
      try {
        // tiny WebAudio blip (no asset needed)
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.value = 880
        g.gain.value = 0.04
        o.connect(g); g.connect(ctx.destination)
        o.start(); o.stop(ctx.currentTime + 0.12)
      } catch { /* no-op */ }
    }
  }, [recent, pingOnInbound])

  const focusedPerson = focusedPersonId ? peopleById.get(focusedPersonId) : null

  // Counts for the chips (only the visible portion after search).
  const counts = useMemo(() => {
    const visible = (recent ?? []).filter((m: any) => {
      if (!search) return true
      const p = m.person_id ? peopleById.get(m.person_id) : null
      const q = search.toLowerCase()
      const name = (p?.display_name ?? "").toLowerCase()
      const body = (m.body ?? "").toLowerCase()
      return name.includes(q) || body.includes(q)
    })
    const inbound = visible.filter((m: any) => m.direction === "inbound").length
    const needsResp = visible.filter((m: any) => {
      if (m.direction !== "inbound" || !m.person_id) return false
      const p = peopleById.get(m.person_id)
      if (!p) return false
      return !p.last_outbound_at || p.last_outbound_at < (m.sent_at ?? 0)
    }).length
    return { all: visible.length, inbound, needsResp }
  }, [recent, peopleById, search])

  if (recent === undefined || people === undefined) {
    return <div className="p-8 text-gray-500">Loading live feed...</div>
  }

  return (
    <div className="p-3 sm:p-6 max-w-[1600px]">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Live messages</h1>
          <p className="text-gray-500 text-xs">Real-time. Updates the moment a message lands. Click a row to focus.</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer text-gray-400">
            <input type="checkbox" checked={pingOnInbound} onChange={(e) => setPingOnInbound(e.target.checked)} />
            ping on inbound
          </label>
          <Link href="/admin/clapcheeks-ops/touches" className="text-purple-400 hover:text-purple-300">all touches →</Link>
          <Link href="/admin/clapcheeks-ops/network" className="text-purple-400 hover:text-purple-300">network →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT — live feed */}
        <div className="lg:col-span-2">
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>All ({counts.all})</Chip>
            <Chip active={filter === "inbound"} onClick={() => setFilter("inbound")}>Inbound ({counts.inbound})</Chip>
            <Chip active={filter === "needs_response"} onClick={() => setFilter("needs_response")} accent="rose">
              Needs response ({counts.needsResp})
            </Chip>
            <Chip active={filter === "cooling"} onClick={() => setFilter("cooling")} accent="amber">Cooling</Chip>
            <Chip active={filter === "hot"} onClick={() => setFilter("hot")} accent="pink">Hot cadence</Chip>
            <input
              type="text"
              value={search}
              placeholder="search name or body..."
              onChange={(e) => setSearch(e.target.value)}
              className="ml-auto bg-gray-950 border border-gray-800 rounded px-3 py-1.5 text-xs w-48"
            />
          </div>

          <div className="space-y-1.5 max-h-[78vh] overflow-y-auto pr-2">
            {enriched.length === 0 ? (
              <div className="text-gray-500 text-sm py-8 text-center">
                No messages match. Try clearing the filter or search.
              </div>
            ) : enriched.map((row: EnrichedRow) => (
              <MessageRow
                key={row.msg._id}
                msg={row.msg}
                person={row.person}
                isNeedsResponse={row.isNeedsResponse}
                focused={focusedPersonId === row.person?._id}
                onFocus={() => row.person?._id && setFocusedPersonId(row.person._id)}
              />
            ))}
          </div>
        </div>

        {/* RIGHT — schedule + prefs */}
        <div className="space-y-4">
          <NextTouchesColumn upcoming={upcoming} peopleById={peopleById} onFocusPerson={setFocusedPersonId} />
          {focusedPerson ? (
            <CommsPreferencesPanel person={focusedPerson} compact />
          ) : (
            <div className="bg-gray-900 border border-dashed border-gray-800 rounded-lg p-4 text-xs text-gray-500">
              Click any message row on the left to load that person's communication preferences here.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------

function MessageRow({
  msg, person, isNeedsResponse, focused, onFocus,
}: {
  msg: any; person: any | null; isNeedsResponse: boolean; focused: boolean; onFocus: () => void;
}) {
  const isOut = msg.direction === "outbound"
  const ago = formatAgo(msg.sent_at)
  const platform: string = inferPlatform(msg)
  const channelChip = PLATFORM_CHIP[platform] ?? PLATFORM_CHIP.imessage

  // Insight chips on the row — date-ask readiness, quiet thread, hot cadence.
  const dateAskReady = typeof person?.time_to_ask_score === "number" && person.time_to_ask_score >= 0.7
  const isQuiet = typeof person?.her_question_ratio_7d === "number"
    && person.her_question_ratio_7d < 0.15
    && person?.last_inbound_at && (Date.now() - person.last_inbound_at) > 24 * 3600 * 1000

  return (
    <div
      onClick={onFocus}
      className={`group cursor-pointer rounded-lg border px-3 py-2 transition-colors ${
        focused
          ? "border-purple-600 bg-purple-950/30"
          : isNeedsResponse
          ? "border-rose-800/60 bg-rose-950/20 hover:border-rose-600"
          : "border-gray-800 bg-gray-900 hover:border-gray-600"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Direction marker */}
        <div className={`shrink-0 mt-1 w-1.5 h-1.5 rounded-full ${
          isNeedsResponse ? "bg-rose-400" : isOut ? "bg-purple-500" : "bg-emerald-500"
        }`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-medium text-gray-100 truncate">
              {person?.display_name ?? "(unlinked)"}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${channelChip.cls}`}>
              {channelChip.icon} {platform}
            </span>
            <span className={`text-[10px] ${isOut ? "text-purple-400" : "text-emerald-400"}`}>
              {isOut ? "→ sent" : "← inbound"}
            </span>
            <span className="text-[10px] text-gray-500">{ago}</span>
            {dateAskReady && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-900/40 text-pink-200 border border-pink-700/50" title="time_to_ask_score >= 0.7">
                🎯 ask now
              </span>
            )}
            {isQuiet && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-200 border border-amber-700/50" title="her_question_ratio_7d < 0.15">
                💤 quiet
              </span>
            )}
            {person?.cadence_profile === "hot" && (
              <span className="text-[10px] text-rose-400">🔥 hot cadence</span>
            )}
          </div>
          <div className="text-sm text-gray-200 mt-0.5 line-clamp-2 whitespace-pre-wrap">
            {msg.body || <span className="text-gray-600 italic">(no body)</span>}
          </div>
        </div>

        {person?._id && (
          <Link
            href={`/admin/clapcheeks-ops/people/${person._id}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-[10px] text-purple-400 hover:text-purple-300 underline self-center"
          >
            dossier
          </Link>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------

function NextTouchesColumn({
  upcoming, peopleById, onFocusPerson,
}: {
  upcoming: any[] | undefined;
  peopleById: Map<string, any>;
  onFocusPerson: (id: string) => void;
}) {
  const cancel = useMutation(api.touches.cancelOne)
  const fireNow = useMutation(api.touches.fireNow)
  const regenerate = useMutation(api.touches.regenerateDraft)
  const editDraft = useMutation(api.touches.editDraft)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftText, setDraftText] = useState("")

  if (upcoming === undefined) {
    return <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-xs text-gray-500">Loading schedule...</div>
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-gray-200">Next 24h schedule</div>
        <span className="text-[11px] text-gray-500">{upcoming.length} queued</span>
      </div>
      {upcoming.length === 0 ? (
        <div className="text-xs text-gray-500 py-2">Nothing queued in the next 24h.</div>
      ) : (
        <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-1">
          {upcoming.map((t: any) => {
            const person = t.person_id ? peopleById.get(t.person_id) : null
            const fireIn = t.scheduled_for - Date.now()
            const fireInText = fireIn < 60_000 ? "now" : fireIn < 3_600_000
              ? `in ${Math.round(fireIn / 60_000)}m`
              : `at ${new Date(t.scheduled_for).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            const isEditing = editingId === t._id
            return (
              <div key={t._id} className={`rounded border ${t.urgency === "hot" ? "border-rose-800/60" : "border-gray-800"} bg-gray-950/40 p-2`}>
                <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
                  <button
                    onClick={() => person?._id && onFocusPerson(person._id)}
                    className="font-medium text-gray-100 hover:text-purple-300 truncate"
                  >
                    {person?.display_name ?? "(unlinked)"}
                  </button>
                  <span className="text-gray-600">·</span>
                  <span className="text-purple-300">{t.type.replace(/_/g, " ")}</span>
                  <span className="text-gray-600">·</span>
                  <span className="text-amber-300">{fireInText}</span>
                  {t.urgency && (
                    <span className={`text-[10px] px-1 py-0.5 rounded ${
                      t.urgency === "hot" ? "bg-rose-900 text-rose-200"
                      : t.urgency === "warm" ? "bg-yellow-900 text-yellow-200"
                      : "bg-gray-800 text-gray-400"
                    }`}>{t.urgency}</span>
                  )}
                </div>

                {/* Draft body / edit textarea */}
                {isEditing ? (
                  <div className="mt-1.5">
                    <textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={3}
                      className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs"
                      placeholder="rewrite..."
                    />
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        onClick={async () => {
                          await editDraft({ touch_id: t._id, draft_body: draftText })
                          setEditingId(null)
                        }}
                        className="text-[11px] px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white"
                      >save</button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
                      >cancel</button>
                    </div>
                  </div>
                ) : t.draft_body ? (
                  <div className="text-xs text-gray-300 mt-1 line-clamp-2">{t.draft_body}</div>
                ) : (
                  <div className="text-xs text-gray-600 mt-1 italic">drafting at fire time...</div>
                )}

                {!isEditing && (
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <ActionButton
                      label="Send now"
                      kind="hot"
                      onClick={() => fireNow({ touch_id: t._id })}
                    />
                    <ActionButton
                      label="Regenerate"
                      onClick={() => regenerate({ touch_id: t._id })}
                    />
                    <ActionButton
                      label="Edit"
                      onClick={() => { setEditingId(t._id); setDraftText(t.draft_body ?? "") }}
                    />
                    <ActionButton
                      label="Cancel"
                      kind="muted"
                      onClick={() => cancel({ touch_id: t._id, reason: "manual_cancel_dashboard" })}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function Chip({
  active, onClick, accent, children,
}: { active: boolean; onClick: () => void; accent?: "rose" | "amber" | "pink"; children: React.ReactNode }) {
  const accentCls = accent === "rose"
    ? "bg-rose-900/40 border-rose-700 text-rose-200"
    : accent === "amber"
    ? "bg-amber-900/40 border-amber-700 text-amber-200"
    : accent === "pink"
    ? "bg-pink-900/40 border-pink-700 text-pink-200"
    : "bg-purple-900/40 border-purple-700 text-purple-200"
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1 rounded border ${
        active ? accentCls : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600"
      }`}
    >
      {children}
    </button>
  )
}

function ActionButton({
  label, onClick, kind,
}: { label: string; onClick: () => void; kind?: "hot" | "muted" }) {
  const cls = kind === "hot"
    ? "bg-purple-700 hover:bg-purple-600 text-white"
    : kind === "muted"
    ? "bg-gray-900 hover:bg-gray-800 text-gray-500 hover:text-rose-300"
    : "bg-gray-800 hover:bg-gray-700 text-gray-200"
  return (
    <button onClick={onClick} className={`text-[11px] px-2 py-0.5 rounded ${cls}`}>{label}</button>
  )
}

const PLATFORM_CHIP: Record<string, { icon: string; cls: string }> = {
  imessage: { icon: "📱", cls: "border-blue-700/60 text-blue-300" },
  hinge: { icon: "💜", cls: "border-purple-700/60 text-purple-300" },
  bumble: { icon: "🟡", cls: "border-yellow-700/60 text-yellow-300" },
  tinder: { icon: "🔴", cls: "border-rose-700/60 text-rose-300" },
  instagram: { icon: "📷", cls: "border-pink-700/60 text-pink-300" },
  telegram: { icon: "✈️", cls: "border-cyan-700/60 text-cyan-300" },
  email: { icon: "✉️", cls: "border-gray-700/60 text-gray-300" },
  sms: { icon: "💬", cls: "border-emerald-700/60 text-emerald-300" },
  whatsapp: { icon: "🟢", cls: "border-green-700/60 text-green-300" },
}

function inferPlatform(msg: any): string {
  if (msg.transport === "sms") return "sms"
  if (msg._platform) return msg._platform
  return "imessage"
}

function formatAgo(ts?: number | null): string {
  if (!ts) return "—"
  const diff = Date.now() - ts
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}
