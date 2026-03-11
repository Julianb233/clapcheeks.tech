import { Sentry } from '../lib/sentry.js'

export function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message)

  // Report to Sentry with request context
  Sentry.withScope((scope) => {
    scope.setTag('path', req.path)
    scope.setTag('method', req.method)
    scope.setExtra('query', req.query)
    scope.setExtra('body', req.body)
    if (req.userId) scope.setUser({ id: req.userId })
    Sentry.captureException(err)
  })

  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production'
    ? 'An internal error occurred'
    : err.message

  res.status(err.status || 500).json({ error: message })
}
