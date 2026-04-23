/**
 * Security middleware — OWASP hardening for the Express API
 *
 * Covers:
 * - Request ID injection (correlation)
 * - Suspicious payload detection
 * - Security event logging
 * - IP-based request tracking
 */

import { randomUUID } from 'crypto'

/**
 * Inject a unique request ID for log correlation
 */
export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
}

/**
 * Log security-relevant events
 */
const securityEvents = []
const MAX_EVENTS = 1000

export function logSecurityEvent(event) {
  securityEvents.push({
    ...event,
    timestamp: new Date().toISOString(),
  })
  // Keep ring buffer bounded
  if (securityEvents.length > MAX_EVENTS) {
    securityEvents.shift()
  }
}

export function getSecurityEvents() {
  return securityEvents
}

/**
 * Detect and block suspicious payloads (A03: Injection)
 */
const SUSPICIOUS_PATTERNS = [
  /(<script[^>]*>)/i,                     // XSS
  /(javascript:)/i,                        // XSS in URLs
  /(on\w+\s*=)/i,                          // Event handler injection
  /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b.*\b(FROM|INTO|TABLE|SET)\b)/i, // SQL injection
  /(\.\.\/(\.\.\/)+)/,                     // Path traversal
  /(\/etc\/passwd|\/proc\/self)/i,          // LFI
]

export function suspiciousPayloadDetector(req, res, next) {
  const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(bodyStr) || pattern.test(req.url)) {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
      logSecurityEvent({
        type: 'suspicious_payload',
        severity: 'warning',
        ip,
        method: req.method,
        path: req.path,
        pattern: pattern.source,
        requestId: req.id,
      })

      console.warn(`[SECURITY] Suspicious payload from ${ip}: ${req.method} ${req.path} matched ${pattern.source}`)

      // Don't block — just log. False positives are worse than missed attacks at this stage.
      // Upgrade to blocking after tuning.
      break
    }
  }

  next()
}

/**
 * Track request rate per IP (supplement to express-rate-limit)
 * Useful for identifying abuse patterns in logs
 */
const ipRequestCounts = new Map()
const WINDOW_MS = 60 * 1000

export function requestTracker(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
  const now = Date.now()

  if (!ipRequestCounts.has(ip)) {
    ipRequestCounts.set(ip, { count: 0, windowStart: now })
  }

  const entry = ipRequestCounts.get(ip)
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 0
    entry.windowStart = now
  }
  entry.count++

  // Log high-volume IPs
  if (entry.count === 200) {
    logSecurityEvent({
      type: 'high_volume_ip',
      severity: 'info',
      ip,
      count: entry.count,
      window_ms: WINDOW_MS,
    })
    console.warn(`[SECURITY] High volume from ${ip}: ${entry.count} requests in ${WINDOW_MS / 1000}s`)
  }

  next()
}

// Clean up IP tracking every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 5
  for (const [ip, entry] of ipRequestCounts.entries()) {
    if (entry.windowStart < cutoff) {
      ipRequestCounts.delete(ip)
    }
  }
}, 5 * 60 * 1000)
