'use client'

import { useState, useCallback, useRef } from 'react'

interface PhotoScore {
  filename: string
  preview: string
  score: number
  face_score: number
  smile_score: number
  background_score: number
  lighting_score: number
  solo_score: number
  tips: string[]
  rank: number
  scoring: boolean
}

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-green-500'
  if (score >= 40) return 'bg-yellow-500'
  return 'bg-red-500'
}

function scoreTextColor(score: number): string {
  if (score >= 70) return 'text-green-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

function rankBadgeColor(rank: number): string {
  if (rank === 1) return 'bg-violet-600 text-white'
  if (rank === 2) return 'bg-white/10 text-white/80'
  if (rank === 3) return 'bg-white/5 text-white/60'
  return 'bg-white/5 text-white/40'
}

export default function PhotosPage() {
  const [photos, setPhotos] = useState<PhotoScore[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedCard, setExpandedCard] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const MAX_FILES = 10
  const MAX_SIZE = 10 * 1024 * 1024 // 10MB
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setError(null)
    const fileArray = Array.from(files)

    // Validate
    const totalAfter = photos.length + fileArray.length
    if (totalAfter > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} photos allowed. You have ${photos.length}, trying to add ${fileArray.length}.`)
      return
    }

    for (const file of fileArray) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(`${file.name}: unsupported format. Use JPG, PNG, or WebP.`)
        return
      }
      if (file.size > MAX_SIZE) {
        setError(`${file.name}: exceeds 10MB limit.`)
        return
      }
    }

    setUploading(true)

    // Add placeholder entries
    const placeholders: PhotoScore[] = fileArray.map((file) => ({
      filename: file.name,
      preview: URL.createObjectURL(file),
      score: 0,
      face_score: 0,
      smile_score: 0,
      background_score: 0,
      lighting_score: 0,
      solo_score: 0,
      tips: [],
      rank: 0,
      scoring: true,
    }))

    setPhotos((prev) => [...prev, ...placeholders])

    // Score each photo
    const scored: PhotoScore[] = []
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      try {
        const base64 = await fileToBase64(file)
        const res = await fetch('/api/photos/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, filename: file.name }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Scoring failed' }))
          scored.push({
            ...placeholders[i],
            scoring: false,
            tips: [data.error || 'Scoring unavailable — try again later'],
          })
          continue
        }

        const data = await res.json()
        scored.push({
          filename: file.name,
          preview: placeholders[i].preview,
          score: data.score ?? 0,
          face_score: data.face_score ?? 0,
          smile_score: data.smile_score ?? 0,
          background_score: data.background_score ?? 0,
          lighting_score: data.lighting_score ?? 0,
          solo_score: data.solo_score ?? 0,
          tips: data.tips ?? [],
          rank: 0,
          scoring: false,
        })
      } catch {
        scored.push({
          ...placeholders[i],
          scoring: false,
          tips: ['Network error — could not reach scoring service'],
        })
      }
    }

    // Merge scored results and rank
    setPhotos((prev) => {
      const existing = prev.filter((p) => !p.scoring || !fileArray.some((f) => f.name === p.filename))
      const all = [...existing, ...scored]
      return rankPhotos(all)
    })

    setUploading(false)
  }, [photos.length])

  const rankPhotos = (list: PhotoScore[]): PhotoScore[] => {
    const sorted = [...list].sort((a, b) => b.score - a.score)
    return sorted.map((p, i) => ({ ...p, rank: i + 1 }))
  }

  const handleRescore = useCallback(async () => {
    if (photos.length === 0) return
    setUploading(true)
    setError(null)

    const rescored: PhotoScore[] = []
    for (const photo of photos) {
      try {
        // Re-fetch the image from the object URL and convert
        const blob = await fetch(photo.preview).then((r) => r.blob())
        const base64 = await blobToBase64(blob)
        const res = await fetch('/api/photos/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, filename: photo.filename }),
        })

        if (!res.ok) {
          rescored.push({ ...photo, tips: ['Rescoring failed — try again'] })
          continue
        }

        const data = await res.json()
        rescored.push({
          ...photo,
          score: data.score ?? photo.score,
          face_score: data.face_score ?? photo.face_score,
          smile_score: data.smile_score ?? photo.smile_score,
          background_score: data.background_score ?? photo.background_score,
          lighting_score: data.lighting_score ?? photo.lighting_score,
          solo_score: data.solo_score ?? photo.solo_score,
          tips: data.tips ?? photo.tips,
        })
      } catch {
        rescored.push(photo)
      }
    }

    setPhotos(rankPhotos(rescored))
    setUploading(false)
  }, [photos])

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return rankPhotos(next)
    })
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files)
    }
  }, [processFiles])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files)
      e.target.value = ''
    }
  }, [processFiles])

  const bestPhoto = photos.length > 0 ? photos.find((p) => p.rank === 1) : null
  const scoredPhotos = photos.filter((p) => !p.scoring)
  const avgScore = scoredPhotos.length > 0
    ? Math.round(scoredPhotos.reduce((s, p) => s + p.score, 0) / scoredPhotos.length)
    : 0

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-6 py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8 animate-slide-up">
          <h1 className="text-3xl font-bold gradient-text mb-2">Photo Optimizer</h1>
          <p className="text-white/40 text-sm animate-fade-in delay-150">
            Upload your dating profile photos to get AI-powered scores and ranking recommendations.
          </p>
        </div>

        {/* Upload zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-200 mb-8 ${
            dragging
              ? 'border-violet-500 bg-violet-500/10 scale-[1.01]'
              : 'border-violet-500/30 bg-white/[0.02] hover:border-violet-500/50 hover:bg-white/[0.04]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          </div>
          <p className="text-white/60 text-sm font-medium mb-1">
            Drop photos here or click to upload
          </p>
          <p className="text-white/30 text-xs">
            JPG, PNG, WebP — max 10MB each, up to {MAX_FILES} photos
          </p>
          {uploading && (
            <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-violet-300 text-sm font-medium">Scoring photos...</span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Photo grid */}
        {photos.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">
                Your Photos ({photos.length})
              </h2>
              {scoredPhotos.length > 0 && (
                <span className="text-white/30 text-xs">
                  Average score: <span className={scoreTextColor(avgScore)}>{avgScore}</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo, idx) => (
                <div
                  key={`${photo.filename}-${idx}`}
                  className="relative bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden group"
                >
                  {/* Rank badge */}
                  {!photo.scoring && photo.score > 0 && (
                    <div className={`absolute top-3 left-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${rankBadgeColor(photo.rank)}`}>
                      #{photo.rank}
                    </div>
                  )}

                  {/* Best photo badge */}
                  {photo.rank === 1 && !photo.scoring && photo.score > 0 && (
                    <div className="absolute top-3 right-3 z-10 bg-violet-600 text-white text-[10px] font-bold px-2 py-1 rounded-full">
                      Best for first photo
                    </div>
                  )}

                  {/* Remove button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); removePhoto(idx) }}
                    className="absolute top-3 right-3 z-10 w-6 h-6 bg-black/60 hover:bg-red-500/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={photo.rank === 1 && !photo.scoring && photo.score > 0 ? { top: '2.5rem' } : {}}
                  >
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  {/* Image */}
                  <div className="aspect-[3/4] relative">
                    <img
                      src={photo.preview}
                      alt={photo.filename}
                      className="w-full h-full object-cover"
                    />
                    {photo.scoring && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* Score bar and info */}
                  {!photo.scoring && (
                    <div className="p-4">
                      {/* Score display */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/60 text-xs truncate mr-2">{photo.filename}</span>
                        <span className={`text-lg font-bold ${scoreTextColor(photo.score)}`}>
                          {photo.score}
                        </span>
                      </div>

                      {/* Score bar */}
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-3">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${scoreColor(photo.score)}`}
                          style={{ width: `${photo.score}%` }}
                        />
                      </div>

                      {/* Expand/collapse breakdown */}
                      <button
                        onClick={() => setExpandedCard(expandedCard === idx ? null : idx)}
                        className="text-violet-400 hover:text-violet-300 text-xs font-medium mb-2 transition-colors"
                      >
                        {expandedCard === idx ? 'Hide breakdown' : 'Show breakdown'}
                      </button>

                      {expandedCard === idx && (
                        <div className="space-y-2 mt-2 pt-2 border-t border-white/[0.06]">
                          {[
                            { label: 'Face visibility', value: photo.face_score },
                            { label: 'Smile', value: photo.smile_score },
                            { label: 'Background', value: photo.background_score },
                            { label: 'Lighting', value: photo.lighting_score },
                            { label: 'Solo vs group', value: photo.solo_score },
                          ].map(({ label, value }) => (
                            <div key={label} className="flex items-center gap-2">
                              <span className="text-white/40 text-[11px] w-24 shrink-0">{label}</span>
                              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${scoreColor(value)}`}
                                  style={{ width: `${value}%` }}
                                />
                              </div>
                              <span className={`text-[11px] w-6 text-right ${scoreTextColor(value)}`}>{value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Tips */}
                      {photo.tips.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {photo.tips.map((tip, i) => (
                            <p key={i} className="text-white/30 text-[11px] leading-relaxed flex gap-1.5">
                              <span className="text-violet-400 shrink-0">*</span>
                              {tip}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations panel */}
        {scoredPhotos.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 mb-8">
            <h2 className="text-white font-semibold text-sm mb-4">Recommendations</h2>

            {/* Best photo callout */}
            {bestPhoto && bestPhoto.score > 0 && (
              <div className="flex items-center gap-4 mb-5 bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                <img
                  src={bestPhoto.preview}
                  alt="Best photo"
                  className="w-16 h-20 object-cover rounded-lg"
                />
                <div>
                  <p className="text-violet-300 text-sm font-medium mb-1">
                    Your top photo should be: {bestPhoto.filename}
                  </p>
                  <p className="text-white/40 text-xs">
                    Score: {bestPhoto.score}/100 — Use this as your first profile photo for maximum impact.
                  </p>
                </div>
              </div>
            )}

            {/* General tips */}
            <div className="space-y-2 mb-5">
              <h3 className="text-white/50 text-xs font-medium uppercase tracking-wider mb-2">General Tips</h3>
              {avgScore < 40 && (
                <p className="text-white/40 text-xs flex gap-1.5">
                  <span className="text-red-400 shrink-0">*</span>
                  Your photos need significant improvement. Focus on good lighting, clear face shots, and simple backgrounds.
                </p>
              )}
              {avgScore >= 40 && avgScore < 70 && (
                <p className="text-white/40 text-xs flex gap-1.5">
                  <span className="text-yellow-400 shrink-0">*</span>
                  Decent set! Swap out lower-scoring photos and focus on natural smiles with good lighting.
                </p>
              )}
              {avgScore >= 70 && (
                <p className="text-white/40 text-xs flex gap-1.5">
                  <span className="text-green-400 shrink-0">*</span>
                  Strong photo set. Minor tweaks could still help — check individual tips for fine-tuning.
                </p>
              )}
              <p className="text-white/40 text-xs flex gap-1.5">
                <span className="text-violet-400 shrink-0">*</span>
                Use a mix of solo shots, activity photos, and one group photo where you stand out.
              </p>
              <p className="text-white/40 text-xs flex gap-1.5">
                <span className="text-violet-400 shrink-0">*</span>
                Natural daylight produces the best results. Avoid heavy filters.
              </p>
            </div>

            {/* Rescore button */}
            <button
              onClick={handleRescore}
              disabled={uploading}
              className="bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all duration-200 shadow-lg shadow-violet-900/30"
            >
              {uploading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Rescoring...
                </span>
              ) : (
                'Rescore All Photos'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
