'use client'

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const features = [
  {
    number: '01',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M4 7h20M4 14h14M4 21h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="22" cy="20" r="4" stroke="currentColor" strokeWidth="2" />
        <path d="M20.5 20h3M22 18.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'AI iMessage',
    tag: 'Conversations',
    description:
      'Clapcheeks reads your message history, learns your tone, and replies in your voice using local LLMs. Your matches talk to "you" — even when you\'re in the gym.',
  },
  {
    number: '02',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 4 L18 12 L26 12 L20 18 L22 26 L14 22 L6 26 L8 18 L2 12 L10 12 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />
      </svg>
    ),
    title: 'Smart Swiping',
    tag: 'Automation',
    description:
      'Set your type once. The agent swipes Tinder, Bumble, and Hinge based on your actual attraction patterns — running in the background while you focus on what matters.',
  },
  {
    number: '03',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="3" y="5" width="22" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M3 11h22" stroke="currentColor" strokeWidth="2" />
        <path d="M9 3v4M19 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 16h4M8 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: 'Date Booking',
    tag: 'Scheduling',
    description:
      'When the conversation is ready, the AI checks your calendar and proposes a time. Dates get booked, reminders get set, confirmations get sent — you just show up.',
  },
  {
    number: '04',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M4 22 L4 16 L10 16 L10 22" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M11 22 L11 10 L17 10 L17 22" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M18 22 L18 6 L24 6 L24 22" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M2 22h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: 'Analytics Dashboard',
    tag: 'Intelligence',
    description:
      'Swipe-to-match rate. Match-to-date conversion. Cost-per-date. Response time patterns. Know every number that matters and optimize like an athlete studies film.',
  },
  {
    number: '05',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 4 C8 4 4 8.5 4 14 C4 19.5 8 24 14 24 C20 24 24 19.5 24 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M20 4 L24 8 M24 4 L20 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M10 14 L13 17 L19 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'AI Coaching',
    tag: 'Coaching',
    description:
      'Weekly personalized reports with brutally honest insights. Which openers convert? Which photos get the most swipes? The AI tells you exactly what to change.',
  },
  {
    number: '06',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 3 L5 8.5 V15.5 C5 20.5 9 25 14 26.5 C19 25 23 20.5 23 15.5 V8.5 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />
        <path d="M10 14.5 L13 17.5 L18 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: '100% Private',
    tag: 'Privacy',
    description:
      'Every message, match, and conversation stays on your Mac. We never see your data. Only anonymized swipe counts sync to the cloud — never content, never names.',
  },
]

export default function Features() {
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Header reveal
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

      // Cards stagger reveal
      const cards = cardsRef.current?.querySelectorAll('.feature-card-item')
      if (cards) {
        gsap.from(cards, {
          opacity: 0,
          y: 60,
          x: -20,
          stagger: 0.1,
          duration: 0.7,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: cardsRef.current,
            start: 'top 80%',
          },
        })
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} id="features" className="py-28 px-6 relative overflow-hidden">
      {/* Gold accent orb */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '20%',
          right: '-15%',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(201,164,39,0.07) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      <div className="max-w-7xl mx-auto relative">
        {/* Header */}
        <div ref={headerRef} className="mb-16 max-w-2xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px w-8 bg-yellow-500" />
            <span className="text-yellow-500 text-xs font-body font-bold tracking-widest uppercase">
              Your unfair advantage
            </span>
          </div>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl text-white mb-5 uppercase leading-none">
            SIX WEAPONS.
            <br />
            <span className="gold-text">ONE AGENT.</span>
          </h2>
          <p className="font-body text-white/45 text-lg leading-relaxed">
            Clapcheeks combines AI conversation management, intelligent automation,
            and deep analytics into a single agent that runs silently on your Mac.
          </p>
        </div>

        {/* Feature grid */}
        <div ref={cardsRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="feature-card-item feature-card alpha-card rounded-2xl p-6 group cursor-default"
            >
              {/* Number + tag row */}
              <div className="flex items-center justify-between mb-5">
                <span className="font-display text-4xl text-yellow-500/20 leading-none">
                  {feature.number}
                </span>
                <span className="text-[10px] font-body font-bold text-yellow-500/40 border border-yellow-500/15 bg-yellow-500/5 px-2 py-0.5 rounded-full tracking-widest uppercase">
                  {feature.tag}
                </span>
              </div>

              {/* Icon */}
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-yellow-400 transition-colors group-hover:text-yellow-300"
                style={{ background: 'rgba(201,164,39,0.08)', border: '1px solid rgba(201,164,39,0.2)' }}
              >
                {feature.icon}
              </div>

              {/* Content */}
              <h3 className="font-display text-2xl text-white mb-3 uppercase tracking-wide group-hover:text-yellow-400 transition-colors">
                {feature.title}
              </h3>
              <p className="font-body text-sm text-white/45 leading-relaxed">
                {feature.description}
              </p>

              {/* Hover bottom line */}
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-b-2xl"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(201,164,39,0.6), transparent)' }}
              />
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="mt-10 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/[0.05]" />
          <p className="font-body text-sm text-white/25 text-center px-4">
            All features run offline — no cloud required, no data ever leaves your Mac.
          </p>
          <div className="h-px flex-1 bg-white/[0.05]" />
        </div>
      </div>
    </section>
  )
}
