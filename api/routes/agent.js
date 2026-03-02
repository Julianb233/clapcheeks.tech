import { Router } from 'express'
export const router = Router()

// POST /agent/register — register a new local agent device
router.post('/register', async (req, res) => {
  res.json({ agent_token: 'stub-token', message: 'Device registered' })
})

// GET /agent/config — return user's preferences/config for local agent
router.get('/config', async (req, res) => {
  res.json({ swipe_limit_daily: 500, apps_enabled: ['tinder', 'bumble', 'hinge'] })
})
