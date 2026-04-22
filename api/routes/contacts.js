import { Router } from 'express'
import { supabase, validateAgentToken } from '../server.js'
import { requirePlan } from '../middleware/requirePlan.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { validatePlatform } from '../middleware/validate.js'

export const router = Router()

// POST /contacts — create a new contact profile
router.post('/', validateAgentToken, requirePlan('pro'), validatePlatform, asyncHandler(async (req, res) => {
  const { name, platform, platform_match_id, profile_url, avatar_url, zodiac_sign, zodiac_source, ig_username } = req.body
  if (!name || !platform) {
    return res.status(400).json({ error: 'name and platform required' })
  }

  const { data, error } = await supabase
    .from('clapcheeks_contact_profiles')
    .upsert({
      user_id: req.userId,
      name,
      platform,
      platform_match_id: platform_match_id || null,
      profile_url: profile_url || null,
      avatar_url: avatar_url || null,
      zodiac_sign: zodiac_sign || null,
      zodiac_source: zodiac_source || null,
      ig_username: ig_username || null,
    }, { onConflict: 'user_id,platform,platform_match_id' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
}))

// GET /contacts — list all contacts for user
router.get('/', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const { status, stage, platform, limit: lim } = req.query

  let query = supabase
    .from('clapcheeks_contact_profiles')
    .select('*')
    .eq('user_id', req.userId)
    .order('last_message_date', { ascending: false, nullsFirst: false })
    .limit(parseInt(lim) || 50)

  if (status) query = query.eq('status', status)
  if (stage) query = query.eq('current_stage', stage)
  if (platform) query = query.eq('platform', platform)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ contacts: data || [], count: (data || []).length })
}))

// GET /contacts/:id — get full contact context (calls RPC)
router.get('/:id', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  // First verify ownership
  const { data: profile, error: ownerErr } = await supabase
    .from('clapcheeks_contact_profiles')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (ownerErr || !profile) {
    return res.status(404).json({ error: 'Contact not found' })
  }

  // Get full context via RPC
  const { data, error } = await supabase.rpc('get_contact_context', {
    p_contact_id: req.params.id
  })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data || {})
}))

// PUT /contacts/:id — update contact profile
router.put('/:id', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const allowed = [
    'name', 'status', 'current_stage', 'profile_url', 'avatar_url',
    'user_notes', 'zodiac_sign', 'zodiac_source',
    'estimated_attachment_style', 'estimated_love_language',
    'ig_username', 'ig_bio', 'ig_follower_count', 'ig_following_count',
    'ig_post_count', 'ig_is_private', 'ig_scraped_at',
    'total_messages_sent', 'total_messages_received',
    'first_message_date', 'last_message_date',
    'initiation_ratio', 'avg_engagement_score', 'sentiment_trend',
    'red_flags', 'boundaries_expressed',
  ]

  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  const { data, error } = await supabase
    .from('clapcheeks_contact_profiles')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Contact not found' })
  res.json(data)
}))

// DELETE /contacts/:id — archive contact
router.delete('/:id', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('clapcheeks_contact_profiles')
    .update({ status: 'archived' })
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Contact not found' })
  res.json({ archived: true, id: data.id })
}))

// POST /contacts/:id/interests — add/update an interest
router.post('/:id/interests', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const { topic, category, intensity_score, source_message_snippet } = req.body
  if (!topic) {
    return res.status(400).json({ error: 'topic required' })
  }

  // Verify contact ownership
  const { data: contact } = await supabase
    .from('clapcheeks_contact_profiles')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  // Upsert: if same topic exists, increment mention count
  const { data: existing } = await supabase
    .from('clapcheeks_contact_interests')
    .select('id, mention_count')
    .eq('contact_id', req.params.id)
    .eq('topic', topic)
    .single()

  let result
  if (existing) {
    const { data, error } = await supabase
      .from('clapcheeks_contact_interests')
      .update({
        mention_count: existing.mention_count + 1,
        last_mentioned: new Date().toISOString(),
        intensity_score: intensity_score || undefined,
      })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    result = data
  } else {
    const { data, error } = await supabase
      .from('clapcheeks_contact_interests')
      .insert({
        contact_id: req.params.id,
        user_id: req.userId,
        topic,
        category: category || null,
        intensity_score: intensity_score || 0.5,
        source_message_snippet: source_message_snippet || null,
      })
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    result = data
  }

  res.status(201).json(result)
}))

// POST /contacts/:id/memories — add a memory
router.post('/:id/memories', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const { memory_type, content, context, source_message_snippet, expires_at, emotional_weight } = req.body
  if (!memory_type || !content) {
    return res.status(400).json({ error: 'memory_type and content required' })
  }

  // Verify contact ownership
  const { data: contact } = await supabase
    .from('clapcheeks_contact_profiles')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  const { data, error } = await supabase
    .from('clapcheeks_contact_memory_bank')
    .insert({
      contact_id: req.params.id,
      user_id: req.userId,
      memory_type,
      content,
      context: context || null,
      source_message_snippet: source_message_snippet || null,
      expires_at: expires_at || null,
      emotional_weight: emotional_weight || 0.5,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
}))

// GET /contacts/:id/intelligence — get conversation intelligence
router.get('/:id/intelligence', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const { limit: lim, sender } = req.query

  let query = supabase
    .from('clapcheeks_conversation_intelligence')
    .select('*')
    .eq('contact_id', req.params.id)
    .eq('user_id', req.userId)
    .order('sent_at', { ascending: false })
    .limit(parseInt(lim) || 50)

  if (sender) query = query.eq('sender', sender)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ messages: data || [], count: (data || []).length })
}))

// POST /contacts/:id/intelligence — add message intelligence
router.post('/:id/intelligence', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const {
    sender, sent_at, sentiment, detected_emotion, emotion_confidence,
    engagement_score, message_length, question_count, topics_mentioned,
    entities_detected, callback_opportunities, response_time_seconds,
    analyzed_by, message_id, message_index
  } = req.body

  if (!sender) {
    return res.status(400).json({ error: 'sender required (user or contact)' })
  }

  // Verify contact ownership
  const { data: contact } = await supabase
    .from('clapcheeks_contact_profiles')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  const { data, error } = await supabase
    .from('clapcheeks_conversation_intelligence')
    .insert({
      contact_id: req.params.id,
      user_id: req.userId,
      sender,
      sent_at: sent_at || new Date().toISOString(),
      sentiment: sentiment ?? null,
      detected_emotion: detected_emotion || null,
      emotion_confidence: emotion_confidence ?? null,
      engagement_score: engagement_score ?? null,
      message_length: message_length || null,
      question_count: question_count || 0,
      topics_mentioned: topics_mentioned || [],
      entities_detected: entities_detected || [],
      callback_opportunities: callback_opportunities || [],
      response_time_seconds: response_time_seconds || null,
      analyzed_by: analyzed_by || null,
      message_id: message_id || null,
      message_index: message_index || null,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
}))

// PUT /contacts/:id/rules — set response rules
router.put('/:id/rules', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const {
    mode, min_response_delay_seconds, max_response_delay_seconds,
    quiet_hours_start, quiet_hours_end, timezone, cadence_rule,
    tone_override, max_messages_per_day, max_initiations_per_week,
    auto_extract_memories, auto_analyze_sentiment, suggest_callbacks
  } = req.body

  // Verify contact ownership
  const { data: contact } = await supabase
    .from('clapcheeks_contact_profiles')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  const { data, error } = await supabase
    .from('clapcheeks_contact_response_rules')
    .upsert({
      contact_id: req.params.id,
      user_id: req.userId,
      mode: mode || 'suggest',
      min_response_delay_seconds: min_response_delay_seconds ?? 120,
      max_response_delay_seconds: max_response_delay_seconds ?? 7200,
      quiet_hours_start: quiet_hours_start || null,
      quiet_hours_end: quiet_hours_end || null,
      timezone: timezone || 'America/Los_Angeles',
      cadence_rule: cadence_rule || null,
      tone_override: tone_override || null,
      max_messages_per_day: max_messages_per_day || null,
      max_initiations_per_week: max_initiations_per_week ?? 3,
      auto_extract_memories: auto_extract_memories ?? true,
      auto_analyze_sentiment: auto_analyze_sentiment ?? true,
      suggest_callbacks: suggest_callbacks ?? true,
    }, { onConflict: 'contact_id' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
}))

// PUT /contacts/:id/style — upsert communication style profile
router.put('/:id/style', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const allowed = [
    'avg_response_time_seconds', 'median_response_time_seconds', 'response_time_variance',
    'avg_message_length', 'median_message_length', 'messages_per_turn',
    'emoji_frequency', 'top_emojis', 'humor_style',
    'formality_level', 'energy_level',
    'uses_abbreviations', 'capitalization_style', 'punctuation_style', 'question_frequency',
    'love_lang_words_of_affirmation', 'love_lang_quality_time',
    'love_lang_acts_of_service', 'love_lang_gifts', 'love_lang_physical_touch',
    'messages_analyzed', 'confidence_score',
  ]

  const updates = { contact_id: req.params.id, user_id: req.userId }
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  // Verify contact ownership
  const { data: contact } = await supabase
    .from('clapcheeks_contact_profiles')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  const { data, error } = await supabase
    .from('clapcheeks_contact_style_profiles')
    .upsert(updates, { onConflict: 'contact_id' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
}))

// POST /contacts/:id/completeness — recalculate profile completeness
router.post('/:id/completeness', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  // Verify contact ownership
  const { data: contact } = await supabase
    .from('clapcheeks_contact_profiles')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  const { data, error } = await supabase.rpc('update_contact_completeness', {
    p_contact_id: req.params.id
  })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ completeness: data })
}))
