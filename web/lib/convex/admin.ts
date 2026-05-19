import { createAdminClient as createConvexAdminClient } from "@/lib/convex/compat-client"

export function createAdminClient() {
  return createConvexAdminClient()
}
