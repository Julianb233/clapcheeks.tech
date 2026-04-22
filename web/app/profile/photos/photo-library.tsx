'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trash2, Upload, Loader2, ImagePlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { InstagramImporter } from './instagram-importer'

type Photo = {
  id: string
  category: string
  source: 'upload' | 'instagram' | 'mac_photos'
  sourceRef: string | null
  caption: string | null
  createdAt: string
  url: string | null
}

const CATEGORIES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'drop_in', label: 'Drop-Ins', hint: 'Strong lead photos. Clear face. Smile.' },
  { key: 'selfie', label: 'Selfies', hint: 'Good lighting. No sunglasses.' },
  { key: 'activity', label: 'Activities', hint: 'You doing something interesting.' },
  { key: 'full_body', label: 'Full Body', hint: 'Head to toe. Good fit.' },
  { key: 'group', label: 'Group', hint: 'Social proof. You clearly identifiable.' },
  { key: 'pets', label: 'Pets', hint: 'With your dog or cat.' },
  { key: 'hobby', label: 'Hobbies', hint: 'Sports, music, hiking, etc.' },
  { key: 'uncategorized', label: 'Inbox', hint: 'Drop anything here to sort later.' },
]

export function PhotoLibrary() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingTo, setUploadingTo] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/photos/library', { cache: 'no-store' })
    if (!res.ok) {
      toast.error('Failed to load photos')
      setLoading(false)
      return
    }
    const json = await res.json()
    setPhotos(json.photos ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function upload(files: File[], category: string) {
    if (files.length === 0) return
    setUploadingTo(category)
    const form = new FormData()
    form.set('category', category)
    files.forEach((f) => form.append('files', f))
    try {
      const res = await fetch('/api/photos/library', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      toast.success(`Uploaded ${json.uploaded?.length ?? 0} to ${categoryLabel(category)}`)
      if (json.rejected?.length) {
        for (const r of json.rejected) toast.error(`${r.name}: ${r.reason}`)
      }
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingTo(null)
    }
  }

  async function recategorize(id: string, category: string) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, category } : p)))
    const res = await fetch(`/api/photos/library/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category }),
    })
    if (!res.ok) {
      toast.error('Failed to move photo')
      load()
    }
  }

  async function remove(id: string) {
    const prev = photos
    setPhotos((p) => p.filter((x) => x.id !== id))
    const res = await fetch(`/api/photos/library/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to delete')
      setPhotos(prev)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-3 items-center">
        <Button variant="outline" size="sm" asChild>
          <label className="cursor-pointer">
            <ImagePlus className="mr-2 h-4 w-4" />
            Quick add to Inbox
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                upload(files, 'uncategorized')
              }}
            />
          </label>
        </Button>
        <InstagramImporter
          categories={CATEGORIES.map((c) => ({ key: c.key, label: c.label }))}
          onImported={load}
        />
        <span className="text-xs text-muted-foreground">
          {photos.length} photo{photos.length === 1 ? '' : 's'} total
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading your library…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {CATEGORIES.map((cat) => {
            const bucket = photos.filter((p) => p.category === cat.key)
            return (
              <CategoryBucket
                key={cat.key}
                label={cat.label}
                hint={cat.hint}
                count={bucket.length}
                photos={bucket}
                uploading={uploadingTo === cat.key}
                onDropFiles={(files) => upload(files, cat.key)}
                onDropPhoto={(id) => recategorize(id, cat.key)}
                onRemove={remove}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function categoryLabel(key: string) {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key
}

function CategoryBucket(props: {
  label: string
  hint: string
  count: number
  photos: Photo[]
  uploading: boolean
  onDropFiles: (files: File[]) => void
  onDropPhoto: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [hover, setHover] = useState(false)

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setHover(true)
  }
  function handleDragLeave() {
    setHover(false)
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setHover(false)
    const id = e.dataTransfer.getData('text/photo-id')
    if (id) {
      props.onDropPhoto(id)
      return
    }
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    )
    if (files.length > 0) props.onDropFiles(files)
  }

  return (
    <Card
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`p-4 transition-colors ${
        hover ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-base">{props.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{props.hint}</p>
        </div>
        <span className="text-xs font-mono text-muted-foreground">
          {props.count}
        </span>
      </div>

      <label
        className={`flex items-center justify-center gap-2 py-3 px-3 rounded-md border border-dashed text-xs text-muted-foreground hover:text-foreground hover:border-foreground/50 cursor-pointer transition-colors ${
          props.uploading ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        {props.uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        Drop photos here or click to browse
        <input
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length > 0) props.onDropFiles(files)
          }}
        />
      </label>

      {props.photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          {props.photos.map((p) => (
            <div
              key={p.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/photo-id', p.id)}
              className="relative group aspect-square rounded-md overflow-hidden bg-muted border border-border"
            >
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.url}
                  alt=""
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[10px]">
                  no preview
                </div>
              )}
              <button
                onClick={() => props.onRemove(p.id)}
                className="absolute top-1 right-1 p-1 rounded bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Delete photo"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
