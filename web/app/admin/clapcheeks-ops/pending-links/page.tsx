/**
 * Pending links — conversations whose handle didn't auto-link to a single
 * person row. Manual disambiguation: pick a candidate, or ignore.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"

const FLEET_USER_ID = "fleet-julian"

export default function PendingLinksPage() {
  const links = useQuery(api.people.listPendingLinks, { user_id: FLEET_USER_ID, limit: 100 })
  const resolve = useMutation(api.people.resolvePendingLink)
  const ignore = useMutation(api.people.ignorePendingLink)

  if (links === undefined) return <div className="p-8 text-gray-500">Loading…</div>

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-2">Pending Links</h1>
      <p className="text-gray-400 mb-6">
        {links.length} conversations with ambiguous matches. Pick the right person
        or ignore (spam/unknown). Resolves the conversation + all its messages.
      </p>

      {links.length === 0 && (
        <div className="text-gray-500 text-sm">
          No pending links. The auto-linker resolved every recent conversation
          to exactly one person — no human intervention needed.
        </div>
      )}

      <div className="space-y-4">
        {links.map((link: any) => (
          <div key={link._id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="font-mono text-sm">{link.handle_value}</div>
                <div className="text-xs text-gray-500">
                  {link.handle_channel} · {new Date(link.created_at).toLocaleString()}
                </div>
              </div>
              <button onClick={() => ignore({ pending_id: link._id })}
                      className="text-xs text-gray-500 hover:text-red-400">
                ignore
              </button>
            </div>

            {link.raw_context && (
              <div className="bg-gray-950 rounded p-2 text-sm text-gray-300 mb-3 italic">
                &quot;{link.raw_context}&quot;
              </div>
            )}

            <div className="text-xs text-gray-500 mb-2">
              {link.candidates.length === 0
                ? "No candidate matches — would need to create a new people row first."
                : `${link.candidates.length} candidate match${link.candidates.length === 1 ? "" : "es"}:`}
            </div>

            <div className="space-y-2">
              {link.candidates.map((c: any) => (
                <div key={c._id} className="flex justify-between items-center bg-gray-950 rounded p-2">
                  <div>
                    <div className="text-sm font-medium">{c.display_name}</div>
                    <div className="text-xs text-gray-500">
                      {c.courtship_stage || "—"} · {c.status || "—"}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {(c.handles ?? []).map((h: any) => `${h.channel}:${h.value}`).join(" · ")}
                    </div>
                  </div>
                  <button onClick={() => resolve({ pending_id: link._id, person_id: c._id })}
                          className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 rounded text-xs">
                    use this
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
