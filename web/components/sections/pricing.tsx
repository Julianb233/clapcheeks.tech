import Link from 'next/link'
import { Check } from 'lucide-react'

const plans = [
  {
    name: 'Starter',
    price: '$29',
    period: '/mo',
    tagline: 'Perfect for getting started',
    features: [
      '1 dating app (Tinder, Bumble, or Hinge)',
      'iMessage AI — replies in your voice',
      'Basic analytics dashboard',
      '500 AI-powered swipes per day',
      'Weekly summary report',
      'Email support',
    ],
    cta: 'Start free trial',
    ctaHref: '/#install',
    popular: false,
  },
  {
    name: 'Pro',
    price: '$59',
    period: '/mo',
    tagline: 'For serious daters',
    features: [
      '3 dating apps simultaneously',
      'iMessage AI — all features',
      'Unlimited AI swipes per day',
      'Full analytics + conversion tracking',
      'AI coaching & weekly recommendations',
      'Date booking & calendar sync',
      'Priority support',
      'Early access to new features',
    ],
    cta: 'Start free trial',
    ctaHref: '/#install',
    popular: true,
  },
  {
    name: 'Elite',
    price: '$99',
    period: '/mo',
    tagline: 'The unfair advantage',
    features: [
      'Unlimited dating apps',
      'Custom AI persona & voice tuning',
      'Advanced analytics (heatmaps, A/B testing)',
      'White-glove onboarding call',
      'Dedicated account manager',
      'Slack / Discord support channel',
      'API access for custom integrations',
      'Early beta access',
    ],
    cta: 'Talk to us',
    ctaHref: 'mailto:elite@clapcheeks.tech',
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
            Invest in your love life
          </h2>
          <p className="text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            All plans include a 7-day free trial. No credit card required.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl p-6 transition-all duration-300 ${
                plan.popular
                  ? 'bg-brand-900/30 border border-brand-600/60 pricing-popular'
                  : 'bg-white/[0.02] border border-white/8 hover:border-white/15'
              }`}
            >
              {/* Popular badge */}
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-brand-600 to-brand-500 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg shadow-brand-900/50 whitespace-nowrap">
                    MOST POPULAR
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className="mb-6 pt-2">
                <h3
                  className={`text-base font-bold mb-1 ${
                    plan.popular ? 'text-brand-300' : 'text-white/70'
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
                    ? 'bg-gradient-to-r from-transparent via-brand-600 to-transparent'
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
                          ? 'bg-brand-600/30 border border-brand-600/50'
                          : 'bg-white/6 border border-white/10'
                      }`}
                    >
                      <Check
                        size={9}
                        className={plan.popular ? 'text-brand-400' : 'text-white/40'}
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
                    ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40'
                    : 'bg-white/6 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="text-center mt-10">
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
    </section>
  )
}
