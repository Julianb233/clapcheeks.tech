import { Router } from 'express'
import { supabase } from '../server.js'

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

// POST /auth/register — sync profile after signup
router.post('/register', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: req.user.id, email: req.user.email, updated_at: new Date().toISOString() })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ profile: data })
})

// GET /auth/profile
router.get('/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single()
  if (error) return res.status(404).json({ error: 'Profile not found' })
  res.json({ profile: data })
})

// PATCH /auth/profile
router.patch('/profile', requireAuth, async (req, res) => {
  const { full_name } = req.body
  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ profile: data })
})
