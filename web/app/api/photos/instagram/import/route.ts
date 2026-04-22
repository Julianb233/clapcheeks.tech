import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { createClient } from '@/lib/supabase/server'

type ScrapedPost = {
  shortcode: string
  image_url: string
  caption: string | null
}

type ScrapeFile = { posts: ScrapedPost[] }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const shortcodes: string[] = Array.isArray(body.shortcodes) ? body.shortcodes : []
  const category: string =
    typeof body.category === 'string' && body.category.trim().length > 0
      ? body.category.trim()
      : 'uncategorized'

  if (shortcodes.length === 0) {
    return NextResponse.json({ error: 'shortcodes required' }, { status: 400 })
  }

  const file = path.join(
    process.cwd(),
    'data',
    'instagram-julianbradleytv.json'
  )
  const raw = await fs.readFile(file, 'utf-8').catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Scrape file missing' }, { status: 500 })
  const parsed = JSON.parse(raw) as ScrapeFile
  const byCode = new Map(parsed.posts.map((p) => [p.shortcode, p]))

  const imported: Array<{ shortcode: string; id: string }> = []
  const failed: Array<{ shortcode: string; reason: string }> = []

  for (const sc of shortcodes) {
    const post = byCode.get(sc)
    if (!post) {
      failed.push({ shortcode: sc, reason: 'Not in scrape file' })
      continue
    }

    const res = await fetch(post.image_url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Clapcheeks IG Import)' },
    }).catch((e: unknown) => {
      failed.push({
        shortcode: sc,
        reason: e instanceof Error ? e.message : 'fetch failed',
      })
      return null
    })
    if (!res || !res.ok) {
      failed.push({
        shortcode: sc,
        reason: res ? `HTTP ${res.status}` : 'fetch failed',
      })
      continue
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
        ? 'webp'
        : 'jpg'
    const buf = Buffer.from(await res.arrayBuffer())
    const key = `${user.id}/ig-${sc}-${nanoid(6)}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('profile-photos')
      .upload(key, buf, { contentType, upsert: false })
    if (uploadErr) {
      failed.push({ shortcode: sc, reason: uploadErr.message })
      continue
    }

    const { data: row, error: insertErr } = await supabase
      .from('profile_photos')
      .insert({
        user_id: user.id,
        storage_path: key,
        category,
        source: 'instagram',
        source_ref: sc,
        caption: post.caption,
        bytes: buf.byteLength,
        mime_type: contentType,
      })
      .select('id')
      .single()

    if (insertErr || !row) {
      await supabase.storage.from('profile-photos').remove([key])
      failed.push({ shortcode: sc, reason: insertErr?.message || 'insert failed' })
      continue
    }

    imported.push({ shortcode: sc, id: row.id })
  }

  return NextResponse.json({ imported, failed })
}
