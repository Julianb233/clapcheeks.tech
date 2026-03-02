'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import CheckoutButton from '@/components/checkout-button'

interface Tier {
  name: string
  price: string
  period: string
  tagline: string
  plan: string
  cta: string
  popular: boolean
  features: string[]
}

interface Addon {
  id: string
  name: string
  price: string
  description: string
}

export default function PricingClient({
  tiers,
  addons,
}: {
  tiers: Tier[]
  addons: Addon[]
}) {
  const [selectedAddons, setSelectedAddons] = useState<string[]>([])

  function toggleAddon(id: string) {
    setSelectedAddons((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  return (
    <>
      {/* Tier cards */}
      <section className="px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-2xl p-8 transition-all duration-300 ${
                tier.popular
                  ? 'bg-brand-900/30 border border-brand-600/60'
                  : 'bg-white/[0.02] border border-white/8 hover:border-white/15'
              }`}
            >
              {tier.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-brand-600 to-brand-500 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg shadow-brand-900/50 whitespace-nowrap">
                    MOST POPULAR
                  </span>
                </div>
              )}

              <div className="mb-6 pt-2">
                <h3
                  className={`text-base font-bold mb-1 ${
                    tier.popular ? 'text-brand-300' : 'text-white/70'
                  }`}
                >
                  {tier.name}
                </h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-5xl font-extrabold text-white">{tier.price}</span>
                  <span className="text-white/35 text-sm">{tier.period}</span>
                </div>
                <p className="text-sm text-white/35">{tier.tagline}</p>
              </div>

              <div
                className={`h-px mb-6 ${
                  tier.popular
                    ? 'bg-gradient-to-r from-transparent via-brand-600 to-transparent'
                    : 'bg-white/6'
                }`}
              />

              <ul className="space-y-3 flex-1 mb-8">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        tier.popular
                          ? 'bg-brand-600/30 border border-brand-600/50'
                          : 'bg-white/6 border border-white/10'
                      }`}
                    >
                      <Check
                        size={9}
                        className={tier.popular ? 'text-brand-400' : 'text-white/40'}
                      />
                    </div>
                    <span className="text-sm text-white/55 leading-snug">{feature}</span>
                  </li>
                ))}
              </ul>

              <CheckoutButton
                plan={tier.plan}
                addons={selectedAddons.length > 0 ? selectedAddons : undefined}
                className={`block w-full text-center font-semibold text-sm py-3.5 rounded-xl transition-all duration-200 active:scale-[0.98] cursor-pointer ${
                  tier.popular
                    ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40'
                    : 'bg-white/6 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white'
                }`}
              >
                {tier.cta}
              </CheckoutButton>
            </div>
          ))}
        </div>
      </section>

      {/* Add-ons */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-3">
            Power-up add-ons
          </h2>
          <p className="text-white/40 text-sm text-center mb-10">
            Select add-ons to bundle with your plan at checkout.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {addons.map((addon) => {
              const selected = selectedAddons.includes(addon.id)
              return (
                <button
                  key={addon.id}
                  onClick={() => toggleAddon(addon.id)}
                  className={`text-left rounded-xl p-5 transition-all duration-200 cursor-pointer ${
                    selected
                      ? 'bg-brand-900/30 border border-brand-600/60'
                      : 'bg-white/[0.02] border border-white/8 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                          selected
                            ? 'bg-brand-600 border-brand-600'
                            : 'border-white/20 bg-transparent'
                        }`}
                      >
                        {selected && <Check size={12} className="text-white" />}
                      </div>
                      <span className="text-white font-semibold text-sm">{addon.name}</span>
                    </div>
                    <span className={`text-sm font-bold ${selected ? 'text-brand-300' : 'text-white/50'}`}>
                      {addon.price}
                    </span>
                  </div>
                  <p className="text-white/35 text-xs leading-relaxed pl-8">
                    {addon.description}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </>
  )
}
