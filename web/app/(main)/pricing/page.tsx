import type { Metadata } from 'next'
import Pricing from '@/components/sections/pricing'
import CTA from '@/components/sections/cta'

export const metadata: Metadata = {
  title: 'Pricing — Outward',
  description:
    'Simple, transparent pricing for your AI dating co-pilot. Start free for 7 days, no credit card required.',
}

export default function PricingPage() {
  return (
    <div className="pt-16">
      <div className="text-center py-16 px-6">
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          Simple, transparent pricing
        </h1>
        <p className="text-white/50 text-lg max-w-xl mx-auto">
          Start with a 7-day free trial. No credit card required. Cancel anytime.
        </p>
      </div>
      <Pricing />
      <CTA />
    </div>
  )
}
