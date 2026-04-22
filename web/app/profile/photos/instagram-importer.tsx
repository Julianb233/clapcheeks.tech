'use client'

import { useEffect, useState } from 'react'
import { Check, Instagram, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type IgPost = {
  shortcode: string
  imageUrl: string
  caption: string | null
  instagramUrl: string
  alreadyImported: boolean
}

type Categories = Array<{ key: string; label: string }>

export function InstagramImporter({
  categories,
  onImported,
}: {
  categories: Categories
  onImported: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [posts, setPosts] = useState<IgPost[]>([])
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
  const [scrapedAt, setScrapedAt] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [category, setCategory] = useState<string>('uncategorized')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/photos/instagram/posts')
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          toast.error(json.error)
          return
        }
        setPosts(json.posts ?? [])
        setProfile(json.profile ?? null)
        setScrapedAt(json.scrapedAt ?? null)
      })
      .catch(() => toast.error('Failed to load Instagram posts'))
      .finally(() => setLoading(false))
  }, [open])

  function toggle(sc: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sc)) next.delete(sc)
      else next.add(sc)
      return next
    })
  }

  async function runImport() {
    if (selected.size === 0) {
      toast.error('Select at least one photo')
      return
    }
    setImporting(true)
    try {
      const res = await fetch('/api/photos/instagram/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortcodes: Array.from(selected),
          category,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Import failed')
      toast.success(
        `Imported ${json.imported?.length ?? 0} · Failed ${json.failed?.length ?? 0}`
      )
      if (json.failed?.length) {
        for (const f of json.failed) toast.error(`${f.shortcode}: ${f.reason}`)
      }
      setSelected(new Set())
      setOpen(false)
      onImported()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Instagram className="mr-2 h-4 w-4" />
          Import from Instagram
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import from Instagram</DialogTitle>
          <DialogDescription>
            {profile && typeof profile.handle === 'string'
              ? `@${String(profile.handle)} — ${String(profile.posts ?? '?')} posts · ${String(profile.followers ?? '?')} followers`
              : 'Select photos to pull into your library.'}
            {scrapedAt && (
              <span className="block text-[10px] mt-1">
                Scraped {new Date(scrapedAt).toLocaleString()}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading posts…
            </div>
          ) : posts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8">
              No posts found. Run{' '}
              <code className="px-1 bg-muted rounded">
                node scripts/scrape-instagram.mjs julianbradleytv
              </code>{' '}
              to refresh the scrape.
            </p>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {posts.map((p) => {
                const isSelected = selected.has(p.shortcode)
                const disabled = p.alreadyImported
                return (
                  <button
                    key={p.shortcode}
                    type="button"
                    onClick={() => !disabled && toggle(p.shortcode)}
                    className={`relative aspect-square rounded-md overflow-hidden bg-muted border-2 transition-all ${
                      disabled
                        ? 'opacity-40 cursor-not-allowed border-transparent'
                        : isSelected
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-transparent hover:border-foreground/30'
                    }`}
                    title={p.caption ?? p.shortcode}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {isSelected && (
                      <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                    {disabled && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-[10px] font-semibold">
                        imported
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row sm:items-center">
          <div className="flex-1 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {selected.size} selected
            </span>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={runImport}
            disabled={importing || selected.size === 0}
          >
            {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {selected.size > 0 ? `${selected.size} ` : ''}to{' '}
            {categories.find((c) => c.key === category)?.label ?? category}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
