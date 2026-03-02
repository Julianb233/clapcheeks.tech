import type { Metadata } from 'next'
import PricingClient from './pricing-client'

export const metadata: Metadata = {
  title: 'Pricing — Clapcheeks',
  description:
    'Simple, transparent pricing for your AI dating co-pilot. Start free, upgrade when you\'re ready.',
}

const tiers = [
  {
    name: 'Starter',
    monthlyPrice: 29,
    annualPrice: 23,
    tagline: 'Perfect for getting started',
    plan: 'starter',
    cta: 'Get Started',
    popular: false,
    features: [
      '3 platforms: Tinder, Bumble, Hinge',
      '100 swipes/day per platform',
      'AI conversation replies',
      'Basic analytics',
    ],
  },
  {
    name: 'Pro',
    monthlyPrice: 59,
    annualPrice: 47,
    tagline: 'For serious daters',
    plan: 'pro',
    cta: 'Get Started',
    popular: true,
    features: [
      'Everything in Starter +',
      '7 platforms (+ Grindr, Badoo, Happn, OKCupid)',
      '150 swipes/day',
      'Calendar date booking',
      'NLP style personalization',
      'Photo optimizer',
    ],
  },
  {
    name: 'Elite',
    monthlyPrice: 99,
    annualPrice: 79,
    tagline: 'The unfair advantage',
    plan: 'elite',
    cta: 'Get Started',
    popular: false,
    features: [
      'Everything in Pro +',
      'All 10 platforms',
      '300 swipes/day',
      'Re-engagement sequences',
      'Priority support',
    ],
  },
]

const faqs = [
  {
    q: 'Can I get banned?',
    a: 'Yes, risk exists with any automation tool. We enforce strict rate limits and human-like Gaussian-jittered delays to minimize detection, but no tool can guarantee zero risk. Use responsibly.',
  },
  {
    q: 'Does it work without a phone?',
    a: 'Yes. Mac Cloud browser mode uses Browserbase (managed Chromium with residential proxies) so you can swipe without your phone. iPhone USB and WiFi modes are also available.',
  },
  {
    q: 'What AI does it use?',
    a: 'Kimi 2.5 (Moonshot AI) by default for conversation replies and openers. You can optionally use Ollama for 100% local, private AI that never leaves your machine.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Absolutely. Cancel from your dashboard with one click. Your subscription stays active until the end of the current billing period — no questions asked.',
  },
  {
    q: 'Is my data private?',
    a: 'Only aggregate stats (match counts, swipe rates) sync to our servers to improve the AI. Messages, match names, and personal data never leave your device.',
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
            Simple, Transparent Pricing
          </h1>
          <p className="text-white/45 text-lg max-w-xl mx-auto leading-relaxed">
            Start free. Upgrade when you&apos;re ready.
          </p>
        </div>
      </div>

      {/* Tier cards + Billing toggle — client component */}
      <PricingClient tiers={tiers} />

      {/* Free tier note */}
      <div className="text-center px-6 pb-16">
        <p className="text-white/40 text-sm mb-3">
          Start free — Tinder only, 50 swipes/day, no credit card required.
        </p>
        <a
          href="/signup"
          className="inline-flex items-center gap-1.5 text-brand-400 hover:text-brand-300 text-sm font-semibold transition-colors"
        >
          Sign up free
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </a>
      </div>

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

      {/* Bottom note */}
      <div className="text-center pb-20 px-6">
        <p className="text-xs text-white/25">
          All prices in USD &middot; Cancel anytime &middot; 7-day free trial on all plans
        </p>
        <p className="text-xs text-white/20 mt-2">
          Need a custom plan for a team or agency?{' '}
          <a
            href="mailto:hello@clapcheeks.tech"
            className="text-brand-400 hover:text-brand-300 transition-colors"
          >
            Get in touch
          </a>
        </p>
      </div>
    </div>
  )
}
