'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const VIDEO_ID = 'dQw4w9WgXcQ'

const highlights = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="#C9A427" strokeWidth="1.5" />
        <path d="M10 6v4l2.5 2.5" stroke="#E8C547" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: '2 min setup',
    description: 'Install, connect your apps, and let it rip.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="3" stroke="#C9A427" strokeWidth="1.5" />
        <path d="M8 7l5 3-5 3V7z" fill="#E8C547" />
      </svg>
    ),
    title: 'Full autopilot demo',
    description: 'Watch swiping, messaging, and date booking — hands-free.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 13l4 4L17 5" stroke="#C9A427" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="14" cy="6" r="3" stroke="#E8C547" strokeWidth="1.5" />
      </svg>
    ),
    title: 'Real results shown',
    description: 'Actual match rates, conversations, and dates landed.',
  },
]

export default function DemoVideo() {
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headerRef.current, {
        opacity: 0,
        y: 50,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: headerRef.current,
          start: 'top 85%',
        },
      })

      gsap.from(videoRef.current, {
        opacity: 0,
        y: 40,
        scale: 0.96,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: videoRef.current,
          start: 'top 85%',
        },
        delay: 0.15,
      })

      const cardEls = cardsRef.current?.querySelectorAll('.highlight-card')
      if (cardEls) {
        gsap.from(cardEls, {
          opacity: 0,
          y: 30,
          stagger: 0.12,
          duration: 0.7,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: cardsRef.current,
            start: 'top 90%',
          },
        })
      }

      gsap.from(ctaRef.current, {
        opacity: 0,
        y: 20,
        duration: 0.6,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: ctaRef.current,
          start: 'top 92%',
        },
      })
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} id="demo" className="py-28 px-6 relative overflow-hidden">
      {/* Background glow behind video */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute"
          style={{
            top: '35%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '900px',
            height: '500px',
            background: 'radial-gradient(ellipse, rgba(201,164,39,0.06) 0%, transparent 65%)',
            filter: 'blur(80px)',
          }}
        />
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 grid-overlay"
          style={{ opacity: 0.3 }}
        />
      </div>

      <div className="max-w-5xl mx-auto relative">
        {/* Header */}
        <div ref={headerRef} className="text-center mb-14">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="h-px w-8 bg-amber-500" />
            <span className="text-amber-400 text-xs font-body font-bold tracking-widest uppercase">
              See it in action
            </span>
            <div className="h-px w-8 bg-amber-500" />
          </div>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl text-white uppercase leading-none mb-5">
            WATCH THE
            <br />
            <span className="gold-text">DEMO.</span>
          </h2>
          <p className="font-body text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            Two minutes. No fluff. See exactly how Clapcheeks runs your dating apps on autopilot.
          </p>
        </div>

        {/* Video embed */}
        <div ref={videoRef} className="mb-14">
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{
              boxShadow: '0 0 60px rgba(201,164,39,0.12), 0 0 120px rgba(201,164,39,0.04)',
              border: '1px solid rgba(201,164,39,0.2)',
            }}
          >
            {/* Gold glow border effect */}
            <div
              className="absolute -inset-px rounded-2xl pointer-events-none"
              style={{
                background: 'linear-gradient(135deg, rgba(201,164,39,0.15) 0%, transparent 40%, transparent 60%, rgba(201,164,39,0.1) 100%)',
                zIndex: 1,
              }}
            />
            {/* 16:9 aspect ratio container */}
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                className="absolute inset-0 w-full h-full"
                src={`https://www.youtube.com/embed/${VIDEO_ID}?rel=0&modestbranding=1&color=white`}
                title="Clapcheeks Demo"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>

        {/* Highlight cards */}
        <div ref={cardsRef} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
          {highlights.map((h) => (
            <div
              key={h.title}
              className="highlight-card alpha-card rounded-2xl p-6 text-center transition-all duration-300"
            >
              <div className="flex justify-center mb-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'rgba(201,164,39,0.08)',
                    border: '1px solid rgba(201,164,39,0.2)',
                  }}
                >
                  {h.icon}
                </div>
              </div>
              <h3 className="font-display text-xl gold-text uppercase mb-2">
                {h.title}
              </h3>
              <p className="font-body text-white/40 text-sm leading-relaxed">
                {h.description}
              </p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div ref={ctaRef} className="text-center">
          <Link
            href="/auth/sign-up"
            className="btn-gold font-body inline-flex items-center justify-center gap-2 px-10 py-4 rounded-xl text-sm"
          >
            TRY IT FREE
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <p className="font-body text-xs text-white/20 mt-4">
            No credit card required &middot; 7-day free trial
          </p>
        </div>
      </div>

      {/* Bottom section divider */}
      <div className="section-slash mt-28" />
    </section>
  )
}
