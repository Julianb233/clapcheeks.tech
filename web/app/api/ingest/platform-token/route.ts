import { NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'

import { encryptToken } from '@/lib/crypto/token-vault'
import { api } from '@/convex/_generated/api'

/**
 * Token ingest endpoint used by the Chrome extension and Mac Mini mitmproxy.
 *
 *   POST /api/ingest/platform-token
 *   Headers:
 *     X-Device-Token: <token from agent_device_tokens (Convex)>
 *     X-Device-Name:  friendly label (optional)
 *   Body: { platform: "tinder" | "hinge" | "instagram" | "bumble", token: string, source?: string }
 *
 * Validates the device token, encrypts the platform token with the per-user
 * vault, and writes ciphertext to Convex platform_tokens.
 *
 * AI-9524: Migrated from Supabase clapcheeks_user_settings to Convex
 * platform_tokens. The plaintext dual-write path (MIGRATE_KEEP_PLAINTEXT) is
 * removed — that migration window closed under AI-8766.
 */

export const runtime = 'nodejs' // need node:crypto via lib/crypto/token-vault.ts

const ALLOWED_PLATFORMS = ['tinder', 'hinge', 'instagram', 'bumble'] as const
type Platform = (typeof ALLOWED_PLATFORMS)[number]

function cors(resp: NextResponse) {
  resp.headers.set('Access-Control-Allow-Origin', '*')
  resp.headers.set('Access-Control-Allow-Headers',
    'Content-Type, X-Device-Token, X-Device-Name')
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  return resp
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

export async function POST(req: Request) {
  const deviceToken = req.headers.get('x-device-token') || ''
  const deviceName = req.headers.get('x-device-name') || ''
  if (!deviceToken) {
    return cors(NextResponse.json(
      { error: 'missing X-Device-Token' }, { status: 401 }))
  }

  let body: { platform?: string; token?: string; source?: string; storage_key?: string; at?: number }
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json({ error: 'invalid_json' }, { status: 400 }))
  }

  const platform = (body.platform || '').toLowerCase()
  const token = (body.token || '').trim()
  if (!ALLOWED_PLATFORMS.includes(platform as Platform)) {
    return cors(NextResponse.json({ error: 'bad_platform' }, { status: 400 }))
  }
  // Instagram and Bumble ship a JSON cookie blob; longer than 40 chars.
  const minLen = platform === 'instagram' || platform === 'bumble' ? 40 : 20
  if (!token || token.length < minLen) {
    return cors(NextResponse.json({ error: 'token_too_short' }, { status: 400 }))
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  if (!convexUrl) {
    return cors(NextResponse.json(
      { error: 'server_unconfigured', detail: 'CONVEX_URL not set' },
      { status: 500 }))
  }

  // Validate device token + look up user_id via Convex
  const convex = new ConvexHttpClient(convexUrl)
  let device: { user_id: string; device_name: string | null; last_seen_at: number | null } | null
  try {
    device = await convex.query(api.agentDeviceTokens.validate, { token: deviceToken })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return cors(NextResponse.json(
      { error: 'lookup_failed', detail: msg }, { status: 500 }))
  }
  if (!device) {
    return cors(NextResponse.json(
      { error: 'invalid_device_token' }, { status: 401 }))
  }

  // Encrypt the platform token before storing.
  let ciphertext: Buffer
  try {
    ciphertext = encryptToken(token, device.user_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return cors(NextResponse.json(
      { error: 'encryption_failed', detail: msg }, { status: 500 }))
  }

  // Convex v.bytes() expects ArrayBuffer over the wire; Buffer extends Uint8Array
  // so we slice into a fresh ArrayBuffer matching the buffer's length.
  const ab = ciphertext.buffer.slice(
    ciphertext.byteOffset,
    ciphertext.byteOffset + ciphertext.byteLength,
  ) as ArrayBuffer

  const source = (body.source || 'chrome-extension').trim() || 'chrome-extension'

  try {
    const result = await convex.mutation(api.platformTokens.upsertEncrypted, {
      token: deviceToken,
      platform: platform as Platform,
      ciphertext: ab,
      enc_version: 1,
      source,
      ...(deviceName ? { device_name: deviceName } : {}),
    })
    return cors(NextResponse.json({
      ok: true,
      platform,
      device_name: deviceName || device.device_name,
      updated_at: new Date(result.updated_at).toISOString(),
      action: result.action,
      encrypted: true,
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('invalid_device_token')) {
      return cors(NextResponse.json(
        { error: 'invalid_device_token' }, { status: 401 }))
    }
    return cors(NextResponse.json(
      { error: 'write_failed', detail: msg }, { status: 500 }))
  }
}
