import { Router } from 'express'
export const router = Router()

// POST /analytics/sync — receive daily metrics from local agent
router.post('/sync', async (req, res) => {
  // TODO: validate agent token, upsert analytics_daily
  res.json({ received: true })
})

// GET /analytics/summary — return summary for dashboard
router.get('/summary', async (req, res) => {
  res.json({ swipes: 0, matches: 0, dates: 0, spent: 0 })
})
