import type { Metadata } from 'next'
import '../landing.css'

export const metadata: Metadata = {
  title: 'Clapcheeks — AI Dating Co-Pilot',
  description: 'Your unfair advantage. AI that automates your dating apps — swipes, messages, and dates on autopilot.',
}
import Hero from '@/components/sections/hero'
import Features from '@/components/sections/features'
import HowItWorks from '@/components/sections/how-it-works'
import Privacy from '@/components/sections/privacy'
import Pricing from '@/components/sections/pricing'
import CPNBreakdown from '@/components/sections/cpn-breakdown'
import CTA from '@/components/sections/cta'
import ParallaxOrbs from '@/components/parallax-orbs'

export default function Home() {
  return (
    <div className="relative">
      <ParallaxOrbs />
      <div className="relative" style={{ zIndex: 1 }}>
        <Hero />
        <Features />
        <CPNBreakdown />
        <HowItWorks />
        <Privacy />
        <Pricing />
        <CTA />
      </div>
    </div>
  )
}
