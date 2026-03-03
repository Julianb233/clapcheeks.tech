import { Router } from 'express'
import { supabase, validateAgentToken } from '../server.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { validatePlatform } from '../middleware/validate.js'

export const router = Router()

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!jwt) return res.status(401).json({ error: 'Missing auth token' })
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })
  req.user = user
  next()
}

// POST /events/agent — receive events from agent daemon
router.post('/agent', validateAgentToken, validatePlatform, asyncHandler(async (req, res) => {
  const { event, data, ts } = req.body

  if (!event) return res.status(400).json({ error: 'Missing event type' })

  // Store event in Supabase
  const { error: insertErr } = await supabase
    .from('clapcheeks_agent_events')
    .insert({
      user_id: req.userId,
      event_type: event,
      data,
      occurred_at: ts || new Date().toISOString(),
    })

  if (insertErr) {
    console.error('Failed to store agent event:', insertErr.message)
    return res.status(500).json({ error: 'Failed to store event' })
  }

  // Trigger push notification for important events
  const notifyEvents = ['match_received', 'date_booked', 'ban_detected']
  if (notifyEvents.includes(event)) {
    await sendPushNotification(req.userId, event, data)
  }

  res.json({ received: true })
}))

// POST /events/push-token — register Expo push token from mobile app
router.post('/push-token', requireAuth, asyncHandler(async (req, res) => {
  const { expo_token, device_name } = req.body

  if (!expo_token) return res.status(400).json({ error: 'Missing expo_token' })

  const { error } = await supabase
    .from('clapcheeks_push_tokens')
    .upsert(
      { user_id: req.user.id, expo_token, device_name: device_name || null },
      { onConflict: 'user_id,expo_token' },
    )

  if (error) return res.status(500).json({ error: error.message })

  res.json({ registered: true })
}))

// DELETE /events/push-token — unregister Expo push token
router.delete('/push-token', requireAuth, asyncHandler(async (req, res) => {
  const { expo_token } = req.body

  if (!expo_token) return res.status(400).json({ error: 'Missing expo_token' })

  const { error } = await supabase
    .from('clapcheeks_push_tokens')
    .delete()
    .eq('user_id', req.user.id)
    .eq('expo_token', expo_token)

  if (error) return res.status(500).json({ error: error.message })

  res.json({ removed: true })
}))

function formatPushMessage(event, data) {
  switch (event) {
    case 'match_received':
      return {
        title: 'New Match!',
        body: `New match on ${data.platform}: ${data.match_name}`,
      }
    case 'date_booked':
      return {
        title: 'Date Booked!',
        body: `Date booked with ${data.match_name}! Check your calendar`,
      }
    case 'ban_detected':
      return {
        title: 'Platform Paused',
        body: `${data.platform} paused — ${data.ban_type} detected`,
      }
    default:
      return { title: 'Clapcheeks', body: `Event: ${event}` }
  }
}

async function sendPushNotification(userId, event, data) {
  try {
    const { data: tokens, error } = await supabase
      .from('clapcheeks_push_tokens')
      .select('expo_token')
      .eq('user_id', userId)

    if (error || !tokens || tokens.length === 0) return

    const { title, body } = formatPushMessage(event, data)

    const messages = tokens.map(t => ({
      to: t.expo_token,
      sound: 'default',
      title,
      body,
      data: { event, ...data },
    }))

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    })
  } catch (err) {
    console.error('Push notification failed:', err.message)
  }
}
