import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  operatorSession: readFileSync('lib/auth/operator-session.ts', 'utf8'),
  supabaseServer: readFileSync('lib/supabase/server.ts', 'utf8'),
  supabaseMiddleware: readFileSync('lib/supabase/middleware.ts', 'utf8'),
  compat: readFileSync('lib/convex/compat-client.ts', 'utf8'),
  actions: readFileSync('app/auth/actions.ts', 'utf8'),
  loginForm: readFileSync('app/login/login-form.tsx', 'utf8'),
}

test('server auth uses a signed operator session cookie instead of Supabase password auth', () => {
  assert.match(files.operatorSession, /cc_operator_session/)
  assert.match(files.operatorSession, /httpOnly: true/)
  assert.match(files.operatorSession, /sameSite: 'lax'/)
  assert.match(files.operatorSession, /createHmac\('sha256'/)
  assert.match(files.operatorSession, /CLAPCHEEKS_OPERATOR_PASSWORD_HASH/)
  assert.match(files.supabaseServer, /getCurrentOperatorUser/)
  assert.match(files.supabaseServer, /createServerClient\(\{ user: await getCurrentOperatorUser\(\) \}\)/)
})

test('operator login action validates configured credentials before setting the cookie', () => {
  assert.match(files.actions, /signInOperator\(email, password\)/)
  assert.match(files.actions, /setOperatorSession\(user\)/)
  assert.match(files.actions, /redirect\('\/dashboard'\)/)
  assert.match(files.actions, /Public signup is disabled/)
  assert.match(files.actions, /Google login is not configured/)
})

test('middleware does not redirect before the operator cookie can be read', () => {
  assert.match(files.supabaseMiddleware, /NextResponse\.next\(\{ request \}\)/)
  assert.doesNotMatch(files.supabaseMiddleware, /auth\.getUser/)
  assert.doesNotMatch(files.supabaseMiddleware, /NextResponse\.redirect/)
})

test('Convex compatibility auth refuses direct password and OAuth auth', () => {
  assert.match(files.compat, /Use the operator login action for email\/password auth/)
  assert.match(files.compat, /Google app login is not configured/)
  assert.doesNotMatch(files.compat, /signInWithPassword: async \(_data: any\) => \(\{ data: \{ user: DEFAULT_USER \}/)
})

test('operator login screen only exposes working operator controls', () => {
  assert.match(files.loginForm, /login\(formData\)/)
  assert.doesNotMatch(files.loginForm, /loginWithGoogle/)
  assert.doesNotMatch(files.loginForm, /Continue with Google/)
  assert.doesNotMatch(files.loginForm, /auth\/sign-up/)
})
