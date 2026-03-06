'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Copy, Check } from 'lucide-react'
import { gsap } from 'gsap'

const INSTALL_CMD = 'curl -fsSL https://clapcheeks.tech/install.sh | bash'

// Floating stat badge
function StatBadge({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div
      className="bg-black/80 border border-amber-500/25 rounded-xl px-4 py-2.5 backdrop-blur-md"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 1px rgba(201,164,39,0.3)' }}
    >
      <div className="text-[10px] text-white/35 font-body uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-xl font-display text-white leading-none tracking-wide">{value}</div>
      <div className="text-[10px] text-emerald-400 font-body font-semibold mt-0.5">{delta}</div>
    </div>
  )
}

// Glowing abstract ring — replaces silhouette
function GlowRing() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* Outer cosmic glow */}
      <div
        className="absolute rounded-full"
        style={{
          width: '420px',
          height: '420px',
          background: 'radial-gradient(circle, rgba(201,164,39,0.08) 0%, rgba(232,160,30,0.04) 40%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      {/* Gradient ring */}
      <div
        className="absolute rounded-full"
        style={{
          width: '320px',
          height: '320px',
          background: 'conic-gradient(from 0deg, rgba(201,164,39,0.6), rgba(232,160,30,0.3), rgba(201,164,39,0.05), rgba(232,160,30,0.3), rgba(201,164,39,0.6))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
        }}
      />
      {/* Inner glow fill */}
      <div
        className="absolute rounded-full"
        style={{
          width: '314px',
          height: '314px',
          background: 'radial-gradient(circle at 40% 35%, rgba(201,164,39,0.06) 0%, rgba(0,0,0,0.8) 70%)',
        }}
      />
      {/* Phone mockup inside ring */}
      <div
        className="relative z-10 rounded-3xl overflow-hidden"
        style={{
          width: '180px',
          height: '360px',
          background: 'linear-gradient(180deg, #0a0a0a 0%, #111 100%)',
          border: '2px solid rgba(201,164,39,0.25)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(201,164,39,0.08)',
        }}
      >
        {/* Status bar */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="text-[8px] text-white/30 font-mono">9:41</span>
          <div className="flex gap-1">
            <div className="w-2.5 h-1.5 rounded-sm bg-white/20" />
            <div className="w-2.5 h-1.5 rounded-sm bg-white/20" />
            <div className="w-4 h-2 rounded-sm border border-white/20 flex items-center justify-end pr-0.5">
              <div className="w-2 h-1 rounded-sm bg-emerald-400/60" />
            </div>
          </div>
        </div>
        {/* App header */}
        <div className="px-4 pb-2">
          <div className="text-[10px] font-display gold-text tracking-wider">CLAPCHEEKS</div>
          <div className="text-[7px] text-white/25 font-body">Agent active</div>
        </div>
        {/* Mini stat cards */}
        <div className="px-3 grid grid-cols-2 gap-1.5 mb-2">
          {[
            { n: '847', l: 'Swipes', c: 'text-amber-400' },
            { n: '23', l: 'Matches', c: 'text-amber-400' },
            { n: '11', l: 'Convos', c: 'text-amber-400' },
            { n: '3', l: 'Dates', c: 'text-emerald-400' },
          ].map((s) => (
            <div
              key={s.l}
              className="rounded-lg px-2 py-1.5"
              style={{ background: 'rgba(201,164,39,0.06)', border: '1px solid rgba(201,164,39,0.12)' }}
            >
              <div className={`text-sm font-display leading-none ${s.c}`}>{s.n}</div>
              <div className="text-[6px] text-white/30 font-body mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>
        {/* Mini chart */}
        <div className="px-3 mb-2">
          <div
            className="h-16 rounded-lg flex items-end gap-px px-1.5 pb-1.5"
            style={{ background: 'rgba(201,164,39,0.04)', border: '1px solid rgba(201,164,39,0.08)' }}
          >
            {[35, 50, 45, 70, 55, 85, 60, 75, 40, 90, 65, 80, 50, 70, 95, 55, 75, 85, 60, 45].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${h}%`,
                  background: i >= 16
                    ? 'rgba(201,164,39,0.7)'
                    : `rgba(201,164,39,${0.12 + (h / 100) * 0.2})`,
                }}
              />
            ))}
          </div>
        </div>
        {/* Conversation preview */}
        <div className="px-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[7px] text-white/60 font-body font-semibold">Sarah M.</div>
              <div className="text-[6px] text-white/30 font-body truncate">haha you&apos;re so funny...</div>
            </div>
            <div className="text-[6px] text-emerald-400/60 font-body">2m</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[7px] text-white/60 font-body font-semibold">Jessica K.</div>
              <div className="text-[6px] text-white/30 font-body truncate">yes! friday works for me</div>
            </div>
            <div className="text-[6px] text-emerald-400/60 font-body">8m</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[7px] text-white/60 font-body font-semibold">Emma R.</div>
              <div className="text-[6px] text-white/30 font-body truncate">that restaurant looks amazing</div>
            </div>
            <div className="text-[6px] text-amber-400/60 font-body">15m</div>
          </div>
        </div>
      </div>
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
  const phoneRef = useRef<HTMLDivElement>(null)
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

      tl.from(badgeRef.current, { opacity: 0, y: -16, duration: 0.5 })
      tl.from(line1Ref.current, { opacity: 0, x: -60, duration: 0.7 }, '-=0.2')
      tl.from(line2Ref.current, { opacity: 0, x: -80, duration: 0.7 }, '-=0.5')
      tl.from(line3Ref.current, { opacity: 0, x: -60, duration: 0.6 }, '-=0.5')
      tl.from(subRef.current, { opacity: 0, y: 20, duration: 0.6 }, '-=0.3')
      tl.from(installRef.current, { opacity: 0, y: 20, duration: 0.5 }, '-=0.4')
      tl.from(ctaRef.current, { opacity: 0, y: 20, duration: 0.5 }, '-=0.3')

      // Phone + ring
      tl.from(phoneRef.current, { opacity: 0, y: 40, scale: 0.92, duration: 1.2, ease: 'power2.out' }, 0.3)

      // Floating stat badges
      tl.from([badge1Ref.current, badge2Ref.current, badge3Ref.current], {
        opacity: 0, scale: 0.8, stagger: 0.15, duration: 0.5,
      }, '-=0.6')

      // Continuous badge float
      gsap.to(badge1Ref.current, { y: -8, repeat: -1, yoyo: true, duration: 2.5, ease: 'sine.inOut' })
      gsap.to(badge2Ref.current, { y: 6, repeat: -1, yoyo: true, duration: 3, ease: 'sine.inOut', delay: 0.8 })
      gsap.to(badge3Ref.current, { y: -5, repeat: -1, yoyo: true, duration: 2.2, ease: 'sine.inOut', delay: 1.2 })
    }, containerRef)

    return () => ctx.revert()
  }, [])

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex flex-col justify-center overflow-hidden pt-16 pb-8"
      style={{ background: 'linear-gradient(180deg, #000 0%, #0a0a0a 40%, #080808 100%)' }}
    >
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Subtle grid */}
        <div className="absolute inset-0 grid-overlay opacity-60" />
        {/* Warm gold radial on right */}
        <div
          className="absolute"
          style={{
            width: '800px', height: '800px', top: '10%', right: '-15%',
            background: 'radial-gradient(circle, rgba(201,164,39,0.06) 0%, rgba(232,160,30,0.02) 40%, transparent 65%)',
            filter: 'blur(60px)',
          }}
        />
        {/* Subtle orange bottom-left */}
        <div
          className="absolute"
          style={{
            width: '500px', height: '500px', bottom: '5%', left: '-10%',
            background: 'radial-gradient(circle, rgba(232,120,30,0.04) 0%, transparent 60%)',
            filter: 'blur(50px)',
          }}
        />
        {/* Diagonal gold accent */}
        <div
          className="absolute"
          style={{
            top: '20%', left: '-10%', right: '-10%', height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(201,164,39,0.15) 30%, rgba(201,164,39,0.4) 50%, rgba(201,164,39,0.15) 70%, transparent 100%)',
            transform: 'rotate(-6deg)',
          }}
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-0 items-center min-h-[calc(100vh-4rem)]">

          {/* ── LEFT: Copy ─────────────────────────── */}
          <div className="relative z-10 flex flex-col justify-center py-16 lg:py-0">
            {/* Badge */}
            <div ref={badgeRef} className="inline-flex items-center gap-2 mb-8 self-start">
              <div className="flex items-center gap-2 border border-amber-500/30 rounded-full px-4 py-1.5" style={{ background: 'rgba(201,164,39,0.06)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400 text-xs font-body font-semibold tracking-wider uppercase">
                  Now in beta — 7 days free
                </span>
              </div>
            </div>

            {/* Headline */}
            <div className="mb-6">
              <div ref={line1Ref} className="font-display text-6xl sm:text-7xl lg:text-8xl xl:text-9xl text-white leading-none uppercase tracking-wide">
                MOST MEN
              </div>
              <div ref={line2Ref} className="font-display text-6xl sm:text-7xl lg:text-8xl xl:text-9xl leading-none uppercase tracking-wide gold-text">
                BEG FOR
              </div>
              <div ref={line3Ref} className="font-display text-6xl sm:text-7xl lg:text-8xl xl:text-9xl text-white leading-none uppercase tracking-wide">
                DATES.
              </div>
            </div>

            {/* Accent divider */}
            <div className="flex items-center gap-4 mb-6">
              <div className="h-px w-12 bg-gradient-to-r from-amber-500 to-amber-500/0" />
              <span className="text-amber-500/80 text-xs font-body font-bold tracking-widest uppercase">You automate them.</span>
            </div>

            {/* Sub */}
            <p ref={subRef} className="font-body text-base sm:text-lg text-white/50 leading-relaxed max-w-lg mb-8">
              Clapcheeks is an AI that swipes, messages, and books dates for you —
              {' '}<span className="text-white/80 font-semibold">running privately on your Mac</span>{' '}
              while you live like a winner.
            </p>

            {/* Install command */}
            <div ref={installRef} className="mb-6 max-w-lg">
              <div
                className="flex items-center justify-between rounded-xl px-4 py-3.5 group cursor-pointer transition-all duration-300 hover:border-amber-500/40"
                style={{ background: 'rgba(10,10,10,0.9)', border: '1px solid rgba(201,164,39,0.2)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-amber-500/40 font-mono text-sm shrink-0">$</span>
                  <code className="text-sm font-mono text-amber-400 truncate">{INSTALL_CMD}</code>
                </div>
                <button
                  onClick={handleCopy}
                  className="ml-3 shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-amber-500/10 text-white/40 hover:text-amber-400 transition-all duration-200"
                  aria-label="Copy install command"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
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
                  {i > 0 && <span className="text-white/10 mr-3">&middot;</span>}
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Phone mockup + floating badges ─── */}
          <div ref={phoneRef} className="relative flex items-center justify-center h-full min-h-[460px] lg:min-h-[600px]">
            <GlowRing />

            {/* Floating stat badges */}
            <div ref={badge1Ref} className="absolute hidden sm:block" style={{ top: '12%', right: '2%' }}>
              <StatBadge label="Matches" value="23" delta="+8 vs yesterday" />
            </div>
            <div ref={badge2Ref} className="absolute hidden sm:block" style={{ top: '45%', left: '-2%' }}>
              <StatBadge label="Swipes" value="847" delta="+12% this week" />
            </div>
            <div ref={badge3Ref} className="absolute hidden sm:block" style={{ bottom: '12%', right: '4%' }}>
              <StatBadge label="Dates" value="3" delta="This week" />
            </div>
          </div>
        </div>

        {/* ── Social proof bar ────────────────────── */}
        <div className="pb-12 pt-4 border-t border-white/[0.06]">
          <p className="text-[10px] text-white/20 mb-5 uppercase tracking-widest font-body font-semibold text-center">
            Works with
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {['Tinder', 'Bumble', 'Hinge', 'iMessage', 'Calendar'].map((app) => (
              <span key={app} className="text-sm font-display tracking-wider text-white/15 uppercase">{app}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
