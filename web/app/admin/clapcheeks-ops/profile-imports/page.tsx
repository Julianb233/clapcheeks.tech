/**
 * Profile imports — review screenshots of dating-app profiles, AI extracts
 * everything (bio, photos, prompts, zodiac, DISC, openers), one-click create
 * a person row from the analysis.
 */
"use client"

import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState } from "react"

const FLEET_USER_ID = "fleet-julian"

export default function ProfileImportsPage() {
  const screenshots = useQuery(api.profile_import.listForReview, {
    user_id: FLEET_USER_ID, limit: 50,
  })
  const reanalyze = useMutation(api.profile_import.reanalyze)
  const createPerson = useMutation(api.profile_import.createPersonFromProfile)
  const dismiss = useMutation(api.profile_import.dismissProfileScreenshot)

  if (screenshots === undefined) return <div className="p-8 text-gray-500">Loading…</div>

  return (
    <div className="p-8 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">Profile Imports</h1>
      <p className="text-gray-400 mb-6">
        {screenshots.length} screenshots awaiting review. Drop a profile screenshot
        in your iPhone Shortcut with <code className="bg-gray-800 px-1 rounded text-xs">x-cc-kind: profile</code>
        header (or upload via dashboard once that's wired) and AI extracts everything below.
      </p>

      {screenshots.length === 0 && (
        <div className="text-gray-500 text-sm">
          No pending profile imports. Send any Tinder/Bumble/Hinge/IG screenshot via
          your Clapcheeks Shortcut with the profile flag and it'll show up here within ~10s.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {screenshots.map((m: any) => (
          <ScreenshotCard
            key={m._id}
            m={m}
            onCreate={(overrides: any) =>
              createPerson({ media_id: m._id, user_id: FLEET_USER_ID, overrides })
            }
            onReanalyze={() => reanalyze({ media_id: m._id })}
            onDismiss={() => dismiss({ media_id: m._id })}
          />
        ))}
      </div>
    </div>
  )
}

function ScreenshotCard({ m, onCreate, onReanalyze, onDismiss }: any) {
  const [busy, setBusy] = useState(false)
  const data = m.profile_screenshot_data
  const analyzing = !data
  const [overrideName, setOverrideName] = useState<string | null>(null)
  const [overridePlatform, setOverridePlatform] = useState<string | null>(null)

  async function handleCreate() {
    setBusy(true)
    try {
      const overrides: any = {}
      if (overrideName) overrides.display_name = overrideName
      if (overridePlatform) overrides.platform = overridePlatform
      await onCreate(overrides)
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex">
        <div className="w-1/3 bg-gray-950">
          {m.thumbnail_url || m.storage_url ? (
            <img src={m.thumbnail_url || m.storage_url}
                 alt="profile screenshot"
                 className="w-full h-full object-cover" />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-gray-500 p-4">no preview</div>
          )}
        </div>
        <div className="flex-1 p-4 space-y-2 text-sm">
          {analyzing ? (
            <>
              <div className="text-gray-500">Analyzing with Gemini Vision…</div>
              <button onClick={onReanalyze} className="text-xs text-purple-400 hover:text-purple-300">
                retry analyze
              </button>
            </>
          ) : (
            <>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-lg">
                    {data.name || "(name not visible)"}
                    {data.age ? <span className="text-gray-500 font-normal"> · {data.age}</span> : null}
                  </div>
                  <div className="text-xs text-gray-500">
                    {data.platform || "?"} · {data.location || "?"} · {data.occupation || "?"}
                  </div>
                </div>
                <span className="text-xs text-gray-600">
                  conf {(data.confidence ?? 0).toFixed(2)}
                </span>
              </div>

              {data.bio_text && (
                <div className="bg-gray-950 rounded p-2 text-xs text-gray-300 italic max-h-20 overflow-y-auto">
                  &quot;{data.bio_text}&quot;
                </div>
              )}

              {data.likely_zodiac_sign && (
                <div>
                  <div className="text-purple-300 text-xs font-semibold uppercase mt-2">
                    {data.likely_zodiac_sign} · {data.disc || "?"}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{data.zodiac_block}</div>
                </div>
              )}

              {data.opener_suggestions && data.opener_suggestions.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-semibold text-gray-400 uppercase">Suggested openers</div>
                  <ul className="text-xs space-y-1 mt-1">
                    {data.opener_suggestions.slice(0, 3).map((o: string, i: number) => (
                      <li key={i} className="bg-gray-950 rounded px-2 py-1 text-gray-300">{o}</li>
                    ))}
                  </ul>
                </div>
              )}

              {data.green_flags && data.green_flags.length > 0 && (
                <div className="text-xs text-green-400 mt-1">
                  ✓ {data.green_flags.slice(0, 3).join(" · ")}
                </div>
              )}
              {data.red_flags && data.red_flags.length > 0 && (
                <div className="text-xs text-red-400">
                  ⚠ {data.red_flags.slice(0, 3).join(" · ")}
                </div>
              )}

              {data.compatibility_with_julian && (
                <div className="text-xs text-gray-400 italic mt-2">
                  Compat read: {data.compatibility_with_julian}
                </div>
              )}

              <div className="flex gap-2 pt-3">
                <input type="text" placeholder={data.name || "Name"}
                       defaultValue={data.name || ""}
                       onChange={(e) => setOverrideName(e.target.value)}
                       className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs" />
                <select value={overridePlatform ?? data.platform ?? "other"}
                        onChange={(e) => setOverridePlatform(e.target.value)}
                        className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs">
                  <option value="tinder">tinder</option>
                  <option value="bumble">bumble</option>
                  <option value="hinge">hinge</option>
                  <option value="instagram">instagram</option>
                  <option value="other">other</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleCreate} disabled={busy}
                        className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-3 py-1 rounded text-xs">
                  {busy ? "Creating…" : "Create person row"}
                </button>
                <button onClick={onDismiss} className="bg-gray-800 hover:bg-red-700 text-gray-300 px-3 py-1 rounded text-xs">
                  Skip
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
