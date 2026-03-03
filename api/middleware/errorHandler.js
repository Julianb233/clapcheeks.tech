export function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message)

  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production'
    ? 'An internal error occurred'
    : err.message

  res.status(err.status || 500).json({ error: message })
}
