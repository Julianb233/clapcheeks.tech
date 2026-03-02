import { Router } from 'express'
export const router = Router()

// POST /auth/register — create user profile after Supabase signup
router.post('/register', async (req, res) => {
  res.json({ message: 'stub' })
})
