// AI-9535 — Shared Convex HTTP client for Next.js server-side routes.
//
// Auth still resolves user_id via Supabase in the calling route. This helper
// is just the wire to talk to Convex from API handlers.
import { ConvexHttpClient } from 'convex/browser'

let cached: ConvexHttpClient | null = null

export function getConvexServerClient(): ConvexHttpClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error('NEXT_PUBLIC_CONVEX_URL is not configured')
  }
  cached = new ConvexHttpClient(url)
  return cached
}
