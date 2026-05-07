/**
 * Media library — approve / deprecate / re-tag.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState } from "react"

const FLEET_USER_ID = "fleet-julian"

export default function MediaLibrary() {
  const [tab, setTab] = useState<"pending" | "approved">("pending")
  const pending = useQuery(api.media.listForApproval, { user_id: FLEET_USER_ID })
  const approved = useQuery(api.media.listApproved, { user_id: FLEET_USER_ID, limit: 100 })
  const approve = useMutation(api.media.approve)
  const deprecate = useMutation(api.media.deprecate)

  const items = tab === "pending" ? pending : approved

  return (
    <div className="p-8 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">Media Library</h1>
      <p className="text-gray-400 mb-6">
        Photos / videos / memes the AI can attach to outbound messages when context fits.
      </p>

      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab("pending")}
                className={`px-4 py-2 rounded-lg text-sm ${tab === "pending" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300"}`}>
          Pending ({pending?.length ?? "—"})
        </button>
        <button onClick={() => setTab("approved")}
                className={`px-4 py-2 rounded-lg text-sm ${tab === "approved" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300"}`}>
          Approved ({approved?.length ?? "—"})
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items === undefined && <div className="text-gray-500">Loading…</div>}
        {items && items.length === 0 && (
          <div className="text-gray-500 col-span-full">
            {tab === "pending"
              ? "No pending media. Drop photos into ~/Google Drive/Other computers/Mac mini/Clapcheeks Media."
              : "No approved media yet."}
          </div>
        )}
        {items?.map((m: any) => (
          <div key={m._id} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {m.thumbnail_url || m.storage_url ? (
              <img src={m.thumbnail_url || m.storage_url} alt={m.caption || ""}
                   className="w-full h-48 object-cover" />
            ) : (
              <div className="w-full h-48 bg-gray-800 flex items-center justify-center text-gray-500">
                no preview
              </div>
            )}
            <div className="p-3 space-y-1">
              <div className="text-sm font-medium truncate">{m.caption || m.asset_id}</div>
              <div className="text-xs text-gray-500">
                {m.kind} · vibe={m.vibe ?? "—"} · flex={m.flex_level ?? "—"} · used={m.used_count ?? 0}
              </div>
              <div className="text-xs text-gray-400 line-clamp-2">
                {(m.tags ?? []).slice(0, 6).join(", ") || "(untagged — auto-tag pending)"}
              </div>
              <div className="text-xs text-gray-500 line-clamp-2">
                hooks: {(m.context_hooks ?? []).slice(0, 4).join(", ") || "—"}
              </div>
              <div className="flex gap-2 pt-2">
                {tab === "pending" ? (
                  <>
                    <button onClick={() => approve({ asset_id: m._id })}
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs">
                      Approve
                    </button>
                    <button onClick={() => deprecate({ asset_id: m._id })}
                            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1 rounded text-xs">
                      Skip
                    </button>
                  </>
                ) : (
                  <button onClick={() => deprecate({ asset_id: m._id })}
                          className="flex-1 bg-gray-800 hover:bg-red-700 text-gray-300 px-3 py-1 rounded text-xs">
                    Deprecate
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
