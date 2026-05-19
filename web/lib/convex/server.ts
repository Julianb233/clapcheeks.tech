import { createServerClient } from "@/lib/convex/compat-client"

export async function createClient() {
  return createServerClient()
}
