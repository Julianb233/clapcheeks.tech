/**
 * Claude Vision auto-scoring + category suggestion for profile_photos.
 *
 * Shared helper used by:
 *   - POST /api/photos/categorize  — explicit single / batch categorize call
 *   - POST /api/photos/library     — fire-and-forget on new upload
 *
 * We never overwrite `category`. The AI writes to `ai_category_suggested`
 * and the user decides whether to apply it.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

export const PHOTO_CATEGORIES = [
  'drop_in',
  'selfie',
  'activity',
  'full_body',
  'group',
  'pets',
  'hobby',
  'uncategorized',
] as const

export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]

export function isPhotoCategory(value: unknown): value is PhotoCategory {
  return (
    typeof value === 'string' &&
    (PHOTO_CATEGORIES as readonly string[]).includes(value)
  )
}

export interface PhotoCategorizationResult {
  photoId: string
  aiScore: number | null
  aiScoreReason: string | null
  aiCategorySuggested: PhotoCategory | null
  error?: string
}

interface PhotoRow {
  id: string
  user_id: string
  storage_path: string
  mime_type: string | null
}

// The bucket that /api/photos/library uploads into. Kept in one place so
// the categorizer, uploader, and UI signed-URL fetches all agree.
export const PHOTO_BUCKET = 'profile-photos'

// Claude model. claude-opus-4-7 is not yet in @anthropic-ai/sdk ^0.78.0's
// Model union, so we fall back to the supported flagship per task spec.
const VISION_MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = [
  'You are a dating-profile photo classifier for Clapcheeks, an AI dating co-pilot.',
  'For each user photo, return:',
  '  1. best_category  — exactly ONE key from this fixed set:',
  `     ${PHOTO_CATEGORIES.join(', ')}`,
  '     Category meanings:',
  '       drop_in    — lifestyle / in-the-moment candid shot',
  '       selfie     — self-taken close-up, camera held by subject',
  '       activity   — subject doing something (sport, travel, cooking, etc.)',
  '       full_body  — full-length shot showing outfit / body',
  '       group      — two or more people',
  '       pets       — subject with a pet, or pet-focused',
  '       hobby      — interest-focused (musician, gamer, reading, art)',
  '       uncategorized — truly does not fit any of the above',
  '  2. score  — integer 0-100 for dating-profile quality. Rubric:',
  '       lighting (natural light good, harsh flash bad)',
  '       composition (clean background, subject centered)',
  '       face visibility (eyes unobstructed beats sunglasses/hats)',
  '       genuine smile or confident expression beats blank',
  '       group photos lose points if ambiguity is high (hard to tell which is user)',
  '       red flags: bathroom mirror, dirty room, drinking visibility, gym mirror',
  '  3. reason — ONE sentence, under 140 chars, explaining the score.',
  '',
  'Rules:',
  '- Output ONLY valid JSON. No prose, no markdown fences.',
  '- Use the tool if one is offered, otherwise return a bare JSON object.',
  '- Never invent a category outside the fixed set.',
  '- ASCII only. No em-dashes, curly quotes, or ellipsis.',
].join('\n')

const USER_PROMPT =
  'Analyze the attached photo and return JSON: {"best_category": "<one_of_fixed_set>", "score": <0-100 int>, "reason": "<<=140 char sentence>"}'

// Structured-output tool — gives us typed JSON without brittle parsing.
const CATEGORIZE_TOOL = {
  name: 'record_photo_analysis',
  description:
    'Record the single best category, a 0-100 quality score, and a one-sentence reason for a dating-profile photo.',
  input_schema: {
    type: 'object' as const,
    properties: {
      best_category: {
        type: 'string',
        enum: PHOTO_CATEGORIES as unknown as string[],
        description: 'The single best category key for this photo.',
      },
      score: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Dating-profile quality score 0-100.',
      },
      reason: {
        type: 'string',
        maxLength: 200,
        description: 'One sentence (<=140 chars) explaining the score.',
      },
    },
    required: ['best_category', 'score', 'reason'],
    additionalProperties: false,
  },
}

function mimeForVision(mime: string | null | undefined): string {
  const m = (mime || '').toLowerCase()
  if (m === 'image/jpeg' || m === 'image/png' || m === 'image/webp' || m === 'image/gif') {
    return m
  }
  return 'image/jpeg'
}

function assertApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Photo categorization is unavailable.'
    )
  }
  return key
}

async function fetchSignedUrl(
  admin: ReturnType<typeof createAdminClient>,
  storagePath: string
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(storagePath, 60 * 60) // 1 hour TTL
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

async function downloadAsBase64(
  signedUrl: string,
  mime: string
): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(signedUrl)
    if (!res.ok) return null
    const headerMime = res.headers.get('content-type')?.split(';')[0].trim()
    const media = mimeForVision(headerMime || mime)
    const buf = Buffer.from(await res.arrayBuffer())
    return { data: buf.toString('base64'), mediaType: media }
  } catch {
    return null
  }
}

interface ParsedAnalysis {
  best_category: PhotoCategory
  score: number
  reason: string
}

function parseAnalysis(raw: unknown): ParsedAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const cat = r.best_category
  const score = r.score
  const reason = r.reason
  if (!isPhotoCategory(cat)) return null
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  if (typeof reason !== 'string') return null
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)))
  const trimmedReason = reason.slice(0, 280)
  return { best_category: cat, score: clampedScore, reason: trimmedReason }
}

async function analyzeOne(
  anthropic: Anthropic,
  imageData: string,
  mediaType: string
): Promise<ParsedAnalysis | null> {
  const message = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 300,
    temperature: 0,
    system: SYSTEM_PROMPT,
    tools: [CATEGORIZE_TOOL],
    tool_choice: { type: 'tool', name: CATEGORIZE_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: imageData,
            },
          },
          { type: 'text', text: USER_PROMPT },
        ],
      },
    ],
  })

  // Prefer the tool-use block; fall back to best-effort JSON parse from text.
  for (const block of message.content) {
    if (block.type === 'tool_use' && block.name === CATEGORIZE_TOOL.name) {
      const parsed = parseAnalysis(block.input)
      if (parsed) return parsed
    }
  }
  for (const block of message.content) {
    if (block.type === 'text' && block.text) {
      try {
        const trimmed = block.text.trim().replace(/^```(?:json)?|```$/g, '').trim()
        const parsed = parseAnalysis(JSON.parse(trimmed))
        if (parsed) return parsed
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

/**
 * Categorize and score a batch of photos owned by a user.
 *
 * Caller is responsible for authenticating and restricting `photoIds` to
 * this user's rows. We still filter by `userId` here as a defense-in-depth
 * check before calling Claude.
 */
export async function categorizePhotos(
  userId: string,
  photoIds: string[]
): Promise<PhotoCategorizationResult[]> {
  if (!photoIds.length) return []
  assertApiKey()

  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('profile_photos')
    .select('id, user_id, storage_path, mime_type')
    .eq('user_id', userId)
    .in('id', photoIds)

  if (error) {
    throw new Error(`Failed to load photos: ${error.message}`)
  }

  const photos: PhotoRow[] = (rows || []) as PhotoRow[]
  if (!photos.length) return []

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const results: PhotoCategorizationResult[] = []

  // Sequential to keep cost/rate bounded. Batch-level concurrency (if we
  // need it) can come later; the upload path fires only one photo anyway.
  for (const photo of photos) {
    try {
      const signed = await fetchSignedUrl(admin, photo.storage_path)
      if (!signed) {
        results.push({
          photoId: photo.id,
          aiScore: null,
          aiScoreReason: null,
          aiCategorySuggested: null,
          error: 'signed_url_failed',
        })
        continue
      }

      const image = await downloadAsBase64(signed, photo.mime_type || 'image/jpeg')
      if (!image) {
        results.push({
          photoId: photo.id,
          aiScore: null,
          aiScoreReason: null,
          aiCategorySuggested: null,
          error: 'image_download_failed',
        })
        continue
      }

      const analysis = await analyzeOne(anthropic, image.data, image.mediaType)
      if (!analysis) {
        results.push({
          photoId: photo.id,
          aiScore: null,
          aiScoreReason: null,
          aiCategorySuggested: null,
          error: 'analysis_parse_failed',
        })
        continue
      }

      const nowIso = new Date().toISOString()
      const { error: updErr } = await admin
        .from('profile_photos')
        .update({
          ai_score: analysis.score,
          ai_score_reason: analysis.reason,
          ai_category_suggested: analysis.best_category,
          ai_categorized_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', photo.id)
        .eq('user_id', userId)

      if (updErr) {
        results.push({
          photoId: photo.id,
          aiScore: analysis.score,
          aiScoreReason: analysis.reason,
          aiCategorySuggested: analysis.best_category,
          error: `persist_failed: ${updErr.message}`,
        })
        continue
      }

      results.push({
        photoId: photo.id,
        aiScore: analysis.score,
        aiScoreReason: analysis.reason,
        aiCategorySuggested: analysis.best_category,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error'
      results.push({
        photoId: photo.id,
        aiScore: null,
        aiScoreReason: null,
        aiCategorySuggested: null,
        error: message,
      })
    }
  }

  return results
}

/**
 * Fire-and-forget helper for the upload path. Never throws; errors are
 * logged so a Claude/Anthropic outage can't break uploads.
 */
export function scheduleCategorization(userId: string, photoId: string): void {
  // Detached promise; explicitly do not await.
  void categorizePhotos(userId, [photoId]).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      '[photo-ai] scheduleCategorization failed',
      { userId, photoId, error: msg }
    )
  })
}
