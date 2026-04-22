#!/usr/bin/env node
/**
 * Scrape a public Instagram profile via imginn.com (IG proxy) and Firecrawl.
 * Usage: FIRECRAWL_API_KEY=... node scripts/scrape-instagram.mjs <handle>
 * Writes: web/data/instagram-<handle>.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const handle = process.argv[2] || 'julianbradleytv'
const key = process.env.FIRECRAWL_API_KEY
if (!key) {
  console.error('FIRECRAWL_API_KEY required')
  process.exit(1)
}

const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    url: `https://imginn.com/${handle}/`,
    formats: ['markdown'],
    waitFor: 4000,
  }),
})
const json = await res.json()
if (!json.success) {
  console.error('Scrape failed:', json.error)
  process.exit(2)
}
const md = json.data?.markdown ?? ''

const profile = { handle }
const stats = md.match(/([\d.,K]+)\s*\n?\s*(posts|followers|following)/gi) || []
for (const s of stats) {
  const m = s.match(/([\d.,K]+)\s*\n?\s*(posts|followers|following)/i)
  if (m) profile[m[2].toLowerCase()] = m[1]
}
const bioMatch = md.match(new RegExp(`@${handle}\\*\\*\\]\\(.*?\\)\\n\\n(.*?)(?:\\n\\n\\d|\\n\\n\\[)`, 's'))
if (bioMatch) profile.bio = bioMatch[1].trim()

const posts = []
const seen = new Set()
const re = /\[!\[([^\]]*)\]\(([^)]+)\)\]\((https?:\/\/imginn\.com\/p\/[^)]+\/)\)/g
let m
while ((m = re.exec(md)) !== null) {
  const [, caption, imageUrl, postUrl] = m
  const sc = postUrl.match(/\/p\/([^/]+)\//)?.[1]
  if (!sc || seen.has(sc)) continue
  seen.add(sc)
  posts.push({
    shortcode: sc,
    image_url: imageUrl,
    caption: caption.trim() || null,
    post_url: postUrl,
    instagram_url: `https://www.instagram.com/p/${sc}/`,
  })
}

const out = {
  profile,
  posts,
  post_count_scraped: posts.length,
  scraped_at: new Date().toISOString(),
  source: 'imginn.com',
}
const outPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'data',
  `instagram-${handle}.json`
)
await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.writeFile(outPath, JSON.stringify(out, null, 2))
console.log(`Wrote ${posts.length} posts to ${outPath}`)
