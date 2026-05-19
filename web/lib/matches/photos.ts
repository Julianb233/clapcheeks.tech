export type MatchPhotoLike = {
  url?: unknown
  src?: unknown
  image_url?: unknown
  imageUrl?: unknown
  public_url?: unknown
  publicUrl?: unknown
  signed_url?: unknown
  signedUrl?: unknown
  supabase_url?: unknown
  supabaseUrl?: unknown
  convex_url?: unknown
  convexUrl?: unknown
  cdn_url?: unknown
  cdnUrl?: unknown
  raw_url?: unknown
  rawUrl?: unknown
  width?: unknown
  height?: unknown
  convex_path?: unknown
  supabase_path?: unknown
}

export type NormalizedMatchPhoto = {
  url: string
  width?: number | null
  height?: number | null
  convex_path?: string | null
  supabase_path?: string | null
}

const PHOTO_URL_KEYS = [
  'url',
  'public_url',
  'publicUrl',
  'signed_url',
  'signedUrl',
  'supabase_url',
  'supabaseUrl',
  'convex_url',
  'convexUrl',
  'image_url',
  'imageUrl',
  'cdn_url',
  'cdnUrl',
  'raw_url',
  'rawUrl',
  'src',
] as const

function cleanPhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('data:image/')
  ) {
    return trimmed
  }
  return null
}

function nullableString(value: unknown): string | null | undefined {
  if (value == null) return value as null | undefined
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value == null) return value as null | undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function getMatchPhotoUrl(photo: unknown): string | null {
  if (!photo || typeof photo !== 'object') return null
  const record = photo as MatchPhotoLike
  for (const key of PHOTO_URL_KEYS) {
    const url = cleanPhotoUrl(record[key])
    if (url) return url
  }
  return null
}

export function normalizeMatchPhotos(photos: unknown): NormalizedMatchPhoto[] {
  if (!Array.isArray(photos)) return []

  const seen = new Set<string>()
  const normalized: NormalizedMatchPhoto[] = []

  for (const photo of photos) {
    if (!photo || typeof photo !== 'object') continue
    const url = getMatchPhotoUrl(photo)
    if (!url || seen.has(url)) continue
    const record = photo as MatchPhotoLike
    seen.add(url)
    normalized.push({
      url,
      width: nullableNumber(record.width),
      height: nullableNumber(record.height),
      convex_path: nullableString(record.convex_path),
      supabase_path: nullableString(record.supabase_path),
    })
  }

  return normalized
}

export function getCoverPhoto(photos: unknown): string | null {
  return normalizeMatchPhotos(photos)[0]?.url ?? null
}
