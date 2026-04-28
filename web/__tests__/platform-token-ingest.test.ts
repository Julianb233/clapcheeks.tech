// AI-8768: Platform-token-ingest endpoint coverage for
// web/app/api/ingest/platform-token/route.ts.
//
// The route encrypts the platform token with @/lib/crypto/token-vault
// and writes the ciphertext to the *_enc bytea column on
// clapcheeks_user_settings (AI-8766). These tests cover both the happy
// path and the encryption-failure / missing-key paths.

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'

const VALID_DEVICE_TOKEN = 'dev_token_abc_123'
const OWNING_USER_ID = 'user-uuid-abc'

// 32 raw bytes -> base64 master key
const MASTER_KEY = randomBytes(32).toString('base64')
process.env.CLAPCHEEKS_TOKEN_MASTER_KEY = MASTER_KEY

type DbWrite = {
  table: string
  op: 'insert' | 'update' | 'upsert'
  payload: any
  filter?: { field: string; value: any }
  options?: any
}
const dbWrites: DbWrite[] = []
let knownTokens: Record<string, { user_id: string; device_name: string } | null> = {}
let upsertError: { message: string } | null = null
let lookupError: { message: string } | null = null

function makeQuery(table: string) {
  let _filterField: string | null = null
  let _filterValue: any = null
  return {
    select(_cols: string) {
      return {
        eq(field: string, value: any) {
          _filterField = field
          _filterValue = value
          return {
            limit(_n: number) {
              if (lookupError) return Promise.resolve({ data: null, error: lookupError })
              if (table === 'clapcheeks_agent_tokens' && _filterField === 'token') {
                const row = knownTokens[_filterValue]
                if (!row) return Promise.resolve({ data: [], error: null })
                return Promise.resolve({ data: [row], error: null })
              }
              return Promise.resolve({ data: [], error: null })
            },
            single: async () => ({ data: null, error: null }),
          }
        },
      }
    },
    insert(payload: any) {
      dbWrites.push({ table, op: 'insert', payload })
      return Promise.resolve({ data: null, error: null })
    },
    update(payload: any) {
      return {
        eq(_field: string, _value: any) {
          dbWrites.push({ table, op: 'update', payload, filter: { field: _field, value: _value } })
          return {
            then: (resolve: any) => {
              resolve({ data: null, error: null })
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
      }
    },
    upsert(payload: any, options: any) {
      dbWrites.push({ table, op: 'upsert', payload, options })
      if (upsertError) return Promise.resolve({ data: null, error: upsertError })
      return Promise.resolve({ data: null, error: null })
    },
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeQuery(table) }),
}))

const { POST, OPTIONS } = await import('../app/api/ingest/platform-token/route')

const VALID_TINDER_TOKEN = 'tinder_token_'.padEnd(40, 'x')
const VALID_HINGE_TOKEN = 'hinge_token_'.padEnd(40, 'y')
const VALID_INSTAGRAM_TOKEN = JSON.stringify({
  cookies: ['sessionid=abcdefghijklmnopqrstuvwxyz1234567890=='],
})
const VALID_BUMBLE_TOKEN = JSON.stringify({
  cookies: ['session=' + 'b'.repeat(60)],
})

function buildReq(body: any, headers: Record<string, string> = {}) {
  return new Request('https://clapcheeks.tech/api/ingest/platform-token', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  })
}

beforeEach(() => {
  dbWrites.length = 0
  knownTokens = {
    [VALID_DEVICE_TOKEN]: { user_id: OWNING_USER_ID, device_name: 'Test Mac' },
  }
  upsertError = null
  lookupError = null
  // ensure encryption is configured per test
  process.env.CLAPCHEEKS_TOKEN_MASTER_KEY = MASTER_KEY
  // default: do NOT keep plaintext (AI-8766 cutover)
  delete process.env.MIGRATE_KEEP_PLAINTEXT
})

describe('platform-token ingest', () => {
  test('OPTIONS returns 204 with CORS headers', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })

  test('rejects missing X-Device-Token with 401', async () => {
    const req = buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('missing X-Device-Token')
    expect(dbWrites.length).toBe(0)
  })

  test('rejects invalid JSON body with 400', async () => {
    const req = buildReq('{not json', { 'x-device-token': VALID_DEVICE_TOKEN })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_json')
    expect(dbWrites.length).toBe(0)
  })

  test('rejects unknown platform with 400', async () => {
    const req = buildReq(
      { platform: 'feeld', token: VALID_TINDER_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('bad_platform')
    expect(dbWrites.length).toBe(0)
  })

  test('rejects too-short Tinder token with 400 (20-char min)', async () => {
    const req = buildReq(
      { platform: 'tinder', token: 'short' },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('token_too_short')
  })

  test('rejects too-short Instagram blob with 400 (40-char min)', async () => {
    const req = buildReq(
      { platform: 'instagram', token: 'x'.repeat(20) },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('token_too_short')
  })

  test('rejects too-short Bumble session with 400 (40-char min)', async () => {
    const req = buildReq(
      { platform: 'bumble', token: 'b'.repeat(20) },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('token_too_short')
  })

  test('rejects invalid device token with 401', async () => {
    const req = buildReq(
      { platform: 'tinder', token: VALID_TINDER_TOKEN },
      { 'x-device-token': 'not_a_real_token' },
    )
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('invalid_device_token')
    expect(dbWrites.find(w => w.op === 'upsert')).toBeUndefined()
  })

  test('returns 500 server_unconfigured if Supabase env not set', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    try {
      const req = buildReq(
        { platform: 'tinder', token: VALID_TINDER_TOKEN },
        { 'x-device-token': VALID_DEVICE_TOKEN },
      )
      const res = await POST(req)
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe('server_unconfigured')
    } finally {
      // Restore exact prior values (may have been undefined originally)
      if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url
      if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key
    }
  })

  test('returns 500 encryption_failed when master key missing', async () => {
    const orig = process.env.CLAPCHEEKS_TOKEN_MASTER_KEY
    delete process.env.CLAPCHEEKS_TOKEN_MASTER_KEY
    try {
      const req = buildReq(
        { platform: 'tinder', token: VALID_TINDER_TOKEN },
        { 'x-device-token': VALID_DEVICE_TOKEN },
      )
      const res = await POST(req)
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe('encryption_failed')
      expect(body.detail).toMatch(/master.*key/i)
      // No upsert should have happened — encryption failed before write
      expect(dbWrites.find(w => w.op === 'upsert')).toBeUndefined()
    } finally {
      process.env.CLAPCHEEKS_TOKEN_MASTER_KEY = orig
    }
  })

  test('valid Tinder token: writes ciphertext to *_enc, NULLs plaintext', async () => {
    const req = buildReq(
      { platform: 'tinder', token: VALID_TINDER_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN, 'x-device-name': 'Brave on MBA' },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)

    const upsert = dbWrites.find(
      w => w.table === 'clapcheeks_user_settings' && w.op === 'upsert',
    )
    expect(upsert).toBeTruthy()
    expect(upsert!.payload.user_id).toBe(OWNING_USER_ID)
    // Ciphertext column populated
    expect(typeof upsert!.payload.tinder_auth_token_enc).toBe('string')
    expect(upsert!.payload.tinder_auth_token_enc.startsWith('\\x')).toBe(true)
    // Plaintext column explicitly nulled (AI-8766 cutover)
    expect(upsert!.payload.tinder_auth_token).toBe(null)
    expect(upsert!.payload.tinder_auth_token_updated_at).toBeTruthy()
    expect(upsert!.payload.tinder_auth_source).toBe('chrome-extension')
    expect(upsert!.payload.token_enc_version).toBe(1)
    expect(upsert!.options).toEqual({ onConflict: 'user_id' })

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.platform).toBe('tinder')
    expect(body.encrypted).toBe(true)
    expect(body.device_name).toBe('Brave on MBA')
  })

  test('MIGRATE_KEEP_PLAINTEXT=true keeps plaintext alongside ciphertext (back-compat)', async () => {
    process.env.MIGRATE_KEEP_PLAINTEXT = 'true'
    try {
      const req = buildReq(
        { platform: 'tinder', token: VALID_TINDER_TOKEN },
        { 'x-device-token': VALID_DEVICE_TOKEN },
      )
      const res = await POST(req)
      expect(res.status).toBe(200)

      const upsert = dbWrites.find(
        w => w.table === 'clapcheeks_user_settings' && w.op === 'upsert',
      )
      expect(upsert).toBeTruthy()
      expect(upsert!.payload.tinder_auth_token).toBe(VALID_TINDER_TOKEN)
      expect(upsert!.payload.tinder_auth_token_enc).toBeTruthy()
    } finally {
      delete process.env.MIGRATE_KEEP_PLAINTEXT
    }
  })

  test('valid Hinge token: hinge_auth_token_enc populated', async () => {
    const req = buildReq(
      { platform: 'hinge', token: VALID_HINGE_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)

    const upsert = dbWrites.find(
      w => w.table === 'clapcheeks_user_settings' && w.op === 'upsert',
    )
    expect(upsert).toBeTruthy()
    expect(upsert!.payload.hinge_auth_token_enc).toBeTruthy()
    expect(upsert!.payload.hinge_auth_source).toBe('chrome-extension')
    expect(upsert!.payload.hinge_auth_token).toBe(null)
  })

  test('valid Instagram blob: instagram_auth_token_enc populated', async () => {
    const req = buildReq(
      { platform: 'instagram', token: VALID_INSTAGRAM_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)

    const upsert = dbWrites.find(
      w => w.table === 'clapcheeks_user_settings' && w.op === 'upsert',
    )
    expect(upsert).toBeTruthy()
    expect(upsert!.payload.instagram_auth_token_enc).toBeTruthy()
    expect(upsert!.payload.instagram_auth_token).toBe(null)
  })

  test('valid Bumble session: bumble_session_enc populated (different column basename)', async () => {
    const req = buildReq(
      { platform: 'bumble', token: VALID_BUMBLE_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)

    const upsert = dbWrites.find(
      w => w.table === 'clapcheeks_user_settings' && w.op === 'upsert',
    )
    expect(upsert).toBeTruthy()
    // Bumble uses bumble_session* (NOT bumble_auth_token*)
    expect(upsert!.payload.bumble_session_enc).toBeTruthy()
    expect(upsert!.payload.bumble_session).toBe(null)
    expect(upsert!.payload.bumble_session_updated_at).toBeTruthy()
    expect(upsert!.payload.bumble_auth_source).toBe('chrome-extension')
  })

  test('platform field is case-insensitive', async () => {
    const req = buildReq(
      { platform: 'TINDER', token: VALID_TINDER_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.platform).toBe('tinder')
  })

  test('lookup error from supabase returns 500 lookup_failed', async () => {
    lookupError = { message: 'connection refused' }
    const req = buildReq(
      { platform: 'tinder', token: VALID_TINDER_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('lookup_failed')
    expect(body.detail).toBe('connection refused')
  })

  test('upsert error returns 500 write_failed', async () => {
    upsertError = { message: 'unique constraint violated' }
    const req = buildReq(
      { platform: 'tinder', token: VALID_TINDER_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('write_failed')
  })

  test('replay attack: same payload twice -> upsert on user_id (idempotent at DB layer)', async () => {
    const payload = { platform: 'tinder', token: VALID_TINDER_TOKEN }
    const headers = { 'x-device-token': VALID_DEVICE_TOKEN }

    const res1 = await POST(buildReq(payload, headers))
    expect(res1.status).toBe(200)
    const res2 = await POST(buildReq(payload, headers))
    expect(res2.status).toBe(200)

    const upserts = dbWrites.filter(
      w => w.table === 'clapcheeks_user_settings' && w.op === 'upsert',
    )
    expect(upserts.length).toBe(2)
    for (const u of upserts) {
      expect(u.options).toEqual({ onConflict: 'user_id' })
      expect(u.payload.user_id).toBe(OWNING_USER_ID)
    }
    // The two ciphertexts are different (random IV) — proves real encryption
    expect(upserts[0].payload.tinder_auth_token_enc)
      .not.toBe(upserts[1].payload.tinder_auth_token_enc)
  })

  test('response includes CORS Allow-Origin', async () => {
    const req = buildReq(
      { platform: 'tinder', token: VALID_TINDER_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN },
    )
    const res = await POST(req)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('also bumps last_seen_at on the device token row', async () => {
    const req = buildReq(
      { platform: 'tinder', token: VALID_TINDER_TOKEN },
      { 'x-device-token': VALID_DEVICE_TOKEN, 'x-device-name': 'Test Device' },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)

    // Wait one tick to allow the fire-and-forget update to land
    await new Promise(r => setTimeout(r, 10))
    const update = dbWrites.find(
      w => w.table === 'clapcheeks_agent_tokens' && w.op === 'update',
    )
    expect(update).toBeTruthy()
    expect(update!.payload.last_seen_at).toBeTruthy()
    expect(update!.payload.device_name).toBe('Test Device')
    expect(update!.filter!.value).toBe(VALID_DEVICE_TOKEN)
  })
})
