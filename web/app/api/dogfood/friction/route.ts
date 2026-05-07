import { NextRequest, NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'

import { createClient } from '@/lib/supabase/server'
import { api } from '@/convex/_generated/api'

// AI-9536 — friction_points now lives on Convex.

const ALLOWED_SEVERITY = new Set([
  'blocker',
  'major',
  'minor',
  'cosmetic',
] as const)
type Severity = 'blocker' | 'major' | 'minor' | 'cosmetic'

const ALLOWED_CATEGORY = new Set([
  'swiping',
  'conversation',
  'agent_setup',
  'auth',
  'stripe',
  'dashboard',
  'reports',
  'performance',
  'crash',
  'ux',
  'other',
] as const)
type Category =
  | 'swiping'
  | 'conversation'
  | 'agent_setup'
  | 'auth'
  | 'stripe'
  | 'dashboard'
  | 'reports'
  | 'performance'
  | 'crash'
  | 'ux'
  | 'other'

function getConvex(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  return url ? new ConvexHttpClient(url) : null
}

/**
 * POST /api/dogfood/friction — log a friction point from the web UI.
 * Body: { title, description?, severity?, category?, platform? }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, description, severity, category, platform } = body

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const convex = getConvex()
  if (!convex) {
    return NextResponse.json(
      { error: 'server_unconfigured', detail: 'CONVEX_URL not set' },
      { status: 500 },
    )
  }

  const sev: Severity = ALLOWED_SEVERITY.has(severity)
    ? (severity as Severity)
    : 'minor'
  const cat: Category = ALLOWED_CATEGORY.has(category)
    ? (category as Category)
    : 'ux'

  try {
    const result = await convex.mutation(api.telemetry.recordFriction, {
      user_id: user.id,
      title,
      description: description || title,
      severity: sev,
      category: cat,
      platform: platform || undefined,
      auto_detected: false,
    })
    return NextResponse.json({ friction: { id: result._id } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * GET /api/dogfood/friction — list friction points for the current user.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const convex = getConvex()
  if (!convex) {
    return NextResponse.json({ friction: [] })
  }

  try {
    const rows = await convex.query(api.telemetry.listFrictionForUser, {
      user_id: user.id,
      limit: 100,
    })
    return NextResponse.json({ friction: rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
