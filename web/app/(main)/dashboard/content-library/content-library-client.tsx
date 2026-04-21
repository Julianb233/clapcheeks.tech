'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { LibraryRow, QueueRow } from './page'

const CATEGORY_LABELS: Record<string, string> = {
  beach_house_work_from_home: 'Beach house / WFH',
  beach_active: 'Beach active',
  dog_faith: 'Dog + faith',
  entrepreneur_behind_scenes: 'Entrepreneur BTS',
  ted_talk_speaking: 'Speaking / TED',
  food_drinks_mission_beach: 'Food / Mission Beach',
}

const CATEGORY_COLORS: Record<string, string> = {
  beach_house_work_from_home: 'bg-sky-500/20 text-sky-300 border-sky-400/30',
  beach_active: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
  dog_faith: 'bg-amber-500/20 text-amber-300 border-amber-400/30',
  entrepreneur_behind_scenes: 'bg-violet-500/20 text-violet-300 border-violet-400/30',
  ted_talk_speaking: 'bg-rose-500/20 text-rose-300 border-rose-400/30',
  food_drinks_mission_beach: 'bg-orange-500/20 text-orange-300 border-orange-400/30',
}

type Props = {
  initialLibrary: LibraryRow[]
  initialQueue: QueueRow[]
  userId: string
}

type View = 'grid' | 'calendar'

export default function ContentLibraryClient({
  initialLibrary,
  initialQueue,
  userId,
}: Props) {
  const [library, setLibrary] = useState<LibraryRow[]>(initialLibrary)
  const [queue, setQueue] = useState<QueueRow[]>(initialQueue)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('grid')
  const [busyId, setBusyId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const row of library) {
      counts[row.category] = (counts[row.category] || 0) + 1
    }
    return counts
  }, [library])

  const postedCount = useMemo(
    () => library.filter((r) => r.posted_at).length,
    [library],
  )

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null)
      setUploading(true)

      const supabase = createClient()
      const list = Array.from(files)
      try {
        for (const file of list) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
          const mediaPath = `${userId}/${Date.now()}-${safeName}`

          const { error: upErr } = await supabase
            .storage
            .from('julian-content')
            .upload(mediaPath, file, {
              cacheControl: '3600',
              upsert: false,
              contentType: file.type || 'image/jpeg',
            })
          if (upErr) {
            throw new Error(`upload failed: ${upErr.message}`)
          }

          // Categorize via our API (Claude Vision) before inserting.
          let category = 'entrepreneur_behind_scenes'
          let target_time_of_day = 'anytime'
          try {
            const resp = await fetch('/api/content-library/categorize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ media_path: mediaPath }),
            })
            if (resp.ok) {
              const data = await resp.json()
              category = data.category || category
              target_time_of_day = data.target_time_of_day || 'anytime'
            }
          } catch {
            // non-fatal; just use default category.
          }

          const { data: insertData, error: insErr } = await supabase
            .from('clapcheeks_content_library' as any)
            .insert({
              user_id: userId,
              media_path: mediaPath,
              media_type: file.type.startsWith('video') ? 'video' : 'photo',
              category,
              target_time_of_day,
              post_type: 'story',
            } as any)
            .select('*')
            .single()

          if (insErr) {
            throw new Error(`insert failed: ${insErr.message}`)
          }

          const { data: signed } = await supabase
            .storage
            .from('julian-content')
            .createSignedUrl(mediaPath, 3600)

          setLibrary((prev) => [
            { ...(insertData as LibraryRow), signed_url: signed?.signedUrl ?? null },
            ...prev,
          ])
        }
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [userId],
  )

  const onFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadFiles(e.target.files)
      }
    },
    [uploadFiles],
  )

  async function updateCategory(id: string, category: string) {
    setBusyId(id)
    const supabase = createClient()
    try {
      const { error: updErr } = await supabase
        .from('clapcheeks_content_library' as any)
        .update({ category } as any)
        .eq('id', id)
      if (updErr) throw new Error(updErr.message)
      setLibrary((prev) =>
        prev.map((r) => (r.id === id ? { ...r, category } : r)),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function postNow(id: string) {
    setBusyId(id)
    try {
      const resp = await fetch('/api/content-library/post-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_library_id: id }),
      })
      const data = await resp.json()
      if (!resp.ok || !data.ok) {
        throw new Error(data.reason || data.error || 'post failed')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function autoFill() {
    setBusyId('__autofill__')
    try {
      const resp = await fetch('/api/content-library/auto-fill', {
        method: 'POST',
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'auto-fill failed')
      const { data: freshQueue } = await (createClient() as any)
        .from('clapcheeks_posting_queue')
        .select('id, content_library_id, scheduled_for, status, posted_at, error')
        .eq('user_id', userId)
        .in('status', ['pending', 'in_progress'])
        .order('scheduled_for', { ascending: true })
        .limit(100)
      if (freshQueue) setQueue(freshQueue as QueueRow[])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // Calendar grouping: map yyyy-mm-dd -> queue rows
  const byDate = useMemo(() => {
    const map: Record<string, QueueRow[]> = {}
    for (const q of queue) {
      const d = q.scheduled_for?.slice(0, 10)
      if (!d) continue
      map[d] = map[d] || []
      map[d].push(q)
    }
    return map
  }, [queue])

  const days = useMemo(() => {
    const out: string[] = []
    const now = new Date()
    for (let i = 0; i < 14; i++) {
      const d = new Date(now)
      d.setDate(now.getDate() + i)
      out.push(d.toISOString().slice(0, 10))
    }
    return out
  }, [])

  const libById = useMemo(() => {
    const m: Record<string, LibraryRow> = {}
    for (const r of library) m[r.id] = r
    return m
  }, [library])

  return (
    <div>
      {/* Summary strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total items" value={library.length} />
        <Stat label="Posted" value={postedCount} />
        <Stat label="Scheduled" value={queue.length} />
        <Stat label="Categories" value={Object.keys(categoryCounts).length} />
      </div>

      {/* Uploader */}
      <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-medium text-white">Upload media</h2>
            <p className="mt-1 text-sm text-white/50">
              Drop photos or videos. We auto-categorize via Claude Vision.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Choose files'}
            </button>
            <button
              type="button"
              onClick={autoFill}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/5 disabled:opacity-50"
              disabled={busyId === '__autofill__'}
            >
              {busyId === '__autofill__' ? 'Filling...' : 'Auto-fill this week'}
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={onFiles}
        />
        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* View toggle */}
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setView('grid')}
          className={`rounded-md px-3 py-1.5 text-sm ${
            view === 'grid'
              ? 'bg-white/10 text-white'
              : 'text-white/50 hover:text-white'
          }`}
        >
          Library grid
        </button>
        <button
          type="button"
          onClick={() => setView('calendar')}
          className={`rounded-md px-3 py-1.5 text-sm ${
            view === 'calendar'
              ? 'bg-white/10 text-white'
              : 'text-white/50 hover:text-white'
          }`}
        >
          Schedule ({queue.length})
        </button>
      </div>

      {view === 'grid' ? (
        <LibraryGrid
          library={library}
          busyId={busyId}
          onPostNow={postNow}
          onChangeCategory={updateCategory}
        />
      ) : (
        <Calendar days={days} byDate={byDate} libById={libById} />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-white/40">
        {label}
      </div>
    </div>
  )
}

function CategoryPill({
  category,
  onClick,
}: {
  category: string
  onClick?: () => void
}) {
  const cls =
    CATEGORY_COLORS[category] ||
    'bg-white/10 text-white/70 border-white/20'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-xs ${cls}`}
    >
      {CATEGORY_LABELS[category] || category}
    </button>
  )
}

function LibraryGrid({
  library,
  busyId,
  onPostNow,
  onChangeCategory,
}: {
  library: LibraryRow[]
  busyId: string | null
  onPostNow: (id: string) => void
  onChangeCategory: (id: string, cat: string) => void
}) {
  if (library.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-white/50">
        No content yet. Upload some photos above.
      </div>
    )
  }
  const byCategory = new Map<string, LibraryRow[]>()
  for (const row of library) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, [])
    byCategory.get(row.category)!.push(row)
  }
  const order = Object.keys(CATEGORY_LABELS)
  return (
    <div className="space-y-8">
      {order.map((cat) => {
        const rows = byCategory.get(cat) || []
        if (rows.length === 0) return null
        return (
          <section key={cat}>
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-white/80">
                {CATEGORY_LABELS[cat]}{' '}
                <span className="text-white/40">({rows.length})</span>
              </h3>
            </header>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {rows.map((row) => (
                <LibraryCard
                  key={row.id}
                  row={row}
                  busy={busyId === row.id}
                  onPostNow={() => onPostNow(row.id)}
                  onChangeCategory={(c) => onChangeCategory(row.id, c)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function LibraryCard({
  row,
  busy,
  onPostNow,
  onChangeCategory,
}: {
  row: LibraryRow
  busy: boolean
  onPostNow: () => void
  onChangeCategory: (c: string) => void
}) {
  const posted = !!row.posted_at
  const views = (row.performance_jsonb as { view_count?: number })?.view_count
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="relative aspect-[3/4] bg-black">
        {row.signed_url ? (
          <img
            src={row.signed_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/20">
            no preview
          </div>
        )}
        {posted && (
          <div className="absolute left-2 top-2 rounded-md bg-green-500/30 px-2 py-0.5 text-[10px] font-medium text-green-100 ring-1 ring-green-400/40">
            Posted
          </div>
        )}
      </div>
      <div className="p-3 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <CategoryPill category={row.category} />
          {typeof views === 'number' && (
            <span className="text-xs text-white/40">{views} views</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.keys(CATEGORY_LABELS)
            .filter((c) => c !== row.category)
            .slice(0, 3)
            .map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChangeCategory(c)}
                className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50 hover:bg-white/5"
              >
                {'->'} {CATEGORY_LABELS[c].split(' ')[0]}
              </button>
            ))}
        </div>
        {!posted && (
          <button
            type="button"
            onClick={onPostNow}
            disabled={busy}
            className="mt-3 w-full rounded-md bg-violet-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? 'Posting...' : 'Post now'}
          </button>
        )}
      </div>
    </div>
  )
}

function Calendar({
  days,
  byDate,
  libById,
}: {
  days: string[]
  byDate: Record<string, QueueRow[]>
  libById: Record<string, LibraryRow>
}) {
  return (
    <div className="space-y-2">
      {days.map((d) => {
        const entries = byDate[d] || []
        const dt = new Date(`${d}T12:00:00Z`)
        const weekday = dt.toLocaleDateString(undefined, { weekday: 'short' })
        const monthday = dt.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
        return (
          <div
            key={d}
            className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3"
          >
            <div className="w-24 text-sm text-white/60">
              <div className="uppercase tracking-wide text-[10px] text-white/40">
                {weekday}
              </div>
              <div className="text-white/90">{monthday}</div>
            </div>
            {entries.length === 0 ? (
              <div className="text-xs text-white/30">No posts scheduled</div>
            ) : (
              <div className="flex flex-1 flex-wrap gap-2">
                {entries.map((e) => {
                  const lib = libById[e.content_library_id]
                  if (!lib) return null
                  const time = new Date(e.scheduled_for).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs"
                    >
                      {lib.signed_url && (
                        <img
                          src={lib.signed_url}
                          alt=""
                          className="h-10 w-8 rounded object-cover"
                        />
                      )}
                      <div>
                        <div className="text-white/80">
                          {time}{' '}
                          {e.status === 'in_progress' && (
                            <span className="text-amber-300">(posting)</span>
                          )}
                        </div>
                        <CategoryPill category={lib.category} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
