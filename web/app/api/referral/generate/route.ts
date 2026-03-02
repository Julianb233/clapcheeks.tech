import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { nanoid } from 'nanoid'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if user already has a ref_code
  const { data: profile } = await supabase
    .from('profiles')
    .select('ref_code')
    .eq('id', user.id)
    .single()

  if (profile?.ref_code) {
    return NextResponse.json({ ref_code: profile.ref_code })
  }

  // Generate a new unique ref code
  const refCode = nanoid(8).toUpperCase()

  const { error } = await supabase
    .from('profiles')
    .update({ ref_code: refCode })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to generate referral code' }, { status: 500 })
  }

  return NextResponse.json({ ref_code: refCode })
}
