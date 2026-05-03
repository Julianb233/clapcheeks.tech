import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

// Auth endpoints: strict (5 req/min per IP)
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// AI/generation endpoints: per-user (20 req/min)
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.userId || ipKeyGenerator(req.ip),
  message: { error: 'Rate limit exceeded for AI features. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// General API: moderate (100 req/min per IP)
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
})
