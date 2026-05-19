import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/compat-client'

const convexAdmin = createClient(
  process.env.NEXT_PUBLIC_CONVEX_URL!,
  process.env.CONVEX_DEPLOY_KEY!
)

export async function POST(request: NextRequest) {
  const { ref_code } = await request.json()

  if (!ref_code || typeof ref_code !== 'string' || ref_code.length > 20) {
    return NextResponse.json({ error: 'Invalid referral code' }, { status: 400 })
  }

  // Verify the ref_code exists
  const { data: referrer } = await convexAdmin
    .from('profiles')
    .select('id')
    .eq('ref_code', ref_code)
    .single()

  if (!referrer) {
    return NextResponse.json({ error: 'Invalid referral code' }, { status: 404 })
  }

  // Set cookie with 30-day expiry
  const response = NextResponse.json({ success: true })
  response.cookies.set('ref_code', ref_code, {
    maxAge: 30 * 24 * 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })

  return response
}
