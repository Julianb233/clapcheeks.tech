import { NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const convex = await createClient()
    const { error } = await convex.auth.exchangeCodeForSession(code)
    if (!error) {
      // Check if user has completed onboarding
      const { data: { user } } = await convex.auth.getUser()
      if (user) {
        const { data: profile } = await convex
          .from('profiles')
          .select('onboarding_completed')
          .eq('id', user.id)
          .single()

        if (!profile?.onboarding_completed) {
          return NextResponse.redirect(`${origin}/onboarding`)
        }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return to login with error
  return NextResponse.redirect(`${origin}/login?error=Could not authenticate`)
}
