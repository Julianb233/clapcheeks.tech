'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Copy, Check } from 'lucide-react'
import { gsap } from 'gsap'

const INSTALL_CMD = 'curl -fsSL https://clapcheeks.tech/install.sh | bash'

// Feminine silhouette — hourglass figure, hand-on-hip pose
function FemaleSilhouette() {
  return (
    <svg
      viewBox="0 0 220 520"
      fill="currentColor"
      className="w-full h-full"
      aria-hidden="true"
    >
      {/* Hair — flowing wave */}
      <path d="M82 10 C68 4 56 12 52 26 C48 40 54 58 62 68 C58 62 56 48 60 36 C64 24 74 18 84 20 Z" />
      <path d="M138 10 C152 4 164 12 168 26 C172 40 166 58 158 68 C162 62 164 48 160 36 C156 24 146 18 136 20 Z" />
      <path d="M72 8 C60 2 52 14 54 28 C56 38 62 46 58 54 C54 46 52 32 56 20 C60 10 68 6 76 10 Z" />
      {/* Head — slightly smaller, feminine */}
      <ellipse cx="110" cy="44" rx="30" ry="36" />
      {/* Neck — long and slender */}
      <path d="M98 78 C96 86 96 94 98 100 L122 100 C124 94 124 86 122 78 C118 82 112 84 110 84 C108 84 102 82 98 78 Z" />
      {/* Full body — single flowing hourglass path */}
      {/* Shoulders narrow → bust → dramatic waist → flared hips → thighs */}
      <path d="
        M72 108
        C58 112 46 122 44 136
        C42 150 50 162 62 170
        C70 176 80 180 84 190
        C88 200 86 212 80 224
        C70 238 56 250 54 266
        C52 282 62 296 76 302
        C90 308 104 310 110 310
        C116 310 130 308 144 302
        C158 296 168 282 166 266
        C164 250 150 238 140 224
        C134 212 132 200 136 190
        C140 180 150 176 158 170
        C170 162 178 150 176 136
        C174 122 162 112 148 108
        C136 104 122 102 110 103
        C98 102 84 104 72 108
        Z
      " />
      {/* Left arm — resting at side */}
      <path d="
        M58 130
        C44 142 36 162 34 182
        C32 200 36 218 42 228
        L52 224
        C48 214 46 198 48 182
        C50 166 58 148 68 138
        Z
      " />
      {/* Right arm — raised, hand on hip */}
      <path d="
        M162 130
        C172 142 178 158 178 176
        C178 190 174 202 168 210
        C164 216 156 220 152 218
        L158 212
        C162 206 166 196 166 182
        C166 168 162 152 154 140
        Z
      " />
      {/* Left leg — long, shapely */}
      <path d="
        M68 306
        C60 322 54 344 52 366
        C50 386 52 404 56 416
        C58 424 62 428 66 430
        L86 430
        C88 428 90 424 90 418
        C90 406 88 388 90 370
        C92 352 96 332 100 316
        Z
      " />
      {/* Right leg */}
      <path d="
        M152 306
        C160 322 166 344 168 366
        C170 386 168 404 164 416
        C162 424 158 428 154 430
        L134 430
        C132 428 130 424 130 418
        C130 406 132 388 130 370
        C128 352 124 332 120 316
        Z
      " />
      {/* Left heel — pointed stiletto */}
      <path d="M52 428 L86 428 L86 436 L70 436 L70 440 L66 440 L66 452 L62 452 L62 438 L52 438 Z" />
      {/* Right heel */}
      <path d="M134 428 L168 428 L168 438 L158 438 L158 452 L154 452 L154 440 L150 440 L150 436 L134 436 Z" />
    </svg>
  )
}

// Floating stat badge
function StatBadge({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div
      className="bg-black/80 border border-yellow-500/30 rounded-xl px-3 py-2 backdrop-blur-sm"
      style={{ boxShadow: '0 4px 20px rgba(201,164,39,0.12)' }}
    >
      <div className="text-xs text-white/40 font-body mb-0.5">{label}</div>
      <div className="text-lg font-display text-white leading-none">{value}</div>
      <div className="text-[10px] text-emerald-400 font-body font-semibold mt-0.5">{delta}</div>
    </div>
  )
}

export default function Hero() {
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const line1Ref = useRef<HTMLDivElement>(null)
  const line2Ref = useRef<HTMLDivElement>(null)
  const line3Ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLParagraphElement>(null)
  const installRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)
  const silhouetteRef = useRef<HTMLDivElement>(null)
  const badge1Ref = useRef<HTMLDivElement>(null)
  const badge2Ref = useRef<HTMLDivElement>(null)
  const badge3Ref = useRef<HTMLDivElement>(null)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_CMD)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

      // Badge pop
      tl.from(badgeRef.current, { opacity: 0, y: -16, duration: 0.5 })

      // Hero lines — slash in from left
      tl.from(line1Ref.current, { opacity: 0, x: -60, duration: 0.7 }, '-=0.2')
      tl.from(line2Ref.current, { opacity: 0, x: -80, duration: 0.7 }, '-=0.5')
      tl.from(line3Ref.current, { opacity: 0, x: -60, duration: 0.6 }, '-=0.5')

      // Subtext + install
      tl.from(subRef.current, { opacity: 0, y: 20, duration: 0.6 }, '-=0.3')
      tl.from(installRef.current, { opacity: 0, y: 20, duration: 0.5 }, '-=0.4')
      tl.from(ctaRef.current, { opacity: 0, y: 20, duration: 0.5 }, '-=0.3')

      // Silhouette
      tl.from(silhouetteRef.current, { opacity: 0, scale: 0.88, duration: 1.2, ease: 'power2.out' }, 0.2)

      // Stat badges float in
      tl.from([badge1Ref.current, badge2Ref.current, badge3Ref.current], {
        opacity: 0,
        scale: 0.8,
        stagger: 0.15,
        duration: 0.5,
      }, '-=0.6')

      // Continuous float on badges
      gsap.to(badge1Ref.current, {
        y: -10,
        repeat: -1,
        yoyo: true,
        duration: 2.5,
        ease: 'sine.inOut',
      })
      gsap.to(badge2Ref.current, {
        y: 8,
        repeat: -1,
        yoyo: true,
        duration: 3,
        ease: 'sine.inOut',
        delay: 0.8,
      })
      gsap.to(badge3Ref.current, {
        y: -6,
        repeat: -1,
        yoyo: true,
        duration: 2.2,
        ease: 'sine.inOut',
        delay: 1.2,
      })

      // Silhouette glow pulse
      gsap.to(silhouetteRef.current, {
        filter: 'drop-shadow(0 0 60px rgba(201,164,39,0.5)) drop-shadow(0 0 120px rgba(201,164,39,0.2))',
        repeat: -1,
        yoyo: true,
        duration: 2.5,
        ease: 'sine.inOut',
        delay: 1.5,
      })
    }, containerRef)

    return () => ctx.revert()
  }, [])

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex flex-col justify-center overflow-hidden pt-16 pb-8"
    >
      {/* Background: gold grid + red vignette */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 grid-overlay opacity-100" />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 70% 50%, rgba(201,164,39,0.06) 0%, transparent 60%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 80% at 10% 80%, rgba(232,41,30,0.05) 0%, transparent 50%)',
          }}
        />
        {/* Diagonal accent line */}
        <div
          className="absolute"
          style={{
            top: '15%',
            left: '-10%',
            right: '-10%',
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(201,164,39,0.2) 40%, rgba(201,164,39,0.5) 50%, rgba(201,164,39,0.2) 60%, transparent 100%)',
            transform: 'rotate(-8deg)',
          }}
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-0 items-center min-h-[calc(100vh-4rem)]">

          {/* ── LEFT: Copy ─────────────────────────── */}
          <div className="relative z-10 flex flex-col justify-center py-16 lg:py-0">
            {/* Badge */}
            <div ref={badgeRef} className="inline-flex items-center gap-2 mb-8 self-start">
              <div className="flex items-center gap-2 border border-yellow-500/30 rounded-full px-4 py-1.5 bg-yellow-500/5">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-yellow-400 text-xs font-body font-semibold tracking-wider uppercase">
                  Now in beta — 7 days free
                </span>
              </div>
            </div>

            {/* Headline */}
            <div className="mb-6">
              <div ref={line1Ref} className="font-display text-6xl sm:text-7xl lg:text-8xl xl:text-9xl text-white leading-none uppercase">
                MOST MEN
              </div>
              <div ref={line2Ref} className="font-display text-6xl sm:text-7xl lg:text-8xl xl:text-9xl leading-none uppercase gold-text">
                BEG FOR
              </div>
              <div ref={line3Ref} className="font-display text-6xl sm:text-7xl lg:text-8xl xl:text-9xl text-white leading-none uppercase">
                DATES.
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 mb-6">
              <div className="h-px w-12 bg-yellow-500/60" />
              <span className="text-yellow-500/60 text-xs font-body font-bold tracking-widest uppercase">You automate them.</span>
            </div>

            {/* Sub */}
            <p ref={subRef} className="font-body text-base sm:text-lg text-white/55 leading-relaxed max-w-lg mb-8">
              Clapcheeks is an AI agent that swipes, messages, and books dates for you —
              {' '}<span className="text-white/80 font-semibold">running privately on your Mac</span>{' '}
              while you live like a winner.
            </p>

            {/* Install command */}
            <div ref={installRef} className="mb-6 max-w-lg">
              <div
                className="flex items-center justify-between rounded-xl px-4 py-3.5 group cursor-pointer transition-all duration-300"
                style={{
                  background: 'rgba(0,0,0,0.7)',
                  border: '1px solid rgba(201,164,39,0.25)',
                  boxShadow: '0 0 0 1px rgba(201,164,39,0.05) inset',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(201,164,39,0.5)'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(201,164,39,0.25)'
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-yellow-500/50 font-mono text-sm shrink-0">$</span>
                  <code className="text-sm font-mono text-yellow-400 truncate">{INSTALL_CMD}</code>
                </div>
                <button
                  onClick={handleCopy}
                  className="ml-3 shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-yellow-500/10 text-white/40 hover:text-yellow-400 transition-all duration-200"
                  aria-label="Copy install command"
                >
                  {copied ? (
                    <Check size={14} className="text-emerald-400" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>

            {/* CTAs */}
            <div ref={ctaRef} className="flex flex-col sm:flex-row gap-3 mb-10">
              <Link
                href="/auth/sign-up"
                className="btn-gold font-body inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-sm"
              >
                GET YOUR EDGE — FREE
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <a
                href="#how-it-works"
                className="btn-ghost-gold font-body inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-sm"
              >
                SEE HOW IT WORKS
              </a>
            </div>

            {/* Trust row */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/25 font-body">
              {['Privacy-first', 'Runs locally', 'Tinder + Bumble + Hinge', 'macOS 13+'].map((item, i) => (
                <span key={item} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-white/10 mr-3">·</span>}
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Silhouette ───────────────────── */}
          <div className="relative flex items-center justify-center lg:justify-end h-full min-h-[460px] lg:min-h-[600px]">
            {/* Background glow disk */}
            <div
              className="absolute"
              style={{
                width: '500px',
                height: '500px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(201,164,39,0.12) 0%, rgba(201,164,39,0.04) 40%, transparent 70%)',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />

            {/* Ground glow line */}
            <div
              className="absolute bottom-4 left-1/2"
              style={{
                width: '220px',
                height: '24px',
                transform: 'translateX(-50%)',
                background: 'radial-gradient(ellipse, rgba(201,164,39,0.3) 0%, transparent 70%)',
                filter: 'blur(8px)',
              }}
            />

            {/* Silhouette */}
            <div
              ref={silhouetteRef}
              className="relative z-10"
              style={{
                width: '220px',
                height: '480px',
                color: 'rgba(201,164,39,0.85)',
                filter: 'drop-shadow(0 0 40px rgba(201,164,39,0.35)) drop-shadow(0 0 80px rgba(201,164,39,0.12))',
              }}
            >
              <FemaleSilhouette />
            </div>

            {/* Floating stat badges */}
            <div ref={badge1Ref} className="absolute hidden sm:block" style={{ top: '18%', right: '0%' }}>
              <StatBadge label="Matches today" value="23" delta="+8 vs yesterday" />
            </div>

            <div ref={badge2Ref} className="absolute hidden sm:block" style={{ top: '42%', left: '0%' }}>
              <StatBadge label="Swipes automated" value="847" delta="+12% this week" />
            </div>

            <div ref={badge3Ref} className="absolute hidden sm:block" style={{ bottom: '16%', right: '2%' }}>
              <StatBadge label="Dates booked" value="3" delta="This week" />
            </div>
          </div>
        </div>

        {/* ── Social proof bar ─────────────────────── */}
        <div className="pb-12 pt-4 border-t border-white/[0.06]">
          <p className="text-[10px] text-white/20 mb-5 uppercase tracking-widest font-body font-semibold text-center">
            Works with
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {['Tinder', 'Bumble', 'Hinge', 'iMessage', 'Calendar'].map((app) => (
              <span
                key={app}
                className="text-sm font-display tracking-wider text-white/20 uppercase"
              >
                {app}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
