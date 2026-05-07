/**
 * Wave 2.4 Task B — Person dossier deep-dive route.
 *
 * Click any person in /admin/clapcheeks-ops/network → land here. Tabs:
 *   Timeline / Memory / Schedule / Media / Profile / Notes
 *
 * Wave 2.4 Task G — Compose panel ("Send a touch now"):
 *   pick template → click Preview → Mac Mini drafts → editable textarea → Send.
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
    <div className="p-8 max-w-7xl">
      <div className="mb-4">
        <Link href="/admin/clapcheeks-ops/network" className="text-xs text-gray-500 hover:text-gray-300">
          ← back to network
        </Link>
      </div>

      <HeaderCard person={person} />

      <div className="mt-6 flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-t-md ${
              tab === t
                ? "bg-gray-900 text-white border border-gray-800 border-b-transparent"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 border-t-0 rounded-b-md p-6 mb-8">
        {tab === "Timeline" && <TimelineTab messages={messages} conversations={conversations} />}
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

  return (
    <div className="bg-gradient-to-br from-purple-900/20 to-gray-900 border border-purple-800/40 rounded-lg p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{person.display_name}</h1>
            {person.age && <span className="text-gray-500">· {person.age}</span>}
            <span className={`text-xs px-2 py-0.5 rounded ${
              person.whitelist_for_autoreply
                ? "bg-green-900 text-green-300" : "bg-gray-800 text-gray-500"
            }`}>
              {person.whitelist_for_autoreply ? "✓ whitelisted" : "○ manual only"}
            </span>
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {person.location_observed || person.company || "—"}
            {person.occupation_observed ? ` · ${person.occupation_observed}` : ""}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-gray-400">
            <span>stage: <b className="text-purple-300">{person.courtship_stage ?? "early_chat"}</b></span>
            <span>cadence: {person.cadence_profile}</span>
            <span>vibe: {person.conversation_temperature ?? "—"}</span>
            <span>last emotion: {lastEmotion}</span>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span>inbound {lastInbound}</span>
            <span>outbound {lastOutbound}</span>
            <span>trust {trust}</span>
            <span>ask-readiness {tta}</span>
            <span>messages 30d {person.total_messages_30d ?? 0}</span>
          </div>
        </div>
        <div className="text-right text-xs text-gray-500 max-w-sm">
          {person.next_best_move && (
            <div className="text-purple-300 italic">💡 {person.next_best_move}</div>
          )}
          {person.zodiac_sign && (
            <div className="mt-2 capitalize">♈ {person.zodiac_sign} · {person.disc_inference || "DISC ?"}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timeline tab — recent messages, ascending (oldest first within the slice)
// ---------------------------------------------------------------------------
function TimelineTab({ messages, conversations }: { messages: any[]; conversations: any[] }) {
  const ordered = useMemo(() => [...messages].reverse(), [messages]) // newest at bottom
  if (!ordered.length) {
    return <div className="text-gray-500 text-sm">No messages yet.</div>
  }
  const platforms = Array.from(new Set(conversations.map((c) => c.platform)))
  return (
    <div>
      <div className="text-xs text-gray-500 mb-3">
        {ordered.length} messages across {conversations.length} conversation(s) · {platforms.join(", ")}
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
        {ordered.map((m: any) => {
          const isOut = m.direction === "outbound"
          const ts = new Date(m.sent_at).toLocaleString()
          return (
            <div key={m._id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-lg px-3 py-2 ${
                isOut ? "bg-purple-700/40 border border-purple-700/60" : "bg-gray-800 border border-gray-700"
              }`}>
                <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                <div className="text-[10px] text-gray-500 mt-1">
                  {ts} · {m.transport ?? m.source ?? "—"}
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
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
// Schedule tab — pending touches and recent fires
// ---------------------------------------------------------------------------
function ScheduleTab({ person, touches }: { person: any; touches: any[] }) {
  const cancelMut = useMutation(api.touches.cancelOne)
  const upcoming = touches.filter((t) => t.status === "scheduled" && !t.is_preview)
  const fired = touches.filter((t) => t.status === "fired").slice(0, 10)
  const skipped = touches.filter((t) => t.status === "skipped").slice(0, 10)

  return (
    <div className="space-y-6">
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
