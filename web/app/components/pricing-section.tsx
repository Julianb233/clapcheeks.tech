"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

const plans = [
  {
    name: "Starter",
    price: 29,
    highlight: false,
    features: [
      "Tinder + Bumble + Hinge",
      "100 swipes/day",
      "AI conversations",
      "Basic analytics",
    ],
  },
  {
    name: "Pro",
    price: 59,
    highlight: true,
    badge: "Most Popular",
    features: [
      "7 platforms",
      "150 swipes/day",
      "Calendar booking",
      "NLP personalization",
      "Advanced analytics",
    ],
  },
  {
    name: "Elite",
    price: 99,
    highlight: false,
    features: [
      "All 10 platforms",
      "300 swipes/day",
      "Everything in Pro",
      "Priority support",
      "Custom AI tuning",
    ],
  },
]

export default function PricingSection() {
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = sectionRef.current?.querySelectorAll(".pricing-card")
      if (!cards) return

      gsap.fromTo(
        cards,
        { opacity: 0, y: 50 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 75%",
            toggleActions: "play none none none",
          },
        }
      )
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section
      ref={sectionRef}
      className="py-24 px-6 lg:px-12"
      style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0d0b18 100%)" }}
    >
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#F5F5F5] mb-4">
            Simple{" "}
            <span className="bg-gradient-to-r from-[#D4AF37] to-[#8B5CF6] bg-clip-text text-transparent">
              Pricing
            </span>
          </h2>
          <p className="text-[#6B7280] text-lg">
            Cancel anytime. No long-term contracts.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 items-stretch">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`pricing-card relative rounded-2xl p-8 flex flex-col transition-all duration-300
                ${
                  plan.highlight
                    ? "border-2 border-[#D4AF37]/50 bg-white/[0.04] md:scale-105 shadow-[0_0_40px_rgba(212,175,55,0.1)]"
                    : "border border-white/5 bg-white/[0.02]"
                }`}
              style={{ opacity: 0 }}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-4 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-[#D4AF37] to-[#B8860B] text-black">
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-[#F5F5F5] mb-2">
                  {plan.name}
                </h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-[#F5F5F5]">
                    ${plan.price}
                  </span>
                  <span className="text-[#6B7280]">/mo</span>
                </div>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feat, j) => (
                  <li key={j} className="flex items-center gap-3 text-[#9CA3AF]">
                    <svg
                      className={`w-5 h-5 flex-shrink-0 ${
                        plan.highlight ? "text-[#D4AF37]" : "text-[#8B5CF6]"
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    {feat}
                  </li>
                ))}
              </ul>

              <Link
                href="/auth/sign-up"
                className={`inline-flex items-center justify-center h-12 rounded-xl font-semibold transition-all duration-300
                  ${
                    plan.highlight
                      ? "bg-gradient-to-r from-[#D4AF37] to-[#B8860B] text-black hover:from-[#E5C349] hover:to-[#D4AF37] shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                      : "border border-[#8B5CF6]/30 text-[#8B5CF6] hover:bg-[#8B5CF6]/10"
                  }`}
              >
                Get Started
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
