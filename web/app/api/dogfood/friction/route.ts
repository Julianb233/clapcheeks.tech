import { createClient } from '@/lib/convex/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/dogfood/friction — log a friction point from the web UI.
 * Body: { title, description?, severity?, category?, platform? }
 */
export async function POST(req: NextRequest) {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, description, severity, category, platform } = body

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const { data, error } = await convex
    .from('clapcheeks_friction_points')
    .insert({
      user_id: user.id,
      title,
      description: description || title,
      severity: severity || 'minor',
      category: category || 'ux',
      platform: platform || null,
      auto_detected: false,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ friction: data })
}

/**
 * GET /api/dogfood/friction — list friction points for the current user.
 */
export async function GET() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await convex
    .from('clapcheeks_friction_points')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ friction: data })
}
