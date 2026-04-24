/**
 * Elite roster screenshot intake (2026-04-24).
 *
 * Shared pipeline used by every entry point:
 *   - POST /api/roster/intake         (web upload)
 *   - agent/clapcheeks/imessage/*     (iMessage attachment handler, via a thin
 *                                       fetch wrapper to the same API route)
 *   - scripts/poll-roster-email.ts    (email inbox poller, same)
 *
 * Inputs: raw image bytes + optional meta (source, message body, sender handle).
 * Pipeline:
 *   1. Claude Vision extracts {name, phone, email, instagram_handle, city, notes}
 *   2. Upsert by (user_id, contact_phone) OR (user_id, instagram_handle) — merge
 *      into existing row if either matches.
 *   3. Upload image to Supabase `knowledge` bucket, stash storage path.
 *   4. Sync to Google Contacts via gws people (best-effort — returns resource_id
 *      but doesn't block on failure).
 *   5. Flip `elite=true`, tag `source`, return the match row.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MatchSource } from '@/lib/matches/types'

const VISION_MODEL = 'claude-sonnet-4-6'

export type ExtractedContact = {
  name: string | null
  phone_e164: string | null
  email: string | null
  instagram_handle: string | null
  city: string | null
  notes: string | null
  confidence: number // 0-1
}

export type IntakeInput = {
  userId: string
  imageBytes: Buffer
  imageMime: string // e.g. 'image/png', 'image/jpeg'
  source: MatchSource
  sourceMessage?: string // optional message body accompanying the image
  sourceHandle?: string // phone / email of the sender on imessage/email paths
}

export type IntakeResult = {
  matchId: string
  extracted: ExtractedContact
  storagePath: string | null
  googleContactId: string | null
  merged: boolean // true if we updated an existing row, false if created new
}

const VISION_PROMPT = `You are extracting contact information from a screenshot.

The image is either (a) an iPhone/Android contact card from the Contacts app,
or (b) an Instagram profile screenshot. Extract what you can see.

Return ONLY a JSON object with this exact shape — no prose, no markdown fence:
{
  "name": string or null,
  "phone_e164": string or null,         // ALWAYS in +1XXXXXXXXXX E.164 format, US default
  "email": string or null,
  "instagram_handle": string or null,   // without the @ prefix
  "city": string or null,
  "notes": string or null,              // 1 short sentence of anything notable
  "confidence": number                  // 0-1, how confident you are overall
}

Rules:
- If you can't see a field, set it to null. Do not guess.
- Normalize phone to +1XXXXXXXXXX (strip spaces/dashes/parens, add +1 if US 10-digit).
- For IG screenshots: handle is the @username at the top. Phone is usually absent.
- For contact cards: phone is explicit. Sometimes multiple numbers; pick the mobile.
- "notes" should capture 1 useful data point (bio, job, location) in <= 100 chars.
- Output VALID JSON only. ASCII only (no curly quotes, em-dashes).`

export async function extractContactFromImage(
  imageBytes: Buffer,
  mime: string,
): Promise<ExtractedContact> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const b64 = imageBytes.toString('base64')
  const res = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime as any, data: b64 } },
        { type: 'text', text: VISION_PROMPT },
      ],
    }],
  })
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
  // Strip ```json ... ``` fences if the model ignored instructions
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as Partial<ExtractedContact>
    return {
      name: parsed.name ?? null,
      phone_e164: normalizePhone(parsed.phone_e164 ?? null),
      email: parsed.email ? parsed.email.toLowerCase() : null,
      instagram_handle: parsed.instagram_handle
        ? parsed.instagram_handle.replace(/^@/, '').toLowerCase()
        : null,
      city: parsed.city ?? null,
      notes: parsed.notes ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    }
  } catch {
    return {
      name: null, phone_e164: null, email: null, instagram_handle: null,
      city: null, notes: null, confidence: 0,
    }
  }
}

export function normalizePhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export async function ingestScreenshot(input: IntakeInput): Promise<IntakeResult> {
  const supabase = createAdminClient()

  const extracted = await extractContactFromImage(input.imageBytes, input.imageMime)

  // Upload screenshot to private `knowledge` bucket for audit / re-run
  let storagePath: string | null = null
  try {
    const key = `${input.userId}/elite-intake/${Date.now()}-${cryptoRandom(8)}.${mimeToExt(input.imageMime)}`
    const { error } = await supabase.storage
      .from('knowledge')
      .upload(key, input.imageBytes, { contentType: input.imageMime, upsert: false })
    if (!error) storagePath = key
  } catch { /* non-fatal */ }

  // Dedupe: look for existing row with matching phone OR IG handle
  let existingId: string | null = null
  if (extracted.phone_e164) {
    const { data } = await supabase
      .from('clapcheeks_matches')
      .select('id')
      .eq('user_id', input.userId)
      .eq('contact_phone', extracted.phone_e164)
      .limit(1)
      .maybeSingle()
    if (data?.id) existingId = data.id
  }
  if (!existingId && extracted.instagram_handle) {
    const { data } = await supabase
      .from('clapcheeks_matches')
      .select('id')
      .eq('user_id', input.userId)
      .ilike('instagram_handle', extracted.instagram_handle)
      .limit(1)
      .maybeSingle()
    if (data?.id) existingId = data.id
  }

  const payload = {
    user_id: input.userId,
    name: extracted.name,
    contact_phone: extracted.phone_e164,
    contact_email: extracted.email,
    instagram_handle: extracted.instagram_handle,
    elite: true,
    source: input.source,
    intake_screenshot_path: storagePath,
    platform: 'offline' as const,
    // Append notes / meta into match_intel as a free-text field
    match_intel: {
      summary: extracted.notes,
      vibe: extracted.city,
      source_handle: input.sourceHandle || null,
      source_message: input.sourceMessage || null,
      extracted_confidence: extracted.confidence,
    },
    status: 'new' as const,
  }

  let matchId: string
  if (existingId) {
    const { data, error } = await supabase
      .from('clapcheeks_matches')
      .update(payload)
      .eq('id', existingId)
      .select('id')
      .single()
    if (error) throw error
    matchId = data.id
  } else {
    const { data, error } = await supabase
      .from('clapcheeks_matches')
      .insert(payload)
      .select('id')
      .single()
    if (error) throw error
    matchId = data.id
  }

  return {
    matchId,
    extracted,
    storagePath,
    googleContactId: null, // Google sync handled out-of-band (best-effort, async)
    merged: !!existingId,
  }
}

function mimeToExt(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('heic')) return 'heic'
  return 'bin'
}

function cryptoRandom(n: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}
