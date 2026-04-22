'use client'

import {
  ArrowLeft,
  ArrowUpDown,
  Check,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const CATEGORIES = [
  'drop_in',
  'selfie',
  'activity',
  'full_body',
  'group',
  'pets',
  'hobby',
  'uncategorized',
] as const
type Category = (typeof CATEGORIES)[number]

const CATEGORY_LABEL: Record<Category, string> = {
  drop_in: 'Drop-in',
  selfie: 'Selfie',
  activity: 'Activity',
  full_body: 'Full body',
  group: 'Group',
  pets: 'Pets',
  hobby: 'Hobby',
  uncategorized: 'Uncategorized',
}

interface Photo {
  id: string
  userId: string
  storagePath: string
  category: string
  source: string | null
  sourceRef: string | null
  caption: string | null
  width: number | null
  height: number | null
  bytes: number | null
  mimeType: string | null
  createdAt: string
  updatedAt: string
  aiScore: number | null
  aiScoreReason: string | null
  aiCategorySuggested: string | null
  aiCategorizedAt: string | null
  signedUrl: string | null
}

type SortMode = 'score' | 'date'

interface LibraryResponse {
  photos: Photo[]
}

function scoreBadgeClasses(score: number): string {
  if (score >= 75) {
    return 'bg-emerald-500/90 text-black'
  }
  if (score >= 60) {
    return 'bg-yellow-400/90 text-black'
  }
  return 'bg-orange-500/90 text-white'
}

function sortPhotos(photos: Photo[], mode: SortMode): Photo[] {
  const copy = [...photos]
  if (mode === 'score') {
    copy.sort((a, b) => {
      const sa = a.aiScore ?? -1
      const sb = b.aiScore ?? -1
      if (sb !== sa) return sb - sa
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  } else {
    copy.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }
  return copy
}

export default function PhotoLibrary() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('score')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/photos/library', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed to load library (${res.status})`)
      }
      const data = (await res.json()) as LibraryResponse
      setPhotos(data.photos || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll for AI scoring to land for newly uploaded photos.
  useEffect(() => {
    if (!pendingIds.size) return
    const interval = setInterval(() => {
      void refresh()
    }, 4000)
    return () => clearInterval(interval)
  }, [pendingIds, refresh])

  // When AI fields show up, drop those ids from the pending set.
  useEffect(() => {
    if (!pendingIds.size) return
    const landed: string[] = []
    for (const photo of photos) {
      if (pendingIds.has(photo.id) && photo.aiCategorizedAt) {
        landed.push(photo.id)
      }
    }
    if (landed.length) {
      setPendingIds((prev) => {
        const next = new Set(prev)
        for (const id of landed) next.delete(id)
        return next
      })
    }
  }, [photos, pendingIds])

  const buckets = useMemo(() => {
    const grouped = new Map<Category, Photo[]>()
    for (const cat of CATEGORIES) grouped.set(cat, [])
    for (const photo of photos) {
      const key = (CATEGORIES as readonly string[]).includes(photo.category)
        ? (photo.category as Category)
        : 'uncategorized'
      grouped.get(key)!.push(photo)
    }
    for (const cat of CATEGORIES) {
      grouped.set(cat, sortPhotos(grouped.get(cat) || [], sortMode))
    }
    return grouped
  }, [photos, sortMode])

  const onPickFiles = () => fileInputRef.current?.click()

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || !files.length) return
    setUploading(true)
    setError(null)
    const newPendingIds: string[] = []
    try {
      for (const file of Array.from(files)) {
        const body = new FormData()
        body.append('file', file)
        body.append('category', 'uncategorized')
        const res = await fetch('/api/photos/library', { method: 'POST', body })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Upload failed (${res.status})`)
        }
        const data = (await res.json()) as { photo: Photo }
        if (data.photo?.id) newPendingIds.push(data.photo.id)
      }
      if (newPendingIds.length) {
        setPendingIds((prev) => {
          const next = new Set(prev)
          for (const id of newPendingIds) next.add(id)
          return next
        })
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const applySuggestion = async (photo: Photo) => {
    if (!photo.aiCategorySuggested) return
    const res = await fetch(`/api/photos/library/${photo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: photo.aiCategorySuggested }),
    })
    if (res.ok) {
      await refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to apply suggestion')
    }
  }

  const deletePhoto = async (photo: Photo) => {
    const confirmed = window.confirm('Delete this photo?')
    if (!confirmed) return
    const res = await fetch(`/api/photos/library/${photo.id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      await refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to delete photo')
    }
  }

  const rescoreAll = async () => {
    if (!photos.length) return
    setRescoring(true)
    setError(null)
    try {
      const photoIds = photos.map((p) => p.id)
      setPendingIds(new Set(photoIds))
      const res = await fetch('/api/photos/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Rescore failed (${res.status})`)
      }
      await refresh()
      setPendingIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescore failed')
      setPendingIds(new Set())
    } finally {
      setRescoring(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="bg-black/90 backdrop-blur border-b border-white/8 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/profile"
            className="text-white/40 hover:text-white/70 p-1.5 rounded-lg hover:bg-white/5 transition-all"
            aria-label="Back to profile"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold">Photo Library</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setSortMode((m) => (m === 'score' ? 'date' : 'score'))
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:bg-white/5 transition-all"
              title="Toggle sort order"
            >
              <ArrowUpDown className="w-4 h-4" />
              Sort: {sortMode === 'score' ? 'Score desc' : 'Newest'}
            </button>
            <button
              type="button"
              onClick={rescoreAll}
              disabled={rescoring || !photos.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {rescoring ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Rescore all
            </button>
            <button
              type="button"
              onClick={onPickFiles}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-50 transition-all"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) => void onFilesSelected(e.target.files)}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-8">
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24 text-white/60">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading your library...
          </div>
        ) : (
          CATEGORIES.map((cat) => {
            const bucket = buckets.get(cat) || []
            if (!bucket.length && cat !== 'uncategorized') return null
            return (
              <section key={cat}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-white/90">
                    {CATEGORY_LABEL[cat]}{' '}
                    <span className="text-white/40 text-sm font-normal">
                      ({bucket.length})
                    </span>
                  </h2>
                </div>
                {bucket.length === 0 ? (
                  <p className="text-white/40 text-sm italic">
                    No photos in this bucket yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {bucket.map((photo) => (
                      <PhotoCard
                        key={photo.id}
                        photo={photo}
                        pending={pendingIds.has(photo.id)}
                        onApply={() => void applySuggestion(photo)}
                        onDelete={() => void deletePhoto(photo)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })
        )}
      </main>
    </div>
  )
}

interface PhotoCardProps {
  photo: Photo
  pending: boolean
  onApply: () => void
  onDelete: () => void
}

function PhotoCard({ photo, pending, onApply, onDelete }: PhotoCardProps) {
  const suggested =
    photo.aiCategorySuggested &&
    photo.aiCategorySuggested !== photo.category &&
    (CATEGORIES as readonly string[]).includes(photo.aiCategorySuggested)
      ? (photo.aiCategorySuggested as Category)
      : null

  return (
    <div className="group relative rounded-xl overflow-hidden border border-white/10 bg-white/5">
      <div className="aspect-square bg-black/60 relative">
        {photo.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.signedUrl}
            alt={photo.caption || photo.category}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">
            No preview
          </div>
        )}

        {photo.aiScore != null && (
          <div
            className={`absolute top-2 left-2 px-1.5 py-0.5 rounded-md text-xs font-semibold shadow-sm ${scoreBadgeClasses(
              photo.aiScore
            )}`}
            title={photo.aiScoreReason || ''}
          >
            {photo.aiScore}
          </div>
        )}

        {pending && photo.aiScore == null && (
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-black/70 text-white/80 inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Scoring
          </div>
        )}

        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete photo"
          className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white/80 hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2 space-y-1">
        <div className="text-[11px] text-white/50 uppercase tracking-wide">
          {CATEGORY_LABEL[photo.category as Category] || photo.category}
        </div>
        {suggested && (
          <button
            type="button"
            onClick={onApply}
            className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
            title={photo.aiScoreReason || 'Apply AI suggestion'}
          >
            <Check className="w-3 h-3" />
            → {CATEGORY_LABEL[suggested]}
          </button>
        )}
      </div>
    </div>
  )
}
