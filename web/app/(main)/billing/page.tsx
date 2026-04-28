import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BillingClient from './billing-client'

export const metadata: Metadata = {
  title: 'Billing — Clapcheeks',
  description: 'Manage your subscription, view invoices, and update payment method.',
}

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id')
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
          plan={profile?.subscription_tier || 'base'}
          subscriptionStatus={profile?.subscription_status || 'inactive'}
          hasStripeCustomer={!!profile?.stripe_customer_id}
        />

        {/* Device add-on CTA — moved out of the sidebar 2026-04-27
            (sidebar-audit Fix E). The /device page is a marketing landing
            with a "Coming soon Q3" banner; it's an upsell, not a daily-use
            tool. The page itself is still reachable by URL for marketing. */}
        <div className="mt-8 rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 to-red-600/5 p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500 to-red-600 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16v12H4z M2 20h20" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="text-white font-semibold text-base">Clapcheeks Device</h3>
                <span className="text-[10px] uppercase tracking-widest font-mono text-yellow-300 bg-black/40 px-2 py-0.5 rounded border border-yellow-500/30">
                  add-on · coming Q3
                </span>
              </div>
              <p className="text-white/60 text-sm mt-1">
                Set it and forget it — swipe 24/7 from a dedicated device, no laptop required. $49/mo when it ships.
              </p>
              <Link
                href="/device"
                className="inline-flex items-center gap-1 mt-3 text-xs text-yellow-300 hover:text-yellow-200 font-mono"
              >
                Learn more →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
