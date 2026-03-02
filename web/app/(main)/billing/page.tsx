import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BillingClient from './billing-client'

export const metadata: Metadata = {
  title: 'Billing — Outward',
  description: 'Manage your subscription, view invoices, and update payment method.',
}

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, subscription_status, stripe_customer_id, stripe_subscription_id')
    .eq('id', user.id)
    .single()

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="orb w-96 h-96 bg-brand-600"
          style={{ top: '10%', left: '50%', transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="relative max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Billing</h1>
            <p className="text-white/40 text-sm mt-1">Manage your subscription and payments</p>
          </div>
          <a
            href="/dashboard"
            className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
          >
            Back to Dashboard
          </a>
        </div>

        <BillingClient
          plan={profile?.plan || 'base'}
          subscriptionStatus={profile?.subscription_status || 'inactive'}
          hasStripeCustomer={!!profile?.stripe_customer_id}
        />
      </div>
    </div>
  )
}
