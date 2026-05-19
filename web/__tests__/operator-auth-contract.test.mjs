import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  operatorSession: readFileSync('lib/auth/operator-session.ts', 'utf8'),
  serverClient: readFileSync('lib/convex/server.ts', 'utf8'),
  compat: readFileSync('lib/convex/compat-client.ts', 'utf8'),
  actions: readFileSync('app/auth/actions.ts', 'utf8'),
  mainLayout: readFileSync('app/(main)/layout.tsx', 'utf8'),
}

test('server auth uses a signed operator session cookie instead of default user auth', () => {
  assert.match(files.operatorSession, /cc_operator_session/)
  assert.match(files.operatorSession, /httpOnly: true/)
  assert.match(files.operatorSession, /sameSite: 'lax'/)
  assert.match(files.operatorSession, /createHmac\('sha256'/)
  assert.match(files.operatorSession, /timingSafeEqual/)
  assert.match(files.operatorSession, /payload\.exp <= nowSeconds/)
  assert.match(files.serverClient, /getCurrentOperatorUser/)
  assert.match(files.serverClient, /createServerClient\(\{ user: await getCurrentOperatorUser\(\) \}\)/)
  assert.match(files.mainLayout, /if \(!user\) redirect\('\/login'\)/)
})

test('email password login validates configured operator credentials before setting the cookie', () => {
  assert.match(files.operatorSession, /CLAPCHEEKS_OPERATOR_EMAIL/)
  assert.match(files.operatorSession, /CLAPCHEEKS_OPERATOR_PASSWORD_HASH/)
  assert.match(files.operatorSession, /pbkdf2Sync/)
  assert.match(files.operatorSession, /Invalid login credentials/)
  assert.match(files.actions, /signInOperator\(email, password\)/)
  assert.match(files.actions, /setOperatorSession\(user\)/)
  assert.match(files.actions, /redirect\('\/dashboard'\)/)
})

test('Convex facade no longer treats password or OAuth auth as an automatic success', () => {
  assert.match(files.compat, /currentUser: MaybeUser \| null/)
  assert.match(files.compat, /getUser: async \(\) => \(\{ data: \{ user: this\.currentUser \}/)
  assert.match(files.compat, /Use the operator login action for email\/password auth/)
  assert.match(files.compat, /Google app login is not configured/)
  assert.doesNotMatch(files.compat, /signInWithPassword: async \(_data: any\) => \(\{ data: \{ user: DEFAULT_USER \}/)
  assert.doesNotMatch(files.compat, /exchangeCodeForSession: async \(_code: string\) => \(\{ data: \{ session: \{ user: DEFAULT_USER \}/)
})
