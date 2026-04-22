import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@/lib/supabase/server'

type ScrapedPost = {
  shortcode: string
  image_url: string
  caption: string | null
  post_url: string
  instagram_url: string
}

type ScrapeFile = {
  profile: Record<string, unknown>
  posts: ScrapedPost[]
  scraped_at: string
  source: string
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const file = path.join(
      process.cwd(),
      'data',
      'instagram-julianbradleytv.json'
    )
    const raw = await fs.readFile(file, 'utf-8')
    const parsed = JSON.parse(raw) as ScrapeFile

    const { data: existing } = await supabase
      .from('profile_photos')
      .select('source_ref')
      .eq('user_id', user.id)
      .eq('source', 'instagram')
    const imported = new Set(
      (existing ?? []).map((r) => r.source_ref).filter(Boolean) as string[]
    )

    return NextResponse.json({
      profile: parsed.profile,
      scrapedAt: parsed.scraped_at,
      posts: parsed.posts.map((p) => ({
        shortcode: p.shortcode,
        imageUrl: p.image_url,
        caption: p.caption,
        instagramUrl: p.instagram_url,
        alreadyImported: imported.has(p.shortcode),
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Scrape file missing' },
      { status: 500 }
    )
  }
}
