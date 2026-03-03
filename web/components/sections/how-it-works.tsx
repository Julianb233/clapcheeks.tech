'use client'

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const steps = [
  {
    number: '01',
    title: 'INSTALL IN 30 SECONDS',
    description:
      'One terminal command installs Clapcheeks on your Mac. No dependencies, no config files. It unpacks, sets up your local agent, and launches your dashboard.',
    code: 'curl -fsSL https://clapcheeks.tech/install.sh | bash',
    detail: 'macOS 13 Ventura or later. Apple Silicon and Intel both supported.',
  },
  {
    number: '02',
    title: 'CONNECT YOUR APPS',
    description:
      'Link Tinder, Bumble, and Hinge through secure OAuth. Grant iMessage access so the AI learns your tone. Five minutes of setup. Then it builds your preference profile silently.',
    detail: 'Your credentials live in your Mac\'s Keychain. Never on our servers.',
  },
  {
    number: '03',
    title: 'DOMINATE ON AUTOPILOT',
    description:
      'The agent runs in the background — swiping based on your patterns, keeping conversations alive, booking dates on your calendar, and delivering weekly analytics reports.',
    detail: 'You stay in control — review, override, or pause any action at any time.',
  },
]

export default function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const stepsRef = useRef<HTMLDivElement>(null)
  const mockupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headerRef.current, {
        opacity: 0,
        x: -60,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: headerRef.current,
          start: 'top 85%',
        },
      })

      const stepEls = stepsRef.current?.querySelectorAll('.step-item')
      if (stepEls) {
        gsap.from(stepEls, {
          opacity: 0,
          x: -80,
          stagger: 0.2,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: stepsRef.current,
            start: 'top 80%',
          },
        })
      }

      gsap.from(mockupRef.current, {
        opacity: 0,
        y: 60,
        scale: 0.95,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: mockupRef.current,
          start: 'top 85%',
        },
      })
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} id="how-it-works" className="py-28 px-6 relative overflow-hidden">
      {/* Red left accent */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, transparent, rgba(232,41,30,0.5), transparent)',
        }}
      />

      {/* Background grid */}
      <div className="absolute inset-0 grid-overlay opacity-40 pointer-events-none" />

      <div className="max-w-7xl mx-auto relative">
        {/* Header */}
        <div ref={headerRef} className="mb-20 max-w-2xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px w-8 bg-red-500" />
            <span className="text-red-500 text-xs font-body font-bold tracking-widest uppercase">
              Simple setup
            </span>
          </div>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl text-white uppercase leading-none mb-4">
            3 MOVES.
            <br />
            <span className="gold-text">THAT'S IT.</span>
          </h2>
          <p className="font-body text-white/45 text-lg leading-relaxed">
            If you can open Terminal, you can run Clapcheeks. No technical knowledge required.
          </p>
        </div>

        {/* Steps */}
        <div ref={stepsRef} className="max-w-3xl mb-24">
          {steps.map((step, i) => (
            <div key={step.number} className="step-item flex gap-6 mb-14 last:mb-0 group">
              {/* Left: number + connector line */}
              <div className="flex flex-col items-center shrink-0 w-14">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-105"
                  style={{
                    background: 'rgba(201,164,39,0.08)',
                    border: '1px solid rgba(201,164,39,0.3)',
                    boxShadow: '0 0 0 0 rgba(201,164,39,0)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 20px rgba(201,164,39,0.2)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 0 rgba(201,164,39,0)'
                  }}
                >
                  <span className="font-display text-2xl text-yellow-400 leading-none">{step.number}</span>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className="w-px flex-1 mt-4"
                    style={{
                      background: 'linear-gradient(180deg, rgba(201,164,39,0.4) 0%, rgba(201,164,39,0.05) 100%)',
                    }}
                  />
                )}
              </div>

              {/* Right: content */}
              <div className="pt-2 pb-4 min-w-0 flex-1">
                <h3 className="font-display text-3xl sm:text-4xl text-white uppercase leading-none mb-3 group-hover:text-yellow-400 transition-colors">
                  {step.title}
                </h3>
                <p className="font-body text-white/50 leading-relaxed mb-4 text-base">
                  {step.description}
                </p>

                {step.code && (
                  <div
                    className="inline-flex items-center gap-3 rounded-xl px-4 py-3 mb-4 max-w-full overflow-hidden"
                    style={{
                      background: 'rgba(0,0,0,0.8)',
                      border: '1px solid rgba(201,164,39,0.2)',
                    }}
                  >
                    <span className="text-yellow-500/40 font-mono text-sm shrink-0">$</span>
                    <code className="font-mono text-sm text-yellow-400 truncate">{step.code}</code>
                  </div>
                )}

                <p className="font-body text-xs text-white/25 flex items-start gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-0.5 shrink-0">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" />
                    <path d="M6 5v4M6 3.5v.5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {step.detail}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Dashboard mockup */}
        <div ref={mockupRef} className="max-w-3xl mx-auto">
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(0,0,0,0.8)',
              border: '1px solid rgba(201,164,39,0.2)',
              boxShadow: '0 0 80px rgba(201,164,39,0.05)',
            }}
          >
            {/* Window chrome */}
            <div
              className="flex items-center gap-1.5 px-4 py-3"
              style={{ borderBottom: '1px solid rgba(201,164,39,0.1)' }}
            >
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
              <span className="ml-3 font-mono text-xs text-white/20">clapcheeks — dashboard</span>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-[10px] text-yellow-400/60 font-body">AGENT ACTIVE</span>
              </div>
            </div>

            {/* Stats grid */}
            <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Swipes Today', value: '847', delta: '+12%', color: 'text-yellow-400' },
                { label: 'New Matches', value: '23', delta: '+8%', color: 'text-yellow-400' },
                { label: 'Active Convos', value: '11', delta: '+2', color: 'text-yellow-400' },
                { label: 'Dates This Week', value: '3', delta: 'new', color: 'text-emerald-400' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl p-3"
                  style={{ background: 'rgba(201,164,39,0.04)', border: '1px solid rgba(201,164,39,0.1)' }}
                >
                  <div className={`font-display text-2xl ${stat.color} leading-none mb-1`}>{stat.value}</div>
                  <div className="font-body text-[10px] text-white/30 mb-1">{stat.label}</div>
                  <div className="font-body text-[10px] font-semibold text-emerald-400">{stat.delta}</div>
                </div>
              ))}
            </div>

            {/* Activity bars */}
            <div className="px-5 pb-5">
              <div
                className="h-14 rounded-xl flex items-end gap-0.5 px-3 py-2"
                style={{ background: 'rgba(201,164,39,0.03)', border: '1px solid rgba(201,164,39,0.08)' }}
              >
                {Array.from({ length: 32 }).map((_, i) => {
                  const heights = [30, 45, 60, 40, 75, 55, 80, 50, 65, 35, 90, 70, 45, 85, 60, 40, 75, 55, 65, 80, 50, 35, 70, 45, 90, 60, 40, 75, 55, 80, 65, 50]
                  const h = heights[i % heights.length]
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{
                        height: `${h}%`,
                        background: i > 24
                          ? 'rgba(201,164,39,0.7)'
                          : `rgba(201,164,39,${0.15 + (h / 100) * 0.25})`,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          </div>
          <p className="text-center font-body text-xs text-white/20 mt-4">
            Live dashboard — updates every time the agent runs
          </p>
        </div>
      </div>
    </section>
  )
}
