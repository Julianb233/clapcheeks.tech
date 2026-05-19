import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/compat-client'

const convexAdmin = createClient(
  process.env.NEXT_PUBLIC_CONVEX_URL!,
  process.env.CONVEX_DEPLOY_KEY!
)

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, email, platform, audience_size, message } = body

  if (!name || !email || !platform) {
    return NextResponse.json(
      { error: 'Name, email, and platform are required' },
      { status: 400 }
    )
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  const { error } = await convexAdmin
    .from('clapcheeks_affiliate_applications')
    .insert({
      name,
      email,
      platform,
      audience_size: audience_size || null,
      message: message || null,
    })

  if (error) {
    console.error('Affiliate application error:', error)
    return NextResponse.json(
      { error: 'Failed to submit application' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
