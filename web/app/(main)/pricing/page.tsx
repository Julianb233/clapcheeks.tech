import type { Metadata } from 'next'
import { Check, X } from 'lucide-react'
import PricingClient from './pricing-client'

export const metadata: Metadata = {
  title: 'Pricing — Outward',
  description:
    'Simple, premium pricing for your AI dating co-pilot. Two plans, powerful add-ons.',
}

const tiers = [
  {
    name: 'Base',
    price: '$97',
    period: '/mo',
    tagline: 'Everything you need to start winning',
    plan: 'base',
    cta: 'Get Started',
    popular: false,
    features: [
      '1 dating app (Tinder, Bumble, or Hinge)',
      'iMessage AI — replies in your voice',
      'Basic analytics dashboard',
      '500 AI-powered swipes per day',
      'Weekly summary report',
      'Email support',
    ],
  },
  {
    name: 'Elite',
    price: '$197',
    period: '/mo',
    tagline: 'The unfair advantage',
    plan: 'elite',
    cta: 'Go Elite',
    popular: true,
    features: [
      'Unlimited dating apps',
      'iMessage AI — all features + voice tuning',
      'Full analytics + conversion tracking',
      'Unlimited AI swipes per day',
      'AI coaching & weekly recommendations',
      'Date booking & calendar sync',
      'Priority support + Slack channel',
      'Early access to new features',
    ],
  },
]

const addons = [
  {
    id: 'profile-doctor',
    name: 'Profile Doctor',
    price: '$15',
    description: 'AI-powered profile review with photo ranking, bio rewriting, and prompt optimization.',
  },
  {
    id: 'super-opener',
    name: 'Super Opener 10-pack',
    price: '$27',
    description: 'Ten custom-crafted opening messages based on their profile, optimized for response rate.',
  },
  {
    id: 'turbo-session',
    name: 'Turbo Session',
    price: '$9',
    description: 'One-hour burst of max-speed swiping with boosted match priority on all platforms.',
  },
  {
    id: 'voice-calibration',
    name: 'Voice Calibration',
    price: '$97',
    description: 'One-on-one session to fine-tune your AI voice model for perfectly natural conversations.',
  },
]

const comparisonFeatures = [
  { name: 'Dating apps supported', base: '1', elite: 'Unlimited' },
  { name: 'Daily AI swipes', base: '500', elite: 'Unlimited' },
  { name: 'iMessage AI replies', base: true, elite: true },
  { name: 'Voice tuning', base: false, elite: true },
  { name: 'Analytics dashboard', base: 'Basic', elite: 'Full + heatmaps' },
  { name: 'Conversion tracking', base: false, elite: true },
  { name: 'AI coaching', base: false, elite: true },
  { name: 'Date booking & calendar sync', base: false, elite: true },
  { name: 'Weekly summary report', base: true, elite: true },
  { name: 'Support', base: 'Email', elite: 'Priority + Slack' },
  { name: 'Early access to features', base: false, elite: true },
  { name: 'API access', base: false, elite: true },
]

const faqs = [
  {
    q: 'Is my data private? What can you see?',
    a: 'Outward runs entirely on your Mac. Your dating profiles, messages, and photos never leave your device. We only receive anonymous, aggregated analytics (match counts, swipe rates) to improve the AI. We cannot see your conversations or personal data.',
  },
  {
    q: 'Do I need a Mac to use Outward?',
    a: 'Yes. The local agent runs natively on macOS (Apple Silicon & Intel). It needs access to your dating apps and iMessage, which requires macOS. We are exploring Windows and Linux support for a future release.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Absolutely. Cancel from your billing dashboard with one click. Your subscription stays active until the end of the current billing period — no prorating, no questions asked.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: 'All local data stays on your Mac. We delete your account data from our servers within 30 days of cancellation. You can also request immediate deletion at any time.',
  },
]

export default function PricingPage() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <div className="text-center py-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="orb w-[600px] h-[600px] bg-brand-900"
            style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
          />
        </div>
        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">Simple pricing</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
            Simple, premium pricing
          </h1>
          <p className="text-white/45 text-lg max-w-xl mx-auto leading-relaxed">
            Two plans. No hidden fees. Cancel anytime.
          </p>
        </div>
      </div>

      {/* Tier cards + Addons + Checkout — client component */}
      <PricingClient tiers={tiers} addons={addons} />

      {/* Comparison table */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-12">
            What&apos;s included
          </h2>
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-3 border-b border-white/8 px-6 py-4">
              <div className="text-sm text-white/40 font-medium">Feature</div>
              <div className="text-sm text-white/40 font-medium text-center">Base</div>
              <div className="text-sm text-brand-400 font-medium text-center">Elite</div>
            </div>
            {/* Table rows */}
            {comparisonFeatures.map((f, i) => (
              <div
                key={f.name}
                className={`grid grid-cols-3 px-6 py-3.5 ${
                  i < comparisonFeatures.length - 1 ? 'border-b border-white/5' : ''
                }`}
              >
                <div className="text-sm text-white/60">{f.name}</div>
                <div className="text-sm text-center">
                  {typeof f.base === 'boolean' ? (
                    f.base ? (
                      <Check size={16} className="text-white/40 mx-auto" />
                    ) : (
                      <X size={16} className="text-white/15 mx-auto" />
                    )
                  ) : (
                    <span className="text-white/50">{f.base}</span>
                  )}
                </div>
                <div className="text-sm text-center">
                  {typeof f.elite === 'boolean' ? (
                    f.elite ? (
                      <Check size={16} className="text-brand-400 mx-auto" />
                    ) : (
                      <X size={16} className="text-white/15 mx-auto" />
                    )
                  ) : (
                    <span className="text-brand-300">{f.elite}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-6">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-12">
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <div
                key={faq.q}
                className="bg-white/[0.02] border border-white/8 rounded-xl p-6"
              >
                <h3 className="text-white font-semibold mb-2">{faq.q}</h3>
                <p className="text-white/45 text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
