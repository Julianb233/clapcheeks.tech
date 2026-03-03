'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Copy, Check } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const INSTALL_CMD = 'curl -fsSL https://clapcheeks.tech/install.sh | bash'

// Feminine figure — flowing hourglass, slim and elegant
function FemaleFigure({
  scale = 1,
  opacity = 1,
  glow = false,
}: {
  scale?: number
  opacity?: number
  glow?: boolean
}) {
  const color = glow ? 'rgba(201,164,39,0.88)' : 'rgba(255,255,255,0.22)'
  const dropShadow = glow
    ? 'drop-shadow(0 0 24px rgba(201,164,39,0.45)) drop-shadow(0 0 60px rgba(201,164,39,0.15))'
    : 'none'
  return (
    <svg
      viewBox="0 0 220 520"
      fill={color}
      style={{
        height: `${200 * scale}px`,
        width: 'auto',
        opacity,
        filter: dropShadow,
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {/* Hair */}
      <path d="M80 8 C66 2 54 12 52 26 C50 40 56 56 62 66 C58 58 56 44 60 32 C64 20 74 14 82 16 Z" />
      <path d="M140 8 C154 2 166 12 168 26 C170 40 164 56 158 66 C162 58 164 44 160 32 C156 20 146 14 138 16 Z" />
      {/* Head */}
      <ellipse cx="110" cy="44" rx="30" ry="36" />
      {/* Long slender neck */}
      <path d="M99 78 C97 87 97 95 99 101 L121 101 C123 95 123 87 121 78 C117 83 113 85 110 85 C107 85 103 83 99 78 Z" />
      {/* Hourglass torso — narrow waist, flared hips */}
      <path d="
        M74 108 C60 112 48 122 46 136
        C44 150 52 164 64 172
        C74 178 84 182 88 194
        C92 206 90 220 82 234
        C72 248 58 260 56 276
        C54 292 64 306 80 312
        C92 317 104 319 110 319
        C116 319 128 317 140 312
        C156 306 166 292 164 276
        C162 260 148 248 138 234
        C130 220 128 206 132 194
        C136 182 146 178 156 172
        C168 164 176 150 174 136
        C172 122 160 112 146 108
        C134 104 122 102 110 103
        C98 102 86 104 74 108 Z
      " />
      {/* Left arm — relaxed, slightly away from body */}
      <path d="M58 128 C44 142 36 164 36 186 C36 202 40 216 46 224 L56 220 C52 212 50 198 50 184 C50 166 56 148 66 136 Z" />
      {/* Right arm — hand on hip, angled out */}
      <path d="M162 128 C174 140 182 160 182 180 C182 196 178 208 170 216 C164 222 156 224 152 220 L158 214 C164 208 168 196 168 180 C168 164 164 146 156 134 Z" />
      {/* Left leg */}
      <path d="M68 314 C60 330 54 352 52 374 C50 394 52 412 56 424 C58 432 62 436 68 436 L88 436 C90 432 92 426 92 418 C92 404 90 386 92 368 C94 350 98 330 102 316 Z" />
      {/* Right leg */}
      <path d="M152 314 C160 330 166 352 168 374 C170 394 168 412 164 424 C162 432 158 436 152 436 L132 436 C130 432 128 426 128 418 C128 404 130 386 128 368 C126 350 122 330 118 316 Z" />
      {/* Left stiletto heel */}
      <path d="M50 432 L88 432 L88 440 L72 440 L72 442 L68 442 L68 456 L64 456 L64 442 L50 442 Z" />
      {/* Right stiletto heel */}
      <path d="M132 432 L170 432 L170 442 L156 442 L156 456 L152 456 L152 442 L148 442 L148 440 L132 440 Z" />
    </svg>
  )
}

function SilhouettePair() {
  return (
    <div className="relative flex items-end justify-center gap-12 pb-4">
      {/* Secondary — faded white, shorter */}
      <FemaleFigure scale={0.78} opacity={1} glow={false} />
      {/* Primary — gold, taller */}
      <FemaleFigure scale={1} opacity={1} glow={true} />
    </div>
  )
}

export default function CTA() {
  const [copied, setCopied] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const headlineRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const statsRef = useRef<HTMLDivElement>(null)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_CMD)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headlineRef.current, {
        opacity: 0,
        y: 60,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: headlineRef.current,
          start: 'top 85%',
        },
      })

      gsap.from(contentRef.current, {
        opacity: 0,
        y: 40,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: contentRef.current,
          start: 'top 85%',
        },
        delay: 0.2,
      })

      // Stat counters
      const statEls = statsRef.current?.querySelectorAll('.stat-value')
      if (statEls) {
        gsap.from(statEls, {
          opacity: 0,
          y: 20,
          stagger: 0.15,
          duration: 0.6,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: statsRef.current,
            start: 'top 90%',
          },
        })
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="py-28 px-6 relative overflow-hidden">
      {/* Full-bleed dark background with gold center glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 70% 70% at 50% 50%, rgba(201,164,39,0.07) 0%, transparent 60%)',
          }}
        />
        {/* Red corner accents */}
        <div
          className="absolute top-0 left-0 w-64 h-64"
          style={{
            background: 'radial-gradient(circle at 0% 0%, rgba(232,41,30,0.08) 0%, transparent 60%)',
          }}
        />
        <div
          className="absolute bottom-0 right-0 w-64 h-64"
          style={{
            background: 'radial-gradient(circle at 100% 100%, rgba(232,41,30,0.06) 0%, transparent 60%)',
          }}
        />
        {/* Top border line */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(201,164,39,0.4), transparent)' }}
        />
      </div>

      <div className="max-w-5xl mx-auto relative">
        {/* Silhouette pair */}
        <div className="flex justify-center mb-10">
          <SilhouettePair />
        </div>

        {/* Headline */}
        <div ref={headlineRef} className="text-center mb-10">
          <p className="font-body text-red-500 text-sm font-bold tracking-widest uppercase mb-4">
            The choice is yours
          </p>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl xl:text-8xl text-white uppercase leading-none mb-4">
            KEEP SWIPING
            <br />
            <span className="text-white/20">MANUALLY.</span>
          </h2>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl xl:text-8xl uppercase leading-none gold-text">
            OR LET AI
            <br />
            CLOSE FOR YOU.
          </h2>
        </div>

        {/* Content */}
        <div ref={contentRef} className="max-w-xl mx-auto text-center">
          <p className="font-body text-white/50 text-lg leading-relaxed mb-8">
            While you&apos;re manually swiping for hours, Clapcheeks users are getting matches,
            having better conversations, and booking dates — on autopilot.
          </p>

          {/* Install command */}
          <div
            className="flex items-center justify-between rounded-xl px-4 py-3.5 mb-6 group cursor-pointer transition-all duration-300"
            style={{
              background: 'rgba(0,0,0,0.7)',
              border: '1px solid rgba(201,164,39,0.25)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(201,164,39,0.5)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(201,164,39,0.25)'
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-yellow-500/40 font-mono text-sm shrink-0">$</span>
              <code className="font-mono text-sm text-yellow-400 truncate">{INSTALL_CMD}</code>
            </div>
            <button
              onClick={handleCopy}
              className="ml-3 shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-yellow-500/10 text-white/40 hover:text-yellow-400 transition-all"
              aria-label="Copy install command"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
            <Link
              href="/auth/sign-up"
              className="btn-gold font-body inline-flex items-center justify-center gap-2 px-10 py-4 rounded-xl text-sm w-full sm:w-auto"
            >
              START FREE — 7 DAYS
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link
              href="/dashboard"
              className="btn-ghost-gold font-body inline-flex items-center justify-center gap-2 px-10 py-4 rounded-xl text-sm w-full sm:w-auto"
            >
              SIGN IN
            </Link>
          </div>

          <p className="font-body text-xs text-white/20">
            No credit card required · Cancel anytime · macOS 13+
          </p>
        </div>

        {/* Stats row */}
        <div
          ref={statsRef}
          className="mt-16 pt-12 grid grid-cols-3 gap-8 max-w-md mx-auto"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          {[
            { value: '50k+', label: 'Swipes automated' },
            { value: '4.9★', label: 'Average rating' },
            { value: '7 days', label: 'Free trial' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="stat-value font-display text-3xl gold-text mb-1">{stat.value}</div>
              <div className="font-body text-xs text-white/30">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
