import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OnboardingWizard } from './onboarding-wizard'
import PageOrbs from '@/components/page-orbs'

export const metadata: Metadata = {
  title: 'Get Started — Clapcheeks',
  description: 'Set up your Clapcheeks AI dating co-pilot.',
}

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', user.id)
    .single()

  const plan = profile?.subscription_tier || 'free'

  return (
    <div className="relative min-h-screen bg-black">
      <PageOrbs />
      <div className="relative" style={{ zIndex: 1 }}>
        <OnboardingWizard userId={user.id} plan={plan} />
      </div>
    </div>
  )
}
