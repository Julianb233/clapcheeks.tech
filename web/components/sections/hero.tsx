'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Copy, Check } from 'lucide-react'
import { gsap } from 'gsap'

const INSTALL_CMD = 'curl -fsSL https://clapcheeks.tech/install.sh | bash'

// Male power-pose silhouette SVG
function MaleSilhouette() {
  return (
    <svg
      viewBox="0 0 280 520"
      fill="currentColor"
      className="w-full h-full"
      aria-hidden="true"
    >
      {/* Head */}
      <ellipse cx="140" cy="48" rx="38" ry="44" />
      {/* Neck */}
      <rect x="124" y="88" width="32" height="22" rx="4" />
      {/* Trapezoid torso — wide alpha shoulders */}
      <path d="M30 125 Q55 108 90 105 L140 112 L190 105 Q225 108 250 125 L235 280 L45 280 Z" />
      {/* Left arm raised slightly out */}
      <path d="M50 155 C30 175 12 240 8 295 Q5 318 18 325 L34 328 Q50 332 52 312 L72 220 Z" />
      {/* Right arm raised slightly out */}
      <path d="M230 155 C250 175 268 240 272 295 Q275 318 262 325 L246 328 Q230 332 228 312 L208 220 Z" />
      {/* Lower torso */}
      <path d="M58 275 L72 395 L208 395 L222 275 Z" />
      {/* Left leg */}
      <path d="M72 390 L52 510 L104 510 L140 420 Z" />
      {/* Right leg */}
      <path d="M208 390 L228 510 L176 510 L140 420 Z" />
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
                width: '260px',
                height: '480px',
                color: 'rgba(201,164,39,0.9)',
                filter: 'drop-shadow(0 0 40px rgba(201,164,39,0.35)) drop-shadow(0 0 80px rgba(201,164,39,0.12))',
              }}
            >
              <MaleSilhouette />
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
