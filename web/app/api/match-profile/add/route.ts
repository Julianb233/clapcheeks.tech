import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, platform, age, birthday, ig_handle, bio, notes, quick_tags } = body

  if (!name || !platform) {
    return NextResponse.json({ error: 'Name and platform are required' }, { status: 400 })
  }

  // Generate a match_id if not provided
  const match_id = body.match_id || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const { data, error } = await supabase
    .from('clapcheeks_match_profiles')
    .insert({
      user_id: user.id,
      name,
      platform,
      match_id,
      age: age ? parseInt(age) : null,
      birthday: birthday || null,
      bio: bio || null,
      ig_handle: ig_handle || null,
      notes: notes || null,
      quick_tags: quick_tags || [],
      enrichment_status: 'pending',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Trigger background enrichment (non-blocking)
  if (data?.id) {
    fetch(`${request.nextUrl.origin}/api/match-profile/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') || '' },
      body: JSON.stringify({ profile_id: data.id }),
    }).catch(() => { /* fire and forget */ })
  }

  return NextResponse.json({ profile: data })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('clapcheeks_match_profiles')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ profiles: data })
}
