'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Copy, Check } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const INSTALL_CMD = 'curl -fsSL https://clapcheeks.tech/install.sh | bash'

// Abstract crown / chess piece visual — represents dominance without literal people
function CrownVisual() {
  return (
    <div className="flex justify-center mb-8">
      <div className="relative">
        {/* Glow behind */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            width: '120px',
            height: '120px',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(circle, rgba(201,164,39,0.25) 0%, transparent 70%)',
            filter: 'blur(30px)',
          }}
        />
        {/* Knight chess piece icon — like Tate's logo */}
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          fill="none"
          className="relative z-10"
          style={{ filter: 'drop-shadow(0 0 20px rgba(201,164,39,0.4))' }}
        >
          <defs>
            <linearGradient id="gold-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#C9A427" />
              <stop offset="50%" stopColor="#E8C547" />
              <stop offset="100%" stopColor="#C9A427" />
            </linearGradient>
          </defs>
          {/* Crown / chess knight simplified */}
          <path
            d="M40 8 L20 28 L24 32 L18 50 L14 68 L66 68 L62 50 L56 32 L60 28 L40 8Z"
            stroke="url(#gold-grad)"
            strokeWidth="2"
            fill="none"
          />
          {/* Crown points */}
          <path d="M28 24 L40 12 L52 24" stroke="url(#gold-grad)" strokeWidth="2" fill="none" strokeLinejoin="round" />
          <circle cx="40" cy="12" r="3" fill="#C9A427" />
          <circle cx="28" cy="24" r="2" fill="#C9A427" />
          <circle cx="52" cy="24" r="2" fill="#C9A427" />
          {/* Base line */}
          <line x1="14" y1="72" x2="66" y2="72" stroke="url(#gold-grad)" strokeWidth="2" />
        </svg>
      </div>
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
        {/* Crown visual */}
        <CrownVisual />

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
