'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Copy, Check } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const INSTALL_CMD = 'curl -fsSL https://clapcheeks.tech/install.sh | bash'

// Two male silhouettes — one dominant, one submissive (smaller)
function SilhouettePair() {
  return (
    <div className="relative flex items-end justify-center gap-8 h-52">
      {/* Smaller / submissive figure (left) */}
      <svg
        viewBox="0 0 200 380"
        fill="currentColor"
        className="h-full opacity-20"
        style={{ color: '#fff', width: 'auto' }}
        aria-hidden="true"
      >
        <ellipse cx="100" cy="38" rx="28" ry="34" />
        <rect x="87" y="70" width="26" height="18" rx="3" />
        <path d="M25 100 Q45 85 70 82 L100 88 L130 82 Q155 85 175 100 L162 220 L38 220 Z" />
        <path d="M38 140 C22 158 10 200 8 240 Q6 258 16 264 L28 267 Q38 270 40 254 L56 172 Z" />
        <path d="M162 140 C178 158 190 200 192 240 Q194 258 184 264 L172 267 Q162 270 160 254 L144 172 Z" />
        <path d="M44 216 L32 372 L76 372 L100 300 Z" />
        <path d="M156 216 L168 372 L124 372 L100 300 Z" />
      </svg>

      {/* Dominant figure (right, taller) */}
      <svg
        viewBox="0 0 280 520"
        fill="currentColor"
        className="h-full"
        style={{ color: 'rgba(201,164,39,0.85)', width: 'auto', filter: 'drop-shadow(0 0 30px rgba(201,164,39,0.4))' }}
        aria-hidden="true"
      >
        <ellipse cx="140" cy="48" rx="38" ry="44" />
        <rect x="124" y="88" width="32" height="22" rx="4" />
        <path d="M30 125 Q55 108 90 105 L140 112 L190 105 Q225 108 250 125 L235 280 L45 280 Z" />
        <path d="M50 155 C30 175 12 240 8 295 Q5 318 18 325 L34 328 Q50 332 52 312 L72 220 Z" />
        <path d="M230 155 C250 175 268 240 272 295 Q275 318 262 325 L246 328 Q230 332 228 312 L208 220 Z" />
        <path d="M58 275 L72 395 L208 395 L222 275 Z" />
        <path d="M72 390 L52 510 L104 510 L140 420 Z" />
        <path d="M208 390 L228 510 L176 510 L140 420 Z" />
      </svg>
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
