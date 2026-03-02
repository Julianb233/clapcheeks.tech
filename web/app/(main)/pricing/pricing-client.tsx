'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Tier {
  name: string
  monthlyPrice: number
  annualPrice: number
  tagline: string
  plan: string
  cta: string
  popular: boolean
  features: string[]
}

export default function PricingClient({ tiers }: { tiers: Tier[] }) {
  const [annual, setAnnual] = useState(false)
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const router = useRouter()

  async function handleCheckout(plan: string) {
    setLoadingPlan(plan)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, annual }),
      })
      if (res.status === 401) {
        router.push(`/signup?next=/pricing`)
        return
      }
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <section className="px-6 pb-12">
      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-4 mb-12">
        <span
          className={`text-sm font-medium transition-colors ${
            !annual ? 'text-white' : 'text-white/40'
          }`}
        >
          Monthly
        </span>
        <button
          onClick={() => setAnnual(!annual)}
          className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
            annual ? 'bg-brand-600' : 'bg-white/15'
          }`}
          aria-label="Toggle annual billing"
        >
          <div
            className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
              annual ? 'translate-x-7.5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span
          className={`text-sm font-medium transition-colors ${
            annual ? 'text-white' : 'text-white/40'
          }`}
        >
          Annual
        </span>
        {annual && (
          <span className="text-xs font-bold text-[#D4AF37] bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-full px-3 py-0.5">
            2 months free
          </span>
        )}
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {tiers.map((tier) => {
          const price = annual ? tier.annualPrice : tier.monthlyPrice
          const isLoading = loadingPlan === tier.plan

          return (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-2xl p-8 transition-all duration-300 ${
                tier.popular
                  ? 'bg-brand-900/30 border-2 border-[#D4AF37]/60 md:scale-105 md:-my-2 shadow-lg shadow-[#D4AF37]/10'
                  : 'bg-white/[0.02] border border-white/8 hover:border-white/15'
              }`}
            >
              {/* Popular badge */}
              {tier.popular && (
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
                    tier.popular ? 'text-[#D4AF37]' : 'text-white/70'
                  }`}
                >
                  {tier.name}
                </h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-5xl font-extrabold text-white">
                    ${price}
                  </span>
                  <span className="text-white/35 text-sm">/mo</span>
                </div>
                <p className="text-sm text-white/35">{tier.tagline}</p>
                {annual && (
                  <p className="text-xs text-brand-400 mt-1">
                    Billed ${price * 12}/year
                  </p>
                )}
              </div>

              {/* Divider */}
              <div
                className={`h-px mb-6 ${
                  tier.popular
                    ? 'bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent'
                    : 'bg-white/6'
                }`}
              />

              {/* Features */}
              <ul className="space-y-3 flex-1 mb-8">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        tier.popular
                          ? 'bg-[#D4AF37]/20 border border-[#D4AF37]/40'
                          : 'bg-white/6 border border-white/10'
                      }`}
                    >
                      <Check
                        size={9}
                        className={tier.popular ? 'text-[#D4AF37]' : 'text-white/40'}
                      />
                    </div>
                    <span className="text-sm text-white/55 leading-snug">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                onClick={() => handleCheckout(tier.plan)}
                disabled={isLoading}
                className={`block w-full text-center font-semibold text-sm py-3.5 rounded-xl transition-all duration-200 active:scale-[0.98] cursor-pointer ${
                  tier.popular
                    ? 'bg-gradient-to-r from-[#D4AF37] to-[#F5D76E] hover:from-[#C4A030] hover:to-[#E5C75E] text-black shadow-lg shadow-[#D4AF37]/30'
                    : 'bg-white/6 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white'
                }`}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading...
                  </span>
                ) : (
                  tier.cta
                )}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
