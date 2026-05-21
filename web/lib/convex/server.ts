import { ConvexHttpClient } from 'convex/browser'
import { createServerClient } from "@/lib/convex/compat-client"
import { getCurrentOperatorUser } from "@/lib/auth/operator-session"

let cached: ConvexHttpClient | null = null

export async function createClient() {
  return createServerClient({ user: await getCurrentOperatorUser() })
}

export function getConvexServerClient(): ConvexHttpClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error('NEXT_PUBLIC_CONVEX_URL is not configured')
  }
  cached = new ConvexHttpClient(url)
  return cached
}
