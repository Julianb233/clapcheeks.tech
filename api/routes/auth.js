import { Router } from 'express'
import { randomBytes, randomUUID } from 'crypto'
import { supabase } from '../server.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const router = Router()

// Middleware: validate Supabase JWT
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!jwt) return res.status(401).json({ error: 'Missing auth token' })

  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })
  req.user = user
  next()
}

// Generate XXXX-XXXX device code
function generateDeviceCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length]
    if (i === 3) code += '-'
  }
  return code
}

// POST /auth/register — sync profile after signup
router.post('/register', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: req.user.id, email: req.user.email, updated_at: new Date().toISOString() })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ profile: data })
}))

// GET /auth/profile
router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single()
  if (error) return res.status(404).json({ error: 'Profile not found' })
  res.json({ profile: data })
}))

// PATCH /auth/profile
router.patch('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { full_name } = req.body
  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ profile: data })
}))

// ── Device Flow (CLI login) ─────────────────────────────────────────────────

// POST /auth/device — generate a device code for CLI login
router.post('/device', asyncHandler(async (req, res) => {
  const code = generateDeviceCode()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000) // 5 minutes

  const { error } = await supabase
    .from('clapcheeks_device_codes')
    .insert({
      code,
      expires_at: expiresAt.toISOString(),
    })

  if (error) return res.status(500).json({ error: error.message })

  res.json({
    code,
    verification_url: 'https://clapcheeks.tech/activate',
    expires_in: 300,
  })
}))

// GET /auth/device/poll?code=XXXX-XXXX — CLI polls for approval
router.get('/device/poll', asyncHandler(async (req, res) => {
  const { code } = req.query
  if (!code) return res.status(400).json({ error: 'Missing code parameter' })

  const { data, error } = await supabase
    .from('clapcheeks_device_codes')
    .select('*')
    .eq('code', code)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Code not found' })

  // Check expiry
  if (new Date(data.expires_at) < new Date()) {
    return res.json({ status: 'expired' })
  }

  // Not yet approved
  if (!data.user_id) {
    return res.json({ status: 'pending' })
  }

  // Already used — don't issue another token
  if (data.used) {
    return res.json({ status: 'expired' })
  }

  // Approved — generate agent token and mark as used
  const agentToken = randomUUID()
  const { error: tokenError } = await supabase
    .from('clapcheeks_agent_tokens')
    .insert({
      user_id: data.user_id,
      token: agentToken,
      device_name: 'CLI Device',
    })

  if (tokenError) return res.status(500).json({ error: tokenError.message })

  // Mark device code as used
  await supabase
    .from('clapcheeks_device_codes')
    .update({ used: true })
    .eq('code', code)

  res.json({ status: 'approved', agent_token: agentToken })
}))

// POST /auth/device/approve — web dashboard approves a device code
router.post('/device/approve', requireAuth, asyncHandler(async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: 'Missing code' })

  const { data, error } = await supabase
    .from('clapcheeks_device_codes')
    .select('*')
    .eq('code', code)
    .eq('used', false)
    .single()

  if (error || !data) {
    return res.status(404).json({ error: 'Invalid or expired code' })
  }

  if (new Date(data.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Code expired' })
  }

  if (data.user_id) {
    return res.status(409).json({ error: 'Code already approved' })
  }

  const { error: updateError } = await supabase
    .from('clapcheeks_device_codes')
    .update({ user_id: req.user.id })
    .eq('code', code)

  if (updateError) return res.status(500).json({ error: updateError.message })

  res.json({ success: true })
}))
