import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import * as Sentry from "@sentry/nextjs"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const body = await request.json()
    const { type, rating, message } = body
    if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 })
    const { error } = await supabase.from("alpha_feedback").insert({
      user_id: user.id, user_email: user.email, type: type || "general",
      rating: rating || null, message: message.trim(),
      metadata: { user_agent: request.headers.get("user-agent"), timestamp: new Date().toISOString() },
    })
    if (error) { console.error("Feedback insert error:", error); Sentry.captureException(error) }
    return NextResponse.json({ success: true })
  } catch (err) { Sentry.captureException(err); return NextResponse.json({ error: "Internal error" }, { status: 500 }) }
}
