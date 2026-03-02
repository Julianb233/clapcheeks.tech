import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  console.log("[v0] Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log("[v0] Supabase Key exists:", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
}
