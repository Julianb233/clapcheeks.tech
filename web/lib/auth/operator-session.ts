import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export type OperatorUser = {
  id: string
  email: string
  email_confirmed_at: string
  user_metadata: Record<string, unknown>
}

type SessionPayload = {
  v: 1
  sub: string
  email: string
  iat: number
  exp: number
}

const COOKIE_NAME = 'cc_operator_session'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const PASSWORD_HASH_PREFIX = 'pbkdf2_sha256'
const PASSWORD_HASH_ITERATIONS = 310_000
const PASSWORD_HASH_BYTES = 32

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString('base64url')
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

export function operatorUser(): OperatorUser {
  return {
    id: process.env.CONVEX_FLEET_USER_ID || 'fleet-julian',
    email: process.env.CLAPCHEEKS_OPERATOR_EMAIL || 'julianb233@gmail.com',
    email_confirmed_at: new Date(0).toISOString(),
    user_metadata: { full_name: 'Julian' },
  }
}

function authSecret() {
  const secret = process.env.CLAPCHEEKS_AUTH_SECRET || process.env.NEXTAUTH_SECRET || ''
  return secret.trim()
}

function configuredPasswordHash() {
  return (process.env.CLAPCHEEKS_OPERATOR_PASSWORD_HASH || '').trim()
}

function signPayload(encodedPayload: string) {
  const secret = authSecret()
  if (!secret) return null
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function hashOperatorPassword(password: string) {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, PASSWORD_HASH_BYTES, 'sha256')
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_ITERATIONS}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

function verifyPassword(password: string, encodedHash: string) {
  const [prefix, iterationsRaw, saltRaw, expectedRaw] = encodedHash.split('$')
  const iterations = Number(iterationsRaw)
  if (
    prefix !== PASSWORD_HASH_PREFIX ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    !saltRaw ||
    !expectedRaw
  ) {
    return false
  }

  const salt = Buffer.from(saltRaw, 'base64url')
  const expected = Buffer.from(expectedRaw, 'base64url')
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, 'sha256')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function createSessionToken(user: OperatorUser, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload: SessionPayload = {
    v: 1,
    sub: user.id,
    email: user.email,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = signPayload(encodedPayload)
  if (!signature) return null
  return `${encodedPayload}.${signature}`
}

function readSessionToken(token: string | undefined): OperatorUser | null {
  if (!token) return null
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return null

  const expectedSignature = signPayload(encodedPayload)
  if (!expectedSignature || !constantTimeEqual(signature, expectedSignature)) return null

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<SessionPayload>
    const user = operatorUser()
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (
      payload.v !== 1 ||
      payload.sub !== user.id ||
      payload.email?.toLowerCase() !== user.email.toLowerCase() ||
      typeof payload.exp !== 'number' ||
      payload.exp <= nowSeconds
    ) {
      return null
    }
    return user
  } catch {
    return null
  }
}

export async function getCurrentOperatorUser() {
  const cookieStore = await cookies()
  return readSessionToken(cookieStore.get(COOKIE_NAME)?.value)
}

export async function signInOperator(email: string, password: string) {
  const user = operatorUser()
  if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { user: null, error: 'Invalid login credentials' }
  }

  const passwordHash = configuredPasswordHash()
  if (!passwordHash || !authSecret()) {
    return { user: null, error: 'Operator auth is not configured' }
  }

  if (!verifyPassword(password, passwordHash)) {
    return { user: null, error: 'Invalid login credentials' }
  }

  return { user, error: null }
}

export async function setOperatorSession(user: OperatorUser) {
  const token = createSessionToken(user)
  if (!token) {
    return { error: 'Operator auth is not configured' }
  }

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  })
  return { error: null }
}

export async function clearOperatorSession() {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
}
