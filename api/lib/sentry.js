import * as Sentry from '@sentry/node'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',

    // Performance monitoring: 10% in prod, 100% in dev
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Filter out health check noise
    ignoreTransactions: ['/health'],
  })

  console.log('[Sentry] Initialized for Express API')
} else {
  console.log('[Sentry] Skipped — SENTRY_DSN not set')
}

export { Sentry }
export default Sentry
