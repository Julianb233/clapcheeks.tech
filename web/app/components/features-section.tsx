"use client"

import { useEffect, useRef } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
        <path d="M3.6 9h16.8M3.6 15h16.8" />
        <path d="M12 3a15 15 0 014 9 15 15 0 01-4 9 15 15 0 01-4-9 15 15 0 014-9z" />
      </svg>
    ),
    title: "10 Platforms",
    desc: "Tinder, Hinge, Bumble, and 7 more — simultaneously. One agent runs every app you're on.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        <path d="M8 9h8M8 13h4" />
      </svg>
    ),
    title: "Speaks Their Language",
    desc: "Analyzes how they text and mirrors it. Playful when they're playful. Smooth when they're warm.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path d="M9 16l2 2 4-4" />
      </svg>
    ),
    title: "Auto Date Booking",
    desc: "Detects when she's ready. Proposes a spot, books the time, adds it to your calendar. Just show up.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
    title: "Stays Undetected",
    desc: "Randomized typing delays, human-paced replies, per-app rate limits. Looks completely real.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
    title: "Never Sleeps",
    desc: "Configure once. The daemon runs swipe sessions overnight, on weekends, whenever you're not.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    title: "Best AI, Lowest Cost",
    desc: "Claude for premium replies, Kimi AI for speed, local Ollama for privacy. All under $5/month.",
  },
]

export default function FeaturesSection() {
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = sectionRef.current?.querySelectorAll(".feature-card")
      if (!cards) return

      cards.forEach((card, i) => {
        gsap.fromTo(
          card,
          { opacity: 0, y: 60 },
          {
            opacity: 1,
            y: 0,
            duration: 0.7,
            delay: i * 0.1,
            ease: "power3.out",
            scrollTrigger: {
              trigger: card,
              start: "top 85%",
              toggleActions: "play none none none",
            },
          }
        )
      })
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section
      ref={sectionRef}
      className="py-24 px-6 lg:px-12"
      style={{ background: "#0a0a0f" }}
    >
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#F5F5F5] mb-4">
            Built to{" "}
            <span className="bg-gradient-to-r from-[#8B5CF6] to-[#D4AF37] bg-clip-text text-transparent">
              Win
            </span>
          </h2>
          <p className="text-[#6B7280] text-lg max-w-2xl mx-auto">
            Every feature exists to get you more dates. Nothing more, nothing less.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className="feature-card group rounded-2xl p-6 border border-white/5 bg-white/[0.02]
                         hover:bg-white/[0.05] hover:border-[#8B5CF6]/20 transition-all duration-300"
              style={{ opacity: 0 }}
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#D4AF37]/10 flex items-center justify-center text-[#8B5CF6] mb-4 group-hover:from-[#8B5CF6]/30 group-hover:to-[#D4AF37]/20 transition-all duration-300">
                {f.icon}
              </div>
              <h3 className="text-xl font-semibold text-[#F5F5F5] mb-2">
                {f.title}
              </h3>
              <p className="text-[#9CA3AF] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
