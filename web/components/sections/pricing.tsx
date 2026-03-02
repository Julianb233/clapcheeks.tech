import Link from 'next/link'
import { Check } from 'lucide-react'

const plans = [
  {
    name: 'Starter',
    price: '$29',
    period: '/mo',
    tagline: 'Perfect for getting started',
    features: [
      '3 platforms: Tinder, Bumble, Hinge',
      '100 swipes/day per platform',
      'AI conversation replies',
      'Basic analytics',
    ],
    cta: 'Get Started',
    ctaHref: '/pricing',
    popular: false,
  },
  {
    name: 'Pro',
    price: '$59',
    period: '/mo',
    tagline: 'For serious daters',
    features: [
      'Everything in Starter +',
      '7 platforms (+ Grindr, Badoo, Happn, OKCupid)',
      '150 swipes/day',
      'Calendar date booking',
      'NLP style personalization',
      'Photo optimizer',
    ],
    cta: 'Get Started',
    ctaHref: '/pricing',
    popular: true,
  },
  {
    name: 'Elite',
    price: '$99',
    period: '/mo',
    tagline: 'The unfair advantage',
    features: [
      'Everything in Pro +',
      'All 10 platforms',
      '300 swipes/day',
      'Re-engagement sequences',
      'Priority support',
    ],
    cta: 'Get Started',
    ctaHref: '/pricing',
    popular: false,
  },
]

export default function Pricing() {
  return (
    <section id="pricing" className="py-28 px-6 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[700px] h-[700px] bg-brand-900"
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">Simple pricing</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5">
            Simple, Transparent Pricing
          </h2>
          <p className="text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            Start free. Upgrade when you&apos;re ready.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl p-6 transition-all duration-300 ${
                plan.popular
                  ? 'bg-brand-900/30 border-2 border-[#D4AF37]/60 md:scale-105 md:-my-2 shadow-lg shadow-[#D4AF37]/10'
                  : 'bg-white/[0.02] border border-white/8 hover:border-white/15'
              }`}
            >
              {/* Popular badge */}
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-[#D4AF37] to-[#F5D76E] text-black text-xs font-bold px-4 py-1 rounded-full shadow-lg shadow-[#D4AF37]/30 whitespace-nowrap">
                    MOST POPULAR
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className="mb-6 pt-2">
                <h3
                  className={`text-base font-bold mb-1 ${
                    plan.popular ? 'text-[#D4AF37]' : 'text-white/70'
                  }`}
                >
                  {plan.name}
                </h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-white/35 text-sm">{plan.period}</span>
                </div>
                <p className="text-xs text-white/35">{plan.tagline}</p>
              </div>

              {/* Divider */}
              <div
                className={`h-px mb-6 ${
                  plan.popular
                    ? 'bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent'
                    : 'bg-white/6'
                }`}
              />

              {/* Features */}
              <ul className="space-y-3 flex-1 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        plan.popular
                          ? 'bg-[#D4AF37]/20 border border-[#D4AF37]/40'
                          : 'bg-white/6 border border-white/10'
                      }`}
                    >
                      <Check
                        size={9}
                        className={plan.popular ? 'text-[#D4AF37]' : 'text-white/40'}
                      />
                    </div>
                    <span className="text-sm text-white/55 leading-snug">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Link
                href={plan.ctaHref}
                className={`block text-center font-semibold text-sm py-3 rounded-xl transition-all duration-200 active:scale-[0.98] ${
                  plan.popular
                    ? 'bg-gradient-to-r from-[#D4AF37] to-[#F5D76E] hover:from-[#C4A030] hover:to-[#E5C75E] text-black shadow-lg shadow-[#D4AF37]/30'
                    : 'bg-white/6 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Free tier note */}
        <div className="text-center mt-10">
          <p className="text-sm text-white/40 mb-2">
            Start free — Tinder only, 50 swipes/day, no credit card required.
          </p>
          <Link
            href="/signup"
            className="text-brand-400 hover:text-brand-300 text-sm font-semibold transition-colors"
          >
            Sign up free &rarr;
          </Link>
        </div>

        {/* Bottom note */}
        <div className="text-center mt-6">
          <p className="text-xs text-white/25">
            All prices in USD &middot; Cancel anytime &middot; 7-day free trial on all plans
          </p>
        </div>
      </div>
    </section>
  )
}
