import { createServerClient } from "@/lib/convex/compat-client"
import { getCurrentOperatorUser } from "@/lib/auth/operator-session"

export async function createClient() {
  return createServerClient({ user: await getCurrentOperatorUser() })
}
