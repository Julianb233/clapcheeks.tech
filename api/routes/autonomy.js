import { Router } from 'express'
import { supabase, validateAgentToken } from '../server.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const router = Router()

// All autonomy routes require agent auth
router.use(validateAgentToken)

// GET /autonomy/config — return autonomy settings
router.get('/config', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('clapcheeks_autonomy_config')
    .select('*')
    .eq('user_id', req.userId)
    .single()

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message })
  }

  res.json(data || {
    global_level: 'semi_auto',
    auto_swipe_enabled: true,
    auto_respond_enabled: true,
    confidence_threshold: 0.5,
    auto_send_confidence: 0.8,
    max_auto_swipes_per_hour: 30,
  })
}))

// PUT /autonomy/config — update autonomy settings
router.put('/config', asyncHandler(async (req, res) => {
  const updates = {}
  const allowed = [
    'global_level', 'auto_swipe_enabled', 'auto_respond_enabled',
    'confidence_threshold', 'auto_send_confidence', 'max_auto_swipes_per_hour',
    'per_match_overrides',
  ]
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  const { data, error } = await supabase
    .from('clapcheeks_autonomy_config')
    .upsert({ user_id: req.userId, ...updates, updated_at: new Date().toISOString() })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
}))

// GET /autonomy/queue — list pending approval items
router.get('/queue', asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending'
  const { data, error } = await supabase
    .from('clapcheeks_approval_queue')
    .select('*')
    .eq('user_id', req.userId)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ items: data || [], count: (data || []).length })
}))

// POST /autonomy/queue — add item to approval queue (from agent)
router.post('/queue', asyncHandler(async (req, res) => {
  const { action_type, platform, match_id, match_name, text, confidence, context } = req.body
  const { data, error } = await supabase
    .from('clapcheeks_approval_queue')
    .insert({
      user_id: req.userId,
      action_type: action_type || 'reply',
      platform: platform || '',
      match_id: match_id || '',
      match_name: match_name || '',
      proposed_text: text || '',
      confidence: confidence || 0,
      proposed_data: context || {},
      status: 'pending',
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
}))

// POST /autonomy/queue/:id/approve
router.post('/queue/:id/approve', asyncHandler(async (req, res) => {
  const { id } = req.params
  const updates = { status: 'approved', decided_at: new Date().toISOString() }
  if (req.body.edited_text) updates.proposed_text = req.body.edited_text

  const { data, error } = await supabase
    .from('clapcheeks_approval_queue')
    .update(updates)
    .eq('id', id)
    .eq('user_id', req.userId)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Not found' })
  res.json(data)
}))

// POST /autonomy/queue/:id/reject
router.post('/queue/:id/reject', asyncHandler(async (req, res) => {
  const { id } = req.params
  const { data, error } = await supabase
    .from('clapcheeks_approval_queue')
    .update({
      status: 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: req.body.reason || '',
    })
    .eq('id', id)
    .eq('user_id', req.userId)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Not found' })
  res.json(data)
}))

// POST /autonomy/swipe-record — record manual swipe for preference learning
router.post('/swipe-record', asyncHandler(async (req, res) => {
  const { platform, profile_id, direction, features } = req.body
  const { error } = await supabase
    .from('clapcheeks_swipe_decisions')
    .insert({
      user_id: req.userId,
      platform: platform || '',
      profile_id: profile_id || '',
      decision: direction || 'left',
      features: features || {},
      was_auto: false,
    })

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ ok: true })
}))

// POST /autonomy/action-log — log an autonomous action
router.post('/action-log', asyncHandler(async (req, res) => {
  const { action_type, platform, match_id, match_name, confidence, input_data, output_data, status } = req.body
  const { error } = await supabase
    .from('clapcheeks_auto_actions')
    .insert({
      user_id: req.userId,
      action_type: action_type || '',
      platform: platform || '',
      match_id: match_id || '',
      match_name: match_name || '',
      confidence: confidence || 0,
      input_data: input_data || {},
      output_data: output_data || {},
      status: status || 'executed',
    })

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ ok: true })
}))

// GET /autonomy/dashboard — confidence dashboard stats (AUTO-06)
router.get('/dashboard', asyncHandler(async (req, res) => {
  const yesterday = new Date(Date.now() - 86400000).toISOString()

  const [queueResult, actionsResult, configResult] = await Promise.all([
    supabase.from('clapcheeks_approval_queue').select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId).eq('status', 'pending'),
    supabase.from('clapcheeks_auto_actions').select('*')
      .eq('user_id', req.userId).gte('created_at', yesterday)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('clapcheeks_autonomy_config').select('*')
      .eq('user_id', req.userId).single(),
  ])

  const actions = actionsResult.data || []
  res.json({
    config: configResult.data || { global_level: 'semi_auto' },
    queue_depth: queueResult.count || 0,
    last_24h: {
      auto_sent: actions.filter(a => a.status === 'executed').length,
      queued: actions.filter(a => a.status === 'queued').length,
      total: actions.length,
    },
    recent_actions: actions.slice(0, 20),
  })
}))
