import HeroAnimated from "./components/hero-animated"
import FeaturesSection from "./components/features-section"
import PricingSection from "./components/pricing-section"
import Link from "next/link"

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
      {/* Hero */}
      <HeroAnimated />

      {/* Features */}
      <FeaturesSection />

      {/* Pricing */}
      <PricingSection />

      {/* Risk Disclosure */}
      <section className="py-12 px-6" style={{ background: "#0a0a0f" }}>
        <div className="container mx-auto max-w-3xl text-center">
          <p className="text-xs text-[#6B7280]/60 leading-relaxed">
            Built for personal use. Platform automation may violate Terms of
            Service. Use responsibly. Clapcheeks is not affiliated with any
            dating platform.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="py-8 px-6 border-t border-white/5"
        style={{ background: "#08080d" }}
      >
        <div className="container mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-[#6B7280]">
            &copy; 2026 Clapcheeks. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link
              href="/privacy"
              className="text-sm text-[#6B7280] hover:text-[#F5F5F5] transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-sm text-[#6B7280] hover:text-[#F5F5F5] transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/docs"
              className="text-sm text-[#6B7280] hover:text-[#F5F5F5] transition-colors"
            >
              Docs
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
