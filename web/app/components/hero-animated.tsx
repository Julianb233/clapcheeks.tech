"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import gsap from "gsap"

function SilhouetteSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 280 640"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="silhouetteGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="55%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#D4AF37" />
        </linearGradient>
        <filter id="glow" x="-30%" y="-5%" width="160%" height="112%">
          <feGaussianBlur stdDeviation="9" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Head */}
      <circle
        cx="140"
        cy="38"
        r="42"
        fill="url(#silhouetteGrad)"
        filter="url(#glow)"
      />

      {/*
        Body — a single symmetrical bezier path tracing the right side
        top-to-bottom then the mirrored left side bottom-to-top.
        All left-side x values = 280 − right-side x values.
        Key widths at centre ±px:
          neck      ±15   (30px)
          shoulders ±65  (130px)
          bust      ±59  (118px)
          waist     ±41   (82px)
          hips      ±63  (126px)
          ankles    ±17   (34px)
      */}
      <path
        d="
          M 155,70
          C 170,85  190,106  205,126
          C 214,140  214,152  209,163
          C 204,174  200,184  199,196
          C 198,209  193,222  188,237
          C 183,250  181,262  181,274
          C 181,286  183,298  189,311
          C 195,323  201,333  203,346
          C 205,358  203,372  197,387
          C 191,401  185,416  180,432
          C 175,448  171,462  169,476
          C 167,490  163,504  161,520
          C 159,534  157,547  157,559
          C 157,571  161,581  168,588
          L 112,588
          C 119,581  123,571  123,559
          C 123,547  121,534  119,520
          C 117,504  113,490  111,476
          C 109,462  105,448  100,432
          C  95,416   89,401   83,387
          C  77,372   75,358   77,346
          C  79,333   85,323   91,311
          C  97,298   99,286   99,274
          C  99,262   97,250   92,237
          C  87,222   82,209   81,196
          C  80,184   76,174   71,163
          C  66,152   66,140   75,126
          C  90,106  110,85   125,70
          Z
        "
        fill="url(#silhouetteGrad)"
        filter="url(#glow)"
      />
    </svg>
  )
}

export default function HeroAnimated() {
  const silhouetteRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const headlineRef = useRef<HTMLHeadingElement>(null)
  const tagRef = useRef<HTMLDivElement>(null)
  const subtitleRef = useRef<HTMLParagraphElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)
  const proofRef = useRef<HTMLDivElement>(null)
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY)
    }
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Tag fade in
      gsap.fromTo(
        tagRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.6, delay: 0.2, ease: "power3.out" }
      )

      // Headline: staggered letter animation
      if (headlineRef.current) {
        const lines = headlineRef.current.querySelectorAll(".headline-word")
        lines.forEach((word, wordIndex) => {
          const chars = word.querySelectorAll(".headline-char")
          gsap.fromTo(
            chars,
            { opacity: 0, y: 40 },
            {
              opacity: 1,
              y: 0,
              duration: 0.5,
              stagger: 0.05,
              delay: 0.4 + wordIndex * 0.3,
              ease: "power3.out",
            }
          )
        })
      }

      // Subtitle fade in after headline
      gsap.fromTo(
        subtitleRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.8, delay: 1.4, ease: "power3.out" }
      )

      // CTA buttons slide up with scale
      if (ctaRef.current) {
        const buttons = ctaRef.current.querySelectorAll("a")
        gsap.fromTo(
          buttons,
          { opacity: 0, y: 30, scale: 0.9 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.6,
            stagger: 0.15,
            delay: 1.8,
            ease: "back.out(1.4)",
          }
        )
      }

      // Social proof
      gsap.fromTo(
        proofRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.8, delay: 2.2, ease: "power2.out" }
      )

      // Silhouette fade in from right
      gsap.fromTo(
        silhouetteRef.current,
        { opacity: 0, x: 80 },
        { opacity: 1, x: 0, duration: 1.2, delay: 0.3, ease: "power3.out" }
      )
    }, heroRef)

    return () => ctx.revert()
  }, [])

  const renderChars = (text: string) =>
    text.split("").map((char, i) => (
      <span key={i} className="headline-char inline-block" style={{ opacity: 0 }}>
        {char === " " ? "\u00A0" : char}
      </span>
    ))

  return (
    <section
      ref={heroRef}
      className="relative min-h-screen flex items-center overflow-hidden"
      style={{ background: "#0a0a0f" }}
    >
      {/* Background gradient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-[#8B5CF6]/10 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-[#D4AF37]/8 blur-[100px]" />
      </div>

      {/* Silhouette — right side on desktop, background on mobile */}
      <div
        ref={silhouetteRef}
        className="absolute right-0 top-0 h-full flex items-center justify-end pointer-events-none
                   md:relative md:w-1/2 md:flex md:justify-center
                   max-md:opacity-20 max-md:w-full max-md:justify-center"
        style={{
          transform: `translateY(${scrollY * 0.3}px)`,
          willChange: "transform",
        }}
      >
        <SilhouetteSVG className="h-[70vh] md:h-[80vh] w-auto max-w-full drop-shadow-[0_0_40px_rgba(139,92,246,0.3)]" />
      </div>

      {/* Hero Content */}
      <div className="container mx-auto px-6 lg:px-12 relative z-10">
        <div className="flex flex-col md:flex-row items-center">
          <div className="w-full md:w-1/2 md:pr-12">
            {/* Tag */}
            <div ref={tagRef} className="mb-6" style={{ opacity: 0 }}>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 text-[#8B5CF6]">
                <span className="w-2 h-2 rounded-full bg-[#D4AF37] animate-pulse" />
                AI Dating Co-Pilot
              </span>
            </div>

            {/* Headline */}
            <h1
              ref={headlineRef}
              className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.1] mb-6"
            >
              <span className="headline-word block text-[#F5F5F5]">
                {renderChars("Your Unfair")}
              </span>
              <span className="headline-word block bg-gradient-to-r from-[#8B5CF6] to-[#D4AF37] bg-clip-text text-transparent">
                {renderChars("Advantage")}
              </span>
            </h1>

            {/* Subtitle */}
            <p
              ref={subtitleRef}
              className="text-lg sm:text-xl text-[#9CA3AF] max-w-lg mb-8 leading-relaxed"
              style={{ opacity: 0 }}
            >
              Your AI co-pilot swipes, writes openers, replies in your voice,
              and books the date &mdash; across Tinder, Hinge, Bumble, and 7
              more apps. Set it up once. Go live your life.
            </p>

            {/* CTA Buttons */}
            <div ref={ctaRef} className="flex flex-col sm:flex-row gap-4 mb-8">
              <Link
                href="/auth/sign-up"
                className="inline-flex items-center justify-center h-14 px-8 rounded-xl text-lg font-semibold
                           bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white
                           hover:from-[#7C3AED] hover:to-[#6D28D9] transition-all duration-300
                           shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:shadow-[0_0_40px_rgba(139,92,246,0.5)]
                           min-w-[180px]"
                style={{ opacity: 0 }}
              >
                Get Started Free
              </Link>
              <Link
                href="#demo"
                className="inline-flex items-center justify-center h-14 px-8 rounded-xl text-lg font-semibold
                           border-2 border-[#D4AF37]/40 text-[#D4AF37]
                           hover:bg-[#D4AF37]/10 hover:border-[#D4AF37]/60 transition-all duration-300
                           min-w-[180px]"
                style={{ opacity: 0 }}
              >
                Watch Demo
              </Link>
            </div>

            {/* Social Proof */}
            <div ref={proofRef} className="flex items-center gap-3" style={{ opacity: 0 }}>
              <div className="flex -space-x-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full border-2 border-[#0a0a0f]"
                    style={{
                      background: `linear-gradient(135deg, ${
                        ["#8B5CF6", "#D4AF37", "#7C3AED", "#B8860B"][i]
                      }, ${["#D4AF37", "#8B5CF6", "#6D28D9", "#D4AF37"][i]})`,
                    }}
                  />
                ))}
              </div>
              <p className="text-sm text-[#6B7280]">
                <span className="text-[#D4AF37] font-semibold">2,400+</span>{" "}
                dates booked this month
              </p>
            </div>
          </div>

          {/* Desktop silhouette placeholder — actual SVG is positioned absolute on mobile, relative in flex on md+ */}
          <div className="hidden md:block md:w-1/2" />
        </div>
      </div>
    </section>
  )
}
