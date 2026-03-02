import '../landing.css'
import Hero from '@/components/sections/hero'
import Features from '@/components/sections/features'
import HowItWorks from '@/components/sections/how-it-works'
import Privacy from '@/components/sections/privacy'
import Pricing from '@/components/sections/pricing'
import CTA from '@/components/sections/cta'
import ParallaxOrbs from '@/components/parallax-orbs'

export default function Home() {
  return (
    <div className="relative">
      <ParallaxOrbs />
      <div className="relative" style={{ zIndex: 1 }}>
        <Hero />
        <Features />
        <HowItWorks />
        <Privacy />
        <Pricing />
        <CTA />
      </div>
    </div>
  )
}
