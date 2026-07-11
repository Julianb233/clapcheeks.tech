import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// AI-8333 Phase 34 (Closed Alpha): Next.js 15 requires this hook to forward
// server-side render / route-handler / server-action errors to Sentry.
// Without it, only client-side and unhandled-rejection errors are captured —
// server errors during the alpha would be invisible.
export const onRequestError = Sentry.captureRequestError
