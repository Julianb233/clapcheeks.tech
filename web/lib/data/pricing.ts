export interface PricingTier {
  name: string
  monthlyPrice: number
  annualPrice: number
  tagline: string
  plan: 'starter' | 'pro' | 'elite'
  cta: string
  popular: boolean
  features: string[]
}

export const PRICING: PricingTier[] = [
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
