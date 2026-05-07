// AI-9524: Platform-token-ingest endpoint coverage for the Convex-backed route
// at web/app/api/ingest/platform-token/route.ts.

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'

const VALID_DEVICE_TOKEN = 'dev_token_abc_123'
const OWNING_USER_ID = 'user-uuid-abc'
const MASTER_KEY = randomBytes(32).toString('base64')
process.env.CLAPCHEEKS_TOKEN_MASTER_KEY = MASTER_KEY
process.env.NEXT_PUBLIC_CONVEX_URL = 'https://test.convex.cloud'

type Mutation = { name: string; args: any }
type Query = { name: string; args: any }
const mutationCalls: Mutation[] = []
const queryCalls: Query[] = []
let knownTokens: Record<string, { user_id: string; device_name: string | null; last_seen_at: number | null } | null> = {}
let mutationError: string | null = null
let queryError: string | null = null

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    constructor(_url: string) {}
    async query(ref: any, args: any) {
      const name = typeof ref === 'string' ? ref : (ref?._name ?? 'unknown')
      queryCalls.push({ name, args })
      if (queryError) throw new Error(queryError)
      const token = args?.token
      if (token === undefined) return null
      return knownTokens[token] ?? null
    }
    async mutation(ref: any, args: any) {
      const name = typeof ref === 'string' ? ref : (ref?._name ?? 'unknown')
      mutationCalls.push({ name, args })
      if (mutationError) throw new Error(mutationError)
      if (!knownTokens[args.token]) throw new Error('invalid_device_token')
      return { ok: true, user_id: knownTokens[args.token]!.user_id, platform: args.platform, action: 'inserted' as const, updated_at: Date.now() }
    }
  },
}))

vi.mock('@/convex/_generated/api', () => ({
  api: {
    agentDeviceTokens: { validate: { _name: 'agentDeviceTokens.validate' } },
    platformTokens: { upsertEncrypted: { _name: 'platformTokens.upsertEncrypted' } },
  },
}))

const { POST, OPTIONS } = await import('../app/api/ingest/platform-token/route')

const VALID_TINDER_TOKEN = 'tinder_token_'.padEnd(40, 'x')
const VALID_HINGE_TOKEN = 'hinge_token_'.padEnd(40, 'y')
const VALID_INSTAGRAM_TOKEN = JSON.stringify({ cookies: ['sessionid=abcdefghijklmnopqrstuvwxyz1234567890=='] })
const VALID_BUMBLE_TOKEN = JSON.stringify({ cookies: ['session=' + 'b'.repeat(60)] })

function buildReq(body: any, headers: Record<string, string> = {}) {
  return new Request('https://clapcheeks.tech/api/ingest/platform-token', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  mutationCalls.length = 0
  queryCalls.length = 0
  knownTokens = { [VALID_DEVICE_TOKEN]: { user_id: OWNING_USER_ID, device_name: 'Test Mac', last_seen_at: null } }
  mutationError = null
  queryError = null
  process.env.CLAPCHEEKS_TOKEN_MASTER_KEY = MASTER_KEY
  process.env.NEXT_PUBLIC_CONVEX_URL = 'https://test.convex.cloud'
})

describe('platform-token ingest (Convex backend, AI-9524)', () => {
  test('OPTIONS returns 204 with CORS headers', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })

  test('rejects missing X-Device-Token with 401', async () => {
    const res = await POST(buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('missing X-Device-Token')
    expect(mutationCalls.length).toBe(0)
  })

  test('rejects invalid JSON body with 400', async () => {
    const res = await POST(buildReq('{not json', { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  test('rejects unknown platform with 400', async () => {
    const res = await POST(buildReq({ platform: 'feeld', token: VALID_TINDER_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('bad_platform')
  })

  test('rejects too-short Tinder token with 400 (20-char min)', async () => {
    const res = await POST(buildReq({ platform: 'tinder', token: 'short' }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('token_too_short')
  })

  test('rejects too-short Instagram blob with 400 (40-char min)', async () => {
    const res = await POST(buildReq({ platform: 'instagram', token: 'x'.repeat(20) }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('token_too_short')
  })

  test('rejects too-short Bumble session with 400 (40-char min)', async () => {
    const res = await POST(buildReq({ platform: 'bumble', token: 'b'.repeat(20) }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('token_too_short')
  })

  test('rejects invalid device token with 401', async () => {
    const res = await POST(buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN }, { 'x-device-token': 'not_a_real_token' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('invalid_device_token')
    expect(mutationCalls.length).toBe(0)
  })

  test('returns 500 server_unconfigured if Convex URL not set', async () => {
    const orig = process.env.NEXT_PUBLIC_CONVEX_URL
    delete process.env.NEXT_PUBLIC_CONVEX_URL
    delete process.env.CONVEX_URL
    try {
      const res = await POST(buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
      expect(res.status).toBe(500)
      expect((await res.json()).error).toBe('server_unconfigured')
    } finally {
      if (orig !== undefined) process.env.NEXT_PUBLIC_CONVEX_URL = orig
    }
  })

  test('returns 500 encryption_failed when master key missing', async () => {
    const orig = process.env.CLAPCHEEKS_TOKEN_MASTER_KEY
    delete process.env.CLAPCHEEKS_TOKEN_MASTER_KEY
    try {
      const res = await POST(buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe('encryption_failed')
      expect(body.detail).toMatch(/master.*key/i)
      expect(mutationCalls.length).toBe(0)
    } finally {
      process.env.CLAPCHEEKS_TOKEN_MASTER_KEY = orig
    }
  })

  test('valid Tinder token: writes ciphertext via Convex upsertEncrypted', async () => {
    const res = await POST(buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN, 'x-device-name': 'Brave on MBA' }))
    expect(res.status).toBe(200)
    const upsert = mutationCalls.find(m => m.name === 'platformTokens.upsertEncrypted')
    expect(upsert).toBeTruthy()
    expect(upsert!.args.token).toBe(VALID_DEVICE_TOKEN)
    expect(upsert!.args.platform).toBe('tinder')
    expect(upsert!.args.enc_version).toBe(1)
    expect(upsert!.args.source).toBe('chrome-extension')
    expect(upsert!.args.device_name).toBe('Brave on MBA')
    expect(upsert!.args.ciphertext).toBeInstanceOf(ArrayBuffer)
    expect((upsert!.args.ciphertext as ArrayBuffer).byteLength).toBeGreaterThan(29)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.encrypted).toBe(true)
  })

  test('valid Hinge token: hinge platform recorded', async () => {
    const res = await POST(buildReq({ platform: 'hinge', token: VALID_HINGE_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(200)
    expect(mutationCalls.find(m => m.name === 'platformTokens.upsertEncrypted')!.args.platform).toBe('hinge')
  })

  test('valid Instagram blob: instagram platform recorded', async () => {
    const res = await POST(buildReq({ platform: 'instagram', token: VALID_INSTAGRAM_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(200)
    expect(mutationCalls.find(m => m.name === 'platformTokens.upsertEncrypted')!.args.platform).toBe('instagram')
  })

  test('valid Bumble session: bumble platform recorded', async () => {
    const res = await POST(buildReq({ platform: 'bumble', token: VALID_BUMBLE_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(200)
    expect(mutationCalls.find(m => m.name === 'platformTokens.upsertEncrypted')!.args.platform).toBe('bumble')
  })

  test('platform field is case-insensitive', async () => {
    const res = await POST(buildReq({ platform: 'TINDER', token: VALID_TINDER_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(200)
    expect((await res.json()).platform).toBe('tinder')
  })

  test('lookup error from Convex returns 500 lookup_failed', async () => {
    queryError = 'connection refused'
    const res = await POST(buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('lookup_failed')
    expect(body.detail).toContain('connection refused')
  })

  test('mutation error returns 500 write_failed', async () => {
    mutationError = 'unique constraint violated'
    const res = await POST(buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('write_failed')
  })

  test('replay: same payload twice -> two upserts (random IV proves real encryption)', async () => {
    const payload = { platform: 'tinder', token: VALID_TINDER_TOKEN }
    const headers = { 'x-device-token': VALID_DEVICE_TOKEN }
    expect((await POST(buildReq(payload, headers))).status).toBe(200)
    expect((await POST(buildReq(payload, headers))).status).toBe(200)
    const upserts = mutationCalls.filter(m => m.name === 'platformTokens.upsertEncrypted')
    expect(upserts.length).toBe(2)
    const ct1 = Buffer.from(new Uint8Array(upserts[0].args.ciphertext)).toString('hex')
    const ct2 = Buffer.from(new Uint8Array(upserts[1].args.ciphertext)).toString('hex')
    expect(ct1).not.toBe(ct2)
  })

  test('source defaults to chrome-extension; can be overridden via body', async () => {
    const res = await POST(buildReq({ platform: 'tinder', token: VALID_TINDER_TOKEN, source: 'mitmproxy-mac-mini' }, { 'x-device-token': VALID_DEVICE_TOKEN }))
    expect(res.status).toBe(200)
    const upsert = mutationCalls.find(m => m.name === 'platformTokens.upsertEncrypted')
    expect(upsert!.args.source).toBe('mitmproxy-mac-mini')
  })
})
