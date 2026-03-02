"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import gsap from "gsap"

function SilhouetteSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 900"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="silhouetteGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#D4AF37" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="12" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M200 40
           C210 40 220 35 225 30 C230 25 232 20 230 15
           C228 10 222 8 215 10 C210 5 205 2 200 2
           C195 2 190 5 185 10 C178 8 172 10 170 15
           C168 20 170 25 175 30 C180 35 190 40 200 40Z
           M200 40
           C195 45 188 55 185 65
           C182 75 178 90 176 100
           C173 95 165 92 155 95
           C145 98 132 108 128 115
           C124 122 126 130 132 132
           C138 134 148 128 158 120
           C163 116 168 112 172 108
           C170 120 168 138 166 155
           C164 170 160 188 158 200
           C155 202 148 208 142 218
           C136 228 132 242 135 252
           C137 258 142 260 146 258
           C150 254 152 246 155 238
           C158 228 164 220 170 212
           C172 208 174 205 176 202
           C178 222 182 248 186 270
           C188 285 190 305 192 320
           C193 340 194 360 195 380
           C195 400 196 425 196 445
           C196 470 195 500 194 530
           C193 555 192 575 190 600
           C189 620 188 640 186 660
           C185 675 184 690 182 710
           C180 730 178 748 175 765
           C173 780 170 792 168 800
           C166 815 164 828 163 840
           C162 855 162 865 165 872
           C168 878 174 878 178 872
           C182 862 184 848 186 835
           C188 820 190 808 192 795
           C194 780 196 768 198 755
           C199 742 200 732 200 725
           C200 732 201 742 202 755
           C204 768 206 780 208 795
           C210 808 212 820 214 835
           C216 848 218 862 222 872
           C226 878 232 878 235 872
           C238 865 238 855 237 840
           C236 828 234 815 232 800
           C230 792 227 780 225 765
           C222 748 220 730 218 710
           C216 690 215 675 214 660
           C212 640 211 620 210 600
           C208 575 207 555 206 530
           C205 500 204 470 204 445
           C204 425 205 400 205 380
           C206 360 207 340 208 320
           C210 305 212 285 214 270
           C218 248 222 222 224 202
           C226 205 228 208 230 212
           C236 220 242 228 245 238
           C248 246 250 254 254 258
           C258 260 263 258 265 252
           C268 242 264 228 258 218
           C252 208 245 202 242 200
           C240 188 236 170 234 155
           C232 138 230 120 228 108
           C232 112 237 116 242 120
           C252 128 262 134 268 132
           C274 130 276 122 272 115
           C268 108 255 98 245 95
           C235 92 227 95 224 100
           C222 90 218 75 215 65
           C212 55 205 45 200 40Z"
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
              Stop swiping blind. Let AI handle the grind &mdash; personalized
              openers, NLP conversation analysis, automatic date booking across
              10 platforms.
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
                matches made this week
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
